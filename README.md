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

- Node.js + Express
- SQLite (`better-sqlite3`)
- Session auth (`express-session`, `bcryptjs`)
- Image uploads (`multer`)
- Vanilla JS single-page frontend

## Getting started

```bash
npm install
npm start        # starts the server (default http://localhost:3000)
npm run dev      # start with auto-reload
```

## Status

🚧 Work in progress — scaffolding and core server being built.

## License

MIT
