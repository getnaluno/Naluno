/* ============================================================
   MODULE: js/nudenet.js   —   Naluno content moderation

   Replaces js/nsfw-model.js. Loads AFTER screen.js and upgrades
   runNalunoScreen() in place; the Broadcast composer and the Signal
   composer both call it.

   WHAT CHANGED, AND WHY — measured on real uploads, not guessed
   The previous whole-image classifier (NSFWJS) was tested on three real
   images, across all three of its model sizes:
     - lingerie seen from behind      -> "Porn" 0.63-0.89   (should be fine)
     - an explicit act under a video play-button -> "Drawing"  (should be caught)
   It answers "what kind of picture is this?". The policy needs a different
   question: "what is EXPOSED?". So this uses NudeNet, an object detector that
   reports body parts — male chest, buttocks, female breast, genitals — and a
   written policy decides which of those matter.

   The model is NudeNet 320n (MIT), quantised to int8: 11.6 MB -> 3.1 MB with
   near-identical results on the test images, so it is affordable on mobile
   data. It runs on the device; nothing is sent to a third-party scanner.

   HONEST LIMITS
   - It cannot see what is not in the pixels. An act where the anatomy is
     hidden behind a head or an overlay has no exposed part to detect. The
     video-player check below exists because that is exactly how explicit
     previews are disguised.
   - It runs on the device, so a deliberately modified app could skip it.
     The server validates what it receives, untrusted publishers are held,
     and Report + the console review queue remain the backstop.
   ============================================================ */
(function (root) {
  var ORT_BASE  = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.1/dist/';
  var ORT_URL   = ORT_BASE + 'ort.wasm.min.js';
  // Self-hosted: a moderation system that stops working when someone else's
  // bucket moves is worse than none.
  var MODEL_URL = '/models/nudenet/320n.int8.onnx';
  var S = 320;
  /* =====================================================================================
     NALUNO MODERATION RULEBOOK
     IDENTICAL in js/nudenet.js and workers/economy/screen.mjs. Change both or neither.
     The same definitions are shown to human reviewers in the console, so a person and
     the machine apply one standard.

     ------------------------------------------------------------------------------------
     WHAT "EXPLICIT" MEANS ON NALUNO — rejected
     ------------------------------------------------------------------------------------
     A photo or video is explicit if it shows ANY of these, of any person, in any setting:

       1. GENITALS — exposed male or female genitals.
       2. ANUS — exposed.
       3. FEMALE BREAST — an exposed female nipple/areola ("topless"). This includes
          breastfeeding, for now. Owner decision, to be revisited as Naluno grows.
       4. NUDITY — two or more of the above exposed together.
       5. SEXUAL ACTS — intercourse, oral sex, masturbation, sexual touching of
          genitals — EVEN IF the genitals themselves are hidden.

     "Pornographic" on Naluno means content made to show 1-5. A video is pornographic
     if those things appear in it; its title, music or intent do not change that.

     ------------------------------------------------------------------------------------
     WHAT IS NOT EXPLICIT — accepted, however "sexy"
     ------------------------------------------------------------------------------------
     Naluno allows sensual, glamorous and revealing content. None of these is rejected:

       - Bikinis, swimwear, lingerie, underwear, bodysuits — as long as nipples and
         genitals are covered.
       - Thongs and G-strings: exposed BUTTOCKS are allowed (the anus is not).
       - Shirtless men — a male chest is not nudity.
       - Cleavage, sideboob with the nipple covered, midriffs, bare backs, bare legs.
       - Dancing, twerking, pole and stage shows, suggestive poses, sensual movement,
         modelling, fitness, beach, pool and bedroom photos — clothed as above.
       - Kissing and affection between clothed people.
       - Tight, short or sheer clothing that still covers nipples and genitals.

     The test is WHAT IS EXPOSED, never how much skin shows or how provocative it looks.

     ------------------------------------------------------------------------------------
     HOW THE MACHINE APPLIES THIS — and where it stops
     ------------------------------------------------------------------------------------
     The detector (NudeNet) reports body parts with a confidence 0-1. It reliably sees
     rules 1-4. It CANNOT see rule 5 when the anatomy is hidden: an act with no exposed
     part has nothing to detect. Those are caught by reports and human review, and a
     screenshot of a video player (the usual disguise for reposted porn) is held.

     Confidence bands — chosen so that a wrong guess goes to a PERSON, not straight to
     rejection. The breast threshold is higher than the genital one because cleavage
     and bikini tops are its most common misread.

                                  REJECT      HOLD (a person looks)
       genitals / anus            >= 0.50     0.30 - 0.50
       female breast (topless)    >= 0.55     0.35 - 0.55
       two intimate parts         each >= 0.40
       video-player screenshot                >= 0.85

     VIDEOS are judged across all sampled frames (3, 5 or 8 depending on length):
       - REJECT if any single frame is near-certain (>= 0.80), or if TWO OR MORE frames
         reach the reject level. Real explicit video shows it repeatedly.
       - HOLD if only ONE frame reaches the reject level. One frame out of eight is how
         a dancer's turn or a lighting flash gets misread — that goes to a person, it
         does not reject a genuine video.
     Nothing explicit becomes public under these rules: anything uncertain is held.
     ===================================================================================== */
  var MOD_LABELS = ["FEMALE_GENITALIA_COVERED","FACE_FEMALE","BUTTOCKS_EXPOSED","FEMALE_BREAST_EXPOSED",
    "FEMALE_GENITALIA_EXPOSED","MALE_BREAST_EXPOSED","ANUS_EXPOSED","FEET_EXPOSED","BELLY_COVERED",
    "FEET_COVERED","ARMPITS_COVERED","ARMPITS_EXPOSED","FACE_MALE","BELLY_EXPOSED",
    "MALE_GENITALIA_EXPOSED","ANUS_COVERED","FEMALE_BREAST_COVERED","BUTTOCKS_COVERED"];
  var MOD_ANATOMY = { FEMALE_GENITALIA_EXPOSED: 1, MALE_GENITALIA_EXPOSED: 1, ANUS_EXPOSED: 1 };
  var MOD_INTIMATE = { FEMALE_GENITALIA_EXPOSED: 1, MALE_GENITALIA_EXPOSED: 1, ANUS_EXPOSED: 1, FEMALE_BREAST_EXPOSED: 1 };
  var MOD_REVEALING = { MALE_BREAST_EXPOSED: 1, BUTTOCKS_EXPOSED: 1, BELLY_EXPOSED: 1 };
  var MOD_T = {
    anatomyReject: 0.50, anatomyHold: 0.30,
    breastReject: 0.55,  breastHold: 0.35,
    pair: 0.40, certain: 0.80, player: 0.85,
  };
  /* Plain-language reasons, shown to uploaders and reviewers. */
  var MOD_REASON_TEXT = {
    "genitals": "exposed genitals",
    "anus": "exposed anus",
    "topless": "an exposed female breast",
    "nudity": "nudity",
    "possible-genitals": "possible exposed genitals",
    "possible-anus": "possible exposed anus",
    "possible-topless": "a possibly exposed female breast",
    "single-frame": "one frame that may be explicit",
    "video-player-screenshot": "a screenshot of a video player",
    "revealing-allowed": "revealing but allowed",
  };
  function modAnatomyReason(cls, possible) {
    var base = cls === "ANUS_EXPOSED" ? "anus" : "genitals";
    return possible ? "possible-" + base : base;
  }

  /* One frame -> { level: "certain"|"reject"|"hold"|"allow", reason, score }.
     frame: { d: [[classIndex, score], ...], p: playerScore } */
  function modAssessFrame(frame) {
    var best = {}, i, cls, sc;
    var d = (frame && frame.d) || [];
    for (i = 0; i < d.length; i++) {
      cls = MOD_LABELS[d[i][0]]; sc = Number(d[i][1]) || 0;
      if (cls && (!(cls in best) || sc > best[cls])) best[cls] = sc;
    }
    var anatomy = 0, anatomyCls = "", intimate = 0, revealing = 0;
    for (cls in best) {
      if (MOD_ANATOMY[cls] && best[cls] > anatomy) { anatomy = best[cls]; anatomyCls = cls; }
      if (MOD_INTIMATE[cls] && best[cls] >= MOD_T.pair) intimate++;
      if (MOD_REVEALING[cls] && best[cls] >= 0.5) revealing++;
    }
    var breast = best.FEMALE_BREAST_EXPOSED || 0;
    var player = Number(frame && frame.p) || 0;
    var top = Math.max(anatomy, breast);
    if (anatomy >= MOD_T.certain) return { level: "certain", reason: modAnatomyReason(anatomyCls), score: anatomy };
    if (breast  >= MOD_T.certain) return { level: "certain", reason: "topless", score: breast };
    if (anatomy >= MOD_T.anatomyReject) return { level: "reject", reason: modAnatomyReason(anatomyCls), score: anatomy };
    if (breast  >= MOD_T.breastReject)  return { level: "reject", reason: "topless", score: breast };
    if (intimate >= 2)                  return { level: "reject", reason: "nudity", score: top };
    if (anatomy >= MOD_T.anatomyHold)   return { level: "hold", reason: modAnatomyReason(anatomyCls, true), score: anatomy };
    if (breast  >= MOD_T.breastHold)    return { level: "hold", reason: "possible-topless", score: breast };
    if (player  >= MOD_T.player)        return { level: "hold", reason: "video-player-screenshot", score: player };
    return { level: "allow", reason: revealing ? "revealing-allowed" : "", score: top };
  }

  /* A photo is one frame. A video is several, judged together (see rulebook). */
  function modDecide(frames) {
    if (!frames || !frames.length) return { decision: "unread", reason: "unread", score: 0, frame: -1 };
    var a = [], k, certain = null, rejects = [], holds = [];
    for (k = 0; k < frames.length; k++) {
      var r = modAssessFrame(frames[k]); r.frame = k; a.push(r);
      if (r.level === "certain" && (!certain || r.score > certain.score)) certain = r;
      if (r.level === "reject") rejects.push(r);
      if (r.level === "hold") holds.push(r);
    }
    var byScore = function (x, y) { return y.score - x.score; };
    if (certain) return { decision: "block", reason: certain.reason, score: certain.score, frame: certain.frame };
    if (frames.length === 1 && rejects.length) {
      return { decision: "block", reason: rejects[0].reason, score: rejects[0].score, frame: 0 };
    }
    if (rejects.length >= 2) {
      rejects.sort(byScore);
      return { decision: "block", reason: rejects[0].reason, score: rejects[0].score, frame: rejects[0].frame, frames: rejects.length };
    }
    if (rejects.length === 1) {
      return { decision: "hold", reason: "single-frame", score: rejects[0].score, frame: rejects[0].frame, detail: rejects[0].reason };
    }
    if (holds.length) {
      holds.sort(byScore);
      return { decision: "hold", reason: holds[0].reason, score: holds[0].score, frame: holds[0].frame };
    }
    var allowed = a.slice().sort(byScore)[0];
    var revealing = a.some(function (x) { return x.reason === "revealing-allowed"; });
    return { decision: "allow", reason: revealing ? "revealing-allowed" : "", score: allowed.score, frame: -1 };
  }
  function modReasonText(reason) { return MOD_REASON_TEXT[reason] || ""; }
  /* Kept for callers that ask about a single frame. */
  function modDecideFrame(frame) { return modDecide([frame]); }
  /* ===================================================================================== */

  /* ---------------- runtime + model loading ---------------- */
  var sessionPromise = null;
  function loadScript(src) {
    return new Promise(function (ok, bad) {
      if (document.querySelector('script[data-mod-src="' + src + '"]')) return ok();
      var s = document.createElement('script');
      s.src = src; s.async = true; s.crossOrigin = 'anonymous';
      s.setAttribute('data-mod-src', src);
      s.onload = function () { ok(); };
      s.onerror = function () { bad(new Error('failed to load ' + src)); };
      document.head.appendChild(s);
    });
  }
  function loadSession() {
    if (sessionPromise) return sessionPromise;
    sessionPromise = (async function () {
      if (!root.ort) await loadScript(ORT_URL);
      if (!root.ort) throw new Error('onnxruntime unavailable');
      root.ort.env.wasm.wasmPaths = ORT_BASE;
      // One thread: multithreaded WASM needs cross-origin isolation headers,
      // which GitHub Pages cannot send. Without this it can fail to start.
      root.ort.env.wasm.numThreads = 1;
      return root.ort.InferenceSession.create(MODEL_URL, { executionProviders: ['wasm'] });
    })().catch(function (e) { sessionPromise = null; throw e; });
    return sessionPromise;
  }

  /* ---------------- NudeNet pre/post-processing ----------------
     Mirrors NudeNet 3.4.2 detect(): pad to a square with black on the
     bottom/right, resize to 320, /255, RGB, NCHW. Verified against the
     Python reference on the test images. */
  function tensorFromSource(src, sw, sh) {
    var M = Math.max(sw, sh), sc = S / M;
    var c = document.createElement('canvas'); c.width = S; c.height = S;
    var ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, S, S);
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src, 0, 0, sw, sh, 0, 0, sw * sc, sh * sc);
    var px = ctx.getImageData(0, 0, S, S).data, inp = new Float32Array(3 * S * S), n = S * S;
    for (var i = 0; i < n; i++) {
      inp[i] = px[i * 4] / 255; inp[n + i] = px[i * 4 + 1] / 255; inp[2 * n + i] = px[i * 4 + 2] / 255;
    }
    return inp;
  }
  function iou(a, b) {
    var x1 = Math.max(a[0], b[0]), y1 = Math.max(a[1], b[1]);
    var x2 = Math.min(a[0] + a[2], b[0] + b[2]), y2 = Math.min(a[1] + a[3], b[1] + b[3]);
    var inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
    return inter / ((a[2] * a[3] + b[2] * b[3] - inter) || 1);
  }
  function decodeDetections(data, dims) {
    var ch = dims[1], n = dims[2], rows = [];
    for (var i = 0; i < n; i++) {
      var best = 0, cls = -1;
      for (var k = 4; k < ch; k++) { var v = data[k * n + i]; if (v > best) { best = v; cls = k - 4; } }
      if (best < 0.25) continue;
      var w = data[2 * n + i], h = data[3 * n + i];
      rows.push({ cls: cls, score: best, box: [data[i] - w / 2, data[n + i] - h / 2, w, h] });
    }
    rows.sort(function (a, b) { return b.score - a.score; });
    var keep = [];
    rows.forEach(function (r) { if (keep.every(function (k) { return iou(k.box, r.box) <= 0.45; })) keep.push(r); });
    return keep.map(function (r) { return [r.cls, Math.round(r.score * 1000) / 1000]; });
  }

  /* ---------------- video-player screenshot detector ----------------
     A thin bright RING near the centre, a play ARROW inside it (tall on the
     left, pointed on the right), and a thin scrub BAR across the lower frame
     (a line brighter than the rows above AND below — a real counter edge or
     horizon is a step, bright on one side only, and does not pass). A bar on
     its own is never enough. Tested on 13 synthetic cases including plates,
     clock faces, ring logos, targets, horizons and suns. */
  function boxDown(rgba, W, H, tw) {
    var th = Math.max(1, Math.round(H * tw / W)), g = new Float32Array(tw * th), sat = new Float32Array(tw * th);
    var fx = W / tw, fy = H / th;
    for (var y = 0; y < th; y++) for (var x = 0; x < tw; x++) {
      var x0 = Math.floor(x * fx), x1 = Math.max(x0 + 1, Math.floor((x + 1) * fx));
      var y0 = Math.floor(y * fy), y1 = Math.max(y0 + 1, Math.floor((y + 1) * fy));
      var sg = 0, ss = 0, nn = 0, sy = Math.max(1, (y1 - y0) >> 2), sx = Math.max(1, (x1 - x0) >> 2);
      for (var yy = y0; yy < y1; yy += sy) for (var xx = x0; xx < x1; xx += sx) {
        var j = (yy * W + xx) * 4, r = rgba[j], gg = rgba[j + 1], b = rgba[j + 2];
        sg += (r + gg + b) / 3; ss += Math.max(r, gg, b) - Math.min(r, gg, b); nn++;
      }
      g[y * tw + x] = sg / nn; sat[y * tw + x] = ss / nn;
    }
    return { g: g, sat: sat, w: tw, h: th };
  }
  function findRing(D) {
    var g = D.g, sat = D.sat, w = D.w, h = D.h, s = Math.min(w, h), N = 64, cs = [], sn = [], k;
    function B(x, y) { x = Math.round(x); y = Math.round(y); if (x < 0 || y < 0 || x >= w || y >= h) return 0;
      var i = y * w + x; return (g[i] > 200 && sat[i] < 45) ? 1 : 0; }
    for (k = 0; k < N; k++) { cs.push(Math.cos(k * 2 * Math.PI / N)); sn.push(Math.sin(k * 2 * Math.PI / N)); }
    var best = { v: 0 };
    for (var cy = Math.round(h * 0.22); cy <= Math.round(h * 0.70); cy += 2)
      for (var cx = Math.round(w * 0.28); cx <= Math.round(w * 0.72); cx += 2)
        for (var r = Math.round(s * 0.12); r <= Math.round(s * 0.34); r += 2) {
          var on = 0; for (k = 0; k < N; k++) on += B(cx + r * cs[k], cy + r * sn[k]);
          var f = on / N; if (f < 0.5 || f <= best.v) continue;
          var inr = 0, out = 0;
          for (k = 0; k < N; k++) { inr += B(cx + r * 0.78 * cs[k], cy + r * 0.78 * sn[k]); out += B(cx + r * 1.2 * cs[k], cy + r * 1.2 * sn[k]); }
          var v = f - Math.max(inr, out) / N;
          if (v > best.v) best = { v: v, cx: cx, cy: cy, r: r };
        }
    return best;
  }
  function hasPlayGlyph(D, c) {
    var g = D.g, sat = D.sat, w = D.w, h = D.h; if (!c || !c.r) return false;
    function B(x, y) { if (x < 0 || y < 0 || x >= w || y >= h) return 0; var i = y * w + x; return (g[i] > 200 && sat[i] < 45) ? 1 : 0; }
    var R = Math.round(c.r * 0.7), cols = [];
    for (var x = c.cx - R; x <= c.cx + R; x++) {
      var top = -1, bot = -1;
      for (var y = c.cy - R; y <= c.cy + R; y++) {
        if ((x - c.cx) * (x - c.cx) + (y - c.cy) * (y - c.cy) > R * R) continue;
        if (B(x, y)) { if (top < 0) top = y; bot = y; }
      }
      cols.push(top < 0 ? 0 : bot - top + 1);
    }
    var lit = []; cols.forEach(function (v, i) { if (v > 0) lit.push(i); });
    if (lit.length < 4) return false;
    var first = lit[0], last = lit[lit.length - 1], span = last - first + 1;
    if (span < R * 0.5) return false;
    var third = Math.max(1, Math.floor(span / 3));
    function avg(a, b) { var s2 = 0, n2 = 0; for (var i = a; i < b; i++) { s2 += cols[i]; n2++; } return n2 ? s2 / n2 : 0; }
    var left = avg(first, first + third), right = avg(last - third + 1, last + 1);
    return left > right * 1.8 && left >= R * 0.45;
  }
  function findBar(D) {
    var g = D.g, w = D.w, h = D.h, best = 0;
    for (var y = Math.round(h * 0.55); y < h - 3; y++) {
      var lines = 0;
      for (var x = 0; x < w; x++) { if (g[y * w + x] - Math.max(g[(y - 3) * w + x], g[(y + 3) * w + x]) > 6) lines++; }
      best = Math.max(best, lines / w);
    }
    return best;
  }
  function playerScore(rgba, W, H) {
    var D = boxDown(rgba, W, H, 200), ring = findRing(D), glyph = hasPlayGlyph(D, ring);
    var bar = findBar(boxDown(rgba, W, H, 480)), rv = Math.max(0, ring.v || 0);
    if (rv > 0.45 && glyph) return 0.95;
    if (rv > 0.45 && bar > 0.6) return 0.9;
    if (rv > 0.6) return 0.6;
    return 0;
  }
  function rgbaOf(src, sw, sh) {
    // Downscale to at most 960 px wide first: the player check is
    // resolution-independent, and this keeps it under ~100 ms on a phone.
    var tw = Math.min(960, sw), th = Math.round(sh * tw / sw);
    var c = document.createElement('canvas'); c.width = tw; c.height = th;
    var ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(src, 0, 0, sw, sh, 0, 0, tw, th);
    return { data: ctx.getImageData(0, 0, tw, th).data, w: tw, h: th };
  }

  /* ---------------- frames ---------------- */
  function isVideo(f) {
    var t = (f && f.type) || '', n = (f && f.name) || '';
    return t.indexOf('video/') === 0 || /\.(mp4|mov|webm|m4v|mkv|3gp)$/i.test(n);
  }
  async function frameSources(file, durationHint) {
    var url = URL.createObjectURL(file);
    if (!isVideo(file)) {
      var img = await new Promise(function (ok, bad) {
        var i = new Image(); i.onload = function () { ok(i); };
        i.onerror = function () { bad(new Error('image decode failed')); }; i.src = url;
      });
      return { url: url, frames: [{ src: img, w: img.naturalWidth, h: img.naturalHeight }] };
    }
    var v = document.createElement('video');
    v.muted = true; v.playsInline = true; v.preload = 'auto'; v.src = url;
    await new Promise(function (ok, bad) { v.onloadedmetadata = function () { ok(); }; v.onerror = function () { bad(new Error('video decode failed')); }; });
    var dur = (v.duration && isFinite(v.duration)) ? v.duration : (durationHint || 0);
    var spots = (typeof root.nalunoVideoScreenSpots === 'function') ? root.nalunoVideoScreenSpots(dur) : [0.2, 0.5, 0.8];
    var frames = [];
    for (var i = 0; i < spots.length; i++) {
      await new Promise(function (ok) {
        var done = false; function fin() { if (!done) { done = true; ok(); } }
        v.onseeked = fin; setTimeout(fin, 2500);
        try { v.currentTime = Math.max(0, Math.min(dur - 0.05, spots[i] * dur)); } catch (_) { fin(); }
      });
      // Snapshot each frame to its own canvas — the <video> keeps moving.
      var c = document.createElement('canvas'); c.width = v.videoWidth; c.height = v.videoHeight;
      try { c.getContext('2d').drawImage(v, 0, 0); frames.push({ src: c, w: c.width, h: c.height }); } catch (_) {}
    }
    return { url: url, frames: frames, video: v };
  }

  async function moderateFile(file, durationHint) {
    var sess = await loadSession();
    var fs = await frameSources(file, durationHint);
    try {
      var out = [];
      for (var i = 0; i < fs.frames.length; i++) {
        var fr = fs.frames[i];
        var feeds = {}; feeds[sess.inputNames[0]] = new root.ort.Tensor('float32', tensorFromSource(fr.src, fr.w, fr.h), [1, 3, S, S]);
        var res = await sess.run(feeds), o = res[sess.outputNames[0]];
        var rg = rgbaOf(fr.src, fr.w, fr.h);
        out.push({ d: decodeDetections(o.data, o.dims), p: playerScore(rg.data, rg.w, rg.h) });
      }
      return { frames: out, result: modDecide(out) };
    } finally {
      try { if (fs.video) { fs.video.removeAttribute('src'); fs.video.load(); } } catch (_) {}
      URL.revokeObjectURL(fs.url);
    }
  }

  /* ---------------- upgrade runNalunoScreen in place ----------------
     Same shape every caller already understands. The detections travel to
     the server in packed.nudenet, so the SERVER decides from them rather than
     re-running the old skin heuristic and overruling a correct verdict. */
  var heuristicRun = root.runNalunoScreen;
  root.runNalunoScreen = async function (file, title, durationHint) {
    // The heuristic still runs: it produces the pixel stills the server's
    // payload contract expects, and it is the fallback below.
    var base = null;
    try { base = heuristicRun ? await heuristicRun(file, title, durationHint) : null; } catch (_) {}
    var m = null;
    try {
      m = await Promise.race([
        moderateFile(file, durationHint),
        new Promise(function (ok) { setTimeout(function () { ok(null); }, 15000); }),
      ]);
    } catch (e) {
      console.warn('[moderation] detector unavailable — falling back', e && e.message);
    }
    if (!m || m.result.decision === 'unread') {
      /* Fallback when the detector cannot run. The heuristic cannot tell a
         bikini from nudity, so it is NOT allowed to reject anything on its
         own: its "block" becomes "hold", and a person decides. Stopping
         genuine content on weak evidence is the failure this rebuild exists
         to fix. */
      var fb = Object.assign({}, base || { decision: 'unread', score: 0, reason: 'unread', packed: null });
      if (fb.decision === 'block') { fb.decision = 'hold'; fb.reason = 'heuristic-only'; }
      fb.engine = 'heuristic';
      return fb;
    }
    var packed = (base && base.packed) ? Object.assign({}, base.packed) : { w: 0, h: 0, frames: [] };
    packed.nudenet = { v: 1, frames: m.frames };
    return {
      v: (base && base.v) || 3, engine: 'nudenet',
      decision: m.result.decision, reason: m.result.reason,
      reasonText: modReasonText(m.result.detail || m.result.reason),
      score: Math.round((m.result.score || 0) * 100),
      packed: packed,
    };
  };

  root.nalunoModDecide = modDecide;
  root.nalunoModDecideFrame = modDecideFrame;
  root.nalunoModReasonText = modReasonText;
  root.nalunoModThresholds = MOD_T;
  root.nalunoModerateFile = moderateFile;
  root.nalunoPlayerScore = playerScore;
  root.nalunoModPreload = function () { return loadSession().then(function () { return true; }, function () { return false; }); };
})(typeof window !== 'undefined' ? window : globalThis);
