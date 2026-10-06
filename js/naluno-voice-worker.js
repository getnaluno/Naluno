/* On-device Broadcast voices. Weights and wasm are same-origin files,
   so a phone that has already opened Naluno can read aloud with Google
   and the wider internet blocked. */
/* Classic worker, not a module. ONNX Runtime only fetches its wasm when
   the page has window or the worker has importScripts. A module worker
   has neither, so the voice never started and Listen used the phone. */
importScripts('/js/naluno-voice-engine.js?v=20261005i');
importScripts('/js/naluno-af-engine.js?v=20261007a');

var createFromBuffers = self.NalunoVoiceEngine.createFromBuffers;
var say = self.NalunoVoiceEngine.say;

let tts = null;
let job = 0;
let chain = Promise.resolve();

function enqueue(fn) {
  const run = chain.then(fn, fn);
  chain = run.then(function () {}, function () {});
  return run;
}

async function bytes(path) {
  const cache = await caches.open('naluno-voices');
  let hit = await cache.match(path);
  if (!hit) {
    const res = await fetch(path);
    if (!res.ok) throw new Error(path + ' ' + res.status);
    try { await cache.put(path, res.clone()); } catch (_) {}
    hit = res;
  }
  return hit.arrayBuffer();
}

async function load() {
  if (tts) return;
  const base = new URL('/voices/kitten/', self.location.origin).href;
  const ortBase = new URL('/voices/ort/', self.location.origin).href;
  const [model, voices, cfgRaw] = await Promise.all([
    bytes(base + 'model.onnx'),
    bytes(base + 'voices.npz'),
    bytes(base + 'config.json'),
  ]);
  const config = JSON.parse(new TextDecoder().decode(cfgRaw));
  tts = await createFromBuffers(ortBase, model, voices, config);
}

self.onmessage = function (ev) {
  const data = ev.data || {};
  if (data.type === 'job') { job = data.job; return; }
  if (data.type === 'load') {
    enqueue(function () {
      return load().then(function () {
        self.postMessage({ type: 'ready' });
      }, function (e) {
        self.postMessage({ type: 'load-error', message: (e && e.message) || 'voice' });
      });
    });
    return;
  }
  /* 05i: Naluno's African voice reads Luganda sounds (voices/af/). If its
     files cannot be had, this answers 'af-missing' and the app uses the
     other voice. */
  if (data.type === 'af-say') {
    enqueue(function () {
      if (data.job !== job) { self.postMessage({ type: 'skip', n: data.n }); return; }
      var Af = self.NalunoAfEngine;
      var ort = self.NalunoVoiceEngine.ort;
      if (!Af || !ort) { self.postMessage({ type: 'fail', n: data.n, message: 'af-missing' }); return; }
      ort.env.wasm.numThreads = 1;
      ort.env.wasm.simd = true;
      ort.env.wasm.proxy = false;
      ort.env.wasm.wasmPaths = new URL('/voices/ort/', self.location.origin).href;
      var base = new URL('/voices/af/', self.location.origin).href;
      return Af.load(base, ort, bytes).then(function () {
        return Af.synth(data.phones, { female: !!data.female, speed: data.speed });
      }, function () { throw new Error('af-missing'); }).then(function (audio) {
        if (!audio || data.job !== job) { self.postMessage({ type: 'skip', n: data.n }); return; }
        var samples = new Float32Array(audio.samples);
        self.postMessage({ type: 'audio', n: data.n, rate: audio.rate, samples: samples }, [samples.buffer]);
      }).catch(function (e) {
        self.postMessage({ type: 'fail', n: data.n, message: (e && e.message) || 'af' });
      });
    });
    return;
  }
  if (data.type === 'say') {
    enqueue(function () {
      if (data.job !== job) {
        self.postMessage({ type: 'skip', n: data.n });
        return;
      }
      /* 05 Oct (g): Luganda arrives as phones and is spoken from them; it
         used to be dropped here, so Luganda was read by the English
         phonemizer. */
      /* 05h: phonemes may also be segments (English with Luganda names). */
      return say(tts, data.text, data.voice, data.speed, data.phonemes || '').then(function (audio) {
        if (data.job !== job) {
          self.postMessage({ type: 'skip', n: data.n });
          return;
        }
        const samples = new Float32Array(audio.samples);
        self.postMessage({ type: 'audio', n: data.n, rate: audio.rate, samples: samples }, [samples.buffer]);
      }, function (e) {
        self.postMessage({ type: 'fail', n: data.n, message: (e && e.message) || 'voice' });
      });
    });
  }
};
