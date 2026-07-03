# Personals

A self-hosted, open-source replacement for the (deprecated) **Craigslist Personals** section.

> ⚠️ Adults only (18+). This project is intended for legal, consensual personal ads between adults.

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

## Getting started

```bash
npm install
npm start        # starts the server (default http://localhost:3000)
npm run dev      # start with auto-reload
```

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
