/* Console: Launch & Capacity (13 Oct a).

   Everything here goes through the economy worker's /v1/admin/launch routes,
   which check the operator and the console password, validate, version,
   publish and audit every change. Nothing here writes Firestore directly. */
(function () {
  const MIB = 1048576, GIB = 1073741824;
  let H = null;
  let root = null;
  const S = { env: 'production', data: null, metrics: null, metricsErr: '', wl: null, editing: '' };

  const FIELDS = [
    ['broadcast.maxVideoBytes', 'Broadcast video: largest file', 'MB'],
    ['broadcast.maxVideoSec', 'Broadcast video: longest', 'min'],
    ['broadcast.maxImageBytes', 'Broadcast image: largest file', 'MB'],
    ['broadcast.maxImageSide', 'Broadcast image: longest side', 'px'],
    ['broadcast.uploadsPerDay', 'Broadcast uploads per account per day', 'n'],
    ['broadcast.bytesPerDay', 'Broadcast data per account per day', 'GB'],
    ['broadcast.maxResolution', 'Suggested resolution (shown to creators)', 'text'],
    ['signal.maxVideoBytes', 'Signal video: largest file (95 MB at most)', 'MB'],
    ['signal.maxVideoSec', 'Signal video: longest', 'min'],
    ['signal.maxImageBytes', 'Signal and photo: largest image', 'MB'],
    ['signal.maxImageSide', 'Signal and photo: longest side', 'px'],
    ['signal.uploadsPerDay', 'Signal and photo uploads per account per day', 'n'],
    ['signal.bytesPerDay', 'Signal and photo data per account per day', 'GB'],
    ['account.maxStorageBytes', 'Storage per account, each store (0 = no limit)', 'GB'],
    ['account.concurrentUploads', 'Uploads at once per account', 'n'],
    ['live.maxLiveSec', 'Longest live (0 = no limit)', 'min'],
    ['live.maxSimultaneous', 'Lives at once per account', 'n'],
    ['incompleteUploadHours', 'Abandoned uploads removed after', 'h'],
    ['unreadableDuration', 'A video whose length cannot be read', 'mode'],
    ['formats.video', 'Video formats accepted', 'list'],
    ['formats.image', 'Image formats accepted', 'list'],
    ['formats.audio', 'Audio formats accepted', 'list'],
  ];
  const FEATURE_NOTES = {
    signals: 'New Signals stop. Signals already up stay until they expire.',
    broadcasts: 'New Broadcasts stop. Everything published stays.',
    live: 'New lives stop. A live already running carries on until it ends.',
    uploads: 'New uploads are refused. An upload already sending finishes.',
    comments: 'New comments and replies stop. Existing ones stay.',
    questions: 'New questions, results and resources stop. Existing ones stay.',
    bands: 'New Bands cannot be started. Existing Bands carry on.',
  };

  const esc = function (s) { return H.escapeHtml(String(s == null ? '' : s)); };
  function get(o, path) { return path.split('.').reduce(function (x, k) { return x == null ? undefined : x[k]; }, o); }
  function set(o, path, v) { const ks = path.split('.'); let x = o; ks.slice(0, -1).forEach(function (k) { if (!x[k] || typeof x[k] !== 'object') x[k] = {}; x = x[k]; }); x[ks[ks.length - 1]] = v; }
  function show(v, unit) {
    if (v == null) return '';
    if (unit === 'MB') return String(Math.round(v / MIB * 100) / 100);
    if (unit === 'GB') return String(Math.round(v / GIB * 100) / 100);
    if (unit === 'min') return String(Math.round(v / 60 * 100) / 100);
    if (unit === 'list') return (v || []).join(', ');
    return String(v);
  }
  function read(raw, unit) {
    const t = String(raw == null ? '' : raw).trim();
    if (unit === 'text' || unit === 'mode') return t;
    if (unit === 'list') return t.split(/[\s,]+/).filter(Boolean);
    const n = Number(t);
    if (!isFinite(n) || n < 0) return NaN;
    if (unit === 'MB') return Math.round(n * MIB);
    if (unit === 'GB') return Math.round(n * GIB);
    if (unit === 'min') return Math.round(n * 60);
    return Math.round(n);
  }
  function human(v, unit) {
    if (unit === 'MB' || unit === 'GB') return v ? (v >= GIB ? (Math.round(v / GIB * 10) / 10) + ' GB' : Math.round(v / MIB) + ' MB') : 'no limit';
    if (unit === 'min') return v ? (v >= 3600 ? (Math.round(v / 360) / 10) + ' h' : Math.round(v / 60) + ' min') : 'no limit';
    return String(v);
  }
  function when(t) { return t ? new Date(Number(t)).toLocaleString() : '—'; }
  function bytesText(b) { return b == null ? '—' : (b >= GIB ? (Math.round(b / GIB * 100) / 100) + ' GB' : (Math.round(b / MIB * 10) / 10) + ' MB'); }
  function badge(text, tone) {
    const c = { ok: '#7CFFB2', warn: '#ffc266', bad: '#ff8a9a', dim: 'rgba(232,236,245,.6)' }[tone || 'dim'];
    return '<span style="display:inline-block;padding:2px 8px;border-radius:999px;border:1px solid ' + c + ';color:' + c + ';font-size:11px;letter-spacing:.03em;">' + esc(text) + '</span>';
  }
  const LEVEL_TONE = { normal: 'ok', watch: 'warn', warning: 'warn', critical: 'bad', unknown: 'dim', 'not set': 'dim' };

  async function call(path, body) {
    const sep = path.indexOf('?') >= 0 ? '&' : '?';
    const res = await H.adminWorker(path + sep + 'env=' + encodeURIComponent(S.env), body ? { method: 'POST', body: JSON.stringify(body) } : {});
    if (!res) throw new Error('Could not reach the service');
    const j = await res.json().catch(function () { return {}; });
    if (!res.ok || j.ok === false) {
      const e = new Error((j.errors && j.errors.join(' · ')) || j.error || ('The service said ' + res.status));
      e.body = j; throw e;
    }
    return j;
  }
  function ask(question) {
    const r = window.prompt(question + '\n\nReason (kept in the audit, optional):', '');
    return r === null ? null : r;
  }

  /* What goes down when moving to another phase (same test as the worker). */
  function lowered(from, to) {
    const out = [];
    FIELDS.forEach(function (f) {
      if (['n', 'MB', 'GB', 'min', 'px', 'h'].indexOf(f[2]) < 0) return;
      const a = Number(get(from, f[0])) || 0, b = Number(get(to, f[0])) || 0;
      if (a === b) return;
      if ((a === 0 && b > 0) || (b > 0 && b < a)) out.push(f[1] + ': ' + human(a, f[2]) + ' → ' + human(b, f[2]));
    });
    return out;
  }

  async function load() {
    root.innerHTML = '<p class="sub">Reading launch settings…</p>';
    try {
      S.data = await call('/v1/admin/launch');
    } catch (e) {
      root.innerHTML = H.card('Launch & Capacity', '<p class="sub">Could not read the launch settings: ' + esc(e.message) + '</p>');
      return;
    }
    S.loadedAt = Date.now();
    paint();
    call('/v1/admin/launch/metrics').then(function (m) { S.metrics = m; S.metricsErr = ''; S.metricsAt = Date.now(); paintMetrics(); }, function (e) { S.metricsErr = e.message; paintMetrics(); });
    startQuietRefresh();
  }

  /* 13b: background refresh. New figures come in without the page going
     blank: the tab is drawn off-screen and only the parts that changed are
     swapped in, so the reading position stays. Nothing refreshes while you
     are typing, editing a phase or have unsaved changes on the page. */
  function busy() {
    if (!root || !root.isConnected || document.hidden) return true;
    if (S.editing) return true;
    const a = document.activeElement;
    if (a && root.contains(a) && /^(INPUT|SELECT|TEXTAREA)$/.test(a.tagName)) return true;
    const fields = root.querySelectorAll('input, select, textarea');
    for (let i = 0; i < fields.length; i++) {
      const f = fields[i];
      if (f.type === 'checkbox' || f.type === 'radio') { if (f.checked !== f.defaultChecked) return true; continue; }
      if (f.tagName === 'SELECT') { if (f.id !== 'lcEnv' && f.options[f.selectedIndex] && !f.options[f.selectedIndex].defaultSelected) return true; continue; }
      if (String(f.value) !== String(f.defaultValue)) return true;
    }
    return false;
  }
  function morph(live, fresh) {
    const a = Array.prototype.slice.call(live.children), b = Array.prototype.slice.call(fresh.children);
    if (a.length !== b.length) { while (live.firstChild) live.removeChild(live.firstChild); b.forEach(function (n) { live.appendChild(n); }); return; }
    for (let i = 0; i < a.length; i++) {
      if (a[i].outerHTML === b[i].outerHTML) continue;
      if (a[i].tagName === b[i].tagName && a[i].className === b[i].className && a[i].children.length && a[i].children.length === b[i].children.length && a[i].id === b[i].id) { morph(a[i], b[i]); continue; }
      live.replaceChild(b[i], a[i]);
    }
  }
  function repaintQuietly() {
    const live = root;
    const fresh = live.cloneNode(false);
    root = fresh;
    try { paint(); if (S.metrics || S.metricsErr) paintMetrics(); } finally { root = live; }
    morph(live, fresh);
  }
  /* After a save or action: fetch and swap in, without blanking the page. */
  async function refreshNow() {
    try {
      S.data = await call('/v1/admin/launch');
      S.loadedAt = Date.now();
      repaintQuietly();
      call('/v1/admin/launch/metrics').then(function (m) { S.metrics = m; S.metricsAt = Date.now(); S.metricsErr = ''; paintMetrics(); }, function () {});
    } catch (e) { load(); }
  }
  let timer = null;
  function startQuietRefresh() {
    if (timer) clearInterval(timer);
    timer = setInterval(async function () {
      if (!root || !root.isConnected) { clearInterval(timer); timer = null; return; }
      if (busy()) return;
      try {
        const next = await call('/v1/admin/launch');
        let metrics = null;
        if (!S.metricsAt || Date.now() - S.metricsAt > 120000) {
          metrics = await call('/v1/admin/launch/metrics').catch(function () { return null; });
        }
        if (busy()) return;
        const same = JSON.stringify(next) === JSON.stringify(S.data);
        if (metrics) { S.metrics = metrics; S.metricsAt = Date.now(); S.metricsErr = ''; }
        if (same && !metrics) return;
        S.data = next;
        S.loadedAt = Date.now();
        repaintQuietly();
      } catch (_) { /* try again next time; what is on screen stays */ }
    }, 45000);
  }

  function regState() {
    const c = S.data.config, n = S.data.counter.registered;
    const r = c.registration;
    if (r.emergencyPause) return ['Paused (emergency)', 'bad'];
    if (!r.open) return ['Closed', 'warn'];
    if (n != null && n >= r.maxAccounts) return ['Full', 'warn'];
    return ['Open', 'ok'];
  }

  function paint() {
    const d = S.data, c = d.config, n = d.counter.registered;
    const phase = c.phases[c.activePhase] || {};
    const rs = regState();
    const g = d.guardState;
    let html = '';
    html += '<div class="row" style="align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:10px;">'
      + '<label for="lcEnv" class="sub" style="margin:0;">Settings for</label>'
      + '<select id="lcEnv"><option value="production"' + (S.env === 'production' ? ' selected' : '') + '>Production</option><option value="staging"' + (S.env === 'staging' ? ' selected' : '') + '>Staging</option></select>'
      + '<span class="sub">Version ' + esc(c.version || 0) + (c.updatedAt ? ' · saved ' + esc(when(c.updatedAt)) : ' · defaults, not saved yet') + '</span>'
      + '<button type="button" class="ghost" id="lcReload">Reload</button></div>';
    if (S.env === 'staging') html += '<p class="sub">Staging settings are kept apart from production. The app uses them only when opened with ?launchEnv=staging, and a worker deployed with LAUNCH_ENV=staging gives seats against them. Database rules always enforce production.</p>';
    html += H.kpis([
      ['Registered accounts', n == null ? '—' : n],
      ['Account cap', c.registration.maxAccounts],
      ['Places left', n == null ? '—' : Math.max(0, c.registration.maxAccounts - n)],
      ['Registration', rs[0]],
      ['Waiting list', c.registration.waitlist ? 'On' : 'Off'],
      ['Phase', phase.name || c.activePhase],
      ['Guard', g ? g.level : 'not measured yet'],
    ]);
    if (n != null && n > c.registration.maxAccounts) html += '<p class="sub">The cap is below the number of accounts. Nobody is removed; new sign-ups wait until the cap is above ' + esc(n) + '.</p>';

    // Registration + emergency pause
    html += H.card('Public registration',
      '<p class="sub">Anyone can create an account while registration is on and places remain. No invitations, country, phone, ID or extra checks are asked; sign-up is exactly as before. '
      + 'A registered account is a Callsign profile. The count starts from the profiles that exist and adds one for each new account; Recount counts the profiles again.</p>'
      + '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px;align-items:end;">'
      + '<label style=\"display:flex;align-items:center;gap:8px;text-transform:none;letter-spacing:0;font-family:inherit;font-size:13px;\"><input type="checkbox" id="lcOpen"' + (c.registration.open ? ' checked' : '') + ' /> Public registration on</label>'
      + '<label style=\"display:flex;align-items:center;gap:8px;text-transform:none;letter-spacing:0;font-family:inherit;font-size:13px;\"><input type="checkbox" id="lcWait"' + (c.registration.waitlist ? ' checked' : '') + ' /> Waiting list when closed or full</label>'
      + '<label>Most accounts Naluno accepts<input type="number" id="lcMax" min="0" step="1" value="' + esc(c.registration.maxAccounts) + '" /></label>'
      + '</div>'
      + '<div class="row" style="margin-top:10px;gap:8px;flex-wrap:wrap;"><button type="button" class="primary" id="lcRegSave">Save registration</button>'
      + '<button type="button" class="ghost" id="lcRecount">Recount accounts</button>'
      + '<span class="sub">Last recount: ' + esc(when(d.counter.recountedAt)) + ' · sign-ups refused so far: ' + esc(d.counter.refused) + '</span></div>'
      + '<div style="margin-top:14px;padding:12px;border:1px solid ' + (c.registration.emergencyPause ? '#ff8a9a' : 'var(--line, #2a3042)') + ';border-radius:12px;">'
      + '<b>Emergency registration pause</b> ' + (c.registration.emergencyPause ? badge('ON', 'bad') : badge('off', 'dim'))
      + '<p class="sub" style="margin:6px 0;">Stops every new sign-up at once, whatever the phase or cap. Everyone who has an account keeps signing in and using Naluno. A phase change never lifts it.</p>'
      + '<button type="button" class="' + (c.registration.emergencyPause ? 'primary' : 'ghost') + '" id="lcPause" style="' + (c.registration.emergencyPause ? '' : 'border-color:#ff8a9a;color:#ff8a9a;') + '">' + (c.registration.emergencyPause ? 'Lift the pause' : 'Pause registration now') + '</button></div>');

    // Phases
    let ph = '<p class="sub">Only one phase is active. Activating one applies its cap, registration setting, waiting list, media limits and storage allowance. It never deletes an account, Broadcast, Signal or file. You are shown every limit that goes down before you confirm.</p>'
      + '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px;">';
    Object.keys(c.phases).sort(function (a, b) { return (c.phases[a].order || 0) - (c.phases[b].order || 0); }).forEach(function (id) {
      const p = c.phases[id], m = p.media || {}, active = id === c.activePhase;
      ph += '<div style="border:1px solid ' + (active ? '#7CFFB2' : 'var(--line, #2a3042)') + ';border-radius:14px;padding:12px;">'
        + '<div style="display:flex;justify-content:space-between;gap:8px;align-items:center;"><b>' + esc(p.name) + '</b>' + (active ? badge('Active', 'ok') : badge('Inactive', 'dim')) + '</div>'
        + '<p class="sub" style="margin:6px 0;">' + esc(p.purpose || '') + '</p>'
        + '<div class="sub">Registration ' + (p.registrationOpen ? 'on' : 'off') + ' · waiting list ' + (p.waitlist ? 'on' : 'off') + '</div>'
        + '<div class="sub">Cap ' + esc(p.maxAccounts) + ' accounts' + (n != null ? ' · ' + esc(Math.max(0, p.maxAccounts - n)) + ' places left at this cap' : '') + '</div>'
        + '<div class="sub">Broadcast ' + esc(human(get(m, 'broadcast.maxVideoBytes'), 'MB')) + ', ' + esc(human(get(m, 'broadcast.maxVideoSec'), 'min')) + ' · Signal ' + esc(human(get(m, 'signal.maxVideoBytes'), 'MB')) + ', ' + esc(human(get(m, 'signal.maxVideoSec'), 'min')) + '</div>'
        + '<div class="sub">Per account ' + esc(human(get(m, 'account.maxStorageBytes'), 'GB')) + ' stored · live ' + esc(human(get(m, 'live.maxLiveSec'), 'min')) + ' · ' + esc(get(m, 'broadcast.maxResolution') || '') + '</div>'
        + '<div class="sub">Storage allowance ' + esc(bytesText(p.storageAllowanceBytes)) + '</div>'
        + '<div class="row" style="margin-top:8px;gap:8px;">'
        + (active ? '' : '<button type="button" class="primary lcActivate" data-id="' + esc(id) + '">Activate</button>')
        + '<button type="button" class="ghost lcEdit" data-id="' + esc(id) + '">Edit</button></div></div>';
    });
    ph += '</div><div id="lcEditor"></div>';
    html += H.card('Launch phases', ph);

    // Features
    let fe = '<p class="sub">Each switch is enforced by the database rules or the upload service, not only by the app. Off stops new activity; nothing already made is deleted.</p>';
    Object.keys(d.features).forEach(function (k) {
      fe += '<label style="display:flex;align-items:flex-start;gap:8px;margin:6px 0;text-transform:none;letter-spacing:0;font-family:inherit;font-size:13px;"><input type="checkbox" class="lcFeat" data-k="' + esc(k) + '"' + (c.features[k] !== false ? ' checked' : '') + ' /> <b>' + esc(d.features[k]) + '</b> <span class="sub">' + esc(FEATURE_NOTES[k] || '') + '</span></label>';
    });
    fe += '<p class="sub">Public registration is the switch above. Naluno has no server-side video processing, so there is no processing switch or job limit.</p>'
      + '<button type="button" class="primary" id="lcFeatSave">Save features</button>';
    html += H.card('Feature controls', fe);

    // Guardrails
    const gd = c.guard, t = gd.thresholds, b = gd.budgets, ar = gd.autoRestrict;
    let gu = '<p class="sub">Budgets are compared with what is measured. A budget left at 0 is not set and is not judged. Money is only what you type here; nothing is filled in for you. Cloudflare and Google have no automatic spending cap from Naluno: these limits restrict uploads and new lives, they do not stop a bill.</p>'
      + '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px;">'
      + '<label>Watch from (%)<input type="number" id="lcTw" min="1" max="99" value="' + esc(t.watch) + '" /></label>'
      + '<label>Warning from (%)<input type="number" id="lcTr" min="2" max="99" value="' + esc(t.warning) + '" /></label>'
      + '<label>Critical from (%)<input type="number" id="lcTc" min="3" max="100" value="' + esc(t.critical) + '" /></label>'
      + '<label>Monthly infrastructure budget (USD, Cloudflare usage)<input type="number" id="lcBm" min="0" step="0.01" value="' + esc(b.monthlyUsd || 0) + '" /></label>'
      + '<label>Media storage allowance (GB)<input type="number" id="lcBs" min="0" step="1" value="' + esc(show(b.storageBytes, 'GB')) + '" /></label>'
      + '<label>Uploaded per day, everyone (GB)<input type="number" id="lcBu" min="0" step="0.1" value="' + esc(show(b.dailyUploadBytes, 'GB')) + '" /></label>'
      + '<label>Database reads per day<input type="number" id="lcBr" min="0" step="1000" value="' + esc(b.dailyFirestoreReads) + '" /></label>'
      + '<label>Storage writes per day (R2 class A)<input type="number" id="lcBa" min="0" step="1000" value="' + esc(b.dailyR2ClassA) + '" /></label>'
      + '</div>'
      + '<p class="sub" style="margin-top:10px;">At Critical:</p>'
      + '<label style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;text-transform:none;letter-spacing:0;font-family:inherit;font-size:13px;"><input type="checkbox" id="lcArU"' + (ar.largeUploads ? ' checked' : '') + ' /> Refuse new uploads larger than <input type="number" id="lcArB" min="1" step="1" style="width:90px;" value="' + esc(show(ar.largeUploadBytes, 'MB')) + '" /> MB (smaller files still go through)</label>'
      + '<label style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;text-transform:none;letter-spacing:0;font-family:inherit;font-size:13px;"><input type="checkbox" id="lcArL"' + (ar.newLives ? ' checked' : '') + ' /> Refuse new lives (lives running carry on)</label>'
      + '<p class="sub">Sign-in, existing accounts and existing content are never restricted by the guard.</p>'
      + '<button type="button" class="primary" id="lcGuardSave">Save guardrails</button>';
    if (g && g.items) {
      gu += '<div style="margin-top:12px;"><b>Now</b> ' + badge(g.level, LEVEL_TONE[g.level]) + ' <span class="sub">measured ' + esc(when(g.at)) + ' by the 10-minute check'
        + (g.restricting && (g.restricting.largeUploads || g.restricting.newLives) ? ' · restricting: ' + [g.restricting.largeUploads ? 'large uploads' : '', g.restricting.newLives ? 'new lives' : ''].filter(Boolean).join(', ') : '') + '</span>'
        + '<div style="overflow-x:auto;max-width:100%;"><table style="width:100%;margin-top:6px;font-size:13px;"><tr><th align="left">Measure</th><th align="right">Used</th><th align="right">Budget</th><th align="right">%</th><th align="left">Level</th><th align="left">Source</th></tr>'
        + g.items.map(function (it) {
          const isB = it.key === 'storage' || it.key === 'uploadToday';
          const fmt = function (v) { return v == null ? '—' : (isB ? bytesText(v) : (it.key === 'monthCost' ? '$' + v : String(v))); };
          return '<tr><td>' + esc(it.label) + '</td><td align="right">' + esc(fmt(it.used)) + '</td><td align="right">' + esc(it.limit ? fmt(it.limit) : 'not set') + '</td><td align="right">' + esc(it.pct == null ? '—' : it.pct) + '</td><td>' + badge(it.level, LEVEL_TONE[it.level]) + '</td><td class="sub">' + esc(it.source || '') + '</td></tr>';
        }).join('') + '</table></div></div>';
    } else gu += '<p class="sub" style="margin-top:10px;">The guard has not measured yet. It runs every 10 minutes once the economy worker is deployed.</p>';
    html += H.card('Resource guardrails', gu);

    html += '<div id="lcMetrics">' + H.card('Monitoring', '<p class="sub">Counting…</p>') + '</div>';
    html += '<div id="lcWaitlist">' + H.card('Waiting list', '<button type="button" class="ghost" id="lcWlLoad">Show the waiting list</button>') + '</div>';

    // History and audit
    html += H.card('Settings history', (d.history || []).length
      ? '<p class="sub">Every saved version. Rolling back saves the old settings as a new version (it is checked again first).</p>'
        + '<div style="overflow-x:auto;max-width:100%;"><table style="width:100%;font-size:13px;"><tr><th align="left">Version</th><th align="left">When</th><th align="left">What</th><th align="left">Reason</th><th></th></tr>'
        + d.history.map(function (h) {
          return '<tr><td>' + esc(h.version) + '</td><td>' + esc(when(h.at)) + '</td><td>' + esc(h.action) + '</td><td>' + esc(h.reason || '') + '</td><td>'
            + (Number(h.version) !== Number(c.version) ? '<button type="button" class="ghost lcRoll" data-v="' + esc(h.version) + '">Roll back to this</button>' : badge('current', 'ok')) + '</td></tr>';
        }).join('') + '</table></div></div>'
      : '<p class="sub">No saved versions yet. The first save creates version 1.</p>');
    html += H.card('Launch audit', (d.audit || []).length
      ? '<p class="sub">Every change, refusal and guard change: who, when, what, from, to, why, result. Nobody can edit or delete these, the desk included.</p>'
        + '<div style="overflow-x:auto;max-width:100%;"><table style="width:100%;font-size:12px;"><tr><th align="left">When</th><th align="left">Who</th><th align="left">Action</th><th align="left">Changed</th><th align="left">Reason</th><th align="left">Result</th></tr>'
        + d.audit.map(function (a) {
          const ch = (a.changes || []).slice(0, 6).map(function (x) { return x.setting + ': ' + x.from + ' → ' + x.to; }).join('; ') + ((a.changes || []).length > 6 ? ' …' : '');
          return '<tr><td>' + esc(when(a.at)) + '</td><td>' + esc(a.actorEmail || a.actorUid) + '</td><td>' + esc(a.action) + '</td><td style="max-width:420px;word-break:break-word;">' + esc(ch) + '</td><td>' + esc(a.reason || '') + '</td><td>' + esc(a.result || '') + '</td></tr>';
        }).join('') + '</table></div></div>'
      : '<p class="sub">Nothing recorded yet.</p>');
    html += '<p class="msg" id="lcMsg" role="status"></p>';
    root.innerHTML = html;
    wire();
    if (S.editing) openEditor(S.editing);
  }

  function msg(t) { const m = root.querySelector('#lcMsg'); if (m) m.textContent = t; try { H.toast(t); } catch (_) {} }
  function clone() { return JSON.parse(JSON.stringify(S.data.config)); }
  async function save(next, reason, what) {
    try {
      const out = await call('/v1/admin/launch/save', { config: next, reason: reason || '', expectVersion: S.data.config.version || 0 });
      msg(what + ' saved as version ' + out.version + '.');
      await refreshNow();
    } catch (e) { msg('Not saved: ' + e.message); }
  }

  function wire() {
    const $ = function (id) { return root.querySelector('#' + id); };
    $('lcEnv').onchange = function () { S.env = this.value; S.metrics = null; S.wl = null; S.editing = ''; load(); };
    $('lcReload').onclick = refreshNow;
    $('lcRegSave').onclick = function () {
      const next = clone();
      next.registration.open = $('lcOpen').checked;
      next.registration.waitlist = $('lcWait').checked;
      const max = Number($('lcMax').value);
      if (!isFinite(max) || max < 0 || Math.floor(max) !== max) { msg('The cap must be a whole number, 0 or more.'); return; }
      next.registration.maxAccounts = max;
      const n = S.data.counter.registered;
      if (n != null && max < n && !window.confirm('The cap (' + max + ') is below the ' + n + ' accounts that exist. Nobody is removed; new sign-ups stop until the cap is raised. Continue?')) return;
      const why = ask('Save the registration settings?');
      if (why === null) return;
      save(next, why, 'Registration');
    };
    $('lcRecount').onclick = async function () {
      const why = ask('Count every Callsign profile again and set the account count to it?');
      if (why === null) return;
      try { const r = await call('/v1/admin/launch/recount', { reason: why }); msg('Counted ' + r.registered + ' accounts (was ' + r.before + ').'); refreshNow(); } catch (e) { msg('Could not recount: ' + e.message); }
    };
    $('lcPause').onclick = async function () {
      const on = !S.data.config.registration.emergencyPause;
      if (!window.confirm(on ? 'Pause all new registrations now? Existing accounts are not affected.' : 'Lift the emergency pause? Registration then follows the switch and the cap again.')) return;
      const why = ask(on ? 'Why are new registrations paused?' : 'Why is the pause lifted?');
      if (why === null) return;
      try { await call('/v1/admin/launch/pause', { on: on, reason: why }); msg(on ? 'New registrations are paused.' : 'The pause is lifted.'); refreshNow(); } catch (e) { msg('Not changed: ' + e.message); }
    };
    root.querySelectorAll('.lcActivate').forEach(function (btn) {
      btn.onclick = async function () {
        const id = btn.getAttribute('data-id');
        const c = S.data.config, p = c.phases[id];
        const down = lowered(c.media, p.media);
        const n = S.data.counter.registered;
        const lines = ['Activate "' + p.name + '"?', '', 'Cap: ' + c.registration.maxAccounts + ' → ' + p.maxAccounts + (n != null && p.maxAccounts < n ? ' (below the ' + n + ' accounts: nobody is removed, sign-ups stop)' : ''),
          'Registration: ' + (p.registrationOpen ? 'on' : 'off') + ', waiting list ' + (p.waitlist ? 'on' : 'off') + (c.registration.emergencyPause ? ' (the emergency pause stays on)' : '')];
        if (down.length) lines.push('', 'These limits go DOWN:', ...down.map(function (x) { return '• ' + x; }));
        else lines.push('', 'No limit goes down.');
        lines.push('', 'Nothing anyone made is deleted.');
        if (!window.confirm(lines.join('\n'))) return;
        const why = ask('Why this phase now?');
        if (why === null) return;
        try {
          const out = await call('/v1/admin/launch/activate', { phase: id, reason: why, expectVersion: c.version || 0 });
          msg('"' + p.name + '" is active (version ' + out.version + ').');
          refreshNow();
        } catch (e) { msg('Not activated: ' + e.message); }
      };
    });
    root.querySelectorAll('.lcEdit').forEach(function (btn) { btn.onclick = function () { S.editing = btn.getAttribute('data-id'); openEditor(S.editing); }; });
    $('lcFeatSave').onclick = function () {
      const next = clone();
      root.querySelectorAll('.lcFeat').forEach(function (cb) { next.features[cb.getAttribute('data-k')] = cb.checked; });
      const off = Object.keys(next.features).filter(function (k) { return next.features[k] === false && S.data.config.features[k] !== false; });
      if (off.length && !window.confirm('Turn off: ' + off.map(function (k) { return S.data.features[k]; }).join(', ') + '? New activity stops; nothing is deleted.')) return;
      const why = ask('Save the feature switches?');
      if (why === null) return;
      save(next, why, 'Features');
    };
    $('lcGuardSave').onclick = function () {
      const next = clone();
      const g = next.guard;
      g.thresholds = { watch: Number($('lcTw').value), warning: Number($('lcTr').value), critical: Number($('lcTc').value) };
      g.budgets.monthlyUsd = Math.round(Number($('lcBm').value) * 100) / 100;
      g.budgets.storageBytes = read($('lcBs').value, 'GB');
      g.budgets.dailyUploadBytes = read($('lcBu').value, 'GB');
      g.budgets.dailyFirestoreReads = read($('lcBr').value, 'n');
      g.budgets.dailyR2ClassA = read($('lcBa').value, 'n');
      g.autoRestrict = { largeUploads: $('lcArU').checked, largeUploadBytes: read($('lcArB').value, 'MB'), newLives: $('lcArL').checked };
      const why = ask('Save the guardrails?');
      if (why === null) return;
      save(next, why, 'Guardrails');
    };
    $('lcWlLoad').onclick = loadWaitlist;
    root.querySelectorAll('.lcRoll').forEach(function (btn) {
      btn.onclick = async function () {
        const v = btn.getAttribute('data-v');
        if (!window.confirm('Roll back to version ' + v + '? It is checked again and saved as a new version.')) return;
        const why = ask('Why roll back?');
        if (why === null) return;
        try { const out = await call('/v1/admin/launch/rollback', { version: Number(v), reason: why }); msg('Rolled back: now version ' + out.version + '.'); refreshNow(); } catch (e) { msg('Not rolled back: ' + e.message); }
      };
    });
  }

  function openEditor(id) {
    const box = root.querySelector('#lcEditor');
    const c = S.data.config, p = c.phases[id];
    if (!box || !p) return;
    const m = p.media || {};
    let h = '<div style="margin-top:14px;padding:12px;border:1px solid var(--line, #2a3042);border-radius:14px;">'
      + '<b>Edit "' + esc(p.name) + '"</b>' + (id === c.activePhase ? ' ' + badge('active: media limits apply as soon as you save', 'ok') : '')
      + '<p class="sub">Ceilings of the pipeline: a Broadcast file up to 8 GB and 3 hours; a Signal up to 95 MB. Reach still decides how long each person\'s Broadcast videos can be, inside these limits.</p>'
      + '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:10px;">'
      + '<label>Name<input id="pe_name" value="' + esc(p.name) + '" maxlength="60" /></label>'
      + '<label>Most accounts<input id="pe_max" type="number" min="0" step="1" value="' + esc(p.maxAccounts) + '" /></label>'
      + '<label>Storage allowance (GB)<input id="pe_store" type="number" min="0" step="1" value="' + esc(show(p.storageAllowanceBytes, 'GB')) + '" /></label>'
      + '<label style=\"display:flex;align-items:center;gap:8px;text-transform:none;letter-spacing:0;font-family:inherit;font-size:13px;\"><input type="checkbox" id="pe_open"' + (p.registrationOpen ? ' checked' : '') + ' /> Registration on</label>'
      + '<label style=\"display:flex;align-items:center;gap:8px;text-transform:none;letter-spacing:0;font-family:inherit;font-size:13px;\"><input type="checkbox" id="pe_wait"' + (p.waitlist ? ' checked' : '') + ' /> Waiting list on</label>';
    FIELDS.forEach(function (f, i) {
      const v = get(m, f[0]);
      if (f[2] === 'mode') {
        h += '<label>' + esc(f[1]) + '<select id="pe_f' + i + '"><option value="size-only"' + (v === 'size-only' ? ' selected' : '') + '>Check its size only</option><option value="reject"' + (v === 'reject' ? ' selected' : '') + '>Refuse it</option></select></label>';
      } else {
        const unitWord = { MB: 'MB', GB: 'GB', min: 'minutes', px: 'pixels', n: '', h: 'hours', text: '', list: '' }[f[2]];
        h += '<label>' + esc(f[1]) + (unitWord ? ' (' + unitWord + ')' : '') + '<input id="pe_f' + i + '" value="' + esc(show(v, f[2])) + '"' + (['text', 'list'].indexOf(f[2]) >= 0 ? '' : ' type="number" min="0" step="any"') + ' /></label>';
      }
    });
    h += '</div><label style="display:block;margin-top:8px;">Purpose<input id="pe_purpose" value="' + esc(p.purpose || '') + '" maxlength="300" style="width:100%;" /></label>'
      + '<div class="row" style="margin-top:10px;gap:8px;"><button type="button" class="primary" id="pe_save">Save phase</button><button type="button" class="ghost" id="pe_cancel">Close</button></div></div>';
    box.innerHTML = h;
    box.querySelector('#pe_cancel').onclick = function () { S.editing = ''; box.innerHTML = ''; };
    box.querySelector('#pe_save').onclick = function () {
      const next = clone();
      const q = next.phases[id];
      q.name = box.querySelector('#pe_name').value.trim();
      q.purpose = box.querySelector('#pe_purpose').value.trim();
      q.maxAccounts = read(box.querySelector('#pe_max').value, 'n');
      q.storageAllowanceBytes = read(box.querySelector('#pe_store').value, 'GB');
      q.registrationOpen = box.querySelector('#pe_open').checked;
      q.waitlist = box.querySelector('#pe_wait').checked;
      let bad = '';
      FIELDS.forEach(function (f, i) {
        const v = read(box.querySelector('#pe_f' + i).value, f[2]);
        if (typeof v === 'number' && !isFinite(v)) bad = bad || f[1];
        set(q.media, f[0], v);
      });
      if (bad || !isFinite(q.maxAccounts) || !isFinite(q.storageAllowanceBytes)) { msg('Check the number for: ' + (bad || 'accounts or storage')); return; }
      let note = '';
      if (id === next.activePhase) {
        const down = lowered(next.media, q.media);
        if (down.length && !window.confirm('This phase is active. These limits go down as soon as you save:\n' + down.map(function (x) { return '• ' + x; }).join('\n') + '\n\nContinue?')) return;
        next.media = JSON.parse(JSON.stringify(q.media));
        next.guard.budgets.storageBytes = q.storageAllowanceBytes;
        note = ' Its registration settings apply when it is activated; use Public registration above to change them now.';
      }
      const why = ask('Save the "' + q.name + '" phase?');
      if (why === null) return;
      S.editing = '';
      save(next, why, 'Phase "' + q.name + '"').then(function () { if (note) msg(note.trim()); });
    };
  }

  function paintMetrics() {
    const box = root && root.querySelector('#lcMetrics');
    if (!box) return;
    if (S.metricsErr) { box.innerHTML = H.card('Monitoring', '<p class="sub">Could not count: ' + esc(S.metricsErr) + '</p>'); return; }
    const m = S.metrics && S.metrics.metrics;
    if (!m) return;
    const cost = m.cost.cloudflareMonthUsd;
    const perUser = cost != null && m.active.week ? Math.round(cost / m.active.week * 100) / 100 : null;
    const perBcast = cost != null && m.broadcasts.total ? Math.round(cost / m.broadcasts.total * 100) / 100 : null;
    const row = function (label, value, source, kind) {
      return '<tr><td>' + esc(label) + '</td><td align="right"><b>' + esc(value == null ? '—' : value) + '</b></td><td>' + badge(kind, kind === 'live' ? 'ok' : (kind === 'delayed' ? 'warn' : 'dim')) + '</td><td class="sub">' + esc(source) + '</td></tr>';
    };
    const refusedBy = Object.keys(m.uploads.refusedBy || {}).map(function (k) { return k + ' ' + m.uploads.refusedBy[k]; }).join(', ');
    const html = '<p class="sub">Last update ' + esc(when(m.at)) + '. Live = counted just now; delayed = the provider\'s figures, behind by minutes to hours; estimated = worked out from other figures. No country or identity data is used.</p>'
      + '<div style="overflow-x:auto;max-width:100%;"><table style="width:100%;font-size:13px;"><tr><th align="left">Measure</th><th align="right">Value</th><th align="left">Kind</th><th align="left">Source</th></tr>'
      + row('Registered accounts (count / profiles)', (m.accounts.registered == null ? '—' : m.accounts.registered) + ' / ' + (m.accounts.profiles == null ? '—' : m.accounts.profiles), m.accounts.source, 'live')
      + row('Active, last 24 hours', m.active.day, m.active.source, 'live')
      + row('Active, last 7 days', m.active.week, m.active.source, 'live')
      + row('Waiting list', m.waitlist.size, m.waitlist.source, 'live')
      + row('Broadcasts (all / public)', (m.broadcasts.total == null ? '—' : m.broadcasts.total) + ' / ' + (m.broadcasts.public == null ? '—' : m.broadcasts.public), m.broadcasts.source, 'live')
      + row('Signals published', m.signals.total, m.signals.source, 'live')
      + row('Uploads today (done / refused)', m.uploads.today.ok + ' / ' + m.uploads.today.refused, m.uploads.source, 'live')
      + row('Uploads yesterday (done / refused)', m.uploads.yesterday.ok + ' / ' + m.uploads.yesterday.refused, m.uploads.source, 'live')
      + row('Refused today by reason', refusedBy || 'none', 'limits that stopped an upload', 'live')
      + row('Uploaded today', bytesText(m.uploads.today.bytes), m.uploads.source, 'live')
      + row('Media storage', bytesText(m.storage.bytes), m.storage.source, 'delayed')
      + row('Delivered data', '—', m.delivered.source, 'not measured')
      + row('Video processing', '—', m.processing.source, 'none')
      + row('Storage writes today (R2 class A)', m.r2ClassAToday.n, m.r2ClassAToday.source, 'delayed')
      + row('Database reads today', m.firestoreReadsToday.n, m.firestoreReadsToday.source, 'delayed')
      + row('Cloudflare usage this month (USD)', cost == null ? null : '$' + cost, m.cost.source, cost == null ? 'not measured' : 'delayed')
      + row('Firebase / Google charges', '—', m.cost.firebase, 'not measured')
      + row('Cost per active user (7 days)', perUser == null ? null : '$' + perUser, 'Cloudflare this month ÷ active this week', 'estimated')
      + row('Cost per Broadcast', perBcast == null ? null : '$' + perBcast, 'Cloudflare this month ÷ all Broadcasts', 'estimated')
      + row('Open reports', m.safety.openReports, m.safety.source, 'live')
      + row('Publishers waiting for review', m.safety.publishersAwaitingReview, m.safety.source, 'live')
      + row('Sign-ups refused (closed, full, paused)', m.safety.refusedSignups, 'counted by the registration service', 'live')
      + '</table></div></div>'
      + ((m.cost.invoices || []).length ? '<p class="sub" style="margin-top:8px;">Cloudflare invoices (actual bills): ' + m.cost.invoices.map(function (i) { return esc((i.date || i.occurred_at || '') + ' ' + (i.amount != null ? i.amount : '') + ' ' + (i.currency || '')); }).join(' · ') + '</p>' : '');
    box.innerHTML = H.card('Monitoring', html);
  }

  async function loadWaitlist() {
    const box = root.querySelector('#lcWaitlist');
    box.innerHTML = H.card('Waiting list', '<p class="sub">Reading…</p>');
    try {
      const out = await call('/v1/admin/launch/waitlist');
      const rows = out.rows || [];
      box.innerHTML = H.card('Waiting list (' + rows.length + ')',
        '<p class="sub">Each entry is an email address and when it was added, nothing else. Joining never creates an account or opens registration. To let people in, raise the cap or open registration, then write to them yourself.</p>'
        + (rows.length ? '<div class="row" style="gap:8px;margin-bottom:8px;"><button type="button" class="ghost" id="lcWlCopy">Copy all email addresses</button></div>'
          + '<div style="overflow-x:auto;max-width:100%;"><table style="width:100%;font-size:13px;"><tr><th align="left">Email</th><th align="left">Added</th><th align="left">When it was</th><th></th></tr>'
          + rows.map(function (r) { return '<tr><td>' + esc(r.email) + '</td><td>' + esc(when(r.at)) + '</td><td>' + esc(r.reason || '') + '</td><td><button type="button" class="ghost lcWlDel" data-id="' + esc(r.id) + '">Remove</button></td></tr>'; }).join('') + '</table></div></div>'
          : '<p class="sub">Nobody is waiting.</p>'));
      const copy = box.querySelector('#lcWlCopy');
      if (copy) copy.onclick = function () {
        const text = rows.map(function (r) { return r.email; }).join('\n');
        try { navigator.clipboard.writeText(text).then(function () { msg('Copied ' + rows.length + ' addresses.'); }); } catch (_) { window.prompt('Copy these:', text); }
      };
      box.querySelectorAll('.lcWlDel').forEach(function (b) {
        b.onclick = async function () {
          if (!window.confirm('Remove this email from the waiting list?')) return;
          const why = ask('Why remove it?');
          if (why === null) return;
          try { await call('/v1/admin/launch/waitlist/remove', { id: b.getAttribute('data-id'), reason: why }); loadWaitlist(); } catch (e) { msg('Not removed: ' + e.message); }
        };
      });
    } catch (e) { box.innerHTML = H.card('Waiting list', '<p class="sub">Could not read it: ' + esc(e.message) + '</p>'); }
  }

  window.NalunoLaunchDesk = {
    /* Opening the tab loads it; the console asking again while it is already
       on screen (live updates elsewhere) changes nothing. */
    render: function (el, helpers) {
      H = helpers;
      if (root === el && el.isConnected && S.data && el.querySelector('#lcEnv')) return;
      root = el;
      load();
    },
    _lowered: lowered, _read: read, _show: show, _refreshNow: function () { return refreshNow(); },
  };
})();
