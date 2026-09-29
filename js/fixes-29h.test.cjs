/* 29h: explicit photos in Writing, the zoomed call picture, a steady
   console, website history, live console settings, one reload per update,
   and no money written into the code. Browser checks cover the screens;
   these pin the logic. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const read = (f) => fs.readFileSync(path.join(__dirname, f), 'utf8');
function extractFn(src, name){
  const start = src.indexOf('function ' + name + '(');
  assert.ok(start >= 0, 'found ' + name);
  let i = src.indexOf('{', start), depth = 0;
  for(; i < src.length; i++){
    if(src[i] === '{') depth++;
    else if(src[i] === '}'){ depth--; if(depth === 0) return src.slice(start, i + 1); }
  }
  throw new Error('unbalanced ' + name);
}

(async function(){
  /* 1. Screen: a picture is never published on a missing verdict. */
  const comp = read('broadcast-composer.js');
  {
    const ctx = { setTimeout, clearTimeout, Promise, Object };
    vm.createContext(ctx);
    vm.runInContext('const NALUNO_SCREEN_WAIT_MS = 50;\nasync ' + extractFn(comp, 'nalunoStrictVerdict') + '\nthis.v = nalunoStrictVerdict;', ctx);
    assert.strictEqual((await ctx.v(null)).decision, 'hold', 'no verdict -> held');
    assert.strictEqual((await ctx.v(Promise.resolve({ decision: 'unread' }))).decision, 'hold', 'unread -> held');
    assert.strictEqual((await ctx.v(new Promise(() => {}))).decision, 'hold', 'still reading at the limit -> held, not published');
    assert.strictEqual((await ctx.v(Promise.resolve({ decision: 'block', packed: { nudenet: {} } }))).decision, 'block');
    assert.ok((await ctx.v(Promise.resolve({ decision: 'allow', packed: { nudenet: 1 } }))).packed, 'the detector findings travel with the verdict');
  }
  assert.ok(!/new Promise\(function\(ok\)\{ setTimeout\(ok, 8000\); \}\)/.test(comp), 'no 8 s give-up on the Writing photo');
  assert.ok(!/setTimeout\(function\(\)\{ ok\(null\); \}, 6000\)/.test(comp), 'no 6 s second try that published unscreened');
  assert.ok(comp.includes("const snapScreen = window._bcompScreen || null;"), 'no stray verdict from another file');
  const core = read('broadcast-core.js');
  assert.ok(!core.includes('window._nalunoLastScreen'), 'createPermanentBroadcast never borrows the last verdict');
  {
    const ctx = { currentProfile: { trustedPublisher: true } };
    vm.createContext(ctx);
    vm.runInContext(extractFn(core, 'nalunoPublisherTrusted') + extractFn(core, 'nalunoBroadcastListingFields') + '\nthis.f = nalunoBroadcastListingFields;', ctx);
    assert.strictEqual(ctx.f(null, { hasPicture: true }).held, true, 'trusted account, picture, no verdict -> held');
    assert.strictEqual(ctx.f({ decision: 'allow' }, { hasPicture: true }).listed, true);
    assert.strictEqual(ctx.f({ decision: 'allow' }, { hasPicture: true, inherited: true }).listed, true, 'a Pass-on inherits');
    assert.strictEqual(ctx.f(null, { hasPicture: false }).listed, true, 'text needs no picture check');
  }
  const compass = read('compass.js');
  assert.ok(compass.includes("screenRep = await nalunoStrictVerdict("), 'the Compass Broadcast route is screened');
  assert.ok(compass.includes("seg.heldReason = 'unread';"), 'an unread Signal picture stays private');
  const nn = read('nudenet.js');
  assert.ok(nn.includes('WHAT AN EXPLICIT PICTURE LOOKS LIKE'), 'the rulebook describes an explicit picture in words');
  assert.ok(nn.includes('anatomyHold: 0.25'), 'weak genital signs are held');
  assert.ok(nn.includes('"possible-sexual-act"') && nn.includes('"possible-nudity"'));

  /* 2. The call picture is not blown up. */
  const calls = read('calls.js');
  {
    const v = { videoWidth: 1280, videoHeight: 720, style: { objectFit: '', setProperty(k, val){ this.objectFit = val; } }, dataset: {}, getBoundingClientRect: () => ({ width: 390, height: 844 }) };
    const ctx = { document: { getElementById: () => v }, Math };
    vm.createContext(ctx);
    vm.runInContext('const NALUNO_REMOTE_MIN_SHOWN = 0.75;\n' + extractFn(calls, 'nalunoFitRemoteVideo') + '\nthis.fit = nalunoFitRemoteVideo;', ctx);
    ctx.fit();
    assert.strictEqual(v.style.objectFit, 'contain', 'a landscape frame on a portrait phone is shown whole (was 26% of it)');
    v.videoWidth = 720; v.videoHeight = 1280; ctx.fit();
    assert.strictEqual(v.style.objectFit, 'cover', 'a portrait frame still fills the screen');
  }

  /* 3. The console keeps what you opened. */
  const con = read('admin-console.js');
  assert.ok(con.includes('if (deskDrafting() || deskHasOpen()) {'), 'a repaint waits while something is open');
  assert.ok(con.includes("__tabCache.safetyQuery = parts.join('&');"), 'the Safety search is kept');
  assert.ok(con.includes("if (!el.querySelector('#safeQ')) el.innerHTML = '<p class=\"sub\">Loading the safety queue…</p>';"), 'no Loading… flash on refresh');
  assert.ok(con.includes("String(el.tagName).toLowerCase() === 'select'"), 'menus no longer count as typing');

  /* 4. Website history. */
  {
    const ctx = { Date, Math, Number, isNaN };
    vm.createContext(ctx);
    vm.runInContext(extractFn(con, 'ymdOf') + extractFn(con, 'sitePeriodRange') + '\nthis.r = sitePeriodRange;', ctx);
    const m = ctx.r({ mode: 'month', month: '2026-07' });
    assert.strictEqual(m.from, '2026-07-01'); assert.strictEqual(m.to, '2026-07-31');
    const y = ctx.r({ mode: 'year', year: '2025' });
    assert.strictEqual(y.from, '2025-01-01'); assert.strictEqual(y.to, '2025-12-31');
    const back = ctx.r({ mode: 'back', back: 2 });
    const want = new Date(); want.setDate(1); want.setMonth(want.getMonth() - 2);
    assert.strictEqual(back.from.slice(0, 7), want.getFullYear() + '-' + String(want.getMonth() + 1).padStart(2, '0'), 'months ago');
    assert.strictEqual(ctx.r({ mode: 'span', from: '2026-09-10', to: '2026-09-01' }).from, '2026-09-01', 'a reversed span is put right');
  }
  assert.ok(con.includes("return isFinite(m) && m >= 1 ? Math.min(120, Math.round(m)) : 24;"), 'website data kept 24 months unless changed');
  assert.ok(con.includes("listenCol('siteDays', 180, 'siteDays', 'updatedAt');"), 'the latest days load, not the oldest');

  /* 5. The app follows the console live. */
  assert.ok(read('ads.js').includes("doc('adRates').onSnapshot("), 'ad rate card');
  assert.ok(read('discover.js').includes("doc('live').onSnapshot("), 'discovery settings');
  assert.ok(read('circle.js').includes("doc('viewRules').onSnapshot("), 'view seconds');
  assert.ok(read('known.js').includes("collection('knownPublic').limit(1000).onSnapshot("), 'Known list');
  assert.ok(read('currency.js').includes('__publishedAt'), 'published rates are what the app shows');

  /* 6. One reload per update. */
  const cj = read('core.js');
  {
    const store = {};
    let reloads = 0;
    const ctx = { sessionStorage: { getItem: (k) => store[k] || null, setItem: (k, v) => { store[k] = v; } }, location: { reload(){ reloads++; } }, Date, Number, String };
    vm.createContext(ctx);
    vm.runInContext(extractFn(cj, 'nalunoReloadOnce') + '\nthis.once = nalunoReloadOnce;', ctx);
    ctx.once(true); ctx.once(); ctx.once();
    assert.strictEqual(reloads, 1, 'the takeover after an Update tap does not reload again');
  }
  assert.ok(read('pwa.js').includes("if(typeof nalunoReloadOnce === 'function') nalunoReloadOnce();"));
  assert.ok(read('../sw.js').includes("cache.add(new Request(u, { cache: 'reload' }))"), 'a new version never stores an old page');

  /* 7. No money in the code. */
  assert.ok(!/knownMonthly: \{ amount: 49/.test(con), 'no seeded Known price');
  assert.ok(!/amounts: \[5, 10, 25\]/.test(con), 'no seeded Support amounts');
  assert.ok(!/amount_minor\) \|\| 0\) \/ 100;/.test(con), 'books use each currency\'s own decimals');
  const data = read('admin-data.js');
  assert.ok(data.includes('function applyCostRates('), 'cost figures are editable');
  assert.ok(con.includes("collection('economyConfig').doc('costRates')"), 'saved from the console');
  assert.ok(!/toFixed\(2\)/.test(read('ads.js')), 'ad amounts follow the running currency\'s decimals');
  {
    const ctx = {};
    vm.createContext(ctx);
    vm.runInContext(data.replace(/\}\)\(typeof window !== 'undefined' \? window : globalThis\);\s*$/, "})(this);"), ctx);
    const D = ctx.NalunoAdminData || Object.values(ctx).find((x) => x && x.applyCostRates);
    if (D) {
      D.applyCostRates({ turn_gb_usd: 0.09 });
      assert.strictEqual(D.COST_RATES.turn_gb_usd, 0.09);
      D.applyCostRates(null);
      assert.strictEqual(D.COST_RATES.turn_gb_usd, 0.05, 'back to list price');
    }
  }
  const sw = read('../sw.js');
  ['broadcast-composer.js', 'compass.js', 'nudenet.js', 'calls.js', 'admin-console.js', 'known.js', 'core.js', 'pwa.js'].forEach((f) => {
    const html = read(f === 'admin-console.js' ? '../admin/index.html' : '../app/index.html');
    const m = html.match(new RegExp('/js/' + f.replace('.', '\\.') + '\\?v=(\\d{8}[a-z])'));
    assert.ok(m && m[1] >= '20260929h', f + ' stamp bumped');
  });
  const build = (sw.match(/APP_BUILD = '(\d{8}[a-z])'/) || [])[1];
  assert.ok(build && build >= '20260929h', 'sw build at least 29h');
  console.log('fixes-29h tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
