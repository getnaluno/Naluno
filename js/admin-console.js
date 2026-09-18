/* ============================================================
   MODULE: js/admin-console.js
   Operator Control Centre at /admin/. Not loaded by the member app.

   Two gates:
     1. Firebase sign-in (same Google / handle as the app)
     2. Console password — hashed onto the signed-in account, so it
        follows the person, not the phone.

   Tabs read Naluno through the signed-in operator's Firebase SDK.
   The economy worker is optional. A rejected service account must
   never block this console or paint a red error on Unlock.
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
  const BUILD = '20260918g';
  let __appMeta = { label: '', shell: '' };
  function liveAppLabel() {
    return __appMeta.label || BUILD;
  }
  async function loadLiveAppMeta() {
    try {
      const r = await fetch('/app/index.html?nalunoMeta=1', { cache: 'no-store' });
      if (r && r.ok) {
        const t = await r.text();
        const m = t.match(/naluno-build["']\s+content=["']([^"']+)/i)
          || t.match(/content=["']([^"']+)["']\s+name=["']naluno-build/i);
        const v = t.match(/app-version["']\s+content=["']([^"']+)/i);
        if (m) __appMeta.label = m[1];
        else if (v) __appMeta.label = v[1];
      }
    } catch (_) {}
    try {
      const r2 = await fetch('/sw.js?nalunoMeta=1', { cache: 'no-store' });
      if (r2 && r2.ok) {
        const t2 = await r2.text();
        const c = t2.match(/CACHE_NAME\s*=\s*['"]([^'"]+)['"]/);
        if (c) __appMeta.shell = c[1];
      }
    } catch (_) {}
    return __appMeta;
  }
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
  async function colDocsOrder(name, field, limit) {
    const db = adminDb();
    if (!db) return [];
    try {
      const snap = await db.collection(name).orderBy(field, 'desc').limit(limit || 400).get();
      const out = [];
      snap.forEach(function (d) { out.push(Object.assign({ id: d.id }, d.data())); });
      return out;
    } catch (_) {
      return colDocs(name, limit);
    }
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
  function personHandle(row) {
    return String((row && (row.handle || row.number)) || '').replace(/^@/, '');
  }
  function personBlob(row) {
    if (!row) return '';
    return [
      row.name, row.displayName, row.handle, row.number,
      row.email, row.id, row.uid, row.accountState, row.closedKind
    ].map(function (x) { return String(x || '').toLowerCase(); }).join(' ');
  }
  function mergeUserIntoSnap(row) {
    if (!row || !row.id) return;
    if (!__snap) return;
    if (!__snap.users) __snap.users = { list: [] };
    if (!__snap.users.list) __snap.users.list = [];
    const i = __snap.users.list.findIndex(function (u) { return u.id === row.id; });
    const next = Object.assign({}, i >= 0 ? __snap.users.list[i] : {}, row, {
      id: row.id,
      handle: personHandle(row) || (i >= 0 ? personHandle(__snap.users.list[i]) : ''),
    });
    if (i >= 0) __snap.users.list[i] = next;
    else __snap.users.list.unshift(next);
    if (__snap._raw) {
      __snap._raw.users = __snap._raw.users || [];
      const j = __snap._raw.users.findIndex(function (u) { return u.id === row.id; });
      if (j >= 0) __snap._raw.users[j] = Object.assign({}, __snap._raw.users[j], next);
      else __snap._raw.users.unshift(next);
    }
    return next;
  }
  async function findPeople(q) {
    const raw = String(q || '').trim();
    if (!raw) return [];
    const needle = raw.replace(/^@/, '').toLowerCase();
    const found = {};
    function add(row) {
      if (!row) return;
      const id = row.id || row.uid;
      if (!id) return;
      const prev = found[id] || { id: id };
      found[id] = Object.assign({}, prev, row, {
        id: id,
        handle: personHandle(row) || personHandle(prev),
      });
    }
    const fromSnap = []
      .concat((__snap && __snap.users && __snap.users.list) || [])
      .concat((__snap && __snap._raw && __snap._raw.users) || []);
    fromSnap.forEach(function (row) {
      if (personBlob(row).indexOf(needle) >= 0) add(row);
    });
    const db = adminDb();
    if (db) {
      const looksUid = /^[A-Za-z0-9]{20,}$/.test(raw) && raw.indexOf('@') < 0 && raw.indexOf('.') < 0;
      if (looksUid) {
        try {
          const s = await db.collection('users').doc(raw).get();
          if (s.exists) add(Object.assign({ id: s.id }, s.data()));
        } catch (_) {}
      }
      try {
        const h = await db.collection('handles').doc(needle).get();
        if (h.exists) {
          const data = h.data() || {};
          const uid = data.uid;
          if (uid) {
            try {
              const u = await db.collection('users').doc(uid).get();
              if (u.exists) add(Object.assign({ id: u.id }, u.data(), { handle: needle, closed: data.closed }));
              else add({ id: uid, handle: needle, closed: data.closed });
            } catch (_) {
              add({ id: uid, handle: needle, closed: data.closed });
            }
          }
        }
      } catch (_) {}
      function byField(field, value) {
        return db.collection('users').where(field, '==', value).limit(8).get().then(function (s) {
          s.forEach(function (d) { add(Object.assign({ id: d.id }, d.data())); });
        }).catch(function () {});
      }
      await Promise.all([
        byField('number', needle),
        byField('handle', needle),
        raw.indexOf('@') >= 0 ? byField('email', raw) : Promise.resolve(),
      ]);
    }
    return Object.keys(found).map(function (k) { return found[k]; });
  }
  async function loadSignals(users) {
    const top = await colDocs('signals', 400);
    const group = await loadCollectionGroup('signal', 400);
    let out = mergeById(top, group);
    out.sort(function (a, b) { return (Number(b.createdAt || b.ts) || 0) - (Number(a.createdAt || a.ts) || 0); });
    return out;
  }
  async function loadBeacons(users) {
    return loadCollectionGroup('beacons', 400);
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
    try { await loadLiveAppMeta(); } catch (_) {}
    if (!force && __snap && (Date.now() - (__snap._at || 0) < 90000)) return __snap;
    const db = adminDb();
    const pack = {
      users: [], broadcasts: [], signals: [], toga: [], strands: [], bands: [],
      reports: [], ledger: [], metrics: [], audit: [], flags: {},
      worker: {}, sw: __swInfo, now: Date.now(),
      zone: Data ? (Data.adminZone ? Data.adminZone() : Data.localZone()) : undefined,
      beacons: [], originMarks: [], deskMail: [], deskAds: [],
      siteSessions: [], siteDays: [],
      adRates: {},
      currency: {},
      costInputs: readCostInputs(),
    };
    const core = [
      colDocs('users', 500).then(function (r) { pack.users = r; }),
      colDocs('broadcasts', 400).then(function (r) { pack.broadcasts = r; }),
      colDocs('reports', 80).then(function (r) { pack.reports = r; }),
      colDocs('deskMail', 80).then(function (r) { pack.deskMail = r; }),
      colDocs('deskAds', 80).then(function (r) { pack.deskAds = r; }),
      colDocsOrder('siteSessions', 'startedAt', 800).then(function (r) { pack.siteSessions = r; }),
      colDocs('siteDays', 180).then(function (r) { pack.siteDays = r; }),
    ];
    if (db) {
      core.push(db.collection('economyConfig').doc('flags').get().then(function (s) {
        if (s && s.exists) pack.flags = s.data() || {};
      }).catch(function () {}));
      core.push(db.collection('economyConfig').doc('adRates').get().then(function (s) {
        if (s && s.exists) pack.adRates = s.data() || {};
      }).catch(function () {}));
      core.push(db.collection('economyConfig').doc('currency').get().then(function (s) {
        if (s && s.exists) pack.currency = s.data() || {};
        const C = Ccy();
        if (C && pack.currency && pack.currency.code) C.setCode(pack.currency.code);
      }).catch(function () {}));
      core.push(db.collection('economyConfig').doc('fxRates').get().then(function (s) {
        if (s && s.exists) {
          const fx = s.data() || {};
          const C = Ccy();
          if (C && fx.rates) C.applyRates(fx.rates, { source: 'desk', fetchedAt: fx.fetchedAt });
        }
      }).catch(function () {}));
    }
    await Promise.all(core);
    function finish(p) {
      const snap = Data ? Data.deriveSnapshot(p) : p;
      snap._at = Date.now();
      snap._raw = p;
      __snap = snap;
      return snap;
    }
    const first = finish(pack);
    Promise.all([
      colDocs('toga', 80).then(function (r) { pack.toga = r; }),
      colDocs('strands', 200).then(function (r) { pack.strands = r; }),
      colDocs('bands', 80).then(function (r) { pack.bands = r; }),
      colDocs('contributionLedger', 200).then(function (r) { pack.ledger = r; }),
      colDocs('economyInbox', 200).then(function (r) { pack._inbox = r; }),
      colDocs('creatorSupport', 80).then(function (r) { pack.creatorSupport = r; }),
      colDocs('metrics', 80).then(function (r) { pack.metrics = r; }),
      colDocs('adminAudit', 80).then(function (r) {
        pack.audit = r.sort(function (a, b) { return (b.created_at || 0) - (a.created_at || 0); });
      }),
      pingWorker().then(function (w) { pack.worker = w; }),
      loadSignals(pack.users).then(function (r) { pack.signals = r; }),
      loadBeacons(pack.users).then(function (r) { pack.beacons = r; }),
      colDocs('originMarks', 200).then(function (r) { pack.originMarks = r; }),
    ]).then(function () {
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
        }
      }
      const next = finish(pack);
      try {
        if (next && __activeTab) {
          renderStrip(next);
          renderTab(__activeTab, next);
        }
      } catch (_) {}
    }).catch(function () {});
    return first;
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
  function Ccy() {
    try { if (typeof NalunoCurrency !== 'undefined') return NalunoCurrency; } catch (_) {}
    return null;
  }
  function opCode() {
    const C = Ccy();
    return (C && C.code && C.code()) || 'AED';
  }
  function opName() {
    const C = Ccy();
    return (C && C.nameOf) ? C.nameOf(opCode()) : 'United Arab Emirates dirham';
  }
  function moneyLabel() {
    return opCode() + ' · ' + opName();
  }
  async function saveOperatingCurrency(code) {
    const C = Ccy();
    if (!C) return;
    const next = C.norm(code);
    if (!next) return;
    try {
      await C.saveCode(adminDb(), currentUser && currentUser.uid, next);
      await C.fetchLive(true);
      try { await C.publishRates(adminDb()); } catch (_) {}
      try { await writeAudit('currency', next, C.nameOf(next)); } catch (_) {}
      toast('Currency is now ' + next + '. Amounts convert live.');
      loadTab(__activeTab, true);
    } catch (e) {
      toast((e && e.message) || 'Could not save the currency.');
    }
  }
  function wireCurrencySelect(id) {
    const el = $(id);
    if (!el) return;
    el.onchange = function () { saveOperatingCurrency(el.value); };
  }
  function currencyCard() {
    const C = Ccy();
    if (!C) return '';
    return card('Operating currency',
      '<p class="sub">Every amount on Naluno follows this code. Pick any ISO 4217 currency, including UGX. Conversion is live against a USD book — nothing is hardcoded to dirham.</p>'
      + '<label for="opCurrency">Currency</label>'
      + C.selectHtml('opCurrency', opCode())
      + '<p class="gap-note" style="margin-top:8px;" id="opFxLine">' + escapeHtml(C.quoteLine()) + '</p>');
  }
  function bytesLabel(n) {
    return Data && Data.formatBytes ? Data.formatBytes(n) : String(n || 0);
  }
  function termsBlock() {
    const terms = (Data && Data.TERMS) || [];
    if (!terms.length) return '';
    return card('Terms',
      '<p class="sub" style="margin-bottom:8px;">Abbreviations used on this console.</p>'
      + '<dl class="terms">' + terms.map(function (t) {
        return '<div class="term-row"><dt>' + escapeHtml(t.abbr) + '</dt><dd><strong>'
          + escapeHtml(t.name) + '</strong> — ' + escapeHtml(t.note) + '</dd></div>';
      }).join('') + '</dl>');
  }
  function personCost(d, uid) {
    const list = (d && d.costs && d.costs.people) || [];
    for (let i = 0; i < list.length; i++) if (list[i].uid === uid) return list[i];
    return null;
  }
  function dur(ms) {
    ms = Number(ms) || 0;
    if (ms < 1000) return '0s';
    const s = Math.round(ms / 1000);
    if (s < 60) return s + 's';
    const m = Math.floor(s / 60);
    const r = s % 60;
    if (m < 60) return r ? (m + 'm ' + r + 's') : (m + 'm');
    const h = Math.floor(m / 60);
    return (m % 60) ? (h + 'h ' + (m % 60) + 'm') : (h + 'h');
  }
  function bars(items, limit) {
    items = (items || []).slice(0, limit || 12);
    if (!items.length) return '<p class="sub">Nothing recorded yet.</p>';
    const max = Math.max.apply(null, items.map(function (i) { return Number(i.n) || 0; })) || 1;
    return items.map(function (i) {
      const n = Number(i.n) || 0;
      const pct = Math.max(2, Math.round(100 * n / max));
      return '<div class="flag-row" style="gap:10px;">'
        + '<span style="flex:0 0 118px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + escapeHtml(String(i.label || '')) + '</span>'
        + '<span style="flex:1;height:8px;background:var(--line);border-radius:99px;overflow:hidden;"><i style="display:block;height:100%;width:' + pct + '%;background:linear-gradient(90deg,var(--mint),var(--cyan));"></i></span>'
        + '<span style="width:46px;text-align:right;font-variant-numeric:tabular-nums;font-family:var(--dial);font-size:11px;">' + n + '</span></div>';
    }).join('');
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
    const swBit = (__swInfo.connected ? 'Service worker on' : 'Service worker off');
    el.innerHTML =
      '<span class="h" style="color:' + colour + '">NALUNO ' + escapeHtml(d.healthLabel || '') + '</span>'
      + '<span class="m">Online <b>' + (u.active_now || 0) + '</b></span>'
      + '<span class="m">Daily active <b>' + (u.dau || 0) + '</b></span>'
      + '<span class="m">Broadcasts <b>' + (c.broadcasts_total || 0) + '</b></span>'
      + '<span class="m">Live <b>' + (c.broadcasts_live || 0) + '</b></span>'
      + '<span class="m">Site now <b>' + ((d.site && d.site.live) || 0) + '</b></span>'
      + '<span class="m">Site today <b>' + ((d.site && d.site.today) || 0) + '</b></span>'
      + '<span class="m">Opened app <b>' + ((d.site && d.site.app_opens_today) || 0) + '</b></span>'
      + '<span class="m">App <b>' + escapeHtml(liveAppLabel()) + '</b></span>'
      + '<span class="m">' + escapeHtml(swBit) + '</span>'
      + '<span class="m">Currency</span>'
      + (Ccy() ? Ccy().selectHtml('ccStripCurrency', opCode()) : ('<span class="m"><b>' + escapeHtml(opCode()) + '</b></span>'))
      + '<button type="button" class="ghost" id="ccRefresh" style="margin-left:auto;padding:6px 10px;">Refresh</button>';
    const btn = $('ccRefresh');
    if (btn) btn.onclick = function () { loadTab(__activeTab, true); };
    wireCurrencySelect('ccStripCurrency');
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
    if (__snap && !force) {
      try { renderStrip(__snap); renderTab(tab, __snap); } catch (_) {}
    } else {
      el.innerHTML = '<p class="sub">Loading…</p>';
    }
    try {
      const d = await loadSnapshot(!!force);
      renderStrip(d);
      renderTab(tab, d);
    } catch (e) {
      if (!__snap) el.innerHTML = '<p class="sub">Could not load this section. ' + escapeHtml((e && e.message) || '') + '</p>';
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
        card('What needs attention',
          alerts.map(function (a) {
            return '<div class="alert ' + escapeHtml(a.level) + '">'
              + escapeHtml(a.text)
              + (a.tab ? '<button type="button" class="ghost ccGo" data-go="' + escapeHtml(a.tab) + '">Open</button>' : '')
              + '</div>';
          }).join(''))
        + card('Are people coming back?',
          kpis([['Registered', u.total || 0], ['Active now', u.active_now || 0],
            ['Daily active (DAU)', u.dau || 0], ['Weekly active (WAU)', u.wau || 0], ['Monthly active (MAU)', u.mau || 0],
            ['Returning today', u.returning_today || 0],
            ['Stickiness', u.stickiness == null ? '—' : u.stickiness + '%']])
          + kpis([['New today', u.new_today || 0], ['New 7 days', u.new_7d || 0], ['New 30 days', u.new_30d || 0]])
          + gap('Today follows the operator device timezone (' + (d.zone || '') + '), not UTC (Coordinated Universal Time). Stickiness is daily active ÷ monthly active. Active now means a heartbeat in the last 10 minutes.'))
        + card('Still here',
          kpis([['≥7 days still in 7d', u.still_7_pct == null ? '—' : u.still_7_pct + '%'],
            ['of', (u.still_7 || 0) + ' / ' + (u.still_7_of || 0)],
            ['≥30 days still in 30d', u.still_30_pct == null ? '—' : u.still_30_pct + '%'],
            ['of', (u.still_30 || 0) + ' / ' + (u.still_30_of || 0)]])
          + gap(g.retention || 'Day-1 / day-7 retention needs a session log. Still-here is not cohort retention.'))
        + card('What each person costs',
          kpis([['Invoiced this month', aedUsd((d.costs && d.costs.invoice_aed) || 0)],
            ['List-price usage', aedUsd((d.costs && d.costs.metered_aed) || 0)],
            ['After free tier', aedUsd((d.costs && d.costs.billable_aed) || 0)],
            ['Per monthly active', aedUsd((d.costs && d.costs.per_mau_aed) || 0)]])
          + gap((d.costs && d.costs.headline) || g.unit_econ || '')
          + '<div class="row"><button type="button" class="ghost ccGo" data-go="money">Open Money</button></div>')
        + card('On record',
          kpis([['Live', 'getnaluno.com'],
            ['Registered', u.total || 0],
            ['Monthly active', u.mau || 0],
            ['Booked ads', aedUsd((d.ads && d.ads.revenue && d.ads.revenue.bookedAed) || 0)]])
          + kpis([['Play Store', 'not listed'],
            ['Acquisition cost', 'not known'],
            ['Payouts', 'locked'],
            ['First bill', (d.costs && d.costs.first_gate && d.costs.first_gate.mau_display)
              ? ('~' + Number(d.costs.first_gate.mau_display).toLocaleString('en-GB') + ' monthly active')
              : 'still free']])
          + gap('Counts are registered accounts, not store downloads. Cost-to-serve is the Money model. Customer acquisition cost (CAC) and lifetime value (LTV) are not estimated. Lock-screen ring is not available.'))
        + card('The public website',
          kpis([['On the site now', (d.site && d.site.live) || 0],
            ['Visits today', (d.site && d.site.today) || 0],
            ['Unique today', (d.site && d.site.uniques_today) || 0],
            ['Opened Naluno today', (d.site && d.site.app_opens_today) || 0],
            ['Avg time today', dur((d.site && d.site.avg_ms) || 0)],
            ['Countries today', ((d.site && d.site.countries) || []).length]])
          + '<div class="row"><button type="button" class="ghost ccGo" data-go="analytics">Open Analytics</button></div>')
        + card('What are people making?',
          kpis([['Broadcasts', c.broadcasts_total || 0], ['Live now', c.broadcasts_live || 0],
            ['Today', c.broadcasts_today || 0], ['Creators', cr.total || 0]])
          + kpis([['Signals', s.total || 0], ['Active Signals', s.active || 0],
            ['Views', c.views || 0], ['Comments', c.comments || 0]]))
        + card('Where are the devices?',
          kpis([['People with a pin', (d.locations && d.locations.with_coords) || 0],
            ['Find pings', (d.locations && d.locations.devices) || 0]])
          + gap('Pins come from Find Naluno on that phone. The last GPS (Global Positioning System) fix is stored on the account so a missing device can be opened on a map from Users.'));
        + card('Can we trust the activity?',
          kpis([['Open reports', sf.open_reports || 0], ['Suspended', sf.suspended || 0],
            ['Restricted', sf.restricted || 0], ['Held for review', sf.pending_review || 0]]))
        + termsBlock();
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
        ['Service worker', !!__swInfo.connected, __swInfo.connected ? (__swInfo.cache || __swInfo.version) : 'The service worker (SW) is not connected on this session.'],
        ['Content Hub', !!d.flags.content_hub_enabled, g.content_hub],
      ];
      el.innerHTML =
        card('Is Naluno working?',
          kpis([['App version', liveAppLabel()], ['Worker', w.ok ? (w.ms + ' ms') : 'down'],
            ['Service worker', __swInfo.connected ? 'connected' : 'off'],
            ['Metric failures', (d.metrics && d.metrics.failures) || 0]]))
        + card('Live status', services.map(function (row) {
          const on = row[1];
          return '<div class="flag-row"><span style="flex:1;">' + escapeHtml(row[0]) + '</span>'
            + '<span style="color:' + (on ? 'var(--mint)' : 'var(--ink-dim)') + ';">' + (on ? 'ON' : 'OFF') + '</span></div>'
            + '<p class="gap-note" style="margin:0 0 8px;">' + escapeHtml(row[2] || '') + '</p>';
        }).join(''))
        + card('What is not measured',
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
        if (q === 'delete') return String(m.kind || '') === 'delete-account' || String(m.kind || '') === 'violation-close';
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

    if (tab === 'ads') {
      const ads = (d.ads && d.ads.list) || [];
      const q = (__tabCache.adsQ || 'all');
      const filtered = ads.filter(function (a) {
        const st = String(a.status || 'paused');
        if (q === 'live') return st === 'live';
        if (q === 'paused') return st !== 'live';
        return true;
      });
      const rev = (d.ads && d.ads.revenue) || {};
      const rates = rev.rates || { ecpmAed: 0, cpcAed: 0, cpvAed: 0, viewCompleteSec: 15 };
      const ctr = rev.ctr != null ? rev.ctr : ((d.ads && d.ads.impressions) ? ((d.ads.clicks || 0) / d.ads.impressions) * 100 : 0);
      const viewRate = rev.viewRate != null ? rev.viewRate : 0;
      function pct1(n) {
        n = Number(n) || 0;
        if (!n) return '—';
        return (Math.round(n * 10) / 10) + '%';
      }
      function billLabel(m) {
        if (m === 'cpc') return 'CPC (cost per click)';
        if (m === 'cpv') return 'CPV (cost per view)';
        return 'CPM (cost per mille)';
      }
      const unitById = {};
      (rev.units || []).forEach(function (u) { if (u && u.id) unitById[u.id] = u; });
      el.innerHTML =
        kpis([['Live', (d.ads && d.ads.live) || 0], ['Paused', (d.ads && d.ads.paused) || 0],
          ['Impressions', (d.ads && d.ads.impressions) || 0], ['Clicks', (d.ads && d.ads.clicks) || 0],
          ['Completed views', (d.ads && d.ads.viewCompletes) || 0], ['Booked', aedUsd(rev.bookedAed || 0)]])
        + kpis([['Skips', (d.ads && d.ads.skips) || 0], ['Click-through', pct1(ctr)],
          ['View rate', pct1(viewRate)], ['RPM (revenue per mille)', aedUsd(rev.rpmAed || 0)],
          ['ARPDAU', aedUsd(rev.arpdauAed || 0)], ['ARPU', aedUsd(rev.arpuAed || 0)]])
        + card('Booked ad revenue',
          '<p class="gap-note">Booked ad revenue is rate-card maths × observed events. Cash has not moved until an advertiser pays. There is no third-party auction.</p>'
          + kpis([['CPM line (diagnostic)', aedUsd(rev.cpmAed || 0)],
            ['CPC line (diagnostic)', aedUsd(rev.cpcAed || 0)],
            ['CPV line (diagnostic)', aedUsd(rev.cpvAed || 0)],
            ['Booked (chosen models)', aedUsd(rev.bookedAed || 0)]])
          + '<p class="gap-note">Each unit books one model — CPM (cost per mille), CPC (cost per click) or CPV (cost per view). The other two lines are diagnostics, not extra cash. RPM (revenue per mille) is booked ÷ impressions × 1,000. ARPDAU (average revenue per daily active user) here is lifetime booked ÷ today’s daily active users, until a day rollup exists — that is not a day’s take. ARPU (average revenue per user) is lifetime booked ÷ registered accounts.</p>')
        + card('Rate card',
          '<label for="adRateEcpm">eCPM (effective cost per mille) — ' + escapeHtml(opCode()) + ' per 1,000 impressions</label>'
          + '<input id="adRateEcpm" inputmode="decimal" value="' + escapeHtml(String(rates.ecpmAed != null ? (Ccy() && Ccy().convert ? Ccy().convert(rates.ecpmAed, 'AED', opCode()) : rates.ecpmAed) : 0)) + '" />'
          + '<label for="adRateCpc">CPC (cost per click) — ' + escapeHtml(opCode()) + ' per tap</label>'
          + '<input id="adRateCpc" inputmode="decimal" value="' + escapeHtml(String(rates.cpcAed != null ? (Ccy() && Ccy().convert ? Ccy().convert(rates.cpcAed, 'AED', opCode()) : rates.cpcAed) : 0)) + '" />'
          + '<label for="adRateCpv">CPV (cost per view) — ' + escapeHtml(opCode()) + ' per completed view</label>'
          + '<input id="adRateCpv" inputmode="decimal" value="' + escapeHtml(String(rates.cpvAed != null ? (Ccy() && Ccy().convert ? Ccy().convert(rates.cpvAed, 'AED', opCode()) : rates.cpvAed) : 0)) + '" />'
          + '<label for="adRateViewSec">Completed view after (seconds of the unit playing)</label>'
          + '<input id="adRateViewSec" type="number" min="1" max="60" value="' + escapeHtml(String(rates.viewCompleteSec != null ? rates.viewCompleteSec : 15)) + '" />'
          + '<div class="row"><button type="button" class="primary" id="adSaveRates">Save rate card</button></div>'
          + '<p class="gap-note" style="margin-top:8px;">The math runs at ' + escapeHtml(aed(0)) + ' until rates are typed. Saving the card recalculates every unit immediately. Rates are first-party — not an auction. Typed in ' + escapeHtml(moneyLabel()) + ' and converted live.</p>')
        + card('How ads work on Naluno',
          '<p class="gap-note">Inventory is first-party: a creative is uploaded here and stored on Cloudflare R2 (object storage). There is no third-party network, no auction, and no tracker. A live unit appears as a skippable break after every N minutes of watching Signal or Broadcast, and as a chapter break inside a Broadcast. Every unit is labelled <b>Ad</b>. The call to action (CTA) must be an https address. The unit plays with its own audio. If it is not skipped, the Broadcast or Signal resumes when the unit ends. Swiping away pauses it. A completed view is counted after the seconds on the rate card, or if the creative ends without a skip before that. A skip is not a click. A session may see the same unit at most three times.</p>')
        + card('How often',
          '<label for="adEveryMin">Show a break after every (minutes of watching)</label>'
          + '<input id="adEveryMin" type="number" min="1" max="30" value="' + escapeHtml(String((d.flags && d.flags.adEveryMin) != null ? d.flags.adEveryMin : 1)) + '" />'
          + '<div class="row"><button type="button" class="ghost" id="adSavePace">Save pacing</button></div>'
          + '<p class="gap-note" style="margin-top:8px;">Default is 1 minute. The clock only runs while a Signal or Broadcast is actually playing, not on muted feed previews.</p>')
        + card('New unit',
          '<label for="adFile">Creative — 9:16 video or image, about 6–30 seconds</label>'
          + '<input id="adFile" type="file" accept="video/*,image/*" />'
          + '<label for="adHeadline">Headline</label>'
          + '<input id="adHeadline" maxlength="80" placeholder="What the unit is about" />'
          + '<label for="adAdvertiser">Advertiser</label>'
          + '<input id="adAdvertiser" maxlength="60" placeholder="Brand or person shown on the unit" />'
          + '<label for="adCtaLabel">Call to action (CTA)</label>'
          + '<input id="adCtaLabel" maxlength="24" placeholder="Open" value="Open" />'
          + '<label for="adCtaUrl">Call to action address (https only)</label>'
          + '<input id="adCtaUrl" type="url" placeholder="https://" />'
          + '<label for="adPlace">Placement</label>'
          + '<select id="adPlace">'
          + '<option value="both">Watch-time break and Broadcast chapter break</option>'
          + '<option value="in-feed">Watch-time break only</option>'
          + '<option value="broadcast-break">Broadcast chapter break only</option>'
          + '</select>'
          + '<label for="adBill">Billing model</label>'
          + '<select id="adBill">'
          + '<option value="cpm">CPM (cost per mille) — impressions</option>'
          + '<option value="cpc">CPC (cost per click) — taps</option>'
          + '<option value="cpv">CPV (cost per view) — completed views</option>'
          + '</select>'
          + '<label for="adSkip">Skip after (seconds)</label>'
          + '<input id="adSkip" type="number" min="0" max="15" value="5" />'
          + '<div class="row">'
          + '<button type="button" class="primary" id="adSaveLive">Upload and go live</button>'
          + '<button type="button" class="ghost" id="adSavePaused">Upload paused</button>'
          + '</div>'
          + '<div class="msg" id="adMsg"></div>')
        + '<div class="row" style="margin:12px 0;">'
        + ['all', 'live', 'paused'].map(function (k) {
          const on = q === k ? ' primary' : ' ghost';
          const label = k === 'all' ? 'All' : (k === 'live' ? 'Live' : 'Paused');
          return '<button type="button" class="' + on.trim() + ' adsFilter" data-q="' + k + '">' + label + '</button>';
        }).join('')
        + '</div>'
        + card('Inventory', filtered.length
          ? filtered.map(function (a) {
            const st = String(a.status || 'paused');
            const places = (Array.isArray(a.placements) ? a.placements : [a.placement || '']).map(function (p) {
              if (p === 'in-feed') return 'watch-time';
              if (p === 'broadcast-break') return 'Broadcast chapter';
              return p;
            }).filter(Boolean).join(', ');
            const thumb = a.thumbUrl || (String(a.mediaType || '').indexOf('image') === 0 ? a.mediaUrl : '');
            const media = thumb
              ? '<img class="ad-preview" src="' + escapeHtml(thumb) + '" alt="" />'
              : (a.mediaUrl
                ? '<video class="ad-preview" src="' + escapeHtml(a.mediaUrl) + '" muted playsinline></video>'
                : '<div class="ad-preview"></div>');
            const impr = Number(a.impressions) || 0;
            const clicks = Number(a.clicks) || 0;
            const views = Number(a.viewCompletes) || 0;
            const rate = impr ? (Math.round((clicks / impr) * 1000) / 10) + '%' : '—';
            const u = unitById[a.id] || {};
            const model = u.billModel || a.billModel || 'cpm';
            return '<div class="alert ' + (st === 'live' ? 'ok' : 'warning') + ' ad-row">'
              + media
              + '<div class="ad-body">'
              + '<div class="sub">' + escapeHtml(st) + ' · ' + escapeHtml(places) + ' · skip ' + escapeHtml(String(a.skipAfterSec != null ? a.skipAfterSec : 5)) + 's · ' + escapeHtml(billLabel(model)) + '</div>'
              + '<div style="margin:4px 0;"><b>' + escapeHtml(a.headline || a.advertiser || a.id) + '</b></div>'
              + '<div class="sub">' + escapeHtml(a.advertiser || '') + (a.ctaUrl ? ' · ' + escapeHtml(a.ctaUrl) : '') + '</div>'
              + '<div class="sub" style="margin-top:6px;">Impressions ' + impr + ' · Clicks ' + clicks + ' · Skips ' + (Number(a.skips) || 0) + ' · Completed views ' + views + ' · Click-through ' + rate + ' · Booked ' + aedUsd(u.bookedAed || 0) + '</div>'
              + '<div class="row" style="margin-top:10px;">'
              + (st === 'live'
                ? '<button type="button" class="ghost admAd" data-id="' + escapeHtml(a.id) + '" data-act="pause">Pause</button>'
                : '<button type="button" class="primary admAd" data-id="' + escapeHtml(a.id) + '" data-act="live">Go live</button>')
              + '<button type="button" class="danger admAd" data-id="' + escapeHtml(a.id) + '" data-act="delete">Remove</button>'
              + '</div></div></div>';
          }).join('')
          : '<p class="sub">No units in this filter. Upload a 9:16 creative above. It will not appear in the app until it is live, and firestore.rules for deskAds must be published.</p>')
        + (rev.assumptions && rev.assumptions.length
          ? card('Assumptions',
            '<ul class="sub" style="padding-left:18px;line-height:1.55;margin:0;">'
            + rev.assumptions.map(function (t) { return '<li>' + escapeHtml(t) + '</li>'; }).join('')
            + '</ul>')
          : '')
        + termsBlock();
      el.querySelectorAll('.adsFilter').forEach(function (btn) {
        btn.onclick = function () {
          __tabCache.adsQ = btn.getAttribute('data-q') || 'all';
          loadTab('ads', false);
        };
      });
      el.querySelectorAll('.admAd').forEach(function (btn) {
        btn.onclick = function () { actAd(btn.getAttribute('data-id'), btn.getAttribute('data-act')); };
      });
      const save = function (status) { saveAd(status); };
      if ($('adSaveLive')) $('adSaveLive').onclick = function () { save('live'); };
      if ($('adSavePaused')) $('adSavePaused').onclick = function () { save('paused'); };
      if ($('adSavePace')) $('adSavePace').onclick = function () { saveAdPacing(); };
      if ($('adSaveRates')) $('adSaveRates').onclick = function () { saveAdRates(); };
      return;
    }

    if (tab === 'users') {
      const q = (__tabCache.userQ || '').toLowerCase().replace(/^@/, '');
      let list = (u.list || []).filter(function (row) {
        if (!q) return true;
        return personBlob(row).indexOf(q) >= 0;
      });
      if (q && __tabCache.userHits && __tabCache.userHits.length) {
        const seen = {};
        list.forEach(function (row) { seen[row.id] = true; });
        __tabCache.userHits.forEach(function (row) {
          if (!row || !row.id || seen[row.id]) return;
          seen[row.id] = true;
          list.push(row);
        });
      }
      el.innerHTML =
        '<div class="row"><input id="admUserQ" placeholder="Handle, uid, email or name" style="flex:1" value="' + escapeHtml(__tabCache.userQ || '') + '" />'
        + '<button type="button" class="ghost" id="admUserSearch">Search</button></div>'
        + '<p class="sub" id="admUserHint" style="margin:8px 0 0;">Looks up the live handle map as well as loaded accounts.</p>'
        + kpis([['Users', u.total || 0], ['Matching', list.length], ['Closed', (u.closed || []).length], ['Suspended', (u.suspended || []).length], ['Restricted', (u.restricted || []).length],
          ['With a pin', (d.locations && d.locations.with_coords) || 0],
          ['Per monthly active', aedUsd((d.costs && d.costs.per_mau_aed) || 0)]])
        + card('By platform', plainRows(['Platform', 'People'],
          Object.keys(u.by_platform || {}).map(function (k) { return [k, u.by_platform[k]]; })))
        + card('People', table(['Name', 'Handle', 'Last seen', 'Place', 'Cost / mo', 'State', ''],
          list.slice(0, 80).map(function (row) {
            const state = (row.accountState === 'closed' || row.deleted) ? 'CLOSED' : (row.suspended ? 'SUSPENDED' : (row.restricted ? 'restricted' : 'ok'));
            const pin = coordsOf(row);
            const pc = personCost(d, row.id);
            return [
              escapeHtml(userName(row)),
              escapeHtml(personHandle(row) || row.handle || row.number || ''),
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
        const hint = $('admUserHint');
        __tabCache.userQ = (inp && inp.value) || '';
        const query = String(__tabCache.userQ || '').trim();
        if (!query) {
          __tabCache.userHits = [];
          renderTab('users', d);
          return;
        }
        if (hint) hint.textContent = 'Looking…';
        findPeople(query).then(function (rows) {
          __tabCache.userHits = rows || [];
          (rows || []).forEach(mergeUserIntoSnap);
          renderTab('users', __snap || d);
        }).catch(function () {
          renderTab('users', d);
        });
      };
      if ($('admUserSearch')) $('admUserSearch').onclick = run;
      if ($('admUserQ')) $('admUserQ').addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter') { ev.preventDefault(); run(); }
      });
      el.querySelectorAll('.admUserOpen').forEach(function (btn) {
        btn.onclick = function () { openUser(btn.getAttribute('data-uid'), __snap || d); };
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
          + gap('A Signal → Broadcast funnel needs per-open events. Those are not stored yet, so this is a stock count, not a conversion rate.'));
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
        + gap('Points are written only by the economy worker. Comments still land if the Google key is rejected — they go through the signed-in inbox, and this console counts them.');
      return;
    }

    if (tab === 'support') {
      const on = !!d.flags.creator_support_enabled;
      const txs = (d.economy && d.economy.support_list) || [];
      el.innerHTML =
        (on
          ? '<div class="alert ok">Creator Support is ON. It lives inside Broadcast, below Circle. No payment provider is connected, so intents are recorded and no money moves.</div>'
          : inactiveNote('Creator Support is off. The panel still sits under Circle in Broadcast, inactive. Nothing can be charged.'))
        + kpis([['Place', 'Broadcast · below Circle'], ['State', on ? 'active' : 'inactive'],
          ['Intents on file', txs.length || (d.economy && d.economy.support_transactions) || 0],
          ['Real payouts', d.flags.real_payouts_enabled ? 'on' : 'locked']])
        + (txs.length
          ? card('Recorded intents', plainRows(['When', 'From', 'To', 'Amount', 'Status'],
            txs.slice(0, 30).map(function (r) {
              const C = Ccy();
              const ccy = r.currency || 'AED';
              const major = (Number(r.amount_minor) || 0) / ((C && C.digits) ? Math.pow(10, C.digits(ccy)) : 100);
              const shown = C && C.formatFrom ? C.formatFrom(major, ccy) : (major.toFixed(2) + ' ' + ccy);
              return [when(r.created_at || r.createdAt),
                String(r.supporter_user_id || '').slice(0, 10),
                String(r.creator_user_id || '').slice(0, 10),
                shown,
                r.status || 'intent'];
            })))
          : gap('No support intents on file. Turning the flag on does not move money — it only makes the Broadcast panel active.'))
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
      const adRev = (d.ads && d.ads.revenue) || {};
      const C = Ccy();
      function fromAedField(aedVal) {
        if (C && C.convert) return C.convert(Number(aedVal) || 0, 'AED', opCode());
        return Number(aedVal) || 0;
      }
      function toAedField(opVal) {
        if (C && C.convert) return C.convert(Number(opVal) || 0, opCode(), 'AED');
        return Number(opVal) || 0;
      }
      el.innerHTML =
        currencyCard()
        + inactiveNote('Real payouts are disabled. No money has moved.')
        + card('Booked ad revenue',
          '<p class="sub">Booked ad revenue is rate-card maths × observed events. Cash has not moved until an advertiser pays. There is no third-party auction.</p>'
          + kpis([['Booked ads', aedUsd(adRev.bookedAed || 0)],
            ['RPM (revenue per mille)', aedUsd(adRev.rpmAed || 0)],
            ['ARPDAU', aedUsd(adRev.arpdauAed || 0)],
            ['ARPU', aedUsd(adRev.arpuAed || 0)]])
          + kpis([['Impressions', adRev.impressions || 0],
            ['Clicks', adRev.clicks || 0],
            ['Completed views', adRev.viewCompletes || 0],
            ['After free-tier cost', aedUsd(costs.billable_aed || 0)]])
          + gap((g.ad_revenue || 'Booked ad revenue is rate-card maths × observed events. Cash has not moved.')
            + ' Booked minus cost is not profit. Cost is list-price maths until an invoice is recorded.')
          + '<div class="row"><button type="button" class="ghost ccGo" data-go="ads">Open Ads</button></div>')
        + card('What does each person cost Naluno?',
          '<p class="sub">' + escapeHtml((costs.headline) || 'List prices × usage on this console.') + '</p>'
          + kpis([['Invoiced (recorded)', aedUsd(costs.invoice_aed || 0)],
            ['List-price usage', aedUsd(costs.metered_aed || 0)],
            ['After free tier', aedUsd(costs.billable_aed || 0)],
            ['Serving with', costs.invoice_aed ? 'invoice' : (costs.on_free_tier ? 'Firebase Spark (free)' : 'Firebase Blaze (paid)')]])
          + kpis([['Per registered', aedUsd(costs.per_registered_aed || 0)],
            ['Per monthly active (MAU)', aedUsd(costs.per_mau_aed || 0)],
            ['Per daily active (DAU)', aedUsd(costs.per_dau_aed || 0)],
            ['R2 stored', (costs.storage && costs.storage.r2_gb != null) ? Number(costs.storage.r2_gb).toFixed(3) + ' GB' : '—']])
          + gap(g.unit_econ || ''))
        + card('Free-tier limits',
          (costs.gates && costs.gates.length
            ? plainRows(['Cap', 'Free allowance', 'Around monthly active', 'Status'],
              costs.gates.map(function (gate) {
                const mau = gate.mau_display == null ? 'needs usage' : ('~' + Number(gate.mau_display).toLocaleString('en-GB'));
                return [gate.label, gate.free, mau, gate.already ? 'past free' : 'still free'];
              }))
            : '<p class="sub">Free-tier limits appear once usage is on file.</p>')
          + gap('Firestore reads usually go first. Model: 150 Firestore reads per monthly active user per day. Firebase Spark allows 50,000 reads per day, about 330 monthly active users. Cloudflare R2 egress is not billed. Push (FCM) is not billed.'))
        + card('Bills and extras (this browser)',
          '<label>Invoiced this month (' + escapeHtml(moneyLabel()) + ')</label><input id="costInvoice" inputmode="decimal" placeholder="0" />'
          + '<label>Fixed monthly — domain, store, tools (' + escapeHtml(opCode()) + ')</label><input id="costFixed" inputmode="decimal" placeholder="0" />'
          + '<label>Call minutes this month (TURN)</label><input id="costTurn" inputmode="decimal" placeholder="0" />'
          + '<label>Compass / AI this month (' + escapeHtml(opCode()) + ')</label><input id="costCompass" inputmode="decimal" placeholder="0" />'
          + '<div class="row"><button type="button" class="primary" id="costBtn">Recalculate cost</button></div>'
          + '<p class="sub" id="costHint">Invoiced spend is the amount recorded here. Until an invoice is recorded, that figure is ' + escapeHtml(aed(0)) + '.</p>')
        + card('Where the list-price goes',
          plainRows(['Line', 'Quantity', moneyLabel()],
            lines.map(function (L) {
              const qty = L.unit === 'GB-month' || L.unit === 'GB'
                ? Number(L.qty || 0).toFixed(4) + ' ' + L.unit
                : (Math.round(Number(L.qty) || 0) + (L.unit ? ' ' + L.unit : ''));
              return [L.label, qty, aedUsd(L.aed)];
            }))
          + gap('Broadcast is the expensive part — it remains on storage. Signals fall off after 25 hours.'))
        + card('People, most expensive first',
          top.length
            ? plainRows(['Person', 'Monthly active', 'Media', 'Uploads', 'Variable', 'Share', 'This month'],
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
        + card('Mix projection',
          plainRows(['Monthly active', 'List-price / month', 'After free tier', 'Per monthly active'],
            scale.map(function (row) {
              return [row.n.toLocaleString('en-GB'), aedUsd(row.gross_aed), aedUsd(row.billable_aed), aedUsd(row.per_mau_aed)];
            }))
          + gap('This is a mix projection, not a forecast. With no usage on file, only the recorded fixed bill remains.'))
        + card('Runway',
          '<p class="sub">Cash and burn stay on this browser until a finance ledger exists.</p>'
          + '<label>Cash on hand (' + escapeHtml(moneyLabel()) + ')</label><input id="runCash" inputmode="decimal" placeholder="e.g. 80000" />'
          + '<label>Monthly burn (' + escapeHtml(opCode()) + ')</label><input id="runBurn" inputmode="decimal" placeholder="e.g. 12000" />'
          + '<div class="row"><button type="button" class="primary" id="runBtn">Estimate runway</button></div>'
          + '<div id="runOut" class="sub"></div>')
        + (assum.length
          ? card('Assumptions',
            '<ul class="sub" style="padding-left:18px;line-height:1.55;margin:0;">'
              + assum.map(function (t) { return '<li>' + escapeHtml(t) + '</li>'; }).join('')
              + '</ul>')
          : '')
        + termsBlock();
      try {
        if ($('costInvoice')) $('costInvoice').value = String(fromAedField(inputs.invoiceAed) || '');
        if ($('costFixed')) $('costFixed').value = String(fromAedField(inputs.fixedAed) || '');
        if ($('costTurn')) $('costTurn').value = String(inputs.turnMinutes || '');
        if ($('costCompass')) $('costCompass').value = String(fromAedField(inputs.compassAed) || '');
        const runCashAed = Number(localStorage.getItem('nalunoRunwayCash') || 0) || 0;
        const runBurnAed = Number(localStorage.getItem('nalunoRunwayBurn') || 0) || 0;
        $('runCash').value = runCashAed ? String(fromAedField(runCashAed)) : '';
        $('runBurn').value = runBurnAed ? String(fromAedField(runBurnAed)) : '';
      } catch (_) {}
      wireCurrencySelect('opCurrency');
      if ($('costBtn')) $('costBtn').onclick = function () {
        const next = {
          invoiceAed: toAedField(($('costInvoice') && $('costInvoice').value) || 0),
          fixedAed: toAedField(($('costFixed') && $('costFixed').value) || 0),
          turnMinutes: Number(($('costTurn') && $('costTurn').value) || 0) || 0,
          compassAed: toAedField(($('costCompass') && $('costCompass').value) || 0),
        };
        writeCostInputs(next);
        if (d._raw) d._raw.costInputs = next;
        if (d.costs && Data && Data.estimateCosts) {
          d.costs = Data.estimateCosts(Object.assign({}, d._raw || {}, { now: d.now, zone: d.zone, costInputs: next }));
        }
        toast('Cost recalculated in ' + opCode());
        renderTab('money', d);
      };
      if ($('runBtn')) $('runBtn').onclick = function () {
        const cash = toAedField(($('runCash') && $('runCash').value) || 0);
        const burn = toAedField(($('runBurn') && $('runBurn').value) || 0);
        try {
          localStorage.setItem('nalunoRunwayCash', String(cash));
          localStorage.setItem('nalunoRunwayBurn', String(burn));
        } catch (_) {}
        const out = $('runOut');
        if (!burn) { if (out) out.textContent = 'Burn has to be more than zero.'; return; }
        const months = cash / burn;
        if (out) out.textContent = 'Estimated runway: ' + months.toFixed(1) + ' months · ' + aed(cash) + ' on hand.';
      };
      goButtons();
      return;
    }

    if (tab === 'content') {
      el.innerHTML =
        inactiveNote('Content Hub (sports, movies, channels, providers) is not in the product yet.')
        + gap('When it arrives, rights-expiry alerts belong at the top of this tab so they can never hide.');
      return;
    }

    if (tab === 'analytics') {
      const site = d.site || {};
      const recent = site.recent || [];
      el.innerHTML =
        card('getnaluno.com right now',
          kpis([['On the site now', site.live || 0],
            ['Visits today', site.today || 0],
            ['Unique today', site.uniques_today || 0],
            ['New today', site.new_today || 0],
            ['Returning today', site.returning_today || 0],
            ['Week (7d)', site.week || 0]]))
        + card('Time on the site',
          kpis([['Average today', dur(site.avg_ms || 0)],
            ['Median today', dur(site.median_ms || 0)],
            ['Total attention today', dur(site.total_ms_today || 0)],
            ['Bounce', (site.bounce || 0) + '%'],
            ['Bounced visits', site.bounce_n || 0],
            ['Installed (standalone)', site.standalone_today || 0]]))
        + card('Opened Naluno',
          kpis([['Opened the app today', site.app_opens_today || 0],
            ['Open taps today', site.open_clicks_today || 0],
            ['Visit → open', (site.convert_pct || 0) + '%'],
            ['App opens (sampled)', site.app_opens || 0],
            ['Contact form today', site.contact_today || 0],
            ['Tuner taps today', site.tune_today || 0]])
          + gap('Opened the app counts a load of /app on this origin, once per browser per day. Open taps are the mint buttons on the public pages. A tap that stays in the same tab is both.'))
        + card('Countries today', bars(site.countries, 16))
        + card('Countries (daily rollup)', bars(site.countries_all, 16))
        + card('Cities today', bars(site.cities, 12))
        + card('Devices today', bars(site.devices, 8) + bars(site.os, 8) + bars(site.browsers, 8))
        + card('How they arrived', bars(site.refs, 12) + (site.utm && site.utm.length ? bars(site.utm, 8) : ''))
        + card('Pages today', bars(site.paths, 8))
        + card('Language · screen · connection', bars(site.langs, 8) + bars(site.screens, 8) + bars(site.conn, 6))
        + card('Hour of day (operator timezone)', bars(site.hours, 24))
        + card('Last 30 days on record',
          kpis([['Visits (rollup)', site.day_visits || 0],
            ['App opens (rollup)', site.day_app || 0],
            ['Attention (rollup)', dur(site.day_ms || 0)],
            ['Day files', (site.days || []).length]])
          + plainRows(['Day', 'Visits', 'App opens', 'Attention'],
            (site.days || []).slice(0, 31).map(function (row) {
              return [row.id || '', Number(row.visits) || 0, Number(row.appOpens || row.openApp) || 0, dur(row.ms || 0)];
            })))
        + card('Latest visits',
          table(['When', 'Where', 'Device', 'From', 'Time', 'Opened'],
            recent.slice(0, 25).map(function (s) {
              const where = [s.city, s.region, s.country].filter(Boolean).join(', ') || (s.tz || '—');
              const device = [s.device, s.os, s.browser].filter(Boolean).join(' · ');
              return [
                escapeHtml(when(s.lastAt || s.startedAt)),
                escapeHtml(where),
                escapeHtml(device || '—'),
                escapeHtml(s.ref || 'direct'),
                escapeHtml(dur(s.ms || 0)),
                (Number(s.openApp) > 0 || s.kind === 'app') ? 'yes' : '',
              ];
            })))
        + gap(g.site || '');
      return;
    }

    if (tab === 'notifications') {
      el.innerHTML =
        card('Notifications',
          kpis([['Users with a push token (FCM)',
            (u.list || []).filter(function (row) { return !!(row.fcmToken || row.fcmTokenAndroid); }).length]])
          + gap(g.notifications || ''));
      return;
    }

    if (tab === 'search') {
      const q = __tabCache.searchQ || '';
      const hits = __tabCache.searchHits || [];
      el.innerHTML =
        card('Find a Callsign',
          '<p class="sub" style="margin:0 0 12px;">Handle, uid, email or name. Hits the live handle map, not only the first page of loaded accounts.</p>'
          + '<div class="row"><input id="admFindQ" placeholder="@handle, uid, email, name" style="flex:1" value="' + escapeHtml(q) + '" />'
          + '<button type="button" class="primary" id="admFindGo">Find</button></div>'
          + '<p class="sub" id="admFindHint" style="margin:10px 0 0;"></p>')
        + (hits.length
          ? card('Matches', table(['Name', 'Handle', 'Uid', 'State', ''],
            hits.map(function (row) {
              const state = (row.accountState === 'closed' || row.deleted || row.closed) ? 'CLOSED' : (row.suspended ? 'SUSPENDED' : 'ok');
              return [
                escapeHtml(userName(row)),
                escapeHtml(personHandle(row) || '—'),
                escapeHtml(String(row.id || '').slice(0, 22)),
                escapeHtml(state),
                '<button type="button" class="ghost admFindOpen" data-uid="' + escapeHtml(row.id) + '">Open</button>',
              ];
            })))
          : (q ? '<p class="sub">No match for that yet.</p>' : ''))
        + '<div id="admUserDetail"></div>';
      const go = function () {
        const inp = $('admFindQ');
        const hint = $('admFindHint');
        __tabCache.searchQ = (inp && inp.value) || '';
        const query = String(__tabCache.searchQ || '').trim();
        if (!query) {
          __tabCache.searchHits = [];
          renderTab('search', d);
          return;
        }
        if (hint) hint.textContent = 'Looking…';
        findPeople(query).then(function (rows) {
          __tabCache.searchHits = rows || [];
          (rows || []).forEach(mergeUserIntoSnap);
          renderTab('search', __snap || d);
        }).catch(function () {
          if (hint) hint.textContent = 'Could not look that up just now.';
        });
      };
      if ($('admFindGo')) $('admFindGo').onclick = go;
      if ($('admFindQ')) $('admFindQ').addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter') { ev.preventDefault(); go(); }
      });
      el.querySelectorAll('.admFindOpen').forEach(function (btn) {
        btn.onclick = function () { openUser(btn.getAttribute('data-uid'), __snap || d); };
      });
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
      const skipFlag = { updatedAt: 1, updatedBy: 1, adEveryMin: 1 };
      const keys = Object.keys(meta).length
        ? Object.keys(meta)
        : Object.keys(d.flags || {}).filter(function (k) { return !skipFlag[k]; });
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
          ['State', (row.accountState === 'closed' || row.deleted) ? 'CLOSED' : (row.suspended ? 'SUSPENDED' : (row.restricted ? 'restricted' : 'ok'))],
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
            + (pc.mau ? '' : ' · not monthly active, so no platform share')
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
        + (row.accountState === 'closed' || row.deleted
          ? '<p class="sub">Closed ' + escapeHtml(when(row.closedAt || row.deletedAt)) + ' · '
            + escapeHtml(row.closedKind || 'self') + ' · ' + escapeHtml(row.closedReason || row.deletedReason || '—') + '</p>'
          : '')
        + '<div class="row">'
        + (row.accountState === 'closed' || row.deleted
          ? '<button type="button" class="primary admAct" data-act="restore">Restore Callsign</button>'
          : '<button type="button" class="danger admAct" data-act="close">Close for violation</button>')
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
    if (action === 'close') {
      patch.accountState = 'closed';
      patch.closedAt = Date.now();
      patch.closedBy = currentUser.uid;
      patch.closedKind = 'violation';
      patch.closedReason = reason.trim();
      patch.closedPublic = 'Closed by Naluno';
      patch.deleted = true;
      patch.deletedAt = Date.now();
    }
    if (action === 'restore') {
      patch.accountState = 'active';
      patch.deleted = false;
      patch.restoredAt = Date.now();
      patch.restoredBy = currentUser.uid;
      patch.restoreReason = reason.trim();
      patch.closedKind = '';
      patch.closedPublic = '';
    }
    try {
      await db.collection('users').doc(uid).set(patch, { merge: true });
      if (action === 'close' || action === 'restore') {
        const person = (__snap && __snap.users && (__snap.users.list || []).find(function (u) { return u.id === uid; })) || {};
        const handle = String(person.handle || person.number || '').replace(/^@/, '').toLowerCase();
        if (handle) {
          try {
            const href = db.collection('handles').doc(handle);
            if (action === 'close') await href.set({ uid: uid, closed: true, closedAt: Date.now() }, { merge: true });
            else await href.set({ uid: uid, closed: false }, { merge: true });
          } catch (_) {}
        }
        try {
          await db.collection('accountEvents').add({
            uid: uid,
            action: action,
            kind: action === 'close' ? 'violation' : 'restore',
            reason: reason.trim(),
            by: currentUser.uid,
            handle: handle || '',
            ts: Date.now(),
          });
        } catch (_) {}
        try {
          await db.collection('deskMail').add({
            source: 'console',
            kind: action === 'close' ? 'violation-close' : 'restore',
            uid: uid,
            handle: handle || '',
            name: '',
            text: (action === 'close' ? 'Closed for a violation. ' : 'Callsign restored. ') + reason.trim(),
            ts: Date.now(),
            status: 'new',
            by: currentUser.uid,
          });
        } catch (_) {}
      }
      await writeAudit(action, uid, reason.trim());
      toast('Done — logged');
      await loadTab('users', true);
    } catch (e) {
      toast((e && e.message) || 'Could not update that account. Publish the new firestore.rules.');
    }
  }



  function ensureUploadHelper() {
    if (typeof uploadBroadcastFile === 'function') return Promise.resolve();
    return new Promise(function (resolve, reject) {
      const s = document.createElement('script');
      s.src = '/js/broadcast-upload.js?v=20260913a';
      s.onload = function () { resolve(); };
      s.onerror = function () { reject(new Error('Upload helper did not load')); };
      document.head.appendChild(s);
    });
  }

  async function saveAdRates() {
    const db = adminDb();
    if (!db) { toast('Database is not ready'); return; }
    function nRate(id) {
      let n = Number(($(id) && $(id).value) || 0);
      if (!isFinite(n) || n < 0) n = 0;
      if (n > 100000) n = 100000;
      return n;
    }
    const ecpmTyped = nRate('adRateEcpm');
    const cpcTyped = nRate('adRateCpc');
    const cpvTyped = nRate('adRateCpv');
    const C = Ccy();
    const ecpm = C && C.convert ? C.convert(ecpmTyped, opCode(), 'AED') : ecpmTyped;
    const cpc = C && C.convert ? C.convert(cpcTyped, opCode(), 'AED') : cpcTyped;
    const cpv = C && C.convert ? C.convert(cpvTyped, opCode(), 'AED') : cpvTyped;
    let viewSec = parseInt(($('adRateViewSec') && $('adRateViewSec').value) || '15', 10);
    if (!isFinite(viewSec) || viewSec < 1) viewSec = 15;
    if (viewSec > 60) viewSec = 60;
    const doc = {
      ecpmAed: ecpm,
      cpcAed: cpc,
      cpvAed: cpv,
      currency: opCode(),
      viewCompleteSec: viewSec,
      updatedAt: Date.now(),
      updatedBy: currentUser && currentUser.uid,
    };
    try {
      await db.collection('economyConfig').doc('adRates').set(doc, { merge: true });
      await writeAudit('ad-rates', 'adRates', 'eCPM ' + ecpmTyped + ' ' + opCode() + ' · CPC ' + cpcTyped + ' · CPV ' + cpvTyped + ' · view ' + viewSec + 's');
      if (__snap) {
        if (__snap._raw) __snap._raw.adRates = doc;
        if (Data && Data.estimateAdRevenue && __snap._raw) {
          const next = Data.estimateAdRevenue(__snap._raw);
          if (__snap.ads) __snap.ads.revenue = next;
        }
      }
      toast('Rate card saved. Booked revenue is maths, not cash.');
      loadTab('ads', false);
    } catch (e) {
      toast((e && e.message) || 'Could not save the rate card.');
    }
  }

  async function saveAdPacing() {
    const db = adminDb();
    if (!db) { toast('Database is not ready'); return; }
    let n = parseInt(($('adEveryMin') && $('adEveryMin').value) || '1', 10);
    if (!isFinite(n) || n < 1) n = 1;
    if (n > 30) n = 30;
    try {
      await db.collection('economyConfig').doc('flags').set({
        adEveryMin: n,
        updatedAt: Date.now(),
        updatedBy: currentUser.uid,
      }, { merge: true });
      await writeAudit('ad-pacing', String(n), n + ' minute' + (n === 1 ? '' : 's'));
      if (__snap && __snap.flags) __snap.flags.adEveryMin = n;
      toast('Breaks after every ' + n + ' minute' + (n === 1 ? '' : 's') + ' of watching');
    } catch (e) {
      toast((e && e.message) || 'Could not save pacing.');
    }
  }

  function placementsFrom(val) {
    const v = String(val || 'both');
    if (v === 'in-feed') return ['in-feed'];
    if (v === 'broadcast-break') return ['broadcast-break'];
    return ['in-feed', 'broadcast-break'];
  }
  function httpsOnly(raw) {
    const s = String(raw || '').trim();
    if (!s) return '';
    try {
      const u = new URL(s);
      if (u.protocol !== 'https:') return '';
      return u.href;
    } catch (_) { return ''; }
  }
  async function saveAd(status) {
    const db = adminDb();
    if (!db) { toast('Database is not ready'); return; }
    if (!currentUser) { toast('Sign in again'); return; }
    try { window.currentUser = currentUser; } catch (_) {}
    try { await ensureUploadHelper(); } catch (e) { setMsg('adMsg', (e && e.message) || 'Upload helper failed'); return; }
    const fileEl = $('adFile');
    const file = fileEl && fileEl.files && fileEl.files[0];
    const headline = (($('adHeadline') && $('adHeadline').value) || '').trim().slice(0, 80);
    const advertiser = (($('adAdvertiser') && $('adAdvertiser').value) || '').trim().slice(0, 60);
    const ctaLabel = ((($('adCtaLabel') && $('adCtaLabel').value) || 'Open').trim() || 'Open').slice(0, 24);
    const ctaUrl = httpsOnly(($('adCtaUrl') && $('adCtaUrl').value) || '');
    const place = ($('adPlace') && $('adPlace').value) || 'both';
    let bill = String(($('adBill') && $('adBill').value) || 'cpm').toLowerCase();
    if (bill !== 'cpc' && bill !== 'cpv') bill = 'cpm';
    let skip = parseInt(($('adSkip') && $('adSkip').value) || '5', 10);
    if (!isFinite(skip)) skip = 5;
    skip = Math.max(0, Math.min(15, skip));
    if (!file) { setMsg('adMsg', 'Choose a video or image.'); return; }
    if (!headline && !advertiser) { setMsg('adMsg', 'Add a headline or an advertiser name.'); return; }
    if (($('adCtaUrl') && $('adCtaUrl').value.trim()) && !ctaUrl) {
      setMsg('adMsg', 'The call to action must be an https address.');
      return;
    }
    const isImage = String(file.type || '').indexOf('image/') === 0 || /\.(png|jpe?g|webp|gif)$/i.test(file.name || '');
    setMsg('adMsg', 'Uploading…', true);
    toast('Uploading creative…');
    let url = '';
    try {
      if (typeof uploadBroadcastFile !== 'function') throw new Error('Upload helper is not loaded');
      const ctype = isImage ? (file.type || 'image/jpeg') : (file.type || 'video/mp4');
      url = await uploadBroadcastFile(file, function (p, label) {
        setMsg('adMsg', label || ('Uploading… ' + Math.round((p || 0) * 100) + '%'), true);
      }, ctype);
    } catch (e) {
      setMsg('adMsg', (e && e.message) || 'Upload failed');
      return;
    }
    if (!url) { setMsg('adMsg', 'Upload returned no address.'); return; }
    const doc = {
      status: status === 'live' ? 'live' : 'paused',
      placements: placementsFrom(place),
      placement: place,
      headline: headline,
      advertiser: advertiser,
      ctaLabel: ctaLabel,
      ctaUrl: ctaUrl,
      mediaUrl: url,
      mediaType: isImage ? 'image' : 'video',
      thumbUrl: isImage ? url : '',
      skipAfterSec: skip,
      billModel: bill,
      impressions: 0,
      clicks: 0,
      skips: 0,
      viewCompletes: 0,
      bytes: file.size || 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      createdBy: currentUser.uid,
    };
    try {
      const ref = await db.collection('deskAds').add(doc);
      await writeAudit('ad-create', ref.id, doc.status + ' · ' + (headline || advertiser));
      toast(doc.status === 'live' ? 'Live in the app' : 'Saved paused');
      setMsg('adMsg', 'Saved.', true);
      await loadTab('ads', true);
    } catch (e) {
      setMsg('adMsg', (e && e.message) || 'Could not save. Publish the new firestore.rules.');
    }
  }
  async function actAd(id, action) {
    if (!id || !action) return;
    const db = adminDb();
    if (!db) { toast('Database is not ready'); return; }
    try {
      if (action === 'delete') {
        const ok = window.confirm('Remove this unit from inventory? It will leave the app immediately.');
        if (!ok) return;
        await db.collection('deskAds').doc(id).delete();
        await writeAudit('ad-delete', id, 'removed');
        toast('Removed');
      } else {
        const status = action === 'live' ? 'live' : 'paused';
        await db.collection('deskAds').doc(id).set({ status: status, updatedAt: Date.now(), updatedBy: currentUser.uid }, { merge: true });
        await writeAudit('ad-' + status, id, status);
        toast(status === 'live' ? 'Live in the app' : 'Paused');
      }
      await loadTab('ads', true);
    } catch (e) {
      toast((e && e.message) || 'Could not update that unit. Publish the new firestore.rules.');
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
    try {
      const C = Ccy();
      if (C) {
        C.listen(adminDb());
        C.fetchLive(false).then(function () { try { C.publishRates(adminDb()); } catch (_) {} });
      }
    } catch (_) {}
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
      if (title) title.textContent = 'Set a password';
      if (hint) hint.textContent = 'First time on this account. Choose a password for the Control Centre — at least 8 characters. It is saved to this Naluno account, so any signed-in device can unlock with it.';
    } else {
      if (confirmRow) confirmRow.style.display = 'none';
      if (btn) btn.textContent = 'Unlock';
      if (title) title.textContent = 'Unlock';
      if (hint) hint.textContent = 'The password for this console. It follows the account, not the phone.';
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
        + '. Sign in with the Google account that runs this console.');
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
    if (!typed) { setMsg('adminGateMsg', 'Enter the password.'); return; }
    const uid = currentUser.uid;

    if (__needsSetup) {
      const confirmEl = $('adminPassConfirm');
      const confirmVal = ((confirmEl && confirmEl.value) || '').trim();
      if (typed.length < 8) { setMsg('adminGateMsg', 'Use at least 8 characters.'); return; }
      if (typed !== confirmVal) { setMsg('adminGateMsg', 'The two passwords do not match.'); return; }
      setMsg('adminGateMsg', 'Saving to this account…', true);
      const hash = await hashLocal(uid, typed);
      try { localSet(uid, hash); } catch (_) {}
      const saved = await cloudSetHash(uid, hash);
      if (!saved.ok) {
        setMsg('adminGateMsg', 'Could not save to this account (' + saved.where + '). Publish firestore.rules from this zip and try again.');
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
    if (!password || password.length < 6) { setMsg('signMsg', 'Enter the password.'); return; }
    let email = '';
    if (looksLikeEmail(raw)) email = raw;
    else {
      const handle = normalizeHandle(raw);
      if (!handle || handle.length < 3) { setMsg('signMsg', 'Enter a handle or email.'); return; }
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
    try { window.currentUser = null; } catch (_) {}
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
    try { window.currentUser = currentUser; } catch (_) {}
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
  if (typeof document !== 'undefined') {
    document.addEventListener('naluno-currency', function () {
      if (!__snap) return;
      try { renderStrip(__snap); } catch (_) {}
      if (__activeTab === 'money' || __activeTab === 'ads' || __activeTab === 'support') {
        try { renderTab(__activeTab, __snap); } catch (_) {}
      }
    });
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
