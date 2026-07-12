import assert from 'node:assert/strict';
import {
  emptyDirectorState, makeEntity, makeReference, makeScene, makeLyricEvent, sceneLyrics,
  computeIdentityFingerprint, type DirectorState,
} from './model';
import { normalizeDirectorState } from './normalize';
import { compileScenePacket, compileRepairPacket } from './compile';
import { assessProviderReadiness, canSubmit, unresolvedOverrideKeys } from './providerReadiness';
import { googleVideoCapabilities } from './providers/googleVideo';
import { omniFlashCapabilities } from './providers/omniFlash';
import { capabilitiesFor, DEFAULT_PROVIDER_ID, providerDescriptor } from './providers/registry';
import { createMockAdapter } from './providers/mock';
import {
  addTakeFromPacket, applyProviderSubmit, applyProviderPoll, applyProviderResult, resumableTakes,
  addRepairAttempt, acceptTake, applyEntityIdentity, blockingOverlaps,
  applyRetime, recomputeWorkprintStale, markWorkprintBuilt, takesForScene,
} from './actions';
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

  const { state: s2, take: child } = addRepairAttempt(s, 'parent', { preserve: ['the performance', 'the camera'], change: ['the ending'], intervalSec: { start: 65, end: 68 }, note: 'fix the last beat' });
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

console.log('[director-generation] PASS — provider readiness (no silent mutation), job lifecycle + resume, mock adapter, repair execution + lineage, lyric overlap, fingerprint apply, overlap block, retime, staleness, short-clip policy, and persistence verified.');
