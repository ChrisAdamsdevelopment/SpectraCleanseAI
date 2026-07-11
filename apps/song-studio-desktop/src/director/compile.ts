// CONDITIONING COMPILER (DEC-003 §6) — the translation layer between
// human-facing direction and machine-facing generation inputs.
//
// Canonical scene direction is provider-independent. This module compiles a
// ScenePlan (+ its castings, tool outputs, and lyric performance) into a
// GenerationPacket: a deterministic manifest, a prompt, negative constraints,
// NAMED reference files, conditioning data, and a return contract. A contact
// sheet or storyboard is a compiled ARTIFACT; the canonical references stay
// separate and remain the source of truth. Pure module: no IO — packet
// writers (Node/Tauri) materialize the file list.

import {
  fnv1a64, RELATIONSHIP_MEANING,
  type DirectorState, type ScenePlan, type GenerationTake, type DirectorEntity,
  type ReferenceVariant, type LyricEvent, type ConditioningRecipe, type PoseSequenceData,
} from './model';
import type { ProviderCapabilities } from './providers/types';

export function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'unnamed';
}

// ── Packet shapes ────────────────────────────────────────────────────────────

export interface PacketReference {
  fileName: string;        // deterministic packet-relative name under references/
  sourcePath: string;      // local file it is copied from
  entityId: string;
  entityName: string;
  referenceId: string;
  kind: string;
}

export type PacketFileDirective =
  | { kind: 'text'; relPath: string; content: string }
  | { kind: 'copy'; relPath: string; sourcePath: string }
  | { kind: 'audio-segment'; relPath: string; audioPath: string; startSec: number; durationSec: number };

export interface GenerationPacket {
  attemptId: string;
  sceneId: string;
  recipe: ConditioningRecipe;
  prompt: string;
  negative: string;
  promptDigest: string;
  references: PacketReference[];
  timing: { sceneStartSec: number; sceneEndSec: number; durationSec: number };
  aspect: '9:16' | '16:9';
  resolution: string;
  entityFingerprints: Record<string, string>;
  preserveRules: string[];
  varyRules: string[];
  files: PacketFileDirective[];   // complete manual-package file list
  manifest: Record<string, unknown>;
}

// ── Deterministic reference naming ───────────────────────────────────────────
// character_sobelo_face_front.png / tattoo_left_forearm_close.png style names:
// <entityType>_<entitySlug>_<kind>[_<n>].<ext>

function refFileName(entity: DirectorEntity, ref: ReferenceVariant, seen: Set<string>): string {
  const ext = (ref.path.split('.').pop() || 'png').toLowerCase();
  const typePrefix = entity.type === 'person' ? 'character' : entity.type;
  const body = ref.bodyLocation ? `_${slug(ref.bodyLocation)}` : '';
  let base = `${typePrefix}_${slug(entity.name)}${body}_${slug(ref.kind)}`;
  let name = `${base}.${ext}`;
  let n = 2;
  while (seen.has(name)) { name = `${base}_${String(n).padStart(2, '0')}.${ext}`; n++; }
  seen.add(name);
  return name;
}

// ── Prompt assembly (director language → generation language) ───────────────

function castingBlock(scene: ScenePlan, state: DirectorState): { lines: string[]; preserve: string[]; vary: string[] } {
  const lines: string[] = [];
  const preserve: string[] = [];
  const vary: string[] = [];
  for (const c of scene.castings) {
    const e = state.entities.find((en) => en.id === c.entityId);
    if (!e) continue;
    lines.push(`- ${e.name} (${e.type}) — ${c.relationship.toUpperCase()}: ${RELATIONSHIP_MEANING[c.relationship]}${e.description ? ` ${e.name}: ${e.description}` : ''}`);
    for (const m of [...e.lockedTraits, ...c.mustRemain]) preserve.push(`${e.name}: ${m}`);
    for (const m of [...e.variableTraits, ...c.mayVary]) vary.push(`${e.name}: ${m}`);
  }
  return { lines, preserve: [...new Set(preserve)], vary: [...new Set(vary)] };
}

function lyricsBlock(scene: ScenePlan, state: DirectorState): { lines: string[]; events: LyricEvent[] } {
  const events = scene.lyricEventIds
    .map((id) => state.lyrics.find((l) => l.id === id))
    .filter((l): l is LyricEvent => Boolean(l))
    .sort((a, b) => a.startSec - b.startSec);
  const lines = events.map((l) => {
    const local = (t: number) => (t - scene.startSec).toFixed(2);
    const perf = l.performerEntityId ? state.entities.find((e) => e.id === l.performerEntityId)?.name ?? 'performer' : 'off-camera voice';
    return `- [${local(l.startSec)}s→${local(l.endSec)}s] ${perf} (${l.role}): "${l.word}" emphasis ${(l.emphasis * 100).toFixed(0)}%${l.delivery ? `, ${l.delivery}` : ''}${l.emotion ? `, ${l.emotion}` : ''} — mouth ${l.mouthVisibility}`;
  });
  return { lines, events };
}

function toolBlock(scene: ScenePlan, state: DirectorState): string[] {
  const lines: string[] = [];
  for (const out of scene.toolOutputs) {
    const tool = state.tools.find((t) => t.id === out.toolId);
    if (!tool) continue;
    lines.push(`Directing tool "${tool.name}": ${tool.compileHints || tool.description}`);
    for (const [key, fieldId] of Object.entries(tool.outputSchema)) {
      const v = out.values[fieldId];
      if (v === undefined) continue;
      if (typeof v === 'object' && v !== null && 'poses' in (v as object)) {
        const ps = v as PoseSequenceData;
        lines.push(`  ${key}: pose sequence with ${ps.poses.length} key poses — ${ps.poses.map((p) => `beat ${p.atBeat} hold ${p.holdBeats} (${p.transition})`).join('; ')} (see conditioning/pose-sequence.json for exact joint positions)`);
      } else {
        lines.push(`  ${key}: ${typeof v === 'string' ? v : JSON.stringify(v)}`);
      }
    }
  }
  return lines;
}

export function buildScenePrompt(scene: ScenePlan, state: DirectorState, references: PacketReference[]): { prompt: string; negative: string; preserve: string[]; vary: string[] } {
  const cast = castingBlock(scene, state);
  const lyr = lyricsBlock(scene, state);
  const tools = toolBlock(scene, state);
  const dur = (scene.endSec - scene.startSec).toFixed(1);

  const prompt = [
    `A ${dur}-second ${scene.generationPrefs.aspect} music-video scene${scene.styleGenre ? ` in the style of ${scene.styleGenre}` : ''}.`,
    scene.purpose && `Purpose: ${scene.purpose}`,
    scene.description && `Scene: ${scene.description}`,
    scene.action && `Action: ${scene.action}`,
    scene.movement && `Movement: ${scene.movement}`,
    scene.environment && `Environment: ${scene.environment}`,
    scene.camera && `Camera: ${scene.camera}${scene.cameraDistance !== 'unspecified' ? ` (${scene.cameraDistance.replace('-', ' ')} shot)` : ''}${scene.cameraMotion !== 'unspecified' ? `, ${scene.cameraMotion} camera` : ''}`,
    scene.lighting && `Lighting: ${scene.lighting}${scene.lightingStyle !== 'unspecified' ? ` (${scene.lightingStyle})` : ''}`,
    scene.emotion && `Emotional intention: ${scene.emotion}`,
    scene.howItBegins && `The scene begins: ${scene.howItBegins}`,
    scene.howItEnds && `The scene ends: ${scene.howItEnds}`,
    cast.lines.length > 0 && `WHO/WHAT APPEARS:\n${cast.lines.join('\n')}`,
    references.length > 0 && `REFERENCE IMAGES (attached, by name):\n${references.map((r) => `- ${r.fileName}: ${r.entityName} ${r.kind}`).join('\n')}`,
    cast.preserve.length > 0 && `MUST REMAIN TRUE (do not alter):\n${cast.preserve.map((p) => `- ${p}`).join('\n')}`,
    cast.vary.length > 0 && `MAY VARY NATURALLY:\n${cast.vary.map((p) => `- ${p}`).join('\n')}`,
    scene.invented && `THE AI MAY INVENT: ${scene.invented}`,
    scene.continuityNotes && `Continuity: ${scene.continuityNotes}`,
    tools.length > 0 && tools.join('\n'),
    lyr.lines.length > 0 && `VOCAL PERFORMANCE (timed within the scene):\n${lyr.lines.join('\n')}`,
  ].filter(Boolean).join('\n\n');

  const negative = [
    'Do not add captions, subtitles, watermarks, or on-screen text unless directed.',
    ...cast.preserve.map((p) => `Do not alter: ${p}.`),
  ].join('\n');

  return { prompt, negative, preserve: cast.preserve, vary: cast.vary };
}

// ── Packet compilation ───────────────────────────────────────────────────────

export function compileScenePacket(
  state: DirectorState,
  scene: ScenePlan,
  opts: { attemptId: string; recipe?: ConditioningRecipe; audioPath?: string | null },
): GenerationPacket {
  const recipe: ConditioningRecipe = opts.recipe ?? 'separate-references';
  const seen = new Set<string>();
  const references: PacketReference[] = [];
  const fingerprints: Record<string, string> = {};

  for (const c of scene.castings) {
    const e = state.entities.find((en) => en.id === c.entityId);
    if (!e) continue;
    fingerprints[e.id] = e.activeFingerprint;
    for (const refId of c.referenceIds) {
      const ref = e.references.find((r) => r.id === refId && r.approved);
      if (!ref) continue; // only APPROVED references ever enter a packet
      references.push({
        fileName: refFileName(e, ref, seen), sourcePath: ref.path,
        entityId: e.id, entityName: e.name, referenceId: ref.id, kind: ref.kind,
      });
    }
  }

  const { prompt, negative, preserve, vary } = buildScenePrompt(scene, state, references);
  const promptDigest = 'p-' + fnv1a64(prompt + ' ' + negative);
  const durationSec = scene.endSec - scene.startSec;
  const lyr = lyricsBlock(scene, state);
  const poseOutputs = scene.toolOutputs.flatMap((o) =>
    Object.values(o.values).filter((v): v is PoseSequenceData => typeof v === 'object' && v !== null && 'poses' in (v as object)));

  const returnContract = {
    attemptId: opts.attemptId,
    sceneId: scene.id,
    expected: 'one MP4 video file',
    durationSec,
    aspect: scene.generationPrefs.aspect,
    howToReturn: 'In Song Studio, open the scene → this attempt → "Import generated result", or place the MP4 next to a return-manifest.json containing {"attemptId": "' + opts.attemptId + '"} and import it.',
  };

  const manifest: Record<string, unknown> = {
    format: 'songstudio-generation-packet',
    formatVersion: 1,
    attemptId: opts.attemptId,
    sceneId: scene.id,
    sceneTitle: scene.title,
    recipe,
    promptDigest,
    timing: { sceneStartSec: scene.startSec, sceneEndSec: scene.endSec, durationSec },
    aspect: scene.generationPrefs.aspect,
    resolution: scene.generationPrefs.resolution,
    entityFingerprints: fingerprints,
    references: references.map((r) => ({ file: `references/${r.fileName}`, entity: r.entityName, kind: r.kind, referenceId: r.referenceId })),
    preserve, vary,
    lyricsIncluded: lyr.events.length > 0,
    poseSequenceIncluded: poseOutputs.length > 0,
  };

  const files: PacketFileDirective[] = [
    {
      kind: 'text', relPath: 'README.md',
      content: [
        `# Song Studio generation packet — ${scene.title}`, '',
        'How to use this package with an external generator:',
        '1. Open your video generator.',
        `2. Attach the images in references/ using their file names as identity guides.`,
        '3. Paste prompt.md as the prompt and negative-constraints.md as negative guidance.',
        `4. Generate a ${durationSec.toFixed(1)}s ${scene.generationPrefs.aspect} MP4.`,
        '5. ' + returnContract.howToReturn,
      ].join('\n'),
    },
    { kind: 'text', relPath: 'manifest.json', content: JSON.stringify(manifest, null, 2) },
    { kind: 'text', relPath: 'scene-spec.json', content: JSON.stringify(scene, null, 2) },
    { kind: 'text', relPath: 'prompt.md', content: prompt },
    { kind: 'text', relPath: 'negative-constraints.md', content: negative },
    { kind: 'text', relPath: 'provider-notes.md', content: `Recipe: ${recipe}. Preferred: ${scene.generationPrefs.resolution} ${scene.generationPrefs.aspect}, ~${durationSec.toFixed(1)}s. References are canonical and separate; any contact sheet is a compiled artifact.` },
    { kind: 'text', relPath: 'return-contract.json', content: JSON.stringify(returnContract, null, 2) },
    ...references.map((r): PacketFileDirective => ({ kind: 'copy', relPath: `references/${r.fileName}`, sourcePath: r.sourcePath })),
  ];
  if (poseOutputs.length > 0) {
    files.push({ kind: 'text', relPath: 'conditioning/pose-sequence.json', content: JSON.stringify(poseOutputs, null, 2) });
  }
  if (lyr.events.length > 0) {
    files.push({
      kind: 'text', relPath: 'lyrics/timed-lyrics.json',
      content: JSON.stringify(lyr.events.map((l) => ({
        word: l.word, phrase: l.phrase,
        startInSceneSec: +(l.startSec - scene.startSec).toFixed(3),
        endInSceneSec: +(l.endSec - scene.startSec).toFixed(3),
        emphasis: l.emphasis, delivery: l.delivery, emotion: l.emotion,
        role: l.role, mouthVisibility: l.mouthVisibility,
      })), null, 2),
    });
  }
  if (opts.audioPath) {
    files.push({ kind: 'audio-segment', relPath: 'audio/scene-audio.wav', audioPath: opts.audioPath, startSec: scene.startSec, durationSec });
  }

  return {
    attemptId: opts.attemptId, sceneId: scene.id, recipe, prompt, negative, promptDigest,
    references, timing: { sceneStartSec: scene.startSec, sceneEndSec: scene.endSec, durationSec },
    aspect: scene.generationPrefs.aspect, resolution: scene.generationPrefs.resolution,
    entityFingerprints: fingerprints, preserveRules: preserve, varyRules: vary,
    files, manifest,
  };
}

// ── Lip-sync repair packet (DEC-003 §11B) ────────────────────────────────────

export function compileLipSyncRepairPacket(
  state: DirectorState, scene: ScenePlan, take: GenerationTake,
  opts: { sourceVideoPath: string; audioPath: string | null; intervalSec?: { start: number; end: number } | null },
): PacketFileDirective[] {
  const lyr = lyricsBlock(scene, state);
  const performers = new Set(lyr.events.map((l) => l.performerEntityId).filter(Boolean));
  const seen = new Set<string>();
  const refs: PacketReference[] = [];
  for (const pid of performers) {
    const e = state.entities.find((en) => en.id === pid);
    if (!e) continue;
    for (const r of e.references.filter((r) => r.approved && (r.kind === 'face' || r.kind === 'profile'))) {
      refs.push({ fileName: refFileName(e, r, seen), sourcePath: r.path, entityId: e.id, entityName: e.name, referenceId: r.id, kind: r.kind });
    }
  }
  const interval = opts.intervalSec ?? null;
  const contract = {
    attemptId: take.id, kind: 'lip-sync-repair',
    repairIntervalSec: interval,
    instruction: 'Synchronize the performer mouth movement to the provided audio + timed lyrics. PRESERVE EVERYTHING OUTSIDE THE MOUTH REGION. Do not alter identity, wardrobe, camera, lighting, or background.',
  };
  const files: PacketFileDirective[] = [
    { kind: 'text', relPath: 'README.md', content: `# Lip-sync repair packet — ${scene.title}\nRepair mouth sync on source.mp4 using audio/ + lyrics/. Preserve everything outside the mouth.` },
    { kind: 'copy', relPath: 'source.mp4', sourcePath: opts.sourceVideoPath },
    { kind: 'text', relPath: 'return-contract.json', content: JSON.stringify(contract, null, 2) },
    { kind: 'text', relPath: 'lyrics/timed-lyrics.json', content: JSON.stringify(lyr.events.map((l) => ({ word: l.word, startInSceneSec: +(l.startSec - scene.startSec).toFixed(3), endInSceneSec: +(l.endSec - scene.startSec).toFixed(3), emphasis: l.emphasis, mouthVisibility: l.mouthVisibility })), null, 2) },
    ...refs.map((r): PacketFileDirective => ({ kind: 'copy', relPath: `references/${r.fileName}`, sourcePath: r.sourcePath })),
  ];
  if (opts.audioPath) {
    files.push({ kind: 'audio-segment', relPath: 'audio/scene-audio.wav', audioPath: opts.audioPath, startSec: scene.startSec, durationSec: scene.endSec - scene.startSec });
  }
  return files;
}

// ── Provider fit (capability conflicts are surfaced, never silently fixed) ──

export interface CapabilityConflict {
  id: string;
  message: string;
  choices: string[];
}

export function checkProviderFit(packet: GenerationPacket, caps: ProviderCapabilities): CapabilityConflict[] {
  const out: CapabilityConflict[] = [];
  if (packet.references.length > caps.referenceImages) {
    out.push({
      id: 'too-many-references',
      message: `This scene selected ${packet.references.length} reference images, but the provider supports at most ${caps.referenceImages}.`,
      choices: ['Choose the most important references', 'Export the manual package for a generator that accepts more', 'Continue with the first ' + caps.referenceImages + ' (you choose which)'],
    });
  }
  const hasPersonRefs = packet.references.some((r) => r.kind === 'face' || r.kind === 'full-body' || r.kind === 'profile');
  if (hasPersonRefs && !caps.humanLikenessReferences) {
    out.push({
      id: 'human-likeness-unsupported',
      message: 'This provider does not support real-person likeness references. Your identity requirement will NOT be honored automatically.',
      choices: ['Use the manual generation package with a generator that supports likeness', 'Relax the identity requirement to consistent/related for this scene', 'Continue knowingly'],
    });
  }
  const maxDur = Math.max(...caps.durationsSec, 0);
  if (packet.timing.durationSec > maxDur) {
    out.push({
      id: 'duration-exceeds-provider',
      message: `The scene is ${packet.timing.durationSec.toFixed(1)}s but the provider generates at most ${maxDur}s per clip.`,
      choices: ['Split the scene into two shots', `Generate ${maxDur}s and direct an extension later`, 'Export the manual package'],
    });
  }
  if (!caps.aspects.includes(packet.aspect)) {
    out.push({ id: 'aspect-unsupported', message: `Aspect ${packet.aspect} is not supported by this provider.`, choices: ['Switch the scene aspect', 'Export the manual package'] });
  }
  if (!caps.audioInput && packet.files.some((f) => f.kind === 'audio-segment')) {
    out.push({ id: 'audio-conditioning-unsupported', message: 'This provider cannot take the song audio as input; timing will rely on the prompt only.', choices: ['Continue (assemble to the song afterward)', 'Export the manual package for an audio-aware generator'] });
  }
  return out;
}
