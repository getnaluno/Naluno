/* Mastering for Naluno's on-phone voice.
   Takes the clicks off chunk edges, holds the level, and can drop
   the female voice into a lower male register without changing
   how long the line takes. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.NalunoVoiceMaster = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  function fadeEnds(samples, rate) {
    const n = Math.max(8, Math.round((rate || 24000) * 0.012));
    const len = samples.length;
    const edge = Math.min(n, Math.floor(len / 2));
    for (let i = 0; i < edge; i++) {
      const w = i / edge;
      samples[i] *= w;
      samples[len - 1 - i] *= w;
    }
  }

  function dropDc(samples) {
    if (!samples.length) return 0;
    let sum = 0;
    for (let i = 0; i < samples.length; i++) sum += samples[i];
    const mean = sum / samples.length;
    let peak = 0;
    for (let i = 0; i < samples.length; i++) {
      const v = samples[i] - mean;
      samples[i] = v;
      const a = v < 0 ? -v : v;
      if (a > peak) peak = a;
    }
    return peak;
  }

  function holdLevel(samples, peak) {
    const target = 0.82;
    if (!(peak > 0.0001)) return;
    const gain = peak > target ? target / peak : Math.min(1.4, target / Math.max(peak, 0.2));
    for (let i = 0; i < samples.length; i++) {
      let v = samples[i] * gain;
      if (v > 0.92) v = 0.92;
      if (v < -0.92) v = -0.92;
      samples[i] = v;
    }
  }

  /* Overlap grains so the pitch falls and the length stays. */
  function lower(samples, semitones) {
    const pitch = Math.pow(2, semitones / 12);
    const grain = 2048;
    const hop = 512;
    if (samples.length < grain) return samples;
    const out = new Float32Array(samples.length);
    const weight = new Float32Array(samples.length);
    let inPos = 0;
    let outPos = 0;
    while (inPos + grain < samples.length && outPos < samples.length) {
      const stretched = Math.round(grain / pitch);
      for (let i = 0; i < stretched; i++) {
        const o = outPos + i;
        if (o >= out.length) break;
        const srcF = i * pitch;
        const s0 = Math.floor(srcF);
        if (s0 + 1 >= grain) break;
        const frac = srcF - s0;
        const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / stretched);
        const v = samples[inPos + s0] * (1 - frac) + samples[inPos + s0 + 1] * frac;
        out[o] += v * w;
        weight[o] += w;
      }
      inPos += hop;
      outPos += hop;
    }
    for (let n = 0; n < out.length; n++) {
      if (weight[n] > 0.001) out[n] /= weight[n];
    }
    return out;
  }

  function warm(samples) {
    let acc = 0;
    const a = 0.06;
    for (let i = 0; i < samples.length; i++) {
      acc += a * (samples[i] - acc);
      let v = samples[i] * 0.78 + acc * 0.42;
      if (v > 0.92) v = 0.92;
      if (v < -0.92) v = -0.92;
      samples[i] = v;
    }
  }

  /* 05i: less breath. The voice's breathiness is noise above the voice's
     own harmonics (about 5 kHz and up). A gentle high shelf (−6 dB from
     5 kHz) takes most of the hiss off; the consonants (s, f, t) stay clear. */
  function deBreath(samples, rate, db, freq) {
    const fs = rate || 24000;
    const A = Math.pow(10, (db || -6) / 40);
    const w0 = 2 * Math.PI * (freq || 5000) / fs;
    const cos = Math.cos(w0), sin = Math.sin(w0);
    const alpha = sin / 2 * Math.SQRT2 * 0.5;
    const sq = 2 * Math.sqrt(A) * alpha;
    const b0 = A * ((A + 1) + (A - 1) * cos + sq);
    const b1 = -2 * A * ((A - 1) + (A + 1) * cos);
    const b2 = A * ((A + 1) + (A - 1) * cos - sq);
    const a0 = (A + 1) - (A - 1) * cos + sq;
    const a1 = 2 * ((A - 1) - (A + 1) * cos);
    const a2 = (A + 1) - (A - 1) * cos - sq;
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < samples.length; i++) {
      const x = samples[i];
      const y = (b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
      x2 = x1; x1 = x; y2 = y1; y1 = y;
      samples[i] = y;
    }
  }

  function master(input, rate, male) {
    const samples = new Float32Array(input || []);
    if (!samples.length) return samples;
    deBreath(samples, rate);
    const peak = dropDc(samples);
    holdLevel(samples, peak);
    /* Warmth only. A pitch warp of the female voice was the broken male. */
    if (male) warm(samples);
    fadeEnds(samples, rate || 24000);
    return samples;
  }

  /* ---------- 07 Oct: the finishing stage, for every voice ----------
     The English voices, Naluno's African voice (Luganda) and the optional
     Sunbird voice all end here, so they come out equally loud and clear.
     The voices themselves are not changed: no pitch, no speed, no new
     sound. Only what a mastering engineer does to a spoken recording:
       1. rumble below the voice is taken off (high-pass, 70 Hz);
       2. a gentle lift (+2.5 dB) where speech is understood (about
          3 kHz), so words are clearer on a phone speaker;
       3. every piece is set to the same speech loudness (-16 dBFS while
          speaking, the usual level for spoken audio on phones), at most
          +12 dB, so quiet pieces are not dragged up out of the noise;
       4. a fast limiter keeps the loudest moments under the ceiling
          (-0.5 dBFS), so nothing clips or crackles. */
  function biquad(samples, c) {
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < samples.length; i++) {
      const x = samples[i];
      const y = c.b0 * x + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
      x2 = x1; x1 = x; y2 = y1; y1 = y;
      samples[i] = y;
    }
  }
  function highPass(fs, f, q) {
    const w = 2 * Math.PI * f / fs, cs = Math.cos(w), al = Math.sin(w) / (2 * q), a0 = 1 + al;
    return { b0: (1 + cs) / 2 / a0, b1: -(1 + cs) / a0, b2: (1 + cs) / 2 / a0, a1: -2 * cs / a0, a2: (1 - al) / a0 };
  }
  function peak(fs, f, q, db) {
    const A = Math.pow(10, db / 40), w = 2 * Math.PI * f / fs, cs = Math.cos(w), al = Math.sin(w) / (2 * q), a0 = 1 + al / A;
    return { b0: (1 + al * A) / a0, b1: -2 * cs / a0, b2: (1 - al * A) / a0, a1: -2 * cs / a0, a2: (1 - al / A) / a0 };
  }
  /* Loudness while speaking: the 10 ms frames within 30 dB of the loudest
     one (the pauses between words do not pull it down). */
  function speechLevel(samples, rate) {
    const win = Math.max(1, Math.round((rate || 24000) * 0.01));
    const frames = [];
    let top = 0;
    for (let i = 0; i + win <= samples.length; i += win) {
      let e = 0;
      for (let j = i; j < i + win; j++) e += samples[j] * samples[j];
      e /= win;
      frames.push(e);
      if (e > top) top = e;
    }
    if (!(top > 1e-10)) return 0;
    const floor = top * 0.001;
    let sum = 0, n = 0;
    for (let k = 0; k < frames.length; k++) if (frames[k] >= floor) { sum += frames[k]; n++; }
    return n ? Math.sqrt(sum / n) : 0;
  }
  function limit(samples, rate, ceiling) {
    const look = Math.max(1, Math.round((rate || 24000) * 0.003));
    const rel = 1 - Math.exp(-1 / ((rate || 24000) * 0.08));
    const n = samples.length;
    const need = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const a = samples[i] < 0 ? -samples[i] : samples[i];
      need[i] = a > ceiling ? ceiling / a : 1;
    }
    /* Look ahead: start turning down 3 ms before a peak arrives. */
    const ahead = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      let m = 1;
      const end = Math.min(n, i + look + 1);
      for (let j = i; j < end; j++) if (need[j] < m) m = need[j];
      ahead[i] = m;
    }
    let g = 1;
    for (let i = 0; i < n; i++) {
      g = ahead[i] < g ? ahead[i] : g + (1 - g) * rel;
      let v = samples[i] * g;
      if (v > ceiling) v = ceiling;
      if (v < -ceiling) v = -ceiling;
      samples[i] = v;
    }
  }
  const FINISH = { level: Math.pow(10, -16 / 20), maxGain: Math.pow(10, 12 / 20), ceiling: Math.pow(10, -0.5 / 20), presenceDb: 2.5, presenceHz: 3000, lowCutHz: 70 };
  function finish(input, rate) {
    const samples = new Float32Array(input || []);
    if (samples.length < 32) return samples;
    const fs = rate || 24000;
    biquad(samples, highPass(fs, FINISH.lowCutHz, 0.707));
    if (fs > FINISH.presenceHz * 2.4) biquad(samples, peak(fs, FINISH.presenceHz, 0.9, FINISH.presenceDb));
    const lvl = speechLevel(samples, fs);
    if (lvl > 1e-5) {
      const gain = Math.min(FINISH.maxGain, FINISH.level / lvl);
      for (let i = 0; i < samples.length; i++) samples[i] *= gain;
    }
    limit(samples, fs, FINISH.ceiling);
    return samples;
  }

  return { master: master, lower: lower, deBreath: deBreath, finish: finish, speechLevel: speechLevel, FINISH: FINISH };
});
