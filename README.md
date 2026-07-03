# Personals

A self-hosted, open-source replacement for the (deprecated) **Craigslist Personals** section.

### 🌐 Live demo: **https://royce1998.github.io/personals/**

> ⚠️ Adults only (18+). This project is intended for legal, consensual personal ads between adults.
>
> ℹ️ The live demo runs on **GitHub Pages** (static hosting), so the entire backend
> runs **in your browser** via IndexedDB. Every feature works, but data is stored
> per-browser and is **not shared between visitors**. For a real, shared,
> multi-user deployment, run the Node server (see below).

## Planned features

- **Categories** — Strictly Platonic, Women Seeking Women/Men, Men Seeking Women/Men, Misc Romance, Casual Encounters, Missed Connections, Rants & Raves
- **City / location filtering**
- **User accounts** — register, login, session-based auth (bcrypt-hashed passwords)
- **Post an ad** — title, body, age, category, city, image uploads
- **Browse & search** — filter by category/city, keyword search, pagination
- **Anonymous reply messaging** — reply to a post without exposing emails; posters get an in-app inbox
- **Favorites** — save posts you like
- **Manage your posts** — edit, delete, repost, auto-expiry
- **Moderation** — flag/report posts, auto-hide over a threshold
- **18+ age gate**

## Stack

- **Node.js + Express**
- **SQLite** via Node's built-in `node:sqlite` module — no native build tools required (needs Node **>= 22.5**)
- Session auth (`express-session`, `bcryptjs`)
- Image uploads (`multer`)
- Vanilla-JS single-page frontend (no build step)

## Project layout

```
src/
  server.js        Express app, sessions, static + SPA fallback, error handling
  db.js            SQLite schema (users, posts, images, conversations, messages, favorites, flags)
  constants.js     Categories, cities, limits/config
  util.js          Validation + helpers
  routes/
    auth.js        register / login / logout / me
    posts.js       browse/search, CRUD, image upload, repost, favorite, flag
    messages.js    anonymous replies + inbox threads
public/
  index.html       App shell + 18+ age gate
  css/style.css    Styles
  js/app.js        SPA (hash router + all views)
```

## Two ways to run

**1. Static (GitHub Pages / any static host) — zero backend**
The SPA auto-detects static hosting (`*.github.io` or opened as a file) and routes
all API calls to an in-browser backend (`public/js/local-backend.js`) that mirrors
the real API 1:1, persisting to IndexedDB. Just publish the `public/` folder.
This repo auto-deploys `public/` to GitHub Pages via `.github/workflows/pages.yml`.

**2. Node server — real, shared, multi-user**

```bash
npm install
npm start        # http://localhost:3000
npm run dev      # auto-reload
```

Data is stored in SQLite (`data/personals.db`) and uploads on disk (`uploads/`).
On `localhost` / a real server the SPA talks to the live API automatically.

### Deploying the Node server

A `Dockerfile` and `fly.toml` are included for **Fly.io** (persistent volume for the
SQLite DB + uploads, plus a SQLite-backed session store so logins survive restarts):

```bash
fly apps create <your-app>
fly volumes create personals_data --region <region> --size 1 -a <your-app>
fly secrets set SESSION_SECRET=$(openssl rand -hex 32) -a <your-app>
fly deploy --remote-only
```

Env vars: `PORT`, `SESSION_SECRET`, `DATA_DIR`, `DB_PATH`, `UPLOAD_DIR`, `NODE_ENV`.

## Status

✅ **Functional.** Implemented and tested end-to-end:

- Accounts (register/login/logout, bcrypt-hashed, session cookies)
- Post an ad with category, city, age, gender/seeking, and up to 6 image uploads
- Browse/search with category + city filters, age range, has-photos, sort, pagination
- Post detail with image gallery + lightbox
- Anonymous private reply messaging with an inbox (threads, unread badges)
- Favorites (save/unsave)
- Manage your posts: edit, delete (removes images from disk), repost/renew
- Report/flag posts with auto-hide past a threshold
- 30-day auto-expiry
- 18+ age gate

## License

MIT
