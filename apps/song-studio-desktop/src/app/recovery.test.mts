// ALPHA-001 §14 — autosave debounce, atomic replacement, rolling snapshots,
// corruption fallback, unclean-shutdown recovery, pending-job restoration.
// Run: npm run app:recovery:test

import assert from 'node:assert/strict';
import {
  emptyDebounceState, markChanged, markWritten, shouldWrite, DEBOUNCE_MS, MAX_DEFER_MS,
  atomicWrite, snapshotName, snapshotSeq, listSnapshots, writeSnapshot,
  loadNewestValidSnapshot, isPlausibleProject, markSessionOpen, markSessionClean,
  wasUncleanShutdown, decideLaunchOffer, autosaveTarget, MAX_SNAPSHOTS, RECOVERY_DIR,
  type RecoveryFs,
} from './recovery';

function memFs() {
  const files = new Map<string, string>();
  let failNextWrite = false;
  const fs: RecoveryFs & { files: Map<string, string>; crashNextWrite(): void } = {
    files,
    crashNextWrite() { failNextWrite = true; },
    async readText(p) { const v = files.get(p); if (v === undefined) throw new Error('ENOENT'); return v; },
    async writeText(p, c) { if (failNextWrite) { failNextWrite = false; throw new Error('crash'); } files.set(p, c); },
    async exists(p) { return files.has(p) || [...files.keys()].some((k) => k.startsWith(p + '/')); },
    async rename(a, b) { const v = files.get(a); if (v === undefined) throw new Error('ENOENT'); files.set(b, v); files.delete(a); },
    async remove(p) { files.delete(p); },
    async mkdir() { /* no-op */ },
    async list(dir) {
      const out: string[] = [];
      for (const k of files.keys()) {
        if (k.startsWith(dir + '/')) { const rest = k.slice(dir.length + 1); if (!rest.includes('/')) out.push(rest); }
      }
      return out;
    },
    join: (...parts) => parts.join('/'),
  };
  return fs;
}

const project = (n: number) => JSON.stringify({ schemaVersion: 5, title: 'Demo', outputs: [{ id: 'out-1' }], rev: n });

// ── Debounce: no disk write per keystroke ──────────────────────────────────
{
  let s = emptyDebounceState();
  assert.equal(shouldWrite(s, 1000), false, 'nothing to write when clean');

  s = markChanged(s, 1000);
  assert.equal(shouldWrite(s, 1000), false, 'does not write immediately on change');
  assert.equal(shouldWrite(s, 1000 + DEBOUNCE_MS - 1), false, 'still typing → no write');
  assert.equal(shouldWrite(s, 1000 + DEBOUNCE_MS), true, 'writes once the edit settles');

  // Continuous typing keeps deferring, but never longer than MAX_DEFER_MS from
  // when the dirty streak STARTED — this works even BEFORE the first write of
  // the session (ALPHA-002 §15: no first-write starvation).
  {
    let t = 1000;
    let d = emptyDebounceState();
    d = markChanged(d, t);          // firstDirtyAt = 1000, NO prior write
    const start = t;
    for (let i = 0; i < 30; i++) { t += 500; d = markChanged(d, t); }  // keep typing past 10s
    assert.equal(shouldWrite(d, start + MAX_DEFER_MS - 1), false, 'still within the defer window → no forced write');
    assert.equal(shouldWrite(d, start + MAX_DEFER_MS), true, 'constant typing forces a write at MAX_DEFER_MS from the FIRST dirty change, even before any baseline write');
  }

  // After a write, the streak restarts: the next change begins a fresh window,
  // measured from ITS first dirty change (not the old one).
  {
    let d = emptyDebounceState();
    d = markChanged(d, 1000);
    d = markWritten(d, 1200);       // clean
    assert.equal(shouldWrite(d, 5000), false, 'nothing pending after a write');
    let t = 2000;
    d = markChanged(d, t);          // new streak starts at 2000
    for (let i = 0; i < 30; i++) { t += 500; d = markChanged(d, t); }  // keep typing
    assert.equal(shouldWrite(d, 2000 + MAX_DEFER_MS - 1), false, 'new streak still deferring (measured from 2000, not the earlier write)');
    assert.equal(shouldWrite(d, 2000 + MAX_DEFER_MS), true, 'new streak forces a write at MAX_DEFER_MS from ITS start');
    d = markWritten(d, 2000 + MAX_DEFER_MS);
    assert.equal(shouldWrite(d, 2000 + MAX_DEFER_MS + 1), false, 'clean again after writing');
  }
}

// ── Atomic write: crash leaves the OLD file intact ─────────────────────────
{
  const fs = memFs();
  await atomicWrite('/p/project.ssproj', project(1), fs);
  assert.equal(fs.files.get('/p/project.ssproj'), project(1));
  assert.ok(!fs.files.has('/p/project.ssproj.tmp'), 'temp renamed away');

  fs.crashNextWrite();
  await assert.rejects(() => atomicWrite('/p/project.ssproj', project(2), fs));
  assert.equal(fs.files.get('/p/project.ssproj'), project(1), 'a crashed write NEVER corrupts the existing project file');
}

// ── Snapshot naming sorts chronologically ─────────────────────────────────
{
  assert.equal(snapshotName(1), 'snapshot-000001.json');
  assert.equal(snapshotSeq('snapshot-000042.json'), 42);
  assert.equal(snapshotSeq('not-a-snapshot.json'), null);
  const sorted = ['snapshot-000002.json', 'snapshot-000010.json'].sort();
  assert.deepEqual(sorted, ['snapshot-000002.json', 'snapshot-000010.json'], 'zero-padding keeps lexicographic == chronological');
}

// ── Rolling window: keeps MAX_SNAPSHOTS, prunes oldest, newest-first ───────
{
  const fs = memFs();
  const dir = '/appdata/' + RECOVERY_DIR;
  for (let i = 1; i <= MAX_SNAPSHOTS + 3; i++) await writeSnapshot(dir, project(i), fs);
  const names = await listSnapshots(dir, fs);
  assert.equal(names.length, MAX_SNAPSHOTS, `rolling window keeps exactly ${MAX_SNAPSHOTS}`);
  assert.equal(names[0], snapshotName(MAX_SNAPSHOTS + 3), 'newest first');
  const newest = await loadNewestValidSnapshot(dir, fs);
  assert.equal((newest.value as { rev: number }).rev, MAX_SNAPSHOTS + 3, 'newest snapshot loads');
}

// ── Corrupt snapshot fallback: skip to the newest VALID one, keep the bad file ─
{
  const fs = memFs();
  const dir = '/appdata/' + RECOVERY_DIR;
  await writeSnapshot(dir, project(1), fs);
  await writeSnapshot(dir, project(2), fs);
  await writeSnapshot(dir, project(3), fs);
  // Corrupt the newest (simulating a torn write from a hard kill).
  fs.files.set(`${dir}/${snapshotName(3)}`, '{"schemaVersion":5,"outp');
  const load = await loadNewestValidSnapshot(dir, fs);
  assert.equal((load.value as { rev: number }).rev, 2, 'falls back to the newest VALID snapshot');
  assert.equal(load.name, snapshotName(2));
  assert.deepEqual(load.skippedCorrupt, [snapshotName(3)], 'the corrupt one is reported');
  assert.ok(fs.files.has(`${dir}/${snapshotName(3)}`), 'and PRESERVED on disk, not deleted');

  // All corrupt → honest null, never a throw.
  const fs2 = memFs();
  await writeSnapshot('/r', project(1), fs2);
  fs2.files.set('/r/' + snapshotName(1), 'garbage');
  const none = await loadNewestValidSnapshot('/r', fs2);
  assert.equal(none.value, null, 'no valid snapshot → null, not a crash');
}

// ── Plausibility guard rejects junk but accepts a real project ─────────────
{
  assert.equal(isPlausibleProject({ schemaVersion: 5, outputs: [] }), true, 'the real ReleaseProject shape is accepted');
  assert.equal(isPlausibleProject({ schemaVersion: 5 }), false, 'missing outputs rejected');
  assert.equal(isPlausibleProject({ outputs: [] }), false, 'missing schemaVersion rejected');
  assert.equal(isPlausibleProject(null), false);
  assert.equal(isPlausibleProject('{}'), false);
}

// ── Pending provider jobs + accepted takes survive recovery ───────────────
{
  const fs = memFs();
  const dir = '/appdata/' + RECOVERY_DIR;
  const withJobs = JSON.stringify({
    schemaVersion: 5, outputs: [{ id: 'out-1' }],
    director: {
      takes: [
        { id: 'take-1', providerJob: { jobId: 'xai-req-123', phase: 'running', providerId: 'xai-video' }, assetId: null },
        { id: 'take-2', providerJob: { jobId: 'v1_abc', phase: 'succeeded', providerId: 'google-omni' }, assetId: 'asset-9', accepted: true },
      ],
      scenes: [{ id: 'scene-1', acceptedTakeId: 'take-2' }],
    },
  });
  await writeSnapshot(dir, withJobs, fs);
  const load = await loadNewestValidSnapshot(dir, fs);
  const d = (load.value as { director: { takes: Array<{ providerJob: { jobId: string; phase: string } }>; scenes: Array<{ acceptedTakeId: string }> } }).director;
  assert.equal(d.takes[0].providerJob.jobId, 'xai-req-123', 'pending provider job id restored');
  assert.equal(d.takes[0].providerJob.phase, 'running', 'pending phase restored → auto-poll can resume');
  assert.equal(d.scenes[0].acceptedTakeId, 'take-2', 'accepted take link restored');
}

// ── Unclean shutdown detection ────────────────────────────────────────────
{
  const fs = memFs();
  const dir = '/appdata/' + RECOVERY_DIR;
  assert.equal(await wasUncleanShutdown(dir, fs), false, 'fresh install → clean');
  await markSessionOpen(dir, fs, '2026-07-12T10:00:00Z');
  assert.equal(await wasUncleanShutdown(dir, fs), true, 'marker present while running (i.e. if we crash now)');
  await markSessionClean(dir, fs);
  assert.equal(await wasUncleanShutdown(dir, fs), false, 'clean exit clears the marker');
  await markSessionClean(dir, fs); // idempotent
}

// ── Launch offer decision ─────────────────────────────────────────────────
{
  assert.deepEqual(decideLaunchOffer({ lastProjectPath: null, uncleanShutdown: false, newestSnapshot: null, snapshotNewerThanFile: false }),
    { kind: 'none' }, 'fresh install offers nothing');

  assert.deepEqual(decideLaunchOffer({ lastProjectPath: 'C:/a/b.ssproj', uncleanShutdown: false, newestSnapshot: null, snapshotNewerThanFile: false }),
    { kind: 'reopen-last', path: 'C:/a/b.ssproj' }, 'clean exit offers reopen-last');

  const crashed = decideLaunchOffer({ lastProjectPath: 'C:/a/b.ssproj', uncleanShutdown: true, newestSnapshot: 'snapshot-000003.json', snapshotNewerThanFile: false });
  assert.equal(crashed.kind, 'recover');
  assert.equal((crashed as { reason: string }).reason, 'unclean-shutdown', 'a crash offers recovery');

  const newer = decideLaunchOffer({ lastProjectPath: 'C:/a/b.ssproj', uncleanShutdown: false, newestSnapshot: 'snapshot-000003.json', snapshotNewerThanFile: true });
  assert.equal((newer as { reason: string }).reason, 'newer-recovery', 'a newer recovery copy offers recovery even after a clean exit');

  // Recovery outranks a plain reopen.
  assert.equal(decideLaunchOffer({ lastProjectPath: 'C:/a/b.ssproj', uncleanShutdown: true, newestSnapshot: 'snapshot-000001.json', snapshotNewerThanFile: true }).kind, 'recover');
  // No snapshot means nothing to recover, even after a crash.
  assert.equal(decideLaunchOffer({ lastProjectPath: null, uncleanShutdown: true, newestSnapshot: null, snapshotNewerThanFile: false }).kind, 'none');
}

// ── Autosave target: never fake a permanent location ──────────────────────
{
  assert.deepEqual(autosaveTarget('C:/songs/demo.ssproj', '/appdata/recovery'), { kind: 'user-file', path: 'C:/songs/demo.ssproj' },
    'a saved project autosaves to its own file');
  assert.deepEqual(autosaveTarget(null, '/appdata/recovery'), { kind: 'recovery-only', dir: '/appdata/recovery' },
    'an unsaved project autosaves ONLY to the recovery area — we never pretend it has a home');
}

// ── §16-C: open-project autosave targets the user's file + reopen-last ──────
// Simulates the App autosave decision path without React: an OPENED project has
// a path → autosave replaces that file atomically AND writes a recovery
// snapshot; a NEVER-saved project autosaves only to recovery. "Reopen last"
// resolves the same path.
{
  const fs = memFs();
  const recDir = '/appdata/' + RECOVERY_DIR;
  const pathA = '/docs/song-a.songstudio.json';
  const pathB = '/docs/song-b.songstudio.json';

  // The user's file already exists on disk (they opened it).
  await atomicWrite(pathA, project(1), fs);

  // App autosave step for an OPENED project (explicitPath = pathA):
  async function autosave(explicitPath: string | null, json: string) {
    await writeSnapshot(recDir, json, fs);                       // always the crash net
    const target = autosaveTarget(explicitPath, recDir);
    if (target.kind === 'user-file') await atomicWrite(target.path, json, fs);   // P1-7
  }

  await autosave(pathA, project(2));
  assert.equal(JSON.parse(fs.files.get(pathA)!).rev, 2, 'autosave replaced the OPENED project file (path retained)');
  assert.ok((await listSnapshots(recDir, fs)).length >= 1, 'a recovery snapshot exists as a backup too');

  // "Reopen last" resolves pathA and reads rev 2.
  assert.ok(await fs.exists(pathA), 'last-project path is a real file to reopen');
  assert.equal(JSON.parse(fs.files.get(pathA)!).rev, 2, 'reopen-last would read the latest autosaved content');

  // Save As from A to B: future autosaves target B, not A.
  await atomicWrite(pathB, project(3), fs);                      // Save As wrote B
  await autosave(pathB, project(4));
  assert.equal(JSON.parse(fs.files.get(pathB)!).rev, 4, 'after Save As, autosave targets the NEW file B');
  assert.equal(JSON.parse(fs.files.get(pathA)!).rev, 2, 'the old file A is left untouched after Save As');

  // A never-saved project autosaves ONLY to recovery, never inventing a home.
  const before = (await listSnapshots(recDir, fs)).length;
  await autosave(null, project(9));
  assert.equal((await listSnapshots(recDir, fs)).length, before + 1, 'unsaved project still snapshots');
  // (no user file was created for it — there is nothing to assert a path for)
}

console.log('[recovery] PASS — debounce (settle + max-defer), atomic replacement preserves the old file on crash, rolling snapshot window, newest-valid load with corrupt fallback (bad files preserved), pending-job + accepted-take restoration, unclean-shutdown detection, launch-offer ordering, honest autosave target.');
