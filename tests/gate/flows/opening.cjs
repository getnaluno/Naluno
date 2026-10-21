/* A new phone: welcome → agreement → country → tour → sign in. A person who
   agreed to an older version sees the "updated Terms" notice once; a new
   person does not. */
const fs = require('fs');
const path = require('path');
const { pw } = require('../lib/pw.cjs');
const { makeStore } = require('../lib/store.cjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
module.exports = {
  name: 'opening',
  async run(G) {
    const out = [];
    const { chromium } = pw();
    const fakeOut = fs.readFileSync(path.join(__dirname, '..', 'lib', 'fakefb-signedout.js'), 'utf8');
    const fakeIn = fs.readFileSync(path.join(__dirname, '..', 'lib', 'fakefb.js'), 'utf8');
    const b = await chromium.launch();
    try {
      const route = (fake) => (r) => {
        const u = r.request().url();
        if (/firebase-app-compat/.test(u)) return r.fulfill({ status: 200, contentType: 'application/javascript', body: fake });
        if (/\/v1\/launch\/status/.test(u)) return r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{"ok":true,"open":true,"mode":"open"}' });
        return r.fulfill({ status: 200, contentType: /workers/.test(u) ? 'application/json' : 'application/javascript', body: /workers/.test(u) ? '{}' : '' });
      };
      /* new phone */
      const ctx = await b.newContext({ viewport: { width: 393, height: 852 }, isMobile: true, serviceWorkers: 'block', timezoneId: 'Africa/Kampala', locale: 'en-UG' });
      const store = makeStore({});
      await store.attach(ctx, null);
      await ctx.addInitScript(() => { window.__AUDIT_SIGNED_OUT = true; window.__AUDIT_FRESH = true; });
      await ctx.route(/^https?:\/\/(?!localhost|127\.0\.0\.1)/, route(fakeOut));
      const p = await ctx.newPage();
      const errs = [];
      p.on('pageerror', (e) => errs.push(e.message));
      await p.goto(G.base + '/app/', { waitUntil: 'load' });
      await sleep(3500);
      const vis = () => p.evaluate(() => ['nalunoHello', 'nalunoWelcome', 'nalunoCountry', 'nalunoTour'].filter((id) => { const el = document.getElementById(id); return el && !el.hidden && el.classList.contains('on'); }));
      out.push({ check: 'a new phone opens on the welcome', ok: (await vis()).join() === 'nalunoHello', detail: (await vis()).join() });
      await p.click('#helloNextBtn'); await sleep(600);
      out.push({ check: 'then the agreement', ok: (await vis()).join() === 'nalunoWelcome', detail: '' });
      await p.click('#welcomeAgreeBtn'); await sleep(600);
      out.push({ check: 'then the country', ok: (await vis()).join() === 'nalunoCountry', detail: '' });
      await p.click('#countryNextBtn'); await sleep(600);
      out.push({ check: 'then the tour', ok: (await vis()).join() === 'nalunoTour', detail: '' });
      await p.click('#tourSkipBtn'); await sleep(800);
      const gate = await p.evaluate(() => { const f = document.getElementById('authGateForm'); return !!(f && getComputedStyle(f).display !== 'none'); });
      out.push({ check: 'then sign in', ok: gate, detail: '' });
      await sleep(10000);
      out.push({ check: 'a new person is not shown the "updated Terms" notice', ok: !(await p.evaluate(() => !!document.getElementById('nalunoLegalNotice'))), detail: '' });
      out.push({ check: 'no page errors on a new phone', ok: !errs.length, detail: errs.slice(0, 2).join(' / ') });
      await ctx.close();
      /* someone who agreed before 21 Oct */
      const ctx2 = await b.newContext({ viewport: { width: 393, height: 852 }, serviceWorkers: 'block' });
      const store2 = makeStore({});
      store2.seed('users/alice', { name: 'Alice Test', handle: 'alice' });
      await store2.attach(ctx2, 'alice');
      await ctx2.addInitScript(() => { try { if (!sessionStorage.getItem('__seeded')) { localStorage.setItem('nalunoWelcomeOk', '1'); localStorage.setItem('nalunoTourOk', '1'); localStorage.removeItem('nalunoLegalSeen'); sessionStorage.setItem('__seeded', '1'); } } catch (_) {} });
      await ctx2.route(/^https?:\/\/(?!localhost|127\.0\.0\.1)/, route(fakeIn));
      const q = await ctx2.newPage();
      await q.goto(G.base + '/app/', { waitUntil: 'load' });
      await sleep(12000);
      const shown = await q.evaluate(() => { const n = document.getElementById('nalunoLegalNotice'); return n ? n.innerText.replace(/\s+/g, ' ') : ''; });
      out.push({ check: 'someone who agreed before sees the notice', ok: /updated our Terms and Privacy Policy/.test(shown), detail: shown.slice(0, 80) });
      await q.evaluate(() => { const b = document.getElementById('nlLegalOk'); b && b.click(); });
      await q.reload({ waitUntil: 'load' });
      await sleep(12000);
      out.push({ check: '… only once', ok: !(await q.evaluate(() => !!document.getElementById('nalunoLegalNotice'))), detail: '' });
      await ctx2.close();
    } finally { await b.close(); }
    return out;
  },
};
