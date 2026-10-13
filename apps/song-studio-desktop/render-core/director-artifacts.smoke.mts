// Materialized conditioning-artifact proof (VIDEO-003B §3, §9). Compiles a scene
// under each recipe and WRITES the produced .svg artifacts to disk, then checks
// they are real, non-empty, labeled SVG documents. This proves the recipes emit
// genuine inspectable image files — not just recipe labels. Run:
//   npm run director:artifacts:smoke

import { mkdirSync, writeFileSync, existsSync, statSync, readFileSync } from 'node:fs';
import { emptyDirectorState, makeEntity, makeReference, makeScene, makeLyricEvent, defaultPose } from '../src/director/model';
import { compileScenePacket } from '../src/director/compile';
import type { ConditioningRecipe, DirectorTool } from '../src/director/model';

const OUT = 'out/_dir_artifacts';

function buildState() {
  const state = emptyDirectorState();
  state.songAudioPath = '/tmp/song.m4a';
  const artist = makeEntity('Sobelo', 'person', 'lean, weathered');
  const face = makeReference(artist.id, 'face', '/tmp/face.png', 'face', 'upload'); face.approved = true;
  const body = makeReference(artist.id, 'full-body', '/tmp/body.png', 'body', 'upload'); body.approved = true;
  artist.references.push(face, body);
  state.entities.push(artist);
  const scene = makeScene('Chorus', 60, 68);
  scene.action = 'the artist walks toward camera'; scene.camera = 'slow dolly in'; scene.cameraDistance = 'medium';
  scene.howItBegins = 'a wide street at dusk'; scene.howItEnds = 'a tight portrait'; scene.emotion = 'defiant';
  scene.castings.push({ entityId: artist.id, relationship: 'exact', mustRemain: ['tattoo'], mayVary: [], referenceIds: [face.id, body.id] });
  const l1 = makeLyricEvent('rise', 61, 62); l1.mouthVisibility = 'required'; l1.emphasis = 0.9;
  const l2 = makeLyricEvent('again', 63, 64);
  state.lyrics.push(l1, l2);
  const tool: DirectorTool = { id: 'pt', name: 'Pose', description: '', version: 1, appliesTo: ['scene'], fields: [{ id: 'p', kind: 'pose-sequence', label: 'Pose' }, { id: 'c', kind: 'camera-path', label: 'Cam' }], outputSchema: { pose: 'p', cam: 'c' }, conflictRules: [], compileHints: '', usageCount: 0, importedFrom: null, createdAt: 't' };
  state.tools.push(tool);
  scene.toolOutputs.push({ toolId: 'pt', toolVersion: 1, updatedAt: 't', values: {
    p: { poses: [{ atBeat: 0, holdBeats: 1, transition: 'smooth', joints: defaultPose() }, { atBeat: 2, holdBeats: 1, transition: 'snap', joints: defaultPose() }] },
    c: { start: { x: 0.2, y: 0.6 }, end: { x: 0.8, y: 0.4 }, control: [], movement: 'dolly', orientation: 'toward subject' },
  } });
  state.scenes.push(scene);
  return { state, scene };
}

function main() {
  mkdirSync(OUT, { recursive: true });
  const { state, scene } = buildState();
  const recipes: ConditioningRecipe[] = ['contact-sheet', 'storyboard', 'pose-sequence', 'audio-timed-lyrics', 'motion-guide'];
  const results: Array<{ recipe: string; file: string; bytes: number; ok: boolean }> = [];
  let pass = true;
  for (const recipe of recipes) {
    const pk = compileScenePacket(state, scene, { attemptId: 'a', recipe, audioPath: '/tmp/song.m4a' });
    const svg = pk.files.find((f) => f.relPath.endsWith('.svg'));
    if (!svg || svg.kind !== 'text') { results.push({ recipe, file: '(none)', bytes: 0, ok: false }); pass = false; continue; }
    const path = `${OUT}/${recipe}.svg`;
    writeFileSync(path, svg.content);
    const bytes = existsSync(path) ? statSync(path).size : 0;
    const content = readFileSync(path, 'utf8');
    const ok = bytes > 200 && content.startsWith('<?xml') && content.includes('<svg') && content.includes('</svg>');
    results.push({ recipe, file: path, bytes, ok });
    pass = pass && ok;
  }

  for (const r of results) console.log(`[director-artifacts] ${r.recipe.padEnd(18)} → ${r.file} (${r.bytes} bytes) ${r.ok ? 'OK' : 'FAIL'}`);
  console.log(pass
    ? '\n[director-artifacts] PASS — every recipe materialized a real, non-empty, labeled SVG artifact.'
    : '\n[director-artifacts] FAIL');
  process.exit(pass ? 0 : 1);
}

main();
