import { describe, expect, it } from 'vitest';
const { generateReport } = require('../server/readiness/report');

// better-sqlite3 is a native module built for the project's Node 20 runtime.
// When the local test runner is on a different Node ABI the binding won't load,
// so we skip this suite there; CI (Node 20) runs it for real.
let Database: any;
let sqliteAvailable = true;
try {
  Database = require('better-sqlite3');
  const probe = new Database(':memory:');
  probe.close();
} catch {
  sqliteAvailable = false;
}

const suite = sqliteAvailable ? describe : describe.skip;

suite('readiness store', () => {
  const store = require('../server/readiness/store');
  let db: any;

  function freshDb() {
    const d = new Database(':memory:');
    d.pragma('foreign_keys = ON');
    d.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT);`);
    d.prepare(`INSERT INTO users (email) VALUES ('a@b.c')`).run(); // user id 1
    return d;
  }

  it('creates a release and scopes reads to the owner', () => {
    db = freshDb();
    store.init(db);
    const rel = store.createRelease(1, { title: 'My Song', platform: 'Spotify', context: { metadata: { title: 'My Song' } } });
    expect(rel.id).toBeGreaterThan(0);
    expect(store.getRelease(1, rel.id)?.title).toBe('My Song');
    expect(store.getRelease(1, rel.id)?.context.metadata.title).toBe('My Song');
    expect(store.getRelease(999, rel.id)).toBeNull(); // another user cannot see it
    db.close();
  });

  it('persists a report and surfaces it as the latest (honest needs_attention with no providers)', async () => {
    db = freshDb();
    store.init(db);
    const rel = store.createRelease(1, { title: 'Track 2', context: { metadata: {} } });
    const report = await generateReport({ releaseId: rel.id, context: rel.context, providers: [], ruleRegistryVersion: 'none' });
    store.saveReport(rel.id, report);

    const latest = store.getLatestReport(rel.id);
    expect(latest.verdict.status).toBe('needs_attention'); // nothing assessed -> honesty cap
    expect(latest.reportId).toBe(report.reportId);

    const found = store.listReleases(1).find((r: any) => r.id === rel.id);
    expect(found.latestStatus).toBe('needs_attention');
    db.close();
  });
});
