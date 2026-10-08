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
  'camera: what is asked of the camera': ['nalunoIsPortraitDevice', 'nalunoTouchDevice', 'nalunoCameraPortrait', 'nalunoCameraBox', 'nalunoHdVideo', 'buildVideoConstraints', 'nalunoLensConstraint', 'nalunoRaiseToHd', 'nalunoUnzoom']
    .map((n) => fnSource(cam, n, 'camera.js')).join('\n'),
  'camera: how a lens is opened and settled': ['resolveCameraDeviceId', 'nalunoLensDeviceId', 'flipCamera', 'nalunoLensAttempts', 'nalunoSwitchLens', 'nalunoMarkLensTrack', 'nalunoLensShapeOk', 'nalunoWatchLensShape', 'nalunoSettleCallCamera', 'enableCameraForCall']
    .map((n) => fnSource(cam, n, 'camera.js')).join('\n'),
  'camera: how your own picture is drawn and sent': ['drawVideoFit', 'ensureCanvasSize', 'nalunoCompositeFit', 'nalunoAspectNeedsPortrait', 'compositeFrame', 'drawSendCanvas', 'nalunoFitLocalPip']
    .map((n) => fnSource(cam, n, 'camera.js')).join('\n'),
  'calls: the other person full screen': (calls.match(/const NALUNO_REMOTE_MIN_SHOWN = [^;]+;/) || [''])[0] + '\n'
    + ['nalunoRemoteFit', 'nalunoFitRemoteVideo'].map((n) => fnSource(calls, n, 'calls.js')).join('\n'),
  'call-filters: which picture is sent': ['nalunoOutboundPortrait'].map((n) => fnSource(filters, n, 'call-filters.js')).join('\n'),
  'css: the call screens\' video boxes': cssBlocks(css, ['#remoteVideo', 'remote-stage', 'local-pip', '#localPip', 'pipStageCanvas', 'camStageCanvas', 'ringStageCanvas', 'pipRawVideo', 'incomingSelfVideo', 'data-cam']),
};

/* The fingerprints the owner approved. Change only with the owner's say-so
   (see CAMERA-LOCK.md). */
const APPROVED = {
  'camera: what is asked of the camera': 'b953139962dce09d',
  'camera: how a lens is opened and settled': 'cd1ddd2942c27409',
  'camera: how your own picture is drawn and sent': 'e4da395a687a323f',
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
assert.ok(box.includes("'1440': [1440, 1920, 3/4]") && !/9\/16/.test(box), 'an upright phone asks for the full 3:4 sensor, never 9:16');
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
console.log('camera-lock tests passed');
