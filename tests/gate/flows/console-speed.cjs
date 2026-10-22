/* The console on a phone-speed processor (Chrome slowed 6×), with a
   realistic amount of data and Naluno busy (a website visit and an app
   opening every second): how long until it shows, how long tabs take,
   how much of the time it is too busy to answer a tap, and how many
   documents it reads. Before 21 Oct g it was busy about half the time. */
const fs = require('fs');
const path = require('path');
const { pw } = require('../lib/pw.cjs');
const { makeStore } = require('../lib/store.cjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
module.exports = {
  name: 'console-speed',
  async run(G) {
    const out = [];
    const store = makeStore({ opDelayMs: 80 });
    const now = Date.now(); const day = (n) => new Date(now - n * 86400000).toISOString().slice(0, 10);
    for (let i = 0; i < 500; i++) store.seed('users/u' + i, { name: 'Person ' + i, handle: 'p' + i, country: 'UG', createdAt: now - i * 3600e3, lastSeen: now - i * 60e3, lastPlatform: i % 2 ? 'pwa' : 'android-native' });
    for (let i = 0; i < 300; i++) store.seed('broadcasts/b' + i, { title: 'Broadcast ' + i, creatorUid: 'u' + (i % 50), createdAt: now - i * 3600e3, views: i * 3 });
    for (let i = 0; i < 800; i++) store.seed('traffic/t' + i, { kind: i % 3 ? 'message' : 'call', ok: true, actorUid: 'u' + (i % 40), peerUid: 'u' + ((i + 1) % 40), at: now - i * 600e3, seconds: 60 });
    for (let i = 0; i < 2000; i++) store.seed('presenceDays/p' + i, { uid: 'u' + (i % 500), day: day(i % 60), at: now - (i % 60) * 86400000 });
    for (let i = 0; i < 800; i++) store.seed('siteSessions/s' + i, { vid: 'v' + i, startedAt: now - i * 900e3, path: '/', country: 'UG' });
    for (let i = 0; i < 1500; i++) store.seed('contributionLedger/l' + i, { uid: 'u' + (i % 100), points: 3, status: 'COUNTED', ts: now - i * 1000 });
    const { chromium } = pw();
    const b = await chromium.launch();
    try {
      const ctx = await b.newContext({ viewport: { width: 412, height: 900 }, serviceWorkers: 'block' });
      await store.attach(ctx, 'op');
      await ctx.addInitScript(() => { window.__AUDIT_EMAIL = 'magjoed@gmail.com'; window.__lt = 0; try { new PerformanceObserver((l) => { l.getEntries().forEach((e) => { window.__lt += e.duration; }); }).observe({ type: 'longtask', buffered: true }); } catch (_) {} });
      const fake = fs.readFileSync(path.join(__dirname, '..', 'lib', 'fakefb.js'), 'utf8');
      await ctx.route(/^https?:\/\/(?!localhost|127\.0\.0\.1)/, (r) => { const u = r.request().url(); if (/firebase-app-compat/.test(u)) return r.fulfill({ status: 200, contentType: 'application/javascript', body: fake }); if (/workers\.dev/.test(u)) return r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{"ok":true,"operator":true,"hasPassword":true}' }); return r.fulfill({ status: 200, contentType: 'application/javascript', body: '' }); });
      const p = await ctx.newPage();
      const cdp = await ctx.newCDPSession(p);
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 6 });
      await p.goto(G.base + '/admin/', { waitUntil: 'load' });
      await sleep(4000);
      const docs = store.docs.size;
      const r0 = store.reads.n;
      const t0 = Date.now();
      await p.evaluate(() => { document.getElementById('adminPassInput').value = 'password123'; document.getElementById('adminUnlockBtn').click(); });
      let shown = null;
      for (let i = 0; i < 300; i++) { if (await p.evaluate(() => { const b = document.getElementById('adminBody'); return !!(b && b.innerText.length > 200 && !/Loading/.test(b.innerText.slice(0, 40))); })) { shown = Date.now() - t0; break; } await sleep(100); }
      await sleep(8000);
      out.push({ check: 'console shows within 4 s on a phone', ok: shown != null && shown < 4000, detail: shown + ' ms' });
      const reads = store.reads.n - r0;
      out.push({ check: 'opening reads each document about once', ok: reads <= docs * 1.15 + 150, detail: reads + ' reads for ' + docs + ' documents' });
      for (const t of ['users', 'overview', 'health']) {
        const ms = await p.evaluate((t) => new Promise((r) => { const s = performance.now(); document.querySelector('[data-tab="' + t + '"]').click(); requestAnimationFrame(() => setTimeout(() => r(Math.round(performance.now() - s)), 0)); }), t);
        out.push({ check: 'tab ' + t + ' opens within 0.4 s on a phone', ok: ms < 400, detail: ms + ' ms' });
        await sleep(800);
      }
      await p.evaluate(() => { document.querySelector('[data-tab="overview"]').click(); });
      await sleep(1500);
      const lt0 = await p.evaluate(() => window.__lt);
      for (let i = 0; i < 20; i++) {
        store.write('x', { kind: 'set', path: 'siteSessions/new' + i, data: { vid: 'n' + i, startedAt: Date.now(), path: '/' } });
        store.write('x', { kind: 'set', path: 'presenceDays/new' + i, data: { uid: 'u1', day: day(0), at: Date.now() } });
        await sleep(1000);
      }
      const busy = Math.round((await p.evaluate(() => window.__lt)) - lt0);
      out.push({ check: 'while Naluno is busy, the console is free to answer taps at least 85% of the time', ok: busy < 3000, detail: busy + ' ms busy in 20 s' });
    } finally { await b.close(); }
    return out;
  },
};
