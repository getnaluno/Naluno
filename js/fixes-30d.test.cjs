/* 30d: calls connect sooner (TURN kept ready, no waiting on it in the
   wrong place, voice calls "Connected" at once) and the Writing voices read
   at a normal pace with natural pauses. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const read = (f) => fs.readFileSync(path.join(__dirname, f), 'utf8');
const flush = () => new Promise((r) => setImmediate(r));

(async function () {
  /* ---------- 1. TURN kept ready (ice-core) ---------- */
  function iceBox(opts) {
    const store = {};
    if (opts.saved) store.nalunoIceCache = JSON.stringify(opts.saved);
    const listeners = {};
    const box = {
      console: { log() {}, warn() {} },
      Date, Math, JSON, Promise, String, Array, Object, Error,
      localStorage: {
        getItem: (k) => (k in store ? store[k] : null),
        setItem: (k, v) => { store[k] = String(v); },
        removeItem: (k) => { delete store[k]; },
      },
      setTimeout: (fn) => { fn(); return 0; }, clearTimeout() {},
      setInterval() { return 0; },
      AbortController: undefined,
      document: { hidden: false, addEventListener() {} },
      currentUser: opts.user === undefined ? { uid: 'me', getIdToken: async () => 'tok' } : opts.user,
      fetches: 0,
    };
    box.window = { addEventListener: (k, fn) => { listeners[k] = fn; } };
    box.fetch = async () => {
      box.fetches++;
      if (opts.fail) throw new Error('offline');
      return { ok: true, json: async () => ({ iceServers: [{ urls: ['stun:s:3478', 'turn:t:3478'], username: 'u', credential: 'c' }] }) };
    };
    vm.createContext(box);
    vm.runInContext(read('ice-core.js') + '\nthis.IceCore = IceCore; this.fetchTurnServers = fetchTurnServers;', box);
    box.store = store;
    return box;
  }
  {
    const b = iceBox({});
    assert.strictEqual(b.IceCore.cached(), null, 'nothing cached at first');
    await b.fetchTurnServers();
    assert.ok(b.IceCore.cached(), 'fetched TURN is cached');
    const saved = JSON.parse(b.store.nalunoIceCache);
    assert.strictEqual(saved.uid, 'me', 'saved for this person');
    const again = iceBox({ saved });
    assert.ok(again.IceCore.cached(), 'a fresh app start has TURN at once');
    assert.strictEqual(again.fetches, 0);
    const other = iceBox({ saved, user: { uid: 'someone-else', getIdToken: async () => 't' } });
    assert.strictEqual(other.IceCore.cached(), null, 'another person never uses these credentials');
    const old = iceBox({ saved: Object.assign({}, saved, { at: Date.now() - 21 * 60 * 1000 }) });
    assert.strictEqual(old.IceCore.cached(), null, 'saved credentials older than 20 minutes are not used');
    assert.ok(!('nalunoIceCache' in old.store), 'and are removed');
    const bad = iceBox({ saved: { uid: 'me', at: 'x', cfg: 1 } });
    assert.strictEqual(bad.IceCore.cached(), null, 'a damaged saved copy is ignored');
  }
  {
    /* Refreshed before they run out; a failed refresh keeps the old ones. */
    const saved = { uid: 'me', at: Date.now() - 19 * 60 * 1000, cfg: { iceServers: [{ urls: 'turn:old:3478' }] } };
    const b = iceBox({ saved });
    b.IceCore.keepWarm(); await flush(); await flush();
    assert.strictEqual(b.fetches, 1, 'an 18+ minute old copy is fetched again');
    assert.notStrictEqual(JSON.parse(b.store.nalunoIceCache).at, saved.at, 'and the new one saved');
    const f = iceBox({ saved, fail: true });
    f.IceCore.keepWarm(); await flush(); await flush();
    assert.ok(f.IceCore.cached() && /old/.test(JSON.stringify(f.IceCore.cached())), 'a failed refresh keeps the usable copy');
    assert.strictEqual(f.IceCore.pending(), false);
    const fresh = iceBox({ saved: Object.assign({}, saved, { at: Date.now() }) });
    fresh.IceCore.keepWarm(); await flush();
    assert.strictEqual(fresh.fetches, 0, 'fresh credentials are not fetched again');
  }

  /* ---------- 2. Waiting for TURN only while it is really coming ---------- */
  const calls = read('calls.js');
  {
    const a = calls.indexOf('function nalunoCfgHasTurn');
    const b = calls.indexOf('window.nalunoCfgHasTurn = nalunoCfgHasTurn;');
    const run = async (pending, cap) => {
      let now = 0; const q = [];
      const ctx = { Date: { now: () => now }, setTimeout: (fn) => { q.push(fn); }, prewarmIceServers() {}, console,
        IceCore: { now: () => ({ iceServers: [{ urls: 'stun:x' }] }), pending: () => pending } };
      vm.createContext(ctx);
      vm.runInContext(calls.slice(a, b) + '\nthis.wait = nalunoWaitForTurn;', ctx);
      let out = 'pending';
      ctx.wait(cap).then((v) => { out = v; });
      await flush();
      let steps = 0;
      while (out === 'pending' && q.length && steps++ < 500) { now += 40; q.shift()(); await flush(); }
      return now;
    };
    assert.ok(await run(false, 1000) <= 120, 'a TURN fetch that came back empty is not waited out');
    assert.ok(await run(true, 1000) >= 1000, 'a TURN fetch still on its way is waited for, up to the cap');
  }
  {
    const start = calls.indexOf('async function startRealCall') >= 0 ? calls.indexOf('async function startRealCall') : calls.indexOf('const dial = nalunoDialing = nalunoLastDial');
    const body = calls.slice(start, calls.indexOf('armRingTimeout(currentCallContactId);', start));
    const wait = body.indexOf('const turnReady = nalunoWaitForTurn(1000);');
    const mic = body.indexOf('await nalunoOpenMic()');
    assert.ok(wait > 0 && mic > wait, 'TURN is waited for while the mic/camera opens, not after');
    assert.ok(body.indexOf('await turnReady') > mic && body.indexOf('await turnReady') < body.indexOf('createPeerConnection()'), 'and before the offer is built');
    assert.ok(!body.includes('await nalunoWaitForTurn(600)'), 'no second wait after the camera');
    const wd = calls.slice(calls.indexOf('function attachConnectionWatchdogs'), calls.indexOf('pc.oniceconnectionstatechange'));
    /* 10.02: "Connected" now follows the media itself (nalunoMarkIfMediaUp), voice included. */
    assert.ok(/if\(s === 'connected'\)\{[\s\S]{0,400}nalunoMarkIfMediaUp\(pc\)/.test(wd), 'Connected follows the media the moment the call connects');
  }

  /* ---------- 3. Writing voices: pace and pauses ---------- */
  const V = require('./naluno-voices.js');
  const src = read('naluno-voices.js');
  assert.ok(!/\(\?<[=!]/.test(src), 'no look-behind (older iPhones cannot run it)');
  assert.ok(/naluno-voice-worker\.js\?v=\d{8}[a-z]/.test(src));
  assert.strictEqual(V.PACE.Bella, 1.42, 'female: about 168 words a minute (05 Oct i, a little faster)');
  assert.strictEqual(V.PACE.Hugo, 0.89, 'male: about 168 words a minute (05 Oct i, a little faster)');
  {
    const p = V._pieces('Boda boda diaries\n\nIt was raining. See https://www.bbc.com/news for more! "Are you sure?" she asked.\nNext line here.');
    assert.deepStrictEqual(p.map((x) => x.text), ['Boda boda diaries', 'It was raining.', 'See bbc.com for more!', '"Are you sure?" she asked.', 'Next line here.']);
    assert.strictEqual(p[0].gap, V.GAP.paragraph, 'a longer pause after a paragraph');
    assert.strictEqual(p[1].gap, V.GAP.sentence, 'a short pause between sentences');
    assert.ok(V.GAP.sentence <= 0.3 && V.GAP.paragraph <= 0.6, 'pauses are short');
    assert.strictEqual(V._pieces('[my blog](https://ex.org/b) is here.')[0].text, 'my blog is here.', 'a link is read by its words');
    const long = V._pieces('word, '.repeat(80) + 'end.');
    assert.ok(long.every((x) => x.text.length <= 281), 'long sentences are split');
  }
  {
    const rate = 24000;
    const s = new Float32Array(rate * 2);
    for (let i = rate * 0.6; i < rate * 1.5; i++) s[i] = Math.sin(i / 5) * 0.3;
    const t = V._trim(s, rate);
    assert.ok(t.length / rate < 1.1 && t.length / rate > 0.9, 'the voice\'s own silence before and after is cut: ' + (t.length / rate));
    assert.strictEqual(V._trim(new Float32Array(rate), rate).length, 0, 'pure silence is dropped');
  }
  {
    /* Playback: pieces follow each other with exactly the planned pause. */
    const starts = [];
    let clock = 0;
    class FakeWorker {
      constructor() { this.job = 0; }
      postMessage(m) {
        const self = this;
        setTimeout(() => {
          if (m.type === 'load') return self.onmessage({ data: { type: 'ready' } });
          if (m.type === 'job') { self.job = m.job; return; }
          if (m.type === 'say') {
            const rate = 24000, n = Math.round(rate * (1.0 + m.text.length / 40));
            const smp = new Float32Array(n);
            for (let i = Math.round(rate * 0.4); i < n - rate * 0.3; i++) smp[i] = 0.2 * Math.sin(i / 7);
            self.onmessage({ data: { type: 'audio', n: m.n, rate, samples: smp } });
          }
        }, 5);
      }
    }
    class FakeCtx {
      constructor() { this.state = 'running'; this.destination = {}; }
      get currentTime() { return clock; }
      resume() {}
      createBuffer(ch, len, rate) { return { duration: len / rate, copyToChannel() {} }; }
      createBufferSource() { const src = { connect() {}, stop() {}, start(at) { starts.push({ at, dur: src.buffer.duration }); setTimeout(() => src.onended && src.onended(), 1); } }; return src; }
    }
    const g = { Worker: FakeWorker, AudioContext: FakeCtx, navigator: { hardwareConcurrency: 8 }, setTimeout, clearTimeout, setInterval, clearInterval, Float32Array, Promise, Math, Date, String, Array, Object, Error };
    g.window = g;
    vm.createContext(g);
    vm.runInContext(src, g);
    const tick = setInterval(() => { clock += 0.05; }, 1);
    const ok = await g.NalunoVoices.speak('Title\n\nOne sentence here. Two sentence here.\nThird para.', { voice: 'female', alive: () => true });
    clearInterval(tick);
    assert.strictEqual(ok, true);
    assert.strictEqual(starts.length, 4, 'four pieces played');
    const gaps = starts.slice(1).map((s, i) => +(s.at - (starts[i].at + starts[i].dur)).toFixed(2));
    assert.deepStrictEqual(gaps, [V.GAP.paragraph, V.GAP.sentence, V.GAP.paragraph], 'planned pauses only: ' + gaps);
    assert.strictEqual(g.NalunoVoices._makers(), 3, 'three voice makers on an 8-core phone');
  }

  /* ---------- 4. Listen keeps paragraphs ---------- */
  {
    const space = read('broadcast-space.js');
    const fn = space.slice(space.indexOf('async function bspaceSpeakWriting'), space.indexOf('function bspacePickVoice'));
    assert.ok(!fn.includes("replace(/\\s+/g, ' ')"), 'paragraph breaks are no longer flattened');
    assert.ok(!fn.includes('speed: 1.05'), 'the pace comes from the voice, not a fixed slow speed');
  }

  /* ---------- 5. Release stamps ---------- */
  {
    const html = read('../app/index.html');
    ['naluno-voices.js', 'broadcast-space.js', 'calls.js', 'ice-core.js'].forEach((f) => {
      const m = html.match(new RegExp('/js/' + f.replace(/[.-]/g, '\\$&') + '\\?v=(\\d{8}[a-z])'));
      assert.ok(m && m[1] >= '20260930d', f + ' stamp bumped');
    });
    const sw = read('../sw.js');
    assert.ok((sw.match(/APP_BUILD = '(\d{8}[a-z])'/) || [])[1] >= '20260930d');
  }
  console.log('fixes-30d tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
