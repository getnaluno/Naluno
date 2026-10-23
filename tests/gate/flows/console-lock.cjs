/* The console's 3-try lock in a real browser (23 Oct c).
   - The worker says "wrong, 2 tries left" but this phone's copy matches:
     the console still opens (how the owner gets in when the worker's copy
     is out of date — the live console has always done this).
   - The worker says "code required": the console does NOT open even though
     this phone's copy matches; the 6-digit box shows.
   - With the code, it opens and asks for a new password.
   - Locked while the desk is open (a call answers "code required"): it goes
     back to the gate with the code box.
   - Secret code window saves the code to the worker. */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { pw } = require('../lib/pw.cjs');
const { makeStore } = require('../lib/store.cjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const UID = 'op';
const PASS = 'password123';
const phoneCopy = crypto.pbkdf2Sync(PASS, 'naluno-admin-v1|' + UID, 120000, 32, 'sha256').toString('base64');

module.exports = {
  name: 'console-lock',
  async run(G) {
    const out = [];
    const { chromium } = pw();
    const fake = fs.readFileSync(path.join(__dirname, '..', 'lib', 'fakefb.js'), 'utf8');
    const store = makeStore({});
    store.seed('users/u1', { name: 'Person 1', handle: 'p1', createdAt: Date.now() });
    const b = await chromium.launch();
    let mode = 'tries';     /* what /v1/admin/unlock answers */
    let lockApis = false;   /* other admin calls answer code_required */
    const asked = [];
    const mk = async () => {
      const ctx = await b.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
      await store.attach(ctx, UID);
      await ctx.addInitScript(([k, v]) => { window.__AUDIT_EMAIL = 'magjoed@gmail.com'; try { localStorage.setItem(k, v); } catch (_) {} }, ['nalunoAdminLocal.' + UID, phoneCopy]);
      await ctx.route(/^https?:\/\/(?!localhost|127\.0\.0\.1)/, async (r) => {
        const u = r.request().url();
        const ok = (status, body) => r.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
        if (/firebase-app-compat/.test(u)) return r.fulfill({ status: 200, contentType: 'application/javascript', body: fake });
        if (/workers\.dev/.test(u)) {
          let body = {}; try { body = JSON.parse(r.request().postData() || '{}'); } catch (_) {}
          asked.push({ u, body });
          if (/\/v1\/admin\/unlock/.test(u)) {
            if (body.recovery_code === '246813') return ok(200, { ok: true, hasPassword: true, code_used: true, must_reset: true });
            if (mode === 'tries') return ok(401, { ok: false, error: 'console password not accepted', tries_left: 2, code_set: true });
            if (mode === 'code') return ok(401, { ok: false, code_required: true, error: 'Too many tries. Enter your 6-digit code.' });
            return ok(200, { ok: true, hasPassword: true });
          }
          if (/\/v1\/admin\/status/.test(u)) return ok(200, { ok: true, operator: true, hasPassword: true, gate: { fails: (mode === 'code' || lockApis) ? 3 : 0, code_required: mode === 'code' || lockApis, code_set: true, cooldown_s: 0 } });
          if (lockApis && /\/v1\/admin\//.test(u)) return ok(401, { ok: false, code_required: true });
          if (/\/v1\/admin\/recovery-code/.test(u)) return ok(200, { ok: true, saved: 'firestore-sa' });
          return ok(200, { ok: true, operator: true, hasPassword: true });
        }
        return r.fulfill({ status: 200, contentType: 'application/javascript', body: '' });
      });
      const p = await ctx.newPage();
      const errs = [];
      p.on('pageerror', (e) => errs.push(e.message));
      const prompts = [];
      p.on('dialog', async (d) => { prompts.push(d.message()); if (/6-digit recovery code|confirm/i.test(d.message())) await d.accept('246813'); else await d.dismiss(); });
      await p.goto(G.base + '/admin/', { waitUntil: 'load' });
      await sleep(3500);
      return { ctx, p, errs, prompts };
    };
    const state = (p) => p.evaluate(() => {
      const vis = (id) => { const e = document.getElementById(id); return !!(e && e.offsetParent !== null && getComputedStyle(e).display !== 'none'); };
      return { open: vis('consoleView') && !document.getElementById('consoleView').classList.contains('hidden'), codeBox: vis('adminCodeRow'), msg: (document.getElementById('adminGateMsg') || {}).textContent || '' };
    });
    const typePass = (p) => p.evaluate((pw) => { document.getElementById('adminPassInput').value = pw; document.getElementById('adminUnlockBtn').click(); }, PASS);
    try {
      /* A. worker out of date, phone copy right → opens */
      mode = 'tries';
      let A = await mk();
      await typePass(A.p); await sleep(3500);
      let s = await state(A.p);
      out.push({ check: 'worker copy out of date, this phone’s copy right: the console still opens (owner never locked out)', ok: s.open, detail: JSON.stringify(s) });
      /* D. locked while the desk is open → back to the gate with the code box */
      lockApis = true;
      /* any call to the worker (here: saving a code) answers "code required" */
      await A.p.evaluate(() => document.getElementById('adminCodeBtn').click());
      await sleep(3500);
      s = await state(A.p);
      out.push({ check: 'lock trips while the desk is open: back to the gate, asking for the code', ok: !s.open && s.codeBox, detail: JSON.stringify(s) });
      lockApis = false;
      await A.ctx.close();
      /* B. code required → does NOT open even with the phone copy right */
      mode = 'code';
      const B = await mk();
      s = await state(B.p);
      out.push({ check: 'a lock already in force: the gate shows the code box up front', ok: s.codeBox && /6-digit code/.test(s.msg), detail: JSON.stringify(s) });
      await typePass(B.p); await sleep(3500);
      s = await state(B.p);
      out.push({ check: 'code required: the right password alone does not open it (the phone copy cannot bypass the lock)', ok: !s.open && s.codeBox, detail: JSON.stringify(s) });
      /* C. with the code → opens and asks for a new password */
      await B.p.evaluate((pw) => { document.getElementById('adminPassInput').value = pw; document.getElementById('adminCodeInput').value = '246813'; document.getElementById('adminUnlockBtn').click(); }, PASS);
      await sleep(4000);
      s = await state(B.p);
      const sent = asked.filter((x) => /\/v1\/admin\/unlock/.test(x.u)).pop();
      out.push({ check: 'with the 6-digit code it opens and asks for a new password', ok: s.open && sent && sent.body.recovery_code === '246813' && B.prompts.some((m) => /Current password/i.test(m)), detail: JSON.stringify(s) + ' prompts ' + B.prompts.length });
      /* E. Secret code window saves to the worker */
      mode = 'ok';
      B.prompts.length = 0;
      await B.p.evaluate(() => document.getElementById('adminCodeBtn').click());
      await sleep(1500);
      const saved = asked.filter((x) => /\/v1\/admin\/recovery-code/.test(x.u)).pop();
      out.push({ check: 'the Secret code window saves a 6-digit code to the worker', ok: !!saved && saved.body.code === '246813', detail: saved ? JSON.stringify(saved.body) : 'not sent' });
      out.push({ check: 'no page errors', ok: !A.errs.length && !B.errs.length, detail: A.errs.concat(B.errs).slice(0, 2).join(' / ') });
      await B.ctx.close();
    } finally { await b.close(); }
    return out;
  },
};
