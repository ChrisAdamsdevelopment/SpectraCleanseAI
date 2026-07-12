import assert from 'node:assert/strict';
import {
  emptyDirectorState, makeEntity, makeReference, makeScene, makeLyricEvent, sceneLyrics,
  makeReferenceRequest, computeIdentityFingerprint,
  type DirectorState, type DirectorTool,
} from './model';
import { normalizeDirectorState } from './normalize';
import { compileScenePacket, compileRepairPacket, compileLipSyncRepairPacket, compileCameraPath } from './compile';
import { assessProviderReadiness, canSubmit, unresolvedOverrideKeys } from './providerReadiness';
import { googleVideoCapabilities } from './providers/googleVideo';
import { omniFlashCapabilities } from './providers/omniFlash';
import { capabilitiesFor, DEFAULT_PROVIDER_ID, providerDescriptor, DEFAULT_IMAGE_PROVIDER_ID, imageCapabilitiesFor } from './providers/registry';
import { createMockAdapter } from './providers/mock';
import { createMockImageAdapter } from './providers/mockImage';
import {
  addTakeFromPacket, applyProviderSubmit, applyProviderPoll, applyProviderResult, resumableTakes,
  addRepairAttempt, addLipSyncRepair, acceptTake, applyEntityIdentity, blockingOverlaps,
  applyRetime, recomputeWorkprintStale, markWorkprintBuilt, takesForScene,
  applySceneResolution, splitScene,
} from './actions';
import {
  assessImageReadiness, applyReferenceSubmit, addProposedVariant, approveProposedVariant,
  rejectProposedVariant, resumableReferenceRequests, compileReferencePackage, setReferenceRequest,
} from './referenceGen';
import { nextPollDecision, POLL_MAX_ATTEMPTS, POLL_MAX_ERRORS } from './polling';
import { planWorkprint, buildWorkprintArgs } from './assembly';

function baseState(): { state: DirectorState; sceneId: string; entityId: string } {
  const state = emptyDirectorState();
  state.songAudioPath = '/tmp/song.m4a';
  const artist = makeEntity('Sobelo', 'person', 'lean');
  const face = makeReference(artist.id, 'face', '/tmp/face.png', 'face', 'upload'); face.approved = true;
  const body = makeReference(artist.id, 'full-body', '/tmp/body.png', 'body', 'upload'); body.approved = true;
  const prof = makeReference(artist.id, 'profile', '/tmp/prof.png', 'profile', 'upload'); prof.approved = true;
  const extra = makeReference(artist.id, 'hair', '/tmp/hair.png', 'hair', 'upload'); extra.approved = true;
  artist.references.push(face, body, prof, extra);
  state.entities.push(artist);
  const scene = makeScene('Chorus', 60, 68);
  scene.castings.push({ entityId: artist.id, relationship: 'exact', mustRemain: ['tattoo'], mayVary: [], referenceIds: [face.id, body.id, prof.id, extra.id] });
  state.scenes.push(scene);
  return { state, sceneId: scene.id, entityId: artist.id };
}

// ── Provider registry / capabilities ─────────────────────────────────────────
assert.equal(DEFAULT_PROVIDER_ID, 'google-omni', 'Omni Flash is the default provider');
assert.equal(providerDescriptor('google-veo').role, 'specialist', 'Veo is the specialist secondary');
assert.equal(capabilitiesFor('google-omni').conversationalEditing, true);
assert.equal(omniFlashCapabilities.audioInput, false, 'Omni audio input honestly false (documented)');
assert.equal(googleVideoCapabilities.maxDurationSec, 8, 'Veo hard 8s cap');
assert.equal(omniFlashCapabilities.maxDurationSec, null, 'Omni infers duration (no clamp)');

// ── §C: NO SILENT MUTATION — readiness blocks, never clamps ──────────────────
{
  const { state, sceneId } = baseState();
  const scene = state.scenes.find((s) => s.id === sceneId)!;
  const packet = compileScenePacket(state, scene, { attemptId: 'a', audioPath: '/tmp/song.m4a' });
  assert.equal(packet.references.length, 4, '4 references selected');

  // Veo: only 3 references + 8s cap. A 4-ref, 8s scene → too-many-references block.
  const veo = assessProviderReadiness(packet, googleVideoCapabilities, 'Veo');
  assert.ok(veo.blocking.some((b) => b.id === 'too-many-references'), 'excess refs BLOCK (never send first 3)');
  assert.equal(canSubmit(veo, []), false, 'cannot submit with unresolved blocks');
  assert.deepEqual(unresolvedOverrideKeys(veo, []), ['refs:choose']);
  assert.equal(canSubmit(veo, ['refs:choose']), true, 'explicit override unblocks');

  // A 12s scene on Veo → duration BLOCK (never clamp to 8).
  const longScene = makeScene('Long', 0, 12);
  longScene.castings.push({ entityId: state.entities[0].id, relationship: 'consistent', mustRemain: [], mayVary: [], referenceIds: [] });
  const longPacket = compileScenePacket(state, longScene, { attemptId: 'a2' });
  const veoLong = assessProviderReadiness(longPacket, googleVideoCapabilities, 'Veo');
  assert.ok(veoLong.blocking.some((b) => b.id === 'duration-exceeds-provider'), '12s scene BLOCKS on Veo (no silent clamp)');
  assert.equal(longPacket.timing.durationSec, 12, 'packet keeps the EXACT directed 12s');

  // Omni: 3-ref cap too, but no duration cap (maxDurationSec null).
  const omni = assessProviderReadiness(longPacket, omniFlashCapabilities, 'Omni');
  assert.ok(!omni.blocking.some((b) => b.id === 'duration-exceeds-provider'), 'Omni infers duration — no duration block');

  // Audio conditioning surfaced as a WARNING (song still master at assembly).
  // The audio-bearing packet (compiled with audioPath) carries the segment.
  const omniAudio = assessProviderReadiness(packet, omniFlashCapabilities, 'Omni');
  assert.ok(omniAudio.items.some((i) => i.id === 'audio-conditioning-unsupported' && i.severity === 'warning'), 'audio omission surfaced, not silent');
}

// ── §B: provider job lifecycle + persistence + resume ────────────────────────
{
  const { state, sceneId } = baseState();
  const scene = state.scenes.find((s) => s.id === sceneId)!;
  const packet = compileScenePacket(state, scene, { attemptId: 'take-1' });
  let s = addTakeFromPacket(state, scene, packet, 'google-omni', null, 'take-1').state;
  assert.equal(s.takes[0].requestSnapshot.durationSec, 8, 'exact requested duration snapshotted');

  // submit persists the job id immediately
  s = applyProviderSubmit(s, 'take-1', { providerId: 'google-omni', modelId: 'gemini-omni-flash-preview', jobId: 'v1_abc', phase: 'submitted' });
  assert.equal(s.takes[0].providerJob.jobId, 'v1_abc', 'operation id persisted on submit (P1 fix)');
  assert.equal(s.takes[0].providerJob.phase, 'submitted');

  // reopen: the pending job is resumable from persisted state
  const reopened = normalizeDirectorState(JSON.parse(JSON.stringify(s)));
  const resumable = resumableTakes(reopened);
  assert.equal(resumable.length, 1, 'pending job resumable after reopen');
  assert.equal(resumable[0].providerJob.jobId, 'v1_abc');

  // poll running → succeeded, then bind result
  s = applyProviderPoll(s, 'take-1', { phase: 'running' });
  assert.equal(s.takes[0].providerJob.phase, 'running');
  s = applyProviderPoll(s, 'take-1', { phase: 'succeeded', resultRef: 'files/xyz' });
  assert.equal(s.takes[0].providerJob.phase, 'succeeded');
  s = applyProviderResult(s, 'take-1', 'asset-vid-1', '/out/take-1.mp4');
  assert.equal(s.takes[0].assetId, 'asset-vid-1', 'result bound to exact take');
  assert.equal(s.takes[0].providerJob.localResultPath, '/out/take-1.mp4');
  assert.equal(s.scenes[0].status, 'review', 'scene moved to review on result');
  // duplicate-poll safety: re-applying the same result is a no-op
  const sDup = applyProviderResult(s, 'take-1', 'asset-vid-1', '/out/take-1.mp4');
  assert.equal(sDup, s, 'duplicate result binding is a no-op');

  // provider error persists
  const sErr = applyProviderPoll(applyProviderSubmit(state, sceneId, { providerId: 'mock', modelId: 'm', jobId: 'j', phase: 'submitted' }) === state ? s : s, 'take-1', { phase: 'failed', error: 'boom' });
  assert.equal(sErr.takes[0].providerJob.error, 'boom', 'error persisted');
}

// ── mock adapter drives immediate + pending + fail deterministically ─────────
{
  const immediate = createMockAdapter({ mode: 'immediate', pollsBeforeDone: 0, resultPath: '/out/x.mp4' });
  assert.equal((await immediate.submit({} as never)).phase, 'succeeded', 'mock immediate completion');

  const pending = createMockAdapter({ mode: 'pending-then-success', pollsBeforeDone: 3, resultPath: '/out/y.mp4' });
  assert.equal((await pending.submit({} as never)).phase, 'submitted');
  assert.equal((await pending.poll('j')).phase, 'running');
  assert.equal((await pending.poll('j')).phase, 'running');
  assert.equal((await pending.poll('j')).phase, 'succeeded', 'mock completes after N polls');

  const failing = createMockAdapter({ mode: 'pending-then-fail', pollsBeforeDone: 1, resultPath: '' });
  await failing.submit({} as never);
  assert.equal((await failing.poll('j')).phase, 'failed', 'mock failure path');
}

// ── §D: repair is executable — lineage + real repair request ─────────────────
{
  const { state, sceneId } = baseState();
  const scene = state.scenes.find((s) => s.id === sceneId)!;
  const packet = compileScenePacket(state, scene, { attemptId: 'parent' });
  let s = addTakeFromPacket(state, scene, packet, 'google-omni', null, 'parent').state;
  s = applyProviderResult(applyProviderSubmit(s, 'parent', { providerId: 'google-omni', modelId: 'm', jobId: 'v1_p', phase: 'submitted' }), 'parent', 'asset-parent', '/out/parent.mp4');
  s = acceptTake(s, 'parent');
  assert.equal(s.scenes[0].acceptedTakeId, 'parent');

  const { state: s2, take: child } = addRepairAttempt(s, 'parent', { kind: 'general', preserve: ['the performance', 'the camera'], change: ['the ending'], intervalSec: { start: 65, end: 68 }, note: 'fix the last beat' });
  assert.equal(child.parentTakeId, 'parent', 'child take keeps parent lineage');
  assert.equal(s2.takes.find((t) => t.id === 'parent')!.accepted, true, 'parent take preserved & still accepted');
  assert.equal(s2.scenes[0].status, 'needs-repair');

  const parentTake = { ...s2.takes.find((t) => t.id === 'parent')!, repair: child.repair, providerJob: { ...s2.takes.find((t) => t.id === 'parent')!.providerJob, jobId: 'v1_p' } };
  const repairPk = compileRepairPacket(s2, scene, parentTake, { attemptId: child.id, sourceVideoPath: '/out/parent.mp4', audioPath: '/tmp/song.m4a' });
  const rel = repairPk.files.map((f) => f.relPath);
  assert.ok(rel.includes('source.mp4'), 'repair packet includes the source video');
  assert.ok(rel.includes('repair-direction.md'));
  assert.ok(repairPk.prompt.includes('PRESERVE EXACTLY') && repairPk.prompt.includes('the performance'));
  assert.ok(repairPk.prompt.includes('CHANGE ONLY') && repairPk.prompt.includes('the ending'));
  assert.ok(rel.some((r) => r.startsWith('references/')), 'identity references travel with the repair');

  // accept the repaired child; sibling acceptance transfers, parent no longer accepted
  const s3 = applyProviderResult(s2, child.id, 'asset-child', '/out/child.mp4');
  const s4 = acceptTake(s3, child.id);
  assert.equal(s4.scenes[0].acceptedTakeId, child.id, 'repaired take becomes accepted only after approval');
  assert.equal(s4.takes.find((t) => t.id === 'parent')!.accepted, false, 'exactly one accepted take per scene');
  assert.equal(takesForScene(s4, sceneId).length, 2, 'both takes preserved in history');
}

// ── §E: lyric-scene overlap is DERIVED (no invisible wiring) ─────────────────
{
  const { state, sceneId } = baseState();
  const scene = state.scenes.find((s) => s.id === sceneId)!; // [60,68]
  const inside = makeLyricEvent('drive', 61, 62); inside.mouthVisibility = 'required'; inside.performerEntityId = state.entities[0].id;
  const outside = makeLyricEvent('later', 90, 91);
  const offcam = makeLyricEvent('ah', 63, 64); offcam.mouthVisibility = 'off-camera'; offcam.role = 'adlib';
  state.lyrics.push(inside, outside, offcam);
  const picked = sceneLyrics(state, scene).map((l) => l.word).sort();
  assert.deepEqual(picked, ['ah', 'drive'], 'overlapping lyrics auto-included; non-overlapping excluded');

  // exclude override removes one
  scene.lyricExclude = [offcam.id];
  assert.deepEqual(sceneLyrics(state, scene).map((l) => l.word), ['drive'], 'explicit exclude honored');
  scene.lyricExclude = [];

  // compiled packet carries the overlapping lyrics + timed file
  const packet = compileScenePacket(state, scene, { attemptId: 'a', audioPath: '/tmp/song.m4a' });
  assert.ok(packet.prompt.includes('drive') && packet.prompt.includes('VOCAL PERFORMANCE'));
  assert.ok(packet.files.some((f) => f.relPath === 'lyrics/timed-lyrics.json'));

  // required visible mouth in a wide shot conflicts; off-camera alone would not
  scene.cameraDistance = 'extreme-wide';
  // (preflight consumes the SAME sceneLyrics selection)
  const { preflightScene } = await import('./preflight');
  assert.ok(preflightScene(scene, state).some((c) => c.id === 'lipsync-vs-extreme-wide'), 'required visible lyric drives the conflict');
}

// ── §H1: fingerprint apply transaction ───────────────────────────────────────
{
  const { state, entityId } = baseState();
  const before = state.entities[0].activeFingerprint;
  // editing description via apply bumps version + fingerprint ONCE
  const s1 = applyEntityIdentity(state, entityId, { description: 'weathered, calm eyes' });
  assert.notEqual(s1.entities[0].activeFingerprint, before, 'canonical description change refreshes fingerprint');
  assert.equal(s1.entities[0].version, state.entities[0].version + 1);
  // a no-op apply does NOT bump the version (avoid per-keystroke churn)
  const s2 = applyEntityIdentity(s1, entityId, { description: 'weathered, calm eyes' });
  assert.equal(s2.entities[0].version, s1.entities[0].version, 'no-op apply does not bump version');
  // content digest is preferred over path
  const e = state.entities[0];
  const withDigest = { ...e, references: e.references.map((r) => ({ ...r, contentDigest: 'sha-' + r.id })) };
  assert.notEqual(computeIdentityFingerprint(withDigest), computeIdentityFingerprint(e), 'digest participates in fingerprint');
}

// ── §H3: accepted overlap blocking ───────────────────────────────────────────
{
  const state = emptyDirectorState();
  const a = makeScene('A', 0, 6); const b = makeScene('B', 4, 10);
  a.acceptedTakeId = 't-a'; b.acceptedTakeId = 't-b';
  state.scenes.push(a, b);
  assert.deepEqual(blockingOverlaps(state), [[a.id, b.id]], 'accepted overlapping scenes are flagged to block');
  b.acceptedTakeId = null;
  assert.deepEqual(blockingOverlaps(state), [], 'unaccepted overlap does not block');
}

// ── §H4: explicit retime cleanup ─────────────────────────────────────────────
{
  const { state } = baseState();
  const cleared = applyRetime(state, '/tmp/new.m4a', 'clear');
  assert.equal(cleared.scenes.length, 0, 'clear detaches scenes');
  assert.equal(cleared.takes.length, 0, 'clear leaves no dangling takes');
  assert.equal(cleared.songAudioPath, '/tmp/new.m4a', 'audio path updated (suspect gate clears)');
  const kept = applyRetime(state, '/tmp/new.m4a', 'keep');
  assert.equal(kept.scenes.length, state.scenes.length, 'keep retains direction');
  assert.equal(kept.songAudioPath, '/tmp/new.m4a');
}

// ── §H7: staleness responds to timing/policy/aspect, not just take set ───────
{
  const { state, sceneId } = baseState();
  const scene = state.scenes.find((s) => s.id === sceneId)!;
  let s = applyProviderResult(state, sceneId, 'asset-x', '/out/x.mp4'); // no take yet → no-op safe
  // set up an accepted take
  const packet = compileScenePacket(state, scene, { attemptId: 't' });
  s = addTakeFromPacket(state, scene, packet, 'google-omni', null, 't').state;
  s = applyProviderResult(applyProviderSubmit(s, 't', { providerId: 'google-omni', modelId: 'm', jobId: 'j', phase: 'submitted' }), 't', 'asset-x', '/out/x.mp4');
  s = acceptTake(s, 't');
  s = markWorkprintBuilt(s);
  assert.equal(s.workprint.stale, false, 'fresh after build');
  // change scene timing → stale
  s = { ...s, scenes: s.scenes.map((sc) => (sc.id === sceneId ? { ...sc, endSec: 70 } : sc)) };
  assert.equal(recomputeWorkprintStale(s).workprint.stale, true, 'scene timing change restales the workprint');
}

// ── Assembly short-clip policy (§H6) ─────────────────────────────────────────
{
  const state = emptyDirectorState();
  const scene = makeScene('S', 0, 8); scene.acceptedTakeId = 'tk';
  state.scenes.push(scene);
  state.takes.push({ ...addTakeFromPacket(state, scene, compileScenePacket(state, scene, { attemptId: 'tk' }), 'mock', null, 'tk').state.takes[0], accepted: true, assetId: 'vid' });
  // clip is only 4s but scene is 8s
  const durOf = () => 4;
  const pathOf = () => '/out/vid.mp4';
  const planUnset = planWorkprint(state, 8, pathOf, durOf);
  assert.equal(planUnset.mismatches.length, 1, 'short clip surfaced as mismatch');
  assert.equal(planUnset.finalReady, false, 'unset policy blocks FINAL');
  scene.shortClipPolicy = 'hold-last';
  const planHold = planWorkprint(state, 8, pathOf, durOf);
  assert.equal(planHold.finalReady, true, 'explicit policy unblocks FINAL');
  const argsHold = buildWorkprintArgs(planHold, { songAudioPath: '/tmp/s.m4a', width: 1080, height: 1920, fps: 30, outputPath: '/out/wp.mp4', mode: 'final' });
  assert.ok(argsHold.join(' ').includes('tpad=stop_mode=clone'), 'hold-last clones the final frame (no silent gap)');
  scene.shortClipPolicy = 'shorten-scene';
  const planShort = planWorkprint(state, 8, pathOf, durOf);
  assert.equal(planShort.scenes[0].endSec, 4, 'shorten-scene trims the assembled window to clip length');
}

// ── Persistence round-trip of new fields ─────────────────────────────────────
{
  const { state, sceneId } = baseState();
  const scene = state.scenes.find((s) => s.id === sceneId)!;
  scene.shortClipPolicy = 'loop'; scene.lyricExclude = ['x'];
  let s = addTakeFromPacket(state, scene, compileScenePacket(state, scene, { attemptId: 'tk' }), 'google-omni', null, 'tk').state;
  s = applyProviderSubmit(s, 'tk', { providerId: 'google-omni', modelId: 'gemini-omni-flash-preview', jobId: 'v1_z', phase: 'submitted' });
  s.takes[0].acceptedOverrides = ['refs:choose'];
  const rt = normalizeDirectorState(JSON.parse(JSON.stringify(s)));
  assert.equal(rt.scenes[0].shortClipPolicy, 'loop');
  assert.equal(rt.takes[0].providerJob.jobId, 'v1_z', 'provider job survives persistence');
  assert.equal(rt.takes[0].requestSnapshot.durationSec, 8);
  assert.deepEqual(rt.takes[0].acceptedOverrides, ['refs:choose'], 'accepted overrides persisted');
}

// ── §1: AI reference-variant lifecycle (mock image adapter) ──────────────────
{
  assert.equal(DEFAULT_IMAGE_PROVIDER_ID, 'gemini-image', 'default image provider');
  const caps = imageCapabilitiesFor('gemini-image');

  const { state, entityId } = baseState();
  const entity = state.entities.find((e) => e.id === entityId)!;
  // build a request and check readiness (too many conditioning refs blocks)
  const req = { ...makeReferenceRequest(entity, 'profile', 'gemini-image'), conditioningReferenceIds: entity.references.map((r) => r.id) };
  const readiness = assessImageReadiness(req, caps);
  assert.ok(readiness.blocking.some((b) => b.id === 'too-many-conditioning'), '4 conditioning refs > cap blocks (never silently dropped)');
  const okReq = { ...req, conditioningReferenceIds: entity.references.slice(0, 2).map((r) => r.id) };
  assert.equal(assessImageReadiness(okReq, caps).blocking.length, 0, 'within cap is ready');

  // make a take conditioned on the CURRENT identity, then generate + approve a
  // new reference and prove the prior take fingerprint is preserved.
  const scene = state.scenes.find((s) => s.id === state.scenes[0].id)!;
  const pk = compileScenePacket(state, scene, { attemptId: 'tk-pre' });
  let s = addTakeFromPacket(state, scene, pk, 'google-omni', null, 'tk-pre').state;
  const priorFp = s.takes[0].entityFingerprints[entityId];
  const priorEntityFp = s.entities.find((e) => e.id === entityId)!.activeFingerprint;

  // register + submit the request, drive the mock image adapter, add a proposal
  s = setReferenceRequest(s, okReq);
  const img = createMockImageAdapter({ mode: 'pending-then-success', pollsBeforeDone: 2, resultPaths: ['/out/ref_new.png'] });
  const sub = await img.submit({ prompt: 'p', referenceImagePaths: [], outputCount: 1, aspect: '9:16' });
  s = applyReferenceSubmit(s, okReq.id, { providerId: 'gemini-image', modelId: 'mock-img-1', jobId: sub.jobId, phase: 'submitted' });
  assert.equal(s.referenceRequests[0].jobId, sub.jobId, 'image job id persisted (resume-critical)');
  const reopened = normalizeDirectorState(JSON.parse(JSON.stringify(s)));
  assert.equal(resumableReferenceRequests(reopened).length, 1, 'pending image request resumable after reopen');
  assert.equal((await img.poll('j')).phase, 'running');
  const done = await img.poll('j');
  assert.equal(done.phase, 'succeeded', 'mock image completes after N polls');

  const added = addProposedVariant(s, okReq.id, '/out/ref_new.png', { origin: 'ai-generated' });
  s = added.state;
  const proposal = s.entities.find((e) => e.id === entityId)!.references.find((r) => r.id === added.refId)!;
  assert.equal(proposal.approved, false, 'generated result enters as an UNAPPROVED proposal');
  assert.equal(proposal.provenance.generationAttemptId, okReq.id, 'proposal retains generation provenance');
  assert.equal(s.entities.find((e) => e.id === entityId)!.activeFingerprint, priorEntityFp, 'unapproved proposal does NOT change identity');

  // approve through the canonical apply transaction → new version + fingerprint
  const beforeVersion = s.entities.find((e) => e.id === entityId)!.version;
  s = approveProposedVariant(s, entityId, added.refId);
  const afterEntity = s.entities.find((e) => e.id === entityId)!;
  assert.equal(afterEntity.version, beforeVersion + 1, 'approval bumps identity version once');
  assert.notEqual(afterEntity.activeFingerprint, priorEntityFp, 'approval changes the identity fingerprint');
  assert.equal(s.takes[0].entityFingerprints[entityId], priorFp, 'PRIOR TAKE fingerprint preserved across approval');

  // rejecting a proposal removes it without a version bump
  const added2 = addProposedVariant(s, okReq.id, '/out/ref_rej.png', { origin: 'imported-generation' });
  const vBefore = added2.state.entities.find((e) => e.id === entityId)!.version;
  const sRej = rejectProposedVariant(added2.state, entityId, added2.refId);
  assert.equal(sRej.entities.find((e) => e.id === entityId)!.references.some((r) => r.id === added2.refId), false, 'rejected proposal removed');
  assert.equal(sRej.entities.find((e) => e.id === entityId)!.version, vBefore, 'rejecting a proposal does not bump version');

  // manual reference package end-to-end
  const pkg = compileReferencePackage(s, okReq);
  const rel = pkg.files.map((f) => f.relPath);
  assert.ok(rel.includes('prompt.md') && rel.includes('request.json') && rel.some((r) => r.startsWith('conditioning/')), 'manual reference package has prompt + request + conditioning images');

  // persistence round-trip of the request
  const rt = normalizeDirectorState(JSON.parse(JSON.stringify(s)));
  assert.equal(rt.referenceRequests.length, 1, 'reference request persists');
}

// ── §2: rich directing primitives feed compilation + preflight ───────────────
{
  const { state, entityId } = baseState();
  const scene = state.scenes.find((s) => s.id === state.scenes[0].id)!; // [60,68]
  const lyric = makeLyricEvent('rise', 61, 62); lyric.performerEntityId = entityId; state.lyrics.push(lyric);
  const tool: DirectorTool = {
    id: 'tool-rich', name: 'Rich', description: '', version: 1, appliesTo: ['scene'],
    fields: [
      { id: 'cam', kind: 'camera-path', label: 'Camera' },
      { id: 'board', kind: 'image-board', label: 'Board' },
      { id: 'lyr', kind: 'lyric-blocks', label: 'Lyrics' },
    ],
    outputSchema: { camera: 'cam', board: 'board' },
    conflictRules: [], compileHints: 'rich', usageCount: 0, importedFrom: null, createdAt: 't',
  };
  state.tools.push(tool);
  const face = state.entities[0].references[0];
  scene.toolOutputs.push({
    toolId: 'tool-rich', toolVersion: 1, updatedAt: 't',
    values: {
      cam: { start: { x: 0.1, y: 0.5 }, end: { x: 0.9, y: 0.5 }, control: [{ x: 0.5, y: 0.2 }], movement: 'dolly', orientation: 'toward subject' },
      board: { items: [{ id: 'i1', referenceId: face.id, label: 'hero' }, { id: 'i2', referenceId: face.id, label: 'detail' }] },
      lyr: { selectedLyricIds: [lyric.id], overrides: { [lyric.id]: { mouthVisibility: 'required', emphasis: 0.9 } } },
    },
  });
  // camera-path compiles into machine-facing camera direction
  assert.ok(compileCameraPath({ start: { x: 0.1, y: 0.5 }, end: { x: 0.9, y: 0.5 }, control: [], movement: 'orbit', orientation: '' }).includes('orbit'), 'camera-path compiles a movement');
  const pk = compileScenePacket(state, scene, { attemptId: 'rp' });
  assert.ok(pk.prompt.includes('dolly camera move'), 'camera-path appears in the compiled prompt');
  assert.ok(pk.prompt.includes('image board') && pk.prompt.includes('hero'), 'image-board ordering appears in the compiled prompt');
  // lyric-blocks feed the SAME canonical selection: emphasis override applied
  const picked = sceneLyrics(state, scene).find((l) => l.id === lyric.id)!;
  assert.equal(picked.emphasis, 0.9, 'lyric-block emphasis override feeds sceneLyrics');
  assert.equal(picked.mouthVisibility, 'required', 'lyric-block mouth override feeds sceneLyrics');
  // normalization round-trips the structured shapes
  const rt = normalizeDirectorState(JSON.parse(JSON.stringify(state)));
  const rtOut = rt.scenes[0].toolOutputs[0].values;
  assert.equal((rtOut.board as { items: unknown[] }).items.length, 2, 'image-board items round-trip in order');
  assert.equal((rtOut.cam as { movement: string }).movement, 'dolly', 'camera-path round-trips');
}

// ── §3: each conditioning recipe materializes a distinct artifact ────────────
{
  const { state } = baseState();
  const scene = state.scenes.find((s) => s.id === state.scenes[0].id)!;
  const lyric = makeLyricEvent('go', 61, 62); state.lyrics.push(lyric);
  // a pose-sequence tool output so pose-sheet + motion-guide have data
  const tool: DirectorTool = { id: 'pt', name: 'Pose', description: '', version: 1, appliesTo: ['scene'], fields: [{ id: 'p', kind: 'pose-sequence', label: 'Pose' }], outputSchema: { pose: 'p' }, conflictRules: [], compileHints: '', usageCount: 0, importedFrom: null, createdAt: 't' };
  state.tools.push(tool);
  const { defaultPose } = await import('./model');
  scene.toolOutputs.push({ toolId: 'pt', toolVersion: 1, updatedAt: 't', values: { p: { poses: [{ atBeat: 0, holdBeats: 1, transition: 'smooth', joints: defaultPose() }] } } });

  const rel = (recipe: Parameters<typeof compileScenePacket>[2]['recipe']) => compileScenePacket(state, scene, { attemptId: 'a', recipe, audioPath: '/tmp/song.m4a' }).files.map((f) => f.relPath);
  assert.ok(rel('contact-sheet').includes('conditioning/contact-sheet.svg'), 'contact-sheet emits a real .svg');
  assert.ok(rel('storyboard').includes('conditioning/storyboard.svg'), 'storyboard emits a real .svg');
  assert.ok(rel('pose-sequence').includes('conditioning/pose-sheet.svg'), 'pose-sequence emits a pose sheet');
  assert.ok(rel('audio-timed-lyrics').includes('conditioning/performance-score.svg'), 'audio-timed-lyrics emits a performance score');
  assert.ok(rel('motion-guide').includes('conditioning/motion-guide.svg'), 'motion-guide emits a guide artifact');
  assert.ok(rel('first-last-frame').includes('conditioning/first-last-frame.json'), 'first-last-frame emits its distinct frame manifest');
  // recipes produce materially DIFFERENT file sets
  assert.notDeepEqual(rel('contact-sheet'), rel('storyboard'), 'different recipes → different packet files');
  // the contact sheet svg actually contains labeled panels
  const cs = compileScenePacket(state, scene, { attemptId: 'a', recipe: 'contact-sheet' }).files.find((f) => f.relPath.endsWith('contact-sheet.svg'))!;
  assert.ok(cs.kind === 'text' && cs.content.includes('<svg') && cs.content.includes('panel 1'), 'contact sheet is a labeled svg');
}

// ── first/last-frame references are resolved DISTINCTLY (not by accident) ─────
{
  const { state } = baseState();
  const entity = state.entities[0];
  const ff = makeReference(entity.id, 'first-frame', '/tmp/ff.png', 'first', 'upload'); ff.approved = true;
  const lf = makeReference(entity.id, 'final-frame', '/tmp/lf.png', 'final', 'upload'); lf.approved = true;
  entity.references.push(ff, lf);
  const scene = state.scenes[0];
  scene.castings[0].referenceIds = [...scene.castings[0].referenceIds, ff.id, lf.id];
  const pk = compileScenePacket(state, scene, { attemptId: 'a', recipe: 'first-last-frame' });
  assert.ok(String(pk.manifest.firstFrame).includes('first_frame') || String(pk.manifest.firstFrame).includes('first-frame'), 'manifest records a distinct first frame');
  assert.ok(pk.manifest.finalFrame, 'manifest records a distinct final frame');
}

// ── §4: automatic polling decision core ──────────────────────────────────────
{
  assert.equal(nextPollDecision('succeeded', 1, 0).action, 'done', 'succeeded → done');
  assert.equal(nextPollDecision('failed', 1, 0).action, 'stop', 'failed → stop');
  assert.equal(nextPollDecision('cancelled', 1, 0).action, 'stop', 'cancelled → stop');
  const d1 = nextPollDecision('running', 1, 0);
  assert.equal(d1.action, 'poll', 'running → poll');
  const d2 = nextPollDecision('running', 5, 0);
  assert.ok(d2.delayMs >= d1.delayMs, 'backoff grows with attempts');
  assert.ok(d2.delayMs <= 30000, 'backoff capped');
  assert.equal(nextPollDecision('running', 1, POLL_MAX_ERRORS).action, 'stop', 'too many errors → stop (pause)');
  assert.equal(nextPollDecision('running', POLL_MAX_ATTEMPTS, 0).action, 'stop', 'poll budget exhausted → stop');
}

// ── §5: retime 'retime' mode keeps scenes, drops takes + pending jobs ────────
{
  const { state, sceneId } = baseState();
  const scene = state.scenes.find((s) => s.id === sceneId)!;
  let s = addTakeFromPacket(state, scene, compileScenePacket(state, scene, { attemptId: 't' }), 'google-omni', null, 't').state;
  s = applyProviderSubmit(s, 't', { providerId: 'google-omni', modelId: 'm', jobId: 'v1_a', phase: 'submitted' });
  const retimed = applyRetime(s, '/tmp/new.m4a', 'retime');
  assert.equal(retimed.scenes.length, s.scenes.length, 'retime KEEPS scenes for re-timing');
  assert.equal(retimed.lyrics.length, s.lyrics.length, 'retime keeps lyrics');
  assert.equal(retimed.takes.length, 0, 'retime drops all takes (no orphaned pending jobs)');
  assert.equal(resumableTakes(retimed).length, 0, 'no resumable jobs after retime');
  assert.equal(retimed.scenes[0].acceptedTakeId, null, 'accepted links cleared');
  assert.equal(retimed.songAudioPath, '/tmp/new.m4a', 'audio path updated (suspect gate clears)');
  assert.equal(retimed.entities.length, s.entities.length, 'reusable entities preserved');
}

// ── §6: lip-sync repair lifecycle ────────────────────────────────────────────
{
  const { state, sceneId } = baseState();
  const scene = state.scenes.find((s) => s.id === sceneId)!;
  const lyric = makeLyricEvent('sing', 61, 63); lyric.mouthVisibility = 'required'; lyric.performerEntityId = state.entities[0].id;
  state.lyrics.push(lyric);
  let s = addTakeFromPacket(state, scene, compileScenePacket(state, scene, { attemptId: 'p' }), 'google-omni', null, 'p').state;
  s = applyProviderResult(applyProviderSubmit(s, 'p', { providerId: 'google-omni', modelId: 'm', jobId: 'v1_p', phase: 'submitted' }), 'p', 'asset-p', '/out/p.mp4');
  s = acceptTake(s, 'p');

  const { state: s2, take: child } = addLipSyncRepair(s, 'p', { intervalSec: { start: 61, end: 63 }, performerEntityId: state.entities[0].id, note: 'tighten sync' });
  assert.equal(child.parentTakeId, 'p', 'lip-sync child keeps parent lineage');
  assert.equal(child.repair!.kind, 'lip-sync');
  assert.equal(child.lipSync, 'pending', 'child lip-sync pending');
  assert.equal(s2.takes.find((t) => t.id === 'p')!.lipSync, 'needs-repair', 'parent flagged needs-repair');
  assert.equal(s2.takes.find((t) => t.id === 'p')!.accepted, true, 'parent take preserved & still accepted');

  const lipPk = compileLipSyncRepairPacket(s2, scene, s2.takes.find((t) => t.id === 'p')!, { sourceVideoPath: '/out/p.mp4', audioPath: '/tmp/song.m4a', intervalSec: child.repair!.intervalSec });
  const rel = lipPk.map((f) => f.relPath);
  assert.ok(rel.includes('source.mp4'), 'lip-sync package includes the source video');
  assert.ok(rel.includes('lyrics/timed-lyrics.json'), 'lip-sync package includes scene-local timed lyrics');
  assert.ok(rel.some((r) => r === 'audio/scene-audio.wav'), 'lip-sync package includes the audio segment');

  // import + accept the child WITHOUT deleting the original take
  const s3 = applyProviderResult(s2, child.id, 'asset-child', '/out/child.mp4');
  const s4 = acceptTake(s3, child.id);
  assert.equal(s4.scenes[0].acceptedTakeId, child.id, 'repaired child accepted');
  assert.ok(s4.takes.some((t) => t.id === 'p'), 'original take still present (not deleted)');
  assert.equal(s4.takes.find((t) => t.id === 'p')!.accepted, false, 'exactly one accepted take per scene');
}

// ── §7: actionable preflight resolutions change canonical state ──────────────
{
  const { state, sceneId } = baseState();
  let s = state;
  const scene = () => s.scenes.find((x) => x.id === sceneId)!;

  // relationship change: exact → consistent
  s = applySceneResolution(s, sceneId, `relationship:${state.entities[0].id}:consistent`);
  assert.equal(scene().castings[0].relationship, 'consistent', 'relationship resolution changed the casting');

  // camera distance
  s = applySceneResolution(s, sceneId, 'camera-distance:close');
  assert.equal(scene().cameraDistance, 'close', 'camera-distance resolution applied');

  // trim references to the provider cap and re-check readiness clears
  const pkBefore = compileScenePacket(s, scene(), { attemptId: 'a' });
  assert.ok(pkBefore.references.length > 3, 'starts with >3 refs');
  s = applySceneResolution(s, sceneId, 'trim-refs:3');
  const pkAfter = compileScenePacket(s, scene(), { attemptId: 'a' });
  assert.ok(pkAfter.references.length <= 3, 'trim-refs reduced the reference count');
  assert.equal(assessProviderReadiness(pkAfter, googleVideoCapabilities, 'Veo').blocking.some((b) => b.id === 'too-many-references'), false, 'trim resolves the readiness block');

  // vocals off-camera resolution flips required overlapping lyrics
  const withLyric = { ...s };
  const l = makeLyricEvent('hey', 61, 62); l.mouthVisibility = 'required'; withLyric.lyrics = [l];
  const s2 = applySceneResolution(withLyric, sceneId, 'vocals-offcamera');
  assert.equal(s2.lyrics[0].mouthVisibility, 'off-camera', 'vocals-offcamera flips the required lyric');
}

// ── §7: scene splitting ──────────────────────────────────────────────────────
{
  const { state, sceneId } = baseState();
  const scene = state.scenes.find((s) => s.id === sceneId)!; // [60,68]
  const early = makeLyricEvent('a', 61, 62); const late = makeLyricEvent('b', 66, 67);
  state.lyrics.push(early, late);
  scene.lyricEventIds = [early.id, late.id];
  // give it an accepted take to prove it is NOT duplicated
  let s = addTakeFromPacket(state, scene, compileScenePacket(state, scene, { attemptId: 'tk' }), 'google-omni', null, 'tk').state;
  s = applyProviderResult(applyProviderSubmit(s, 'tk', { providerId: 'google-omni', modelId: 'm', jobId: 'j', phase: 'submitted' }), 'tk', 'asset', '/out.mp4');
  s = acceptTake(s, 'tk');
  const beforeTakes = s.takes.length;

  const { state: s2, parts } = splitScene(s, sceneId, 64);
  assert.ok(parts, 'split produced two parts');
  assert.equal(s2.scenes.length, 2, 'one scene became two');
  const [a, b] = parts!;
  assert.equal(a.endSec, 64); assert.equal(b.startSec, 64, 'split boundary honored');
  assert.ok(a.startSec === 60 && b.endSec === 68, 'song-relative bounds preserved');
  assert.deepEqual(a.lyricEventIds, [early.id], 'early lyric assigned to part 1');
  assert.deepEqual(b.lyricEventIds, [late.id], 'late lyric assigned to part 2');
  assert.equal(a.acceptedTakeId, null, 'split parts do not carry the accepted take');
  assert.ok(a.continuityNotes.includes('split'), 'lineage recorded');
  assert.ok(s2.takes.length < beforeTakes || s2.takes.every((t) => t.sceneId !== sceneId), 'old scene takes not duplicated onto the parts');
}

console.log('[director-generation] PASS — provider readiness (no silent mutation), job lifecycle + resume, mock adapter, repair execution + lineage, lyric overlap, fingerprint apply, overlap block, retime, staleness, short-clip policy, persistence, AI reference-variant lifecycle, rich primitives (camera-path/image-board/lyric-blocks), materialized conditioning artifacts, first/last frame, polling core, retime-mode cleanup, lip-sync lifecycle, actionable preflight resolutions, and scene splitting verified.');
