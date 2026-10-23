/* Once a newer version has landed on a phone, nothing pulls it back.
   A copy of this build is served by a server that can be told to hand out
   OLDER copies of single files (what a slow CDN edge or a half-finished
   upload does): an older app page, an older sw.js, an older script under the
   same ?v=, an older page while a new worker installs, and an older console
   page. Every file carries a Last-Modified date, like GitHub Pages.
   NALUNO_NOFALLBACK_SW=<file> runs it against another sw.js (sabotage). */
const fs = require('fs');
const path = require('path');
const http = require('http');
const { pw } = require('../lib/pw.cjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };

function serveWith(dir, overrides) {
  return new Promise((resolve) => {
    const s = http.createServer((req, res) => {
      const u = decodeURIComponent(req.url.split('?')[0]);
      const o = overrides[u];
      if (o) {
        res.writeHead(200, { 'Content-Type': o.type, 'Cache-Control': 'no-cache', 'Last-Modified': new Date(o.lm).toUTCString() });
        return res.end(o.body);
      }
      let f = path.join(dir, u);
      if (!f.startsWith(dir)) { res.writeHead(403); return res.end(); }
      try {
        if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
        const body = fs.readFileSync(f);
        const lm = fs.statSync(f).mtime;
        const ims = Date.parse(req.headers['if-modified-since'] || '');
        if (isFinite(ims) && Math.floor(lm.getTime() / 1000) * 1000 <= ims) { res.writeHead(304, { 'Last-Modified': lm.toUTCString() }); return res.end(); }
        res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-cache', 'Last-Modified': lm.toUTCString() });
        res.end(body);
      } catch (_) { res.writeHead(404); res.end('not found'); }
    });
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; resolve({ base: 'http://localhost:' + p, close: () => s.close() }); });
  });
}

module.exports = {
  name: 'no-fallback',
  async run(G) {
    const out = [];
    const add = (check, ok, detail) => out.push({ check, ok: !!ok, detail: detail || '' });
    const { chromium } = pw();
    const dir = path.join(G.tmp, 'nofb-site');
    fs.rmSync(dir, { recursive: true, force: true });
    for (const f of ['app', 'admin', 'js', 'css', 'img', 'sw.js', 'pwa.js', 'manifest.json', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'firebase-config.js', 'index.html']) {
      const src = path.join(G.root, f);
      if (fs.existsSync(src)) fs.cpSync(src, path.join(dir, f), { recursive: true });
    }
    if (process.env.NALUNO_NOFALLBACK_SW) fs.copyFileSync(process.env.NALUNO_NOFALLBACK_SW, path.join(dir, 'sw.js'));
    if (process.env.NF_DEBUG) { const sp = path.join(dir, 'sw.js'); fs.writeFileSync(sp, fs.readFileSync(sp, 'utf8').replace("self.addEventListener('fetch', event=>{", "self.addEventListener('fetch', event=>{ if(/linkify|\\/app\\/|\\/admin\\//.test(event.request.url)) (self.__log = self.__log || []).push(event.request.cache + ' ' + event.request.mode + ' ' + event.request.url.replace(self.location.origin, ''));")); }
    const T0 = Date.now() - 3600e3;
    const stampPage = (rel, stamp, at) => {
      const p = path.join(dir, rel);
      let s = fs.readFileSync(p, 'utf8');
      s = s.replace(/(<meta name="naluno-build" content=")[^"]+(")/, '$1' + stamp + '$2').replace(/(<meta name="app-version" content=")[^"]+(")/, '$1' + stamp + '$2');
      fs.writeFileSync(p, s);
      const d = new Date(at); fs.utimesSync(p, d, d);
      return s;
    };
    const stampSw = (build, cache, at) => {
      const p = path.join(dir, 'sw.js');
      let s = fs.readFileSync(p, 'utf8');
      s = s.replace(/const APP_BUILD = '[^']+';/, "const APP_BUILD = '" + build + "';").replace(/const CACHE_NAME = '[^']+';/, "const CACHE_NAME = '" + cache + "';");
      fs.writeFileSync(p, s);
      const d = new Date(at); fs.utimesSync(p, d, d);
      return s;
    };
    const linkify = path.join(dir, 'js/linkify.js');
    const linkifyBase = fs.readFileSync(linkify, 'utf8');
    const setMark = (m, at) => { fs.writeFileSync(linkify, linkifyBase + '\n;window.__nfMark=' + JSON.stringify(m) + ';\n'); const d = new Date(at); fs.utimesSync(linkify, d, d); };

    const pageA = stampPage('app/index.html', '2031.01.01a', T0 + 60e3);
    const swA = stampSw('20310101a', 'naluno-shell-v901', T0 + 60e3);
    const adminA = stampPage('admin/index.html', '2031.01.01a', T0 + 60e3);
    setMark('A', T0 + 60e3);
    const older = (s) => s.replace(/2031\.01\.01a/g, '2030.12.31z');
    const overrides = {};
    const srv = await serveWith(dir, overrides);
    const prof = path.join(G.tmp, 'nofb-profile');
    fs.rmSync(prof, { recursive: true, force: true });
    const ctx = await chromium.launchPersistentContext(prof, { viewport: { width: 393, height: 852 }, serviceWorkers: 'allow' });
    try {
      /* No request interception here: Playwright turns the browser's own
         cache off for intercepted contexts, which a phone never does. The
         app's other services are simply unreachable; this flow only reads
         which build and which script copy a phone is running. */
      await ctx.addInitScript(() => { try { localStorage.setItem('nalunoWelcomeOk', String(Date.now())); } catch (_) {} });
      const dump = async (p, tag) => {
        if (!process.env.NF_DEBUG) return;
        const d = await p.evaluate(async () => {
          const out = [];
          for (const n of await caches.keys()) {
            const c = await caches.open(n);
            for (const r of await c.keys()) {
              if (!/\/app\/(index\.html)?$|linkify|\/admin\/(index\.html)?$/.test(r.url)) continue;
              const res = await c.match(r); const t = await res.text();
              out.push(n + ' ' + r.url.replace(location.origin, '') + ' = ' + ((t.match(/app-version" content="([^"]+)/) || [])[1] || (t.match(/__nfMark=("[^"]+")/) || [])[1] || '?') + ' lm=' + res.headers.get('last-modified'));
            }
          }
          return out;
        }).catch((e) => [e.message]);
        let swl = [];
        try { const w = p.context().serviceWorkers()[0]; if (w) swl = await w.evaluate(() => { const l = self.__log || []; self.__log = []; return l; }); } catch (e) { swl = ['sw? ' + e.message]; }
        console.log('--- ' + tag + '\n  ' + d.join('\n  ') + '\n  SW: ' + swl.join(' | '));
      };
      const st = async (p) => { const r = await st0(p); await dump(p, JSON.stringify(r)); return r; };
      const st0 = (p) => p.evaluate(() => ({
        build: (document.querySelector('meta[name="naluno-build"]') || {}).content,
        mark: window.__nfMark || '',
        ctl: !!(navigator.serviceWorker && navigator.serviceWorker.controller),
      })).catch((e) => ({ err: e.message }));
      const APP = srv.base + '/app/';
      const swCache = (p) => p.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration('/'); const w = r && r.active; return w ? w.scriptURL : ''; }).catch(() => '');
      const cacheNames = (p) => p.evaluate(() => caches.keys()).catch(() => []);

      /* Opening the app the way a person does: a new page each time (a page
         navigating to itself is answered by the browser's memory and never
         asks the service worker), plus a pull-to-refresh style reload. */
      let p = null;
      const openApp = async (url, wait) => { if (p) await p.close().catch(() => {}); p = await ctx.newPage(); await p.goto(url, { waitUntil: 'load' }); await sleep(wait || 4000); return st(p); };
      const pull = async (wait) => { await p.reload({ waitUntil: 'load' }); await sleep(wait || 4000); return st(p); };
      const looks = async (url, n) => { const r = []; for (let i = 0; i < n; i++) r.push(await openApp(url)); r.push(await pull()); return r; };

      /* 1. the phone gets 2031.01.01a */
      await openApp(APP, 6000);
      const s0 = await openApp(APP, 5000);
      add('setup: the phone runs the newer build', s0.build === '2031.01.01a' && s0.mark === 'A', JSON.stringify(s0) + ' ' + (await cacheNames(p)).join(','));

      /* 2. the server hands out an older copy of a script under the same ?v= */
      overrides['/js/linkify.js'] = { body: linkifyBase + '\n;window.__nfMark="OLD";\n', type: 'application/javascript', lm: T0 };
      const marks = (await looks(APP, 3)).map((x) => x.mark);
      add('an older copy of a script never replaces the newer one', marks.every((m) => m === 'A'), marks.join(' → '));
      delete overrides['/js/linkify.js'];

      /* 3. a genuinely newer copy of the same file still heals (the 23 Oct fix) */
      setMark('B', Date.now() - 1000);
      const healed = (await looks(APP, 3)).map((x) => x.mark);
      add('a newer copy of the same file still reaches the phone', healed[healed.length - 1] === 'B', healed.join(' → '));

      /* 4. the server reverts to an older app page and an older sw.js */
      overrides['/app/'] = overrides['/app/index.html'] = { body: older(pageA), type: 'text/html; charset=utf-8', lm: T0 };
      overrides['/sw.js'] = { body: stampSw('20301231z', 'naluno-shell-v900', T0), type: 'application/javascript', lm: T0 };
      stampSw('20310101a', 'naluno-shell-v901', T0 + 60e3);
      await p.evaluate(() => { try { checkForUpdate(); navigator.serviceWorker.getRegistration('/').then((r) => r && r.update()).catch(() => {}); } catch (_) {} }); await sleep(4000);
      const builds = (await looks(APP, 3)).map((x) => x.build);
      add('an older app page or worker on the server never pulls the phone back', builds.every((b) => b === '2031.01.01a'), builds.join(' → ') + ' | ' + (await cacheNames(p)).join(','));
      delete overrides['/sw.js'];

      /* 5. a NEW worker installs while the server still hands out an older page */
      stampSw('20310101b', 'naluno-shell-v902', Date.now() - 500);
      await p.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration('/'); if (r) await r.update().catch(() => {}); });
      await sleep(8000);
      const installed = await cacheNames(p);
      const after5 = (await looks(APP, 2)).map((x) => x.build);
      add('a new worker never keeps an older page than the phone had', installed.includes('naluno-shell-v902') && !installed.includes('naluno-shell-v901') && after5.every((b) => b === '2031.01.01a'), installed.join(',') + ' | ' + after5.join(' → '));

      /* 6. and when the newer page does arrive, it is taken */
      delete overrides['/app/']; delete overrides['/app/index.html'];
      stampPage('app/index.html', '2031.01.01b', Date.now() - 500);
      await openApp(APP, 1000);
      await p.evaluate(() => { localStorage.removeItem('nalunoAutoUpdate'); checkForUpdate(); }); await sleep(12000);
      let s6 = await st(p);
      if (s6.build !== '2031.01.01b') s6 = await openApp(APP, 5000);
      add('the newer page is still taken when it arrives', s6.build === '2031.01.01b', s6.build);

      /* 7. the console: an older console page on the server is not shown */
      const ADMIN = srv.base + '/admin/';
      await openApp(ADMIN, 6000);
      const a0 = await openApp(ADMIN, 4000);
      overrides['/admin/'] = overrides['/admin/index.html'] = { body: older(adminA), type: 'text/html; charset=utf-8', lm: T0 };
      const ab = (await looks(ADMIN, 2)).map((x) => x.build);
      add('an older console page on the server is never shown', a0.build === '2031.01.01a' && ab.every((b) => b === '2031.01.01a'), a0.build + ' | ' + ab.join(' → '));
      delete overrides['/admin/']; delete overrides['/admin/index.html'];
      stampPage('admin/index.html', '2031.01.01b', Date.now() - 500);
      let a1 = await openApp(ADMIN, 4000);
      if (a1.build !== '2031.01.01b') a1 = await openApp(ADMIN, 4000);
      add('a newer console page is shown', a1.build === '2031.01.01b', a1.build);
    } finally { await ctx.close().catch(() => {}); srv.close(); }
    return out;
  },
};
