'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { openDb } = require('./src/db');
const { createApp } = require('./src/app');

const dataDir = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
fs.mkdirSync(dataDir, { recursive: true });

const app = createApp({
  database: openDb(path.join(dataDir, 'attendance.db')),
  uploadDir: path.join(dataDir, 'uploads'),
  trackLength: Number(process.env.TRACK_LENGTH) || 20,
  adminToken: process.env.ADMIN_TOKEN,
});

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => console.log(`Cutwater Mile running at http://localhost:${port}`));
