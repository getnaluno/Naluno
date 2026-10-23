/* 23 Oct e: newest wins for every kept file (no fallback to an older
   version once a newer one landed), and the Callsign dial stations. The
   browser behaviour is tested end to end by the gate flows no-fallback and
   dial; these are the pieces that can run outside a browser. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const R = path.resolve(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(R, f), 'utf8');
function fn(src, name) {
  const m = new RegExp('(^|\\n)(async )?function ' + name + '\\(').exec(src);
  assert.ok(m, name + ' exists');
  const i = m.index + m[1].length;
  let depth = 0;
  for (let k = src.indexOf('{', i); k < src.length; k++) {
    if (src[k] === '{') depth++;
    else if (src[k] === '}') { depth--; if (depth === 0) return src.slice(i, k + 1); }
  }
  throw new Error('could not read ' + name);
}
let n = 0;
const t = async (name, f) => { await f(); n++; console.log('ok ' + n + ' - ' + name); };
const sw = read('sw.js');
const sb = { Date, isFinite, String, Response };
vm.createContext(sb);
vm.runInContext([fn(sw, 'nalunoShellStamp'), fn(sw, 'nalunoServerDate'), fn(sw, 'nalunoFreshIsOlder')].join('\n'), sb);
const page = (stamp, lm) => new Response('<html><head><meta name="app-version" content="' + stamp + '" /></head></html>', { headers: Object.assign({ 'content-type': 'text/html; charset=utf-8' }, lm ? { 'last-modified': new Date(lm).toUTCString() } : {}) });
const admin = (stamp) => new Response('<meta name="naluno-build" content="' + stamp + '" />', { headers: { 'content-type': 'text/html' } });
const js = (lm) => new Response('x()', { headers: Object.assign({ 'content-type': 'application/javascript' }, lm ? { 'last-modified': new Date(lm).toUTCString() } : {}) });

(async () => {
  await t('an older app page is older, a newer or equal one is not', async () => {
    assert.strictEqual(await sb.nalunoFreshIsOlder(page('2026.10.22a'), page('2026.10.23e')), true);
    assert.strictEqual(await sb.nalunoFreshIsOlder(page('2026.10.24a'), page('2026.10.23e')), false);
    assert.strictEqual(await sb.nalunoFreshIsOlder(page('2026.10.23e'), page('2026.10.23e')), false);
  });
  await t('the page stamp wins over dates (a re-upload of an old build is still old)', async () => {
    assert.strictEqual(await sb.nalunoFreshIsOlder(page('2026.10.22a', Date.UTC(2026, 9, 25)), page('2026.10.23e', Date.UTC(2026, 9, 23))), true);
  });
  await t('the console page is read by its naluno-build stamp', async () => {
    assert.strictEqual(await sb.nalunoFreshIsOlder(admin('2026.10.20a'), admin('2026.10.23e')), true);
    assert.strictEqual(await sb.nalunoFreshIsOlder(admin('2026.10.24a'), admin('2026.10.23e')), false);
  });
  await t('a script with an older server date is older; newer or undated is taken', async () => {
    assert.strictEqual(await sb.nalunoFreshIsOlder(js(Date.UTC(2026, 9, 20)), js(Date.UTC(2026, 9, 23))), true);
    assert.strictEqual(await sb.nalunoFreshIsOlder(js(Date.UTC(2026, 9, 24)), js(Date.UTC(2026, 9, 23))), false);
    assert.strictEqual(await sb.nalunoFreshIsOlder(js(0), js(Date.UTC(2026, 9, 23))), false, 'no date: fresh wins, as before');
    assert.strictEqual(await sb.nalunoFreshIsOlder(js(Date.UTC(2026, 9, 20)), null), false, 'nothing kept: fresh wins');
  });
  await t('the kept copy is still readable after the check (bodies are not used up)', async () => {
    const kept = page('2026.10.23e');
    await sb.nalunoFreshIsOlder(page('2026.10.22a'), kept);
    assert.ok(/2026\.10\.23e/.test(await kept.text()));
  });
  await t('every refresh path in the worker uses the check', async () => {
    assert.ok(/nalunoFreshIsOlder\(fresh, have\)\.then\(function\(older\)\{ if\(!older\) putBare\(fresh\); \}\)/.test(sw), 'versioned code, background refresh');
    assert.ok(/keptCode && isShellResponse\(keptCode, path\) && await nalunoFreshIsOlder\(response, keptCode\)\) return keptCode;/.test(sw), 'code, network first');
    assert.ok(/if\(fresh && fresh\.ok && await nalunoFreshIsOlder\(fresh, cached\)\) return;/.test(sw), 'app page, background refresh');
    assert.ok(/if\(best && await nalunoFreshIsOlder\(response, best\)\) return best;/.test(sw), 'app page, nothing kept under this address');
    assert.ok(/if\(keptAdmin && await nalunoFreshIsOlder\(fresh, keptAdmin\)\) return keptAdmin;/.test(sw), 'console page');
    assert.ok(/if\(kept && await nalunoFreshIsOlder\(fresh, kept\)\) return kept;/.test(sw), 'reloads');
  });
  await t('reloads of the app and console still go to the network first; version checks are untouched', async () => {
    assert.ok(/if\(event\.request\.cache === 'no-store'\) return;/.test(sw));
    const seg = sw.slice(sw.indexOf('if(reloadMode){'), sw.indexOf('const isSiteRoot'));
    assert.ok(/const fresh = await fetch\(event\.request\);/.test(seg) && /return fresh;/.test(seg));
    assert.ok(/if\(!\(isAppCode \|\| isAdminPage \|\| isAppPage\)/.test(seg), 'anything else passes straight through');
  });
  await t('a new worker carries the newest kept page forward instead of a slow older copy', async () => {
    const ins = sw.slice(sw.indexOf("self.addEventListener('install'"), sw.indexOf("self.addEventListener('activate'"));
    assert.ok(/const kept = await nalunoNewestKeptPage\(PAGE_KEYS\);/.test(ins));
    assert.ok(ins.indexOf('nalunoNewestKeptPage(PAGE_KEYS)') < ins.indexOf('CORE_ASSETS.map'), 'read before the precache');
    assert.ok(/nalunoInstall=/.test(ins) && /await cache\.put\(k, kept\.res\.clone\(\)\)/.test(ins));
    assert.ok(/if\(mine && newest > mine\) throw new Error/.test(ins), 'an older worker still refuses to install');
  });
  await t('Callsign: the three settings are dial stations; only Sign out and Privacy/Terms under it', async () => {
    const html = read('app/index.html');
    const dock = html.slice(html.indexOf('id="callsignDialDock"'), html.indexOf('id="signOutBtn"'));
    for (const [id, st] of [['callNotifSection', 'alerts'], ['countrySection', 'country'], ['blockedPeopleSection', 'stopped']]) {
      assert.ok(new RegExp('id="' + id + '" data-dial="' + st + '"').test(dock), id);
    }
    for (const id of ['enableCallNotifsBtn', 'callNotifStatus', 'downloadAndroidAppBtn', 'androidAppHint', 'countrySetting', 'blockedPeopleSub', 'blockedPeopleList']) {
      assert.strictEqual((html.match(new RegExp('id="' + id + '"', 'g')) || []).length, 1, id + ' exists once');
      assert.ok(dock.includes('id="' + id + '"'), id + ' is on the dial');
    }
    const view = html.slice(html.indexOf('id="callsignView"'), html.indexOf('id="callsignDial"'));
    assert.ok(/<p class="cdial-guide" id="callsignDialGuide">[^<]{20,140}<\/p>/.test(view), 'guide line above the dial');
    const p = read('js/profile.js');
    const st = p.slice(p.indexOf('const stations = ['), p.indexOf('];', p.indexOf('const stations = [')));
    assert.deepStrictEqual([...st.matchAll(/id:'(\w+)'/g)].map((m) => m[1]), ['greenroom', 'find', 'tone', 'alerts', 'country', 'stopped', 'mine', 'close']);
    assert.ok(/\.cdial-guide\{/.test(read('css/app.css')));
  });
  console.log('1..' + n);
})().catch((e) => { console.error(e); process.exit(1); });
