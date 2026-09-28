'use strict';

const crypto = require('node:crypto');

const COOKIE = 'cm_session';
const SESSION_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest();
}

function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

/**
 * Parses "Name:password,Name:password" into { Name: password }, matching names
 * case-insensitively against `people`. Unknown names are reported, not silently kept.
 */
function parsePasswords(spec, people) {
  const accounts = {};
  const unknown = [];
  for (const entry of String(spec || '').split(',')) {
    const i = entry.indexOf(':');
    if (i <= 0) continue;
    const given = entry.slice(0, i).trim();
    const password = entry.slice(i + 1).trim();
    const name = people.find((p) => p.toLowerCase() === given.toLowerCase());
    if (!name) unknown.push(given);
    else if (password) accounts[name] = password;
  }
  return { accounts, unknown };
}

/**
 * Per-person password login. Sessions are stateless signed cookies:
 * `<name>.<expiry>.<hmac>`. Changing a person's password signs them out.
 */
function createAuth({ accounts, approvers, secret, now = () => Date.now() }) {
  const serverKey = sha256(secret || crypto.randomBytes(32).toString('hex'));
  const passwordHashes = new Map(Object.entries(accounts).map(([name, pw]) => [name, sha256(pw)]));
  const attempts = new Map(); // ip -> { count, resetAt }

  // Each person's signing key includes their password, so changing it revokes their sessions.
  const sign = (name, payload) =>
    crypto.createHmac('sha256', serverKey).update(`${accounts[name]}\n${payload}`).digest('base64url');

  function issue(name) {
    const payload = `${encodeURIComponent(name)}.${now() + SESSION_MS}`;
    return `${payload}.${sign(name, payload)}`;
  }

  function verify(token) {
    if (typeof token !== 'string') return null;
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const name = decodeURIComponent(parts[0]);
    if (!passwordHashes.has(name)) return null;
    const payload = `${parts[0]}.${parts[1]}`;
    const expected = Buffer.from(sign(name, payload));
    const given = Buffer.from(parts[2]);
    if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return null;
    if (Number(parts[1]) < now()) return null;
    return { name, approver: approvers.includes(name) };
  }

  function cookieHeader(req, value, maxAgeMs) {
    const secure = req.secure ? '; Secure' : '';
    return `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${Math.floor(maxAgeMs / 1000)}${secure}`;
  }

  function rateLimited(ip) {
    const entry = attempts.get(ip);
    return Boolean(entry && entry.resetAt >= now() && entry.count >= MAX_ATTEMPTS);
  }

  function recordFailure(ip) {
    const entry = attempts.get(ip);
    if (!entry || entry.resetAt < now()) attempts.set(ip, { count: 1, resetAt: now() + ATTEMPT_WINDOW_MS });
    else entry.count += 1;
  }

  return {
    /** Names that can log in. */
    people: [...passwordHashes.keys()],

    /** Express middleware: sets req.user to { name, approver } or null. */
    identify(req, _res, next) {
      req.user = verify(parseCookies(req.headers.cookie)[COOKIE]);
      next();
    },

    requireLogin(req, res, next) {
      if (req.user) return next();
      res.status(401).json({ error: 'Log in to do that.' });
    },

    requireApprover(req, res, next) {
      if (req.user?.approver) return next();
      res.status(req.user ? 403 : 401).json({ error: 'Only Miguel or Frida can do that.' });
    },

    login(req, res) {
      const ip = req.ip || 'unknown';
      if (rateLimited(ip)) return res.status(429).json({ error: 'Too many attempts. Try again in 15 minutes.' });

      const { name, password } = req.body || {};
      const expected = passwordHashes.get(name);
      if (!expected) return res.status(400).json({ error: 'Pick your name.' });
      if (typeof password !== 'string' || !crypto.timingSafeEqual(sha256(password), expected)) {
        recordFailure(ip);
        return res.status(401).json({ error: 'Wrong password.' });
      }
      attempts.delete(ip);
      res.setHeader('Set-Cookie', cookieHeader(req, issue(name), SESSION_MS));
      res.json({ user: { name, approver: approvers.includes(name) } });
    },

    logout(req, res) {
      res.setHeader('Set-Cookie', cookieHeader(req, '', 0));
      res.status(204).end();
    },
  };
}

module.exports = { createAuth, parsePasswords };
