'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const multer = require('multer');
const db = require('./db');
const { createAuth, parsePasswords } = require('./auth');

const MAX_PHOTO_BYTES = 15 * 1024 * 1024;
const IMAGE_EXTENSIONS = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/heic': '.heic',
  'image/heif': '.heif',
};
// Where the leader sits on the lap; everyone else is placed in proportion to them.
const LEAD_POINT = 0.85;

function isValidDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

function isFutureDate(value) {
  // Allow one day of slack so users ahead of UTC can log "today".
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return value > tomorrow;
}

function createApp({ database, uploadDir, passwords, sessionSecret, trustProxy = false } = {}) {
  fs.mkdirSync(uploadDir, { recursive: true });

  const people = [...db.listAdvisors(database).map((a) => a.name), ...db.APPROVERS];
  const { accounts, unknown } = parsePasswords(passwords, people);
  if (unknown.length) console.warn(`PASSWORDS has names nobody here matches: ${unknown.join(', ')}`);
  const missing = people.filter((p) => !accounts[p]);
  if (missing.length) console.warn(`No password set for: ${missing.join(', ')} (they can't log in).`);
  const auth = createAuth({ accounts, approvers: db.APPROVERS, secret: sessionSecret });

  const upload = multer({
    storage: multer.diskStorage({
      destination: uploadDir,
      filename: (_req, file, cb) =>
        cb(null, crypto.randomUUID() + IMAGE_EXTENSIONS[file.mimetype]),
    }),
    limits: { fileSize: MAX_PHOTO_BYTES, files: 1 },
    fileFilter: (_req, file, cb) => cb(null, Boolean(IMAGE_EXTENSIONS[file.mimetype])),
  });

  const removePhoto = (filename) => {
    if (filename) fs.rmSync(path.join(uploadDir, path.basename(filename)), { force: true });
  };
  const withPhotoUrl = (row) => ({ ...row, photoUrl: `/uploads/${row.photo}`, approved: Boolean(row.approvedAt) });

  const app = express();
  if (trustProxy) app.set('trust proxy', trustProxy);
  app.use(express.json());
  app.use(auth.identify);

  app.get('/api/config', (req, res) => {
    res.json({
      approvers: db.APPROVERS,
      advisors: db.listAdvisors(database),
      people: auth.people,
      user: req.user,
    });
  });

  app.get('/api/standings', (_req, res) => {
    const { rows, held } = db.getStandings(database);
    const counts = rows.map((r) => r.sessions);
    const fewest = Math.min(...counts);
    const most = Math.max(...counts);
    res.json({
      held,
      standings: rows.map((r) => ({
        ...r,
        rate: held ? Math.round((r.sessions / held) * 100) : null,
        // Runners are placed relative to the leader, so they move up and down as counts change.
        position: most ? LEAD_POINT * (r.sessions / most) : 0,
        // Last place is flagged once someone has pulled ahead; a dead heat flags nobody yet.
        milkMile: most > fewest && r.sessions === fewest,
      })),
    });
  });

  app.get('/api/checkins', (req, res) => {
    const { advisor, status } = req.query;
    res.json(db.listCheckins(database, { advisorId: advisor, status }).map(withPhotoUrl));
  });

  app.post('/api/checkins', auth.requireLogin, (req, res, next) => {
    upload.single('photo')(req, res, (err) => {
      if (err instanceof multer.MulterError) {
        return res.status(400).json({ error: `Photo upload failed: ${err.message}` });
      }
      if (err) return next(err);

      const fail = (status, error) => {
        removePhoto(req.file?.filename);
        res.status(status).json({ error });
      };

      if (!req.file) return fail(400, 'A photo (JPEG, PNG, WebP, GIF or HEIC) is required.');

      const names = new Map(db.listAdvisors(database).map((a) => [a.id, a.name]));
      const advisorIds = [...new Set([].concat(req.body.advisors ?? []))];
      if (!advisorIds.length) return fail(400, 'Pick at least one advisor in the photo.');
      const unknown = advisorIds.filter((id) => !names.has(id));
      if (unknown.length) return fail(400, `Unknown advisor: ${unknown.join(', ')}`);

      const { witness, sessionDate } = req.body;
      if (!db.APPROVERS.includes(witness)) {
        return fail(400, `Witness must be one of: ${db.APPROVERS.join(', ')}`);
      }
      if (!isValidDate(sessionDate)) return fail(400, 'sessionDate must be YYYY-MM-DD.');
      if (isFutureDate(sessionDate)) return fail(400, 'sessionDate cannot be in the future.');

      const result = db.createCheckins(database, {
        advisorIds,
        witness,
        sessionDate,
        photo: req.file.filename,
        submittedBy: req.user.name,
      });
      if (result.conflicts) {
        const who = result.conflicts.map((id) => names.get(id)).join(', ');
        return fail(409, `Already checked in for ${sessionDate}: ${who}`);
      }
      res.status(201).json({ ids: result.created, photoUrl: `/uploads/${req.file.filename}` });
    });
  });

  // Everyone logs in with their own password; Miguel and Frida can also approve.
  app.post('/api/login', auth.login);
  app.post('/api/logout', auth.logout);

  app.post('/api/checkins/:id/approve', auth.requireApprover, (req, res) => {
    if (!db.approveCheckin(database, Number(req.params.id), req.user.name)) {
      return res.status(404).json({ error: 'Check-in not found.' });
    }
    res.status(204).end();
  });

  // Rejecting a pending check-in and removing an approved one are the same operation.
  app.delete('/api/checkins/:id', auth.requireApprover, (req, res) => {
    const result = db.deleteCheckin(database, Number(req.params.id));
    if (!result) return res.status(404).json({ error: 'Check-in not found.' });
    removePhoto(result.orphanedPhoto);
    res.status(204).end();
  });

  app.use('/uploads', express.static(uploadDir, { fallthrough: false }));
  app.use(express.static(path.join(__dirname, '..', 'public')));

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong.' });
  });

  return app;
}

module.exports = { createApp };
