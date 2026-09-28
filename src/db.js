'use strict';

const { DatabaseSync } = require('node:sqlite');

const ADVISORS = [
  { id: 'ethelyn', name: 'Ethelyn' },
  { id: 'alok', name: 'Alok' },
  { id: 'jaansi', name: 'Jaansi' },
];

const WITNESSES = ['Miguel', 'Frida'];

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
    UNIQUE (advisor_id, session_date)
  );
`;

function openDb(filename) {
  const db = new DatabaseSync(filename);
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  const seed = db.prepare('INSERT OR IGNORE INTO advisors (id, name) VALUES (?, ?)');
  for (const a of ADVISORS) seed.run(a.id, a.name);
  return db;
}

function listAdvisors(db) {
  return db.prepare('SELECT id, name FROM advisors ORDER BY name').all();
}

function getStandings(db) {
  return db
    .prepare(
      `SELECT a.id, a.name,
              COUNT(c.id)         AS sessions,
              MAX(c.session_date) AS lastSession
         FROM advisors a
         LEFT JOIN checkins c ON c.advisor_id = a.id
        GROUP BY a.id
        ORDER BY sessions DESC, a.name`
    )
    .all();
}

function listCheckins(db, advisorId) {
  const base = `SELECT c.id, c.advisor_id AS advisorId, a.name AS advisorName, c.witness,
                       c.session_date AS sessionDate, c.photo, c.created_at AS createdAt
                  FROM checkins c JOIN advisors a ON a.id = c.advisor_id`;
  const order = ' ORDER BY c.session_date DESC, c.id DESC';
  return advisorId
    ? db.prepare(`${base} WHERE c.advisor_id = ?${order}`).all(advisorId)
    : db.prepare(base + order).all();
}

/**
 * Records one check-in per advisor for a single photo, atomically.
 * Returns { created } on success or { conflicts } naming advisors who already
 * checked in for that session (in which case nothing is written).
 */
function createCheckins(db, { advisorIds, witness, sessionDate, photo }) {
  const existing = db.prepare(
    'SELECT advisor_id FROM checkins WHERE session_date = ? AND advisor_id = ?'
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
  WITNESSES,
  openDb,
  listAdvisors,
  getStandings,
  listCheckins,
  createCheckins,
  deleteCheckin,
};
