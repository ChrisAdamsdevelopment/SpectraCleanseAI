import assert from 'node:assert/strict';
import {
  emptyDirectorState, makeEntity, makeReference, makeScene, makeLyricEvent, makeTake,
} from './model';
import { preflightScene } from './preflight';
import { validateToolDefinition, parseToolFromModelText, exportToolPackage, importToolPackage, toolGenerationPrompt } from './toolSchema';
import { compileScenePacket, checkProviderFit, slug } from './compile';
import { googleVideoCapabilities } from './providers/googleVideo';
import { writePacket, resolveReturnAttemptId } from './packetIo';
import { planWorkprint, buildWorkprintArgs } from './assembly';
import { bindResultToTake, acceptTake } from './actions';

// ── Conflict preflight (deterministic, no AI) ───────────────────────────────
{
  const state = emptyDirectorState();
  const artist = makeEntity('Sobelo', 'person', 'lead');
  const ring = makeEntity('Silver ring', 'jewelry', 'v2 silver ring');
  state.entities.push(artist, ring);
  const scene = makeScene('Wide chorus', 60, 68);
  scene.cameraDistance = 'extreme-wide';
  scene.castings.push({ entityId: ring.id, relationship: 'exact', mustRemain: ['engraving'], mayVary: [], referenceIds: [] });
  const word = makeLyricEvent('night', 61, 62); word.mouthVisibility = 'required';
  state.lyrics.push(word); scene.lyricEventIds.push(word.id);
  state.scenes.push(scene);
  const conflicts = preflightScene(scene, state);
  const ids = conflicts.map((c) => c.id);
  assert.ok(ids.includes('exact-detail-vs-wide'), 'exact ring vs extreme-wide detected');
  assert.ok(ids.includes('lipsync-vs-extreme-wide'), 'lip sync vs extreme-wide detected');
  assert.ok(ids.includes('exact-without-references-' + ring.id), 'exact element without references detected');
  // every conflict offers real choices and never auto-removes a requirement
  for (const c of conflicts) assert.ok(c.choices.length >= 2 && c.choices.some((x) => /continue|split|move|widen|turn|select|change|use|mark|calm|loosen|keep/i.test(x)));
}
{
  const state = emptyDirectorState();
  const artist = makeEntity('Sobelo', 'person'); state.entities.push(artist);
  const scene = makeScene('Back-facing sung line', 10, 18);
  scene.camera = 'shot from behind the artist walking away';
  const w = makeLyricEvent('run', 11, 12); w.mouthVisibility = 'required';
  state.lyrics.push(w); scene.lyricEventIds.push(w.id); state.scenes.push(scene);
  const conflicts = preflightScene(scene, state);
  const back = conflicts.find((c) => c.id === 'lipsync-vs-back-facing');
  assert.ok(back && back.severity === 'blocking', 'back-facing + required lip sync is blocking');
}
{
  // clean scene → no conflicts
  const state = emptyDirectorState();
  const e = makeEntity('City', 'location'); state.entities.push(e);
  const scene = makeScene('Establishing', 0, 6);
  scene.cameraDistance = 'wide';
  scene.castings.push({ entityId: e.id, relationship: 'related', mustRemain: [], mayVary: ['layout'], referenceIds: [] });
  assert.deepEqual(preflightScene(scene, state), [], 'a clean scene has no conflicts');
}

// ── Safe declarative tool system ────────────────────────────────────────────
{
  const good = validateToolDefinition({
    name: 'Shoulder-Elbow-Hand tracker', description: 'Track arm positions over beats',
    appliesTo: ['scene', 'person'],
    fields: [
      { id: 'poses', kind: 'pose-sequence', label: 'Arm poses', beats: 8, maxItems: 4 },
      { id: 'intensity', kind: 'scale', label: 'Energy', labels: ['calm', 'medium', 'explosive'] },
    ],
    outputSchema: { armPoses: 'poses', energy: 'intensity' },
    conflictRules: ['needs a medium or closer shot'],
    compileHints: 'Describe the arm positions at each beat.',
  });
  assert.ok(good.ok && good.tool, 'valid tool accepted');
  assert.equal(good.tool!.fields.length, 2);

  // unsafe: unknown primitive rejected, not coerced
  const unsafe = validateToolDefinition({
    name: 'x', description: 'y', appliesTo: ['scene'],
    fields: [{ id: 'a', kind: 'iframe', label: 'bad' }],
    outputSchema: { a: 'a' },
  });
  assert.ok(!unsafe.ok, 'unknown primitive kind rejected');

  // unsafe: code/handler keys rejected anywhere in the object
  const codey = validateToolDefinition({
    name: 'x', description: 'y', appliesTo: ['scene'],
    fields: [{ id: 'a', kind: 'text', label: 'ok', onClick: 'alert(1)' }],
    outputSchema: { a: 'a' },
  });
  assert.ok(!codey.ok, 'forbidden handler key rejected');
  assert.ok(codey.errors.some((e) => /forbidden key/.test(e)));

  // outputSchema must reference real fields
  const badOut = validateToolDefinition({
    name: 'x', description: 'y', appliesTo: ['scene'],
    fields: [{ id: 'a', kind: 'text', label: 'ok' }],
    outputSchema: { out: 'nonexistent' },
  });
  assert.ok(!badOut.ok, 'outputSchema referencing a missing field rejected');

  // parse from noisy model text
  const parsed = parseToolFromModelText('Sure! Here is the tool:\n{"name":"T","description":"d","appliesTo":["scene"],"fields":[{"id":"n","kind":"range","label":"N","min":0,"max":10}],"outputSchema":{"n":"n"}}\nHope that helps!');
  assert.ok(parsed.ok, 'tool JSON extracted from surrounding prose');

  // package round-trip
  const pkg = exportToolPackage(good.tool!);
  assert.equal(pkg.format, 'songstudio-directing-tool');
  const imported = importToolPackage(JSON.parse(JSON.stringify(pkg)), 'shared/pack');
  assert.ok(imported.ok && imported.tool!.importedFrom === 'shared/pack', 'tool package re-imports and records source');

  assert.ok(toolGenerationPrompt('track arm positions').includes('pose-sequence'), 'generation prompt lists allowlisted kinds');
}

// ── Conditioning compiler ────────────────────────────────────────────────────
{
  const state = emptyDirectorState();
  state.songAudioPath = '/tmp/song.m4a';
  const artist = makeEntity('Sobelo', 'person', 'lean, weathered');
  artist.lockedTraits = ['left-forearm script tattoo'];
  const face = makeReference(artist.id, 'face', '/tmp/face.png', 'face', 'upload'); face.approved = true;
  const tat = makeReference(artist.id, 'tattoo-close', '/tmp/tat.png', 'forearm', 'upload'); tat.approved = true; tat.bodyLocation = 'left forearm';
  const unapproved = makeReference(artist.id, 'full-body', '/tmp/body.png', 'body', 'ai-generated'); // NOT approved
  artist.references.push(face, tat, unapproved);
  state.entities.push(artist);

  const scene = makeScene('Chorus', 60, 68);
  scene.styleGenre = 'neon noir'; scene.camera = 'slow push-in'; scene.cameraDistance = 'medium';
  scene.castings.push({ entityId: artist.id, relationship: 'exact', mustRemain: ['tattoo readable'], mayVary: ['crowd'], referenceIds: [face.id, tat.id, unapproved.id] });
  const word = makeLyricEvent('drive', 61, 62); word.performerEntityId = artist.id; word.mouthVisibility = 'required';
  state.lyrics.push(word); scene.lyricEventIds.push(word.id);
  state.scenes.push(scene);

  const packet = compileScenePacket(state, scene, { attemptId: 'att-1', audioPath: '/tmp/song.m4a' });

  // only APPROVED references enter the packet (2 of 3)
  assert.equal(packet.references.length, 2, 'unapproved reference excluded from packet');
  const names = packet.references.map((r) => r.fileName).sort();
  assert.ok(names.includes('character_sobelo_face.png'), 'deterministic face file name');
  assert.ok(names.some((n) => /character_sobelo_left_forearm_tattoo_close\.png/.test(n)), 'body-located tattoo file name');
  // prompt carries direction + preserve rules + timed lyrics
  assert.ok(/EXACT/.test(packet.prompt) && /neon noir/.test(packet.prompt));
  assert.ok(packet.preserveRules.some((p) => /left-forearm script tattoo/.test(p)), 'locked trait preserved');
  assert.ok(/VOCAL PERFORMANCE/.test(packet.prompt) && /drive/.test(packet.prompt));
  // manual package file list is complete + deterministic
  const rel = packet.files.map((f) => f.relPath);
  for (const req of ['README.md', 'manifest.json', 'scene-spec.json', 'prompt.md', 'negative-constraints.md', 'return-contract.json', 'lyrics/timed-lyrics.json', 'audio/scene-audio.wav']) {
    assert.ok(rel.includes(req), `packet includes ${req}`);
  }
  assert.ok(rel.filter((r) => r.startsWith('references/')).length === 2, 'reference files copied into packet');
  // determinism: same inputs → same prompt digest
  const again = compileScenePacket(state, scene, { attemptId: 'att-2', audioPath: '/tmp/song.m4a' });
  assert.equal(again.promptDigest, packet.promptDigest, 'prompt digest deterministic across attempts');

  // provider fit: refs (2<=3), duration (8<=8), aspect (9:16) all fit Google
  // caps; the only surfaced conflict is that Veo cannot take the song audio as
  // an input (informative, never a silent drop — we assemble to the song after).
  const conflicts = checkProviderFit(packet, googleVideoCapabilities);
  assert.deepEqual(conflicts.map((c) => c.id), ['audio-conditioning-unsupported'], 'only the audio-input conflict surfaces; refs/duration/aspect fit');
  // Without an audio segment, the same scene has zero conflicts.
  const noAudioPacket = compileScenePacket(state, scene, { attemptId: 'att-3' });
  assert.deepEqual(checkProviderFit(noAudioPacket, googleVideoCapabilities), [], 'in-bounds scene without audio has no capability conflicts');

  // too-many-references surfaces a conflict, never silently drops
  const capped = { ...googleVideoCapabilities, referenceImages: 1 };
  const c2 = checkProviderFit(packet, capped);
  assert.ok(c2.some((c) => c.id === 'too-many-references'), 'excess references surfaced as a conflict');
}

assert.equal(slug('Left Forearm!!'), 'left_forearm');

// ── Packet IO: writePacket materializes files; return binds via sidecar ─────
{
  const store = new Map<string, string>();
  const dirs = new Set<string>();
  const memFs = {
    async mkdir(d: string) { dirs.add(d); },
    async writeText(p: string, c: string) { store.set(p, c); },
    async copyFile(from: string, to: string) { store.set(to, `copy:${from}`); },
    join: (...p: string[]) => p.join('/'),
    async extractAudio(src: string, to: string, s: number, d: number) { store.set(to, `audio:${src}:${s}:${d}`); },
    async readText(p: string) { return store.get(p) ?? ''; },
    async exists(p: string) { return store.has(p) || p.startsWith('/tmp/'); },
    async statBytes(p: string) { return store.has(p) ? 100 : 0; },
  };
  const state = emptyDirectorState();
  const e = makeEntity('Sobelo', 'person'); const r = makeReference(e.id, 'face', '/tmp/face.png', 'face', 'upload'); r.approved = true;
  e.references.push(r); state.entities.push(e);
  const scene = makeScene('S', 0, 6);
  scene.castings.push({ entityId: e.id, relationship: 'exact', mustRemain: [], mayVary: [], referenceIds: [r.id] });
  state.scenes.push(scene);
  const packet = compileScenePacket(state, scene, { attemptId: 'att-9', audioPath: '/tmp/song.m4a' });
  const written = await writePacket(packet, 'pkg', memFs);
  assert.ok(written.includes('manifest.json') && written.includes('prompt.md'), 'packet text files written');
  assert.ok(store.get('pkg/references/character_sobelo_face.png')?.startsWith('copy:/tmp/face.png'), 'reference copied by name');
  assert.ok(store.get('pkg/audio/scene-audio.wav')?.startsWith('audio:/tmp/song.m4a:0:6'), 'scene audio extracted for the exact range');
  // sidecar return manifest binds the MP4 to the exact attempt (not filename guessing)
  store.set('inbox/return-manifest.json', JSON.stringify({ attemptId: 'att-9' }));
  const bind = await resolveReturnAttemptId('inbox/result.mp4', memFs);
  assert.deepEqual(bind, { attemptId: 'att-9', via: 'manifest' });
  const guided = await resolveReturnAttemptId('elsewhere/x.mp4', memFs, 'att-guided');
  assert.equal(guided.via, 'guided');
}

// ── Assembly planning (pure): coverage, gaps, final-readiness, arg shape ─────
{
  let state = emptyDirectorState();
  const sceneA = makeScene('A', 2, 6); const sceneB = makeScene('B', 12, 16);
  state.scenes.push(sceneA, sceneB);
  const snap = (s: typeof sceneA) => ({ promptDigest: 'd', recipe: 'separate-references' as const, referenceFiles: [], sceneStartSec: s.startSec, sceneEndSec: s.endSec, aspect: '9:16' as const, resolution: '720p' });
  const takeA = makeTake(sceneA, snap(sceneA), 'manual', {}); const takeB = makeTake(sceneB, snap(sceneB), 'manual', {});
  state.takes.push(takeA, takeB);
  state = bindResultToTake(state, takeA.id, 'clipA', 'imported');
  state = acceptTake(state, takeA.id); // only A accepted
  const assetPath = (id: string) => (id === 'clipA' ? '/tmp/a.mp4' : id === 'clipB' ? '/tmp/b.mp4' : null);
  const plan1 = planWorkprint(state, 20, assetPath);
  assert.equal(plan1.scenes.length, 1, 'only accepted-with-clip scenes are assembled');
  assert.equal(plan1.finalReady, false, 'gaps → not final ready');
  assert.ok(plan1.gaps.some((g) => g.startSec === 0 && g.endSec === 2), 'leading gap [0,2] reported');
  assert.ok(plan1.gaps.some((g) => Math.abs(g.startSec - 6) < 0.01), 'gap after scene A reported');

  state = bindResultToTake(state, takeB.id, 'clipB', 'imported');
  state = acceptTake(state, takeB.id);
  const plan2 = planWorkprint(state, 20, assetPath);
  assert.equal(plan2.scenes.length, 2);
  const args = buildWorkprintArgs(plan2, { songAudioPath: '/tmp/song.m4a', width: 360, height: 640, fps: 24, outputPath: '/tmp/wp.mp4', mode: 'workprint' });
  assert.ok(args.includes('/tmp/song.m4a') && args.includes('/tmp/a.mp4') && args.includes('/tmp/b.mp4'), 'song + both clips are inputs');
  assert.ok(args.includes('1:a'), 'song audio (input 1) is mapped');
  const fc = args[args.indexOf('-filter_complex') + 1];
  assert.ok(/enable='between\(t,2.000,6.000\)'/.test(fc) && /enable='between\(t,12.000,16.000\)'/.test(fc), 'each clip gated to its song range');
  assert.ok(/setpts=PTS-STARTPTS\+2.000\/TB/.test(fc), 'clip timestamps shifted to song time');

  // Full-song coverage → finalReady
  const full = makeScene('Full', 0, 20);
  let s2 = emptyDirectorState(); s2.scenes.push(full);
  const tf = makeTake(full, snap(full as typeof sceneA), 'manual', {}); s2.takes.push(tf);
  s2 = bindResultToTake(s2, tf.id, 'clipA', 'imported'); s2 = acceptTake(s2, tf.id);
  assert.equal(planWorkprint(s2, 20, assetPath).finalReady, true, 'full coverage → final ready');
}

console.log('[director-logic] PASS — preflight, safe tools, compiler, approved-only refs, provider-fit, packet IO, and assembly planning verified.');
