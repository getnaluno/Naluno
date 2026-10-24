/* 24 Oct b: Signals as reels; the camera flip keeps the mic, keeps a tap
   made while a lens is opening, and hands a fallback camera to the call.
   Browser behaviour: gate flows signals-strip and call-camera. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const R = path.resolve(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(R, f), 'utf8');
let n = 0;
const t = (name, fn) => { fn(); n++; console.log('ok ' + n + ' - ' + name); };
const css = read('css/app.css');
const cam = read('js/camera.js');
t('Signals are reels in our diamond: tall diamonds, the clip fills them, thread and knots kept', () => {
  const blk = css.slice(css.indexOf("Signals are Naluno's reels, in our diamond"));
  assert.ok(blk.length > 200, 'block present');
  assert.ok(/--rw:120px; --rh:178px;/.test(blk), 'tall: about 2:3');
  assert.ok((blk.match(/clip-path:polygon\(50% 0, 100% 50%, 50% 100%, 0 50%\);/g) || []).length >= 3, 'rim, plate and clip are diamonds');
  assert.ok(/\.signal-tile \+ \.signal-tile::before\{\s*content:'';/.test(blk) && /\.signal-tile \+ \.signal-tile::after\{\s*content:'';/.test(blk), 'the thread and knot stay');
  assert.ok(/> \.signal-tile-cap\{\s*position:relative;/.test(blk), 'name under the diamond');
});
t('a written Signal shows up to 90 characters on its card', () => {
  const s = read('js/signal-ui.js');
  assert.strictEqual((s.match(/String\(latest\.text\|\|''\)\.slice\(0,90\)/g) || []).length, 2);
});
t('flip: a tap while a lens is opening is queued, not dropped', () => {
  assert.ok(/if\(window\.__flipBusy\)\{ nalunoQueueFlip\(\); return; \}/.test(cam));
  assert.ok(/function nalunoQueueFlip\(\)\{\s*nalunoFlipQueued = !nalunoFlipQueued;/.test(cam), 'two taps cancel out');
  assert.ok(/if\(gen !== nalunoCamGen \|\| Date\.now\(\) - t0 > 10000\)/.test(cam), 'never after the call ended');
});
t('flip: the open mic is kept', () => {
  assert.ok(/const audioConstraint = keepMic \? false : \{ echoCancellation:true/.test(cam));
  assert.ok(/if\(t === keepMic\) return; try\{ t\.stop\(\); \}/.test(cam));
  assert.ok(/newStream\.addTrack\(keepMic\)/.test(cam));
});
t('flip: a fallback camera goes to the call at once', () => {
  assert.strictEqual((cam.match(/nalunoRepointSenders\(peerConnection\)/g) || []).length, 2);
});
t('the camera sizes are untouched (lock fingerprints for size, drawing, fitting, CSS unchanged)', () => {
  const lock = read('js/camera-lock.test.cjs');
  assert.ok(lock.includes("'camera: what is asked of the camera': '8d001c6f9432afbf'"));
  assert.ok(lock.includes("'camera: how your own picture is drawn and sent': 'e4da395a687a323f'"));
  assert.ok(lock.includes("'css: the call screens\\' video boxes': 'f95078b25fdfbd17'"));
  assert.ok(read('CAMERA-LOCK.md').includes('24 Oct 2026 (24b)'));
});
console.log('1..' + n);
