/* Naluno's African voice (05 Oct i).

   Luganda is read by an African voice: a Kiswahili speaker (a Bantu voice,
   East/Central Africa; the Piper voice sw_CD-lanfrica, see
   voices/af/ABOUT.md). It runs on the phone, in the voice worker, with the
   same ONNX Runtime as the other voices; nothing is paid for and no server
   is asked. The voice files are in the site (voices/af/), so it also works
   offline once the phone has them.

   It is given Luganda SOUNDS (NalunoLgVoice.forAfrican), never spelling.
   The female voice is made from the same speaker: the pitch is raised
   (×1.65) and the voice tract made a little shorter (×1.12), keeping the
   length of every sound (no open female East African voice exists yet). */
(function (root) {
  'use strict';
  var state = { session: null, cfg: null, loading: null };

  function idsFor(phones, map) {
    var out = [map['^'], map['_']];
    var s = String(phones || '');
    for (var i = 0; i < s.length; i++) {
      var id = map[s[i]];
      if (typeof id === 'number') { out.push(id); out.push(map['_']); }
    }
    out.push(map['$']);
    return out;
  }

  function load(base, ort, bytes) {
    if (state.session) return Promise.resolve(true);
    if (state.loading) return state.loading;
    var cfgUrl = base + 'sw.json';
    state.loading = (typeof fetch === 'function'
      ? fetch(cfgUrl, { cache: 'no-cache' }).then(function (r) {
          if (r.status === 404) throw new Error('af-missing');
          if (!r.ok) throw new Error('af ' + r.status);
          return r.arrayBuffer();
        }).catch(function (e) { if (/af-missing/.test(String(e && e.message))) throw e; return bytes(cfgUrl); })
      : bytes(cfgUrl)
    ).then(function (raw) {
      state.cfg = JSON.parse(new TextDecoder().decode(raw));
      return bytes(base + 'sw.onnx?v=' + encodeURIComponent(String(state.cfg.version || '1')));
    }).then(function (b) {
      return ort.InferenceSession.create(b, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
    }).then(function (s) {
      state.session = { ort: ort, s: s };
      try {
        var keep = 'sw.onnx?v=' + encodeURIComponent(String(state.cfg.version || '1'));
        if (typeof caches !== 'undefined') caches.open('naluno-voices').then(function (c) {
          return c.keys().then(function (ks) {
            ks.forEach(function (k) { if (/\/voices\/af\/sw\.onnx\?v=/.test(k.url) && k.url.indexOf(keep) < 0) c.delete(k); });
          });
        }).catch(function () {});
      } catch (_) {}
      return true;
    }, function (e) { state.loading = null; throw e; });
    return state.loading;
  }

  /* ---------- female voice from the same speaker ---------- */
  function resample(x, factor) {
    var n = Math.max(1, Math.floor(x.length / factor));
    var y = new Float32Array(n);
    for (var i = 0; i < n; i++) {
      var p = i * factor, a = Math.floor(p), f = p - a;
      var v0 = x[a] || 0, v1 = x[a + 1] || 0;
      y[i] = v0 + (v1 - v0) * f;
    }
    return y;
  }
  /* Pitch per 5 ms (0 = no voice), by autocorrelation. */
  function track(x, sr) {
    var H = Math.round(sr * 0.005), W = Math.round(sr * 0.03);
    var lo = Math.floor(sr / 400), hi = Math.floor(sr / 70);
    var peak = 0, i, k;
    for (i = 0; i < x.length; i++) { var a = x[i] < 0 ? -x[i] : x[i]; if (a > peak) peak = a; }
    var f = [];
    for (var s = 0; s + W + hi < x.length; s += H) {
      var mean = 0;
      for (i = 0; i < W; i++) mean += x[s + i];
      mean /= W;
      var e0 = 0;
      for (i = 0; i < W; i++) { var d = x[s + i] - mean; e0 += d * d; }
      if (Math.sqrt(e0 / W) < 0.03 * peak) { f.push(0); continue; }
      var best = -1e9, bk = lo;
      for (k = lo; k <= hi; k++) {
        var acc = 0;
        for (i = 0; i < W; i++) acc += (x[s + i] - mean) * (x[s + i + k] - mean);
        if (acc > best) { best = acc; bk = k; }
      }
      f.push(best > 0.45 * e0 ? sr / bk : 0);
    }
    var g = f.slice();
    for (i = 2; i < f.length - 2; i++) {
      if (!f[i]) continue;
      var w = f.slice(i - 2, i + 3).filter(function (v) { return v > 0; }).sort(function (p, q) { return p - q; });
      if (w.length >= 3) g[i] = w[w.length >> 1];
    }
    return { f: g, H: H };
  }
  /* TD-PSOLA: grains two periods long, laid down closer together. */
  function psola(x, sr, beta) {
    var tr = track(x, sr), f = tr.f, H = tr.H, n = x.length;
    var marks = [], t = 0;
    while (t < n) {
      var fi = f[Math.min(f.length - 1, Math.floor(t / H))] || 0;
      var p = fi > 0 ? Math.round(sr / fi) : Math.round(sr * 0.01);
      if (fi > 0) {
        var a = Math.max(0, t - (p >> 2)), b = Math.min(n, t + (p >> 2) + 1), bi = a, bv = -1e9;
        for (var q = a; q < b; q++) if (x[q] > bv) { bv = x[q]; bi = q; }
        t = Math.max(t, bi);
      }
      marks.push([t, p, fi > 0]);
      t += Math.max(1, p);
    }
    var out = new Float32Array(n + 2000);
    var j = 0, o = 0;
    while (o < n && marks.length) {
      while (j + 1 < marks.length && Math.abs(marks[j + 1][0] - o) <= Math.abs(marks[j][0] - o)) j++;
      var m = marks[j], c = m[0], P = m[1];
      var g0 = Math.max(0, c - P), g1 = Math.min(n, c + P), len = g1 - g0, start = Math.round(o) - (c - g0);
      for (var i = 0; i < len; i++) {
        var oi = start + i;
        if (oi < 0 || oi >= out.length) continue;
        var wv = len > 4 ? 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (len - 1)) : 1;
        out[oi] += x[g0 + i] * wv;
      }
      o += m[2] ? P / beta : P;
    }
    return out.subarray(0, n);
  }
  /* WSOLA: stretch the length by rate, keeping the pitch. */
  function wsola(x, rate, sr) {
    var W = Math.round(sr * 0.03), H = W >> 1, tol = Math.round(sr * 0.01);
    var nOut = Math.floor(x.length * rate);
    var out = new Float32Array(nOut + W), norm = new Float32Array(nOut + W);
    var win = new Float32Array(W);
    for (var i = 0; i < W; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (W - 1));
    var prev = -1;
    for (var o = 0; o + W < nOut; o += H) {
      var c = Math.floor(o / rate);
      if (prev >= 0) {
        var lo = Math.max(0, c - tol), hi = Math.min(x.length - W, c + tol), best = c, bv = -1e9;
        for (var k = lo; k < hi; k += 2) {
          var v = 0;
          for (var q = 0; q < H; q++) v += x[k + q] * x[prev + q];
          if (v > bv) { bv = v; best = k; }
        }
        c = best;
      }
      if (c + W > x.length) break;
      for (i = 0; i < W; i++) { out[o + i] += x[c + i] * win[i]; norm[o + i] += win[i]; }
      prev = c + H + W <= x.length ? c + H : c;
    }
    var y = new Float32Array(nOut);
    for (i = 0; i < nOut; i++) y[i] = norm[i] > 1e-3 ? out[i] / norm[i] : 0;
    return y;
  }
  function female(x, sr, opt) {
    var formant = (opt && opt.formant) || 1.12, pitch = (opt && opt.pitch) || 1.65;
    var y = resample(x, formant);
    var z = psola(y, sr, pitch / formant);
    return wsola(z, formant, sr);
  }

  /* One piece of Luganda sounds -> samples. */
  async function synth(phones, opts) {
    opts = opts || {};
    var S = state.session, cfg = state.cfg, ort = S.ort;
    var ids = idsFor(phones, cfg.phoneme_id_map);
    if (ids.length <= 4) return { rate: cfg.sample_rate, samples: new Float32Array(0) };
    var big = new BigInt64Array(ids.length);
    for (var i = 0; i < ids.length; i++) big[i] = BigInt(ids[i]);
    var sc = cfg.scales || {};
    /* 07 Oct: the Luganda pace (0.65 / 0.73) times a slower speed setting
       may go below 0.6; that used to snap back to full speed. */
    var speed = typeof opts.speed === 'number' && opts.speed > 0.35 && opts.speed < 1.6 ? opts.speed : 1;
    var r = await S.s.run({
      input: new ort.Tensor('int64', big, [1, ids.length]),
      input_lengths: new ort.Tensor('int64', BigInt64Array.from([BigInt(ids.length)]), [1]),
      scales: new ort.Tensor('float32', Float32Array.from([sc.noise || 0.6, (sc.length || 1.05) / speed, sc.noise_w || 0.7]), [3]),
    });
    var out = r[S.s.outputNames[0]].data;
    var samples = new Float32Array(out.length);
    samples.set(out);
    if (opts.female) samples = female(samples, cfg.sample_rate, cfg.female);
    return { rate: cfg.sample_rate, samples: samples };
  }

  root.NalunoAfEngine = {
    load: load,
    synth: synth,
    idsFor: idsFor,
    female: female,
    _track: track,
    ready: function () { return !!state.session; },
  };
  if (typeof module === 'object' && module.exports) module.exports = root.NalunoAfEngine;
})(typeof self !== 'undefined' ? self : globalThis);
