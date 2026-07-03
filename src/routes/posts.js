'use strict';

const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const { db } = require('../db');
const { UPLOAD_DIR } = require('../paths');
const { CATEGORY_SLUGS, CONFIG } = require('../constants');
const {
  now, cleanText, asyncHandler, fail, requireAuth,
} = require('../util');

const router = express.Router();

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);
const EXT_BY_MIME = {
  'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif', 'image/webp': '.webp',
};

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = EXT_BY_MIME[file.mimetype] || '.bin';
    cb(null, `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: CONFIG.MAX_IMAGE_BYTES, files: CONFIG.MAX_IMAGES_PER_POST },
  fileFilter: (req, file, cb) => {
    if (ALLOWED_MIME.has(file.mimetype)) return cb(null, true);
    cb(new Error('Only JPEG, PNG, GIF, or WebP images are allowed.'));
  },
});

// ---- helpers ----------------------------------------------------------------

function imagesFor(postId) {
  return db.prepare(
    'SELECT filename, position FROM post_images WHERE post_id = ? ORDER BY position, id'
  ).all(postId).map((r) => ({ url: `/uploads/${r.filename}`, filename: r.filename }));
}

function serialize(post, viewerId) {
  const author = db.prepare('SELECT username FROM users WHERE id = ?').get(post.user_id);
  const favRow = viewerId
    ? db.prepare('SELECT 1 AS f FROM favorites WHERE user_id = ? AND post_id = ?').get(viewerId, post.id)
    : null;
  return {
    id: post.id,
    category: post.category,
    title: post.title,
    body: post.body,
    city: post.city,
    age: post.age,
    gender: post.gender,
    seeking: post.seeking,
    contact_pref: post.contact_pref,
    status: post.status,
    flag_count: post.flag_count,
    created_at: post.created_at,
    updated_at: post.updated_at,
    expires_at: post.expires_at,
    author: author ? author.username : '[deleted]',
    author_id: post.user_id,
    is_owner: viewerId === post.user_id,
    is_favorite: !!favRow,
    images: imagesFor(post.id),
  };
}

// Lazily flip expired posts to 'expired' so browsing stays accurate.
function sweepExpired() {
  db.prepare("UPDATE posts SET status = 'expired' WHERE status = 'active' AND expires_at < ?")
    .run(now());
}

function validatePostFields(body) {
  const category = cleanText(body.category, 64);
  if (!CATEGORY_SLUGS.has(category)) return { error: 'Please choose a valid category.' };

  const title = cleanText(body.title, CONFIG.TITLE_MAX);
  if (title.length < 3) return { error: 'Title must be at least 3 characters.' };

  const text = cleanText(body.body, CONFIG.BODY_MAX);
  if (text.length < 10) return { error: 'Body must be at least 10 characters.' };

  const city = cleanText(body.city, 64);
  if (!city) return { error: 'Please choose a location.' };

  let age = null;
  if (body.age !== undefined && body.age !== null && String(body.age).trim() !== '') {
    age = parseInt(body.age, 10);
    if (!Number.isInteger(age) || age < CONFIG.MIN_AGE || age > CONFIG.MAX_AGE) {
      return { error: `Age must be between ${CONFIG.MIN_AGE} and ${CONFIG.MAX_AGE}.` };
    }
  }

  const gender = cleanText(body.gender, 32) || null;
  const seeking = cleanText(body.seeking, 32) || null;
  const contact_pref = ['onsite', 'both'].includes(body.contact_pref) ? body.contact_pref : 'onsite';

  return { data: { category, title, body: text, city, age, gender, seeking, contact_pref } };
}

function removeImageFiles(postId) {
  const rows = db.prepare('SELECT filename FROM post_images WHERE post_id = ?').all(postId);
  for (const r of rows) {
    const fp = path.join(UPLOAD_DIR, r.filename);
    fs.promises.unlink(fp).catch(() => {});
  }
}

// ---- routes -----------------------------------------------------------------

// GET /api/posts  — browse/search with filters + pagination
router.get('/', (req, res) => {
  sweepExpired();
  const viewerId = req.session.userId || null;
  const where = ["status = 'active'"];
  const params = [];

  const category = cleanText(req.query.category, 64);
  if (category && CATEGORY_SLUGS.has(category)) { where.push('category = ?'); params.push(category); }

  const city = cleanText(req.query.city, 64);
  if (city) { where.push('city = ?'); params.push(city); }

  const q = cleanText(req.query.q, 100);
  if (q) { where.push('(title LIKE ? OR body LIKE ?)'); params.push(`%${q}%`, `%${q}%`); }

  const minAge = parseInt(req.query.minAge, 10);
  if (Number.isInteger(minAge)) { where.push('age >= ?'); params.push(minAge); }
  const maxAge = parseInt(req.query.maxAge, 10);
  if (Number.isInteger(maxAge)) { where.push('age <= ?'); params.push(maxAge); }

  const hasImages = req.query.hasImages === 'true' || req.query.hasImages === '1';
  if (hasImages) where.push('id IN (SELECT post_id FROM post_images)');

  const sort = req.query.sort === 'oldest' ? 'ASC' : 'DESC';
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = CONFIG.PAGE_SIZE;
  const offset = (page - 1) * limit;

  const whereSql = where.join(' AND ');
  const total = db.prepare(`SELECT COUNT(*) AS n FROM posts WHERE ${whereSql}`).get(...params).n;
  const rows = db.prepare(
    `SELECT * FROM posts WHERE ${whereSql} ORDER BY created_at ${sort} LIMIT ? OFFSET ?`
  ).all(...params, limit, offset);

  res.json({
    posts: rows.map((p) => serialize(p, viewerId)),
    page,
    pageSize: limit,
    total,
    totalPages: Math.max(1, Math.ceil(total / limit)),
  });
});

// GET /api/posts/mine — the logged-in user's own posts (any status)
router.get('/mine', requireAuth, (req, res) => {
  sweepExpired();
  const rows = db.prepare('SELECT * FROM posts WHERE user_id = ? ORDER BY created_at DESC')
    .all(req.session.userId);
  res.json({ posts: rows.map((p) => serialize(p, req.session.userId)) });
});

// GET /api/posts/favorites — the logged-in user's favorited posts
router.get('/favorites', requireAuth, (req, res) => {
  const rows = db.prepare(
    `SELECT p.* FROM posts p
     JOIN favorites f ON f.post_id = p.id
     WHERE f.user_id = ? ORDER BY f.created_at DESC`
  ).all(req.session.userId);
  res.json({ posts: rows.map((p) => serialize(p, req.session.userId)) });
});

// GET /api/posts/:id — single post
router.get('/:id', (req, res) => {
  const viewerId = req.session.userId || null;
  const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(req.params.id);
  if (!post) return fail(res, 404, 'That post no longer exists.');
  if (post.status === 'removed' && post.user_id !== viewerId) {
    return fail(res, 404, 'That post is no longer available.');
  }
  res.json({ post: serialize(post, viewerId) });
});

// POST /api/posts — create (multipart: fields + up to N images)
router.post('/', requireAuth, upload.array('images', CONFIG.MAX_IMAGES_PER_POST),
  asyncHandler(async (req, res) => {
    const v = validatePostFields(req.body);
    if (v.error) {
      (req.files || []).forEach((f) => fs.promises.unlink(f.path).catch(() => {}));
      return fail(res, 400, v.error);
    }
    const ts = now();
    const expires = ts + CONFIG.POST_EXPIRY_DAYS * 24 * 3600 * 1000;
    const d = v.data;
    const info = db.prepare(
      `INSERT INTO posts (user_id, category, title, body, city, age, gender, seeking,
        contact_pref, status, created_at, updated_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`
    ).run(req.session.userId, d.category, d.title, d.body, d.city, d.age, d.gender,
      d.seeking, d.contact_pref, ts, ts, expires);

    const postId = info.lastInsertRowid;
    (req.files || []).forEach((f, i) => {
      db.prepare('INSERT INTO post_images (post_id, filename, position) VALUES (?, ?, ?)')
        .run(postId, f.filename, i);
    });

    const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(postId);
    res.status(201).json({ post: serialize(post, req.session.userId) });
  }));

// PATCH /api/posts/:id — edit own post (fields only; images via separate endpoints)
router.patch('/:id', requireAuth, express.json(), (req, res) => {
  const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(req.params.id);
  if (!post) return fail(res, 404, 'That post no longer exists.');
  if (post.user_id !== req.session.userId) return fail(res, 403, 'You can only edit your own posts.');

  const merged = {
    category: req.body.category ?? post.category,
    title: req.body.title ?? post.title,
    body: req.body.body ?? post.body,
    city: req.body.city ?? post.city,
    age: req.body.age ?? post.age,
    gender: req.body.gender ?? post.gender,
    seeking: req.body.seeking ?? post.seeking,
    contact_pref: req.body.contact_pref ?? post.contact_pref,
  };
  const v = validatePostFields(merged);
  if (v.error) return fail(res, 400, v.error);
  const d = v.data;
  db.prepare(
    `UPDATE posts SET category=?, title=?, body=?, city=?, age=?, gender=?, seeking=?,
      contact_pref=?, updated_at=? WHERE id=?`
  ).run(d.category, d.title, d.body, d.city, d.age, d.gender, d.seeking, d.contact_pref,
    now(), post.id);

  const updated = db.prepare('SELECT * FROM posts WHERE id = ?').get(post.id);
  res.json({ post: serialize(updated, req.session.userId) });
});

// POST /api/posts/:id/repost — renew an expired/active post for another cycle
router.post('/:id/repost', requireAuth, (req, res) => {
  const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(req.params.id);
  if (!post) return fail(res, 404, 'That post no longer exists.');
  if (post.user_id !== req.session.userId) return fail(res, 403, 'You can only repost your own posts.');
  const ts = now();
  const expires = ts + CONFIG.POST_EXPIRY_DAYS * 24 * 3600 * 1000;
  db.prepare("UPDATE posts SET status='active', created_at=?, updated_at=?, expires_at=? WHERE id=?")
    .run(ts, ts, expires, post.id);
  const updated = db.prepare('SELECT * FROM posts WHERE id = ?').get(post.id);
  res.json({ post: serialize(updated, req.session.userId) });
});

// DELETE /api/posts/:id — delete own post (removes images from disk too)
router.delete('/:id', requireAuth, (req, res) => {
  const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(req.params.id);
  if (!post) return fail(res, 404, 'That post no longer exists.');
  if (post.user_id !== req.session.userId) return fail(res, 403, 'You can only delete your own posts.');
  removeImageFiles(post.id);
  db.prepare('DELETE FROM posts WHERE id = ?').run(post.id);
  res.json({ ok: true });
});

// POST /api/posts/:id/favorite — toggle favorite
router.post('/:id/favorite', requireAuth, (req, res) => {
  const post = db.prepare('SELECT id FROM posts WHERE id = ?').get(req.params.id);
  if (!post) return fail(res, 404, 'That post no longer exists.');
  const existing = db.prepare('SELECT 1 FROM favorites WHERE user_id = ? AND post_id = ?')
    .get(req.session.userId, post.id);
  if (existing) {
    db.prepare('DELETE FROM favorites WHERE user_id = ? AND post_id = ?').run(req.session.userId, post.id);
    return res.json({ favorite: false });
  }
  db.prepare('INSERT INTO favorites (user_id, post_id, created_at) VALUES (?, ?, ?)')
    .run(req.session.userId, post.id, now());
  res.json({ favorite: true });
});

// POST /api/posts/:id/flag — report a post
router.post('/:id/flag', requireAuth, express.json(), (req, res) => {
  const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(req.params.id);
  if (!post) return fail(res, 404, 'That post no longer exists.');
  if (post.user_id === req.session.userId) return fail(res, 400, 'You cannot flag your own post.');

  const already = db.prepare('SELECT 1 FROM flags WHERE user_id = ? AND post_id = ?')
    .get(req.session.userId, post.id);
  if (already) return res.json({ ok: true, alreadyFlagged: true });

  const reason = cleanText(req.body && req.body.reason, 200) || null;
  db.prepare('INSERT INTO flags (user_id, post_id, reason, created_at) VALUES (?, ?, ?, ?)')
    .run(req.session.userId, post.id, reason, now());
  const count = db.prepare('SELECT COUNT(*) AS n FROM flags WHERE post_id = ?').get(post.id).n;
  let status = post.status;
  if (count >= CONFIG.FLAG_HIDE_THRESHOLD) status = 'removed';
  db.prepare('UPDATE posts SET flag_count = ?, status = ? WHERE id = ?').run(count, status, post.id);
  res.json({ ok: true, flag_count: count });
});

module.exports = { router, UPLOAD_DIR };
