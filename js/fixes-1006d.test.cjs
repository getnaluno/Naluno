/* 06 Oct (d): the camera a call opens is the same lens the flip button
   opens (no close, soft first picture); the Known mark at the top of a call
   is the real coloured mark, or nothing. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const cam = read('js/camera.js');
const calls = read('js/calls.js');
const css = read('css/app.css');
const html = read('app/index.html');

/* 1. Lens choice: by name only, the same name test the flip uses. */
{
  const start = cam.indexOf('function classifyCameraDevice');
  const end = cam.indexOf('async function resolveCameraDeviceId');
  const lStart = cam.indexOf('async function nalunoLensDeviceId');
  const lEnd = cam.indexOf('async function flipCamera');
  assert.ok(start > 0 && lStart > 0, 'helpers exist');
  const run = async (devices, facing) => {
    const box = { cameraFacingMode: 'user', navigator: { mediaDevices: { enumerateDevices: async () => devices } } };
    vm.createContext(box);
    vm.runInContext(cam.slice(cam.indexOf('async function listVideoInputDevices'), end) + cam.slice(lStart, lEnd) + '\nthis.pick = nalunoLensDeviceId;', box);
    return box.pick(facing);
  };
  const vi = (deviceId, label) => ({ kind: 'videoinput', deviceId, label });
  (async () => {
    const samsung = [vi('f1', 'camera2 1, facing front'), vi('b0', 'camera2 0, facing back'), vi('f3', 'camera2 3, facing front'), vi('b2', 'camera2 2, facing back')];
    assert.strictEqual(await run(samsung, 'user'), 'f1', 'the first named front lens, as the flip picks it');
    assert.strictEqual(await run(samsung, 'environment'), 'b0', 'the first named back lens');
    assert.strictEqual(await run([vi('', ''), vi('', '')], 'user'), null, 'names hidden before permission: the old way is kept');
    assert.strictEqual(await run([vi('x', 'Integrated Camera')], 'user'), null, 'a laptop camera with no facing in its name: the old way');
    assert.strictEqual(await run([], 'user'), null, 'no camera');
    console.log('fixes-1006d tests passed');
  })().catch((e) => { console.error(e); process.exit(1); });
}

/* 2. The call camera opens on that lens first, before the call is up only. */
{
  const fn = cam.slice(cam.indexOf('async function enableCameraForCall'), cam.indexOf('async function enableCamera()'));
  assert.ok(fn.includes('lensId = await nalunoLensDeviceId(cameraFacingMode);'), 'the lens is looked up by name');
  assert.ok(/if\(lensId\)\{\s*const exact = Object\.assign\(\{\}, hd\);\s*delete exact\.facingMode;\s*exact\.deviceId = \{ exact: lensId \};\s*attempts\.push/.test(fn), 'opened like the flip: that lens, full sensor (resizeMode none)');
  assert.ok(fn.indexOf('attempts.push({ video: exact') < fn.indexOf('{ video: hd, audio: audioConstraints }'), 'the named lens is tried before the old attempts');
  ['{ video: hd, audio: audioConstraints }', '{ video: hdSoft, audio: audioConstraints }', '{ video: mid, audio: audioConstraints }', '{ video: true, audio: true }'].forEach((a) => {
    assert.ok(fn.includes(a), 'old fallback kept: ' + a);
  });
  assert.ok(/const inCallNow = [^;]*classList\.contains\('active'\)\)\s*\|\| \(typeof peerConnection !== 'undefined' && !!peerConnection\);/.test(fn), 'never swapped once a connection exists');
  assert.ok(fn.includes('if(!wrongLens && mediaStreamIsLive(stream)'), 'a warm stream on another lens is reopened on the right one');
  assert.ok(fn.includes('if(got && !lensId && !inCallNow)'), 'first time ever: moved to the named lens once names are visible');
  assert.ok(fn.includes('That lens would not open: put the first one back.'), 'and if that fails, the camera is not left off');
  /* Nothing else about the camera changed. */
  assert.ok(/function nalunoLensConstraint\(facing\)\{\s*const video = nalunoHdVideo\('1440', facing \|\| cameraFacingMode\);\s*video\.resizeMode = 'none';/.test(cam), 'same lens constraint as before');
  assert.ok(!/9\/16/.test(cam.slice(cam.indexOf('function nalunoCameraBox'), cam.indexOf('function nalunoHdVideo'))), 'no 9:16 crop');
}

/* 3. Known at the top of a call: the coloured mark, or nothing. */
{
  const fn = calls.slice(calls.indexOf('function nalunoSetIncallHeadName'), calls.indexOf('\n}\n', calls.indexOf('function nalunoSetIncallHeadName')) + 2);
  assert.ok(fn.includes("querySelector('.known-text')"), 'only the name is copied, never the word Known');
  assert.ok(fn.includes("querySelectorAll('.naluno-known').forEach(function(m){ m.remove(); })"), 'a mark is stripped from the copy');
  assert.ok(fn.includes('NalunoKnown.paintBeside(head, uid)'), 'the real mark is painted by Known');
  assert.ok(fn.includes("head.removeAttribute('data-known-uid')"), 'no uid, no mark');
  assert.ok(css.includes('#incall .call-head-name.has-known{ justify-content:center; }'), 'name and mark stay centered');
  /* Behaviour: a Known name copies as the name only. */
  const mk = (tag) => {
    const el = { tag, children: [], childNodes: [], attrs: {}, classList: { set: new Set(), add(c){ this.set.add(c); }, remove(c){ this.set.delete(c); }, contains(c){ return this.set.has(c); } } };
    el.getAttribute = (k) => (k in el.attrs ? el.attrs[k] : null);
    el.setAttribute = (k, v) => { el.attrs[k] = String(v); };
    el.removeAttribute = (k) => { delete el.attrs[k]; };
    return el;
  };
  const head = mk('span');
  Object.defineProperty(head, 'textContent', { get(){ return this._t || ''; }, set(v){ this._t = v; } });
  const src = mk('span');
  src.attrs['data-known-uid'] = 'u1';
  src.querySelector = (sel) => (sel === '.known-text' ? { textContent: 'Aster Wynter' } : null);
  const painted = [];
  const box = { $: (id) => (id === 'incallHeadName' ? head : id === 'remoteName' ? src : null), window: {}, NalunoKnown: { paintBeside: (el, uid) => painted.push(uid) } };
  box.window.NalunoKnown = box.NalunoKnown;
  vm.createContext(box);
  vm.runInContext(fn + '\nnalunoSetIncallHeadName();', box);
  assert.strictEqual(head.textContent, 'Aster Wynter', 'no "Known" glued to the name');
  assert.deepStrictEqual(painted, ['u1'], 'mark painted once, in colour, by Known');
}

/* 4. Stamps */
['calls.js', 'camera.js', 'pwa.js'].forEach((f) => assert.ok(new RegExp('/js/' + f.replace('.', '\\.') + '\\?v=20261006d').test(html), f + ' stamp'));
assert.ok(/\/css\/app\.css\?v=20261006d/.test(html), 'app.css stamp');
assert.ok(/APP_BUILD = '20261006d'/.test(read('sw.js')) && /register\('\/sw\.js\?v=20261006d'/.test(read('js/pwa.js')), 'service worker');
