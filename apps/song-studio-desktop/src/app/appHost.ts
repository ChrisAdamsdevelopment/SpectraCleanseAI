// TAURI HOST for the ALPHA-001 app systems (settings, secure store, recovery,
// updater, diagnostics, health). Every pure module above takes an injected port;
// this file is the only place that touches Tauri APIs, so the Node test harness
// never needs them.

import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import { appDataDir } from '@tauri-apps/api/path';
import { writeTextFile, readTextFile, mkdir, exists, remove, rename, readDir } from '@tauri-apps/plugin-fs';
import type { SettingsFs } from './settingsStore';
import type { RecoveryFs } from './recovery';
import type { SecureStore } from './secureStore';
import type { UpdaterPort, UpdateInfo } from './updater';

export const IS_TAURI = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in (window as object);

/** Join path segments with forward slashes (Tauri's fs accepts them on Windows). */
const join = (...parts: string[]) => parts.filter(Boolean).join('/').replace(/\/+/g, '/');

// ── Filesystem ports ───────────────────────────────────────────────────────

export const tauriSettingsFs: SettingsFs = {
  async readText(p) { return readTextFile(p); },
  async writeText(p, c) { await writeTextFile(p, c); },
  async exists(p) { try { return await exists(p); } catch { return false; } },
  async rename(a, b) {
    // PLAIN rename — NEVER delete the destination first (ALPHA-002 P1-5). The
    // shared atomicWrite() backup-swap guarantees `b` does not exist when this
    // is called, so a plain rename is safe on every platform and there is no
    // window in which the user's file could be deleted.
    await rename(a, b);
  },
  async remove(p) { try { await remove(p); } catch { /* already gone */ } },
  async mkdir(d) { try { await mkdir(d, { recursive: true }); } catch { /* exists */ } },
  join,
};

export const tauriRecoveryFs: RecoveryFs = {
  ...tauriSettingsFs,
  async list(dir) {
    try { return (await readDir(dir)).filter((e) => e.isFile).map((e) => e.name); }
    catch { return []; }
  },
};

/** The app-data directory Tauri gives us (per-user, writable, survives updates). */
export async function appDir(): Promise<string> {
  return appDataDir();
}

// ── Secure store over the OS credential manager (Rust `keyring`) ────────────

export const tauriSecureStore: SecureStore = {
  async set(providerId, secret) { await invoke('secure_set', { providerId, secret }); },
  async get(providerId) { return (await invoke<string | null>('secure_get', { providerId })) ?? null; },
  async remove(providerId) { await invoke('secure_remove', { providerId }); },
  async available() { try { return await invoke<boolean>('secure_available'); } catch { return false; } },
};

/** Null when the platform vault is unusable — the UI then offers session-only. */
export async function resolveSecureStore(): Promise<SecureStore | null> {
  if (!IS_TAURI) return null;
  try { return (await tauriSecureStore.available()) ? tauriSecureStore : null; }
  catch { return null; }
}

// ── Startup health (§1) ────────────────────────────────────────────────────

export interface HealthReport {
  appVersion: string;
  installedBuild: boolean;
  targetTriple: string;
  appDataDir: string;
  appDataOk: boolean;
  ffmpeg: { found: boolean; source: string; path: string };
  secureStore: boolean;
  webview: boolean;
}

export async function healthCheck(): Promise<HealthReport | null> {
  if (!IS_TAURI) return null;
  try { return await invoke<HealthReport>('health_check'); } catch { return null; }
}

/** Plain-language recovery text for a failed health check (§1). Empty = healthy. */
export function healthProblems(h: HealthReport | null): string[] {
  if (!h) return [];
  const out: string[] = [];
  if (!h.appDataOk) {
    out.push('Song Studio cannot write to its own settings folder. Your preferences and recovery snapshots will not be saved. This usually means antivirus or a policy is blocking it — try reinstalling, or contact whoever manages this computer.');
  }
  if (!h.ffmpeg.found) {
    out.push(h.installedBuild
      ? 'The bundled video engine is missing, so Song Studio cannot render or assemble video. This installation looks incomplete — please reinstall from the original download.'
      : 'FFmpeg was not found. In a dev checkout, run `npm install` inside apps/song-studio-desktop.');
  }
  if (!h.secureStore) {
    out.push('Windows Credential Manager is not available, so keys cannot be remembered securely. You can still connect a provider using "this session only".');
  }
  return out;
}

// ── Updater port over the official Tauri plugin (§3) ────────────────────────
// Imported lazily so a browser/dev run without the plugin never crashes at load.

export function createTauriUpdaterPort(): UpdaterPort {
  return {
    async check(): Promise<UpdateInfo | null> {
      const { check } = await import('@tauri-apps/plugin-updater');
      const update = await check();
      if (!update) return null;
      return { version: update.version, notes: update.body ?? 'No release notes were provided.', date: update.date ?? null };
    },
    async downloadAndInstall(onProgress) {
      const { check } = await import('@tauri-apps/plugin-updater');
      const update = await check();
      if (!update) throw new Error('no update available');
      let total = 0; let got = 0;
      // The plugin verifies the minisign signature against the configured
      // pubkey during this call; a bad signature rejects here.
      await update.downloadAndInstall((e) => {
        if (e.event === 'Started') { total = e.data.contentLength ?? 0; onProgress(0); }
        else if (e.event === 'Progress') { got += e.data.chunkLength ?? 0; if (total > 0) onProgress(got / total); }
        else if (e.event === 'Finished') onProgress(1);
      });
    },
    async relaunch() {
      const { relaunch } = await import('@tauri-apps/plugin-process');
      await relaunch();
    },
  };
}

/** A port that reports "no update" — used in the browser/dev shell so the UI is
 * honest instead of throwing. */
export const unavailableUpdaterPort: UpdaterPort = {
  async check() { return null; },
  async downloadAndInstall() { throw new Error('Updates need the installed desktop app.'); },
  async relaunch() { throw new Error('Updates need the installed desktop app.'); },
};

// ── Diagnostics writing (§11) ──────────────────────────────────────────────

/** Write the diagnostics files into a folder the creator picked. Returns the
 * folder path. A real ZIP needs an archiver dependency we deliberately did not
 * add for the alpha — the folder is clearly organized and self-describing. */
export async function writeDiagnostics(destDir: string, files: Array<{ relPath: string; content: string }>): Promise<string> {
  await tauriSettingsFs.mkdir(destDir);
  for (const f of files) await tauriSettingsFs.writeText(join(destDir, f.relPath), f.content);
  return destDir;
}

export function toSrc(path: string): string | null {
  try { return path ? convertFileSrc(path) : null; } catch { return null; }
}
