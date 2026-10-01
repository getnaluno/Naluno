/* Luganda from recordings you feed it.
   A saved line is spoken as that recording. If the whole line is
   missing, words you have recorded are joined. The English phone
   voice is not used for a line these clips already cover. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.NalunoLgEar = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  const lines = Object.create(null);
  const words = Object.create(null);

  function norm(text) {
    return String(text || '')
      .toLowerCase()
      .replace(/ŋ/g, "ng")
      .replace(/[^a-z'\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function ingest(rows) {
    Object.keys(lines).forEach(function (k) { delete lines[k]; });
    Object.keys(words).forEach(function (k) { delete words[k]; });
    (rows || []).forEach(function (row) {
      if (!row || !row.audio) return;
      const key = norm(row.norm || row.text);
      if (!key) return;
      lines[key] = row.audio;
      if (key.indexOf(' ') === -1) words[key] = row.audio;
    });
  }

  function plan(text) {
    const line = norm(text);
    if (!line) return null;
    if (lines[line]) return { kind: 'line', clips: [lines[line]] };
    const parts = line.split(' ');
    const clips = [];
    let i = 0;
    while (i < parts.length) {
      let hit = null;
      let n = 0;
      const max = Math.min(8, parts.length - i);
      for (let len = max; len >= 1; len--) {
        const key = parts.slice(i, i + len).join(' ');
        const audio = len === 1 ? words[key] : lines[key];
        if (audio) { hit = audio; n = len; break; }
      }
      if (!hit) return null;
      clips.push(hit);
      i += n;
    }
    return clips.length ? { kind: 'words', clips: clips } : null;
  }

  function counts() {
    return { lines: Object.keys(lines).length, words: Object.keys(words).length };
  }

  function decodeUrl(ctx, url) {
    return fetch(url).then(function (res) { return res.arrayBuffer(); }).then(function (buf) {
      return ctx.decodeAudioData(buf);
    });
  }

  function play(ready, alive) {
    if (!ready || !ready.clips || !ready.clips.length || typeof AudioContext === 'undefined') {
      return Promise.resolve(false);
    }
    const ctx = new AudioContext();
    if (ctx.state === 'suspended') { try { ctx.resume(); } catch (_) {} }
    return Promise.all(ready.clips.map(function (url) { return decodeUrl(ctx, url); })).then(function (buffers) {
      if (alive && !alive()) { try { ctx.close(); } catch (_) {} return false; }
      const rate = buffers[0].sampleRate || 24000;
      const overlap = Math.round(rate * 0.02);
      let total = 0;
      buffers.forEach(function (b, idx) {
        total += b.length;
        if (idx) total -= overlap;
      });
      if (total < 1) return false;
      const mixed = ctx.createBuffer(1, total, rate);
      const out = mixed.getChannelData(0);
      let at = 0;
      buffers.forEach(function (b, idx) {
        const src = b.getChannelData(0);
        const start = idx ? at - overlap : 0;
        for (let i = 0; i < src.length; i++) {
          const o = start + i;
          if (o < 0 || o >= out.length) continue;
          let w = 1;
          if (idx && i < overlap) w = i / overlap;
          if (idx < buffers.length - 1 && i > src.length - overlap) {
            w = Math.min(w, (src.length - i) / overlap);
          }
          out[o] += src[i] * w;
        }
        at = start + src.length;
      });
      return new Promise(function (resolve) {
        const node = ctx.createBufferSource();
        node.buffer = mixed;
        node.connect(ctx.destination);
        const timer = setInterval(function () {
          if (alive && !alive()) {
            clearInterval(timer);
            try { node.stop(); } catch (_) {}
            try { ctx.close(); } catch (_) {}
            resolve(true);
          }
        }, 80);
        node.onended = function () {
          clearInterval(timer);
          try { ctx.close(); } catch (_) {}
          resolve(true);
        };
        node.start();
      });
    }).catch(function () { return false; });
  }

  function boot() {
    let tries = 0;
    function tick() {
      const db = (typeof fbDb !== 'undefined' && fbDb) || (root.fbDb || null);
      if (!db || !db.collection) {
        tries += 1;
        if (tries < 20) setTimeout(tick, 500);
        return;
      }
      try {
        db.collection('lgVoice').limit(400).onSnapshot(function (snap) {
          const rows = [];
          snap.forEach(function (doc) {
            const d = doc.data() || {};
            rows.push({ text: d.text, norm: d.norm, audio: d.audio });
          });
          ingest(rows);
        }, function () {});
      } catch (_) {}
    }
    tick();
  }

  if (typeof window !== 'undefined') boot();

  return { norm: norm, ingest: ingest, plan: plan, play: play, counts: counts };
});
