'use strict';

// A minimal express-session store backed by the app's SQLite database, so
// sessions survive restarts / machine auto-stop on the host.
const session = require('express-session');
const { db } = require('./db');

db.exec(`CREATE TABLE IF NOT EXISTS sessions (
  sid    TEXT PRIMARY KEY,
  sess   TEXT NOT NULL,
  expire INTEGER NOT NULL
);`);

const DEFAULT_TTL = 1000 * 60 * 60 * 24 * 30; // 30 days

class SqliteStore extends session.Store {
  constructor() {
    super();
    this._prune();
    this._timer = setInterval(() => this._prune(), 15 * 60 * 1000);
    if (this._timer.unref) this._timer.unref();
  }

  _prune() {
    try { db.prepare('DELETE FROM sessions WHERE expire < ?').run(Date.now()); } catch (_) {}
  }

  _expiry(sess) {
    const maxAge = sess && sess.cookie && sess.cookie.maxAge;
    return Date.now() + (typeof maxAge === 'number' && maxAge > 0 ? maxAge : DEFAULT_TTL);
  }

  get(sid, cb) {
    try {
      const row = db.prepare('SELECT sess, expire FROM sessions WHERE sid = ?').get(sid);
      if (!row) return cb(null, null);
      if (row.expire < Date.now()) { this.destroy(sid, () => {}); return cb(null, null); }
      return cb(null, JSON.parse(row.sess));
    } catch (e) { return cb(e); }
  }

  set(sid, sess, cb) {
    try {
      db.prepare(
        `INSERT INTO sessions (sid, sess, expire) VALUES (?, ?, ?)
         ON CONFLICT(sid) DO UPDATE SET sess = excluded.sess, expire = excluded.expire`
      ).run(sid, JSON.stringify(sess), this._expiry(sess));
      if (cb) cb(null);
    } catch (e) { if (cb) cb(e); }
  }

  touch(sid, sess, cb) {
    try {
      db.prepare('UPDATE sessions SET expire = ? WHERE sid = ?').run(this._expiry(sess), sid);
      if (cb) cb(null);
    } catch (e) { if (cb) cb(e); }
  }

  destroy(sid, cb) {
    try { db.prepare('DELETE FROM sessions WHERE sid = ?').run(sid); if (cb) cb(null); }
    catch (e) { if (cb) cb(e); }
  }

  length(cb) {
    try { cb(null, db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n); }
    catch (e) { cb(e); }
  }

  clear(cb) {
    try { db.prepare('DELETE FROM sessions').run(); if (cb) cb(null); }
    catch (e) { if (cb) cb(e); }
  }
}

module.exports = SqliteStore;
