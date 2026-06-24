import { open, save } from '@tauri-apps/plugin-dialog';
import { writeTextFile, readTextFile } from '@tauri-apps/plugin-fs';
import type { SongProject } from './types';

// Allowed input formats for v1 (LIMITED — broader support is planned).
export const AUDIO_EXTENSIONS = ['mp3', 'wav', 'm4a', 'aac', 'flac'];
export const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp'];

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
  return JSON.parse(text) as SongProject;
}
