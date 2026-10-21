/* 21 Oct e: Drop can block, report a person, ⋮ menus, Compass AI notice and
   ⚑, legal text, child safety page, Support switch for the Android app,
   and the alert speed-ups. Run: node js/fixes-1021e.test.cjs */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

function fakeDb(log, opts) {
  const o = opts || {};
  const docRef = (p) => ({
    path: p,
    collection: (c) => colRef(p + '/' + c),
    set: async (data, m) => { if (o.fail && o.fail(p, 'set')) { const e = new Error('Missing or insufficient permissions.'); e.code = 'permission-denied'; throw e; } log.push(['set', p, JSON.parse(JSON.stringify(data)), m || null]); },
    delete: async () => { log.push(['delete', p]); },
    get: async () => ({ exists: false, data: () => ({}) }),
  });
  const colRef = (p) => ({ doc: (id) => docRef(p + '/' + id), onSnapshot: (fn) => { o.snap = fn; return () => {}; } });
  return {
    collection: (c) => colRef(c),
    batch: o.noBatch ? undefined : () => {
      const w = [];
      return {
        set: (ref, data, m) => { w.push(['set', ref.path, JSON.parse(JSON.stringify(data)), m || null]); },
        commit: async () => {
          if (o.batchFail) { const e = new Error(o.batchFail); e.code = o.batchFail; throw e; }
          log.push(['batch', w]);
        },
      };
    },
  };
}

(async () => {
  /* 1. The rules stop a blocked person: requests, Wireline, the chat line, calls. */
  {
    const r = read('firestore.rules');
    assert.ok(/function blockedBy\(owner\) \{\s*return exists\(\/databases\/\$\(database\)\/documents\/users\/\$\(owner\)\/blocked\/\$\(request\.auth\.uid\)\);/.test(r));
    const blk = r.slice(r.indexOf('match /users/{uid}/blocked/{otherUid}'), r.indexOf('match /users/{uid}/connectionRequests/{fromUid}'));
    assert.ok(/allow read: if isOwner\(uid\) \|\| isOperator\(\);/.test(blk) && /allow create, update: if isOwner\(uid\) && otherUid != uid/.test(blk) && /hasOnly\(\['at', 'name'\]\)/.test(blk) && /allow delete: if isOwner\(uid\);/.test(blk));
    const req = r.slice(r.indexOf('match /users/{uid}/connectionRequests/{fromUid}'), r.indexOf('match /users/{uid}/connectionRequests/{fromUid}') + 500);
    assert.ok(/&& !blockedBy\(uid\)/.test(req), 'no Frequency request');
    const thr = r.slice(r.indexOf('match /threads/{threadId}'), r.indexOf('match /wireDrop/{uid}'));
    assert.strictEqual((thr.match(/!blockedBy\((resource|request\.resource)\.data\.participants\[0\]\) && !blockedBy\((resource|request\.resource)\.data\.participants\[1\]\)/g) || []).length, 2, 'no new chat line or preview update');
    const drop = r.slice(r.indexOf('match /wireDrop/{uid}'), r.indexOf('match /receipts/{id}'));
    assert.ok(/request\.resource\.data\.to == uid\s*&& !blockedBy\(uid\)/.test(drop), 'no Wireline message');
    assert.ok(/allow create: if isSignedIn\(\) && request\.auth\.uid == request\.resource\.data\.callerUid\s*&& request\.resource\.data\.calleeUid is string\s*&& !blockedBy\(request\.resource\.data\.calleeUid\);/.test(r), 'no call');
  }

  /* 2. people-safety.js: block, unblock, the list, the menu. */
  {
    const log = [];
    const db = fakeDb(log);
    const ctx = { console, Map, Array, Date, Math, String, Number, Object, JSON, Promise, setTimeout: () => 0, setInterval: () => 0, clearTimeout() {},
      document: { readyState: 'complete', getElementById: () => null, addEventListener() {}, dispatchEvent() {}, body: { appendChild() {} }, createElement: () => ({ setAttribute() {}, appendChild() {}, style: {} }) },
      CustomEvent: function () {}, navigator: {}, fbDb: db, currentUser: { uid: 'me' }, contacts: [{ id: 5, firebaseUid: 'amina', name: 'Amina K' }] };
    ctx.window = ctx;
    vm.createContext(ctx);
    vm.runInContext(read('js/people-safety.js'), ctx);
    const P = ctx.NalunoPeople;
    assert.strictEqual(await P.block('me'), false, 'cannot block yourself');
    assert.strictEqual(await P.block('bad id!'), false);
    assert.strictEqual(await P.block('amina', 'Amina K'), true);
    assert.deepStrictEqual(log[0].slice(0, 2), ['set', 'users/me/blocked/amina']);
    assert.deepStrictEqual(Object.keys(log[0][2]).sort(), ['at', 'name'], 'only what the rules allow');
    assert.deepStrictEqual(log[1], ['delete', 'users/me/connectionRequests/amina'], 'their pending request goes too');
    assert.strictEqual(P.isBlocked('amina'), true);
    assert.strictEqual(ctx.nalunoIsBlocked('amina'), true);
    assert.strictEqual(P.blockedList()[0].name, 'Amina K');
    await P.unblock('amina');
    assert.deepStrictEqual(log[2], ['delete', 'users/me/blocked/amina']);
    assert.strictEqual(P.isBlocked('amina'), false);
    const src = read('js/people-safety.js');
    assert.ok(/Also stop ' \+ first \+ ' from reaching me/.test(src) && /No requests, Wireline or calls, until you undo it\./.test(src));
    assert.ok(/label: connected \? 'Drop' : 'Stop them reaching me', danger: true/.test(src) && /label: 'Report', danger: true/.test(src));
    assert.ok(/openReportSheet\(\{ target_type: 'person', target_id: String\(where \|\| 'person'\), target_user_id: who\.uid, name: who\.name \}\)/.test(src), 'a person report carries no messages');
    assert.ok(/esc\(r\.name \|\| 'Someone'\)/.test(src), 'names in the list are escaped');
  }

  /* 3. Drop goes through the sheet; the menus are ⋮, not buttons on the screen. */
  {
    const find = read('js/find.js');
    assert.ok(/async function dropFrequency\(localId, opts\)/.test(find) && /window\.NalunoPeople\.dropPerson\(\{ uid: c\.firebaseUid, name: name, localId: c\.id \}\);/.test(find));
    const ui = read('js/signal-ui.js');
    assert.ok(/class="nl-dots" data-drop-freq="\$\{c\.id\}" aria-label="More for/.test(ui) && !/>Drop<\/button>/.test(ui));
    const html = read('app/index.html');
    assert.ok(!/id="threadClearBtn"/.test(html), 'the bin icon left the chat header');
    assert.ok(/id="threadMoreBtn" aria-label="More: clear chat, drop or report"[^>]*>⋮<\/button>/.test(html));
    const wire = read('js/wireline.js');
    assert.ok(/label: 'Clear chat on my side'/.test(wire) && /personMenu\(more, \{ uid: c\.firebaseUid/.test(wire));
    assert.ok(/<script src="\/js\/people-safety\.js\?v=20261021e"><\/script>/.test(html));
    assert.ok(html.indexOf('/js/report.js') < html.indexOf('/js/people-safety.js'));
    assert.ok(/id="blockedPeopleSection"/.test(html) && /Stopped from reaching you/.test(html));
    const band = read('js/band-room.js');
    assert.ok(/msgs = msgs\.filter\(m => m\.fromMe \|\| !m\.fromUid \|\| !nalunoIsBlocked\(m\.fromUid\)\)/.test(band));
  }

  /* 4. Compass: the AI line and a tiny ⚑ that sends the answer, never the question. */
  {
    const html = read('app/index.html');
    assert.ok(/<div class="compass-ai-note" id="compassAiNote">Compass is AI and can make mistakes\. Check important information\.<\/div>/.test(html));
    const css = read('css/app.css');
    assert.ok(/\.compass-ai-note\{font-size:10\.5px;/.test(css) && /\.compass-flag\{[^}]*font-size:10px;/.test(css), 'small');
    const c = read('js/compass.js');
    assert.ok(/class="compass-flag" data-compass-flag="\$\{i\}" aria-label="Report this answer"/.test(c) && /!m\.thinking/.test(c));
    assert.ok(/openReportSheet\(\{ target_type: 'compass', target_id: String\(m\.id \|\| m\.ts \|\| ''\), name: 'a Compass answer', answer: String\(m\.text \|\| ''\) \}\)/.test(c));
    const rep = read('js/report.js');
    const ctx = {};
    vm.createContext(ctx);
    vm.runInContext(rep.slice(rep.indexOf('const NALUNO_COMPASS_REASONS'), rep.indexOf('function nalunoReportId')) + 'this.R = NALUNO_COMPASS_REASONS;', ctx);
    const codes = ctx.R.map((x) => x.code);
    const worker = read('workers/economy/handler.mjs');
    codes.forEach((k) => assert.ok(new RegExp('\\b' + k + ': 1').test(worker.slice(worker.indexOf('const REPORT_CODES'), worker.indexOf('const REPORT_CODES') + 400)), k + ' is a reason the worker accepts today'));
    assert.ok(/reason = \('Compass answer reported: ' \+ pick\.label/.test(rep) && /The answer:/.test(rep));
    assert.ok(/if\(btn\) btn\.disabled = !quick;/.test(rep), 'words optional for an answer');
    assert.ok(/const personReport = String\(body\.target_type \|\| ""\) === "person" \|\| String\(body\.target_type \|\| ""\) === "compass";\s*if \(wrote\.ok && saToken && !personReport\)/.test(worker), 'a person report does not hold their Broadcasts');
    const adm = read('js/admin-console.js');
    assert.ok(/if \(tt === 'person' \|\| tt === 'compass'\) \{/.test(adm), 'the desk can read these reports');
  }

  /* 5. Legal text: Privacy the same in the app and both pages; Terms in all three; the child safety page. */
  {
    const want = [/Effective 21 October 2026/, /The people who run Naluno can see a phone’s last reported place, to help with a lost phone or a safety matter; they cannot see Find Naluno history\./,
      /Compass answers are written by AI and can be wrong\./, /everything else \(profile, Compass notes, Find Naluno history, Frequencies, push addresses\) 30 days later\./,
      /You can stop someone reaching you \(⋮ → Drop, and tick “Also stop them reaching me”\)/, /<a href="\/child-safety\/">Child safety standards<\/a>/];
    const app = read('js/legal-privacy.js');
    const body = app.slice(app.indexOf('`') + 1, app.lastIndexOf('`')).trim().replace(/\s+/g, ' ');
    ['js/legal-privacy.js', 'privacy.html', 'privacy/index.html'].forEach((f) => {
      const s = read(f);
      want.forEach((re) => assert.ok(re.test(s), f + ' ' + re));
      assert.ok(!/A closed Callsign can be restored/.test(s), f);
      if (f !== 'js/legal-privacy.js') assert.ok(s.replace(/\s+/g, ' ').indexOf(body) >= 0, f + ' word for word');
    });
    ['terms.html', 'terms/index.html', 'js/onboard.js'].forEach((f) => {
      const s = read(f);
      assert.ok(/Post or send any sexual content involving someone under 18/.test(s), f);
      assert.ok(/praise or support terrorism/.test(s) && /Encourage someone to harm or kill themselves\./.test(s) && /stir up hatred/.test(s), f);
      assert.ok(/4b\. Reporting and blocking/.test(s), f);
      assert.ok(/and the rest of the account 30 days later; after that it cannot be restored\./.test(s) && !/A closed Callsign can be restored/.test(s), f);
    });
    assert.ok(/NALUNO_LEGAL_EFFECTIVE = '21 October 2026'/.test(read('js/onboard.js')));
    ['child-safety/index.html', 'child-safety.html'].forEach((f) => {
      const s = read(f);
      assert.ok(/<title>Child safety standards — Naluno<\/title>/.test(s) && /child sexual abuse and exploitation \(CSAE\)/.test(s));
      assert.ok(/Google Play/.test(s) && /Sauti child helpline on 116/.test(s) && /href="\/contact\/"/.test(s) && /responsible for these standards/.test(s));
    });
    assert.ok(/href="\/child-safety"/.test(read('privacy.html')) && /href="\/child-safety"/.test(read('terms.html')));
    /* the one-time notice */
    const ob = read('js/onboard.js');
    assert.ok(/const NALUNO_LEGAL_VERSION = '2026-10-21';/.test(ob) && /function showNalunoLegalNotice\(\)/.test(ob) && /\.callscreen\.active/.test(ob));
    const agreeAt = ob.indexOf("agree.onclick = function(){");
    assert.ok(/localStorage\.setItem\(NALUNO_LEGAL_SEEN_KEY, NALUNO_LEGAL_VERSION\)/.test(ob.slice(agreeAt, agreeAt + 400)), 'a new person agreeing now is not shown the notice');
    assert.ok(!/NALUNO_LEGAL_SEEN_KEY/.test(ob.slice(ob.indexOf('function stampNalunoWelcome'), ob.indexOf('\n}', ob.indexOf('function stampNalunoWelcome')))), 'a returning phone marked complete still sees it once');
  }

  /* 6. Support in the Android app follows the desk's switch; the website is unchanged. */
  {
    const src = read('js/economy.js');
    const fn = src.slice(src.indexOf('function nalunoSupportAllowedHere'), src.indexOf('function applyEconomyFlagsToUi'));
    const run = (cap, on) => { const ctx = { window: { Capacitor: cap }, nalunoEconomyFlag: (k) => k === 'support_in_android_app' && on }; vm.createContext(ctx); vm.runInContext(fn + 'this.r = nalunoSupportAllowedHere();', ctx); return ctx.r; };
    assert.strictEqual(run(undefined, false), true, 'website');
    assert.strictEqual(run({ platform: 'android' }, false), false, 'Android app, switch off');
    assert.strictEqual(run({ isNativePlatform: () => true }, true), true, 'Android app, switch on');
    assert.ok(/if\(typeof nalunoSupportAllowedHere === 'function' && !nalunoSupportAllowedHere\(\)\) return;/.test(read('js/economy-ui.js')));
    assert.ok(/body\.naluno-support-hidden #bspaceSupportSlot/.test(read('css/app.css')));
    assert.ok(/support_in_android_app: false,/.test(read('workers/economy/handler.mjs')) && /support_in_android_app: \{ label: 'Support in the Android app'/.test(read('js/admin-data.js')));
  }

  /* 7. Alerts: one write for a Wireline message; each browser keeps its own push address; repeats don't force a new sign-in token. */
  {
    const mk = (opts) => {
      const log = [];
      const ctx = { console, fbDb: fakeDb(log, opts), currentUser: { uid: 'me' }, firebase: { firestore: { FieldValue: { serverTimestamp: () => 'TS', delete: () => 'DEL' } } }, localStorage: { s: {}, getItem(k) { return this.s[k] || null; }, setItem(k, v) { this.s[k] = String(v); } }, Date, Math, JSON, Object, String, Promise, setTimeout, clearTimeout, setInterval: () => 0 };
      ctx.window = ctx; ctx.globalThis = ctx;
      vm.createContext(ctx);
      vm.runInContext(read('js/wire-mailbox.js'), ctx);
      return { ctx, log };
    };
    let t = mk();
    await t.ctx.NalunoWireMailbox.sendDrop('you', 'me_you', 'c1', { type: 'text', encrypted: true }, 'text');
    assert.strictEqual(t.log.length, 1); assert.strictEqual(t.log[0][0], 'batch'); assert.strictEqual(t.log[0][1].length, 2, 'the chat line and the message together');
    t = mk({ batchFail: 'permission-denied' });
    await t.ctx.NalunoWireMailbox.sendDrop('you', 'me_you', 'c2', { type: 'text', encrypted: true }, 'text');
    assert.deepStrictEqual(t.log.map((x) => x[1]), ['threads/me_you', 'wireDrop/you/inbox/c2'], 'refused as one: the two writes as before');
    t = mk({ batchFail: 'unavailable' });
    await assert.rejects(t.ctx.NalunoWireMailbox.sendDrop('you', 'me_you', 'c3', { type: 'text', encrypted: true }, 'text'), 'offline is still an error the queue handles');
    t = mk({ noBatch: true });
    await t.ctx.NalunoWireMailbox.sendDrop('you', 'me_you', 'c4', { type: 'text', encrypted: true }, 'text');
    assert.strictEqual(t.log.length, 2);

    const vlog = [];
    const vctx = { console, fbDb: fakeDb(vlog), currentUser: { uid: 'me' }, currentProfile: {}, firebase: { firestore: { FieldValue: { delete: () => 'DEL' } } }, localStorage: { s: {}, getItem(k) { return this.s[k] || null; }, setItem(k, v) { this.s[k] = String(v); } }, Date, Math, JSON, Object, Promise };
    vctx.window = vctx; vctx.globalThis = vctx;
    vm.createContext(vctx);
    vm.runInContext(read('js/vault.js'), vctx);
    await vctx.nalunoVault.writePush({ fcmTokenWeb: 'tok-web-1', fcmTokenPlatform: 'web' });
    const w = vlog.find((x) => x[1] === 'users/me/vault/main');
    assert.strictEqual(w[2].fcmTokenWeb, 'tok-web-1', 'the old field still written');
    const dev = Object.keys(w[2].webPush)[0];
    assert.ok(/^[a-z0-9]{6,24}$/.test(dev) && w[2].webPush[dev].t === 'tok-web-1' && w[3] && w[3].merge === true, 'and this browser’s own slot, merged');
    await vctx.nalunoVault.writePush({ fcmTokenAndroid: 'and-1' });
    assert.ok(!('webPush' in vlog[vlog.length - 1][2]), 'the Android address has its own field');

    const calls = read('js/calls.js');
    assert.ok(/const idToken = await currentUser\.getIdToken\(false\);/.test(calls) && !/getIdToken\(firstAttempt \? false : true\)/.test(calls));
    const wire = read('js/wireline.js');
    assert.ok(/nalunoNotePush\(\{ pingId: pingId, toUid: calleeUid, type: 'wireline'/.test(wire), 'Wireline alerts are timed');
  }

  /* 8. The desk sees how long alerts take. */
  {
    const ctx = { window: {}, globalThis: {} };
    ctx.globalThis = ctx;
    vm.runInNewContext(read('js/admin-data.js'), ctx);
    const D = ctx.window.NalunoAdminData || ctx.NalunoAdminData;
    const now = Date.now();
    const pings = [], receipts = [];
    [800, 1500, 2400, 3000, 95000].forEach((ms, i) => { pings.push({ pingId: 'pw' + i, status: 'handed', type: 'wireline', sentAt: now - 200000 }); receipts.push({ pingId: 'pw' + i, arrivedAt: now - 200000 + ms }); });
    pings.push({ pingId: 'pc0', status: 'handed', type: 'incoming_call', sentAt: now - 1000 }); receipts.push({ pingId: 'pc0', arrivedAt: now - 1000 + 1200 });
    pings.push({ pingId: 'nore', status: 'handed', type: 'wireline', sentAt: now });
    const snap = D.deriveSnapshot({ now, zone: 'Africa/Kampala', users: [], pushPings: pings, pushReceipts: receipts });
    const dl = snap.proof.delivery;
    const w = dl.find((x) => x.kind === 'wireline');
    assert.strictEqual(w.n, 5); assert.strictEqual(w.median, 2400); assert.strictEqual(w.slowest, 95000); assert.strictEqual(w.over1m, 1);
    assert.strictEqual(dl.find((x) => x.kind === 'call').median, 1200);
    assert.ok(/How long alerts took to show/.test(read('js/admin-console.js')));
  }

  /* 9. Measures know the new counts; the console shows them. */
  {
    const M = require('./admin-measures.js');
    const shown = new Set();
    M.AREAS.forEach((a) => { a.counts.forEach((c) => shown.add(c[0])); a.lists.forEach((l) => shown.add(l[0])); });
    ['person_drop', 'person_block', 'compass_flag'].forEach((n) => assert.ok(shown.has(n), n));
    const { CATALOGUE } = await import(path.join(root, 'workers/economy/measure.mjs'));
    ['person_drop', 'person_block', 'compass_flag'].forEach((n) => assert.ok(CATALOGUE[n], n));
  }
  console.log('fixes-1021e: all checks passed');
})().catch((e) => { console.error(e); process.exit(1); });
