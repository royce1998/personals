'use strict';

// Centralized, env-overridable paths so the app works both locally and on a
// host with a mounted volume (e.g. Fly.io sets DATA_DIR / UPLOAD_DIR to /data).
const path = require('path');
const fs = require('fs');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'personals.db');
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, '..', 'uploads');

for (const dir of [DATA_DIR, path.dirname(DB_PATH), UPLOAD_DIR]) {
  try { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); } catch (_) {}
}

module.exports = { DATA_DIR, DB_PATH, UPLOAD_DIR };
