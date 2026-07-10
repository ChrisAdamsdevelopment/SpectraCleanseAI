import { open, save } from '@tauri-apps/plugin-dialog';
import { writeTextFile, readTextFile } from '@tauri-apps/plugin-fs';
import { parseTime } from '../lib/time';
import {
  defaultLoopCore, emptyOutput, emptyReleaseProject, isLoopOutputType, makeOutputId,
  type DirectionCue, type LoopAnchorPoint, type LoopContinuityMode, type LoopCore, type LoopVisualStateMarker,
  type OutputLastRender, type OutputStatus, type ProjectAsset, type ProjectAssetRole, type ProjectOutput,
  type ReleaseProject, type SongAnalysis, type SongMoment,
} from './types';

// Allowed input formats for v1 (LIMITED — broader support is planned).
export const AUDIO_EXTENSIONS = ['mp3', 'wav', 'm4a', 'aac', 'flac'];
export const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp'];
export const CANVAS_VIDEO_EXTENSIONS = ['mp4', 'mov', 'm4v', 'webm'];


function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function normalizeMoment(value: unknown): SongMoment | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== 'string' || typeof value.label !== 'string') return null;
  if (typeof value.startSec !== 'number' || typeof value.durationSec !== 'number') return null;
  const endSec = typeof value.endSec === 'number' ? value.endSec : value.startSec + value.durationSec;
  return {
    id: value.id,
    label: value.label,
    startSec: value.startSec,
    durationSec: value.durationSec,
    endSec,
    confidence: typeof value.confidence === 'number' ? value.confidence : 0,
    reason: typeof value.reason === 'string' ? value.reason : '',
    kind: value.kind === 'teaser' || value.kind === 'early' || value.kind === 'middle' || value.kind === 'promo' || value.kind === 'manual' ? value.kind : 'manual',
    source: value.source === 'manual' ? 'manual' : 'duration-heuristic',
  };
}

function normalizeAnalysis(value: unknown): SongAnalysis | null {
  if (!isRecord(value)) return null;
  if (typeof value.audioPath !== 'string' || typeof value.durationSec !== 'number') return null;
  const moments = Array.isArray(value.moments) ? value.moments.map(normalizeMoment).filter((m): m is SongMoment => Boolean(m)) : [];
  const selectedMomentId = typeof value.selectedMomentId === 'string' && moments.some((m) => m.id === value.selectedMomentId) ? value.selectedMomentId : null;
  return {
    audioPath: value.audioPath,
    analyzedAt: typeof value.analyzedAt === 'string' ? value.analyzedAt : new Date().toISOString(),
    durationSec: value.durationSec,
    moments,
    selectedMomentId,
  };
}

// Legacy single-output project (schemaVersion 2 and earlier/unversioned) had
// no friendly output name; give the migrated output a readable one.
const LEGACY_FUNCTION_LABELS: Record<string, string> = {
  make_canvas: 'Release card',
  make_hook_promo: 'Music promo',
  make_visualizer: 'Visualizer',
};

function normalizeOutputStatus(value: unknown): OutputStatus {
  return value === 'rendered' || value === 'error' ? value : 'draft';
}

function normalizeLastRender(value: unknown): OutputLastRender | null {
  if (!isRecord(value) || typeof value.outputPath !== 'string') return null;
  return {
    outputPath: value.outputPath,
    bytes: typeof value.bytes === 'number' ? value.bytes : undefined,
    renderedAt: typeof value.renderedAt === 'string' ? value.renderedAt : new Date().toISOString(),
  };
}

function normalizeAnchorPoint(value: unknown): LoopAnchorPoint | null {
  if (!isRecord(value) || typeof value.timeSec !== 'number' || typeof value.label !== 'string') return null;
  return { id: typeof value.id === 'string' && value.id ? value.id : makeOutputId(), timeSec: value.timeSec, label: value.label };
}

function normalizeVisualStateMarker(value: unknown): LoopVisualStateMarker | null {
  if (!isRecord(value) || typeof value.timeSec !== 'number' || typeof value.label !== 'string') return null;
  return { id: typeof value.id === 'string' && value.id ? value.id : makeOutputId(), timeSec: value.timeSec, label: value.label };
}

// UX-005: loopCore is optional/nullable, so files saved before this change
// load unaffected — a missing or invalid loopCore just normalizes to a fresh
// default (loop-type outputs) or null (non-loop outputs). clipDuration is the
// authoritative persisted duration; loopDurationSec is normalized to that same
// value so older/scratch files cannot silently disagree with what will render.
function normalizeLoopCore(value: unknown, functionId: string, fallbackDurationSec: number): LoopCore | null {
  if (isRecord(value)) {
    const loopDurationSec = fallbackDurationSec;
    const anchorPoints = Array.isArray(value.anchorPoints) ? value.anchorPoints.map(normalizeAnchorPoint).filter((a): a is LoopAnchorPoint => Boolean(a)) : [];
    const continuityMode: LoopContinuityMode = value.continuityMode === 'soft-loop' ? 'soft-loop' : 'hard-loop';
    const motionIntensity = typeof value.motionIntensity === 'number' ? Math.min(1, Math.max(0, value.motionIntensity)) : 0.5;
    const visualStateMarkers = Array.isArray(value.visualStateMarkers) ? value.visualStateMarkers.map(normalizeVisualStateMarker).filter((m): m is LoopVisualStateMarker => Boolean(m)) : undefined;
    return { loopDurationSec, anchorPoints, continuityMode, motionIntensity, visualStateMarkers };
  }
  return isLoopOutputType(functionId) ? defaultLoopCore(fallbackDurationSec) : null;
}

function normalizeOutput(value: unknown): ProjectOutput | null {
  if (!isRecord(value)) return null;
  const now = new Date().toISOString();
  const functionId = typeof value.functionId === 'string' ? value.functionId : 'make_canvas';
  const clipDuration = typeof value.clipDuration === 'string' ? value.clipDuration : '6';
  return {
    id: typeof value.id === 'string' && value.id ? value.id : makeOutputId(),
    name: typeof value.name === 'string' && value.name ? value.name : 'Output',
    functionId,
    recipeId: typeof value.recipeId === 'string' ? value.recipeId : 'clean_canvas',
    clipStart: typeof value.clipStart === 'string' ? value.clipStart : '0:00',
    clipDuration,
    selectedMomentId: typeof value.selectedMomentId === 'string' ? value.selectedMomentId : null,
    selectedPromoDirectionId: typeof value.selectedPromoDirectionId === 'string' ? value.selectedPromoDirectionId : null,
    status: normalizeOutputStatus(value.status),
    lastRender: normalizeLastRender(value.lastRender),
    renderRevision: typeof value.renderRevision === 'number' && Number.isFinite(value.renderRevision) ? Math.max(0, Math.floor(value.renderRevision)) : 0,
    createdAt: typeof value.createdAt === 'string' ? value.createdAt : now,
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : now,
    loopCore: normalizeLoopCore(value.loopCore, functionId, parseTime(clipDuration) ?? 6),
  };
}

function normalizeAsset(value: unknown): ProjectAsset | null {
  if (!isRecord(value) || typeof value.path !== 'string') return null;
  const role: ProjectAssetRole = value.role === 'artist-photo' || value.role === 'extra' || value.role === 'reference' || value.role === 'logo' ? value.role : 'cover';
  return { id: typeof value.id === 'string' && value.id ? value.id : makeOutputId(), role, path: value.path, label: typeof value.label === 'string' ? value.label : undefined };
}

// VIDEO-002: a direction cue is dropped unless it has a positive-length
// song-relative span AND still references an existing artist-photo asset — so
// removing an asset (or a cue targeting a non-artist-photo role) can never leave
// a dangling/invalid direction, and old projects (no directionCues) normalize to
// an empty list. The artist-photo-only invariant is enforced here, not just in
// the UI. v1 keeps at most one active cue.
function normalizeDirectionCue(value: unknown, artistPhotoIds: Set<string>): DirectionCue | null {
  if (!isRecord(value)) return null;
  if (typeof value.assetId !== 'string' || !artistPhotoIds.has(value.assetId)) return null;
  if (typeof value.startSec !== 'number' || typeof value.endSec !== 'number') return null;
  if (!(value.endSec > value.startSec)) return null;
  return {
    id: typeof value.id === 'string' && value.id ? value.id : makeOutputId(),
    assetId: value.assetId,
    startSec: value.startSec,
    endSec: value.endSec,
  };
}

function normalizeDirectionCues(value: unknown, assets: ProjectAsset[]): DirectionCue[] {
  if (!Array.isArray(value)) return [];
  const artistPhotoIds = new Set(assets.filter((a) => a.role === 'artist-photo').map((a) => a.id));
  return value.map((v) => normalizeDirectionCue(v, artistPhotoIds)).filter((c): c is DirectionCue => Boolean(c)).slice(0, 1);
}

/**
 * Normalize any saved Song Studio project file into a ReleaseProject.
 *
 * Handles two shapes: a current release project (has an `outputs` array), or
 * a legacy single-output project (schemaVersion 2 and earlier), which is
 * migrated into a release project with exactly one output carrying over every
 * selection it had. The legacy shape never recorded render history, so the
 * migrated output honestly starts as 'draft' rather than fabricating one.
 */
export function normalizeReleaseProject(value: unknown): ReleaseProject {
  const base = emptyReleaseProject();
  if (!isRecord(value)) return base;

  const songAnalysis = normalizeAnalysis(value.songAnalysis);
  const shared = {
    title: typeof value.title === 'string' ? value.title : '',
    artist: typeof value.artist === 'string' ? value.artist : '',
    audioPath: typeof value.audioPath === 'string' ? value.audioPath : null,
    coverPath: typeof value.coverPath === 'string' ? value.coverPath : null,
    outputDir: typeof value.outputDir === 'string' ? value.outputDir : null,
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : base.updatedAt,
  };

  if (Array.isArray(value.outputs)) {
    const normalized = value.outputs.map(normalizeOutput).filter((o): o is ProjectOutput => Boolean(o));
    const outputs = normalized.length > 0 ? normalized : [emptyOutput()];
    const activeOutputId = typeof value.activeOutputId === 'string' && outputs.some((o) => o.id === value.activeOutputId) ? value.activeOutputId : outputs[0].id;
    const assets = Array.isArray(value.assets) ? value.assets.map(normalizeAsset).filter((a): a is ProjectAsset => Boolean(a)) : [];
    const directionCues = normalizeDirectionCues(value.directionCues, assets);
    return { ...base, ...shared, songAnalysis, assets, directionCues, outputs, activeOutputId };
  }

  // Legacy single-output shape — migrate into one output.
  const functionId = typeof value.functionId === 'string' ? value.functionId : 'make_canvas';
  const recipeId = typeof value.recipeId === 'string' ? value.recipeId : 'clean_canvas';
  const clipDuration = typeof value.clipDuration === 'string' ? value.clipDuration : '6';
  const selectedMomentId = typeof value.selectedMomentId === 'string' && songAnalysis?.moments.some((m) => m.id === value.selectedMomentId) ? value.selectedMomentId : null;
  // Pass the REAL migrated duration into emptyOutput so loopCore.loopDurationSec
  // (if this is a loop-type output) is derived from it, not a placeholder.
  const migratedOutput: ProjectOutput = {
    ...emptyOutput(functionId, recipeId, parseTime(clipDuration) ?? 6, LEGACY_FUNCTION_LABELS[functionId] ?? 'Output'),
    clipStart: typeof value.clipStart === 'string' ? value.clipStart : '0:00',
    clipDuration,
    selectedMomentId,
    selectedPromoDirectionId: typeof value.selectedPromoDirectionId === 'string' ? value.selectedPromoDirectionId : null,
  };
  return {
    ...base,
    ...shared,
    songAnalysis: songAnalysis ? { ...songAnalysis, selectedMomentId } : null,
    assets: [],
    outputs: [migratedOutput],
    activeOutputId: migratedOutput.id,
  };
}

export async function pickAudioFile(): Promise<string | null> {
  const selected = await open({
    multiple: false,
    directory: false,
    filters: [{ name: 'Audio', extensions: AUDIO_EXTENSIONS }],
  });
  return typeof selected === 'string' ? selected : null;
}

export async function pickCoverImage(): Promise<string | null> {
  const selected = await open({
    multiple: false,
    directory: false,
    filters: [{ name: 'Image', extensions: IMAGE_EXTENSIONS }],
  });
  return typeof selected === 'string' ? selected : null;
}

export async function pickOutputDir(): Promise<string | null> {
  const selected = await open({ multiple: false, directory: true });
  return typeof selected === 'string' ? selected : null;
}

// VIDEO-002: pick an artist-photo asset to direct into the song. Same image
// formats as cover art; the caller registers it as a ProjectAsset.
export async function pickArtistPhoto(): Promise<string | null> {
  const selected = await open({
    multiple: false,
    directory: false,
    filters: [{ name: 'Artist photo', extensions: IMAGE_EXTENSIONS }],
  });
  return typeof selected === 'string' ? selected : null;
}

export async function pickCanvasSourceVideo(): Promise<string | null> {
  const selected = await open({
    multiple: false,
    directory: false,
    filters: [{ name: 'Canvas source video', extensions: CANVAS_VIDEO_EXTENSIONS }],
  });
  return typeof selected === 'string' ? selected : null;
}

export async function pickCanvasOutputDir(): Promise<string | null> {
  return pickOutputDir();
}

export async function saveReleaseProjectToFile(project: ReleaseProject): Promise<string | null> {
  const target = await save({
    defaultPath: `${(project.title || 'song').replace(/[^a-z0-9-_ ]/gi, '_') || 'song'}.songstudio.json`,
    filters: [{ name: 'Song Studio Project', extensions: ['json'] }],
  });
  if (!target) return null;
  const payload: ReleaseProject = { ...project, updatedAt: new Date().toISOString() };
  await writeTextFile(target, JSON.stringify(payload, null, 2));
  return target;
}

export async function loadReleaseProjectFromFile(): Promise<ReleaseProject | null> {
  const selected = await open({
    multiple: false,
    directory: false,
    filters: [{ name: 'Song Studio Project', extensions: ['json'] }],
  });
  if (typeof selected !== 'string') return null;
  const text = await readTextFile(selected);
  return normalizeReleaseProject(JSON.parse(text));
}
