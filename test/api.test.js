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
const PASSWORD = 'milk-mile-2026';

let server, base, uploadDir, tmp;

async function start(options = {}) {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cutwater-'));
  uploadDir = path.join(tmp, 'uploads');
  const app = createApp({
    database: openDb(':memory:'),
    uploadDir,
    approverPassword: PASSWORD,
    sessionSecret: 'test-secret',
    ...options,
  });
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
}

beforeEach(() => start());

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

async function login(name = 'Miguel', password = PASSWORD) {
  const res = await fetch(`${base}/api/approver/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, password }),
  });
  const cookie = res.headers.get('set-cookie')?.split(';')[0];
  return { res, cookie };
}

const json = (url, headers) => fetch(base + url, { headers }).then((r) => r.json());
const uploads = () => fs.readdirSync(uploadDir);
const approve = (id, cookie) =>
  fetch(`${base}/api/checkins/${id}/approve`, { method: 'POST', headers: cookie ? { cookie } : {} });
const remove = (id, cookie) =>
  fetch(`${base}/api/checkins/${id}`, { method: 'DELETE', headers: cookie ? { cookie } : {} });
const bySessions = (standings) => Object.fromEntries(standings.map((s) => [s.id, s.sessions]));

test('config lists the advisors and approvers', async () => {
  const cfg = await json('/api/config');
  assert.deepEqual(cfg.advisors.map((a) => a.name), ['Alok', 'Ethelyn', 'Jaansi']);
  assert.deepEqual(cfg.approvers, ['Miguel', 'Frida']);
  assert.equal(cfg.approverLoginEnabled, true);
  assert.equal(cfg.approver, null);
});

test('everyone starts at zero with nobody flagged for the milk mile', async () => {
  const { held, standings } = await json('/api/standings');
  assert.equal(held, 0);
  assert.ok(standings.every((s) => s.sessions === 0 && !s.milkMile && s.position === 0));
});

test('a new check-in is pending and does not count until approved', async () => {
  const res = await checkin({ advisors: ['ethelyn'], witness: 'Frida' });
  assert.equal(res.status, 201);
  const [id] = (await res.json()).ids;

  let { standings, held } = await json('/api/standings');
  assert.equal(held, 0);
  assert.equal(bySessions(standings).ethelyn, 0);
  assert.equal(standings.find((s) => s.id === 'ethelyn').pending, 1);
  const [row] = await json('/api/checkins?status=pending');
  assert.equal(row.approved, false);

  const { cookie } = await login('Frida');
  assert.equal((await approve(id, cookie)).status, 204);

  ({ standings, held } = await json('/api/standings'));
  assert.equal(held, 1);
  const ethelyn = standings.find((s) => s.id === 'ethelyn');
  assert.equal(ethelyn.sessions, 1);
  assert.equal(ethelyn.pending, 0);
  assert.equal(ethelyn.rate, 100);
  const [approved] = await json('/api/checkins?status=approved');
  assert.equal(approved.approvedBy, 'Frida');
});

test('approving and removing require the approver password', async () => {
  const [id] = (await (await checkin()).json()).ids;

  assert.equal((await approve(id)).status, 401);
  assert.equal((await remove(id)).status, 401);
  assert.equal((await approve(id, 'cm_approver=Miguel.99999999999999.forged')).status, 401);

  const bad = await login('Miguel', 'wrong');
  assert.equal(bad.res.status, 401);
  assert.equal(bad.cookie, undefined);
  assert.equal((await login('Bob')).res.status, 400);

  const { res, cookie } = await login('Miguel');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('set-cookie'), /HttpOnly/);
  assert.match(res.headers.get('set-cookie'), /SameSite=Strict/);
  assert.equal((await json('/api/config', { cookie })).approver, 'Miguel');
  assert.equal((await approve(id, cookie)).status, 204);
});

test('login is rate limited after repeated wrong passwords', async () => {
  for (let i = 0; i < 5; i++) assert.equal((await login('Miguel', 'nope')).res.status, 401);
  assert.equal((await login('Miguel', PASSWORD)).res.status, 429);
});

test('logout clears the approver session', async () => {
  const res = await fetch(`${base}/api/approver/logout`, { method: 'POST' });
  assert.equal(res.status, 204);
  assert.match(res.headers.get('set-cookie'), /Max-Age=0/);
});

test('approver login is disabled without a password', async () => {
  server.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  await start({ approverPassword: undefined });
  assert.equal((await json('/api/config')).approverLoginEnabled, false);
  assert.equal((await login('Miguel', '')).res.status, 503);
});

test('standings rank by approved attendance, place runners relative to the leader, and flag last place', async () => {
  const { cookie } = await login();
  const ids = [];
  for (const [advisors, date] of [
    [['ethelyn', 'alok', 'jaansi'], '2026-09-01'],
    [['ethelyn', 'alok'], '2026-09-08'],
    [['ethelyn'], '2026-09-15'],
    [['ethelyn'], '2026-09-22'],
  ]) {
    ids.push(...(await (await checkin({ advisors, sessionDate: date })).json()).ids);
  }
  for (const id of ids) await approve(id, cookie);
  await checkin({ advisors: ['jaansi'], sessionDate: '2026-09-23' }); // pending, doesn't count

  const { held, standings } = await json('/api/standings');
  assert.equal(held, 4);
  assert.deepEqual(standings.map((s) => s.id), ['ethelyn', 'alok', 'jaansi']);
  assert.deepEqual(bySessions(standings), { ethelyn: 4, alok: 2, jaansi: 1 });
  const s = Object.fromEntries(standings.map((r) => [r.id, r]));
  assert.equal(s.ethelyn.position, 0.85);
  assert.equal(s.alok.position, 0.425);
  assert.equal(s.alok.rate, 50);
  assert.equal(s.jaansi.milkMile, true);
  assert.equal(s.alok.milkMile, false);
  assert.equal(s.jaansi.pending, 1);
});

test('one group photo checks in several advisors', async () => {
  const res = await checkin({ advisors: ['alok', 'jaansi'] });
  assert.equal(res.status, 201);
  assert.equal((await res.json()).ids.length, 2);
  assert.equal(uploads().length, 1);
});

test('same advisor cannot check in twice for one date, and nothing is partially written', async () => {
  assert.equal((await checkin({ advisors: ['alok'] })).status, 201);
  const res = await checkin({ advisors: ['jaansi', 'alok'] });
  assert.equal(res.status, 409);
  assert.match((await res.json()).error, /Alok/);
  assert.equal((await json('/api/checkins?advisor=jaansi')).length, 0);
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

test('rejecting a check-in removes it and deletes photos nothing else uses', async () => {
  const { cookie } = await login('Frida');
  const { ids } = await (await checkin({ advisors: ['alok', 'jaansi'] })).json();

  assert.equal((await remove(ids[0], cookie)).status, 204);
  assert.equal(uploads().length, 1, 'photo still used by the other check-in');
  assert.equal((await remove(ids[1], cookie)).status, 204);
  assert.deepEqual(uploads(), []);
  assert.equal((await remove(ids[1], cookie)).status, 404);
  assert.equal((await approve(ids[1], cookie)).status, 404);
});

test('serves the frontend', async () => {
  const res = await fetch(base + '/');
  assert.equal(res.status, 200);
  assert.match(await res.text(), /Cutwater/);
});
