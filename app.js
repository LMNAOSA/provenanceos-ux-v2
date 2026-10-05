'use strict';
(() => {
  const cfg = window.POS_CONFIG || {};
  const BUCKET = cfg.BUCKET || 'sample-images';
  const RAW_BUCKET = cfg.RAW_BUCKET || 'vanta-raw';
  // The "-light" files are the white artwork; this UI is dark, so those are the ones that show up.
  const APP_LOGO = 'assets/app-light.png';
  const SYS_LOGO = 'assets/provenanceos-light.png';
  const NAV = ['Home','Samples','XRF Inbox','Evidence','Reference Data','Provenance','Settings'];
  const TYPES = [
    {code:'AHM',name:'Andamooka Hard Matrix',short:'Hard Matrix',note:'opal-bearing hard matrix'},
    {code:'ACC',name:'Andamooka Coloured Concrete',short:'Coloured Concrete',note:'iron-stained / coloured concrete'},
    {code:'ACX',name:'Andamooka Crystal Opal',short:'Crystal Opal',note:'crystal / transparent opal'},
    {code:'OTH',name:'Unknown / Other',short:'Unknown / Other',note:'use when classification is not yet defensible'}
  ];
  const TYPE_BY_CODE = Object.fromEntries(TYPES.map(t=>[t.code,t]));
  const MAX_IMAGE = 25 * 1024 * 1024, MAX_VIDEO = 75 * 1024 * 1024;
  const PARSER_VERSION = 'pxrf-v2.0.0';
  const DEFAULT_LOCATION = 'Andamooka, South Australia';
  const MAX_PHOTO_BYTES = 25 * 1024 * 1024; // matches the bucket limit in supabase/schema.sql

  const app = document.getElementById('app');
  const state = { user:null, detail:null, tab:'Overview', shots:[], stream:null, mediaRecorder:null, recordChunks:[], captureKind:'visible', plan:null, importTarget:null, selectedMeasure:null, segmenter:null, segmenterModule:null, segmenterLoading:false };

  // ── runtime / data layer ──────────────────────────────────────────────────────────────────
  let sb = null;
  let navToken = 0;
  const urlCache = new Map();

  const $ = selector => document.querySelector(selector);
  const errText = e => e?.message || e?.error_description || String(e || 'Unknown error');
  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const fmtNum = value => {
    const n = Number(value);
    return Number.isFinite(n) ? new Intl.NumberFormat('en-AU',{maximumFractionDigits:3}).format(n) : '—';
  };
  function fmtDate(value) {
    if (!value) return '—';
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? '—' : new Intl.DateTimeFormat('en-AU',{day:'numeric',month:'short',year:'numeric'}).format(d);
  }
  function fmtDateTime(value) {
    if (!value) return '—';
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? '—' : new Intl.DateTimeFormat('en-AU',{day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}).format(d);
  }
  const plural = (n, word) => Number(n) === 1 ? `1 ${word}` : `${n} ${word}s`;

  function must(result) {
    if (result?.error) throw result.error;
    return result?.data;
  }

  async function sha256(input) {
    const data = typeof input === 'string' ? new TextEncoder().encode(input) : await input.arrayBuffer();
    const digest = await crypto.subtle.digest('SHA-256', data);
    return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2,'0')).join('');
  }

  async function signed(paths = []) {
    const unique = [...new Set(paths.filter(Boolean))];
    const missing = unique.filter(p => !urlCache.has(p));
    if (missing.length) {
      for (let i = 0; i < missing.length; i += 50) {
        const part = missing.slice(i, i + 50);
        const data = must(await sb.storage.from(BUCKET).createSignedUrls(part, 3600));
        (data || []).forEach((row, idx) => {
          if (row?.signedUrl) urlCache.set(part[idx], row.signedUrl);
        });
      }
    }
    return path => path ? urlCache.get(path) || null : null;
  }

  function toast(message, type) {
    const el = $('#toast');
    if (!el) return;
    el.textContent = message || '';
    el.className = 'toast show' + (type === 'error' ? ' error' : '');
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => { el.className = 'toast'; }, 4200);
  }

  const api = {
    async overview({limit=500}={}) {
      return must(await sb.from('sample_overview').select('*').order('created_at',{ascending:false}).limit(limit)) || [];
    },
    async counts() {
      const [samples, images, analyses] = await Promise.all([
        sb.from('samples').select('id',{count:'exact',head:true}),
        sb.from('sample_images').select('id',{count:'exact',head:true}),
        sb.from('analyses').select('id',{count:'exact',head:true})
      ]);
      if (samples.error) throw samples.error;
      if (images.error) throw images.error;
      if (analyses.error) throw analyses.error;
      return {samples:samples.count||0,photographed:images.count||0,analysed:analyses.count||0};
    },
    async sampleDetail(id) {
      const [sample,images,analyses,events,measurements] = await Promise.all([
        sb.from('samples').select('*').eq('id',id).maybeSingle(),
        sb.from('sample_images').select('*').eq('sample_id',id).order('created_at',{ascending:true}),
        sb.from('analyses').select('*').eq('sample_id',id).order('measured_at',{ascending:false,nullsLast:true}).order('created_at',{ascending:false}),
        sb.from('sample_events').select('*').eq('sample_id',id).order('created_at',{ascending:true}),
        sb.from('sample_measurements').select('*').eq('sample_id',id).order('created_at',{ascending:false})
      ]);
      return {
        sample: must(sample),
        images: must(images) || [],
        analyses: must(analyses) || [],
        events: must(events) || [],
        measurements: must(measurements) || []
      };
    },
    async events() {
      return must(await sb.from('sample_events').select('*').order('created_at',{ascending:false}).limit(500)) || [];
    },
    async isStaff() {
      return Boolean(must(await sb.rpc('is_staff')));
    },
    async knownIds(ids=[]) {
      const wanted=[...new Set(ids.filter(Boolean))], out=new Set();
      for(let i=0;i<wanted.length;i+=200) {
        const rows=must(await sb.from('samples').select('id').in('id',wanted.slice(i,i+200))) || [];
        rows.forEach(r=>out.add(r.id));
      }
      return out;
    },
    async peekId(code='AHM') {
      return must(await sb.rpc('peek_next_sample_id',{p_code:code}));
    },
    async addSample(payload) {
      return must(await sb.from('samples').insert(payload).select('*').single());
    },
    async addMedia(payload) {
      return must(await sb.from('sample_images').insert(payload).select('*').single());
    },
    async addRaw(payload) {
      return must(await sb.from('raw_files').insert(payload).select('*').single());
    },
    async rawByHash(hash) {
      return must(await sb.from('raw_files').select('*').eq('sha256',hash).maybeSingle());
    },
    async addAnalyses(rows) {
      if(!rows?.length) return 0;
      const data=must(await sb.from('analyses').upsert(rows,{onConflict:'sample_id,reading_hash',ignoreDuplicates:true}).select('id'));
      return data?.length||0;
    },
    async imports() {
      return must(await sb.from('import_batches').select('*,raw_files(file_name,sha256)').order('created_at',{ascending:false}).limit(50)) || [];
    },
    async addImport(payload) {
      return must(await sb.from('import_batches').insert(payload).select('*').single());
    },
    async addUnmatched(rows) {
      if(!rows?.length) return [];
      return must(await sb.from('import_unmatched_rows').insert(rows).select('id')) || [];
    },
    async saveMeasurement(payload) {
      return must(await sb.from('sample_measurements').insert(payload).select('*').single());
    },
    async historicalDatasets() {
      return must(await sb.from('historical_datasets').select('*,raw_files(file_name,sha256)').order('created_at',{ascending:false}).limit(50)) || [];
    },
    async historicalByRawFile(rawFileId) {
      return must(await sb.from('historical_datasets').select('*').eq('raw_file_id',rawFileId).maybeSingle());
    },
    async addHistoricalDataset(payload) {
      return must(await sb.from('historical_datasets').insert(payload).select('*').single());
    },
    async addHistoricalRecords(rows) {
      if(!rows?.length) return [];
      return must(await sb.from('historical_records').insert(rows).select('id,source_row_no')) || [];
    },
    async addHistoricalObservations(rows) {
      if(!rows?.length) return 0;
      const data=must(await sb.from('historical_observations').upsert(rows,{onConflict:'record_id,analyte',ignoreDuplicates:true}).select('id'));
      return data?.length||0;
    }
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
      app.innerHTML = `<div class="shell"><aside class="rail">${brandBlock}<nav class="nav" aria-label="Main">${NAV.map(n => `<button data-action="nav" data-page="${n === 'XRF Inbox' ? 'xrf-inbox' : n.toLowerCase()}">${n}</button>`).join('')}</nav></aside><main class="content" id="content"></main></div>`;
    }
    app.querySelectorAll('.nav button').forEach(b => {
      const on = b.dataset.page === active;
      b.classList.toggle('active', on);
      if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
  }

  const pages = { home: pageHome, samples: pageSamples, sample: pageSample, 'xrf-inbox': pageXrfInbox, evidence: pageEvidence, provenance: pageProvenance, settings: pageSettings };

  function parseRoute() {
    const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
    const page = parts[0] === 'samples' && parts[1] ? 'sample' : (parts[0] === 'reference-data' ? 'reference-data' : (parts[0] || 'home'));
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
  const newSampleBtn = '<button class="primary" data-action="new-sample">＋ Register specimen</button>';
  const fmtDT = fmtDateTime;
  const emptyBox = text => `<div class="empty">${text}</div>`;

  // ── pages / specimen workflow ─────────────────────────────────────────────────────────────
  const typeInfo=code=>TYPE_BY_CODE[code]||TYPES[3];
  const typePill=code=>'<span class="code-pill code-'+esc(code)+'">'+esc(code)+'</span>';
  const primaryNew='<button class="primary" data-action="new-sample">＋ Register specimen</button>';
  function sampleRow(s,urlOf){
    const thumb=urlOf(s.cover_thumb_path||s.cover_path);
    return '<button class="sample" data-action="open-sample" data-id="'+esc(s.id)+'"><div class="thumb">'+(thumb?'<img src="'+esc(thumb)+'" alt="" loading="lazy">':'')+'</div><div class="sample-copy"><strong>'+esc(s.id)+'</strong><small>'+typePill(s.sample_code)+' '+esc(typeInfo(s.sample_code).short)+' · '+esc(s.location||'Location not recorded')+'</small></div><div class="sample-status">'+(s.analysis_count?'Analysed':'Registered')+' <span>›</span></div></button>';
  }
  async function pageHome(){
    const [counts,recent]=await Promise.all([api.counts(),api.overview({limit:6})]);
    const u=await signed(recent.map(x=>x.cover_thumb_path||x.cover_path));
    return header('Australian Provenance Project','A record of what was found.','Register once. Capture once. Let the evidence accumulate.',primaryNew)+
      '<div class="home-grid"><section class="hero-surface"><div class="orbital"></div><span class="pill"><i class="dot"></i> ProvenanceOS / live registry</span><h2>Identity before interpretation.</h2><p>Every specimen receives a permanent code. Images, observations and instrument results attach to that identity — without overwriting the original evidence.</p><div class="stats"><div><b>'+counts.samples+'</b><span>Specimens</span></div><div><b>'+counts.photographed+'</b><span>With evidence</span></div><div><b>'+counts.analysed+'</b><span>Analysed</span></div></div></section><section class="surface"><div class="surface-head"><div><span class="eyebrow">Registry</span><h3>Recent specimens</h3></div><button class="quiet-action" data-action="nav" data-page="samples">View all</button></div><div class="sample-list">'+(recent.length?recent.map(s=>sampleRow(s,u)).join(''):'<div class="empty-state compact"><p>No specimens yet.</p><button class="primary" data-action="new-sample">Register the first</button></div>')+'</div></section></div>';
  }
  async function pageSamples(){
    const list=await api.overview(),u=await signed(list.map(x=>x.cover_thumb_path||x.cover_path));
    return header('Collection','Samples','The physical registry — choose the material class, then let the system count it.',primaryNew)+
      '<section class="surface"><div class="filter-row"><div class="code-filters">'+TYPES.map(t=>'<button class="filter" data-action="filter-type" data-code="'+t.code+'">'+t.code+'<small>'+t.short+'</small></button>').join('')+'</div></div><div class="sample-list" id="sample-list">'+(list.length?list.map(s=>sampleRow(s,u)).join(''):'<div class="empty-state"><h2>Nothing registered.</h2><p>The first specimen starts the registry.</p></div>')+'</div></section>';
  }
  async function pageXrfInbox(){
    const imports=await api.imports();
    return header('Instrument','XRF Inbox','Drop in a Vanta export periodically. One file can connect hundreds of readings.', '<button class="primary" data-action="import-csv">＋ Import Vanta CSV</button>')+
      '<div class="inbox-hero"><div><span class="eyebrow">Batch workflow</span><h2>One export. Many specimens.</h2><p>The original CSV is preserved and hashed. Exact specimen IDs are matched automatically; anything ambiguous stays in review.</p></div><div class="inbox-steps"><span>01<br><b>Export</b></span><i>→</i><span>02<br><b>Match</b></span><i>→</i><span>03<br><b>Attach</b></span></div></div>'+
      '<section class="surface"><div class="surface-head"><div><span class="eyebrow">Import history</span><h3>Recent exports</h3></div></div>'+
      (imports.length?'<div class="import-list">'+imports.map(i=>'<div class="import-row"><div><strong>'+esc(i.raw_files?.file_name||'Vanta export')+'</strong><small>'+fmtDT(i.created_at)+' · '+esc((i.raw_files?.sha256||'').slice(0,12))+'…</small></div><div class="import-metrics"><span>'+(i.imported_count||0)+' attached</span><span>'+(i.duplicate_count||0)+' already held</span><span>'+(i.skipped_count||0)+' review</span></div></div>').join('')+'</div>':'<div class="empty-state compact"><p>No Vanta exports have been ingested yet.</p></div>')+'</section>';
  }
  async function pageReferenceData(){
    const datasets=await api.historicalDatasets();
    return header('Reference data','Historical datasets','Original scientific records that inform provenance without becoming physical specimens.',
      '<button class="primary" data-action="import-history">＋ Import historical CSV</button>')+
      '<section class="surface">'+
      '<div class="surface-head"><div><span class="eyebrow">Archive</span><h3>Historical reference datasets</h3></div></div>'+
      (datasets.length ? '<div class="dataset-list">'+datasets.map(d=>'<article class="dataset-row"><div><strong>'+esc(d.name)+'</strong><small>'+esc(d.dataset_type)+' · '+fmtDT(d.created_at)+'</small></div><div class="import-metrics"><span>'+(d.metadata?.record_count||0)+' records</span><span>'+(d.metadata?.observation_count||0)+' observations</span><span>'+esc((d.raw_files?.sha256||'').slice(0,12))+'…</span></div></article>').join('') :
      '<div class="empty-state compact"><p>No historical reference datasets have been imported.</p><p class="sub">These records remain separate from AHM, ACC, ACX and OTH specimens.</p></div>')+
      '</section>';
  }

  async function pageEvidence(){
    const list=await api.overview({limit:500}),u=await signed(list.map(x=>x.cover_path||x.cover_thumb_path));
    return header('Evidence','Capture archive','Visible light, fluorescence, phosphorescence and derived specimen images.')+
      '<section class="surface"><div class="evidence-grid">'+(list.map(s=>'<button class="evidence-card" data-action="open-sample" data-id="'+esc(s.id)+'"><div class="evidence-img">'+(u(s.cover_path||s.cover_thumb_path)?'<img src="'+esc(u(s.cover_path||s.cover_thumb_path))+'" alt="">':'')+'</div><div class="evidence-meta"><strong>'+esc(s.id)+'</strong><span>'+(s.image_count||0)+' media item'+(s.image_count===1?'':'s')+'</span></div></button>').join('')||'<div class="empty-state"><p>No evidence captured yet.</p></div>')+'</div></section>';
  }

  const EVENT_LABEL={registered:'Registered',photographed:'Evidence captured',analysed:'pXRF attached',measured:'Dimensions estimated'};
  function eventDetail(e){const d=e.detail||{};if(e.kind==='registered')return (d.sample_type||'')+' · '+(d.location||'');if(e.kind==='photographed')return (d.capture_kind||'visible')+' · '+(d.file_name||'');if(e.kind==='analysed')return (d.readings||0)+' reading'+(d.readings===1?'':'s')+' · '+(d.source_file||'');if(e.kind==='measured')return (d.method||'camera calibration')+' · '+JSON.stringify(d.dimensions||{});return d.file_name||'';}
  async function pageProvenance(){const events=await api.events();return header('ProvenanceOS','Provenance','A quiet history of what happened to each specimen.')+'<section class="surface"><div class="events">'+(events.map(e=>'<button class="event" data-action="open-sample" data-id="'+esc(e.sample_id)+'"><i class="event-line"></i><span><strong>'+esc(e.sample_id)+' · '+esc(EVENT_LABEL[e.kind]||e.kind)+'</strong><small>'+esc(eventDetail(e))+'</small></span><time>'+fmtDT(e.created_at)+'</time></button>').join('')||'<div class="empty-state"><p>No events yet.</p></div>')+'</div></section>';}
  async function pageSettings(){let host=cfg.SUPABASE_URL||'';try{host=new URL(host).host}catch{}return header('ProvenanceOS','Settings','The instrument and evidence registry are append-only by design.')+'<section class="surface settings"><div><span class="eyebrow">Signed in</span><p>'+esc(state.user.email)+'</p></div><div><span class="eyebrow">Database</span><p>'+esc(host)+'</p></div><div><span class="eyebrow">Parser</span><p>'+PARSER_VERSION+'</p></div><div><span class="eyebrow">Evidence</span><p>Originals + SHA-256 + derived lineage</p></div><div class="actions"><button class="secondary" data-action="sign-out">Sign out</button></div></section>';}

  const pageMap={home:pageHome,samples:pageSamples,'xrf-inbox':pageXrfInbox,evidence:pageEvidence,'reference-data':pageReferenceData,provenance:pageProvenance,settings:pageSettings,sample:pageSample};
  async function pageSample(id){const changed=state.detail?.sample?.id!==id,d=await api.sampleDetail(id);if(!d.sample)return header('Sample','Not found','No record exists for '+esc(id));if(changed)state.tab='Overview';state.detail=d;d.urlOf=await signed(d.images.flatMap(x=>[x.storage_path,x.thumb_path]));return samplePageHTML(d);}
  function samplePageHTML(d){const s=d.sample,cover=d.images.find(x=>x.capture_kind==='visible')||d.images[0],coverUrl=cover&&d.urlOf(cover.storage_path),tabs=['Overview','Evidence','Analysis','History'];return header('Specimen record',esc(s.id),typePill(s.sample_code)+' '+esc(typeInfo(s.sample_code).name)+' · '+esc(s.location||'Location not recorded'),'<button class="primary" data-action="import-csv" data-id="'+esc(s.id)+'">＋ Attach pXRF</button>')+'<div class="record-grid"><section class="specimen-stage '+(coverUrl?'has-image':'')+'">'+(coverUrl?'<img src="'+esc(coverUrl)+'" alt="'+esc(s.id)+'">':'<div class="stage-empty">No visible-light specimen image yet.<br><button class="secondary" data-action="capture-evidence">Add evidence</button></div>')+'<div class="stage-id"><span>'+esc(s.id)+'</span><small>permanent specimen identity</small></div></section><section class="surface record-panel"><div class="record-top"><div><span class="eyebrow">Registered '+fmtDate(s.created_at)+'</span><h2>'+esc(s.id)+'</h2><p>'+esc(typeInfo(s.sample_code).note)+'</p></div><button class="quiet-action" data-action="new-evidence">＋ Capture</button></div><div class="tabs">'+tabs.map(t=>'<button class="'+(t===state.tab?'active':'')+'" data-action="tab" data-tab="'+t+'">'+t+'</button>').join('')+'</div>'+recordTab(d)+'</section></div>';}
  function recordTab(d){const s=d.sample;if(state.tab==='Evidence')return evidenceTab(d);if(state.tab==='Analysis')return analysisTab(d);if(state.tab==='History')return historyTab(d);const latest=d.analyses[0],m=d.measurements?.[0];return '<div class="facts"><div><span>Location</span><b>'+esc(s.location||'—')+'</b></div><div><span>Weight</span><b>'+(s.weight_g!=null?fmtNum(s.weight_g)+' g':'—')+'</b></div><div><span>Dimension estimate</span><b>'+(m?fmtNum(m.dimensions?.length_mm)+' mm (2D)':'Not measured')+'</b></div><div><span>Evidence sets</span><b>'+([...new Set(d.images.map(x=>x.capture_kind))].map(esc).join(' · ')||'—')+'</b></div></div><div class="scientific-note"><span class="eyebrow">Evidence discipline</span><p>Original media and source Vanta rows are preserved. Derived masks and camera estimates remain explicitly labelled as derivatives.</p></div>'+(latest?'<div class="analysis-preview"><div class="surface-head"><div><span class="eyebrow">Latest pXRF</span><h3>'+esc(latest.instrument||'Vanta')+' · '+esc(latest.method||'Method not recorded')+'</h3></div><button class="quiet-action" data-action="tab" data-tab="Analysis">View data</button></div>'+elementGrid(latest)+'</div>':'<div class="empty-state compact"><p>No pXRF result attached yet.</p><button class="secondary" data-action="import-csv" data-id="'+esc(s.id)+'">Import Vanta data</button></div>');}
  function evidenceTab(d){const sections=[['Visible light','Original daylight / normal capture','visible'],['Fluorescence','UV response — wavelength/source can be noted','fluorescence'],['Phosphorescence','Afterglow sequence — photo or video','phosphorescence']];return '<div class="capture-toolbar"><button class="secondary" data-action="new-evidence">＋ Evidence</button><button class="secondary" data-action="measure">Measure with camera</button></div><div class="evidence-sections">'+sections.map(x=>evidenceSection(x[0],x[1],d.images.filter(i=>i.capture_kind===x[2]),d,x[2])).join('')+'</div>';}
  function evidenceSection(title,sub,list,d,kind){const tiles=list.map(x=>{const u=d.urlOf(x.storage_path)||d.urlOf(x.thumb_path),video=(x.media_type||'').startsWith('video/');return '<div class="media-tile">'+(u?(video?'<video controls preload="metadata" src="'+esc(u)+'"></video>':'<img src="'+esc(u)+'" alt="'+esc(x.file_name||title)+'">'):'<span class="tile-missing">Preview unavailable</span>')+'<div><strong>'+esc(x.file_name||title)+'</strong><small>'+esc(x.processing_method||'original')+' · '+fmtDate(x.created_at)+'</small></div></div>';}).join('');return '<section><div class="section-intro"><div><span class="eyebrow">'+title+'</span><p>'+sub+'</p></div><button class="quiet-action" data-action="new-evidence" data-kind="'+kind+'">＋ Add</button></div><div class="media-grid">'+(tiles||'<div class="empty-state compact"><p>No capture yet.</p></div>')+'</div></section>';}
  function elementGrid(a){const els=Vanta.sortElements(Object.keys(a.results||{}));return '<div class="analysis-grid">'+els.map(el=>{const r=a.results[el],meta=r.lod?(r.limit!=null?'limit '+fmtNum(r.limit):'not detected'):[r.unit,r.error!=null?'± '+fmtNum(r.error):''].filter(Boolean).join(' · ');return '<div class="element"><span>'+esc(el)+'</span><b>'+(r.lod?'&lt;LOD':fmtNum(r.value))+'</b><small>'+esc(meta)+'</small></div>';}).join('')+'</div>';}
  function analysisTab(d){if(!d.analyses.length)return '<div class="empty-state"><h2>No pXRF attached</h2><p>Import one Vanta CSV and ProvenanceOS will connect all exact matches.</p><button class="primary" data-action="import-csv" data-id="'+esc(d.sample.id)+'">Import Vanta CSV</button></div>';return '<div class="analysis-head"><div><span class="eyebrow">'+d.analyses.length+' stored reading'+(d.analyses.length===1?'':'s')+'</span><p>Exact specimen-ID matches only. Source rows remain attached to the export hash.</p></div><button class="secondary" data-action="import-csv" data-id="'+esc(d.sample.id)+'">＋ Add export</button></div><div class="reading-list">'+d.analyses.map((a,i)=>'<article class="reading"><div><strong>#'+esc(a.reading_no||String(i+1))+'</strong><small>'+fmtDT(a.measured_at)+' · '+esc(a.instrument||'Vanta')+' · '+esc(a.method||'Method not recorded')+'</small></div>'+elementGrid(a)+'<div class="reading-foot"><span>'+esc(a.source_file||'Vanta export')+'</span><span class="hash">'+esc((a.source_sha256||'').slice(0,16))+'…</span></div></article>').join('')+'</div>';}
  function historyTab(d){return '<div class="events record-events">'+(d.events.map(e=>'<div class="event"><i class="event-line"></i><span><strong>'+esc(EVENT_LABEL[e.kind]||e.kind)+'</strong><small>'+esc(eventDetail(e))+'</small></span><time>'+fmtDT(e.created_at)+'</time></div>').join('')||'<div class="empty-state compact"><p>No recorded events.</p></div>')+'</div>';}

  // ── capture / media ────────────────────────────────────────────────────────────────────────
  function modal(html){closeModal();app.insertAdjacentHTML('beforeend',html);$('#modal .modal-box')?.focus();}
  function closeModal(){stopCamera();if(state.mediaRecorder&&state.mediaRecorder.state!=='inactive'){state.mediaRecorder.ondataavailable=null;state.mediaRecorder.onstop=null;try{state.mediaRecorder.stop();}catch{}}state.mediaRecorder=null;state.recordChunks=[];state.shots.forEach(s=>{if(s.url)URL.revokeObjectURL(s.url)});state.shots=[];state.plan=null;state.importTarget=null;state.selectedMeasure=null;document.getElementById('modal')?.remove();document.getElementById('mask-modal')?.remove();}
  function captureModeButtons(){return ['visible','fluorescence','phosphorescence'].map(k=>'<button class="mode '+(k===state.captureKind?'active':'')+'" data-action="capture-mode" data-kind="'+k+'">'+(k==='visible'?'Visible':k==='fluorescence'?'Fluorescence':'Phosphorescence')+'</button>').join('');}
  async function updatePreview(code){try{const x=await api.peekId(code);if($('#id-preview'))$('#id-preview').textContent=x||code+'-000001';}catch{if($('#id-preview'))$('#id-preview').textContent=code+'-000001';}}
  function renderCameraActions(){const el=$('#camera-actions');if(!el)return;const choose='<label class="secondary file-label">Choose media<input type="file" accept="image/*,video/*" hidden data-change="pick-media"></label>';if(state.mediaRecorder)return el.innerHTML='<button class="recording" data-action="stop-recording">● Stop recording</button>';el.innerHTML=state.stream?'<button class="primary" data-action="capture-photo">Capture photo</button><button class="secondary" data-action="record-video">Record video</button><button class="secondary" data-action="stop-camera">Close camera</button>'+choose:'<button class="primary" data-action="start-camera">Open camera</button>'+choose;}
  async function startCamera(){const b=$('#camera');if(!navigator.mediaDevices?.getUserMedia){b.innerHTML='<div class="camera-guide">Camera unavailable. Use Choose media.</div>';return;}try{state.stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'}},audio:false});b.innerHTML='<video autoplay playsinline muted></video>';b.querySelector('video').srcObject=state.stream;}catch{b.innerHTML='<div class="camera-guide">Camera permission was declined. Use Choose media.</div>';}renderCameraActions();}
  function stopCamera(){state.stream?.getTracks().forEach(t=>t.stop());state.stream=null;renderCameraActions();}
  function stopRecording(){if(state.mediaRecorder&&state.mediaRecorder.state!=='inactive')state.mediaRecorder.stop();}
  async function capturePhoto(){const v=$('#camera video');if(!v?.videoWidth)return;const c=document.createElement('canvas');c.width=v.videoWidth;c.height=v.videoHeight;c.getContext('2d').drawImage(v,0,0);const blob=await new Promise(r=>c.toBlob(r,'image/jpeg',.94));if(blob)addShot(new File([blob],state.captureKind+'-'+Date.now()+'.jpg',{type:'image/jpeg'}));}
  function recordVideo(){const stream=state.stream;if(!stream||!window.MediaRecorder)return toast('Video recording is unavailable in this browser.','error');const mime=['video/mp4','video/webm;codecs=vp9','video/webm'].find(x=>MediaRecorder.isTypeSupported(x));state.recordChunks=[];const rec=new MediaRecorder(stream,mime?{mimeType:mime}:undefined);state.mediaRecorder=rec;rec.ondataavailable=e=>{if(e.data.size)state.recordChunks.push(e.data)};rec.onstop=()=>{const type=rec.mimeType||mime||'video/webm',blob=new Blob(state.recordChunks,{type});if(blob.size)addShot(new File([blob],state.captureKind+'-'+Date.now()+'.'+(type.includes('mp4')?'mp4':'webm'),{type}),state.captureKind);state.mediaRecorder=null;state.recordChunks=[];renderCameraActions();};rec.start(300);renderCameraActions();}
  function validateMedia(file){if(file.type.startsWith('image/')&&file.size>MAX_IMAGE)throw new Error(file.name+' is larger than 25 MB.');if(file.type.startsWith('video/')&&file.size>MAX_VIDEO)throw new Error(file.name+' is larger than 75 MB.');if(!file.type.startsWith('image/')&&!file.type.startsWith('video/'))throw new Error('Choose an image or video.');}
  function addShot(file,kind=state.captureKind){try{validateMedia(file)}catch(e){toast(e.message,'error');return}state.shots.push({id:crypto.randomUUID(),file,url:URL.createObjectURL(file),captureKind:kind,mime:file.type});renderShots();}
  function renderShots(){const el=$('#shots');if(!el)return;el.innerHTML=state.shots.map((s,i)=>'<div class="shot"><div class="shot-media">'+(s.mime.startsWith('video/')?'<video muted src="'+s.url+'"></video>':'<img src="'+s.url+'" alt="'+esc(s.captureKind)+'">')+'<span>'+esc(s.captureKind)+'</span></div><div class="shot-actions"><button data-action="clean-shot" data-i="'+i+'">Clean background</button><button data-action="remove-shot" data-i="'+i+'">Remove</button></div></div>').join('');}
  function chooseMedia(input){[...input.files].forEach(addShot);input.value='';}
  function setCaptureKind(kind){state.captureKind=kind;document.querySelectorAll('.mode').forEach(b=>b.classList.toggle('active',b.dataset.kind===kind));}
  function openNewSample(){state.captureKind='visible';modal('<div class="modal" id="modal"><div class="modal-box" tabindex="-1"><div class="modal-head"><div><span class="eyebrow">New specimen</span><h2 class="modal-title">Give the stone an identity.</h2><p class="sub">Choose the material class. ProvenanceOS assigns the next number; you never type it.</p></div><button class="close" data-action="close-modal">×</button></div><div class="identity-preview"><div id="id-preview">—</div><small>database-assigned / permanent</small></div><div class="type-grid">'+TYPES.map(t=>'<button class="type-choice '+(t.code==='AHM'?'selected':'')+'" data-action="pick-type" data-code="'+t.code+'"><span>'+t.code+'</span><strong>'+t.name+'</strong><small>'+t.note+'</small></button>').join('')+'</div><div class="capture-note">Classification is recorded as field context. Use Unknown / Other when the material is uncertain; the specimen ID is permanent.</div><div class="fields"><div class="field"><label>Location</label><input id="f-location" value="Andamooka, South Australia"></div><div class="field"><label>Weight (g)</label><input id="f-weight" inputmode="decimal" placeholder="Optional"></div><div class="field full"><label>Notes</label><textarea id="f-notes" placeholder="Context worth preserving…"></textarea></div></div><div class="capture-block"><div class="capture-switch" id="capture-switch">'+captureModeButtons()+'</div><div class="camera" id="camera"><div class="camera-guide"><span>Place specimen inside frame</span><small>Original capture will be preserved.</small></div></div><div class="camera-actions" id="camera-actions"></div><div class="shots" id="shots"></div></div><div class="actions"><button class="secondary" data-action="close-modal">Cancel</button><button class="primary" id="save-btn" data-action="save-sample">Register specimen</button></div><div class="form-error" id="form-error"></div></div></div>');renderCameraActions();updatePreview('AHM');}
  async function uploadMedia(sampleId,item,derived){derived=derived||{};const f=item.file||item;validateMedia(f);const hash=await sha256(f),mime=f.type||'application/octet-stream',ext={'image/jpeg':'jpg','image/png':'png','image/webp':'webp','image/heic':'heic','image/heif':'heif','video/mp4':'mp4','video/webm':'webm','video/quicktime':'mov'}[mime]||'bin',path=sampleId+'/'+crypto.randomUUID()+'.'+ext,bucket=sb.storage.from(BUCKET);must(await bucket.upload(path,f,{contentType:mime,upsert:false}));let thumbPath=null,widthPx=null,heightPx=null;if(mime.startsWith('image/')){try{const bmp=await createImageBitmap(f);widthPx=bmp.width;heightPx=bmp.height;bmp.close?.()}catch{}try{const bmp=await createImageBitmap(f),k=Math.min(1,480/Math.max(bmp.width,bmp.height)),c=document.createElement('canvas');c.width=Math.round(bmp.width*k);c.height=Math.round(bmp.height*k);c.getContext('2d').drawImage(bmp,0,0,c.width,c.height);bmp.close?.();const th=await new Promise((res,rej)=>c.toBlob(b=>b?res(b):rej(new Error('thumbnail failed')),'image/jpeg',.82)),tp=sampleId+'/'+crypto.randomUUID()+'_thumb.jpg',rr=await bucket.upload(tp,th,{contentType:'image/jpeg',upsert:false});if(!rr.error)thumbPath=tp}catch{}}return api.addMedia({sample_id:sampleId,storage_path:path,thumb_path:thumbPath,file_name:f.name,content_type:mime,size_bytes:f.size,sha256:hash,capture_kind:item.captureKind||derived.captureKind||'visible',media_type:mime,processing_method:derived.processing_method||'original',is_original:derived.is_original!==false,derived_from_id:derived.derived_from_id||null,metadata:{...(derived.metadata||{}),file_last_modified:f.lastModified||null},width_px:widthPx,height_px:heightPx});}
  async function saveSample(){const btn=$('#save-btn'),err=$('#form-error'),rawW=$('#f-weight').value.trim(),w=rawW===''?null:Number(rawW),choice=document.querySelector('.type-choice.selected')||document.querySelector('.type-choice'),code=choice?.dataset.code||'AHM',info=typeInfo(code);if(w!==null&&(!Number.isFinite(w)||w<0)){err.textContent='Enter a valid non-negative weight or leave it blank.';return;}btn.disabled=true;btn.textContent='Creating identity…';let sample;try{sample=await api.addSample({sample_code:code,sample_type:info.name,location:$('#f-location').value.trim(),weight_g:w,dimensions:null,notes:$('#f-notes').value.trim()||null})}catch(e){err.textContent=errText(e);btn.disabled=false;btn.textContent='Register specimen';return;}let failed=0;for(let i=0;i<state.shots.length;i++){btn.textContent='Preserving evidence '+(i+1)+' of '+state.shots.length+'…';try{const original=await uploadMedia(sample.id,state.shots[i]);if(state.shots[i].cutout?.file)await uploadMedia(sample.id,{file:state.shots[i].cutout.file,captureKind:state.shots[i].captureKind},{derived_from_id:original.id,is_original:false,processing_method:'MediaPipe Interactive Segmenter / confidence threshold 0.5',metadata:{derived_from:'original capture',threshold:0.5}})}catch(e){console.error(e);failed++;}}closeModal();state.detail=null;toast(failed?sample.id+' created · '+failed+' media item'+(failed===1?'':'s')+' need attention':sample.id+' registered',failed?'error':undefined);go('#/samples/'+encodeURIComponent(sample.id));}
  function openEvidence(sampleId,kind){state.captureKind=['visible','fluorescence','phosphorescence'].includes(kind)?kind:'visible';modal('<div class="modal" id="modal"><div class="modal-box" tabindex="-1"><div class="modal-head"><div><span class="eyebrow">Evidence capture</span><h2 class="modal-title">'+(state.captureKind==='visible'?'Visible light':state.captureKind==='fluorescence'?'Fluorescence':'Phosphorescence')+'</h2><p class="sub">The original media is preserved. Derived presentation images are stored separately.</p></div><button class="close" data-action="close-modal">×</button></div><div class="capture-block"><div class="capture-switch">'+captureModeButtons()+'</div><div class="camera" id="camera"><div class="camera-guide"><span>Ready to capture</span><small>Use the same lighting setup consistently.</small></div></div><div class="camera-actions" id="camera-actions"></div><div class="shots" id="shots"></div></div><div class="evidence-instructions">For fluorescence and phosphorescence, note the excitation source and wavelength in the specimen notes when it matters. The video itself is the evidence record.</div><div class="actions"><button class="secondary" data-action="close-modal">Cancel</button><button class="primary" data-action="save-evidence" data-sample-id="'+esc(sampleId)+'">Preserve evidence</button></div><div class="form-error" id="form-error"></div></div></div>');renderCameraActions();}
  async function saveEvidence(sampleId){const err=$('#form-error');if(!state.shots.length){err.textContent='Capture or choose at least one item.';return;}let ok=0;for(const shot of state.shots){try{const original=await uploadMedia(sampleId,shot);if(shot.cutout?.file)await uploadMedia(sampleId,{file:shot.cutout.file,captureKind:shot.captureKind},{derived_from_id:original.id,is_original:false,processing_method:'MediaPipe Interactive Segmenter / confidence threshold 0.5',metadata:{derived_from:'original capture',threshold:0.5}});ok++}catch(e){err.textContent=errText(e)}}if(ok)toast(ok+' evidence item'+(ok===1?'':'s')+' preserved');closeModal();render({quiet:true});}

  // ── Historical reference import ──────────────────────────────────────────────────────────
  const HISTORICAL_PARSER_VERSION='historical-soil-v1.0.0';
  function openHistoricalImport(){
    modal('<div class="modal" id="modal"><div class="modal-box wide" tabindex="-1"><div class="modal-head"><div><span class="eyebrow">Reference data</span><h2 class="modal-title">Import historical soil data.</h2><p class="sub">The original file is preserved. Records remain separate from the physical specimen registry.</p></div><button class="close" data-action="close-modal">×</button></div><div class="fields"><div class="field"><label>Dataset name</label><input id="history-name" placeholder="e.g. 2018 soil reference dataset"></div></div><label class="dropzone">Choose historical CSV<input type="file" accept=".csv,text/csv,text/plain" hidden data-change="pick-history"></label><div id="history-summary"></div><div class="actions"><button class="secondary" data-action="close-modal">Cancel</button><button class="primary" id="history-import-btn" data-action="run-history-import" disabled>Import</button></div></div></div>');
  }
  async function pickHistoricalCsv(input){
    const file=input.files[0];input.value='';if(!file)return;
    const out=$('#history-summary'),btn=$('#history-import-btn');
    btn.disabled=true;state.historyPlan=null;out.innerHTML='<div class="loading-inline">Reading historical export…</div>';
    try{
      if(file.size>50*1024*1024)throw new Error('That export is larger than 50 MB — check the selected file.');
      const parsed=Vanta.parseHistoricalSoil(await file.text());
      const fileHash=await sha256(file);
      state.historyPlan={file,fileName:file.name,fileHash,parsed};
      if(!$('#history-name').value.trim()) $('#history-name').value=file.name.replace(/\.[^.]+$/,'');
      const locs=[...new Set(parsed.records.map(r=>r.location).filter(Boolean))];
      out.innerHTML='<div class="import-summary"><div class="stats compact"><div><b>'+parsed.recordCount+'</b><span>Historical records</span></div><div><b>'+parsed.observationCount+'</b><span>Element observations</span></div><div><b>'+locs.length+'</b><span>Locations</span></div></div><div class="section-title" style="margin-top:22px">Elements</div><div class="sub">'+parsed.elements.map(esc).join(' · ')+'</div><div class="section-title" style="margin-top:22px">Source</div><div class="sub">'+esc(file.name)+' · SHA-256 '+esc(fileHash.slice(0,16))+'…</div>'+(parsed.warnings.map(w=>'<div class="warn">'+esc(w)+'</div>').join(''))+'</div>';
      btn.disabled=false;btn.textContent='Preserve '+plural(parsed.recordCount,'record');
    }catch(e){out.innerHTML='<div class="form-error">'+esc(errText(e))+'</div>';}
  }
  async function runHistoricalImport(){
    const p=state.historyPlan,btn=$('#history-import-btn');if(!p?.parsed?.records?.length)return;
    btn.disabled=true;btn.textContent='Preserving source…';
    try{
      let raw=await api.rawByHash(p.fileHash);
      if(raw){
        const existing=await api.historicalByRawFile(raw.id);
        if(existing)throw new Error('This historical source has already been imported.');
      }else{
        const storagePath=new Date().getFullYear()+'/historical/'+p.fileHash+'.csv';
        const rr=await sb.storage.from(RAW_BUCKET).upload(storagePath,p.file,{contentType:'text/csv',upsert:false});
        if(rr.error&&!/already exists/i.test(rr.error.message))throw rr.error;
        try{raw=await api.addRaw({file_name:p.fileName,storage_path:storagePath,content_type:'text/csv',size_bytes:p.file.size,sha256:p.fileHash,parser_version:HISTORICAL_PARSER_VERSION,metadata:{header_row:p.parsed.headerRowNo,delimiter:p.parsed.delimiter,elements:p.parsed.elements,warnings:p.parsed.warnings,record_count:p.parsed.recordCount,observation_count:p.parsed.observationCount}})}
        catch(e){if(e?.code==='23505'){raw=await api.rawByHash(p.fileHash);if(await api.historicalByRawFile(raw.id))throw new Error('This historical source has already been imported.');}else throw e;}
      }
      const dataset=await api.addHistoricalDataset({name:$('#history-name').value.trim()||p.fileName,dataset_type:'soil_reference',description:'Historical soil / pXRF reference dataset',raw_file_id:raw.id,parser_version:HISTORICAL_PARSER_VERSION,metadata:{source_file:p.fileName,source_sha256:p.fileHash,record_count:p.parsed.recordCount,observation_count:p.parsed.observationCount,elements:p.parsed.elements,units:p.parsed.units,locations:[...new Set(p.parsed.records.map(r=>r.location).filter(Boolean))].slice(0,500),warnings:p.parsed.warnings}});
      btn.textContent='Storing records…';
      const recordRows=p.parsed.records.map(r=>({dataset_id:dataset.id,source_row_no:r.sourceRowNo,original_index:r.originalIndex,location:r.location,original_time:r.originalTime,measured_at_local:r.measuredAtLocal,time_ambiguous:r.timeAmbiguous,original_sample:r.originalSample,material_type:r.materialType,duration_s:r.durationS,units:r.units,sigma_value:r.sigmaValue,sequence:r.sequence,res:r.res,escale:r.eScale,shape_time:r.shapeTime,inspector:r.inspector,cor_1:r.cor1,cor_2:r.cor2,misc:r.misc,note:r.note,flags:r.flags,raw:r.raw}));
      const stored=await api.addHistoricalRecords(recordRows);
      const idByRow=new Map(stored.map(r=>[r.source_row_no,r.id]));
      const obs=[];
      p.parsed.records.forEach(r=>r.observations.forEach(o=>{const recordId=idByRow.get(r.sourceRowNo);if(recordId)obs.push({record_id:recordId,analyte:o.analyte,raw_value:o.raw_value,value:o.value,qualifier:o.qualifier,detection_limit:o.detection_limit,raw_error:o.raw_error,error:o.error,unit:o.unit});}));
      for(let i=0;i<obs.length;i+=250)await api.addHistoricalObservations(obs.slice(i,i+250));
      closeModal();state.historyPlan=null;toast(dataset.name+' preserved · '+p.parsed.recordCount+' historical records');render({quiet:true});
    }catch(e){console.error(e);const box=$('#history-summary');if(box)box.insertAdjacentHTML('beforeend','<div class="form-error">'+esc(errText(e))+'</div>');btn.disabled=false;btn.textContent='Try again';}
  }

  // ── Vanta batch import ────────────────────────────────────────────────────────────────────
  function storageResults(results,unitsAssumed){if(!unitsAssumed)return results;return Object.fromEntries(Object.entries(results||{}).map(([el,r])=>[el,{...r,unit:r.lod?r.unit:'UNVERIFIED'}]));}
  function openImport(target){state.importTarget=target||null;modal('<div class="modal" id="modal"><div class="modal-box wide" tabindex="-1"><div class="modal-head"><div><span class="eyebrow">pXRF</span><h2 class="modal-title">'+(target?'Attach to '+esc(target):'Import Vanta export')+'</h2><p class="sub">'+(target?'This file is restricted to the named specimen.':'Choose the periodic Vanta CSV export. Every row with an exact specimen ID will attach automatically; unmatched rows remain in review.')+'</p></div><button class="close" data-action="close-modal">×</button></div><label class="dropzone">Choose CSV file<input type="file" accept=".csv,text/csv,text/plain" hidden data-change="pick-csv"></label><div id="import-summary"></div><div class="actions"><button class="secondary" data-action="close-modal">Cancel</button><button class="primary" id="import-btn" data-action="run-import" disabled>Import</button></div></div></div>');}
  async function pickCsv(input){const file=input.files[0];input.value='';if(!file)return;const out=$('#import-summary'),btn=$('#import-btn');btn.disabled=true;state.plan=null;out.innerHTML='<div class="loading-inline">Reading and matching…</div>';try{state.plan=await buildPlan(file,state.importTarget);out.innerHTML=planSummary(state.plan);const importable=state.plan.parsed.readings.length>0;btn.disabled=!importable;btn.textContent=state.plan.rows.length?'Import '+plural(state.plan.rows.length,'reading'):state.plan.parsed.readings.length?'Preserve export':'Nothing to import';}catch(e){out.innerHTML='<div class="form-error">'+esc(errText(e))+'</div>';}}
  async function buildPlan(file,target){if(file.size>50*1024*1024)throw new Error('That export is larger than 50 MB — check the selected file.');const parsed=Vanta.parse(await file.text()),fileHash=await sha256(file),known=target?new Set([target]):await api.knownIds([...new Set(parsed.readings.map(r=>r.sampleId).filter(Boolean))]),rows=[],skipped=[];for(const r of parsed.readings){let sid=null,why=null;if(target){if(!r.sampleId||r.sampleId===target)sid=target;else why='row is labelled '+r.sampleId;}else if(!r.sampleId)why='no specimen ID in row';else if(!known.has(r.sampleId))why=r.sampleId+' is not registered';else sid=r.sampleId;if(sid)rows.push({r,sid,readingHash:await sha256(JSON.stringify(r.raw))});else skipped.push({r,why});}return {file,fileName:file.name,fileHash,parsed,rows,skipped};}
  function planSummary(p){const bySample=new Map(),reasons=new Map();p.rows.forEach(x=>bySample.set(x.sid,(bySample.get(x.sid)||0)+1));p.skipped.forEach(x=>reasons.set(x.why,(reasons.get(x.why)||0)+1));return '<div class="import-summary"><div class="stats compact"><div><b>'+p.parsed.readings.length+'</b><span>Readings in file</span></div><div><b>'+p.rows.length+'</b><span>Exact matches</span></div><div><b>'+reasons.size+'</b><span>Review reasons</span></div></div><div class="section-title" style="margin-top:22px">Elements</div><div class="sub">'+p.parsed.elements.map(esc).join(' · ')+'</div>'+(bySample.size?'<div class="section-title" style="margin-top:22px">Matched specimens</div><div class="match-strip">'+[...bySample].map(([id,n])=>'<span>'+esc(id)+' · '+n+'</span>').join('')+'</div>':'')+(p.skipped.length?'<div class="review-box"><strong>'+p.skipped.length+' row'+(p.skipped.length===1?'':'s')+' held for review</strong><small>'+[...reasons].map(([r,n])=>n+' × '+esc(r)).join(' · ')+'</small><p>No reading is attached when ProvenanceOS cannot establish the specimen identity.</p></div>':'')+(p.parsed.warnings.map(w=>'<div class="warn">'+esc(w)+'</div>').join(''))+'</div>';}
  async function runImport(){const p=state.plan,btn=$('#import-btn');if(!p?.parsed?.readings.length)return;btn.disabled=true;btn.textContent='Preserving export…';let raw=null,inserted=0;try{raw=await api.rawByHash(p.fileHash);if(!raw){const storagePath=new Date().getFullYear()+'/'+p.fileHash+'.csv',rr=await sb.storage.from(RAW_BUCKET).upload(storagePath,p.file,{contentType:'text/csv',upsert:false});if(rr.error&&!/already exists/i.test(rr.error.message))throw rr.error;try{raw=await api.addRaw({file_name:p.fileName,storage_path:storagePath,content_type:'text/csv',size_bytes:p.file.size,sha256:p.fileHash,parser_version:PARSER_VERSION,metadata:{header_row:p.parsed.headerRowNo,delimiter:p.parsed.delimiter,elements:p.parsed.elements,warnings:p.parsed.warnings,units_assumed:p.parsed.unitsAssumed}})}catch(e){if(e?.code==='23505')raw=await api.rawByHash(p.fileHash);else throw e;}}const payload=p.rows.map(x=>({sample_id:x.sid,instrument:x.r.instrument||'Vanta',method:x.r.method,reading_no:x.r.readingNo,measured_at:x.r.measuredAt,results:storageResults(x.r.results,p.parsed.unitsAssumed),raw:x.r.raw,source_file:p.fileName,source_sha256:p.fileHash,reading_hash:x.readingHash,raw_file_id:raw.id,parser_version:PARSER_VERSION,match_method:'sample_id',match_confidence:1,match_basis:'exact specimen ID in source row'}));for(let i=0;i<payload.length;i+=250)inserted+=await api.addAnalyses(payload.slice(i,i+250));const dup=payload.length-inserted,batch=await api.addImport({raw_file_id:raw.id,parser_version:PARSER_VERSION,imported_count:inserted,duplicate_count:dup,skipped_count:p.skipped.length,warnings:p.parsed.warnings,metadata:{matched_specimens:[...new Set(payload.map(x=>x.sample_id))],units_assumed:p.parsed.unitsAssumed}});if(p.skipped.length)await api.addUnmatched(p.skipped.map(x=>({import_batch_id:batch.id,row_no:x.r.rowNo,sample_id:x.r.sampleId,reason:x.why,raw:x.r.raw})).slice(0,5000));closeModal();toast(plural(inserted,'reading')+' attached'+(dup?' · '+dup+' already held':'')+(p.skipped.length?' · '+p.skipped.length+' awaiting review':''));render({quiet:true});}catch(e){console.error(e);const box=$('#import-summary');if(box)box.insertAdjacentHTML('beforeend','<div class="form-error">'+esc(errText(e))+(inserted?' '+inserted+' readings were saved before the error; repeating the import is safe.':'')+'</div>');btn.disabled=false;btn.textContent='Try again';}}

  // ── measurement + masking ────────────────────────────────────────────────────────────────
  function openMeasure(){const d=state.detail;if(!d?.images?.length)return toast('Capture a visible-light image first.','error');const vis=d.images.find(x=>x.capture_kind==='visible')||d.images[0],u=d.urlOf(vis.storage_path);if(!u)return toast('The image is not available yet.','error');modal('<div class="modal" id="modal"><div class="modal-box wide" tabindex="-1"><div class="modal-head"><div><span class="eyebrow">Camera measurement</span><h2 class="modal-title">Measure with a known reference.</h2><p class="sub">Traceable 2D estimate only. The app does not infer thickness from a single image.</p></div><button class="close" data-action="close-modal">×</button></div><div class="measure-intro"><label class="field"><span>Reference length (mm)</span><input id="ref-mm" value="10" inputmode="decimal"></label><p>Put a ruler or known reference in the same image plane. Tap its endpoints, then tap the specimen endpoints.</p></div><div class="measure-canvas-wrap"><img id="measure-img" data-image-id="'+esc(vis.id)+'" src="'+esc(u)+'" alt="Measurement image"><canvas id="measure-canvas"></canvas></div><div class="measure-status" id="measure-status">1. Tap the two ends of the known reference.</div><div class="measure-results" id="measure-results"></div><div class="actions"><button class="secondary" data-action="reset-measure">Reset</button><button class="primary" data-action="save-measure" data-id="'+esc(d.sample.id)+'" disabled>Save estimate</button></div></div></div>');initMeasure();}
  function initMeasure(){const img=$('#measure-img'),cv=$('#measure-canvas');if(!img||!cv)return;const draw=()=>{cv.width=img.clientWidth;cv.height=img.clientHeight};if(img.complete)draw();img.onload=draw;cv.addEventListener('click',measureTap);state.selectedMeasure={ref:[],len:[],img,imageId:img.dataset.imageId};}
  function measureTap(e){const cv=$('#measure-canvas'),r=cv.getBoundingClientRect(),m=state.selectedMeasure,p={x:e.clientX-r.left,y:e.clientY-r.top};if(!m)return;if(m.ref.length<2)m.ref.push(p);else if(m.len.length<2)m.len.push(p);else return;drawMeasure();if(m.ref.length<2)$('#measure-status').textContent='1. Tap the second end of the known reference.';else if(m.len.length<2)$('#measure-status').textContent='2. Tap the two ends of the specimen length.';else calculateMeasure();}
  function drawMeasure(){const cv=$('#measure-canvas'),ctx=cv.getContext('2d'),m=state.selectedMeasure;if(!cv||!m)return;ctx.clearRect(0,0,cv.width,cv.height);[m.ref,m.len].forEach((a,idx)=>{if(!a.length)return;ctx.beginPath();a.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.strokeStyle=idx===0?'#6ed5d2':'#e8eee9';ctx.lineWidth=2;ctx.stroke();a.forEach(p=>{ctx.beginPath();ctx.arc(p.x,p.y,5,0,Math.PI*2);ctx.fillStyle=idx===0?'#6ed5d2':'#e8eee9';ctx.fill()})});}
  function calculateMeasure(){const m=state.selectedMeasure,refMm=Number($('#ref-mm').value),dist=a=>Math.hypot(a[1].x-a[0].x,a[1].y-a[0].y);if(!m||!Number.isFinite(refMm)||refMm<=0||m.ref.length<2||m.len.length<2)return;const refPx=dist(m.ref),objPx=dist(m.len);if(!refPx)return;const mm=objPx/refPx*refMm;m.result={length_mm:mm,reference_mm:refMm,reference_px:refPx,object_px:objPx,method:'2D camera calibration'};$('#measure-status').textContent='Estimate calculated from the shared image plane.';$('#measure-results').innerHTML='<div><span>Length</span><b>'+fmtNum(mm)+' mm</b></div><small>Reference '+fmtNum(refMm)+' mm · '+fmtNum(objPx)+' px specimen / '+fmtNum(refPx)+' px reference</small>';$('#modal [data-action="save-measure"]').disabled=false;}
  function resetMeasure(){const imageId=state.selectedMeasure?.imageId,img=state.selectedMeasure?.img;state.selectedMeasure={ref:[],len:[],img,imageId};$('#measure-results').innerHTML='';$('#measure-status').textContent='1. Tap the two ends of the known reference.';drawMeasure();}
  async function saveMeasure(id){const m=state.selectedMeasure;if(!m?.result)return;await api.saveMeasurement({sample_id:id,method:m.result.method,dimensions:{length_mm:m.result.length_mm,reference_mm:m.result.reference_mm,reference_px:m.result.reference_px,object_px:m.result.object_px,axis:'length'},reference_metadata:{note:'2D scale reference in same image plane',source_image_id:m.imageId}});closeModal();toast('Dimension estimate stored');render({quiet:true});}
  async function loadSegmenter(){if(state.segmenter||state.segmenterLoading)return state.segmenter;state.segmenterLoading=true;try{const mp=await import('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/vision_bundle.mjs');state.segmenterModule=mp;state.segVision=await mp.FilesetResolver.forVisionTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm');state.segmenter=await mp.InteractiveSegmenter.createFromOptions(state.segVision,{baseOptions:{modelAssetPath:'https://storage.googleapis.com/mediapipe-models/interactive_segmenter_v2/magic_touch/int8/1/interactive_segmentation.task'}});return state.segmenter;}catch{throw new Error('The on-device specimen mask could not be loaded. The original image remains unchanged.');}finally{state.segmenterLoading=false;}}
  function drawMaskPreview(mask,img){const w=mask.width,h=mask.height,data=mask.hasFloat32Array()?mask.getAsFloat32Array():null;if(!data)return;const c=document.createElement('canvas');c.width=w;c.height=h;const ctx=c.getContext('2d'),im=ctx.createImageData(w,h);for(let i=0;i<data.length;i++){const a=data[i]>=0.5?255:0;im.data[i*4]=255;im.data[i*4+1]=255;im.data[i*4+2]=255;im.data[i*4+3]=a;}ctx.putImageData(im,0,0);const cut=document.createElement('canvas');cut.width=img.naturalWidth;cut.height=img.naturalHeight;const cc=cut.getContext('2d');cc.drawImage(img,0,0);cc.globalCompositeOperation='destination-in';cc.drawImage(c,0,0,cut.width,cut.height);state.maskResult.preview=cut;}
  async function openMask(i){const shot=state.shots[i];if(!shot||!shot.mime.startsWith('image/'))return toast('Background cleanup is available for photographs only.','error');document.getElementById('mask-modal')?.remove();document.body.insertAdjacentHTML('beforeend','<div class="modal" id="mask-modal"><div class="modal-box wide" tabindex="-1"><div class="modal-head"><div><span class="eyebrow">Derived specimen image</span><h2 class="modal-title">Tap the stone.</h2><p class="sub">This creates a presentation cutout. The original capture is never modified.</p></div><button class="close" data-action="close-mask">×</button></div><div class="mask-stage"><img id="mask-img" src="'+esc(shot.url)+'" alt=""><div class="mask-overlay" id="mask-overlay">Preparing on-device model…</div></div><div class="mask-status" id="mask-status">The model runs on-device. Tap the specimen when ready.</div><div class="actions"><button class="secondary" data-action="close-mask">Cancel</button><button class="primary" id="mask-save" data-action="apply-mask" data-i="'+i+'" disabled>Generate cutout</button></div></div></div>');try{const seg=await loadSegmenter(),img=$('#mask-img');seg.setImage(img);$('#mask-overlay').textContent='Tap the stone to refine the mask.';$('#mask-overlay').classList.add('ready');$('#mask-overlay').onclick=e=>{const r=img.getBoundingClientRect(),x=(e.clientX-r.left)/r.width,y=(e.clientY-r.top)/r.height;try{const B=state.segmenterModule.BrushMode,result=seg.segment([{brushMode:B.POSITIVE,point:[{x,y}],isCompleted:true}]),mask=result.confidenceMasks?.[0];if(!mask)throw new Error('No confidence mask returned');state.maskResult={shotIndex:i,mask,img};drawMaskPreview(mask,img);$('#mask-status').textContent='Mask ready. Generate the derived cutout.';$('#mask-save').disabled=false;}catch(err){console.error(err);$('#mask-status').textContent='Try another point on the specimen.';}}}catch(e){$('#mask-status').textContent=errText(e);}}
  async function applyMask(i){const mr=state.maskResult,original=state.shots[i];if(!mr?.preview||!original)return;const blob=await new Promise((res,rej)=>mr.preview.toBlob(b=>b?res(b):rej(new Error('Cutout failed')),'image/png'));original.cutout={file:new File([blob],original.file.name.replace(/\.[^.]+$/,'')+'-cutout.png',{type:'image/png'}),captureKind:original.captureKind};state.maskResult=null;document.getElementById('mask-modal')?.remove();toast('Derived cutout prepared — original preserved.');}

  const actions={
    nav:e=>go('#/'+e.dataset.page),
    'open-sample':e=>go('#/samples/'+encodeURIComponent(e.dataset.id)),
    'new-sample':openNewSample,'close-modal':closeModal,'retry':()=>render(),'retry-boot':boot,'sign-out':async()=>{await sb.auth.signOut()},
    'pick-type':e=>{document.querySelectorAll('.type-choice').forEach(b=>b.classList.remove('selected'));e.classList.add('selected');updatePreview(e.dataset.code)},
    'start-camera':startCamera,'stop-camera':stopCamera,'capture-photo':capturePhoto,'record-video':recordVideo,'stop-recording':stopRecording,
    'remove-shot':e=>{const s=state.shots.splice(+e.dataset.i,1)[0];if(s?.url)URL.revokeObjectURL(s.url);renderShots()},'clean-shot':e=>openMask(+e.dataset.i),'save-sample':saveSample,
    'new-evidence':e=>openEvidence(state.detail?.sample.id,e.dataset.kind||'visible'),'capture-evidence':()=>openEvidence(state.detail?.sample.id,'visible'),'save-evidence':e=>saveEvidence(e.dataset.sampleId),
    'import-csv':e=>openImport(e.dataset.id||null),'import-history':openHistoricalImport,'run-history-import':runHistoricalImport,'run-import':runImport,'tab':e=>{state.tab=e.dataset.tab;$('#content').innerHTML=samplePageHTML(state.detail)},
    'measure':openMeasure,'reset-measure':resetMeasure,'save-measure':e=>saveMeasure(e.dataset.id),'apply-mask':e=>applyMask(+e.dataset.i),'close-mask':()=>{document.getElementById('mask-modal')?.remove();state.maskResult=null;},
    'filter-type':async e=>{const all=await api.overview({limit:500}),list=e.dataset.code==='ALL'?all:all.filter(s=>s.sample_code===e.dataset.code),u=await signed(list.map(x=>x.cover_thumb_path||x.cover_path)),box=$('#sample-list');if(box)box.innerHTML=list.map(s=>sampleRow(s,u)).join('')||'<div class="empty-state"><p>No specimens in that class yet.</p></div>';document.querySelectorAll('.filter').forEach(b=>b.classList.toggle('active',b===e));},
    'capture-mode':e=>setCaptureKind(e.dataset.kind)
  };
  const changes={'pick-media':chooseMedia,'pick-csv':pickCsv,'pick-history':pickHistoricalCsv};
  document.addEventListener('click',e=>{const el=e.target.closest('[data-action]');if(el&&actions[el.dataset.action]){const r=actions[el.dataset.action](el,e);if(r?.catch)r.catch(err=>toast(errText(err),'error'));}});
  document.addEventListener('change',e=>{const fn=changes[e.target.dataset?.change];if(fn)fn(e.target);});
  document.addEventListener('keydown',e=>{if(e.key==='Escape')closeModal();});
  window.addEventListener('hashchange',()=>{closeModal();render();});
  document.addEventListener('submit',e=>{if(e.target.dataset.form!=='login')return;e.preventDefault();login(e.target);});

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
    try {
      if (!window.supabase || !cfg.SUPABASE_URL || !cfg.SUPABASE_KEY) return showFatal('The Supabase library didn’t load. Check your connection and reload.');
      if (!sb) {
        sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_KEY);
        sb.auth.onAuthStateChange(event => { if (event === 'SIGNED_OUT') setTimeout(() => { state.user = null; state.detail = null; urlCache.clear(); showLogin(); }, 0); });
      }
      showBooting();
      const schema = await checkSchema();
      if (schema === 'offline') return showFatal('Can’t reach Supabase. Check your signal and try again.');
      if (schema === 'missing') return showSetup();
      const { data: { session }, error } = await sb.auth.getSession();
      if (error) throw error;
      if (!session) return showLogin();
      await afterAuth();
    } catch (e) {
      console.error('[ProvenanceOS boot]', e);
      showFatal(errText(e));
    }
  }

  boot();
})();
