/* Signals for everyone (07 Oct c).

   A Signal its creator posts to "Everyone on Naluno" (the Signal maker's
   choice, the default) is shown to everyone in the Signals row, after the
   Signals of your own connections, for its 24 hours. Your connections see
   your Signals as before.

   Read from the desk's slim copy (signals/{id}). The list asks for
   feedUntil after the server's clock. That field equals the expiry only
   while the Signal is public, not held and not taken down, so the rules
   can allow the query. The older public/hidden/held query remains as a
   fallback for a project that has not taken the new rules yet.
   Played in the existing Signal viewer. */
(function () {
  'use strict';
  var raw = [];           /* the public copies as read */
  var rows = [];          /* one entry per person: { uid, name, segs: [...] } */
  var loadedAt = 0;
  var loading = null;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function me() { try { return (typeof currentUser !== 'undefined' && currentUser && currentUser.uid) || ''; } catch (_) { return ''; } }
  function connectedUids() {
    var set = {};
    try {
      (typeof contacts !== 'undefined' && contacts ? contacts : []).forEach(function (c) { if (c && c.firebaseUid) set[c.firebaseUid] = 1; });
    } catch (_) {}
    return set;
  }
  function days() {
    var now = Date.now();
    return [new Date(now).toISOString().slice(0, 10), new Date(now - 86400000).toISOString().slice(0, 10)];
  }
  function safeColour(v) {
    var x = String(v || '');
    if (x.length > 300 || /url|expression|image|var\(|[;{}<>"\\]/i.test(x)) return false;
    return /^(#[0-9a-f]{3,8}|rgba?\([0-9.,\s%]+\)|hsla?\([0-9.,\s%deg]+\)|(linear|radial)-gradient\([#0-9a-z.,\s%()-]+\))$/i.test(x.trim());
  }
  function segFrom(doc) {
    var d = doc || {};
    var type = d.type || (d.videoUrl ? 'video' : (d.photoUrl ? 'photo' : (d.text ? 'text' : 'photo')));
    var seg = {
      id: d.id, type: type, createdAt: Number(d.createdAt) || Date.now(), expiresAt: Number(d.expiresAt) || 0,
      caption: d.caption || '', publicSignal: true,
    };
    if (d.videoUrl) seg.videoUrl = d.videoUrl;
    if (d.photoUrl) seg.photoUrl = d.photoUrl;
    if (d.thumbDataUrl) seg.thumbDataUrl = d.thumbDataUrl;
    if (d.text != null) seg.text = String(d.text).slice(0, 500);
    /* Colours from someone you do not know: plain colours and gradients
       only (nothing that could load from elsewhere). */
    ['bg', 'textColor'].forEach(function (k) { if (d[k] != null && safeColour(d[k])) seg[k] = String(d[k]); });
    ['fontKey', 'fontSize'].forEach(function (k) { if (d[k] != null) seg[k] = String(d[k]).replace(/[^a-z0-9_-]/gi, '').slice(0, 24); });
    if (d.filterCss && /^[a-z0-9()., %-]*$/i.test(String(d.filterCss)) && !/url|expression/i.test(String(d.filterCss))) seg.filterCss = String(d.filterCss).slice(0, 200);
    ['duration', 'trimStart', 'trimEnd'].forEach(function (k) { if (isFinite(Number(d[k]))) seg[k] = Number(d[k]); });
    return seg;
  }
  function signalNow() {
    try { if (typeof nalunoSignalNow === 'function') return nalunoSignalNow(); } catch (_) {}
    var k = serverSkew();
    return Date.now() + (k ? k.skew : 0);
  }
  function group(list) {
    var mine = me();
    var conn = connectedUids();
    var now = signalNow();
    var by = {};
    list.forEach(function (d) {
      if (!d || typeof d.uid !== 'string' || !d.uid || d.uid === '__proto__' || d.uid === 'constructor' || d.uid === 'prototype') return;
      if (d.uid === mine || conn[d.uid]) return; /* yours and your connections' are already shown */
      if (!(Number(d.expiresAt) > now)) return;
      if (d.held || d.hidden || d.public !== true) return;
      if (!by[d.uid]) by[d.uid] = { uid: d.uid, name: String(d.name || 'Someone'), segs: [] };
      by[d.uid].segs.push(segFrom(d));
    });
    var out = Object.keys(by).map(function (k) {
      var r = by[k];
      r.segs.sort(function (a, b) { return a.createdAt - b.createdAt; });
      /* The row needs the newest clip. Keep a few older ones so opening
         still plays the recent set, without one loud creator filling memory. */
      if (r.segs.length > 8) r.segs = r.segs.slice(-8);
      r.latest = r.segs[r.segs.length - 1];
      return r;
    });
    /* Newest first. No person-cap: a quiet Signal is not pushed out by busier ones. */
    out.sort(function (a, b) { return b.latest.createdAt - a.latest.createdAt; });
    return out;
  }
  /* 15 Oct: the rules let anyone read a public Signal only while its
     expiresAt is after the SERVER's clock, and refuse the whole query when
     the phone asks from an earlier moment (a phone clock running slow).
     The bound is the server's clock (measured, or the last one this phone
     measured) plus a minute. Without either, five minutes. A refusal
     measures again and asks further ahead (10 min, 1 h, 6 h). */
  /* The first read is four pages (the old 480). A full last page is NOT the
     end: the cursor is kept and another page is read while few creators have
     appeared, and again when the row is scrolled. A failed read does not
     count as a fresh empty catalogue and does not hide the last good row. */
  var PAGE = 120, FIRST_PAGES = 4, FOLLOW_CAP = 12, MIN_CREATORS = 24;
  var aheadExtra = 0, refusals = 0;
  var scanCursor = null, scanComplete = true, pagesRead = 0;
  var problem = null;
  var LADDER = [10 * 60000, 60 * 60000, 6 * 60 * 60000];
  var TRANSIENT = { unavailable: 1, 'deadline-exceeded': 1, aborted: 1, internal: 1, 'resource-exhausted': 1 };
  function serverSkew() {
    try { if (typeof nalunoServerSkew === 'number' && isFinite(nalunoServerSkew)) return { skew: nalunoServerSkew, measured: true }; } catch (_) {}
    try { if (typeof window.nalunoStoredSkew === 'number' && isFinite(window.nalunoStoredSkew)) return { skew: window.nalunoStoredSkew, measured: false }; } catch (_) {}
    return null;
  }
  /* A stored clock difference bigger than half an hour is not trusted.
     The service worker used to answer the clock check with a cached
     manifest, so the difference looked like days and every public query
     was refused. A difference measured this session is trusted. */
  function freshSkew(measured, stored) {
    if (typeof measured === 'number' && isFinite(measured) && Math.abs(measured) < 36 * 3600000) return { skew: measured, fresh: true };
    if (typeof stored === 'number' && isFinite(stored) && Math.abs(stored) < 30 * 60 * 1000) return { skew: stored, fresh: false };
    return null;
  }
  /* Expiry the rules will accept. A phone running fast writes "24 hours"
     past the server's 25-hour ceiling and the public copy is refused.
     With no fresh clock, 20 hours still fits a phone up to five hours fast. */
  function publicExpiry(wanted, now, measured, stored) {
    var k = freshSkew(measured, stored);
    var day = 24 * 60 * 60 * 1000;
    var cap = k ? (now + k.skew + day) : (now + 20 * 60 * 60 * 1000);
    var exp = (typeof wanted === 'number' && isFinite(wanted) && wanted > 0) ? wanted : cap;
    if (exp > cap) exp = cap;
    var floor = now + (k ? k.skew : 0) + 60000;
    if (exp < floor) exp = Math.min(cap, floor + 23 * 60 * 60 * 1000);
    return Math.round(exp);
  }
  function lowerBound() {
    var k = serverSkew();
    var measured = (k && k.measured) ? k.skew : null;
    var stored = null;
    try { if (typeof window.nalunoStoredSkew === 'number') stored = window.nalunoStoredSkew; } catch (_) {}
    if (k && !k.measured && typeof k.skew === 'number') stored = k.skew;
    var trusted = freshSkew(measured, measured != null ? null : stored);
    if (trusted && trusted.fresh) {
      k = { skew: trusted.skew, measured: true };
      if (k && k.measured) return Date.now() + k.skew + 60000 + aheadExtra;
    }
    var mild = freshSkew(null, stored);
    return Date.now() + (mild ? mild.skew : 0) + 300000 + aheadExtra;
  }
  function baseQuery(bound) {
    return fbDb.collection('signals')
      .where('feedUntil', '>', bound)
      .orderBy('feedUntil', 'desc');
  }
  /* The previous list. Kept so a project that already has its composite
     index still shows Signals posted before feedUntil existed. A missing
     index or a rules refusal does not hide the feedUntil list. */
  function legacyQuery(bound) {
    return fbDb.collection('signals')
      .where('public', '==', true)
      .where('hidden', '==', false)
      .where('held', '==', false)
      .where('expiresAt', '>', bound)
      .orderBy('expiresAt', 'desc');
  }
  function readPages(startCursor, maxPages) {
    var bound = lowerBound();
    var list = [];
    var last = startCursor || null;
    var n = 0;
    function page() {
      var q = baseQuery(bound).limit(PAGE);
      if (last) q = q.startAfter(last);
      return q.get().then(function (snap) {
        var docs = [];
        snap.forEach(function (doc) {
          docs.push(doc);
          var d = (doc && typeof doc.data === 'function' ? doc.data() : null) || {};
          d.id = doc.id;
          list.push(d);
        });
        n++;
        var full = docs.length === PAGE;
        if (full && n < maxPages) {
          last = docs[docs.length - 1];
          return page();
        }
        return { list: list, cursor: docs.length ? docs[docs.length - 1] : last, complete: !full, pages: n };
      });
    }
    return page();
  }
  function readLegacyOnce() {
    if (typeof fbDb === 'undefined' || !fbDb || !fbDb.collection) return Promise.resolve([]);
    return legacyQuery(lowerBound()).limit(PAGE).get().then(function (snap) {
      var list = [];
      snap.forEach(function (doc) {
        var d = (doc && typeof doc.data === 'function' ? doc.data() : null) || {};
        d.id = doc.id;
        list.push(d);
      });
      return list;
    }, function () { return []; });
  }
  function mergeRaw(extra) {
    var byId = {};
    raw.forEach(function (d) { if (d && d.id) byId[d.id] = d; });
    (extra || []).forEach(function (d) { if (d && d.id) byId[d.id] = d; });
    raw = Object.keys(byId).map(function (k) { return byId[k]; });
    rows = group(raw);
  }
  function noteProblem(e) {
    problem = {
      code: String((e && e.code) || 'error'),
      msg: String((e && e.message) || e || ''),
      at: Date.now(),
    };
    try { console.warn('[signals] public', problem.code, problem.msg); } catch (_) {}
    /* 15 Oct g: the database's words (and its index link) go to Naluno. */
    try { if (typeof nalunoDiag === 'function') nalunoDiag('public-signals', problem.code + ' ' + problem.msg.slice(0, 380)); } catch (_) {}
    try { if (typeof renderBroadcastTab === 'function') renderBroadcastTab(); } catch (_) {}
    return problem;
  }
  function problemText() {
    if (!problem) return '';
    if (problem.code === 'unavailable' || problem.code === 'deadline-exceeded') return 'No connection. Signals for everyone load when it is back.';
    return 'Signals for everyone couldn\u2019t load right now. Trying again…';
  }
  /* For Naluno's team (Diagnostics), never painted on a phone. */
  function indexLink() {
    if (!problem || problem.code !== 'failed-precondition') return '';
    var m = String(problem.msg || '').match(/https:\/\/console\.firebase\.google\.com\/[^\s"'<>]+/);
    return m ? m[0] : '';
  }
  function applyPack(pack) {
    mergeRaw(pack.list);
    pagesRead += pack.pages || 0;
    scanComplete = !!pack.complete;
    scanCursor = scanComplete ? null : pack.cursor;
    problem = null;
    loadedAt = Date.now();
    try { if (typeof renderBroadcastTab === 'function') renderBroadcastTab(); } catch (_) {}
    return rows;
  }
  function followIfThin(pack) {
    applyPack(pack);
    if (!scanComplete && rows.length < MIN_CREATORS && pagesRead < FOLLOW_CAP && scanCursor) {
      return readPages(scanCursor, 1).then(followIfThin, function (e) {
        noteProblem(e);
        return rows;
      });
    }
    return rows;
  }
  function afterRefusal() {
    if (refusals >= LADDER.length + 1) return Promise.resolve(false);
    refusals++;
    var before = serverSkew();
    var m = null;
    try { if (typeof window.nalunoMeasureSkew === 'function') m = window.nalunoMeasureSkew(); } catch (_) {}
    return Promise.race([Promise.resolve(m).catch(function () {}), new Promise(function (r) { setTimeout(r, 3000); })]).then(function () {
      var after = serverSkew();
      if (refusals === 1 && after && after.measured && !(before && before.measured)) aheadExtra = 0;
      else aheadExtra = LADDER[Math.min(refusals - 1, LADDER.length - 1)];
      return true;
    });
  }
  function load(force) {
    if (loading) return loading;
    if (!force && loadedAt && Date.now() - loadedAt < 120000) return Promise.resolve(rows);
    if (typeof fbDb === 'undefined' || !fbDb || !me()) return Promise.resolve(rows);
    var transientTries = 0;
    function fail(e) {
      noteProblem(e);
      var code = e && e.code;
      if (TRANSIENT[code] && transientTries < 3) {
        transientTries++;
        var wait = 400 * Math.pow(2, transientTries - 1);
        return new Promise(function (r) { setTimeout(r, wait); }).then(attempt);
      }
      return rows;
    }
    function begin(pack) {
      raw = [];
      pagesRead = 0;
      return followIfThin(pack);
    }
    function attempt() {
      function withLegacy(pack) {
        return readLegacyOnce().then(function (extra) {
          pack.list = (pack.list || []).concat(extra || []);
          return begin(pack);
        });
      }
      return readPages(null, FIRST_PAGES).then(withLegacy, function (e) {
        var code = e && e.code;
        /* feedUntil is the list the rules can prove. If this project has not
           taken the new rules yet, the older composite query still works. */
        if (code === 'permission-denied' || code === 'failed-precondition') {
          return legacyQuery(lowerBound()).limit(PAGE).get().then(function (snap) {
            var list = [];
            snap.forEach(function (doc) {
              var d = (doc && typeof doc.data === 'function' ? doc.data() : null) || {};
              d.id = doc.id;
              list.push(d);
            });
            return begin({ list: list, cursor: null, complete: true, pages: 1 });
          }, function (e2) {
            if (e2 && e2.code === 'permission-denied') {
              return afterRefusal().then(function (again) { if (again) return attempt(); return fail(e2); });
            }
            return fail(e2 || e);
          });
        }
        return fail(e);
      });
    }
    loading = attempt().then(function (r) { loading = null; return r; }, function () { loading = null; return rows; });
    return loading;
  }
  function loadMore(fromUser) {
    if (loading || scanComplete || !scanCursor) return Promise.resolve(rows);
    if (!fromUser && pagesRead >= FOLLOW_CAP) return Promise.resolve(rows);
    if (typeof fbDb === 'undefined' || !fbDb || !me()) return Promise.resolve(rows);
    loading = readPages(scanCursor, 1).then(function (pack) {
      return applyPack(pack);
    }, function (e) {
      noteProblem(e);
      return rows;
    }).then(function (r) { loading = null; return r; }, function () { loading = null; return rows; });
    return loading;
  }
  function armStrip(strip) {
    if (!strip || strip.__pubMore) return;
    strip.__pubMore = true;
    strip.addEventListener('scroll', function () {
      if (scanComplete || !scanCursor) return;
      if (strip.scrollLeft + strip.clientWidth > strip.scrollWidth - 80) loadMore(true);
    }, { passive: true });
  }

  /* Tiles for the Signals row (signal-ui.js renders them after your
     connections'). */
  function tilesHtml() {
    /* Grouped again each time: your connections (which may load after the
       public list) and expiry are always current. */
    rows = group(raw);
    if (!rows.length) return '';
    var safe = function (u) {
      u = String(u || '');
      return /^(https?:|data:image\/)/i.test(u) ? esc(u) : '';
    };
    return rows.map(function (r, i) {
      var s = r.latest || {};
      var inner;
      var img = safe(s.thumbDataUrl || s.photoUrl);
      if (s.type === 'text') {
        var st = (typeof signalTextCardStyle === 'function') ? signalTextCardStyle(s) : ('background:' + (s.bg || '#333') + ';');
        var clean = (typeof signalSafeStyle === 'function') ? signalSafeStyle(st) : '';
        inner = '<div class="avatar" style="width:100%;height:100%;' + clean + 'font-size:9px;padding:4px;text-align:center;line-height:1.15;">' + esc(String(s.text || '').slice(0, 26)) + '</div>';
      } else if (img) {
        inner = '<img src="' + img + '" class="mysignal-thumb" alt="" />';
      } else {
        inner = '<div class="avatar" style="width:100%;height:100%;background:#1F2333;font-size:11px;color:#7CFFB2;">▶</div>';
      }
      var first = String(r.name || 'Someone').split(' ')[0];
      return '<div class="bcast-item signal-tile signal-public" data-public-signal="' + i + '">'
        + '<div class="signal-window">'
        + ((typeof signalEdgeHtml === 'function') ? signalEdgeHtml() : '')
        + '<div class="signal-window-in">' + inner
        + '<span class="signal-public-tag">Everyone</span>'
        + '<span class="signal-play">▶</span>'
        + '</div></div>'
        + ((typeof signalTileCaption === 'function') ? signalTileCaption(first, 'Public', r.uid) : '<div class="signal-tile-cap"><strong>' + esc(first) + '</strong></div>')
        + '</div>';
    }).join('');
  }
  function bind(strip) {
    if (!strip) return;
    strip.querySelectorAll('[data-public-signal]').forEach(function (el) {
      el.onclick = function () { open(Number(el.getAttribute('data-public-signal'))); };
    });
  }

  /* Play one person's public Signals in the Signal viewer. */
  function open(i) {
    var r = rows[i];
    if (!r) return;
    var segs = r.segs.filter(function (x) { return x && x.expiresAt > signalNow(); });
    if (!segs.length) { try { toast('Signal expired'); } catch (_) {} return; }
    try {
      viewingMine = false;
      currentSegments = segs;
      currentSegments.forEach(function (seg) { try { signalPlaySrc(seg); } catch (_) {} });
      currentStoryOwnerUid = r.uid;
      currentSegmentIndex = 0;
      var nameEl = document.getElementById('bviewerName');
      if (nameEl) { nameEl.setAttribute('data-known-uid', r.uid); nameEl.textContent = r.name || 'Signal'; }
      var av = document.getElementById('bviewerAvatar');
      if (av) {
        if (typeof applyContactAvatarToEl === 'function') applyContactAvatarToEl(av, { name: r.name, initials: String(r.name || '?').slice(0, 1).toUpperCase(), color: '#7CFFB2' });
        else { av.textContent = String(r.name || '?').slice(0, 1).toUpperCase(); }
      }
      var v = document.getElementById('bviewer');
      if (v && !v.classList.contains('active')) {
        v.classList.add('active');
        try { if (window.nalunoBack) window.nalunoBack.push(); } catch (_) {}
      }
      if (typeof renderBars === 'function') renderBars(currentSegments.length);
      if (typeof playSegment === 'function') playSegment(0);
      try { if (window.NalunoKnown && NalunoKnown.paintBeside && nameEl) NalunoKnown.paintBeside(nameEl, r.uid); } catch (_) {}
    } catch (e) {
      try { console.warn('[signals] open public', e); toast('Could not open that Signal'); } catch (_) {}
    }
  }

  window.NalunoPublicSignals = {
    load: load, loadMore: loadMore, tilesHtml: tilesHtml, bind: bind, open: open, armStrip: armStrip,
    problemText: problemText, indexLink: indexLink,
    rows: function () { return rows; },
    status: function () { return { complete: scanComplete, pages: pagesRead, problem: problem }; },
    _group: group, _segFrom: segFrom, _days: days, _safeColour: safeColour, _now: signalNow,
    _lowerBound: lowerBound,
    freshSkew: freshSkew, publicExpiry: publicExpiry,
  };
  window.nalunoPublicSignalTilesHtml = tilesHtml;

  /* Keep it fresh while the Broadcast tab is open. */
  setInterval(function () {
    try {
      var tab = document.getElementById('tab-broadcast');
      if (tab && tab.classList.contains('active') && !document.hidden) load(false);
    } catch (_) {}
  }, 60000);
})();
