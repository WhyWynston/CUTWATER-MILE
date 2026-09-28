'use strict';

const { DatabaseSync } = require('node:sqlite');

const ADVISORS = [
  { id: 'alok', name: 'Alok' },
  { id: 'ethelyn', name: 'Ethelyn' },
  { id: 'jaansi', name: 'Jaansi' },
];

// Photos are taken with, and approved by, one of these two.
const APPROVERS = ['Miguel', 'Frida'];

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS advisors (
    id   TEXT PRIMARY KEY,
    name TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS checkins (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    advisor_id   TEXT NOT NULL REFERENCES advisors(id),
    witness      TEXT NOT NULL,
    session_date TEXT NOT NULL,
    photo        TEXT NOT NULL,
    created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    approved_by  TEXT,
    approved_at  TEXT,
    UNIQUE (advisor_id, session_date)
  );
`;

function openDb(filename) {
  const db = new DatabaseSync(filename);
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  // Databases created before approvals existed lack these columns.
  const columns = new Set(db.prepare('PRAGMA table_info(checkins)').all().map((c) => c.name));
  if (!columns.has('approved_by')) db.exec('ALTER TABLE checkins ADD COLUMN approved_by TEXT');
  if (!columns.has('approved_at')) db.exec('ALTER TABLE checkins ADD COLUMN approved_at TEXT');
  const seed = db.prepare('INSERT OR IGNORE INTO advisors (id, name) VALUES (?, ?)');
  for (const a of ADVISORS) seed.run(a.id, a.name);
  return db;
}

function listAdvisors(db) {
  return db.prepare('SELECT id, name FROM advisors ORDER BY name').all();
}

/** Approved attendance per advisor, plus how many sessions have been held. */
function getStandings(db) {
  const rows = db
    .prepare(
      `SELECT a.id, a.name,
              COUNT(c.id)         AS sessions,
              MAX(c.session_date) AS lastSession,
              (SELECT COUNT(*) FROM checkins p
                WHERE p.advisor_id = a.id AND p.approved_at IS NULL) AS pending
         FROM advisors a
         LEFT JOIN checkins c ON c.advisor_id = a.id AND c.approved_at IS NOT NULL
        GROUP BY a.id
        ORDER BY sessions DESC, a.name`
    )
    .all();
  const { held } = db
    .prepare('SELECT COUNT(DISTINCT session_date) AS held FROM checkins WHERE approved_at IS NOT NULL')
    .get();
  return { rows, held };
}

const CHECKIN_COLUMNS = `
  c.id, c.advisor_id AS advisorId, a.name AS advisorName, c.witness,
  c.session_date AS sessionDate, c.photo, c.created_at AS createdAt,
  c.approved_by AS approvedBy, c.approved_at AS approvedAt`;

function listCheckins(db, { advisorId, status } = {}) {
  const where = [];
  const params = [];
  if (advisorId) { where.push('c.advisor_id = ?'); params.push(advisorId); }
  if (status === 'pending') where.push('c.approved_at IS NULL');
  if (status === 'approved') where.push('c.approved_at IS NOT NULL');
  const sql = `SELECT ${CHECKIN_COLUMNS}
                 FROM checkins c JOIN advisors a ON a.id = c.advisor_id
                ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
                ORDER BY c.session_date DESC, c.id DESC`;
  return db.prepare(sql).all(...params);
}

/**
 * Records one pending check-in per advisor for a single photo, atomically.
 * Returns { created } on success or { conflicts } naming advisors who already
 * have a check-in (pending or approved) for that date; nothing is written then.
 */
function createCheckins(db, { advisorIds, witness, sessionDate, photo }) {
  const existing = db.prepare(
    'SELECT 1 FROM checkins WHERE session_date = ? AND advisor_id = ?'
  );
  const conflicts = advisorIds.filter((id) => existing.get(sessionDate, id));
  if (conflicts.length) return { conflicts };

  const insert = db.prepare(
    'INSERT INTO checkins (advisor_id, witness, session_date, photo) VALUES (?, ?, ?, ?)'
  );
  const created = [];
  db.exec('BEGIN');
  try {
    for (const id of advisorIds) {
      created.push(Number(insert.run(id, witness, sessionDate, photo).lastInsertRowid));
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return { created };
}

/** Marks a check-in approved. Returns false if it doesn't exist. */
function approveCheckin(db, id, approver) {
  const result = db
    .prepare(
      `UPDATE checkins
          SET approved_by = ?, approved_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE id = ? AND approved_at IS NULL`
    )
    .run(approver, id);
  if (result.changes) return true;
  return Boolean(db.prepare('SELECT 1 FROM checkins WHERE id = ?').get(id));
}

/** Deletes a check-in; returns the photo filename if it is no longer referenced. */
function deleteCheckin(db, id) {
  const row = db.prepare('SELECT photo FROM checkins WHERE id = ?').get(id);
  if (!row) return null;
  db.prepare('DELETE FROM checkins WHERE id = ?').run(id);
  const stillUsed = db.prepare('SELECT 1 FROM checkins WHERE photo = ?').get(row.photo);
  return { orphanedPhoto: stillUsed ? null : row.photo };
}

module.exports = {
  ADVISORS,
  APPROVERS,
  openDb,
  listAdvisors,
  getStandings,
  listCheckins,
  createCheckins,
  approveCheckin,
  deleteCheckin,
};
