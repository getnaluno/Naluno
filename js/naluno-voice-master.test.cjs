const assert = require('assert');
const Master = require('./naluno-voice-master.js');
const Ear = require('./lg-ear.js');

const rate = 24000;
const raw = new Float32Array(rate);
for (let i = 0; i < raw.length; i++) raw[i] = Math.sin((2 * Math.PI * 180 * i) / rate) * 0.4 + 0.2;
const female = Master.master(raw, rate, false);
const male = Master.master(raw, rate, true);
assert.strictEqual(female.length, raw.length);
assert.strictEqual(male.length, raw.length);
assert.ok(Math.abs(female[0]) < 0.02);
assert.ok(Math.abs(female[female.length - 1]) < 0.02);
assert.ok(Math.abs(male[0]) < 0.02);
let peak = 0;
let nan = false;
for (let i = 0; i < male.length; i++) {
  if (male[i] !== male[i]) nan = true;
  const a = Math.abs(male[i]);
  if (a > peak) peak = a;
}
assert.strictEqual(nan, false);
assert.ok(peak <= 0.93);
let diff = 0;
for (let i = 1000; i < 2000; i++) diff += Math.abs(male[i] - female[i]);
assert.ok(diff > 1);

Ear.ingest([
  { text: 'Oli otya', audio: 'data:audio/wav,line' },
  { text: 'Weebale', audio: 'data:audio/wav,thanks' },
  { text: 'nnyo', audio: 'data:audio/wav,very' },
]);
const whole = Ear.plan('Oli otya!');
assert.strictEqual(whole.kind, 'line');
assert.strictEqual(whole.clips.length, 1);
const joined = Ear.plan('Weebale nnyo');
assert.strictEqual(joined.kind, 'words');
assert.strictEqual(joined.clips[0], 'data:audio/wav,thanks');
assert.strictEqual(joined.clips[1], 'data:audio/wav,very');
assert.strictEqual(Ear.plan('Katonda'), null);

const fs = require('fs');
const voices = fs.readFileSync(__dirname + '/naluno-voices.js', 'utf8');
assert.ok(voices.indexOf('var speed = typeof opts.speed === \'number\' ? opts.speed : 1.25;') > 0);
assert.ok(voices.indexOf("var voice = 'Bella';") > 0);
assert.ok(voices.indexOf('0.88') < 0);
const css = fs.readFileSync(__dirname + '/../css/app.css', 'utf8');
assert.ok(css.indexOf('.air-make-live') > 0);
assert.ok(css.indexOf('font-size: 14.5px') > 0);
assert.ok(css.indexOf('min-height:26vh') < 0);
assert.ok(css.indexOf('-webkit-line-clamp: 4') > 0);

console.log('voice master and ear ok');
