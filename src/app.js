'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const multer = require('multer');
const db = require('./db');

const MAX_PHOTO_BYTES = 15 * 1024 * 1024;
const IMAGE_EXTENSIONS = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/heic': '.heic',
  'image/heif': '.heif',
};

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

function createApp({ database, uploadDir, trackLength = 20, adminToken } = {}) {
  fs.mkdirSync(uploadDir, { recursive: true });

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

  const app = express();
  app.use(express.json());

  app.get('/api/config', (_req, res) => {
    res.json({ trackLength, witnesses: db.WITNESSES, advisors: db.listAdvisors(database) });
  });

  app.get('/api/standings', (_req, res) => {
    const standings = db.getStandings(database);
    const fewest = Math.min(...standings.map((s) => s.sessions));
    res.json({
      trackLength,
      standings: standings.map((s) => ({
        ...s,
        progress: Math.min(s.sessions / trackLength, 1),
        // Everyone tied for last is on the hook for the milk mile.
        milkMile: s.sessions === fewest,
      })),
    });
  });

  app.get('/api/checkins', (req, res) => {
    const rows = db.listCheckins(database, req.query.advisor);
    res.json(rows.map((r) => ({ ...r, photoUrl: `/uploads/${r.photo}` })));
  });

  app.post('/api/checkins', (req, res, next) => {
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
      if (!db.WITNESSES.includes(witness)) {
        return fail(400, `Witness must be one of: ${db.WITNESSES.join(', ')}`);
      }
      if (!isValidDate(sessionDate)) return fail(400, 'sessionDate must be YYYY-MM-DD.');
      if (isFutureDate(sessionDate)) return fail(400, 'sessionDate cannot be in the future.');

      const result = db.createCheckins(database, {
        advisorIds,
        witness,
        sessionDate,
        photo: req.file.filename,
      });
      if (result.conflicts) {
        return fail(409, `Already checked in for ${sessionDate}: ${result.conflicts.map((id) => names.get(id)).join(', ')}`);
      }
      res.status(201).json({ ids: result.created, photoUrl: `/uploads/${req.file.filename}` });
    });
  });

  app.delete('/api/checkins/:id', (req, res) => {
    if (!adminToken) return res.status(403).json({ error: 'Deleting is disabled (no ADMIN_TOKEN set).' });
    if (req.get('x-admin-token') !== adminToken) return res.status(401).json({ error: 'Bad admin token.' });
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
