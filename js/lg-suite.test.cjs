/* PERMANENT Luganda pronunciation suite (05 Oct h).
   Every change to the voice system (lg-speak.js, lg-voice.js,
   naluno-voices.js, the voice worker or engine, the economy worker's
   /v1/voice/lg) must pass this. The words, names, sentences and numbers are
   in js/lg-suite.json; a native speaker's correction goes there AND into
   the lexicon in js/lg-voice.js.
   Run: node js/lg-suite.test.cjs */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const LV = require('./lg-voice.js');
const suite = JSON.parse(read('js/lg-suite.json'));

/* Sounds the voice may receive for Luganda. Nothing English: no reduced
   vowels (ɪ ʊ ə ɐ ʌ æ), no English r (ɹ), no glides as vowels, no stress. */
const ALLOWED = /^[aeiouːbdfɡhklmnɲŋpɾstʃʒvwjz .,!?;:'\-]*$/;
const ENGLISH = /[ɪʊəɐʌæɑɔɛɹˈˌ]|aɪ|eɪ|oʊ|aʊ|ɔɪ/;
const nuclei = (ph) => (ph.match(/[aeiou]ː?/g) || []).length;
const syllables = (s) => s.split(/[-\s]+/).filter(Boolean).length;
let checked = 0;

function sound(entry, what) {
  const ph = what === 'number' ? LV.phones(String(entry.n)) : (what === 'sentence' ? LV.phones(entry.text) : LV.word(entry.text));
  assert.strictEqual(ph, entry.phones, what + ' "' + (entry.text || entry.n) + '" changed: ' + ph + ' (suite: ' + entry.phones + ')');
  assert.ok(ALLOWED.test(ph), what + ' "' + (entry.text || entry.n) + '" uses a sound outside Luganda: ' + ph);
  assert.ok(!ENGLISH.test(ph), what + ' "' + (entry.text || entry.n) + '" has English vowels or stress: ' + ph);
  /* A word-final vowel is short. */
  ph.split(/[ ,.!?;:]+/).filter(Boolean).forEach((w) => assert.ok(!/ː$/.test(w), 'final vowel short: ' + w));
  checked++;
  return ph;
}

/* ---------- 1. Words and names: exact sounds, every syllable kept ---------- */
suite.words.concat(suite.names).forEach((e) => {
  const ph = sound(e, 'word');
  assert.strictEqual(nuclei(ph), syllables(e.syllables), e.text + ': every syllable spoken (' + e.syllables + ' -> ' + ph + ')');
});
/* The brief's own examples. */
assert.strictEqual(LV.word('chatandika'), 'tʃataːndika', 'cha-tan-di-ka');
assert.strictEqual(LV.word('Katonda'), 'katoːnda', 'Ka-ton-da, not "Kay-ton-dah"');
assert.strictEqual(LV.word('ebigambo'), 'ebiɡaːmbo', 'e-bi-gam-bo');
/* Names are never anglicised. */
['Kampala', 'Mbarara', 'Kiwanuka', 'Nnalubaale', 'Entebbe'].forEach((n) => assert.ok(LV.names[n.toLowerCase()], n + ' is a known name'));

/* ---------- 2. Sentences ---------- */
suite.sentences.forEach((e) => {
  sound(e, 'sentence');
  assert.strictEqual(LV.sentenceLang(e.text, ''), 'lg', 'recognised as Luganda without being told: ' + e.text);
  assert.strictEqual(LV.sentenceLang(e.text, 'lg'), 'lg');
});

/* ---------- 3. Numbers ---------- */
suite.numbers.forEach((e) => {
  assert.strictEqual(LV.number(e.n), e.words, e.n + ' in Luganda');
  sound(e, 'number');
});
assert.strictEqual(LV.expand('Essimu: 0772123456'), 'Essimu: zeero musanvu musanvu bbiri emu bbiri ssatu nnya ttaano mukaaga', 'a phone number digit by digit');
assert.strictEqual(LV.expand('Abantu 1,000'), 'Abantu lukumi');

/* ---------- 4. English stays English; Luganda names in it stay Luganda ---------- */
suite.english.forEach((e) => {
  assert.strictEqual(LV.sentenceLang(e.text, ''), 'en', e.text);
  const segs = LV.englishWithNames(e.text);
  const names = segs ? segs.filter((s) => s.lg).length : 0;
  assert.strictEqual(names, e.names.length, 'names said the Luganda way in: ' + e.text);
  if (segs) {
    assert.strictEqual(segs.map((s) => s.en || '').join('').replace(/\s+/g, ' ').trim().length > 0, true);
    segs.filter((s) => s.lg).forEach((s) => assert.ok(ALLOWED.test(s.lg) && !ENGLISH.test(s.lg), s.lg));
  }
});
/* An English quote inside a Luganda piece is read as English. */
assert.strictEqual(LV.sentenceLang('He said thank you for the food and the water.', 'lg'), 'en');

/* ---------- 5. Routing: Luganda never reaches the English phonemizer ---------- */
{
  const plan = LV.planner('Weebale nnyo. I love Kampala. Abantu bangi baagenda mu kibuga.', { lang: '' });
  const a = plan('Weebale nnyo.');
  assert.strictEqual(a.lang, 'lg');
  assert.ok(a.phonemes && typeof a.phonemes === 'string', 'Luganda goes as sounds');
  assert.ok(a.speed < 1 && a.speed >= 0.85, 'a moderate Luganda pace');
  const b = plan('I love Kampala.');
  assert.strictEqual(b.lang, 'en');
  assert.ok(Array.isArray(b.phonemes) && b.phonemes.some((s) => s.lg === 'kaːmpala'));
  const c = plan('Thank you for reading.');
  assert.strictEqual(c.phonemes, '', 'plain English is unchanged');
  /* Spark in Luganda: everything as Luganda. */
  const sp = LV.planner('Oli otya', { lang: 'lg' });
  assert.strictEqual(sp('Oli otya').lang, 'lg');
  assert.strictEqual(sp('Kale').phonemes, 'kale');
}

/* ---------- 6. Doubled consonants are said strongly (for the phone voice) ---------- */
{
  const fv = (w) => LV.forVoice(LV.word(w));
  assert.strictEqual(fv('bbiri'), 'ˈbːiɾi', 'bb at the start: a strong b');
  assert.strictEqual(fv('ssebo'), 'ˈsːebo');
  assert.strictEqual(fv('ekkomo'), 'ekˈkomo', 'kk inside: held across the syllables');
  assert.strictEqual(fv('amazzi'), 'amazˈzi');
  assert.strictEqual(fv('jjajja'), 'ˈdʒːadʒˈdʒa');
  assert.strictEqual(fv('weebale'), 'weːbale', 'no doubled consonant: nothing added');
  assert.strictEqual(fv('Katonda'), 'katoːnda');
  suite.words.concat(suite.names).forEach((e) => {
    const v = LV.forVoice(e.phones);
    const gem = (e.phones.match(/(tʃ|dʒ|[bdfɡkmnɲŋpstvzlɾ])ː/g) || []).length;
    assert.strictEqual((v.match(/ˈ/g) || []).length, gem, e.text + ': a strong mark only for each doubled consonant: ' + v);
  });
}

/* ---------- 7. The whole chain: Naluno's own Luganda voice, the optional
   Sunbird voice, and the phone voice from Luganda sounds ---------- */
(async function () {
  function world(answer, ownWorks) {
    const posted = [];
    const fetched = [];
    class FakeWorker {
      postMessage(m) {
        posted.push(m);
        setTimeout(() => {
          if (m.type === 'load') return this.onmessage({ data: { type: 'ready' } });
          if (m.type === 'af-say') {
            if (!ownWorks) return this.onmessage({ data: { type: 'fail', n: m.n, message: 'af-missing' } });
            const s = new Float32Array(22050); for (let i = 0; i < s.length; i++) s[i] = 0.3 * Math.sin(i / 6);
            return this.onmessage({ data: { type: 'audio', n: m.n, rate: 22050, samples: s } });
          }
          if (m.type !== 'say') return;
          const rate = 24000, n = rate;
          const smp = new Float32Array(n);
          for (let i = 0; i < n; i++) smp[i] = 0.2 * Math.sin(i / 7);
          this.onmessage({ data: { type: 'audio', n: m.n, rate, samples: smp } });
        }, 2);
      }
    }
    let clock = 0;
    const starts = [];
    const rates = [];
    class FakeCtx {
      constructor() { this.state = 'running'; this.destination = {}; }
      get currentTime() { return clock; }
      resume() {}
      createBuffer(ch, len, rate) { rates.push(rate); return { duration: len / rate, copyToChannel() {} }; }
      createBufferSource() { const src = { connect() {}, stop() {}, start(at) { starts.push(at); setTimeout(() => src.onended && src.onended(), 1); } }; return src; }
      decodeAudioData(buf, ok) { const s = new Float32Array(16000); for (let i = 0; i < s.length; i++) s[i] = 0.3 * Math.sin(i / 5); ok({ getChannelData: () => s, sampleRate: 16000 }); }
    }
    const g = {
      Worker: FakeWorker, AudioContext: FakeCtx, navigator: { hardwareConcurrency: 4 },
      setTimeout, clearTimeout, setInterval, clearInterval, Float32Array, Uint8Array, ArrayBuffer, Promise, Math, Date, String, Array, Object, Error, JSON, Number, console,
      firebase: { auth: () => ({ currentUser: { getIdToken: () => Promise.resolve('tok') } }) },
      fetch: (url, init) => { fetched.push({ url, body: JSON.parse(init.body) }); return Promise.resolve(answer(url)); },
    };
    g.window = g;
    vm.createContext(g);
    vm.runInContext(read('js/lg-speak.js'), g);
    vm.runInContext(read('js/lg-voice.js'), g);
    vm.runInContext(read('js/naluno-voices.js'), g);
    const tick = setInterval(() => { clock += 0.05; }, 1);
    return { g, posted, fetched, starts, rates, stop: () => clearInterval(tick) };
  }
  const text = 'Weebale nnyo, ssebo.\n\nI love Kampala. Abantu 3 baagenda mu kibuga.';
  const audio = { ok: true, status: 200, arrayBuffer: () => Promise.resolve(new ArrayBuffer(64)) };
  const plan = (w, voice) => w.g.NalunoLgVoice.planner(text, { voice, decode: w.g.NalunoVoices.decode });

  /* A. Naluno's African voice: Luganda goes to it as Luganda sounds in its
     symbols (numbers as Luganda words), nothing is paid for, English stays
     English. */
  let w = world(() => audio, true);
  let ok = await w.g.NalunoVoices.speak(text, { voice: 'male', alive: () => true, plan: plan(w, 'male') });
  w.stop();
  assert.strictEqual(ok, true);
  const lgs = w.posted.filter((m) => m.type === 'af-say');
  assert.deepStrictEqual(lgs.map((m) => m.phones), ['weebale ɲɲˈo, ssˈebo.', 'abaantu ssˈatu baaɡeenda mu tʃibuɡa.'], 'Luganda sounds to the African voice');
  assert.ok(lgs.every((m) => m.female === false), 'the male setting');
  assert.strictEqual(w.fetched.length, 0, 'the paid voice is not asked');
  let says = w.posted.filter((m) => m.type === 'say');
  assert.strictEqual(says.length, 1, 'only the English sentence goes to the English-trained voice');
  assert.ok(Array.isArray(says[0].phonemes) && says[0].phonemes.some((s) => s.lg === 'kaːmpala'));
  assert.strictEqual(w.starts.length, 3);
  assert.strictEqual(w.g.NalunoVoices._own.state, 'ok');
  assert.strictEqual(w.rates.filter((r) => r === 22050).length, 2, 'two Luganda sentences from the African voice');

  /* B. African voice files cannot be had, Sunbird key set: Sunbird. */
  w = world(() => audio, false);
  ok = await w.g.NalunoVoices.speak(text, { voice: 'male', alive: () => true, plan: plan(w, 'male') });
  w.stop();
  assert.strictEqual(ok, true);
  assert.strictEqual(w.g.NalunoVoices._own.state, 'missing');
  assert.deepStrictEqual(w.fetched.map((f) => f.body.text).sort(), ['Abantu ssatu baagenda mu kibuga.', 'Weebale nnyo, ssebo.']);
  assert.strictEqual(w.posted.filter((m) => m.type === 'say').length, 1);
  assert.strictEqual(w.starts.length, 3);

  /* C. Neither: the phone voice from Luganda sounds, doubled consonants
     strong, a little slower than English. */
  w = world(() => ({ ok: false, status: 503, arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)) }), false);
  ok = await w.g.NalunoVoices.speak(text, { voice: 'female', alive: () => true, plan: plan(w, 'female') });
  w.stop();
  assert.strictEqual(ok, true);
  says = w.posted.filter((m) => m.type === 'say');
  assert.strictEqual(says.length, 3);
  const lgSays = says.filter((m) => typeof m.phonemes === 'string');
  assert.deepStrictEqual(lgSays.map((m) => m.phonemes).sort(), ['abaːntu ˈsːatu baːɡeːnda mu tʃibuɡa.', 'weːbale ˈɲːo, ˈsːebo.'], 'Luganda sounds, never spelling');
  lgSays.forEach((m) => assert.ok(m.speed < w.g.NalunoVoices.PACE.Bella, 'Luganda a little slower'));
  assert.strictEqual(w.fetched.length, 1, 'after "not set up" the worker is left alone');
  assert.strictEqual(w.starts.length, 3);
  says.forEach((m) => assert.ok(m.phonemes && (typeof m.phonemes === 'string' ? m.phonemes.trim() : m.phonemes.length), 'no Luganda without sounds: ' + m.text));

  /* D. The African voice engine: its own symbols, the female voice. */
  const E = require('./naluno-af-engine.js');
  const cfg = JSON.parse(read('voices/af/sw.json'));
  const map = cfg.phoneme_id_map;
  assert.deepStrictEqual(E.idsFor('ab', map), [1, 0, 14, 0, 15, 0, 2], 'the Piper order: ^ _ a _ b _ $');
  suite.sentences.forEach((e) => {
    const af = LV.forAfrican(e.phones);
    for (const ch of af) assert.ok(ch in map, 'the African voice knows every sound: "' + ch + '" in ' + af);
    assert.ok(!/ː/.test(af) && !/dʒ|ɾ/.test(af), 'in the symbols it was trained on: ' + af);
  });
  assert.strictEqual(LV.forAfrican(LV.word('Katonda')), 'katoonda');
  assert.strictEqual(LV.forAfrican(LV.word('bbiri')), 'bbˈiri', 'a doubled consonant doubled and said strongly');
  assert.strictEqual(LV.forAfrican(LV.word('ekkomo')), 'ekkˈomo');
  {
    /* The female voice: same length, pitch about ×1.65. */
    const sr = 22050, n = sr;
    const x = new Float32Array(n);
    for (let i = 0; i < n; i++) x[i] = 0.5 * Math.sin(2 * Math.PI * 120 * i / sr) + 0.25 * Math.sin(2 * Math.PI * 240 * i / sr);
    const y = E.female(x, sr, cfg.female);
    assert.ok(Math.abs(y.length - n) < sr * 0.02, 'same length');
    const fx = E._track(x, sr).f.filter((v) => v > 0), fy = E._track(y, sr).f.filter((v) => v > 0);
    const med = (a) => a.slice().sort((p, q) => p - q)[a.length >> 1];
    const ratio = med(fy) / med(fx);
    assert.ok(ratio > 1.45 && ratio < 1.85, 'pitch raised about 1.65x: ' + ratio.toFixed(2));
  }
  const worker = read('js/naluno-voice-worker.js');
  assert.ok(/importScripts\('\/js\/naluno-af-engine\.js\?v=/.test(worker) && /data\.type === 'af-say'/.test(worker));
  assert.ok(/af-missing/.test(worker), 'voice files missing: the app is told');
  const size = fs.statSync(path.join(root, 'voices/af/sw.onnx')).size;
  assert.ok(size < 25 * 1024 * 1024, 'under GitHub\'s 25 MB web-upload limit: ' + size);

  /* ---------- 8. The engine speaks given sounds and mixed sentences ---------- */
  const engine = read('js/naluno-voice-engine.js');
  assert.ok(/async function sayMixed\(tts, segs, voice, speed\)/.test(engine));
  assert.ok(/if \(Array\.isArray\(phones\) && phones\.length\) return sayMixed/.test(engine));
  new vm.Script(engine);
  const shown = suite.words.length + suite.names.length + suite.sentences.length + suite.numbers.length;
  assert.strictEqual(checked, shown);
  console.log('lg-suite passed: ' + checked + ' items (' + suite.words.length + ' words, ' + suite.names.length + ' names, ' + suite.sentences.length + ' sentences, ' + suite.numbers.length + ' numbers)');
})().catch((e) => { console.error(e); process.exit(1); });
