/* ============================================================
   MODULE: js/admin-console.js
   Operator Control Centre at /admin/. Not loaded by the member app.

   Two gates:
     1. Firebase sign-in (same Google / handle as the app)
     2. Console password — hashed onto the signed-in account, so it
        follows the person, not the phone.

   Tabs read Naluno through the signed-in operator's Firebase SDK.
   The economy worker is optional. A rejected service account must
   never block this desk or paint a red error on Unlock.
   ============================================================ */
(function () {
  const $ = function (id) { return document.getElementById(id); };
  const WORKER = 'https://naluno-economy.naluno.workers.dev';
  function workerBase() {
    try {
      if (typeof location !== 'undefined' && location.origin) return location.origin + '/__naluno-economy';
    } catch (_) {}
    return WORKER;
  }
  const HANDLE_DOMAIN = 'users.getnaluno.com';
  const LOCAL_KEY = 'nalunoAdminLocal.';
  const BUILD = '20260912b';
  const OPERATOR_UIDS = { 'ibMOMY6Q3sVTCxIrwO2FGk43zw93': true };
  const OPERATOR_EMAILS = { 'magjoed@gmail.com': true };

  let fbAuth = null;
  let fbDbAdmin = null;
  let currentUser = null;
  let __adminPass = '';
  let __needsSetup = false;
  let __tabCache = {};
  let __activeTab = 'overview';
  let __snap = null;
  let __swInfo = { connected: false, cache: '', version: '' };
  const Data = (typeof NalunoAdminData !== 'undefined') ? NalunoAdminData : null;

  function escapeHtml(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&' + 'amp;')
      .replace(/</g, '&' + 'lt;')
      .replace(/>/g, '&' + 'gt;')
      .replace(/"/g, '&' + 'quot;')
      .replace(/'/g, '&#39;');
  }
  function toast(msg) {
    const t = $('toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.classList.remove('show'); }, 2200);
  }
  function setMsg(id, text, ok) {
    const el = $(id);
    if (!el) return;
    el.textContent = text || '';
    el.className = 'msg' + (ok ? ' ok' : '');
  }
  function setStage(stage) {
    const map = { sign: 'signPanel', gate: 'gatePanel', console: 'consoleView' };
    Object.keys(map).forEach(function (k) {
      const el = $(map[k]);
      if (!el) return;
      const on = (k === stage);
      el.classList.toggle('hidden', !on);
      el.style.display = on ? 'block' : 'none';
    });
    try { document.title = stage === 'console' ? 'Naluno · Control' : 'Naluno'; } catch (_) {}
  }

  /* -------- Clock: follows the device that opened the desk, never Al Ain -------- */
  let __deskPlace = { zone: '', city: '', temp: null, coords: null, source: '' };

  function tickClock() {
    const el = $('liveClock');
    if (!el) return;
    const zone = Data && Data.adminZone ? Data.adminZone() : undefined;
    const clock = Data
      ? Data.formatAdminClock(new Date(), zone)
      : { full: new Date().toLocaleString(), label: new Date().toLocaleTimeString(), zone: '' };
    el.textContent = clock.full;
    el.title = (clock.zone || '') + (__deskPlace.coords
      ? (' · ' + Number(__deskPlace.coords.lat).toFixed(4) + ', ' + Number(__deskPlace.coords.lon).toFixed(4))
      : '');
    const sub = $('liveClockZone');
    if (sub) {
      const bits = [clock.zone || ''];
      if (__deskPlace.city) bits.push(__deskPlace.city);
      if (__deskPlace.temp != null && isFinite(__deskPlace.temp)) bits.push(Math.round(__deskPlace.temp) + '°C');
      sub.textContent = bits.filter(Boolean).join(' · ');
    }
  }
  tickClock();
  setInterval(tickClock, 1000);

  function tzFromGeoJson(j) {
    if (!j) return '';
    if (typeof j.timeZone === 'string' && j.timeZone) return j.timeZone;
    if (j.timeZone && j.timeZone.ianaTimeId) return j.timeZone.ianaTimeId;
    return '';
  }
  function cityFromGeoJson(j) {
    if (!j) return '';
    const city = j.city || '';
    const loc = j.locality || '';
    if (loc && city && loc !== city) return loc + ', ' + city;
    return city || loc || j.principalSubdivision || j.countryName || '';
  }
  async function applyDeskCoords(lat, lon) {
    __deskPlace.coords = { lat: Number(lat), lon: Number(lon) };
    __deskPlace.source = 'gps';
    try {
      const geoRes = await fetch('https://api.bigdatacloud.net/data/reverse-geocode-client?latitude='
        + encodeURIComponent(lat) + '&longitude=' + encodeURIComponent(lon) + '&localityLanguage=en');
      const j = await geoRes.json();
      const tz = tzFromGeoJson(j);
      if (tz && Data && Data.setAdminZone) Data.setAdminZone(tz);
      __deskPlace.city = cityFromGeoJson(j);
      __deskPlace.zone = tz || (Data && Data.adminZone ? Data.adminZone() : '');
      tickClock();
    } catch (_) {}
    try {
      const wRes = await fetch('https://api.open-meteo.com/v1/forecast?latitude=' + encodeURIComponent(lat)
        + '&longitude=' + encodeURIComponent(lon)
        + '&current=temperature_2m,weather_code&timezone=auto');
      const w = await wRes.json();
      if (w && w.current && w.current.temperature_2m != null) __deskPlace.temp = w.current.temperature_2m;
      if (w && w.timezone && Data && Data.setAdminZone) Data.setAdminZone(w.timezone);
      tickClock();
    } catch (_) {}
  }
  function resolveDeskPlace() {
    try {
      const local = Data && Data.localZone ? Data.localZone() : '';
      if (local && local !== 'UTC' && local !== 'Etc/UTC' && local !== 'Etc/GMT') {
        if (Data && Data.setAdminZone) Data.setAdminZone(local);
        tickClock();
      }
    } catch (_) {}
    try {
      if (!navigator.geolocation) return;
      navigator.geolocation.getCurrentPosition(function (pos) {
        applyDeskCoords(pos.coords.latitude, pos.coords.longitude).catch(function () {});
      }, function () {}, { enableHighAccuracy: true, timeout: 20000, maximumAge: 30000 });
    } catch (_) {}
  }
  resolveDeskPlace();

  /* -------- Service worker handshake -------- */
  function wireServiceWorker() {
    if (!('serviceWorker' in navigator)) {
      __swInfo = { connected: false, cache: '', version: 'unsupported' };
      return;
    }
    navigator.serviceWorker.addEventListener('message', function (ev) {
      const msg = (ev && ev.data) || {};
      if (msg.type === 'naluno-sw-pong') {
        __swInfo = {
          connected: true,
          cache: msg.cache || '',
          version: msg.version || '',
          at: msg.at || Date.now(),
        };
        paintSwBadge();
        if (__snap) {
          __snap.sw = __swInfo;
        }
      }
    });
    navigator.serviceWorker.register('/sw.js?v=' + BUILD, { scope: '/', updateViaCache: 'none' })
      .then(function (reg) {
        try { reg.update(); } catch (_) {}
        pingSw();
        navigator.serviceWorker.addEventListener('controllerchange', function () { pingSw(); });
      })
      .catch(function () {
        __swInfo = { connected: false, cache: '', version: 'register-failed' };
        paintSwBadge();
      });
    if (navigator.serviceWorker.controller) pingSw();
  }
  function pingSw() {
    try {
      const ctl = navigator.serviceWorker && navigator.serviceWorker.controller;
      if (!ctl) return;
      ctl.postMessage({ type: 'naluno-console-hello', at: Date.now(), build: BUILD });
    } catch (_) {}
  }
  function paintSwBadge() {
    const el = $('swBadge');
    if (!el) return;
    if (__swInfo.connected) {
      el.textContent = 'worker ' + (__swInfo.version || 'on');
      el.className = 'sw-badge on';
    } else {
      el.textContent = 'worker off';
      el.className = 'sw-badge';
    }
  }

  function normalizeHandle(raw) {
    return String(raw || '').trim().replace(/^@+/, '').toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 24);
  }
  function looksLikeEmail(raw) {
    const s = String(raw || '').trim();
    return s.indexOf('@') > 0 && s.indexOf('.') > s.indexOf('@');
  }
  function handleToEmail(handle) {
    const h = normalizeHandle(handle);
    return h ? (h + '@' + HANDLE_DOMAIN) : '';
  }
  function whoLine(user) {
    if (!user) return '';
    const mail = user.email || '';
    const handle = mail.indexOf('@' + HANDLE_DOMAIN) > 0 ? mail.split('@')[0] : mail;
    return (handle || 'signed in') + ' · ' + String(user.uid);
  }
  function isOperator(user) {
    if (!user) return false;
    if (OPERATOR_UIDS[user.uid]) return true;
    const mail = String(user.email || '').trim().toLowerCase();
    return !!(mail && OPERATOR_EMAILS[mail]);
  }

  function firebaseReady() {
    return typeof firebase !== 'undefined'
      && typeof firebaseConfig !== 'undefined'
      && firebaseConfig.apiKey && firebaseConfig.apiKey !== 'YOUR_API_KEY';
  }
  function initFirebase() {
    if (fbAuth) return true;
    if (!firebaseReady()) return false;
    try {
      if (!(firebase.apps && firebase.apps.length)) firebase.initializeApp(firebaseConfig);
      fbAuth = firebase.auth();
      fbAuth.setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch(function () {});
      try { fbDbAdmin = firebase.firestore(); } catch (_) { fbDbAdmin = null; }
      return true;
    } catch (e) {
      console.error('[naluno-admin] firebase init', e);
      return false;
    }
  }
  function adminDb() {
    if (fbDbAdmin) return fbDbAdmin;
    try {
      if (typeof firebase !== 'undefined' && firebase.firestore) {
        fbDbAdmin = firebase.firestore();
        return fbDbAdmin;
      }
    } catch (_) {}
    return null;
  }

  async function hashLocal(uid, pass) {
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey('raw', enc.encode(String(pass)), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits({
      name: 'PBKDF2',
      salt: enc.encode('naluno-admin-v1|' + uid),
      iterations: 120000,
      hash: 'SHA-256',
    }, key, 256);
    const bytes = new Uint8Array(bits);
    let out = '';
    for (let i = 0; i < bytes.length; i++) out += String.fromCharCode(bytes[i]);
    return btoa(out);
  }
  function localGet(uid) { try { return localStorage.getItem(LOCAL_KEY + uid) || ''; } catch (_) { return ''; } }
  function localSet(uid, hash) { try { localStorage.setItem(LOCAL_KEY + uid, hash); } catch (_) {} }
  async function localOk(uid, pass) {
    const stored = localGet(uid);
    if (!stored) return false;
    try { return stored === await hashLocal(uid, pass); } catch (_) { return false; }
  }

  async function cloudGetHash(uid) {
    const db = adminDb();
    if (!db || !uid) return '';
    const paths = [
      function () { return db.collection('adminConsole').doc(uid).get(); },
      function () { return db.collection('users').doc(uid).collection('consoleGate').doc('main').get(); },
      function () { return db.collection('users').doc(uid).collection('wirelineHidden').doc('__nalunoConsoleGate').get(); },
      function () { return db.collection('users').doc(uid).get(); },
    ];
    for (let i = 0; i < paths.length; i++) {
      try {
        const snap = await paths[i]();
        if (!snap || !snap.exists) continue;
        const data = snap.data() || {};
        const hash = data.hash || (data._consoleGate && data._consoleGate.hash) || '';
        if (hash) return String(hash);
      } catch (_) {}
    }
    return '';
  }
  async function cloudSetHash(uid, hash) {
    const db = adminDb();
    if (!db || !uid || !hash) return { ok: false, where: 'no-db' };
    const payload = { hash: hash, v: 1, at: Date.now(), kind: 'console-gate' };
    try { await db.collection('adminConsole').doc(uid).set(payload); return { ok: true, where: 'adminConsole' }; } catch (_) {}
    try { await db.collection('users').doc(uid).collection('consoleGate').doc('main').set(payload); return { ok: true, where: 'consoleGate' }; } catch (_) {}
    try { await db.collection('users').doc(uid).collection('wirelineHidden').doc('__nalunoConsoleGate').set(payload); return { ok: true, where: 'account' }; } catch (_) {}
    try { await db.collection('users').doc(uid).set({ _consoleGate: payload }, { merge: true }); return { ok: true, where: 'profile' }; }
    catch (e) { return { ok: false, where: (e && (e.code || e.message)) || 'write-denied' }; }
  }
  async function cloudOk(uid, pass) {
    const stored = await cloudGetHash(uid);
    if (!stored) return false;
    try { return stored === await hashLocal(uid, pass); } catch (_) { return false; }
  }

  async function writeAudit(action, target, reason, extra) {
    const db = adminDb();
    if (!db || !currentUser) return;
    const row = {
      action: String(action || ''),
      target: String(target || ''),
      reason: String(reason || ''),
      extra: extra || null,
      actor: currentUser.uid,
      actorEmail: currentUser.email || '',
      created_at: Date.now(),
    };
    try { await db.collection('adminAudit').add(row); } catch (_) {}
  }

  /* -------- Live snapshot from Firestore (operator SDK) -------- */
  async function colDocs(name, limit) {
    const db = adminDb();
    if (!db) return [];
    try {
      const snap = await db.collection(name).limit(limit || 400).get();
      const out = [];
      snap.forEach(function (d) { out.push(Object.assign({ id: d.id }, d.data())); });
      return out;
    } catch (_) { return []; }
  }
  function parentUidOf(doc) {
    try {
      const parent = doc.ref && doc.ref.parent && doc.ref.parent.parent;
      return parent ? parent.id : '';
    } catch (_) { return ''; }
  }
  async function loadCollectionGroup(name, limit) {
    const db = adminDb();
    if (!db) return [];
    try {
      const snap = await db.collectionGroup(name).limit(limit || 200).get();
      const out = [];
      snap.forEach(function (d) {
        out.push(Object.assign({ id: d.id, uid: parentUidOf(d) }, d.data()));
      });
      return out;
    } catch (_) { return []; }
  }
  async function loadPerUserSub(users, sub, limitEach) {
    const db = adminDb();
    if (!db || !users || !users.length) return [];
    const out = [];
    const slice = users.slice(0, 150);
    await Promise.all(slice.map(function (u) {
      const uid = u.id || u.uid;
      if (!uid) return Promise.resolve();
      return db.collection('users').doc(uid).collection(sub).limit(limitEach || 40).get()
        .then(function (s) {
          s.forEach(function (d) {
            out.push(Object.assign({ id: d.id, uid: uid }, d.data()));
          });
        }).catch(function () {});
    }));
    return out;
  }
  function mergeById(a, b) {
    const seen = {};
    const out = [];
    function add(row) {
      if (!row) return;
      const key = String(row.uid || '') + ':' + String(row.id || '');
      if (seen[key]) return;
      seen[key] = true;
      out.push(row);
    }
    (a || []).forEach(add);
    (b || []).forEach(add);
    return out;
  }
  async function loadSignals(users) {
    const top = await colDocs('signals', 400);
    const group = await loadCollectionGroup('signal', 400);
    const per = await loadPerUserSub(users, 'signal', 40);
    let out = mergeById(mergeById(top, group), per);
    out.sort(function (a, b) { return (Number(b.createdAt || b.ts) || 0) - (Number(a.createdAt || a.ts) || 0); });
    return out;
  }
  async function loadBeacons(users) {
    const group = await loadCollectionGroup('beacons', 400);
    const per = await loadPerUserSub(users, 'beacons', 8);
    return mergeById(group, per);
  }
  async function pingWorker() {
    const out = { ok: false, degraded: false, ms: 0, version: '', error: '', persist: '' };
    const bases = [];
    try { bases.push(location.origin + '/__naluno-economy'); } catch (_) {}
    bases.push(WORKER);
    for (let i = 0; i < bases.length; i++) {
      const base = bases[i];
      try {
        const t0 = Date.now();
        const h = await fetch(base + '/health', { cache: 'no-store' });
        const b = await h.json().catch(function () { return {}; });
        if (!h.ok) continue;
        out.ok = true;
        out.ms = Date.now() - t0;
        out.version = b.version || '';
        out.persist = b.persist || '';
        try {
          const f = await fetch(base + '/v1/flags', { cache: 'no-store' });
          const fb = await f.json().catch(function () { return {}; });
          out.degraded = !!fb.degraded && !f.ok;
          if (fb.persist) out.persist = fb.persist;
        } catch (_) { out.degraded = false; }
        return out;
      } catch (_) {}
    }
    out.error = 'unreachable';
    return out;
  }
  async function loadSnapshot(force) {
    if (!force && __snap && (Date.now() - (__snap._at || 0) < 15000)) return __snap;
    const db = adminDb();
    const pack = {
      users: [], broadcasts: [], signals: [], toga: [], strands: [], bands: [],
      reports: [], ledger: [], metrics: [], audit: [], flags: {},
      worker: {}, sw: __swInfo, now: Date.now(),
      zone: Data ? (Data.adminZone ? Data.adminZone() : Data.localZone()) : undefined,
      beacons: [], originMarks: [], deskMail: [],
      costInputs: readCostInputs(),
    };
    const jobs = [
      colDocs('users', 500).then(function (r) { pack.users = r; }),
      colDocs('broadcasts', 400).then(function (r) { pack.broadcasts = r; }),
      colDocs('toga', 80).then(function (r) { pack.toga = r; }),
      colDocs('strands', 200).then(function (r) { pack.strands = r; }),
      colDocs('bands', 80).then(function (r) { pack.bands = r; }),
      colDocs('reports', 80).then(function (r) { pack.reports = r; }),
      colDocs('deskMail', 200).then(function (r) { pack.deskMail = r; }),
      colDocs('contributionLedger', 200).then(function (r) { pack.ledger = r; }),
      colDocs('economyInbox', 200).then(function (r) { pack._inbox = r; }),
      colDocs('metrics', 200).then(function (r) { pack.metrics = r; }),
      colDocs('adminAudit', 80).then(function (r) {
        pack.audit = r.sort(function (a, b) { return (b.created_at || 0) - (a.created_at || 0); });
      }),
      pingWorker().then(function (w) { pack.worker = w; }),
    ];
    if (db) {
      jobs.push(db.collection('economyConfig').doc('flags').get().then(function (s) {
        if (s && s.exists) pack.flags = s.data() || {};
      }).catch(function () {}));
    }
    await Promise.all(jobs);
    const extra = await Promise.all([
      loadSignals(pack.users),
      loadBeacons(pack.users),
      colDocs('originMarks', 200),
    ]);
    pack.signals = extra[0];
    pack.beacons = extra[1];
    pack.originMarks = extra[2];
    if (!pack.ledger.length) {
      const inbox = pack._inbox || [];
      if (inbox.length) {
        pack.ledger = inbox.map(function (row) {
          return {
            id: row.id || row.event_id,
            event_type: row.event_type,
            user_id: row.actor_user_id || row.user_id,
            points: 0,
            eligible_points: 0,
            status: 'RECORDED',
            reason: 'inbox',
          };
        });
      } else {
        pack.ledger = (pack.metrics || []).filter(function (m) {
          return String(m.name || '').indexOf('economy.') === 0;
        }).map(function (m) {
          return {
            id: m.id || m.event_id,
            event_type: m.event_type || String(m.name || '').replace(/^economy\./, ''),
            user_id: m.uid || m.user_id,
            points: 0,
            eligible_points: 0,
            status: 'RECORDED',
            reason: 'metrics',
          };
        });
      }
    }
    const snap = Data ? Data.deriveSnapshot(pack) : pack;
    snap._at = Date.now();
    snap._raw = pack;
    __snap = snap;
    return snap;
  }

  function money(minor, ccy) {
    return Data ? Data.money(minor, ccy) : ((Number(minor) || 0) / 100).toFixed(2);
  }
  function readCostInputs() {
    try {
      return {
        invoiceAed: Number(localStorage.getItem('nalunoCostInvoice') || 0) || 0,
        fixedAed: Number(localStorage.getItem('nalunoCostFixed') || 0) || 0,
        turnMinutes: Number(localStorage.getItem('nalunoCostTurnMin') || 0) || 0,
        compassAed: Number(localStorage.getItem('nalunoCostCompass') || 0) || 0,
      };
    } catch (_) {
      return { invoiceAed: 0, fixedAed: 0, turnMinutes: 0, compassAed: 0 };
    }
  }
  function writeCostInputs(v) {
    try {
      localStorage.setItem('nalunoCostInvoice', String(v.invoiceAed || 0));
      localStorage.setItem('nalunoCostFixed', String(v.fixedAed || 0));
      localStorage.setItem('nalunoCostTurnMin', String(v.turnMinutes || 0));
      localStorage.setItem('nalunoCostCompass', String(v.compassAed || 0));
    } catch (_) {}
  }
  function aed(n) {
    return Data && Data.formatAed ? Data.formatAed(n) : ('AED ' + (Number(n) || 0).toFixed(2));
  }
  function aedUsd(n) {
    return Data && Data.moneyPair ? Data.moneyPair(n) : aed(n);
  }
  function bytesLabel(n) {
    return Data && Data.formatBytes ? Data.formatBytes(n) : String(n || 0);
  }
  function personCost(d, uid) {
    const list = (d && d.costs && d.costs.people) || [];
    for (let i = 0; i < list.length; i++) if (list[i].uid === uid) return list[i];
    return null;
  }
  function kpi(label, value) {
    return '<div class="kpi"><b>' + escapeHtml(String(value == null ? '—' : value)) + '</b><span>' + escapeHtml(label) + '</span></div>';
  }
  function kpis(pairs) {
    return '<div class="kpi-row">' + pairs.map(function (p) { return kpi(p[0], p[1]); }).join('') + '</div>';
  }
  function card(title, inner) {
    return '<div class="card"><div class="who">' + escapeHtml(title) + '</div>' + inner + '</div>';
  }
  function table(headers, rows) {
    if (!rows.length) return '<p class="sub">Nothing recorded yet.</p>';
    return '<table class="tbl"><thead><tr>'
      + headers.map(function (h) { return '<th>' + escapeHtml(h) + '</th>'; }).join('')
      + '</tr></thead><tbody>'
      + rows.map(function (r) {
        return '<tr>' + r.map(function (c) { return '<td>' + c + '</td>'; }).join('') + '</tr>';
      }).join('')
      + '</tbody></table>';
  }
  function plainRows(headers, rows) {
    return table(headers, rows.map(function (r) {
      return r.map(function (c) { return escapeHtml(String(c == null ? '' : c)); });
    }));
  }
  function inactiveNote(text) {
    return '<div class="inactive-note">' + escapeHtml(text) + '</div>';
  }
  function gap(text) {
    return '<p class="gap-note">' + escapeHtml(text) + '</p>';
  }
  function userName(u) {
    return u.name || u.handle || u.email || String(u.id || u.uid || '').slice(0, 10);
  }
  function mapsHref(lat, lng) {
    return 'https://www.openstreetmap.org/?mlat=' + lat + '&mlon=' + lng + '#map=17/' + lat + '/' + lng;
  }
  function pinHtml(lat, lng, acc, place) {
    if (lat == null || lng == null || !isFinite(Number(lat)) || !isFinite(Number(lng))) return '—';
    const a = Number(lat).toFixed(5) + ', ' + Number(lng).toFixed(5);
    const accS = acc ? (' ±' + Math.round(Number(acc)) + ' m') : '';
    const label = (place ? escapeHtml(place) + ' · ' : '') + escapeHtml(a + accS);
    return '<a href="' + mapsHref(lat, lng) + '" target="_blank" rel="noopener">' + label + '</a>';
  }
  function coordsOf(row) {
    if (!row) return null;
    const lat = row.lastLat != null ? row.lastLat : row.lat;
    const lng = row.lastLng != null ? row.lastLng : (row.lng != null ? row.lng : row.lon);
    if (lat == null || lng == null || !isFinite(Number(lat)) || !isFinite(Number(lng))) return null;
    if (Number(lat) === 0 && Number(lng) === 0) return null;
    return {
      lat: Number(lat),
      lng: Number(lng),
      accuracy: row.lastAccuracy || row.accuracy,
      place: row.lastPlace || row.placeName || row.place || '',
      at: row.lastLocationAt || row.ts,
    };
  }
  function when(ms) {
    if (!ms) return '—';
    try {
      if (Data && Data.formatAdminClock) {
        const c = Data.formatAdminClock(new Date(Number(ms)));
        return c.day + ' · ' + c.time;
      }
      return new Date(Number(ms)).toLocaleString();
    } catch (_) { return '—'; }
  }

  function renderStrip(d) {
    const el = $('ccStrip');
    if (!el) return;
    const u = d.users || {};
    const c = d.content || {};
    const e = d.economy || {};
    const alerts = d.alerts || [];
    const colour = d.healthTone === 'critical' ? '#ff8a9a' : (d.healthTone === 'warning' ? '#ffc266' : 'var(--mint)');
    const swBit = (__swInfo.connected ? 'SW on' : 'SW off');
    el.innerHTML =
      '<span class="h" style="color:' + colour + '">NALUNO ' + escapeHtml(d.healthLabel || '') + '</span>'
      + '<span class="m">Online <b>' + (u.active_now || 0) + '</b></span>'
      + '<span class="m">DAU <b>' + (u.dau || 0) + '</b></span>'
      + '<span class="m">Broadcasts <b>' + (c.broadcasts_total || 0) + '</b></span>'
      + '<span class="m">Live <b>' + (c.broadcasts_live || 0) + '</b></span>'
      + '<span class="m">Alerts <b>' + alerts.filter(function (a) { return a.level !== 'ok'; }).length + '</b></span>'
      + '<span class="m">' + escapeHtml(swBit) + '</span>'
      + '<button type="button" class="ghost" id="ccRefresh" style="margin-left:auto;padding:6px 10px;">Refresh</button>';
    const btn = $('ccRefresh');
    if (btn) btn.onclick = function () { loadTab(__activeTab, true); };
  }

  function wireAdminTabs() {
    const nav = $('adminTabs');
    if (!nav) return;
    nav.querySelectorAll('.atab').forEach(function (btn) {
      btn.onclick = function () {
        const tab = btn.getAttribute('data-tab');
        if (!tab) return;
        __activeTab = tab;
        nav.querySelectorAll('.atab').forEach(function (b) { b.classList.toggle('on', b === btn); });
        loadTab(tab, false);
      };
    });
  }

  async function loadTab(tab, force) {
    const el = $('adminBody');
    if (!el) return;
    el.innerHTML = '<p class="sub">Loading…</p>';
    try {
      const d = await loadSnapshot(!!force);
      renderStrip(d);
      renderTab(tab, d);
    } catch (e) {
      el.innerHTML = '<p class="sub">Could not load this section. ' + escapeHtml((e && e.message) || '') + '</p>';
    }
  }

  function renderTab(tab, d) {
    const el = $('adminBody');
    if (!el) return;
    d = d || __snap || {};
    const u = d.users || {};
    const c = d.content || {};
    const s = d.signals || {};
    const cr = d.creators || {};
    const sf = d.safety || {};
    const e = d.economy || {};
    const w = d.worker || {};
    const g = d.gaps || {};

    function goButtons() {
      el.querySelectorAll('.ccGo').forEach(function (b) {
        b.onclick = function () {
          const t = b.getAttribute('data-go');
          const nav = $('adminTabs');
          const target = nav && nav.querySelector('[data-tab="' + t + '"]');
          if (target) target.click();
        };
      });
    }

    if (tab === 'overview') {
      const alerts = d.alerts || [];
      el.innerHTML =
        card('What needs your attention',
          alerts.map(function (a) {
            return '<div class="alert ' + escapeHtml(a.level) + '">'
              + escapeHtml(a.text)
              + (a.tab ? '<button type="button" class="ghost ccGo" data-go="' + escapeHtml(a.tab) + '">Open</button>' : '')
              + '</div>';
          }).join(''))
        + card('Are people coming back?',
          kpis([['Registered', u.total || 0], ['Active now', u.active_now || 0],
            ['DAU', u.dau || 0], ['WAU', u.wau || 0], ['MAU', u.mau || 0],
            ['Returning today', u.returning_today || 0],
            ['Stickiness', u.stickiness == null ? '—' : u.stickiness + '%']])
          + kpis([['New today', u.new_today || 0], ['New 7 days', u.new_7d || 0], ['New 30 days', u.new_30d || 0]])
          + gap('Today is your local day (' + (d.zone || '') + '), not UTC. Stickiness is DAU ÷ MAU. Active now means a heartbeat in the last 10 minutes.'))
        + card('Still here',
          kpis([['≥7 days still in 7d', u.still_7_pct == null ? '—' : u.still_7_pct + '%'],
            ['of', (u.still_7 || 0) + ' / ' + (u.still_7_of || 0)],
            ['≥30 days still in 30d', u.still_30_pct == null ? '—' : u.still_30_pct + '%'],
            ['of', (u.still_30 || 0) + ' / ' + (u.still_30_of || 0)]])
          + gap(g.retention || 'True D1/D7 needs a session log. Still-here is not cohort retention.'))
        + card('What each person costs',
          kpis([['Invoiced this month', aedUsd((d.costs && d.costs.invoice_aed) || 0)],
            ['List-price usage', aedUsd((d.costs && d.costs.metered_aed) || 0)],
            ['After free tier', aedUsd((d.costs && d.costs.billable_aed) || 0)],
            ['Per MAU', aedUsd((d.costs && d.costs.per_mau_aed) || 0)]])
          + gap((d.costs && d.costs.headline) || g.unit_econ || '')
          + '<div class="row"><button type="button" class="ghost ccGo" data-go="money">Open Money</button></div>')
        + card('Pitch snapshot',
          kpis([['Live', 'getnaluno.com'],
            ['Registered', u.total || 0],
            ['MAU', u.mau || 0],
            ['Revenue', 'none']])
          + kpis([['Play Store', 'not listed'],
            ['CAC / LTV', 'unknown'],
            ['Payouts', 'locked'],
            ['First bill', (d.costs && d.costs.first_gate && d.costs.first_gate.mau_display)
              ? ('~' + Number(d.costs.first_gate.mau_display).toLocaleString('en-GB') + ' MAU')
              : 'still free']])
          + gap('Registered people, not downloads. Cost-to-serve is the Money model. Do not invent CAC, LTV, lock-screen ring, or store numbers.'))
        + card('What are people making?',
          kpis([['Broadcasts', c.broadcasts_total || 0], ['Live now', c.broadcasts_live || 0],
            ['Today', c.broadcasts_today || 0], ['Creators', cr.total || 0]])
          + kpis([['Signals', s.total || 0], ['Active Signals', s.active || 0],
            ['Views', c.views || 0], ['Comments', c.comments || 0]]))
        + card('Where are the devices?',
          kpis([['People with a pin', (d.locations && d.locations.with_coords) || 0],
            ['Find pings', (d.locations && d.locations.devices) || 0]])
          + gap('Pins come from Find Naluno on that phone. The last GPS fix is stored on the account so a missing device can be opened on a map from Users.'));
        + card('Can we trust the activity?',
          kpis([['Open reports', sf.open_reports || 0], ['Suspended', sf.suspended || 0],
            ['Restricted', sf.restricted || 0], ['Held for review', sf.pending_review || 0]]));
      goButtons();
      return;
    }

    if (tab === 'health') {
      const services = [
        ['Authentication', true, 'Firebase Auth is how people sign in.'],
        ['Database', !!adminDb(), 'Firestore, through this signed-in operator.'],
        ['Broadcast', !!d.flags.broadcast_enabled, 'Long-form rooms.'],
        ['Signals', d.flags.signals_enabled !== false, 'Short clips.'],
        ['Notifications', true, 'Device push. Central delivery ledger is not built.'],
        ['Payments', !!d.flags.real_payouts_enabled, 'Off until a provider is connected.'],
        ['Economy worker', !!w.ok, w.degraded ? 'Up, but Google rejected its service account.' : (w.ok ? (w.ms + ' ms · ' + (w.version || '') + (w.persist ? ' · ' + w.persist : '')) : (w.error || 'down'))],
        ['Service worker', !!__swInfo.connected, __swInfo.connected ? (__swInfo.cache || __swInfo.version) : 'This desk is not talking to sw.js yet.'],
        ['Content Hub', !!d.flags.content_hub_enabled, g.content_hub],
      ];
      el.innerHTML =
        card('Is Naluno working?',
          kpis([['App version', BUILD], ['Worker', w.ok ? (w.ms + ' ms') : 'down'],
            ['SW', __swInfo.connected ? 'connected' : 'off'],
            ['Metric failures', (d.metrics && d.metrics.failures) || 0]]))
        + card('Live status', services.map(function (row) {
          const on = row[1];
          return '<div class="flag-row"><span style="flex:1;">' + escapeHtml(row[0]) + '</span>'
            + '<span style="color:' + (on ? 'var(--mint)' : 'var(--ink-dim)') + ';">' + (on ? 'ON' : 'OFF') + '</span></div>'
            + '<p class="gap-note" style="margin:0 0 8px;">' + escapeHtml(row[2] || '') + '</p>';
        }).join(''))
        + card('What this desk cannot invent',
          '<ul class="gap-note"><li>' + escapeHtml(g.cpu_memory || '') + '</li>'
          + '<li>' + escapeHtml(g.notifications || '') + '</li>'
          + '<li>' + escapeHtml(g.search || '') + '</li></ul>')
        + card('Sampled client metrics',
          plainRows(['Name', 'When', 'User'],
            ((d.metrics && d.metrics.list) || []).slice(0, 20).map(function (m) {
              return [m.name || '', when(m.createdAt && m.createdAt.toMillis ? m.createdAt.toMillis() : m.createdAt), String(m.uid || '').slice(0, 10)];
            })));
      return;
    }

    if (tab === 'mail') {
      const mail = (d.mail && d.mail.list) || [];
      const q = (__tabCache.mailQ || 'new');
      const filtered = mail.filter(function (m) {
        const st = String(m.status || 'new').toLowerCase();
        if (q === 'new') return st === 'new';
        if (q === 'delete') return String(m.kind || '') === 'delete-account';
        if (q === 'compass') return String(m.source || '') === 'compass';
        if (q === 'web') return String(m.source || '') === 'web';
        if (q === 'done') return st === 'done';
        return true;
      });
      el.innerHTML =
        kpis([['New', (d.mail && d.mail.unread) || 0], ['Delete asks', (d.mail && d.mail.deletes) || 0],
          ['Compass', (d.mail && d.mail.compass) || 0], ['Website', (d.mail && d.mail.web) || 0]])
        + '<div class="row" style="margin-bottom:12px;">'
        + ['new', 'all', 'delete', 'compass', 'web', 'done'].map(function (k) {
          const on = q === k ? ' primary' : ' ghost';
          const label = k === 'new' ? 'New' : k === 'delete' ? 'Delete' : k === 'compass' ? 'Compass' : k === 'web' ? 'Website' : k === 'done' ? 'Done' : 'All';
          return '<button type="button" class="' + on.trim() + ' mailFilter" data-q="' + k + '">' + label + '</button>';
        }).join('')
        + '</div>'
        + card('Inbox', filtered.length
          ? filtered.map(function (m) {
            const st = String(m.status || 'new').toLowerCase();
            const kind = String(m.kind || 'contact');
            const who = [m.name, m.handle ? '@' + m.handle : '', m.email].filter(Boolean).join(' · ') || (m.uid || 'visitor');
            const reply = m.email
              ? '<a class="ghost" href="mailto:' + encodeURIComponent(m.email) + '">Reply</a> '
              : '';
            return '<div class="alert ' + (kind === 'delete-account' ? 'critical' : (st === 'new' ? 'warning' : 'ok')) + '">'
              + '<div class="sub">' + escapeHtml(when(m.ts)) + ' · ' + escapeHtml(m.source || '') + ' · ' + escapeHtml(kind) + ' · ' + escapeHtml(st) + '</div>'
              + '<div style="margin:6px 0 8px;"><b>' + escapeHtml(who) + '</b>'
              + (m.uid ? ' <span class="sub">' + escapeHtml(String(m.uid).slice(0, 12)) + '</span>' : '')
              + '</div>'
              + '<div style="white-space:pre-wrap;font-size:14px;line-height:1.45;">' + escapeHtml(m.text || '') + '</div>'
              + '<div class="row" style="margin-top:10px;">'
              + reply
              + (st !== 'read' && st !== 'done' ? '<button type="button" class="ghost admMail" data-id="' + escapeHtml(m.id) + '" data-st="read">Mark read</button> ' : '')
              + (st !== 'done' ? '<button type="button" class="ghost admMail" data-id="' + escapeHtml(m.id) + '" data-st="done">Done</button>' : '')
              + '</div></div>';
          }).join('')
          : '<p class="sub">Nothing in this filter. Contact-page and Compass requests land here. Compass notebooks are not copied — only what someone sent as a request.</p>');
      el.querySelectorAll('.mailFilter').forEach(function (btn) {
        btn.onclick = function () {
          __tabCache.mailQ = btn.getAttribute('data-q') || 'new';
          loadTab('mail', false);
        };
      });
      el.querySelectorAll('.admMail').forEach(function (btn) {
        btn.onclick = function () { actMail(btn.getAttribute('data-id'), btn.getAttribute('data-st')); };
      });
      return;
    }

    if (tab === 'users') {
      const q = (__tabCache.userQ || '').toLowerCase();
      const list = (u.list || []).filter(function (row) {
        if (!q) return true;
        const blob = ((row.name || '') + ' ' + (row.handle || '') + ' ' + (row.email || '') + ' ' + (row.id || '')).toLowerCase();
        return blob.indexOf(q) >= 0;
      });
      el.innerHTML =
        '<div class="row"><input id="admUserQ" placeholder="Search name, handle, email or uid" style="flex:1" value="' + escapeHtml(__tabCache.userQ || '') + '" />'
        + '<button type="button" class="ghost" id="admUserSearch">Search</button></div>'
        + kpis([['Users', u.total || 0], ['Matching', list.length], ['Suspended', (u.suspended || []).length], ['Restricted', (u.restricted || []).length],
          ['With a pin', (d.locations && d.locations.with_coords) || 0],
          ['Per MAU', aedUsd((d.costs && d.costs.per_mau_aed) || 0)]])
        + card('By platform', plainRows(['Platform', 'People'],
          Object.keys(u.by_platform || {}).map(function (k) { return [k, u.by_platform[k]]; })))
        + card('People', table(['Name', 'Handle', 'Last seen', 'Place', 'Cost / mo', 'State', ''],
          list.slice(0, 80).map(function (row) {
            const state = row.suspended ? 'SUSPENDED' : (row.restricted ? 'restricted' : 'ok');
            const pin = coordsOf(row);
            const pc = personCost(d, row.id);
            return [
              escapeHtml(userName(row)),
              escapeHtml(row.handle || row.number || ''),
              escapeHtml(row.lastSeen ? when(row.lastSeen) : 'never'),
              pin ? pinHtml(pin.lat, pin.lng, pin.accuracy, pin.place) : '—',
              escapeHtml(pc ? aed(pc.monthly_aed) : '—'),
              escapeHtml(state),
              '<button type="button" class="ghost admUserOpen" data-uid="' + escapeHtml(row.id) + '">Open</button>',
            ];
          })))
        + '<div id="admUserDetail"></div>';
      const run = function () {
        const inp = $('admUserQ');
        __tabCache.userQ = (inp && inp.value) || '';
        renderTab('users', d);
      };
      if ($('admUserSearch')) $('admUserSearch').onclick = run;
      if ($('admUserQ')) $('admUserQ').addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter') { ev.preventDefault(); run(); }
      });
      el.querySelectorAll('.admUserOpen').forEach(function (btn) {
        btn.onclick = function () { openUser(btn.getAttribute('data-uid'), d); };
      });
      return;
    }

    if (tab === 'broadcast') {
      el.innerHTML =
        kpis([['Broadcasts', c.broadcasts_total || 0], ['Live', c.broadcasts_live || 0],
          ['Today', c.broadcasts_today || 0], ['Deleted', c.broadcasts_deleted || 0],
          ['Views', c.views || 0], ['Creators', cr.total || 0]])
        + card('Creators by views', plainRows(['Creator', 'Broadcasts', 'Views', 'Live'],
          (cr.top || []).map(function (x) { return [x.name || x.uid.slice(0, 10), x.broadcasts, x.views, x.live]; })))
        + card('Recent', plainRows(['Title', 'Creator', 'Views', 'Live', 'When'],
          (c.recent || []).slice(0, 30).map(function (b) {
            return [b.title || '(untitled)', b.creatorName || String(b.creatorUid || '').slice(0, 10),
              b.views || 0, b.live ? 'LIVE' : '', when(b.createdAt)];
          })));
      return;
    }

    if (tab === 'signals') {
      const list = s.list || [];
      el.innerHTML =
        kpis([['Signals', s.total || 0], ['Still active', s.active || 0],
          ['Expired', s.expired || 0], ['Today', s.today || 0]])
        + gap('Signals are the short clips on each account. The desk reads the live posts (not a sample that used to fail silently).')
        + card('Recent Signals', table(['Owner', 'Kind', 'Caption', 'When'],
          list.slice(0, 60).map(function (row) {
            const owner = row.name || String(row.uid || '').slice(0, 12);
            return [
              escapeHtml(owner),
              escapeHtml(row.mediaType || row.type || 'signal'),
              escapeHtml(String(row.caption || row.text || '').slice(0, 48) || '—'),
              escapeHtml(when(row.createdAt || row.ts)),
            ];
          })));
      return;
    }

    if (tab === 'journey') {
      const impressions = s.total || 0;
      const bOpens = c.broadcasts_total || 0;
      const rate = impressions ? Math.round((Math.min(bOpens, impressions) / impressions) * 1000) / 10 : 0;
      el.innerHTML =
        card('Do Signals bring people into Broadcast?',
          kpis([['Signals stored', impressions], ['Broadcasts stored', bOpens],
            ['Rough conversion', rate + '%']])
          + gap('A true Signal → Broadcast funnel needs per-open events. Those are not stored yet, so this is a stock count, not a conversion rate you should steer by.'));
      return;
    }

    if (tab === 'creators') {
      el.innerHTML =
        kpis([['Creators', cr.total || 0], ['With a Broadcast', cr.active_30d || 0]])
        + card('Top creators', plainRows(['Creator', 'Broadcasts', 'Signals', 'Views', 'Live'],
          (cr.list || []).slice(0, 30).map(function (x) {
            return [x.name || x.uid.slice(0, 12), x.broadcasts, x.signals, x.views, x.live];
          })));
      return;
    }

    if (tab === 'toga') {
      const top = d.toga && d.toga.top || [];
      el.innerHTML =
        card('Toga — this month',
          top.length
            ? plainRows(['#', 'Creator', 'Score', 'Views'],
              top.map(function (t, i) {
                return [i + 1, t.name || String(t.id || '').slice(0, 12),
                  t.scoreMonth || t.score || 0, t.viewsMonth || t.viewsTotal || 0];
              }))
            : '<p class="sub">No Toga scores stored this month.</p>')
        + gap('Admin can see why a rank exists: score is views + circle + engagement for the month. The formula is not shown to members.');
      return;
    }

    if (tab === 'community') {
      el.innerHTML =
        kpis([['Comments', c.comments || 0], ['Replies', c.replies || 0],
          ['Shares', c.shares || 0], ['Views', c.views || 0],
          ['Bands', c.bands || 0], ['Strands', c.strands || 0]])
        + gap('These are stored on Broadcast documents (comments and replies increment there) and also counted from the contribution ledger when that is filling. Community value is a measurement — never money.')
        + ((d.origin && d.origin.total)
          ? card('Origin marks',
            kpis([['Scanned', d.origin.total], ['Held / match', d.origin.held]])
            + plainRows(['Title', 'Status', 'Score', 'When'],
              (d.origin.list || []).slice(0, 12).map(function (m) {
                return [m.title || '', m.status || '', m.score || 0, when(m.createdAt)];
              })))
          : '');
      return;
    }

    if (tab === 'trust') {
      el.innerHTML =
        kpis([['Open reports', sf.open_reports || 0], ['Suspended', sf.suspended || 0],
          ['Restricted', sf.restricted || 0], ['Flagged', sf.flagged || 0]])
        + card('Open reports', plainRows(['Target', 'By', 'Reason', 'Status', ''],
          (sf.open || []).map(function (r) {
            return [String(r.target_user_id || r.target_id || '').slice(0, 12),
              String(r.reporter_uid || '').slice(0, 10),
              r.reason || '', r.status || 'OPEN',
              '<button type="button" class="ghost admRpt" data-id="' + escapeHtml(r.id) + '" data-d="ACTIONED">Action</button> '
              + '<button type="button" class="ghost admRpt" data-id="' + escapeHtml(r.id) + '" data-d="DISMISSED">Dismiss</button>'];
          })))
        + card('Suspended', plainRows(['Person', 'Reason'],
          (u.suspended || []).map(function (row) {
            return [userName(row), row.suspendedReason || row.suspended_reason || '—'];
          })));
      el.querySelectorAll('.admRpt').forEach(function (btn) {
        btn.onclick = function () { actReport(btn.getAttribute('data-id'), btn.getAttribute('data-d')); };
      });
      return;
    }

    if (tab === 'economy') {
      const off = !d.flags.contribution_enabled;
      el.innerHTML =
        (off ? inactiveNote('Contribution tracking is switched off.') : '')
        + inactiveNote('Contribution points are a measurement. They are not money, not a wallet, and not a promise to pay.')
        + kpis([['Ledger rows', (e.ledger || []).length], ['Points', e.contribution_points || 0],
          ['Eligible', e.eligible_points || 0], ['Pending review', (e.pending_review || []).length],
          ['Contributors', e.contributors || 0]])
        + card('Recent ledger', plainRows(['Event', 'Points', 'Eligible', 'Status', 'User'],
          (e.ledger || []).slice(0, 30).map(function (r) {
            return [r.event_type || '', r.points || 0, r.eligible_points || 0, r.status || '', String(r.user_id || '').slice(0, 10)];
          })))
        + gap('Points are written only by the economy worker. Comments still land if the Google key is rejected — they go through the signed-in inbox, and this desk counts them.');
      return;
    }

    if (tab === 'support') {
      el.innerHTML =
        inactiveNote('Creator Support is off. No payment provider is connected, so no money can move.')
        + gap(g.payments || '');
      return;
    }

    if (tab === 'money') {
      const inputs = readCostInputs();
      const raw = d._raw || {};
      const costs = (Data && Data.estimateCosts)
        ? Data.estimateCosts(Object.assign({}, raw, { now: d.now, zone: d.zone, costInputs: inputs }))
        : (d.costs || {});
      const lines = costs.lines || [];
      const top = costs.top || [];
      const scale = costs.scale || [];
      const assum = costs.assumptions || [];
      el.innerHTML =
        inactiveNote('Real payouts are disabled. No money has moved. Revenue does not exist yet.')
        + card('What does each person cost Naluno?',
          '<p class="sub">' + escapeHtml((costs.headline) || 'List prices × usage on this desk.') + '</p>'
          + kpis([['Invoiced (typed)', aedUsd(costs.invoice_aed || 0)],
            ['List-price usage', aedUsd(costs.metered_aed || 0)],
            ['After free tier', aedUsd(costs.billable_aed || 0)],
            ['Serving with', costs.invoice_aed ? 'invoice' : (costs.on_free_tier ? 'free tier' : 'Blaze / paid')]])
          + kpis([['Per registered', aedUsd(costs.per_registered_aed || 0)],
            ['Per MAU', aedUsd(costs.per_mau_aed || 0)],
            ['Per DAU', aedUsd(costs.per_dau_aed || 0)],
            ['R2 stored', (costs.storage && costs.storage.r2_gb != null) ? Number(costs.storage.r2_gb).toFixed(3) + ' GB' : '—']])
          + gap(g.unit_econ || ''))
        + card('When you start paying',
          (costs.gates && costs.gates.length
            ? plainRows(['Cap', 'Free allowance', 'Around MAU', 'Status'],
              costs.gates.map(function (gate) {
                const mau = gate.mau_display == null ? 'needs usage' : ('~' + Number(gate.mau_display).toLocaleString('en-GB'));
                return [gate.label, gate.free, mau, gate.already ? 'past free' : 'still free'];
              }))
            : '<p class="sub">Free-tier gates appear once usage is on file.</p>')
          + gap('Reads usually go first. Model: 150 Firestore reads per MAU per day. Spark allows 50,000/day ≈ 330 MAU. R2 egress is $0. FCM is free.'))
        + card('Bills and extras (this browser)',
          '<label>Invoiced this month (AED)</label><input id="costInvoice" inputmode="decimal" placeholder="0" />'
          + '<label>Fixed monthly — domain, store, tools (AED)</label><input id="costFixed" inputmode="decimal" placeholder="0" />'
          + '<label>Call minutes this month (TURN)</label><input id="costTurn" inputmode="decimal" placeholder="0" />'
          + '<label>Compass / AI this month (AED)</label><input id="costCompass" inputmode="decimal" placeholder="0" />'
          + '<div class="row"><button type="button" class="primary" id="costBtn">Recalculate cost</button></div>'
          + '<p class="sub" id="costHint"></p>')
        + card('Where the list-price goes',
          plainRows(['Line', 'Quantity', 'AED / month'],
            lines.map(function (L) {
              const qty = L.unit === 'GB-month' || L.unit === 'GB'
                ? Number(L.qty || 0).toFixed(4) + ' ' + L.unit
                : (Math.round(Number(L.qty) || 0) + (L.unit ? ' ' + L.unit : ''));
              return [L.label, qty, aedUsd(L.aed)];
            }))
          + gap('Broadcast is the expensive part — it stays. Signals fall off after 25 hours.'))
        + card('People, most expensive first',
          top.length
            ? plainRows(['Person', 'MAU', 'Media', 'Uploads', 'Variable', 'Share', 'This month'],
              top.map(function (p) {
                return [
                  (p.name || p.uid.slice(0, 10)) + (p.handle ? ' · ' + p.handle : ''),
                  p.mau ? 'yes' : 'no',
                  bytesLabel((p.broadcast_bytes || 0) + (p.signal_bytes || 0)),
                  p.uploads || 0,
                  aedUsd(p.variable_aed),
                  aedUsd(p.share_aed),
                  aedUsd(p.monthly_aed),
                ];
              }))
            : '<p class="sub">No people on file yet. The math still works at zero.</p>')
        + card('If everyone stored like the people you have now',
          plainRows(['MAU', 'List-price / month', 'After free tier', 'Per MAU'],
            scale.map(function (row) {
              return [row.n.toLocaleString('en-GB'), aedUsd(row.gross_aed), aedUsd(row.billable_aed), aedUsd(row.per_mau_aed)];
            }))
          + gap('This is a mix projection, not a forecast. Empty product → only the typed fixed bill.'))
        + card('Runway',
          '<p class="sub">Cash and burn stay on this browser until a finance ledger exists.</p>'
          + '<label>Cash on hand (AED)</label><input id="runCash" inputmode="decimal" placeholder="e.g. 80000" />'
          + '<label>Monthly burn (AED)</label><input id="runBurn" inputmode="decimal" placeholder="e.g. 12000" />'
          + '<div class="row"><button type="button" class="primary" id="runBtn">Estimate runway</button></div>'
          + '<div id="runOut" class="sub"></div>')
        + card('Before you sit with an investor',
          '<ul class="sub" style="padding-left:18px;line-height:1.55">'
          + '<li>Live at getnaluno.com. Not on Play Store.</li>'
          + '<li>Registered people, not downloads.</li>'
          + '<li>Cost-to-serve is this model, shown in AED and USD (peg 3.6725). Invoiced spend is what you type (AED 0 until a bill exists).</li>'
          + '<li>No revenue. Creator Support and payouts are off.</li>'
          + '<li>' + escapeHtml(g.cac || 'Do not invent CAC or LTV.') + '</li>'
          + '<li>' + escapeHtml(g.native || 'Do not claim lock-screen ring.') + '</li>'
          + '<li>Mail and delete requests are read by a person, not instant.</li>'
          + '</ul>'
          + (assum.length
            ? '<p class="sub" style="margin-top:10px">Assumptions</p><ul class="sub" style="padding-left:18px;line-height:1.55">'
              + assum.map(function (t) { return '<li>' + escapeHtml(t) + '</li>'; }).join('')
              + '</ul>'
            : ''));
      try {
        if ($('costInvoice')) $('costInvoice').value = String(inputs.invoiceAed || '');
        if ($('costFixed')) $('costFixed').value = String(inputs.fixedAed || '');
        if ($('costTurn')) $('costTurn').value = String(inputs.turnMinutes || '');
        if ($('costCompass')) $('costCompass').value = String(inputs.compassAed || '');
        $('runCash').value = localStorage.getItem('nalunoRunwayCash') || '';
        $('runBurn').value = localStorage.getItem('nalunoRunwayBurn') || '';
      } catch (_) {}
      if ($('costBtn')) $('costBtn').onclick = function () {
        const next = {
          invoiceAed: Number(($('costInvoice') && $('costInvoice').value) || 0) || 0,
          fixedAed: Number(($('costFixed') && $('costFixed').value) || 0) || 0,
          turnMinutes: Number(($('costTurn') && $('costTurn').value) || 0) || 0,
          compassAed: Number(($('costCompass') && $('costCompass').value) || 0) || 0,
        };
        writeCostInputs(next);
        if (d._raw) d._raw.costInputs = next;
        if (d.costs && Data && Data.estimateCosts) {
          d.costs = Data.estimateCosts(Object.assign({}, d._raw || {}, { now: d.now, zone: d.zone, costInputs: next }));
        }
        toast('Cost recalculated');
        renderTab('money', d);
      };
      if ($('runBtn')) $('runBtn').onclick = function () {
        const cash = Number(($('runCash') && $('runCash').value) || 0);
        const burn = Number(($('runBurn') && $('runBurn').value) || 0);
        try {
          localStorage.setItem('nalunoRunwayCash', String(cash));
          localStorage.setItem('nalunoRunwayBurn', String(burn));
        } catch (_) {}
        const out = $('runOut');
        if (!burn) { if (out) out.textContent = 'Burn has to be more than zero.'; return; }
        const months = cash / burn;
        if (out) out.textContent = 'Estimated runway: ' + months.toFixed(1) + ' months.';
      };
      return;
    }

    if (tab === 'content') {
      el.innerHTML =
        inactiveNote('Content Hub (sports, movies, channels, providers) is not in the product yet.')
        + gap('When it arrives, rights-expiry alerts belong at the top of this tab so they can never hide.');
      return;
    }

    if (tab === 'analytics') {
      el.innerHTML =
        card('What are people doing?',
          kpis([['Sessions (approx DAU)', u.dau || 0], ['Broadcasts viewed (stored views)', c.views || 0],
            ['Comments', c.comments || 0], ['Signals', s.total || 0]]))
        + gap('Screen-by-screen paths and completion rates are not stored. Showing them as numbers would be a guess.');
      return;
    }

    if (tab === 'notifications') {
      el.innerHTML =
        card('Notifications',
          kpis([['Users with an FCM token',
            (u.list || []).filter(function (row) { return !!(row.fcmToken || row.fcmTokenAndroid); }).length]])
          + gap(g.notifications || ''));
      return;
    }

    if (tab === 'search') {
      el.innerHTML = card('Search', gap(g.search || ''));
      return;
    }

    if (tab === 'alerts') {
      el.innerHTML = card('Alert centre',
        (d.alerts || []).map(function (a) {
          return '<div class="alert ' + escapeHtml(a.level) + '">' + escapeHtml(a.text)
            + (a.tab ? '<button type="button" class="ghost ccGo" data-go="' + escapeHtml(a.tab) + '">Open</button>' : '')
            + '</div>';
        }).join(''));
      goButtons();
      return;
    }

    if (tab === 'flags') {
      const meta = (Data && Data.FLAG_META) || {};
      const keys = Object.keys(d.flags || {});
      el.innerHTML =
        gap('Flags live in Firestore (economyConfig/flags). The member app reads them there. The economy worker is not required, which is why a rejected Google key can no longer freeze this tab.')
        + card('Feature flags', keys.map(function (k) {
          const on = !!d.flags[k];
          const m = meta[k] || { label: k, note: '' };
          const locked = k === 'real_payouts_enabled';
          return '<div class="flag-row">'
            + '<span style="flex:1;"><strong>' + escapeHtml(m.label || k) + '</strong><br><span class="gap-note">' + escapeHtml(m.note || k) + '</span></span>'
            + '<span style="color:' + (on ? 'var(--mint)' : 'var(--ink-dim)') + ';">' + (on ? 'ON' : 'OFF') + '</span>'
            + (locked
              ? '<span style="font-size:10px;color:var(--ink-dim);">locked</span>'
              : '<button type="button" class="ghost admin-flag" data-flag="' + escapeHtml(k) + '" data-next="' + (on ? '0' : '1') + '">' + (on ? 'Turn off' : 'Turn on') + '</button>')
            + '</div>';
        }).join(''));
      el.querySelectorAll('.admin-flag').forEach(function (btn) {
        btn.onclick = function () { toggleFlag(btn.getAttribute('data-flag'), btn.getAttribute('data-next') === '1'); };
      });
      return;
    }

    if (tab === 'audit') {
      el.innerHTML =
        card('Everything important an administrator does',
          plainRows(['When', 'Who', 'Action', 'Target', 'Reason'],
            (d.audit || []).slice(0, 40).map(function (row) {
              return [when(row.created_at), row.actorEmail || String(row.actor || '').slice(0, 8),
                row.action || '', row.target || '', row.reason || ''];
            })));
      return;
    }

    el.innerHTML = '<p class="sub">Unknown section.</p>';
  }

  async function openUser(uid, d) {
    const out = $('admUserDetail');
    if (!out) return;
    const row = ((d.users && d.users.list) || []).filter(function (u) { return u.id === uid; })[0] || { id: uid };
    const bcasts = ((d.content && d.content.broadcasts) || []).filter(function (b) { return b.creatorUid === uid; });
    const pin = coordsOf(row);
    const theirBeacons = ((d.locations && d.locations.beacons) || (d._raw && d._raw.beacons) || (d.locations && d.locations.recent) || []).filter(function (b) {
      return String(b.uid || '') === String(uid);
    });
    out.innerHTML =
      card('User · ' + escapeHtml(userName(row)),
        '<p class="sub">' + escapeHtml(row.handle || '') + ' ' + escapeHtml(row.email || '')
        + ' · uid ' + escapeHtml(uid) + '</p>'
        + kpis([['Last seen', row.lastSeen ? when(row.lastSeen) : 'never'],
          ['Platform', row.lastPlatform || '—'],
          ['State', row.suspended ? 'SUSPENDED' : (row.restricted ? 'restricted' : 'ok')],
          ['Broadcasts', bcasts.length],
          ['Signals', ((d.signals && d.signals.list) || []).filter(function (s) { return s.uid === uid; }).length],
          ['Cost / month', (function () {
            const pc = personCost(d, uid);
            return pc ? aed(pc.monthly_aed) : '—';
          })()]])
        + (function () {
          const pc = personCost(d, uid);
          if (!pc) return '';
          return '<p class="sub">Media ' + escapeHtml(bytesLabel((pc.broadcast_bytes || 0) + (pc.signal_bytes || 0)))
            + ' · uploads ' + (pc.uploads || 0)
            + ' · variable ' + escapeHtml(aed(pc.variable_aed))
            + ' · platform share ' + escapeHtml(aed(pc.share_aed))
            + (pc.mau ? '' : ' · not in MAU, so no platform share')
            + '</p>';
        })()
        + (pin
          ? '<p class="sub">Last pin: ' + pinHtml(pin.lat, pin.lng, pin.accuracy, pin.place)
            + (pin.at ? ' · ' + escapeHtml(when(pin.at)) : '')
            + (row.lastLocationSource ? ' · ' + escapeHtml(row.lastLocationSource) : '')
            + '</p>'
            + '<iframe title="Last pin" style="width:100%;height:220px;border:1px solid var(--line);border-radius:10px;margin:8px 0 12px;" src="https://www.openstreetmap.org/export/embed.html?bbox='
            + (pin.lng - 0.012) + '%2C' + (pin.lat - 0.008) + '%2C' + (pin.lng + 0.012) + '%2C' + (pin.lat + 0.008)
            + '&layer=mapnik&marker=' + pin.lat + '%2C' + pin.lng + '"></iframe>'
          : '<p class="sub">No GPS pin yet. Turn Find Naluno on under Callsign on that phone.</p>')
        + (row.suspended ? '<p class="sub">Suspended: ' + escapeHtml(row.suspendedReason || '—') + '</p>' : '')
        + '<div class="row">'
        + (row.suspended
          ? '<button type="button" class="primary admAct" data-act="unsuspend">Lift suspension</button>'
          : '<button type="button" class="danger admAct" data-act="suspend">Suspend</button>')
        + (row.restricted
          ? '<button type="button" class="ghost admAct" data-act="unrestrict">Remove restriction</button>'
          : '<button type="button" class="ghost admAct" data-act="restrict">Restrict</button>')
        + '</div>')
      + (theirBeacons.length
        ? card('Devices', table(['Device', 'Place', 'When', ''],
          theirBeacons.map(function (b) {
            const blat = b.lat, blng = b.lng != null ? b.lng : b.lon;
            return [
              escapeHtml(b.label || b.deviceId || b.id || 'device'),
              pinHtml(blat, blng, b.accuracy, b.placeName || b.place || ''),
              escapeHtml(when(b.ts)),
              (blat != null ? '<a class="ghost" href="' + mapsHref(blat, blng) + '" target="_blank" rel="noopener">Map</a>' : ''),
            ];
          })))
        : '')
      + card('Their Broadcasts', plainRows(['Title', 'Views', 'Live'],
        bcasts.map(function (b) { return [b.title || '', b.views || 0, b.live ? 'LIVE' : '']; })));
    out.querySelectorAll('.admAct').forEach(function (btn) {
      btn.onclick = function () { actUser(uid, btn.getAttribute('data-act')); };
    });
  }

  async function actUser(uid, action) {
    const reason = window.prompt('Reason for "' + action + '" (saved in the audit log):', '');
    if (reason === null) return;
    if (!String(reason).trim()) { toast('A reason is required'); return; }
    const db = adminDb();
    if (!db) { toast('Database is not ready'); return; }
    const patch = { moderationAt: Date.now(), moderationBy: currentUser.uid };
    if (action === 'suspend') { patch.suspended = true; patch.suspendedReason = reason.trim(); patch.suspendedAt = Date.now(); }
    if (action === 'unsuspend') { patch.suspended = false; patch.suspendedReason = ''; }
    if (action === 'restrict') { patch.restricted = true; patch.restrictedReason = reason.trim(); }
    if (action === 'unrestrict') { patch.restricted = false; patch.restrictedReason = ''; }
    try {
      await db.collection('users').doc(uid).set(patch, { merge: true });
      await writeAudit(action, uid, reason.trim());
      toast('Done — logged');
      await loadTab('users', true);
    } catch (e) {
      toast((e && e.message) || 'Could not update that account. Publish the new firestore.rules.');
    }
  }

  async function actMail(id, status) {
    if (!id || !status) return;
    const db = adminDb();
    if (!db) { toast('Database is not ready'); return; }
    const patch = { status: status, updatedAt: Date.now(), updatedBy: currentUser.uid };
    if (status === 'read') patch.readAt = Date.now();
    if (status === 'done') patch.doneAt = Date.now();
    try {
      await db.collection('deskMail').doc(id).set(patch, { merge: true });
      await writeAudit('mail-' + status, id, status);
      toast(status === 'done' ? 'Marked done' : 'Marked read');
      await loadTab('mail', true);
    } catch (e) {
      toast((e && e.message) || 'Could not update mail. Publish the new firestore.rules.');
    }
  }

  async function actReport(id, decision) {
    const note = window.prompt('Note for the audit log:', '');
    if (note === null) return;
    if (!String(note).trim()) { toast('A note is required'); return; }
    const db = adminDb();
    if (!db) return;
    try {
      await db.collection('reports').doc(id).set({
        status: decision,
        resolution: note.trim(),
        resolvedAt: Date.now(),
        resolvedBy: currentUser.uid,
      }, { merge: true });
      await writeAudit('report-' + decision, id, note.trim());
      toast('Report ' + String(decision).toLowerCase());
      await loadTab('trust', true);
    } catch (e) {
      toast((e && e.message) || 'Could not update the report.');
    }
  }

  async function toggleFlag(flag, next) {
    const reason = window.prompt('Reason for this change (audit log):', '');
    if (reason === null) return;
    const db = adminDb();
    if (!db) { toast('Database is not ready'); return; }
    const flags = Object.assign({}, (__snap && __snap.flags) || (Data && Data.DEFAULT_FLAGS) || {});
    flags[flag] = next;
    flags.updatedAt = Date.now();
    flags.updatedBy = currentUser.uid;
    try {
      await db.collection('economyConfig').doc('flags').set(flags, { merge: true });
      await writeAudit('flag-' + flag, String(next), reason || '');
      toast(flag + ' · ' + (next ? 'ON' : 'OFF'));
      await loadTab('flags', true);
    } catch (e) {
      toast((e && e.message) || 'Could not save the flag. Publish the new firestore.rules.');
    }
  }

  function openConsole() {
    setStage('console');
    resolveDeskPlace();
    const who = $('consoleWho');
    if (who) who.textContent = whoLine(currentUser) + ' · every change is logged.';
    __activeTab = 'overview';
    wireAdminTabs();
    const nav = $('adminTabs');
    if (nav) nav.querySelectorAll('.atab').forEach(function (b) {
      b.classList.toggle('on', b.getAttribute('data-tab') === 'overview');
    });
    loadTab('overview', true);
  }

  function setGateMode(mode) {
    const confirmRow = $('adminPassConfirmRow');
    const btn = $('adminUnlockBtn');
    const title = $('adminGateTitle');
    const hint = $('adminGateHint');
    if (mode === 'setup') {
      if (confirmRow) confirmRow.style.display = 'block';
      if (btn) btn.textContent = 'Create password';
      if (title) title.textContent = 'Set your password';
      if (hint) hint.textContent = 'First time on this account. Choose a password for the Control Centre — at least 8 characters. It is saved to this Naluno account, so any device you sign in on can unlock with it.';
    } else {
      if (confirmRow) confirmRow.style.display = 'none';
      if (btn) btn.textContent = 'Unlock';
      if (title) title.textContent = 'Unlock';
      if (hint) hint.textContent = 'Same password you set for this console. It follows the account, not the phone.';
    }
  }

  async function refreshGateState() {
    if (!currentUser) return;
    const uid = currentUser.uid;
    const ping = $('workerPing');
    if (ping) ping.textContent = 'Checking account…';

    if (!isOperator(currentUser)) {
      __needsSetup = false;
      setGateMode('locked');
      if (ping) ping.textContent = '';
      setMsg('adminGateMsg',
        'This account is not an operator. uid: ' + uid
        + (currentUser.email ? (' · ' + currentUser.email) : '')
        + '. Sign in with the Google account that runs this desk.');
      return;
    }

    let cloudHash = '';
    try { cloudHash = await cloudGetHash(uid); } catch (_) {}
    const hasCloud = !!cloudHash;
    const hasLocal = !!localGet(uid);
    __needsSetup = !hasCloud && !hasLocal;
    setGateMode(__needsSetup ? 'setup' : 'locked');
    if (ping) ping.textContent = hasCloud ? 'password on this account' : (hasLocal ? 'password on this phone — will copy to the account on unlock' : '');
    setMsg('adminGateMsg', '');
  }

  async function adminUnlock() {
    const inp = $('adminPassInput');
    if (!inp || !currentUser) return;
    if (!isOperator(currentUser)) {
      setMsg('adminGateMsg', 'This account is not an operator.');
      return;
    }
    const typed = (inp.value || '').trim();
    if (!typed) { setMsg('adminGateMsg', 'Enter your password.'); return; }
    const uid = currentUser.uid;

    if (__needsSetup) {
      const confirmEl = $('adminPassConfirm');
      const confirmVal = ((confirmEl && confirmEl.value) || '').trim();
      if (typed.length < 8) { setMsg('adminGateMsg', 'Use at least 8 characters.'); return; }
      if (typed !== confirmVal) { setMsg('adminGateMsg', 'The two passwords do not match.'); return; }
      setMsg('adminGateMsg', 'Saving to your account…', true);
      const hash = await hashLocal(uid, typed);
      try { localSet(uid, hash); } catch (_) {}
      const saved = await cloudSetHash(uid, hash);
      if (!saved.ok) {
        setMsg('adminGateMsg', 'Could not save to your account (' + saved.where + '). Publish firestore.rules from this zip and try again.');
        return;
      }
      __needsSetup = false;
      setGateMode('locked');
      if ($('adminPassConfirm')) $('adminPassConfirm').value = '';
    } else {
      const storedCloud = await cloudGetHash(uid);
      const typedHash = await hashLocal(uid, typed);
      const okCloud = !!(storedCloud && storedCloud === typedHash);
      const okLocal = await localOk(uid, typed);
      if (storedCloud) {
        if (!okCloud) { setMsg('adminGateMsg', 'Password not accepted.'); return; }
        if (!okLocal) { try { localSet(uid, typedHash); } catch (_) {} }
      } else {
        if (!okLocal) { setMsg('adminGateMsg', 'Password not accepted.'); return; }
        const saved = await cloudSetHash(uid, typedHash);
        if (!saved.ok) {
          setMsg('adminGateMsg', 'Password is right on this phone but could not be copied to the account (' + saved.where + '). Publish firestore.rules from this zip and try again.');
          return;
        }
      }
    }
    __adminPass = typed;
    setMsg('adminGateMsg', 'Opening…', true);
    openConsole();
  }

  async function changeAdminPassword() {
    if (!currentUser) return;
    const cur = window.prompt('Current password:');
    if (cur === null) return;
    const next = window.prompt('New password (at least 8 characters):');
    if (next === null) return;
    const again = window.prompt('Type the new password again:');
    if (again === null) return;
    if ((next || '').trim() !== (again || '').trim()) { toast('The two new passwords do not match'); return; }
    if ((next || '').trim().length < 8) { toast('Use at least 8 characters'); return; }
    const uid = currentUser.uid;
    const curTrim = (cur || '').trim();
    const nextTrim = (next || '').trim();
    const okCloud = await cloudOk(uid, curTrim);
    const okLocal = await localOk(uid, curTrim);
    const hasAny = !!(await cloudGetHash(uid) || localGet(uid));
    if (hasAny && !okCloud && !okLocal) { toast('Current password is wrong'); return; }
    const hash = await hashLocal(uid, nextTrim);
    try { localSet(uid, hash); } catch (_) {}
    const saved = await cloudSetHash(uid, hash);
    __adminPass = nextTrim;
    await writeAudit('password-change', uid, 'operator changed console password');
    toast(saved.ok ? 'Password changed on the account' : ('Phone updated. Account: ' + saved.where));
  }

  async function signInHandle() {
    if (!initFirebase()) { setMsg('signMsg', 'Sign-in is not ready.'); return; }
    const raw = (($('adminHandle') && $('adminHandle').value) || '').trim();
    const password = ($('adminPassword') && $('adminPassword').value) || '';
    if (!password || password.length < 6) { setMsg('signMsg', 'Enter your password.'); return; }
    let email = '';
    if (looksLikeEmail(raw)) email = raw;
    else {
      const handle = normalizeHandle(raw);
      if (!handle || handle.length < 3) { setMsg('signMsg', 'Enter your handle or email.'); return; }
      email = handleToEmail(handle);
    }
    setMsg('signMsg', 'Signing in…', true);
    try { await fbAuth.signInWithEmailAndPassword(email, password); }
    catch (e) {
      const bad = e && (e.code === 'auth/user-not-found' || e.code === 'auth/wrong-password' || e.code === 'auth/invalid-credential');
      setMsg('signMsg', bad ? 'Not recognized.' : ((e && (e.message || e.code)) || 'Could not sign in.'));
    }
  }
  async function signInGoogle() {
    if (!initFirebase()) { setMsg('signMsg', 'Sign-in is not ready.'); return; }
    setMsg('signMsg', 'Opening Google…', true);
    const provider = new firebase.auth.GoogleAuthProvider();
    try { await fbAuth.signInWithPopup(provider); }
    catch (e) {
      const popupCant = e && (e.code === 'auth/popup-blocked' || e.code === 'auth/operation-not-supported-in-this-environment');
      if (popupCant) {
        setMsg('signMsg', 'Popup blocked — switching to redirect…', true);
        try { await fbAuth.signInWithRedirect(provider); }
        catch (e2) { setMsg('signMsg', (e2 && e2.message) || 'Google sign-in failed.'); }
        return;
      }
      if (e && (e.code === 'auth/popup-closed-by-user' || e.code === 'auth/cancelled-popup-request')) {
        setMsg('signMsg', 'Sign-in window closed — tap Google again.');
        return;
      }
      setMsg('signMsg', (e && (e.message || e.code)) || 'Google sign-in failed.');
    }
  }
  function signOut() {
    __adminPass = '';
    currentUser = null;
    setStage('sign');
    setMsg('signMsg', '');
    setMsg('adminGateMsg', '');
    try { document.title = 'Naluno'; } catch (_) {}
    if (fbAuth) fbAuth.signOut().catch(function () {});
  }
  function lockConsole() {
    __adminPass = '';
    const body = $('adminBody');
    if (body) body.innerHTML = '';
    if (!currentUser) { setStage('sign'); return; }
    setStage('gate');
    const who = $('gateWho');
    if (who) who.textContent = whoLine(currentUser);
    const inp = $('adminPassInput'); if (inp) inp.value = '';
    setMsg('adminGateMsg', '');
    refreshGateState();
  }
  function onUser(user) {
    currentUser = user || null;
    if (!user) { setStage('sign'); return; }
    setStage('gate');
    const who = $('gateWho');
    if (who) who.textContent = whoLine(user);
    setMsg('signMsg', '');
    refreshGateState();
  }
  function bind() {
    const si = $('adminSignInBtn'); if (si) si.onclick = signInHandle;
    const gg = $('adminGoogleBtn'); if (gg) gg.onclick = signInGoogle;
    const un = $('adminUnlockBtn'); if (un) un.onclick = adminUnlock;
    const so = $('adminSignOutBtn'); if (so) so.onclick = signOut;
    const so2 = $('adminSignOutBtn2'); if (so2) so2.onclick = signOut;
    const lk = $('adminLockBtn'); if (lk) lk.onclick = lockConsole;
    const chg = $('adminChangePwBtn'); if (chg) chg.onclick = changeAdminPassword;
    ['adminPassInput', 'adminPassConfirm'].forEach(function (id) {
      const el = $(id);
      if (el) el.addEventListener('keydown', function (e) { if (e.key === 'Enter') adminUnlock(); });
    });
    const pw = $('adminPassword');
    if (pw) pw.addEventListener('keydown', function (e) { if (e.key === 'Enter') signInHandle(); });
  }
  function boot() {
    bind();
    wireServiceWorker();
    if (!initFirebase()) {
      setMsg('signMsg', 'Sign-in could not start.');
      return;
    }
    fbAuth.getRedirectResult().then(function () {}).catch(function (e) {
      if (e && e.code !== 'auth/popup-closed-by-user') {
        setMsg('signMsg', (e && e.message) || 'Google redirect did not finish.');
      }
    }).finally(function () {
      fbAuth.onAuthStateChanged(onUser);
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
