"use strict";
const crypto = require('crypto');
const path = require('path');
const UPLOAD_DIR = path.resolve('uploads');
const TOKEN_TTL_MS = 30 * 60 * 1000;
let db; let timer;
const isWithinUploadDir = (filePath) => { const resolved = path.resolve(filePath); const relative = path.relative(UPLOAD_DIR, resolved); return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative)); };
function sweepExpired(){ if (!db) return; db.prepare('DELETE FROM download_tokens WHERE used=1 OR expires_at < ?').run(Date.now()); }
function init(existingDb){ db = existingDb; db.exec(`CREATE TABLE IF NOT EXISTS download_tokens (token TEXT PRIMARY KEY,user_id INTEGER NOT NULL,file_path TEXT NOT NULL,download_name TEXT NOT NULL,expires_at INTEGER NOT NULL,used INTEGER NOT NULL DEFAULT 0)`); sweepExpired(); timer = setInterval(sweepExpired, 15*60*1000); if (timer?.unref) timer.unref(); }
function createToken({ userId, filePath, downloadName }){ const resolved = path.resolve(filePath); if (!isWithinUploadDir(resolved)) throw new Error('Invalid download path.'); const token = crypto.randomUUID(); db.prepare('INSERT INTO download_tokens (token,user_id,file_path,download_name,expires_at,used) VALUES (?,?,?,?,?,0)').run(token, userId, resolved, downloadName, Date.now()+TOKEN_TTL_MS); return token; }
function consumeToken(token, userId){ const row = db.prepare('SELECT * FROM download_tokens WHERE token=? AND used=0').get(token); if (!row) return { error:'Download link not found.', code:404 }; if (row.expires_at < Date.now()) return { error:'Download link has expired.', code:410 }; if (Number(row.user_id)!==Number(userId)) return { error:'Download link is not valid for this account.', code:403 }; if (!isWithinUploadDir(row.file_path)) return { error:'Invalid download path.', code:403 }; db.prepare('UPDATE download_tokens SET used=1 WHERE token=?').run(token); return { filePath: row.file_path, downloadName: row.download_name, code:200 }; }
module.exports = { init, createToken, consumeToken };
