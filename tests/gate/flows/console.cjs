/* The console: the operator gets in with the password (never locked out),
   every tab draws without an error, Legal stays behind its own password,
   keep marks work and are audited, reports about a person can be read,
   and Measures shows its batches. */
const fs = require('fs');
const path = require('path');
const { pw } = require('../lib/pw.cjs');
const { makeStore } = require('../lib/store.cjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
module.exports = {
  name: 'console',
  async run(G) {
    const out = [];
    const { chromium } = pw();
    const fake = fs.readFileSync(path.join(__dirname, '..', 'lib', 'fakefb.js'), 'utf8');
    const store = makeStore({});
    const now = Date.now();
    for (let i = 0; i < 6; i++) store.seed('users/u' + i, { name: 'Person ' + i, handle: 'p' + i, country: 'UG', createdAt: now - i * 86400000 });
    store.seed('handles/p1', { uid: 'u1' });
    store.seed('traffic/t1', { kind: 'call', ok: true, actorUid: 'u1', peerUid: 'u2', actorName: 'Person 1', peerName: 'Person 2', seconds: 300, at: now - 3600e3, status: 'ended' });
    store.seed('reports/rep_p1', { report_id: 'rep_p1', reporter_uid: 'u2', target_type: 'person', target_id: 'wireline', target_user_id: 'u1', reason_code: 'harassment', reason: 'Keeps sending threats after I asked them to stop.', status: 'OPEN', ts: now - 60000 });
    const day = new Date(now).toISOString().slice(0, 10);
    store.seed('measureDays/' + day, { day, n__call_end: 4, p__call_end__outcome__connected: 3, p__call_end__outcome__missed: 1 });
    store.seed('measureBatches/b1', { at: now - 60000, uid: 'u1', country: 'UG', device: 'd', events: [{ n: 'call_end', p: { outcome: 'connected' } }] });
    const b = await chromium.launch();
    const ctx = await b.newContext({ viewport: { width: 1280, height: 1000 }, serviceWorkers: 'block' });
    await store.attach(ctx, 'op');
    await ctx.addInitScript(() => { window.__AUDIT_EMAIL = 'magjoed@gmail.com'; });
    await ctx.route(/^https?:\/\/(?!localhost|127\.0\.0\.1)/, (r) => {
      const u = r.request().url();
      if (/firebase-app-compat/.test(u)) return r.fulfill({ status: 200, contentType: 'application/javascript', body: fake });
      if (/workers\.dev/.test(u)) return r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{"ok":true,"operator":true,"hasPassword":true}' });
      return r.fulfill({ status: 200, contentType: 'application/javascript', body: '' });
    });
    const p = await ctx.newPage();
    const errs = [];
    p.on('pageerror', (e) => errs.push(e.message));
    p.on('dialog', (d) => d.accept());
    try {
      await p.goto(G.base + '/admin/', { waitUntil: 'load' });
      await sleep(4000);
      await p.evaluate(() => { document.getElementById('adminPassInput').value = 'password123'; document.getElementById('adminUnlockBtn').click(); });
      await sleep(4500);
      const inside = await p.evaluate(() => { const b = document.getElementById('adminBody'); return !!(b && b.innerText.trim().length > 50) && !!document.querySelector('[data-tab]'); });
      out.push({ check: 'operator gets in with the password', ok: inside, detail: '' });
      const tabs = await p.evaluate(() => Array.from(document.querySelectorAll('#adminTabs [data-tab], [data-tab]')).map((x) => x.getAttribute('data-tab')).filter((v, i, a) => v && a.indexOf(v) === i));
      for (const t of tabs) {
        const before = errs.length;
        await p.evaluate((t) => { const x = document.querySelector('[data-tab="' + t + '"]'); x && x.click(); }, t);
        await sleep(1600);
        const drawn = await p.evaluate(() => (document.getElementById('adminBody') || {}).innerText.trim().length > 10);
        out.push({ check: 'console tab ' + t + ' draws', ok: drawn && errs.length === before, detail: errs.slice(before, before + 2).join(' / ') });
      }
      await p.evaluate(() => { const x = document.querySelector('[data-tab="legal"]'); x && x.click(); });
      await sleep(2000);
      out.push({ check: 'Legal asks for its own password first', ok: await p.evaluate(() => !document.getElementById('recOut') && !document.getElementById('legalHoldsHost') && !!document.getElementById('legalPass')), detail: '' });
      await p.evaluate(() => { document.getElementById('legalPass').value = 'legal-pass-1'; const s = document.getElementById('legalSetFirst') || document.getElementById('legalUnlock'); s.click(); });
      await sleep(4500);
      await p.evaluate(() => { document.getElementById('holdUid').value = '@p1'; document.getElementById('holdWhy').value = 'Report R-12'; document.getElementById('holdAdd').click(); });
      await sleep(2000);
      out.push({ check: 'keep mark saved', ok: !!store.get('legalHolds/u1'), detail: '' });
      await p.evaluate(() => { const b = document.querySelector('.holdLift'); b && b.click(); });
      await sleep(2000);
      out.push({ check: 'keep mark lifted', ok: !store.get('legalHolds/u1'), detail: '' });
      const audits = [...store.docs.entries()].filter(([k]) => k.startsWith('adminAudit/')).map(([, v]) => v.action);
      out.push({ check: 'opening records, keeping and lifting are all in the audit', ok: ['legal-records-open', 'legal-hold-add', 'legal-hold-lift'].every((a) => audits.includes(a)), detail: audits.join(', ') });
      /* a report about a person is readable */
      const rep = await p.evaluate(() => { const t = Array.from(document.querySelectorAll('[data-tab]')).find((x) => /safety|reports|trust|review/i.test(x.getAttribute('data-tab'))); if (t) t.click(); return t ? t.getAttribute('data-tab') : ''; });
      await sleep(2500);
      await p.evaluate(() => { document.querySelectorAll('#adminBody details').forEach((d) => { d.open = true; }); });
      const seen = await p.evaluate(() => /Keeps sending threats/.test(document.getElementById('adminBody').innerText));
      out.push({ check: 'a report about a person shows in the queue', ok: seen, detail: rep || 'no reports tab' });
      await p.evaluate(() => { const x = document.querySelector('[data-tab="measures"]'); x && x.click(); });
      await sleep(5000);
      await p.evaluate(() => { document.querySelectorAll('#adminBody details').forEach((d) => { d.open = true; }); });
      const batches = await p.evaluate(() => { const b = document.getElementById('msBatches'); return !!(b && /Latest batches from phones/i.test(b.innerText)); });
      out.push({ check: 'Measures shows the latest batches', ok: batches, detail: '' });
      out.push({ check: 'no page errors in the console', ok: !errs.length, detail: errs.slice(0, 3).join(' / ') });
    } finally { await b.close(); }
    return out;
  },
};
