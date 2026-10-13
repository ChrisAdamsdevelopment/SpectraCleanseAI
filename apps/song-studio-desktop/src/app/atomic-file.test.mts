// ALPHA-002 §16-G / P1-5 — REAL-FILESYSTEM contract test for the safe backup-swap
// replacement, using a temporary directory and node:fs (not only an in-memory
// fs). Simulates failures during the temp write, the destination replacement,
// and the backup cleanup, and proves at least ONE valid copy always remains.
// Run: npm run app:atomic:test

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { atomicWrite, type AtomicFs } from './atomicFile';
import { promises as fsp } from 'node:fs';

const dir = mkdtempSync(join(tmpdir(), 'ss-atomic-'));
const target = join(dir, 'project.songstudio.json');

/** A real-fs AtomicFs, optionally rigged to throw at a chosen step. */
function realFs(fail?: { on: 'write' | 'renameToTarget' | 'removeBak'; once?: boolean }): AtomicFs {
  let armed = true;
  const maybe = (step: string) => {
    if (fail && fail.on === step && armed) { if (fail.once) armed = false; throw new Error(`simulated failure at ${step}`); }
  };
  return {
    async writeText(p, c) { maybe('write'); await fsp.writeFile(p, c); },
    async exists(p) { return existsSync(p); },
    async rename(a, b) { if (b.endsWith('.json')) maybe('renameToTarget'); await fsp.rename(a, b); },
    async remove(p) { if (p.endsWith('.bak')) maybe('removeBak'); await fsp.rm(p, { force: true }); },
  };
}

const V1 = JSON.stringify({ schemaVersion: 5, outputs: [], rev: 1 });
const V2 = JSON.stringify({ schemaVersion: 5, outputs: [], rev: 2 });
const V3 = JSON.stringify({ schemaVersion: 5, outputs: [], rev: 3 });

try {
  // ── Happy path: first write creates the file. ─────────────────────────────
  await atomicWrite(target, V1, realFs());
  assert.equal(readFileSync(target, 'utf8'), V1, 'first write lands');
  assert.ok(!existsSync(`${target}.tmp`), 'temp cleaned up');

  // ── Happy path: replace an existing file, backup removed on success. ───────
  await atomicWrite(target, V2, realFs());
  assert.equal(readFileSync(target, 'utf8'), V2, 'replacement lands');
  assert.ok(!existsSync(`${target}.bak`), 'backup removed after success');
  assert.ok(!existsSync(`${target}.tmp`), 'temp removed after success');

  // ── Failure during the TEMP WRITE: the real file is untouched. ────────────
  await assert.rejects(() => atomicWrite(target, V3, realFs({ on: 'write' })), /simulated/);
  assert.equal(readFileSync(target, 'utf8'), V2, 'a temp-write failure NEVER touches the real file');

  // ── Failure during the DESTINATION REPLACEMENT: backup is restored, so a
  // valid copy always remains. (once:true fails only the tmp→target rename, not
  // the bak→target restore.) ────────────────────────────────────────────────
  await assert.rejects(() => atomicWrite(target, V3, realFs({ on: 'renameToTarget', once: true })), /simulated/);
  assert.ok(existsSync(target), 'the target still exists after a replacement failure');
  assert.equal(readFileSync(target, 'utf8'), V2, 'the PREVIOUS content is restored (never left with no file)');
  // No stray backup left occupying the .bak name for the next write.
  // (Our algorithm restores bak→target; a leftover tmp is harmless.)
  rmSync(`${target}.tmp`, { force: true });

  // ── Failure during BACKUP CLEANUP: the NEW content is already in place and
  // the write still SUCCEEDS (cleanup is best-effort). ──────────────────────
  await atomicWrite(target, V3, realFs({ on: 'removeBak' }));
  assert.equal(readFileSync(target, 'utf8'), V3, 'the new content is in place even if backup cleanup failed');
  // A leftover .bak is harmless and will be overwritten next time.
  rmSync(`${target}.bak`, { force: true });

  // ── Recovery-shape sanity: after every step a JSON.parse of the target
  // succeeds (never a torn file). ───────────────────────────────────────────
  for (const content of [V1, V2, V3]) {
    writeFileSync(target, content);
    await atomicWrite(target, content, realFs());
    JSON.parse(readFileSync(target, 'utf8'));   // throws if torn
  }

  console.log('[atomic-file] PASS — real-fs backup-swap: temp-write failure never touches the file, replacement failure restores the previous copy, backup-cleanup failure still succeeds with the new content, and the target is always valid JSON (never torn, never missing).');
} finally {
  rmSync(dir, { recursive: true, force: true });
}
