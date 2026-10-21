/* Updates reach phones: a copy of this build is served, new versions are
   "published" into it while a phone has the app open, during a call, while
   it is closed, half-uploaded, and as an older copy. */
const fs = require('fs');
const path = require('path');
const http = require('http');
const { pw } = require('../lib/pw.cjs');
const { serve } = require('../lib/serve.cjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
module.exports = {
  name: 'update',
  async run(G) {
    const out = [];
    const { chromium } = pw();
    const dir = path.join(G.tmp, 'upd-site');
    fs.rmSync(dir, { recursive: true, force: true });
    for (const f of ['app', 'js', 'css', 'img', 'sw.js', 'pwa.js', 'manifest.json', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'firebase-config.js', 'index.html', 'voices', 'models']) {
      const src = path.join(G.root, f);
      if (fs.existsSync(src)) fs.cpSync(src, path.join(dir, f), { recursive: true });
    }
    const bump = (index, sw, cache) => {
      if (index) {
        const p = path.join(dir, 'app/index.html');
        let s = fs.readFileSync(p, 'utf8');
        s = s.replace(/(<meta name="naluno-build" content=")[^"]+(")/, '$1' + index + '$2').replace(/(<meta name="app-version" content=")[^"]+(")/, '$1' + index + '$2');
        fs.writeFileSync(p, s);
      }
      if (sw) {
        const p = path.join(dir, 'sw.js');
        let s = fs.readFileSync(p, 'utf8');
        s = s.replace(/const APP_BUILD = '[^']+';/, "const APP_BUILD = '" + sw + "';").replace(/const CACHE_NAME = '[^']+';/, "const CACHE_NAME = '" + cache + "';");
        fs.writeFileSync(p, s);
      }
    };
    const srv = await serve(dir);
    const URL = srv.base + '/app/';
    const fake = fs.readFileSync(path.join(__dirname, '..', 'lib', 'fakefb.js'), 'utf8');
    const prof = path.join(G.tmp, 'upd-profile');
    fs.rmSync(prof, { recursive: true, force: true });
    const ctx = await chromium.launchPersistentContext(prof, { viewport: { width: 393, height: 852 }, serviceWorkers: 'allow' });
    try {
      const { makeStore } = require('../lib/store.cjs');
      const store = makeStore({});
      store.seed('users/alice', { name: 'Alice Test', handle: 'alice' });
      await store.attach(ctx, 'alice');
      await ctx.route(/^https?:\/\/(?!localhost|127\.0\.0\.1)/, (r) => {
        const u = r.request().url();
        if (/firebase-app-compat/.test(u)) return r.fulfill({ status: 200, contentType: 'application/javascript', body: fake });
        return r.fulfill({ status: 200, contentType: /workers/.test(u) ? 'application/json' : 'application/javascript', body: /workers/.test(u) ? '{}' : '' });
      });
      await ctx.addInitScript(() => { try { localStorage.setItem('nalunoWelcomeOk', String(Date.now())); sessionStorage.setItem('__loads', String(Number(sessionStorage.getItem('__loads') || 0) + 1)); } catch (_) {} });
      const st = (p) => p.evaluate(async () => ({
        build: (document.querySelector('meta[name="naluno-build"]') || {}).content,
        banner: (function () { const b = document.getElementById('updateBanner'); return !!(b && b.style.display === 'flex'); })(),
        loads: Number(sessionStorage.getItem('__loads') || 0),
      })).catch((e) => ({ err: e.message }));
      let p = await ctx.newPage();
      await p.goto(URL, { waitUntil: 'load' }); await sleep(7000);
      const first = await st(p);
      out.push({ check: 'first visit loads this build', ok: first.build === G.build, detail: first.build });
      bump('2031.01.01a', '20310101a', 'naluno-shell-v901');
      await p.evaluate(() => checkForUpdate()); await sleep(12000);
      const s1 = await st(p);
      out.push({ check: 'a new version reaches an open app without a tap', ok: s1.build === '2031.01.01a', detail: s1.build });
      bump('2031.01.01b', '20310101b', 'naluno-shell-v902');
      await p.evaluate(() => { activeCallId = 'call1'; checkForUpdate(); }); await sleep(15000);
      const s2 = await st(p);
      out.push({ check: 'during a call the app does not reload', ok: s2.build === '2031.01.01a', detail: s2.build + (s2.banner ? ' (banner)' : '') });
      await p.evaluate(() => { activeCallId = null; }); await sleep(14000);
      const s3 = await st(p);
      out.push({ check: 'after the call it updates by itself', ok: s3.build === '2031.01.01b', detail: s3.build });
      await p.close();
      bump('2031.01.01c', '20310101c', 'naluno-shell-v903');
      bump('2031.01.01d', '20310101d', 'naluno-shell-v904');
      p = await ctx.newPage();
      await p.goto(URL, { waitUntil: 'load' }); await sleep(14000);
      const s4 = await st(p);
      out.push({ check: 'a phone that was closed opens on the newest', ok: s4.build === '2031.01.01d', detail: s4.build });
      bump('-', '20310101e', 'naluno-shell-v905');
      await p.evaluate(() => checkForUpdate()); await sleep(12000);
      const h1 = await st(p);
      await p.evaluate(() => checkForUpdate()); await sleep(8000);
      const h2 = await st(p);
      out.push({ check: 'a half-finished upload does not reload in a loop', ok: h2.loads === h1.loads, detail: h1.loads + ' → ' + h2.loads });
      bump('2031.01.01e', null);
      await p.evaluate(() => { localStorage.removeItem('nalunoAutoUpdate'); checkForUpdate(); }); await sleep(12000);
      const s5 = await st(p);
      out.push({ check: 'once the upload is complete it updates', ok: s5.build === '2031.01.01e', detail: s5.build });
    } finally { await ctx.close().catch(() => {}); srv.close(); }
    return out;
  },
};
