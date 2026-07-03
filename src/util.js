'use strict';

const { CONFIG } = require('./constants');

const now = () => Date.now();

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateEmail(email) {
  return typeof email === 'string' && email.length <= 254 && EMAIL_RE.test(email);
}

function validateUsername(username) {
  return typeof username === 'string' && /^[a-zA-Z0-9_.-]{3,24}$/.test(username);
}

function validatePassword(pw) {
  return typeof pw === 'string' && pw.length >= 8 && pw.length <= 200;
}

// Trim + collapse to a safe stored string
function cleanText(v, max) {
  if (typeof v !== 'string') return '';
  const t = v.trim();
  return max ? t.slice(0, max) : t;
}

// Wrap an async express handler so thrown errors hit the error middleware
function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

// Standard JSON error responder
function fail(res, status, message) {
  return res.status(status).json({ error: message });
}

function requireAuth(req, res, next) {
  if (!req.session || !req.session.userId) {
    return fail(res, 401, 'You must be logged in to do that.');
  }
  next();
}

module.exports = {
  now,
  escapeHtml,
  validateEmail,
  validateUsername,
  validatePassword,
  cleanText,
  asyncHandler,
  fail,
  requireAuth,
  CONFIG,
};
