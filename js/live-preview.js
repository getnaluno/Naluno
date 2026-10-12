/* 29g — a live Broadcast shows what is happening on the feed.
   Before, a live plate on the Broadcast feed was the creator's initial on a
   blank card until the live ended. Now:
   - The host's phone publishes a small still of its camera every 2 s to
     broadcasts/{id}/livePreview/frame (about 20–40 KB, one document, so the
     1-write-a-second limit is never near).
   - A live plate that is on screen follows that document and shows the
     picture, with the LIVE mark. Plates that are off screen, or a feed that
     is not showing, stop following, so browsing costs nothing.
   - Tapping the plate opens the Broadcast, which joins the live by itself
     (broadcast-live.js bLiveOnSpaceOpened).
   The frame is only shown when it was written by the Broadcast's creator. */
(function () {
  const EVERY_MS = 2000;
  const W = 360;
  const MAX_BYTES = 90000;

  /* ---------------- host ---------------- */
  let host = null;
  function frameRef(bid) {
    return fbDb.collection('broadcasts').doc(bid).collection('livePreview').doc('frame');
  }
  function grab(video, canvas) {
    const vw = video.videoWidth || 0, vh = video.videoHeight || 0;
    if (!vw || !vh) return '';
    const w = Math.min(W, vw);
    const h = Math.round(w * vh / vw);
    canvas.width = w; canvas.height = h;
    const g = canvas.getContext('2d');
    g.drawImage(video, 0, 0, w, h);
    let q = 0.6, url = canvas.toDataURL('image/jpeg', q);
    while (url.length > MAX_BYTES && q > 0.25) { q -= 0.12; url = canvas.toDataURL('image/jpeg', q); }
    return url.length > MAX_BYTES ? '' : url;
  }
  function start(bid, stream) {
    stop();
    if (!bid || !stream || typeof fbDb === 'undefined' || !fbDb || typeof currentUser === 'undefined' || !currentUser) return;
    const track = stream.getVideoTracks && stream.getVideoTracks()[0];
    if (!track) return;
    const video = document.createElement('video');
    video.muted = true; video.playsInline = true; video.setAttribute('playsinline', '');
    video.dataset.nalunoPreview = '1';
    video.srcObject = new MediaStream([track]);
    video.play().catch(function () {});
    const canvas = document.createElement('canvas');
    const me = { bid: bid, video: video, timer: null, busy: false, stopped: false };
    host = me;
    const tick = function () {
      if (me.stopped || me.busy) return;
      if (track.readyState === 'ended') { stop(); return; }
      let url = '';
      try { url = grab(video, canvas); } catch (_) { url = ''; }
      if (!url) return;
      me.busy = true;
      frameRef(bid).set({ from: currentUser.uid, frame: url, at: Date.now(), w: canvas.width, h: canvas.height }, { merge: true })
        .catch(function () {})
        .then(function () { me.busy = false; });
    };
    setTimeout(tick, 600);
    me.timer = setInterval(tick, EVERY_MS);
  }
  function stop() {
    const me = host;
    host = null;
    if (!me) return;
    me.stopped = true;
    if (me.timer) clearInterval(me.timer);
    try { me.video.srcObject = null; } catch (_) {}
    try { frameRef(me.bid).delete().catch(function () {}); } catch (_) {}
  }

  /* ---------------- feed ---------------- */
  const follow = {};   // bid -> { unsub, plate }
  function feedShowing() {
    const tab = document.getElementById('tab-broadcast');
    if (!tab || !tab.classList.contains('active')) return false;
    const space = document.getElementById('bspace');
    if (space && space.classList.contains('active')) return false;
    return !document.hidden;
  }
  function paint(plate, url) {
    const frame = plate.querySelector('.bcast-plate-frame');
    if (!frame) return;
    let img = frame.querySelector('img.bcast-live-frame');
    if (!img) {
      img = document.createElement('img');
      img.className = 'bcast-live-frame';
      img.alt = '';
      frame.insertBefore(img, frame.firstChild);
    }
    if (img.getAttribute('src') !== url) img.setAttribute('src', url);
    plate.classList.add('has-live-frame');
  }
  function watch(plate) {
    const bid = plate.getAttribute('data-broadcast-id');
    const creator = plate.getAttribute('data-creator-uid') || '';
    if (!bid || follow[bid] || typeof fbDb === 'undefined' || !fbDb) return;
    const f = { plate: plate, unsub: null };
    follow[bid] = f;
    try {
      f.unsub = frameRef(bid).onSnapshot(function (snap) {
        const d = snap && snap.exists ? (snap.data() || {}) : null;
        if (!d || !d.frame || (creator && d.from !== creator)) return;
        if (typeof d.frame !== 'string' || d.frame.indexOf('data:image/jpeg;base64,') !== 0) return;
        if (Date.now() - (Number(d.at) || 0) > 120000) return; // a host that vanished
        paint(f.plate.isConnected ? f.plate : plate, d.frame);
      }, function () { unwatch(bid); });
    } catch (_) { delete follow[bid]; }
    // 12b: the LIVE mark on a plate whose host stopped sending says so.
    try {
      f.beat = watchHeartbeat(bid, creator, function (state) {
        const pl = f.plate.isConnected ? f.plate : plate;
        pl.classList.toggle('live-quiet', state === 'quiet');
        const w = pl.querySelector('.bcast-live-wait');
        if (w) w.textContent = state === 'quiet' ? 'Live \u00b7 host not sending' : 'Live now \u00b7 tap to join';
      });
    } catch (_) {}
  }
  function unwatch(bid) {
    const f = follow[bid];
    if (!f) return;
    delete follow[bid];
    try { if (f.unsub) f.unsub(); } catch (_) {}
    try { if (f.beat) f.beat(); } catch (_) {}
  }
  function unwatchAll() { Object.keys(follow).forEach(unwatch); }
  function onScreen(el) {
    const r = el.getBoundingClientRect();
    const h = window.innerHeight || 800, w = window.innerWidth || 400;
    return r.width > 2 && r.height > 2 && r.bottom > h * 0.08 && r.top < h * 0.92 && r.right > 0 && r.left < w;
  }
  function scan() {
    Object.keys(follow).forEach(function (bid) {
      const p = follow[bid].plate;
      if (!p.isConnected || !feedShowing() || !onScreen(p)) unwatch(bid);
    });
    try{ if (typeof bLiveSyncFeed === 'function') bLiveSyncFeed(); }catch (_){}
    if (!feedShowing()) return;
    document.querySelectorAll('#tab-broadcast .bcast-plate[data-live="1"]').forEach(function (p) {
      if (onScreen(p)) watch(p);
    });
  }
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) unwatchAll();
    else scan();
  });
  document.addEventListener('scroll', function () {
    if (scan._t) return;
    scan._t = setTimeout(function () { scan._t = null; scan(); }, 250);
  }, true);
  setInterval(scan, 1500);

  /* ---------------- 12b: a live whose host is gone ----------------
     A live Broadcast always sends camera stills to the frame document every
     2 s while its host is really on air (going live needs the camera). When
     the host's phone dies or the app is killed, nothing ends the live, so the
     Broadcast stayed "live" for ever: viewers sat on "Connecting to live…"
     and the feed kept the LIVE mark. The frame document is the heartbeat.
     Nothing here changes anyone else's data: viewers and the feed only change
     what they show, and only the creator's own app ends its own dead live. */
  const QUIET_WATCH_MS = 20000;          // no new still for this long, while watching
  const DEAD_AGE_MS = 10 * 60 * 1000;    // last still older than this (generous for clock skew)
  function frameAt(d) { return d ? (Number(d.at) || 0) : 0; }
  // cb('fresh'|'quiet'). 'quiet' only after watching QUIET_WATCH_MS with no new
  // still (measured on this device's clock, so other phones' clocks don't matter),
  // or at once when the last still is far older than any clock difference.
  function watchHeartbeat(bid, creator, cb) {
    if (!bid || typeof fbDb === 'undefined' || !fbDb) return function () {};
    let lastAt = -1, lastSeen = Date.now(), state = '', unsub = null, done = false;
    const say = function (s) { if (!done && s !== state) { state = s; try { cb(s); } catch (_) {} } };
    try {
      unsub = frameRef(bid).onSnapshot(function (snap) {
        const d = snap && snap.exists ? (snap.data() || {}) : null;
        const ok = d && (!creator || d.from === creator);
        const at = ok ? frameAt(d) : 0;
        if (at && at !== lastAt) {
          // The first still seen may already be old (the watch restarts when
          // the Broadcast re-renders): count its age, at most one quiet spell,
          // so an old still never reads as a host that is back.
          lastSeen = lastAt === -1 ? Math.min(Date.now(), Math.max(at, Date.now() - QUIET_WATCH_MS)) : Date.now();
          lastAt = at;
        }
        if (at && Date.now() - at > DEAD_AGE_MS) say('quiet');
        else if (at && Date.now() - lastSeen < QUIET_WATCH_MS) say('fresh');
      }, function () {});
    } catch (_) {}
    const t = setInterval(function () {
      if (Date.now() - lastSeen >= QUIET_WATCH_MS) say('quiet');
    }, 2000);
    return function () { done = true; clearInterval(t); try { if (unsub) unsub(); } catch (_) {} };
  }

  /* 12c — the limelight. A live of the creator's that stopped sending (their
     phone died, Naluno was killed) is not ended at once: the creator gets a
     card, here and as a push from the server (workers/economy/live-sweep.mjs),
     to Resume live or End live. If nobody resumes within LIMELIGHT_MS of its
     last still, it is stopped: by this app if it is open, else by the server.
     A live really running on another of their devices keeps sending stills,
     so it is never offered here and never touched. Same numbers as the server. */
  const LIVE_QUIET_MS = 2 * 60 * 1000;
  const LIMELIGHT_MS = 15 * 60 * 1000;
  let swept = false;
  const lime = {};   // bid -> { el, timer, b, endsAt }
  function hostingHere(bid) {
    try { if (typeof bspaceLiveStream !== 'undefined' && bspaceLiveStream && typeof activeBroadcastId !== 'undefined' && activeBroadcastId === bid) return true; } catch (_) {}
    return !!(host && host.bid === bid);
  }
  function lastOf(b, f) {
    return Math.max(frameAt(f), Number(b.liveAt) || 0, Number(b.liveResumedAt) || 0);
  }
  function fmtFor(ms) {
    const m = Math.max(0, Math.round((Number(ms) || 0) / 60000));
    if (m < 1) return 'under a minute';
    if (m < 60) return m + (m === 1 ? ' minute' : ' minutes');
    const h = Math.floor(m / 60), r = m % 60;
    return h + (h === 1 ? ' hour' : ' hours') + (r ? ' ' + r + ' min' : '');
  }
  async function endOwnLive(bid, b, lastAt) {
    const ref = fbDb.collection('broadcasts').doc(bid);
    const cur = await ref.get().catch(function () { return null; });
    const c = cur && cur.exists ? (cur.data() || {}) : null;
    if (!c || c.live !== true || (Number(c.liveAt) || 0) !== (Number(b.liveAt) || 0)) return false; // changed meanwhile
    if (hostingHere(bid)) return false;
    const started = Number(b.liveAt) || null;
    const ended = Number(lastAt) || Date.now();
    const dur = started ? Math.max(0, ended - started) : null;
    await ref.set({ live: false, liveAt: null, liveBy: null, lastLiveStartedAt: started, lastLiveEndedAt: ended, lastLiveDurationMs: dur,
      liveEndReason: 'host-gone', liveDroppedAt: null, liveDroppedNotifiedAt: null, liveLimelightUntil: null, updatedAt: Date.now() }, { merge: true });
    frameRef(bid).delete().catch(function () {});
    try {
      const who = (typeof currentProfile !== 'undefined' && currentProfile && currentProfile.name) || 'Creator';
      ref.collection('conversation').add({ type: 'system', kind: 'was_live', durationMs: dur, text: who + ' was live' + (dur != null ? ' for ' + fmtFor(dur) : '') + '.', from: currentUser.uid, ts: Date.now() }).catch(function () {});
    } catch (_) {}
    console.log('[live] ended own live that had stopped sending', bid);
    return true;
  }
  function closeLime(bid) {
    const L = lime[bid];
    if (!L) return;
    delete lime[bid];
    clearInterval(L.timer);
    try { L.el.remove(); } catch (_) {}
  }
  async function resumeLive(bid) {
    const L = lime[bid];
    const b = (L && L.b) || {};
    closeLime(bid);
    window.__nalunoResumeLive = { bid: bid, liveAt: Number(b.liveAt) || Date.now() };
    try {
      if (typeof openBroadcastById === 'function') await openBroadcastById(bid);
      for (let i = 0; i < 80; i++) {
        if (typeof activeBroadcastId !== 'undefined' && activeBroadcastId === bid && typeof activeBroadcastMeta !== 'undefined' && activeBroadcastMeta) break;
        await new Promise(function (r) { setTimeout(r, 100); });
      }
      if (typeof bspaceStartLive === 'function') await bspaceStartLive();
    } catch (e) {
      console.warn('[live] resume', e);
      if (typeof toast === 'function') toast('Could not resume the live');
    }
  }
  function showLime(bid, b, lastAt, endsAt) {
    if (lime[bid] || typeof document === 'undefined' || !document.body) return;
    const el = document.createElement('div');
    el.className = 'naluno-limelight';
    el.setAttribute('role', 'alertdialog');
    el.setAttribute('aria-live', 'assertive');
    el.dataset.broadcastId = bid;
    el.style.cssText = 'position:fixed;left:12px;right:12px;bottom:calc(84px + env(safe-area-inset-bottom,0px));z-index:9000;max-width:460px;margin:0 auto;'
      + 'background:#151926;color:#E8ECF5;border:1px solid rgba(255,84,112,.55);border-radius:16px;padding:14px 16px;'
      + 'box-shadow:0 0 0 1px rgba(255,84,112,.15),0 12px 40px rgba(0,0,0,.55),0 0 32px rgba(255,84,112,.25);font-family:inherit;';
    const title = String(b.title || 'Your live').slice(0, 80);
    el.innerHTML = '<div style="display:flex;align-items:center;gap:8px;font-weight:700;font-size:15px;">'
      + '<span style="width:9px;height:9px;border-radius:50%;background:#ff5470;box-shadow:0 0 10px #ff5470;"></span>Your live dropped</div>'
      + '<div class="lime-text" style="margin-top:6px;font-size:13px;line-height:1.45;color:rgba(232,236,245,.85);"></div>'
      + '<div style="display:flex;gap:10px;margin-top:12px;">'
      + '<button type="button" class="lime-resume" style="flex:1;padding:11px 12px;border-radius:12px;border:0;background:#ff5470;color:#fff;font-weight:700;font-size:14px;">Resume live</button>'
      + '<button type="button" class="lime-end" style="flex:1;padding:11px 12px;border-radius:12px;border:1px solid rgba(232,236,245,.25);background:none;color:#E8ECF5;font-size:14px;">End live</button></div>';
    const text = el.querySelector('.lime-text');
    const paint = function () {
      const left = endsAt - Date.now();
      if (left <= 0) {
        const L = lime[bid];
        if (L) clearInterval(L.timer);
        endOwnLive(bid, b, lastAt).catch(function () {}).then(function () {
          text.textContent = '“' + title + '” has ended.';
          el.querySelectorAll('button').forEach(function (x) { x.remove(); });
          setTimeout(function () { closeLime(bid); }, 5000);
        });
        return;
      }
      text.textContent = '“' + title + '” stopped sending ' + fmtFor(Date.now() - lastAt) + ' ago. Viewers are waiting. Resume within '
        + fmtFor(left) + ', or it ends.';
    };
    el.querySelector('.lime-resume').onclick = function () { resumeLive(bid); };
    el.querySelector('.lime-end').onclick = function () {
      closeLime(bid);
      endOwnLive(bid, b, lastAt).then(function (ok) { if (ok && typeof toast === 'function') toast('Live ended'); }).catch(function () {});
    };
    document.body.appendChild(el);
    lime[bid] = { el: el, b: b, endsAt: endsAt, timer: setInterval(paint, 15000) };
    paint();
  }
  async function sweepOwnDeadLives() {
    if (swept || typeof fbDb === 'undefined' || !fbDb || typeof currentUser === 'undefined' || !currentUser) return;
    swept = true;
    const uid = currentUser.uid;
    let snap;
    try { snap = await fbDb.collection('broadcasts').where('creatorUid', '==', uid).where('live', '==', true).limit(10).get(); } catch (_) { swept = false; return; }
    const docs = (snap && snap.docs) || [];
    for (const doc of docs) {
      const b = doc.data() || {};
      if (hostingHere(doc.id)) continue;
      const first = await frameRef(doc.id).get().catch(function () { return null; });
      if (first === null) continue;
      const f1 = first.exists ? (first.data() || {}) : null;
      let lastAt = lastOf(b, f1);
      const serverSaysDropped = (Number(b.liveDroppedAt) || 0) > 0 && (Number(b.liveDroppedAt) || 0) >= lastAt - 1000;
      if (!serverSaysDropped && Date.now() - lastAt < LIVE_QUIET_MS) {
        // Recently sending: watch a little before calling it dropped.
        await new Promise(function (r) { setTimeout(r, QUIET_WATCH_MS); });
        if (hostingHere(doc.id) || !currentUser || currentUser.uid !== uid) continue;
        const again = await frameRef(doc.id).get().catch(function () { return null; });
        if (again === null) continue;
        if (frameAt(again.exists ? again.data() : null) !== frameAt(f1)) continue; // it is alive
      }
      const endsAt = (Number(b.liveLimelightUntil) || 0) > lastAt ? Number(b.liveLimelightUntil) : lastAt + LIMELIGHT_MS;
      if (Date.now() >= endsAt) {
        try {
          if (await endOwnLive(doc.id, b, lastAt) && typeof toast === 'function') toast('Your live “' + String(b.title || '').slice(0, 40) + '” ended while you were away');
        } catch (e) { console.warn('[live] could not end stale live', doc.id, e && e.code); }
        continue;
      }
      showLime(doc.id, b, lastAt, endsAt);
    }
  }
  try {
    if (window.firebase && firebase.auth) {
      firebase.auth().onAuthStateChanged(function (u) { if (u) setTimeout(function () { sweepOwnDeadLives().catch(function () {}); }, 2500); });
    }
    // Back in front after a while (the push was tapped, or the phone woke): look again.
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden && typeof currentUser !== 'undefined' && currentUser) { swept = false; sweepOwnDeadLives().catch(function () {}); }
    });
  } catch (_) {}

  window.nalunoLimelightClose = closeLime;
  window.nalunoLiveHeartbeat = watchHeartbeat;
  window.nalunoSweepOwnDeadLives = sweepOwnDeadLives;
  window.nalunoLivePreviewStart = start;
  window.nalunoLivePreviewStop = stop;
  window.nalunoLivePreviewScan = scan;
})();
