'use strict';
/*
 * Supabase-backed backend for the browser. Exposes window.SupabaseBackend.handle()
 * with the exact same request/response shapes as the Node API and the local
 * (IndexedDB) backend, so the SPA (app.js) works unchanged. Real, shared,
 * multi-user data: Supabase Auth + Postgres (RLS) + Storage.
 */
(function () {
  if (!window.SUPABASE_URL || !window.SUPABASE_KEY || typeof supabase === 'undefined') return;

  const sb = supabase.createClient(window.SUPABASE_URL, window.SUPABASE_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
  });

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
  const CONFIG = { POST_EXPIRY_DAYS: 30, MAX_IMAGES_PER_POST: 6, MAX_IMAGE_BYTES: 5 * 1024 * 1024,
    PAGE_SIZE: 20, MIN_AGE: 18, MAX_AGE: 120, TITLE_MAX: 120, BODY_MAX: 8000 };

  const toMs = (ts) => (ts ? new Date(ts).getTime() : ts);
  const clean = (v, max) => { if (typeof v !== 'string') return ''; const t = v.trim(); return max ? t.slice(0, max) : t; };
  function fail(status, message) { const e = new Error(message); e.status = status; return e; }
  function sbErr(error, fallback) {
    if (!error) return null;
    return fail(error.status || 400, error.message || fallback || 'Something went wrong.');
  }

  let _session = null;
  sb.auth.onAuthStateChange((_e, s) => { _session = s; });
  async function session() {
    if (_session) return _session;
    const { data } = await sb.auth.getSession();
    _session = data.session; return _session;
  }
  async function myId() { const s = await session(); return s ? s.user.id : null; }
  async function requireAuth() { const id = await myId(); if (!id) throw fail(401, 'You must be logged in to do that.'); return id; }

  async function profileUsername(id) {
    const { data } = await sb.from('profiles').select('username').eq('id', id).maybeSingle();
    return data ? data.username : null;
  }
  async function publicUserFromSession(s) {
    if (!s) return null;
    const username = await profileUsername(s.user.id);
    return { id: s.user.id, email: s.user.email, username, created_at: toMs(s.user.created_at) };
  }

  async function myFavSet() {
    const id = await myId(); if (!id) return new Set();
    const { data } = await sb.from('favorites').select('post_id').eq('user_id', id);
    return new Set((data || []).map((r) => r.post_id));
  }

  function serializePost(row, favSet, meId) {
    return {
      id: row.id, category: row.category, title: row.title, body: row.body, city: row.city,
      age: row.age, gender: row.gender, seeking: row.seeking, contact_pref: row.contact_pref,
      status: row.status, flag_count: row.flag_count,
      created_at: toMs(row.created_at), updated_at: toMs(row.updated_at), expires_at: toMs(row.expires_at),
      author: row.profiles ? row.profiles.username : '[deleted]', author_id: row.user_id,
      is_owner: meId === row.user_id, is_favorite: favSet.has(row.id),
      images: (row.image_urls || []).map((u) => ({ url: u, filename: String(u).split('/').pop() })),
    };
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
      if (!Number.isInteger(age) || age < CONFIG.MIN_AGE || age > CONFIG.MAX_AGE) return { error: `Age must be between ${CONFIG.MIN_AGE} and ${CONFIG.MAX_AGE}.` };
    }
    return { data: { category, title, body, city, age,
      gender: clean(b.gender, 32) || null, seeking: clean(b.seeking, 32) || null,
      contact_pref: ['onsite', 'both'].includes(b.contact_pref) ? b.contact_pref : 'onsite' } };
  }

  const SELECT_POST = '*, profiles(username)';

  async function handle(rawPath, opts = {}) {
    const method = (opts.method || 'GET').toUpperCase();
    const [pathname, qs] = rawPath.split('?');
    const q = {}; if (qs) new URLSearchParams(qs).forEach((v, k) => { q[k] = v; });
    const body = opts.body || {};
    const form = opts.form || null;
    const seg = pathname.split('/').filter(Boolean);

    // ---- meta / health ----
    if (pathname === '/api/meta') {
      return { categories: CATEGORIES, cities: CITIES, limits: {
        maxImages: CONFIG.MAX_IMAGES_PER_POST, maxImageBytes: CONFIG.MAX_IMAGE_BYTES,
        titleMax: CONFIG.TITLE_MAX, bodyMax: CONFIG.BODY_MAX, minAge: CONFIG.MIN_AGE,
        maxAge: CONFIG.MAX_AGE, expiryDays: CONFIG.POST_EXPIRY_DAYS } };
    }
    if (pathname === '/api/health') return { ok: true, time: Date.now() };

    // ---- auth ----
    if (pathname === '/api/auth/register' && method === 'POST') {
      const email = String(body.email || '').trim().toLowerCase();
      const username = String(body.username || '').trim();
      const password = String(body.password || '');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw fail(400, 'Please enter a valid email address.');
      if (!/^[a-zA-Z0-9_.-]{3,24}$/.test(username)) throw fail(400, 'Username must be 3-24 characters (letters, numbers, . _ -).');
      if (password.length < 8) throw fail(400, 'Password must be at least 8 characters.');
      const { data: taken } = await sb.from('profiles').select('id').ilike('username', username).maybeSingle();
      if (taken) throw fail(409, 'That username is taken.');
      const { data, error } = await sb.auth.signUp({ email, password, options: { data: { username } } });
      if (error) {
        if (/already registered|already exists/i.test(error.message)) throw fail(409, 'An account with that email already exists.');
        throw sbErr(error, 'Could not create account.');
      }
      _session = data.session;
      const uname = (await profileUsername(data.user.id)) || username;
      return { user: { id: data.user.id, email: data.user.email, username: uname, created_at: toMs(data.user.created_at) } };
    }
    if (pathname === '/api/auth/login' && method === 'POST') {
      const ident = String(body.identifier || body.email || '').trim();
      const password = String(body.password || '');
      if (!ident.includes('@')) throw fail(400, 'Please log in with the email address you signed up with.');
      const { data, error } = await sb.auth.signInWithPassword({ email: ident.toLowerCase(), password });
      if (error) throw fail(401, 'Invalid credentials.');
      _session = data.session;
      return { user: await publicUserFromSession(data.session) };
    }
    if (pathname === '/api/auth/logout' && method === 'POST') { await sb.auth.signOut(); _session = null; return { ok: true }; }
    if (pathname === '/api/auth/me') { return { user: await publicUserFromSession(await session()) }; }

    // ---- posts ----
    if (pathname === '/api/posts' && method === 'GET') {
      const meId = await myId();
      const limit = CONFIG.PAGE_SIZE;
      const page = Math.max(1, parseInt(q.page, 10) || 1);
      let query = sb.from('posts').select(SELECT_POST, { count: 'exact' })
        .eq('status', 'active').gt('expires_at', new Date().toISOString());
      if (q.category && CATEGORY_SLUGS.has(q.category)) query = query.eq('category', q.category);
      if (q.city) query = query.eq('city', q.city);
      if (q.q) { const s = q.q.replace(/[%,]/g, ' '); query = query.or(`title.ilike.%${s}%,body.ilike.%${s}%`); }
      if (q.minAge) query = query.gte('age', parseInt(q.minAge, 10));
      if (q.maxAge) query = query.lte('age', parseInt(q.maxAge, 10));
      if (q.hasImages === 'true' || q.hasImages === '1') query = query.eq('has_images', true);
      query = query.order('created_at', { ascending: q.sort === 'oldest' }).range((page - 1) * limit, (page - 1) * limit + limit - 1);
      const { data, count, error } = await query;
      if (error) throw sbErr(error);
      const favSet = await myFavSet();
      const total = count || 0;
      return { posts: (data || []).map((r) => serializePost(r, favSet, meId)), page, pageSize: limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) };
    }
    if (pathname === '/api/posts/mine' && method === 'GET') {
      const meId = await requireAuth();
      const { data, error } = await sb.from('posts').select(SELECT_POST).eq('user_id', meId).order('created_at', { ascending: false });
      if (error) throw sbErr(error);
      const favSet = await myFavSet();
      return { posts: (data || []).map((r) => serializePost(r, favSet, meId)) };
    }
    if (pathname === '/api/posts/favorites' && method === 'GET') {
      const meId = await requireAuth();
      const { data, error } = await sb.from('favorites').select('created_at, posts(' + SELECT_POST + ')').eq('user_id', meId).order('created_at', { ascending: false });
      if (error) throw sbErr(error);
      const favSet = new Set((data || []).map((r) => r.posts && r.posts.id).filter(Boolean));
      return { posts: (data || []).map((r) => r.posts).filter(Boolean).map((r) => serializePost(r, favSet, meId)) };
    }
    if (pathname === '/api/posts' && method === 'POST') {
      const meId = await requireAuth();
      const src = form ? { category: form.get('category'), title: form.get('title'), body: form.get('body'),
        city: form.get('city'), age: form.get('age'), gender: form.get('gender'), seeking: form.get('seeking') } : body;
      const v = validatePost(src);
      if (v.error) throw fail(400, v.error);
      let image_urls = [];
      if (form) {
        const files = form.getAll('images').filter((f) => f && f.size);
        if (files.length > CONFIG.MAX_IMAGES_PER_POST) throw fail(400, `You can upload at most ${CONFIG.MAX_IMAGES_PER_POST} images.`);
        for (const f of files) {
          if (f.size > CONFIG.MAX_IMAGE_BYTES) throw fail(400, 'Each image must be under 5 MB.');
          const ext = (f.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
          const path = `${meId}/${Date.now()}-${Math.random().toString(16).slice(2, 10)}.${ext}`;
          const up = await sb.storage.from('post-images').upload(path, f, { contentType: f.type, upsert: false });
          if (up.error) throw sbErr(up.error, 'Image upload failed.');
          image_urls.push(sb.storage.from('post-images').getPublicUrl(path).data.publicUrl);
        }
      }
      const { data, error } = await sb.from('posts').insert({ ...v.data, image_urls }).select(SELECT_POST).single();
      if (error) throw sbErr(error);
      return { post: serializePost(data, new Set(), meId) };
    }
    if (seg[0] === 'api' && seg[1] === 'posts' && seg[2]) {
      const id = Number(seg[2]);
      const action = seg[3];
      if (!action && method === 'GET') {
        const meId = await myId();
        const { data, error } = await sb.from('posts').select(SELECT_POST).eq('id', id).maybeSingle();
        if (error) throw sbErr(error);
        if (!data) throw fail(404, 'That post no longer exists.');
        const favSet = await myFavSet();
        return { post: serializePost(data, favSet, meId) };
      }
      if (!action && method === 'PATCH') {
        const meId = await requireAuth();
        const cur = await sb.from('posts').select(SELECT_POST).eq('id', id).maybeSingle();
        if (!cur.data) throw fail(404, 'That post no longer exists.');
        if (cur.data.user_id !== meId) throw fail(403, 'You can only edit your own posts.');
        const merged = { category: body.category ?? cur.data.category, title: body.title ?? cur.data.title,
          body: body.body ?? cur.data.body, city: body.city ?? cur.data.city, age: body.age ?? cur.data.age,
          gender: body.gender ?? cur.data.gender, seeking: body.seeking ?? cur.data.seeking,
          contact_pref: body.contact_pref ?? cur.data.contact_pref };
        const v = validatePost(merged); if (v.error) throw fail(400, v.error);
        const { data, error } = await sb.from('posts').update(v.data).eq('id', id).select(SELECT_POST).single();
        if (error) throw sbErr(error);
        return { post: serializePost(data, await myFavSet(), meId) };
      }
      if (!action && method === 'DELETE') {
        await requireAuth();
        const { error } = await sb.from('posts').delete().eq('id', id);
        if (error) throw sbErr(error);
        return { ok: true };
      }
      if (action === 'repost' && method === 'POST') {
        const meId = await requireAuth();
        const { error } = await sb.rpc('repost', { p_post_id: id });
        if (error) throw sbErr(error);
        const { data } = await sb.from('posts').select(SELECT_POST).eq('id', id).maybeSingle();
        return { post: serializePost(data, await myFavSet(), meId) };
      }
      if (action === 'favorite' && method === 'POST') {
        await requireAuth();
        const { data, error } = await sb.rpc('toggle_favorite', { p_post_id: id });
        if (error) throw sbErr(error);
        return { favorite: !!data };
      }
      if (action === 'flag' && method === 'POST') {
        await requireAuth();
        const { data, error } = await sb.rpc('flag_post', { p_post_id: id, p_reason: clean(body.reason, 200) || null });
        if (error) throw sbErr(error);
        return { ok: true, flag_count: data };
      }
    }

    // ---- messages ----
    if (seg[0] === 'api' && seg[1] === 'messages') {
      if (seg[2] === 'reply' && seg[3] && method === 'POST') {
        await requireAuth();
        const { data, error } = await sb.rpc('reply_to_post', { p_post_id: Number(seg[3]), p_body: clean(body.body, 4000) });
        if (error) throw sbErr(error);
        return { conversation_id: data };
      }
      if (pathname === '/api/messages/conversations' && method === 'GET') {
        await requireAuth();
        const { data, error } = await sb.rpc('my_conversations');
        if (error) throw sbErr(error);
        return { conversations: (data || []).map((c) => ({ id: c.id, post_id: c.post_id, post_title: c.post_title,
          post_status: c.post_status, role: c.role, counterpart: c.counterpart, last_message: c.last_message,
          last_at: toMs(c.last_at), unread: c.unread, updated_at: toMs(c.updated_at) })) };
      }
      if (pathname === '/api/messages/unread-count' && method === 'GET') {
        await requireAuth();
        const { data, error } = await sb.rpc('unread_count');
        if (error) throw sbErr(error);
        return { unread: data || 0 };
      }
      if (seg[2] === 'conversations' && seg[3]) {
        const cid = Number(seg[3]);
        const meId = await requireAuth();
        if (method === 'GET') {
          const { data: conv, error } = await sb.from('conversations').select('*, posts(title,status)').eq('id', cid).maybeSingle();
          if (error) throw sbErr(error);
          if (!conv) throw fail(404, 'Conversation not found.');
          await sb.rpc('mark_read', { p_conversation_id: cid });
          const { data: msgs } = await sb.from('messages').select('*').eq('conversation_id', cid).order('id', { ascending: true });
          const isPoster = conv.poster_id === meId;
          return {
            conversation: { id: conv.id, post_id: conv.post_id, post_title: conv.posts ? conv.posts.title : '[deleted post]',
              post_status: conv.posts ? conv.posts.status : 'removed', role: isPoster ? 'poster' : 'replier',
              counterpart: isPoster ? 'Replier' : 'Poster', updated_at: toMs(conv.updated_at) },
            messages: (msgs || []).map((m) => ({ id: m.id, body: m.body, created_at: toMs(m.created_at), mine: m.sender_id === meId })),
          };
        }
        if (method === 'POST') {
          const { data, error } = await sb.rpc('send_message', { p_conversation_id: cid, p_body: clean(body.body, 4000) });
          if (error) throw sbErr(error);
          return { message: { id: data.id, body: data.body, created_at: toMs(data.created_at), mine: true } };
        }
      }
    }

    throw fail(404, 'Not found.');
  }

  window.SupabaseBackend = { handle };
})();
