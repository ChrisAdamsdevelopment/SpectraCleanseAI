// A song project is the central object of Song Studio: one song and the inputs
// used to generate promotional assets from it. Stored as local JSON (no DB).

export type SongMomentKind = 'teaser' | 'early' | 'middle' | 'promo' | 'manual';
export type SongMomentSource = 'duration-heuristic' | 'manual';

export interface SongMoment {
  id: string;
  label: string;
  startSec: number;
  durationSec: number;
  endSec: number;
  confidence: number;
  reason: string;
  kind: SongMomentKind;
  source: SongMomentSource;
}

export interface SongAnalysis {
  audioPath: string;
  analyzedAt: string;
  durationSec: number;
  moments: SongMoment[];
  selectedMomentId: string | null;
}

// SongProject is now the "single-output view" the renderer/editor and the
// export/promo helper modules consume: a ReleaseProject's shared fields merged
// with ONE of its outputs (see mergeProjectView below). It is no longer the
// persisted root object — ReleaseProject is — but its shape is kept exactly as
// it was so render/plan.ts, export/review.ts, export/result.ts, and
// promo/directions.ts never need to change.
export interface SongProject {
  schemaVersion: 2;
  title: string;
  artist: string;
  audioPath: string | null;
  coverPath: string | null;
  outputDir: string | null;
  // creative selection
  functionId: string;        // what to make
  recipeId: string;          // which style/recipe
  // clip selection (stored as user-entered strings; parsed at render time)
  clipStart: string;         // e.g. "0:42" or "42"
  clipDuration: string;      // e.g. "15"
  selectedMomentId: string | null;
  songAnalysis: SongAnalysis | null;
  selectedPromoDirectionId: string | null;
  updatedAt: string;
}

export function emptyProject(): SongProject {
  return {
    schemaVersion: 2,
    title: '',
    artist: '',
    audioPath: null,
    coverPath: null,
    outputDir: null,
    functionId: 'make_canvas',
    recipeId: 'clean_canvas',
    clipStart: '0:00',
    clipDuration: '6',
    selectedMomentId: null,
    songAnalysis: null,
    selectedPromoDirectionId: null,
    updatedAt: new Date().toISOString(),
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Release Project + Outputs (v1 spine). A release project owns the shared
// song/cover inputs once; each Output is one promo asset created from those
// shared inputs, with its own type, style, song section, and render status.
// This is what makes "one song -> many promo outputs" possible.
// ─────────────────────────────────────────────────────────────────────────

export type OutputStatus = 'draft' | 'rendered' | 'error';

export interface OutputLastRender {
  outputPath: string;
  bytes?: number;
  renderedAt: string;
}

export interface ProjectOutput {
  id: string;
  name: string;
  functionId: string;
  recipeId: string;
  clipStart: string;
  clipDuration: string;
  selectedMomentId: string | null;
  selectedPromoDirectionId: string | null;
  status: OutputStatus;
  lastRender: OutputLastRender | null;
  createdAt: string;
  updatedAt: string;
}

// Reserved for Phase 2 (artist photos, extra images, references, logo). The
// field is persisted and migrated starting now so nothing has to change shape
// again later, but it is not wired to any UI yet — registering an asset here
// does not currently affect rendering.
export type ProjectAssetRole = 'cover' | 'artist-photo' | 'extra' | 'reference' | 'logo';
export interface ProjectAsset {
  id: string;
  role: ProjectAssetRole;
  path: string;
  label?: string;
}

export interface ReleaseProject {
  schemaVersion: 3;
  title: string;
  artist: string;
  audioPath: string | null;
  coverPath: string | null;
  outputDir: string | null;
  songAnalysis: SongAnalysis | null;
  assets: ProjectAsset[];
  outputs: ProjectOutput[];
  activeOutputId: string | null;
  updatedAt: string;
}

let outputIdCounter = 0;
export function makeOutputId(): string {
  outputIdCounter += 1;
  return `output-${Date.now().toString(36)}-${outputIdCounter}-${Math.random().toString(36).slice(2, 6)}`;
}

export function emptyOutput(functionId = 'make_canvas', recipeId = 'clean_canvas', defaultDurationSec = 6, name = 'Output'): ProjectOutput {
  const now = new Date().toISOString();
  return {
    id: makeOutputId(),
    name,
    functionId,
    recipeId,
    clipStart: '0:00',
    clipDuration: String(defaultDurationSec),
    selectedMomentId: null,
    selectedPromoDirectionId: null,
    status: 'draft',
    lastRender: null,
    createdAt: now,
    updatedAt: now,
  };
}

export function emptyReleaseProject(): ReleaseProject {
  return {
    schemaVersion: 3,
    title: '',
    artist: '',
    audioPath: null,
    coverPath: null,
    outputDir: null,
    songAnalysis: null,
    assets: [],
    outputs: [],
    activeOutputId: null,
    updatedAt: new Date().toISOString(),
  };
}

/** Merge a release project's shared inputs with ONE of its outputs into the
 * SongProject shape the renderer/editor/export/promo modules already expect. */
export function mergeProjectView(project: ReleaseProject, output: ProjectOutput): SongProject {
  return {
    schemaVersion: 2,
    title: project.title,
    artist: project.artist,
    audioPath: project.audioPath,
    coverPath: project.coverPath,
    outputDir: project.outputDir,
    functionId: output.functionId,
    recipeId: output.recipeId,
    clipStart: output.clipStart,
    clipDuration: output.clipDuration,
    selectedMomentId: output.selectedMomentId,
    songAnalysis: project.songAnalysis,
    selectedPromoDirectionId: output.selectedPromoDirectionId,
    updatedAt: project.updatedAt,
  };
}
