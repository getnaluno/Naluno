/* Opening the console (24 Oct a): page → password box → Unlock → console →
   data, on a phone-speed processor, with a worker that takes 800 ms per
   console request (what it took with its database reads one after
   another). Once the worker says the password is right, the console opens;
   keeping the password copies in step happens behind it. A wrong password
   still opens nothing. */
const fs = require('fs');
const path = require('path');
const { pw } = require('../lib/pw.cjs');
const { makeStore } = require('../lib/store.cjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const WMS = 800;
module.exports = {
  name: 'console-open',
  async run(G) {
    const out = [];
    const add = (check, ok, detail) => out.push({ check, ok: !!ok, detail: detail || '' });
    const { chromium } = pw();
    const b = await chromium.launch();
    try {
      const open = async (workerOk) => {
        const store = makeStore({ opDelayMs: 120 });
        const now = Date.now();
        for (let i = 0; i < 300; i++) store.seed('users/u' + i, { name: 'Person ' + i, handle: 'p' + i, country: 'UG', createdAt: now - i * 3600e3, lastSeen: now - i * 60e3 });
        const ctx = await b.newContext({ viewport: { width: 412, height: 900 }, serviceWorkers: 'block' });
        await store.attach(ctx, 'op');
        await ctx.addInitScript(() => { window.__AUDIT_EMAIL = 'magjoed@gmail.com'; });
        const fake = fs.readFileSync(path.join(__dirname, '..', 'lib', 'fakefb.js'), 'utf8');
        await ctx.route(/^https?:\/\/(?!localhost|127\.0\.0\.1)/, async (r) => {
          const u = r.request().url();
          if (/firebase-app-compat/.test(u)) return r.fulfill({ status: 200, contentType: 'application/javascript', body: fake });
          if (/workers\.dev|__naluno-economy/.test(u)) {
            const admin = /\/v1\/admin\//.test(u);
            await sleep(admin ? WMS : 150);
            if (/\/v1\/admin\/unlock/.test(u) && !workerOk) return r.fulfill({ status: 401, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{"ok":false,"tries_left":2}' });
            return r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{"ok":true,"operator":true,"hasPassword":true}' });
          }
          return r.fulfill({ status: 200, contentType: 'application/javascript', body: '' });
        });
        const p = await ctx.newPage();
        const cdp = await ctx.newCDPSession(p);
        await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
        const t0 = Date.now();
        await p.goto(G.base + '/admin/', { waitUntil: 'commit' });
        let gate = null;
        for (let i = 0; i < 400; i++) { if (await p.evaluate(() => { const x = document.getElementById('adminPassInput'); return !!(x && x.offsetParent); }).catch(() => false)) { gate = Date.now() - t0; break; } await sleep(50); }
        await sleep(300);
        const tU = Date.now();
        await p.evaluate(() => { document.getElementById('adminPassInput').value = 'password123'; document.getElementById('adminUnlockBtn').click(); });
        let tabs = null, data = null;
        for (let i = 0; i < 160; i++) {
          const st = await p.evaluate(() => { const t = document.getElementById('adminTabs'); const bd = document.getElementById('adminBody'); return { tabs: !!(t && t.offsetParent), data: !!(bd && bd.innerText.length > 200 && !/Loading/.test(bd.innerText.slice(0, 40))) }; });
          if (st.tabs && tabs === null) tabs = Date.now() - tU;
          if (st.data) { data = Date.now() - tU; break; }
          await sleep(50);
        }
        const msg = await p.evaluate(() => (document.getElementById('adminGateMsg') || {}).textContent || '');
        await ctx.close();
        return { gate, tabs, data, msg };
      };
      const r = await open(true);
      add('the password box shows within 1.5 s on a phone', r.gate != null && r.gate < 1500, r.gate + ' ms');
      add('Unlock → console within 1.4 s (worker 0.8 s)', r.tabs != null && r.tabs < 1400, r.tabs + ' ms');
      add('Unlock → data within 2.2 s (worker 0.8 s)', r.data != null && r.data < 2200, r.data + ' ms');
      const w = await open(false);
      add('a password the worker refuses (and no copy here matches) opens nothing', w.tabs == null && w.data == null && /not accepted/i.test(w.msg), w.msg);
    } finally { await b.close(); }
    return out;
  },
};
