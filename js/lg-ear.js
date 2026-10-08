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

  /* 09 Oct: the two masters in voices/lg (the console plays them). Once
     their exact words are written in voices/lg/masters.json, Listen plays
     them for those words like any saved line. A console recording of the
     same words still comes first. */
  let masterRows = [];
  let lastRows = [];
  function ingest(rows) {
    lastRows = rows || [];
    Object.keys(lines).forEach(function (k) { delete lines[k]; });
    Object.keys(words).forEach(function (k) { delete words[k]; });
    masterRows.concat(lastRows).forEach(function (row) {
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

  let current = null;
  let loaded = false;
  let readyWait = [];

  function markLoaded() {
    loaded = true;
    const wait = readyWait;
    readyWait = [];
    wait.forEach(function (fn) { try { fn(); } catch (_) {} });
  }

  function ready() {
    if (loaded) return Promise.resolve();
    return new Promise(function (resolve) {
      readyWait.push(resolve);
      setTimeout(function () { resolve(); }, 4000);
    });
  }

  function resume() {
    if (!current || current.ended) return;
    if (!current.paused) return;
    try {
      const started = current.play();
      if (started && typeof started.catch === 'function') started.catch(function () {});
    } catch (_) {}
  }

  function stop() {
    if (!current) return;
    try { current.pause(); } catch (_) {}
    try { current.src = ''; } catch (_) {}
    current = null;
  }

  /* The same player the console uses. Do not decode and rebuild the
     clip — that is a different sound from the one that was saved. */
  function play(readyPlan, alive) {
    if (!readyPlan || !readyPlan.clips || !readyPlan.clips.length || typeof Audio === 'undefined') {
      return Promise.resolve(false);
    }
    stop();
    const clips = readyPlan.clips.slice();
    let i = 0;
    return new Promise(function (resolve) {
      function next() {
        if (alive && !alive()) { stop(); resolve(true); return; }
        if (i >= clips.length) { current = null; resolve(true); return; }
        const audio = new Audio(clips[i]);
        current = audio;
        i += 1;
        audio.onended = function () {
          if (current === audio) current = null;
          next();
        };
        audio.onerror = function () { stop(); resolve(false); };
        const started = audio.play();
        if (started && typeof started.catch === 'function') {
          started.catch(function () { stop(); resolve(false); });
        }
      }
      next();
    });
  }

  function boot() {
    let tries = 0;
    function tick() {
      const db = (typeof fbDb !== 'undefined' && fbDb) || ((typeof window !== 'undefined' && window.fbDb) || null);
      if (!db || !db.collection) {
        tries += 1;
        if (tries < 20) setTimeout(tick, 500);
        else markLoaded();
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
          markLoaded();
        }, function () { markLoaded(); });
      } catch (_) { markLoaded(); }
    }
    tick();
  }

  function loadMasters() {
    try {
      if (typeof fetch !== 'function') return;
      fetch('/voices/lg/masters.json', { cache: 'no-cache' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
        const list = (j && Array.isArray(j.masters)) ? j.masters : [];
        masterRows = list.filter(function (m) {
          return m && typeof m.file === 'string' && /^[a-z0-9._-]+$/i.test(m.file) && String(m.text || '').trim();
        }).map(function (m) { return { text: String(m.text), audio: '/voices/lg/' + m.file }; });
        if (masterRows.length) ingest(lastRows);
      }).catch(function () {});
    } catch (_) {}
  }

  if (typeof window !== 'undefined') { boot(); loadMasters(); }

  return { norm: norm, ingest: ingest, plan: plan, play: play, stop: stop, resume: resume, ready: ready, counts: counts };
});
