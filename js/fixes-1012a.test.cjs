/* 12 Oct a: calls, call alerts and Broadcast visibility.
   Each block names the failure it guards against. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

function fnSource(src, name) {
  const re = new RegExp('(^|\\n)(async )?function ' + name + '\\(');
  const m = re.exec(src);
  assert.ok(m, 'function ' + name + ' exists');
  let i = src.indexOf('{', m.index + m[0].length - 1);
  let depth = 0;
  for (let k = i; k < src.length; k++) {
    if (src[k] === '{') depth++;
    else if (src[k] === '}') { depth--; if (depth === 0) return src.slice(m.index, k + 1); }
  }
  throw new Error('unbalanced ' + name);
}

(async () => {
  const calls = read('js/calls.js');
  const pwa = read('js/pwa.js');
  const sw = read('sw.js');
  const core = read('js/core.js');
  const bcore = read('js/broadcast-core.js');

  /* 1. An answered call's alerts are recognised in every shape the shade
        holds: the worker's own ring, a browser-drawn Firebase push (data
        under FCM_MSG), and older call pushes sent with the Wireline tag. */
  const info = new Function(fnSource(calls, 'nalunoCallNoteInfo') + '; return nalunoCallNoteInfo;')();
  assert.deepStrictEqual(JSON.parse(JSON.stringify(info({ tag: 'naluno-call:c1', data: { callId: 'c1', type: 'incoming_call' } }))), { callish: true, id: 'c1', tag: 'naluno-call:c1' });
  assert.strictEqual(info({ tag: 'naluno-call:c2', data: { FCM_MSG: { data: { type: 'incoming_call', callId: 'c2' } } } }).id, 'c2');
  const legacy = info({ tag: 'naluno-wire::', data: { FCM_MSG: { data: { type: 'incoming_call', callId: '' } } } });
  assert.ok(legacy.callish && legacy.id === '', 'an older call push with the Wireline tag is a call alert');
  assert.ok(!info({ tag: 'naluno-wire:u1:m1', data: { FCM_MSG: { data: { type: 'wireline' } } } }).callish, 'a message alert is not a call alert');
  assert.ok(/setTimeout\(function\(\)\{ nalunoCloseCallNotesNow\(callId\); \}, 2500\)/.test(calls), 'the page looks again after a late push is drawn');

  /* 2. The service worker: a push for a handled call is taken down, also
        after Firebase draws its own copy; Answer on the notification
        answers; alerts for another call stay. */
  const shown = [];
  const handlers = {};
  const posted = [];
  const opened = [];
  function Note(title, o) { this.title = title; this.tag = (o && o.tag) || ''; this.data = (o && o.data) || {}; this.closed = false; }
  Note.prototype.close = function () { this.closed = true; const i = shown.indexOf(this); if (i >= 0) shown.splice(i, 1); };
  const cacheStore = new Map();
  const box = {
    console, setTimeout, clearTimeout, setInterval, clearInterval, Promise, URL, Request: function (u) { this.url = u; }, Response: function (b) { this.body = b; },
    importScripts: () => { throw new Error('offline'); },
    caches: { open: async () => ({ put: async (r, v) => { cacheStore.set(r.url || r, v); }, match: async (u) => cacheStore.get(u) || null, addAll: async () => {} }), keys: async () => [], delete: async () => true, match: async () => null },
    fetch: async () => ({ ok: true }),
  };
  box.self = {
    addEventListener: (t, f) => { handlers[t] = f; },
    registration: {
      showNotification: async (t, o) => { const old = shown.find((n) => n.tag && n.tag === (o && o.tag)); if (old) old.close(); shown.push(new Note(t, o)); },
      getNotifications: async () => shown.slice(),
    },
    clients: {
      matchAll: async () => [{ focus: async () => {}, postMessage: (m) => posted.push(m), visibilityState: 'hidden', focused: false }],
      openWindow: async (u) => { opened.push(u); },
      claim: async () => {},
    },
    skipWaiting: () => {},
    location: { origin: 'https://getnaluno.com' },
  };
  vm.createContext(box);
  vm.runInContext(sw, box, { filename: 'sw.js' });
  const ev = (extra) => { const ps = []; return Object.assign({ waitUntil: (p) => ps.push(p), done: () => Promise.all(ps) }, extra); };
  // A browser-drawn copy of a call push and the worker's own ring, for call A; an alert for call B.
  shown.push(new Note('Alice is calling', { tag: 'naluno-call:callA', data: { FCM_MSG: { data: { type: 'incoming_call', callId: 'callA' } } } }));
  shown.push(new Note('Old style', { tag: 'naluno-wire::', data: { FCM_MSG: { data: { type: 'incoming_call' } } } }));
  shown.push(new Note('Bob is calling', { tag: 'naluno-call:callB', data: { type: 'incoming_call', callId: 'callB' } }));
  shown.push(new Note('Hi', { tag: 'naluno-wire:u:m', data: { type: 'wireline' } }));
  let e = ev({ data: { type: 'naluno-call-handled', callId: 'callA' } });
  handlers.message(e); await e.done();
  assert.deepStrictEqual(shown.map((n) => n.tag).sort(), ['naluno-call:callB', 'naluno-wire:u:m'], 'answering call A takes down its alerts only');
  // A late push for the answered call: drawn by Firebase while the worker runs.
  e = ev({ data: { json: () => ({ data: { type: 'incoming_call', callId: 'callA', title: 'Alice is calling' } }) } });
  handlers.push(e);
  shown.push(new Note('Alice is calling', { tag: 'naluno-call:callA', data: { FCM_MSG: { data: { type: 'incoming_call', callId: 'callA' } } } }));
  await e.done();
  assert.ok(!shown.some((n) => n.tag === 'naluno-call:callA'), 'a late push for an answered call does not stay on screen');
  assert.ok(shown.some((n) => n.tag === 'naluno-call:callB'), 'another call keeps ringing');
  // Answer on the notification answers (and opens the app when it is closed).
  const box2 = box.self.clients.matchAll;
  box.self.clients.matchAll = async () => [];
  const n = new Note('Bob is calling', { tag: 'naluno-call:callB', data: { type: 'incoming_call', callId: 'callB' } });
  e = ev({ notification: n, action: 'answer' });
  handlers.notificationclick(e); await e.done();
  assert.ok(opened.some((u) => u === '/app/?call=callB&answer=1'), 'Answer opens the app with answer=1');
  box.self.clients.matchAll = box2;
  e = ev({ notification: new Note('Carol is calling', { tag: 'naluno-call:callC', data: { type: 'incoming_call', callId: 'callC' } }), action: 'answer' });
  handlers.notificationclick(e); await e.done();
  assert.ok(posted.some((m) => m.type === 'naluno-incoming-call' && m.callId === 'callC' && m.answer === true), 'an open app is told to answer');
  e = ev({ notification: new Note('Dan is calling', { tag: 'naluno-call:callD', data: { type: 'incoming_call', callId: 'callD' } }), action: '' });
  handlers.notificationclick(e); await e.done();
  assert.ok(posted.some((m) => m.type === 'naluno-incoming-call' && m.callId === 'callD' && m.answer === false), 'opening the alert itself only shows the ring');

  /* 3. The web push for a call carries its own tag and call id. */
  const wn = await import(path.join(root, 'workers/economy/wire-notify.mjs'));
  const callPush = wn.webPushFor({ type: 'incoming_call', callId: 'abc_1', title: 'Alice is calling', body: 'Tap' });
  assert.strictEqual(callPush.notification.tag, 'naluno-call:abc_1');
  assert.deepStrictEqual(callPush.notification.data, { type: 'incoming_call', callId: 'abc_1', url: '/app/?call=abc_1' });
  assert.strictEqual(callPush.fcm_options.link, 'https://getnaluno.com/app/?call=abc_1');
  assert.strictEqual(callPush.headers.TTL, '60', 'a late ring is not delivered');
  const wirePush = wn.webPushFor({ type: 'wireline', fromUid: 'u1', clientMsgId: 'm1', title: 'Hi' });
  assert.strictEqual(wirePush.notification.tag, 'naluno-wire:u1:m1', 'messages are unchanged');
  assert.ok(!wirePush.fcm_options, 'messages are unchanged');

  /* 4. Answer / Decline pressed outside the app finish the job, and a call
        opened from a closed app waits for sign-in instead of being dropped. */
  assert.ok(/function nalunoAnswerIncoming\(callId\)/.test(calls) && /window\.nalunoAnswerIncoming = nalunoAnswerIncoming/.test(calls));
  const hip = fnSource(pwa, 'handleIncomingCallFromPush');
  assert.ok(/await nalunoCallReady\(/.test(hip), 'waits for sign-in');
  assert.ok(!/if\(!callId \|\| !fbDb \|\| !currentUser\) return;/.test(hip), 'no longer dropped before sign-in');
  assert.ok(/action === 'answer'[\s\S]*nalunoAnswerIncoming\(callId\)/.test(hip) && /declineIncomingCall\(callId\)/.test(hip));
  assert.ok(/params\.get\('answer'\) === '1'/.test(pwa), 'answer=1 on the link answers');
  assert.ok(/takePendingCall/.test(pwa));
  const main = read('MainActivity.java');
  const ica = read('IncomingCallActivity.java');
  assert.ok(/launch\.putExtra\("callAction", "answer"\)/.test(ica) && /MainActivity\.rememberCallAction\(callId, "answer"\)/.test(ica), 'native Answer says answer');
  assert.ok(/MainActivity\.relayDecline\(callId\)/.test(ica), 'native Decline reaches the caller');
  assert.ok(/public String takePendingCall\(\)/.test(main) && /@JavascriptInterface\s+public String takePendingCall/.test(main));
  assert.ok(/getStringExtra\("callAction"\)/.test(main));

  /* 5. A blocked remote voice is not silent: the next touch starts it. */
  assert.ok(/p\.catch\(function\(err\)\{ nalunoVoiceBlocked\(a, err\); \}\)/.test(fnSource(calls, 'nalunoHearRemote')));
  assert.ok(/Tap the screen to hear the call/.test(calls));
  assert.ok(/nalunoVoiceUnblockOff\(\)/.test(fnSource(calls, 'nalunoStopRemoteAudio')), 'the wait ends with the call');

  /* 6. A blocked microphone is not reported as "no connection", and the
        caller is told why the call ended. */
  const friendly = new Function(fnSource(core, 'nalunoFriendlyError') + '; return nalunoFriendlyError;')();
  assert.strictEqual(friendly('Microphone unavailable — allow access, then try answering again'), 'Microphone unavailable — allow access, then try answering again');
  assert.strictEqual(friendly('Failed to fetch'), 'No connection right now — try again in a moment.');
  assert.strictEqual(friendly('FirebaseError: [code=unavailable]: The service is currently unavailable.'), 'No connection right now — try again in a moment.');
  assert.strictEqual(friendly('Missing or insufficient permissions.'), '');
  assert.ok(/endReason: \(e && e\.nalunoMedia\) \? 'callee-media' : 'answer-failed'/.test(calls));
  assert.ok(/d\.endReason === 'callee-media' \? 'They could not turn on their microphone'/.test(calls));

  /* 7. Private Broadcasts: the list is not replaced by a 40-row read. */
  const lmb = fnSource(bcore, 'loadMyBroadcasts');
  assert.ok(!/\.limit\(40\)/.test(lmb) && !/myBroadcasts = snap\.docs/.test(lmb), 'no truncating overwrite');
  assert.ok(/startMyBroadcastsListener\(\)/.test(lmb));
  const merge = new Function(fnSource(bcore, 'nalunoMergeOwnerBroadcasts') + '; return nalunoMergeOwnerBroadcasts;')();
  const out = merge([{ id: 'a', visibility: 'private', createdAt: 1 }], [{ id: 'b', visibility: 'private', creatorUid: 'u' }], 10, [], 'u');
  assert.deepStrictEqual(out.list.map((b) => b.id).sort(), ['a', 'b'], 'a private pin survives a snapshot that has not got it yet');

  /* 8. Public catalogue: bounded by the server clock, never by this phone's. */
  assert.ok(!/where\('publishAt', '<=', Date\.now\(\)\)/.test(bcore), 'no query bounded by the phone clock');
  assert.ok(!/const bound = Date\.now\(\);/.test(bcore));
  const sandbox = { Date: { now: () => 1_000_000_000 }, window: {}, nalunoServerSkew: undefined };
  const catNow = vm.runInNewContext('var nalunoServerSkew = S; ' + fnSource(bcore, 'nalunoCatalogueNow') + '; nalunoCatalogueNow()', Object.assign({}, sandbox, { S: 120000, isFinite }));
  assert.strictEqual(catNow, 1_000_000_000 + 120000 - 60000, 'server clock minus a minute');
  const catNow2 = vm.runInNewContext('var nalunoServerSkew = null; ' + fnSource(bcore, 'nalunoCatalogueNow') + '; nalunoCatalogueNow()', Object.assign({}, sandbox, { isFinite }));
  assert.strictEqual(catNow2, 1_000_000_000 - 300000, 'unknown skew: five minutes back');
  const lfb = fnSource(bcore, 'loadFeedBroadcasts');
  assert.ok(!/contacts \|\| \[\]\)\.forEach/.test(lfb), 'no refused read of connections by creator');
  const chan = fnSource(bcore, 'openBroadcastChannel');
  assert.ok(/if\(!own\)\{[\s\S]*where\('listed', '==', true\)[\s\S]*where\('publishAt', '<=', nalunoCatalogueNow\(\)\)/.test(chan), 'someone else\'s channel lists their public Broadcasts');
  const idx = JSON.parse(read('firestore.indexes.json')).indexes;
  assert.ok(idx.some((i) => i.collectionGroup === 'broadcasts' && i.fields.map((f) => f.fieldPath).join(',') === 'creatorUid,listed,hidden,held,visibility,publishAt'), 'index for the channel read');

  /* 9. Private → public goes through the worker, so it is listed (or reviewed). */
  const sbe = fnSource(bcore, 'saveBroadcastEdits');
  assert.ok(/nalunoPlaceBroadcast\(id, null\)/.test(sbe));

  /* 10. Older public Broadcasts: the console restore adds only missing fields. */
  const admin = read('js/admin-console.js');
  const patchFn = new Function(fnSource(admin.replace(/\n  /g, '\n'), 'legacyCatMs') + '\n' + fnSource(admin.replace(/\n  /g, '\n'), 'legacyCatPatch') + '; return legacyCatPatch;')();
  const NOW = 1_700_000_000_000;
  assert.deepStrictEqual(patchFn({ title: 'old', createdAt: NOW - 5 }, NOW), { visibility: 'public', listed: true, hidden: false, held: false, publishAt: NOW - 5 });
  assert.deepStrictEqual(patchFn({ visibility: 'public', createdAt: { toMillis: () => NOW - 9 } }, NOW), { listed: true, hidden: false, held: false, publishAt: NOW - 9 });
  assert.deepStrictEqual(patchFn({ visibility: 'public', listed: true, hidden: false, held: false, publishAt: { seconds: 1000 }, createdAt: NOW - 1 }, NOW), { publishAt: 1000000 }, 'a date publishAt keeps its moment');
  assert.strictEqual(patchFn({ visibility: 'private', createdAt: 1 }, NOW), null);
  assert.strictEqual(patchFn({ held: true, createdAt: 1 }, NOW), null);
  assert.strictEqual(patchFn({ hidden: true, createdAt: 1 }, NOW), null);
  assert.strictEqual(patchFn({ listed: false, createdAt: 1 }, NOW), null);
  assert.strictEqual(patchFn({ deleted: true, createdAt: 1 }, NOW), null);
  assert.strictEqual(patchFn({ visibility: 'public', listed: true, hidden: false, held: false, publishAt: 5 }, NOW), null, 'a complete Broadcast is left alone');
  assert.strictEqual(patchFn({ title: 'no time' }, NOW), null, 'no time to give it: left for a person');
  assert.strictEqual(patchFn({ createdAt: NOW + 60000 }, NOW), null, 'a future one is not published early');
  assert.ok(/writeAudit\('broadcast-catalogue-restore'/.test(admin) && admin.indexOf("writeAudit('broadcast-catalogue-restore'") < admin.indexOf("batch.set(db.collection('broadcasts')"), 'the audit is written before anything changes');

  /* 11. Phones fetch the fixed files. */
  const html = read('app/index.html');
  ['calls.js', 'pwa.js', 'core.js', 'broadcast-core.js', 'signal-ui.js'].forEach((f) => assert.ok(html.includes('/js/' + f + '?v=20261012a'), f + ' stamp'));
  assert.ok(/CACHE_NAME = 'naluno-shell-v3\d\d'/.test(sw));
  console.log('fixes-1012a tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
