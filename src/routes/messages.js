'use strict';

const express = require('express');
const { db } = require('../db');
const { now, cleanText, fail, requireAuth } = require('../util');

const router = express.Router();
router.use(express.json());

const MSG_MAX = 4000;

// Shape a conversation row for the current viewer (anonymized counterpart).
function serializeConversation(conv, viewerId) {
  const post = db.prepare('SELECT id, title, status FROM posts WHERE id = ?').get(conv.post_id);
  const isPoster = conv.poster_id === viewerId;
  // The other party stays anonymous: posters see "Replier", repliers see "Poster".
  const counterpart = isPoster ? 'Replier' : 'Poster';
  const lastMsg = db.prepare(
    'SELECT body, created_at, sender_id FROM messages WHERE conversation_id = ? ORDER BY id DESC LIMIT 1'
  ).get(conv.id);
  const unread = db.prepare(
    'SELECT COUNT(*) AS n FROM messages WHERE conversation_id = ? AND sender_id != ? AND read_at IS NULL'
  ).get(conv.id, viewerId).n;
  return {
    id: conv.id,
    post_id: conv.post_id,
    post_title: post ? post.title : '[deleted post]',
    post_status: post ? post.status : 'removed',
    role: isPoster ? 'poster' : 'replier',
    counterpart,
    last_message: lastMsg ? lastMsg.body : null,
    last_at: lastMsg ? lastMsg.created_at : conv.created_at,
    unread,
    updated_at: conv.updated_at,
  };
}

// POST /api/messages/reply/:postId — start (or continue) a conversation on a post
router.post('/reply/:postId', requireAuth, (req, res) => {
  const viewerId = req.session.userId;
  const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(req.params.postId);
  if (!post) return fail(res, 404, 'That post no longer exists.');
  if (post.status !== 'active') return fail(res, 400, 'That post is no longer accepting replies.');
  if (post.user_id === viewerId) return fail(res, 400, 'You cannot reply to your own post.');

  const body = cleanText(req.body.body, MSG_MAX);
  if (body.length < 1) return fail(res, 400, 'Your message is empty.');

  let conv = db.prepare('SELECT * FROM conversations WHERE post_id = ? AND replier_id = ?')
    .get(post.id, viewerId);
  const ts = now();
  if (!conv) {
    const info = db.prepare(
      `INSERT INTO conversations (post_id, poster_id, replier_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`
    ).run(post.id, post.user_id, viewerId, ts, ts);
    conv = db.prepare('SELECT * FROM conversations WHERE id = ?').get(info.lastInsertRowid);
  }
  db.prepare('INSERT INTO messages (conversation_id, sender_id, body, created_at) VALUES (?, ?, ?, ?)')
    .run(conv.id, viewerId, body, ts);
  db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(ts, conv.id);

  res.status(201).json({ conversation_id: conv.id });
});

// GET /api/messages/conversations — inbox list (poster + replier threads)
router.get('/conversations', requireAuth, (req, res) => {
  const viewerId = req.session.userId;
  const rows = db.prepare(
    `SELECT * FROM conversations WHERE poster_id = ? OR replier_id = ? ORDER BY updated_at DESC`
  ).all(viewerId, viewerId);
  res.json({ conversations: rows.map((c) => serializeConversation(c, viewerId)) });
});

// GET /api/messages/unread-count — total unread messages for badge
router.get('/unread-count', requireAuth, (req, res) => {
  const viewerId = req.session.userId;
  const n = db.prepare(
    `SELECT COUNT(*) AS n FROM messages m
     JOIN conversations c ON c.id = m.conversation_id
     WHERE (c.poster_id = ? OR c.replier_id = ?)
       AND m.sender_id != ? AND m.read_at IS NULL`
  ).get(viewerId, viewerId, viewerId).n;
  res.json({ unread: n });
});

// GET /api/messages/conversations/:id — full thread (marks incoming as read)
router.get('/conversations/:id', requireAuth, (req, res) => {
  const viewerId = req.session.userId;
  const conv = db.prepare('SELECT * FROM conversations WHERE id = ?').get(req.params.id);
  if (!conv) return fail(res, 404, 'Conversation not found.');
  if (conv.poster_id !== viewerId && conv.replier_id !== viewerId) {
    return fail(res, 403, 'You are not part of this conversation.');
  }
  db.prepare('UPDATE messages SET read_at = ? WHERE conversation_id = ? AND sender_id != ? AND read_at IS NULL')
    .run(now(), conv.id, viewerId);

  const msgs = db.prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY id ASC')
    .all(conv.id).map((m) => ({
      id: m.id,
      body: m.body,
      created_at: m.created_at,
      mine: m.sender_id === viewerId,
    }));

  res.json({
    conversation: serializeConversation(conv, viewerId),
    messages: msgs,
  });
});

// POST /api/messages/conversations/:id — send a reply in an existing thread
router.post('/conversations/:id', requireAuth, (req, res) => {
  const viewerId = req.session.userId;
  const conv = db.prepare('SELECT * FROM conversations WHERE id = ?').get(req.params.id);
  if (!conv) return fail(res, 404, 'Conversation not found.');
  if (conv.poster_id !== viewerId && conv.replier_id !== viewerId) {
    return fail(res, 403, 'You are not part of this conversation.');
  }
  const body = cleanText(req.body.body, MSG_MAX);
  if (body.length < 1) return fail(res, 400, 'Your message is empty.');
  const ts = now();
  const info = db.prepare(
    'INSERT INTO messages (conversation_id, sender_id, body, created_at) VALUES (?, ?, ?, ?)'
  ).run(conv.id, viewerId, body, ts);
  db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(ts, conv.id);
  res.status(201).json({
    message: { id: info.lastInsertRowid, body, created_at: ts, mine: true },
  });
});

module.exports = { router };
