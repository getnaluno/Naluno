/* Naluno's own voices for reading a written Broadcast.
   Female and male, generated on the phone. Not the system voice,
   and not a Google read-aloud.

   30d:
   - Pace. Measured on the same passage, the female voice spoke about
     135 words a minute and the male about 190. Both now speak at a normal
     reading pace, about 155-165 words a minute. The words themselves are
     made exactly as before; only the pace setting changed.
   - Breaks. Every sentence the voice makes comes with about 0.5-0.8 s of
     silence before it and 0.3-0.6 s after it, so two sentences were about
     1-1.4 s apart, longer between paragraphs. That silence is now trimmed
     and replaced by a natural pause: a short one between sentences, a
     slightly longer one between paragraphs. Pauses inside a sentence (at
     commas) are left as the voice makes them.
   - No waiting between sentences. The next sentences are made while the
     current one plays, and each one is scheduled to start right as the
     previous pause ends. Phones with four or more cores make two sentences
     at once, so the reading keeps up. */
(function (root) {
  'use strict';
  var VOICE = { female: 'Bella', male: 'Jasper' };
  /* The model's pace for each voice at a normal reading speed (measured). */
  var PACE = { Bella: 1.3, Jasper: 0.95 };
  /* Pauses between pieces, in seconds. */
  /* With the soft edges kept above (about 0.17 s of near-silence), a
     sentence pause sounds like about a third of a second and a paragraph
     pause like about 0.6 s, as a person reading aloud would. */
  var GAP = { sentence: 0.16, paragraph: 0.45, split: 0.02, comma: 0.1 };
  var WORKER_URL = '/js/naluno-voice-worker.js?v=20260930c';
  var ctx = null;
  var job = 0;
  var makers = [];

  function ac() {
    if (!ctx) ctx = new (root.AudioContext || root.webkitAudioContext)();
    if (ctx.state === 'suspended') { try { ctx.resume(); } catch (_) {} }
    return ctx;
  }
  function prime() { try { ac(); } catch (_) {} }

  /* One voice maker (a worker holding the model). */
  function Maker() {
    this.seq = 0;
    this.pending = {};
    this.worker = null;
    this.booting = null;
    this.busy = 0;
  }
  Maker.prototype.boot = function () {
    var self = this;
    if (self.booting) return self.booting;
    self.booting = new Promise(function (resolve, reject) {
      try { self.worker = new Worker(WORKER_URL); } catch (e) { self.booting = null; reject(e); return; }
      self.worker.onmessage = function (ev) {
        var d = ev.data || {};
        if (d.type === 'ready') { resolve(true); return; }
        if (d.type === 'load-error') { self.booting = null; reject(new Error(d.message || 'voice')); return; }
        var p = self.pending[d.n];
        if (!p) return;
        delete self.pending[d.n];
        self.busy = Math.max(0, self.busy - 1);
        if (d.type === 'audio') p.resolve(d);
        else if (d.type === 'skip') p.resolve(null);
        else p.reject(new Error(d.message || 'voice'));
      };
      self.worker.onerror = function () { self.booting = null; reject(new Error('voice worker')); };
      self.worker.postMessage({ type: 'load' });
    });
    return self.booting;
  };
  Maker.prototype.job = function (j) {
    if (this.worker) { try { this.worker.postMessage({ type: 'job', job: j }); } catch (_) {} }
  };
  Maker.prototype.say = function (text, voice, speed, j) {
    var self = this;
    var n = ++self.seq;
    self.busy += 1;
    return new Promise(function (resolve, reject) {
      self.pending[n] = { resolve: resolve, reject: reject };
      self.worker.postMessage({ type: 'say', n: n, job: j, text: text, voice: voice, speed: speed });
    });
  };
  function maker(i) {
    if (!makers[i]) makers[i] = new Maker();
    return makers[i];
  }

  function twoMakers() {
    try {
      var nav = root.navigator || {};
      if ((nav.hardwareConcurrency || 2) < 4) return false;
      if (nav.deviceMemory && nav.deviceMemory < 3) return false;
      return true;
    } catch (_) { return false; }
  }
  function stop() {
    job += 1;
    makers.forEach(function (m) { m.job(job); });
  }

  /* The text in speakable pieces. `gap` is the pause after each piece. */
  /* Links are read as their words or their site name, never letter by letter. */
  function speakable(text) {
    return String(text || '')
      .replace(/\[([^\]\n]{1,90})\]\((?:https?:\/\/|www\.)[^\s)]+\)/g, '$1')
      .replace(/\b(?:https?:\/\/|www\.)([^\s\/?#)]+)[^\s)]*/g, function (m, host) {
        return host.replace(/^www\./, '');
      });
  }
  function pieces(text) {
    var out = [];
    var paras = speakable(text).replace(/\r/g, '').split(/\n\s*\n+|\n/);
    paras.forEach(function (para) {
      var p = para.replace(/\s+/g, ' ').trim();
      if (!p) return;
      /* No look-behind: older iPhones cannot read it. */
      /* A sentence ends at . ! ? followed by a space (so bbc.com stays whole),
         and a lower-case next word ("…?" she asked) stays in the sentence. */
      var sents = [];
      (p.match(/.+?(?:[.!?…]+["'”’)]*(?=\s|$)|$)/g) || [p]).forEach(function (x) {
        x = x.trim();
        if (!x) return;
        if (sents.length && /^[a-z]/.test(x)) sents[sents.length - 1] += ' ' + x;
        else sents.push(x);
      });
      sents.forEach(function (s) {
        s = s.trim();
        while (s.length > 280) {
          var cut = s.lastIndexOf(', ', 280);
          if (cut < 60) cut = s.lastIndexOf(' ', 280);
          if (cut < 40) cut = 280;
          out.push({ text: s.slice(0, cut + (s[cut] === ',' ? 1 : 0)).trim(), gap: GAP.split });
          s = s.slice(cut + 1).trim();
        }
        if (s) out.push({ text: s, gap: GAP.sentence });
      });
      if (out.length) out[out.length - 1].gap = GAP.paragraph;
    });
    /* The first sound comes sooner when the opening pieces are short:
       a long opening sentence is read in two parts, split at a comma. */
    for (var k = 0; k < Math.min(2, out.length); k++) {
      var t = out[k].text;
      if (t.length <= 90) continue;
      var c = t.indexOf(', ', 25);
      if (c < 0 || c > 110 || t.length - c < 25) continue;
      out.splice(k, 1, { text: t.slice(0, c + 1), gap: GAP.comma }, { text: t.slice(c + 2), gap: out[k].gap });
      break;
    }
    return out;
  }
  /* Kept for callers that only want the sentence list. */
  function sentences(text) { return pieces(text).map(function (p) { return p.text; }); }

  /* The sound without the silence the voice puts before and after it,
     with a short fade so the cut never clicks. */
  function trim(samples, rate) {
    var s = samples;
    if (!s || !s.length) return s;
    var thr = 0.006;
    var win = Math.max(1, Math.round(rate * 0.01));
    var a = 0, b = s.length;
    function loud(i) {
      var end = Math.min(s.length, i + win), m = 0;
      for (var j = i; j < end; j++) { var v = s[j] < 0 ? -s[j] : s[j]; if (v > m) m = v; }
      return m >= thr;
    }
    while (a < s.length && !loud(a)) a += win;
    while (b > a && !loud(Math.max(a, b - win))) b -= win;
    if (b <= a) return new Float32Array(0);
    /* A soft first sound (f, h, s) and a fading last one are kept whole. */
    a = Math.max(0, a - Math.round(rate * 0.08));
    b = Math.min(s.length, b + Math.round(rate * 0.09));
    var out = new Float32Array(b - a);
    out.set(s.subarray ? s.subarray(a, b) : Array.prototype.slice.call(s, a, b));
    var fade = Math.min(Math.round(rate * 0.012), out.length >> 1);
    for (var k = 0; k < fade; k++) { var g = k / fade; out[k] *= g; out[out.length - 1 - k] *= g; }
    return out;
  }

  function speak(text, opts) {
    opts = opts || {};
    var alive = opts.alive || function () { return true; };
    var voice = VOICE[opts.voice] || VOICE.female;
    /* opts.speed is a gentle multiplier on the normal pace (1 = normal). */
    var mult = (typeof opts.speed === 'number' && opts.speed > 0.5 && opts.speed < 2) ? opts.speed : 1;
    var speed = (PACE[voice] || 1) * mult;
    var list = pieces(text);
    if (!list.length) return Promise.resolve(false);
    prime();
    var started = job;
    var first = maker(0);
    return first.boot().then(function () {
      if (!alive() || job !== started) return true;
      var myJob = job;
      makers.forEach(function (m) { m.job(myJob); });
      var live = function () { return alive() && myJob === job; };
      if (typeof opts.onready === 'function') opts.onready();

      var results = [];      // promise per piece
      var sent = 0;          // pieces handed to a maker
      var LOOK = 3;          // pieces made ahead of what is playing
      /* Two voice makers side by side on phones with four or more cores:
         the next sentence is made while this one is, so the reading keeps
         up and the first sentences come sooner. */
      var team = [first];
      if (twoMakers()) team.push(maker(1));
      function sayOn(m, piece) {
        var t0 = Date.now();
        var run = function (mm) {
          return mm.boot().then(function () { mm.job(myJob); return mm.say(piece.text, voice, speed, myJob); });
        };
        return run(m).catch(function () { return m === first ? null : run(first); })
          .then(function (a) { if (a) a.took = Date.now() - t0; return a; });
      }
      function feed(upto) {
        while (sent < list.length && sent <= upto) {
          results[sent] = sayOn(team[sent % team.length], list[sent]);
          sent += 1;
        }
      }

      var context = ac();
      var nextAt = 0;
      var sources = [];
      var heard = false;
      var i = 0;
      feed(LOOK);
      return new Promise(function (done) {
        var finished = false;
        var guard = setInterval(function () {
          if (!live()) {
            clearInterval(guard);
            sources.forEach(function (s) { try { s.stop(); } catch (_) {} });
            if (!finished) { finished = true; done(true); }
          }
        }, 80);
        function finish(v) { if (finished) return; finished = true; clearInterval(guard); done(v); }
        function step() {
          if (!live()) return finish(true);
          if (i >= list.length) {
            var left = Math.max(0, nextAt - context.currentTime);
            setTimeout(function () { finish(heard || true); }, left * 1000 + 30);
            return;
          }
          var idx = i;
          /* A short first piece (a title) waits for the sentence after it,
             so the reading does not stop right after the title. */
          var gate = results[idx];
          if (idx === 0 && list.length > 1) {
            gate = results[0].then(function (a0) {
              var secs = (a0 && a0.samples) ? a0.samples.length / (a0.rate || 24000) * 0.7 : 0;
              if (!a0 || !a0.took) return a0;
              /* Start the title just late enough that the next sentence is
                 ready when the title's pause ends (estimated from how fast
                 the title was made). */
              var perChar = a0.took / Math.max(8, list[0].text.length);
              var wait = perChar * list[1].text.length * 1.1 / 1000 - secs - list[0].gap;
              if (wait <= 0.05) return a0;
              return Promise.race([
                results[1].then(function () { return a0; }, function () { return a0; }),
                new Promise(function (r) { setTimeout(function () { r(a0); }, Math.min(wait, 6) * 1000); }),
              ]);
            });
          }
          gate.then(function (audio) {
            if (!live()) return finish(true);
            i += 1;
            feed(i + LOOK);
            var samples = audio && audio.samples;
            if (samples && samples.length) {
              var rate = audio.rate || 24000;
              var clip = trim(samples instanceof Float32Array ? samples : new Float32Array(samples), rate);
              if (clip.length) {
                var buf = context.createBuffer(1, clip.length, rate);
                buf.copyToChannel(clip, 0);
                var src = context.createBufferSource();
                src.buffer = buf;
                src.connect(context.destination);
                var now = context.currentTime + 0.02;
                var at = Math.max(now, nextAt);
                try { src.start(at); } catch (_) { src.start(); }
                sources.push(src);
                src.onended = function () { var k = sources.indexOf(src); if (k >= 0) sources.splice(k, 1); };
                heard = true;
                nextAt = at + buf.duration + list[idx].gap;
              }
            }
            /* The next piece is scheduled the moment it is ready, to start
               exactly when this one's pause ends: no dead air, and no timer
               that a busy phone could run late. */
            step();
          }, function () {
            i += 1;
            feed(i + LOOK);
            step();
          });
        }
        step();
      }).then(function (v) { return heard ? true : (v === true && !live()); });
    }).catch(function () { return false; });
  }

  root.NalunoVoices = {
    _makers: function () { return makers.length; },
    speak: speak,
    stop: stop,
    prime: prime,
    female: 'Bella',
    male: 'Jasper',
    _pieces: pieces,
    _sentences: sentences,
    _trim: trim,
    PACE: PACE,
    GAP: GAP,
  };
  if (typeof module === 'object' && module.exports) module.exports = root.NalunoVoices;
})(typeof window !== 'undefined' ? window : globalThis);
