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
  /* 07 Oct: Luganda at the English voices' pace.
     Measured on the real voices (js/lg-suite.json Luganda sentences, six
     English sentences, speech only):
       English  female 3.8, male 4.2 syllables a second;
       Luganda  female 6.85, male 6.7 (Naluno's African voice at its own
                pace) - about 1.7 times as fast.
     Words a minute look alike (about 150-185) only because Luganda words
     are long. A language built of simple syllables (consonant + vowel,
     like Luganda) is heard at the same pace when it says about 1.26 times
     as many syllables a second as English (Pellegrino, Coupe & Marsico,
     Language 87(3), 2011). So Luganda is slowed to 1.26 x the English
     voice's syllable rate: female 4.8, male 5.3 syllables a second (AF_PACE below, checked by
     measuring again: female 4.8, male 5.3).
     Only the length of the sounds changes (the model's own length scale);
     the voice, its pitch and its pronunciation are the same. The person's
     speed setting, if any, applies on top, as it does for English. */
  var AF_PACE = { female: 0.65, male: 0.73 };
  var WORKER_URL = '/js/naluno-voice-worker.js?v=20261007a';
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
    /* 09 Oct: the first sound comes sooner. The voice makes a whole piece
       before any of it is heard, so the opening piece is kept short: the
       first sentence is cut at its first comma, or else after about eight
       words, when it is longer than that. The voice and its speed are the
       same; only where the first breath falls changes. */
    if (out.length) {
      var t0 = out[0].text;
      if (t0.length > 60) {
        var cut = -1, gap = GAP.comma;
        var c = t0.indexOf(', ', 18);
        if (c > 0 && c <= 70 && t0.length - c >= 18) cut = c + 1;
        else {
          var words = t0.split(' ');
          if (words.length >= 12) { cut = words.slice(0, 8).join(' ').length; gap = GAP.split; }
        }
        if (cut > 0) out.splice(0, 1, { text: t0.slice(0, cut).trim(), gap: gap }, { text: t0.slice(cut).trim(), gap: out[0].gap });
      }
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
        var afSpeed = (typeof pl.af.speed === 'number' && pl.af.speed > 0) ? pl.af.speed : (AF_PACE[pl.af.female ? 'female' : 'male'] * mult);
        return m.boot().then(function () { m.job(myJob); return m.sayAf(pl.af.phones, pl.af.female, afSpeed, myJob); }).then(function (a) {
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

      /* 09 Oct: until the first sound is out, everything goes to the voice
         that is already loaded. Starting the other makers at the same
         moment (each loads its own copy of the voice) slowed the first
         sound; they start once it is playing. */
      function feed(upto) {
        while (sent < list.length && sent <= upto) {
          var m = heard ? team[sent % team.length] : first;
          results[sent] = sayOn(m, list[sent]);
          sent += 1;
        }
      }
      if (typeof opts.onready === 'function') opts.onready();
      var heard = false;
      feed(1);
      var context = ac();
      var nextAt = 0;
      var sources = [];
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
              /* 09 Oct: only a very short title waits, and not for long. */
              if (secs >= 1.6) return a0;
              gated = true;
              return Promise.race([
                results[1].then(function () { return a0; }, function () { return a0; }),
                new Promise(function (r) { setTimeout(function () { r(a0); }, 2500); }),
              ]);
            });
          }
          gate.then(function (audio) {
            if (!live()) return finish();
            i += 1;
            feed(heard ? i + LOOK : i + 1);
            var samples = audio && audio.samples;
            if (samples && samples.length) {
              var rate = audio.rate || 24000;
              var mono = samples instanceof Float32Array ? samples : new Float32Array(samples);
              if (!audio.native && root.NalunoVoiceMaster && typeof root.NalunoVoiceMaster.master === 'function') {
                try { mono = root.NalunoVoiceMaster.master(mono, rate, male) || mono; } catch (_) {}
              }
              var clip = trim(mono, rate);
              /* 07 Oct: every voice (English, Luganda, Sunbird) gets the
                 same finishing: clear and equally loud, never clipped. */
              if (clip.length && root.NalunoVoiceMaster && typeof root.NalunoVoiceMaster.finish === 'function') {
                try { clip = root.NalunoVoiceMaster.finish(clip, rate) || clip; } catch (_) {}
              }
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
                  startAt = context.currentTime + Math.min(gated ? 0.02 : 1.5, Math.max(0.02, deficit));
                }
                var src = context.createBufferSource();
                src.buffer = buf;
                src.connect(context.destination);
                var at = Math.max(context.currentTime + 0.02, nextAt, heard ? 0 : startAt);
                try { src.start(at); } catch (_) { src.start(); }
                sources.push(src);
                src.onended = function () { var q = sources.indexOf(src); if (q >= 0) sources.splice(q, 1); };
                var wasHeard = heard;
                heard = true;
                nextAt = at + buf.duration + list[idx].gap;
                /* The first sound is out: now the rest of the team helps. */
                if (!wasHeard) feed(i + LOOK);
              }
            }
            step();
          }, function () {
            i += 1;
            feed(heard ? i + LOOK : i + 1);
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

  /* 09 Oct: get the voice ready before Listen is tapped (a written
     Broadcast is open, a finger is on Listen). Only when its files are
     already on the phone, or the person is looking at something to read,
     so nobody downloads a voice they will not use. */
  var warming = null;
  function warm(force) {
    if (warming) return warming;
    var go = function () {
      warming = maker(0).boot().catch(function () { warming = null; return false; });
      return warming;
    };
    if (force) return go();
    try {
      if (!root.caches || !root.caches.open) return Promise.resolve(false);
      return root.caches.open('naluno-voices').then(function (c) {
        return c.match(new URL('/voices/kitten/model.onnx', root.location.origin).href);
      }).then(function (hit) { return hit ? go() : false; }, function () { return false; });
    } catch (_) { return Promise.resolve(false); }
  }

  root.NalunoVoices = {
    speak: speak,
    warm: warm,
    decode: decode,
    stop: stop,
    prime: prime,
    resume: resume,
    female: 'Bella',
    male: 'Hugo',
    PACE: PACE,
    AF_PACE: AF_PACE,
    GAP: GAP,
    _pieces: pieces,
    _trim: trim,
    _teamSize: teamSize,
    _makers: function () { return makers.length; },
    _own: own,
  };
  if (typeof module === 'object' && module.exports) module.exports = root.NalunoVoices;
})(typeof window !== 'undefined' ? window : globalThis);
