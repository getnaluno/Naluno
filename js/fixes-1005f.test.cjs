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

  /* ---------- 2. Web: Android Chrome goes full screen on the call tap ---------- */
  const pipSrc = read('js/call-pip.js');
  function pipBox(ua, opts = {}) {
    const listeners = {};
    const els = {};
    function el(id) {
      if (!els[id]) {
        const attrs = {};
        els[id] = {
          id, srcObject: opts.remote ? {} : null, disablePictureInPicture: false, muted: false, classList: { contains: () => !!opts.live, toggle() {}, remove() {}, add() {} },
          setAttribute(k, v) { attrs[k] = v; }, removeAttribute(k) { delete attrs[k]; }, attrs,
          play() { return Promise.resolve(); }, addEventListener() {}, getBoundingClientRect: () => ({ width: 50, height: 50 }),
        };
      }
      return els[id];
    }
    const doc = {
      fullscreenElement: null, hidden: false, readyState: 'complete', body: { classList: { contains: () => false, toggle() {}, remove() {} }, appendChild() {} },
      documentElement: opts.noFullscreen ? {} : { requestFullscreen(o) { doc.fullscreenElement = doc.documentElement; doc.fsOpts = o; return Promise.resolve(); } },
      exitFullscreen() { doc.fullscreenElement = null; return Promise.resolve(); },
      getElementById: el,
      addEventListener(k, fn, cap) { (listeners[k] = listeners[k] || []).push(fn); },
      createElement: () => ({ style: {}, setAttribute() {}, addEventListener() {}, getContext: () => null, play: () => Promise.resolve() }),
    };
    const box = {
      document: doc, navigator: { userAgent: ua, mediaSession: null, mediaDevices: null }, console,
      setInterval() { return 0; }, clearInterval() {}, setTimeout, MutationObserver: undefined,
      incallIsLive: () => !!opts.live, nalunoIsVoiceCall: () => !!opts.voice,
      addEventListener() {},
    };
    box.window = box;
    if (opts.native) box.NalunoNative = { armCallPip() {}, enterCallPipNow() {}, updateCallPip() {} };
    vm.createContext(box);
    vm.runInContext(pipSrc, box);
    box.listeners = listeners; box.el = el;
    box.tap = (id) => { const target = { closest: (sel) => (sel.split(',').map((x) => x.trim().replace('#', '')).indexOf(id) >= 0 ? el(id) : null) }; (listeners.click || []).forEach((fn) => fn({ target, preventDefault() {} })); };
    return box;
  }
  const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Mobile Safari/537.36';
  const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
  const DESKTOP = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36';
  {
    const a = pipBox(ANDROID, { live: true, remote: true });
    assert.strictEqual(a.nalunoPip.androidWeb(), true);
    a.tap('acceptIncoming');
    assert.ok(a.document.fullscreenElement, 'Answer on Android Chrome goes full screen');
    assert.strictEqual(JSON.stringify(a.document.fsOpts), JSON.stringify({ navigationUI: 'hide' }));
    a.nalunoPip.arm();
    assert.strictEqual(a.el('remoteVideo').disablePictureInPicture, false, 'the other person\'s picture may float on Android');
    a.nalunoPip.disarm();
    await flush();
    assert.strictEqual(a.document.fullscreenElement, null, 'the end of the call leaves full screen');
    assert.strictEqual(a.el('remoteVideo').disablePictureInPicture, true, 'and locks the picture again');
    a.tap('joinBtn');
    assert.ok(a.document.fullscreenElement, 'calling from the lobby too');
    a.nalunoPip.disarm(); await flush();
    a.tap('endBtn');
    assert.strictEqual(a.document.fullscreenElement, null, 'End never goes full screen');
  }
  {
    const v = pipBox(ANDROID, { live: true, voice: true });
    v.tap('acceptIncoming');
    assert.strictEqual(v.document.fullscreenElement, null, 'a voice call stays as it is');
    const i = pipBox(IPHONE, { live: true });
    assert.strictEqual(i.nalunoPip.androidWeb(), false);
    i.tap('acceptIncoming');
    assert.strictEqual(i.document.fullscreenElement, null, 'iPhone untouched');
    const d = pipBox(DESKTOP, { live: true });
    d.tap('acceptIncoming');
    assert.strictEqual(d.document.fullscreenElement, null, 'desktop untouched (it has its own automatic route)');
    const n = pipBox(ANDROID, { live: true, native: true });
    n.tap('acceptIncoming');
    assert.strictEqual(n.document.fullscreenElement, null, 'the Android app uses the system window, not full screen');
    const old = pipBox(ANDROID, { live: true, noFullscreen: true });
    old.tap('acceptIncoming');
    assert.strictEqual(old.nalunoPip.androidWeb(), false, 'no Fullscreen API: nothing');
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
    assert.ok(/APP_BUILD = '20261005f'/.test(read('sw.js')));
  }
  console.log('fixes-1005f tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
