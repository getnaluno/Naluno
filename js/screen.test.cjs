const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

const src = fs.readFileSync(__dirname + '/screen.js', 'utf8');
const ctx = { window: {}, globalThis: {}, btoa: function (s) { return Buffer.from(s, 'binary').toString('base64'); }, atob: function (s) { return Buffer.from(s, 'base64').toString('binary'); }, Int32Array, Uint8Array, Uint32Array, Math, String, Number, Array, Object, Promise, setTimeout, clearTimeout };
ctx.globalThis = ctx;
ctx.window = ctx;
vm.runInNewContext(src, ctx);
const S = ctx.NalunoScreen;
assert.ok(S, 'NalunoScreen missing');
assert.strictEqual(S.VERSION, 3);
assert.ok(S.videoScreenSpots(1).length >= 3, 'short clips still get more than one still');
assert.ok(S.videoScreenSpots(12).length >= 8, 'longer clips sample through the file, including late');
assert.ok(S.videoScreenSpots(12).slice(-1)[0] >= 0.9, 'last sample is near the end');

function fill(w, h, fn) {
  const rgb = new Uint8Array(w * h * 3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = fn(x, y, w, h);
      const o = (y * w + x) * 3;
      rgb[o] = c[0]; rgb[o + 1] = c[1]; rgb[o + 2] = c[2];
    }
  }
  return rgb;
}

const W = 96, H = 96;

const green = fill(W, H, function () { return [40, 160, 50]; });
const peach = fill(W, H, function () { return [210, 155, 125]; });
const darkSkin = fill(W, H, function () { return [110, 70, 48]; });
const face = fill(W, H, function (x, y, w, h) {
  const cx = w / 2, cy = h * 0.22, r = w * 0.18;
  const d = (x - cx) * (x - cx) + (y - cy) * (y - cy);
  if (d < r * r) return [210, 160, 130];
  return [28, 42, 92];
});
const noise = fill(W, H, function (x, y) {
  return [(x * 37 + y * 19) % 255, (x * 11 + y * 53) % 255, (x * 91 + y * 7) % 255];
});

function decideRgb(rgb, title) {
  const f = S.featuresFromRgb(rgb, W, H);
  const hint = S.hintFromFeatures(f);
  return S.decideFromHints([hint], { title: title || '' });
}

const g = decideRgb(green);
assert.strictEqual(g.decision, 'allow', 'green field should go out, got ' + g.decision + ' score ' + g.score);

const p = decideRgb(peach);
assert.strictEqual(p.decision, 'block', 'smooth central skin should stop, got ' + p.decision + ' score ' + p.score);

const d = decideRgb(darkSkin);
assert.strictEqual(d.decision, 'block', 'darker skin fill should still stop, got ' + d.decision + ' score ' + d.score);

const f = decideRgb(face);
assert.ok(f.decision !== 'block', 'a face on a shirt must not be stopped, got ' + f.decision + ' score ' + f.score);

const n = decideRgb(noise);
assert.ok(n.decision !== 'block', 'noisy scene must not be stopped, got ' + n.decision);

const unread = S.decideFromHints([]);
assert.strictEqual(unread.decision, 'unread');

const holdMid = S.decideFromHints([0.45, 0.4]);
assert.strictEqual(holdMid.decision, 'hold');

const lateHit = S.decideFromHints([0.12, 0.14, 0.18, 0.86]);
assert.strictEqual(lateHit.decision, 'block', 'one late sexual still must stop the upload');

const beach = fill(W, H, function (x, y, w, h) {
  if (y < h * 0.30) {
    const cx = w / 2, cy = h * 0.16, r = w * 0.16;
    if ((x - cx) * (x - cx) + (y - cy) * (y - cy) < r * r) return [210, 160, 130];
    return [80, 165, 225];
  }
  if (x < w * 0.14 || x > w * 0.86) return [35, 110, 45];
  if (y > h * 0.38 && y < h * 0.52 && x > w * 0.32 && x < w * 0.68) return [235, 60, 80];
  if (y > h * 0.86) return [210, 185, 130];
  return [200, 150, 118];
});
const beachD = decideRgb(beach);
assert.strictEqual(beachD.decision, 'allow', 'beach bikini-style should go out, got ' + beachD.decision + ' score ' + beachD.score);

const bedroom = fill(W, H, function (x, y, w, h) {
  if (y < h * 0.18) return [155, 170, 188];
  return [200, 140, 110];
});
const bedD = decideRgb(bedroom);
assert.strictEqual(bedD.decision, 'block', 'explicit close-up should stop, got ' + bedD.decision + ' score ' + bedD.score);

const couple = fill(W, H, function (x, y, w, h) {
  const nx = x / w, ny = y / h;
  const h1 = (nx - 0.32) * (nx - 0.32) + (ny - 0.2) * (ny - 0.2);
  const h2 = (nx - 0.64) * (nx - 0.64) + (ny - 0.22) * (ny - 0.22);
  if (h1 < 0.03 || h2 < 0.03) return [210, 160, 130];
  if (ny > 0.32 && ny < 0.82 && nx > 0.16 && nx < 0.84) return [200, 145, 115];
  return [48, 32, 24];
});
const coupleD = decideRgb(couple);
assert.strictEqual(coupleD.decision, 'block', 'indoor sex-with-faces should stop, got ' + coupleD.decision + ' score ' + coupleD.score);

console.log('screen contract tests passed');
