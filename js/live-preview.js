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
  }
  function unwatch(bid) {
    const f = follow[bid];
    if (!f) return;
    delete follow[bid];
    try { if (f.unsub) f.unsub(); } catch (_) {}
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

  window.nalunoLivePreviewStart = start;
  window.nalunoLivePreviewStop = stop;
  window.nalunoLivePreviewScan = scan;
})();
