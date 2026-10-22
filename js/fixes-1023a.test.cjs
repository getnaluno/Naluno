/* 23 Oct a: the console's "is ready" bar; the profile photo is its own
   picker with pinch to zoom; versioned files heal after an upload. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const R = path.resolve(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(R, f), 'utf8');
const P = require('./avatar-picker.js');
let n = 0;
const t = (name, fn) => { fn(); n++; console.log('ok ' + n + ' - ' + name); };
const near = (a, b, e) => Math.abs(a - b) <= (e || 0.5);

t('the picture always fills the frame: a portrait fills the width, a landscape the height', () => {
  const b = P.coverBase(3000, 4000, 400);
  assert.ok(near(b.w, 400) && near(b.h, 533.33, 0.5));
  const l = P.coverBase(4000, 3000, 400);
  assert.ok(near(l.h, 400) && near(l.w, 533.33, 0.5));
});
t('dragging stops where the picture would leave an empty edge', () => {
  const b = P.coverBase(3000, 4000, 400);
  const v = P.clampView({ s: 1, x: 300, y: -500 }, b, 400);
  assert.strictEqual(v.x, 0);
  assert.ok(near(v.y, -66.67, 0.5));
  const z = P.clampView({ s: 2, x: 999, y: 0 }, b, 400);
  assert.ok(near(z.x, 200));
});
t('zoom stays between 1x and the maximum', () => {
  const b = P.coverBase(1000, 1000, 400);
  assert.strictEqual(P.clampView({ s: 0.3, x: 0, y: 0 }, b, 400).s, 1);
  assert.strictEqual(P.clampView({ s: 99, x: 0, y: 0 }, b, 400).s, P.MAX_ZOOM);
});
t('pinching apart zooms in and keeps the spot between the fingers in place', () => {
  const b = P.coverBase(1000, 1000, 400);
  const start = { v: { s: 1, x: 0, y: 0 }, p1: { x: 150, y: 200 }, p2: { x: 250, y: 200 } };
  const v = P.pinch(start, { x: 100, y: 200 }, { x: 300, y: 200 }, b, 400);
  assert.ok(near(v.s, 2));
  assert.ok(near(v.x, 0) && near(v.y, 0));
  const off = { v: { s: 1, x: 0, y: 0 }, p1: { x: 300, y: 300 }, p2: { x: 340, y: 300 } };
  const v2 = P.pinch(off, { x: 280, y: 300 }, { x: 360, y: 300 }, b, 400);
  /* zoomed around (320,300): the picture moves away from that spot */
  assert.ok(near(v2.s, 2) && v2.x < 0 && v2.y < 0);
});
t('"Use photo" takes exactly the framed square of the original', () => {
  const b = P.coverBase(3000, 4000, 400);
  const r = P.sourceRect({ s: 1, x: 0, y: 0 }, b, 3000, 4000, 400);
  assert.ok(near(r.sx, 0, 1) && near(r.sw, 3000, 1) && near(r.sh, 3000, 1) && near(r.sy, 500, 1));
  const r2 = P.sourceRect({ s: 2, x: 200, y: 0 }, b, 3000, 4000, 400);
  assert.ok(near(r2.sx, 0, 1) && near(r2.sw, 1500, 1));
});
t('the Callsign photo is its own picker: no pencil or plus on it, both photos open the picker', () => {
  const h = read('app/index.html');
  assert.ok(!/id="avatarEditBtn"/.test(h), 'the pencil badge is gone');
  assert.ok(/<div class="profile-avatar-wrap avatar-pick">\s*<div class="avatar profile-avatar" id="viewAvatar"[^>]*>YO<\/div>\s*<input type="file" id="viewAvatarFileInput" class="avatar-pick-input"/.test(h));
  assert.ok(/<div class="profile-avatar-wrap avatar-pick">\s*<div class="avatar profile-avatar" id="profileAvatarBig"[^>]*>YO<\/div>\s*<input type="file" id="avatarFileInput" class="avatar-pick-input"/.test(h));
  assert.ok(/\.avatar-pick-input\{[^}]*inset:0[^}]*opacity:0\.01/.test(read('css/app.css')));
  const p = read('js/profile.js');
  assert.ok(/NalunoAvatarPicker\.open\(dataUrl\)/.test(p) && /\$\('viewAvatarFileInput'\)\.onchange/.test(p) && /save\.click\(\)/.test(p));
  assert.ok(h.indexOf('/js/avatar-picker.js') > 0 && h.indexOf('/js/avatar-picker.js') < h.indexOf('/js/profile.js'));
  assert.ok(/'\/js\/avatar-picker\.js'/.test(read('sw.js')));
});
t('the console: no floating "is ready" bar; loads a newer build before the password; waits politely after it', () => {
  const c = read('js/admin-console.js');
  assert.ok(!/is ready\. Reload when you can/.test(c));
  assert.ok(/function reloadOnceFor\(live, why\)/.test(c) && /if \(!consoleUnlocked\(\) && reloadOnceFor\(live, 'newer build, before the password'\)\) return;/.test(c));
  assert.ok(/'update ' \+ __pendingBuild/.test(c) && /if \(__pendingBuild\) \{[^\n]*reloadOnceFor\(__pendingBuild, 'locked'\)/.test(c));
  assert.ok(/catch \(_\) \{ return false; \}/.test(c), 'no reload at all when it cannot remember it already reloaded (no loop)');
  assert.ok(/page > BUILD && !consoleUnlocked\(\)/.test(c));
});
t('versioned files are refreshed with the server, not the browser’s few-minute copy', () => {
  assert.ok(/new Request\(event\.request\.url, \{ cache: 'no-cache', credentials: 'same-origin' \}\)/.test(read('sw.js')));
});
console.log('1..' + n);
