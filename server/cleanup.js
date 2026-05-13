"use strict";
const path = require('path');
const fs = require('fs-extra');
const UPLOAD_DIR = path.resolve('uploads');
const TTL_MS = 60 * 60 * 1000;
const SWEEP_INTERVAL = 10 * 60 * 1000;
const ROW_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
let db; let timer;
const isWithinUploadDir = (filePath) => { const resolved = path.resolve(filePath); const relative = path.relative(UPLOAD_DIR, resolved); return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative)); };
function runSweeper() { if (!db) return; const now = Date.now(); const rows = db.prepare('SELECT id, file_path, registered_at FROM cleanup_queue WHERE deleted=0').all(); for (const r of rows) { if (now - r.registered_at > TTL_MS) { if (isWithinUploadDir(r.file_path)) fs.remove(path.resolve(r.file_path)).catch(() => {}); db.prepare('UPDATE cleanup_queue SET deleted=1 WHERE id=?').run(r.id); } } db.prepare('DELETE FROM cleanup_queue WHERE deleted=1 AND registered_at < ?').run(now - ROW_MAX_AGE_MS); }
function init(existingDb){ db = existingDb; db.exec(`CREATE TABLE IF NOT EXISTS cleanup_queue (id INTEGER PRIMARY KEY AUTOINCREMENT,file_path TEXT NOT NULL,registered_at INTEGER NOT NULL,deleted INTEGER NOT NULL DEFAULT 0)`); runSweeper(); timer = setInterval(runSweeper, SWEEP_INTERVAL); if (timer?.unref) timer.unref(); }
function registerForCleanup(filePaths){ if (!db || !Array.isArray(filePaths)) return; const stmt = db.prepare('INSERT INTO cleanup_queue (file_path, registered_at, deleted) VALUES (?, ?, 0)'); for (const f of filePaths) { if (!f) continue; if (!isWithinUploadDir(f)) { console.warn('Refusing cleanup registration outside uploads:', f); continue; } stmt.run(path.resolve(f), Date.now()); } }
async function deleteImmediately(filePath){ if (!filePath || !isWithinUploadDir(filePath)) { if (filePath) console.warn('Refusing cleanup delete outside uploads:', filePath); return; } const resolved = path.resolve(filePath); await fs.remove(resolved).catch(() => {}); if (db) db.prepare('UPDATE cleanup_queue SET deleted=1 WHERE file_path=?').run(resolved); }
module.exports = { init, registerForCleanup, deleteImmediately };
