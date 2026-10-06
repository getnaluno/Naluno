/* Camera opens at the phone's own shape, at HD, without a 60fps trap
   and without a timer that retunes the lens during a call. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const src = fs.readFileSync(path.join(__dirname, 'camera.js'), 'utf8');
const band = fs.readFileSync(path.join(__dirname, 'band-room.js'), 'utf8');

assert.ok(!/max:\s*60/.test(src), 'a 60fps cap must not be requested — Chrome then skips HD');
assert.ok(!/setTimeout\(\s*climb/.test(src), 'the camera is not retuned on a timer during a call');
assert.ok(!src.includes('9/16') && !src.includes('9 / 16'), 'portrait is not a 9:16 crop');
assert.ok(src.includes('function nalunoRaiseToHd'), 'a short open is raised to HD before the picture is sent');
assert.ok(src.includes('srcLong >= 1280 ? 1280 : 960'), 'an HD camera is sent at HD, a small one stays light');
assert.ok(src.includes('Math.min(window.devicePixelRatio || 1, 3)'), 'the preview uses the phone pixels up to 3x');

const start = src.indexOf('function nalunoIsPortraitDevice');
const end = src.indexOf('function nalunoAspectOf');
assert.ok(start > 0 && end > start, 'constraint helpers found');
function load(portrait){
  const ctx = {
    cameraFacingMode: 'user',
    preferredVideoDeviceId: null,
    screen: { orientation: { type: portrait ? 'portrait-primary' : 'landscape-primary' } },
    window: {},
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(src.slice(start, end) + '\nthis.box=nalunoCameraBox; this.lens=nalunoLensConstraint; this.label=nalunoHdLabel; this.hd=nalunoHdVideo;', ctx);
  return ctx;
}
const p = load(true);
const full = p.box('1440');
assert.strictEqual(full.width, 1440);
assert.strictEqual(full.height, 1920);
assert.ok(Math.abs(full.aspect - 0.75) < 0.001, 'portrait aspect is 3:4');
assert.ok(full.width < full.height, 'portrait requests the short side as width');
const lens = p.lens('user');
assert.strictEqual(lens.width.ideal, 1440);
assert.strictEqual(lens.height.ideal, 1920);
assert.strictEqual(lens.frameRate.max, 30);
assert.strictEqual(lens.frameRate.ideal, 30);
assert.strictEqual(lens.resizeMode, 'none');
assert.strictEqual(lens.facingMode.ideal, 'user');
assert.strictEqual(p.label(1440, 1920), 'Full HD');
assert.strictEqual(p.label(1080, 1440), 'Full HD');
assert.strictEqual(p.label(1280, 720), 'HD');
assert.strictEqual(p.label(720, 960), 'HD');
assert.strictEqual(p.label(640, 480), '');
assert.strictEqual(p.label(3840, 2160), '4K');
const land = load(false);
const wide = land.box('1080');
assert.strictEqual(wide.width, 1920);
assert.strictEqual(wide.height, 1080);
assert.ok(wide.width > wide.height, 'landscape requests a wide HD frame');
assert.ok(band.includes("nalunoHdVideo('1440', 'user')"), 'Band live uses the same HD lens');
assert.ok(!/aspectRatio:\s*\{\s*ideal:\s*9\/16\s*\}/.test(band), 'no camera opens as a 9:16 zoom');
console.log('camera-hd ok');
