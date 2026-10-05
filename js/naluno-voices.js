/* Naluno's own voices for reading a written Broadcast.
   Female and male, generated on the phone. Not the system voice,
   and not a Google read-aloud.

   05 Oct (g):
   - Pace, measured on the same passage: the male voice (Hugo) read about
     210 words a minute and the female (Bella) about 150. Both now read
     at about 160, a normal reading pace. The words are made as before.
   - The long breaks. A phone makes this voice about as fast as it speaks,
     or slower, and only one sentence was made at a time, after the last
     one had started: each break was however long the phone took to make
     the next sentence (30 s and more on a slow phone). Now:
       * phones with several cores make two or three sentences at once;
       * sentences are made ahead, while one plays, and each is scheduled
         to start the moment the previous pause ends;
       * the silence the voice puts around every sentence (about 0.4-0.8 s
         before, 0.2-0.5 s after) is trimmed, and a short natural pause is
         put back: about a third of a second between sentences, about 0.6 s
         between paragraphs;
       * when the phone is clearly slower than the reading, Listen waits a
         few seconds at the start (at most 5) so the reading then runs on
         instead of stopping between sentences.
   - Luganda: phones handed in by the caller reach the voice model (they
     were dropped on the way before). */
(function (root) {
  'use strict';
  var VOICE = { female: 'Bella', male: 'Hugo' };
  /* Model pace for about 160 words a minute (measured; config.json already
     multiplies Bella by 0.8 and Hugo by 0.9). */
  var PACE = { Bella: 1.42, Hugo: 0.89 };
  /* Pauses put back between pieces, in seconds (the kept soft edges add
     about 0.17 s of near-silence to each). */
  var GAP = { sentence: 0.16, paragraph: 0.45, split: 0.02, comma: 0.1 };
  var WORKER_URL = '/js/naluno-voice-worker.js?v=20261005i';
  var ctx = null;
  var job = 0;
  var makers = [];

  function ac() {
    if (!ctx) ctx = new (root.AudioContext || root.webkitAudioContext)();
    if (ctx.state === 'suspended') { try { ctx.resume(); } catch (_) {} }
    return ctx;
  }
  function prime() { try { ac(); } catch (_) {} }
  function resume() { try { ac(); } catch (_) {} }

  /* One voice maker: a worker holding the model. */
  function Maker() { this.seq = 0; this.pending = {}; this.worker = null; this.booting = null; }
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
  Maker.prototype.say = function (text, voice, speed, j, phones) {
    var self = this;
    var n = ++self.seq;
    return new Promise(function (resolve, reject) {
      self.pending[n] = { resolve: resolve, reject: reject };
      self.worker.postMessage({ type: 'say', n: n, job: j, text: text, voice: voice, speed: speed, phonemes: phones || '' });
    });
  };
  /* 05i: Naluno's African voice (a Kiswahili speaker, on the phone) reads
     Luganda sounds; samples at 22050 Hz. */
  Maker.prototype.sayAf = function (phones, female, speed, j) {
    var self = this;
    var n = ++self.seq;
    return new Promise(function (resolve, reject) {
      self.pending[n] = { resolve: resolve, reject: reject };
      self.worker.postMessage({ type: 'af-say', n: n, job: j, phones: phones, female: !!female, speed: speed });
    });
  };
  /* 'unknown' until the first try; 'missing' when its files cannot be had
     (then Luganda uses the other voice for the rest of the visit). */
  var own = { state: 'unknown' };
  function maker(i) {
    if (!makers[i]) makers[i] = new Maker();
    return makers[i];
  }
  /* How many sentences this phone can make at once. Each maker holds its
     own copy of the model, so memory decides too. */
  function teamSize() {
    try {
      var nav = root.navigator || {};
      var cores = nav.hardwareConcurrency || 2;
      var mem = nav.deviceMemory || 0;
      if (mem && mem < 3) return 1;
      if (cores >= 6 && (!mem || mem >= 4)) return 3;
      if (cores >= 4) return 2;
    } catch (_) {}
    return 1;
  }

  function stop() {
    job += 1;
    makers.forEach(function (m) { m.job(job); });
  }

  /* Links are read as their words or their site name, never letter by letter. */
  function speakable(text) {
    return String(text || '')
      .replace(/\[([^\]\n]{1,90})\]\((?:https?:\/\/|www\.)[^\s)]+\)/g, '$1')
      .replace(/\b(?:https?:\/\/|www\.)([^\s\/?#)]+)[^\s)]*/g, function (m, host) { return host.replace(/^www\./, ''); });
  }
  /* The text in speakable pieces, with the pause that follows each. */
  function pieces(text) {
    var out = [];
    var paras = speakable(text).replace(/\r/g, '').split(/\n\s*\n+|\n/);
    paras.forEach(function (para) {
      var p = para.replace(/\s+/g, ' ').trim();
      if (!p) return;
      /* A sentence ends at . ! ? followed by a space (so bbc.com stays
         whole); a lower-case next word ("…?" she asked) stays with it. No
         look-behind: older iPhones cannot read it. */
      var sents = [];
      (p.match(/.+?(?:[.!?…]+["'”’)]*(?=\s|$)|$)/g) || [p]).forEach(function (x) {
        x = x.trim();
        if (!x) return;
        if (sents.length && /^[a-z]/.test(x)) sents[sents.length - 1] += ' ' + x;
        else sents.push(x);
      });
      sents.forEach(function (s) {
        while (s.length > 240) {
          var cut = s.lastIndexOf(', ', 240);
          if (cut < 60) cut = s.lastIndexOf(' ', 240);
          if (cut < 40) cut = 240;
          out.push({ text: s.slice(0, cut + (s[cut] === ',' ? 1 : 0)).trim(), gap: GAP.comma });
          s = s.slice(cut + 1).trim();
        }
        if (s) out.push({ text: s, gap: GAP.sentence });
      });
      if (out.length) out[out.length - 1].gap = GAP.paragraph;
    });
    /* A long opening sentence is read in two parts (split at a comma), so
       the first sound comes sooner. */
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

  /* The sound without the silence the voice puts before and after it, with
     the soft first and last sounds kept and a short fade so nothing clicks. */
  function trim(s, rate) {
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
    var male = opts.voice === 'male';
    var voice = male ? VOICE.male : VOICE.female;
    var mult = (typeof opts.speed === 'number' && opts.speed > 0.5 && opts.speed < 2) ? opts.speed : 1;
    var speed = (PACE[voice] || 1) * mult;
    var toPhones = typeof opts.phonemes === 'function' ? opts.phonemes : null;
    var list = pieces(text);
    if (!list.length) return Promise.resolve(false);
    prime();
    var started = job;
    var first = maker(0);
    return first.boot().then(function () {
      if (!alive() || job !== started) return true;
      var myJob = job;
      var live = function () { return alive() && myJob === job; };
      var team = [first];
      for (var t = 1; t < teamSize(); t++) team.push(maker(t));
      var results = [];
      var sent = 0;
      var LOOK = Math.max(3, team.length * 2);
      function phonesFor(p) {
        if (!toPhones) return '';
        try { return String(toPhones(p.text) || ''); } catch (_) { return ''; }
      }
      /* 05h: a planner (NalunoLgVoice.planner) decides per sentence:
         Luganda goes to the Luganda-trained voice when it is set up, else
         to this voice as Luganda sounds at a moderate pace; English may
         carry Luganda names as their own sounds (segments). */
      function planFor(p) {
        if (typeof opts.plan === 'function') {
          try { return opts.plan(p.text) || {}; } catch (_) { return {}; }
        }
        return { phonemes: phonesFor(p) };
      }
      function sayOn(m, p) {
        var t0 = Date.now();
        var pl = planFor(p);
        var sp = speed * ((typeof pl.speed === 'number' && pl.speed > 0.5 && pl.speed < 1.5) ? pl.speed : 1);
        var run = function (mm) {
          return mm.boot().then(function () { mm.job(myJob); return mm.say(p.text, voice, sp, myJob, pl.phonemes || ''); });
        };
        var onDevice = function () {
          return run(m).catch(function () { return m === first ? null : run(first); })
            .then(function (a) { if (a) a.took = Date.now() - t0; return a; });
        };
        var viaNative = function () {
          if (typeof pl.native !== 'function') return onDevice();
          return Promise.resolve().then(pl.native).then(function (a) {
            if (!a || !a.samples || !a.samples.length) return onDevice();
            a.native = true;
            a.took = Date.now() - t0;
            return a;
          }, onDevice);
        };
        /* Luganda: Naluno's African voice first (free, on the phone), then
           the optional Sunbird voice, then this voice from Luganda sounds. */
        if (!pl.af || own.state === 'missing') return viaNative();
        return m.boot().then(function () { m.job(myJob); return m.sayAf(pl.af.phones, pl.af.female, pl.af.speed || 1, myJob); }).then(function (a) {
          if (!a || !a.samples || !a.samples.length) return viaNative();
          own.state = 'ok';
          a.native = true;
          a.took = Date.now() - t0;
          return a;
        }, function (e) {
          if (e && /af-missing/.test(String(e.message || ''))) own.state = 'missing';
          return viaNative();
        });
      }

      function feed(upto) {
        while (sent < list.length && sent <= upto) {
          results[sent] = sayOn(team[sent % team.length], list[sent]);
          sent += 1;
        }
      }
      if (typeof opts.onready === 'function') opts.onready();
      feed(LOOK);
      var context = ac();
      var nextAt = 0;
      var sources = [];
      var heard = false;
      var i = 0;
      var startAt = 0;
      var gated = false;
      return new Promise(function (done) {
        var finished = false;
        var guard = setInterval(function () {
          if (!live()) {
            clearInterval(guard);
            sources.forEach(function (s) { try { s.stop(); } catch (_) {} });
            if (!finished) { finished = true; done(true); }
          }
        }, 80);
        function finish() { if (finished) return; finished = true; clearInterval(guard); done(true); }
        function step() {
          if (!live()) return finish();
          if (i >= list.length) {
            var left = Math.max(0, nextAt - context.currentTime);
            setTimeout(finish, left * 1000 + 40);
            return;
          }
          var idx = i;
          /* A short first piece (a title) waits until the sentence after it
             is made, so the reading does not stop right after the title. */
          var gate = results[idx];
          if (idx === 0 && list.length > 1) {
            gate = results[0].then(function (a0) {
              var secs = (a0 && a0.samples) ? a0.samples.length / (a0.rate || 24000) : 0;
              if (secs >= 3.5) return a0;
              gated = true;
              return Promise.race([
                results[1].then(function () { return a0; }, function () { return a0; }),
                new Promise(function (r) { setTimeout(function () { r(a0); }, 10000); }),
              ]);
            });
          }
          gate.then(function (audio) {
            if (!live()) return finish();
            i += 1;
            feed(i + LOOK);
            var samples = audio && audio.samples;
            if (samples && samples.length) {
              var rate = audio.rate || 24000;
              var mono = samples instanceof Float32Array ? samples : new Float32Array(samples);
              if (!audio.native && root.NalunoVoiceMaster && typeof root.NalunoVoiceMaster.master === 'function') {
                try { mono = root.NalunoVoiceMaster.master(mono, rate, male) || mono; } catch (_) {}
              }
              var clip = trim(mono, rate);
              if (clip.length) {
                var buf = context.createBuffer(1, clip.length, rate);
                buf.copyToChannel(clip, 0);
                if (!heard) {
                  /* The first piece tells how fast this phone makes the
                     voice. Clearly slower than the reading: wait a little
                     at the start so the reading then keeps going. */
                  var per = audio.took ? (audio.took / 1000) / Math.max(0.3, mono.length / rate) : 0;
                  var slow = per / team.length;
                  var restChars = 0;
                  for (var r = idx + 1; r < Math.min(list.length, idx + 5); r++) restChars += list[r].text.length;
                  var secPerChar = buf.duration / Math.max(10, list[idx].text.length);
                  var deficit = slow > 1.05 ? (slow - 1) * restChars * secPerChar : 0;
                  /* At most a few seconds; less when the next sentence is
                     already waiting (a short title waited for it). */
                  startAt = context.currentTime + Math.min(gated ? 0.02 : 5, Math.max(0.02, deficit));
                }
                var src = context.createBufferSource();
                src.buffer = buf;
                src.connect(context.destination);
                var at = Math.max(context.currentTime + 0.02, nextAt, heard ? 0 : startAt);
                try { src.start(at); } catch (_) { src.start(); }
                sources.push(src);
                src.onended = function () { var q = sources.indexOf(src); if (q >= 0) sources.splice(q, 1); };
                heard = true;
                nextAt = at + buf.duration + list[idx].gap;
              }
            }
            step();
          }, function () {
            i += 1;
            feed(i + LOOK);
            step();
          });
        }
        step();
      }).then(function () { return heard || !live(); });
    }).catch(function () { return false; });
  }

  /* Audio bytes (WAV/MP3 from the Luganda voice) to samples. */
  function decode(buf) {
    return new Promise(function (resolve) {
      var done = function (b) {
        try { resolve(b && b.getChannelData ? { samples: b.getChannelData(0), rate: b.sampleRate } : null); } catch (_) { resolve(null); }
      };
      try {
        var r = ac().decodeAudioData(buf.slice(0), done, function () { resolve(null); });
        if (r && typeof r.then === 'function') r.then(done, function () { resolve(null); });
      } catch (_) { resolve(null); }
    });
  }

  root.NalunoVoices = {
    speak: speak,
    decode: decode,
    stop: stop,
    prime: prime,
    resume: resume,
    female: 'Bella',
    male: 'Hugo',
    PACE: PACE,
    GAP: GAP,
    _pieces: pieces,
    _trim: trim,
    _teamSize: teamSize,
    _makers: function () { return makers.length; },
    _own: own,
  };
  if (typeof module === 'object' && module.exports) module.exports = root.NalunoVoices;
})(typeof window !== 'undefined' ? window : globalThis);
