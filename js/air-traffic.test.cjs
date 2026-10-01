const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const path = require('path');

function load(file, name) {
  const src = fs.readFileSync(path.join(__dirname, file), 'utf8');
  const ctx = { window: {}, globalThis: {}, module: { exports: {} }, console: console, Date: Date };
  ctx.globalThis = ctx;
  ctx.window = ctx;
  vm.runInNewContext(src, ctx);
  return ctx[name] || ctx.module.exports || ctx.window[name];
}

const Books = load('lg-books.js', 'NalunoLgBooks');
assert.strictEqual(Books.translate('man', 'en', 'lg'), 'omuntu');
assert.strictEqual(Books.translate('omuntu', 'lg', 'en'), 'man');
assert.strictEqual(Books.translate('hello', 'en', 'lg'), 'Oli otya');
assert.strictEqual(Books.translate('not a real sentence at all', 'en', 'lg'), '');
assert.ok(Books.answer('how do you say water in luganda').indexOf('amazzi') >= 0);
assert.ok(Books.answer('how do you pronounce luganda').indexOf('Pilkington') >= 0);
assert.ok(Books.affix.length > 40);
const aff = Books.answer('what does buga mean');
assert.ok(/enclosing/i.test(aff));

const T = load('traffic.js', 'NalunoTraffic');
const secret = T.record({
  kind: 'message', ok: true, actorUid: 'a', peerUid: 'b',
  actorName: 'Ada', peerName: 'Bo', text: 'secret words', body: 'cipher',
});
assert.ok(!('text' in secret) && !('body' in secret));
assert.strictEqual(JSON.stringify(secret).indexOf('secret'), -1);
const day = T.rangeFor('day', new Date(2026, 9, 1, 15).getTime());
assert.strictEqual(day.to - day.from, 86400000);
const rows = [
  { kind: 'call', ok: true, at: day.from + 1000, seconds: 3600, actorName: 'Ada', peerName: 'Bo', actorUid: 'a', peerUid: 'b' },
  { kind: 'call', ok: false, at: day.from + 2000, seconds: 0, actorName: 'Ada', peerName: 'Bo', actorUid: 'a', peerUid: 'b' },
  { kind: 'video', ok: true, at: day.from + 3000, title: 'Piece' },
  { kind: 'video', ok: false, at: day.from + 4000 },
  { kind: 'message', ok: true, at: day.from + 5000 },
  { kind: 'message', ok: false, at: day.to + 10 },
];
const sum = T.summarize(rows, day.from, day.to);
assert.strictEqual(sum.calls, 2);
assert.strictEqual(sum.callsOk, 1);
assert.strictEqual(sum.callsFail, 1);
assert.strictEqual(sum.talkHours, 1);
assert.strictEqual(sum.videosOk, 1);
assert.strictEqual(sum.videosFail, 1);
assert.strictEqual(sum.messages, 1);
assert.strictEqual(sum.pairs[0].who, 'Ada → Bo');
assert.strictEqual(sum.pairs[0].n, 2);

const calls = fs.readFileSync(path.join(__dirname, 'calls.js'), 'utf8');
assert.ok(calls.indexOf('nalunoScheduleCallFail') > 0);
assert.ok(calls.indexOf('}, 1400)') < 0);
assert.ok(calls.indexOf('nalunoNoteTraffic') > 0);

const auth = fs.readFileSync(path.join(__dirname, 'auth.js'), 'utf8');
assert.ok(auth.indexOf('nalunoBakeCroppedImage') < 0);
assert.ok(auth.indexOf('photoOut.crop') > 0);

const html = fs.readFileSync(path.join(__dirname, '../app/index.html'), 'utf8');
assert.ok(html.indexOf('id="airShareBtn"') > 0);
assert.ok(html.indexOf('id="airAbout"') > 0);
assert.ok(html.indexOf('id="bwriteToLg"') > 0);
assert.ok(html.indexOf('avatarFileInput" accept="image/*') > 0);
assert.ok(html.indexOf('lg-books.js') > 0);

const desk = fs.readFileSync(path.join(__dirname, 'admin-console.js'), 'utf8');
assert.ok(desk.indexOf("tab === 'records'") > 0);
assert.ok(desk.indexOf('pressQuiet') > 0);
assert.ok(desk.indexOf('No message text') > 0);

const rules = fs.readFileSync(path.join(__dirname, '../firestore.rules'), 'utf8');
assert.ok(rules.indexOf('match /traffic/{id}') > 0);
assert.ok(rules.indexOf("hasOnly") > 0);

console.log('air-traffic adversary ok');
