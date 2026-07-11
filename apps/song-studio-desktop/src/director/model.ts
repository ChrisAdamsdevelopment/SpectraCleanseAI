// Director Mode v1 (DEC-003) — canonical, provider-independent directing model.
//
// THE ARTIST DIRECTS. AI GENERATES THE MOVING SCENES. SONG STUDIO REMEMBERS,
// COORDINATES, REPAIRS, AND ASSEMBLES THE WORK.
//
// This module is pure domain data + factories + the identity fingerprint. It
// has no React, no Tauri, no provider knowledge — the conditioning compiler
// (compile.ts) translates this canonical direction into machine-facing inputs,
// and provider adapters translate packets into API calls. Everything here is
// persisted inside `ReleaseProject.director` and normalized on load
// (normalize.ts), so old projects open unchanged and Director Mode state
// round-trips exactly.

import { makeOutputId } from '../project/types';

// ── Directable visual entities ───────────────────────────────────────────────

export type EntityType =
  | 'person'        // the artist or another real person
  | 'character'     // fictional character
  | 'object' | 'prop' | 'wardrobe' | 'jewelry'
  | 'tattoo'        // tattoo / body marking (bodyLocation matters)
  | 'vehicle' | 'building' | 'location' | 'environment' | 'creature'
  | 'style';        // visual-style family (e.g. graffiti lettering language)

export const ENTITY_TYPES: EntityType[] = [
  'person', 'character', 'object', 'prop', 'wardrobe', 'jewelry', 'tattoo',
  'vehicle', 'building', 'location', 'environment', 'creature', 'style',
];

export type ReferenceKind =
  | 'face' | 'full-body' | 'profile' | 'hair'
  | 'tattoo-close' | 'tattoo-location'
  | 'wardrobe' | 'jewelry' | 'prop' | 'architecture' | 'material'
  | 'lighting' | 'pose' | 'movement' | 'camera'
  | 'first-frame' | 'final-frame' | 'style' | 'general';

export const REFERENCE_KINDS: ReferenceKind[] = [
  'face', 'full-body', 'profile', 'hair', 'tattoo-close', 'tattoo-location',
  'wardrobe', 'jewelry', 'prop', 'architecture', 'material', 'lighting',
  'pose', 'movement', 'camera', 'first-frame', 'final-frame', 'style', 'general',
];

export type ReferenceOrigin =
  | 'upload'               // creator-provided file
  | 'ai-generated'         // produced by a reference-generation attempt
  | 'imported-generation'  // brought back from an external generator
  | 'approved-frame'       // extracted from an approved generated take
  | 'derived';             // derived reference sheet / crop

export interface ReferenceVariant {
  id: string;
  entityId: string;
  kind: ReferenceKind;
  path: string;            // local file path (image)
  label: string;
  origin: ReferenceOrigin;
  /** A generated proposal never silently becomes canonical identity. */
  approved: boolean;
  bodyLocation?: string;   // e.g. "left forearm" for tattoo refs
  provenance: {
    generationAttemptId?: string; // which attempt created it (ai/imported/frame)
    sourceTakeId?: string;        // take a frame was extracted from
    note?: string;
  };
  createdAt: string;
}

export interface DirectorEntity {
  id: string;
  name: string;
  type: EntityType;
  description: string;
  /** Entity-level approval: it may be cast in scenes once approved. */
  approved: boolean;
  /** Bumped whenever the approved identity package changes (see fingerprint). */
  version: number;
  lockedTraits: string[];    // must never change across generations
  variableTraits: string[];  // AI may vary these naturally
  references: ReferenceVariant[];
  /** Fingerprint of the CURRENT approved identity package (see below). */
  activeFingerprint: string;
  scope: 'project';          // reserved for future cross-release scope
  history: Array<{ at: string; event: string }>;
  createdAt: string;
}

// ── Versioned identity fingerprint ───────────────────────────────────────────
// A deterministic, content-addressed manifest hash of the APPROVED identity
// package — not a magical likeness hash. It records exactly which references,
// locked traits, version, and description a generated scene was conditioned
// on. Changing any approved component produces a new fingerprint (and callers
// bump `version`), without corrupting prior takes, which keep the fingerprint
// they were generated with.

function fnv1a64(input: string): string {
  // 64-bit FNV-1a via two 32-bit lanes (deterministic, dependency-free).
  let h1 = 0x811c9dc5 >>> 0;
  let h2 = 0xcbf29ce4 >>> 0;
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ ((c << 1) | 1), 0x01000193) >>> 0;
  }
  return (h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0'));
}

/** Optional per-file digests (path -> content digest) supplied by IO layers;
 * when absent, the manifest still fingerprints ids/kinds/labels/paths. */
export function computeIdentityFingerprint(
  entity: Pick<DirectorEntity, 'version' | 'description' | 'lockedTraits' | 'references'>,
  assetDigests?: Record<string, string>,
): string {
  const approvedRefs = entity.references
    .filter((r) => r.approved)
    .map((r) => ({ id: r.id, kind: r.kind, label: r.label, path: r.path, digest: assetDigests?.[r.path] ?? null }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const manifest = {
    v: entity.version,
    description: entity.description,
    locked: [...entity.lockedTraits].sort(),
    refs: approvedRefs,
  };
  return 'idfp-' + fnv1a64(JSON.stringify(manifest));
}

// ── Exact / Consistent / Related / Invented ─────────────────────────────────

export type ContinuityRelationship = 'exact' | 'consistent' | 'related' | 'invented';

export const RELATIONSHIP_MEANING: Record<ContinuityRelationship, string> = {
  exact: 'Use the same approved entity or detail, unchanged.',
  consistent: 'Preserve identity; viewpoint, pose, lighting, and context may vary naturally.',
  related: 'Create something new in the same design language.',
  invented: 'The AI may create freely within the project and scene rules.',
};

export interface SceneCasting {
  entityId: string;
  relationship: ContinuityRelationship;
  mustRemain: string[];   // e.g. ["left-forearm tattoo", "silver ring v2"]
  mayVary: string[];      // e.g. ["exact buildings", "graffiti placement"]
  referenceIds: string[]; // which approved reference variants guide this scene
}

// ── Scene plans (full-song planning, song-relative) ─────────────────────────

export type SceneStatus = 'draft' | 'directed' | 'awaiting-result' | 'review' | 'accepted' | 'needs-repair';

export interface ScenePlan {
  id: string;
  title: string;
  startSec: number;        // song-relative (VIDEO-002 ownership doctrine)
  endSec: number;          // song-relative, > startSec
  purpose: string;
  description: string;
  action: string;
  movement: string;        // subject movement direction
  environment: string;
  camera: string;          // director-language camera direction
  cameraDistance: 'extreme-close' | 'close' | 'medium' | 'wide' | 'extreme-wide' | 'unspecified';
  cameraMotion: 'locked' | 'smooth' | 'handheld' | 'unstable' | 'unspecified';
  lighting: string;
  lightingStyle: 'natural' | 'stylized' | 'silhouette' | 'unspecified';
  styleGenre: string;
  emotion: string;
  continuityNotes: string;
  castings: SceneCasting[];
  invented: string;        // what the AI is invited to invent
  howItBegins: string;
  howItEnds: string;
  /** ids of LyricEvents performed in this scene (mouth-visibility feeds preflight). */
  lyricEventIds: string[];
  generationPrefs: { aspect: '9:16' | '16:9'; resolution: '720p' | '1080p' };
  /** Structured outputs from custom directing tools used in this scene. */
  toolOutputs: ToolOutput[];
  status: SceneStatus;
  acceptedTakeId: string | null;
  createdAt: string;
}

// ── Generation takes (attempts) ──────────────────────────────────────────────

export type TakeStatus =
  | 'packet-built' | 'exported' | 'submitted' | 'polling'
  | 'succeeded' | 'failed' | 'imported' | 'cancelled';

export interface RepairDirection {
  preserve: string[];      // "the performance", "the camera", "first five seconds"
  change: string[];        // "the ending", "the tattoos", "the hands"
  intervalSec?: { start: number; end: number } | null;
  note: string;
}

export interface GenerationTake {
  id: string;
  sceneId: string;
  /** Compiled-packet manifest snapshot: prompt digest, recipe, refs, timing. */
  requestSnapshot: {
    promptDigest: string;
    recipe: ConditioningRecipe;
    referenceFiles: string[];       // deterministic packet file names
    sceneStartSec: number;
    sceneEndSec: number;
    aspect: string;
    resolution: string;
  };
  provider: string;                 // 'google-video' | 'manual' | future ids
  model: string | null;
  submittedAt: string | null;
  status: TakeStatus;
  error: string | null;
  /** Generated ProjectAsset id (role 'generated-video') once a result exists. */
  assetId: string | null;
  /** Identity fingerprints in force when this take was compiled. */
  entityFingerprints: Record<string, string>;
  notes: string;
  accepted: boolean | null;         // null = not reviewed yet
  lipSync: 'not-required' | 'pending' | 'passed' | 'needs-repair';
  repair: RepairDirection | null;
  parentTakeId: string | null;      // derived-from (another-version / repair)
  createdAt: string;
}

// ── Lyrics as a vocal-performance score ──────────────────────────────────────

export type MouthVisibility = 'required' | 'preferred' | 'off-camera' | 'none';
export type VocalRole = 'lead' | 'background' | 'adlib' | 'narration' | 'dialogue';

export interface LyricEvent {
  id: string;
  performerEntityId: string | null; // who performs it (a person/character entity)
  phrase: string;                   // the phrase this word belongs to
  word: string;                     // single word (or whole phrase if untimed per word)
  startSec: number;
  endSec: number;
  emphasis: number;                 // 0..1
  delivery: string;                 // "whispered", "shouted", "melodic"…
  emotion: string;
  mouthVisibility: MouthVisibility;
  role: VocalRole;
  breathAfter: boolean;
  syllables?: number;
  phonemes?: string;                // optional phoneme/viseme hint string
}

// ── User-created, AI-generated directing tools (SAFE DECLARATIVE ONLY) ──────
// Tools are DATA. No AI-generated executable code, ever. The UI renders a tool
// from its declarative field list (allowlisted primitives only), and the tool's
// output is canonical structured data consumed by the conditioning compiler.

export type ToolFieldKind =
  | 'text' | 'range' | 'scale' | 'toggle' | 'choice'
  | 'reference-picker' | 'image-board' | 'steps' | 'preserve-vary'
  | 'beat-grid' | 'body-map' | 'pose-sequence' | 'camera-path' | 'lyric-blocks';

export const TOOL_FIELD_KINDS: ToolFieldKind[] = [
  'text', 'range', 'scale', 'toggle', 'choice',
  'reference-picker', 'image-board', 'steps', 'preserve-vary',
  'beat-grid', 'body-map', 'pose-sequence', 'camera-path', 'lyric-blocks',
];

export interface ToolField {
  id: string;
  kind: ToolFieldKind;
  label: string;
  help?: string;
  // kind-specific declarative config (validated by toolSchema.ts):
  min?: number; max?: number; step?: number;          // range
  labels?: string[];                                   // scale / choice
  options?: string[];                                  // choice
  maxItems?: number;                                   // steps / image-board / pose-sequence
  rows?: string[]; columns?: string[];                 // preserve-vary matrix
  beats?: number;                                      // beat-grid / pose-sequence
  regions?: string[];                                  // body-map
}

export interface DirectorTool {
  id: string;
  name: string;
  description: string;
  version: number;
  appliesTo: Array<'scene' | EntityType>;
  fields: ToolField[];
  /** Names the structured output keys → field ids (canonical output contract). */
  outputSchema: Record<string, string>;
  conflictRules: string[];        // human-readable rules preflight may surface
  compileHints: string;           // guidance for the conditioning compiler
  usageCount: number;
  importedFrom: string | null;    // package source, if imported
  createdAt: string;
}

/** Structured output of a tool used inside a scene. Values are JSON data keyed
 * by field id — pose-sequence fields store PoseSequenceData. */
export interface ToolOutput {
  toolId: string;
  toolVersion: number;
  values: Record<string, unknown>;
  updatedAt: string;
}

// ── Pose sequence primitive (SVG directing input, not an animator) ──────────

export type PoseJointId =
  | 'head' | 'neck' | 'shoulderL' | 'shoulderR' | 'elbowL' | 'elbowR'
  | 'handL' | 'handR' | 'hip' | 'kneeL' | 'kneeR' | 'footL' | 'footR';

export const POSE_JOINTS: PoseJointId[] = [
  'head', 'neck', 'shoulderL', 'shoulderR', 'elbowL', 'elbowR',
  'handL', 'handR', 'hip', 'kneeL', 'kneeR', 'footL', 'footR',
];

export interface PoseKey {
  atBeat: number;                        // beat position within the scene
  holdBeats: number;
  transition: 'smooth' | 'snap' | 'lock';
  joints: Record<PoseJointId, { x: number; y: number }>; // normalized 0..1
}

export interface PoseSequenceData { poses: PoseKey[] }

export function defaultPose(): Record<PoseJointId, { x: number; y: number }> {
  return {
    head: { x: 0.5, y: 0.12 }, neck: { x: 0.5, y: 0.2 },
    shoulderL: { x: 0.4, y: 0.24 }, shoulderR: { x: 0.6, y: 0.24 },
    elbowL: { x: 0.34, y: 0.38 }, elbowR: { x: 0.66, y: 0.38 },
    handL: { x: 0.3, y: 0.52 }, handR: { x: 0.7, y: 0.52 },
    hip: { x: 0.5, y: 0.55 }, kneeL: { x: 0.44, y: 0.74 }, kneeR: { x: 0.56, y: 0.74 },
    footL: { x: 0.42, y: 0.95 }, footR: { x: 0.58, y: 0.95 },
  };
}

// ── Conditioning recipes ─────────────────────────────────────────────────────

export type ConditioningRecipe =
  | 'separate-references' | 'contact-sheet' | 'storyboard'
  | 'pose-sequence' | 'first-last-frame' | 'audio-timed-lyrics' | 'motion-guide';

export const CONDITIONING_RECIPES: ConditioningRecipe[] = [
  'separate-references', 'contact-sheet', 'storyboard',
  'pose-sequence', 'first-last-frame', 'audio-timed-lyrics', 'motion-guide',
];

// ── Director state root (persisted on ReleaseProject.director) ──────────────

export interface WorkprintState {
  lastBuiltAt: string | null;
  /** Take ids included in the last build — replacing one marks it stale. */
  builtFromTakeIds: string[];
  stale: boolean;
}

export interface DirectorState {
  /** The audio file the song-relative timings (scenes, lyrics) were authored
   * against. If ReleaseProject.audioPath no longer matches, timings are
   * SUSPECT: the UI must surface a re-timing gate and block generation and
   * assembly until the creator explicitly confirms or re-times. Timings are
   * never silently kept valid and never silently destroyed. */
  songAudioPath: string | null;
  entities: DirectorEntity[];
  scenes: ScenePlan[];
  takes: GenerationTake[];
  lyrics: LyricEvent[];
  tools: DirectorTool[];
  workprint: WorkprintState;
}

export function emptyDirectorState(): DirectorState {
  return {
    songAudioPath: null,
    entities: [], scenes: [], takes: [], lyrics: [], tools: [],
    workprint: { lastBuiltAt: null, builtFromTakeIds: [], stale: false },
  };
}

/** True when the project's audio no longer matches the audio the director
 * timings were authored against — the explicit retime gate. */
export function directorTimingSuspect(projectAudioPath: string | null, state: DirectorState): boolean {
  if (state.scenes.length === 0 && state.lyrics.length === 0) return false;
  return state.songAudioPath !== projectAudioPath;
}

// ── Factories ────────────────────────────────────────────────────────────────

const now = () => new Date().toISOString();

export function makeEntity(name: string, type: EntityType, description = ''): DirectorEntity {
  const e: DirectorEntity = {
    id: makeOutputId(), name, type, description,
    approved: false, version: 1, lockedTraits: [], variableTraits: [],
    references: [], activeFingerprint: '', scope: 'project',
    history: [{ at: now(), event: 'created' }], createdAt: now(),
  };
  e.activeFingerprint = computeIdentityFingerprint(e);
  return e;
}

export function makeReference(entityId: string, kind: ReferenceKind, path: string, label: string, origin: ReferenceOrigin, provenance: ReferenceVariant['provenance'] = {}): ReferenceVariant {
  return { id: makeOutputId(), entityId, kind, path, label, origin, approved: origin === 'upload', bodyLocation: undefined, provenance, createdAt: now() };
}

/** Approving/unapproving identity components bumps the version + fingerprint;
 * prior takes keep the fingerprint they were generated with. */
export function refreshEntityIdentity(entity: DirectorEntity, assetDigests?: Record<string, string>): DirectorEntity {
  const next = { ...entity, version: entity.version + 1 };
  next.activeFingerprint = computeIdentityFingerprint(next, assetDigests);
  next.history = [...entity.history, { at: now(), event: `identity version ${next.version}` }];
  return next;
}

export function makeScene(title: string, startSec: number, endSec: number): ScenePlan {
  return {
    id: makeOutputId(), title, startSec, endSec,
    purpose: '', description: '', action: '', movement: '', environment: '',
    camera: '', cameraDistance: 'unspecified', cameraMotion: 'unspecified',
    lighting: '', lightingStyle: 'unspecified', styleGenre: '', emotion: '',
    continuityNotes: '', castings: [], invented: '', howItBegins: '', howItEnds: '',
    lyricEventIds: [], generationPrefs: { aspect: '9:16', resolution: '720p' },
    toolOutputs: [], status: 'draft', acceptedTakeId: null, createdAt: now(),
  };
}

export function makeTake(scene: ScenePlan, snapshot: GenerationTake['requestSnapshot'], provider: string, fingerprints: Record<string, string>, parentTakeId: string | null = null): GenerationTake {
  return {
    id: makeOutputId(), sceneId: scene.id, requestSnapshot: snapshot,
    provider, model: null, submittedAt: null, status: 'packet-built',
    error: null, assetId: null, entityFingerprints: fingerprints,
    notes: '', accepted: null, lipSync: 'not-required', repair: null,
    parentTakeId, createdAt: now(),
  };
}

export function makeLyricEvent(word: string, startSec: number, endSec: number): LyricEvent {
  return {
    id: makeOutputId(), performerEntityId: null, phrase: word, word,
    startSec, endSec, emphasis: 0.5, delivery: '', emotion: '',
    mouthVisibility: 'preferred', role: 'lead', breathAfter: false,
  };
}

/** Scenes sorted by song time; overlaps allowed in planning but reported. */
export function orderedScenes(scenes: ScenePlan[]): ScenePlan[] {
  return [...scenes].sort((a, b) => a.startSec - b.startSec || a.endSec - b.endSec);
}

export function sceneOverlaps(scenes: ScenePlan[]): Array<[string, string]> {
  const s = orderedScenes(scenes);
  const out: Array<[string, string]> = [];
  for (let i = 0; i < s.length - 1; i++) {
    if (s[i + 1].startSec < s[i].endSec) out.push([s[i].id, s[i + 1].id]);
  }
  return out;
}

export function acceptedTakeForScene(state: DirectorState, sceneId: string): GenerationTake | null {
  const scene = state.scenes.find((s) => s.id === sceneId);
  if (!scene?.acceptedTakeId) return null;
  return state.takes.find((t) => t.id === scene.acceptedTakeId && t.accepted === true) ?? null;
}
