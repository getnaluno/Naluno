/* 07 Oct (a): Luganda read at the English voices' pace; every voice
   mastered the same way (clear, equally loud, never clipped). The voices
   themselves are not changed: same pitch, same sounds. */
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const M = require('./naluno-voice-master.js');
const voices = read('js/naluno-voices.js');
const af = read('js/naluno-af-engine.js');

const db = (x) => 20 * Math.log10(x);
/* A voice-like test signal: a 150 Hz tone with harmonics, in syllables with
   gaps, plus a quiet hiss. */
function speechish(rate, amp, secs) {
  const n = Math.round(rate * secs), s = new Float32Array(n);
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 - 0.5; };
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    const syl = Math.max(0, Math.sin(Math.PI * t * 4.5)) ** 2;
    const tone = Math.sin(2 * Math.PI * 150 * t) + 0.5 * Math.sin(2 * Math.PI * 300 * t) + 0.3 * Math.sin(2 * Math.PI * 2900 * t);
    s[i] = amp * (syl * tone / 1.8 + 0.002 * rnd());
  }
  return s;
}
function f0(s, rate) {
  const W = Math.round(rate * 0.04); let best = 0, lag = 0;
  for (let k = Math.floor(rate / 400); k <= Math.floor(rate / 70); k++) {
    let acc = 0; for (let i = 0; i < W; i++) acc += s[i] * s[i + k];
    if (acc > best) { best = acc; lag = k; }
  }
  return lag ? rate / lag : 0;
}

/* 1. Every voice ends at the same speech loudness, under the ceiling. */
for (const rate of [24000, 22050]) {
  for (const amp of [0.25, 0.5, 0.95]) {
    const x = speechish(rate, amp, 2);
    const y = M.finish(x, rate);
    assert.strictEqual(y.length, x.length, 'same length: no speed change');
    const lvl = db(M.speechLevel(y, rate));
    assert.ok(Math.abs(lvl - -16) < 1.2, rate + ' Hz, input ' + amp + ': speech level ' + lvl.toFixed(1) + ' dB');
    let pk = 0; for (const v of y) pk = Math.max(pk, Math.abs(v));
    assert.ok(pk <= M.FINISH.ceiling + 1e-6, 'never above the ceiling: ' + pk.toFixed(3));
    /* Same pitch: the 150 Hz tone still crosses zero as often. */
    const a = f0(x.subarray(Math.round(rate * 0.08)), rate), b = f0(y.subarray(Math.round(rate * 0.08)), rate);
    assert.ok(a > 0 && Math.abs(a - b) < 2, 'pitch unchanged (' + a.toFixed(1) + ' vs ' + b.toFixed(1) + ' Hz)');
  }
}
/* 2. Quiet input is not dragged up out of the noise; silence stays silent. */
{
  const x = speechish(24000, 0.005, 1);
  const y = M.finish(x, 24000);
  assert.ok(M.speechLevel(y, 24000) / M.speechLevel(x, 24000) <= M.FINISH.maxGain * 1.05, 'at most +12 dB');
  const z = M.finish(new Float32Array(24000), 24000);
  assert.ok(z.every((v) => v === 0), 'silence stays silent');
  assert.strictEqual(M.finish(new Float32Array(10), 24000).length, 10, 'tiny pieces pass through');
}
/* 3. The settings, in plain numbers. */
assert.ok(Math.abs(db(M.FINISH.level) - -16) < 0.01 && Math.abs(db(M.FINISH.ceiling) - -0.5) < 0.01 && Math.abs(db(M.FINISH.maxGain) - 12) < 0.01);
assert.ok(M.FINISH.presenceDb <= 3 && M.FINISH.lowCutHz <= 80, 'gentle: the voices are not re-coloured');

/* 4. Every voice goes through it, after the existing steps. */
assert.ok(/var clip = trim\(mono, rate\);\s*\/\*[\s\S]*?\*\/\s*if \(clip\.length && root\.NalunoVoiceMaster && typeof root\.NalunoVoiceMaster\.finish === 'function'\) \{\s*try \{ clip = root\.NalunoVoiceMaster\.finish\(clip, rate\) \|\| clip; \} catch \(_\) \{\}/.test(voices), 'finish runs for English, Luganda and Sunbird alike');
assert.ok(voices.includes("if (!audio.native && root.NalunoVoiceMaster && typeof root.NalunoVoiceMaster.master === 'function')"), 'the English voices keep their existing master step');

/* 5. Luganda pace. */
assert.ok(voices.includes('var AF_PACE = { female: 0.65, male: 0.73 };'), 'measured pace for the African voice');
assert.ok(voices.includes("var afSpeed = (typeof pl.af.speed === 'number' && pl.af.speed > 0) ? pl.af.speed : (AF_PACE[pl.af.female ? 'female' : 'male'] * mult);"), 'used, with the person\'s speed setting on top');
assert.ok(voices.includes('m.sayAf(pl.af.phones, pl.af.female, afSpeed, myJob)'), 'sent to the voice');
assert.ok(af.includes("opts.speed > 0.35 && opts.speed < 1.6"), 'a slower setting no longer snaps back to full speed');
assert.ok(af.includes("(sc.length || 1.05) / speed"), 'pace is the model\'s own length scale (the voice is not resampled)');
assert.ok(/var PACE = \{ Bella: 1\.42, Hugo: 0\.89 \};/.test(voices), 'the English voices\' pace is unchanged');
assert.ok(/"scales": \{"noise": 0\.6, "length": 1\.05, "noise_w": 0\.7\}|"length": 1\.05/.test(read('voices/af/sw.json')), 'the African voice file is unchanged');

/* 6. Stamps, so phones get the new files. */
const html = read('app/index.html');
assert.ok(/naluno-voice-master\.js\?v=2026100[7-9][a-z]/.test(html) && /naluno-voices\.js\?v=2026100[7-9][a-z]/.test(html), 'app stamps');
assert.ok(/naluno-voice-worker\.js\?v=20261007a/.test(voices) && /naluno-af-engine\.js\?v=20261007a/.test(read('js/naluno-voice-worker.js')), 'worker stamps');
assert.ok(/APP_BUILD = '(?:20261007[a-z]|2026100[89][a-z]|202610[1-3][0-9][a-z])'/.test(read('sw.js')), 'service worker');
console.log('fixes-1007a tests passed');
