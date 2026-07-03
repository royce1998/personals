'use strict';

const path = require('path');
const express = require('express');
const session = require('express-session');
const multer = require('multer');

const { CATEGORIES, CITIES, CONFIG } = require('./constants');
const authRoutes = require('./routes/auth');
const postRoutes = require('./routes/posts');
const messageRoutes = require('./routes/messages');

const app = express();
const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

app.set('trust proxy', 1);

// Body parsers (multipart handled per-route by multer)
app.use(express.urlencoded({ extended: false }));

app.use(session({
  name: 'connect.sid',
  secret: process.env.SESSION_SECRET || 'dev-only-change-me-in-production',
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 1000 * 60 * 60 * 24 * 30, // 30 days
  },
}));

// Static assets
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads'), {
  maxAge: '7d',
  index: false,
}));
app.use(express.static(PUBLIC_DIR, { index: false, extensions: ['html'] }));

// Metadata for the client (categories + cities + limits)
app.get('/api/meta', (req, res) => {
  res.json({
    categories: CATEGORIES,
    cities: CITIES,
    limits: {
      maxImages: CONFIG.MAX_IMAGES_PER_POST,
      maxImageBytes: CONFIG.MAX_IMAGE_BYTES,
      titleMax: CONFIG.TITLE_MAX,
      bodyMax: CONFIG.BODY_MAX,
      minAge: CONFIG.MIN_AGE,
      maxAge: CONFIG.MAX_AGE,
      expiryDays: CONFIG.POST_EXPIRY_DAYS,
    },
  });
});

app.get('/api/health', (req, res) => res.json({ ok: true, time: Date.now() }));

// API routes
app.use('/api/auth', express.json(), authRoutes.router);
app.use('/api/posts', postRoutes.router);
app.use('/api/messages', messageRoutes.router);

// SPA entry — serve index.html for any non-API GET route
app.get(/^\/(?!api\/|uploads\/).*/, (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

// 404 for unknown API routes
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));

// Central error handler (multer + thrown errors)
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    const map = {
      LIMIT_FILE_SIZE: `Each image must be under ${Math.round(CONFIG.MAX_IMAGE_BYTES / 1024 / 1024)} MB.`,
      LIMIT_FILE_COUNT: `You can upload at most ${CONFIG.MAX_IMAGES_PER_POST} images.`,
      LIMIT_UNEXPECTED_FILE: 'Unexpected file field.',
    };
    return res.status(400).json({ error: map[err.code] || 'Upload error.' });
  }
  if (err && /images are allowed/i.test(err.message || '')) {
    return res.status(400).json({ error: err.message });
  }
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on our end.' });
});

app.listen(PORT, () => {
  console.log(`Personals running at http://localhost:${PORT}`);
});

module.exports = app;
