// AUTOSAVE + RECOVERY (ALPHA-001 §10). Real testers close the app unexpectedly;
// this is the local-first trust layer.
//
// Rules that matter:
//   - a user's explicit project file is NEVER overwritten with incomplete JSON
//     (autosave for an unsaved project goes to a clearly-marked recovery area);
//   - every write is atomic (temp + replace) so a crash cannot truncate a file;
//   - a small rolling set of snapshots survives, newest-first, corrupt ones are
//     skipped rather than fatal;
//   - pending provider jobs and accepted takes ride along inside the project
//     JSON, so recovery restores them;
//   - generated media on disk is NEVER deleted by recovery.
//
// Pure logic + an injected filesystem: the Node test harness and the Tauri host
// share this exact code.

export interface RecoveryFs {
  readText(path: string): Promise<string>;
  writeText(path: string, content: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  rename(from: string, to: string): Promise<void>;
  remove(path: string): Promise<void>;
  mkdir(dir: string): Promise<void>;
  /** File names (not full paths) directly inside `dir`. */
  list(dir: string): Promise<string[]>;
  join(...parts: string[]): string;
}

export const RECOVERY_DIR = 'recovery';
export const SESSION_MARKER = 'session.open';
export const MAX_SNAPSHOTS = 5;

// ── Debounce (§10: no disk write on every keystroke) ────────────────────────

export interface DebounceState {
  /** When the project last changed (ms epoch). */
  lastChangeAt: number | null;
  /** When the CURRENT dirty streak first became dirty (ms epoch). Reset to null
   * on write. Used so continuous typing still reaches MAX_DEFER_MS even before
   * the very first write of the session (P3). */
  firstDirtyAt: number | null;
  /** When we last wrote (ms epoch). */
  lastWriteAt: number | null;
  /** Whether a change is waiting to be written. */
  dirty: boolean;
}

export const DEBOUNCE_MS = 1500;
/** Never let unsaved work sit longer than this even under constant typing. */
export const MAX_DEFER_MS = 10_000;

export function emptyDebounceState(): DebounceState {
  return { lastChangeAt: null, firstDirtyAt: null, lastWriteAt: null, dirty: false };
}

export function markChanged(s: DebounceState, now: number): DebounceState {
  return { ...s, dirty: true, lastChangeAt: now, firstDirtyAt: s.dirty ? s.firstDirtyAt : now };
}

/** PURE: should we write right now? Writes when the edit has settled for
 * DEBOUNCE_MS, or when this dirty streak has been open for MAX_DEFER_MS straight
 * — the latter works even before the first write of the session. */
export function shouldWrite(s: DebounceState, now: number): boolean {
  if (!s.dirty || s.lastChangeAt === null) return false;
  const settled = now - s.lastChangeAt >= DEBOUNCE_MS;
  const deferredTooLong = s.firstDirtyAt !== null && now - s.firstDirtyAt >= MAX_DEFER_MS;
  return settled || deferredTooLong;
}

export function markWritten(s: DebounceState, now: number): DebounceState {
  return { ...s, dirty: false, firstDirtyAt: null, lastWriteAt: now };
}

// ── Atomic write ────────────────────────────────────────────────────────────
// Re-exported from the shared safe-replace module (ALPHA-002 P1-5): backup-swap
// so a crash mid-replace always leaves at least one valid copy. RecoveryFs
// satisfies AtomicFs.
export { atomicWrite } from './atomicFile';
import { atomicWrite } from './atomicFile';

// ── Snapshots ───────────────────────────────────────────────────────────────

/** Snapshot files sort lexicographically in the same order as chronologically,
 * because the counter is zero-padded. */
export function snapshotName(seq: number): string {
  return `snapshot-${String(seq).padStart(6, '0')}.json`;
}

export function snapshotSeq(name: string): number | null {
  const m = /^snapshot-(\d{6})\.json$/.exec(name);
  return m ? Number(m[1]) : null;
}

/** Newest-first list of snapshot file names in the recovery dir. */
export async function listSnapshots(dir: string, fs: RecoveryFs): Promise<string[]> {
  if (!(await fs.exists(dir))) return [];
  const names = (await fs.list(dir)).filter((n) => snapshotSeq(n) !== null);
  return names.sort((a, b) => (snapshotSeq(b)! - snapshotSeq(a)!));
}

/** Append a snapshot and prune to MAX_SNAPSHOTS (rolling window). */
export async function writeSnapshot(dir: string, projectJson: string, fs: RecoveryFs, keep = MAX_SNAPSHOTS): Promise<string> {
  await fs.mkdir(dir);
  const existing = await listSnapshots(dir, fs);
  const nextSeq = existing.length > 0 ? snapshotSeq(existing[0])! + 1 : 1;
  const name = snapshotName(nextSeq);
  await atomicWrite(fs.join(dir, name), projectJson, fs);
  // prune oldest beyond the window — never touches media, only JSON snapshots
  const after = await listSnapshots(dir, fs);
  for (const old of after.slice(keep)) {
    try { await fs.remove(fs.join(dir, old)); } catch { /* best effort */ }
  }
  return name;
}

export interface SnapshotLoad {
  /** Parsed project payload, or null when no valid snapshot exists. */
  value: unknown | null;
  /** The snapshot file used. */
  name: string | null;
  /** Snapshots that failed to parse and were skipped (kept on disk). */
  skippedCorrupt: string[];
}

/** Load the NEWEST VALID snapshot, skipping (but preserving) corrupt ones. */
export async function loadNewestValidSnapshot(dir: string, fs: RecoveryFs): Promise<SnapshotLoad> {
  const names = await listSnapshots(dir, fs);
  const skippedCorrupt: string[] = [];
  for (const name of names) {
    try {
      const raw = await fs.readText(fs.join(dir, name));
      const parsed = JSON.parse(raw);
      if (isPlausibleProject(parsed)) return { value: parsed, name, skippedCorrupt };
      skippedCorrupt.push(name);
    } catch {
      skippedCorrupt.push(name);
    }
  }
  return { value: null, name: null, skippedCorrupt };
}

/** A cheap structural sanity check — the full normalizer (normalizeReleaseProject)
 * still runs on load. This only rejects payloads that are obviously not a
 * project: truncated JSON, empty objects, garbage. It matches the REAL
 * ReleaseProject shape (schemaVersion + outputs), not a guessed one. */
export function isPlausibleProject(v: unknown): boolean {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return typeof o.schemaVersion === 'number' && Array.isArray(o.outputs);
}

// ── Unclean-shutdown detection ──────────────────────────────────────────────

/** Drop a marker at launch; clear it on a clean exit. A marker still present at
 * the next launch means the last session ended unexpectedly. */
export async function markSessionOpen(dir: string, fs: RecoveryFs, at: string): Promise<void> {
  await fs.mkdir(dir);
  await atomicWrite(fs.join(dir, SESSION_MARKER), JSON.stringify({ openedAt: at }), fs);
}
export async function markSessionClean(dir: string, fs: RecoveryFs): Promise<void> {
  try { await fs.remove(fs.join(dir, SESSION_MARKER)); } catch { /* already gone */ }
}
export async function wasUncleanShutdown(dir: string, fs: RecoveryFs): Promise<boolean> {
  return fs.exists(fs.join(dir, SESSION_MARKER));
}

// ── The launch decision (§10) ───────────────────────────────────────────────

export type RecoveryOffer =
  | { kind: 'none' }
  | { kind: 'reopen-last'; path: string }
  | { kind: 'recover'; reason: 'unclean-shutdown' | 'newer-recovery'; snapshotName: string; lastProjectPath: string | null };

export interface LaunchInputs {
  lastProjectPath: string | null;
  uncleanShutdown: boolean;
  newestSnapshot: string | null;
  /** True when the snapshot is newer than the saved project file on disk. */
  snapshotNewerThanFile: boolean;
}

/** PURE: what should the app offer at launch? Recovery always beats a plain
 * reopen, and we never auto-apply — the creator chooses. */
export function decideLaunchOffer(i: LaunchInputs): RecoveryOffer {
  if (i.newestSnapshot && (i.uncleanShutdown || i.snapshotNewerThanFile)) {
    return {
      kind: 'recover',
      reason: i.uncleanShutdown ? 'unclean-shutdown' : 'newer-recovery',
      snapshotName: i.newestSnapshot,
      lastProjectPath: i.lastProjectPath,
    };
  }
  if (i.lastProjectPath) return { kind: 'reopen-last', path: i.lastProjectPath };
  return { kind: 'none' };
}

// ── Autosave target (§10: never fake a permanent location) ──────────────────

export type SaveTarget =
  | { kind: 'user-file'; path: string }
  | { kind: 'recovery-only'; dir: string };

/** A project the creator has explicitly saved autosaves to ITS OWN file; one
 * that has never been saved autosaves only into the recovery area, so the UI can
 * honestly say "not saved to a file yet". */
export function autosaveTarget(explicitPath: string | null, recoveryDir: string): SaveTarget {
  return explicitPath ? { kind: 'user-file', path: explicitPath } : { kind: 'recovery-only', dir: recoveryDir };
}
