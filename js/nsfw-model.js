/* ============================================================
   MODULE: js/nsfw-model.js
   Model-based explicit-content screening. Loads AFTER screen.js and upgrades
   runNalunoScreen() in place, so every existing caller (the Broadcast
   composer, OriginID) gets the better judgement with no rewiring.

   WHY THIS EXISTS
   The previous screen measured skin AREA and background SCENERY. Tested
   against synthetic scenes it scored a bikini indoors at 0.86 — identical to
   nudity on a bed — and treated "sky is visible" as proof of swimwear, so
   nudity outdoors was excused. Skin area does not encode whether a body is
   covered, so no amount of threshold-tuning could meet "bikinis yes,
   explicit no". That needs a model that recognises what it is looking at.

   THE MODEL
   NSFWJS (MIT, Infinite Red), MobileNetV2, ~90% accuracy. Five classes, which
   map onto Naluno's policy directly:

     Sexy     revealing, not pornography — bikinis, swimwear   -> ACCEPT
     Porn     pornographic images, sexual acts                 -> explicit
     Hentai   pornographic drawings                            -> explicit
     Neutral  everyday safe images                             -> accept
     Drawing  safe drawings and anime                          -> accept

   STILL ON-DEVICE
   Inference runs in the browser. No image leaves the phone for a third-party
   scanner, which keeps the principle stated at the top of screen.js.

   HONEST LIMIT
   Because it runs on the device, a deliberately modified client could skip it
   or lie about its result. The server re-checks what it can (see
   screen.mjs), untrusted publishers are still held, and reports plus the
   console review queue catch what gets through. A tamper-proof check needs
   a server-side model; that is a separate decision, not something to paper
   over here.
   ============================================================ */
(function (root) {
  const TFJS_URL   = 'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0/dist/tf.min.js';
  const NSFWJS_URL = 'https://cdn.jsdelivr.net/npm/nsfwjs@4.4.0/dist/browser/nsfwjs.min.js';
  // Self-hosted. The maintainer warns their hosted copy may move, and a
  // moderation system that silently stops working when someone else's bucket
  // disappears is worse than none.
  const MODEL_URL  = '/models/nsfw/model.json';
  const MODEL_SIZE = 224;

  /* ---------------- The policy — pure, and the thing that matters ----------------
     "explicit" is Porn + Hentai. Sexy is deliberately NOT counted — that is
     the class bikinis and swimwear land in, and the requirement is that they
     are accepted.

     Two thresholds rather than one, because the model is ~90% accurate, not
     perfect: the confident cases decide themselves, and the uncertain middle
     goes to a person instead of being guessed. */
  const REJECT_AT = 0.70;
  const REVIEW_AT = 0.30;

  function scoresFromPredictions(preds) {
    const out = { Drawing: 0, Hentai: 0, Neutral: 0, Porn: 0, Sexy: 0 };
    (preds || []).forEach(function (p) {
      if (p && typeof p.className === 'string' && typeof p.probability === 'number') {
        out[p.className] = p.probability;
      }
    });
    return out;
  }

  function explicitOf(s) {
    return (Number(s.Porn) || 0) + (Number(s.Hentai) || 0);
  }

  /** frames: array of score objects. A video is judged by its WORST frame —
   *  one explicit frame is enough, averaging it away would be the wrong way
   *  round for a safety check. */
  function nsfwDecide(frames) {
    if (!frames || !frames.length) {
      return { decision: 'unread', explicit: 0, sexy: 0, reason: 'unread' };
    }
    let worst = 0, worstIdx = 0, sexyAtWorst = 0, maxSexy = 0;
    frames.forEach(function (s, i) {
      const e = explicitOf(s);
      if (e > worst) { worst = e; worstIdx = i; sexyAtWorst = Number(s.Sexy) || 0; }
      maxSexy = Math.max(maxSexy, Number(s.Sexy) || 0);
    });
    let decision, reason;
    if (worst >= REJECT_AT) {
      decision = 'block';  reason = 'explicit';
    } else if (worst >= REVIEW_AT) {
      decision = 'hold';   reason = 'review';
    } else {
      decision = 'allow';  reason = maxSexy >= 0.5 ? 'revealing-allowed' : '';
    }
    return {
      decision: decision,
      explicit: Math.round(worst * 1000) / 1000,
      sexy: Math.round(maxSexy * 1000) / 1000,
      worstFrame: worstIdx,
      reason: reason,
    };
  }

  /* ---------------- Loading ---------------- */
  let modelPromise = null;

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      if (document.querySelector('script[data-nsfw-src="' + src + '"]')) return resolve();
      const s = document.createElement('script');
      s.src = src; s.async = true; s.crossOrigin = 'anonymous';
      s.setAttribute('data-nsfw-src', src);
      s.onload = function () { resolve(); };
      s.onerror = function () { reject(new Error('failed to load ' + src)); };
      document.head.appendChild(s);
    });
  }

  function loadModel() {
    if (modelPromise) return modelPromise;
    modelPromise = (async function () {
      if (!root.tf) await loadScript(TFJS_URL);
      if (!root.nsfwjs) await loadScript(NSFWJS_URL);
      if (!root.nsfwjs || typeof root.nsfwjs.load !== 'function') throw new Error('nsfwjs unavailable');
      return root.nsfwjs.load(MODEL_URL, { size: MODEL_SIZE });
    })().catch(function (e) {
      // Let a later attempt retry rather than caching the failure forever.
      modelPromise = null;
      throw e;
    });
    return modelPromise;
  }

  /* ---------------- Frame sampling ---------------- */
  function canvas224() {
    const c = document.createElement('canvas');
    c.width = MODEL_SIZE; c.height = MODEL_SIZE;
    return c;
  }

  function drawCover(ctx, src, sw, sh) {
    // Centre-crop to a square so the subject is not squashed — the model was
    // trained on square crops, and distortion costs accuracy.
    const s = Math.min(sw, sh);
    const sx = (sw - s) / 2, sy = (sh - s) / 2;
    ctx.drawImage(src, sx, sy, s, s, 0, 0, MODEL_SIZE, MODEL_SIZE);
  }

  function isVideoFile(f) {
    const t = (f && f.type) || '', n = (f && f.name) || '';
    return t.indexOf('video/') === 0 || /\.(mp4|mov|webm|m4v|mkv|3gp)$/i.test(n);
  }

  async function framesFromImage(file) {
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise(function (ok, bad) {
        const i = new Image();
        i.onload = function () { ok(i); };
        i.onerror = function () { bad(new Error('image decode failed')); };
        i.src = url;
      });
      const c = canvas224();
      drawCover(c.getContext('2d'), img, img.naturalWidth, img.naturalHeight);
      return [c];
    } finally { URL.revokeObjectURL(url); }
  }

  async function framesFromVideo(file, durationHint) {
    const url = URL.createObjectURL(file);
    const v = document.createElement('video');
    v.muted = true; v.playsInline = true; v.preload = 'auto'; v.src = url;
    try {
      await new Promise(function (ok, bad) {
        v.onloadedmetadata = function () { ok(); };
        v.onerror = function () { bad(new Error('video decode failed')); };
      });
      const dur = v.duration && isFinite(v.duration) ? v.duration : (durationHint || 0);
      const spots = (typeof root.nalunoVideoScreenSpots === 'function')
        ? root.nalunoVideoScreenSpots(dur) : [0.2, 0.5, 0.8];
      const out = [];
      for (let i = 0; i < spots.length; i++) {
        await new Promise(function (ok) {
          let done = false;
          const finish = function () { if (!done) { done = true; ok(); } };
          v.onseeked = finish;
          setTimeout(finish, 2500);          // never hang on a stubborn seek
          try { v.currentTime = Math.max(0, Math.min(dur - 0.05, spots[i] * dur)); } catch (_) { finish(); }
        });
        const c = canvas224();
        try { drawCover(c.getContext('2d'), v, v.videoWidth, v.videoHeight); out.push(c); } catch (_) {}
      }
      return out;
    } finally {
      try { v.removeAttribute('src'); v.load(); } catch (_) {}
      URL.revokeObjectURL(url);
    }
  }

  /** Classify a file. Resolves to the policy decision plus raw scores. */
  async function nsfwClassifyFile(file, durationHint) {
    const model = await loadModel();
    const frames = isVideoFile(file) ? await framesFromVideo(file, durationHint) : await framesFromImage(file);
    if (!frames.length) return { decision: 'unread', explicit: 0, sexy: 0, reason: 'unread', frames: [] };
    const scored = [];
    for (let i = 0; i < frames.length; i++) {
      scored.push(scoresFromPredictions(await model.classify(frames[i], 5)));
    }
    return Object.assign(nsfwDecide(scored), { frames: scored });
  }

  /* ---------------- Upgrade runNalunoScreen in place ----------------
     Same return shape every caller already understands. The model scores are
     added to the packed payload so the SERVER can decide from them instead
     of re-running the skin heuristic — otherwise the server would silently
     overrule a correct model verdict with the old one. */
  const heuristicRun = root.runNalunoScreen;

  root.runNalunoScreen = async function (file, title, durationHint) {
    // The heuristic still runs: it produces the pixel stills the server
    // expects, and it is the fallback if the model cannot load.
    let base = null;
    try { base = heuristicRun ? await heuristicRun(file, title, durationHint) : null; } catch (_) {}

    let m = null;
    try {
      m = await Promise.race([
        nsfwClassifyFile(file, durationHint),
        new Promise(function (ok) { setTimeout(function () { ok(null); }, 12000); }),
      ]);
    } catch (e) {
      console.warn('[nsfw] model unavailable — using the heuristic screen', e && e.message);
    }

    if (!m || m.decision === 'unread') {
      // Model could not run. Fall back, and SAY so, rather than pretend the
      // better check happened.
      return Object.assign({}, base || { decision: 'unread', score: 0, reason: 'unread', packed: null },
        { engine: 'heuristic' });
    }

    const packed = (base && base.packed) ? Object.assign({}, base.packed) : { w: 0, h: 0, frames: [] };
    packed.model = {
      engine: 'nsfwjs-mobilenet_v2',
      frames: m.frames.map(function (s) {
        return { Drawing: s.Drawing, Hentai: s.Hentai, Neutral: s.Neutral, Porn: s.Porn, Sexy: s.Sexy };
      }),
    };
    return {
      v: (base && base.v) || 3,
      engine: 'model',
      decision: m.decision,
      score: Math.round(m.explicit * 100),
      explicit: m.explicit,
      sexy: m.sexy,
      reason: m.reason,
      packed: packed,
    };
  };

  root.nsfwDecide = nsfwDecide;
  root.nsfwClassifyFile = nsfwClassifyFile;
  root.nsfwPreload = function () { return loadModel().then(function () { return true; }, function () { return false; }); };
})(typeof window !== 'undefined' ? window : globalThis);
