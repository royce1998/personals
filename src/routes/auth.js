'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const { db } = require('../db');
const { CONFIG } = require('../constants');
const {
  now, validateEmail, validateUsername, validatePassword,
  asyncHandler, fail,
} = require('../util');

const router = express.Router();

function publicUser(u) {
  if (!u) return null;
  return { id: u.id, email: u.email, username: u.username, created_at: u.created_at };
}

// POST /api/auth/register
router.post('/register', asyncHandler(async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');

  if (!validateEmail(email)) return fail(res, 400, 'Please enter a valid email address.');
  if (!validateUsername(username)) {
    return fail(res, 400, 'Username must be 3-24 characters (letters, numbers, . _ -).');
  }
  if (!validatePassword(password)) {
    return fail(res, 400, 'Password must be at least 8 characters.');
  }

  const existsEmail = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existsEmail) return fail(res, 409, 'An account with that email already exists.');
  const existsUser = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (existsUser) return fail(res, 409, 'That username is taken.');

  const hash = await bcrypt.hash(password, CONFIG.BCRYPT_ROUNDS);
  const ts = now();
  const info = db.prepare(
    'INSERT INTO users (email, username, password_hash, created_at) VALUES (?, ?, ?, ?)'
  ).run(email, username, hash, ts);

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
  req.session.userId = user.id;
  res.status(201).json({ user: publicUser(user) });
}));

// POST /api/auth/login
router.post('/login', asyncHandler(async (req, res) => {
  const identifier = String(req.body.identifier || req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  if (!identifier || !password) return fail(res, 400, 'Enter your email/username and password.');

  const user = db.prepare(
    'SELECT * FROM users WHERE email = ? OR username = ?'
  ).get(identifier, String(req.body.identifier || '').trim());

  if (!user) return fail(res, 401, 'Invalid credentials.');
  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return fail(res, 401, 'Invalid credentials.');

  req.session.userId = user.id;
  res.json({ user: publicUser(user) });
}));

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('connect.sid');
    res.json({ ok: true });
  });
});

// GET /api/auth/me
router.get('/me', (req, res) => {
  if (!req.session || !req.session.userId) return res.json({ user: null });
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
  res.json({ user: publicUser(user) });
});

module.exports = { router, publicUser };
