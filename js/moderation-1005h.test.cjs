/* 05 Oct (h): one moderation rule on the phone and on the server, and the
   machine taught what a clothed picture looks like (fabric is not skin).
   Run: node js/moderation-1005h.test.cjs */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

(async function () {
  const box = { console, Math, Number, Array, Object, Float32Array, Promise };
  box.window = box;
  vm.createContext(box);
  vm.runInContext(read('js/nudenet.js'), box);
  const skin = (r, g, b) => box.nalunoPixelCouldBeSkin(r / 255, g / 255, b / 255);
  const server = await import(path.join(root, 'workers/economy/screen.mjs'));

  /* ---------- 1. One rule, word for word ---------- */
  const a = read('js/nudenet.js'), b = read('workers/economy/screen.mjs');
  const block = (s) => s.slice(s.indexOf('NALUNO MODERATION RULEBOOK'), s.indexOf('function modDecideFrame'));
  assert.strictEqual(block(a), block(b), 'the rulebook and its code are identical on the phone and the server');
  assert.ok(block(a).includes('WHAT A CLOTHED PICTURE LOOKS LIKE'));
  assert.ok(!/faces >= 2 && \(weak >= 1 \|\| bottom\)/.test(b), 'the old strict group rule is gone from the server');

  /* ---------- 2. Skin of every shade is skin ---------- */
  [[247, 222, 206], [235, 200, 180], [224, 172, 145], [198, 134, 98], [160, 105, 75], [141, 85, 54],
   [110, 68, 45], [92, 58, 40], [75, 48, 34], [60, 38, 28], [45, 30, 25], [33, 22, 18], [20, 14, 12],
   [250, 236, 229], [190, 120, 110], [120, 80, 60]].forEach((c) => {
    assert.ok(skin(c[0], c[1], c[2]), 'skin ' + c);
  });
  /* Fabric is not: white, grey, cool colours, yellow, vivid dyes. */
  [[252, 252, 252], [235, 236, 240], [180, 180, 182], [120, 122, 125], [30, 80, 200], [20, 40, 120],
   [40, 160, 70], [120, 200, 60], [250, 220, 30], [255, 120, 0], [220, 20, 30], [230, 60, 0],
   [130, 50, 160], [0, 170, 190]].forEach((c) => {
    assert.ok(!skin(c[0], c[1], c[2]), 'fabric ' + c);
  });

  /* ---------- 3. The phone measures what a box lies on ---------- */
  const S = 320, n = S * S;
  function picture(fill) {
    const t = new Float32Array(3 * n);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const c = fill(x, y), i = y * S + x;
      t[i] = c[0] / 255; t[n + i] = c[1] / 255; t[2 * n + i] = c[2] / 255;
    }
    return t;
  }
  /* Left half a bright blue shirt, right half dark brown skin. */
  const pic = picture((x) => (x < 160 ? [40, 90, 220] : [70, 44, 30]));
  assert.strictEqual(box.nalunoSkinShare(pic, [10, 10, 100, 100]), 0, 'a shirt');
  assert.strictEqual(box.nalunoSkinShare(pic, [200, 10, 100, 100]), 1, 'dark skin is skin');
  /* A fake detector output: two findings, a "breast" on the shirt and one on skin. */
  function output(rows) {
    const ch = 4 + 18, k = rows.length, data = new Float32Array(ch * k);
    rows.forEach((r, i) => {
      data[i] = r.cx; data[k + i] = r.cy; data[2 * k + i] = r.w; data[3 * k + i] = r.h;
      data[(4 + r.cls) * k + i] = r.score;
    });
    return { data, dims: [1, ch, k] };
  }
  const o = output([{ cls: 3, score: 0.5, cx: 60, cy: 60, w: 100, h: 100 }, { cls: 3, score: 0.6, cx: 250, cy: 60, w: 100, h: 100 }, { cls: 1, score: 0.7, cx: 250, cy: 250, w: 40, h: 40 }]);
  const rows = JSON.parse(JSON.stringify(box.nalunoDecodeDetections(o.data, o.dims, pic)));
  assert.deepStrictEqual(rows, [[1, 0.7], [3, 0.6, 1], [3, 0.5, 0]], 'exposed findings carry their skin share; faces do not');
  const gray = picture((x) => (x < 160 ? [200, 200, 200] : [90, 90, 90]));
  assert.deepStrictEqual(JSON.parse(JSON.stringify(box.nalunoDecodeDetections(o.data, o.dims, gray))), [[1, 0.7], [3, 0.6], [3, 0.5]], 'black-and-white: nothing can be told, no allowance');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(box.nalunoDecodeDetections(o.data, o.dims))), [[1, 0.7], [3, 0.6], [3, 0.5]], 'no picture given: as before');

  /* ---------- 4. The rule ---------- */
  const L = { FACE_F: 1, BUTT: 2, BREAST: 3, F_GEN: 4, ANUS: 6, FACE_M: 12, M_GEN: 14 };
  const judge = (frames) => server.judgeScreenPayload({ v: 1, nudenet: { v: 1, frames } }, { title: '' });
  /* The 02 Oct photo: two people, bright clothes misread as breast and bottom. */
  let r = judge([{ d: [[L.FACE_F, 0.85], [L.FACE_M, 0.8], [L.BREAST, 0.45, 0.04], [L.BUTT, 0.66, 0.08]], p: 0 }]);
  assert.strictEqual(r.decision, 'allow', 'two clothed people in bright clothes: allowed (' + r.reason + ')');
  r = judge([{ d: [[L.FACE_F, 0.85], [L.BREAST, 0.62, 0.1]], p: 0 }]);
  assert.strictEqual(r.decision, 'allow', 'a bright top read as a breast: allowed');
  /* Real explicit pictures: unchanged, whatever the skin colour. */
  assert.strictEqual(judge([{ d: [[L.F_GEN, 0.7, 0.9]], p: 0 }]).decision, 'block');
  assert.strictEqual(judge([{ d: [[L.M_GEN, 0.55, 0.95]], p: 0 }]).decision, 'block');
  assert.strictEqual(judge([{ d: [[L.BREAST, 0.6, 0.7]], p: 0 }]).decision, 'block', 'topless');
  assert.strictEqual(judge([{ d: [[L.BREAST, 0.45, 0.3], [L.F_GEN, 0.45, 0.4]], p: 0 }]).decision, 'block', 'nudity: two parts');
  assert.strictEqual(judge([{ d: [[L.FACE_F, 0.8], [L.FACE_M, 0.8], [L.BUTT, 0.7, 0.6]], p: 0 }]).reason, 'possible-sexual-act');
  assert.strictEqual(judge([{ d: [[L.F_GEN, 0.92, 0.0]], p: 0 }]).decision, 'block', 'near-certain is never reduced');
  /* Genitals on "fabric" are never let out on that alone: a person looks. */
  r = judge([{ d: [[L.F_GEN, 0.7, 0.05]], p: 0 }]);
  assert.strictEqual(r.decision, 'hold');
  r = judge([{ d: [[L.ANUS, 0.3, 0.0]], p: 0 }]);
  assert.strictEqual(r.decision, 'hold');
  /* Old phones (no skin share): exactly the rule as it was on the phone. */
  assert.strictEqual(judge([{ d: [[L.BREAST, 0.45]], p: 0 }]).decision, 'hold');
  assert.strictEqual(judge([{ d: [[L.FACE_F, 0.8], [L.FACE_M, 0.8], [L.BREAST, 0.3]], p: 0 }]).decision, 'allow', 'two faces and a flicker: not a sexual act (was held by the server)');
  /* Videos: two frames of real exposure still block. */
  assert.strictEqual(judge([{ d: [[L.F_GEN, 0.6, 0.8]], p: 0 }, { d: [], p: 0 }, { d: [[L.F_GEN, 0.65, 0.7]], p: 0 }]).decision, 'block');

  /* ---------- 5. The server only takes a well-formed skin share ---------- */
  ['0.1', -0.1, 1.2, NaN, true].forEach((bad) => {
    assert.notStrictEqual(judge([{ d: [[L.F_GEN, 0.7, bad]], p: 0 }]).engine, 'nudenet', 'bad skin share refused: ' + bad);
  });
  assert.notStrictEqual(judge([{ d: [[L.F_GEN, 0.7, 0.5, 1]], p: 0 }]).engine, 'nudenet', 'no 4th value');
  assert.strictEqual(judge([{ d: [[L.F_GEN, 0.7, null]], p: 0 }]).decision, 'block', 'null = not measured');

  /* ---------- 6. Phone and server decide the same, always ---------- */
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  for (let t = 0; t < 3000; t++) {
    const frames = [];
    const nf = 1 + Math.floor(rnd() * 4);
    for (let f = 0; f < nf; f++) {
      const d = [];
      const k = Math.floor(rnd() * 6);
      for (let j = 0; j < k; j++) {
        const row = [Math.floor(rnd() * 18), Math.round(rnd() * 1000) / 1000];
        if (rnd() < 0.5) row.push(Math.round(rnd() * 1000) / 1000);
        d.push(row);
      }
      frames.push({ d, p: rnd() < 0.1 ? 0.9 : 0 });
    }
    const phone = JSON.parse(JSON.stringify(box.nalunoModDecide(frames)));
    const srv = JSON.parse(JSON.stringify(server.modDecide(frames)));
    assert.deepStrictEqual(phone, srv, 'same decision for ' + JSON.stringify(frames));
  }
  console.log('moderation-1005h tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
