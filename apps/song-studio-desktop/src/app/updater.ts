// IN-APP UPDATES (ALPHA-001 §3/§10). Test users must get new alpha builds
// without a terminal.
//
// The real implementation is the official Tauri updater plugin
// (@tauri-apps/plugin-updater + tauri-plugin-updater, verified 2026-07-12):
//   check() -> Update | null ; update.downloadAndInstall(onEvent) ; relaunch()
// This module is the TESTABLE seam around it: a small port interface the host
// implements over the plugin, and a pure state machine the UI drives. Tests use
// a mock port, so every branch (no update / available / signature failure /
// download failure / restart blocked) is exercised without a published release.
//
// Signature verification is NOT reimplemented here — the Tauri updater verifies
// the minisign signature against the configured `pubkey` before installing. A
// verification failure surfaces to us as a failed check/download.

export type UpdaterStatus =
  | 'idle'
  | 'checking'
  | 'up-to-date'
  | 'available'
  | 'downloading'
  | 'ready-to-restart'
  | 'restart-deferred'
  | 'error';

export interface UpdateInfo {
  version: string;
  notes: string;
  date: string | null;
}

export interface UpdaterState {
  status: UpdaterStatus;
  currentVersion: string;
  available: UpdateInfo | null;
  /** 0..1 while downloading. */
  progress: number;
  /** Plain-language message for the creator. Never a raw stack trace. */
  message: string;
  lastCheckedAt: string | null;
}

export function initialUpdaterState(currentVersion: string): UpdaterState {
  return { status: 'idle', currentVersion, available: null, progress: 0, message: '', lastCheckedAt: null };
}

/** The port the host implements over the Tauri updater plugin. */
export interface UpdaterPort {
  /** Returns the available update, or null when already current. */
  check(): Promise<UpdateInfo | null>;
  /** Download + verify + install. Signature failures reject. */
  downloadAndInstall(onProgress: (fraction: number) => void): Promise<void>;
  /** Restart into the newly installed version. */
  relaunch(): Promise<void>;
}

/** Why a restart may not happen right now (§3: never interrupt real work). */
export interface BusyState {
  generating: boolean;
  rendering: boolean;
}

export function isBusy(b: BusyState): boolean {
  return b.generating || b.rendering;
}

export function busyReason(b: BusyState): string {
  if (b.generating && b.rendering) return 'a scene is generating and a render is running';
  if (b.generating) return 'a scene is still generating';
  if (b.rendering) return 'a render is still running';
  return '';
}

// ── Error mapping: plain language, never a raw error string alone ───────────

export function mapUpdaterError(e: unknown): string {
  const raw = (e instanceof Error ? e.message : String(e)).toLowerCase();
  if (raw.includes('signature') || raw.includes('minisign') || raw.includes('verify')) {
    return 'This update failed its security check and was NOT installed. Your current version is untouched. Please report this — it may mean the download was tampered with or the release was signed incorrectly.';
  }
  if (raw.includes('network') || raw.includes('fetch') || raw.includes('dns') || raw.includes('timeout') || raw.includes('connect')) {
    return 'Song Studio could not reach the update server. Check your internet connection and try again — your current version is untouched.';
  }
  if (raw.includes('404') || raw.includes('not found')) {
    return 'No update manifest was found for this channel yet. Your current version is untouched.';
  }
  if (raw.includes('permission') || raw.includes('denied') || raw.includes('access')) {
    return 'Windows blocked the update from being written. Try reopening Song Studio, or reinstall from the latest download.';
  }
  return 'The update could not be completed. Your current version is untouched and safe to keep using.';
}

// ── Lifecycle actions (each returns the next state; all failures are safe) ───

export async function checkForUpdate(state: UpdaterState, port: UpdaterPort, at: string): Promise<UpdaterState> {
  const checking: UpdaterState = { ...state, status: 'checking', message: 'Checking for updates…' };
  try {
    const info = await port.check();
    if (!info) {
      return { ...checking, status: 'up-to-date', available: null, lastCheckedAt: at, message: `Song Studio ${state.currentVersion} is up to date.` };
    }
    return { ...checking, status: 'available', available: info, lastCheckedAt: at, message: `Song Studio ${info.version} is available.` };
  } catch (e) {
    return { ...checking, status: 'error', lastCheckedAt: at, message: mapUpdaterError(e) };
  }
}

/** Download + verify + install. The creator chooses when this runs (§3). */
export async function downloadUpdate(state: UpdaterState, port: UpdaterPort, onState: (s: UpdaterState) => void): Promise<UpdaterState> {
  if (!state.available) return { ...state, status: 'error', message: 'There is no update to download.' };
  let s: UpdaterState = { ...state, status: 'downloading', progress: 0, message: `Downloading Song Studio ${state.available.version}…` };
  onState(s);
  try {
    await port.downloadAndInstall((fraction) => {
      s = { ...s, progress: Math.max(0, Math.min(1, fraction)) };
      onState(s);
    });
    return { ...s, status: 'ready-to-restart', progress: 1, message: `Song Studio ${state.available.version} is installed. Restart to start using it.` };
  } catch (e) {
    // A failed download/verify NEVER corrupts the installed app.
    return { ...s, status: 'error', progress: 0, message: mapUpdaterError(e) };
  }
}

/** Restart into the new version — refused while real work is in flight. */
export async function restartIntoUpdate(state: UpdaterState, port: UpdaterPort, busy: BusyState): Promise<UpdaterState> {
  if (state.status !== 'ready-to-restart') return { ...state, status: 'error', message: 'There is no installed update waiting.' };
  if (isBusy(busy)) {
    return { ...state, status: 'restart-deferred', message: `Song Studio will restart when you are ready — ${busyReason(busy)}. Your work is not interrupted.` };
  }
  try {
    await port.relaunch();
    return { ...state, message: 'Restarting…' };
  } catch (e) {
    return { ...state, status: 'error', message: mapUpdaterError(e) };
  }
}

/** A startup check must never block launch (§3): the caller fires this without
 * awaiting it on the render path. Returns null when auto-check is off. */
export async function maybeStartupCheck(state: UpdaterState, port: UpdaterPort, autoCheck: boolean, at: string): Promise<UpdaterState | null> {
  if (!autoCheck) return null;
  return checkForUpdate(state, port, at);
}
