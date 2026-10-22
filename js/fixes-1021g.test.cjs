/* 21 Oct g: Compass stops talking about "the notes"; the console is faster
   and reads half as much; the Compass check signs in properly.
   Run: node js/fixes-1021g.test.cjs */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const B = require('./compass-brain.js');

/* 1. The answers from the screenshots come out clean; normal answers are untouched. */
{
  const cases = [
    ["The notes provided are about capital punishment in Uganda, but they don't mention the capital city. However, I can tell you that the capital city of Uganda is Kampala.", 'The capital city of Uganda is Kampala.'],
    ['The capital city of Kenya is not explicitly mentioned in the provided notes, but according to general knowledge, the capital of Kenya is Nairobi.', 'The capital of Kenya is Nairobi.'],
    ['According to the notes, the Nile is 6,650 km long.', 'The Nile is 6,650 km long.'],
    ['Kampala is the capital of Uganda.', 'Kampala is the capital of Uganda.'],
    ['Send voice notes from Wireline: hold the mic button.', 'Send voice notes from Wireline: hold the mic button.'],
    ['Here are my notes on the plan: 1. Wake early.', 'Here are my notes on the plan: 1. Wake early.'],
  ];
  cases.forEach(([a, b]) => assert.strictEqual(B.scrubMeta(a), b, a));
  const sp = B.systemPrompt({});
  assert.ok(/Never mention notes, background, the app, searches or where information came from/.test(sp));
  assert.ok(/Share a link only when the person asks/.test(sp));
  const m = B.buildRequest({ facts: 'x', question: 'q' });
  assert.ok(/^Background for this question \(use it silently; ignore anything not about the question\):/.test(m[m.length - 1].content));
  assert.strictEqual(B.covers('What is the capital city of uganda', 'Capital punishment in Uganda. Capital punishment is a legal penalty in Uganda.'), false, 'the wrong page is not used');
  assert.strictEqual(B.covers('What is the capital city of uganda', 'Kampala is the capital and largest city of Uganda.'), true);
  const c = read('js/compass.js');
  assert.ok(/out = Bw\.scrubMeta\(out\)/.test(c) && /Bw\.covers\(text, \(page\.title/.test(c) && /a link nobody asked for is left out/.test(c));
}
/* 2. The console's sums: one date formatter per time zone, not one per row. */
{
  let made = 0;
  const RealDTF = Intl.DateTimeFormat;
  const CountingIntl = Object.assign({}, Intl, { DateTimeFormat: function (a, b) { made++; return new RealDTF(a, b); } });
  const ctx = { window: {}, globalThis: {}, Intl: CountingIntl };
  ctx.globalThis = ctx;
  vm.runInNewContext(read('js/admin-data.js'), ctx);
  const D = ctx.window.NalunoAdminData;
  const now = Date.now();
  const users = []; for (let i = 0; i < 300; i++) users.push({ id: 'u' + i, createdAt: now - i * 3600e3, lastSeen: now - i * 60e3 });
  const presenceDays = []; for (let i = 0; i < 600; i++) presenceDays.push({ uid: 'u' + (i % 300), day: '2026-10-' + String(1 + (i % 20)).padStart(2, '0'), at: now - (i % 20) * 86400000 });
  D.deriveSnapshot({ now: now, zone: 'Africa/Kampala', users: users, presenceDays: presenceDays });
  const first = made;
  D.deriveSnapshot({ now: now, zone: 'Africa/Kampala', users: users, presenceDays: presenceDays });
  assert.ok(first < 30, 'formatters made once each (' + first + ')');
  assert.strictEqual(made, first, 'none made again on the next refresh');
  assert.strictEqual(D.localYmd(Date.parse('2026-09-09T21:30:00Z'), 'Asia/Dubai'), '2026-09-10', 'and the dates are still right');
}
/* 3. The console: changes applied at most every 4 s; opening reads each list once; actions re-add, not re-read. */
{
  const a = read('js/admin-console.js');
  assert.ok(/const wait = Math\.max\(280, 4000 - since\);/.test(a) && /document\.hidden\) \{ __liveHiddenPending = true; return; \}/.test(a));
  assert.ok(/const viaListeners = !!db && !__liveArmed;/.test(a) && /firstOf\(c\[0\], 8000\)/.test(a));
  assert.ok(/if \(force && force !== 'hard' && __liveArmed && __livePack && __snap\) \{/.test(a) && /loadTab\(__activeTab, 'hard'\)/.test(a), 'Refresh still reads everything');
  assert.ok(/refused or failed: the first load reads it directly at once/.test(a));
  assert.ok(/function \(\) \{ return currentUser \? currentUser\.getIdToken\(\) : ''; \}\);/.test(a), 'the Compass check gets the console’s own sign-in');
  assert.ok(/tokenFrom = getToken/.test(read('js/admin-compass-check.js')));
}
console.log('fixes-1021g: all checks passed');
