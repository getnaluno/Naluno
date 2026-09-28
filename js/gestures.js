/* ============================================================
   MODULE: js/gestures.js
   Swipe gestures, added on top of the buttons (every gesture has a button
   or a Back that does the same thing, so nothing depends on swiping):

   1. Signal stories: swipe ←/→ between people, down to close, hold to
      pause, up to open the linked Broadcast or reply in Wireline.
   2. Pull a sheet down to close it (from its header, or from the top of
      its content when that content is scrolled to the top).
   3. Wireline: swipe a message right to reply with a quote.
   4. Pull to refresh: Frequencies, Wireline and Broadcast.
   5. Wireline list: swipe a conversation left for Read / Call / Clear.
   6. A light vibration when a swipe completes; a one-time hint the first
      time someone opens a story.

   Gestures never start within 24px of the screen's left or right edge,
   which Android uses for its own Back gesture.
   ============================================================ */
(function () {
  'use strict';
  const EDGE = 24;
  const doc = document;
  const $id = (id) => doc.getElementById(id);

  /* ---------- 6. Vibration ---------- */
  function buzz(ms) {
    try {
      const hp = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Haptics;
      if (hp && typeof hp.impact === 'function') { hp.impact({ style: 'LIGHT' }); return; }
    } catch (_) {}
    try { if (navigator.vibrate) navigator.vibrate(ms || 10); } catch (_) {}
  }
  window.nalunoBuzz = buzz;

  function point(e) {
    const t = (e.touches && e.touches[0]) || (e.changedTouches && e.changedTouches[0]) || e;
    return { x: t.clientX, y: t.clientY };
  }
  function nearEdge(p) { return p.x < EDGE || p.x > window.innerWidth - EDGE; }
  function isOpen(el) { return !!(el && el.classList && el.classList.contains('active')); }
  function interactive(t) {
    return !!(t && t.closest && t.closest('input, textarea, select, [contenteditable="true"], input[type="range"], .no-swipe'));
  }
  /* After a swipe, the click the browser sends at touchend must not also
     tap a button or a story tap-zone. */
  let swallowUntil = 0;
  doc.addEventListener('click', function (e) {
    if (Date.now() < swallowUntil) { e.stopPropagation(); e.preventDefault(); }
  }, true);
  function swallowNextClick() { swallowUntil = Date.now() + 450; }
  /* When a gesture here takes a touch (closing a sheet, refreshing a
     list), the older whole-app pull-to-reload in pwa.js stands aside. */
  window.__nalunoGestureTouch = false;
  window.addEventListener('touchstart', function () { window.__nalunoGestureTouch = false; }, { capture: true, passive: true });
  function claim() { window.__nalunoGestureTouch = true; }

  function hintOnce(key, text) {
    try {
      if (localStorage.getItem('nalunoHint:' + key)) return;
      localStorage.setItem('nalunoHint:' + key, '1');
    } catch (_) { return; }
    const el = doc.createElement('div');
    el.className = 'naluno-gesture-hint';
    el.textContent = text;
    doc.body.appendChild(el);
    setTimeout(function () { el.classList.add('out'); }, 3600);
    setTimeout(function () { try { el.remove(); } catch (_) {} }, 4200);
  }

  /* ---------- 1. Signal stories ---------- */
  function storyList() {
    const now = Date.now();
    const list = (typeof connectionsSignals !== 'undefined' && connectionsSignals) ? connectionsSignals : [];
    return list.filter(function (r) {
      return r && r.contact && r.latest && !(Number(r.latest.expiresAt) <= now) && !r.latest.held && !r.latest.hidden;
    });
  }
  /** Move to the next (+1) or previous (-1) person's Signals. */
  function storyPerson(dir) {
    try {
      const list = storyList();
      const mine = (typeof viewingMine !== 'undefined') && viewingMine;
      const owner = (typeof currentStoryOwnerUid !== 'undefined') ? currentStoryOwnerUid : '';
      let idx = mine ? -1 : list.findIndex(function (r) { return r.contact.firebaseUid === owner; });
      if (!mine && idx < 0) return false;
      const target = idx + dir;
      if (target === -1 && !mine && typeof mySignal !== 'undefined' && mySignal && mySignal.length && typeof openMySignalStory === 'function') {
        openMySignalStory();
        return true;
      }
      if (target < 0 || target >= list.length) return false;
      if (typeof openContactSignalStory === 'function') {
        openContactSignalStory(list[target].contact.id);
        return true;
      }
    } catch (_) {}
    return false;
  }
  window.nalunoStoryPerson = storyPerson;

  let paused = null;
  function barEl() {
    const idx = (typeof currentSegmentIndex !== 'undefined') ? currentSegmentIndex : 0;
    return doc.querySelectorAll('#bviewerBars .bar i')[idx] || null;
  }
  function storyPause() {
    try {
      if (typeof segTimer !== 'undefined' && segTimer) { clearTimeout(segTimer); segTimer = null; }
      const bar = barEl();
      let total = 4000, ratio = 0;
      if (bar) {
        const m = /(\d+)ms/.exec(bar.style.transition || '');
        if (m) total = Number(m[1]);
        const w = bar.getBoundingClientRect().width, pw = bar.parentElement.getBoundingClientRect().width || 1;
        ratio = Math.max(0, Math.min(1, w / pw));
        bar.style.transition = 'none';
        bar.style.width = (ratio * 100) + '%';
      }
      const v = $id('bviewerActiveVideo');
      if (v) { try { v.pause(); } catch (_) {} }
      paused = { idx: currentSegmentIndex, total: total, ratio: ratio, video: !!v };
      const bv = $id('bviewer'); if (bv) bv.classList.add('story-held');
    } catch (_) { paused = null; }
  }
  function storyResume() {
    const p = paused; paused = null;
    const bv = $id('bviewer'); if (bv) bv.classList.remove('story-held');
    if (!p || !isOpen($id('bviewer')) || p.idx !== currentSegmentIndex) return;
    try {
      const left = Math.max(400, Math.round(p.total * (1 - p.ratio)));
      const bar = barEl();
      if (bar) {
        requestAnimationFrame(function () {
          bar.style.transition = 'width ' + left + 'ms linear';
          bar.style.width = '100%';
        });
      }
      const idx = p.idx;
      if (p.video) {
        const v = $id('bviewerActiveVideo');
        if (v) { try { v.play().catch(function () {}); } catch (_) {} }
        segTimer = setTimeout(function () { goToSegment(idx + 1); }, left + 1500);
      } else {
        segTimer = setTimeout(function () { goToSegment(idx + 1); }, left);
      }
    } catch (_) {}
  }
  /* Close the story without a history step, so what opens next gets its
     own clean Back entry (the same path the phone's Back uses). */
  function leaveStory() {
    if (window.nalunoBack && typeof nalunoBack.closeTop === 'function' && nalunoBack.top() === 'bviewer') nalunoBack.closeTop();
    else closeBroadcast();
  }
  /* Close the story the way the phone's Back does. */
  function closeStory() {
    try { if (history.state && history.state.naluno && history.state.overlay === 'bviewer') { history.back(); return; } } catch (_) {}
    closeBroadcast();
  }
  function storyUp() {
    try {
      /* A Signal that points at a Broadcast already shows a Watch button;
         swiping up presses it, so the tested path is used. */
      const watch = doc.querySelector('#bviewerSocial [data-bcast]');
      if (watch) { watch.click(); return true; }
      if (viewingMine) return false;
      const seg = currentSegments[currentSegmentIndex] || {};
      const c = (contacts || []).find(function (x) { return x.firebaseUid === currentStoryOwnerUid; });
      if (!c || typeof openThread !== 'function') return false;
      const what = seg.caption || seg.text || (seg.type === 'video' ? 'Video' : 'Photo');
      const who = String(c.name || 'Their').split(' ')[0];
      leaveStory();
      openThread(c.id);
      setReply({ author: who + '’s Signal', text: what });
      return true;
    } catch (_) { return false; }
  }
  function bindStory() {
    const bv = $id('bviewer');
    const body = $id('bviewerBody');
    if (!bv || bv.__gest) return;
    bv.__gest = true;
    let s = null;
    const reset = function () {
      if (body) { body.style.transition = 'transform .22s ease'; body.style.transform = ''; }
      bv.style.transition = 'background-color .22s ease'; bv.style.backgroundColor = '';
    };
    bv.addEventListener('touchstart', function (e) {
      if (!isOpen(bv) || e.touches.length !== 1) { s = null; return; }
      const p = point(e);
      if (nearEdge(p) || interactive(e.target) || (e.target.closest && e.target.closest('.bviewer-head, #bviewerSocial button, #bviewerPlayKick, .cam-expand-btn'))) { s = null; return; }
      s = { x: p.x, y: p.y, axis: '', held: false, dx: 0, dy: 0 };
      s.timer = setTimeout(function () { if (s && !s.axis) { s.held = true; storyPause(); } }, 260);
    }, { passive: true });
    bv.addEventListener('touchmove', function (e) {
      if (!s) return;
      const p = point(e);
      s.dx = p.x - s.x; s.dy = p.y - s.y;
      if (!s.axis && Math.max(Math.abs(s.dx), Math.abs(s.dy)) > 12) {
        s.axis = Math.abs(s.dx) > Math.abs(s.dy) * 1.2 ? 'x' : 'y';
        if (!s.held) clearTimeout(s.timer);
      }
      if (s.axis === 'y' && s.dy > 0 && body) {
        body.style.transition = 'none';
        body.style.transform = 'translateY(' + s.dy + 'px) scale(' + Math.max(0.85, 1 - s.dy / 1600) + ')';
        if (e.cancelable) e.preventDefault();
      }
    }, { passive: false });
    bv.addEventListener('touchend', function () {
      if (!s) return;
      const st = s; s = null;
      clearTimeout(st.timer);
      if (st.held) { storyResume(); swallowNextClick(); reset(); return; }
      if (st.axis === 'y') {
        swallowNextClick();
        if (st.dy > 90) { buzz(); reset(); closeStory(); return; }
        if (st.dy < -70) { reset(); if (storyUp()) buzz(); return; }
        reset();
        return;
      }
      if (st.axis === 'x' && Math.abs(st.dx) > 60) {
        swallowNextClick();
        const dir = st.dx < 0 ? 1 : -1;
        if (storyPerson(dir)) { buzz(); return; }
        if (dir > 0) { buzz(); closeStory(); }
        return;
      }
      reset();
    }, { passive: true });
    bv.addEventListener('touchcancel', function () { if (s && s.held) storyResume(); s = null; reset(); }, { passive: true });
    try {
      new MutationObserver(function () {
        if (isOpen(bv)) hintOnce('story', 'Swipe ← → for people · down to close · hold to pause · up to reply');
      }).observe(bv, { attributes: true, attributeFilter: ['class'] });
    } catch (_) {}
  }

  /* ---------- 2. Pull a sheet down to close it ---------- */
  /* handle: 'header' = only from the top of the sheet (screens with their
     own scrolling or typing); 'top' = also from content scrolled to the top. */
  const SHEETS = [
    { id: 'supportSheet', how: 'top' }, { id: 'signalViewers', how: 'top' }, { id: 'contributionPanel', how: 'top' },
    { id: 'downloadsPanel', how: 'top' }, { id: 'reportSheet', how: 'header' }, { id: 'appealSheet', how: 'header' },
    { id: 'findPeopleOverlay', how: 'header' }, { id: 'knownSheet', how: 'top', card: '.bspace-room-card' },
    { id: 'bspaceRoomSheet', how: 'header', card: '.bspace-room-card' }, { id: 'bspaceMoreMenu', how: 'top', card: null },
    { id: 'sparkSheet', how: 'header', card: ':scope > div' }, { id: 'bcastAdSheet', how: 'header' },
    { id: 'discoverSheet', how: 'top' }, { id: 'bspaceLineSheet', how: 'header' },
    { id: 'composer', how: 'header' }, { id: 'bcomposer', how: 'header' }, { id: 'bwriteSetup', how: 'header' },
    { id: 'bliveSetup', how: 'header' }, { id: 'wireBackupScreen', how: 'header' }, { id: 'wireHistoryScreen', how: 'header' },
    { id: 'wirelineThread', how: 'header' }, { id: 'bandRoom', how: 'header' },
  ];
  function sheetOpen(def) {
    const el = $id(def.id);
    if (!el) return false;
    if (window.nalunoBack && typeof nalunoBack.top === 'function') return nalunoBack.top() === def.id;
    return isOpen(el);
  }
  function closeSheet(def) {
    const el = $id(def.id);
    if (!el) return;
    /* The same path as the phone's Back button, so history stays right. */
    try {
      if (history.state && history.state.naluno && history.state.overlay === def.id) { history.back(); return; }
    } catch (_) {}
    try { if (window.nalunoBack && nalunoBack.closeById) nalunoBack.closeById(def.id); } catch (_) {}
  }
  function scrollerAt(t, root) {
    let n = t;
    while (n && n !== root && n !== doc.body) {
      const cs = getComputedStyle(n);
      if ((cs.overflowY === 'auto' || cs.overflowY === 'scroll') && n.scrollHeight > n.clientHeight + 2) return n;
      n = n.parentElement;
    }
    return null;
  }
  function bindSheets() {
    let s = null;
    doc.addEventListener('touchstart', function (e) {
      s = null;
      if (e.touches.length !== 1) return;
      const p = point(e);
      if (nearEdge(p) || interactive(e.target)) return;
      for (let i = 0; i < SHEETS.length; i++) {
        const def = SHEETS[i];
        const root = $id(def.id);
        if (!root || !root.contains(e.target) || !sheetOpen(def)) continue;
        let mover = root;
        if (def.card) { try { mover = root.querySelector(def.card) || root; } catch (_) { mover = root; } }
        const r = mover.getBoundingClientRect();
        const inHeader = (p.y - r.top) < 88;
        const sc = scrollerAt(e.target, root);
        const atTop = !sc || sc.scrollTop <= 0;
        if (def.how === 'header' ? !inHeader : !(inHeader || atTop)) return;
        s = { def: def, mover: mover, y: p.y, x: p.x, dy: 0, axis: '' };
        claim();
        return;
      }
    }, { passive: true });
    doc.addEventListener('touchmove', function (e) {
      if (!s) return;
      const p = point(e);
      const dy = p.y - s.y, dx = p.x - s.x;
      if (!s.axis && Math.max(Math.abs(dx), Math.abs(dy)) > 10) s.axis = (dy > 0 && Math.abs(dy) > Math.abs(dx) * 1.3) ? 'down' : 'no';
      if (s.axis !== 'down') return;
      s.dy = Math.max(0, dy);
      s.mover.style.transition = 'none';
      s.mover.style.transform = 'translateY(' + s.dy + 'px)';
      if (e.cancelable) e.preventDefault();
    }, { passive: false });
    const end = function () {
      if (!s) return;
      const st = s; s = null;
      if (st.axis !== 'down') return;
      swallowNextClick();
      st.mover.style.transition = 'transform .2s ease';
      if (st.dy > 110) {
        buzz();
        st.mover.style.transform = 'translateY(100%)';
        setTimeout(function () {
          closeSheet(st.def);
          st.mover.style.transition = ''; st.mover.style.transform = '';
        }, 180);
      } else {
        st.mover.style.transform = '';
      }
    };
    doc.addEventListener('touchend', end, { passive: true });
    doc.addEventListener('touchcancel', end, { passive: true });
  }

  /* ---------- 3. Swipe a Wireline message to reply ---------- */
  let reply = null;
  function replyBar() {
    let bar = $id('wireReplyBar');
    if (bar) return bar;
    const input = $id('threadInput');
    if (!input) return null;
    let row = input.parentElement;
    while (row && row.parentElement && row.parentElement.id !== 'wirelineThread' && !row.classList.contains('thread-composer')) row = row.parentElement;
    bar = doc.createElement('div');
    bar.id = 'wireReplyBar';
    bar.hidden = true;
    bar.innerHTML = '<div class="wire-reply-in"><b id="wireReplyWho"></b><span id="wireReplyText"></span></div>'
      + '<button type="button" id="wireReplyClose" aria-label="Cancel reply">×</button>';
    if (row && row.parentElement) row.parentElement.insertBefore(bar, row);
    else input.parentElement.insertBefore(bar, input);
    $id('wireReplyClose').onclick = function () { clearReply(); };
    return bar;
  }
  function setReply(r) {
    reply = { author: String(r.author || '').slice(0, 40), text: String(r.text || '').replace(/\s+/g, ' ').slice(0, 90) };
    const bar = replyBar();
    if (!bar) return;
    $id('wireReplyWho').textContent = reply.author;
    $id('wireReplyText').textContent = reply.text;
    bar.hidden = false;
    try { const i = $id('threadInput'); if (i) i.focus(); } catch (_) {}
  }
  function clearReply() {
    reply = null;
    const bar = $id('wireReplyBar');
    if (bar) bar.hidden = true;
  }
  /** Used by sendThreadMessage: the quote line to put above the text. */
  function takeReply() {
    if (!reply) return '';
    const line = '› ' + reply.author + ': ' + reply.text;
    clearReply();
    return line;
  }
  window.nalunoReplySet = setReply;
  window.nalunoReplyClear = clearReply;
  window.nalunoReplyTake = takeReply;

  function msgFor(row) {
    try {
      const id = row.getAttribute('data-msgid');
      const list = (wirelineThreads && wirelineThreads[activeThreadContactId]) || [];
      const m = list.find(function (x) { return String(x.id) === String(id); });
      if (!m) return null;
      const c = (contacts || []).find(function (x) { return x.id === activeThreadContactId; });
      const author = m.from === 'me' ? 'You' : String((c && c.name) || 'Them').split(' ')[0];
      let text = m.text || '';
      if (!text) text = m.type === 'voice' ? 'Voice note' : (m.type === 'photo' ? 'Photo' : (m.type === 'video' ? 'Video' : (m.type === 'document' ? (m.fileName || 'Document') : 'Message')));
      /* Quoting a reply quotes its own words, not the quote above them. */
      if (/^› /.test(text) && text.indexOf('\n') > 0) text = text.slice(text.indexOf('\n') + 1);
      return { author: author, text: text };
    } catch (_) { return null; }
  }
  function bindReplySwipe() {
    const list = $id('threadMessages');
    if (!list || list.__gest) return;
    list.__gest = true;
    let s = null;
    list.addEventListener('touchstart', function (e) {
      s = null;
      if (e.touches.length !== 1) return;
      const p = point(e);
      const row = e.target.closest && e.target.closest('.msg-row[data-msgid]:not(.system)');
      if (!row || nearEdge(p) || interactive(e.target)) return;
      const bubble = row.querySelector('.msg-bubble');
      s = { row: row, bubble: bubble || row, x: p.x, y: p.y, dx: 0, axis: '' };
    }, { passive: true });
    list.addEventListener('touchmove', function (e) {
      if (!s) return;
      const p = point(e);
      const dx = p.x - s.x, dy = p.y - s.y;
      if (!s.axis && Math.max(Math.abs(dx), Math.abs(dy)) > 10) s.axis = (dx > 0 && Math.abs(dx) > Math.abs(dy) * 1.4) ? 'x' : 'no';
      if (s.axis !== 'x') return;
      s.dx = Math.min(80, Math.max(0, dx));
      s.bubble.style.transition = 'none';
      s.bubble.style.transform = 'translateX(' + s.dx + 'px)';
      s.row.classList.toggle('reply-armed', s.dx > 56);
      if (e.cancelable) e.preventDefault();
    }, { passive: false });
    const end = function () {
      if (!s) return;
      const st = s; s = null;
      if (st.axis !== 'x') return;
      swallowNextClick();
      st.bubble.style.transition = 'transform .18s ease';
      st.bubble.style.transform = '';
      st.row.classList.remove('reply-armed');
      if (st.dx > 56) {
        const m = msgFor(st.row);
        if (m) { buzz(); setReply(m); }
      }
    };
    list.addEventListener('touchend', end, { passive: true });
    list.addEventListener('touchcancel', end, { passive: true });
  }

  /* ---------- 4. Pull to refresh ---------- */
  const PULLS = [
    { sel: '#tab-frequencies .tab-scroll', tab: 'tab-frequencies', run: function () {
      try { (contacts || []).filter(function (c) { return c.isReal && c.firebaseUid; }).forEach(function (c) { if (typeof refreshContactLiveProfile === 'function') refreshContactLiveProfile(c.firebaseUid); }); } catch (_) {}
      return typeof refreshConnectionsSignals === 'function' ? refreshConnectionsSignals(true) : null;
    } },
    { sel: '#tab-wireline .tab-scroll', tab: 'tab-wireline', run: function () {
      try { if (window.NalunoWireMailbox && NalunoWireMailbox.retryPendingDrops) NalunoWireMailbox.retryPendingDrops(); } catch (_) {}
      try { if (typeof flushMessageQueue === 'function') flushMessageQueue(); } catch (_) {}
      try { if (typeof renderWirelineList === 'function') renderWirelineList(); } catch (_) {}
      return null;
    } },
    { sel: '#broadcastTabScroll', tab: 'tab-broadcast', run: function () {
      const a = typeof refreshConnectionsSignals === 'function' ? refreshConnectionsSignals(true) : null;
      try { if (typeof loadFeedBroadcasts === 'function') loadFeedBroadcasts(); } catch (_) {}
      try { if (typeof renderTogaBoard === 'function' && typeof bcastActiveView !== 'undefined' && bcastActiveView === 'toga') renderTogaBoard(); } catch (_) {}
      return a;
    } },
  ];
  function pullPill() {
    let el = $id('nalunoPull');
    if (el) return el;
    el = doc.createElement('div');
    el.id = 'nalunoPull';
    el.innerHTML = '<span class="naluno-pull-dot"></span><span id="nalunoPullText">Pull to refresh</span>';
    doc.body.appendChild(el);
    return el;
  }
  function bindPull() {
    let s = null;
    doc.addEventListener('touchstart', function (e) {
      s = null;
      if (e.touches.length !== 1) return;
      if (window.nalunoBack && nalunoBack.top && nalunoBack.top()) return;
      const p = point(e);
      if (nearEdge(p) || interactive(e.target)) return;
      for (let i = 0; i < PULLS.length; i++) {
        const def = PULLS[i];
        const tab = $id(def.tab);
        const sc = doc.querySelector(def.sel);
        if (!tab || !sc || !tab.classList.contains('active') || !sc.contains(e.target)) continue;
        if (sc.scrollTop > 0) return;
        if (e.target.closest && e.target.closest('.bcast-strip, .toga-list, #myBcastStrip')) {
          /* Horizontal strips keep their own swipe; a clearly vertical pull still counts. */
        }
        s = { def: def, y: p.y, x: p.x, dy: 0, axis: '' };
        claim();
        return;
      }
    }, { passive: true });
    doc.addEventListener('touchmove', function (e) {
      if (!s) return;
      const p = point(e);
      const dy = p.y - s.y, dx = p.x - s.x;
      if (!s.axis && Math.max(Math.abs(dx), Math.abs(dy)) > 10) s.axis = (dy > 0 && Math.abs(dy) > Math.abs(dx) * 1.4) ? 'down' : 'no';
      if (s.axis !== 'down') return;
      s.dy = Math.min(140, dy * 0.55);
      const pill = pullPill();
      pill.classList.add('on');
      pill.classList.toggle('ready', s.dy > 70);
      pill.style.transform = 'translate(-50%,' + (s.dy - 40) + 'px)';
      $id('nalunoPullText').textContent = s.dy > 70 ? 'Release to refresh' : 'Pull to refresh';
      if (e.cancelable) e.preventDefault();
    }, { passive: false });
    const end = function () {
      if (!s) return;
      const st = s; s = null;
      const pill = $id('nalunoPull');
      if (st.axis !== 'down' || !pill) return;
      if (st.dy > 70) {
        buzz();
        pill.classList.add('busy');
        $id('nalunoPullText').textContent = 'Refreshing…';
        pill.style.transform = 'translate(-50%, 24px)';
        let done = false;
        const finish = function () {
          if (done) return; done = true;
          $id('nalunoPullText').textContent = 'Up to date';
          setTimeout(function () { pill.classList.remove('on', 'ready', 'busy'); pill.style.transform = ''; }, 700);
        };
        let r = null;
        try { r = st.def.run(); } catch (_) {}
        Promise.race([Promise.resolve(r), new Promise(function (ok) { setTimeout(ok, 6000); })]).then(function () { setTimeout(finish, 500); }, finish);
      } else {
        pill.classList.remove('on', 'ready');
        pill.style.transform = '';
      }
    };
    doc.addEventListener('touchend', end, { passive: true });
    doc.addEventListener('touchcancel', end, { passive: true });
  }

  /* ---------- 5. Wireline list: swipe left for quick actions ---------- */
  function closeTrays(except) {
    doc.querySelectorAll('#wirelineList .contact-row.swiped').forEach(function (r) { if (r !== except) r.classList.remove('swiped'); });
  }
  function trayFor(row) {
    let tray = row.querySelector('.wire-swipe-tray');
    if (tray) return tray;
    tray = doc.createElement('div');
    tray.className = 'wire-swipe-tray';
    tray.innerHTML = '<button type="button" data-act="read">Read</button><button type="button" data-act="call">Call</button><button type="button" data-act="clear">Clear</button>';
    row.appendChild(tray);
    tray.addEventListener('click', function (e) {
      const b = e.target.closest && e.target.closest('button[data-act]');
      if (!b) return;
      e.stopPropagation();
      const id = parseInt(row.getAttribute('data-thread'), 10);
      const c = (contacts || []).find(function (x) { return x.id === id; });
      row.classList.remove('swiped');
      if (!c) return;
      const act = b.getAttribute('data-act');
      if (act === 'read') {
        try { if (typeof wireMarkSeen === 'function') wireMarkSeen(typeof wireSeenKey === 'function' ? wireSeenKey(c) : c.firebaseUid, Date.now()); } catch (_) {}
        try { renderWirelineList(); } catch (_) {}
        if (typeof toast === 'function') toast('Marked as read');
      } else if (act === 'call') {
        if (typeof startOutgoingCall === 'function') startOutgoingCall(id);
      } else if (act === 'clear') {
        let ok = true;
        try { ok = window.confirm('Clear this conversation on your side? It can’t be undone.'); } catch (_) {}
        if (!ok) return;
        Promise.resolve(typeof wipeContactSide === 'function' ? wipeContactSide(c) : null).then(function () {
          try { renderWirelineList(); } catch (_) {}
          if (typeof toast === 'function') toast('Cleared on your side');
        });
      }
    });
    return tray;
  }
  function bindWireList() {
    const list = $id('wirelineList');
    if (!list || list.__gest) return;
    list.__gest = true;
    let s = null;
    list.addEventListener('touchstart', function (e) {
      s = null;
      if (e.touches.length !== 1) return;
      const p = point(e);
      const row = e.target.closest && e.target.closest('.contact-row[data-thread]');
      if (!row || nearEdge(p) || (e.target.closest && e.target.closest('.wire-swipe-tray'))) return;
      s = { row: row, x: p.x, y: p.y, dx: 0, axis: '', was: row.classList.contains('swiped') };
    }, { passive: true });
    list.addEventListener('touchmove', function (e) {
      if (!s) return;
      const p = point(e);
      const dx = p.x - s.x, dy = p.y - s.y;
      if (!s.axis && Math.max(Math.abs(dx), Math.abs(dy)) > 10) s.axis = Math.abs(dx) > Math.abs(dy) * 1.4 ? 'x' : 'no';
      if (s.axis !== 'x') return;
      s.dx = dx;
      if (e.cancelable) e.preventDefault();
    }, { passive: false });
    const end = function () {
      if (!s) return;
      const st = s; s = null;
      if (st.axis !== 'x') return;
      swallowNextClick();
      if (st.dx < -50) { trayFor(st.row); closeTrays(st.row); st.row.classList.add('swiped'); buzz(); }
      else if (st.dx > 30) st.row.classList.remove('swiped');
    };
    list.addEventListener('touchend', end, { passive: true });
    list.addEventListener('touchcancel', end, { passive: true });
    /* A tap on an open row closes its tray instead of opening the chat. */
    list.addEventListener('click', function (e) {
      const row = e.target.closest && e.target.closest('.contact-row.swiped');
      if (row && !(e.target.closest && e.target.closest('.wire-swipe-tray'))) { e.stopPropagation(); e.preventDefault(); row.classList.remove('swiped'); }
    }, true);
  }

  function boot() {
    bindStory();
    bindSheets();
    bindReplySwipe();
    bindPull();
    bindWireList();
    /* The Wireline list re-renders often; the delegated listeners above sit
       on its container, so nothing needs re-binding. */
  }
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
