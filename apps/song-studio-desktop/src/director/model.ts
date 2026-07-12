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
  /** Stable content-address of the image bytes (host-computed on register).
   * The fingerprint prefers this over the file path so identity survives moves
   * and is not spoofable by renaming. */
  contentDigest?: string;
  bodyLocation?: string;   // e.g. "left forearm" for tattoo refs
  provenance: {
    generationAttemptId?: string; // which attempt created it (ai/imported/frame)
    sourceTakeId?: string;        // take a frame was extracted from
    note?: string;
  };
  createdAt: string;
}

// ── AI-generated reference variants (DEC-003 §F / VIDEO-003B §1) ─────────────
// One GENERAL reference-variant request system (not one feature per kind). A
// request records exactly what identity it was conditioned on and what may vary;
// its results arrive as UNAPPROVED proposals and only become canonical through
// the entity apply transaction (which bumps version + fingerprint). Persisted so
// a pending image job survives close/reopen, mirroring ProviderJob for video.

export type ReferenceRequestStatus =
  | 'draft' | 'submitted' | 'running' | 'succeeded' | 'failed' | 'exported' | 'imported';

export interface ReferenceRequest {
  id: string;
  entityId: string;
  entityVersion: number;          // identity version this was conditioned on
  kind: ReferenceKind;            // requested reference kind (general system)
  direction: string;              // creator direction ("3/4 left, softer light")
  conditioningReferenceIds: string[]; // approved refs used as identity guides
  traitsRemain: string[];         // must remain
  traitsVary: string[];           // may vary
  outputCount: number;            // how many variants to request (provider-permitting)
  providerId: string;             // image provider id (or 'manual')
  modelId: string | null;
  readiness: 'ready' | 'warning' | 'blocked';
  readinessNote: string;
  status: ReferenceRequestStatus;
  jobId: string | null;           // provider interaction/operation id (resume)
  error: string | null;
  resultRefIds: string[];         // reference variant ids this request produced
  bodyLocation?: string;          // for tattoo kinds
  createdAt: string;
}

export function makeReferenceRequest(entity: DirectorEntity, kind: ReferenceKind, providerId: string): ReferenceRequest {
  return {
    id: makeOutputId(), entityId: entity.id, entityVersion: entity.version, kind,
    direction: '', conditioningReferenceIds: entity.references.filter((r) => r.approved).map((r) => r.id),
    traitsRemain: [...entity.lockedTraits], traitsVary: [...entity.variableTraits],
    outputCount: 1, providerId, modelId: null, readiness: 'ready', readinessNote: '',
    status: 'draft', jobId: null, error: null, resultRefIds: [], createdAt: now(),
  };
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

export function fnv1a64(input: string): string {
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
    // Prefer the stable content digest over the path (identity must not depend
    // primarily on file location). Body location is identity-bearing for tattoos.
    .map((r) => ({ id: r.id, kind: r.kind, bodyLocation: r.bodyLocation ?? null, digest: r.contentDigest ?? assetDigests?.[r.path] ?? null, path: r.contentDigest ? null : r.path }))
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
  /** Explicit lyric includes. By default (§E) a scene's lyrics are DERIVED from
   * song-time overlap; this list force-includes events (e.g. off-camera lines
   * whose timing sits just outside), and `lyricExclude` force-removes. See
   * sceneLyrics() — the single canonical selection the compiler + preflight use. */
  lyricEventIds: string[];
  lyricExclude: string[];
  /** What to do when the accepted clip is shorter than the directed scene
   * (§H6). 'unset' means the creator has not chosen — assembly BLOCKS FINAL. */
  shortClipPolicy: 'unset' | 'hold-last' | 'loop' | 'shorten-scene' | 'leave-gap';
  /** Which conditioning recipe compiles this scene's packet (§3). Different
   * recipes materialize materially different artifacts (contact sheet,
   * storyboard, pose sheet, first/last frame, audio-timed lyrics, motion guide)
   * while the canonical references always stay separate and authoritative. */
  recipe: ConditioningRecipe;
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
  kind: 'general' | 'lip-sync'; // lip-sync repairs compile the dedicated packet
  preserve: string[];      // "the performance", "the camera", "first five seconds"
  change: string[];        // "the ending", "the tattoos", "the hands"
  intervalSec?: { start: number; end: number } | null;
  performerEntityId?: string | null; // whose mouth to sync (lip-sync)
  note: string;
}

/** The minimum persisted provider-job record required to RESUME an unfinished
 * request after closing and reopening the project. Without this the operation
 * id is lost and a pending live job can never be polled/downloaded. */
export interface ProviderJob {
  providerId: string;               // 'google-omni' | 'google-veo' | 'mock' | 'manual'
  modelId: string | null;
  jobId: string | null;             // provider operation / interaction id
  phase: 'none' | 'submitted' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  submittedAt: string | null;
  lastPolledAt: string | null;
  completedAt: string | null;
  resultRef: string | null;         // provider-side uri/file id when applicable
  localResultPath: string | null;   // downloaded/written MP4 path
  error: string | null;
  parentJobId: string | null;       // prior interaction id for conversational repair
}

export function emptyProviderJob(providerId: string, modelId: string | null = null): ProviderJob {
  return {
    providerId, modelId, jobId: null, phase: 'none',
    submittedAt: null, lastPolledAt: null, completedAt: null,
    resultRef: null, localResultPath: null, error: null, parentJobId: null,
  };
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
    durationSec: number;            // the EXACT duration requested (never clamped silently)
  };
  provider: string;                 // provider id (also mirrored in providerJob)
  model: string | null;
  submittedAt: string | null;
  status: TakeStatus;
  error: string | null;
  /** Generated ProjectAsset id (role 'generated-video') once a result exists. */
  assetId: string | null;
  /** Persisted provider-job record for resume-after-reopen. */
  providerJob: ProviderJob;
  /** Identity fingerprints in force when this take was compiled. */
  entityFingerprints: Record<string, string>;
  /** Provider limitations the creator explicitly accepted for this attempt. */
  acceptedOverrides: string[];
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

// ── Rich directing-primitive output shapes (VIDEO-003B §2) ──────────────────
// Each rich field stores STABLE structured data (ids, not paths or free text)
// so it round-trips, feeds compilation + preflight, and never becomes a dead
// control. Normalization (normalize.ts) validates each shape by field kind.

/** reference-picker: stable reference/asset ids the creator selected. */
export interface ReferencePickData { referenceIds: string[]; assetIds: string[] }

/** image-board: an ORDERED list of image cards, each labeled by purpose. */
export interface ImageBoardItem { id: string; referenceId?: string; assetId?: string; label: string }
export interface ImageBoardData { items: ImageBoardItem[] }

export type CameraMovementType =
  | 'static' | 'pan' | 'tilt' | 'dolly' | 'truck' | 'crane' | 'orbit' | 'handheld' | 'zoom';
export const CAMERA_MOVEMENTS: CameraMovementType[] = ['static', 'pan', 'tilt', 'dolly', 'truck', 'crane', 'orbit', 'handheld', 'zoom'];

/** camera-path: normalized (0..1) start/end + optional control points, a
 * semantic movement type, and optional facing/orientation metadata. */
export interface CameraPathData {
  start: { x: number; y: number };
  end: { x: number; y: number };
  control: Array<{ x: number; y: number }>;
  movement: CameraMovementType;
  orientation: string;
}
export function defaultCameraPath(): CameraPathData {
  return { start: { x: 0.2, y: 0.5 }, end: { x: 0.8, y: 0.5 }, control: [], movement: 'dolly', orientation: '' };
}

/** lyric-blocks: selected lyric event ids + explicit per-lyric overrides that
 * feed the SAME canonical selection the compiler + preflight consume. */
export interface LyricBlockOverride { mouthVisibility?: MouthVisibility; emphasis?: number }
export interface LyricBlocksData { selectedLyricIds: string[]; overrides: Record<string, LyricBlockOverride> }

export function isPoseSequenceData(v: unknown): v is PoseSequenceData {
  return typeof v === 'object' && v !== null && 'poses' in (v as object) && Array.isArray((v as PoseSequenceData).poses);
}
export function isCameraPathData(v: unknown): v is CameraPathData {
  return typeof v === 'object' && v !== null && 'start' in (v as object) && 'end' in (v as object) && 'movement' in (v as object);
}
export function isImageBoardData(v: unknown): v is ImageBoardData {
  return typeof v === 'object' && v !== null && Array.isArray((v as ImageBoardData).items);
}
export function isLyricBlocksData(v: unknown): v is LyricBlocksData {
  return typeof v === 'object' && v !== null && Array.isArray((v as LyricBlocksData).selectedLyricIds);
}
export function isReferencePickData(v: unknown): v is ReferencePickData {
  return typeof v === 'object' && v !== null && Array.isArray((v as ReferencePickData).referenceIds) && Array.isArray((v as ReferencePickData).assetIds);
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
  /** Signature of everything that affects the assembled output (accepted takes,
   * scene timings, short-clip policies, aspect). Any change → stale (§H7). */
  builtSignature: string;
  stale: boolean;
}

/** A signature of the current assembled-output inputs. Changing an accepted
 * take, a scene's timing, its short-clip policy, or its aspect changes it. */
export function assemblySignature(state: DirectorState): string {
  const parts = orderedScenes(state.scenes)
    .filter((s) => s.acceptedTakeId)
    .map((s) => `${s.acceptedTakeId}:${s.startSec}-${s.endSec}:${s.shortClipPolicy}:${s.generationPrefs.aspect}`);
  return fnv1a64(parts.join('|'));
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
  /** In-flight / historical AI reference-variant requests (§F). */
  referenceRequests: ReferenceRequest[];
  workprint: WorkprintState;
}

export function emptyDirectorState(): DirectorState {
  return {
    songAudioPath: null,
    entities: [], scenes: [], takes: [], lyrics: [], tools: [], referenceRequests: [],
    workprint: { lastBuiltAt: null, builtFromTakeIds: [], builtSignature: "", stale: false },
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
    lyricEventIds: [], lyricExclude: [], shortClipPolicy: 'unset',
    recipe: 'separate-references',
    generationPrefs: { aspect: '9:16', resolution: '720p' },
    toolOutputs: [], status: 'draft', acceptedTakeId: null, createdAt: now(),
  };
}

/** The CANONICAL lyric selection for a scene (§E): events whose song time
 * overlaps the scene, plus explicit includes, minus explicit excludes. The
 * compiler AND preflight consume exactly this — no invisible manual wiring. */
export function sceneLyrics(state: DirectorState, scene: ScenePlan): LyricEvent[] {
  const excluded = new Set(scene.lyricExclude);
  const forced = new Set(scene.lyricEventIds);
  // A lyric-blocks directing-tool output feeds the SAME canonical selection
  // (§2): its selected ids force-include, its overrides adjust emphasis/mouth.
  const overrides: Record<string, LyricBlockOverride> = {};
  for (const out of scene.toolOutputs) {
    for (const v of Object.values(out.values)) {
      if (!isLyricBlocksData(v)) continue;
      for (const lid of v.selectedLyricIds) forced.add(lid);
      for (const [lid, ov] of Object.entries(v.overrides)) overrides[lid] = { ...overrides[lid], ...ov };
    }
  }
  return state.lyrics
    .filter((l) => !excluded.has(l.id))
    .filter((l) => forced.has(l.id) || (l.startSec < scene.endSec && l.endSec > scene.startSec))
    .map((l) => {
      const ov = overrides[l.id];
      return ov ? { ...l, mouthVisibility: ov.mouthVisibility ?? l.mouthVisibility, emphasis: ov.emphasis ?? l.emphasis } : l;
    })
    .sort((a, b) => a.startSec - b.startSec);
}

export function makeTake(scene: ScenePlan, snapshot: GenerationTake['requestSnapshot'], provider: string, fingerprints: Record<string, string>, parentTakeId: string | null = null, id: string = makeOutputId()): GenerationTake {
  return {
    id, sceneId: scene.id, requestSnapshot: snapshot,
    provider, model: null, submittedAt: null, status: 'packet-built',
    error: null, assetId: null, providerJob: emptyProviderJob(provider),
    entityFingerprints: fingerprints, acceptedOverrides: [],
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
