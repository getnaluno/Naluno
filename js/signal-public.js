/* Signals for everyone (07 Oct c).

   A Signal its creator posts to "Everyone on Naluno" (the Signal maker's
   choice, the default) is shown to everyone in the Signals row, after the
   Signals of your own connections, for its 24 hours. Your connections see
   your Signals as before.

   Read from the desk's slim copy (signals/{id}): the database rules let
   anyone signed in read one only while it is public, not held for review
   and not taken down. The query asks for exactly that (public, not hidden,
   not held, posted today or yesterday), so no extra index is needed.
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
  function group(list) {
    var mine = me();
    var conn = connectedUids();
    var now = Date.now();
    var by = {};
    list.forEach(function (d) {
      if (!d || !d.uid || d.uid === mine || conn[d.uid]) return; /* yours and your connections' are already shown */
      if (!(Number(d.expiresAt) > now)) return;
      if (d.held || d.hidden || d.public !== true) return;
      if (!by[d.uid]) by[d.uid] = { uid: d.uid, name: String(d.name || 'Someone'), segs: [] };
      by[d.uid].segs.push(segFrom(d));
    });
    var out = Object.keys(by).map(function (k) {
      var r = by[k];
      r.segs.sort(function (a, b) { return a.createdAt - b.createdAt; });
      r.latest = r.segs[r.segs.length - 1];
      return r;
    });
    /* Newest first. */
    out.sort(function (a, b) { return b.latest.createdAt - a.latest.createdAt; });
    return out.slice(0, 30);
  }
  function load(force) {
    if (loading) return loading;
    if (!force && Date.now() - loadedAt < 120000) return Promise.resolve(rows);
    if (typeof fbDb === 'undefined' || !fbDb || !me()) return Promise.resolve(rows);
    /* Still live, newest first. Asked from five minutes ahead so a phone
       clock a little behind never asks for something the rules refuse. */
    loading = fbDb.collection('signals')
      .where('public', '==', true)
      .where('hidden', '==', false)
      .where('held', '==', false)
      .where('expiresAt', '>', Date.now() + 300000)
      .orderBy('expiresAt', 'desc')
      .limit(120)
      .get()
      .then(function (snap) {
        var list = [];
        snap.forEach(function (doc) { var d = doc.data() || {}; d.id = doc.id; list.push(d); });
        var before = JSON.stringify(rows.map(function (r) { return r.uid + ':' + r.segs.length; }));
        raw = list;
        rows = group(list);
        loadedAt = Date.now();
        var after = JSON.stringify(rows.map(function (r) { return r.uid + ':' + r.segs.length; }));
        if (before !== after) { try { if (typeof renderBroadcastTab === 'function') renderBroadcastTab(); } catch (_) {} }
        return rows;
      }, function (e) {
        /* Rules not published yet, or offline: no public Signals, nothing breaks. */
        try { console.warn('[signals] public', e && (e.code || e.message)); } catch (_) {}
        loadedAt = Date.now();
        return rows;
      })
      .then(function (r) { loading = null; return r; }, function () { loading = null; return rows; });
    return loading;
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
        + ((typeof signalTileCaption === 'function') ? signalTileCaption(first, 'Public', r.uid) : '<div class="signal-tile-cap"><strong>' + esc(first) + '</strong></div>')
        + '</div></div></div>';
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
    var segs = r.segs.filter(function (x) { return x && x.expiresAt > Date.now(); });
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
    load: load, tilesHtml: tilesHtml, bind: bind, open: open,
    rows: function () { return rows; }, _group: group, _segFrom: segFrom, _days: days, _safeColour: safeColour,
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
