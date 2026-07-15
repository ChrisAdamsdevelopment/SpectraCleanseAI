// ALPHA-001 §14 — Grok / xAI as a first-class provider. Every request is driven
// through a MOCK ProviderIo, so this asserts the exact documented request shapes
// and the full lifecycle without a key, credits, or a network.
// Run: npm run grok:test

import assert from 'node:assert/strict';
import {
  createGrokTextAdapter, createGrokImageAdapter, createGrokVideoAdapter,
  testXaiConnection, mapXaiError, xaiVideoCapabilities,
  XAI_BASE, XAI_TEXT_MODEL, XAI_IMAGE_MODEL, XAI_VIDEO_MODEL, XAI_VIDEO_REF_MODEL,
  XAI_MAX_VIDEO_SECONDS, XAI_MAX_EDIT_REFERENCES, XAI_MAX_IMAGE_OUTPUTS,
} from './xai';
import type { ProviderIo } from './types';
import { assessProviderReadiness, canSubmit, unresolvedOverrideKeys } from '../providerReadiness';
import { assessImageReadiness } from '../referenceGen';
import { capabilitiesFor, imageCapabilitiesFor, providerDescriptor, resolveVideoProvider, resolveImageProvider, resolveRepairProvider } from './registry';
import {
  emptyDirectorState, makeEntity, makeReference, makeScene, makeReferenceRequest,
} from '../model';
import { compileScenePacket } from '../compile';
import {
  addTakeFromPacket, applyProviderSubmit, applyProviderPoll, applyProviderResult,
  resumableTakes, addRepairAttempt, acceptTake,
} from '../actions';
import { normalizeDirectorState } from '../normalize';
import { parseToolFromModelText } from '../toolSchema';

const KEY = 'xai-9f8e7d6c5b4a3210zyxwvutsrqponmlkjihgfedcba';

interface Call { url: string; method: string; body: unknown; headers: Record<string, string> }

/** A mock ProviderIo that records calls and returns scripted responses. */
function mockIo(script: Array<{ ok: boolean; status: number; json: unknown; text?: string }>) {
  const calls: Call[] = [];
  let i = 0;
  const io: ProviderIo & { calls: Call[] } = {
    calls,
    async readBase64(p) { return `BASE64(${p})`; },
    mimeType(p) { return p.endsWith('.png') ? 'image/png' : 'image/jpeg'; },
    async fetchJson(url, init) {
      calls.push({ url, method: init.method ?? 'GET', body: init.body ? JSON.parse(init.body) : null, headers: init.headers ?? {} });
      const r = script[Math.min(i, script.length - 1)]; i++;
      return { ok: r.ok, status: r.status, text: r.text ?? JSON.stringify(r.json), json: r.json };
    },
    async downloadToFile() { return 4096; },
    async writeBase64ToFile() { return 2048; },
  };
  return io;
}

// ── Registry: Grok is registered as a peer, not a fork ─────────────────────
{
  assert.equal(providerDescriptor('xai-video').account, 'xai', 'Grok video draws on the xAI account');
  assert.equal(capabilitiesFor('xai-video').maxDurationSec, XAI_MAX_VIDEO_SECONDS, 'documented 15s cap declared');
  assert.equal(imageCapabilitiesFor('xai-image').referenceImages, XAI_MAX_EDIT_REFERENCES, 'documented 3-reference edit cap');
  assert.equal(imageCapabilitiesFor('xai-image').maxOutputs, XAI_MAX_IMAGE_OUTPUTS, 'documented 10-output cap');

  // Undocumented capabilities are declared FALSE, never guessed.
  assert.equal(xaiVideoCapabilities.sourceVideoEditing, false, 'source-video editing is NOT documented for Grok → false');
  assert.equal(xaiVideoCapabilities.videoExtension, false, 'video extension is NOT documented for Grok → false');
  assert.equal(xaiVideoCapabilities.audioInput, false, 'audio conditioning not documented → false');
  assert.equal(xaiVideoCapabilities.imageToVideo, true, 'image-to-video IS documented → true');
}

// ── 'Auto' resolution uses capability + connection, never wishful thinking ──
{
  assert.equal(resolveVideoProvider('auto', { google: true, xai: true }), 'google-omni', 'Google preferred when both connected');
  assert.equal(resolveVideoProvider('auto', { google: false, xai: true }), 'xai-video', 'Grok used when it is what is connected');
  assert.equal(resolveVideoProvider('auto', { google: false, xai: false }), 'manual', 'nothing connected → the always-available manual path');
  assert.equal(resolveVideoProvider('xai-video', { google: true, xai: false }), 'xai-video', 'an explicit choice is respected');
  assert.equal(resolveImageProvider('auto', { google: false, xai: true }), 'xai-image');

  // A repair needs documented source-video editing — Grok must NOT be chosen,
  // because silently "repairing" via regeneration would be a lie.
  assert.equal(resolveRepairProvider('auto', { google: false, xai: true }), 'manual', 'auto never routes a repair to a provider that cannot edit source video');
  assert.equal(resolveRepairProvider('auto', { google: true, xai: true }), 'google-omni', 'repair goes to the provider that documents source-video editing');
}

// ── Connection test: cheapest documented call, correct shape ───────────────
{
  const io = mockIo([{ ok: true, status: 200, json: { choices: [{ message: { content: 'hi' } }] } }]);
  const r = await testXaiConnection(KEY, io);
  assert.equal(r.ok, true);
  assert.match(r.message, /Connected to xAI/);
  const call = io.calls[0];
  assert.equal(call.url, `${XAI_BASE}/chat/completions`, 'uses the documented chat endpoint');
  assert.equal(call.method, 'POST');
  assert.equal(call.headers.Authorization, `Bearer ${KEY}`, 'documented bearer auth');
  assert.equal((call.body as { model: string }).model, XAI_TEXT_MODEL);
  assert.equal((call.body as { max_tokens: number }).max_tokens, 1, '1 token — never generates a video to test a key');

  const empty = await testXaiConnection('  ', io);
  assert.equal(empty.ok, false, 'blank key rejected before any network call');
}

// ── Error mapping distinguishes every required case (§8E) ─────────────────
{
  assert.equal(mapXaiError(401, 'invalid api key').category, 'invalid-key');
  assert.equal(mapXaiError(403, 'insufficient credits for this request').category, 'no-credits');
  assert.equal(mapXaiError(402, 'payment required').category, 'no-credits');
  assert.equal(mapXaiError(403, 'permission denied for scope').category, 'no-permission');
  assert.equal(mapXaiError(404, 'model not found').category, 'model-unavailable');
  assert.equal(mapXaiError(429, 'rate limit exceeded').category, 'rate-limited');
  assert.equal(mapXaiError(451, 'unavailable in your region').category, 'region-restricted');
  assert.equal(mapXaiError(500, 'internal error').category, 'provider-outage');
  assert.equal(mapXaiError(0, 'fetch failed').category, 'network');
  assert.equal(mapXaiError(418, 'weird').category, 'unknown');

  // A consumer Grok subscription is not API access — the credits message says so.
  assert.match(mapXaiError(403, 'no credits').message, /credits/i);
  assert.match(mapXaiError(403, 'no credits').message, /xAI console/i, 'tells the tester exactly where to fix it');
  // Never a raw body as the only message.
  assert.ok(!mapXaiError(500, 'panic: nil deref at 0xdeadbeef').message.includes('0xdeadbeef'));
}

// ── A. Grok text: structured output feeds the SAFE schema validator ────────
{
  const toolJson = JSON.stringify({
    name: 'Beat Emphasis', description: 'mark emphasised beats', appliesTo: ['scene'],
    fields: [{ id: 'beats', kind: 'beat-grid', label: 'Beats', beats: 8 }],
    outputSchema: { beats: 'beats' }, compileHints: 'emphasise these beats',
  });
  const io = mockIo([{ ok: true, status: 200, json: { choices: [{ message: { content: toolJson } }] } }]);
  const text = createGrokTextAdapter({ key: KEY, io });
  assert.equal(text.isConfigured(), true);
  const r = await text.complete('make me a tool');
  assert.equal(r.ok, true);
  const call = io.calls[0];
  assert.equal(call.url, `${XAI_BASE}/chat/completions`);
  assert.equal((call.body as { model: string }).model, XAI_TEXT_MODEL);

  // The model's output is DATA and must still pass the declarative allowlist.
  const validated = parseToolFromModelText(r.text);
  assert.equal(validated.ok, true, 'a valid declarative tool from Grok installs');
  assert.equal(validated.tool!.fields[0].kind, 'beat-grid');

  // Anything non-declarative is rejected by the SAME validator — Grok cannot
  // smuggle executable behaviour in.
  const evil = parseToolFromModelText(JSON.stringify({
    name: 'Evil', description: 'x', appliesTo: ['scene'],
    fields: [{ id: 'a', kind: 'eval-script', label: 'Run', code: 'process.exit(1)' }], outputSchema: {},
  }));
  assert.equal(evil.ok, false, 'a non-allowlisted field kind from Grok is REJECTED');
}
{
  // Text errors map, and an unconfigured adapter never pretends.
  const io = mockIo([{ ok: false, status: 401, json: {}, text: 'invalid api key' }]);
  const r = await createGrokTextAdapter({ key: KEY, io }).complete('x');
  assert.equal(r.ok, false);
  assert.equal(r.error!.category, 'invalid-key');

  const none = await createGrokTextAdapter({ key: null, io }).complete('x');
  assert.equal(none.ok, false);
  assert.match(none.error!.message, /Settings/i, 'tells the user how to connect');
}

// ── B. Grok image: generation + editing use the documented endpoints ───────
{
  // No references → /images/generations
  const io = mockIo([{ ok: true, status: 200, json: { data: [{ b64_json: 'AAAA' }] } }]);
  const img = createGrokImageAdapter({ key: KEY, io });
  const r = await img.submit({ prompt: 'a profile of Sobelo', referenceImagePaths: [], outputCount: 1, aspect: '9:16' });
  assert.equal(r.phase, 'succeeded');
  assert.deepEqual(r.resultInlineBase64, ['AAAA']);
  assert.equal(io.calls[0].url, `${XAI_BASE}/images/generations`, 'text-to-image endpoint');
  assert.equal((io.calls[0].body as { model: string }).model, XAI_IMAGE_MODEL);
  assert.equal((io.calls[0].body as { n: number }).n, 1);
}
{
  // With references → /images/edits, multi-reference
  const io = mockIo([{ ok: true, status: 200, json: { data: [{ b64_json: 'A' }, { b64_json: 'B' }] } }]);
  const r = await createGrokImageAdapter({ key: KEY, io }).submit({
    prompt: 'same face, new angle', referenceImagePaths: ['/f/face.png', '/f/body.png'], outputCount: 2, aspect: '1:1',
  });
  assert.equal(r.phase, 'succeeded');
  assert.equal(r.resultInlineBase64!.length, 2, 'multiple variants returned');
  assert.equal(io.calls[0].url, `${XAI_BASE}/images/edits`, 'multi-reference editing endpoint');
  const body = io.calls[0].body as { image: Array<{ url: string }>; n: number };
  assert.equal(body.image.length, 2, 'both references sent');
  assert.match(body.image[0].url, /^data:image\/png;base64,BASE64\(\/f\/face\.png\)$/, 'documented data-URI image input');
  assert.equal(body.n, 2);
}
{
  // n is capped at the DOCUMENTED limit rather than sending an invalid request.
  const io = mockIo([{ ok: true, status: 200, json: { data: [{ b64_json: 'A' }] } }]);
  await createGrokImageAdapter({ key: KEY, io }).submit({ prompt: 'p', referenceImagePaths: [], outputCount: 99, aspect: '1:1' });
  assert.equal((io.calls[0].body as { n: number }).n, XAI_MAX_IMAGE_OUTPUTS, 'output count clamped to the documented max');
}
{
  // Image readiness BLOCKS more conditioning refs than documented (no silent drop).
  const state = emptyDirectorState();
  const e = makeEntity('Sobelo', 'person', 'lean');
  for (const k of ['face', 'profile', 'hair', 'full-body'] as const) {
    const r = makeReference(e.id, k, `/f/${k}.png`, k, 'upload'); r.approved = true; e.references.push(r);
  }
  state.entities.push(e);
  const req = { ...makeReferenceRequest(e, 'profile', 'xai-image'), conditioningReferenceIds: e.references.map((r) => r.id) };
  const readiness = assessImageReadiness(req, imageCapabilitiesFor('xai-image'));
  assert.ok(readiness.blocking.some((b) => b.id === 'too-many-conditioning'), '4 refs > Grok\'s documented 3 → BLOCKED, never truncated');
  const ok = assessImageReadiness({ ...req, conditioningReferenceIds: req.conditioningReferenceIds.slice(0, 3) }, imageCapabilitiesFor('xai-image'));
  assert.equal(ok.blocking.length, 0, 'within the documented limit is ready');
}
{
  const io = mockIo([{ ok: false, status: 403, json: {}, text: 'insufficient credits' }]);
  const r = await createGrokImageAdapter({ key: KEY, io }).submit({ prompt: 'p', referenceImagePaths: [], outputCount: 1, aspect: '1:1' });
  assert.equal(r.phase, 'failed');
  assert.match(r.error!, /credits/i, 'image errors are plain language');
}

// ── C. Grok video: async submit → poll → download, exact documented shapes ──
{
  const io = mockIo([
    { ok: true, status: 200, json: { request_id: 'req-abc', status: 'pending' } },
    { ok: true, status: 200, json: { status: 'pending' } },
    { ok: true, status: 200, json: { status: 'done', video: { url: 'https://x.ai/v/abc.mp4' } } },
  ]);
  const vid = createGrokVideoAdapter({ key: KEY, io });
  const sub = await vid.submit({
    prompt: 'Sobelo walks', negative: 'no captions', aspect: '9:16', resolution: '720p',
    durationSec: 8, referenceImagePaths: [],
  });
  assert.equal(sub.phase, 'submitted');
  assert.equal(sub.jobId, 'req-abc', 'documented request_id captured');
  assert.equal(io.calls[0].url, `${XAI_BASE}/videos/generations`, 'documented video endpoint');
  const body = io.calls[0].body as { model: string; duration: number; prompt: string };
  assert.equal(body.model, XAI_VIDEO_MODEL, 'text-to-video uses the base video model');
  assert.equal(body.duration, 8, 'EXACT directed duration sent — never silently changed');
  assert.match(body.prompt, /no captions/, 'negative constraints folded into the prompt (Grok has no negative field)');

  assert.equal((await vid.poll('req-abc')).phase, 'running', 'pending → running');
  assert.equal(io.calls[1].url, `${XAI_BASE}/videos/req-abc`, 'documented polling endpoint');
  const done = await vid.poll('req-abc');
  assert.equal(done.phase, 'succeeded');
  assert.equal(done.resultUri, 'https://x.ai/v/abc.mp4', 'documented video.url result');
  assert.equal(await vid.download(done.resultUri!, '/out/x.mp4'), 4096, 'result downloads');
}
{
  // image-to-video / reference-to-video uses the documented reference model.
  const io = mockIo([{ ok: true, status: 200, json: { request_id: 'req-ref' } }]);
  await createGrokVideoAdapter({ key: KEY, io }).submit({
    prompt: 'p', aspect: '9:16', resolution: '720p', durationSec: 6,
    referenceImagePaths: ['/f/face.png'],
  });
  const body = io.calls[0].body as { model: string; image: { url: string } };
  assert.equal(body.model, XAI_VIDEO_REF_MODEL, 'reference-to-video model id used when references are present');
  assert.match(body.image.url, /^data:image\/png;base64,/, 'documented image input');
}
{
  // Immediate completion is handled too.
  const io = mockIo([{ ok: true, status: 200, json: { request_id: 'r1', status: 'done', video: { url: 'https://x.ai/v/now.mp4' } } }]);
  const r = await createGrokVideoAdapter({ key: KEY, io }).submit({ prompt: 'p', aspect: '9:16', resolution: '720p', durationSec: 4, referenceImagePaths: [] });
  assert.equal(r.phase, 'succeeded', 'immediate result supported');
  assert.equal(r.resultUri, 'https://x.ai/v/now.mp4');
}
{
  // Provider-side failure during polling.
  const io = mockIo([{ ok: true, status: 200, json: { status: 'failed', error: 'content policy' } }]);
  const r = await createGrokVideoAdapter({ key: KEY, io }).poll('r');
  assert.equal(r.phase, 'failed');
  assert.match(r.error!, /content policy/);
}
{
  // done-without-url is an honest failure, not a silent success.
  const io = mockIo([{ ok: true, status: 200, json: { status: 'done' } }]);
  const r = await createGrokVideoAdapter({ key: KEY, io }).poll('r');
  assert.equal(r.phase, 'failed');
  assert.match(r.error!, /no URL/i);
}

// ── D. NO SILENT MUTATION: readiness blocks, never trims ──────────────────
{
  const state = emptyDirectorState();
  state.songAudioPath = '/tmp/song.m4a';
  const artist = makeEntity('Sobelo', 'person', 'lean');
  const refs = (['face', 'full-body', 'profile', 'hair'] as const).map((k) => {
    const r = makeReference(artist.id, k, `/f/${k}.png`, k, 'upload'); r.approved = true; return r;
  });
  artist.references.push(...refs);
  state.entities.push(artist);

  // 4 references + a 20s scene — both exceed Grok's DOCUMENTED limits.
  const scene = makeScene('Chorus', 0, 20);
  scene.castings.push({ entityId: artist.id, relationship: 'exact', mustRemain: ['tattoo'], mayVary: [], referenceIds: refs.map((r) => r.id) });
  state.scenes.push(scene);
  const packet = compileScenePacket(state, scene, { attemptId: 'a', audioPath: '/tmp/song.m4a' });

  const readiness = assessProviderReadiness(packet, xaiVideoCapabilities, 'Grok Imagine');
  assert.ok(readiness.blocking.some((b) => b.id === 'too-many-references'), '4 refs > 3 → BLOCKS (never sends only 3)');
  assert.ok(readiness.blocking.some((b) => b.id === 'duration-exceeds-provider'), '20s > 15s → BLOCKS (never shortens)');
  assert.equal(packet.timing.durationSec, 20, 'the packet still carries the EXACT directed 20s');
  assert.equal(canSubmit(readiness, []), false, 'cannot submit while blocked');
  assert.deepEqual(unresolvedOverrideKeys(readiness, []).sort(), ['duration:accept-15', 'refs:choose'].sort());
  assert.equal(canSubmit(readiness, ['refs:choose', 'duration:accept-15']), true, 'explicit, visible overrides unblock');

  // The blocks carry EXECUTABLE resolutions, not just prose.
  const dur = readiness.blocking.find((b) => b.id === 'duration-exceeds-provider')!;
  assert.ok(dur.actions?.some((a) => a.key === 'split-scene'), 'offers to split the scene');
  assert.ok(dur.actions?.some((a) => a.key === 'shorten-scene:15'), 'offers to shorten to the documented cap');
  assert.ok(dur.message.includes('15'), 'names the real limit');

  // Audio is surfaced, never silently omitted.
  assert.ok(readiness.items.some((i) => i.id === 'audio-conditioning-unsupported'), 'Grok cannot take song audio — surfaced honestly');
}

// ── Full lifecycle through the SAME canonical model Google uses ────────────
{
  const state = emptyDirectorState();
  state.songAudioPath = '/tmp/song.m4a';
  const artist = makeEntity('Sobelo', 'person', 'lean');
  const face = makeReference(artist.id, 'face', '/f/face.png', 'face', 'upload'); face.approved = true;
  artist.references.push(face);
  state.entities.push(artist);
  const scene = makeScene('Chorus', 60, 68);
  scene.castings.push({ entityId: artist.id, relationship: 'exact', mustRemain: [], mayVary: [], referenceIds: [face.id] });
  state.scenes.push(scene);

  const packet = compileScenePacket(state, scene, { attemptId: 'take-x' });
  let s = addTakeFromPacket(state, scene, packet, 'xai-video', null, 'take-x').state;
  assert.equal(s.takes[0].requestSnapshot.durationSec, 8, 'exact duration snapshotted');

  // Submit → the request id is persisted IMMEDIATELY (resume-critical).
  s = applyProviderSubmit(s, 'take-x', { providerId: 'xai-video', modelId: XAI_VIDEO_MODEL, jobId: 'req-abc', phase: 'submitted' });
  assert.equal(s.takes[0].providerJob.jobId, 'req-abc');
  assert.equal(s.takes[0].providerJob.providerId, 'xai-video');

  // Reopen the project → the pending Grok job resumes.
  const reopened = normalizeDirectorState(JSON.parse(JSON.stringify(s)));
  const resumable = resumableTakes(reopened);
  assert.equal(resumable.length, 1, 'pending Grok job resumable after reopen');
  assert.equal(resumable[0].providerJob.jobId, 'req-abc');
  assert.equal(resumable[0].provider, 'xai-video', 'and remembers it was Grok');

  // Poll → result → bind to the EXACT take → scene moves to review.
  s = applyProviderPoll(s, 'take-x', { phase: 'running' });
  s = applyProviderResult(s, 'take-x', 'asset-grok-1', '/out/grok.mp4');
  assert.equal(s.takes[0].assetId, 'asset-grok-1', 'result bound to the exact take');
  assert.equal(s.takes[0].providerJob.localResultPath, '/out/grok.mp4');
  assert.equal(s.scenes[0].status, 'review');
  assert.equal(applyProviderResult(s, 'take-x', 'asset-grok-1', '/out/grok.mp4'), s, 'duplicate result binding is a no-op (no duplicate asset)');

  // Accept, then repair — lineage is preserved across providers.
  s = acceptTake(s, 'take-x');
  const { state: s2, take: child } = addRepairAttempt(s, 'take-x', { kind: 'general', preserve: ['the camera'], change: ['the ending'], intervalSec: null, note: '' });
  assert.equal(child.parentTakeId, 'take-x', 'repair lineage kept');
  assert.equal(child.provider, 'xai-video', 'child inherits the provider');
  assert.equal(s2.takes.find((t) => t.id === 'take-x')!.accepted, true, 'parent take preserved');
}

console.log('[grok] PASS — registry/capabilities from DOCUMENTED facts only (undocumented = false), auto never routes a repair to a non-editing provider, 1-token connection test, full error-category mapping with redaction, text output through the safe schema validator, image generation + multi-reference editing endpoints, video async submit/poll/download + immediate results, no silent reference/duration mutation (blocks + executable resolutions), and the full persist/resume/bind/repair lifecycle on the shared canonical model.');
