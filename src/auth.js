'use strict';

const crypto = require('node:crypto');

const COOKIE = 'cm_approver';
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
 * Password login for Miguel and Frida. Sessions are stateless signed cookies:
 * `<name>.<expiry>.<hmac>`. Changing the password or the secret signs everyone out.
 */
function createAuth({ password, secret, approvers, now = () => Date.now() }) {
  const enabled = typeof password === 'string' && password.length > 0;
  const key = sha256(`${secret || crypto.randomBytes(32).toString('hex')}:${password || ''}`);
  const passwordHash = sha256(password || '');
  const attempts = new Map(); // ip -> { count, resetAt }

  const sign = (payload) => crypto.createHmac('sha256', key).update(payload).digest('base64url');

  function issue(name) {
    const payload = `${encodeURIComponent(name)}.${now() + SESSION_MS}`;
    return `${payload}.${sign(payload)}`;
  }

  function verify(token) {
    if (!enabled || typeof token !== 'string') return null;
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = `${parts[0]}.${parts[1]}`;
    const expected = Buffer.from(sign(payload));
    const given = Buffer.from(parts[2]);
    if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return null;
    if (Number(parts[1]) < now()) return null;
    const name = decodeURIComponent(parts[0]);
    return approvers.includes(name) ? name : null;
  }

  function cookieHeader(req, value, maxAgeMs) {
    const secure = req.secure ? '; Secure' : '';
    return `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${Math.floor(maxAgeMs / 1000)}${secure}`;
  }

  function rateLimited(ip) {
    const entry = attempts.get(ip);
    if (!entry || entry.resetAt < now()) return false;
    return entry.count >= MAX_ATTEMPTS;
  }

  function recordFailure(ip) {
    const entry = attempts.get(ip);
    if (!entry || entry.resetAt < now()) attempts.set(ip, { count: 1, resetAt: now() + ATTEMPT_WINDOW_MS });
    else entry.count += 1;
  }

  return {
    enabled,

    /** Express middleware: sets req.approver to "Miguel"/"Frida" or null. */
    identify(req, _res, next) {
      req.approver = verify(parseCookies(req.headers.cookie)[COOKIE]);
      next();
    },

    requireApprover(req, res, next) {
      if (req.approver) return next();
      res.status(401).json({ error: 'Log in as Miguel or Frida to do that.' });
    },

    login(req, res) {
      if (!enabled) return res.status(503).json({ error: 'Approver login is not set up (no APPROVER_PASSWORD).' });
      const ip = req.ip || 'unknown';
      if (rateLimited(ip)) return res.status(429).json({ error: 'Too many attempts. Try again in 15 minutes.' });

      const { name, password: given } = req.body || {};
      if (!approvers.includes(name)) return res.status(400).json({ error: `Pick ${approvers.join(' or ')}.` });
      if (typeof given !== 'string' || !crypto.timingSafeEqual(sha256(given), passwordHash)) {
        recordFailure(ip);
        return res.status(401).json({ error: 'Wrong password.' });
      }
      attempts.delete(ip);
      res.setHeader('Set-Cookie', cookieHeader(req, issue(name), SESSION_MS));
      res.json({ approver: name });
    },

    logout(req, res) {
      res.setHeader('Set-Cookie', cookieHeader(req, '', 0));
      res.status(204).end();
    },
  };
}

module.exports = { createAuth };
