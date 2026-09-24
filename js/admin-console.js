/* ============================================================
   MODULE: js/admin-console.js
   Operator Control Centre at /admin/. Not loaded by the member app.

   Two gates:
     1. Firebase sign-in (same Google / handle as the app — a separate
        session from the member app, even on the same email)
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
  const BUILD = '20260924c';
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
  let __livePack = null;
  let __liveUnsubs = [];
  let __liveArmed = false;
  let __liveTimer = null;
  let __workerTimer = null;
  let __spentLatch = {};
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
  async function refreshOperatorClaim() {
    __operatorClaim = false;
    if (!currentUser || !currentUser.getIdTokenResult) return;
    try {
      const r = await currentUser.getIdTokenResult();
      __operatorClaim = !!(r && r.claims && r.claims.operator);
    } catch (_) {}
  }
  async function stampOperatorClaim() {
    if (!currentUser) return;
    try {
      const tok = await currentUser.getIdToken();
      await fetch(WORKER + '/v1/admin/status', { headers: { Authorization: 'Bearer ' + tok }, cache: 'no-store' });
      await currentUser.getIdToken(true);
      await refreshOperatorClaim();
    } catch (_) {}
  }
  function isOperator(user) {
    if (!user) return false;
    if (__operatorClaim) return true;
    if (OPERATOR_UIDS[user.uid]) return true;
    const mail = String(user.email || '').trim().toLowerCase();
    if (mail && OPERATOR_EMAILS[mail] && user.emailVerified) return true;
    return false;
  }

  async function adminWorker(path, opts) {
    opts = opts || {};
    const tok = currentUser ? await currentUser.getIdToken() : '';
    const headers = Object.assign({
      Authorization: tok ? ('Bearer ' + tok) : '',
      'Content-Type': 'application/json',
    }, opts.headers || {});
    if (__adminPass) headers['X-Naluno-Admin'] = __adminPass;
    const bases = [WORKER];
    try { if (location && location.origin) bases.unshift(location.origin + '/__naluno-economy'); } catch (_) {}
    let last = null;
    for (let i = 0; i < bases.length; i++) {
      try {
        const res = await fetch(bases[i] + path, Object.assign({}, opts, { headers: headers, cache: 'no-store' }));
        last = res;
        if (res.ok || res.status === 401 || res.status === 403) return res;
      } catch (_) {}
    }
    return last;
  }

  const CONSOLE_APP = 'naluno-console';
  function firebaseReady() {
    return typeof firebase !== 'undefined'
      && typeof firebaseConfig !== 'undefined'
      && firebaseConfig.apiKey && firebaseConfig.apiKey !== 'YOUR_API_KEY';
  }
  function consoleApp() {
    try { return firebase.app(CONSOLE_APP); }
    catch (_) { return firebase.initializeApp(firebaseConfig, CONSOLE_APP); }
  }
  function initFirebase() {
    if (fbAuth) return true;
    if (!firebaseReady()) return false;
    try {
      const app = consoleApp();
      fbAuth = app.auth();
      fbAuth.setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch(function () {});
      try { fbDbAdmin = app.firestore(); } catch (_) { fbDbAdmin = null; }
      return true;
    } catch (e) {
      console.error('[naluno-admin] firebase init', e);
      return false;
    }
  }
  function adminDb() {
    if (fbDbAdmin) return fbDbAdmin;
    try {
      fbDbAdmin = consoleApp().firestore();
      return fbDbAdmin;
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

  async function pbkdf2Hex(pass, saltB64, iters) {
    const bin = atob(String(saltB64 || ''));
    const salt = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) salt[i] = bin.charCodeAt(i);
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(String(pass)), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits({
      name: 'PBKDF2',
      salt: salt,
      iterations: Number(iters) || 150000,
      hash: 'SHA-256',
    }, key, 256);
    const bytes = new Uint8Array(bits);
    let hex = '';
    for (let i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, '0');
    return hex;
  }
  async function cloudGetRecord(uid) {
    const db = adminDb();
    if (!db || !uid) return null;
    const paths = [
      function () { return db.collection('users').doc(uid).collection('vault').doc('main').get(); },
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
        const g = (data._consoleGate && typeof data._consoleGate === 'object') ? data._consoleGate : null;
        if (g && Number(g.v) === 2 && g.hash && g.salt) {
          return { v: 2, hash: String(g.hash), salt: String(g.salt), iters: Number(g.iters) || 150000 };
        }
        const hash = (g && g.hash) || data.hash || '';
        if (hash) return { v: 1, hash: String(hash) };
      } catch (_) {}
    }
    return null;
  }
  async function cloudGetHash(uid) {
    const rec = await cloudGetRecord(uid);
    return rec && rec.hash ? String(rec.hash) : '';
  }
  async function cloudSetHash(uid, hash) {
    const db = adminDb();
    if (!db || !uid || !hash) return { ok: false, where: 'no-db' };
    const payload = { hash: hash, v: 1, at: Date.now(), kind: 'console-gate' };
    try { await db.collection('users').doc(uid).collection('vault').doc('main').set({ _consoleGate: payload }, { merge: true }); return { ok: true, where: 'vault' }; } catch (_) {}
    try { await db.collection('adminConsole').doc(uid).set(payload); return { ok: true, where: 'adminConsole' }; } catch (_) {}
    try { await db.collection('users').doc(uid).collection('consoleGate').doc('main').set(payload); return { ok: true, where: 'consoleGate' }; } catch (_) {}
    try { await db.collection('users').doc(uid).collection('wirelineHidden').doc('__nalunoConsoleGate').set(payload); return { ok: true, where: 'account' }; } catch (_) {}
    return { ok: false, where: 'write-denied' };
  }
  async function cloudOk(uid, pass) {
    const rec = await cloudGetRecord(uid);
    if (!rec) return false;
    try {
      if (rec.v === 2 && rec.salt && rec.hash) {
        const got = await pbkdf2Hex(pass, rec.salt, rec.iters);
        return got === rec.hash;
      }
      return rec.hash === await hashLocal(uid, pass);
    } catch (_) { return false; }
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

  function handleGuard() {
    try {
      if (typeof NalunoHandleGuard !== 'undefined') return NalunoHandleGuard;
    } catch (_) {}
    return null;
  }
  function normAdminHandle(raw) {
    const G = handleGuard();
    if (G) return G.normHandle(raw);
    return String(raw || '').replace(/^@/, '').trim().toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 24);
  }
  async function seedIdentity() {
    try {
      await adminWorker('/v1/admin/handles/seed', { method: 'POST', body: '{}' });
    } catch (_) {}
    const db = adminDb();
    if (!db) return;
    const G = handleGuard();
    const seed = (G && G.SEED_RESERVED) || [];
    let holder = '';
    try {
      const n = await db.collection('handles').doc('naluno').get();
      if (n && n.exists) holder = String((n.data() || {}).uid || '');
    } catch (_) {}
    const existing = await colDocs('reservedHandles', 400);
    const have = {};
    existing.forEach(function (r) { have[String(r.handle || r.id || '')] = true; });
    const now = Date.now();
    const actor = currentUser ? currentUser.uid : 'seed';
    for (let i = 0; i < seed.length; i++) {
      const s = seed[i];
      if (have[s.handle]) {
        if (s.handle === 'naluno' && holder) {
          try {
            await db.collection('reservedHandles').doc('naluno').set({
              holderUid: holder, updatedAt: now, updatedBy: actor,
            }, { merge: true });
          } catch (_) {}
        }
        continue;
      }
      const core = String(s.handle || '').replace(/_/g, '');
      const row = {
        handle: s.handle,
        core: core,
        category: s.category || 'other',
        reason: s.reason || '',
        status: 'reserved',
        holderUid: s.handle === 'naluno' ? holder : '',
        createdAt: now,
        createdBy: actor,
        updatedAt: now,
        updatedBy: actor,
      };
      try {
        await db.collection('reservedHandles').doc(s.handle).set(row);
        await db.collection('reservedCores').doc(core).set({
          handle: s.handle, core: core, holderUid: row.holderUid, category: s.category,
        });
      } catch (_) {}
    }
    try { await writeAudit('handle-seed', 'reservedHandles', 'seed'); } catch (_) {}
    try {
      if (currentUser) {
        await db.collection('users').doc(currentUser.uid).set({ trustedPublisher: true }, { merge: true });
      }
    } catch (_) {}
  }
  async function saveReservedHandle(handle, category, reason, holderUid) {
    const h = normAdminHandle(handle);
    const G = handleGuard();
    if (G && !G.handleFormatOk(h)) {
      toast(G.FORMAT_MSG);
      return false;
    }
    if (!h || h.length < 3) {
      toast('Choose a handle with at least 3 letters (a–z, 0–9, _).');
      return false;
    }
    const cat = ['official', 'system', 'support', 'other'].indexOf(category) >= 0 ? category : 'other';
    const db = adminDb();
    const now = Date.now();
    const actor = currentUser ? currentUser.uid : '';
    const prev = ((__snap && __snap.identity && __snap.identity.list) || []).filter(function (r) {
      return r.handle === h;
    })[0] || null;
    const row = {
      handle: h,
      core: h.replace(/_/g, ''),
      category: cat,
      reason: String(reason || '').slice(0, 240),
      status: 'reserved',
      holderUid: holderUid != null ? String(holderUid) : (prev ? prev.holderUid : ''),
      createdAt: prev ? prev.createdAt : now,
      createdBy: prev ? prev.createdBy : actor,
      updatedAt: now,
      updatedBy: actor,
    };
    if (db) {
      try {
        await db.collection('reservedHandles').doc(h).set(row, { merge: true });
        await db.collection('reservedCores').doc(row.core).set({
          handle: h, core: row.core, holderUid: row.holderUid, category: cat,
        }, { merge: true });
        if (row.core !== h) {
          await db.collection('reservedHandles').doc(row.core).set(Object.assign({}, row, {
            handle: row.core, aliasOf: h,
          }), { merge: true });
        }
      } catch (e) {
        toast('Could not save that handle');
        return false;
      }
    }
    try {
      await adminWorker('/v1/admin/handles', {
        method: 'POST',
        body: JSON.stringify({ handle: h, category: cat, reason: row.reason, holderUid: row.holderUid }),
      });
    } catch (_) {}
    await writeAudit(prev ? 'handle-update' : 'handle-reserve', h, row.reason, {
      previous: prev ? { category: prev.category, reason: prev.reason } : null,
      next: { category: cat, reason: row.reason },
    });
    toast('@' + h + ' is reserved');
    return true;
  }
  async function resolveAccount(query) {
    const raw = String(query || '').trim();
    if (!raw) return null;
    const self = raw.toLowerCase();
    if (self === 'me' || self === 'this account' || self === 'myself') {
      if (!currentUser) return null;
      return { id: currentUser.uid, name: 'this account' };
    }
    const rows = await findPeople(raw);
    if (rows && rows[0] && (rows[0].id || rows[0].uid)) {
      return Object.assign({ id: rows[0].id || rows[0].uid }, rows[0]);
    }
    if (/^[A-Za-z0-9]{20,}$/.test(raw) && raw.indexOf('@') < 0) {
      return { id: raw };
    }
    return null;
  }
  function holderLabel(uid, d) {
    if (!uid) return '—';
    const list = ((d && d.users && d.users.list) || []);
    const u = list.filter(function (x) { return x.id === uid || x.uid === uid; })[0];
    if (u) {
      const h = personHandle(u);
      const name = u.name || '';
      if (h) return '@' + h;
      if (name) return name;
    }
    return String(uid).slice(0, 10);
  }
  async function bindReservedHolder(handle, who, opts) {
    opts = opts || {};
    const h = normAdminHandle(handle);
    if (!h) {
      toast('Enter a reserved handle');
      return false;
    }
    const person = await resolveAccount(who);
    const uid = person && (person.id || person.uid);
    if (!uid) {
      toast('Could not find that account. Use a handle, name, or uid.');
      return false;
    }
    const db = adminDb();
    if (db) {
      try {
        const existing = await db.collection('handles').doc(h).get();
        if (existing && existing.exists) {
          const owner = String((existing.data() || {}).uid || '');
          if (owner && owner !== uid) {
            toast('@' + h + ' is already on another account. Do not remove the reservation to take it.');
            return false;
          }
        }
      } catch (_) {}
    }
    const prev = ((__snap && __snap.identity && __snap.identity.list) || []).filter(function (r) {
      return r.handle === h;
    })[0] || { category: 'official', reason: 'Official account' };
    const ok = await saveReservedHandle(h, prev.category || 'official', prev.reason || '', uid);
    if (!ok) return false;
    if (db && opts.claim !== false) {
      try {
        await db.collection('handles').doc(h).set({ uid: uid, claimedAt: Date.now() }, { merge: true });
      } catch (_) {}
    }
    toast('@' + h + ' can be used by ' + (personHandle(person) ? ('@' + personHandle(person)) : 'that account') + ' — keep it reserved');
    return true;
  }
  async function clearReservedHolder(handle) {
    const h = normAdminHandle(handle);
    if (!h) return false;
    const prev = ((__snap && __snap.identity && __snap.identity.list) || []).filter(function (r) {
      return r.handle === h;
    })[0] || { category: 'other', reason: '' };
    return saveReservedHandle(h, prev.category || 'other', prev.reason || '', '');
  }
  async function removeReservedHandle(handle, reason) {
    const h = normAdminHandle(handle);
    if (!h) return false;
    const db = adminDb();
    const core = h.replace(/_/g, '');
    if (db) {
      try {
        await db.collection('reservedHandles').doc(h).delete();
        if (core) await db.collection('reservedCores').doc(core).delete();
        if (core !== h) await db.collection('reservedHandles').doc(core).delete();
      } catch (e) {
        toast('Could not remove that handle');
        return false;
      }
    }
    try {
      await adminWorker('/v1/admin/handles/remove', {
        method: 'POST',
        body: JSON.stringify({ handle: h, reason: reason || '' }),
      });
    } catch (_) {}
    await writeAudit('handle-unreserve', h, reason || '');
    toast('@' + h + ' is no longer reserved');
    return true;
  }
  async function reviewHandleFlag(id, status) {
    if (!id) return;
    const db = adminDb();
    if (db) {
      try {
        await db.collection('handleFlags').doc(id).set({
          status: status,
          reviewedBy: currentUser ? currentUser.uid : '',
          reviewedAt: Date.now(),
        }, { merge: true });
      } catch (_) {}
    }
    try {
      await adminWorker('/v1/admin/handles/flag', {
        method: 'POST',
        body: JSON.stringify({ id: id, status: status }),
      });
    } catch (_) {}
    await writeAudit('handle-flag', id, status);
  }

  /* -------- Live snapshot from Firestore (operator SDK) -------- */
  function rowFromDoc(d, extra) {
    const data = (d && d.data && d.data()) || {};
    const id = String((d && d.id) || '');
    /* Document id always wins. A field named id on the row used to overwrite
       it, so Action wrote a stub and the original stayed OPEN after sign-out. */
    return Object.assign({}, extra || {}, data, { id: id, _id: id });
  }
  async function colDocs(name, limit) {
    const db = adminDb();
    if (!db) return [];
    try {
      const snap = await db.collection(name).limit(limit || 400).get();
      const out = [];
      snap.forEach(function (d) { out.push(rowFromDoc(d)); });
      return out;
    } catch (_) { return []; }
  }
  async function colDocsOrder(name, field, limit) {
    const db = adminDb();
    if (!db) return [];
    try {
      const snap = await db.collection(name).orderBy(field, 'desc').limit(limit || 400).get();
      const out = [];
      snap.forEach(function (d) { out.push(rowFromDoc(d)); });
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
        out.push(rowFromDoc(d, { uid: parentUidOf(d) }));
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
            out.push(rowFromDoc(d, { uid: uid }));
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
        raw.indexOf('@') >= 0
          ? db.collectionGroup('vault').where('recoveryEmail', '==', raw).limit(8).get().then(function (s) {
            return Promise.all(s.docs.map(function (d) {
              const parent = d.ref.parent && d.ref.parent.parent;
              const uid = parent ? parent.id : '';
              if (!uid) return null;
              return db.collection('users').doc(uid).get().then(function (u) {
                add(Object.assign({ id: uid }, u.exists ? u.data() : {}, { recoveryEmail: (d.data() || {}).recoveryEmail }));
              });
            }));
          }).catch(function () {})
          : Promise.resolve(),
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

  function snapRows(snap) {
    const out = [];
    if (!snap) return out;
    snap.forEach(function (d) { out.push(rowFromDoc(d)); });
    return out;
  }
  function groupRows(snap) {
    const out = [];
    if (!snap) return out;
    snap.forEach(function (d) {
      out.push(rowFromDoc(d, { uid: parentUidOf(d) }));
    });
    return out;
  }
  function bodyHasFocus() {
    try {
      const el = document.activeElement;
      if (!el) return false;
      const tag = (el.tagName || '').toLowerCase();
      if (tag !== 'input' && tag !== 'textarea' && tag !== 'select') return false;
      return !!(el.closest && el.closest('#adminBody'));
    } catch (_) { return false; }
  }
  function commitPack(p) {
    if (!p) return __snap;
    p.now = Date.now();
    p.sw = __swInfo;
    try { p.costInputs = readCostInputs(); } catch (_) {}
    const snap = Data ? Data.deriveSnapshot(p) : p;
    snap._at = Date.now();
    snap._raw = p;
    __snap = snap;
    return snap;
  }
  /* ---- Keep what you opened, open ----
     Live listeners fire whenever ANYTHING changes anywhere, and every one of
     them re-rendered the whole tab. Open a user, a report, an audit row, and
     it vanished mid-sentence. Nothing here is urgent enough to interrupt
     someone reading.

     So: the health strip keeps updating (it replaces no content), but the
     tab's body only re-renders when the person is not in the middle of
     something. If it wants to refresh while they are, it waits and offers a
     button instead. */
  let __pendingSnap = null, __lastTouch = 0;
  function markTouch() { __lastTouch = Date.now(); }
  (function watchTouches() {
    try {
      ['pointerdown', 'keydown', 'scroll', 'click'].forEach(function (ev) {
        document.addEventListener(ev, function (e) {
          try { if (e.target && e.target.closest && e.target.closest('#adminBody')) markTouch(); } catch (_) {}
        }, true);
      });
    } catch (_) {}
  })();
  function somethingIsOpen() {
    try {
      const body = document.getElementById('adminBody');
      if (!body) return false;
      if (body.querySelector('details[open]')) return true;          // an expanded section
      const detail = document.getElementById('admUserDetail');
      if (detail && detail.innerHTML.trim()) return true;            // a user opened
      if (body.querySelector('.modal.active, [data-open="1"]')) return true;
      if (body.scrollTop > 40) return true;                          // scrolled in to read
      const sc = body.closest('.tab-scroll') || document.scrollingElement;
      if (sc && sc.scrollTop > 40) return true;
      return false;
    } catch (_) { return false; }
  }
  function refreshHeld() {
    return bodyHasFocus() || somethingIsOpen() || (Date.now() - __lastTouch < 45000);
  }
  function showRefreshPill(on) {
    let pill = document.getElementById('adminRefreshPill');
    if (!on) { if (pill) pill.style.display = 'none'; return; }
    if (!pill) {
      pill = document.createElement('button');
      pill.id = 'adminRefreshPill';
      pill.type = 'button';
      pill.className = 'admin-refresh-pill';
      pill.textContent = 'New activity \u00b7 Refresh';
      pill.onclick = function () {
        const snap = __pendingSnap || __snap;
        __pendingSnap = null;
        __lastTouch = 0;
        showRefreshPill(false);
        try { renderTab(__activeTab, snap); } catch (_) {}
      };
      (document.getElementById('consoleView') || document.body).appendChild(pill);
    }
    pill.style.display = 'block';
  }
  /* Switching tab is a fresh start: nothing is half-read any more. */
  function clearHeldRefresh() { __pendingSnap = null; __lastTouch = 0; showRefreshPill(false); }

  function applyLivePack() {
    if (!__livePack) return;
    try {
      if (__livePack._signalsTop || __livePack._signalsGroup) {
        __livePack.signals = mergeById(__livePack._signalsTop || [], __livePack._signalsGroup || []);
      }
    } catch (_) {}
    try {
      if ((!__livePack.ledger || !__livePack.ledger.length) && __livePack._inbox && __livePack._inbox.length) {
        __livePack.ledger = __livePack._inbox.map(function (row) {
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
    } catch (_) {}
    try {
      if (Array.isArray(__livePack.audit)) {
        __livePack.audit.sort(function (a, b) { return (b.created_at || 0) - (a.created_at || 0); });
      }
    } catch (_) {}
    const snap = commitPack(__livePack);
    try { maybePauseSpentAds(snap); } catch (_) {}
    try { renderStrip(snap); } catch (_) {}
    if (refreshHeld()) {
      // Hold it. The person is reading; they decide when to take the update.
      __pendingSnap = snap;
      showRefreshPill(true);
      return;
    }
    showRefreshPill(false);
    try { renderTab(__activeTab, snap); } catch (_) {}
  }
  function scheduleLive() {
    if (__liveTimer) {
      try { clearTimeout(__liveTimer); } catch (_) {}
    }
    __liveTimer = setTimeout(function () {
      __liveTimer = null;
      applyLivePack();
    }, 280);
  }
  function dropLiveListeners() {
    __liveUnsubs.forEach(function (u) {
      try { if (typeof u === 'function') u(); } catch (_) {}
    });
    __liveUnsubs = [];
    __liveArmed = false;
    if (__liveTimer) {
      try { clearTimeout(__liveTimer); } catch (_) {}
      __liveTimer = null;
    }
    if (__workerTimer) {
      try { clearInterval(__workerTimer); } catch (_) {}
      __workerTimer = null;
    }
  }
  function listenCol(name, limit, key, orderField) {
    const db = adminDb();
    if (!db) return;
    try {
      let q = db.collection(name);
      if (orderField) q = q.orderBy(orderField, 'desc');
      q = q.limit(limit || 400);
      const unsub = q.onSnapshot(function (s) {
        if (!__livePack) return;
        __livePack[key] = snapRows(s);
        scheduleLive();
      }, function () {
        if (orderField) listenCol(name, limit, key);
      });
      __liveUnsubs.push(unsub);
    } catch (_) {
      if (orderField) {
        try { listenCol(name, limit, key); } catch (_2) {}
      }
    }
  }
  function listenDoc(col, id, key, applyFn) {
    const db = adminDb();
    if (!db) return;
    try {
      const unsub = db.collection(col).doc(id).onSnapshot(function (s) {
        if (!__livePack) return;
        const data = (s && s.exists) ? (s.data() || {}) : {};
        if (typeof applyFn === 'function') applyFn(data);
        else __livePack[key] = data;
        scheduleLive();
      }, function () {});
      __liveUnsubs.push(unsub);
    } catch (_) {}
  }
  function listenGroup(name, limit, onRows) {
    const db = adminDb();
    if (!db) return;
    try {
      const unsub = db.collectionGroup(name).limit(limit || 400).onSnapshot(function (s) {
        if (!__livePack) return;
        onRows(groupRows(s));
        scheduleLive();
      }, function () {});
      __liveUnsubs.push(unsub);
    } catch (_) {}
  }
  /* A creator cannot write deskAds until rules are published. They can
     write deskMail. Opening this console (the operator) copies that letter
     into inventory as a paused unit. Go live is the human clearance — this
     never sets status to live. */
  const __heldPromoted = {};
  function heldPayload(data) {
    const row = data || {};
    if (row.mediaUrl && String(row.mediaUrl).length > 8) return row;
    const text = String(row.text || '');
    const at = text.indexOf('\n{');
    if (at >= 0) {
      try {
        const parsed = JSON.parse(text.slice(at + 1));
        if (parsed && typeof parsed === 'object') return Object.assign({}, row, parsed);
      } catch (_) {}
    }
    return row;
  }
  async function promoteHeldAd(db, mailId, data) {
    if (!db || !mailId || __heldPromoted[mailId]) return;
    const src = heldPayload(data);
    if (String(src.kind || '') !== 'broadcast-ad') return;
    if (String(src.status || 'new') !== 'new' && String((data || {}).status || '') !== 'new') return;
    const media = String(src.mediaUrl || '');
    if (media.length < 9) return;
    __heldPromoted[mailId] = true;
    const adId = 'hold_' + mailId;
    try {
      const ref = db.collection('deskAds').doc(adId);
      const cur = await ref.get();
      const prev = cur.exists ? (cur.data() || {}) : null;
      if (prev && prev.status === 'live') {
        await db.collection('deskMail').doc(mailId).set({ status: 'held', promotedAdId: adId }, { merge: true });
        return;
      }
      const placements = Array.isArray(src.placements) ? src.placements : (src.placement ? [src.placement] : ['both']);
      const doc = {
        status: 'paused',
        source: 'broadcast',
        review: 'pending',
        paymentStatus: src.paymentStatus || 'unpaid',
        spent: false,
        creatorUid: src.creatorUid || src.uid || '',
        broadcastId: src.broadcastId || '',
        placements: placements,
        placement: src.placement || placements[0] || 'both',
        headline: String(src.headline || '').slice(0, 80),
        advertiser: String(src.advertiser || '').slice(0, 60),
        advertiserHandle: src.advertiserHandle || '',
        advertiserEmail: src.advertiserEmail || '',
        advertiserPhone: src.advertiserPhone || '',
        paidAed: Number(src.paidAed) || 0,
        ctaLabel: src.ctaLabel || 'Open',
        ctaUrl: src.ctaUrl || '',
        skipAfterSec: src.skipAfterSec != null ? src.skipAfterSec : 5,
        billModel: src.billModel || 'cpm',
        mediaUrl: media.slice(0, 1800),
        mediaType: src.mediaType || 'video',
        thumbUrl: src.thumbUrl || '',
        impressions: prev ? (Number(prev.impressions) || 0) : 0,
        clicks: prev ? (Number(prev.clicks) || 0) : 0,
        skips: prev ? (Number(prev.skips) || 0) : 0,
        viewCompletes: prev ? (Number(prev.viewCompletes) || 0) : 0,
        createdAt: prev && prev.createdAt ? prev.createdAt : (src.createdAt || Date.now()),
        updatedAt: Date.now(),
        heldFrom: mailId,
      };
      await ref.set(doc, { merge: true });
      await db.collection('deskMail').doc(mailId).set({ status: 'held', promotedAdId: adId }, { merge: true });
    } catch (e) {
      __heldPromoted[mailId] = false;
      try { console.warn('[ads] hold', e); } catch (_) {}
    }
  }
  function armHeldAds() {
    const db = adminDb();
    if (!db || armHeldAds.done) return;
    armHeldAds.done = true;
    try {
      const unsub = db.collection('deskMail').limit(40).onSnapshot(function (s) {
        s.docs.forEach(function (d) {
          const data = d.data() || {};
          if (data.kind === 'broadcast-ad' && data.status === 'new') promoteHeldAd(db, d.id, data);
        });
      }, function () {});
      __liveUnsubs.push(unsub);
    } catch (_) { armHeldAds.done = false; }
  }
  function armLiveListeners() {
    if (__liveArmed) return;
    const db = adminDb();
    if (!db) return;
    __liveArmed = true;
    armHeldAds();
    listenCol('users', 500, 'users');
    listenCol('broadcasts', 400, 'broadcasts');
    listenCol('reports', 80, 'reports');
    listenCol('deskMail', 80, 'deskMail');
    listenCol('deskAds', 80, 'deskAds');
    listenCol('siteSessions', 800, 'siteSessions', 'startedAt');
    listenCol('siteDays', 180, 'siteDays');
    listenCol('toga', 80, 'toga');
    listenCol('strands', 200, 'strands');
    listenCol('bands', 80, 'bands');
    listenCol('contributionLedger', 200, 'ledger');
    listenCol('economyInbox', 200, '_inbox');
    listenCol('creatorSupport', 80, 'creatorSupport');
    listenCol('metrics', 80, 'metrics');
    listenCol('adminAudit', 80, 'audit');
    listenCol('originMarks', 200, 'originMarks');
    listenCol('signals', 400, '_signalsTop');
    listenCol('reservedHandles', 400, 'reservedHandles');
    listenCol('handleFlags', 200, 'handleFlags');
    listenDoc('economyConfig', 'flags', 'flags');
    listenDoc('economyConfig', 'adRates', 'adRates');
    listenDoc('economyConfig', 'currency', 'currency', function (data) {
      __livePack.currency = data;
      const C = Ccy();
      if (C && data && data.code) C.setCode(data.code);
    });
    listenDoc('economyConfig', 'fxRates', 'fxRates', function (fx) {
      const C = Ccy();
      if (C && fx && fx.rates) C.applyRates(fx.rates, { source: 'desk', fetchedAt: fx.fetchedAt });
    });
    listenGroup('signal', 400, function (rows) {
      __livePack._signalsGroup = rows;
      __livePack.signals = mergeById(__livePack._signalsTop || [], rows);
    });
    listenGroup('beacons', 400, function (rows) {
      __livePack.beacons = rows;
    });
    if (__workerTimer) {
      try { clearInterval(__workerTimer); } catch (_) {}
    }
    __workerTimer = setInterval(function () {
      pingWorker().then(function (w) {
        if (!__livePack) return;
        __livePack.worker = w || {};
        scheduleLive();
      }).catch(function () {});
    }, 20000);
  }

  async function loadSnapshot(force) {
    try { await loadLiveAppMeta(); } catch (_) {}
    if (!force && __snap && (__liveArmed || (Date.now() - (__snap._at || 0) < 90000))) return __snap;
    const db = adminDb();
    const pack = {
      users: [], broadcasts: [], signals: [], toga: [], strands: [], bands: [],
      reports: [], ledger: [], metrics: [], audit: [], flags: {},
      worker: {}, sw: __swInfo, now: Date.now(),
      zone: Data ? (Data.adminZone ? Data.adminZone() : Data.localZone()) : undefined,
      beacons: [], originMarks: [], deskMail: [], deskAds: [],
      siteSessions: [], siteDays: [],
      reservedHandles: [], handleFlags: [],
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
      colDocs('reservedHandles', 400).then(function (r) { pack.reservedHandles = r; }),
      colDocs('handleFlags', 200).then(function (r) { pack.handleFlags = r; }),
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
      __livePack = p;
      return commitPack(p);
    }
    const first = finish(pack);
    try { armLiveListeners(); } catch (_) {}
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
      healStuckReports(pack).then(function (changed) {
        if (!changed) return;
        const fresh = finish(pack);
        try {
          renderStrip(fresh);
          if (__activeTab) renderTab(__activeTab, fresh);
        } catch (_) {}
      }).catch(function () {});
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
      '<label for="opCurrency">Currency</label>'
      + C.selectHtml('opCurrency', opCode())
      + '<p class="gap-note" style="margin-top:8px;" id="opFxLine">' + escapeHtml(C.quoteLine()) + '</p>');
  }
  function bytesLabel(n) {
    return Data && Data.formatBytes ? Data.formatBytes(n) : String(n || 0);
  }
  function termsBlock() {
    return '';
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
    if (!items.length) return '<p class="sub">—</p>';
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
    if (!rows.length) return '<p class="sub">—</p>';
    return '<table class="tbl"><thead><tr>'
      + headers.map(function (h) { return '<th>' + escapeHtml(h) + '</th>'; }).join('')
      + '</tr></thead><tbody>'
      + rows.map(function (r) {
        return '<tr>' + r.map(function (c) { return '<td>' + c + '</td>'; }).join('') + '</tr>';
      }).join('')
      + '</tbody></table>';
  }
  function bcastMediaUrl(b) {
    if (!b) return '';
    if (b.mediaUrl) return String(b.mediaUrl);
    if (b.videoUrl) return String(b.videoUrl);
    const ch = Array.isArray(b.chapters) ? b.chapters[0] : null;
    return String((ch && (ch.mediaUrl || ch.url)) || '');
  }
  function bcastIsPhoto(b) {
    const t = String((b && b.mediaType) || '').toLowerCase();
    if (t === 'photo' || t === 'image') return true;
    if (t === 'video') return false;
    return /\.(jpe?g|png|webp|gif)(\?|$)/i.test(bcastMediaUrl(b));
  }
  /* Same wording as MOD_REASON_TEXT in js/nudenet.js — a test checks they match,
     so a reviewer never reads a different reason than the uploader was shown. */
  const MOD_REASON_TEXT = {
    'genitals': 'exposed genitals',
    'anus': 'exposed anus',
    'topless': 'an exposed female breast',
    'nudity': 'nudity',
    'possible-genitals': 'possible exposed genitals',
    'possible-anus': 'possible exposed anus',
    'possible-topless': 'a possibly exposed female breast',
    'single-frame': 'one frame that may be explicit',
    'video-player-screenshot': 'a screenshot of a video player',
    'revealing-allowed': 'revealing but allowed',
  };
  function screenWhy(b) {
    const r = String((b && b.screenReason) || '');
    if (r === 'heuristic-only') return 'Old skin check only (detector did not run) — judge it yourself';
    let t = MOD_REASON_TEXT[r] || r;
    if (r === 'single-frame' && b.screenDetail) {
      t = 'one frame may show ' + (MOD_REASON_TEXT[b.screenDetail] || b.screenDetail);
    }
    if (typeof b.screenFrame === 'number' && b.screenFrame >= 0 && b.screenFrames > 1) {
      t += ' (frame ' + (b.screenFrame + 1) + ' of ' + b.screenFrames + ')';
    }
    return t;
  }
  /* The rulebook reviewers work from. It is the SAME standard the detector
     applies (js/nudenet.js), so a person and the machine agree on the line. */
  function moderationRulebookHtml() {
    return '<details class="rulebook"><summary><strong>Moderation rulebook</strong> — what counts as explicit</summary>'
      + '<p><strong>Reject</strong> anything that shows, of any person, in any setting:</p><ul>'
      + '<li>Exposed genitals</li><li>Exposed anus</li>'
      + '<li>An exposed female nipple — topless, <em>including breastfeeding</em> (for now)</li>'
      + '<li>Sexual acts — intercourse, oral sex, masturbation, sexual touching — <em>even when the genitals are hidden</em></li></ul>'
      + '<p><strong>Accept</strong>, however sensual or revealing:</p><ul>'
      + '<li>Bikinis, swimwear, lingerie, underwear, bodysuits — nipples and genitals covered</li>'
      + '<li>Thongs: exposed buttocks are fine (the anus is not)</li>'
      + '<li>Shirtless men</li>'
      + '<li>Cleavage, midriffs, bare backs and legs; tight, short or sheer clothes that still cover</li>'
      + '<li>Dancing, twerking, pole and stage shows, suggestive poses, modelling, fitness, beach, pool, bedroom</li>'
      + '<li>Kissing and affection between clothed people</li></ul>'
      + '<p><strong>The test is what is exposed</strong> — never how much skin shows or how provocative it looks. '
      + 'When a video is held for one frame, check that moment: a turn, a shadow or a flash is often what the detector misread.</p>'
      + '<p>The detector cannot see a sexual act when nothing is exposed. That is why screenshots of video players are held — '
      + 'look at what the video is before approving it.</p></details>';
  }

  /* A reported Broadcast, watchable in the console.
     The report queue used to be a text table: you could read that something
     was reported but not SEE it without going into the app and hunting for
     it. For a sexual or terrorism report that delay is the whole problem.
     This puts the same player the held/taken-down lists use next to the
     report, with the reason, who reported it, and the decisions. */
  function reportReviewCard(r) {
    const bid = r.broadcast_id || (r.target_type === 'broadcast' ? r.target_id : '');
    const b = bid ? findBroadcast(bid) : null;
    const urgent = URGENT_REPORT_CODES[r.reason_code] ? true : false;
    let frame = '<div class="review-missing">' + (bid ? 'This Broadcast is not in the console\u2019s current list' : 'Not about a Broadcast') + '</div>';
    if (b) {
      const media = bcastMediaUrl(b);
      const thumb = String((b && (b.thumbUrl || b.thumb)) || '');
      if (bcastIsPhoto(b) && media) frame = '<img class="review-media" alt="" src="' + escapeHtml(media) + '" />';
      else if (media) frame = '<video class="review-media" playsinline webkit-playsinline controls preload="none" poster="' + escapeHtml(thumb) + '" src="' + escapeHtml(media) + '"></video>';
      else if (thumb) frame = '<img class="review-media" alt="" src="' + escapeHtml(thumb) + '" />';
    }
    const state = b
      ? (b.hidden ? 'already taken down' : (b.held ? 'held, off the feed' : 'still on the feed'))
      : '';
    const id = escapeHtml(r.id || '');
    const actions = '<button type="button" class="ghost admRpt" data-id="' + id + '" data-d="ACTIONED">Action</button> '
      + '<button type="button" class="ghost admRpt" data-id="' + id + '" data-d="DISMISSED">Dismiss</button>'
      + (bid && b && !b.hidden ? ' <button type="button" class="danger admBmod" data-id="' + escapeHtml(bid) + '" data-a="take-down">Take down</button>' : '')
      + (bid && b && (b.hidden || b.held) ? ' <button type="button" class="ghost admBmod" data-id="' + escapeHtml(bid) + '" data-a="' + (b.hidden ? 'restore' : 'let-out') + '">Put back</button>' : '');
    return '<div class="review-card' + (urgent ? ' review-urgent' : '') + '">'
      + '<div class="review-frame">' + frame + '</div>'
      + '<div class="review-meta">'
      + '<div class="review-title">' + escapeHtml((b && (b.title || b.id)) || bid || 'Report') + '</div>'
      + '<div class="sub">' + (urgent ? '<strong>URGENT</strong> \u00b7 ' : '')
      + escapeHtml(r.reason_code || '') + (state ? (' \u00b7 ' + escapeHtml(state)) : '')
      + ' \u00b7 reported by ' + escapeHtml(String(r.reporter_uid || '').slice(0, 10)) + '\u2026</div>'
      + (r.reason ? '<div class="sub" style="margin-top:4px;">\u201c' + escapeHtml(String(r.reason).slice(0, 220)) + '\u201d</div>' : '')
      + '<div class="row" style="margin-top:10px;">' + actions + '</div>'
      + '</div></div>';
  }
  const URGENT_REPORT_CODES = {
    sexual: 1, terrorism: 1, recruitment: 1, child_exploitation: 1,
    sexual_exploitation: 1, violence: 1,
  };
  /* The reported Broadcast may be anywhere in the snapshot, not just in the
     held or taken-down lists. */
  function findBroadcast(id) {
    try {
      const raw = (__snap && __snap._raw) || {};
      const all = [].concat(raw.broadcasts || [], (__snap && __snap.content && __snap.content.held) || [],
        (__snap && __snap.content && __snap.content.hidden) || []);
      return all.find(function (b) { return b && (b.id === id || b._id === id); }) || null;
    } catch (_) { return null; }
  }

  function trustReviewCard(b, mode) {
    const media = bcastMediaUrl(b);
    const thumb = String((b && (b.thumbUrl || b.thumb)) || '');
    const photo = bcastIsPhoto(b);
    const why = mode === 'hidden'
      ? (b.hiddenReason === 'screen' ? 'Naluno Screen' : (b.hiddenReason || 'taken down'))
      : (b.heldReason === 'screen' ? 'Screen unsure' : (b.heldReason || 'new publisher'));
    const screenBit = b.screenDecision
      ? ('Screen ' + b.screenDecision + (b.screenReason ? (' — ' + screenWhy(b)) : '')
         + (b.screenScore != null ? (' · ' + b.screenScore) : ''))
      : '';
    let frame;
    if (photo && media) {
      frame = '<img class="review-media" alt="" src="' + escapeHtml(media) + '" />';
    } else if (media) {
      frame = '<video class="review-media" playsinline webkit-playsinline controls preload="none" poster="'
        + escapeHtml(thumb) + '" src="' + escapeHtml(media) + '"></video>';
    } else if (thumb) {
      frame = '<img class="review-media" alt="" src="' + escapeHtml(thumb) + '" />';
    } else {
      frame = '<div class="review-missing">No file on this Broadcast</div>';
    }
    const id = escapeHtml(b.id || '');
    const uid = escapeHtml(b.creatorUid || '');
    const actions = mode === 'hidden'
      ? '<button type="button" class="ghost admBmod" data-id="' + id + '" data-a="restore">Restore</button>'
      : ('<button type="button" class="primary admBmod" data-id="' + id + '" data-a="let-out">Let out</button> '
        + '<button type="button" class="ghost admBmod" data-id="' + id + '" data-a="take-down">Take down</button> '
        + '<button type="button" class="ghost admBmod" data-id="' + id + '" data-uid="' + uid + '" data-a="trust-publisher">Trust publisher</button>');
    return '<div class="review-card">'
      + '<div class="review-frame">' + frame + '</div>'
      + '<div class="review-meta">'
      + '<div class="review-title">' + escapeHtml(b.title || b.id || '') + '</div>'
      + '<div class="sub">' + escapeHtml(b.creatorName || String(b.creatorUid || '').slice(0, 10))
      + ' · ' + escapeHtml(why)
      + (screenBit ? ' · ' + escapeHtml(screenBit) : '')
      + '</div>'
      + '<div class="row" style="margin-top:10px;">' + actions + '</div>'
      + '</div></div>';
  }
  function wireTrustMedia(root) {
    if (!root) return;
    const clips = root.querySelectorAll('video.review-media');
    clips.forEach(function (v) {
      v.addEventListener('play', function () {
        clips.forEach(function (other) {
          if (other !== v) {
            try { other.pause(); } catch (_) {}
          }
        });
      });
    });
  }
  function plainRows(headers, rows) {
    return table(headers, rows.map(function (r) {
      return r.map(function (c) { return escapeHtml(String(c == null ? '' : c)); });
    }));
  }
  function inactiveNote(text) {
    return '';
  }
  function gap(text) {
    return '';
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
    const swBit = (__swInfo.connected ? 'Offline helper on' : 'Offline helper off');
    el.innerHTML =
      '<span class="h" style="color:' + colour + '">NALUNO ' + escapeHtml(d.healthLabel || '') + '</span>'
      + '<span class="m">Online <b>' + (u.active_now || 0) + '</b></span>'
      + '<span class="m">Active today <b>' + (u.dau || 0) + '</b></span>'
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
        try{ clearHeldRefresh(); }catch(_){}   // a new tab is a fresh start
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

  /* The repair is a dry run first, always. Applying asks for confirmation,
     because it writes people's totals. */
  async function runRepair(apply) {
    const out = document.getElementById('admRepairOut');
    if (out) out.textContent = apply ? 'Repairing\u2026' : 'Checking\u2026';
    try {
      const res = await adminFetch('recompute-profiles', {
        method: 'POST',
        body: JSON.stringify(apply ? { apply: true, reason: 'repair totals from the ledger' } : {}),
      });
      const j = await res.json();
      if (!res.ok || !j.ok) { if (out) out.textContent = (j && j.error) || 'Could not run the repair.'; return; }
      const lines = [];
      lines.push((j.dry_run ? 'Dry run. ' : 'Applied. ')
        + j.ledger_rows_scanned + ' ledger rows, ' + j.people + ' people, '
        + j.changed + ' to change, ' + j.points_restored + ' points to restore.');
      if (j.skipped_would_lower) lines.push(j.skipped_would_lower + ' skipped because the repair would LOWER them (use force only if you are sure).');
      if (j.skipped_unreadable) lines.push(j.skipped_unreadable + ' skipped because their profile could not be read \u2014 run it again.');
      if (j.more) lines.push('More rows remain \u2014 run it again to continue.');
      const rows = (j.changes || []).slice(0, 15).map(function (c) {
        return String(c.user_id).slice(0, 12) + '\u2026  '
          + (c.before ? c.before.total_points : '?') + ' \u2192 ' + c.after.total_points
          + (c.gained > 0 ? '  (+' + c.gained + ')' : '') + '  ' + c.action;
      });
      if (out) out.innerHTML = escapeHtml(lines.join(' ')) + (rows.length ? '<pre style="white-space:pre-wrap;font-size:11px;">' + escapeHtml(rows.join('\n')) + '</pre>' : '');
      if (apply) loadTab('community', true);
    } catch (_) { if (out) out.textContent = 'Couldn\u2019t reach the service.'; }
  }
  function wireRepairButtons() {
    const dry = document.getElementById('admRepairDry');
    if (dry) dry.onclick = function () { runRepair(false); };
    const go = document.getElementById('admRepairApply');
    if (go) go.onclick = function () {
      if (!window.confirm('Rebuild contribution totals from the ledger? It never lowers a total, and every change is logged.')) return;
      runRepair(true);
    };
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
      const alerts = (d.attention && d.attention.length) ? d.attention : (d.alerts || []);
      el.innerHTML =
        card('What needs attention',
          alerts.map(function (a) {
            return '<div class="alert ' + escapeHtml(a.level) + '">'
              + escapeHtml(a.text)
              + (a.tab ? '<button type="button" class="ghost ccGo" data-go="' + escapeHtml(a.tab) + '">Open</button>' : '')
              + '</div>';
          }).join(''))
        + card('Are people coming back?',
          kpis([['Registered', u.total || 0], ['On the app now', u.active_now || 0],
            ['Active today', u.dau || 0], ['Active this week', u.wau || 0], ['Active this month', u.mau || 0],
            ['Returning today', u.returning_today || 0],
            ['Come-back rate', u.stickiness == null ? '—' : u.stickiness + '%']])
          + kpis([['New today', u.new_today || 0], ['New last 7 days', u.new_7d || 0], ['New last 30 days', u.new_30d || 0]])
          + gap('Dates follow this phone’s clock (' + (d.zone || '') + '). Come-back rate is how many of this month’s people were also here today. On the app now means a heartbeat in the last 10 minutes.'))
        + card('Still here',
          kpis([['Signed up ≥7 days ago, active this week', u.still_7_pct == null ? '—' : u.still_7_pct + '%'],
            ['of', (u.still_7 || 0) + ' / ' + (u.still_7_of || 0)],
            ['Signed up ≥30 days ago, active this month', u.still_30_pct == null ? '—' : u.still_30_pct + '%'],
            ['of', (u.still_30 || 0) + ' / ' + (u.still_30_of || 0)]])
          + gap(g.retention || 'Still-here is people who signed up at least N days ago and used the app again in that window.'))
        + card('What each person costs',
          kpis([['Invoiced this month', aedUsd((d.costs && d.costs.invoice_aed) || 0)],
            ['List-price usage', aedUsd((d.costs && d.costs.metered_aed) || 0)],
            ['After free tier', aedUsd((d.costs && d.costs.billable_aed) || 0)],
            ['Per person active this month', aedUsd((d.costs && d.costs.per_mau_aed) || 0)]])
          + gap((d.costs && d.costs.headline) || g.unit_econ || '')
          + '<div class="row"><button type="button" class="ghost ccGo" data-go="money">Open Money</button></div>')
        + card('On record',
          kpis([['Live', 'getnaluno.com'],
            ['Registered', u.total || 0],
            ['Active this month', u.mau || 0],
            ['Booked ads', aedUsd((d.ads && d.ads.revenue && d.ads.revenue.bookedAed) || 0)]])
          + kpis([['Play Store', 'not listed'],
            ['What it cost to get them', 'not known'],
            ['Payouts', 'locked'],
            ['First bill', (d.costs && d.costs.first_gate && d.costs.first_gate.mau_display)
              ? ('around ' + Number(d.costs.first_gate.mau_display).toLocaleString('en-GB') + ' people active in a month')
              : 'still free']])
          + gap('These are registered accounts, not store downloads. Cost-to-serve is on Money. We do not guess what it costs to acquire a person, or what they are worth over a lifetime.'))
        + card('The public website',
          kpis([['On the site now', (d.site && d.site.live) || 0],
            ['Visits today', (d.site && d.site.today) || 0],
            ['Unique today', (d.site && d.site.uniques_today) || 0],
            ['Opened Naluno today', (d.site && d.site.app_opens_today) || 0],
            ['Avg time today', dur((d.site && d.site.avg_ms) || 0)],
            ['Countries today', ((d.site && d.site.countries) || []).length]])
          + '<div class="row"><button type="button" class="ghost ccGo" data-go="visitors">Open Visitors</button></div>')
        + card('What are people making?',
          kpis([['Broadcasts', c.broadcasts_total || 0], ['Live now', c.broadcasts_live || 0],
            ['Today', c.broadcasts_today || 0], ['Creators', cr.total || 0]])
          + kpis([['Signals', s.total || 0], ['Active Signals', s.active || 0],
            ['Views', c.views || 0], ['Comments', c.comments || 0]]))
        + card('Where are the devices?',
          kpis([['People with a pin', (d.locations && d.locations.with_coords) || 0],
            ['Find pings', (d.locations && d.locations.devices) || 0]])
          + gap('Pins come from Find Naluno on that phone. The last place is stored on the account so a missing device can be opened on a map from Users.'))
        + card('Can we trust the activity?',
          kpis([['Open reports', sf.open_reports || 0], ['Suspended', sf.suspended || 0],
            ['Restricted', sf.restricted || 0], ['Held for review', sf.pending_review || 0]]))
        + termsBlock();
      goButtons();
      return;
    }

    if (tab === 'health') {
      const services = [
        ['Sign-in', true],
        ['Database', !!adminDb()],
        ['Broadcast', !!d.flags.broadcast_enabled],
        ['Signals', d.flags.signals_enabled !== false],
        ['Notifications', true],
        ['Payments', !!d.flags.real_payouts_enabled],
        ['Background jobs', !!w.ok],
        ['Offline helper', !!__swInfo.connected],
        ['Content Hub', !!d.flags.content_hub_enabled],
      ];
      el.innerHTML =
        card('Is Naluno working?',
          kpis([['App version', liveAppLabel()], ['Background jobs', w.ok ? (w.ms + ' ms') : 'down'],
            ['Offline helper', __swInfo.connected ? 'connected' : 'off'],
            ['Client errors (sample)', (d.metrics && d.metrics.failures) || 0]]))
        + card('Live status', services.map(function (row) {
          const on = row[1];
          return '<div class="flag-row"><span style="flex:1;">' + escapeHtml(row[0]) + '</span>'
            + '<span style="color:' + (on ? 'var(--mint)' : 'var(--ink-dim)') + ';">' + (on ? 'ON' : 'OFF') + '</span></div>';
        }).join(''))
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
      function isInvestMail(m) {
        const k = String(m.kind || '').toLowerCase();
        return k === 'invest' || k === 'investment' || k === 'partnership' || !!m.interest;
      }
      function interestLabel(v) {
        const x = String(v || '').toLowerCase();
        if (x === 'partnership') return 'Strategic partnership';
        if (x === 'mentorship') return 'Mentorship / advisory';
        if (x === 'other') return 'Other';
        if (x === 'investment') return 'Investment';
        return v || '';
      }
      const filtered = mail.filter(function (m) {
        const st = String(m.status || 'new').toLowerCase();
        if (q === 'new') return st === 'new';
        if (q === 'delete') return String(m.kind || '') === 'delete-account' || String(m.kind || '') === 'violation-close';
        if (q === 'invest') return isInvestMail(m);
        if (q === 'compass') return String(m.source || '') === 'compass';
        if (q === 'web') return String(m.source || '') === 'web';
        if (q === 'done') return st === 'done';
        return true;
      });
      el.innerHTML =
        kpis([['New', (d.mail && d.mail.unread) || 0], ['Invest / partners', (d.mail && d.mail.invest) || 0],
          ['Delete asks', (d.mail && d.mail.deletes) || 0],
          ['Compass', (d.mail && d.mail.compass) || 0], ['Website', (d.mail && d.mail.web) || 0]])
        + '<div class="row" style="margin-bottom:12px;">'
        + ['new', 'all', 'invest', 'delete', 'compass', 'web', 'done'].map(function (k) {
          const on = q === k ? ' primary' : ' ghost';
          const label = k === 'new' ? 'New' : k === 'invest' ? 'Invest' : k === 'delete' ? 'Delete' : k === 'compass' ? 'Compass' : k === 'web' ? 'Website' : k === 'done' ? 'Done' : 'All';
          return '<button type="button" class="' + on.trim() + ' mailFilter" data-q="' + k + '">' + label + '</button>';
        }).join('')
        + '</div>'
        + card('Inbox', filtered.length
          ? filtered.map(function (m) {
            const st = String(m.status || 'new').toLowerCase();
            const kind = String(m.kind || 'contact');
            const invest = isInvestMail(m);
            const who = [m.name, m.organisation, m.handle ? '@' + m.handle : '', m.email, m.phone].filter(Boolean).join(' · ') || (m.uid || 'visitor');
            const meta = [m.country, interestLabel(m.interest)].filter(Boolean).join(' · ');
            const reply = m.email
              ? '<a class="ghost" href="mailto:' + encodeURIComponent(m.email) + '">Reply</a> '
              : '';
            const tel = (m.phone && String(m.phone).replace(/[^\d+]/g, ''))
              ? '<a class="ghost" href="tel:' + encodeURIComponent(String(m.phone).replace(/[^\d+]/g, '')) + '">Call / WhatsApp</a> '
              : '';
            return '<div class="alert ' + (kind === 'delete-account' ? 'critical' : (invest ? 'ok' : (st === 'new' ? 'warning' : 'ok'))) + '">'
              + '<div class="sub">' + escapeHtml(when(m.ts)) + ' · ' + escapeHtml(m.source || '') + ' · ' + escapeHtml(kind) + (meta ? ' · ' + escapeHtml(meta) : '') + ' · ' + escapeHtml(st) + '</div>'
              + '<div style="margin:6px 0 8px;"><b>' + escapeHtml(who) + '</b>'
              + (m.uid ? ' <span class="sub">' + escapeHtml(String(m.uid).slice(0, 12)) + '</span>' : '')
              + '</div>'
              + '<div style="white-space:pre-wrap;font-size:14px;line-height:1.45;">' + escapeHtml(m.text || '') + '</div>'
              + '<div class="row" style="margin-top:10px;">'
              + reply + tel
              + (st !== 'read' && st !== 'done' ? '<button type="button" class="ghost admMail" data-id="' + escapeHtml(m.id) + '" data-st="read">Mark read</button> ' : '')
              + (st !== 'done' ? '<button type="button" class="ghost admMail" data-id="' + escapeHtml(m.id) + '" data-st="done">Done</button>' : '')
              + '</div></div>';
          }).join('')
          : '<p class="sub">Nothing in this filter. Website contact, the invest page, and Compass requests land here. Compass notebooks are not copied — only what someone sent as a request.</p>');
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
        if (m === 'cpc') return 'Per tap';
        if (m === 'cpv') return 'Per completed watch';
        return 'Per thousand views';
      }
      const unitById = {};
      (rev.units || []).forEach(function (u) { if (u && u.id) unitById[u.id] = u; });
      const editingId = __tabCache.adsEditId || '';
      const viewingId = __tabCache.adsViewId || '';
      const editing = editingId ? (ads.filter(function (a) { return a && a.id === editingId; })[0] || null) : null;
      const viewing = viewingId ? (ads.filter(function (a) { return a && a.id === viewingId; })[0] || null) : null;
      const f = editing || {};
      function selected(cur, want) { return String(cur) === String(want) ? ' selected' : ''; }
      function placeOf(a) {
        const p = (a && Array.isArray(a.placements) && a.placements.length)
          ? a.placements.map(String)
          : [String((a && a.placement) || 'both')];
        const feed = p.indexOf('in-feed') >= 0 || p.indexOf('watch-break') >= 0;
        const br = p.indexOf('broadcast-break') >= 0;
        if (p.indexOf('both') >= 0 || (feed && br)) return 'both';
        if (br) return 'broadcast-break';
        if (feed) return 'in-feed';
        return 'both';
      }
      const placeNow = placeOf(f);
      const billNow = String(f.billModel || 'cpm').toLowerCase();
      function fromAedNum(n) {
        const C = Ccy();
        if (C && C.convert) return C.convert(Number(n) || 0, 'AED', opCode());
        return Number(n) || 0;
      }
      function paidBoxVal(aedVal) {
        const n = fromAedNum(aedVal);
        if (!n) return '';
        return String(Math.round(n * 10000) / 10000);
      }
      function adContactHtml(a) {
        const bits = [];
        const handle = String((a && a.advertiserHandle) || '').replace(/^@/, '').trim();
        const email = String((a && a.advertiserEmail) || '').trim();
        const phone = String((a && a.advertiserPhone) || '').trim();
        const extra = String((a && a.advertiserContact) || '').trim();
        if (handle) bits.push('@' + escapeHtml(handle));
        if (email) {
          const safe = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email);
          bits.push(safe
            ? ('<a href="mailto:' + escapeHtml(email) + '">' + escapeHtml(email) + '</a>')
            : escapeHtml(email));
        }
        if (phone) {
          const tel = phone.replace(/[^\d+]/g, '');
          bits.push(tel
            ? ('<a href="tel:' + escapeHtml(tel) + '">' + escapeHtml(phone) + '</a>')
            : escapeHtml(phone));
        }
        if (extra) bits.push(escapeHtml(extra));
        return bits.length ? bits.join(' · ') : 'No contact on file';
      }
      el.innerHTML =
        card('Journal',
          '<p class="sub">House totals across every unit. Open Analytics on a unit for that advertiser’s own book.</p>'
          + ((Number(rates.ecpmAed) || 0) === 0 && (Number(rates.cpcAed) || 0) === 0 && (Number(rates.cpvAed) || 0) === 0
            ? '<p class="sub" style="color:#ffc266;">The rate card is zero, so Used stays zero no matter how many views there are. Type a rate above and save it. A zero stored on one unit does not override a saved card.</p>'
            : '<p class="sub">Used = events × the rate card for the model on that unit. CPM is views ÷ 1,000 × the rate. CPC is taps × the rate. CPV is completed watches × the rate.</p>')
          + kpis([['Live', (d.ads && d.ads.live) || 0], ['Paused', (d.ads && d.ads.paused) || 0],
            ['Views', (d.ads && d.ads.impressions) || 0], ['Taps', (d.ads && d.ads.clicks) || 0],
            ['Completed watches', (d.ads && d.ads.viewCompletes) || 0], ['Booked', aedUsd(rev.bookedAed || 0)]])
          + kpis([['Prepaid', aedUsd(rev.paidAed || 0)], ['Used', aedUsd(rev.bookedAed || 0)],
            ['Left', aedUsd(rev.remainingAed || 0)], ['Used up', rev.spentCount || 0],
            ['Skips', (d.ads && d.ads.skips) || 0], ['Tap-through', pct1(ctr)]])
          + kpis([['View rate', pct1(viewRate)], ['Per thousand views', aedUsd(rev.rpmAed || 0)],
            ['Per person active today', aedUsd(rev.arpdauAed || 0)], ['Per registered account', aedUsd(rev.arpuAed || 0)]])
          + kpis([['Per thousand views (check)', aedUsd(rev.cpmAed || 0)],
            ['Per tap (check)', aedUsd(rev.cpcAed || 0)],
            ['Per completed watch (check)', aedUsd(rev.cpvAed || 0)],
            ['Booked (chosen models)', aedUsd(rev.bookedAed || 0)]]))
        + card('Rate card',
          '<label for="adRateEcpm">Per thousand views — ' + escapeHtml(opCode()) + ' per 1,000 views</label>'
          + '<input id="adRateEcpm" inputmode="decimal" value="' + escapeHtml(String(rates.ecpmAed != null ? (Ccy() && Ccy().convert ? Ccy().convert(rates.ecpmAed, 'AED', opCode()) : rates.ecpmAed) : 0)) + '" />'
          + '<label for="adRateCpc">Per tap — ' + escapeHtml(opCode()) + ' each</label>'
          + '<input id="adRateCpc" inputmode="decimal" value="' + escapeHtml(String(rates.cpcAed != null ? (Ccy() && Ccy().convert ? Ccy().convert(rates.cpcAed, 'AED', opCode()) : rates.cpcAed) : 0)) + '" />'
          + '<label for="adRateCpv">Per completed watch — ' + escapeHtml(opCode()) + ' each</label>'
          + '<input id="adRateCpv" inputmode="decimal" value="' + escapeHtml(String(rates.cpvAed != null ? (Ccy() && Ccy().convert ? Ccy().convert(rates.cpvAed, 'AED', opCode()) : rates.cpvAed) : 0)) + '" />'
          + '<label for="adRateViewSec">Completed watch after (seconds of the ad playing)</label>'
          + '<input id="adRateViewSec" type="number" min="1" max="60" value="' + escapeHtml(String(rates.viewCompleteSec != null ? rates.viewCompleteSec : 15)) + '" />'
          + '<div class="row"><button type="button" class="primary" id="adSaveRates">Save rate card</button></div>')
        + card('How often',
          '<label for="adEveryMin">Show a break after every (minutes of watching)</label>'
          + '<input id="adEveryMin" type="number" min="1" max="30" value="' + escapeHtml(String((d.flags && d.flags.adEveryMin) != null ? d.flags.adEveryMin : 1)) + '" />'
          + '<div class="row"><button type="button" class="ghost" id="adSavePace">Save pacing</button></div>')
        + card(editing ? ('Edit · ' + (f.headline || f.advertiser || editingId)) : 'New unit',
          (editing ? '<p class="sub">Counters stay on this unit. Leave the file empty to keep the current creative.</p>' : '')
          + '<label for="adFile">' + (editing ? 'Replace creative (optional)' : 'Creative — 9:16 video or image, about 6–30 seconds') + '</label>'
          + '<input id="adFile" type="file" accept="video/*,image/*" />'
          + '<label for="adHeadline">Headline</label>'
          + '<input id="adHeadline" maxlength="80" placeholder="What the unit is about" value="' + escapeHtml(f.headline || '') + '" />'
          + '<label for="adAdvertiser">Advertiser</label>'
          + '<input id="adAdvertiser" maxlength="60" placeholder="Brand or person shown on the unit" value="' + escapeHtml(f.advertiser || '') + '" />'
          + '<label for="adAdvHandle">Advertiser Callsign</label>'
          + '<input id="adAdvHandle" maxlength="40" placeholder="@handle" value="' + escapeHtml(f.advertiserHandle || '') + '" />'
          + '<label for="adAdvEmail">Advertiser email</label>'
          + '<input id="adAdvEmail" type="email" maxlength="120" placeholder="name@brand.com" autocomplete="off" value="' + escapeHtml(f.advertiserEmail || '') + '" />'
          + '<label for="adAdvPhone">Advertiser phone</label>'
          + '<input id="adAdvPhone" type="tel" maxlength="32" placeholder="+256…" value="' + escapeHtml(f.advertiserPhone || '') + '" />'
          + '<label for="adPaid">Money paid by the advertiser — ' + escapeHtml(opCode()) + '</label>'
          + '<input id="adPaid" inputmode="decimal" placeholder="0" value="' + escapeHtml(paidBoxVal(Number(f.paidAed) || 0)) + '" />'
          + '<label for="adCtaLabel">Call to action (CTA)</label>'
          + '<input id="adCtaLabel" maxlength="24" placeholder="Open" value="' + escapeHtml(f.ctaLabel || 'Open') + '" />'
          + '<label for="adCtaUrl">Call to action address (https only)</label>'
          + '<input id="adCtaUrl" type="url" placeholder="https://" value="' + escapeHtml(f.ctaUrl || '') + '" />'
          + '<label for="adPlace">Placement</label>'
          + '<select id="adPlace">'
          + '<option value="both"' + selected(placeNow, 'both') + '>Watch-time break and Broadcast chapter break</option>'
          + '<option value="in-feed"' + selected(placeNow, 'in-feed') + '>Watch-time break only</option>'
          + '<option value="broadcast-break"' + selected(placeNow, 'broadcast-break') + '>Broadcast chapter break only</option>'
          + '</select>'
          + '<label for="adBill">Billing model</label>'
          + '<select id="adBill">'
          + '<option value="cpm"' + selected(billNow, 'cpm') + '>CPM (cost per mille) — impressions</option>'
          + '<option value="cpc"' + selected(billNow, 'cpc') + '>CPC (cost per click) — taps</option>'
          + '<option value="cpv"' + selected(billNow, 'cpv') + '>CPV (cost per view) — completed views</option>'
          + '</select>'
          + '<label for="adSkip">Skip after (seconds)</label>'
          + '<input id="adSkip" type="number" min="0" max="15" value="' + escapeHtml(String(f.skipAfterSec != null ? f.skipAfterSec : 5)) + '" />'
          + '<div class="row">'
          + (editing
            ? ('<button type="button" class="primary" id="adSaveLive">Save and publish again</button>'
              + '<button type="button" class="ghost" id="adSavePaused">Save paused</button>'
              + '<button type="button" class="ghost" id="adEditCancel">Cancel</button>')
            : ('<button type="button" class="primary" id="adSaveLive">Upload and go live</button>'
              + '<button type="button" class="ghost" id="adSavePaused">Upload paused</button>'))
          + '</div>'
          + '<div class="msg" id="adMsg"></div>')
        + (viewing ? (function () {
          const a = viewing;
          const u = unitById[a.id] || (Data && Data.adUnitStats ? Data.adUnitStats(a, rates) : {});
          const impr = Number(u.impressions != null ? u.impressions : a.impressions) || 0;
          const taps = Number(u.clicks != null ? u.clicks : a.clicks) || 0;
          const skipsN = Number(u.skips != null ? u.skips : a.skips) || 0;
          const watches = Number(u.viewCompletes != null ? u.viewCompletes : a.viewCompletes) || 0;
          const paidAed = Number(u.paidAed != null ? u.paidAed : a.paidAed) || 0;
          const usedAed = Number(u.bookedAed) || 0;
          const leftAed = paidAed > 0 ? Math.max(0, paidAed - usedAed) : 0;
          const model = u.billModel || a.billModel || 'cpm';
          const thumb = a.thumbUrl || (String(a.mediaType || '').indexOf('image') === 0 ? a.mediaUrl : '');
          const media = thumb
            ? '<img class="ad-preview" src="' + escapeHtml(thumb) + '" alt="" />'
            : (a.mediaUrl
              ? '<video class="ad-preview" src="' + escapeHtml(a.mediaUrl) + '" muted playsinline></video>'
              : '');
          return card('This ad',
            '<p class="sub">Independent of every other unit. The journal above is the house total.</p>'
            + '<div class="ad-row">' + media + '<div class="ad-body">'
            + '<div style="margin:0 0 6px;"><b>' + escapeHtml(a.headline || a.advertiser || a.id) + '</b></div>'
            + '<div class="sub">' + escapeHtml(a.advertiser || '') + '</div>'
            + '<div class="sub" style="margin-top:4px;">' + adContactHtml(a) + '</div>'
            + '<div class="sub" style="margin-top:4px;">' + escapeHtml(billLabel(model)) + (a.ctaUrl ? ' · ' + escapeHtml(a.ctaUrl) : '') + '</div>'
            + '</div></div>'
            + kpis([['Views', impr], ['Taps', taps], ['Skips', skipsN], ['Completed watches', watches],
              ['Tap-through', pct1(u.ctr)], ['View rate', pct1(u.viewRate)]])
            + kpis([['Prepaid', aedUsd(paidAed)], ['Used', aedUsd(usedAed)], ['Left', aedUsd(leftAed)],
              ['Booked', aedUsd(u.bookedAed || 0)], ['Skip rate', pct1(u.skipRate)]])
            + kpis([['Per thousand views (check)', aedUsd(u.cpmAed || 0)], ['Per tap (check)', aedUsd(u.cpcAed || 0)],
              ['Per completed watch (check)', aedUsd(u.cpvAed || 0)]])
            + '<div class="sub" style="margin-top:8px;">Created ' + escapeHtml(when(a.createdAt)) + ' · Updated ' + escapeHtml(when(a.updatedAt)) + '</div>'
            + '<div class="row" style="margin-top:12px;">'
            + '<button type="button" class="primary admAdEdit" data-id="' + escapeHtml(a.id) + '">Edit</button>'
            + '<button type="button" class="ghost" id="adViewBack">Back to inventory</button>'
            + '</div>');
        })() : '')
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
            const u = unitById[a.id] || {};
            const impr = Number(u.impressions != null ? u.impressions : a.impressions) || 0;
            const clicks = Number(u.clicks != null ? u.clicks : a.clicks) || 0;
            const views = Number(u.viewCompletes != null ? u.viewCompletes : a.viewCompletes) || 0;
            const rate = pct1(u.ctr != null ? u.ctr : (impr ? (clicks / impr) * 100 : 0));
            const model = u.billModel || a.billModel || 'cpm';
            const paidAed = Number(u.paidAed != null ? u.paidAed : a.paidAed) || 0;
            const usedAed = Number(u.bookedAed) || 0;
            const leftAed = paidAed > 0 ? Math.max(0, paidAed - usedAed) : null;
            const spent = !!(u.spent || a.spent || (paidAed > 0 && usedAed >= paidAed));
            const rateBit = model === 'cpc'
              ? ('tap rate ' + aedUsd(u.cpcRateAed || 0))
              : (model === 'cpv'
                ? ('watch rate ' + aedUsd(u.cpvRateAed || 0))
                : ('per thousand ' + aedUsd(u.ecpmAed || 0)));
            const unpaid = String(a.paymentStatus || '') === 'unpaid';
            const reviewHold = st !== 'live' && (String(a.review || '') === 'pending' || String(a.source || '') === 'broadcast');
            const moneyLine = paidAed > 0
              ? ('Paid ' + aedUsd(paidAed) + ' · Used ' + aedUsd(usedAed) + ' · Left ' + aedUsd(leftAed || 0) + ' · ' + rateBit)
              : ('No prepaid typed · Used ' + aedUsd(usedAed) + ' · ' + rateBit);
            const payNote = unpaid ? '<div class="sub" style="color:#ffc266;margin-top:4px;">Waiting for payment — provider not connected. Paused until you go live.</div>' : '';
            const reviewNote = reviewHold ? '<div class="sub" style="color:#ffc266;margin-top:4px;">Held for review — paused until you press Go live.</div>' : '';
            const spentNote = spent ? '<div class="sub" style="color:#ffc266;margin-top:4px;">Used up — paused. Type more paid to go live again.</div>' : '';
            const onThis = viewingId === a.id;
            return '<div class="alert ' + (st === 'live' && !spent ? 'ok' : 'warning') + ' ad-row"' + (onThis ? ' style="border-color:rgba(124,255,178,.55);"' : '') + '>'
              + media
              + '<div class="ad-body">'
              + '<div class="sub">' + escapeHtml(spent ? 'used up' : st) + ' · ' + escapeHtml(places) + ' · skip ' + escapeHtml(String(a.skipAfterSec != null ? a.skipAfterSec : 5)) + 's · ' + escapeHtml(billLabel(model)) + '</div>'
              + '<div style="margin:4px 0;"><b>' + escapeHtml(a.headline || a.advertiser || a.id) + '</b></div>'
              + '<div class="sub">' + escapeHtml(a.advertiser || '') + (a.ctaUrl ? ' · ' + escapeHtml(a.ctaUrl) : '') + '</div>'
              + '<div class="sub" style="margin-top:4px;">' + adContactHtml(a) + '</div>'
              + '<div class="sub" style="margin-top:6px;">Views ' + impr + ' · Taps ' + clicks + ' · Skips ' + (Number(u.skips != null ? u.skips : a.skips) || 0) + ' · Completed watches ' + views + ' · Tap-through ' + rate + '</div>'
              + '<div class="sub" style="margin-top:4px;">' + moneyLine + '</div>'
              + payNote
              + reviewNote
              + spentNote
              + '<div class="row" style="margin-top:10px;align-items:center;gap:8px;flex-wrap:wrap;">'
              + '<label class="sub" for="adPaid-' + escapeHtml(a.id) + '" style="margin:0;">Paid</label>'
              + '<input class="adPaidEdit" id="adPaid-' + escapeHtml(a.id) + '" data-id="' + escapeHtml(a.id) + '" inputmode="decimal" value="' + escapeHtml(paidBoxVal(paidAed)) + '" style="width:120px;" />'
              + '<button type="button" class="ghost admAdPaid" data-id="' + escapeHtml(a.id) + '">Save paid</button>'
              + '</div>'
              + '<div class="row" style="margin-top:10px;">'
              + '<button type="button" class="ghost admAdEdit" data-id="' + escapeHtml(a.id) + '">Edit</button>'
              + '<button type="button" class="ghost admAdView" data-id="' + escapeHtml(a.id) + '">Analytics</button>'
              + (st === 'live'
                ? '<button type="button" class="ghost admAd" data-id="' + escapeHtml(a.id) + '" data-act="pause">Pause</button>'
                : (spent
                  ? '<button type="button" class="ghost" disabled>Used up</button>'
                  : '<button type="button" class="primary admAd" data-id="' + escapeHtml(a.id) + '" data-act="live">Go live</button>'))
              + '<button type="button" class="danger admAd" data-id="' + escapeHtml(a.id) + '" data-act="delete">Remove</button>'
              + '</div></div></div>';
          }).join('')
          : '<p class="sub">No units in this filter. Upload a 9:16 creative above.</p>');
      el.querySelectorAll('.adsFilter').forEach(function (btn) {
        btn.onclick = function () {
          __tabCache.adsQ = btn.getAttribute('data-q') || 'all';
          loadTab('ads', false);
        };
      });
      el.querySelectorAll('.admAd').forEach(function (btn) {
        btn.onclick = function () { actAd(btn.getAttribute('data-id'), btn.getAttribute('data-act')); };
      });
      el.querySelectorAll('.admAdPaid').forEach(function (btn) {
        btn.onclick = function () { saveAdPaid(btn.getAttribute('data-id')); };
      });
      el.querySelectorAll('.admAdEdit').forEach(function (btn) {
        btn.onclick = function () {
          __tabCache.adsEditId = btn.getAttribute('data-id') || '';
          __tabCache.adsViewId = '';
          loadTab('ads', false);
          setTimeout(function () { try { const n = $('adHeadline'); if (n) n.focus(); } catch (_) {} }, 40);
        };
      });
      el.querySelectorAll('.admAdView').forEach(function (btn) {
        btn.onclick = function () {
          __tabCache.adsViewId = btn.getAttribute('data-id') || '';
          loadTab('ads', false);
        };
      });
      if ($('adViewBack')) $('adViewBack').onclick = function () {
        __tabCache.adsViewId = '';
        loadTab('ads', false);
      };
      if ($('adEditCancel')) $('adEditCancel').onclick = function () {
        __tabCache.adsEditId = '';
        loadTab('ads', false);
      };
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
      const all = c.broadcasts || c.recent || [];
      const nowMs = Date.now();
      function bState(b) {
        if (!b) return '';
        if (b.hidden) return 'Taken down';
        if (b.held) return 'Held';
        if (b.live) return 'Live';
        if (b.visibility === 'private') return 'Private';
        if (Number(b.publishAt) > nowMs) return 'Scheduled';
        return 'Public';
      }
      const waiting = all.filter(function (b) {
        return b && (b.visibility === 'private' || Number(b.publishAt) > nowMs);
      });
      el.innerHTML =
        kpis([['Broadcasts', c.broadcasts_total || 0], ['Live', c.broadcasts_live || 0],
          ['Scheduled / private', waiting.length], ['Today', c.broadcasts_today || 0], ['Deleted', c.broadcasts_deleted || 0],
          ['Views', c.views || 0], ['Creators', cr.total || 0]])
        + card('Not on the public feed yet', waiting.length
          ? plainRows(['Title', 'Creator', 'State', 'Goes out'], waiting.slice(0, 30).map(function (b) {
            const at = Number(b.publishAt);
            return [b.title || '(untitled)', b.creatorName || String(b.creatorUid || '').slice(0, 10),
              bState(b), at > nowMs ? when(at) : '—'];
          }))
          : '<p class="sub">Nothing scheduled or private.</p>')
        + card('Creators by views', plainRows(['Creator', 'Broadcasts', 'Views', 'Live'],
          (cr.top || []).map(function (x) { return [x.name || x.uid.slice(0, 10), x.broadcasts, x.views, x.live]; })))
        + card('Recent', plainRows(['Title', 'Creator', 'State', 'Views', 'When'],
          (c.recent || []).slice(0, 30).map(function (b) {
            return [b.title || '(untitled)', b.creatorName || String(b.creatorUid || '').slice(0, 10),
              bState(b), b.views || 0, when(b.createdAt)];
          })));
      return;
    }

    if (tab === 'signals') {
      const list = s.list || [];
      el.innerHTML =
        kpis([['Signals', s.total || 0], ['Still active', s.active || 0],
          ['Expired', s.expired || 0], ['Today', s.today || 0]])
        + gap('Signals are the short clips on each account. Who watched, and the reaction on a clip, stay on that Signal — Seen by — and are not copied into a public counter. The desk does not open Wireline or Band.')
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
          : '')
        + card('Repair contribution totals',
            '<p class="sub">Totals were once written from the worker\u2019s memory, which could overwrite a real lifetime score with a much smaller number. That is fixed, but it cannot undo what was already written. The ledger rows survived, so totals can be rebuilt by adding them up.</p>'
          + '<div class="row"><button type="button" class="ghost" id="admRepairDry">Check what would change</button>'
          + '<button type="button" class="danger" id="admRepairApply">Apply the repair</button></div>'
          + '<div id="admRepairOut" class="sub"></div>');
      wireRepairButtons();
      return;
    }

    if (tab === 'safety') {
      el.innerHTML = '<p class="sub">Loading the safety queue…</p>';
      loadSafetyCentre(el);
      return;
    }

    if (tab === 'trust') {
      const held = (c.held || []).slice(0, 40);
      const hidden = (c.hidden || []).slice(0, 40);
      el.innerHTML =
        moderationRulebookHtml()
        + kpis([['Open reports', sf.open_reports || 0], ['Waiting to go out', held.length || c.broadcasts_held || 0],
          ['Taken down', hidden.length || c.broadcasts_hidden || 0],
          ['Suspended', sf.suspended || 0], ['Restricted', sf.restricted || 0]])
        + card('Open reports', (sf.open || []).length
          ? '<p class="sub">Watch it here \u2014 no need to open the app. Urgent reports (sexual, terrorism and the rest) are already off the feed; these buttons decide what happens next.</p>'
            + '<div class="review-list">' + (sf.open || []).map(reportReviewCard).join('') + '</div>'
          : '<p class="sub">No open reports.</p>')
        + card('Waiting to go out', held.length
          ? '<p class="sub">Watch here, then Let out or Take down. It stays on their list until you decide.</p>'
            + '<div class="review-list">' + held.map(function (b) { return trustReviewCard(b, 'held'); }).join('') + '</div>'
          : '<p class="sub">No Broadcasts waiting. Unsure Screen reads wait here. A new Callsign without a clear read still waits.</p>')
        + card('Taken down', hidden.length
          ? '<p class="sub">Already decided. Restore only if that was a mistake.</p>'
            + '<div class="review-list">' + hidden.map(function (b) { return trustReviewCard(b, 'hidden'); }).join('') + '</div>'
          : '<p class="sub">Nothing taken down.</p>')
        + card('Suspended', plainRows(['Person', 'Reason'],
          (u.suspended || []).map(function (row) {
            return [userName(row), row.suspendedReason || row.suspended_reason || '—'];
          })));
      el.querySelectorAll('.admRpt').forEach(function (btn) {
        btn.onclick = function () { actReport(btn.getAttribute('data-id'), btn.getAttribute('data-d')); };
      });
      el.querySelectorAll('.admBmod').forEach(function (btn) {
        btn.onclick = function () {
          modBroadcast(btn.getAttribute('data-id'), btn.getAttribute('data-a'), btn.getAttribute('data-uid') || '');
        };
      });
      wireTrustMedia(el);
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
          '<p class="sub">Booked ad revenue is rate-card maths × observed events. Cash has not moved until an advertiser pays. There is no outside auction.</p>'
          + kpis([['Booked ads', aedUsd(adRev.bookedAed || 0)],
            ['Per thousand views', aedUsd(adRev.rpmAed || 0)],
            ['Per person active today', aedUsd(adRev.arpdauAed || 0)],
            ['Per registered account', aedUsd(adRev.arpuAed || 0)]])
          + kpis([['Views', adRev.impressions || 0],
            ['Taps', adRev.clicks || 0],
            ['Completed watches', adRev.viewCompletes || 0],
            ['After free-tier cost', aedUsd(costs.billable_aed || 0)]])
          + gap((g.ad_revenue || 'Booked ad revenue is rate-card maths × observed events. Cash has not moved.')
            + ' Booked minus cost is not profit. Cost is list-price maths until an invoice is recorded.')
          + '<div class="row"><button type="button" class="ghost ccGo" data-go="ads">Open Ads</button></div>')
        + card('What does each person cost Naluno?',
          '<p class="sub">' + escapeHtml((costs.headline) || 'List prices × usage on this console.') + '</p>'
          + kpis([['Invoiced (recorded)', aedUsd(costs.invoice_aed || 0)],
            ['List-price usage', aedUsd(costs.metered_aed || 0)],
            ['After free tier', aedUsd(costs.billable_aed || 0)],
            ['Serving with', costs.invoice_aed ? 'invoice' : (costs.on_free_tier ? 'free hosting plan' : 'paid hosting plan')]])
          + kpis([['Per registered account', aedUsd(costs.per_registered_aed || 0)],
            ['Per person active this month', aedUsd(costs.per_mau_aed || 0)],
            ['Per person active today', aedUsd(costs.per_dau_aed || 0)],
            ['Files stored', (costs.storage && costs.storage.r2_gb != null) ? Number(costs.storage.r2_gb).toFixed(3) + ' GB' : '—']])
          + gap(g.unit_econ || ''))
        + card('Free-tier limits',
          (costs.gates && costs.gates.length
            ? plainRows(['Cap', 'Free allowance', 'Around people in a month', 'Status'],
              costs.gates.map(function (gate) {
                const mau = gate.mau_display == null ? 'needs usage' : ('~' + Number(gate.mau_display).toLocaleString('en-GB'));
                return [gate.label, gate.free, mau, gate.already ? 'past free' : 'still free'];
              }))
            : '<p class="sub">Free-tier limits appear once usage is on file.</p>')
          + gap('Database reads usually go first. Model: 150 reads per person active this month, per day. The free hosting plan allows 50,000 reads per day, about 330 people active in a month. File downloads are not billed. Push notifications are not billed.'))
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
            ? plainRows(['Person', 'Active this month', 'Media', 'Uploads', 'Variable', 'Share', 'This month'],
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
          plainRows(['People in a month', 'List-price / month', 'After free tier', 'Per person'],
            scale.map(function (row) {
              return [row.n.toLocaleString('en-GB'), aedUsd(row.gross_aed), aedUsd(row.billable_aed), aedUsd(row.per_mau_aed)];
            }))
          + gap('This is a mix projection, not a forecast. With no usage on file, only the recorded fixed bill remains.'))
        + card('Runway',
          '<label>Cash on hand (' + escapeHtml(moneyLabel()) + ')</label><input id="runCash" inputmode="decimal" placeholder="e.g. 80000" />'
          + '<label>Monthly burn (' + escapeHtml(opCode()) + ')</label><input id="runBurn" inputmode="decimal" placeholder="e.g. 12000" />'
          + '<div class="row"><button type="button" class="primary" id="runBtn">Estimate runway</button></div>'
          + '<div id="runOut" class="sub"></div>');
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
      el.innerHTML = '';
      return;
    }

    if (tab === 'visitors' || tab === 'reach' || tab === 'quality' || tab === 'analytics') {
      const site = d.site || {};
      const recent = site.recent || [];
      const fiveYes = (site.five_marked || 0) > 0 || (site.engaged_today || 0) > 0;
      const fiveLabel = !site.today ? '—' : (fiveYes ? 'Yes' : 'No');
      const botsIn = (site.bots_today || 0) > 0 || (site.bots || 0) > 0 ? 'No' : 'No';
      const selfIn = 'No';
      const recentTable = table(['When', 'Landed', 'From', 'Device', 'Pages', 'Time', 'App'],
        recent.slice(0, 40).map(function (s) {
          const device = [s.device, s.os].filter(Boolean).join(' · ');
          const land = (Data && Data.pageLabel) ? Data.pageLabel(s.land || s.path || '/') : (s.land || s.path || '/');
          const from = s.source || ((Data && Data.classifySiteSource) ? Data.classifySiteSource(s.ref, s.utm, s.ua) : (s.ref || 'Direct'));
          const trail = s.trail || s.path || '/';
          return [
            escapeHtml(when(s.lastAt || s.startedAt)),
            escapeHtml(land),
            escapeHtml(from),
            escapeHtml(device || '—'),
            escapeHtml(trail),
            escapeHtml(dur(s.ms || 0)),
            (Number(s.openApp) > 0 || s.kind === 'app') ? 'yes' : '',
          ];
        }));
      if (tab === 'visitors') {
        el.innerHTML =
          card('Which page did they land on?',
            kpis([['Visits today', site.today || 0], ['On the site now', site.live || 0], ['Unique today', site.uniques_today || 0]])
            + bars(site.land || site.paths, 12))
          + card('Where did they come from?',
            bars(site.sources, 12)
            + (site.utm && site.utm.length ? bars(site.utm, 8) : ''))
          + card('What device are they using?',
            bars(site.devices, 8) + bars(site.os, 8) + bars(site.browsers, 8))
          + card('What pages before leaving?',
            bars(site.journeys, 12) + bars(site.exit, 8))
          + card('Latest visits', recentTable);
        return;
      }
      if (tab === 'reach') {
        el.innerHTML =
          card('Clicked the Naluno / app link',
            kpis([['Taps on the app link', site.open_clicks_today || 0],
              ['Visits that opened it', site.open_sessions_today || 0],
              ['Visit → open', (site.convert_pct || 0) + '%'],
              ['App loads today', site.app_opens_today || 0]]))
          + card('Reached investment / partnership',
            kpis([['Reached the section', site.invest_today || 0],
              ['Invest taps', site.invest_clicks_today || 0]]))
          + card('Submitted a contact / investor enquiry',
            kpis([['Enquiries sent', site.contact_today || 0]]));
        return;
      }
      if (tab === 'quality') {
        el.innerHTML =
          card('Is the 5-second measurement working?',
            kpis([['Working', fiveLabel],
              ['Stayed 5s+', site.engaged_today || 0],
              ['Left before 5s', site.bounce_n || 0],
              ['Bounce', (site.bounce || 0) + '%']]))
          + card('Are bots and crawlers included?',
            kpis([['Included', botsIn],
              ['Excluded today', site.bots_today || 0],
              ['Excluded (on file)', site.bots || 0]]))
          + card('Are your own visits counted?',
            kpis([['Included', selfIn],
              ['Excluded today', site.self_today || 0],
              ['Excluded (on file)', site.self || 0]]));
        return;
      }
      el.innerHTML =
        card('getnaluno.com right now',
          kpis([['On the site now', site.live || 0],
            ['Visits today', site.today || 0],
            ['Unique today', site.uniques_today || 0],
            ['New today', site.new_today || 0],
            ['Returning today', site.returning_today || 0],
            ['Week (7d)', site.week || 0]])
          + kpis([['Visits (30d)', site.month || 0],
            ['Unique (30d)', site.uniques_30d || 0],
            ['New (30d)', site.new_30d || 0],
            ['Returning (30d)', site.returning_30d || 0]]))
        + card('Time on the site',
          kpis([['Average today', dur(site.avg_ms || 0)],
            ['Median today', dur(site.median_ms || 0)],
            ['Total attention today', dur(site.total_ms_today || 0)],
            ['Installed (standalone)', site.standalone_today || 0]]))
        + card('Countries today', bars(site.countries, 16))
        + card('Cities today', bars(site.cities, 12))
        + card('Hour of day', bars(site.hours, 24))
        + card('Last 30 days',
          kpis([['Visits (30d)', site.day_visits || 0],
            ['App opens (30d)', site.day_app || 0],
            ['Attention (30d)', dur(site.day_ms || 0)],
            ['Days on file', (site.days || []).length]])
          + plainRows(['Day', 'Visits', 'App opens', 'Attention'],
            (site.days || []).slice(0, 31).map(function (row) {
              return [row.id || '', Number(row.visits) || 0, Number(row.appOpens || row.openApp) || 0, dur(row.ms || 0)];
            })))
        + card('Latest visits', recentTable);
      return;
    }

    if (tab === 'notifications') {
      el.innerHTML =
        card('Notifications',
          kpis([['People with a push token',
            (u.list || []).filter(function (row) { return !!(row.fcmToken || row.fcmTokenAndroid); }).length]])
          + gap(g.notifications || ''));
      return;
    }

    if (tab === 'search') {
      const q = __tabCache.searchQ || '';
      const hits = __tabCache.searchHits || [];
      el.innerHTML =
        card('Find a Callsign',
          '<div class="row"><input id="admFindQ" placeholder="@handle, email, name, id" style="flex:1" value="' + escapeHtml(q) + '" />'
          + '<button type="button" class="primary" id="admFindGo">Find</button></div>'
          + '<p class="sub" id="admFindHint" style="margin:10px 0 0;"></p>')
        + (hits.length
          ? card('Matches', table(['Name', 'Handle', 'Id', 'State', ''],
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

    if (tab === 'identity') {
      const idn = d.identity || { list: [], flags: [], open_flags: [], by_category: {}, total: 0 };
      const q = String(__tabCache.identityQ || '').toLowerCase().replace(/^@/, '');
      const catFilter = String(__tabCache.identityCat || '');
      let list = (idn.list || []).filter(function (row) {
        if (catFilter && row.category !== catFilter) return false;
        if (!q) return true;
        return [row.handle, row.reason, row.category, row.holderUid].join(' ').toLowerCase().indexOf(q) >= 0;
      });
      const catLabel = { official: 'Official', system: 'System', support: 'Support', other: 'Other' };
      const catSelect = function (current, handle) {
        return '<select class="idCat" data-handle="' + escapeHtml(handle) + '" style="width:auto;min-width:110px;padding:6px 8px;font-size:12px;">'
          + ['official', 'system', 'support', 'other'].map(function (c) {
            return '<option value="' + c + '"' + (c === current ? ' selected' : '') + '>' + (catLabel[c] || c) + '</option>';
          }).join('')
          + '</select>';
      };
      if (!__tabCache.identitySeedTried) {
        __tabCache.identitySeedTried = true;
        seedIdentity().then(function () { loadTab('identity', true); }).catch(function () {});
      }
      el.innerHTML =
        kpis([
          ['Reserved', idn.total || 0],
          ['Official', (idn.by_category && idn.by_category.official) || 0],
          ['System', (idn.by_category && idn.by_category.system) || 0],
          ['Support', (idn.by_category && idn.by_category.support) || 0],
          ['Open flags', (idn.open_flags || []).length],
        ])
        + card('Reserved Handles',
          '<p class="sub">These names stay reserved. Do not click Remove to use one — Remove lets anyone take it. Bind an existing account instead. That account can then save the Callsign in the app.</p>'
          + '<div class="row" style="margin-top:0;">'
          + '<input id="idSearch" placeholder="Search handle, reason or category" style="flex:1" value="' + escapeHtml(__tabCache.identityQ || '') + '" />'
          + '<select id="idCatFilter" style="width:auto;min-width:120px;padding:8px 10px;">'
          + '<option value="">All</option>'
          + '<option value="official"' + (catFilter === 'official' ? ' selected' : '') + '>Official</option>'
          + '<option value="system"' + (catFilter === 'system' ? ' selected' : '') + '>System</option>'
          + '<option value="support"' + (catFilter === 'support' ? ' selected' : '') + '>Support</option>'
          + '<option value="other"' + (catFilter === 'other' ? ' selected' : '') + '>Other</option>'
          + '</select></div>'
          + table(['Handle', 'Status', 'Category', 'Reason', 'Holder', 'When', 'Who', ''],
            list.map(function (row) {
              return [
                '@' + escapeHtml(row.handle),
                'Reserved',
                catSelect(row.category, row.handle),
                '<input class="idReason" data-handle="' + escapeHtml(row.handle) + '" value="' + escapeHtml(row.reason || '') + '" style="padding:6px 8px;font-size:12px;" />',
                row.holderUid
                  ? (escapeHtml(holderLabel(row.holderUid, d)) + ' <button type="button" class="ghost idUnbind" data-handle="' + escapeHtml(row.handle) + '" style="padding:4px 8px;font-size:10px;">Clear</button>')
                  : '—',
                escapeHtml(when(row.createdAt || row.updatedAt)),
                escapeHtml(String(row.updatedBy || row.createdBy || '').slice(0, 8) || '—'),
                '<button type="button" class="ghost idSave" data-handle="' + escapeHtml(row.handle) + '">Save</button> '
                + '<button type="button" class="ghost idDrop" data-handle="' + escapeHtml(row.handle) + '">Remove</button>',
              ];
            }))
          + '<div class="row">'
          + '<input id="idNewHandle" placeholder="handle" style="flex:1;min-width:140px;" />'
          + '<select id="idNewCat" style="width:auto;min-width:130px;padding:8px 10px;">'
          + '<option value="official">Official</option>'
          + '<option value="system">System</option>'
          + '<option value="support">Support</option>'
          + '<option value="other">Other</option>'
          + '</select>'
          + '<input id="idNewReason" placeholder="internal reason" style="flex:1;min-width:160px;" />'
          + '<button type="button" class="primary" id="idAdd">Add</button>'
          + '<button type="button" class="ghost" id="idSeed">Seed list</button>'
          + '</div>')
        + card('Give a reserved name to an account',
          '<p class="sub">The name stays reserved. Only this account may use it. Create the account first with any ordinary handle, then bind it here, then save the reserved Callsign on that account.</p>'
          + '<div class="row" style="margin-top:0;">'
          + '<input id="idBindHandle" placeholder="reserved handle" style="flex:1;min-width:140px;" />'
          + '<input id="idBindWho" placeholder="existing handle, name or uid" style="flex:1;min-width:180px;" />'
          + '<button type="button" class="primary" id="idBind">Give</button>'
          + '<button type="button" class="ghost" id="idBindMe">Give to me</button>'
          + '</div>')
        + card('Potential brand impersonation / similarity detected',
          ((idn.flags || []).length
            ? table(['Handle', 'Close to', 'Why', 'Who', 'When', 'Status', ''],
              (idn.flags || []).slice(0, 40).map(function (f) {
                return [
                  '@' + escapeHtml(f.handle),
                  f.reserved ? ('@' + escapeHtml(f.reserved)) : '—',
                  escapeHtml(f.reason || ''),
                  escapeHtml(String(f.uid || '').slice(0, 10)),
                  escapeHtml(when(f.createdAt)),
                  escapeHtml(f.status || 'open'),
                  (f.status === 'open' || f.status === 'new')
                    ? ('<button type="button" class="ghost idFlag" data-id="' + escapeHtml(f.id) + '" data-s="reviewed">Reviewed</button> '
                      + '<button type="button" class="ghost idFlag" data-id="' + escapeHtml(f.id) + '" data-s="dismissed">Dismiss</button>')
                    : '',
                ];
              }))
            : '<p class="sub">No similar handles have been flagged.</p>'));
      const search = $('idSearch');
      if (search) {
        search.oninput = function () {
          __tabCache.identityQ = search.value;
        };
        search.onchange = function () { loadTab('identity', false); };
      }
      const catEl = $('idCatFilter');
      if (catEl) catEl.onchange = function () {
        __tabCache.identityCat = catEl.value;
        loadTab('identity', false);
      };
      el.querySelectorAll('.idSave').forEach(function (btn) {
        btn.onclick = function () {
          const h = btn.getAttribute('data-handle');
          const sel = el.querySelector('.idCat[data-handle="' + h + '"]');
          const reason = el.querySelector('.idReason[data-handle="' + h + '"]');
          saveReservedHandle(h, sel ? sel.value : 'other', reason ? reason.value : '').then(function (ok) {
            if (ok) loadTab('identity', true);
          });
        };
      });
      el.querySelectorAll('.idDrop').forEach(function (btn) {
        btn.onclick = function () {
          const h = btn.getAttribute('data-handle');
          if (!h) return;
          if (!window.confirm('Remove @' + h + ' from the reserved list? Anyone will then be able to register it. To give it to an official account, bind the account instead.')) return;
          removeReservedHandle(h, 'removed from Identity').then(function (ok) {
            if (ok) loadTab('identity', true);
          });
        };
      });
      el.querySelectorAll('.idFlag').forEach(function (btn) {
        btn.onclick = function () {
          reviewHandleFlag(btn.getAttribute('data-id'), btn.getAttribute('data-s')).then(function () {
            loadTab('identity', true);
          });
        };
      });
      if ($('idAdd')) $('idAdd').onclick = function () {
        const h = $('idNewHandle') && $('idNewHandle').value;
        const c = $('idNewCat') && $('idNewCat').value;
        const r = $('idNewReason') && $('idNewReason').value;
        saveReservedHandle(h, c, r).then(function (ok) {
          if (ok) loadTab('identity', true);
        });
      };
      if ($('idSeed')) $('idSeed').onclick = function () {
        seedIdentity().then(function () { loadTab('identity', true); toast('Protected names are on the list'); });
      };
      el.querySelectorAll('.idUnbind').forEach(function (btn) {
        btn.onclick = function () {
          const h = btn.getAttribute('data-handle');
          clearReservedHolder(h).then(function (ok) {
            if (ok) loadTab('identity', true);
          });
        };
      });
      if ($('idBind')) $('idBind').onclick = function () {
        const h = $('idBindHandle') && $('idBindHandle').value;
        const who = $('idBindWho') && $('idBindWho').value;
        bindReservedHolder(h, who).then(function (ok) {
          if (ok) loadTab('identity', true);
        });
      };
      if ($('idBindMe')) $('idBindMe').onclick = function () {
        const h = $('idBindHandle') && $('idBindHandle').value;
        bindReservedHolder(h, 'me').then(function (ok) {
          if (ok) loadTab('identity', true);
        });
      };
      return;
    }

    if (tab === 'flags') {
      const meta = (Data && Data.FLAG_META) || {};
      const skipFlag = { updatedAt: 1, updatedBy: 1, adEveryMin: 1 };
      const keys = Object.keys(meta).length
        ? Object.keys(meta)
        : Object.keys(d.flags || {}).filter(function (k) { return !skipFlag[k]; });
      el.innerHTML =
        card('Feature flags', keys.map(function (k) {
          const on = !!d.flags[k];
          const m = meta[k] || { label: k };
          const locked = k === 'real_payouts_enabled';
          return '<div class="flag-row">'
            + '<span style="flex:1;"><strong>' + escapeHtml(m.label || k) + '</strong></span>'
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
      toast((e && e.message) || 'Could not update that account.');
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
  function parsePaidAed(raw) {
    let n = Number(raw);
    if (!isFinite(n) || n < 0) n = 0;
    if (n > 1e9) n = 1e9;
    const C = Ccy();
    return C && C.convert ? C.convert(n, opCode(), 'AED') : n;
  }
  function cleanHandle(raw) {
    return String(raw || '').trim().replace(/^@/, '').slice(0, 40);
  }
  function cleanEmail(raw) {
    const s = String(raw || '').trim().slice(0, 120);
    if (!s) return '';
    if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(s)) return '';
    return s;
  }
  function cleanPhone(raw) {
    return String(raw || '').trim().slice(0, 32);
  }
  async function saveAd(status) {
    const db = adminDb();
    if (!db) { toast('Database is not ready'); return; }
    if (!currentUser) { toast('Sign in again'); return; }
    try { window.currentUser = currentUser; } catch (_) {}
    const editId = __tabCache.adsEditId || '';
    const existing = (editId && __snap && __snap.ads && __snap.ads.list)
      ? (__snap.ads.list.filter(function (a) { return a && a.id === editId; })[0] || null)
      : null;
    try { await ensureUploadHelper(); } catch (e) {
      if (!editId) { setMsg('adMsg', (e && e.message) || 'Upload helper failed'); return; }
    }
    const fileEl = $('adFile');
    const file = fileEl && fileEl.files && fileEl.files[0];
    const headline = (($('adHeadline') && $('adHeadline').value) || '').trim().slice(0, 80);
    const advertiser = (($('adAdvertiser') && $('adAdvertiser').value) || '').trim().slice(0, 60);
    const advertiserHandle = cleanHandle(($('adAdvHandle') && $('adAdvHandle').value) || '');
    const advertiserEmail = cleanEmail(($('adAdvEmail') && $('adAdvEmail').value) || '');
    const advertiserPhone = cleanPhone(($('adAdvPhone') && $('adAdvPhone').value) || '');
    const paidAed = parsePaidAed(($('adPaid') && $('adPaid').value) || '0');
    const ctaLabel = ((($('adCtaLabel') && $('adCtaLabel').value) || 'Open').trim() || 'Open').slice(0, 24);
    const ctaUrl = httpsOnly(($('adCtaUrl') && $('adCtaUrl').value) || '');
    const place = ($('adPlace') && $('adPlace').value) || 'both';
    let bill = String(($('adBill') && $('adBill').value) || 'cpm').toLowerCase();
    if (bill !== 'cpc' && bill !== 'cpv') bill = 'cpm';
    let skip = parseInt(($('adSkip') && $('adSkip').value) || '5', 10);
    if (!isFinite(skip)) skip = 5;
    skip = Math.max(0, Math.min(15, skip));
    if (!file && !editId) { setMsg('adMsg', 'Choose a video or image.'); return; }
    if (!headline && !advertiser) { setMsg('adMsg', 'Add a headline or an advertiser name.'); return; }
    if (($('adAdvEmail') && $('adAdvEmail').value.trim()) && !advertiserEmail) {
      setMsg('adMsg', 'That email does not look right.');
      return;
    }
    if (($('adCtaUrl') && $('adCtaUrl').value.trim()) && !ctaUrl) {
      setMsg('adMsg', 'The call to action must be an https address.');
      return;
    }
    if (status === 'live' && editId) {
      const units = (__snap && __snap.ads && __snap.ads.revenue && __snap.ads.revenue.units) || [];
      const unit = units.filter(function (u) { return u && u.id === editId; })[0];
      if (unit && unit.spent && paidAed > 0) {
        const used = Number(unit.bookedAed) || 0;
        if (used >= paidAed) {
          setMsg('adMsg', 'Prepaid is used up. Type more paid first.');
          return;
        }
      }
    }
    let url = (existing && existing.mediaUrl) || '';
    let isImage = existing && String(existing.mediaType || '').indexOf('image') === 0;
    if (file) {
      isImage = String(file.type || '').indexOf('image/') === 0 || /\.(png|jpe?g|webp|gif)$/i.test(file.name || '');
      setMsg('adMsg', 'Uploading…', true);
      toast('Uploading creative…');
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
    }
    const usedAed = existing && __snap && __snap.ads && __snap.ads.revenue
      ? Number(((__snap.ads.revenue.units || []).filter(function (u) { return u && u.id === editId; })[0] || {}).bookedAed) || 0
      : 0;
    const spent = paidAed > 0 && usedAed >= paidAed;
    const doc = {
      status: (status === 'live' && !spent) ? 'live' : 'paused',
      placements: placementsFrom(place),
      placement: place,
      headline: headline,
      advertiser: advertiser,
      advertiserHandle: advertiserHandle,
      advertiserEmail: advertiserEmail,
      advertiserPhone: advertiserPhone,
      paidAed: paidAed,
      spent: spent,
      ctaLabel: ctaLabel,
      ctaUrl: ctaUrl,
      skipAfterSec: skip,
      billModel: bill,
      updatedAt: Date.now(),
      updatedBy: currentUser.uid,
    };
    if (url) {
      doc.mediaUrl = url;
      doc.mediaType = isImage ? 'image' : 'video';
      doc.thumbUrl = isImage ? url : (existing && existing.thumbUrl) || '';
    }
    if (file) doc.bytes = file.size || 0;
    try {
      if (editId) {
        await db.collection('deskAds').doc(editId).set(doc, { merge: true });
        await writeAudit('ad-edit', editId, doc.status + ' · ' + (headline || advertiser));
        toast(doc.status === 'live' ? 'Published again' : 'Saved');
        __tabCache.adsEditId = '';
        __tabCache.adsViewId = editId;
      } else {
        doc.impressions = 0;
        doc.clicks = 0;
        doc.skips = 0;
        doc.viewCompletes = 0;
        doc.bytes = file ? (file.size || 0) : 0;
        doc.createdAt = Date.now();
        doc.createdBy = currentUser.uid;
        if (!doc.mediaUrl) { setMsg('adMsg', 'Choose a video or image.'); return; }
        const ref = await db.collection('deskAds').add(doc);
        await writeAudit('ad-create', ref.id, doc.status + ' · ' + (headline || advertiser));
        toast(doc.status === 'live' ? 'Live in the app' : 'Saved paused');
        __tabCache.adsViewId = ref.id;
      }
      setMsg('adMsg', 'Saved.', true);
      await loadTab('ads', true);
    } catch (e) {
      setMsg('adMsg', (e && e.message) || 'Could not save.');
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
        delete __spentLatch[id];
        if (__tabCache.adsEditId === id) __tabCache.adsEditId = '';
        if (__tabCache.adsViewId === id) __tabCache.adsViewId = '';
        toast('Removed');
      } else {
        let status = action === 'live' ? 'live' : 'paused';
        if (status === 'live') {
          const units = (__snap && __snap.ads && __snap.ads.revenue && __snap.ads.revenue.units) || [];
          const unit = units.filter(function (u) { return u && u.id === id; })[0];
          if (unit && unit.spent) {
            toast('Prepaid is used up. Type more paid first.');
            return;
          }
        }
        const patch = { status: status, updatedAt: Date.now(), updatedBy: currentUser.uid };
        if (status === 'live') {
          patch.spent = false;
          delete __spentLatch[id];
        }
        await db.collection('deskAds').doc(id).set(patch, { merge: true });
        await writeAudit('ad-' + status, id, status);
        toast(status === 'live' ? 'Live in the app' : 'Paused');
      }
      await loadTab('ads', true);
    } catch (e) {
      toast((e && e.message) || 'Could not update that unit.');
    }
  }
  async function saveAdPaid(id) {
    if (!id) return;
    const db = adminDb();
    if (!db) { toast('Database is not ready'); return; }
    const inp = document.getElementById('adPaid-' + id) || document.querySelector('.adPaidEdit[data-id="' + id + '"]');
    const paidAed = parsePaidAed((inp && inp.value) || '0');
    const units = (__snap && __snap.ads && __snap.ads.revenue && __snap.ads.revenue.units) || [];
    const unit = units.filter(function (u) { return u && u.id === id; })[0] || {};
    const used = Number(unit.bookedAed) || 0;
    const spent = paidAed > 0 && used >= paidAed;
    const patch = {
      paidAed: paidAed,
      spent: spent,
      updatedAt: Date.now(),
      updatedBy: currentUser && currentUser.uid,
    };
    if (spent) {
      patch.status = 'paused';
      __spentLatch[id] = true;
    } else {
      delete __spentLatch[id];
    }
    try {
      await db.collection('deskAds').doc(id).set(patch, { merge: true });
      await writeAudit('ad-paid', id, String(Math.round(paidAed * 100) / 100) + ' AED');
      toast(spent ? 'Prepaid saved. Used up — paused.' : 'Prepaid saved');
      try { if (inp) inp.blur(); } catch (_) {}
      loadTab('ads', false);
    } catch (e) {
      toast((e && e.message) || 'Could not save prepaid.');
    }
  }
  function maybePauseSpentAds(snap) {
    const db = adminDb();
    if (!db) return;
    const units = (snap && snap.ads && snap.ads.revenue && snap.ads.revenue.units) || [];
    units.forEach(function (u) {
      if (!u || !u.id) return;
      if (String(u.status || '') !== 'live') return;
      if (!u.spent) return;
      if (__spentLatch[u.id]) return;
      __spentLatch[u.id] = true;
      db.collection('deskAds').doc(u.id).set({
        status: 'paused',
        spent: true,
        spentAt: Date.now(),
        updatedAt: Date.now(),
        updatedBy: currentUser && currentUser.uid,
      }, { merge: true }).then(function () {
        writeAudit('ad-spent', u.id, 'prepaid used up');
        toast('An ad used up its prepaid and paused.');
      }).catch(function () {
        delete __spentLatch[u.id];
      });
    });
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
      toast((e && e.message) || 'Could not update mail.');
    }
  }

  /* Resolve a report LOCALLY the moment the write succeeds.

     Why this is needed: actReport used to reload the Trust tab from a fresh
     one-shot read, while the live listeners separately re-commit their own
     cached pack (__livePack) whenever ANY watched collection changes. If a
     users/broadcasts/siteSessions listener fired before the reports update
     had arrived, applyLivePack() re-committed the OLD reports — status still
     OPEN — and the "report waiting for a decision" alert came straight back.
     Whether it stayed gone depended on which network response won.

     Patching the report in BOTH packs removes the race: there is no longer a
     stale copy anywhere for a later re-commit to restore. The live listener
     still delivers the authoritative document afterwards, and it agrees. */
  function markReportLocally(id, decision, note) {
    const now = Date.now();
    const want = String(id || '');
    const patch = function (rows) {
      if (!Array.isArray(rows)) return;
      rows.forEach(function (r) {
        if (!r) return;
        if (String(r.id || '') === want || String(r._id || '') === want || String(r.report_id || '') === want) {
          r.status = decision;
          r.resolution = note || r.resolution || '';
          r.resolvedAt = now;
          r.decided_at = now;
          r.resolvedBy = currentUser ? currentUser.uid : r.resolvedBy;
        }
      });
    };
    try { if (__livePack) patch(__livePack.reports); } catch (_) {}
    try { if (__snap && __snap._raw) patch(__snap._raw.reports); } catch (_) {}
    // Re-derive from the corrected raw pack so the attention list, the alert
    // count and the health label are all recomputed together — patching the
    // derived fields by hand would let them drift apart.
    try {
      if (__snap && __snap._raw) {
        const fresh = commitPack(__snap._raw);
        renderStrip(fresh);
        renderTab(__activeTab, fresh);
      }
    } catch (_) {}
  }

  function reportDecisionPatch(decision, note) {
    const now = Date.now();
    const who = currentUser ? currentUser.uid : '';
    const text = String(note || '').trim();
    return {
      status: decision,
      resolution: text,
      resolvedAt: now,
      resolvedBy: who,
      decided_at: now,
      decided_by: who,
      note: text,
    };
  }

  function reportRowKeys(r) {
    if (!r) return [];
    return [r.id, r._id, r.report_id].map(function (x) { return String(x || ''); }).filter(Boolean);
  }

  async function findReportRefs(id) {
    const db = adminDb();
    const want = String(id || '');
    if (!db || !want) return [];
    const seen = {};
    const refs = [];
    function add(ref) {
      if (!ref || !ref.id || seen[ref.id]) return;
      seen[ref.id] = true;
      refs.push(ref);
    }
    try {
      const direct = await db.collection('reports').doc(want).get();
      if (direct && direct.exists) add(direct.ref);
    } catch (_) {}
    try {
      const q = await db.collection('reports').where('report_id', '==', want).limit(8).get();
      q.forEach(function (d) { add(d.ref); });
    } catch (_) {}
    try {
      ((__livePack && __livePack.reports) || []).forEach(function (r) {
        if (!r) return;
        if (reportRowKeys(r).indexOf(want) < 0) return;
        const real = String(r.id || r._id || '');
        if (real) add(db.collection('reports').doc(real));
      });
    } catch (_) {}
    return refs;
  }

  async function persistReportDecision(id, decision, note) {
    const db = adminDb();
    if (!db) return 0;
    const text = String(note || '').trim();
    const patch = reportDecisionPatch(decision, text);
    const refs = await findReportRefs(id);
    let n = 0;
    for (let i = 0; i < refs.length; i++) {
      await refs[i].set(patch, { merge: true });
      markReportLocally(refs[i].id, decision, text);
      n += 1;
    }
    markReportLocally(id, decision, text);
    try {
      await adminWorker('/v1/admin/report-action', {
        method: 'POST',
        body: JSON.stringify({
          report_id: id,
          id: id,
          decision: decision,
          status: decision,
          reason: text || decision,
        }),
      });
    } catch (_) {}
    return n;
  }

  function liveReportRows() {
    if (__livePack && Array.isArray(__livePack.reports)) return __livePack.reports;
    if (__snap && __snap._raw && Array.isArray(__snap._raw.reports)) return __snap._raw.reports;
    return [];
  }

  function reportIsWaiting(r) {
    try {
      if (Data && typeof Data.reportIsOpen === 'function') {
        return Data.reportIsOpen(r, (__livePack && __livePack.broadcasts) || []);
      }
    } catch (_) {}
    const st = String((r && r.status) || '').toUpperCase();
    if (r && (r.resolvedAt || r.decided_at)) return false;
    return !st || st === 'OPEN' || st === 'NEW' || st === 'UNDER REVIEW';
  }

  async function closeReportsForBroadcast(bid, decision, note) {
    const db = adminDb();
    const target = String(bid || '');
    if (!db || !target) return 0;
    const ids = [];
    liveReportRows().forEach(function (r) {
      if (!r || !reportIsWaiting(r)) return;
      const hit = String(r.broadcast_id || (r.target_type === 'broadcast' ? r.target_id : '') || '');
      if (hit === target) ids.push(r.id || r.report_id);
    });
    try {
      const q = await db.collection('reports').where('broadcast_id', '==', target).limit(40).get();
      q.forEach(function (d) { ids.push(d.id); });
    } catch (_) {}
    try {
      const q2 = await db.collection('reports').where('target_id', '==', target).limit(40).get();
      q2.forEach(function (d) { ids.push(d.id); });
    } catch (_) {}
    const seen = {};
    let n = 0;
    for (let i = 0; i < ids.length; i++) {
      const id = String(ids[i] || '');
      if (!id || seen[id]) continue;
      seen[id] = true;
      n += await persistReportDecision(id, decision, note);
    }
    return n;
  }

  let __healedReports = false;
  function scrubSafeRow(c) {
    const o = Object.assign({}, c || {});
    ['body', 'message', 'ciphertext', 'plaintext', 'wire_text', 'transcript', 'chat', 'public_text', 'text', 'caption', 'bytes', 'file'].forEach(function (k) {
      delete o[k];
    });
    return o;
  }
  function safetyOverviewLocal(cases, appeals) {
    const t = Date.now();
    const day = 86400000;
    const list = cases || [];
    const open = list.filter(function (c) { return c && c.review_status !== 'decided'; });
    const confirm = { REMOVE: 1, RESTRICT: 1, SUSPEND: 1, ESCALATE: 1, AGE_RESTRICT: 1, REGION_RESTRICT: 1 };
    const overturn = { ALLOW: 1, RESTORE: 1, DISMISS: 1 };
    let confirmed = 0;
    let fp = 0;
    const counts = {};
    list.forEach(function (c) {
      if (!c) return;
      const auto = c.automated_risk_result && c.automated_risk_result.decision;
      if (c.review_status === 'decided' && auto && auto !== 'ALLOW' && auto !== 'PRIVATE') {
        if (confirm[c.decision]) confirmed += 1;
        else if (overturn[c.decision]) fp += 1;
      }
      if (c.reported_user_id && (c.decision === 'REMOVE' || c.decision === 'RESTRICT' || c.decision === 'SUSPEND')) {
        counts[c.reported_user_id] = (counts[c.reported_user_id] || 0) + 1;
      }
    });
    const judged = confirmed + fp;
    const repeat = Object.keys(counts).filter(function (uid) { return counts[uid] >= 2; })
      .map(function (uid) { return { uid: uid, count: counts[uid] }; });
    return {
      reports_today: list.filter(function (c) { return c && c.reporter_id && c.reporter_id !== 'system' && t - (c.created_at || 0) < day; }).length,
      open_cases: open.length,
      urgent: open.filter(function (c) { return c.priority === 'URGENT'; }).length,
      high: open.filter(function (c) { return c.priority === 'HIGH'; }).length,
      medium: open.filter(function (c) { return c.priority === 'MEDIUM'; }).length,
      low: open.filter(function (c) { return c.priority === 'LOW'; }).length,
      automated_detections: list.filter(function (c) { return c && c.reporter_id === 'system' && t - (c.created_at || 0) < day; }).length,
      content_removed: list.filter(function (c) { return c && c.decision === 'REMOVE'; }).length,
      accounts_restricted: list.filter(function (c) { return c && (c.decision === 'RESTRICT' || c.decision === 'SUSPEND' || c.decision === 'AGE_RESTRICT' || c.decision === 'REGION_RESTRICT'); }).length,
      appeals_open: (appeals || []).filter(function (a) { return a && a.status === 'open'; }).length,
      repeat_offenders: repeat.length,
      repeat: repeat,
      detection_accuracy: judged ? Math.round((100 * confirmed) / judged) : null,
      false_positive_rate: judged ? Math.round((100 * fp) / judged) : null,
      judged: judged,
    };
  }
  async function loadSafetyCentre(el, query) {
    const rank = { URGENT: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
    let cases = [];
    let audit = [];
    let appeals = [];
    let behaviour = [];
    let overview = null;
    let workerNote = '';
    try {
      const res = await adminWorker('/v1/admin/safety' + (query ? ('?' + query) : ''), { method: 'GET' });
      const body = res && res.ok ? await res.json().catch(function () { return {}; }) : {};
      if (res && !res.ok) workerNote = 'The safety desk on the worker did not answer. Showing the saved record only.';
      cases = (body && body.cases) || [];
      audit = (body && body.audit) || [];
      appeals = (body && body.appeals) || [];
      behaviour = (body && body.behaviour) || [];
      overview = body && body.overview;
    } catch (_) {
      workerNote = 'The safety desk on the worker did not answer. Showing the saved record only.';
    }
    try {
      const db = adminDb();
      if (db) {
        const snap = await db.collection('safetyCases').limit(80).get();
        snap.forEach(function (doc) {
          const row = scrubSafeRow(doc.data() || {});
          row.case_id = row.case_id || doc.id;
          if (!cases.some(function (c) { return c.case_id === row.case_id; })) cases.push(row);
        });
        const asnap = await db.collection('safetyAudit').limit(40).get();
        asnap.forEach(function (doc) {
          const row = doc.data() || {};
          if (!audit.some(function (a) { return a.audit_id === (row.audit_id || doc.id); })) audit.push(row);
        });
        const psnap = await db.collection('safetyAppeals').limit(40).get();
        psnap.forEach(function (doc) {
          const row = doc.data() || {};
          row.appeal_id = row.appeal_id || doc.id;
          if (!appeals.some(function (a) { return a.appeal_id === row.appeal_id; })) appeals.push(row);
        });
      }
    } catch (_) {}
    cases = cases.map(scrubSafeRow);
    cases.sort(function (a, b) {
      return (rank[a.priority] == null ? 9 : rank[a.priority]) - (rank[b.priority] == null ? 9 : rank[b.priority]);
    });
    if (!overview) overview = safetyOverviewLocal(cases, appeals);
    if (!behaviour.length) {
      behaviour = cases.filter(function (c) { return c.content_type === 'account' || c.surface === 'behaviour'; });
    }
    const open = cases.filter(function (c) { return c.review_status !== 'decided'; });
    function caseTable(rows) {
      if (!rows.length) return '<p class="sub">Nothing in this queue.</p>';
      return table(['Priority', 'Case', 'What', 'Score', 'Status', ''], rows.map(function (c) {
        const risk = c.automated_risk_result || {};
        const openRow = c.review_status !== 'decided';
        const account = c.content_type === 'account' || c.surface === 'behaviour';
        const buttons = '<button type="button" class="ghost admSafe" data-id="' + escapeHtml(c.case_id) + '" data-a="REMOVE">Remove</button> '
          + '<button type="button" class="ghost admSafe" data-id="' + escapeHtml(c.case_id) + '" data-a="AGE_RESTRICT">Age</button> '
          + '<button type="button" class="ghost admSafe" data-id="' + escapeHtml(c.case_id) + '" data-a="DISMISS">Dismiss</button> '
          + '<button type="button" class="ghost admSafe" data-id="' + escapeHtml(c.case_id) + '" data-a="ESCALATE">Escalate</button> '
          + (account
            ? '<button type="button" class="ghost admSafe" data-id="' + escapeHtml(c.case_id) + '" data-a="SUSPEND">Suspend</button>'
            : '<button type="button" class="ghost admSafe" data-id="' + escapeHtml(c.case_id) + '" data-a="RESTORE">Restore</button>');
        return [
          escapeHtml(c.priority || ''),
          escapeHtml(c.case_id || ''),
          escapeHtml((c.content_type || '') + ' ' + String(c.content_id || '').slice(0, 18)),
          String(risk.score != null ? risk.score : ''),
          escapeHtml((c.decision || c.review_status || 'open') + (c.statement ? '' : '')),
          openRow ? buttons : escapeHtml(c.decision_reason || c.statement || ''),
        ];
      }));
    }
    function queue(name, pred) {
      return card(name, caseTable(open.filter(pred)));
    }
    const rate = function (n) { return n == null ? '—' : (n + '%'); };
    const repeat = overview.repeat || [];
    el.innerHTML =
      '<div class="alert">Private Wireline and Band conversations are not opened here. There is no control that reads messages. Public Broadcasts and Signals are scored. A machine cannot ban someone. A suspension is a human decision and can be appealed.</div>'
      + (workerNote ? '<p class="sub">' + escapeHtml(workerNote) + '</p>' : '')
      + '<div class="card"><div class="who">Find a case</div>'
      + '<div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;">'
      + '<input id="safeQ" placeholder="Case, content, account, or report id" style="flex:1;min-width:180px;padding:8px 10px;">'
      + '<select id="safeStatus" style="padding:8px;"><option value="">Any status</option><option value="open">Open</option><option value="review">Appeal / review</option><option value="decided">Decided</option></select>'
      + '<select id="safePriority" style="padding:8px;"><option value="">Any priority</option><option>URGENT</option><option>HIGH</option><option>MEDIUM</option><option>LOW</option></select>'
      + '<button type="button" class="ghost" id="safeSearch">Search</button>'
      + '</div></div>'
      + kpis([
        ['Reports today', overview.reports_today],
        ['Open', overview.open_cases],
        ['Urgent', overview.urgent],
        ['Detected today', overview.automated_detections],
      ])
      + kpis([
        ['Removed', overview.content_removed],
        ['Restricted', overview.accounts_restricted],
        ['Appeals', overview.appeals_open],
        ['Repeat', overview.repeat_offenders],
      ])
      + kpis([
        ['Confirmed', rate(overview.detection_accuracy)],
        ['False alarms', rate(overview.false_positive_rate)],
        ['Reviewed', overview.judged || 0],
        ['Private reads', 0],
      ])
      + '<p class="sub">Confirmed and false alarms stay blank until a person has agreed with or overturned the machine. One report does not take something down by itself.</p>'
      + queue('Urgent', function (c) { return c.priority === 'URGENT'; })
      + queue('High', function (c) { return c.priority === 'HIGH'; })
      + queue('Medium', function (c) { return c.priority === 'MEDIUM'; })
      + queue('Low', function (c) { return c.priority === 'LOW'; })
      + card('Behaviour — no message text', behaviour.length
        ? plainRows(['Case', 'Account', 'Score', 'Status'], behaviour.slice(0, 20).map(function (c) {
          const risk = c.automated_risk_result || {};
          return [c.case_id || '', String(c.reported_user_id || '').slice(0, 14), risk.score != null ? risk.score : '', c.decision || c.review_status || 'open'];
        }))
        : '<p class="sub">No behaviour flags. These come from follows, new accounts, repeated uploads, and coordinated public posts — not from chats.</p>')
      + card('Repeat decisions', repeat.length
        ? plainRows(['Account', 'Decisions'], repeat.slice(0, 12).map(function (r) {
          return [String(r.uid || '').slice(0, 18), r.count];
        }))
        : '<p class="sub">Nobody has two removals or restrictions yet.</p>')
      + card('Appeals', appeals.length
        ? plainRows(['Case', 'From', 'Note', 'Status'], appeals.slice(0, 20).map(function (a) {
          return [a.case_id || '', String(a.appellant_uid || '').slice(0, 10), String(a.note || '').slice(0, 80), a.status || ''];
        }))
        : '<p class="sub">No appeals.</p>')
      + card('Audit — cannot be deleted', audit.length
        ? plainRows(['When', 'Who', 'What', 'Why', 'Human'], audit.slice(0, 20).map(function (a) {
          return [when(a.when), String(a.who || '').slice(0, 10), a.what || '', String(a.why || '').slice(0, 60), a.human_reviewed ? 'yes' : 'no'];
        }))
        : '<p class="sub">No audit rows yet.</p>');
    const searchBtn = el.querySelector('#safeSearch');
    if (searchBtn) searchBtn.onclick = function () {
      const q = (el.querySelector('#safeQ').value || '').trim();
      const status = el.querySelector('#safeStatus').value || '';
      const priority = el.querySelector('#safePriority').value || '';
      const parts = [];
      if (q) parts.push('q=' + encodeURIComponent(q));
      if (status) parts.push('status=' + encodeURIComponent(status));
      if (priority) parts.push('priority=' + encodeURIComponent(priority));
      loadSafetyCentre(el, parts.join('&'));
    };
    el.querySelectorAll('.admSafe').forEach(function (btn) {
      btn.onclick = function () { decideSafetyCase(btn.getAttribute('data-id'), btn.getAttribute('data-a'), el); };
    });
  }
  async function decideSafetyCase(caseId, action, el) {
    if (!caseId || !action) return;
    const why = window.prompt('Why this decision? A person has to say.') || '';
    if (why.trim().length < 3) { toast('A reason is required.'); return; }
    try {
      const res = await adminWorker('/v1/admin/safety/decide', {
        method: 'POST',
        body: JSON.stringify({ case_id: caseId, action: action, why: why.trim() }),
      });
      const body = res ? await res.json().catch(function () { return {}; }) : {};
      if (!res || !res.ok || !body.ok) {
        const db = adminDb();
        if (!db) { toast((body && body.error) || 'Could not decide'); return; }
        await db.collection('safetyCases').doc(caseId).set({
          review_status: 'decided',
          decision: action,
          decision_reason: why.trim(),
          reviewer: currentUser ? currentUser.uid : '',
          decided_at: Date.now(),
          auto_ban: false,
        }, { merge: true });
        await db.collection('safetyAudit').add({
          audit_id: 'aud_' + Date.now(),
          case_id: caseId,
          who: currentUser ? currentUser.uid : '',
          what: 'human-decision',
          when: Date.now(),
          why: why.trim(),
          detected_by: 'human',
          human_reviewed: true,
          action_taken: action,
        });
      }
      toast('Decision recorded');
      await writeAudit('safety-' + action, caseId, why.trim());
      loadSafetyCentre(el);
    } catch (e) {
      toast((e && e.message) || 'Could not decide');
    }
  }

  async function healStuckReports(pack) {
    if (__healedReports || !pack) return 0;
    const db = adminDb();
    if (!db) return 0;
    __healedReports = true;
    const broadcasts = pack.broadcasts || [];
    const byId = {};
    broadcasts.forEach(function (b) {
      if (b && (b.id || b.broadcast_id)) byId[String(b.id || b.broadcast_id)] = b;
    });
    const auditClosed = {};
    (pack.audit || []).forEach(function (a) {
      const act = String((a && a.action) || '');
      const t = String((a && (a.target || a.target_id)) || '');
      if (!t) return;
      if (act === 'report-ACTIONED' || act === 'report-DISMISSED') {
        auditClosed[t] = act.replace('report-', '');
      }
    });
    const jobs = [];
    (pack.reports || []).forEach(function (r) {
      if (!r || !reportIsWaiting(r)) return;
      const keys = reportRowKeys(r);
      let decision = '';
      let note = '';
      keys.forEach(function (k) {
        if (auditClosed[k]) {
          decision = auditClosed[k];
          note = 'Closed from an earlier session';
        }
      });
      const bid = String(r.broadcast_id || (r.target_type === 'broadcast' ? r.target_id : '') || '');
      const b = bid ? byId[bid] : null;
      if (!decision && b && (b.hidden || b.deleted)) {
        const hiddenBy = String(b.hiddenBy || '');
        if (hiddenBy && hiddenBy !== 'report') {
          decision = 'ACTIONED';
          note = 'Broadcast already taken down';
        }
      }
      if (decision) jobs.push(persistReportDecision(r.id || r.report_id, decision, note));
    });
    if (!jobs.length) return 0;
    const counts = await Promise.all(jobs);
    let n = 0;
    counts.forEach(function (c) { n += Number(c) || 0; });
    return n;
  }

  async function actReport(id, decision) {
    if (!id || !decision) return;
    const note = window.prompt('Note for the audit log:', '');
    if (note === null) return;
    if (!String(note).trim()) { toast('A note is required'); return; }
    const db = adminDb();
    if (!db) return;
    try {
      const refs = await findReportRefs(id);
      let data = {};
      if (refs.length) {
        try {
          const snap = await refs[0].get();
          data = (snap && snap.exists) ? (snap.data() || {}) : {};
        } catch (_) {}
      }
      const wrote = await persistReportDecision(id, decision, note.trim());
      if (!wrote) {
        toast('Could not find that report to close.');
        return;
      }
      const bid = data.broadcast_id || (data.target_type === 'broadcast' ? data.target_id : '');
      if (decision === 'ACTIONED' && bid && (data.reason_code === 'sexual' || data.reason_code === 'violence')) {
        await db.collection('broadcasts').doc(bid).set({
          hidden: true, listed: false, held: false, live: false,
          hiddenReason: data.reason_code, hiddenAt: Date.now(), hiddenBy: currentUser.uid,
        }, { merge: true });
      }
      await writeAudit('report-' + decision, id, note.trim());
      toast('Report ' + String(decision).toLowerCase() + ' — cleared');
      await loadTab(__activeTab, true);
    } catch (e) {
      toast((e && e.message) || 'Could not update the report.');
    }
  }

  async function modBroadcast(id, action, uid) {
    if (!id || !action) return;
    const db = adminDb();
    if (!db) return;
    const now = Date.now();
    try {
      if (action === 'let-out') {
        await db.collection('broadcasts').doc(id).set({
          listed: true, held: false, heldReason: '', hidden: false, updatedAt: now,
        }, { merge: true });
        toast('That Broadcast is on the public feed');
      } else if (action === 'take-down') {
        const why = window.prompt('Why is this coming down?', 'sexual');
        if (why === null) return;
        await db.collection('broadcasts').doc(id).set({
          listed: false, held: false, hidden: true, live: false,
          hiddenReason: String(why || 'taken down').slice(0, 80),
          hiddenAt: now, hiddenBy: currentUser.uid, updatedAt: now,
        }, { merge: true });
        try { await closeReportsForBroadcast(id, 'ACTIONED', 'Broadcast taken down'); } catch (_) {}
        toast('Taken down');
      } else if (action === 'restore') {
        await db.collection('broadcasts').doc(id).set({
          listed: true, held: false, hidden: false, hiddenReason: '', updatedAt: now,
        }, { merge: true });
        toast('Restored to the public feed');
      } else if (action === 'trust-publisher') {
        const who = uid || '';
        if (!who) { toast('Missing account'); return; }
        await db.collection('users').doc(who).set({ trustedPublisher: true, updatedAt: now }, { merge: true });
        toast('Their next Broadcasts go out live');
      }
      try {
        await adminWorker('/v1/admin/broadcast-moderation', {
          method: 'POST',
          body: JSON.stringify({ broadcast_id: id, action: action, user_id: uid || '', reason: action }),
        });
      } catch (_) {}
      await writeAudit('broadcast-' + action, id, uid || '');
      await loadTab('trust', true);
    } catch (e) {
      toast((e && e.message) || 'Could not update that Broadcast.');
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
      toast((e && e.message) || 'Could not save the flag.');
    }
  }

  function openConsole() {
    try { localStorage.setItem('naluno:pulse:staff', '1'); } catch (_) {}
    setStage('console');
    __healedReports = false;
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
    await refreshOperatorClaim();

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
    const hasLocal = !!localGet(uid);
    let hasWorker = false;
    try {
      const st = await adminWorker('/v1/admin/status', { method: 'GET' });
      const body = st ? await st.json().catch(function () { return {}; }) : {};
      hasWorker = !!(st && st.ok && body.hasPassword);
      if (st && st.ok && body.operator === false) {
        setMsg('adminGateMsg', 'This account is not an operator on the worker.');
      }
    } catch (_) {}
    __needsSetup = !hasWorker && !cloudHash && !hasLocal;
    setGateMode(__needsSetup ? 'setup' : 'locked');
    if (ping) ping.textContent = hasWorker
      ? 'password on the console'
      : (cloudHash ? 'password on this account' : (hasLocal ? 'password on this phone' : ''));
    setMsg('adminGateMsg', '');
    stampOperatorClaim();
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
      setMsg('adminGateMsg', 'Saving…', true);
      const hash = await hashLocal(uid, typed);
      try { localSet(uid, hash); } catch (_) {}
      let workerOk = false;
      try {
        const res = await adminWorker('/v1/admin/password', {
          method: 'POST',
          body: JSON.stringify({ next_password: typed }),
        });
        const body = res ? await res.json().catch(function () { return {}; }) : {};
        workerOk = !!(res && res.ok && body.ok && body.persist && body.persist !== 'memory');
        /* 401 here means an older copy is on the worker. This phone is already saved. */
      } catch (_) {}
      let saved = { ok: workerOk, where: workerOk ? 'worker' : '' };
      try {
        if (!(await cloudOk(uid, typed))) saved = await cloudSetHash(uid, hash);
      } catch (_) {}
      if (!workerOk && !saved.ok) {
        setMsg('adminGateMsg', 'Saved on this phone. Cloud copy failed — you can still unlock here.');
      }
      __needsSetup = false;
      setGateMode('locked');
      if ($('adminPassConfirm')) $('adminPassConfirm').value = '';
    } else {
      let workerVerdict = null;
      try {
        const res = await adminWorker('/v1/admin/unlock', {
          method: 'POST',
          body: JSON.stringify({ password: typed }),
        });
        const body = res ? await res.json().catch(function () { return {}; }) : {};
        if (res && res.ok && body.ok && !body.setup) workerVerdict = true;
        if (res && res.ok && body.setup) workerVerdict = 'setup';
        /* 401 is not final — this phone or the account copy may still match. */
      } catch (_) {}
      if (workerVerdict === true) {
        try { localSet(uid, await hashLocal(uid, typed)); } catch (_) {}
        try {
          if (!(await cloudOk(uid, typed))) await cloudSetHash(uid, await hashLocal(uid, typed));
        } catch (_) {}
      } else {
        const typedHash = await hashLocal(uid, typed);
        const okCloud = await cloudOk(uid, typed);
        const okLocal = await localOk(uid, typed);
        if (!okCloud && !okLocal) { setMsg('adminGateMsg', 'Password not accepted.'); return; }
        try {
          await adminWorker('/v1/admin/password', {
            method: 'POST',
            body: JSON.stringify({ current_password: typed, next_password: typed }),
          });
        } catch (_) {}
        try { localSet(uid, typedHash); } catch (_) {}
        if (!okCloud) { try { await cloudSetHash(uid, typedHash); } catch (_) {} }
      }
    }
    __adminPass = typed;
    try { localStorage.setItem('naluno:pulse:staff', '1'); } catch (_) {}
    setMsg('adminGateMsg', 'Opening…', true);
    stampOperatorClaim();
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
    let workerOk = false;
    try {
      const res = await adminWorker('/v1/admin/password', {
        method: 'POST',
        body: JSON.stringify({ current_password: curTrim, next_password: nextTrim }),
      });
      workerOk = !!(res && res.ok);
      if (res && res.status === 401 && !okCloud && !okLocal) { toast('Current password is wrong'); return; }
    } catch (_) {}
    if (!workerOk) {
      const saved = await cloudSetHash(uid, hash);
      toast(saved.ok ? 'Password changed' : 'Phone updated. Worker copy failed.');
    } else {
      toast('Password changed');
    }
    __adminPass = nextTrim;
    await writeAudit('password-change', uid, 'operator changed console password');
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
    dropLiveListeners();
    __snap = null;
    __livePack = null;
    __spentLatch = {};
    setStage('sign');
    setMsg('signMsg', '');
    setMsg('adminGateMsg', '');
    try { document.title = 'Naluno'; } catch (_) {}
    if (fbAuth) fbAuth.signOut().catch(function () {});
  }
  function lockConsole() {
    __adminPass = '';
    dropLiveListeners();
    __snap = null;
    __livePack = null;
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
