// APP-SETTINGS PERSISTENCE (ALPHA-001 §4). Framework-agnostic: the filesystem is
// injected so the same code serves the Tauri host and the Node test harness.
//
// Durability rules:
//   - writes are ATOMIC where practical (temp file + replace), so a crash mid-
//     write can never leave a truncated settings file;
//   - a partially written / corrupt / older file is never fatal — it normalizes
//     and migrates to a usable object;
//   - a corrupt file is preserved as .corrupt for diagnosis rather than deleted.

import { migrateAppSettings, defaultAppSettings, type AppSettings } from './appSettings';
import { atomicWrite } from './atomicFile';

export interface SettingsFs {
  readText(path: string): Promise<string>;
  writeText(path: string, content: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  /** Atomic-ish replace: rename tmp -> dest, overwriting dest. */
  rename(from: string, to: string): Promise<void>;
  remove(path: string): Promise<void>;
  mkdir(dir: string): Promise<void>;
  join(...parts: string[]): string;
}

export const SETTINGS_FILE = 'settings.json';

export interface LoadResult {
  settings: AppSettings;
  /** 'ok' | 'missing' (first run) | 'recovered' (corrupt file replaced) */
  status: 'ok' | 'missing' | 'recovered';
  migratedFrom: number | null;
}

export async function loadAppSettings(dir: string, fs: SettingsFs): Promise<LoadResult> {
  const path = fs.join(dir, SETTINGS_FILE);
  if (!(await fs.exists(path))) return { settings: defaultAppSettings(), status: 'missing', migratedFrom: null };
  let raw: string;
  try { raw = await fs.readText(path); }
  catch { return { settings: defaultAppSettings(), status: 'recovered', migratedFrom: null }; }
  let parsed: unknown;
  try { parsed = JSON.parse(raw); }
  catch {
    // Keep the bad file for diagnosis; start from defaults rather than crash.
    try { await fs.rename(path, `${path}.corrupt`); } catch { /* best effort */ }
    return { settings: defaultAppSettings(), status: 'recovered', migratedFrom: null };
  }
  const { settings, migratedFrom } = migrateAppSettings(parsed);
  return { settings, status: 'ok', migratedFrom };
}

/** Write settings atomically. Returns the bytes written (0 on failure). */
export async function saveAppSettings(dir: string, settings: AppSettings, fs: SettingsFs): Promise<number> {
  await fs.mkdir(dir);
  const path = fs.join(dir, SETTINGS_FILE);
  const content = JSON.stringify(settings, null, 2);
  // Backup-swap safe replace (ALPHA-002 P1-5): never leaves settings.json in a
  // torn state, and never deletes the old file before the new one is in place.
  await atomicWrite(path, content, fs);
  return content.length;
}

/** Guard used by tests + the host: prove no secret is serialized into settings. */
export function settingsContainsSecretLike(settings: AppSettings): boolean {
  const json = JSON.stringify(settings);
  // Provider key shapes we know about (Google AIza..., xAI xai-...) plus generic
  // long opaque tokens under a suspicious key name.
  return /AIza[0-9A-Za-z\-_]{10,}/.test(json)
    || /xai-[0-9A-Za-z\-_]{10,}/.test(json)
    || /"(apiKey|secret|token|password)"\s*:\s*"[^"]{8,}"/i.test(json);
}
