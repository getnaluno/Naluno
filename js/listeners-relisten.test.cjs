/* Listeners that used to die for the rest of the session (29b).
   1. The app helper (core.js nalunoRelisten) subscribes again with a backoff.
   2. The console's live lists (admin-console.js) subscribe again and stop
      after six failures in a row, so a hard failure cannot pile up listeners.
   3. Every listener named in the fix is wired to it. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const read = (f) => fs.readFileSync(path.join(__dirname, f), 'utf8');

function fakeTimers() {
  let now = 0; const q = [];
  return {
    setTimeout(fn, ms) { const t = { at: now + (ms || 0), fn }; q.push(t); return t; },
    clearTimeout(t) { const i = q.indexOf(t); if (i >= 0) q.splice(i, 1); },
    advance(ms) { const end = now + ms; for (;;) { q.sort((a, b) => a.at - b.at); const t = q[0]; if (!t || t.at > end) break; q.shift(); now = t.at; t.fn(); } now = end; },
    pending() { return q.length; },
  };
}

/* 1. core.js helper */
{
  const core = read('core.js');
  const a = core.indexOf('const nalunoRelistenState = {};');
  const b = core.indexOf('window.nalunoRelisten = nalunoRelisten;');
  assert.ok(a > 0 && b > a, 'helper found');
  const T = fakeTimers();
  const ctx = { console: { warn() {} }, setTimeout: T.setTimeout, clearTimeout: T.clearTimeout, currentUser: { uid: 'me' }, Math };
  vm.createContext(ctx);
  vm.runInContext(core.slice(a, b) + '\nthis.re = nalunoRelisten; this.ok = nalunoListenOk; this.stop = nalunoRelistenStop;', ctx);
  let starts = 0;
  // fails 4 times: waits 1s, 2s, 4s, 8s
  const fail = () => ctx.re('x', () => { starts++; });
  fail(); T.advance(999); assert.strictEqual(starts, 0); T.advance(1); assert.strictEqual(starts, 1, 'first retry after 1s');
  fail(); T.advance(2000); assert.strictEqual(starts, 2, 'then 2s');
  fail(); T.advance(4000); assert.strictEqual(starts, 3, 'then 4s');
  assert.strictEqual(ctx.re('x', () => {}), true); assert.strictEqual(ctx.re('x', () => {}), false, 'one pending retry at a time');
  T.advance(8000);
  ctx.ok('x'); fail(); T.advance(1000); assert.ok(starts >= 3, 'a good snapshot resets the wait');
  // capped at 30s
  for (let i = 0; i < 10; i++) { fail(); T.advance(30000); }
  // signed out: the retry does nothing
  ctx.currentUser = null; let after = 0; ctx.re('y', () => { after++; }); T.advance(2000); assert.strictEqual(after, 0, 'no resubscribe after sign-out');
  // max: stops after N failures
  ctx.currentUser = { uid: 'me' }; let m = 0;
  for (let i = 0; i < 10; i++) { ctx.re('z', () => { m++; }, 6); T.advance(31000); }
  assert.strictEqual(m, 6, 'stops after max tries');
}

/* 2. console live lists */
{
  const src = read('admin-console.js');
  const a = src.indexOf('  const __relistenTries = {};');
  const b = src.indexOf('  /* A creator cannot write deskAds until rules are published.');
  assert.ok(a > 0 && b > a, 'console block found');
  const T = fakeTimers();
  const listeners = [];
  const db = {
    collection: (name) => ({
      orderBy() { return this; }, limit() { return this; },
      onSnapshot(ok, err) { const l = { name, ok, err, live: true }; listeners.push(l); return () => { l.live = false; }; },
      doc: (id) => ({ onSnapshot(ok, err) { const l = { name: name + '/' + id, ok, err, live: true }; listeners.push(l); return () => { l.live = false; }; } }),
    }),
    collectionGroup: (name) => ({ limit() { return this; }, onSnapshot(ok, err) { const l = { name: '*/' + name, ok, err, live: true }; listeners.push(l); return () => { l.live = false; }; } }),
  };
  const ctx = { console: { warn() {} }, setTimeout: T.setTimeout, clearTimeout: T.clearTimeout, Math, Object,
    __liveArmed: true, __liveUnsubs: [], __livePack: {}, adminDb: () => db, snapRows: () => [], groupRows: () => [], scheduleLive() {} };
  vm.createContext(ctx);
  vm.runInContext('var __liveArmed = true, __liveUnsubs = [], __livePack = {};\n' + src.slice(a, b) + '\nthis.listenCol = listenCol; this.listenDoc = listenDoc; this.listenGroup = listenGroup; this.arm = (v) => { __liveArmed = v; }; this.tries = __relistenTries;', ctx);
  ctx.listenCol('users', 400, 'users');
  const live = () => listeners.filter((l) => l.name === 'users');
  assert.strictEqual(live().length, 1);
  // one blip: comes back after 1s, a snapshot resets the count
  live()[0].err(new Error('unavailable'));
  T.advance(1000);
  assert.strictEqual(live().length, 2, 'resubscribed after a blip');
  live()[1].ok({});
  assert.strictEqual(ctx.tries['col:users'], 0, 'good snapshot resets');
  // hard failure: every new one fails at once; stops after 6
  for (let i = 0; i < 20; i++) { const l = live()[live().length - 1]; l.err(new Error('permission-denied')); T.advance(40000); }
  const made = live().length;
  assert.strictEqual(made, 2 + 6, 'six more tries, then it stops (made ' + made + ')');
  // doc and group listeners too
  ctx.listenDoc('economyConfig', 'prices', 'prices');
  ctx.listenGroup('signal', 100, () => {});
  const d = listeners.find((l) => l.name === 'economyConfig/prices'); d.err(new Error('x')); T.advance(1000);
  assert.strictEqual(listeners.filter((l) => l.name === 'economyConfig/prices').length, 2, 'doc listener comes back');
  const g = listeners.find((l) => l.name === '*/signal'); g.err(new Error('x')); T.advance(1000);
  assert.strictEqual(listeners.filter((l) => l.name === '*/signal').length, 2, 'group listener comes back');
  // disarmed console: no retry
  ctx.arm(false);
  const g2 = listeners.filter((l) => l.name === '*/signal')[1]; g2.err(new Error('x')); T.advance(60000);
  assert.strictEqual(listeners.filter((l) => l.name === '*/signal').length, 2, 'no retry once the console dropped its lists');
  assert.ok(src.includes('Object.keys(__relistenTimers).forEach'), 'dropping the lists cancels pending retries');
}

/* 3. wiring */
{
  const want = [
    ['wireline.js', "nalunoRelisten('threads', attachThreadsListListener)"],
    ['wire-mailbox.js', "relisten('mailbox-inbox', attachInbox)"],
    ['wire-mailbox.js', "relisten('mailbox-receipts', attachReceipts)"],
    ['find.js', "nalunoRelisten('contacts'"],
    ['band-list.js', "nalunoRelisten('bandList'"],
    ['band-room.js', "nalunoRelisten('bandMessages'"],
    ['band-room.js', "nalunoRelisten('bandPresence', attachPresence)"],
    ['compass.js', "nalunoRelisten('compass', loadCompassMessages)"],
    ['calls.js', "nalunoRelisten('missedCalls', startMissedCallListener)"],
  ];
  want.forEach(([f, s]) => assert.ok(read(f).includes(s), f + ' resubscribes: ' + s));
  ['wireline.js', 'find.js', 'band-list.js', 'band-room.js', 'compass.js', 'calls.js'].forEach((f) => {
    assert.ok(!/just won't (populate|be live|live-update|sync|update|load) this session/.test(read(f)), f + ': no listener left to die silently');
  });
}
console.log('listeners-relisten tests passed');
