/* Public-site and app-open pulse. Anonymous. No Callsign. The Control Centre
   reads siteSessions + siteDays. Failures are silent — the page must never
   depend on this. */
(function () {
  try {
    var PATH = (location.pathname || '/').replace(/\/+$/, '') || '/';
    var IS_APP = PATH.indexOf('/app') === 0;
    var DAY_KEY = 'naluno:pulse:app:' + ymd(new Date());

    function ymd(d) {
      return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    }
    function rid() {
      try { if (crypto.randomUUID) return crypto.randomUUID(); } catch (_) {}
      return 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 12);
    }
    function clip(s, n) {
      s = String(s == null ? '' : s);
      return s.length > n ? s.slice(0, n) : s;
    }
    function storeGet(which, key) {
      try { return which.getItem(key) || ''; } catch (_) { return ''; }
    }
    function storeSet(which, key, val) {
      try { which.setItem(key, val); } catch (_) {}
    }

    var vid = storeGet(localStorage, 'naluno:pulse:vid');
    if (!vid) { vid = rid(); storeSet(localStorage, 'naluno:pulse:vid', vid); }
    var sid = storeGet(sessionStorage, 'naluno:pulse:sid');
    if (!sid) { sid = rid(); storeSet(sessionStorage, 'naluno:pulse:sid', sid); }
    var docId = (IS_APP ? 'a_' : 'w_') + sid;
    var fresh = !storeGet(localStorage, 'naluno:pulse:seen');
    storeSet(localStorage, 'naluno:pulse:seen', '1');

    var TZ_CC = {
      'Africa/Kampala': 'UG', 'Africa/Nairobi': 'KE', 'Africa/Lagos': 'NG', 'Africa/Accra': 'GH',
      'Africa/Johannesburg': 'ZA', 'Africa/Cairo': 'EG', 'Africa/Casablanca': 'MA', 'Africa/Addis_Ababa': 'ET',
      'Africa/Dar_es_Salaam': 'TZ', 'Africa/Kigali': 'RW', 'Africa/Khartoum': 'SD', 'Africa/Algiers': 'DZ',
      'Africa/Tunis': 'TN', 'Africa/Harare': 'ZW', 'Africa/Lusaka': 'ZM', 'Africa/Maputo': 'MZ',
      'Africa/Windhoek': 'NA', 'Africa/Gaborone': 'BW', 'Africa/Mogadishu': 'SO', 'Africa/Djibouti': 'DJ',
      'Africa/Juba': 'SS', 'Africa/Tripoli': 'LY', 'Africa/Ndjamena': 'TD', 'Africa/Douala': 'CM',
      'Africa/Kinshasa': 'CD', 'Africa/Lubumbashi': 'CD', 'Africa/Bujumbura': 'BI', 'Africa/Maseru': 'LS',
      'Africa/Mbabane': 'SZ', 'Africa/Bamako': 'ML', 'Africa/Abidjan': 'CI', 'Africa/Dakar': 'SN',
      'Asia/Dubai': 'AE', 'Asia/Muscat': 'OM', 'Asia/Qatar': 'QA', 'Asia/Bahrain': 'BH', 'Asia/Kuwait': 'KW',
      'Asia/Riyadh': 'SA', 'Asia/Baghdad': 'IQ', 'Asia/Tehran': 'IR', 'Asia/Karachi': 'PK', 'Asia/Kolkata': 'IN',
      'Asia/Colombo': 'LK', 'Asia/Dhaka': 'BD', 'Asia/Kathmandu': 'NP', 'Asia/Yangon': 'MM', 'Asia/Bangkok': 'TH',
      'Asia/Jakarta': 'ID', 'Asia/Singapore': 'SG', 'Asia/Kuala_Lumpur': 'MY', 'Asia/Manila': 'PH',
      'Asia/Hong_Kong': 'HK', 'Asia/Shanghai': 'CN', 'Asia/Taipei': 'TW', 'Asia/Seoul': 'KR', 'Asia/Tokyo': 'JP',
      'Asia/Jerusalem': 'IL', 'Asia/Amman': 'JO', 'Asia/Beirut': 'LB', 'Asia/Damascus': 'SY',
      'Asia/Istanbul': 'TR', 'Europe/Istanbul': 'TR', 'Europe/London': 'GB', 'Europe/Dublin': 'IE',
      'Europe/Paris': 'FR', 'Europe/Berlin': 'DE', 'Europe/Rome': 'IT', 'Europe/Madrid': 'ES',
      'Europe/Amsterdam': 'NL', 'Europe/Brussels': 'BE', 'Europe/Zurich': 'CH', 'Europe/Vienna': 'AT',
      'Europe/Stockholm': 'SE', 'Europe/Oslo': 'NO', 'Europe/Copenhagen': 'DK', 'Europe/Helsinki': 'FI',
      'Europe/Warsaw': 'PL', 'Europe/Prague': 'CZ', 'Europe/Budapest': 'HU', 'Europe/Bucharest': 'RO',
      'Europe/Athens': 'GR', 'Europe/Lisbon': 'PT', 'Europe/Moscow': 'RU', 'Europe/Kyiv': 'UA',
      'America/New_York': 'US', 'America/Chicago': 'US', 'America/Denver': 'US', 'America/Los_Angeles': 'US',
      'America/Phoenix': 'US', 'America/Toronto': 'CA', 'America/Vancouver': 'CA', 'America/Mexico_City': 'MX',
      'America/Sao_Paulo': 'BR', 'America/Argentina/Buenos_Aires': 'AR', 'America/Bogota': 'CO',
      'America/Lima': 'PE', 'America/Santiago': 'CL', 'America/Caracas': 'VE', 'America/Jamaica': 'JM',
      'Australia/Sydney': 'AU', 'Australia/Melbourne': 'AU', 'Pacific/Auckland': 'NZ',
      'Atlantic/Reykjavik': 'IS'
    };

    function parseUA(ua) {
      ua = String(ua || '');
      var os = /Android/i.test(ua) ? 'Android'
        : /iPhone|iPad|iPod/i.test(ua) ? 'iOS'
        : /Mac OS X/i.test(ua) ? 'macOS'
        : /Windows/i.test(ua) ? 'Windows'
        : /Linux/i.test(ua) ? 'Linux' : 'Other';
      var browser = /Edg\//.test(ua) ? 'Edge'
        : /OPR\/|Opera/i.test(ua) ? 'Opera'
        : /SamsungBrowser/i.test(ua) ? 'Samsung'
        : /Firefox\//.test(ua) ? 'Firefox'
        : /Chrome\//.test(ua) || /CriOS\//.test(ua) ? 'Chrome'
        : /Safari\//.test(ua) ? 'Safari' : 'Other';
      var form = /iPad|Tablet|PlayBook/i.test(ua) ? 'tablet'
        : /Mobi|Android.+Mobile|iPhone|iPod/i.test(ua) ? 'phone' : 'desktop';
      return { os: os, browser: browser, form: form };
    }
    function refHost() {
      var r = document.referrer || '';
      if (!r) return 'direct';
      try {
        var u = new URL(r);
        if (u.hostname === location.hostname) return 'internal';
        return clip(u.hostname.replace(/^www\./, ''), 80);
      } catch (_) { return 'direct'; }
    }
    function utmBlob() {
      try {
        var q = new URLSearchParams(location.search || '');
        var parts = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term']
          .map(function (k) { return q.get(k) ? k.replace('utm_', '') + '=' + q.get(k) : ''; })
          .filter(Boolean);
        return clip(parts.join('&'), 120);
      } catch (_) { return ''; }
    }
    function pathKey() {
      if (IS_APP) return '/app';
      if (PATH === '/privacy' || PATH.indexOf('/privacy') === 0) return '/privacy';
      if (PATH === '/terms' || PATH.indexOf('/terms') === 0) return '/terms';
      if (PATH === '' || PATH === '/') return '/';
      return clip(PATH, 40);
    }
    function connType() {
      try {
        var c = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
        return c && c.effectiveType ? clip(c.effectiveType, 12) : '';
      } catch (_) { return ''; }
    }

    var uaInfo = parseUA(navigator.userAgent || '');
    var tz = '';
    try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (_) {}
    var country = TZ_CC[tz] || '';
    var region = '';
    var city = '';
    var lang = clip((navigator.language || '').toLowerCase(), 12);
    var screenS = '';
    try { screenS = (window.screen.width || 0) + 'x' + (window.screen.height || 0); } catch (_) {}
    var standalone = false;
    try {
      standalone = !!(window.matchMedia && window.matchMedia('(display-mode: standalone)').matches)
        || window.navigator.standalone === true;
    } catch (_) {}

    var startedAt = Date.now();
    var accMs = 0;
    var visAt = Date.now();
    var scrollPct = 0;
    var openApp = 0;
    var contact = 0;
    var tune = 0;
    var lastFlushMs = 0;
    var dayIncd = false;
    var db = null;
    var wrote = false;

    function visibleMs() {
      var extra = document.hidden ? 0 : Math.max(0, Date.now() - visAt);
      return accMs + extra;
    }

    function getDb() {
      if (db) return Promise.resolve(db);
      return new Promise(function (resolve, reject) {
        try {
          if (typeof firebase === 'undefined' || !firebase.firestore) return reject();
          var cfg = (typeof firebaseConfig !== 'undefined') ? firebaseConfig : null;
          if (!firebase.apps || !firebase.apps.length) {
            if (!cfg) return reject();
            firebase.initializeApp(cfg);
          }
          db = firebase.firestore();
          resolve(db);
        } catch (e) { reject(e); }
      });
    }

    function geoThen() {
      return new Promise(function (resolve) {
        var done = false;
        function finish() { if (done) return; done = true; resolve(); }
        try {
          var t = setTimeout(finish, 2200);
          fetch('https://get.geojs.io/v1/ip/geo.json', { credentials: 'omit', cache: 'no-store' })
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(function (j) {
              clearTimeout(t);
              if (j) {
                var cc = String(j.country_code || j.country || '').toUpperCase();
                if (/^[A-Z]{2}$/.test(cc)) country = cc;
                region = clip(j.region || '', 40);
                city = clip(j.city || '', 40);
                if (!tz && j.timezone) tz = clip(j.timezone, 40);
              }
              finish();
            })
            .catch(function () { clearTimeout(t); finish(); });
        } catch (_) { finish(); }
      });
    }

    function sessionPayload(extra) {
      var ms = Math.min(visibleMs(), 172800000);
      var row = {
        vid: clip(vid, 80),
        kind: IS_APP ? 'app' : 'web',
        path: pathKey(),
        hash: clip((location.hash || '').replace(/^#/, ''), 24),
        ref: refHost(),
        utm: utmBlob(),
        country: clip(country, 4),
        region: region,
        city: city,
        tz: clip(tz, 40),
        lang: lang,
        device: uaInfo.form,
        os: uaInfo.os,
        browser: uaInfo.browser,
        screen: clip(screenS, 16),
        startedAt: startedAt,
        lastAt: Date.now(),
        ms: ms,
        openApp: openApp,
        contact: contact,
        tune: tune,
        scroll: scrollPct,
        ua: clip(navigator.userAgent || '', 160),
        standalone: !!standalone,
        conn: connType(),
        fresh: !!fresh
      };
      if (extra) Object.keys(extra).forEach(function (k) { row[k] = extra[k]; });
      return row;
    }

    function writeSession() {
      return getDb().then(function (firestore) {
        return firestore.collection('siteSessions').doc(docId).set(sessionPayload(), { merge: true });
      }).then(function () { wrote = true; }).catch(function () {});
    }

    function incDay(fields) {
      return getDb().then(function (firestore) {
        var inc = firebase.firestore.FieldValue.increment;
        var patch = { updatedAt: Date.now() };
        Object.keys(fields || {}).forEach(function (k) {
          var v = fields[k];
          if (typeof v === 'number' && v) patch[k] = inc(v);
        });
        if (country && /^[A-Z]{2}$/.test(country) && (fields.visits || fields.appOpens)) {
          patch['countries.' + country] = inc(1);
        }
        if (uaInfo.form && fields.visits) patch['devices.' + uaInfo.form] = inc(1);
        if (fields.visits) {
          var host = refHost().replace(/[./]/g, '_');
          if (host) patch['refs.' + clip(host, 40)] = inc(1);
          patch['paths.' + pathKey().replace(/[./]/g, '_') ] = inc(1);
        }
        return firestore.collection('siteDays').doc(ymd(new Date())).set(patch, { merge: true });
      }).catch(function () {});
    }

    function flush(forceDay) {
      var ms = visibleMs();
      var delta = Math.max(0, ms - lastFlushMs);
      lastFlushMs = ms;
      var p = writeSession();
      if (forceDay && !dayIncd && !IS_APP) {
        dayIncd = true;
        p = p.then(function () {
          return incDay({ visits: 1, uniques: fresh ? 1 : 0, ms: delta || 1 });
        });
      } else if (delta > 4000) {
        p = p.then(function () { return incDay({ ms: delta }); });
      }
      return p;
    }

    function bump(field) {
      if (field === 'openApp') openApp += 1;
      if (field === 'contact') contact += 1;
      if (field === 'tune') tune += 1;
      writeSession();
      var o = {}; o[field] = 1;
      incDay(o);
    }

    window.nalunoPulse = function (name) {
      try { bump(String(name || '')); } catch (_) {}
    };

    function onScroll() {
      try {
        var h = document.documentElement;
        var max = Math.max(1, (h.scrollHeight || 1) - (window.innerHeight || 1));
        var pct = Math.round(100 * (window.scrollY || h.scrollTop || 0) / max);
        if (pct > scrollPct) scrollPct = Math.min(100, pct);
      } catch (_) {}
    }

    document.addEventListener('click', function (e) {
      var t = e.target;
      if (!t || !t.closest) return;
      var a = t.closest('a');
      if (a) {
        var href = a.getAttribute('href') || '';
        if (href === '/app' || href === '/app/' || href.indexOf('/app/') === 0 || href.indexOf('/app?') === 0) {
          bump('openApp');
        }
      }
      var st = t.closest && t.closest('#stations button');
      if (st) bump('tune');
    }, true);

    document.addEventListener('visibilitychange', function () {
      if (document.hidden) {
        accMs += Math.max(0, Date.now() - visAt);
        flush(false);
      } else {
        visAt = Date.now();
      }
    });
    window.addEventListener('pagehide', function () { flush(false); });
    window.addEventListener('scroll', onScroll, { passive: true });

    function startWeb() {
      geoThen().then(function () {
        return flush(true);
      });
      setInterval(function () {
        if (document.hidden) return;
        flush(false);
      }, 45000);
    }

    function startApp() {
      if (storeGet(localStorage, DAY_KEY)) return;
      storeSet(localStorage, DAY_KEY, '1');
      geoThen().then(function () {
        openApp = 1;
        return writeSession();
      }).then(function () {
        return incDay({ appOpens: 1, openApp: 1 });
      });
    }

    if (IS_APP) startApp();
    else startWeb();
  } catch (_) {}
})();
