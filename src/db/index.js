/**
 * src/db/index.js
 * SQLite database manager with automatic migrations and prepared statements.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import Database from 'better-sqlite3';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..', '..');
const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

let _defaultDb = null;

export function initDb(dbPath) {
  const targetPath = dbPath || process.env.DB_PATH || path.join(ROOT_DIR, 'data', 'l2s.sqlite');

  if (targetPath !== ':memory:') {
    const parentDir = path.dirname(targetPath);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }
  }

  const db = new Database(targetPath);
  db.pragma('foreign_keys = ON');
  if (targetPath !== ':memory:') {
    db.pragma('journal_mode = WAL');
  }

  runMigrations(db);
  return db;
}

export function getDb() {
  if (!_defaultDb) {
    _defaultDb = initDb();
  }
  return _defaultDb;
}

export function runMigrations(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      name TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);

  if (!fs.existsSync(MIGRATIONS_DIR)) return;

  const files = fs.readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql'))
    .sort();

  const isAppliedStmt = db.prepare('SELECT 1 FROM _migrations WHERE name = ?');
  const recordMigrationStmt = db.prepare('INSERT INTO _migrations (name, applied_at) VALUES (?, ?)');

  for (const file of files) {
    const row = isAppliedStmt.get(file);
    if (!row) {
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
      const applyTx = db.transaction(() => {
        db.exec(sql);
        recordMigrationStmt.run(file, new Date().toISOString());
      });
      applyTx();
    }
  }
}

// ── Prepared Statement Factory ──────────────────────────────────────────────

export function createDbRepository(db) {
  // Users
  const insertUserStmt = db.prepare(`
    INSERT INTO users (id, email, password_hash, plan, credits_seconds, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const getUserByEmailStmt = db.prepare(`SELECT * FROM users WHERE email = ?`);
  const getUserByIdStmt = db.prepare(`SELECT * FROM users WHERE id = ?`);
  const deleteUserStmt = db.prepare(`DELETE FROM users WHERE id = ?`);

  // Sessions (stored hashed)
  const insertSessionStmt = db.prepare(`
    INSERT INTO sessions (id, user_id, csrf_token, expires_at, created_at)
    VALUES (?, ?, ?, ?, ?)
  `);
  const getSessionStmt = db.prepare(`
    SELECT s.*, u.email, u.plan, u.credits_seconds
    FROM sessions s
    JOIN users u ON s.user_id = u.id
    WHERE s.id = ? AND s.expires_at > ?
  `);
  const deleteSessionStmt = db.prepare(`DELETE FROM sessions WHERE id = ?`);
  const deleteExpiredSessionsStmt = db.prepare(`DELETE FROM sessions WHERE expires_at <= ?`);

  // Jobs
  const insertJobStmt = db.prepare(`
    INSERT INTO jobs (id, user_id, status, source_type, source_ref, params_json, progress, error, created_at, started_at, finished_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const getJobStmt = db.prepare(`SELECT * FROM jobs WHERE id = ? AND user_id = ?`);
  const getJobAdminStmt = db.prepare(`SELECT * FROM jobs WHERE id = ?`);
  const listJobsStmt = db.prepare(`SELECT * FROM jobs WHERE user_id = ? ORDER BY created_at DESC`);
  const deleteJobStmt = db.prepare(`DELETE FROM jobs WHERE id = ? AND user_id = ?`);
  const countActiveJobsStmt = db.prepare(`
    SELECT COUNT(*) as count FROM jobs 
    WHERE user_id = ? AND status IN ('queued', 'processing', 'rendering', 'analyzing')
  `);

  // Clips
  const insertClipStmt = db.prepare(`
    INSERT INTO clips (id, job_id, user_id, idx, start, end, score, title, file_path, meta_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const listClipsStmt = db.prepare(`SELECT * FROM clips WHERE job_id = ? AND user_id = ? ORDER BY idx ASC`);
  const getClipStmt = db.prepare(`SELECT * FROM clips WHERE job_id = ? AND idx = ? AND user_id = ?`);

  // OAuth Tokens
  const upsertOAuthTokenStmt = db.prepare(`
    INSERT INTO oauth_tokens (id, user_id, provider, enc_blob, created_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET enc_blob = excluded.enc_blob, created_at = excluded.created_at
  `);
  const getOAuthTokenStmt = db.prepare(`SELECT * FROM oauth_tokens WHERE user_id = ? AND provider = ?`);
  const deleteOAuthTokenStmt = db.prepare(`DELETE FROM oauth_tokens WHERE user_id = ? AND provider = ?`);

  // Usage
  const insertUsageStmt = db.prepare(`
    INSERT INTO usage (id, user_id, job_id, seconds, created_at)
    VALUES (?, ?, ?, ?, ?)
  `);
  const getMonthlyUsageStmt = db.prepare(`
    SELECT SUM(seconds) as total_seconds FROM usage 
    WHERE user_id = ? AND created_at >= ?
  `);

  function hashToken(raw) {
    return crypto.createHash('sha256').update(raw).digest('hex');
  }

  return {
    rawDb: db,

    // Users
    createUser({ email, passwordHash, plan = 'free', creditsSeconds = 1800 }) {
      const id = 'usr_' + crypto.randomUUID().replace(/-/g, '').slice(0, 16);
      const now = new Date().toISOString();
      insertUserStmt.run(id, email.toLowerCase().trim(), passwordHash, plan, creditsSeconds, now);
      return { id, email: email.toLowerCase().trim(), plan, credits_seconds: creditsSeconds, created_at: now };
    },

    getUserByEmail(email) {
      if (!email) return null;
      return getUserByEmailStmt.get(email.toLowerCase().trim()) || null;
    },

    getUserById(id) {
      if (!id) return null;
      return getUserByIdStmt.get(id) || null;
    },

    deleteUser(id) {
      return deleteUserStmt.run(id);
    },

    // Sessions
    createSession({ userId, rawToken, csrfToken, expiresAt }) {
      const id = hashToken(rawToken);
      const now = new Date().toISOString();
      insertSessionStmt.run(id, userId, csrfToken, expiresAt.toISOString(), now);
      return { id, user_id: userId, csrf_token: csrfToken, expires_at: expiresAt.toISOString() };
    },

    getSession(rawToken) {
      if (!rawToken) return null;
      const id = hashToken(rawToken);
      const now = new Date().toISOString();
      return getSessionStmt.get(id, now) || null;
    },

    deleteSession(rawToken) {
      if (!rawToken) return;
      const id = hashToken(rawToken);
      return deleteSessionStmt.run(id);
    },

    deleteExpiredSessions() {
      const now = new Date().toISOString();
      return deleteExpiredSessionsStmt.run(now);
    },

    // Jobs
    createJob({ id, userId, status = 'queued', sourceType, sourceRef, paramsJson }) {
      const jobId = id || 'job_' + crypto.randomUUID().replace(/-/g, '').slice(0, 16);
      const now = new Date().toISOString();
      insertJobStmt.run(jobId, userId, status, sourceType, sourceRef, paramsJson, 0, null, now, null, null);
      return { id: jobId, user_id: userId, status, source_type: sourceType, source_ref: sourceRef, progress: 0, created_at: now };
    },

    getJob(id, userId) {
      if (!id || !userId) return null;
      return getJobStmt.get(id, userId) || null;
    },

    getJobAdmin(id) {
      if (!id) return null;
      return getJobAdminStmt.get(id) || null;
    },

    listJobs(userId) {
      return listJobsStmt.all(userId);
    },

    updateJob(id, updates = {}) {
      const sets = [];
      const values = [];
      for (const [k, v] of Object.entries(updates)) {
        sets.push(`${k} = ?`);
        values.push(v);
      }
      if (sets.length === 0) return;
      values.push(id);
      const sql = `UPDATE jobs SET ${sets.join(', ')} WHERE id = ?`;
      return db.prepare(sql).run(...values);
    },

    deleteJob(id, userId) {
      return deleteJobStmt.run(id, userId);
    },

    countActiveUserJobs(userId) {
      const row = countActiveJobsStmt.get(userId);
      return row ? row.count : 0;
    },

    // Clips
    createClip({ id, jobId, userId, idx, start, end, score, title, filePath, metaJson }) {
      const clipId = id || 'clp_' + crypto.randomUUID().replace(/-/g, '').slice(0, 16);
      const now = new Date().toISOString();
      insertClipStmt.run(clipId, jobId, userId, idx, start, end, score, title, filePath, metaJson, now);
      return { id: clipId, job_id: jobId, user_id: userId, idx, start, end, score, title, file_path: filePath, meta_json: metaJson, created_at: now };
    },

    listClips(jobId, userId) {
      return listClipsStmt.all(jobId, userId);
    },

    getClip(jobId, idx, userId) {
      return getClipStmt.get(jobId, Number(idx), userId) || null;
    },

    // Usage
    recordUsage({ userId, jobId, seconds }) {
      const id = 'usg_' + crypto.randomUUID().replace(/-/g, '').slice(0, 16);
      const now = new Date().toISOString();
      insertUsageStmt.run(id, userId, jobId, seconds, now);
      return { id, user_id: userId, job_id: jobId, seconds, created_at: now };
    },

    getMonthlyUsageSeconds(userId) {
      const startOfMonth = new Date();
      startOfMonth.setDate(1);
      startOfMonth.setHours(0, 0, 0, 0);
      const row = getMonthlyUsageStmt.get(userId, startOfMonth.toISOString());
      return row && row.total_seconds ? row.total_seconds : 0;
    },

    // OAuth
    saveOAuthToken({ userId, provider, encBlob }) {
      const id = `${userId}:${provider}`;
      const now = new Date().toISOString();
      upsertOAuthTokenStmt.run(id, userId, provider, encBlob, now);
      return { id, user_id: userId, provider, enc_blob: encBlob, created_at: now };
    },

    getOAuthToken(userId, provider) {
      return getOAuthTokenStmt.get(userId, provider) || null;
    },

    deleteOAuthToken(userId, provider) {
      return deleteOAuthTokenStmt.run(userId, provider);
    }
  };
}
