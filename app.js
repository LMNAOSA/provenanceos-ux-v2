'use strict';
(() => {
  const cfg = window.POS_CONFIG || {};
  const BUCKET = cfg.BUCKET || 'sample-images';
  // The "-light" files are the white artwork; this UI is dark, so those are the ones that show up.
  const APP_LOGO = 'assets/app-light.png';
  const SYS_LOGO = 'assets/provenanceos-light.png';
  const NAV = ['Home', 'Samples', 'Analysis', 'Provenance', 'Settings'];
  const SAMPLE_TYPES = ['Rough opal', 'Cut opal', 'Polished opal', 'Host material'];
  const DEFAULT_LOCATION = 'Andamooka, South Australia';
  const MAX_PHOTO_BYTES = 25 * 1024 * 1024; // matches the bucket limit in supabase/schema.sql

  const app = document.getElementById('app');
  const state = { user: null, detail: null, tab: 'Overview', reading: 0, shots: [], stream: null, plan: null, importTarget: null };
  let sb = null, navToken = 0, toastTimer = 0;
  const urlCache = new Map();

  // ── helpers ────────────────────────────────────────────────────────────────────────────────
  const $ = sel => document.querySelector(sel);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const nf = new Intl.NumberFormat('en-AU', { maximumSignificantDigits: 5 });
  const fmtNum = n => (n == null ? '—' : nf.format(n));
  const fmtDate = iso => new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
  const fmtDateTime = iso => new Date(iso).toLocaleString('en-AU', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3) | 8).toString(16); }));

  function toast(msg, kind) {
    const t = $('#toast');
    t.textContent = msg;
    t.className = 'toast show' + (kind === 'error' ? ' error' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), kind === 'error' ? 6500 : 2600);
  }

  function errText(e) {
    const m = (e && (e.message || e.error_description)) || String(e);
    if (/failed to fetch|networkerror|load failed|network request failed/i.test(m)) return 'No connection to Supabase. Check your signal and try again.';
    if (e?.code === '42501' || /row-level security|permission denied/i.test(m)) return 'Not permitted. Your account may not be authorised yet — see Settings.';
    if (e?.code === 'PGRST205' || e?.code === '42P01') return 'The database tables are missing. Run supabase/schema.sql in the Supabase SQL editor.';
    return m;
  }

  async function sha256Hex(input) {
    if (!crypto?.subtle) throw new Error('Secure hashing needs https:// or localhost. Open the app over https.');
    const buf = typeof input === 'string' ? new TextEncoder().encode(input) : await input.arrayBuffer();
    return [...new Uint8Array(await crypto.subtle.digest('SHA-256', buf))].map(b => b.toString(16).padStart(2, '0')).join('');
  }

  // Private bucket → short-lived signed URLs. Returns a lookup function; failures just yield null (placeholders show).
  async function signed(paths) {
    const want = [...new Set(paths.filter(Boolean))].filter(p => !(urlCache.get(p)?.exp > Date.now() + 60000));
    if (want.length) {
      try {
        const { data, error } = await sb.storage.from(BUCKET).createSignedUrls(want, 3600);
        if (error) throw error;
        for (const r of data) if (r.signedUrl) urlCache.set(r.path, { url: r.signedUrl, exp: Date.now() + 3600000 });
      } catch (e) { console.warn('Could not sign image URLs', e); }
    }
    return p => urlCache.get(p)?.url || null;
  }

  // ── data access (the only place that talks to Supabase tables) ─────────────────────────────
  const must = res => { if (res.error) throw res.error; return res; };
  const api = {
    async overview({ limit = 500, analysed = false } = {}) {
      let q = sb.from('sample_overview').select('*').order('created_at', { ascending: false }).limit(limit);
      if (analysed) q = q.gt('analysis_count', 0);
      return must(await q).data;
    },
    async counts() {
      const head = () => sb.from('sample_overview').select('id', { count: 'exact', head: true });
      const [all, analysed, photographed] = await Promise.all([head(), head().gt('analysis_count', 0), head().gt('image_count', 0)]);
      return { samples: must(all).count || 0, analysed: must(analysed).count || 0, photographed: must(photographed).count || 0 };
    },
    async sampleDetail(id) {
      const [s, images, analyses, events] = await Promise.all([
        sb.from('samples').select('*').eq('id', id).maybeSingle(),
        sb.from('sample_images').select('*').eq('sample_id', id).order('created_at'),
        sb.from('analyses').select('*').eq('sample_id', id).order('measured_at', { ascending: false, nullsFirst: false }).order('created_at', { ascending: false }),
        sb.from('sample_events').select('*').eq('sample_id', id).order('created_at', { ascending: false })
      ]);
      return { sample: must(s).data, images: must(images).data, analyses: must(analyses).data, events: must(events).data };
    },
    async events(limit = 100) {
      return must(await sb.from('sample_events').select('*').order('created_at', { ascending: false }).limit(limit)).data;
    },
    async peekId() { return must(await sb.rpc('peek_next_sample_id')).data; },
    async addSample(row) { return must(await sb.from('samples').insert(row).select().single()).data; },
    async knownIds(ids) {
      if (!ids.length) return new Set();
      return new Set(must(await sb.from('samples').select('id').in('id', ids)).data.map(r => r.id));
    },
    async addAnalyses(rows) {
      const { data } = must(await sb.from('analyses').upsert(rows, { onConflict: 'sample_id,reading_hash', ignoreDuplicates: true }).select('id'));
      return data.length;
    },
    async isStaff() { return !!must(await sb.from('staff').select('user_id').maybeSingle()).data; }
  };

  // ── whole-screen states (no shell) ─────────────────────────────────────────────────────────
  const brandBlock = `<div class="brand"><img src="${APP_LOGO}" alt="Australian Provenance Project"><div class="system"><img src="${SYS_LOGO}" alt=""> <span>ProvenanceOS</span></div></div>`;
  const authScreen = inner => { app.innerHTML = `<div class="auth"><section class="card auth-card">${brandBlock}${inner}</section></div>`; };

  function showBooting() { authScreen('<div class="sub" role="status">Connecting…</div>'); }

  function showFatal(message, retry = true) {
    authScreen(`<div class="eyebrow">Can’t start</div><h1 class="title auth-title">Connection problem</h1><div class="sub">${esc(message)}</div>${retry ? '<div class="actions"><button class="primary" data-action="retry-boot">Try again</button></div>' : ''}`);
  }

  function showSetup() {
    authScreen(`<div class="eyebrow">One-time setup</div><h1 class="title auth-title">Database not set up yet</h1>
      <div class="sub">Your Supabase project is connected but has no ProvenanceOS tables.</div>
      <ol class="steps">
        <li>In Supabase, open <b>Authentication → Users</b> and add your user (tick <i>Auto Confirm User</i>).</li>
        <li>Open <b>SQL Editor → New query</b>, paste the contents of <b>supabase/schema.sql</b> from this project, and press <b>Run</b>.</li>
        <li>Come back here and press the button below.</li>
      </ol>
      <div class="actions"><button class="primary" data-action="retry-boot">I’ve run it — check again</button></div>`);
  }

  function showLogin(message = '') {
    authScreen(`<div class="eyebrow">Australian Provenance Project</div><h1 class="title auth-title">Sign in</h1>
      <div class="sub">Use the account your administrator created for you.</div>
      <form data-form="login" class="login" novalidate>
        <div class="fields">
          <div class="field"><label for="login-email">Email</label><input id="login-email" name="email" type="email" autocomplete="username" inputmode="email" required></div>
          <div class="field"><label for="login-password">Password</label><input id="login-password" name="password" type="password" autocomplete="current-password" required></div>
        </div>
        <div class="form-error" id="login-error" role="alert">${esc(message)}</div>
        <div class="actions"><button class="primary" type="submit" id="login-btn">Sign in</button></div>
      </form>`);
    $('#login-email')?.focus();
  }

  function showPending(email) {
    authScreen(`<div class="eyebrow">Almost there</div><h1 class="title auth-title">Access not granted yet</h1>
      <div class="sub">You’re signed in as <b>${esc(email)}</b>, but this account isn’t on the staff list. Ask an administrator to authorise it, then try again.</div>
      <div class="actions"><button class="secondary" data-action="sign-out">Sign out</button><button class="primary" data-action="retry-boot">Check again</button></div>`);
  }

  // ── shell + router ─────────────────────────────────────────────────────────────────────────
  function ensureShell(active) {
    if (!app.querySelector('.shell')) {
      app.innerHTML = `<div class="shell"><aside class="rail">${brandBlock}<nav class="nav" aria-label="Main">${NAV.map(n => `<button data-action="nav" data-page="${n.toLowerCase()}">${n}</button>`).join('')}</nav></aside><main class="content" id="content"></main></div>`;
    }
    app.querySelectorAll('.nav button').forEach(b => {
      const on = b.dataset.page === active;
      b.classList.toggle('active', on);
      if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
  }

  const pages = { home: pageHome, samples: pageSamples, sample: pageSample, analysis: pageAnalysis, provenance: pageProvenance, settings: pageSettings };

  function parseRoute() {
    const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
    const page = parts[0] === 'samples' && parts[1] ? 'sample' : (parts[0] || 'home');
    return { page: pages[page] ? page : 'home', id: parts[1] ? decodeURIComponent(parts[1]) : null };
  }

  async function render({ quiet = false } = {}) {
    if (!state.user) return;
    const token = ++navToken;
    const { page, id } = parseRoute();
    ensureShell(page === 'sample' ? 'samples' : page);
    const content = $('#content');
    if (!quiet) content.innerHTML = '<div class="loading" role="status">Loading…</div>';
    try {
      const html = await pages[page](id);
      if (token !== navToken) return;
      content.innerHTML = html;
      if (!quiet) window.scrollTo(0, 0);
    } catch (e) {
      console.error(e);
      if (token === navToken) content.innerHTML = `<div class="card pad"><div class="section-title">Something went wrong</div><div style="font-size:16px">${esc(errText(e))}</div><div class="actions" style="justify-content:flex-start"><button class="secondary" data-action="retry">Try again</button></div></div>`;
    }
  }

  const go = hash => { if (location.hash === hash) render(); else location.hash = hash; };
  const header = (eyebrow, title, sub, action = '') => `<div class="top"><div><div class="eyebrow">${eyebrow}</div><h1 class="title">${title}</h1>${sub ? `<div class="sub">${sub}</div>` : ''}</div>${action}</div>`;
  const newSampleBtn = '<button class="primary" data-action="new-sample">＋ New sample</button>';
  const emptyBox = text => `<div class="empty">${text}</div>`;

  // ── pages ──────────────────────────────────────────────────────────────────────────────────
  function sampleRow(s, urlOf) {
    const thumb = urlOf(s.cover_thumb_path || s.cover_path);
    return `<button class="sample" data-action="open-sample" data-id="${esc(s.id)}"><div class="thumb">${thumb ? `<img src="${esc(thumb)}" alt="" loading="lazy">` : ''}</div><div style="text-align:left"><strong>${esc(s.id)}</strong><small>${esc(s.sample_type || 'Rough opal')} · ${esc(s.location || 'Location not recorded')}</small></div><div class="chev">${s.analysis_count > 0 ? 'Analysed' : 'Registered'}　›</div></button>`;
  }

  async function pageHome() {
    const [counts, recent] = await Promise.all([api.counts(), api.overview({ limit: 5 })]);
    const urlOf = await signed(recent.map(s => s.cover_thumb_path || s.cover_path));
    return header('Australian Provenance Project', 'The physical record,<br>made permanent.', 'A quiet interface for registering stones, evidence and analysis.', newSampleBtn) +
      `<div class="grid"><section class="card hero"><div class="hero-inner"><span class="pill"><i class="dot"></i> ProvenanceOS live</span><h2>Every stone has a story. Give it an identity.</h2><p>Capture the specimen, preserve its context, then connect the analytical record — from field collection to pXRF and beyond.</p><div class="stats"><div class="stat"><b>${counts.samples}</b><span>Samples</span></div><div class="stat"><b>${counts.analysed}</b><span>Analysed</span></div><div class="stat"><b>${counts.photographed}</b><span>Photographed</span></div></div></div></section>` +
      `<section class="card pad"><div class="section-title">Recent specimens</div><div class="sample-list">${recent.length ? recent.map(s => sampleRow(s, urlOf)).join('') : `<div class="empty">No samples yet.<br><br><button class="primary" data-action="new-sample">Register the first stone</button></div>`}</div></section></div>`;
  }

  async function pageSamples() {
    const list = await api.overview();
    const urlOf = await signed(list.map(s => s.cover_thumb_path || s.cover_path));
    return header('Collection', 'Samples', 'The physical record of every registered specimen.', newSampleBtn) +
      `<div class="card pad"><div class="sample-list">${list.length ? list.map(s => sampleRow(s, urlOf)).join('') : emptyBox('Nothing registered yet.')}</div></div>`;
  }

  async function pageAnalysis() {
    const list = await api.overview({ analysed: true });
    const urlOf = await signed(list.map(s => s.cover_thumb_path || s.cover_path));
    return header('Instrument data', 'Analysis', 'pXRF records connected to physical samples.', '<button class="primary" data-action="import-csv">＋ Import Vanta CSV</button>') +
      `<div class="card pad"><div class="sample-list">${list.length ? list.map(s => sampleRow(s, urlOf)).join('') : emptyBox('No Vanta results attached yet.')}</div></div>`;
  }

  const EVENT_LABEL = { registered: 'Registered', photographed: 'Photo added', analysed: 'pXRF attached' };
  function eventDetail(ev) {
    const d = ev.detail || {};
    if (ev.kind === 'registered') return [d.sample_type, d.location].filter(Boolean).join(' · ');
    if (ev.kind === 'photographed') return d.file_name || '';
    if (ev.kind === 'analysed') return `${plural(d.readings || 0, 'reading')}${d.source_file ? ` · ${d.source_file}` : ''}`;
    return '';
  }

  async function pageProvenance() {
    const events = await api.events();
    return header('ProvenanceOS', 'Provenance', 'Every event becomes part of the stone’s permanent history.') +
      `<div class="card pad"><div class="events">${events.length ? events.map(ev => `<button class="event" data-action="open-sample" data-id="${esc(ev.sample_id)}"><span class="event-dot"></span><span class="event-main"><strong>${esc(ev.sample_id)} · ${esc(EVENT_LABEL[ev.kind] || ev.kind)}</strong><small>${esc(eventDetail(ev))}</small></span><time datetime="${esc(ev.created_at)}">${fmtDateTime(ev.created_at)}</time></button>`).join('') : emptyBox('Nothing has happened yet.')}</div></div>`;
  }

  async function pageSettings() {
    let host = cfg.SUPABASE_URL || '';
    try { host = new URL(host).host; } catch { /* keep raw */ }
    return header('ProvenanceOS', 'Settings', 'Account and connection.') +
      `<div class="card pad"><div class="fields" style="margin-top:0"><div><div class="section-title">Signed in as</div><div>${esc(state.user.email)}</div></div><div><div class="section-title">Database</div><div>${esc(host)}</div></div></div><div class="actions" style="justify-content:flex-start;margin-top:28px"><button class="secondary" data-action="sign-out">Sign out</button></div></div>`;
  }

  // Sample detail ---------------------------------------------------------------------------
  async function pageSample(id) {
    const d = await api.sampleDetail(id);
    if (!d.sample) return header('Sample record', 'Not found', `There is no sample called ${esc(id)}.`) + '<div class="card pad"><button class="secondary" data-action="nav" data-page="samples">Back to samples</button></div>';
    if (state.detail?.sample.id !== id) { state.tab = 'Overview'; state.reading = 0; }
    d.urlOf = await signed(d.images.flatMap(i => [i.thumb_path, i.storage_path]));
    state.detail = d;
    return sampleHTML(d);
  }

  function elementGrid(a) {
    const els = Vanta.sortElements(Object.keys(a.results || {}));
    return `<div class="analysis">${els.map(el => {
      const r = a.results[el];
      const meta = r.lod ? (r.limit != null ? `limit ${fmtNum(r.limit)}` : 'not detected') : [r.unit, r.error != null ? `± ${fmtNum(r.error)}` : ''].filter(Boolean).join(' · ');
      return `<div class="element${r.lod ? ' is-lod' : ''}"><span>${esc(el)}</span><b>${r.lod ? '&lt;LOD' : fmtNum(r.value)}</b><i class="meta">${esc(meta)}</i></div>`;
    }).join('')}</div>`;
  }

  const readingLabel = (a, n) => `#${a.reading_no || n + 1}${a.measured_at ? ` · ${fmtDateTime(a.measured_at)}` : ''}`;
  const emptyAnalysis = '<div class="note-box"><div class="section-title">Analysis</div><div style="font-size:15px">No pXRF record attached.</div><div class="sub">Import the Vanta export when the scan is complete.</div></div>';

  function tabBody(d) {
    const s = d.sample;
    if (state.tab === 'Evidence') {
      const tiles = d.images.map((im, n) => {
        const full = d.urlOf(im.storage_path), thumb = d.urlOf(im.thumb_path) || full;
        return `<a class="tile" ${full ? `href="${esc(full)}" target="_blank" rel="noopener"` : ''}>${thumb ? `<img src="${esc(thumb)}" alt="Photo ${n + 1} of ${esc(s.id)}" loading="lazy">` : '<span class="tile-missing">Preview unavailable</span>'}<span>${fmtDate(im.created_at)}</span></a>`;
      }).join('');
      return `<div class="tab-actions"><label class="secondary" style="cursor:pointer">＋ Add photo<input type="file" accept="image/*" multiple hidden data-change="add-photos"></label></div>${tiles ? `<div class="gallery">${tiles}</div>` : emptyBox('No photographs yet.')}`;
    }
    if (state.tab === 'Analysis') {
      if (!d.analyses.length) return emptyAnalysis;
      const i = Math.min(state.reading, d.analyses.length - 1), a = d.analyses[i];
      return `<div class="chips" role="tablist" aria-label="Readings">${d.analyses.map((x, n) => `<button class="chip${n === i ? ' active' : ''}" role="tab" aria-selected="${n === i}" data-action="reading" data-i="${n}">${esc(readingLabel(x, n))}</button>`).join('')}</div>
        <div class="section-title" style="margin-top:22px">${esc(a.instrument)}${a.method ? ` · ${esc(a.method)}` : ''}${a.source_file ? ` · ${esc(a.source_file)}` : ''}</div>${elementGrid(a)}`;
    }
    if (state.tab === 'History') {
      return `<div class="events">${d.events.map(ev => `<div class="event"><span class="event-dot"></span><span class="event-main"><strong>${esc(EVENT_LABEL[ev.kind] || ev.kind)}</strong><small>${esc(eventDetail(ev))}</small></span><time datetime="${esc(ev.created_at)}">${fmtDateTime(ev.created_at)}</time></div>`).join('') || emptyBox('No history yet.')}</div>`;
    }
    const latest = d.analyses[0];
    return `<div class="fields" style="margin-top:0"><div><div class="section-title">Location</div><div>${esc(s.location) || '—'}</div></div><div><div class="section-title">Weight</div><div>${s.weight_g != null ? `${fmtNum(s.weight_g)} g` : '—'}</div></div><div><div class="section-title">Dimensions</div><div>${esc(s.dimensions) || '—'}</div></div><div><div class="section-title">Notes</div><div>${esc(s.notes) || '—'}</div></div></div>` +
      (latest ? `<div style="margin-top:35px"><div class="section-title">pXRF analysis · ${esc(latest.instrument)}${d.analyses.length > 1 ? ` · latest of ${d.analyses.length} readings` : ''}</div>${elementGrid(latest)}</div>` : `<div style="margin-top:45px">${emptyAnalysis}</div>`);
  }

  function sampleHTML(d) {
    const s = d.sample, cover = d.images[0] && d.urlOf(d.images[0].storage_path);
    const tabs = ['Overview', 'Evidence', 'Analysis', 'History'];
    return header('Sample record', esc(s.id), `${esc(s.sample_type)} · ${esc(s.location) || 'Location not recorded'}`, `<button class="primary" data-action="import-csv" data-id="${esc(s.id)}">＋ Attach pXRF</button>`) +
      `<div class="sample-page"><section class="card photo-card${cover ? ' has-photo' : ''}">${cover ? `<img class="cover" src="${esc(cover)}" alt="Photograph of ${esc(s.id)}">` : ''}<div class="label"><span class="pill">${d.images.length ? plural(d.images.length, 'photo') : 'No image yet'}</span></div></section>` +
      `<section class="card detail"><div class="eyebrow">Identity</div><h2 style="font-size:30px;font-weight:300;margin:7px 0">${esc(s.id)}</h2><div class="sub">Registered ${fmtDate(s.created_at)}</div>` +
      `<div class="tabs" role="tablist">${tabs.map(t => `<button role="tab" aria-selected="${t === state.tab}" class="${t === state.tab ? 'active' : ''}" data-action="tab" data-tab="${t}">${t}</button>`).join('')}</div>${tabBody(d)}</section></div>`;
  }

  // ── modals ─────────────────────────────────────────────────────────────────────────────────
  function openModal(html) {
    closeModal();
    app.insertAdjacentHTML('beforeend', html);
    $('#modal .modal-box')?.focus();
  }

  function closeModal() {
    stopCamera();
    state.shots.forEach(s => URL.revokeObjectURL(s.url));
    state.shots = []; state.plan = null; state.importTarget = null;
    document.getElementById('modal')?.remove();
  }

  const hint = t => `<div class="hint">${esc(t)}</div>`;

  // New sample ------------------------------------------------------------------------------
  function openNewSample() {
    openModal(`<div class="modal" id="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><div class="modal-box" tabindex="-1">
      <div class="modal-head"><div><div class="eyebrow">New sample</div><h2 id="modal-title" style="font-size:31px;font-weight:300;margin:7px 0">New sample</h2><div class="sub">Register the physical specimen before analysis. The ID is assigned when you register.</div></div><button class="close" data-action="close-modal" aria-label="Close">×</button></div>
      <div class="camera" id="camera">${hint('Camera ready when you are')}</div>
      <div class="shots" id="shots"></div>
      <div class="actions" id="camera-actions" style="justify-content:flex-start;margin-top:12px"></div>
      <div class="fields">
        <div class="field"><label for="f-location">Location</label><input id="f-location" value="${esc(DEFAULT_LOCATION)}"></div>
        <div class="field"><label for="f-type">Sample type</label><select id="f-type">${SAMPLE_TYPES.map(t => `<option>${t}</option>`).join('')}</select></div>
        <div class="field"><label for="f-weight">Weight (g)</label><input id="f-weight" inputmode="decimal" placeholder="Optional"></div>
        <div class="field"><label for="f-dimensions">Dimensions</label><input id="f-dimensions" placeholder="mm × mm × mm"></div>
        <div class="field full"><label for="f-notes">Notes</label><textarea id="f-notes" placeholder="Anything worth preserving about this specimen…"></textarea></div>
      </div>
      <div class="form-error" id="form-error" role="alert"></div>
      <div class="actions"><button class="secondary" data-action="close-modal">Cancel</button><button class="primary" id="save-btn" data-action="save-sample">Register sample</button></div>
    </div></div>`);
    renderCameraActions();
    api.peekId().then(id => { if (id && $('#modal-title')) $('#modal-title').textContent = id; }).catch(() => {});
  }

  function renderCameraActions() {
    const el = $('#camera-actions');
    if (!el) return;
    const choose = '<label class="secondary" style="cursor:pointer">Choose photo<input type="file" accept="image/*" multiple hidden data-change="pick-photos"></label>';
    el.innerHTML = state.stream
      ? `<button class="primary" data-action="capture">Capture photo</button><button class="secondary" data-action="stop-camera">Close camera</button>${choose}`
      : `<button class="secondary" data-action="start-camera">Open camera</button>${choose}`;
  }

  async function startCamera() {
    const box = $('#camera');
    if (!navigator.mediaDevices?.getUserMedia) { box.innerHTML = hint('Camera is unavailable in this browser. Choose a photo instead.'); return; }
    try {
      state.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
      box.innerHTML = '<video autoplay playsinline muted></video>';
      box.querySelector('video').srcObject = state.stream;
    } catch {
      box.innerHTML = hint('Camera permission was declined. Choose a photo instead.');
    }
    renderCameraActions();
  }

  function stopCamera() {
    state.stream?.getTracks().forEach(t => t.stop());
    state.stream = null;
  }

  function showLatestShot() {
    const box = $('#camera');
    if (!box || state.stream) return;
    const last = state.shots[state.shots.length - 1];
    box.innerHTML = last ? `<img src="${last.url}" alt="Latest photo" class="preview">` : hint('Camera ready when you are');
  }

  function renderShots() {
    const el = $('#shots');
    if (el) el.innerHTML = state.shots.map((s, i) => `<div class="shot"><img src="${s.url}" alt="Photo ${i + 1}"><button type="button" data-action="remove-shot" data-i="${i}" aria-label="Remove photo ${i + 1}">×</button></div>`).join('');
  }

  function validatePhoto(file) {
    if (!file.type.startsWith('image/')) throw new Error(`${file.name} isn’t an image.`);
    if (file.size > MAX_PHOTO_BYTES) throw new Error(`${file.name} is larger than 25 MB.`);
  }

  function addShot(file) {
    try { validatePhoto(file); } catch (e) { toast(e.message, 'error'); return; }
    state.shots.push({ file, url: URL.createObjectURL(file) });
    renderShots();
    showLatestShot();
  }

  async function capturePhoto() {
    const v = $('#camera video');
    if (!v || !v.videoWidth) return;
    const c = document.createElement('canvas');
    c.width = v.videoWidth; c.height = v.videoHeight;
    c.getContext('2d').drawImage(v, 0, 0);
    const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.92));
    if (blob) addShot(new File([blob], `capture-${Date.now()}.jpg`, { type: 'image/jpeg' }));
  }

  async function saveSample() {
    const btn = $('#save-btn'), err = $('#form-error');
    err.textContent = '';
    const weightRaw = $('#f-weight').value.trim();
    const weight = weightRaw === '' ? null : Number(weightRaw);
    if (weight !== null && (!Number.isFinite(weight) || weight < 0)) { err.textContent = 'Weight must be a positive number of grams (or leave it blank).'; $('#f-weight').focus(); return; }
    const row = {
      location: $('#f-location').value.trim(),
      sample_type: $('#f-type').value,
      weight_g: weight,
      dimensions: $('#f-dimensions').value.trim() || null,
      notes: $('#f-notes').value.trim() || null
    };
    btn.disabled = true; btn.textContent = 'Registering…';
    let sample;
    try { sample = await api.addSample(row); }
    catch (e) { console.error(e); err.textContent = errText(e); btn.disabled = false; btn.textContent = 'Register sample'; return; }

    let failed = 0;
    const shots = [...state.shots];
    for (let i = 0; i < shots.length; i++) {
      btn.textContent = `Uploading photo ${i + 1} of ${shots.length}…`;
      try { await uploadPhoto(sample.id, shots[i].file); } catch (e) { failed++; console.error(e); }
    }
    closeModal();
    state.detail = null;
    toast(failed ? `${sample.id} registered, but ${plural(failed, 'photo')} didn’t upload — add them from the Evidence tab.` : `Sample registered · ${sample.id}`, failed ? 'error' : undefined);
    go(`#/samples/${encodeURIComponent(sample.id)}`);
  }

  // Photos ----------------------------------------------------------------------------------
  const MIME_BY_EXT = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', heic: 'image/heic', heif: 'image/heif' };
  const EXT_BY_MIME = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic', 'image/heif': 'heif' };
  const mimeFor = f => (f.type && EXT_BY_MIME[f.type] ? f.type : MIME_BY_EXT[(f.name.split('.').pop() || '').toLowerCase()] || 'image/jpeg');

  async function makeThumb(file, max = 480) {
    const bmp = await createImageBitmap(file);
    const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    bmp.close?.();
    return new Promise((res, rej) => c.toBlob(b => (b ? res(b) : rej(new Error('thumbnail failed'))), 'image/jpeg', 0.8));
  }

  // Original goes up untouched (evidence), plus a small thumbnail for lists. The DB row records the original's SHA-256.
  async function uploadPhoto(sampleId, file) {
    const id = uuid(), mime = mimeFor(file);
    const [hash, thumb] = await Promise.all([sha256Hex(file).catch(() => null), makeThumb(file).catch(() => null)]);
    const bucket = sb.storage.from(BUCKET);
    const path = `${sampleId}/${id}.${EXT_BY_MIME[mime]}`;
    must(await bucket.upload(path, file, { contentType: mime, upsert: false }));
    let thumbPath = null;
    if (thumb) {
      const tp = `${sampleId}/${id}_thumb.jpg`;
      const t = await bucket.upload(tp, thumb, { contentType: 'image/jpeg', upsert: false });
      if (!t.error) thumbPath = tp;
    }
    must(await sb.from('sample_images').insert({ sample_id: sampleId, storage_path: path, thumb_path: thumbPath, file_name: file.name, content_type: mime, size_bytes: file.size, sha256: hash }));
  }

  async function addPhotosToSample(input) {
    const files = [...input.files];
    input.value = '';
    const id = state.detail?.sample.id;
    if (!id || !files.length) return;
    toast(`Uploading ${plural(files.length, 'photo')}…`);
    let ok = 0, failed = 0, lastErr = '';
    for (const f of files) {
      try { validatePhoto(f); await uploadPhoto(id, f); ok++; } catch (e) { failed++; lastErr = errText(e); console.error(e); }
    }
    toast(failed ? `${ok} uploaded, ${failed} failed: ${lastErr}` : `${plural(ok, 'photo')} added`, failed ? 'error' : undefined);
    if (ok) render({ quiet: true });
  }

  // Vanta import ----------------------------------------------------------------------------
  function openImport(sampleId) {
    state.importTarget = sampleId || null;
    openModal(`<div class="modal" id="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><div class="modal-box" tabindex="-1">
      <div class="modal-head"><div><div class="eyebrow">pXRF</div><h2 id="modal-title" style="font-size:31px;font-weight:300;margin:7px 0">${sampleId ? `Attach to ${esc(sampleId)}` : 'Import Vanta export'}</h2><div class="sub">${sampleId ? 'Choose the CSV exported from the Vanta. Readings labelled for a different sample are skipped.' : 'Choose the CSV exported from the Vanta. Each reading is matched to a sample by the ID written in its row (e.g. AND-000012).'}</div></div><button class="close" data-action="close-modal" aria-label="Close">×</button></div>
      <div class="drop"><label class="secondary" style="cursor:pointer">Choose CSV file<input type="file" accept=".csv,text/csv,text/plain" hidden data-change="pick-csv"></label></div>
      <div id="import-summary" aria-live="polite"></div>
      <div class="actions"><button class="secondary" data-action="close-modal">Cancel</button><button class="primary" id="import-btn" data-action="run-import" disabled>Import</button></div>
    </div></div>`);
  }

  async function pickCsv(input) {
    const file = input.files[0];
    input.value = '';
    if (!file) return;
    const out = $('#import-summary'), btn = $('#import-btn');
    btn.disabled = true; state.plan = null;
    out.innerHTML = '<div class="sub" role="status">Reading file…</div>';
    try {
      const plan = await buildPlan(file, state.importTarget);
      state.plan = plan;
      out.innerHTML = planSummary(plan);
      btn.disabled = !plan.rows.length;
      btn.textContent = plan.rows.length ? `Import ${plural(plan.rows.length, 'reading')}` : 'Nothing to import';
    } catch (e) {
      console.error(e);
      out.innerHTML = `<div class="form-error" role="alert">${esc(errText(e))}</div>`;
    }
  }

  async function buildPlan(file, target) {
    if (file.size > 20 * 1024 * 1024) throw new Error('That file is larger than 20 MB — is it the right export?');
    const parsed = Vanta.parse(await file.text());
    const fileHash = await sha256Hex(file);
    const known = target ? new Set([target]) : await api.knownIds([...new Set(parsed.readings.map(r => r.sampleId).filter(Boolean))]);
    const rows = [], skipped = [];
    for (const r of parsed.readings) {
      let sid = null, why = null;
      if (target) { if (!r.sampleId || r.sampleId === target) sid = target; else why = `labelled ${r.sampleId}`; }
      else if (!r.sampleId) why = 'no sample ID in the row';
      else if (!known.has(r.sampleId)) why = `${r.sampleId} isn’t registered`;
      else sid = r.sampleId;
      if (sid) rows.push({ r, sid, hash: await sha256Hex(JSON.stringify(Object.values(r.raw))) });
      else skipped.push({ r, why });
    }
    return { file, fileName: file.name, fileHash, parsed, rows, skipped };
  }

  function planSummary(p) {
    const bySample = new Map();
    p.rows.forEach(x => bySample.set(x.sid, (bySample.get(x.sid) || 0) + 1));
    const reasons = new Map();
    p.skipped.forEach(x => reasons.set(x.why, (reasons.get(x.why) || 0) + 1));
    return `<div class="summary">
      <div class="stats" style="margin-top:20px"><div class="stat"><b>${p.parsed.readings.length}</b><span>Readings in file</span></div><div class="stat"><b>${p.parsed.elements.length}</b><span>Elements</span></div><div class="stat"><b>${bySample.size}</b><span>Samples matched</span></div></div>
      <div class="section-title" style="margin-top:22px">Elements</div><div class="sub" style="margin-top:0">${p.parsed.elements.map(esc).join(' · ')}</div>
      ${bySample.size ? `<div class="section-title" style="margin-top:22px">Will attach</div><div class="sub" style="margin-top:0">${[...bySample].map(([id, n]) => `${esc(id)} (${n})`).join(' · ')}</div>` : ''}
      ${p.skipped.length ? `<div class="section-title" style="margin-top:22px">Skipped · ${p.skipped.length}</div><div class="sub" style="margin-top:0">${[...reasons].map(([why, n]) => `${n} × ${esc(why)}`).join(' · ')}</div>` : ''}
      ${p.parsed.warnings.map(w => `<div class="warn">${esc(w)}</div>`).join('')}
      ${p.rows.length ? '<div class="sub">Readings already stored for a sample are recognised and won’t be duplicated.</div>' : ''}</div>`;
  }

  async function runImport() {
    const p = state.plan, btn = $('#import-btn');
    if (!p?.rows.length) return;
    btn.disabled = true; btn.textContent = 'Importing…';
    const payload = p.rows.map(({ r, sid, hash }) => ({
      sample_id: sid, instrument: r.instrument || 'Vanta', method: r.method, reading_no: r.readingNo, measured_at: r.measuredAt,
      results: r.results, raw: r.raw, source_file: p.fileName, source_sha256: p.fileHash, reading_hash: hash
    }));
    let inserted = 0;
    try {
      for (let i = 0; i < payload.length; i += 500) inserted += await api.addAnalyses(payload.slice(i, i + 500));
    } catch (e) {
      console.error(e);
      $('#import-summary').insertAdjacentHTML('beforeend', `<div class="form-error" role="alert">${esc(errText(e))}${inserted ? ` ${plural(inserted, 'reading')} were saved before the error; importing the same file again is safe.` : ''}</div>`);
      btn.disabled = false; btn.textContent = 'Try again';
      return;
    }
    const dupes = payload.length - inserted;
    closeModal();
    toast(`${plural(inserted, 'reading')} stored${dupes ? ` · ${dupes} already on file` : ''}`);
    render({ quiet: true });
  }

  // ── events ─────────────────────────────────────────────────────────────────────────────────
  const actions = {
    nav: el => go(`#/${el.dataset.page === 'home' ? 'home' : el.dataset.page}`),
    'open-sample': el => go(`#/samples/${encodeURIComponent(el.dataset.id)}`),
    'new-sample': openNewSample,
    'close-modal': closeModal,
    'start-camera': startCamera,
    'stop-camera': () => { stopCamera(); renderCameraActions(); showLatestShot(); },
    capture: capturePhoto,
    'remove-shot': el => { const [s] = state.shots.splice(+el.dataset.i, 1); if (s) URL.revokeObjectURL(s.url); renderShots(); showLatestShot(); },
    'save-sample': saveSample,
    'import-csv': el => openImport(el.dataset.id),
    'run-import': runImport,
    tab: el => { state.tab = el.dataset.tab; $('#content').innerHTML = sampleHTML(state.detail); },
    reading: el => { state.reading = +el.dataset.i; $('#content').innerHTML = sampleHTML(state.detail); },
    retry: () => render(),
    'retry-boot': () => boot(),
    'sign-out': async () => { await sb.auth.signOut(); }
  };
  const changes = { 'pick-photos': el => { [...el.files].forEach(addShot); el.value = ''; }, 'add-photos': addPhotosToSample, 'pick-csv': pickCsv };

  document.addEventListener('click', e => {
    const el = e.target.closest('[data-action]');
    if (el && actions[el.dataset.action]) actions[el.dataset.action](el, e);
  });
  document.addEventListener('change', e => { const f = changes[e.target.dataset?.change]; if (f) f(e.target); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });
  document.addEventListener('submit', e => {
    if (e.target.dataset.form !== 'login') return;
    e.preventDefault();
    login(e.target);
  });
  window.addEventListener('hashchange', () => { closeModal(); render(); });

  // ── auth + boot ────────────────────────────────────────────────────────────────────────────
  async function login(form) {
    const btn = $('#login-btn'), err = $('#login-error');
    const email = form.email.value.trim(), password = form.password.value;
    if (!email || !password) { err.textContent = 'Enter your email and password.'; return; }
    err.textContent = ''; btn.disabled = true; btn.textContent = 'Signing in…';
    const { error } = await sb.auth.signInWithPassword({ email, password });
    if (error) {
      err.textContent = /invalid login/i.test(error.message) ? 'That email and password don’t match.' : errText(error);
      btn.disabled = false; btn.textContent = 'Sign in';
      return;
    }
    await afterAuth();
  }

  async function afterAuth() {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) return showLogin();
    state.user = session.user;
    try {
      if (!(await api.isStaff())) { state.user = null; return showPending(session.user.email); }
    } catch (e) { state.user = null; return showFatal(errText(e)); }
    if (!location.hash) location.hash = '#/home';
    app.innerHTML = '';
    render();
  }

  async function checkSchema() {
    const { error } = await sb.from('staff').select('user_id').limit(1);
    if (!error) return 'ok';
    if (error.code === 'PGRST205' || error.code === '42P01') return 'missing';
    if (/failed to fetch|networkerror|load failed/i.test(error.message || '')) return 'offline';
    return 'ok'; // e.g. permission denied for the signed-out role: tables exist
  }

  async function boot() {
    if (!window.supabase || !cfg.SUPABASE_URL || !cfg.SUPABASE_KEY) return showFatal('The Supabase library didn’t load. Check your connection and reload.');
    if (!sb) {
      sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_KEY);
      sb.auth.onAuthStateChange(event => { if (event === 'SIGNED_OUT') setTimeout(() => { state.user = null; state.detail = null; urlCache.clear(); showLogin(); }, 0); });
    }
    showBooting();
    const schema = await checkSchema();
    if (schema === 'offline') return showFatal('Can’t reach Supabase. Check your signal and try again.');
    if (schema === 'missing') return showSetup();
    const { data: { session } } = await sb.auth.getSession();
    if (!session) return showLogin();
    await afterAuth();
  }

  boot();
})();
