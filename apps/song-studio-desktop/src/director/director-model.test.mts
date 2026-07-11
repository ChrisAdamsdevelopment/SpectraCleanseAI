import assert from 'node:assert/strict';
import {
  emptyDirectorState, makeEntity, makeReference, makeScene, makeTake, makeLyricEvent,
  computeIdentityFingerprint, refreshEntityIdentity, orderedScenes, sceneOverlaps,
  acceptedTakeForScene, directorTimingSuspect, defaultPose,
} from './model';
import { normalizeDirectorState } from './normalize';
import { normalizeReleaseProject } from '../project/storage';
import { emptyReleaseProject } from '../project/types';

// ── 1. Existing projects migrate safely ─────────────────────────────────────
const legacy = normalizeReleaseProject({ outputs: [{ functionId: 'make_hook_promo', recipeId: 'vertical_promo' }] });
assert.equal(legacy.director, undefined, 'pre-Director project has NO director block (behaves as before)');
assert.equal(legacy.schemaVersion, 5);
const v4style = normalizeReleaseProject({ ...emptyReleaseProject(), schemaVersion: 4, director: undefined });
assert.equal(v4style.director, undefined, 'v4 project without director stays untouched');

// ── 2. Fingerprints are deterministic; approval changes them ────────────────
const artist = makeEntity('Sobelo', 'person', 'lead artist');
const fp0 = computeIdentityFingerprint(artist);
assert.equal(computeIdentityFingerprint(artist), fp0, 'same package → same fingerprint');
const face = makeReference(artist.id, 'face', '/tmp/face.png', 'face front', 'upload');
artist.references.push(face);
const fpWithFace = computeIdentityFingerprint(artist);
assert.notEqual(fpWithFace, fp0, 'approved upload reference changes the fingerprint');
// digests, when supplied, participate deterministically
const fpDigest = computeIdentityFingerprint(artist, { '/tmp/face.png': 'abc123' });
assert.notEqual(fpDigest, fpWithFace);
assert.equal(computeIdentityFingerprint(artist, { '/tmp/face.png': 'abc123' }), fpDigest);

// ── 3. Generated variants are proposals until approved ──────────────────────
const proposal = makeReference(artist.id, 'full-body', '/tmp/gen.png', 'gen full body', 'ai-generated', { generationAttemptId: 'att-1' });
assert.equal(proposal.approved, false, 'AI-generated variant is NOT canonical until approved');
artist.references.push(proposal);
assert.equal(computeIdentityFingerprint(artist), fpWithFace, 'unapproved proposal does not alter identity');
proposal.approved = true;
const bumped = refreshEntityIdentity(artist);
assert.equal(bumped.version, artist.version + 1, 'approval bumps identity version');
assert.notEqual(bumped.activeFingerprint, fpWithFace, 'approval changes fingerprint');

// ── 4. Exact/consistent/related/invented round-trip ─────────────────────────
const state = emptyDirectorState();
state.songAudioPath = '/tmp/song.m4a';
state.entities.push(bumped);
const scene = makeScene('Chorus arrival', 60, 68);
scene.castings.push({ entityId: bumped.id, relationship: 'exact', mustRemain: ['left-forearm tattoo'], mayVary: ['background crowd'], referenceIds: [face.id] });
scene.camera = 'slow push-in'; scene.cameraDistance = 'medium'; scene.lightingStyle = 'stylized';
state.scenes.push(scene);
const roundTrip = normalizeDirectorState(JSON.parse(JSON.stringify(state)));
assert.equal(roundTrip.scenes[0].castings[0].relationship, 'exact');
assert.deepEqual(roundTrip.scenes[0].castings[0].mustRemain, ['left-forearm tattoo']);
assert.deepEqual(roundTrip.scenes[0].castings[0].mayVary, ['background crowd']);

// ── 5+6. Scene timing survives persistence; ordering + overlap detection ────
assert.equal(roundTrip.scenes[0].startSec, 60);
assert.equal(roundTrip.scenes[0].endSec, 68);
const s2 = makeScene('Verse', 10, 20); const s3 = makeScene('Overlap', 18, 24);
const ordered = orderedScenes([scene, s3, s2]);
assert.deepEqual(ordered.map((s) => s.title), ['Verse', 'Overlap', 'Chorus arrival']);
assert.deepEqual(sceneOverlaps([scene, s3, s2]), [[s2.id, s3.id]], 'overlap detected between Verse and Overlap');

// ── 14. Accepted/rejected takes persist; dangling acceptance cleared ────────
const take = makeTake(scene, { promptDigest: 'd', recipe: 'separate-references', referenceFiles: ['character_sobelo_face_front.png'], sceneStartSec: 60, sceneEndSec: 68, aspect: '9:16', resolution: '720p' }, 'manual', { [bumped.id]: bumped.activeFingerprint });
take.accepted = true; take.status = 'imported'; take.assetId = 'asset-1';
scene.acceptedTakeId = take.id;
state.takes.push(take);
const rt2 = normalizeDirectorState(JSON.parse(JSON.stringify(state)));
assert.equal(rt2.takes[0].accepted, true);
assert.equal(rt2.takes[0].entityFingerprints[bumped.id], bumped.activeFingerprint, 'take keeps the fingerprint it was generated with');
assert.equal(acceptedTakeForScene(rt2, scene.id)?.id, take.id);
const rejected = makeTake(scene, take.requestSnapshot, 'manual', {});
rejected.accepted = false;
state.takes.push(rejected);
const rt3 = normalizeDirectorState(JSON.parse(JSON.stringify(state)));
assert.equal(rt3.takes.find((t) => t.id === rejected.id)?.accepted, false, 'rejected take persists as rejected');
// dangling acceptedTakeId → cleared
const broken = JSON.parse(JSON.stringify(state));
broken.scenes[0].acceptedTakeId = 'no-such-take';
assert.equal(normalizeDirectorState(broken).scenes[0].acceptedTakeId, null, 'dangling accepted take cleared');

// ── 16. Lyric timing/emphasis round-trip ─────────────────────────────────────
const word = makeLyricEvent('night', 61.2, 61.8);
word.emphasis = 0.9; word.mouthVisibility = 'required'; word.role = 'lead'; word.performerEntityId = bumped.id;
state.lyrics.push(word);
scene.lyricEventIds.push(word.id);
const rt4 = normalizeDirectorState(JSON.parse(JSON.stringify(state)));
assert.equal(rt4.lyrics[0].startSec, 61.2);
assert.equal(rt4.lyrics[0].emphasis, 0.9);
assert.equal(rt4.lyrics[0].mouthVisibility, 'required');
assert.deepEqual(rt4.scenes[0].lyricEventIds, [word.id]);
// dangling lyric ref dropped
const brokenLyric = JSON.parse(JSON.stringify(state));
brokenLyric.scenes[0].lyricEventIds = ['missing'];
assert.deepEqual(normalizeDirectorState(brokenLyric).scenes[0].lyricEventIds, []);

// ── 15-analog (model level): replacing an accepted scene take → stale print ──
state.workprint = { lastBuiltAt: new Date().toISOString(), builtFromTakeIds: [take.id], stale: false };
const rt5 = normalizeDirectorState(JSON.parse(JSON.stringify(state)));
assert.equal(rt5.workprint.stale, false);
assert.deepEqual(rt5.workprint.builtFromTakeIds, [take.id]);

// ── Retime gate: audio replacement makes timings suspect, never silently ok ─
assert.equal(directorTimingSuspect('/tmp/song.m4a', state), false);
assert.equal(directorTimingSuspect('/tmp/NEW-song.m4a', state), true, 'audio change → timings suspect');
assert.equal(directorTimingSuspect('/tmp/other.m4a', emptyDirectorState()), false, 'empty state never suspect');

// ── 20-analog: full ReleaseProject round-trip restores Director state ────────
const project = { ...emptyReleaseProject(), audioPath: '/tmp/song.m4a', director: state };
const reloaded = normalizeReleaseProject(JSON.parse(JSON.stringify(project)));
assert.ok(reloaded.director, 'director block restored');
assert.equal(reloaded.director!.entities.length, 1);
assert.equal(reloaded.director!.scenes.length, 1);
assert.equal(reloaded.director!.takes.length, 2);
assert.equal(reloaded.director!.lyrics.length, 1);
assert.equal(reloaded.director!.songAudioPath, '/tmp/song.m4a');
assert.equal(reloaded.director!.entities[0].activeFingerprint, bumped.activeFingerprint, 'fingerprint recomputed identically from persisted package');

// pose default sanity (used by the pose editor + normalize)
const pose = defaultPose();
assert.ok(pose.head.y < pose.hip.y && pose.hip.y < pose.footL.y);

console.log('[director-model] PASS — migration safety, fingerprints, proposal/approval, relationships, timing, overlaps, takes, lyrics, retime gate, and full round-trip verified.');
