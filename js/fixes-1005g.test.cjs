/* 05 Oct (g): the voices keep reading, Luganda is spoken from its own sounds,
   alerts can be tested from the phone, and scripts that changed are fetched
   again. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const flush = () => new Promise((r) => setImmediate(r));

(async function () {
  /* ---------- 1. Luganda, as described in the published phonology ---------- */
  const Lg = require('./lg-speak.js');
  const W = Lg.word;
  assert.strictEqual(W('ekitabo'), 'etʃitabo', 'k before i is "ch"');
  assert.strictEqual(W('Kiwanuka'), 'tʃiwanuka');
  assert.strictEqual(W('kyalo'), 'tʃaːlo', 'ky is "ch", and the vowel after a consonant + y is long');
  assert.strictEqual(W('gyebale'), 'dʒeːbale', 'gy is "j"');
  assert.strictEqual(W('nyumba'), 'ɲuːmba', 'ny is one sound; a vowel before mb is long');
  assert.strictEqual(W("ng'ombe"), 'ŋoːmbe', "ng' is the ng of sing");
  assert.strictEqual(W('engoma'), 'eːŋɡoma', 'ng without the apostrophe is ng + g');
  assert.strictEqual(W('Katonda'), 'katoːnda', 'a vowel before nd is long');
  assert.strictEqual(W('bbiri'), 'bːiɾi', 'a doubled consonant is long, even first; r after i is a tap');
  assert.strictEqual(W('ekkomo'), 'ekːomo', 'a vowel before a doubled consonant stays short');
  assert.strictEqual(W('weebale'), 'weːbale', 'a doubled vowel is long; l after a is l');
  assert.strictEqual(W('ebirungi'), 'ebiɾuːɲdʒi', 'r after i is a tap; ngi is "nji"');
  assert.strictEqual(W('okwagala'), 'okwaːɡala', 'the vowel after kw is long');
  assert.strictEqual(W('nnyo'), 'ɲːo');
  assert.strictEqual(W('omulimu'), 'omulimu', 'short vowels stay short');
  ['ekitabo', 'Katonda', 'weebale', 'nyumba'].forEach(function (w) {
    const p = W(w);
    assert.ok(!/[ɪʊəɐˈ]/.test(p), w + ': no English reduced vowels and no English stress: ' + p);
  });
  assert.strictEqual(Lg.voice("Weebale nnyo, ssebo! Eno y'entandikwa."), 'weːbale ɲːo, sːebo! eno jeːntaːndikwa.', 'a word-final vowel is short (05h)');
  assert.ok(Lg.looksLuganda('Abantu bangi baagenda mu kibuga okulaba omupiira ne bakomawo nga basanyufu nnyo'), 'Luganda text is recognised');
  assert.ok(!Lg.looksLuganda('Every morning the riders gather at the stage near the old taxi park and wait for the rain'), 'English is not');
  assert.ok(!Lg.looksLuganda('Hola amigo'), 'too short to tell');
  {
    const space = read('js/broadcast-space.js');
    const body = space.slice(space.indexOf('async function bspaceSpeakBody'), space.indexOf('function bspacePickVoice'));
    assert.ok(/lang === 'lg' \|\| \(!lang && /.test(body) && /looksLuganda\(src\)/.test(body), 'a Luganda piece read "As written" is read as Luganda');
    assert.ok(/Lg\.voice/.test(body), 'from the Luganda phones');
  }

  /* ---------- 2. The phones reach the voice model ---------- */
  {
    const worker = read('js/naluno-voice-worker.js');
    assert.ok(/say\(tts, data\.text, data\.voice, data\.speed, data\.phonemes \|\| ''\)/.test(worker), 'the worker passes the phones on (it dropped them)');
    const engine = read('js/naluno-voice-engine.js');
    assert.ok(/async function sayPhones\(tts, phones, voice, speed\)/.test(engine), 'the engine speaks given phones');
    assert.ok(/if \(phones && !Array\.isArray\(phones\) && String\(phones\)\.trim\(\)\) return sayPhones/.test(engine), 'without the English phonemizer');
    assert.ok(!/\/\(\?<[=!]/.test(engine.replace(/_lbRx\("[^"]*"/g, '')), 'no look-behind regex literals: older iPhones can load the voice');
    new vm.Script(engine);
  }

  /* ---------- 3. Voices: pace, team, pieces, scheduling ---------- */
  const V = require('./naluno-voices.js');
  assert.ok(V.PACE.Bella >= 1.35 && V.PACE.Bella <= 1.5, 'female about 160 words a minute or a little faster (was about 150)');
  assert.ok(V.PACE.Hugo >= 0.85 && V.PACE.Hugo <= 0.95, 'male about 160 words a minute or a little faster (was about 210)');
  assert.ok(!/\(\?<[=!]/.test(read('js/naluno-voices.js')));
  {
    const p = V._pieces('Title\n\nOne sentence here. See https://www.bbc.com/news now! "Sure?" she asked.\nNext.');
    assert.deepStrictEqual(p.map((x) => x.text), ['Title', 'One sentence here.', 'See bbc.com now!', '"Sure?" she asked.', 'Next.']);
    assert.strictEqual(p[0].gap, V.GAP.paragraph);
    assert.strictEqual(p[1].gap, V.GAP.sentence);
  }
  function teamFor(cores, mem) {
    const box = { navigator: { hardwareConcurrency: cores, deviceMemory: mem }, console };
    box.window = box;
    vm.createContext(box);
    vm.runInContext(read('js/naluno-voices.js'), box);
    return box.NalunoVoices._teamSize();
  }
  assert.strictEqual(teamFor(8, 8), 3, 'an 8-core phone makes three sentences at once');
  assert.strictEqual(teamFor(8, undefined), 3, 'iPhone (no memory figure): three');
  assert.strictEqual(teamFor(4, 4), 2);
  assert.strictEqual(teamFor(8, 2), 1, 'a 2 GB phone keeps one copy of the model');
  assert.strictEqual(teamFor(2, 4), 1);
  {
    /* Playback through fake workers: phones go to the worker, pieces
       follow each other with only the planned pauses, and every maker is
       used. */
    const starts = [];
    const posted = [];
    let clock = 0;
    class FakeWorker {
      postMessage(m) {
        const self = this;
        posted.push(m);
        setTimeout(() => {
          if (m.type === 'load') return self.onmessage({ data: { type: 'ready' } });
          if (m.type !== 'say') return;
          const rate = 24000, n = Math.round(rate * (1.0 + m.text.length / 40));
          const smp = new Float32Array(n);
          for (let i = Math.round(rate * 0.4); i < n - rate * 0.3; i++) smp[i] = 0.2 * Math.sin(i / 7);
          self.onmessage({ data: { type: 'audio', n: m.n, rate, samples: smp } });
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
    vm.runInContext(read('js/naluno-voices.js'), g);
    const tick = setInterval(() => { clock += 0.05; }, 1);
    const ok = await g.NalunoVoices.speak('Weebale nnyo.\n\nAbantu bangi. Baagenda.', { voice: 'male', alive: () => true, phonemes: (t) => Lg.voice(t) });
    clearInterval(tick);
    assert.strictEqual(ok, true);
    assert.strictEqual(starts.length, 3);
    const gaps = starts.slice(1).map((s, i) => +(s.at - (starts[i].at + starts[i].dur)).toFixed(2));
    assert.strictEqual(gaps[1], V.GAP.sentence, 'sentence pause only: ' + gaps);
    assert.ok(gaps[0] >= V.GAP.paragraph - 0.001, 'paragraph pause (or a little more while the first ones are made)');
    const says = posted.filter((m) => m.type === 'say');
    assert.deepStrictEqual(says.map((m) => m.phonemes), ['weːbale ɲːo.', 'abaːntu baːɲdʒi.', 'baːɡeːnda.'], 'Luganda phones go to the model');
    assert.ok(says.every((m) => m.voice === 'Hugo' && m.speed === V.PACE.Hugo), 'male voice at its pace');
    assert.strictEqual(g.NalunoVoices._makers(), 3);
  }

  /* ---------- 4. Alerts: the worker self-test stays; the Callsign button was
     removed on request (05h) ---------- */
  {
    const html = read('app/index.html');
    assert.ok(!html.includes('id="testPushBtn"'), 'no test button in Callsign');
    assert.ok(!/\/v1\/push\/test/.test(read('js/notifications.js')), 'and no code for it');
    const h = read('workers/economy/handler.mjs');
    assert.ok(/export const VERSION = "2\.1\d\.\d-[a-z]+"/.test(h), '/health shows whether the new worker is live');
  }

  /* ---------- 5. Scripts that changed are fetched again ---------- */
  {
    const html = read('app/index.html');
    ['ice-core.js', 'spark-engine.js', 'calls.js', 'call-pip.js', 'naluno-voices.js', 'lg-speak.js', 'broadcast-space.js', 'known.js'].forEach((f) => {
      const m = html.match(new RegExp('/js/' + f.replace(/[.-]/g, '\\$&') + '\\?v=(\\d{8}[a-z])'));
      assert.ok(m && m[1] >= '20261005g', f + ' stamp');
    });
    assert.ok(/naluno-voice-worker\.js\?v=20261005[g-z]/.test(read('js/naluno-voices.js')));
    assert.ok(/naluno-voice-engine\.js\?v=20261005[g-z]/.test(read('js/naluno-voice-worker.js')));
    assert.ok(!/requestFullscreen/.test(read('js/call-pip.js')), 'no forced full screen in calls');
  }
  console.log('fixes-1005g tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
