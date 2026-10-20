/* 15 Oct: the whole ecosystem moves to the newest version on its own, and
   a phone that missed an update lands on the newest one, never an older. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const core = read('js/core.js');

/* Newest wins: only a newer stamp is a target, whichever file shows it. */
{
  const a = core.indexOf('function nalunoStampKey(');
  const b = core.indexOf('function nalunoReadAppVersion(');
  const c = core.indexOf('function nalunoNewerTarget(');
  const d = core.indexOf('/* 15 Oct: when an update may run');
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(core.slice(a, b) + core.slice(c, d) + '\nthis.t = nalunoNewerTarget;', ctx);
  const t = ctx.t;
  assert.strictEqual(t({ app: '2026.10.14e', build: '2026.10.14e' }, { app: '2026.10.15a', build: '20261015a' }), '20261015a', 'a newer version is taken');
  assert.strictEqual(t({ app: '2026.10.14e', build: '2026.10.14e' }, { app: '2026.10.14e', build: '20261015c' }), '20261015c', 'a skipped version: straight to the newest');
  assert.strictEqual(t({ app: '2026.10.15i', build: '2026.10.15i' }, { app: '2026.10.15g', build: '20261015g' }), '', 'an older copy on the server never pulls a phone back');
  assert.strictEqual(t({ app: '2026.10.15i', build: '2026.10.15i' }, { app: '2026.10.15i', build: '20261015i' }), '', 'the same version: nothing to do');
  assert.strictEqual(t({ app: '2026.10.15i', build: '' }, { app: '', build: 'garbage' }), '', 'a page that cannot be read is ignored');
}
/* It runs by itself, at a good moment, once per version. */
assert.ok(/if\(target\) nalunoAutoUpdate\(target, incomingNotice, [^;]+\);/.test(core), 'a newer version is applied without waiting for a tap');
assert.ok(/window\.nalunoUpdateBusy\(\)/.test(core) && /nalunoUpdateQuietMoment\(\)/.test(core), 'never while busy, only at a quiet moment');
assert.ok(/tried\.target === target && String\(tried\.offer \|\| ''\) === String\(liveKey \|\| ''\) && Date\.now\(\) - Number\(tried\.at \|\| 0\) < 10 \* 60 \* 1000/.test(core), 'no reload loop while an upload is half done');
/* 19 Oct e: ... and when the rest of the upload lands (a different offer), it updates. */
assert.ok(/const guard = target \+ '\|' \+ String\(liveKey \|\| ''\);\s*if\(settled\.indexOf\(guard\) >= 0\)/.test(core), 'the once-per-session guard is per offer, not per target');
assert.ok(/setTimeout\(checkForUpdate, 2500\)/.test(core) && /addEventListener\('online'/.test(core), 'checked soon after opening and when back online');
const pwa = read('js/pwa.js');
assert.ok(/window\.nalunoUpdateBusy = function\(\)\{\s*if\(busyNow\(\)\) return true;/.test(pwa), 'busy covers calls, uploads, composing and typing');
assert.ok(/!m\.paused && !m\.ended && !m\.muted && m\.volume > 0/.test(pwa), '... and anything playing aloud');
assert.ok(/if\(typeof checkForUpdate === 'function'\)\{ checkForUpdate\(\); return; \}/.test(pwa), 'a new worker taking over leads to the same update, not only a banner');
const sw = read('sw.js');
assert.ok(/isAppNav \? new Request\(bare, \{ cache: 'no-cache', credentials: 'same-origin' \}\)/.test(sw), 'the kept app page is checked with the server');
assert.ok(/self\.skipWaiting\(\)/.test(sw) && /self\.clients\.claim\(\)/.test(sw) && /caches\.delete\(n\)/.test(sw), 'a new worker takes over at once and clears old copies');
assert.ok(/if\(mine && newest > mine\) throw new Error/.test(sw), 'an older worker refuses to install over a newer one');
assert.ok(/if\(got && have && got < have\) return;/.test(sw) && /async function nalunoShellStamp\(res\)/.test(sw), 'an older app page is never kept over a newer one');
assert.ok(/got < have\) return;/.test(core.slice(core.indexOf('async function nalunoFreshShell('))), 'the page never saves an older copy of itself before reloading');
/* The console is told, and never reloads itself (each opening asks for its password). */
const con = read('js/admin-console.js');
const seg = con.slice(con.indexOf('function showConsoleUpdateBar('), con.indexOf('function pingSw()'));
assert.ok(/live <= have\)( return;| \{)/.test(seg) && /showConsoleUpdateBar\(live\)/.test(seg), 'the console learns of a newer build');
assert.strictEqual((seg.match(/location\.reload\(\)/g) || []).length, 1, 'the only reload is the button');
assert.ok(/btn\.onclick = async function/.test(seg), '... pressed by the operator');
console.log('fixes-1015a: all checks passed');
