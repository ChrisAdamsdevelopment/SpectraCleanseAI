// ALPHA-001 §14 — updater lifecycle against a MOCK port: no update, update
// available, signature failure, download failure, install ready, restart blocked
// by active work. No published release required.
// Run: npm run updater:test

import assert from 'node:assert/strict';
import {
  initialUpdaterState, checkForUpdate, downloadUpdate, restartIntoUpdate,
  maybeStartupCheck, mapUpdaterError, isBusy, busyReason, type UpdaterPort, type UpdateInfo,
} from './updater';

const V = '0.1.0-alpha.1';
const NEXT: UpdateInfo = { version: '0.1.0-alpha.2', notes: 'Fixes scene polling.', date: '2026-07-12T00:00:00Z' };
const IDLE = { generating: false, rendering: false };

function port(over: Partial<UpdaterPort> = {}): UpdaterPort {
  return {
    async check() { return null; },
    async downloadAndInstall() { /* ok */ },
    async relaunch() { /* ok */ },
    ...over,
  };
}

// ── No update available ────────────────────────────────────────────────────
{
  const s = await checkForUpdate(initialUpdaterState(V), port(), '2026-07-12T10:00:00Z');
  assert.equal(s.status, 'up-to-date');
  assert.equal(s.available, null);
  assert.match(s.message, /up to date/i, 'plain language');
  assert.equal(s.lastCheckedAt, '2026-07-12T10:00:00Z', 'check time recorded');
}

// ── Update available ───────────────────────────────────────────────────────
{
  const s = await checkForUpdate(initialUpdaterState(V), port({ async check() { return NEXT; } }), '2026-07-12T10:00:00Z');
  assert.equal(s.status, 'available');
  assert.equal(s.available!.version, '0.1.0-alpha.2', 'available version shown');
  assert.equal(s.currentVersion, V, 'current version shown alongside');
  assert.equal(s.available!.notes, 'Fixes scene polling.', 'release notes carried');
}

// ── Check failure is safe ─────────────────────────────────────────────────
{
  const s = await checkForUpdate(initialUpdaterState(V), port({ async check() { throw new Error('network timeout'); } }), 't');
  assert.equal(s.status, 'error');
  assert.match(s.message, /internet connection/i, 'network problem explained in plain language');
  assert.match(s.message, /untouched/i, 'and reassures the install is safe');
  assert.ok(!/stack|Error:/i.test(s.message), 'no raw error as the user-facing message');
}

// ── Download → install ready, with progress ───────────────────────────────
{
  let s = await checkForUpdate(initialUpdaterState(V), port({ async check() { return NEXT; } }), 't');
  const seen: number[] = [];
  s = await downloadUpdate(s, port({
    async check() { return NEXT; },
    async downloadAndInstall(onProgress) { onProgress(0.25); onProgress(0.5); onProgress(1); },
  }), (mid) => seen.push(mid.progress));
  assert.equal(s.status, 'ready-to-restart');
  assert.equal(s.progress, 1);
  assert.match(s.message, /Restart to start using it/i);
  assert.deepEqual(seen.filter((n) => n > 0), [0.25, 0.5, 1], 'progress reported to the UI');
}

// ── Signature failure: NOT installed, current version safe ────────────────
{
  let s = await checkForUpdate(initialUpdaterState(V), port({ async check() { return NEXT; } }), 't');
  s = await downloadUpdate(s, port({
    async check() { return NEXT; },
    async downloadAndInstall() { throw new Error('failed to verify signature: minisign mismatch'); },
  }), () => {});
  assert.equal(s.status, 'error');
  assert.match(s.message, /security check/i, 'signature failure explained');
  assert.match(s.message, /NOT installed/i, 'explicitly says it was not installed');
  assert.match(s.message, /untouched/i, 'current version preserved');
  assert.equal(s.progress, 0, 'progress reset');
  assert.equal(mapUpdaterError(new Error('signature verification failed')).includes('security check'), true);
}

// ── Download failure ──────────────────────────────────────────────────────
{
  let s = await checkForUpdate(initialUpdaterState(V), port({ async check() { return NEXT; } }), 't');
  s = await downloadUpdate(s, port({
    async check() { return NEXT; },
    async downloadAndInstall() { throw new Error('connect ETIMEDOUT'); },
  }), () => {});
  assert.equal(s.status, 'error');
  assert.match(s.message, /internet connection/i);
  assert.match(s.message, /untouched/i, 'a failed download never corrupts the install');
}

// ── Download with nothing available is refused ───────────────────────────
{
  const s = await downloadUpdate(initialUpdaterState(V), port(), () => {});
  assert.equal(s.status, 'error');
  assert.match(s.message, /no update to download/i);
}

// ── Restart blocked by active work (§3: never interrupt generation) ───────
{
  let s = await checkForUpdate(initialUpdaterState(V), port({ async check() { return NEXT; } }), 't');
  s = await downloadUpdate(s, port({ async check() { return NEXT; }, async downloadAndInstall() {} }), () => {});
  assert.equal(s.status, 'ready-to-restart');

  let relaunched = false;
  const p = port({ async relaunch() { relaunched = true; } });

  const blockedGen = await restartIntoUpdate(s, p, { generating: true, rendering: false });
  assert.equal(blockedGen.status, 'restart-deferred', 'does not restart mid-generation');
  assert.equal(relaunched, false, 'relaunch NOT called');
  assert.match(blockedGen.message, /still generating/i);
  assert.match(blockedGen.message, /not interrupted/i);

  const blockedRender = await restartIntoUpdate(s, p, { generating: false, rendering: true });
  assert.equal(blockedRender.status, 'restart-deferred');
  assert.match(blockedRender.message, /render is still running/i);

  // Once idle, it restarts.
  const ok = await restartIntoUpdate(s, p, IDLE);
  assert.equal(relaunched, true, 'relaunch called when idle');
  assert.match(ok.message, /Restarting/i);
}

// ── Restart with nothing installed is refused ────────────────────────────
{
  const s = await restartIntoUpdate(initialUpdaterState(V), port(), IDLE);
  assert.equal(s.status, 'error');
  assert.match(s.message, /no installed update/i);
}

// ── Relaunch failure is handled ──────────────────────────────────────────
{
  let s = await checkForUpdate(initialUpdaterState(V), port({ async check() { return NEXT; } }), 't');
  s = await downloadUpdate(s, port({ async check() { return NEXT; }, async downloadAndInstall() {} }), () => {});
  const failed = await restartIntoUpdate(s, port({ async relaunch() { throw new Error('permission denied'); } }), IDLE);
  assert.equal(failed.status, 'error');
  assert.match(failed.message, /blocked the update/i);
}

// ── Busy helpers ─────────────────────────────────────────────────────────
{
  assert.equal(isBusy(IDLE), false);
  assert.equal(isBusy({ generating: true, rendering: false }), true);
  assert.equal(busyReason({ generating: true, rendering: true }), 'a scene is generating and a render is running');
  assert.equal(busyReason(IDLE), '');
}

// ── Startup check never blocks and honors the preference ────────────────
{
  assert.equal(await maybeStartupCheck(initialUpdaterState(V), port(), false, 't'), null, 'auto-check off → no check at all');
  const s = await maybeStartupCheck(initialUpdaterState(V), port({ async check() { return NEXT; } }), true, 't');
  assert.equal(s!.status, 'available', 'auto-check on → checks in the background');
}

console.log('[updater] PASS — no-update, update-available (version + notes), check/download/relaunch failures mapped to plain language with the install left untouched, signature failure explicitly not installed, progress reporting, restart deferred during generation/render, startup check optional and non-blocking.');
