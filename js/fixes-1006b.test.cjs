/* 06 Oct (b): the call picture fills the screen on both phones without
   pulling the face closer; the voices' files are back on the site; stale
   script stamps; the camera preview's play() is handled. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

/* 1. Full screen, no extra zoom */
{
  const calls = read('js/calls.js');
  const start = calls.indexOf('const NALUNO_REMOTE_MIN_SHOWN');
  const end = calls.indexOf('function nalunoFitRemoteVideo');
  const box = { Math };
  vm.createContext(box);
  vm.runInContext(calls.slice(start, end) + '\nthis.fit = nalunoRemoteFit;', box);
  const phones = [[390, 844], [360, 800], [412, 915], [375, 667], [430, 932]];
  phones.forEach(([w, h]) => {
    assert.strictEqual(box.fit(1440, 1920, w, h), 'cover', 'an upright phone camera fills a ' + w + 'x' + h + ' screen');
    assert.strictEqual(box.fit(1080, 1920, w, h), 'cover', '9:16 fills too');
    assert.strictEqual(box.fit(1920, 1080, w, h), 'contain', 'a landscape camera is not blown up 3x on an upright phone');
    assert.strictEqual(box.fit(1280, 960, w, h), 'contain', 'a 4:3 landscape frame is shown whole');
  });
  /* The other way round (a phone held sideways, or a laptop window). */
  assert.strictEqual(box.fit(1920, 1080, 844, 390), 'cover');
  assert.strictEqual(box.fit(1440, 1920, 1280, 720), 'contain', 'an upright picture in a wide window is not cropped to a strip');
  assert.strictEqual(box.fit(0, 0, 390, 844), 'cover', 'before the first frame');
  /* What is cut never exceeds what a normal video call cuts. */
  phones.forEach(([w, h]) => {
    const src = 1440 / 1920, scr = w / h;
    const shown = scr / src;
    assert.ok(shown >= 0.5, 'at least half the width of the picture stays visible: ' + shown.toFixed(2));
  });
  /* The caller's own picture uses the same rule (camera.js). */
  const cam = read('js/camera.js');
  assert.ok(/if\(src > box \* 1\.02\) return 'cover';/.test(cam), 'the own picture fills the window too');
  assert.ok(/srv\.srcObject = stream; try\{ const p = srv\.play\(\); if\(p && p\.catch\) p\.catch/.test(cam), 'the preview\'s play() rejection is handled');
  assert.ok(!/9\/16/.test(cam.slice(cam.indexOf('function nalunoCameraBox'), cam.indexOf('function nalunoHdVideo'))), 'the camera is still not asked for a 9:16 crop');
}

/* 2. Voices: every file they load is on the site */
['voices/kitten/model.onnx', 'voices/kitten/voices.npz', 'voices/kitten/config.json', 'voices/ort/ort-wasm-simd.wasm', 'voices/af/sw.onnx', 'voices/af/sw.json'].forEach((f) => {
  assert.ok(fs.existsSync(path.join(root, f)), f + ' must be on the site (Listen and the African voice need it)');
  assert.ok(fs.statSync(path.join(root, f)).size < 25 * 1024 * 1024, f + ' under the 25 MB web-upload limit');
});

/* 3. Stamps */
{
  const app = read('app/index.html');
  ['calls.js', 'camera.js', 'screen.js', 'handle-guard.js', 'pwa.js'].forEach((f) => {
    assert.ok(new RegExp('/js/' + f.replace(/[.-]/g, '\\$&') + '\\?v=20261006[b-z]').test(app), f + ' stamp');
  });
  const admin = read('admin/index.html');
  assert.ok(/handle-guard\.js\?v=20261006b/.test(admin) && /known\.js\?v=20261006b/.test(admin), 'the console fetches the current handle guard and Known');
  assert.ok(/site-pulse\.js\?v=20261006b/.test(read('index.html')), 'the website fetches the current pulse');
  assert.ok(fs.existsSync(path.join(root, 'img/site-night.jpg')), 'the website background image exists');
}
console.log('fixes-1006b tests passed');
