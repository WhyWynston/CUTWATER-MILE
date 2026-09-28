'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { openDb } = require('./src/db');
const { createApp } = require('./src/app');

const dataDir = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
fs.mkdirSync(dataDir, { recursive: true });

if (!process.env.APPROVER_PASSWORD) {
  console.warn('APPROVER_PASSWORD is not set: nobody can approve check-ins until it is.');
}

const app = createApp({
  database: openDb(path.join(dataDir, 'attendance.db')),
  uploadDir: path.join(dataDir, 'uploads'),
  approverPassword: process.env.APPROVER_PASSWORD,
  // Without a fixed secret, approvers are signed out whenever the server restarts.
  sessionSecret: process.env.SESSION_SECRET,
  // Set when running behind a hosting proxy (Railway, Render, Fly) so cookies are marked Secure.
  trustProxy: process.env.TRUST_PROXY ? Number(process.env.TRUST_PROXY) || process.env.TRUST_PROXY : false,
});

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => console.log(`Cutwater Mile running at http://localhost:${port}`));
