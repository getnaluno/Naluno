/* ============================================================
   MODULE: js/measure.js  (20 Oct c)
   What Naluno measures, from this phone: counts, times and outcomes.
   Never words, pictures, sound, search text, numbers, addresses or a
   phone's location. Every value is a label from a short list (a time is
   sent as a band like "1to5m", never the exact seconds), and the worker
   drops anything that is not on its list (workers/economy/measure.mjs).
   Events wait on the phone (at most 300) and leave in small batches every
   minute and when the app is put away. Fire and forget: a failure here
   never changes anything in the app.
   ============================================================ */
(function (root) {
  var KEY = 'nalunoMeasureQ';
  var ONCE = 'nalunoMeasureOnce';
  var DEVICE = 'nalunoMeasureDevice';
  var MAX = 300;
  var URL = 'https://naluno-economy.naluno.workers.dev/v1/measure';
  var q = null;
  var sending = false;

  function store() { try { return root.localStorage; } catch (_) { return null; } }
  function load() {
    if (q) return q;
    try { q = JSON.parse((store() && store().getItem(KEY)) || '[]'); } catch (_) { q = []; }
    if (!Array.isArray(q)) q = [];
    return q;
  }
  function save() { try { var s = store(); if (s) s.setItem(KEY, JSON.stringify(q.slice(-MAX))); } catch (_) {} }
  function device() {
    try {
      var s = store();
      var d = s && s.getItem(DEVICE);
      if (!d) { d = 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10); if (s) s.setItem(DEVICE, d); }
      return d;
    } catch (_) { return ''; }
  }
  function clean(p) {
    var out = {};
    if (!p || typeof p !== 'object') return out;
    Object.keys(p).slice(0, 16).forEach(function (k) {
      var v = p[k];
      if (v == null) return;
      if (typeof v === 'boolean') v = v ? '1' : '0';
      v = String(v);
      if (v.length > 24 || !/^[A-Za-z0-9.+-]+$/.test(v)) return;
      out[k] = v;
    });
    return out;
  }
  function measure(name, props) {
    try {
      if (!name) return;
      load();
      q.push({ n: String(name).slice(0, 40), p: clean(props), t: Date.now() });
      if (q.length > MAX) q.splice(0, q.length - MAX);
      save();
    } catch (_) {}
  }
  /* Once per phone for this exact event (a step of the welcome, the first connection). */
  function measureOnce(name, props) {
    try {
      var s = store();
      var seen = {};
      try { seen = JSON.parse((s && s.getItem(ONCE)) || '{}') || {}; } catch (_) { seen = {}; }
      var key = name + ':' + JSON.stringify(clean(props));
      if (seen[key]) return false;
      seen[key] = 1;
      if (s) s.setItem(ONCE, JSON.stringify(seen));
      measure(name, props);
      return true;
    } catch (_) { return false; }
  }
  /* Bands, so no exact time leaves the phone. */
  function band(ms, edges, labels) {
    var x = Number(ms);
    if (!(x >= 0)) return labels[labels.length - 1];
    for (var i = 0; i < edges.length; i++) if (x < edges[i]) return labels[i];
    return labels[labels.length - 1];
  }
  var S = 1000, M = 60 * S, H = 60 * M, D = 24 * H;
  var Bands = {
    len: function (ms) { return band(ms, [M, 5 * M, 20 * M], ['lt1m', '1to5m', '5to20m', '20mplus']); },
    ring: function (ms) { return ms == null ? 'none' : band(ms, [5 * S, 15 * S, 30 * S], ['lt5s', '5to15s', '15to30s', '30splus']); },
    lag: function (ms) { return band(ms, [2 * S, 10 * S, M, 10 * M], ['lt2s', '2to10s', '10to60s', '1to10m', '10mplus']); },
    slow: function (ms) { return band(ms, [M, 10 * M, H], ['lt1m', '1to10m', '10to60m', '1hplus']); },
    wait: function (ms) { return band(ms, [H, D, 7 * D], ['lt1h', '1to24h', '1to7d', '7dplus']); },
    vlen: function (ms) { return band(ms, [10 * S, 30 * S, M, 2 * M], ['lt10s', '10to30s', '30to60s', '1to2m', '2mplus']); },
    count: function (n) { n = Number(n) || 0; return n <= 0 ? '0' : (n <= 2 ? '1to2' : (n <= 9 ? '3to9' : '10plus')); },
    people: function (n) { n = Number(n) || 0; return n <= 1 ? '1' : (n === 2 ? '2' : (n <= 5 ? '3to5' : (n <= 12 ? '6to12' : (n <= 50 ? '13to50' : '51plus')))); },
    ms: function (ms) { return band(ms, [S, 2 * S, 4 * S, 8 * S], ['lt1s', '1to2s', '2to4s', '4to8s', '8splus']); },
    pub: function (ms) { return band(ms, [10 * S, 30 * S, 120 * S], ['lt10s', '10to30s', '30to120s', '2mplus']); },
    live: function (ms) { return band(ms, [5 * M, 15 * M, H], ['lt5m', '5to15m', '15to60m', '1hplus']); },
  };
  function platform() {
    try {
      if (root.Capacitor && root.Capacitor.isNativePlatform && root.Capacitor.isNativePlatform()) return 'android';
      if (root.matchMedia && root.matchMedia('(display-mode: standalone)').matches) return 'pwa';
    } catch (_) {}
    return 'browser';
  }
  function build() {
    try { var m = document.querySelector('meta[name="naluno-build"]'); return String((m && m.content) || '').replace(/\./g, ''); } catch (_) { return ''; }
  }
  async function flush(viaBeacon) {
    if (sending) return;
    load();
    if (!q.length) return;
    if (root.navigator && root.navigator.onLine === false) return;
    var part = q.slice(0, 100);
    var tok = '';
    try {
      var u = (typeof currentUser !== 'undefined' && currentUser) ? currentUser : null;
      if (u && u.getIdToken) tok = await u.getIdToken();
    } catch (_) { tok = ''; }
    var body = JSON.stringify({ d: device(), events: part });
    sending = true;
    try {
      var headers = { 'Content-Type': 'application/json' };
      if (tok) headers.Authorization = 'Bearer ' + tok;
      var r = await fetch(URL, { method: 'POST', headers: headers, body: body, keepalive: !!viaBeacon, cache: 'no-store' });
      if (r && (r.ok || r.status === 400 || r.status === 413)) {
        q.splice(0, part.length);
        save();
      }
    } catch (_) {
    } finally { sending = false; }
  }

  /* ---- what this module measures by itself: the app's own health ---- */
  var started = (root.performance && performance.timeOrigin) ? performance.timeOrigin : Date.now();
  function appOpen() {
    var cold = 1;
    try { cold = sessionStorage.getItem('nalunoMeasureOpen') ? 0 : 1; sessionStorage.setItem('nalunoMeasureOpen', '1'); } catch (_) {}
    var lang = 'en';
    try { lang = localStorage.getItem('nalunoLang') === 'lg' ? 'lg' : 'en'; } catch (_) {}
    measure('app_open', { platform: platform(), build: build(), lang: lang, cold: cold });
    /* The last session did not close cleanly (a crash, or the system killed it). */
    try {
      if (localStorage.getItem('nalunoMeasureAlive') === '1' && cold) measure('crash_reload', {});
      localStorage.setItem('nalunoMeasureAlive', '1');
    } catch (_) {}
  }
  var readySent = false;
  /* Called by the app when the first real screen is showing. */
  function ready(first) {
    if (readySent) return;
    readySent = true;
    measure('app_ready', { ms: Bands.ms(Date.now() - started), first: first || 'other' });
  }
  function watchReady() {
    var tries = 0;
    var t = setInterval(function () {
      tries++;
      try {
        /* Behind the sign-in or the welcome, this start is not the app getting ready. */
        if (document.body && document.body.classList.contains('naluno-gated')) { clearInterval(t); return; }
        var feed = document.querySelector('#bcastPlateGrid > *');
        var freq = document.querySelector('#strongList > *, #weakList > *');
        if (feed || freq) { clearInterval(t); ready(freq ? 'frequencies' : 'feed'); return; }
      } catch (_) {}
      if (tries > 120) clearInterval(t);
    }, 250);
  }
  /* Offline periods, by length (where: the network's country, read by the worker when the batch leaves). */
  var offAt = 0;
  try {
    root.addEventListener('offline', function () { offAt = Date.now(); });
    root.addEventListener('online', function () {
      if (offAt) measure('offline', { len: Bands.slow(Date.now() - offAt) });
      offAt = 0;
      setTimeout(function () { flush(); }, 3000);
    });
    root.addEventListener('pagehide', function () {
      try { localStorage.setItem('nalunoMeasureAlive', '0'); } catch (_) {}
      flush(true);
    });
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') flush(true);
      else { try { localStorage.setItem('nalunoMeasureAlive', '1'); } catch (_) {} }
    });
    /* A full phone: writes refused for lack of space. */
    var full = false;
    var onErr = function (e) {
      var r = e && (e.reason || e.error);
      var n = String((r && r.name) || (e && e.message) || '');
      if (!full && /QuotaExceeded/i.test(n)) { full = true; measure('storage_full', {}); }
    };
    root.addEventListener('error', onErr);
    root.addEventListener('unhandledrejection', onErr);
  } catch (_) {}
  /* Notification permission, once per answer. */
  function notifState() {
    try {
      if (root.Notification && Notification.permission) measureOnce('notif_permission', { result: Notification.permission });
    } catch (_) {}
  }

  root.nalunoMeasure = measure;
  root.nalunoMeasureOnce = measureOnce;
  root.nalunoMeasureBands = Bands;
  root.nalunoMeasureReady = ready;
  root.nalunoMeasureFlush = flush;
  root.nalunoMeasureQueue = function () { return load().slice(); };

  try {
    appOpen();
    watchReady();
    setInterval(notifState, 30000);
    setTimeout(notifState, 5000);
    setInterval(function () { flush(); }, 60000);
    setTimeout(function () { flush(); }, 15000);
  } catch (_) {}
})(typeof window !== 'undefined' ? window : globalThis);
