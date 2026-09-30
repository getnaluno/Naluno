/* Naluno's own voices for reading a written Broadcast.
   Female and male, generated on the phone. Not the system voice,
   and not a Google read-aloud. */
(function (root) {
  'use strict';
  var worker = null;
  var booting = null;
  var seq = 0;
  var job = 0;
  var pending = {};
  var ctx = null;
  var VOICE = { female: 'Bella', male: 'Jasper' };

  function ac() {
    if (!ctx) ctx = new (root.AudioContext || root.webkitAudioContext)();
    if (ctx.state === 'suspended') { try { ctx.resume(); } catch (_) {} }
    return ctx;
  }

  function prime() { try { ac(); } catch (_) {} }

  function stop() {
    job += 1;
    if (worker) {
      try { worker.postMessage({ type: 'job', job: job }); } catch (_) {}
    }
  }

  function boot() {
    if (booting) return booting;
    booting = new Promise(function (resolve, reject) {
      var workerUrl = '/js/naluno-voice-worker.js?v=20260930c';
      try {
        worker = new Worker(workerUrl);
      } catch (e) {
        booting = null;
        reject(e);
        return;
      }
      worker.onmessage = function (ev) {
        var d = ev.data || {};
        if (d.type === 'ready') { resolve(true); return; }
        if (d.type === 'load-error') {
          booting = null;
          reject(new Error(d.message || 'voice'));
          return;
        }
        var p = pending[d.n];
        if (!p) return;
        delete pending[d.n];
        if (d.type === 'audio') p.resolve(d);
        else if (d.type === 'skip') p.resolve(null);
        else p.reject(new Error(d.message || 'voice'));
      };
      worker.onerror = function () {
        booting = null;
        reject(new Error('voice worker'));
      };
      worker.postMessage({ type: 'load' });
    });
    return booting;
  }

  function say(text, voice, speed, myJob) {
    var n = ++seq;
    return new Promise(function (resolve, reject) {
      pending[n] = { resolve: resolve, reject: reject };
      worker.postMessage({ type: 'say', n: n, job: myJob, text: text, voice: voice, speed: speed });
    });
  }

  function sentences(text) {
    var parts = String(text || '').split(/(?<=[.!?])\s+|\n+/);
    var out = [];
    parts.forEach(function (part) {
      var s = part.replace(/\s+/g, ' ').trim();
      while (s.length > 280) {
        var cut = s.lastIndexOf(' ', 280);
        if (cut < 40) cut = 280;
        out.push(s.slice(0, cut));
        s = s.slice(cut).trim();
      }
      if (s) out.push(s);
    });
    return out;
  }

  function play(audio, alive) {
    return new Promise(function (resolve) {
      var samples = audio && audio.samples;
      if (!samples || !samples.length) { resolve(); return; }
      var context = ac();
      var buf = context.createBuffer(1, samples.length, audio.rate || 24000);
      var mono = samples instanceof Float32Array ? samples : new Float32Array(samples);
      buf.copyToChannel(mono, 0);
      var src = context.createBufferSource();
      src.buffer = buf;
      src.connect(context.destination);
      var timer = setInterval(function () {
        if (!alive()) {
          clearInterval(timer);
          try { src.stop(); } catch (_) {}
          resolve();
        }
      }, 80);
      src.onended = function () { clearInterval(timer); resolve(); };
      src.start();
    });
  }

  function speak(text, opts) {
    opts = opts || {};
    var alive = opts.alive || function () { return true; };
    var voice = VOICE[opts.voice] || VOICE.female;
    var speed = typeof opts.speed === 'number' ? opts.speed : 1.05;
    var bits = sentences(text);
    if (!bits.length) return Promise.resolve(false);
    prime();
    var started = job;
    return boot().then(function () {
      if (!alive() || job !== started) return true;
      if (worker) { try { worker.postMessage({ type: 'job', job: job }); } catch (_) {} }
      var myJob = job;
      if (typeof opts.onready === 'function') opts.onready();
      var next = say(bits[0], voice, speed, myJob);
      var i = 0;
      var heard = false;
      function step() {
        return next.then(function (audio) {
          if (!alive() || myJob !== job) return true;
          var samples = audio && audio.samples;
          if (!samples || !samples.length) {
            if (i + 1 < bits.length) {
              i += 1;
              next = say(bits[i], voice, speed, myJob);
              return step();
            }
            return heard;
          }
          heard = true;
          next = (i + 1 < bits.length) ? say(bits[i + 1], voice, speed, myJob) : null;
          i += 1;
          return play(audio, function () { return alive() && myJob === job; }).then(function () {
            if (!alive() || myJob !== job) return true;
            if (!next) return true;
            return step();
          });
        });
      }
      return step();
    }).catch(function () { return false; });
  }

  root.NalunoVoices = {
    speak: speak,
    stop: stop,
    prime: prime,
    female: 'Bella',
    male: 'Jasper',
  };
})(typeof window !== 'undefined' ? window : globalThis);
