/* CAMERA LOCK (08 Oct a)
   The owner's rule: a video call's camera starts at the right size, stays
   that way, and both people see each other full screen (WhatsApp style).
   This test fingerprints every piece of code that decides the camera's
   size and shape: what is asked of the camera, how a lens is opened and
   settled, how the picture is fitted on both phones, and the CSS of the
   call screens' video boxes.

   If this test fails, a change touched the camera's dimensions. Do not
   update the fingerprints to make it pass. Undo the change, or get the
   owner's explicit go-ahead first, then record the new fingerprints in
   CAMERA-LOCK.md together with the reason. */
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

function fnSource(src, name, file) {
  const re = new RegExp('(^|\\n)(async )?function ' + name + '\\(');
  const m = re.exec(src);
  assert.ok(m, 'CAMERA LOCK: ' + file + ' must still define ' + name + '()');
  const i = m.index + m[1].length;
  let depth = 0;
  for (let k = src.indexOf('{', i); k < src.length; k++) {
    if (src[k] === '{') depth++;
    else if (src[k] === '}') { depth--; if (depth === 0) return src.slice(i, k + 1); }
  }
  throw new Error('CAMERA LOCK: could not read ' + name);
}
/* Every CSS rule whose selector names one of the keys, with the @media it
   sits in. Comments are dropped first; selectors may span several lines. */
function cssBlocks(css, keys) {
  const src = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const out = [];
  const stack = [];
  let buf = '';
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (ch === '{') {
      const head = buf.trim(); buf = '';
      const end = (function () { let d = 1, k = i + 1; for (; k < src.length && d; k++) { if (src[k] === '{') d++; else if (src[k] === '}') d--; } return k; })();
      if (/^@(media|supports|container|layer)/.test(head)) { stack.push(head); continue; }
      const body = src.slice(i + 1, end - 1);
      if (!/^@/.test(head) && keys.some((k) => head.includes(k))) out.push(stack.join(' > ') + ' :: ' + head.replace(/\s+/g, ' ') + ' { ' + body.replace(/\s+/g, ' ').trim() + ' }');
      i = end - 1;
    } else if (ch === '}') {
      stack.pop(); buf = '';
    } else if (ch === ';' && !stack.length && /^\s*@/.test(buf)) {
      buf = '';
    } else {
      buf += ch;
    }
  }
  return out.join('\n');
}
const sha = (s) => crypto.createHash('sha256').update(s.replace(/\r\n/g, '\n')).digest('hex').slice(0, 16);

const cam = read('js/camera.js');
const calls = read('js/calls.js');
const filters = read('js/call-filters.js');
const css = read('css/app.css');

const LOCKED = {
  'camera: what is asked of the camera': ['nalunoIsPortraitDevice', 'nalunoTouchDevice', 'nalunoCameraPortrait', 'nalunoCameraBox', 'nalunoHdVideo', 'buildVideoConstraints', 'nalunoLensConstraint', 'nalunoRaiseToHd', 'nalunoSensorTarget', 'nalunoSensorConstraint', 'nalunoShapeRatio', 'nalunoHoldsSensor', 'nalunoUnzoom']
    .map((n) => fnSource(cam, n, 'camera.js')).join('\n'),
  'camera: how a lens is opened and settled': ['nalunoOpenLensVideoOnly', 'resolveCameraDeviceId', 'nalunoLensDeviceId', 'flipCamera', 'nalunoLensAttempts', 'nalunoSwitchLens', 'nalunoMarkLensTrack', 'nalunoLensShapeOk', 'nalunoWatchLensShape', 'nalunoSettleCallCamera', 'enableCameraForCall']
    .map((n) => fnSource(cam, n, 'camera.js')).join('\n'),
  'camera: how your own picture is drawn and sent': ['drawVideoFit', 'ensureCanvasSize', 'nalunoCompositeFit', 'nalunoAspectNeedsPortrait', 'compositeFrame', 'drawSendCanvas', 'nalunoFitLocalPip']
    .map((n) => fnSource(cam, n, 'camera.js')).join('\n'),
  'calls: the callee\'s camera when answering': fnSource(calls, 'ensureCallMediaReady', 'calls.js'),
  'calls: the other person full screen': (calls.match(/const NALUNO_REMOTE_MIN_SHOWN = [^;]+;/) || [''])[0] + '\n'
    + ['nalunoRemoteFit', 'nalunoFitRemoteVideo'].map((n) => fnSource(calls, n, 'calls.js')).join('\n'),
  'call-filters: which picture is sent': ['nalunoOutboundPortrait'].map((n) => fnSource(filters, n, 'call-filters.js')).join('\n'),
  'css: the call screens\' video boxes': cssBlocks(css, ['#remoteVideo', 'remote-stage', 'local-pip', '#localPip', 'pipStageCanvas', 'camStageCanvas', 'ringStageCanvas', 'pipRawVideo', 'incomingSelfVideo', 'data-cam']),
};

/* The fingerprints the owner approved. Change only with the owner's say-so
   (see CAMERA-LOCK.md). */
const APPROVED = {
  'camera: what is asked of the camera': '8d001c6f9432afbf',
  'camera: how a lens is opened and settled': 'f192ae09b5414b78',
  'camera: how your own picture is drawn and sent': 'e4da395a687a323f',
  'calls: the callee\'s camera when answering': '3292560e2d07fe76',
  'calls: the other person full screen': '36dd629ead2d348f',
  'call-filters: which picture is sent': '1810339c30833026',
  'css: the call screens\' video boxes': '3abe95f60d635d27',
};

if (process.env.CAMERA_LOCK_PRINT) {
  Object.keys(LOCKED).forEach((k) => console.log(k + ' = ' + sha(LOCKED[k])));
  process.exit(0);
}
Object.keys(APPROVED).forEach((k) => {
  assert.strictEqual(sha(LOCKED[k]), APPROVED[k],
    'CAMERA LOCK: "' + k + '" changed. The call camera\'s size is locked by the owner. Undo the change, or get the owner\'s go-ahead and record it in CAMERA-LOCK.md.');
});

/* The behaviour the lock protects, checked in words too. */
const camPortrait = new Function('window', 'navigator', 'screen', fnSource(cam, 'nalunoIsPortraitDevice', 'camera.js') + fnSource(cam, 'nalunoTouchDevice', 'camera.js') + fnSource(cam, 'nalunoCameraPortrait', 'camera.js') + '; return nalunoCameraPortrait();');
const phone = (w, h, orient) => camPortrait({ innerWidth: w, innerHeight: h, matchMedia: () => ({ matches: false }) }, { maxTouchPoints: 5 }, { orientation: { type: orient } });
assert.strictEqual(phone(393, 852, 'landscape-primary'), true, 'an upright phone whose report says landscape for a moment: still asks 3:4 (the zoom bug)');
assert.strictEqual(phone(393, 300, 'portrait-primary'), true, 'keyboard up: still upright');
assert.strictEqual(phone(852, 393, 'landscape-primary'), false, 'a phone held sideways');
const laptop = camPortrait({ innerWidth: 800, innerHeight: 1000, matchMedia: () => ({ matches: false }) }, { maxTouchPoints: 0 }, { orientation: { type: 'landscape-primary' } });
assert.strictEqual(laptop, false, 'a computer keeps the old test');
const box = fnSource(cam, 'nalunoCameraBox', 'camera.js');
assert.ok(box.includes("'1440': [1440, 1080, 4/3]") && !/9\/16/.test(box), 'a phone asks for the whole 4:3 sensor in its own terms, never an upright slice');

/* 08d: THE UNIFORM RULE, proved on a catalogue of phone cameras.
   A phone browser reads constraints in the sensor's landscape terms and
   picks the closest mode by the standard fitness distance (a native mode,
   or one cropped-and-scaled from a bigger mode). "FOV" is how much of the
   sensor ends up in the picture: 1 means nothing cut off. The first
   request, and the measured whole-sensor request, must give 1 on every
   phone below, or the camera is zoomed on that phone. */
const PHONES = {
  'has 1440x1080':   { sensor: [4032, 3024], modes: [[4032, 3024], [1920, 1440], [1920, 1080], [1440, 1080], [1280, 720], [640, 480]] },
  'square mode':     { sensor: [3264, 2448], modes: [[3264, 2448], [1920, 1080], [1088, 1088], [1280, 720], [640, 480]] },
  'wide 4K modes':   { sensor: [4000, 3000], modes: [[4000, 3000], [3840, 2160], [1920, 1080], [1280, 960], [720, 720], [640, 480]] },
  '16:9 sensor':     { sensor: [1920, 1080], modes: [[1920, 1080], [1280, 720], [640, 360]] },
  'reads upright':   { sensor: [4032, 3024], modes: [[4032, 3024], [1920, 1440], [1920, 1080], [1440, 1080], [1280, 720], [640, 480]], upright: true },
  'modes reordered': { sensor: [4000, 3000], modes: [[1920, 1080], [1280, 720], [4000, 3000], [640, 480]] },
  'no mid 4:3 mode': { sensor: [4000, 3000], modes: [[4000, 3000], [1920, 1080], [1280, 720], [640, 480]] },
  'mixed maximums':  { sensor: [4032, 3024], modes: [[3264, 2448], [3840, 2160], [1920, 1080], [1440, 1080], [640, 480]], capsMax: [3840, 2448] },
  '4K wider than 4:3': { sensor: [2880, 2160], modes: [[3840, 2160], [2880, 2160], [1920, 1080], [1280, 720], [640, 480]], capsMax: [3840, 2160] },
  'only 12MP or 16:9': { sensor: [4000, 3000], modes: [[4000, 3000], [1920, 1080], [1280, 720]] },
};
function pickMode(phone, c) {
  const v = (k) => (c[k] == null ? null : (typeof c[k] === 'object' ? c[k] : { ideal: c[k] }));
  const W = v('width'), H = v('height'), A = v('aspectRatio'), R = v('resizeMode');
  const d = (a, i) => (a === i ? 0 : Math.abs(a - i) / Math.max(Math.abs(a), Math.abs(i)));
  const cands = [];
  phone.modes.forEach(([w, h]) => {
    const m = phone.upright ? [h, w] : [w, h];
    cands.push({ w: m[0], h: m[1], native: m, crop: false });
    let tw = W && (W.exact || W.ideal), th = H && (H.exact || H.ideal); const ta = A && (A.exact || A.ideal);
    if (tw && !th && ta) th = Math.round(tw / ta);
    if (th && !tw && ta) tw = Math.round(th * ta);
    if (tw && th && tw <= m[0] && th <= m[1]) cands.push({ w: tw, h: th, native: m, crop: true });
  });
  let best = null, bd = 1e9, bt = 1e9;
  cands.forEach((k) => {
    if (A && A.exact && Math.abs(k.w / k.h - A.exact) > 0.01) return;
    if (W && W.max && k.w > W.max) return; if (H && H.max && k.h > H.max) return;
    if (R && R.exact && (R.exact === 'none') === k.crop) return;
    let s = 0;
    if (W && W.ideal) s += d(k.w, W.ideal); if (H && H.ideal) s += d(k.h, H.ideal);
    if (A && A.ideal) s += d(k.w / k.h, A.ideal); if (R && R.ideal) s += (k.crop ? 1 : 0);
    /* Ties go to the mode whose own size is nearest the ask, as in Chrome:
       that is what made a 4:3 cut from the 16:9 mode win. */
    const tie = (W && W.ideal ? d(k.native[0], W.ideal) : 0) + (H && H.ideal ? d(k.native[1], H.ideal) : 0);
    if (s < bd - 1e-9 || (Math.abs(s - bd) < 1e-9 && tie < bt)) { bd = s; bt = tie; best = k; }
  });
  return best;
}
function fovOf(phone, k) {
  const sa = phone.upright ? phone.sensor[1] / phone.sensor[0] : phone.sensor[0] / phone.sensor[1];
  const na = k.native[0] / k.native[1];
  let f = Math.min(sa, na) / Math.max(sa, na);
  if (k.crop) { const oa = k.w / k.h; f *= Math.min(oa, na) / Math.max(oa, na); }
  return f;
}
const lensFn = new Function('navigator', 'window', 'screen',
  'let preferredVideoDeviceId = null; let cameraFacingMode = "user"; const nalunoNo43 = {};\n'
  + ['nalunoIsPortraitDevice', 'nalunoTouchDevice', 'nalunoCameraPortrait', 'nalunoCameraBox', 'nalunoHdVideo', 'nalunoLensConstraint', 'nalunoSensorConstraint', 'nalunoSensorTarget'].map((n) => fnSource(cam, n, 'camera.js')).join('\n')
  + '\nreturn { lens: nalunoLensConstraint, sensor: nalunoSensorConstraint, target: nalunoSensorTarget };');
const fns = lensFn({ maxTouchPoints: 5, userAgent: 'Mozilla/5.0 (Linux; Android 14) Mobile' }, { innerWidth: 393, innerHeight: 852, matchMedia: () => ({ matches: false }) }, { orientation: { type: 'landscape-primary' } });
const laptopFns = lensFn({ maxTouchPoints: 10, userAgent: 'Mozilla/5.0 (Windows NT 10.0)' }, { innerWidth: 1400, innerHeight: 900, matchMedia: (q) => ({ matches: /any-pointer: fine/.test(q) }) }, { orientation: { type: 'landscape-primary' } });
assert.ok(!laptopFns.lens('user').aspectRatio.exact, 'a touch laptop keeps the computer rules (its webcam is 16:9)');
Object.keys(PHONES).forEach((name) => {
  const ph = PHONES[name];
  /* The first ask is right straight away on every 4:3 sensor read the
     usual way (a 16:9 sensor refuses it and the next attempt takes its own
     mode; a browser that reads upright is put right by the measured
     request just after). */
  const firstPick = pickMode(ph, fns.lens('user'));
  /* Refused (no 4:3 mode of its own, or only a 12 MP one) is fine: the
     next attempt is soft and prefers the phone's own modes. A cut-down
     picture is never fine. */
  if (!ph.upright && firstPick) assert.ok(fovOf(ph, firstPick) > 0.99, 'first open, ' + name + ': whole sensor (got ' + Math.round(fovOf(ph, firstPick) * 100) + '%)');
  const mx = ph.capsMax || ph.sensor;
  const capsW = ph.upright ? mx[1] : mx[0], capsH = ph.upright ? mx[0] : mx[1];
  const t = fns.target({ getCapabilities: () => ({ width: { max: capsW }, height: { max: capsH }, resizeMode: ['none', 'crop-and-scale'] }) });
  if (!ph.upright && !firstPick && !t) {
    /* Refused, and no sensor report to go on: the soft attempt must give
       the phone's own mode whole. */
    const soft = Object.assign({}, fns.lens('user')); delete soft.aspectRatio; soft.resizeMode = 'none'; soft.width = { ideal: soft.width.ideal }; soft.height = { ideal: soft.height.ideal };
    const sp = pickMode(ph, soft);
    assert.ok(sp && fovOf(ph, sp) > 0.99, 'soft attempt after a refusal, ' + name + ': the phone\'s own mode, whole (got ' + (sp ? Math.round(fovOf(ph, sp) * 100) : 'refused') + '%)');
  }
  if (ph.capsMax || name === '16:9 sensor') { assert.strictEqual(t, null, name + ': a phone takes only a 4:3 report as its sensor'); return; }
  const picked = pickMode(ph, fns.sensor(t, true));
  assert.ok(picked && fovOf(ph, picked) > 0.99, 'whole-sensor request, ' + name + ': nothing cut off (got ' + (picked ? Math.round(fovOf(ph, picked) * 100) : 'refused') + '%)');
});
/* And the old upright request really did zoom (the bug this guards). */
const oldAsk = { width: { ideal: 1440 }, height: { ideal: 1920 }, aspectRatio: { ideal: 3 / 4 }, resizeMode: 'none' };
assert.ok(fovOf(PHONES['square mode'], pickMode(PHONES['square mode'], oldAsk)) < 0.9, 'model check: the old upright ask zooms a square-mode phone');
assert.ok(fns.lens('user').aspectRatio.exact === 4 / 3, 'the 4:3 shape is required on a phone, not just preferred');
const raise = fnSource(cam, 'nalunoRaiseToHd', 'camera.js');
assert.ok(raise.includes('if(phone && !sensor) return;'), 'a phone is never sharpened by cutting a bigger mode down');
const holds = new Function(fnSource(cam, 'nalunoShapeRatio', 'camera.js') + fnSource(cam, 'nalunoHoldsSensor', 'camera.js') + '; return nalunoHoldsSensor;')();
assert.strictEqual(holds(1080, 1440, 4032 / 3024), true, 'upright 3:4 holds a 4:3 sensor');
assert.strictEqual(holds(1440, 1080, 4032 / 3024), true, 'either way round');
assert.strictEqual(holds(1080, 1920, 4032 / 3024), false, '9:16 from a 4:3 sensor is cut down');
assert.strictEqual(holds(1088, 1088, 3264 / 2448), false, 'a square from a 4:3 sensor is cut down');
assert.strictEqual(holds(1080, 1920, 1920 / 1080), true, 'a 16:9 sensor is whole at 9:16');
const unz = fnSource(cam, 'nalunoUnzoom', 'camera.js');
assert.ok(!unz.includes("'crop-and-scale'") && !unz.includes('aspectRatio: { ideal: 3/4 }'), 'nothing crops a picture into another shape any more');
assert.ok(fnSource(cam, 'nalunoLensConstraint', 'camera.js').includes("video.resizeMode = 'none';"), 'no extra crop');
const call = fnSource(cam, 'enableCameraForCall', 'camera.js');
assert.ok(call.includes('nalunoLensAttempts(cameraFacingMode,') && call.includes('nalunoSettleCallCamera();'), 'the call camera opens and settles the way the flip does');
const sw = fnSource(cam, 'nalunoSwitchLens', 'camera.js');
assert.ok(sw.includes('if(switchGen !== nalunoCamGen){') && sw.includes('t.enabled = micOn;'), 'a reopen never outlives the call, and a muted mic stays muted');
assert.ok(fnSource(cam, 'nalunoSettleCallCamera', 'camera.js').includes('applyCallFilterNow();'), 'settling never swaps the picture being sent');
assert.ok(fnSource(cam, 'nalunoWatchLensShape', 'camera.js').includes('if(nalunoReshapeUseless[lensKey]) return;'), 'a camera with only the 9:16 mode is not reopened again and again');
assert.ok(call.includes('const notLocked = !!(!inCallNow && liveTrack && !liveTrack.__nalunoLens);'), 'a warm camera opened another way is reopened before a call');
assert.ok(fnSource(cam, 'flipCamera', 'camera.js').includes('return nalunoSwitchLens(next, { toast: true });'), 'the flip is the same opener');
const ok = new Function(fnSource(cam, 'nalunoLensShapeOk', 'camera.js') + '; return nalunoLensShapeOk;')();
assert.strictEqual(ok(1440 / 1920, 'user'), true, '3:4 is right');
assert.strictEqual(ok(1080 / 1920, 'user'), false, '9:16 is the zoomed face');
assert.strictEqual(ok(1920 / 1440, 'user'), false, 'a landscape front camera is the cropped strip');
assert.strictEqual(ok(1920 / 1440, 'environment'), true, 'a wide back lens is left to the upright canvas');
const fit = new Function(fnSource(calls, 'nalunoRemoteFit', 'calls.js').replace('NALUNO_REMOTE_MIN_SHOWN', '0.5') + '; return nalunoRemoteFit;')();
assert.strictEqual(fit(1440, 1920, 393, 852), 'cover', 'the other person fills the screen');
assert.ok(css.includes('#incall .remote-stage video {\n  object-fit: cover;\n}'), 'full screen by default');
/* 08c: the callee's camera, the same as the caller's. */
const answer = fnSource(calls, 'ensureCallMediaReady', 'calls.js');
assert.ok(answer.includes("if(typeof nalunoSettleCallCamera === 'function') nalunoSettleCallCamera();"), 'answering settles and checks the callee\'s camera like the caller\'s');
assert.ok(answer.includes('await nalunoOpenLensVideoOnly(') && !/height: \{ ideal: 1280 \}/.test(answer), 'a lost camera is reopened the flip\'s way, never 720x1280 (9:16)');
const watch = fnSource(cam, 'nalunoWatchLensShape', 'camera.js');
assert.ok(watch.includes("if(document.hidden){") && watch.includes("document.addEventListener('visibilitychange', back);"), 'a camera opened while Naluno was in the background is checked once Naluno is on screen');
assert.ok(watch.includes("if(nalunoShapeVisHandler) document.removeEventListener('visibilitychange', nalunoShapeVisHandler);"), 'one waiting check at a time');
assert.ok(watch.includes("if(typeof callActionInProgress !== 'undefined' && callActionInProgress){"), 'never reopened while a call is being placed or answered');
console.log('camera-lock tests passed');
