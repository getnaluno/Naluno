/* On-device Broadcast voices. Weights and wasm are same-origin files,
   so a phone that has already opened Naluno can read aloud with Google
   and the wider internet blocked. */
import { createFromBuffers, say } from './naluno-voice-engine.js';

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
  if (data.type === 'say') {
    enqueue(function () {
      if (data.job !== job) {
        self.postMessage({ type: 'skip', n: data.n });
        return;
      }
      return say(tts, data.text, data.voice, data.speed).then(function (audio) {
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
