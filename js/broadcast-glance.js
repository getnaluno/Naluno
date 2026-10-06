/* Broadcast at first sight (07 Oct b).

   The Broadcast tab opened on a page for making things (Signals, Video,
   Go live, Write, description, share, "Under this — swipe up"), and each
   Broadcast after it was a dark frame with "tap to play" and a small
   title. Someone new could not tell what was there without tapping.

   Now, in Naluno's own way:
   - The tab opens on what people made: the Signals row, then the first
     Broadcast, whole, on the same screen. Making lives behind one "+"
     ("Go on air"), with the same Video / Write / Go live / Signal paths.
   - Every Broadcast says what it is before a tap: Watch, Read or Live
     (and Luganda when it is), who made it with their Known mark, how many
     have seen it and how long ago.
   - A written Broadcast is a page of words with Listen on it: tap and
     Naluno's own voice reads it (Luganda in the African voice), right in
     the feed.
   - A tuner under the tabs: All · Watch · Read · Live · Luganda.
   - "⋯" on every Broadcast: why it is shown, more like this, not
     interested, hide this creator. The ranking already listens to these.
   - Previews play by themselves on Wi-Fi and fast data; when the phone
     asks to save data, or the connection is slow, they wait for a tap.

   Nothing that opens, plays, posts or ranks a Broadcast is replaced: the
   buttons in the "+" sheet press the existing ones. */
(function () {
  'use strict';

  var KIND_KEY = 'nalunoBcastKind';
  var KINDS = [
    { id: 'all', label: 'All' },
    { id: 'watch', label: 'Watch' },
    { id: 'read', label: 'Read' },
    { id: 'live', label: 'Live' },
    { id: 'lg', label: 'Luganda' },
  ];
  var kind = 'all';
  try { var saved = sessionStorage.getItem(KIND_KEY); if (saved && KINDS.some(function (k) { return k.id === saved; })) kind = saved; } catch (_) {}

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* ---------- what a Broadcast is ---------- */
  function isWriting(b) { return !!(b && (b.mediaType === 'writing' || b.kind === 'writing')); }
  function kindOf(b) {
    if (!b) return 'watch';
    if (b.live) return 'live';
    if (isWriting(b)) return 'read';
    return 'watch';
  }
  var lgCache = {};
  /* Luganda when at least one of its first sentences reads as Luganda
     (titles and pieces are often mixed with English). */
  function hasLuganda(b) {
    if (!b) return false;
    if (b.lang === 'lg') return true; /* 07c: marked Luganda by its writer */
    var key = (b.id || '') + ':' + (b.updatedAt || b.createdAt || '');
    if (key in lgCache) return lgCache[key];
    var LV = window.NalunoLgVoice, Lg = window.NalunoLgSpeak;
    var test = (LV && typeof LV.looksLuganda === 'function') ? LV.looksLuganda
      : ((Lg && typeof Lg.looksLuganda === 'function') ? Lg.looksLuganda : null);
    var out = false;
    if (test) {
      var text = [b.title, b.description, isWriting(b) ? b.body : ''].filter(Boolean).join('. ');
      /* No look-behind: older iPhones cannot read it. */
      var parts = String(text).split(/[.!?…]+["'”’)]*\s+|\n+/).slice(0, 10);
      for (var i = 0; i < parts.length && !out; i++) {
        try { if (parts[i].trim().split(/\s+/).length >= 2 && test(parts[i])) out = true; } catch (_) {}
      }
    }
    lgCache[key] = out;
    return out;
  }
  function ago(ts) {
    var t = 0;
    try {
      if (ts && typeof ts.toMillis === 'function') t = ts.toMillis();
      else if (ts && typeof ts.seconds === 'number') t = ts.seconds * 1000;
      else t = Number(ts) || 0;
    } catch (_) { t = 0; }
    if (t && t < 1e12) t *= 1000; /* seconds */
    if (!t) return '';
    var s = Math.max(0, (Date.now() - t) / 1000);
    if (s < 90) return 'just now';
    var m = Math.round(s / 60);
    if (m < 60) return m + ' min ago';
    var h = Math.round(m / 60);
    if (h < 24) return h + ' h ago';
    var d = Math.round(h / 24);
    if (d < 7) return d + (d === 1 ? ' day ago' : ' days ago');
    var w = Math.round(d / 7);
    if (d < 31) return w + (w === 1 ? ' week ago' : ' weeks ago');
    var mo = Math.round(d / 30.4);
    if (mo < 12) return mo + (mo === 1 ? ' month ago' : ' months ago');
    var y = Math.round(d / 365);
    return y + (y === 1 ? ' year ago' : ' years ago');
  }
  function views(b) {
    if (!b) return '';
    var mine = false;
    try { mine = !!(typeof currentUser !== 'undefined' && currentUser && b.creatorUid === currentUser.uid); } catch (_) {}
    if (b.shareViews === false && !mine) return '';
    var n = Number(b.views) || 0;
    var f = (typeof formatNalunoViews === 'function') ? formatNalunoViews(n) : String(n);
    return f + (n === 1 ? ' view' : ' views');
  }
  var BARS = '<i class="bcast-glance-bars" aria-hidden="true"><b></b><b></b><b></b></i>';
  var KIND_WORD = { watch: 'Watch', read: 'Read', live: 'Live now' };

  /* Called by broadcastThumbHtml (broadcast-core.js) for every plate. */
  function plateGlance(b, ctx) {
    ctx = ctx || {};
    var k = kindOf(b);
    var lg = hasLuganda(b);
    var kicker = '<div class="bcast-glance-kind" data-kind="' + k + '">' + BARS + '<span>' + KIND_WORD[k] + '</span>'
      + (k === 'read' && ctx.mins ? '<span class="bcast-glance-dot">' + ctx.mins + ' min</span>' : '')
      + (lg ? '<span class="bcast-glance-lg">Luganda</span>' : '')
      + '</div>';
    var bits = [];
    var v = views(b);
    if (v) bits.push('<span>' + esc(v) + '</span>');
    var a = b.live ? 'on air' : ago(b.publishAt && Number(b.publishAt) <= Date.now() ? b.publishAt : b.createdAt);
    if (a) bits.push('<span>' + esc(a) + '</span>');
    var stats = bits.length ? '<div class="bcast-glance-stats">' + bits.join('') + '</div>' : '';
    var listen = '';
    if (k === 'read' && (b.body || b.description)) {
      listen = '<button type="button" class="bcast-glance-listen" data-glance-act="listen" aria-label="Listen to this Broadcast">'
        + '<span class="bcast-glance-wave" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></span>'
        + '<span class="bcast-glance-listen-label">Listen</span>'
        + (lg ? '<span class="bcast-glance-listen-lang">Luganda voice</span>' : '')
        + '</button>';
    }
    var more = '<button type="button" class="bcast-glance-more" data-glance-act="more" aria-label="More about this Broadcast">'
      + '<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.8" fill="currentColor"/><circle cx="12" cy="12" r="1.8" fill="currentColor"/><circle cx="19" cy="12" r="1.8" fill="currentColor"/></svg>'
      + '</button>';
    return { kind: k, lg: lg, kicker: kicker, stats: stats, listen: listen, more: more };
  }
  window.nalunoPlateGlance = plateGlance;

  /* ---------- the tuner: All · Watch · Read · Live · Luganda ---------- */
  function filter(list) {
    if (kind === 'all') return list;
    return (list || []).filter(function (b) {
      if (!b) return false;
      if (kind === 'lg') return hasLuganda(b);
      return kindOf(b) === kind;
    });
  }
  window.nalunoBcastKindFilter = function (list) {
    try { document.body.classList.toggle('naluno-bcast-channel', !!window.__airChannelUid); } catch (_) {}
    try {
      if (typeof bcastActiveView !== 'undefined' && bcastActiveView !== 'foryou') return list;
      if (window.__airChannelUid) return list;
    } catch (_) {}
    return filter(list);
  };
  window.nalunoBcastKind = function () { return kind; };
  var EMPTY = {
    watch: 'No videos to watch yet.',
    read: 'Nothing written yet. Use + and Write to be the first.',
    live: 'Nobody is live right now.',
    lg: 'No Luganda Broadcasts yet. Write one with + — Naluno reads it aloud in Luganda.',
  };
  window.nalunoBcastKindEmpty = function () { return kind === 'all' ? '' : (EMPTY[kind] || ''); };

  function paintTuner() {
    var host = document.getElementById('bcastTune');
    if (!host) return;
    if (!host.__built) {
      host.__built = true;
      host.innerHTML = KINDS.map(function (k) {
        return '<button type="button" class="bcast-tune-btn" role="tab" data-kind="' + k.id + '">' + esc(k.label) + '</button>';
      }).join('');
      host.addEventListener('click', function (e) {
        var btn = e.target && e.target.closest ? e.target.closest('.bcast-tune-btn') : null;
        if (!btn) return;
        setKind(btn.getAttribute('data-kind'));
      });
    }
    host.querySelectorAll('.bcast-tune-btn').forEach(function (btn) {
      var on = btn.getAttribute('data-kind') === kind;
      btn.classList.toggle('on', on);
      btn.setAttribute('aria-selected', on ? 'true' : 'false');
    });
  }
  function setKind(next) {
    if (!KINDS.some(function (k) { return k.id === next; })) next = 'all';
    if (next === kind) return;
    kind = next;
    try { sessionStorage.setItem(KIND_KEY, kind); } catch (_) {}
    paintTuner();
    stopCardListen();
    try { if (typeof renderBroadcastTab === 'function') renderBroadcastTab(); } catch (_) {}
    try {
      var sc = document.getElementById('broadcastTabScroll');
      var head = document.getElementById('bcastFeedHead');
      if (sc) sc.scrollTo({ top: 0, behavior: 'smooth' });
      if (head && sc && sc.scrollTop > (head.offsetHeight || 0)) sc.scrollTop = 0;
    } catch (_) {}
  }
  window.nalunoSetBcastKind = setKind;

  /* ---------- sheets ---------- */
  function sheet(id, html) {
    var el = document.getElementById(id);
    if (!el) {
      el = document.createElement('div');
      el.id = id;
      el.className = 'bcast-sheet';
      el.setAttribute('hidden', '');
      document.body.appendChild(el);
      el.addEventListener('click', function (e) { if (e.target === el) closeSheet(el); });
    }
    el.innerHTML = '<div class="bcast-sheet-card" role="dialog" aria-modal="true">' + html + '</div>';
    el.removeAttribute('hidden');
    requestAnimationFrame(function () { el.classList.add('open'); });
    var x = el.querySelector('[data-sheet-close]');
    if (x) x.onclick = function () { closeSheet(el); };
    return el;
  }
  function closeSheet(el) {
    if (!el) return;
    el.classList.remove('open');
    setTimeout(function () { el.setAttribute('hidden', ''); }, 180);
  }
  window.nalunoCloseBcastSheets = function () {
    ['bcastMakeSheet', 'bcastMoreSheet'].forEach(function (id) { closeSheet(document.getElementById(id)); });
  };

  /* "+": Go on air. Each choice presses the existing button. */
  function press(id) {
    var el = document.getElementById(id);
    if (el && typeof el.click === 'function') { el.click(); return true; }
    return false;
  }
  function openMake() {
    var el = sheet('bcastMakeSheet',
      '<div class="bcast-sheet-top"><div><div class="bcast-sheet-kicker">' + BARS + 'Go on air</div>'
      + '<div class="bcast-sheet-title">What are you making?</div></div>'
      + '<button type="button" class="bcast-sheet-x" data-sheet-close aria-label="Close">✕</button></div>'
      + '<div class="bcast-make-list">'
      + make('video', 'Video', 'Stays on your Broadcast until you delete it')
      + make('write', 'Write', 'Words people read — or hear in Naluno’s voice')
      + make('live', 'Go live', 'Now, with people watching and talking')
      + make('signal', 'Signal', 'A short clip, gone in 24 hours')
      + '</div>'
      + '<div class="bcast-sheet-foot">'
      + (onChannel() ? '' : '<button type="button" class="bcast-sheet-link" data-make="about">Describe your Broadcast</button>'
        + '<button type="button" class="bcast-sheet-link" data-make="share">Share your Broadcast</button>')
      + '<button type="button" class="bcast-sheet-link" data-make="mine">My Broadcasts</button>'
      + '</div>');
    el.querySelectorAll('[data-make]').forEach(function (b) {
      b.onclick = function () {
        var what = b.getAttribute('data-make');
        closeSheet(el);
        setTimeout(function () { makeAct(what); }, 60);
      };
    });
  }
  var ICON = {
    video: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none"><rect x="3" y="6" width="13" height="12" rx="2.5" stroke="currentColor" stroke-width="1.8"/><path d="M16 10.5l5-3v9l-5-3" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>',
    write: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none"><path d="M5 19h14M7 15l9.5-9.5a2.1 2.1 0 013 3L10 18H7v-3z" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    live: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none"><circle cx="12" cy="12" r="2.6" fill="currentColor"/><path d="M7.8 7.8a6 6 0 000 8.4M16.2 7.8a6 6 0 010 8.4M5 5a10 10 0 000 14M19 5a10 10 0 010 14" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
    signal: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none"><rect x="4" y="4" width="16" height="16" rx="5" stroke="currentColor" stroke-width="1.8"/><path d="M12 8.5v7M8.5 12h7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  };
  function make(id, title, sub) {
    return '<button type="button" class="bcast-make-row" data-make="' + id + '" data-tone="' + id + '">'
      + '<span class="bcast-make-ico">' + ICON[id] + '</span>'
      + '<span class="bcast-make-copy"><b>' + esc(title) + '</b><small>' + esc(sub) + '</small></span>'
      + '<span class="bcast-make-go" aria-hidden="true">›</span></button>';
  }
  function makeAct(what) {
    if (what === 'video') return press('newBroadcastBtn');
    if (what === 'write') return press('broadcastWriteBtn');
    if (what === 'live') return press('broadcastGoLiveBtn');
    if (what === 'signal') {
      if (typeof openNewSignalComposer === 'function') { try { openNewSignalComposer(); return true; } catch (_) {} }
      return press('newSignalItem') || press('newSignalBtn');
    }
    if (what === 'share') return press('airShareBtn');
    if (what === 'mine') {
      if (typeof nalunoSetBcastView === 'function') { try { nalunoSetBcastView('mine'); return true; } catch (_) {} }
      return false;
    }
    if (what === 'about') {
      document.body.classList.add('naluno-air-about');
      try {
        var sc = document.getElementById('broadcastTabScroll');
        if (sc) sc.scrollTop = 0;
        var editor = document.getElementById('airEditor');
        if (editor && editor.hasAttribute('hidden')) press('airEditBtn');
        var ta = document.getElementById('airAbout');
        if (ta) setTimeout(function () { try { ta.focus(); } catch (_) {} }, 120);
      } catch (_) {}
      return true;
    }
    return false;
  }

  /* "⋯": why this, and telling the feed what you want. */
  function findBroadcast(id) {
    var pools = [];
    try { if (typeof feedBroadcasts !== 'undefined' && feedBroadcasts) pools.push(feedBroadcasts); } catch (_) {}
    try { if (typeof myBroadcasts !== 'undefined' && myBroadcasts) pools.push(myBroadcasts); } catch (_) {}
    try { if (typeof broadcastSearchResults !== 'undefined' && broadcastSearchResults) pools.push(broadcastSearchResults); } catch (_) {}
    for (var i = 0; i < pools.length; i++) {
      for (var j = 0; j < pools[i].length; j++) if (pools[i][j] && pools[i][j].id === id) return pools[i][j];
    }
    return null;
  }
  function openMore(id) {
    var b = findBroadcast(id) || { id: id };
    var mine = false;
    try { mine = !!(typeof currentUser !== 'undefined' && currentUser && b.creatorUid === currentUser.uid); } catch (_) {}
    var why = (b._why || '').trim();
    var who = String(b.creatorName || 'this creator').split(' ')[0];
    var el = sheet('bcastMoreSheet',
      '<div class="bcast-sheet-top"><div><div class="bcast-sheet-kicker">' + BARS + 'Why you see this</div>'
      + '<div class="bcast-sheet-title">' + esc((b.title || 'Broadcast').slice(0, 80)) + '</div></div>'
      + '<button type="button" class="bcast-sheet-x" data-sheet-close aria-label="Close">✕</button></div>'
      + '<p class="bcast-sheet-why">' + esc(why || (mine ? 'This is yours.' : 'New on Naluno, and close to what you open.')) + '</p>'
      + '<div class="bcast-more-list">'
      + '<button type="button" class="bcast-more-row" data-more="open">Open</button>'
      + (mine ? '' : '<button type="button" class="bcast-more-row" data-more="more">More like this</button>'
        + '<button type="button" class="bcast-more-row" data-more="not_interested">Not interested</button>'
        + '<button type="button" class="bcast-more-row is-quiet" data-more="hide_creator">Hide ' + esc(who) + ' on this phone</button>')
      + '</div>');
    el.querySelectorAll('[data-more]').forEach(function (btn) {
      btn.onclick = function () {
        var act = btn.getAttribute('data-more');
        closeSheet(el);
        if (act === 'open') { if (typeof openBroadcastById === 'function') openBroadcastById(id); return; }
        if (!window.NalunoDiscover || typeof NalunoDiscover.note !== 'function') return;
        if (act === 'not_interested' || act === 'hide_creator') fold(id, act);
        else { try { NalunoDiscover.note(act, id); } catch (_) {} toastSay('We’ll show more like this'); }
      };
    });
  }
  function toastSay(t) { try { if (typeof toast === 'function') toast(t); } catch (_) {} }
  /* The Broadcast folds away, then the ranking (which already hides what
     you said no to) redraws the feed. */
  function fold(id, act) {
    var plate = document.querySelector('#bcastPlateGrid [data-broadcast-id="' + (window.CSS && CSS.escape ? CSS.escape(id) : id) + '"]');
    if (plate) plate.classList.add('is-folding');
    stopCardListen();
    setTimeout(function () {
      try { NalunoDiscover.note(act, id); } catch (_) {}
      toastSay(act === 'hide_creator' ? 'Hidden on this phone. Change it any time in Why this.' : 'Got it — less like this');
    }, plate ? 260 : 0);
  }

  /* ---------- Listen, right on the card ---------- */
  var listening = null;
  function resetButton(btn, label) {
    try { if (label) { label.removeAttribute('data-on'); label.textContent = 'Listen'; } } catch (_) {}
    try { if (btn) btn.classList.remove('is-on'); } catch (_) {}
  }
  function stopCardListen() {
    if (!listening) return;
    var l = listening;
    listening = null;
    try { if (typeof bspaceStopSpeak === 'function') bspaceStopSpeak(); } catch (_) {}
    resetButton(l.btn, l.label);
    try { if (l.io) l.io.disconnect(); } catch (_) {}
  }
  /* Watch the card that is reading: it stops when it leaves the screen. */
  function watchCard(state, plate) {
    try { if (state.io) state.io.disconnect(); } catch (_) {}
    state.io = null;
    if (!plate || typeof IntersectionObserver === 'undefined') return;
    try {
      var sc = document.getElementById('broadcastTabScroll');
      /* Search results sit outside the feed's scroller: watch them against
         the screen instead, or they stop the moment they start. */
      var inFeed = !!(sc && sc.contains(plate) && sc.clientHeight > 40);
      state.io = new IntersectionObserver(function (en) {
        en.forEach(function (x) {
          if (listening !== state) return;
          if (!x.target.isConnected) return; /* a redraw: followed below */
          if (x.intersectionRatio < 0.35) stopCardListen();
        });
      }, { root: inFeed ? sc : null, threshold: [0, 0.35] });
      state.io.observe(plate);
    } catch (_) {}
  }
  /* The feed redraws (new Broadcasts, the ranking, the tuner): the reading
     carries on, and the new card for the same Broadcast shows it. */
  function follow() {
    var state = listening;
    if (!state || (state.btn && state.btn.isConnected)) return;
    var sel = '[data-broadcast-id="' + (window.CSS && CSS.escape ? CSS.escape(state.id) : state.id) + '"] .bcast-glance-listen';
    var next = document.querySelector('#bcastPlateGrid ' + sel) || document.querySelector('#bcastSearchResults ' + sel);
    if (!next) { stopCardListen(); return; }
    var label = next.querySelector('.bcast-glance-listen-label');
    state.btn = next;
    state.label = label;
    next.classList.add('is-on');
    if (label) { label.setAttribute('data-on', '1'); label.textContent = 'Stop'; }
    watchCard(state, next.closest('.bcast-plate'));
  }
  window.nalunoStopCardListen = stopCardListen;
  function cardListen(btn, id) {
    var label = btn.querySelector('.bcast-glance-listen-label');
    if (!label || typeof bspaceSpeakWriting !== 'function') { if (typeof openBroadcastById === 'function') openBroadcastById(id); return; }
    if (listening && (listening.btn === btn || listening.id === id)) {
      /* Second tap: stop. */
      stopCardListen();
      return;
    }
    stopCardListen();
    var b = findBroadcast(id);
    if (!b) { if (typeof openBroadcastById === 'function') openBroadcastById(id); return; }
    var title = String(b.title || '').trim();
    var body = String(b.body || b.description || '');
    var text = (title ? title + (/[.!?…]$/.test(title) ? '' : '.') + '\n\n' : '') + body;
    try { if (window.NalunoVoices && NalunoVoices.prime) NalunoVoices.prime(); } catch (_) {}
    var state = { btn: btn, label: label, id: id, io: null };
    listening = state;
    btn.classList.add('is-on');
    watchCard(state, btn.closest('.bcast-plate'));
    var done = function () {
      /* Finished, or another voice took over (the room's Listen, a video):
         the card always goes back to Listen. */
      resetButton(state.btn, state.label);
      if (label !== state.label) resetButton(btn, label);
      try { state.io && state.io.disconnect(); } catch (_) {}
      if (listening === state) listening = null;
    };
    Promise.resolve(bspaceSpeakWriting(text, b.lang === 'lg' ? 'lg' : '', label)).then(done, done);
  }

  /* One listener for every card, before the card's own "open" tap. */
  document.addEventListener('click', function (e) {
    var t = e.target && e.target.closest ? e.target.closest('[data-glance-act]') : null;
    if (!t) return;
    var plate = t.closest('[data-broadcast-id]');
    if (!plate) return;
    e.preventDefault();
    e.stopPropagation();
    var id = plate.getAttribute('data-broadcast-id');
    var act = t.getAttribute('data-glance-act');
    if (act === 'listen') cardListen(t, id);
    else if (act === 'more') openMore(id);
  }, true);

  /* ---------- previews and data ---------- */
  function saveData() {
    try {
      var c = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
      if (!c) return false;
      if (c.saveData) return true;
      return /(^|-)2g$|^3g$/.test(String(c.effectiveType || ''));
    } catch (_) { return false; }
  }
  window.nalunoPreviewsAllowed = function () { return !saveData(); };
  /* The "tap to play" label goes once the preview is actually moving. */
  function mark(e, on) {
    var v = e.target;
    if (!v || !v.matches || !v.matches('video[data-naluno-preview="1"]')) return;
    var plate = v.closest('.bcast-plate');
    if (plate) plate.classList.toggle('is-moving', on);
  }
  document.addEventListener('playing', function (e) { mark(e, true); }, true);
  document.addEventListener('pause', function (e) { mark(e, false); }, true);
  document.addEventListener('ended', function (e) { mark(e, false); }, true);

  /* ---------- the first screen ---------- */
  function measure() {
    var root = document.documentElement;
    var head = document.getElementById('bcastFeedHead');
    var nav = document.querySelector('.navbar');
    var hh = 0;
    try {
      if (head && document.body.classList.contains('naluno-bcast-foryou') && !document.body.classList.contains('naluno-strand-open') && !document.body.classList.contains('naluno-bcast-headless')) hh = Math.round(head.getBoundingClientRect().height);
    } catch (_) {}
    root.style.setProperty('--bcast-head-h', hh + 'px');
    try { root.style.setProperty('--naluno-nav-h', Math.round(nav ? nav.getBoundingClientRect().height : 0) + 'px'); } catch (_) {}
  }
  window.nalunoMeasureBcastHead = measure;

  function onChannel() { try { return !!window.__airChannelUid; } catch (_) { return false; } }
  /* Landscape on the first Broadcast: the Signals row steps aside so the
     video has the whole screen (it is back when landscape ends). */
  function landscapeWatch() {
    var body = document.body;
    var grid = document.getElementById('bcastPlateGrid');
    var land = grid && grid.querySelector('.bcast-plate.is-landscaped');
    var want = !!(land && land === grid.firstElementChild && body.classList.contains('naluno-feed-landscape')
      && body.classList.contains('naluno-bcast-foryou') && !body.classList.contains('naluno-strand-open'));
    if (want === body.classList.contains('naluno-bcast-headless')) return;
    body.classList.toggle('naluno-bcast-headless', want);
    measure();
    try { var sc = document.getElementById('broadcastTabScroll'); if (sc) sc.scrollTop = 0; } catch (_) {}
  }

  function boot() {
    paintTuner();
    try {
      var bodyMO = new MutationObserver(function () {
        landscapeWatch();
        document.body.classList.toggle('naluno-bcast-channel', onChannel());
      });
      bodyMO.observe(document.body, { attributes: true, attributeFilter: ['class'] });
      var grid = document.getElementById('bcastPlateGrid');
      if (grid) new MutationObserver(function () { follow(); landscapeWatch(); }).observe(grid, { childList: true });
      var results = document.getElementById('bcastSearchResults');
      if (results) new MutationObserver(follow).observe(results, { childList: true, subtree: true });
    } catch (_) {}
    /* Opening a Broadcast stops a card that is reading. */
    if (typeof window.openBroadcastById === 'function' && !window.openBroadcastById.__glance) {
      var prevOpen = window.openBroadcastById;
      var wrapped = function () { stopCardListen(); return prevOpen.apply(this, arguments); };
      wrapped.__glance = true;
      window.openBroadcastById = wrapped;
    }
    var plus = document.getElementById('bcastMakeBtn');
    if (plus && !plus.__wired) { plus.__wired = true; plus.onclick = function (e) { if (e) e.stopPropagation(); openMake(); }; }
    var save = document.getElementById('airSaveBtn');
    if (save && !save.__glance) {
      save.__glance = true;
      save.addEventListener('click', function () { setTimeout(function () { document.body.classList.remove('naluno-air-about'); measure(); }, 400); });
    }
    try {
      var head = document.getElementById('bcastFeedHead');
      if (head && typeof ResizeObserver !== 'undefined' && !head.__glanceRO) {
        head.__glanceRO = new ResizeObserver(function () { measure(); });
        head.__glanceRO.observe(head);
      }
    } catch (_) {}
    window.addEventListener('resize', measure);
    measure();
    /* Leaving the tab stops a card that is reading aloud. */
    document.querySelectorAll('.navbtn').forEach(function (btn) {
      if (btn.__glanceNav) return;
      btn.__glanceNav = true;
      btn.addEventListener('click', function () {
        if (btn.getAttribute('data-tab') !== 'broadcast') { stopCardListen(); document.body.classList.remove('naluno-air-about'); }
      });
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  window.NalunoBcastGlance = {
    glance: plateGlance, kindOf: kindOf, hasLuganda: hasLuganda, ago: ago, views: views,
    filter: filter, setKind: setKind, kind: function () { return kind; },
    openMake: openMake, openMore: openMore, makeAct: makeAct, measure: measure,
    saveData: saveData, stopListen: stopCardListen,
  };
})();
