'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, beforeEach, afterEach } = require('node:test');
const { openDb } = require('../src/db');
const { createApp } = require('../src/app');

// Smallest valid PNG (1x1 transparent pixel).
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64'
);

let server, base, uploadDir, tmp;

beforeEach(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cutwater-'));
  uploadDir = path.join(tmp, 'uploads');
  const app = createApp({
    database: openDb(':memory:'),
    uploadDir,
    trackLength: 10,
    adminToken: 'secret',
  });
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

afterEach(() => {
  server.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

function checkin({ advisors = ['alok'], witness = 'Miguel', sessionDate = '2026-09-01', photo = true } = {}) {
  const form = new FormData();
  for (const a of advisors) form.append('advisors', a);
  form.append('witness', witness);
  form.append('sessionDate', sessionDate);
  if (photo) form.append('photo', new Blob([PNG], { type: 'image/png' }), 'pic.png');
  return fetch(`${base}/api/checkins`, { method: 'POST', body: form });
}

const json = (url) => fetch(base + url).then((r) => r.json());
const uploads = () => fs.readdirSync(uploadDir);

test('config lists the three advisors and two witnesses', async () => {
  const cfg = await json('/api/config');
  assert.deepEqual(cfg.advisors.map((a) => a.name), ['Alok', 'Ethelyn', 'Jaansi']);
  assert.deepEqual(cfg.witnesses, ['Miguel', 'Frida']);
  assert.equal(cfg.trackLength, 10);
});

test('everyone starts tied at zero and on the hook for the milk mile', async () => {
  const { standings } = await json('/api/standings');
  assert.equal(standings.length, 3);
  assert.ok(standings.every((s) => s.sessions === 0 && s.milkMile));
});

test('a check-in moves the advisor up and stores the photo', async () => {
  const res = await checkin({ advisors: ['ethelyn'], witness: 'Frida' });
  assert.equal(res.status, 201);
  const { photoUrl } = await res.json();

  const { standings } = await json('/api/standings');
  assert.equal(standings[0].id, 'ethelyn');
  assert.equal(standings[0].sessions, 1);
  assert.equal(standings[0].progress, 0.1);
  assert.equal(standings[0].milkMile, false);
  assert.ok(standings.slice(1).every((s) => s.milkMile));

  const photo = await fetch(base + photoUrl);
  assert.equal(photo.status, 200);
  assert.deepEqual(Buffer.from(await photo.arrayBuffer()), PNG);

  const [row] = await json('/api/checkins');
  assert.equal(row.advisorName, 'Ethelyn');
  assert.equal(row.witness, 'Frida');
  assert.equal(row.sessionDate, '2026-09-01');
});

test('one group photo checks in several advisors', async () => {
  const res = await checkin({ advisors: ['alok', 'jaansi'] });
  assert.equal(res.status, 201);
  assert.equal((await res.json()).ids.length, 2);
  const { standings } = await json('/api/standings');
  assert.equal(standings.find((s) => s.id === 'ethelyn').milkMile, true);
  assert.equal(standings.filter((s) => s.milkMile).length, 1);
});

test('same advisor cannot check in twice for one session, and nothing is partially written', async () => {
  assert.equal((await checkin({ advisors: ['alok'] })).status, 201);
  const res = await checkin({ advisors: ['jaansi', 'alok'] });
  assert.equal(res.status, 409);
  assert.match((await res.json()).error, /Alok/);

  const { standings } = await json('/api/standings');
  assert.equal(standings.find((s) => s.id === 'jaansi').sessions, 0);
  assert.equal(uploads().length, 1, 'rejected upload is cleaned up');

  assert.equal((await checkin({ advisors: ['alok'], sessionDate: '2026-09-02' })).status, 201);
});

test('rejects bad input and cleans up the uploaded file', async () => {
  const cases = [
    [{ photo: false }, /photo/i],
    [{ advisors: [] }, /at least one/i],
    [{ advisors: ['bob'] }, /Unknown advisor/],
    [{ witness: 'Someone' }, /Witness/],
    [{ sessionDate: '2026-02-30' }, /YYYY-MM-DD/],
    [{ sessionDate: '2999-01-01' }, /future/],
  ];
  for (const [input, message] of cases) {
    const res = await checkin(input);
    assert.equal(res.status, 400, JSON.stringify(input));
    assert.match((await res.json()).error, message);
  }
  assert.deepEqual(uploads(), []);
});

test('rejects non-image uploads', async () => {
  const form = new FormData();
  form.append('advisors', 'alok');
  form.append('witness', 'Miguel');
  form.append('sessionDate', '2026-09-01');
  form.append('photo', new Blob(['hi'], { type: 'text/plain' }), 'x.txt');
  const res = await fetch(`${base}/api/checkins`, { method: 'POST', body: form });
  assert.equal(res.status, 400);
  assert.deepEqual(uploads(), []);
});

test('deleting requires the admin token and removes orphaned photos', async () => {
  const { ids } = await (await checkin({ advisors: ['alok', 'jaansi'] })).json();

  assert.equal((await fetch(`${base}/api/checkins/${ids[0]}`, { method: 'DELETE' })).status, 401);

  const del = (id) =>
    fetch(`${base}/api/checkins/${id}`, { method: 'DELETE', headers: { 'x-admin-token': 'secret' } });
  assert.equal((await del(ids[0])).status, 204);
  assert.equal(uploads().length, 1, 'photo still used by the other check-in');
  assert.equal((await del(ids[1])).status, 204);
  assert.deepEqual(uploads(), []);
  assert.equal((await del(ids[1])).status, 404);
});

test('serves the frontend', async () => {
  const res = await fetch(base + '/');
  assert.equal(res.status, 200);
  assert.match(await res.text(), /CUTWATER/);
});
