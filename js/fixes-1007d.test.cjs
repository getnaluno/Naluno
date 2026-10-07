/* 07 Oct d: the rule of Bands (deleted 2 h after the last person leaves,
   on the server, unreadable by rule), Find Naluno history ("Where was I?"),
   and Signals as joined diamonds. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const rules = read('firestore.rules');
const html = read('app/index.html');
const css = read('css/app.css');
const H = 3600000;

/* ---------- 1. The rule of Bands, in the database rules ---------- */
assert.ok(rules.includes('THE RULE OF BANDS'), 'the rule is written down where it is enforced');
assert.ok(rules.includes('it is DELETED: not archived, not\n       hidden for later, not kept anywhere.'), 'deleted, not archived');
assert.ok(rules.includes('function bandClockHonest()'), 'clock rule exists');
assert.ok(rules.includes("allow update: if isSignedIn() && bandClockHonest() && ("), 'every Band update, the creator\'s too, keeps the clock honest');
assert.ok(rules.includes(".hasOnly(['memberUids', 'lastEmptiedAt', 'messageEpoch', 'aliveAt', 'bellAt', 'bellBy'])"), 'members may stamp aliveAt');
assert.ok(rules.includes('allow read: if isSignedIn() && bandOpenNow() && (epochMs() == 0 || msgMs() >= epochMs());'), 'messages unreadable once the two hours ran out');
assert.ok(rules.includes("request.time > bandAliveDeadline(d)") && rules.includes("d.aliveAt + duration.value(2, 'h')"), 'two hours, on the server clock');
assert.ok(rules.includes("|| bandIsDead(bandData())))") || rules.includes('|| bandIsDead(bandData()))'), 'members may delete a finished conversation');
assert.ok(rules.includes("(!('aliveAt' in request.resource.data) || request.resource.data.aliveAt == request.time)"), 'a new Band cannot start with a clock in the future');
assert.ok(rules.includes("&& bandEpochOf(request.resource.data) <= request.time.toMillis() + 600000)"), 'the line never goes past now');
assert.ok(rules.includes("(request.resource.data.ts is timestamp && request.resource.data.ts <= request.time + duration.value(10, 'm'))"), 'no message dated in the future');
assert.ok(rules.includes("|| request.resource.data.tunedInAt == request.time"), 'tuned-in marks are as of now');
// Rules syntax sanity: braces balance, and every function used is defined.
assert.equal((rules.match(/\{/g) || []).length, (rules.match(/\}/g) || []).length, 'rules braces balance');
['bandAliveDeadline', 'bandHasClock', 'bandIsDead', 'bandEpochOf', 'bandClockHonest', 'bandOpenNow'].forEach((f) => {
  assert.ok(rules.includes('function ' + f + '('), f + ' defined');
});

/* The same logic in JS, run against honest writes and against abuse. */
function epochOf(d) {
  if (!('messageEpoch' in d)) return 0;
  const v = d.messageEpoch;
  if (v && v.ts != null) return v.ts;
  return typeof v === 'number' ? Math.trunc(v) : 0;
}
const TS = (ms) => ({ ts: ms });
function hasClock(d) { return 'aliveAt' in d && d.aliveAt && d.aliveAt.ts != null; }
function isDead(d, now) { return hasClock(d) && now > d.aliveAt.ts + 2 * H; }
function changed(before, after) {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...keys].filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]));
}
function clockHonest(before, after, now) {
  const keys = changed(before, after);
  const has = (k) => keys.includes(k);
  if (has('aliveAt') && !(after.aliveAt && after.aliveAt.ts === now)) return false;
  if (has('messageEpoch') && !(epochOf(after) >= epochOf(before) && epochOf(after) <= now + 600000)) return false;
  if (has('aliveAt') && isDead(before, now) && !(after.messageEpoch && after.messageEpoch.ts === now)) return false;
  return true;
}
function canRead(band, msgTs, now) {
  if (isDead(band, now)) return false;
  const e = epochOf(band);
  return e === 0 || msgTs >= e;
}
const T = 1_800_000_000_000;
// Honest: heartbeat while alive.
let band = { aliveAt: TS(T - 10 * 60000) };
assert.ok(clockHonest(band, { ...band, aliveAt: TS(T) }, T), 'heartbeat stamps now');
// Abuse: a clock in the future to keep a conversation forever.
assert.ok(!clockHonest(band, { ...band, aliveAt: TS(T + 9 * H) }, T), 'no future clock');
// Abuse: drop the clock to fall back to old rules.
assert.ok(!clockHonest(band, {}, T), 'the clock cannot be removed');
// 3 a.m. talk, 9 a.m. now: nobody can read it.
band = { aliveAt: TS(T - 6 * H + 5 * 60000) };
assert.equal(canRead(band, T - 6 * H, T), false, 'the 3 a.m. conversation cannot be read at 9 a.m.');
assert.equal(canRead(band, T - 6 * H, T - 5 * H), true, 'it could be read while people were there');
// Abuse: wake the Band without drawing the line, to read the old talk again.
assert.ok(!clockHonest(band, { ...band, aliveAt: TS(T) }, T), 'waking a finished Band without a fresh page is refused');
// Honest: wake it with the line at now. The old talk stays unreadable.
const woke = { ...band, aliveAt: TS(T), messageEpoch: TS(T) };
assert.ok(clockHonest(band, woke, T), 'waking with a fresh page is allowed');
assert.equal(canRead(woke, T - 6 * H, T + 1000), false, 'after waking, the old conversation is still gone');
assert.equal(canRead(woke, T + 500, T + 1000), true, 'the new conversation is readable');
// Abuse: move the line back.
assert.ok(!clockHonest(woke, { ...woke, messageEpoch: 0 }, T + 1000), 'the line never moves back');
assert.ok(!clockHonest(woke, { ...woke, messageEpoch: null }, T + 1000), 'the line cannot be cleared');
// Abuse: push the line far into the future to brick the Band for good.
assert.ok(!clockHonest(woke, { ...woke, messageEpoch: 9e15 }, T + 1000), 'the line cannot be pushed past now');
// Old phones write the line as a number: still only forward.
assert.ok(clockHonest(woke, { ...woke, messageEpoch: T + 5000 }, T + 6000));
assert.ok(!clockHonest(woke, { ...woke, messageEpoch: T - 5000 }, T + 6000));
// Older Band without a clock: the old epoch rule still applies; the first clock stamp needs no line.
assert.ok(clockHonest({}, { aliveAt: TS(T) }, T));
assert.equal(canRead({}, T - 9 * H, T), true, 'older Bands are swept by the server instead');

/* ---------- 2. The Band room, client side ---------- */
const room = read('js/band-room.js');
assert.ok(room.includes('function bandMarkAlive(bandRef, b, force)'), 'phones keep the clock');
assert.ok(room.includes("bandRef.set({ aliveAt: stamp(), messageEpoch: stamp(), lastEmptiedAt: null }, { merge:true })"), 'fresh page draws the line in the same write');
assert.ok(room.includes("if(denied && nearEnd && !b._freshTried){ b._freshTried = Date.now(); return freshPage(); }"), 'server says the time ran out: fresh page, once');
assert.ok(room.includes("b._aliveWroteAt = Date.now();\n      throw e;"), 'any other refusal backs off instead of looping');
assert.ok(room.indexOf('/* The server drew the line: start the page here too. */') > room.indexOf("return bandRef.set({ aliveAt: stamp(), messageEpoch: stamp(), lastEmptiedAt: null }"), 'the local page is cleared only after the server agreed');
assert.ok(room.includes("'Authorization': 'Bearer ' + token"), 'the sweep ask is signed in');
assert.ok(room.includes("bandMarkAlive(fbDb.collection('bands').doc(b.firestoreId), b, true);\n      startBandPresenceHeartbeat();"), 'tuning in wakes the Band');
assert.ok(room.includes("// Leaving: the two hours count from now.\n    bandMarkAlive(bandRef, b, true);"), 'stepping out stamps the leave');
assert.ok(room.includes("bandMarkAlive(fbDb.collection('bands').doc(b.firestoreId), b, false);\n  };"), 'heartbeat keeps the clock current');
assert.ok(room.includes("b._msgDead = bandDead(b);") && room.includes('if(b._msgDead){'), 'a finished conversation is not asked for');
assert.ok(room.includes("fetch('https://naluno-economy.naluno.workers.dev/v1/bands/sweep'"), 'asks the server to delete now');
assert.ok(read('js/band-list.js').includes('nalunoBandAskServerSweep(row)'), 'opening Naluno asks the server about finished Bands');
// Pure helpers, run.
function grab(src, name) {
  const i = src.indexOf('function ' + name + '(');
  assert.ok(i >= 0, name);
  let depth = 0, j = src.indexOf('{', i);
  for (let k = j; k < src.length; k++) {
    if (src[k] === '{') depth++;
    if (src[k] === '}') { depth--; if (depth === 0) return src.slice(i, k + 1); }
  }
  throw new Error('no end ' + name);
}
const ctx = { BAND_SETTLE_MS: 2 * H, Date, Number, isFinite, Math };
vm.createContext(ctx);
vm.runInContext(['bandAliveMs', 'bandDead', 'bandEmptiedMs', 'bandSettleElapsed', 'bandNeedsFreshPage'].map((n) => grab(room, n)).join('\n'), ctx);
const now = Date.now();
assert.equal(ctx.bandDead({ aliveAt: now - 6 * H }), true, 'six hours after: finished');
assert.equal(ctx.bandDead({ aliveAt: now - H }), false, 'one hour after: still on');
assert.equal(ctx.bandDead({ aliveAt: { toMillis: () => now - 3 * H } }), true, 'reads a database time');
assert.equal(ctx.bandDead({}), false);
assert.equal(ctx.bandNeedsFreshPage({ aliveAt: now - 3 * H }), true);
assert.equal(ctx.bandNeedsFreshPage({ aliveAt: now - 60000 }), false);
assert.equal(ctx.bandNeedsFreshPage({ lastEmptiedAt: now - 3 * H }), true, 'older Band: emptied over two hours ago');
assert.equal(ctx.bandNeedsFreshPage({ _staleHidden: true }), true);
assert.equal(ctx.bandNeedsFreshPage({}), false);
// Words people see.
assert.ok(html.includes('The rule of Bands:') && html.includes('Not archived, not stored: nobody can get it back, not even Naluno.'), 'the rule, in the app');
assert.ok(!html.includes('Messages clear 2 hours after the last person leaves.'), 'old wording gone');
assert.ok(read('privacy.html').includes('Not archived; it cannot be recovered by anyone, Naluno included.'));

/* ---------- 3. The server sweep and the media worker ---------- */
const sw = read('signal-worker-index.js');
assert.ok(sw.includes("url.pathname === '/b/drop'") && sw.includes("request.headers.get('X-Naluno-Sweep')"), 'media worker drops Band clips with the shared key');
assert.ok(sw.indexOf("url.pathname === '/b/drop'") < sw.indexOf("const authHeader = request.headers.get('Authorization')"), 'before sign-in check (server to server)');
assert.ok(/if \(!same\) return json\(\{ error: 'Forbidden' \}, 403, origin\);/.test(sw), 'no key, no delete');
assert.ok(sw.includes("!/^u\\/[A-Za-z0-9_-]{6,128}\\/[A-Za-z0-9._-]{1,120}$/.test(key)"), 'only per-person upload keys');
const bundle = read('naluno-economy-worker.js');
assert.ok(bundle.includes('var VERSION = "2.12.0-bands";') && bundle.includes('async scheduled(event, env, ctx)') && bundle.includes('"/v1/bands/sweep"'), 'the one-file worker carries the sweep');
assert.ok(read('workers/economy/wrangler.toml').includes('crons = ["*/10 * * * *"]'), 'every 10 minutes');

/* ---------- 4. Find Naluno: Where was I? ---------- */
assert.ok(rules.includes('match /users/{uid}/beaconTrail/{id}'), 'trail rules');
const trailBlock = rules.slice(rules.indexOf('match /users/{uid}/beaconTrail/{id}'), rules.indexOf('match /users/{uid}/beaconTrail/{id}') + 900);
assert.ok(trailBlock.includes('allow read, delete: if isOwner(uid);') && !trailBlock.includes('isOperator'), 'only you can read your trail, not the desk');
assert.ok(trailBlock.includes('allow update: if false;'), 'points are never edited');
assert.ok(html.includes('<script src="/js/find-history.js?v=20261007d"></script>'), 'loaded');
assert.ok(read('sw.js').includes("'/js/find-history.js'"), 'works offline');
assert.ok(read('js/beacon.js').includes("nalunoTrailNote(payload)") && read('js/beacon.js').includes('nalunoTrailNote(mine)'), 'pings feed the trail');
assert.ok(read('BeaconFindService.java').includes('/beaconTrail/') && read('BeaconFindService.java').includes('currentDocument.exists=false'), 'the Android service keeps the trail too');

const store = {};
const writes = [];
const doc = (p) => ({ set: (row) => { writes.push({ p, row }); return Promise.resolve(); } });
const fakeDb = { collection: (a) => ({ doc: (b) => ({ collection: (c) => ({ doc: (d) => doc([a, b, c, d].join('/')) }) }) }) };
const win = {
  localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } },
  document: { getElementById: () => null, addEventListener() {}, querySelector: () => null },
  fbDb: fakeDb, currentUser: { uid: 'me1' }, nalunoDeviceId: () => 'd-phone1',
  Date, Math, Number, String, JSON, isFinite, Promise, console, setTimeout,
};
win.window = win;
vm.createContext(win);
vm.runInContext(read('js/find-history.js'), win);
const FH = win.NalunoFindHistory;
assert.ok(FH && typeof FH.note === 'function');
// Trail point rules.
assert.equal(FH._trailWants(null, 0.3, 32.5, 1000), true, 'first point');
assert.equal(FH._trailWants({ lat: 0.3, lng: 32.5, ts: 1000 }, 0.3001, 32.5, 1000 + 60000), false, 'a few metres, a minute later: no');
assert.equal(FH._trailWants({ lat: 0.3, lng: 32.5, ts: 1000 }, 0.3012, 32.5, 1000 + 60000), true, 'about 130 m: yes');
assert.equal(FH._trailWants({ lat: 0.3, lng: 32.5, ts: 1000 }, 0.3, 32.5, 1000 + 31 * 60000), true, 'still for half an hour: yes');
assert.equal(FH._trailWants(null, 91, 32.5, 1000), false, 'nonsense position: no');
// Writing: owner path, deterministic id, throttled.
FH.note({ lat: 0.3136, lng: 32.5811, ts: 1_780_000_000_000, accuracy: 12.4, label: 'Android' });
FH.note({ lat: 0.3137, lng: 32.5811, ts: 1_780_000_060_000, accuracy: 12.4, label: 'Android' });
assert.equal(writes.length, 1, 'second ping a few metres away is not a new point');
assert.equal(writes[0].p, 'users/me1/beaconTrail/d-phone1_1780000000000', 'same id as the Android service');
assert.deepEqual(Object.keys(writes[0].row).sort(), ['accuracy', 'deviceId', 'label', 'lat', 'lng', 'ts'], 'only allowed fields');
// Periods, in local time.
const aug = FH._periodFor({ mode: 'month', year: 2026, month: 7 });
assert.equal(aug.from, new Date(2026, 7, 1).getTime());
assert.equal(aug.to, new Date(2026, 8, 1).getTime());
assert.equal(aug.label, 'August 2026');
const day = FH._periodFor({ mode: 'day', day: '2026-08-14' });
assert.equal(day.to - day.from >= 23 * H && day.to - day.from <= 25 * H, true, 'one day');
const yr = FH._periodFor({ mode: 'year', year: 2025 });
assert.equal(yr.from, new Date(2025, 0, 1).getTime());
const rng = FH._periodFor({ mode: 'range', from: '2026-08-20T18:00', to: '2026-08-02T08:00' });
assert.ok(rng.from < rng.to, 'a backwards span is turned around');
const eve = FH._periodFor({ mode: 'month', year: 2026, month: 7, timeFrom: '18:00', timeTo: '22:00' });
assert.ok(eve.tod && eve.tod.from === 1080 && eve.tod.to === 1320 && /18:00 to 22:00/.test(eve.label), 'August, evenings');
assert.equal(FH._inTimeOfDay(new Date(2026, 7, 3, 19, 30).getTime(), eve.tod), true);
assert.equal(FH._inTimeOfDay(new Date(2026, 7, 3, 9, 30).getTime(), eve.tod), false);
assert.equal(FH._inTimeOfDay(new Date(2026, 7, 3, 1, 0).getTime(), { from: 1320, to: 120 }), true, 'overnight window');
assert.equal(FH._periodFor({ mode: 'day', day: '' }), null);
// Stops: points close together are one stop.
const pts = [
  { lat: 0.3136, lng: 32.5811, ts: 1, deviceId: 'd' }, { lat: 0.3137, lng: 32.5812, ts: 2, deviceId: 'd' },
  { lat: 0.3300, lng: 32.6000, ts: 3, deviceId: 'd' }, { lat: 0.3301, lng: 32.6001, ts: 4, deviceId: 'd' },
];
const stops = FH._stopsOf(pts);
assert.equal(stops.length, 2);
assert.equal(stops[0].from, 1); assert.equal(stops[0].to, 2);
// UI placement: inside Find Naluno, under the Ping button, not on top.
const fhSrc = read('js/find-history.js');
assert.ok(fhSrc.includes("anchor.parentNode.insertBefore(box, anchor.nextSibling)") && fhSrc.includes("$('findNalunoPingBtn')"), 'chip sits below, inside Find Naluno');
assert.ok(fhSrc.includes("[['day','A day'],['month','A month'],['year','A year'],['range','Between']]"), 'day, month, year or any span');
assert.ok(fhSrc.includes("window.confirm('Delete your whole Find Naluno history?"), 'you can delete it');

/* ---------- 5. Signals as joined diamonds ---------- */
const sui = read('js/signal-ui.js');
const spub = read('js/signal-public.js');
[sui, spub].forEach((src) => {
  assert.ok(!/signalTileCaption\([^)]*\)\s*\)?\s*\n?\s*\+ '<\/div><\/div><\/div>'/.test(src), 'caption is not inside the diamond');
});
assert.equal((sui.match(/\+ '<\/div><\/div>'\n\s+\+ signalTileCaption\(/g) || []).length, 3, 'three Signal tile builders put the name under the diamond');
assert.ok(/\+ '<\/div><\/div>'\n\s+\+ \(\(typeof signalTileCaption/.test(spub), 'public Signals too');
assert.ok(css.includes('Signals as diamonds, joined together'));
assert.ok(css.includes('clip-path:polygon(50% 0, 100% 50%, 50% 100%, 0 50%);'), 'diamond');
assert.ok(css.includes('@property --sigA') && css.includes('@keyframes sigRimTurn{ to{ --sigA:360deg; } }'), 'our colours turn around the rim');
assert.ok(css.includes('#myBcastStrip .signal-tile .signal-window::after{') && css.includes('border-radius:50%; z-index:3;'), 'the ring inside');
assert.ok(css.includes('#myBcastStrip .signal-tile-create .signal-create-mark{ position:absolute; inset:0; z-index:2; }'), 'the + keeps its breathing circle');
assert.ok(css.includes('#myBcastStrip .signal-tile + .signal-tile::before{') && css.includes('@keyframes sigThread'), 'the thread joining them');
assert.ok(css.includes('#myBcastStrip .signal-tile + .signal-tile::after{') && css.includes('@keyframes sigKnot'), 'a knot between each pair');
assert.ok(/prefers-reduced-motion: reduce\)\{\s*#myBcastStrip \.signal-tile \.signal-edge,/.test(css), 'still when motion is reduced');

/* ---------- 6. Stamps ---------- */
['band-room.js', 'band-list.js', 'beacon.js', 'find-history.js', 'onboard.js', 'signal-ui.js', 'signal-public.js', 'pwa.js'].forEach((f) => {
  assert.ok(new RegExp('/js/' + f.replace(/[.-]/g, '\\$&') + '\\?v=20261007d').test(html), f + ' stamp');
});
assert.ok(/\/css\/app\.css\?v=20261007d/.test(html) && /APP_BUILD = '20261007d'/.test(read('sw.js')) && read('sw.js').includes("naluno-shell-v297"), 'css and service worker');
assert.ok(read('js/pwa.js').includes("/sw.js?v=20261007d"));
console.log('fixes-1007d tests passed');
