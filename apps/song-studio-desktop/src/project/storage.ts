import { open, save } from '@tauri-apps/plugin-dialog';
import { writeTextFile, readTextFile } from '@tauri-apps/plugin-fs';
import { emptyProject, type SongAnalysis, type SongMoment, type SongProject } from './types';

// Allowed input formats for v1 (LIMITED — broader support is planned).
export const AUDIO_EXTENSIONS = ['mp3', 'wav', 'm4a', 'aac', 'flac'];
export const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp'];


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

export function normalizeProject(value: unknown): SongProject {
  const base = emptyProject();
  if (!isRecord(value)) return base;
  const merged: SongProject = { ...base, ...(value as Partial<SongProject>) };
  const songAnalysis = normalizeAnalysis(value.songAnalysis);
  const selectedMomentId = typeof value.selectedMomentId === 'string' && songAnalysis?.moments.some((m) => m.id === value.selectedMomentId) ? value.selectedMomentId : null;
  return {
    ...merged,
    schemaVersion: 2,
    audioPath: typeof value.audioPath === 'string' ? value.audioPath : null,
    coverPath: typeof value.coverPath === 'string' ? value.coverPath : null,
    outputDir: typeof value.outputDir === 'string' ? value.outputDir : null,
    selectedMomentId,
    songAnalysis: songAnalysis ? { ...songAnalysis, selectedMomentId } : null,
    selectedPromoDirectionId: typeof value.selectedPromoDirectionId === 'string' ? value.selectedPromoDirectionId : null,
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

export async function saveProjectToFile(project: SongProject): Promise<string | null> {
  const target = await save({
    defaultPath: `${(project.title || 'song').replace(/[^a-z0-9-_ ]/gi, '_') || 'song'}.songstudio.json`,
    filters: [{ name: 'Song Studio Project', extensions: ['json'] }],
  });
  if (!target) return null;
  const payload: SongProject = { ...project, updatedAt: new Date().toISOString() };
  await writeTextFile(target, JSON.stringify(payload, null, 2));
  return target;
}

export async function loadProjectFromFile(): Promise<SongProject | null> {
  const selected = await open({
    multiple: false,
    directory: false,
    filters: [{ name: 'Song Studio Project', extensions: ['json'] }],
  });
  if (typeof selected !== 'string') return null;
  const text = await readTextFile(selected);
  return normalizeProject(JSON.parse(text));
}
