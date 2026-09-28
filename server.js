'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { openDb } = require('./src/db');
const { createApp } = require('./src/app');

// Deliberately simple: this is a small internal tool for the five of us.
const DEFAULT_PASSWORDS = 'Miguel:dog,Frida:cat,Jaansi:orange,Alok:brown,Ethelyn:blueprint';

const dataDir = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
fs.mkdirSync(dataDir, { recursive: true });

const app = createApp({
  database: openDb(path.join(dataDir, 'attendance.db')),
  uploadDir: path.join(dataDir, 'uploads'),
  // "Name:password,Name:password". Set PASSWORDS to override these defaults.
  passwords: process.env.PASSWORDS || DEFAULT_PASSWORDS,
  // Without a fixed secret, everyone is signed out whenever the server restarts.
  sessionSecret: process.env.SESSION_SECRET,
  // Set when running behind a hosting proxy (Railway, Render, Fly) so cookies are marked Secure.
  trustProxy: process.env.TRUST_PROXY ? Number(process.env.TRUST_PROXY) || process.env.TRUST_PROXY : false,
});

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => console.log(`Cutwater Mile running at http://localhost:${port}`));
