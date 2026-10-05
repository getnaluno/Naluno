/* 05 Oct (f): the floating call starts by itself where the phone allows it,
   Wireline alerts reach the other phone, a call is answered once per tap,
   and every way a call ends stands the floating window down. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const flush = () => new Promise((r) => setImmediate(r));

(async function () {
  /* ---------- 1. Android app: the bridge exists before the page loads ---------- */
  {
    const main = read('MainActivity.java');
    const onCreate = main.slice(main.indexOf('protected void onCreate'), main.indexOf('private void interceptSystemSplash'));
    assert.ok(onCreate.indexOf('addNativeBridgeNow();') > 0, 'the bridge is added in onCreate');
    assert.ok(onCreate.indexOf('addNativeBridgeNow();') < onCreate.indexOf('injectKeepAliveBridge();'), 'before the delayed one');
    const now = main.slice(main.indexOf('private void addNativeBridgeNow'), main.indexOf('private void injectKeepAliveBridge'));
    assert.ok(/addJavascriptInterface\(new KeepAliveBridge\(\), "NalunoNative"\)/.test(now) && !/postDelayed/.test(now), 'synchronously, no delay');
    const armed = main.slice(main.indexOf('private void setCallArmed'), main.indexOf('private void requestCallFocus'));
    assert.ok(/moveTaskToBack\(true\)/.test(armed), 'a call that ends while floating closes the window quietly');
    assert.ok(/setAutoEnterEnabled\(autoEnter && callArmed\)/.test(main) && /onUserLeaveHint/.test(main), 'auto-enter (Android 12+) and leave-hint (older) still there');
    const manifest = read('AndroidManifest.xml');
    assert.ok(/supportsPictureInPicture="true"/.test(manifest), 'the activity may float');
  }

  /* ---------- 2. Web: the call screen is never forced into full screen ----------
     (05 Oct g) Android Chrome does not float a call's live video when you
     leave, even in full screen; the full-screen attempt is removed. Float
     (a tap) still floats both of you; iPhone gets Apple's own call too. */
  {
    const pipSrc = read('js/call-pip.js');
    assert.ok(!/requestFullscreen/.test(pipSrc), 'no full screen on Answer or Call');
    assert.ok(/webkitSetPresentationMode\('picture-in-picture'\)/.test(pipSrc), 'Float works on iPhones without the standard call');
    assert.ok(/setActionHandler\('enterpictureinpicture'/.test(pipSrc), 'desktop automatic float unchanged');
  }

  /* ---------- 3. Calls ---------- */
  const calls = read('js/calls.js');
  {
    const td = calls.slice(calls.indexOf('function teardownCallConnection(){'), calls.indexOf('function teardownCallConnection(){') + 600);
    assert.ok(/nalunoPip\.disarm\(\)/.test(td), 'every end of a call (also the other person hanging up) disarms the floating window');
    const acc = calls.slice(calls.indexOf("$('acceptIncoming').onclick = "), calls.indexOf("$('acceptIncoming').onclick = ") + 2600);
    assert.ok(/ev\.type === 'click' && b && b\._nalunoAnswerAt && Date\.now\(\) - b\._nalunoAnswerAt < 1500/.test(acc), 'the click after the answering pointerup is ignored');
    assert.ok(/nalunoAnsweredId === activeCallId\) return;/.test(acc) && /nalunoAnsweredId = acceptingId;/.test(acc), 'a call is answered once');
  }

  /* ---------- 4. Wireline alerts ---------- */
  {
    const src = read('js/wireline.js');
    const a = src.indexOf('function wirePreviewForPush');
    const b = src.indexOf('function nalunoOpenWireFromPush');
    async function run(responses) {
      const calls = [];
      const box = {
        console: { warn() {}, log() {} }, JSON, Promise, String, Date, Math,
        currentUser: { uid: 'me', getIdToken: async () => 'tok' },
        currentProfile: { name: 'Me Myself' },
        fbDb: { collection: () => ({ doc: () => ({ get: async () => ({ exists: true, data: () => ({ fcmTokenWeb: 'w' }) }) }) }) },
        CALL_NOTIFY_WORKER_URL: 'https://notify.example',
        fetch: async (url, init) => { calls.push({ url, body: JSON.parse(init.body) }); const r = responses.shift() || { status: 200, body: {} }; if (r.throw) throw new Error('offline'); return { ok: r.status < 300, status: r.status, json: async () => r.body }; },
      };
      box.window = box;
      vm.createContext(box);
      vm.runInContext(src.slice(a, b) + '\nthis.n = notifyWirelinePush; this.p = wirePreviewForPush;', box);
      box.n({ firebaseUid: 'them' }, { type: 'text', text: 'my secret words' }, 'my secret words', 'c1-abc');
      for (let i = 0; i < 10; i++) await flush();
      return { calls, box };
    }
    let r = await run([{ status: 200, body: { ok: true, sent: 2 } }]);
    assert.strictEqual(r.calls.length, 1, 'Naluno\'s worker sent it: no second route');
    assert.ok(/\/v1\/wire\/notify$/.test(r.calls[0].url));
    assert.deepStrictEqual(r.calls[0].body, { to: 'them', clientMsgId: 'c1-abc' }, 'only who and which message; the server builds the alert');
    r = await run([{ status: 404, body: {} }, { status: 200, body: { sent: true } }]);
    assert.strictEqual(r.calls.length, 2, 'worker not deployed yet: the old route still alerts');
    assert.strictEqual(r.calls[1].body.type, 'wireline');
    assert.strictEqual(r.calls[1].body.body, 'New message', 'and it says what kind, never the words');
    assert.ok(!JSON.stringify(r.calls).includes('secret'), 'message text never leaves for the push service');
    r = await run([{ throw: true }, { status: 200, body: {} }]);
    assert.strictEqual(r.calls.length, 2, 'offline worker: old route');
    r = await run([{ status: 403, body: { error: 'not connected' } }]);
    assert.strictEqual(r.calls.length, 1, 'refused by the server: not retried elsewhere');
    r = await run([{ status: 200, body: { ok: true, sent: 0, reason: 'no_token' } }]);
    assert.strictEqual(r.calls.length, 1, 'no phone to reach: nothing more to try');
    assert.strictEqual(r.box.p({ type: 'voice' }), 'Voice message');
    assert.strictEqual(r.box.p({ type: 'photo' }), 'Photo');
  }

  /* ---------- 5. Luganda recordings start again ---------- */
  {
    const ear = read('js/lg-ear.js');
    const factory = ear.slice(ear.indexOf('function () {'));
    assert.ok(!/\broot\.fbDb\b/.test(factory), 'no reference to the wrapper\'s root inside the module');
    const box = { window: {}, console, setTimeout: () => 0, module: undefined };
    box.globalThis = box;
    vm.createContext(box);
    vm.runInContext(ear, box);
    assert.ok(box.window.NalunoLgEar && typeof box.window.NalunoLgEar.plan === 'function', 'the module loads before the database is ready');
  }

  /* ---------- 6. Release stamps ---------- */
  {
    const html = read('app/index.html');
    ['calls.js', 'call-pip.js', 'wireline.js', 'lg-ear.js'].forEach((f) => {
      const m = html.match(new RegExp('/js/' + f.replace(/[.-]/g, '\\$&') + '\\?v=(\\d{8}[a-z])'));
      assert.ok(m && m[1] >= '20261005f', f + ' stamp');
    });
    assert.ok((read('sw.js').match(/APP_BUILD = '(\d{8}[a-z])'/) || [])[1] >= '20261005f');
  }
  console.log('fixes-1005f tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
