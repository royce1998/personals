'use strict';
(function () {
  // ---------------------------------------------------------------------------
  // Small helpers
  // ---------------------------------------------------------------------------
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const app = $('#app');

  function h(tag, attrs, ...children) {
    const e = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v == null || v === false) continue;
        if (k === 'class') e.className = v;
        else if (k === 'html') e.innerHTML = v;
        else if (k === 'text') e.textContent = v;
        else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
        else if (k === 'dataset') Object.assign(e.dataset, v);
        else e.setAttribute(k, v);
      }
    }
    for (const c of children.flat()) {
      if (c == null || c === false) continue;
      e.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
    }
    return e;
  }

  function toast(msg, type = '') {
    const t = h('div', { class: `toast ${type ? 'toast--' + type : ''}`, text: msg });
    $('#toasts').appendChild(t);
    setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 250); }, 3000);
  }

  function fmtTime(ts) {
    const d = new Date(ts);
    const diff = (Date.now() - ts) / 1000;
    if (diff < 60) return 'just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  function fmtClock(ts) {
    return new Date(ts).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  }

  // ---------------------------------------------------------------------------
  // API layer
  // ---------------------------------------------------------------------------
  // Static mode (e.g. GitHub Pages / opened as a file): no Node server, so route
  // requests to the in-browser backend. Otherwise talk to the real API.
  const STATIC_MODE = location.hostname.endsWith('github.io')
    || location.protocol === 'file:'
    || !!window.PERSONALS_STATIC;

  async function api(path, { method = 'GET', body, form } = {}) {
    if (STATIC_MODE && window.LocalBackend) {
      return window.LocalBackend.handle(path, { method, body, form });
    }
    const opts = { method, headers: {}, credentials: 'same-origin' };
    if (form) opts.body = form;
    else if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    const res = await fetch(path, opts);
    let data = null;
    try { data = await res.json(); } catch (_) {}
    if (!res.ok) throw new Error((data && data.error) || `Request failed (${res.status})`);
    return data;
  }

  // ---------------------------------------------------------------------------
  // Global state
  // ---------------------------------------------------------------------------
  const state = { user: null, meta: null, catBySlug: {} };

  async function loadMeta() {
    state.meta = await api('/api/meta');
    state.meta.categories.forEach((c) => { state.catBySlug[c.slug] = c.name; });
  }
  async function loadUser() {
    try { const r = await api('/api/auth/me'); state.user = r.user; }
    catch (_) { state.user = null; }
  }

  function catName(slug) { return state.catBySlug[slug] || slug; }

  // ---------------------------------------------------------------------------
  // Nav / chrome
  // ---------------------------------------------------------------------------
  function updateNav() {
    const authed = !!state.user;
    $$('[data-auth]').forEach((e) => e.classList.toggle('hidden', !authed));
    $$('[data-guest]').forEach((e) => e.classList.toggle('hidden', authed));
    const acc = $('#account-link');
    if (acc && authed) acc.textContent = state.user.username;
    refreshUnread();
  }

  let unreadTimer = null;
  async function refreshUnread() {
    const badge = $('#inbox-badge');
    if (!state.user) { badge.classList.add('hidden'); return; }
    try {
      const r = await api('/api/messages/unread-count');
      if (r.unread > 0) { badge.textContent = r.unread; badge.classList.remove('hidden'); }
      else badge.classList.add('hidden');
    } catch (_) {}
  }
  function startUnreadPolling() {
    if (unreadTimer) clearInterval(unreadTimer);
    unreadTimer = setInterval(refreshUnread, 20000);
  }

  function populateCitySelect() {
    const sel = $('#city-select');
    sel.innerHTML = '';
    sel.appendChild(h('option', { value: '' }, 'All cities'));
    state.meta.cities.forEach((c) => sel.appendChild(h('option', { value: c }, c)));
  }

  // ---------------------------------------------------------------------------
  // Router  (#/path?a=b)
  // ---------------------------------------------------------------------------
  function parseHash() {
    let raw = location.hash.slice(1) || '/';
    const [path, qs] = raw.split('?');
    const query = {};
    if (qs) new URLSearchParams(qs).forEach((v, k) => { query[k] = v; });
    return { path, segments: path.split('/').filter(Boolean), query };
  }

  function navigate(hash) { location.hash = hash; }

  function requireLogin(next) {
    if (!state.user) { toast('Please log in first.', 'error'); navigate('#/login?next=' + encodeURIComponent(next || location.hash)); return false; }
    return true;
  }

  async function router() {
    const { segments, query } = parseHash();
    window.scrollTo(0, 0);
    $('#site-nav').classList.remove('open');
    const root = segments[0] || '';
    try {
      if (root === '' ) return viewBrowse(query);
      if (root === 'browse') return viewBrowse(query);
      if (root === 'c') return viewBrowse({ ...query, category: segments[1] });
      if (root === 'post' && segments[1]) return viewPostDetail(segments[1]);
      if (root === 'post') return viewPostForm();
      if (root === 'edit') return viewPostForm(segments[1]);
      if (root === 'mine') return viewMine();
      if (root === 'favorites') return viewFavorites();
      if (root === 'inbox') return viewInbox(segments[1]);
      if (root === 'login') return viewAuth('login', query);
      if (root === 'register') return viewAuth('register', query);
      if (root === 'account') return viewAccount();
      return viewNotFound();
    } catch (err) {
      app.innerHTML = '';
      app.appendChild(h('div', { class: 'empty' }, h('div', { class: 'empty__emoji' }, '⚠️'), h('p', { text: err.message })));
    }
  }

  // ---------------------------------------------------------------------------
  // View: Browse
  // ---------------------------------------------------------------------------
  function categorySidebar(active) {
    const list = h('ul', { class: 'cat-list' });
    list.appendChild(h('li', {}, h('a', { href: '#/browse', class: !active ? 'active' : '', 'data-link': '' }, 'All Personals')));
    state.meta.categories.forEach((c) => {
      list.appendChild(h('li', {}, h('a', {
        href: `#/c/${c.slug}`, 'data-link': '', class: active === c.slug ? 'active' : '',
      }, c.name)));
    });
    return h('aside', { class: 'sidebar' }, h('h3', { text: 'Categories' }), list,
      h('h3', { text: 'Safety' }),
      h('p', { class: 'field', style: 'font-size:12.5px;color:var(--muted)' },
        'Meet in public. Tell a friend. Never wire money or share financial info.'));
  }

  async function viewBrowse(query) {
    const active = query.category || '';
    // sync header controls
    if (query.city !== undefined) $('#city-select').value = query.city || '';
    $('#search-input').value = query.q || '';

    app.innerHTML = '';
    const content = h('section', {});
    const layout = h('div', { class: 'layout' }, categorySidebar(active), content);
    app.appendChild(layout);
    content.appendChild(h('div', { class: 'center-load', text: 'Loading personals…' }));

    const params = new URLSearchParams();
    if (active) params.set('category', active);
    if (query.city) params.set('city', query.city);
    if (query.q) params.set('q', query.q);
    if (query.sort) params.set('sort', query.sort);
    if (query.minAge) params.set('minAge', query.minAge);
    if (query.maxAge) params.set('maxAge', query.maxAge);
    if (query.hasImages) params.set('hasImages', query.hasImages);
    params.set('page', query.page || '1');

    const data = await api('/api/posts?' + params.toString());
    content.innerHTML = '';

    // Filters bar
    const sortSel = h('select', { onchange: (e) => updateQuery({ sort: e.target.value, page: 1 }) },
      h('option', { value: 'newest' }, 'Newest first'),
      h('option', { value: 'oldest' }, 'Oldest first'));
    sortSel.value = query.sort || 'newest';
    const imgChk = h('input', { type: 'checkbox', onchange: (e) => updateQuery({ hasImages: e.target.checked ? 'true' : '', page: 1 }) });
    if (query.hasImages) imgChk.checked = true;
    const minAge = h('input', { type: 'number', min: 18, max: 120, placeholder: 'min', style: 'width:70px', value: query.minAge || '', onchange: (e) => updateQuery({ minAge: e.target.value, page: 1 }) });
    const maxAge = h('input', { type: 'number', min: 18, max: 120, placeholder: 'max', style: 'width:70px', value: query.maxAge || '', onchange: (e) => updateQuery({ maxAge: e.target.value, page: 1 }) });

    content.appendChild(h('div', { class: 'result-head' },
      h('h1', { text: active ? catName(active) : (query.q ? `Search: “${query.q}”` : 'All Personals') }),
      h('span', { class: 'result-count', text: `${data.total} post${data.total === 1 ? '' : 's'}${query.city ? ' in ' + query.city : ''}` })));

    content.appendChild(h('div', { class: 'filters' },
      h('label', { style: 'display:flex;gap:6px;align-items:center;font-size:13px;color:var(--text-soft)' }, imgChk, 'Has photos'),
      h('span', { style: 'font-size:13px;color:var(--text-soft)' }, 'Age'), minAge, h('span', { text: '–' }), maxAge,
      h('span', { class: 'spacer' }), sortSel));

    if (data.posts.length === 0) {
      content.appendChild(h('div', { class: 'empty' },
        h('div', { class: 'empty__emoji' }, '🔍'),
        h('p', { text: 'No personals match your filters yet.' }),
        h('a', { href: '#/post', class: 'btn btn--primary', 'data-link': '' }, 'Be the first to post')));
    } else {
      const listEl = h('div', { class: 'post-list' });
      data.posts.forEach((p) => listEl.appendChild(postCard(p)));
      content.appendChild(listEl);
      content.appendChild(pagination(data, query));
    }
  }

  function updateQuery(patch) {
    const { segments, query } = parseHash();
    const merged = { ...query, ...patch };
    Object.keys(merged).forEach((k) => { if (merged[k] === '' || merged[k] == null) delete merged[k]; });
    const base = '#/' + segments.join('/');
    const qs = new URLSearchParams(merged).toString();
    navigate(base + (qs ? '?' + qs : ''));
  }

  function postCard(p) {
    const thumb = p.images.length
      ? h('div', { class: 'post-card__thumb', style: `background-image:url('${p.images[0].url}')` })
      : h('div', { class: 'post-card__thumb' }, '💬');
    const meta = h('div', { class: 'post-card__meta' },
      h('span', { class: 'chip', text: catName(p.category) }),
      h('span', { text: '📍 ' + p.city }),
      p.age ? h('span', { text: p.age + ' yrs' }) : null,
      h('span', { text: fmtTime(p.created_at) }));
    return h('a', { class: 'post-card', href: `#/post/${p.id}`, 'data-link': '' },
      thumb,
      h('div', { class: 'post-card__body' },
        h('div', { class: 'post-card__title', text: p.title }),
        meta,
        h('div', { class: 'post-card__excerpt', text: p.body })));
  }

  function pagination(data, query) {
    if (data.totalPages <= 1) return h('div');
    const wrap = h('div', { class: 'pagination' });
    const mk = (label, page, disabled) => h('button', {
      class: 'btn btn--ghost btn--sm', disabled: disabled || false,
      onclick: () => updateQuery({ page }),
    }, label);
    wrap.appendChild(mk('‹ Prev', data.page - 1, data.page <= 1));
    wrap.appendChild(h('span', { style: 'font-size:14px;color:var(--muted)', text: `Page ${data.page} of ${data.totalPages}` }));
    wrap.appendChild(mk('Next ›', data.page + 1, data.page >= data.totalPages));
    return wrap;
  }

  // ---------------------------------------------------------------------------
  // View: Post detail
  // ---------------------------------------------------------------------------
  async function viewPostDetail(id) {
    app.innerHTML = '';
    app.appendChild(h('div', { class: 'center-load', text: 'Loading…' }));
    const { post } = await api('/api/posts/' + id);
    app.innerHTML = '';

    const actions = h('div', { class: 'detail__actions' });
    if (post.is_owner) {
      actions.appendChild(h('a', { class: 'btn btn--ghost btn--sm', href: `#/edit/${post.id}`, 'data-link': '' }, '✏️ Edit'));
      actions.appendChild(h('button', { class: 'btn btn--danger btn--sm', onclick: () => deletePost(post.id) }, '🗑 Delete'));
    } else {
      const favBtn = h('button', { class: 'btn btn--ghost btn--sm', onclick: (e) => toggleFav(post.id, e.currentTarget) },
        post.is_favorite ? '★ Saved' : '☆ Save');
      actions.appendChild(favBtn);
      actions.appendChild(h('button', { class: 'btn btn--ghost btn--sm', onclick: () => flagPost(post.id) }, '⚑ Report'));
    }

    const gallery = post.images.length
      ? h('div', { class: 'gallery' }, post.images.map((im) => h('img', { src: im.url, alt: post.title, onclick: () => lightbox(im.url) })))
      : null;

    const metaBits = [
      h('span', { class: 'chip', text: catName(post.category) }),
      h('span', { text: '📍 ' + post.city }),
      post.age ? h('span', { text: post.age + ' years old' }) : null,
      post.gender ? h('span', { text: post.gender + (post.seeking ? ' seeking ' + post.seeking : '') }) : null,
      h('span', { text: 'Posted ' + fmtClock(post.created_at) }),
    ];

    const detail = h('article', { class: 'detail' },
      h('a', { class: 'detail__back', href: '#/browse', 'data-link': '' }, '← Back to personals'),
      h('div', { class: 'panel' },
        h('div', { class: 'detail__head' },
          h('div', {}, h('h1', { class: 'detail__title', text: post.title }),
            h('div', { class: 'detail__meta' }, metaBits)),
          actions),
        gallery,
        h('div', { class: 'detail__body', text: post.body }),
        h('div', { class: 'safety', text: '🛡 Safety tip: Meet in a public place, tell someone where you\'re going, and never send money or share financial details.' }),
        replySection(post)));
    app.appendChild(detail);
  }

  function replySection(post) {
    if (post.is_owner) {
      return h('div', { class: 'reply-box' },
        h('p', { style: 'color:var(--muted)', text: 'This is your post. Replies will appear in your ' }, ),
        h('a', { href: '#/inbox', 'data-link': '' }, 'inbox.'));
    }
    const ta = h('textarea', { placeholder: 'Introduce yourself… (be respectful)' });
    const btn = h('button', { class: 'btn btn--primary', onclick: send }, 'Send reply');
    async function send() {
      if (!requireLogin(`#/post/${post.id}`)) return;
      const body = ta.value.trim();
      if (!body) { toast('Write a message first.', 'error'); return; }
      btn.disabled = true;
      try {
        const r = await api(`/api/messages/reply/${post.id}`, { method: 'POST', body: { body } });
        toast('Reply sent! You can continue in your inbox.', 'success');
        ta.value = '';
        navigate('#/inbox/' + r.conversation_id);
      } catch (err) { toast(err.message, 'error'); btn.disabled = false; }
    }
    return h('div', { class: 'reply-box' },
      h('h3', { text: 'Reply privately' }),
      h('p', { style: 'color:var(--muted);font-size:13px;margin-top:0', text: 'Your message goes to the poster through the site — your email stays private.' }),
      ta,
      h('div', { style: 'margin-top:10px' }, btn));
  }

  async function toggleFav(id, btn) {
    if (!requireLogin()) return;
    try {
      const r = await api(`/api/posts/${id}/favorite`, { method: 'POST' });
      btn.textContent = r.favorite ? '★ Saved' : '☆ Save';
      toast(r.favorite ? 'Saved to favorites' : 'Removed from favorites');
    } catch (err) { toast(err.message, 'error'); }
  }

  async function flagPost(id) {
    if (!requireLogin()) return;
    const reason = prompt('Optionally tell us why you\'re reporting this post:') || '';
    try {
      await api(`/api/posts/${id}/flag`, { method: 'POST', body: { reason } });
      toast('Thanks — this post has been reported.', 'success');
    } catch (err) { toast(err.message, 'error'); }
  }

  async function deletePost(id) {
    if (!confirm('Delete this post permanently?')) return;
    try { await api('/api/posts/' + id, { method: 'DELETE' }); toast('Post deleted.', 'success'); navigate('#/mine'); }
    catch (err) { toast(err.message, 'error'); }
  }

  // ---------------------------------------------------------------------------
  // View: Post create / edit
  // ---------------------------------------------------------------------------
  async function viewPostForm(editId) {
    if (!requireLogin(editId ? `#/edit/${editId}` : '#/post')) return;
    let post = null;
    if (editId) { post = (await api('/api/posts/' + editId)).post; if (!post.is_owner) { toast('You can only edit your own posts.', 'error'); navigate('#/'); return; } }

    const lim = state.meta.limits;
    app.innerHTML = '';
    const errBox = h('div', { class: 'form-error hidden' });

    const catSel = h('select', { name: 'category', required: true },
      h('option', { value: '' }, 'Choose a category…'),
      state.meta.categories.map((c) => h('option', { value: c.slug }, c.name)));
    const citySel = h('select', { name: 'city', required: true },
      h('option', { value: '' }, 'Choose a location…'),
      state.meta.cities.map((c) => h('option', { value: c }, c)));
    const title = h('input', { name: 'title', maxlength: lim.titleMax, required: true, placeholder: 'A catchy, honest headline' });
    const body = h('textarea', { name: 'body', maxlength: lim.bodyMax, required: true, placeholder: 'Tell people about yourself and who you\'re hoping to meet…' });
    const age = h('input', { name: 'age', type: 'number', min: lim.minAge, max: lim.maxAge, placeholder: 'e.g. 28' });
    const gender = h('select', { name: 'gender' }, ['', 'woman', 'man', 'nonbinary', 'other'].map((g) => h('option', { value: g }, g ? g[0].toUpperCase() + g.slice(1) : 'Prefer not to say')));
    const seeking = h('select', { name: 'seeking' }, ['', 'women', 'men', 'anyone'].map((g) => h('option', { value: g }, g ? g[0].toUpperCase() + g.slice(1) : 'Anyone')));

    if (post) {
      catSel.value = post.category; citySel.value = post.city; title.value = post.title;
      body.value = post.body; age.value = post.age || ''; gender.value = post.gender || ''; seeking.value = post.seeking || '';
    }

    // Image uploader (create only — keeps things simple & robust)
    const files = [];
    const previews = h('div', { class: 'previews' });
    const fileInput = h('input', { type: 'file', accept: 'image/*', multiple: true, style: 'display:none' });
    const drop = h('div', { class: 'uploader' }, `📷 Click or drop up to ${lim.maxImages} photos here`);
    function renderPreviews() {
      previews.innerHTML = '';
      files.forEach((f, i) => {
        const url = URL.createObjectURL(f);
        previews.appendChild(h('div', { class: 'preview' }, h('img', { src: url }),
          h('button', { type: 'button', onclick: () => { files.splice(i, 1); renderPreviews(); } }, '×')));
      });
    }
    function addFiles(list) {
      for (const f of list) {
        if (files.length >= lim.maxImages) { toast(`Max ${lim.maxImages} photos.`, 'error'); break; }
        if (!f.type.startsWith('image/')) continue;
        if (f.size > lim.maxImageBytes) { toast(`${f.name} is too large.`, 'error'); continue; }
        files.push(f);
      }
      renderPreviews();
    }
    drop.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => { addFiles(fileInput.files); fileInput.value = ''; });
    ['dragover', 'dragenter'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('drag'); }));
    ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('drag'); }));
    drop.addEventListener('drop', (e) => addFiles(e.dataTransfer.files));

    const submitBtn = h('button', { type: 'submit', class: 'btn btn--primary btn--lg' }, post ? 'Save changes' : 'Publish post');

    const form = h('form', { onsubmit: onSubmit },
      errBox,
      h('div', { class: 'field' }, h('label', { text: 'Category *' }), catSel),
      h('div', { class: 'field-row' },
        h('div', { class: 'field' }, h('label', { text: 'Location *' }), citySel),
        h('div', { class: 'field' }, h('label', { text: 'Your age' }), age)),
      h('div', { class: 'field' }, h('label', { text: 'Title *' }), title),
      h('div', { class: 'field-row' },
        h('div', { class: 'field' }, h('label', { text: 'I am a…' }), gender),
        h('div', { class: 'field' }, h('label', { text: 'Seeking…' }), seeking)),
      h('div', { class: 'field' }, h('label', { text: 'Post body *' }), body,
        h('div', { class: 'hint', text: `Up to ${lim.bodyMax.toLocaleString()} characters. Posts expire after ${lim.expiryDays} days.` })),
      !post ? h('div', { class: 'field' }, h('label', { text: 'Photos (optional)' }), drop, fileInput, previews) : null,
      post ? h('p', { class: 'hint', text: 'Photos can\'t be changed when editing — delete and repost to change photos.' }) : null,
      h('div', { style: 'margin-top:8px' }, submitBtn));

    async function onSubmit(e) {
      e.preventDefault();
      errBox.classList.add('hidden');
      submitBtn.disabled = true;
      try {
        if (post) {
          const payload = { category: catSel.value, city: citySel.value, title: title.value, body: body.value, age: age.value, gender: gender.value, seeking: seeking.value };
          const r = await api('/api/posts/' + post.id, { method: 'PATCH', body: payload });
          toast('Post updated.', 'success'); navigate('#/post/' + r.post.id);
        } else {
          const fd = new FormData();
          fd.append('category', catSel.value); fd.append('city', citySel.value);
          fd.append('title', title.value); fd.append('body', body.value);
          fd.append('age', age.value); fd.append('gender', gender.value); fd.append('seeking', seeking.value);
          files.forEach((f) => fd.append('images', f));
          const r = await api('/api/posts', { method: 'POST', form: fd });
          toast('Your post is live!', 'success'); navigate('#/post/' + r.post.id);
        }
      } catch (err) {
        errBox.textContent = err.message; errBox.classList.remove('hidden');
        submitBtn.disabled = false;
      }
    }

    app.appendChild(h('div', { class: 'panel panel--mid' },
      h('h1', { class: 'form-title', text: post ? 'Edit your post' : 'Create a personal ad' }),
      h('p', { class: 'form-sub', text: post ? 'Update the details below.' : 'Be genuine and respectful. No illegal content, harassment, or solicitation.' }),
      form));
  }

  // ---------------------------------------------------------------------------
  // View: My posts
  // ---------------------------------------------------------------------------
  async function viewMine() {
    if (!requireLogin('#/mine')) return;
    app.innerHTML = '';
    app.appendChild(h('div', { class: 'center-load', text: 'Loading your posts…' }));
    const { posts } = await api('/api/posts/mine');
    app.innerHTML = '';
    app.appendChild(h('div', { class: 'result-head' }, h('h1', { text: 'My posts' }),
      h('a', { href: '#/post', class: 'btn btn--primary btn--sm', 'data-link': '' }, '+ New post')));

    if (!posts.length) { app.appendChild(emptyState('📭', 'You haven\'t posted anything yet.', '#/post', 'Create your first post')); return; }
    const list = h('div', { class: 'post-list' });
    posts.forEach((p) => {
      const status = h('span', { class: `status-pill status-${p.status}`, text: p.status });
      const acts = h('div', { style: 'display:flex;gap:6px;flex-wrap:wrap' },
        h('a', { class: 'btn btn--ghost btn--sm', href: `#/post/${p.id}`, 'data-link': '' }, 'View'),
        h('a', { class: 'btn btn--ghost btn--sm', href: `#/edit/${p.id}`, 'data-link': '' }, 'Edit'),
        (p.status !== 'active') ? h('button', { class: 'btn btn--ghost btn--sm', onclick: (e) => repost(p.id, e.currentTarget) }, 'Repost') : null,
        h('button', { class: 'btn btn--danger btn--sm', onclick: () => deletePost(p.id) }, 'Delete'));
      list.appendChild(h('div', { class: 'mine-row' },
        h('div', { class: 'mine-row__info' },
          h('div', { class: 'mine-row__title', text: p.title }),
          h('div', { class: 'mine-row__meta', text: `${catName(p.category)} · ${p.city} · ${fmtTime(p.created_at)}` })),
        status, acts));
    });
    app.appendChild(list);
  }

  async function repost(id, btn) {
    btn.disabled = true;
    try { await api(`/api/posts/${id}/repost`, { method: 'POST' }); toast('Reposted — good for another cycle!', 'success'); router(); }
    catch (err) { toast(err.message, 'error'); btn.disabled = false; }
  }

  // ---------------------------------------------------------------------------
  // View: Favorites
  // ---------------------------------------------------------------------------
  async function viewFavorites() {
    if (!requireLogin('#/favorites')) return;
    app.innerHTML = '';
    app.appendChild(h('div', { class: 'center-load', text: 'Loading favorites…' }));
    const { posts } = await api('/api/posts/favorites');
    app.innerHTML = '';
    app.appendChild(h('div', { class: 'result-head' }, h('h1', { text: 'Saved posts' })));
    if (!posts.length) { app.appendChild(emptyState('☆', 'No saved posts yet. Tap “Save” on any post to keep it here.', '#/browse', 'Browse personals')); return; }
    const list = h('div', { class: 'post-list' });
    posts.forEach((p) => list.appendChild(postCard(p)));
    app.appendChild(list);
  }

  // ---------------------------------------------------------------------------
  // View: Inbox
  // ---------------------------------------------------------------------------
  async function viewInbox(convId) {
    if (!requireLogin('#/inbox')) return;
    app.innerHTML = '';
    const listCol = h('div', { class: 'conv-list' });
    const threadCol = h('div', { id: 'thread-col' });
    app.appendChild(h('div', {}, h('div', { class: 'result-head' }, h('h1', { text: 'Inbox' })),
      h('div', { class: 'inbox' }, listCol, threadCol)));

    const { conversations } = await api('/api/messages/conversations');
    if (!conversations.length) {
      listCol.appendChild(h('p', { style: 'color:var(--muted)', text: 'No conversations yet.' }));
      threadCol.appendChild(h('div', { class: 'empty' }, h('div', { class: 'empty__emoji' }, '✉️'), h('p', { text: 'Reply to a post to start chatting.' })));
      return;
    }
    conversations.forEach((c) => {
      const item = h('button', { class: 'conv-item' + (String(c.id) === String(convId) ? ' active' : ''), onclick: () => navigate('#/inbox/' + c.id) },
        h('div', { class: 'conv-item__top' },
          h('span', { text: `${c.counterpart} · ${c.role === 'poster' ? 'your post' : 'you replied'}` }),
          h('span', { text: fmtTime(c.last_at) })),
        h('div', { class: 'conv-item__title' }, c.post_title, c.unread ? h('span', { class: 'dot' }) : null),
        h('div', { class: 'conv-item__preview', text: c.last_message || '—' }));
      listCol.appendChild(item);
    });

    if (!convId) {
      threadCol.appendChild(h('div', { class: 'empty' }, h('div', { class: 'empty__emoji' }, '💬'), h('p', { text: 'Select a conversation.' })));
    } else {
      await renderThread(convId, threadCol);
      refreshUnread();
    }
  }

  async function renderThread(convId, col) {
    col.innerHTML = '';
    col.appendChild(h('div', { class: 'center-load', text: 'Loading…' }));
    let data;
    try { data = await api('/api/messages/conversations/' + convId); }
    catch (err) { col.innerHTML = ''; col.appendChild(h('div', { class: 'empty' }, h('p', { text: err.message }))); return; }

    const body = h('div', { class: 'thread__body' });
    data.messages.forEach((m) => body.appendChild(bubble(m)));

    const input = h('input', { placeholder: 'Type a message…', maxlength: 4000 });
    const form = h('form', { class: 'thread__form', onsubmit: onSend }, input, h('button', { class: 'btn btn--primary', type: 'submit' }, 'Send'));
    async function onSend(e) {
      e.preventDefault();
      const text = input.value.trim();
      if (!text) return;
      input.value = '';
      try {
        const r = await api('/api/messages/conversations/' + convId, { method: 'POST', body: { body: text } });
        body.appendChild(bubble(r.message));
        body.scrollTop = body.scrollHeight;
      } catch (err) { toast(err.message, 'error'); input.value = text; }
    }

    col.innerHTML = '';
    col.appendChild(h('div', { class: 'thread' },
      h('div', { class: 'thread__head' },
        h('span', {}, `${data.conversation.counterpart} · `, h('a', { href: '#/post/' + data.conversation.post_id, 'data-link': '' }, data.conversation.post_title)),
        h('a', { href: '#/inbox', 'data-link': '', class: 'btn btn--ghost btn--sm' }, '↩ All')),
      body, form));
    body.scrollTop = body.scrollHeight;
  }

  function bubble(m) {
    return h('div', { class: 'bubble ' + (m.mine ? 'bubble--me' : 'bubble--them') }, m.body,
      h('span', { class: 'bubble__time', text: fmtClock(m.created_at) }));
  }

  // ---------------------------------------------------------------------------
  // View: Auth
  // ---------------------------------------------------------------------------
  function viewAuth(mode, query) {
    if (state.user) { navigate('#/'); return; }
    app.innerHTML = '';
    const isLogin = mode === 'login';
    const err = h('div', { class: 'form-error hidden' });
    const next = query.next || '#/';

    const email = h('input', { type: 'email', required: true, placeholder: 'you@example.com', autocomplete: 'email' });
    const username = h('input', { required: true, placeholder: 'yourname', autocomplete: 'username' });
    const identifier = h('input', { required: true, placeholder: 'Email or username', autocomplete: 'username' });
    const pw = h('input', { type: 'password', required: true, placeholder: '••••••••', autocomplete: isLogin ? 'current-password' : 'new-password' });
    const btn = h('button', { type: 'submit', class: 'btn btn--primary btn--block btn--lg' }, isLogin ? 'Log in' : 'Create account');

    const form = h('form', { onsubmit: submit }, err,
      isLogin
        ? h('div', { class: 'field' }, h('label', { text: 'Email or username' }), identifier)
        : [h('div', { class: 'field' }, h('label', { text: 'Email' }), email),
           h('div', { class: 'field' }, h('label', { text: 'Username' }), username)],
      h('div', { class: 'field' }, h('label', { text: 'Password' }), pw,
        !isLogin ? h('div', { class: 'hint', text: 'At least 8 characters.' }) : null),
      btn);

    async function submit(e) {
      e.preventDefault();
      err.classList.add('hidden'); btn.disabled = true;
      try {
        if (isLogin) await api('/api/auth/login', { method: 'POST', body: { identifier: identifier.value, password: pw.value } });
        else await api('/api/auth/register', { method: 'POST', body: { email: email.value, username: username.value, password: pw.value } });
        await loadUser(); updateNav();
        toast(isLogin ? 'Welcome back!' : 'Account created!', 'success');
        navigate(decodeURIComponent(next));
      } catch (e2) { err.textContent = e2.message; err.classList.remove('hidden'); btn.disabled = false; }
    }

    app.appendChild(h('div', { class: 'panel panel--narrow' },
      h('h1', { class: 'form-title', text: isLogin ? 'Welcome back' : 'Join Personals' }),
      h('p', { class: 'form-sub', text: isLogin ? 'Log in to post and message.' : 'Create an account to post ads and reply to others. 18+ only.' }),
      form,
      h('div', { class: 'auth-switch' },
        isLogin ? 'New here? ' : 'Already have an account? ',
        h('a', { href: (isLogin ? '#/register' : '#/login') + (query.next ? '?next=' + encodeURIComponent(next) : ''), 'data-link': '' }, isLogin ? 'Create an account' : 'Log in'))));
  }

  // ---------------------------------------------------------------------------
  // View: Account
  // ---------------------------------------------------------------------------
  async function viewAccount() {
    if (!requireLogin('#/account')) return;
    app.innerHTML = '';
    const u = state.user;
    app.appendChild(h('div', { class: 'panel panel--narrow' },
      h('h1', { class: 'form-title', text: 'Your account' }),
      h('div', { class: 'field' }, h('label', { text: 'Username' }), h('input', { value: u.username, disabled: true })),
      h('div', { class: 'field' }, h('label', { text: 'Email' }), h('input', { value: u.email, disabled: true })),
      h('div', { class: 'field' }, h('label', { text: 'Member since' }), h('input', { value: new Date(u.created_at).toLocaleDateString(), disabled: true })),
      h('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;margin-top:8px' },
        h('a', { href: '#/mine', class: 'btn btn--ghost', 'data-link': '' }, 'My posts'),
        h('a', { href: '#/favorites', class: 'btn btn--ghost', 'data-link': '' }, 'Favorites'),
        h('button', { class: 'btn btn--danger', onclick: logout }, 'Log out'))));
  }

  async function logout() {
    try { await api('/api/auth/logout', { method: 'POST' }); } catch (_) {}
    state.user = null; updateNav(); toast('Logged out.'); navigate('#/');
  }

  // ---------------------------------------------------------------------------
  // Misc views + widgets
  // ---------------------------------------------------------------------------
  function emptyState(emoji, msg, link, linkLabel) {
    return h('div', { class: 'empty' }, h('div', { class: 'empty__emoji' }, emoji), h('p', { text: msg }),
      link ? h('a', { href: link, class: 'btn btn--primary', 'data-link': '' }, linkLabel) : null);
  }
  function viewNotFound() {
    app.innerHTML = '';
    app.appendChild(emptyState('🤷', 'Page not found.', '#/', 'Go home'));
  }
  function lightbox(url) {
    const box = h('div', { class: 'lightbox', onclick: () => box.remove() }, h('img', { src: url }));
    document.body.appendChild(box);
  }

  // ---------------------------------------------------------------------------
  // Age gate
  // ---------------------------------------------------------------------------
  function setupAgeGate() {
    const gate = $('#age-gate');
    if (localStorage.getItem('ageOk') === '1') return;
    gate.classList.remove('hidden');
    $('#age-yes').addEventListener('click', () => { localStorage.setItem('ageOk', '1'); gate.classList.add('hidden'); });
  }

  // ---------------------------------------------------------------------------
  // Header interactions
  // ---------------------------------------------------------------------------
  function setupHeader() {
    $('#search-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const q = $('#search-input').value.trim();
      const city = $('#city-select').value;
      const params = new URLSearchParams();
      if (q) params.set('q', q);
      if (city) params.set('city', city);
      navigate('#/browse' + (params.toString() ? '?' + params.toString() : ''));
    });
    $('#city-select').addEventListener('change', () => {
      const { segments, query } = parseHash();
      if (segments[0] === 'browse' || segments[0] === 'c' || !segments[0]) updateQuery({ city: $('#city-select').value, page: 1 });
    });
    $('#nav-toggle').addEventListener('click', () => $('#site-nav').classList.toggle('open'));
    // intercept data-link clicks handled natively by hashchange
  }

  // ---------------------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------------------
  async function boot() {
    setupAgeGate();
    try {
      await Promise.all([loadMeta(), loadUser()]);
    } catch (err) {
      app.innerHTML = '';
      app.appendChild(h('div', { class: 'empty' }, h('div', { class: 'empty__emoji' }, '⚠️'), h('p', { text: 'Could not reach the server. Is it running?' })));
      return;
    }
    populateCitySelect();
    setupHeader();
    updateNav();
    startUnreadPolling();
    window.addEventListener('hashchange', router);
    router();
  }

  boot();
})();
