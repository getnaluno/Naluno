/* The console and a new build (23 Oct): no floating "is ready" bar ever;
   on the same build nothing shows; before the password a newer build just
   loads (once, never in a loop); after the password a small "update" chip
   waits and Lock loads it. The password is still asked every time. */
const fs = require('fs');
const path = require('path');
const { pw } = require('../lib/pw.cjs');
const { makeStore } = require('../lib/store.cjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
module.exports = {
  name: 'console-update',
  async run(G) {
    const out = [];
    const { chromium } = pw();
    const fake = fs.readFileSync(path.join(__dirname, '..', 'lib', 'fakefb.js'), 'utf8');
    const store = makeStore({});
    store.seed('users/u1', { name: 'Person 1', handle: 'p1', createdAt: Date.now() });
    const b = await chromium.launch();
    let serverBuild = null; /* null: the real file; otherwise the build the server claims */
    let loads = 0;
    const mk = async () => {
      const ctx = await b.newContext({ viewport: { width: 412, height: 915 }, serviceWorkers: 'block' });
      await store.attach(ctx, 'op');
      await ctx.addInitScript(() => { window.__AUDIT_EMAIL = 'magjoed@gmail.com'; });
      await ctx.route(/^https?:\/\/(?!localhost|127\.0\.0\.1)/, (r) => {
        const u = r.request().url();
        if (/firebase-app-compat/.test(u)) return r.fulfill({ status: 200, contentType: 'application/javascript', body: fake });
        if (/workers\.dev/.test(u)) return r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{"ok":true,"operator":true,"hasPassword":true}' });
        return r.fulfill({ status: 200, contentType: 'application/javascript', body: '' });
      });
      /* the update check asks /admin/index.html?_=…; the page itself is /admin/ */
      await ctx.route(/\/admin\/index\.html\?_=/, async (r) => {
        const res = await r.fetch();
        let html = await res.text();
        if (serverBuild) html = html.replace(/(<meta name="(?:naluno-build|app-version)" content=")[^"]+/g, '$1' + serverBuild);
        return r.fulfill({ response: res, body: html });
      });
      const p = await ctx.newPage();
      p.on('load', () => { loads++; });
      return { ctx, p };
    };
    const bar = (p) => p.evaluate(() => ({ bar: !!document.getElementById('consoleUpdateBar'), chip: (document.getElementById('consoleUpdateChip') || {}).textContent || '', gate: !!document.getElementById('adminPassInput') && getComputedStyle(document.getElementById('adminPassInput')).display !== 'none' && !!document.getElementById('adminPassInput').offsetParent }));
    const unlock = async (p) => { await p.evaluate(() => { document.getElementById('adminPassInput').value = 'password123'; document.getElementById('adminUnlockBtn').click(); }); await sleep(4000); };
    try {
      /* 1. same build: nothing, no reload */
      let A = await mk();
      loads = 0;
      await A.p.goto(G.base + '/admin/', { waitUntil: 'load' });
      await sleep(5000);
      let s = await bar(A.p);
      out.push({ check: 'on the build it is running: no bar, no chip, no reload', ok: !s.bar && !s.chip && loads === 1, detail: JSON.stringify(s) + ' loads ' + loads });
      await A.ctx.close();
      /* 2. a newer build before the password: it loads itself, once */
      serverBuild = '2099.01.01a';
      A = await mk();
      loads = 0;
      await A.p.goto(G.base + '/admin/', { waitUntil: 'load' });
      await sleep(9000);
      s = await bar(A.p);
      out.push({ check: 'a newer build before the password loads by itself once (never a loop) and shows no bar', ok: loads === 2 && !s.bar && s.gate, detail: 'loads ' + loads + ' ' + JSON.stringify(s) });
      /* 3. after the password: a quiet chip, no bar, no reload */
      await unlock(A.p);
      loads = 0;
      serverBuild = '2099.01.02a';
      await A.p.evaluate(() => { document.dispatchEvent(new Event('visibilitychange')); });
      await sleep(3000);
      s = await bar(A.p);
      out.push({ check: 'after the password: a small "update" chip, no bar, the desk stays open', ok: !s.bar && /update 20990102a/.test(s.chip) && loads === 0 && !s.gate, detail: JSON.stringify(s) });
      /* 4. Lock loads it, and the password is asked */
      await A.p.evaluate(() => { const l = document.getElementById('adminLockBtn'); l && l.click(); });
      await sleep(6000);
      s = await bar(A.p);
      out.push({ check: 'Lock loads the waiting build and the password is asked', ok: loads === 1 && s.gate && !s.bar, detail: 'loads ' + loads + ' ' + JSON.stringify(s) });
      /* 5. with storage blocked it never reloads by itself */
      await A.ctx.close();
      serverBuild = '2099.01.03a';
      A = await mk();
      await A.ctx.addInitScript(() => { try { Object.defineProperty(window, 'sessionStorage', { get() { throw new Error('blocked'); } }); } catch (_) {} });
      loads = 0;
      await A.p.goto(G.base + '/admin/', { waitUntil: 'load' });
      await sleep(8000);
      out.push({ check: 'with storage blocked it never reloads by itself (no loop)', ok: loads === 1, detail: 'loads ' + loads });
      await A.ctx.close();
    } finally { await b.close(); }
    return out;
  },
};
