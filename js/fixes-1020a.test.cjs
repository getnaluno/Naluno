/* 20 Oct a: Screen holds only what the detector clearly finds; skin colour
   never holds; a post the worker could not place is asked about again;
   Signals leave the public list when the desk or a report takes them off;
   account deletion removes the public Signal copies; a half-done upload no
   longer strands a phone on the old page. Run: node js/fixes-1020a.test.cjs */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
function grab(src, name) {
  let i = src.indexOf('async function ' + name + '(');
  if (i < 0) i = src.indexOf('function ' + name + '(');
  assert.ok(i >= 0, 'missing ' + name);
  let d = 0;
  const k = src.indexOf('{', src.indexOf(')', i));
  for (let j = k; j < src.length; j++) {
    if (src[j] === '{') d++;
    else if (src[j] === '}' && --d === 0) return src.slice(i, j + 1);
  }
  throw new Error('unclosed ' + name);
}
const checks = [];
const check = (name, fn) => checks.push([name, fn]);

/* ---------- 1. The phone and the server: one rule, skin never decides ---------- */
check('phone = server on 5,000 random detector readings, and no hold without a detector finding', async () => {
  const box = { console, Math, Number, Array, Object, Float32Array, Promise };
  box.window = box;
  vm.createContext(box);
  vm.runInContext(read('js/nudenet.js'), box);
  const server = await import(path.join(root, 'workers/economy/screen.mjs'));
  let seed = 20261020;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  let holds = 0;
  for (let t = 0; t < 5000; t++) {
    const frames = [];
    const nf = 1 + Math.floor(rnd() * 6);
    for (let f = 0; f < nf; f++) {
      const d = [];
      const k = Math.floor(rnd() * 7);
      for (let j = 0; j < k; j++) {
        const row = [Math.floor(rnd() * 18), Math.round(rnd() * 1000) / 1000];
        if (rnd() < 0.5) row.push(Math.round(rnd() * 1000) / 1000);
        d.push(row);
      }
      frames.push({ d, p: rnd() < 0.15 ? 0.95 : 0 });
    }
    const phone = JSON.parse(JSON.stringify(box.nalunoModDecide(frames)));
    const srv = JSON.parse(JSON.stringify(server.modDecide(frames)));
    assert.deepStrictEqual(phone, srv);
    if (srv.decision === 'hold') {
      holds++;
      assert.ok(srv.reason === 'single-frame' || srv.reason === 'found-on-fabric', 'a hold is always a detector finding: ' + srv.reason);
      /* ... and it is backed by an exposed part at the reject level in the raw readings. */
      const anatomy = [4, 6, 14], breast = 3;
      const hit = frames.some((fr) => fr.d.some((r) => (anatomy.indexOf(r[0]) >= 0 && r[1] >= 0.5) || (r[0] === breast && r[1] >= 0.55)))
        || frames.some((fr) => fr.d.filter((r) => [3, 4, 6, 14].indexOf(r[0]) >= 0 && r[1] >= 0.4).length >= 2);
      assert.ok(hit, 'hold without an exposed part: ' + JSON.stringify(frames));
    }
    assert.notStrictEqual(srv.reason, 'video-player-screenshot');
    assert.notStrictEqual(srv.reason, 'possible-nudity');
    assert.notStrictEqual(srv.reason, 'possible-sexual-act');
  }
  assert.ok(holds > 0, 'the random set reached the hold branch');
});

check('the skin check alone never holds or stops: any shade, any light, any title (phone fallback and server)', async () => {
  const server = await import(path.join(root, 'workers/economy/screen.mjs'));
  const W = 96, H = 96;
  const shades = [[250, 225, 205], [224, 172, 145], [198, 134, 98], [141, 85, 54], [110, 68, 45], [75, 48, 34], [45, 30, 25], [25, 16, 12]];
  for (const c of shades) {
    for (const scene of ['flat', 'face', 'half']) {
      const rgb = server.fillRgb(W, H, (x, y) => {
        if (scene === 'flat') return c;
        if (scene === 'face') { const nx = x / W - 0.5, ny = y / H - 0.45; return nx * nx + ny * ny < 0.08 ? c : [20, 25, 60]; }
        return x < W / 2 ? c : [200, 60, 30];
      });
      for (const title of ['', 'Dance night', 'my nudes']) {
        const j = server.judgeScreenPayload({ v: 3, w: W, h: H, frames: [{ rgb: server.rgbToB64(rgb) }, { rgb: server.rgbToB64(rgb) }] }, { title });
        assert.strictEqual(j.decision, 'allow', c + ' ' + scene + ' ' + title);
        assert.strictEqual(server.listingFromScreen({ trusted: true, hasScreen: true, decision: j.decision }).listed, true);
      }
    }
  }
  /* The phone's fallback (detector did not run): whatever the skin check says. */
  const src = read('js/nudenet.js');
  for (const d of ['block', 'hold', 'allow']) {
    const g = { console: { warn() {}, log() {} }, setTimeout, clearTimeout, Promise, Math, Date, JSON, Object, Array, Uint8Array, Float32Array, Number, String, RegExp, Error };
    g.runNalunoScreen = async () => ({ decision: d, reason: 'screen', score: 90, packed: {} });
    vm.createContext(g);
    vm.runInContext(src, g);
    const v = await g.runNalunoScreen({}, 'xxx', 3);
    assert.strictEqual(v.decision, 'allow', 'skin check said ' + d);
  }
});

/* ---------- 2. The composer and Signals keep only detector holds ---------- */
check('the composer keeps a detector hold and says so; anything else goes out', async () => {
  const comp = read('js/broadcast-composer.js');
  const ctx = { setTimeout, clearTimeout, Promise, Object };
  vm.createContext(ctx);
  vm.runInContext('const NALUNO_SCREEN_WAIT_MS = 50;\n' + grab(comp, 'nalunoStrictVerdict') + '\nthis.v = nalunoStrictVerdict;', ctx);
  for (const r of ['single-frame', 'found-on-fabric']) assert.strictEqual((await ctx.v({ decision: 'hold', engine: 'nudenet', reason: r })).decision, 'hold');
  for (const v of [{ decision: 'hold', engine: 'heuristic', reason: 'heuristic-only' }, { decision: 'hold', engine: 'nudenet', reason: 'possible-nudity' }, { decision: 'unread' }, null]) {
    assert.strictEqual((await ctx.v(v)).decision, 'allow', JSON.stringify(v));
  }
  const paint = grab(comp, 'bcompPaintScreen');
  assert.ok(/a person at Naluno looks at it before it goes on the public feed/.test(paint));
  assert.ok(/if\(screen\.decision === 'block' \|\| screen\.decision === 'hold'\)\{ screen\.decision = 'allow';/.test(comp), 'OriginID\'s skin verdict never holds');
});

check('a Signal part waits only on a detector finding; unread and skin go out', async () => {
  const src = read('js/compass.js');
  const answers = { a: { decision: 'unread' }, b: { decision: 'hold', engine: 'heuristic', reason: 'heuristic-only' }, c: { decision: 'hold', engine: 'nudenet', reason: 'single-frame' }, d: { decision: 'allow', engine: 'nudenet' } };
  const ctx = { Map, Promise, fetch: async () => ({ blob: async () => ({}) }), runNalunoScreen: async (file) => answers[file.k] };
  vm.createContext(ctx);
  vm.runInContext(grab(src, 'nalunoScreenSignalSegments') + '\nthis.s = nalunoScreenSignalSegments;', ctx);
  const segs = ['a', 'b', 'c', 'd'].map((k) => ({ type: 'video', sourceFile: { k } }));
  const out = await ctx.s(segs);
  assert.strictEqual(out.blocked, null);
  assert.deepStrictEqual(segs.map((x) => !!x.held), [false, false, true, false]);
  assert.strictEqual(segs[2].heldReason, 'single-frame');
});

/* ---------- 3. A post the worker could not place is asked about again ---------- */
check('unplaced posts are queued with the detector findings and placed later', async () => {
  const core = read('js/broadcast-core.js');
  const store = {};
  const calls = [];
  let answer = null;
  const ctx = {
    console, Promise, JSON, Date, Number, String, Array, Object, setTimeout: () => 0,
    localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } },
    navigator: { onLine: true },
    currentUser: { uid: 'u1', getIdToken: async () => 'tok' },
    myBroadcasts: [{ id: 'b1', held: true, listed: false }],
    nalunoEconomyUrlBroadcast: () => 'https://w',
    fetch: async (url, init) => { calls.push(JSON.parse(init.body)); return { json: async () => answer() }; },
    addEventListener() {},
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  const body = ['nalunoPlaceBroadcast', 'nalunoPlaceQueueKey', 'nalunoPlaceQueueRead', 'nalunoPlaceQueueWrite', 'nalunoPlaceQueueAdd', 'nalunoPlaceRetry'].map((n) => grab(core, n)).join('\n');
  vm.runInContext('let nalunoPlaceRetryBusy = false;\n' + body + '\nthis.add = nalunoPlaceQueueAdd; this.retry = nalunoPlaceRetry; this.read = nalunoPlaceQueueRead;', ctx);
  const nn = { v: 1, frames: [{ d: [[1, 0.8]], p: 0 }] };
  ctx.add('b1', { packed: { w: 96, h: 96, frames: [{ rgb: 'x'.repeat(40) }], nudenet: nn } });
  ctx.add('b2', null);
  assert.strictEqual(ctx.read().length, 2);
  assert.ok(!/"rgb"/.test(store['nalunoPlaceQueue:u1']), 'only the detector findings are kept, not the pictures');
  answer = () => ({ ok: false, error: 'worker busy' });
  assert.strictEqual(await ctx.retry(), 0);
  assert.strictEqual(ctx.read().length, 2, 'still waiting');
  assert.deepStrictEqual(calls.find((c) => c.broadcast_id === 'b1').screen.nudenet, nn, 'the findings are sent again (the worker judges, not the phone)');
  assert.strictEqual(calls.find((c) => c.broadcast_id === 'b2').screen, null);
  calls.length = 0;
  answer = () => (calls[calls.length - 1].broadcast_id === 'b1' ? { ok: true, wrote: true, listed: true, held: false } : { ok: false, error: 'missing' });
  assert.strictEqual(await ctx.retry(), 1);
  assert.strictEqual(ctx.read().length, 0, 'placed, and a gone one dropped');
  assert.strictEqual(ctx.myBroadcasts[0].listed, true);
  assert.ok(/nalunoPlaceRetrySoon\(5000\)/.test(core) && /addEventListener\('online'/.test(core), 'asked again at the next start and when back online');
});

/* ---------- 4. Signals off the public list ---------- */
check('desk remove and release set feedUntil; a report takes the public copy off the list', () => {
  const adm = read('js/admin-console.js').replace(/\n  /g, '\n');
  const f = new Function(grab(adm, 'signalReleasePatch') + 'return signalReleasePatch;')();
  const now = 1.8e12;
  let r = f({ audience: 'public', expiresAt: now + 3600e3 }, { audience: 'public', expiresAt: now + 3600e3 }, now, 'op');
  assert.strictEqual(r.pub.public, true); assert.strictEqual(r.pub.feedUntil, now + 3600e3);
  r = f({ audience: 'connections', expiresAt: now + 3600e3 }, {}, now, 'op');
  assert.strictEqual(r.pub.public, false); assert.strictEqual(r.pub.feedUntil, 0);
  r = f({ audience: 'public', expiresAt: now - 1 }, {}, now, 'op');
  assert.strictEqual(r.pub.feedUntil, 0, 'its 24 hours are over');
  assert.ok(!('feedUntil' in r.user), 'the person\'s own copy is not given fields the rules refuse');
  assert.ok(/const pubPatch = Object\.assign\(\{\}, userPatch, \{ public: false, feedUntil: 0 \}\);/.test(adm));
  const h = read('workers/economy/handler.mjs');
  assert.ok(/"\/signals\/" \+ encodeURIComponent\(id\), Object\.assign\(\{\}, patch, \{ public: false, feedUntil: 0 \}\)\)/.test(h));
  /* The rule the list uses: a copy is listable only while feedUntil is ahead. */
  assert.ok(/allow list: if isOperator\(\)\s*\|\| \(isSignedIn\(\) && resource\.data\.feedUntil > request\.time\.toMillis\(\)\);/.test(read('firestore.rules')));
});

check('account deletion removes each public Signal copy by id, then the person\'s own', async () => {
  const auth = read('js/auth.js');
  const deleted = [];
  const pub = { s1: { uid: 'me' }, s2: { uid: 'me' }, s3: { uid: 'someone' } };
  const mine = ['s1', 's2', 's3', 's4'];
  const ref = (p) => ({ delete: async () => { deleted.push(p); } });
  const db = {
    collection: (c) => {
      if (c === 'broadcasts') return { where: () => ({ limit: () => ({ get: async () => ({ docs: [] }) }) }) };
      if (c === 'signals') return {
        where: () => ({ limit: () => ({ get: async () => { throw Object.assign(new Error('refused'), { code: 'permission-denied' }); } }) }),
        doc: (id) => ({ get: async () => (pub[id] ? { exists: true, data: () => pub[id], ref: ref('signals/' + id) } : { exists: false }) }),
      };
      if (c === 'users') return { doc: () => ({ collection: () => ({ limit: () => ({ get: async () => ({ docs: mine.map((id) => ({ id, ref: ref('users/me/signal/' + id) })) }) }) }) }) };
      throw new Error(c);
    },
  };
  const ctx = { fbDb: db, currentUser: { uid: 'me', getIdToken: async () => 't' }, Date, Promise, String, Number, Array, fetch: async () => ({ ok: true, json: async () => ({}) }) };
  vm.createContext(ctx);
  vm.runInContext(grab(auth, 'eraseOwnFiles') + '\nthis.e = eraseOwnFiles;', ctx);
  try { await ctx.e(); } catch (_) { /* the file-purge half needs the upload workers */ }
  assert.ok(deleted.includes('signals/s1') && deleted.includes('signals/s2'), 'public copies deleted');
  assert.ok(!deleted.includes('signals/s3'), 'never someone else\'s');
  assert.deepStrictEqual(deleted.filter((p) => p.startsWith('users/')).length, 4, 'then the person\'s own');
  assert.ok(deleted.indexOf('signals/s1') < deleted.indexOf('users/me/signal/s1'), 'the public copy first, while its id is known');
});

/* ---------- 5. The desk ---------- */
check('the desk: "Published without a check" lists unread public posts; new screen fields are worker/desk only', () => {
  const adm = read('js/admin-console.js').replace(/\n  /g, '\n');
  const f = new Function(grab(adm, 'mediaKeyOf') + grab(adm, 'changedAfterCheck') + grab(adm, 'uncheckedRows') + 'return uncheckedRows;')();
  const doc = (id, d) => ({ id, data: () => d });
  const rows = f([
    doc('a', { screenDecision: 'unread', listed: true, createdAt: 2 }),
    doc('b', { screenDecision: 'unread', listed: true, createdAt: 5 }),
    doc('c', { screenDecision: 'unread', listed: true, screenLookedAt: 9 }),
    doc('d', { screenDecision: 'unread', listed: true, hidden: true }),
    doc('e', { screenDecision: 'unread', listed: false }),
    doc('f', { screenDecision: 'unread', listed: true, deleted: true }),
  ]);
  assert.deepStrictEqual(rows.map((r) => r.id), ['b', 'a']);
  assert.ok(/writeAudit\('broadcast-unchecked-looked'/.test(adm) && /loadUncheckedBroadcasts\(el\);/.test(adm));
  const rules = read('firestore.rules');
  const keep = rules.slice(rules.indexOf('function keepsBroadcastListing'), rules.indexOf('function isOriginalVideoFile'));
  for (const k of ['screenDetail', 'screenFrame', 'screenLookedAt', 'screenLookedBy']) assert.ok(keep.includes("'" + k + "'"), k + ' cannot be changed by the creator');
});

/* ---------- 6. Updates after a half-done upload ---------- */
check('a half-done upload reloads once; the rest of the upload is then taken', () => {
  const core = read('js/core.js');
  const ss = {}, ls = {};
  let reloads = 0;
  const ctx = {
    JSON, Date, String, Number, setTimeout: () => 1,
    sessionStorage: { getItem: (k) => (k in ss ? ss[k] : null), setItem: (k, v) => { ss[k] = String(v); }, removeItem: (k) => { delete ss[k]; } },
    localStorage: { getItem: (k) => (k in ls ? ls[k] : null), setItem: (k, v) => { ls[k] = String(v); }, removeItem: (k) => { delete ls[k]; } },
    window: { nalunoUpdateBusy: () => false },
    nalunoUpdateQuietMoment: () => true, nalunoHideUpdateBanner() {}, nalunoShowUpdateBanner() {},
    nalunoUpdateNow: () => { reloads++; },
  };
  vm.createContext(ctx);
  vm.runInContext('const APP_VERSION = "2026.10.19d"; const NALUNO_BUILD = "2026.10.19d"; let nalunoAutoTimer = null;\n'
    + grab(core, 'nalunoStampKey') + grab(core, 'nalunoBestStamp') + grab(core, 'nalunoAutoUpdate') + '\nthis.go = nalunoAutoUpdate;', ctx);
  ctx.go('20261020a', false, '20261019d|20261020a');   // sw.js new, index.html old
  assert.strictEqual(reloads, 1);
  ctx.go('20261020a', false, '20261019d|20261020a');   // same offer again: no loop
  assert.strictEqual(reloads, 1);
  ctx.go('20261020a', false, '20261020a|20261020a');   // the rest of the upload landed
  assert.strictEqual(reloads, 2, 'the finished upload is taken in the same session');
  ctx.go('20261020a', false, '20261020a|20261020a');
  assert.strictEqual(reloads, 2, 'and only once');
  /* Two servers handing out different halves: each offer once, then it stops. */
  for (let i = 0; i < 6; i++) ctx.go('20261020a', false, i % 2 ? '20261019d|20261020a' : '20261020a|20261020a');
  assert.strictEqual(reloads, 2, 'no back-and-forth reloads');
  /* An older single-value guard from 19d is still understood. */
  ss.nalunoUpdateSettled = '20261021b|20261021b|20261021b';
  ctx.go('20261021b', false, '20261021b|20261021b');
  assert.strictEqual(reloads, 2);
});

(async () => {
  let failed = 0;
  for (const [name, fn] of checks) {
    try { await fn(); } catch (e) { failed++; console.error('FAIL: ' + name + '\n', e); }
  }
  if (failed) { console.error('fixes-1020a: ' + failed + ' failed'); process.exit(1); }
  console.log('fixes-1020a: all ' + checks.length + ' checks passed');
})();
