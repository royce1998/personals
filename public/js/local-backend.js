'use strict';
/*
 * In-browser backend for the static (GitHub Pages) build.
 * It mirrors the Node/Express + SQLite API 1:1 so the SPA works unchanged.
 * Data is stored per-browser in IndexedDB. (This is a self-contained demo:
 * data is NOT shared between visitors — for shared data, run the Node server.)
 */
(function () {
  const CATEGORIES = [
    { slug: 'strictly-platonic', name: 'Strictly Platonic' },
    { slug: 'women-seeking-women', name: 'Women Seeking Women' },
    { slug: 'women-seeking-men', name: 'Women Seeking Men' },
    { slug: 'men-seeking-women', name: 'Men Seeking Women' },
    { slug: 'men-seeking-men', name: 'Men Seeking Men' },
    { slug: 'misc-romance', name: 'Misc Romance' },
    { slug: 'casual-encounters', name: 'Casual Encounters' },
    { slug: 'missed-connections', name: 'Missed Connections' },
    { slug: 'rants-and-raves', name: 'Rants & Raves' },
  ];
  const CATEGORY_SLUGS = new Set(CATEGORIES.map((c) => c.slug));
  const CITIES = ['Atlanta', 'Austin', 'Boston', 'Chicago', 'Dallas', 'Denver', 'Detroit',
    'Houston', 'Las Vegas', 'Los Angeles', 'Miami', 'Minneapolis', 'Nashville', 'New York',
    'Philadelphia', 'Phoenix', 'Portland', 'San Diego', 'San Francisco', 'Seattle',
    'Washington DC', 'Other'];
  const CONFIG = {
    POST_EXPIRY_DAYS: 30, FLAG_HIDE_THRESHOLD: 4, MAX_IMAGES_PER_POST: 6,
    MAX_IMAGE_BYTES: 5 * 1024 * 1024, PAGE_SIZE: 20, MIN_AGE: 18, MAX_AGE: 120,
    TITLE_MAX: 120, BODY_MAX: 8000,
  };
  const DAY = 24 * 3600 * 1000;
  const now = () => Date.now();

  // ---- IndexedDB single-record store ----------------------------------------
  function openDb() {
    return new Promise((res, rej) => {
      const r = indexedDB.open('personals', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('kv');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }
  async function idbGet(key) {
    const db = await openDb();
    return new Promise((res, rej) => {
      const t = db.transaction('kv', 'readonly').objectStore('kv').get(key);
      t.onsuccess = () => res(t.result); t.onerror = () => rej(t.error);
    });
  }
  async function idbSet(key, val) {
    const db = await openDb();
    return new Promise((res, rej) => {
      const t = db.transaction('kv', 'readwrite').objectStore('kv').put(val, key);
      t.onsuccess = () => res(); t.onerror = () => rej(t.error);
    });
  }

  let DB = null;
  async function save() { await idbSet('db', DB); }

  function blankDb() {
    return {
      users: [], posts: [], conversations: [], messages: [], favorites: [], flags: [],
      sessionUserId: null,
      seq: { users: 0, posts: 0, conversations: 0, messages: 0 },
    };
  }
  const nextId = (name) => (DB.seq[name] = (DB.seq[name] || 0) + 1);

  async function sha256(str) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
    return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  async function ensureLoaded() {
    if (DB) return;
    DB = (await idbGet('db')) || null;
    if (!DB) { DB = blankDb(); await seed(); await save(); }
  }

  async function seed() {
    const pw = await sha256('password123');
    const mk = (email, username) => {
      const id = nextId('users');
      DB.users.push({ id, email, username, password_hash: pw, created_at: now() - 20 * DAY });
      return id;
    };
    const alex = mk('alex@example.com', 'alex');
    const sam = mk('sam@example.com', 'sam');
    const jordan = mk('jordan@example.com', 'jordan');
    const demo = [
      [alex, 'missed-connections', 'You lent me a pen on the L train', 'Blue line, Tuesday around 6pm. You had a yellow umbrella and a great laugh. Coffee sometime?', 'Chicago', 27, 'woman', 'men'],
      [sam, 'women-seeking-men', 'Bookish introvert seeks trail buddy', 'Love used bookstores, farmers markets, and long hikes. Looking for someone kind and curious.', 'Denver', 31, 'woman', 'men'],
      [jordan, 'strictly-platonic', 'New in town, looking for friends', 'Just moved for work and would love to meet people for board game nights and pickup basketball.', 'Austin', 29, 'man', 'anyone'],
      [alex, 'men-seeking-women', 'Chef who will actually cook for you', 'I make a mean risotto and terrible jokes. Seeking someone to share meals and adventures with.', 'Seattle', 34, 'man', 'women'],
      [sam, 'misc-romance', 'Concert lover wants a plus-one', 'Indie shows, vinyl nights, and rooftop bars. Tell me your favorite album and let\u2019s go.', 'New York', 26, 'nonbinary', 'anyone'],
      [jordan, 'casual-encounters', 'Weekend hiking + coffee, no pressure', 'Early riser who loves sunrise trails. Looking for easygoing company, friendship first.', 'Portland', 30, 'man', 'women'],
    ];
    demo.forEach((d, i) => {
      const id = nextId('posts');
      const ts = now() - (i + 1) * (DAY / 2);
      DB.posts.push({
        id, user_id: d[0], category: d[1], title: d[2], body: d[3], city: d[4], age: d[5],
        gender: d[6], seeking: d[7], contact_pref: 'onsite', status: 'active', flag_count: 0,
        created_at: ts, updated_at: ts, expires_at: ts + CONFIG.POST_EXPIRY_DAYS * DAY, images: [],
      });
    });
  }

  // ---- helpers ----------------------------------------------------------------
  const meId = () => DB.sessionUserId;
  const userById = (id) => DB.users.find((u) => u.id === id);
  const postById = (id) => DB.posts.find((p) => p.id === Number(id));
  const publicUser = (u) => u && ({ id: u.id, email: u.email, username: u.username, created_at: u.created_at });

  function serialize(post) {
    const viewer = meId();
    const author = userById(post.user_id);
    const fav = viewer && DB.favorites.some((f) => f.user_id === viewer && f.post_id === post.id);
    return {
      id: post.id, category: post.category, title: post.title, body: post.body, city: post.city,
      age: post.age, gender: post.gender, seeking: post.seeking, contact_pref: post.contact_pref,
      status: post.status, flag_count: post.flag_count, created_at: post.created_at,
      updated_at: post.updated_at, expires_at: post.expires_at,
      author: author ? author.username : '[deleted]', author_id: post.user_id,
      is_owner: viewer === post.user_id, is_favorite: !!fav,
      images: (post.images || []).map((url, i) => ({ url, filename: 'img' + i })),
    };
  }

  function sweepExpired() {
    const t = now();
    DB.posts.forEach((p) => { if (p.status === 'active' && p.expires_at < t) p.status = 'expired'; });
  }

  function serializeConversation(conv) {
    const viewer = meId();
    const post = postById(conv.post_id);
    const isPoster = conv.poster_id === viewer;
    const msgs = DB.messages.filter((m) => m.conversation_id === conv.id).sort((a, b) => a.id - b.id);
    const last = msgs[msgs.length - 1];
    const unread = msgs.filter((m) => m.sender_id !== viewer && !m.read_at).length;
    return {
      id: conv.id, post_id: conv.post_id, post_title: post ? post.title : '[deleted post]',
      post_status: post ? post.status : 'removed', role: isPoster ? 'poster' : 'replier',
      counterpart: isPoster ? 'Replier' : 'Poster', last_message: last ? last.body : null,
      last_at: last ? last.created_at : conv.created_at, unread, updated_at: conv.updated_at,
    };
  }

  function clean(v, max) { if (typeof v !== 'string') return ''; const t = v.trim(); return max ? t.slice(0, max) : t; }
  function err(status, message) { const e = new Error(message); e.status = status; return e; }
  function requireAuth() { if (!meId()) throw err(401, 'You must be logged in to do that.'); }

  function fileToDataUrl(file) {
    return new Promise((res, rej) => {
      const fr = new FileReader();
      fr.onload = () => res(fr.result); fr.onerror = () => rej(fr.error);
      fr.readAsDataURL(file);
    });
  }

  function validatePost(b) {
    const category = clean(b.category, 64);
    if (!CATEGORY_SLUGS.has(category)) return { error: 'Please choose a valid category.' };
    const title = clean(b.title, CONFIG.TITLE_MAX);
    if (title.length < 3) return { error: 'Title must be at least 3 characters.' };
    const body = clean(b.body, CONFIG.BODY_MAX);
    if (body.length < 10) return { error: 'Body must be at least 10 characters.' };
    const city = clean(b.city, 64);
    if (!city) return { error: 'Please choose a location.' };
    let age = null;
    if (b.age !== undefined && b.age !== null && String(b.age).trim() !== '') {
      age = parseInt(b.age, 10);
      if (!Number.isInteger(age) || age < CONFIG.MIN_AGE || age > CONFIG.MAX_AGE) {
        return { error: `Age must be between ${CONFIG.MIN_AGE} and ${CONFIG.MAX_AGE}.` };
      }
    }
    const gender = clean(b.gender, 32) || null;
    const seeking = clean(b.seeking, 32) || null;
    const contact_pref = ['onsite', 'both'].includes(b.contact_pref) ? b.contact_pref : 'onsite';
    return { data: { category, title, body, city, age, gender, seeking, contact_pref } };
  }

  // ---- router -----------------------------------------------------------------
  async function handle(rawPath, opts = {}) {
    await ensureLoaded();
    const method = (opts.method || 'GET').toUpperCase();
    const [pathname, qs] = rawPath.split('?');
    const q = {}; if (qs) new URLSearchParams(qs).forEach((v, k) => { q[k] = v; });
    const body = opts.body || {};
    const form = opts.form || null;
    const seg = pathname.split('/').filter(Boolean); // e.g. ['api','posts','1']

    // /api/meta
    if (pathname === '/api/meta') {
      return { categories: CATEGORIES, cities: CITIES, limits: {
        maxImages: CONFIG.MAX_IMAGES_PER_POST, maxImageBytes: CONFIG.MAX_IMAGE_BYTES,
        titleMax: CONFIG.TITLE_MAX, bodyMax: CONFIG.BODY_MAX, minAge: CONFIG.MIN_AGE,
        maxAge: CONFIG.MAX_AGE, expiryDays: CONFIG.POST_EXPIRY_DAYS } };
    }
    if (pathname === '/api/health') return { ok: true, time: now() };

    // ---- auth ----
    if (pathname === '/api/auth/register' && method === 'POST') {
      const email = String(body.email || '').trim().toLowerCase();
      const username = String(body.username || '').trim();
      const password = String(body.password || '');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw err(400, 'Please enter a valid email address.');
      if (!/^[a-zA-Z0-9_.-]{3,24}$/.test(username)) throw err(400, 'Username must be 3-24 characters (letters, numbers, . _ -).');
      if (password.length < 8) throw err(400, 'Password must be at least 8 characters.');
      if (DB.users.some((u) => u.email === email)) throw err(409, 'An account with that email already exists.');
      if (DB.users.some((u) => u.username.toLowerCase() === username.toLowerCase())) throw err(409, 'That username is taken.');
      const id = nextId('users');
      const user = { id, email, username, password_hash: await sha256(password), created_at: now() };
      DB.users.push(user); DB.sessionUserId = id; await save();
      return { user: publicUser(user) };
    }
    if (pathname === '/api/auth/login' && method === 'POST') {
      const ident = String(body.identifier || body.email || '').trim().toLowerCase();
      const password = String(body.password || '');
      const user = DB.users.find((u) => u.email === ident || u.username.toLowerCase() === ident);
      if (!user || user.password_hash !== await sha256(password)) throw err(401, 'Invalid credentials.');
      DB.sessionUserId = user.id; await save();
      return { user: publicUser(user) };
    }
    if (pathname === '/api/auth/logout' && method === 'POST') { DB.sessionUserId = null; await save(); return { ok: true }; }
    if (pathname === '/api/auth/me') { return { user: meId() ? publicUser(userById(meId())) : null }; }

    // ---- posts ----
    if (pathname === '/api/posts' && method === 'GET') {
      sweepExpired();
      let list = DB.posts.filter((p) => p.status === 'active');
      if (q.category && CATEGORY_SLUGS.has(q.category)) list = list.filter((p) => p.category === q.category);
      if (q.city) list = list.filter((p) => p.city === q.city);
      if (q.q) { const s = q.q.toLowerCase(); list = list.filter((p) => p.title.toLowerCase().includes(s) || p.body.toLowerCase().includes(s)); }
      if (q.minAge) list = list.filter((p) => p.age != null && p.age >= parseInt(q.minAge, 10));
      if (q.maxAge) list = list.filter((p) => p.age != null && p.age <= parseInt(q.maxAge, 10));
      if (q.hasImages === 'true' || q.hasImages === '1') list = list.filter((p) => (p.images || []).length > 0);
      list.sort((a, b) => q.sort === 'oldest' ? a.created_at - b.created_at : b.created_at - a.created_at);
      const total = list.length;
      const page = Math.max(1, parseInt(q.page, 10) || 1);
      const limit = CONFIG.PAGE_SIZE;
      const slice = list.slice((page - 1) * limit, (page - 1) * limit + limit);
      return { posts: slice.map(serialize), page, pageSize: limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) };
    }
    if (pathname === '/api/posts/mine' && method === 'GET') {
      requireAuth(); sweepExpired();
      return { posts: DB.posts.filter((p) => p.user_id === meId()).sort((a, b) => b.created_at - a.created_at).map(serialize) };
    }
    if (pathname === '/api/posts/favorites' && method === 'GET') {
      requireAuth();
      const favs = DB.favorites.filter((f) => f.user_id === meId()).sort((a, b) => b.created_at - a.created_at);
      return { posts: favs.map((f) => postById(f.post_id)).filter(Boolean).map(serialize) };
    }
    if (pathname === '/api/posts' && method === 'POST') {
      requireAuth();
      const src = form ? {
        category: form.get('category'), title: form.get('title'), body: form.get('body'),
        city: form.get('city'), age: form.get('age'), gender: form.get('gender'), seeking: form.get('seeking'),
      } : body;
      const v = validatePost(src);
      if (v.error) throw err(400, v.error);
      let images = [];
      if (form) {
        const files = form.getAll('images').filter((f) => f && f.size);
        if (files.length > CONFIG.MAX_IMAGES_PER_POST) throw err(400, `You can upload at most ${CONFIG.MAX_IMAGES_PER_POST} images.`);
        for (const f of files) {
          if (f.size > CONFIG.MAX_IMAGE_BYTES) throw err(400, 'Each image must be under 5 MB.');
          images.push(await fileToDataUrl(f));
        }
      }
      const id = nextId('posts'); const ts = now();
      const post = { id, user_id: meId(), ...v.data, status: 'active', flag_count: 0,
        created_at: ts, updated_at: ts, expires_at: ts + CONFIG.POST_EXPIRY_DAYS * DAY, images };
      DB.posts.push(post); await save();
      return { post: serialize(post) };
    }
    // /api/posts/:id  and sub-actions
    if (seg[0] === 'api' && seg[1] === 'posts' && seg[2]) {
      const post = postById(seg[2]);
      const action = seg[3];
      if (!action) {
        if (method === 'GET') {
          if (!post) throw err(404, 'That post no longer exists.');
          if (post.status === 'removed' && post.user_id !== meId()) throw err(404, 'That post is no longer available.');
          return { post: serialize(post) };
        }
        if (method === 'PATCH') {
          requireAuth();
          if (!post) throw err(404, 'That post no longer exists.');
          if (post.user_id !== meId()) throw err(403, 'You can only edit your own posts.');
          const merged = { category: body.category ?? post.category, title: body.title ?? post.title,
            body: body.body ?? post.body, city: body.city ?? post.city, age: body.age ?? post.age,
            gender: body.gender ?? post.gender, seeking: body.seeking ?? post.seeking,
            contact_pref: body.contact_pref ?? post.contact_pref };
          const v = validatePost(merged); if (v.error) throw err(400, v.error);
          Object.assign(post, v.data, { updated_at: now() }); await save();
          return { post: serialize(post) };
        }
        if (method === 'DELETE') {
          requireAuth();
          if (!post) throw err(404, 'That post no longer exists.');
          if (post.user_id !== meId()) throw err(403, 'You can only delete your own posts.');
          DB.posts = DB.posts.filter((p) => p.id !== post.id);
          DB.favorites = DB.favorites.filter((f) => f.post_id !== post.id);
          DB.flags = DB.flags.filter((f) => f.post_id !== post.id);
          await save(); return { ok: true };
        }
      }
      if (action === 'repost' && method === 'POST') {
        requireAuth();
        if (!post) throw err(404, 'That post no longer exists.');
        if (post.user_id !== meId()) throw err(403, 'You can only repost your own posts.');
        const ts = now(); Object.assign(post, { status: 'active', created_at: ts, updated_at: ts, expires_at: ts + CONFIG.POST_EXPIRY_DAYS * DAY });
        await save(); return { post: serialize(post) };
      }
      if (action === 'favorite' && method === 'POST') {
        requireAuth();
        if (!post) throw err(404, 'That post no longer exists.');
        const idx = DB.favorites.findIndex((f) => f.user_id === meId() && f.post_id === post.id);
        if (idx >= 0) { DB.favorites.splice(idx, 1); await save(); return { favorite: false }; }
        DB.favorites.push({ user_id: meId(), post_id: post.id, created_at: now() }); await save();
        return { favorite: true };
      }
      if (action === 'flag' && method === 'POST') {
        requireAuth();
        if (!post) throw err(404, 'That post no longer exists.');
        if (post.user_id === meId()) throw err(400, 'You cannot flag your own post.');
        if (DB.flags.some((f) => f.user_id === meId() && f.post_id === post.id)) return { ok: true, alreadyFlagged: true };
        DB.flags.push({ user_id: meId(), post_id: post.id, reason: clean(body.reason, 200) || null, created_at: now() });
        post.flag_count = DB.flags.filter((f) => f.post_id === post.id).length;
        if (post.flag_count >= CONFIG.FLAG_HIDE_THRESHOLD) post.status = 'removed';
        await save(); return { ok: true, flag_count: post.flag_count };
      }
    }

    // ---- messages ----
    if (seg[0] === 'api' && seg[1] === 'messages') {
      if (seg[2] === 'reply' && seg[3] && method === 'POST') {
        requireAuth();
        const post = postById(seg[3]);
        if (!post) throw err(404, 'That post no longer exists.');
        if (post.status !== 'active') throw err(400, 'That post is no longer accepting replies.');
        if (post.user_id === meId()) throw err(400, 'You cannot reply to your own post.');
        const text = clean(body.body, 4000);
        if (!text) throw err(400, 'Your message is empty.');
        let conv = DB.conversations.find((c) => c.post_id === post.id && c.replier_id === meId());
        const ts = now();
        if (!conv) { conv = { id: nextId('conversations'), post_id: post.id, poster_id: post.user_id, replier_id: meId(), created_at: ts, updated_at: ts }; DB.conversations.push(conv); }
        DB.messages.push({ id: nextId('messages'), conversation_id: conv.id, sender_id: meId(), body: text, read_at: null, created_at: ts });
        conv.updated_at = ts; await save();
        return { conversation_id: conv.id };
      }
      if (pathname === '/api/messages/conversations' && method === 'GET') {
        requireAuth();
        const list = DB.conversations.filter((c) => c.poster_id === meId() || c.replier_id === meId()).sort((a, b) => b.updated_at - a.updated_at);
        return { conversations: list.map(serializeConversation) };
      }
      if (pathname === '/api/messages/unread-count' && method === 'GET') {
        requireAuth();
        const unread = DB.messages.filter((m) => {
          const c = DB.conversations.find((x) => x.id === m.conversation_id);
          return c && (c.poster_id === meId() || c.replier_id === meId()) && m.sender_id !== meId() && !m.read_at;
        }).length;
        return { unread };
      }
      if (seg[2] === 'conversations' && seg[3]) {
        const conv = DB.conversations.find((c) => c.id === Number(seg[3]));
        if (method === 'GET') {
          requireAuth();
          if (!conv) throw err(404, 'Conversation not found.');
          if (conv.poster_id !== meId() && conv.replier_id !== meId()) throw err(403, 'You are not part of this conversation.');
          DB.messages.forEach((m) => { if (m.conversation_id === conv.id && m.sender_id !== meId() && !m.read_at) m.read_at = now(); });
          await save();
          const msgs = DB.messages.filter((m) => m.conversation_id === conv.id).sort((a, b) => a.id - b.id)
            .map((m) => ({ id: m.id, body: m.body, created_at: m.created_at, mine: m.sender_id === meId() }));
          return { conversation: serializeConversation(conv), messages: msgs };
        }
        if (method === 'POST') {
          requireAuth();
          if (!conv) throw err(404, 'Conversation not found.');
          if (conv.poster_id !== meId() && conv.replier_id !== meId()) throw err(403, 'You are not part of this conversation.');
          const text = clean(body.body, 4000);
          if (!text) throw err(400, 'Your message is empty.');
          const ts = now();
          const m = { id: nextId('messages'), conversation_id: conv.id, sender_id: meId(), body: text, read_at: null, created_at: ts };
          DB.messages.push(m); conv.updated_at = ts; await save();
          return { message: { id: m.id, body: text, created_at: ts, mine: true } };
        }
      }
    }

    throw err(404, 'Not found.');
  }

  window.LocalBackend = { handle };
})();
