"use strict";

/**
 * Persistence for releases and their readiness reports. Additive tables — does
 * not touch the existing users/jobs schema. The report history per release is
 * the audit trail (supporting infrastructure, not a marketed blockchain).
 */

let db = null;

function init(database) {
  db = database;
  db.exec(`
    CREATE TABLE IF NOT EXISTS releases (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title        TEXT,
      platform     TEXT NOT NULL DEFAULT 'General',
      context_json TEXT NOT NULL DEFAULT '{}',
      created_at   TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS release_reports (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      release_id     INTEGER NOT NULL REFERENCES releases(id) ON DELETE CASCADE,
      status         TEXT,
      overall_score  INTEGER,
      engine_version TEXT,
      report_json    TEXT NOT NULL,
      created_at     TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_releases_user ON releases(user_id);
    CREATE INDEX IF NOT EXISTS idx_reports_release ON release_reports(release_id);
  `);
}

function createRelease(userId, { title = '', platform = 'General', context = {} }) {
  const result = db.prepare(
    `INSERT INTO releases (user_id, title, platform, context_json) VALUES (?, ?, ?, ?)`
  ).run(userId, String(title || ''), String(platform || 'General'), JSON.stringify(context || {}));
  return getRelease(userId, result.lastInsertRowid);
}

function getRelease(userId, id) {
  const row = db.prepare(`SELECT * FROM releases WHERE id = ? AND user_id = ?`).get(id, userId);
  if (!row) return null;
  let context = {};
  try { context = JSON.parse(row.context_json || '{}'); } catch {}
  return { id: row.id, title: row.title, platform: row.platform, context, createdAt: row.created_at, updatedAt: row.updated_at };
}

function listReleases(userId) {
  const rows = db.prepare(`
    SELECT r.id, r.title, r.platform, r.created_at,
           (SELECT status FROM release_reports rr WHERE rr.release_id = r.id ORDER BY rr.id DESC LIMIT 1) AS latest_status,
           (SELECT overall_score FROM release_reports rr WHERE rr.release_id = r.id ORDER BY rr.id DESC LIMIT 1) AS latest_score
    FROM releases r WHERE r.user_id = ? ORDER BY r.id DESC
  `).all(userId);
  return rows.map((r) => ({ id: r.id, title: r.title, platform: r.platform, createdAt: r.created_at, latestStatus: r.latest_status, latestScore: r.latest_score }));
}

function saveReport(releaseId, report) {
  db.prepare(
    `INSERT INTO release_reports (release_id, status, overall_score, engine_version, report_json) VALUES (?, ?, ?, ?, ?)`
  ).run(releaseId, report?.verdict?.status || null, report?.verdict?.overallScore ?? null, report?.engineVersion || null, JSON.stringify(report));
  db.prepare(`UPDATE releases SET updated_at = datetime('now') WHERE id = ?`).run(releaseId);
}

function getLatestReport(releaseId) {
  const row = db.prepare(`SELECT report_json FROM release_reports WHERE release_id = ? ORDER BY id DESC LIMIT 1`).get(releaseId);
  if (!row) return null;
  try { return JSON.parse(row.report_json); } catch { return null; }
}

module.exports = { init, createRelease, getRelease, listReleases, saveReport, getLatestReport };
