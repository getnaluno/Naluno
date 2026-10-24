/* 24 Oct a: the call keeps its camera and mic; the console opens fast;
   every app script is precached. Browser behaviour: gate flows
   call-camera, console-open; worker: workers/economy/console-speed.test.mjs. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const R = path.resolve(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(R, f), 'utf8');
let n = 0;
const t = (name, fn) => { fn(); n++; console.log('ok ' + n + ' - ' + name); };
const calls = read('js/calls.js');
const seg = (src, from, to) => src.slice(src.indexOf(from), src.indexOf(to, src.indexOf(from)));

t('the media guard starts when a call goes live and stops with it', () => {
  const live = seg(calls, 'function nalunoMarkCallLive', 'let remoteVideoGoneSince');
  assert.ok(/nalunoMediaGuard\(activeCallId\)/.test(live));
  const g = seg(calls, 'function nalunoMediaGuard', 'function preferFastVideoCodecs');
  assert.ok(/if\(activeCallId !== callId\)\{ clearInterval\(nalunoGuardTimer\)/.test(g), 'ends with the call');
  assert.ok(/nalunoHeld\(pc\)\) return;/.test(g), 'never while ringing (held)');
  assert.ok(/if\(!nalunoIsVoiceCall\(\)\) await step\('video'/.test(g), 'a voice call never opens a camera');
  assert.ok(/document\.hidden \|\| now < s\.nextAt \|\| s\.tries >= NALUNO_GUARD_TRIES/.test(g), 'never reopens in the background; tries are capped');
  assert.ok(/window\.__flipBusy/.test(g), 'leaves a flip in progress alone');
});
t('a camera switched off stays off; a muted mic stays muted', () => {
  const r = seg(calls, 'function nalunoRepointSenders', 'async function nalunoReopenCallCamera');
  assert.ok(/t\.enabled = \(typeof camOn === 'undefined'\) \? true : camOn !== false/.test(r));
  assert.ok(/t\.enabled = \(typeof micOn === 'undefined'\) \? true : micOn !== false/.test(r));
  const c = seg(calls, 'async function nalunoReopenCallCamera', 'async function nalunoReopenCallMic');
  assert.ok(/camOn !== false/.test(c) && /nalunoOpenLensVideoOnly\(facing\)/.test(c), 'the same lens, opened the locked way');
  assert.ok(/if\(activeCallId !== callId \|\| !peerConnection \|\| window\.__flipBusy\)\{\s*try\{ v\.getTracks\(\)\.forEach\(function\(t\)\{ t\.stop\(\); \}\); \}catch\(_\)\{\}/.test(c), 'a camera that arrives after the call ended is switched off');
});
t('the guard lives in calls.js; camera.js only hands a fallback camera over (approved 24b)', () => {
  const cam = read('js/camera.js');
  assert.ok(!/nalunoMediaGuard/.test(cam));
  assert.strictEqual((cam.match(/nalunoRepointSenders/g) || []).length, 4, 'two guarded calls (typeof check + call), see CAMERA-LOCK.md 24b');
});
t('lost camera / mic are measured (counts only)', () => {
  assert.ok(/camlost: \(out\.kind !== 'audio' && outcome === 'connected'\) \? \(q\.cam \|\| 'none'\) : undefined/.test(calls));
  assert.ok(/camlost: one\(\["none", "recovered", "lost"\]\), miclost: one\(\["none", "recovered", "lost"\]\)/.test(read('workers/economy/measure.mjs')));
});
t('console: opens as soon as the worker accepts the password; the copies sync behind it', () => {
  const c = read('js/admin-console.js');
  const u = seg(c, 'async function adminUnlock', 'async function setRecoveryCode');
  const yes = u.slice(u.indexOf('if (workerVerdict === true) {'), u.indexOf('} else {', u.indexOf('if (workerVerdict === true) {')));
  assert.ok(/\(async function \(\) \{/.test(yes) && !/^\s*try \{ localSet\(uid, await hashLocal/m.test(yes.split('(async function')[0]), 'the sync is not awaited');
  const no = u.slice(u.indexOf('const typedHash = await hashLocal(uid, typed);'));
  assert.ok(/if \(!okCloud && !okLocal && !okDesk\) \{/.test(no), 'without the worker, the copies are still checked before opening');
});
t('console: the same-site relay is only used when the service worker is in charge', () => {
  const c = read('js/admin-console.js');
  assert.ok(/const relayed = !!\(navigator\.serviceWorker && navigator\.serviceWorker\.controller\);\s*if \(relayed && location && location\.origin\) bases\.unshift/.test(c));
});
t('worker: password copies and the lock-out state are read together; a right password writes nothing', () => {
  const w = read('workers/economy/handler.mjs');
  assert.ok(/const got = await Promise\.all\(attempts\.map\(/.test(w));
  assert.ok(/const \[recs\] = await Promise\.all\(\[\s*collectPasswordRecords/.test(w));
  assert.ok(/if \(gate\.fails \|\| gate\.lockUntil \|\| gate\.lastWrong\) \{\s*await saveGateState/.test(w));
});
t('every script the app page loads is precached', () => {
  const sw = read('sw.js');
  const list = [...sw.match(/const CORE_ASSETS = \[([\s\S]*?)\];/)[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
  const used = [...read('app/index.html').matchAll(/src="(\/js\/[^"?]+)/g)].map((x) => x[1]);
  const missing = used.filter((u) => !list.includes(u));
  assert.deepStrictEqual(missing, []);
  list.forEach((u) => { let f = u.replace(/^\//, ''); if (!f || f.endsWith('/')) f += 'index.html'; assert.ok(fs.existsSync(path.join(R, f)), 'precached file exists: ' + u); });
});
console.log('1..' + n);
