/* 15 Oct d: "Couldn't enable notifications" and an empty feed after
   signing out and back in. Run: node js/fixes-1015d.test.cjs */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

(async () => {
  /* ---- the vault reaches the app's database (script globals, not window) ---- */
  const writes = [];
  const docs = {};
  const db = {
    collection: (c) => ({ doc: (id) => {
      const p1 = c + '/' + id;
      return {
        collection: (c2) => ({ doc: (id2) => {
          const p = p1 + '/' + c2 + '/' + id2;
          return { set: async (v, o) => { writes.push([p, v]); docs[p] = Object.assign({}, o && o.merge ? docs[p] : {}, v); }, get: async () => ({ exists: !!docs[p], data: () => docs[p] }) };
        } }),
        set: async (v) => { writes.push([p1, v]); },
      };
    } }),
  };
  const ctx = { console, Promise, Object, Array, JSON, String, Number, setTimeout,
    firebase: { firestore: { FieldValue: { delete: () => ({ isEqual: () => true, __del: 1 }) } } } };
  ctx.window = ctx; // window has NO fbDb / currentUser, exactly as in the app
  vm.createContext(ctx);
  vm.runInContext('let fbDb = null; let currentUser = null; let currentProfile = { name: "a" };', ctx);
  vm.runInContext(read('js/vault.js'), ctx);
  vm.runInContext('fbDb = __db; currentUser = { uid: "alice" };', Object.assign(ctx, { __db: db }));
  const V = ctx.nalunoVault;
  assert.ok(V.ref(), 'the vault reaches the database through the app\'s own globals');
  assert.strictEqual(await V.movePush({ fcmTokenWeb: 'tok', fcmToken: 'tok', fcmTokenPlatform: 'web' }), true, 'a push address is saved');
  assert.deepStrictEqual(writes[0][0], 'users/alice/vault/main');
  assert.strictEqual(writes[0][1].fcmTokenWeb, 'tok');
  assert.strictEqual(writes[1][0], 'users/alice', 'then the public copy is removed (removal only)');
  assert.ok(Object.values(writes[1][1]).every((v) => v && v.__del));

  /* ---- copying private fields into the vault: copy only, after the vault was read, never the console gate ---- */
  writes.length = 0;
  vm.runInContext('fbDb = __db; currentUser = { uid: "bob" };', ctx);
  const V2 = (() => { const c2 = Object.assign({}, ctx); return V; })();
  // a fresh module so "loaded" starts false
  const ctxB = { console, Promise, Object, Array, JSON, String, Number, setTimeout, firebase: ctx.firebase };
  ctxB.window = ctxB; vm.createContext(ctxB);
  vm.runInContext('let fbDb = null; let currentUser = null; let currentProfile = null;', ctxB);
  vm.runInContext(read('js/vault.js'), ctxB);
  vm.runInContext('fbDb = __db; currentUser = { uid: "bob" };', Object.assign(ctxB, { __db: db }));
  const VB = ctxB.nalunoVault;
  const pub = { recoveryEmail: 'r@x', compassPasswordHash: 'h1', _consoleGate: { hash: 'old' } };
  assert.strictEqual(await VB.migrateFromPublic(pub, 'bob'), false, 'nothing before the vault itself has been read');
  assert.strictEqual(writes.length, 0);
  VB.acceptSnapshot({ compassPasswordHash: 'newer', _consoleGate: { hash: 'current' } });
  assert.strictEqual(await VB.migrateFromPublic(pub, 'bob'), true);
  assert.strictEqual(writes.length, 1, 'one write: into the vault; nothing removed from the public profile');
  assert.strictEqual(writes[0][0], 'users/bob/vault/main');
  assert.deepStrictEqual(Object.keys(writes[0][1]), ['recoveryEmail'], 'only what the vault lacks; never the console gate; a newer vault value is kept');
  assert.ok(!/stripPublic\(\), \{ merge: true \}\)/.test(read('js/vault.js').split('async function migrateFromPublic')[1].split('root.nalunoVault')[0]));
  assert.strictEqual(await VB.migrateFromPublic(pub, 'carol'), false, 'not for another account than the one whose vault was read');
  assert.ok(!/vault\.js/.test(read('admin/index.html')), 'the console does not load the app vault (its sign-in is untouched)');

  /* ---- the public feed: errors are kept, shown and retried ---- */
  const core = read('js/broadcast-core.js');
  assert.ok(/if\(gen !== nalunoFeedGen\) return;\s*if\(feedBroadcastsUnsub\)/.test(core), 'an old listener\'s error cannot stop the new one');
  assert.ok(/nalunoNoteFeedProblem\(err\);\s*\/\*[\s\S]*?\*\/\s*if\(!currentUser\) return;\s*nalunoFeedRetry\(err\);/.test(core), 'signed out: stop; signed in: retry');
  assert.ok(!/\.limit\(80\)/.test(core.slice(core.indexOf('function startFeedBroadcastsListener'), core.indexOf('function recheckCaughtUp'))), 'no fallback query that needs an index nobody built');
  const retry = core.slice(core.indexOf('function nalunoFeedRetry('), core.indexOf('function nalunoFeedRetry(') + 900);
  assert.ok(/Math\.min\(60000, 2000 \* Math\.pow\(2, n\)\)/.test(retry), '2 s, 4 s … then every minute');
  assert.ok(/if\(currentUser && !feedBroadcastsUnsub\) startFeedBroadcastsListener\(\);/.test(retry));
  const f = new Function(core.slice(core.indexOf('let nalunoFeedProblem = null;'), core.indexOf('window.nalunoFeedProblemText')).replace(/try\{ if\(typeof renderBroadcastTab[^\n]*\n/, '').replace(/try\{ if\(typeof nalunoDiag[^\n]*\n/, '')
    + core.slice(core.indexOf('function nalunoFeedIndexLink'), core.indexOf('window.nalunoFeedIndexLink'))
    + 'return { note: nalunoNoteFeedProblem, text: nalunoFeedProblemText, link: nalunoFeedIndexLink };')();
  f.note({ code: 'failed-precondition', message: 'The query requires an index. You can create it here: https://console.firebase.google.com/v1/r/project/x/firestore/indexes?create_composite=abc' });
  /* 15 Oct g: plain words on the phone; the database's own (and its link) go to Naluno. */
  assert.ok(/Broadcasts couldn.t load right now/.test(f.text()) && !/index|database/i.test(f.text()));
  assert.strictEqual(f.link(), 'https://console.firebase.google.com/v1/r/project/x/firestore/indexes?create_composite=abc');
  f.note({ code: 'permission-denied', message: 'x' });
  assert.ok(!/refused|database/i.test(f.text())); assert.strictEqual(f.link(), '');
  const ui = read('js/signal-ui.js');
  assert.ok(/else if\(feedNote\) copy\.textContent = feedNote;/.test(ui) && !/Open the database page/.test(ui), 'the empty feed says so plainly, no database link on a phone');
  /* with the server clock known, a refusal no longer steps the feed back */
  assert.ok(/if\(nalunoMeasuredSkew\(\) !== null && !nalunoBackoffWithSkew && nalunoClockBackoff === 0\) return true;/.test(core));
  console.log('fixes-1015d: all checks passed');
})().catch((e) => { console.error(e); process.exit(1); });
