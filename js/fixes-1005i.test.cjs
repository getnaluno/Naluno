/* 05 Oct (i): the Broadcast upload % bar is back, the voices breathe less,
   and Luganda is read by an African voice that ships with the site. */
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

/* 1. Upload % bar */
{
  const sc = read('js/signal-core.js');
  assert.ok(/function showPublishChip\(text, opts\)/.test(sc), 'the chip can show a bar');
  assert.ok(/const bar = !!\(opts && opts\.bar\)/.test(sc) && /bar \? onWire :/.test(sc), 'the bar shows after the composer closes, never on Wireline');
  assert.ok(/role', 'progressbar'/.test(sc) && /pub-bar-fill/.test(sc) && /pub-bar-pct/.test(sc), 'a real bar with the percentage');
  assert.ok(/job\.progressBar \? \{ bar: true \}/.test(sc), 'only jobs that ask for it');
  const bc = read('js/broadcast-composer.js');
  assert.ok(/progressBar: true,/.test(bc), 'the Broadcast publish job asks for it');
  assert.ok(/'Uploading… ' \+ Math\.round\(\(sent \/ size\) \* 100\) \+ '%/.test(read('js/broadcast-upload.js')), 'the uploader still reports the percentage');
  const core = read('js/core.js');
  assert.ok(/data-bar'\) === '1' && !nalunoOnWireline\(\)/.test(core), 'switching tabs does not hide the bar');
}

/* 2. Less breath */
{
  const M = require('./naluno-voice-master.js');
  const rate = 24000, n = rate;
  const hiss = new Float32Array(n);
  let seed = 3;
  for (let i = 0; i < n; i++) { seed = (seed * 1103515245 + 12345) % 2147483648; hiss[i] = (seed / 2147483648 - 0.5) * 0.2 + 0.4 * Math.sin(2 * Math.PI * 180 * i / rate); }
  const hf = (x) => { let s = 0; for (let i = 1; i < x.length; i++) { const d = x[i] - x[i - 1]; s += d * d; } return s; };
  const raw = Float32Array.from(hiss);
  M.deBreath(hiss, rate);
  assert.ok(hf(hiss) < hf(raw) * 0.7, 'breath noise (high frequencies) is reduced');
  assert.ok(/deBreath\(samples, rate\);/.test(read('js/naluno-voice-master.js')), 'mastering applies it');
}

/* 3. The African voice ships with the site, under GitHub's upload limit */
{
  const cfg = JSON.parse(read('voices/af/sw.json'));
  assert.strictEqual(cfg.sample_rate, 22050);
  assert.ok(cfg.phoneme_id_map.a >= 0 && cfg.phoneme_id_map['^'] === 1);
  assert.ok(fs.statSync(path.join(root, 'voices/af/sw.onnx')).size < 25 * 1024 * 1024);
  assert.ok(/Licence of the recordings/.test(read('voices/af/ABOUT.md')), 'its source and licence are written down');
  assert.ok(!fs.existsSync(path.join(root, '.github/workflows/lg-voice.yml')), 'nothing to download or run on GitHub');
  const html = read('app/index.html');
  ['core.js', 'signal-core.js', 'broadcast-composer.js', 'naluno-voice-master.js', 'naluno-voices.js', 'lg-voice.js'].forEach((f) => {
    assert.ok(new RegExp('/js/' + f.replace('.', '\\.') + '\\?v=20261005i').test(html), f + ' stamp');
  });
  assert.ok(/naluno-af-engine\.js\?v=20261005i/.test(read('js/naluno-voice-worker.js')));
}
console.log('fixes-1005i tests passed');
