'use strict';

const crypto = require('crypto');

const SESSION_TTL = 12 * 60 * 60 * 1000;
const LOGIN_WINDOW = 15 * 60 * 1000;
const LOGIN_LIMIT = 5;

function parseCookies(req) {
  const cookies = {};
  for (const item of String(req.headers.cookie || '').split(';')) {
    const index = item.indexOf('=');
    if (index <= 0) continue;
    try {
      cookies[item.slice(0, index).trim()] = decodeURIComponent(item.slice(index + 1));
    } catch (error) {}
  }
  return cookies;
}

function createAdminAuth(adminPin) {
  if (!/^\d{5,12}$/.test(adminPin)) {
    throw new Error('ADMIN_PIN must contain 5-12 digits');
  }

  const sessions = new Map();
  const loginAttempts = new Map();

  function isAdmin(req) {
    const token = parseCookies(req).admin_session;
    const expiresAt = token && sessions.get(token);
    if (!expiresAt || expiresAt < Date.now()) {
      if (token) sessions.delete(token);
      return false;
    }
    return true;
  }

  function requireAdmin(req, res, next) {
    if (!isAdmin(req)) return res.status(401).json({ error: 'Admin login required' });
    next();
  }

  function login(req, res) {
    const attemptKey = req.ip;
    const now = Date.now();
    const attempts = (loginAttempts.get(attemptKey) || [])
      .filter((time) => now - time < LOGIN_WINDOW);
    if (attempts.length >= LOGIN_LIMIT) {
      return res.status(429).json({ error: 'Too many PIN attempts. Try again later.' });
    }

    const supplied = String(req.body.pin || '');
    const suppliedBuffer = Buffer.from(supplied);
    const expectedBuffer = Buffer.from(adminPin);
    const valid = suppliedBuffer.length === expectedBuffer.length
      && crypto.timingSafeEqual(suppliedBuffer, expectedBuffer);
    if (!valid) {
      attempts.push(now);
      loginAttempts.set(attemptKey, attempts);
      return res.status(401).json({ error: 'Invalid PIN' });
    }

    loginAttempts.delete(attemptKey);
    const token = crypto.randomBytes(32).toString('hex');
    sessions.set(token, now + SESSION_TTL);
    const secure = req.secure ? '; Secure' : '';
    res.setHeader(
      'Set-Cookie',
      `admin_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL / 1000}${secure}`
    );
    return res.json({ ok: true });
  }

  function logout(req, res) {
    const token = parseCookies(req).admin_session;
    if (token) sessions.delete(token);
    res.setHeader('Set-Cookie', 'admin_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
    return res.json({ ok: true });
  }

  return { isAdmin, login, logout, requireAdmin };
}

module.exports = { createAdminAuth };
