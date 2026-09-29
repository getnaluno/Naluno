/* Member side of discovery.
   The phone does not scan the catalogue. It ranks the Broadcasts already
   loaded, using this person's own taste and any features the desk has
   compiled. Events are small and leave upward. */
(function () {
  const Engine = window.NalunoDiscoverEngine;
  if (!Engine) return;
  const KEY = 'naluno:discover:v1';
  const SEEN = {};
  const WHY = {};
  const FEATURES = {};
  let profile = Engine.blankViewer();
  let config = { modelA: 'ranker_v1', modelB: 'ranker_v2', experimentPercent: 0, discoveryShare: 0.22, maxCreatorShare: 0.34, maxTopicStreak: 2 };
  let saveTimer = null;
  let featureFlight = false;

  function loadLocal() {
    try {
      const raw = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (raw && typeof raw === 'object') profile = Object.assign(Engine.blankViewer(), raw);
    } catch (_) {}
  }
  function saveLocal() {
    try { localStorage.setItem(KEY, JSON.stringify(profile)); } catch (_) {}
  }
  function trimMaps() {
    function cap(map, n) {
      const keys = Object.keys(map || {});
      if (keys.length <= n) return;
      keys.sort(function (a, b) { return Math.abs(map[b] || 0) - Math.abs(map[a] || 0); });
      keys.slice(n).forEach(function (k) { delete map[k]; });
    }
    cap(profile.topics, 60);
    cap(profile.creators, 80);
  }

  function modelForViewer() {
    const all = Engine.models();
    const a = all[config.modelA] || Engine.modelV1();
    const b = all[config.modelB] || Engine.modelV2();
    const pct = Number(config.experimentPercent) || 0;
    let chosen = a;
    try {
      const uid = (typeof currentUser !== 'undefined' && currentUser && currentUser.uid) || '';
      if (pct > 0 && uid) {
        let h = 0;
        for (let i = 0; i < uid.length; i++) h = (h * 33 + uid.charCodeAt(i)) >>> 0;
        if ((h % 100) < pct) chosen = b;
      }
    } catch (_) {}
    return Engine.withConfig(chosen, config);
  }

  function viewerNow() {
    const v = Engine.applyTaste(profile, { type: 'noop' });
    try {
      if (typeof contacts !== 'undefined' && contacts) {
        contacts.forEach(function (c) {
          if (c && c.firebaseUid) v.connected[c.firebaseUid] = 1;
        });
      }
    } catch (_) {}
    return v;
  }

  function order(list) {
    const rows = (list || []).map(function (b) {
      if (!b) return b;
      const copy = Object.assign({}, b);
      if (FEATURES[copy.id]) copy.features = FEATURES[copy.id];
      return copy;
    });
    const viewer = viewerNow();
    const result = Engine.run(rows, viewer, modelForViewer(), Date.now());
    const out = result.feed.map(function (item) {
      const b = item.broadcast;
      b._nalunoPlace = item.place;
      b._why = item.why;
      WHY[b.id] = { why: item.why, model: result.model, sources: item.sources };
      return b;
    });
    /* The ranking decides ORDER. The feed already decided what may be
       shown, so anything the engine left out for any other reason than the
       viewer's own choice (hid the creator or topic, not interested, blocked)
       still appears, at the end. Nothing that shows today disappears. */
    try {
      const have = {};
      out.forEach(function (b) { if (b && b.id) have[b.id] = 1; });
      const v = viewer || {};
      rows.forEach(function (b) {
        if (!b || !b.id || have[b.id]) return;
        const uid = b.creatorUid || '';
        if (uid && ((v.blocked && v.blocked[uid]) || (v.hiddenCreators && v.hiddenCreators[uid]))) return;
        if (v.notInterested && v.notInterested[b.id]) return;
        const topics = (Engine.topicsOf && Engine.topicsOf(b)) || [];
        const ht = v.hiddenTopics || {};
        for (let i = 0; i < topics.length; i++) { if (ht[topics[i]]) return; }
        have[b.id] = 1;
        out.push(b);
      });
    } catch (_) {}
    try { hydrate(rows); } catch (_) {}
    try { seen(out.slice(0, 12)); } catch (_) {}
    return out;
  }

  function hydrate(rows) {
    if (featureFlight || typeof fbDb === 'undefined' || !fbDb) return;
    const missing = [];
    rows.forEach(function (b) {
      if (b && b.id && !FEATURES[b.id]) missing.push(b.id);
    });
    if (!missing.length) return;
    featureFlight = true;
    const ids = missing.slice(0, 40);
    Promise.all(ids.map(function (id) {
      return fbDb.collection('broadcastFeatures').doc(id).get().then(function (snap) {
        if (snap && snap.exists) FEATURES[id] = snap.data() || {};
        else FEATURES[id] = { impressions: 0 };
      }).catch(function () { FEATURES[id] = { impressions: 0 }; });
    })).then(function () {
      featureFlight = false;
      if (typeof renderBroadcastTab === 'function') renderBroadcastTab();
    }).catch(function () { featureFlight = false; });
  }

  function topicsFor(id) {
    let b = null;
    try {
      const pool = (typeof feedBroadcasts !== 'undefined' && feedBroadcasts) ? feedBroadcasts : [];
      b = pool.find(function (x) { return x && x.id === id; }) || null;
    } catch (_) {}
    if (!b && typeof activeBroadcastMeta !== 'undefined') b = activeBroadcastMeta;
    return Engine.topicsOf(b || { id: id });
  }
  function creatorFor(id) {
    try {
      if (typeof activeBroadcastId !== 'undefined' && activeBroadcastId === id && activeBroadcastMeta) {
        return activeBroadcastMeta.creatorUid || '';
      }
    } catch (_) {}
    try {
      const pool = (typeof feedBroadcasts !== 'undefined' && feedBroadcasts) ? feedBroadcasts : [];
      const b = pool.find(function (x) { return x && x.id === id; });
      return (b && b.creatorUid) || '';
    } catch (_) { return ''; }
  }

  function persistProfile() {
    trimMaps();
    saveLocal();
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      try {
        if (typeof fbDb === 'undefined' || !fbDb || typeof currentUser === 'undefined' || !currentUser) return;
        const body = {
          topics: profile.topics || {},
          creators: profile.creators || {},
          followed: profile.followed || {},
          hiddenCreators: profile.hiddenCreators || {},
          notInterested: profile.notInterested || {},
          blocked: profile.blocked || {},
          strands: profile.strands || {},
          bands: profile.bands || {},
          hiddenTopics: profile.hiddenTopics || {},
          region: profile.region || '',
          updatedAt: Date.now(),
        };
        fbDb.collection('userInterestProfile').doc(currentUser.uid).set(body, { merge: true }).catch(function () {});
      } catch (_) {}
    }, 1200);
  }

  function pullProfile() {
    try {
      if (typeof fbDb === 'undefined' || !fbDb || typeof currentUser === 'undefined' || !currentUser) return;
      fbDb.collection('userInterestProfile').doc(currentUser.uid).get().then(function (snap) {
        if (!snap || !snap.exists) return;
        profile = Object.assign(Engine.blankViewer(), snap.data() || {});
        saveLocal();
      }).catch(function () {});
      /* 29h: follows the console live instead of one read per session. */
      if (!pullProfile._cfg) {
        pullProfile._cfg = fbDb.collection('discoveryConfig').doc('live').onSnapshot(function (snap) {
          if (snap && snap.exists) config = Object.assign(config, snap.data() || {});
        }, function () { pullProfile._cfg = null; setTimeout(pullProfile, 5000); });
      }
    } catch (_) {}
  }

  function writeEvent(ev) {
    try {
      if (typeof fbDb === 'undefined' || !fbDb || typeof currentUser === 'undefined' || !currentUser) return;
      const body = {
        uid: currentUser.uid,
        broadcastId: ev.broadcastId || '',
        creatorUid: ev.creatorUid || '',
        type: ev.type,
        at: Date.now(),
        model: (WHY[ev.broadcastId] && WHY[ev.broadcastId].model) || modelForViewer().id,
      };
      if (ev.watchSec) body.watchSec = Math.round(ev.watchSec);
      if (ev.durationSec) body.durationSec = Math.round(ev.durationSec);
      if (ev.topic) body.topic = String(ev.topic).slice(0, 40);
      fbDb.collection('recommendationEvents').add(body).catch(function () {});
    } catch (_) {}
  }

  function note(type, broadcastId, extra) {
    const id = broadcastId || '';
    const ev = Object.assign({
      type: type,
      broadcastId: id,
      creatorUid: creatorFor(id),
      topics: topicsFor(id),
    }, extra || {});
    profile = Engine.applyTaste(profile, ev);
    persistProfile();
    if (type !== 'more' && type !== 'less' && type !== 'reset' && type !== 'noop') writeEvent(ev);
    if (id && (type === 'like' || type === 'unlike' || type === 'dislike' || type === 'undislike' || type === 'kept_line' || type === 'comment_react')) {
      const f = Object.assign({ impressions: FEATURES[id] && FEATURES[id].impressions || 0 }, FEATURES[id] || {});
      if (type === 'like') f.likes = (Number(f.likes) || 0) + 1;
      if (type === 'unlike') f.likes = Math.max(0, (Number(f.likes) || 0) - 1);
      if (type === 'dislike') {
        f.dislikes = (Number(f.dislikes) || 0) + 1;
        f.negativeEvents = (Number(f.negativeEvents) || 0) + 1;
      }
      if (type === 'undislike') {
        f.dislikes = Math.max(0, (Number(f.dislikes) || 0) - 1);
        f.negativeEvents = Math.max(0, (Number(f.negativeEvents) || 0) - 1);
      }
      if (type === 'kept_line') f.keptLines = (Number(f.keptLines) || 0) + 1;
      if (type === 'comment_react') f.commentReacts = (Number(f.commentReacts) || 0) + 1;
      FEATURES[id] = f;
    }
    if (type === 'open' || type === 'not_interested' || type === 'hide_creator' || type === 'hide_topic' || type === 'reset' || type === 'like' || type === 'dislike' || type === 'more' || type === 'less') {
      try { if (typeof renderBroadcastTab === 'function') renderBroadcastTab(); } catch (_) {}
    }
  }

  function seen(rows) {
    if (typeof currentUser === 'undefined' || !currentUser) return;
    (rows || []).forEach(function (b) {
      if (!b || !b.id || SEEN[b.id]) return;
      SEEN[b.id] = 1;
      writeEvent({ type: 'broadcast_impression', broadcastId: b.id, creatorUid: b.creatorUid || '', topic: (Engine.topicsOf(b)[0] || '') });
    });
  }

  const watchMark = {};
  function noteWatch(id, sec, dur) {
    if (!id || !dur || dur < 1) return;
    const pct = sec / dur;
    const steps = [
      ['watch_3s', sec >= 3],
      ['watch_10s', sec >= 10],
      ['watch_25_percent', pct >= 0.25],
      ['watch_50_percent', pct >= 0.5],
      ['watch_75_percent', pct >= 0.75],
      ['watch_90_percent', pct >= 0.9],
      ['watch_completed', pct >= 0.97],
    ];
    steps.forEach(function (pair) {
      const key = id + ':' + pair[0];
      if (!pair[1] || watchMark[key]) return;
      watchMark[key] = 1;
      note(pair[0], id, { watchSec: sec, durationSec: dur, topic: topicsFor(id)[0] || '' });
    });
  }

  function ensureSheet() {
    let sheet = document.getElementById('discoverSheet');
    if (sheet) return sheet;
    sheet = document.createElement('div');
    sheet.id = 'discoverSheet';
    sheet.className = 'call-overlay';
    sheet.innerHTML = '<div class="discover-card" role="dialog" aria-label="Why this">'
      + '<div class="discover-top"><b>Why this</b><button type="button" id="discoverClose">Close</button></div>'
      + '<p id="discoverWhy" class="discover-why"></p>'
      + '<div class="discover-actions">'
      + '<button type="button" id="discoverMore">More like this</button>'
      + '<button type="button" id="discoverLess">Less of this</button>'
      + '<button type="button" id="discoverSkip">Not interested</button>'
      + '<button type="button" id="discoverHide">Hide this creator</button>'
      + '</div>'
      + '</div>';
    document.body.appendChild(sheet);
    sheet.querySelector('#discoverClose').onclick = close;
    sheet.addEventListener('click', function (e) { if (e.target === sheet) close(); });
    sheet.querySelector('#discoverMore').onclick = function () { act('more'); };
    sheet.querySelector('#discoverLess').onclick = function () { act('less'); };
    sheet.querySelector('#discoverSkip').onclick = function () { act('not_interested'); };
    sheet.querySelector('#discoverHide').onclick = function () { act('hide_creator'); };
    return sheet;
  }
  function currentId() {
    try { return (typeof activeBroadcastId !== 'undefined' && activeBroadcastId) || ''; } catch (_) { return ''; }
  }
  function act(type) {
    const id = currentId();
    note(type, id);
    close();
    try {
      if (typeof toast === 'function') {
        toast(type === 'not_interested' ? 'We will show this less' : (type === 'hide_creator' ? 'That creator is hidden on this phone' : 'Noted'));
      }
    } catch (_) {}
  }
  function whyForPlaying() {
    const id = currentId();
    let b = { id: id };
    try {
      if (typeof activeBroadcastMeta !== 'undefined' && activeBroadcastMeta) {
        const mid = activeBroadcastMeta.broadcastId || activeBroadcastMeta.id || '';
        if (!id || !mid || mid === id) b = Object.assign({}, activeBroadcastMeta, { id: mid || id });
      }
    } catch (_) {}
    if (b.id && FEATURES[b.id]) b.features = FEATURES[b.id];
    try {
      const scored = Engine.scoreOne(b, viewerNow(), modelForViewer(), Date.now());
      if (scored && scored.why) {
        WHY[b.id] = { why: scored.why, model: modelForViewer().id, sources: scored.sources };
        return scored.why;
      }
    } catch (_) {}
    return (WHY[id] && WHY[id].why) || 'You opened this yourself.';
  }
  function holdPlayback() {
    const v = document.getElementById('bspaceVideoEl');
    if (!v || v.paused) return;
    try {
      v.dataset.nalunoKeepAlive = '1';
      v.dataset.nalunoWantPlay = '1';
    } catch (_) {}
    function resume() {
      if (v && v.paused && v.dataset.nalunoUserPaused !== '1') {
        const p = v.play();
        if (p && p.catch) p.catch(function () {});
      }
    }
    resume();
    setTimeout(resume, 60);
    setTimeout(resume, 280);
  }
  function open() {
    const room = document.getElementById('bspace');
    const hero = document.getElementById('bspaceHero');
    if (!room || !room.classList.contains('active')) return;
    const host = (hero && room.contains(hero)) ? hero : room;
    const sheet = ensureSheet();
    if (sheet.parentElement !== host) host.appendChild(sheet);
    sheet.classList.add('over-video');
    const why = document.getElementById('discoverWhy');
    if (why) why.textContent = whyForPlaying();
    sheet.classList.add('active');
    holdPlayback();
    try { if (window.nalunoBack) window.nalunoBack.push(); } catch (_) {}
  }
  function close() {
    const sheet = document.getElementById('discoverSheet');
    if (sheet) {
      sheet.classList.remove('active');
      sheet.classList.remove('over-video');
    }
    try { if (window.nalunoBack) window.nalunoBack.drop('discoverSheet'); } catch (_) {}
  }

  function bind() {
    const whyBtn = document.getElementById('bspaceWhyBtn');
    if (whyBtn && !whyBtn._nalunoDiscover) {
      whyBtn._nalunoDiscover = 1;
      whyBtn.onclick = function (e) {
        if (e) { e.preventDefault(); e.stopPropagation(); }
        const why = whyForPlaying();
        if (typeof bspaceShowAction === 'function') {
          /* The old map turned '<' into '<' (a no-op), so the reason was not
             escaped at all. Escape it properly before it goes into HTML. */
          const safe = String(why || '').replace(/[&<>"']/g, function(c){ return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]); });
          bspaceShowAction('Why this', '<p class="hint bspace-why-text" style="margin:8px 0 0;">' + safe + '</p>');
          return;
        }
        const menu = document.getElementById('bspaceMoreMenu');
        if (menu) menu.hidden = true;
        open();
      };
    }
    const join = document.getElementById('bspaceJoinBtn');
    if (join && !join._nalunoDiscover) {
      join._nalunoDiscover = 1;
      join.addEventListener('click', function () {
        if(join.classList.contains('joined')) return;
        const id = currentId();
        if (id) note('follow_creator', id);
      });
    }
    const share = document.getElementById('bspaceShareBtn');
    if (share && !share._nalunoDiscover) {
      share._nalunoDiscover = 1;
      share.addEventListener('click', function () {
        const id = currentId();
        if (id) note('share', id);
      });
    }
  }

  loadLocal();
  setInterval(function () {
    try {
      const space = document.getElementById('bspace');
      if (!space || !space.classList.contains('active')) return;
      const v = document.getElementById('bspaceVideoEl');
      const id = currentId();
      if (!v || !id || !isFinite(v.duration) || v.duration < 1) return;
      noteWatch(id, v.currentTime || 0, v.duration);
    } catch (_) {}
  }, 2000);
  /* It used to read once, 1.5 s after load, and skip for the whole session
     if sign-in was not ready by then. */
  function pullWhenSignedIn() {
    let n = 0;
    const t = setInterval(function () {
      n++;
      if (typeof currentUser !== 'undefined' && currentUser && typeof fbDb !== 'undefined' && fbDb) { clearInterval(t); pullProfile(); }
      else if (n > 600) clearInterval(t);
    }, 1000);
  }
  document.addEventListener('DOMContentLoaded', function () {
    bind();
    pullWhenSignedIn();
  });
  if (document.readyState !== 'loading') {
    bind();
    pullWhenSignedIn();
  }

  const prevOpen = window.openBroadcastById;
  if (typeof prevOpen === 'function') {
    window.openBroadcastById = function (id) {
      try { note('broadcast_open', id); } catch (_) {}
      return prevOpen(id);
    };
  }

  window.NalunoDiscover = { order: order, note: note, open: open, close: close, whyNow: whyForPlaying, profile: function () { return profile; } };
})();
