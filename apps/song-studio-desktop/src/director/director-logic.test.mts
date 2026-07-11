import assert from 'node:assert/strict';
import {
  emptyDirectorState, makeEntity, makeReference, makeScene, makeLyricEvent,
} from './model';
import { preflightScene } from './preflight';
import { validateToolDefinition, parseToolFromModelText, exportToolPackage, importToolPackage, toolGenerationPrompt } from './toolSchema';
import { compileScenePacket, checkProviderFit, slug } from './compile';
import { googleVideoCapabilities } from './providers/googleVideo';

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

console.log('[director-logic] PASS — preflight conflicts, safe tool schema, compiler packet, approved-only references, and provider-fit conflicts verified.');
