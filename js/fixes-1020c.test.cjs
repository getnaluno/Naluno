/* 20 Oct c: measurements from the phone, the new opening, call records in
   Legal, every console list folded. Run: node js/fixes-1020c.test.cjs */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
function grab(src, name) {
  let i = src.indexOf('async function ' + name + '(');
  if (i < 0) i = src.indexOf('function ' + name + '(');
  assert.ok(i >= 0, 'missing ' + name);
  let d = 0;
  for (let j = src.indexOf('{', src.indexOf(')', i)); j < src.length; j++) {
    if (src[j] === '{') d++;
    else if (src[j] === '}' && --d === 0) return src.slice(i, j + 1);
  }
  throw new Error('unclosed ' + name);
}

(async () => {
  /* 1. measure.js: labels only, bands, once, batches with the sign-in token. */
  {
    const store = {};
    const sent = [];
    const listeners = {};
    const ctx = {
      console, JSON, Date, Math, Number, String, Object, Array, Promise, setTimeout: () => 0, setInterval: () => 0,
      localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } },
      sessionStorage: { getItem: () => null, setItem: () => {} },
      navigator: { onLine: true }, performance: { timeOrigin: Date.now() - 1500 },
      document: { querySelector: () => ({ content: '2026.10.20c' }), addEventListener: () => {}, visibilityState: 'visible' },
      addEventListener: (t, f) => { listeners[t] = f; },
      matchMedia: () => ({ matches: true }),
      fetch: async (u, init) => { sent.push({ u, init }); return { ok: true, status: 200 }; },
      currentUser: { getIdToken: async () => 'tok-1' },
    };
    ctx.window = ctx;
    vm.createContext(ctx);
    vm.runInContext(read('js/measure.js'), ctx);
    const q = () => ctx.nalunoMeasureQueue();
    assert.strictEqual(q()[0].n, 'app_open', 'the app counts its own opening');
    assert.deepStrictEqual(JSON.parse(JSON.stringify(q()[0].p)), { platform: 'pwa', build: '20261020c', lang: 'en', cold: '1' });
    ctx.nalunoMeasure('msg_sent', { type: 'text', note: 'hello mum, see you at 5', n: undefined, big: 'x'.repeat(40), ok: true });
    const last = q()[q().length - 1];
    assert.deepStrictEqual(JSON.parse(JSON.stringify(last.p)), { type: 'text', ok: '1' }, 'free text, long values and blanks never leave the phone');
    const B = ctx.nalunoMeasureBands;
    assert.strictEqual(B.len(90e3), '1to5m'); assert.strictEqual(B.ring(null), 'none'); assert.strictEqual(B.lag(500), 'lt2s');
    assert.strictEqual(B.wait(3 * 86400e3), '1to7d'); assert.strictEqual(B.vlen(29e3), '10to30s'); assert.strictEqual(B.people(7), '6to12');
    assert.strictEqual(ctx.nalunoMeasureOnce('onboard', { step: 'welcome' }), true);
    assert.strictEqual(ctx.nalunoMeasureOnce('onboard', { step: 'welcome' }), false, 'once per phone');
    await ctx.nalunoMeasureFlush();
    assert.strictEqual(sent.length, 1);
    assert.ok(/\/v1\/measure$/.test(sent[0].u));
    assert.strictEqual(sent[0].init.headers.Authorization, 'Bearer tok-1');
    const body = JSON.parse(sent[0].init.body);
    assert.ok(body.d && body.events.length >= 3);
    assert.strictEqual(q().length, 0, 'sent batches leave the phone queue');
    for (let i = 0; i < 400; i++) ctx.nalunoMeasure('app_ready', { ms: 'lt1s' });
    assert.strictEqual(q().length, 300, 'at most 300 wait on the phone');
    ctx.navigator.onLine = false;
    await ctx.nalunoMeasureFlush();
    assert.strictEqual(sent.length, 1, 'nothing is sent offline');
  }

  /* 2. Every place that measures does it safely (a missing measure.js changes nothing). */
  {
    const files = fs.readdirSync(path.join(root, 'js')).filter((f) => f.endsWith('.js') && !f.includes('.test.') && f !== 'measure.js');
    let calls = 0;
    files.forEach((f) => {
      const src = read('js/' + f);
      const re = /nalunoMeasure(Once)?\(/g;
      let m;
      while ((m = re.exec(src))) {
        calls++;
        const before = src.slice(Math.max(0, m.index - 600), m.index);
        assert.ok(/typeof (root\.)?nalunoMeasure(Once)? (!==|===) 'function'|function deskMeasure|function M\(|var meas = /.test(before) || /typeof nalunoMeasure/.test(before),
          f + ': a measure call without a guard near offset ' + m.index);
      }
    });
    assert.ok(calls >= 40, 'measured in ' + calls + ' places');
    assert.ok(/<script src="\/js\/measure\.js\?v=20261020c"><\/script>/.test(read('app/index.html')));
    assert.ok(read('app/index.html').indexOf('/js/measure.js') < read('app/index.html').indexOf('/js/calls.js'), 'loaded before the modules that use it');
  }

  /* 3. The new opening: a welcome first, then the agreement, then the country. */
  {
    const ob = read('js/onboard.js');
    const html = read('app/index.html');
    assert.ok(/if\(!nalunoWelcomeDone\(\)\)\{\s*showHello\(\);/.test(ob), 'a new phone opens on the welcome');
    assert.ok(/helloNextBtn[\s\S]{0,80}showWelcome\(\)/.test(ob), 'Continue → the agreement');
    assert.ok(/stampNalunoWelcome\(\);[\s\S]{0,420}showCountry\(\);/.test(ob), 'Agree → the country');
    assert.ok(/setNalunoCountry\(c\);[\s\S]{0,200}showTour\(0\);/.test(ob) && /countrySkipBtn[\s\S]{0,300}showTour\(0\);/.test(ob), 'country (or prefer not to say) → the tour');
    assert.ok(html.indexOf('id="nalunoHello"') < html.indexOf('id="nalunoWelcome"') && html.indexOf('id="nalunoWelcome"') < html.indexOf('id="nalunoCountry"'));
    assert.ok(!/Agree|accept/i.test(html.slice(html.indexOf('id="nalunoHello"'), html.indexOf('id="nalunoWelcome"')).replace(/<[^>]*>/g, ' ')), 'the welcome asks for nothing');
    assert.ok(/welcomeTitle: 'Before you start'/.test(ob));
    /* the country helpers */
    const ctx = { localStorage: { s: {}, getItem(k) { return this.s[k] == null ? null : this.s[k]; }, setItem(k, v) { this.s[k] = String(v); }, removeItem(k) { delete this.s[k]; } }, Intl, navigator: { language: 'en-UG' } };
    vm.createContext(ctx);
    const codes = ob.match(/const NALUNO_COUNTRY_CODES = [^\n]*/)[0];
    vm.runInContext("const NALUNO_COUNTRY_KEY='nalunoCountry'; const NALUNO_COUNTRY_SAVED_KEY='x'; const NALUNO_TZ_COUNTRY={}; function nalunoOnboardLang(){return 'en';}\n" + codes + grab(ob, 'nalunoValidCountry') + grab(ob, 'nalunoChosenCountry') + grab(ob, 'nalunoCountryGuess') + grab(ob, 'nalunoCountryName')
      + '\nthis.v = nalunoValidCountry; this.g = nalunoCountryGuess; this.n = nalunoCountryName; this.codes = NALUNO_COUNTRY_CODES;', ctx);
    assert.strictEqual(ctx.v('ug'), 'UG'); assert.strictEqual(ctx.v('XX'), ''); assert.strictEqual(ctx.v('<b>'), '');
    assert.ok(ctx.codes.length >= 240, 'every country');
    assert.strictEqual(ctx.n('UG'), 'Uganda');
    /* saved on the profile once there is a Callsign; only the country */
    assert.ok(/set\(\{ country: c, countryAt: Date\.now\(\) \}, \{ merge: true \}\)/.test(ob));
    assert.ok(/id="countrySetting"/.test(html), 'and it can be changed under Callsign');
  }

  /* 4. Call records live in Legal, behind its password. */
  {
    const adm = read('js/admin-console.js');
    assert.ok(!/data-tab="records"/.test(read('admin/index.html')), 'no Records tab in the bar');
    const legal = adm.slice(adm.indexOf("if (tab === 'legal') {"), adm.indexOf("if (tab === 'legal') {") + 9000);
    assert.ok(legal.indexOf('if (!__legalOpen) {') < legal.indexOf("paintRecordsInto(el.querySelector('#legalRecordsHost'))"), 'drawn only after the Legal password');
    assert.ok(/function paintRecordsInto\(el\)/.test(adm) && /Who called whom/.test(adm), 'the same records (who called whom) are kept');
    assert.ok(/if \(tab === 'records'\) \{\s*el\.innerHTML = card\('Records', '<p class="sub">Call records \(who called whom\) are now inside Legal/.test(adm));
  }

  /* 5. Every console list is folded until tapped, and stays as it was through updates. */
  {
    const adm = read('js/admin-console.js');
    assert.ok(/function foldLists\(root\)/.test(adm) && /new MutationObserver/.test(adm) && /sessionStorage\.setItem\('nalunoDeskFolds'/.test(adm));
    assert.ok(/\.desk-fold\{/.test(read('admin/index.html')));
  }

  /* 6. The desk's Measures add the day totals correctly. */
  {
    const M = require('./admin-measures.js');
    const t = M.sumDays([{ n__call_end: 2, p__call_end__outcome__connected: 1, p__call_end__outcome__missed: 1, day: 'x' }, { n__call_end: 1, p__call_end__outcome__connected: 1 }, null]);
    assert.strictEqual(M.count(t, 'call_end'), 3);
    assert.deepStrictEqual(M.dist(t, 'call_end', 'outcome'), [{ v: 'connected', n: 2 }, { v: 'missed', n: 1 }]);
    assert.strictEqual(M.label('len', '1to5m'), '1–5 min');
    assert.strictEqual(M.label('cap', '1'), 'yes');
    const measured = new Set();
    M.AREAS.forEach((a) => { a.counts.forEach((c) => measured.add(c[0])); a.lists.forEach((l) => measured.add(l[0])); });
    const { CATALOGUE } = await import(path.join(root, 'workers/economy/measure.mjs'));
    Object.keys(CATALOGUE).forEach((n) => assert.ok(measured.has(n), 'the console shows ' + n));
  }
  /* 7. The privacy policy says what is counted, the same on the app and the website. */
  {
    const app = read('js/legal-privacy.js');
    const body = app.slice(app.indexOf('`') + 1, app.lastIndexOf('`')).trim();
    for (const f of ['privacy.html', 'privacy/index.html']) assert.ok(read(f).indexOf(body.slice(0, 2000)) >= 0 || read(f).replace(/\s+/g, ' ').indexOf(body.replace(/\s+/g, ' ').slice(0, 1500)) >= 0, f + ' matches the app');
    assert.ok(/The app also counts how it is used/.test(app) && /kept 180 days, then deleted/.test(app) && /who reached whom, when, for how long/.test(app));
  }
  console.log('fixes-1020c: all checks passed');
})().catch((e) => { console.error(e); process.exit(1); });
