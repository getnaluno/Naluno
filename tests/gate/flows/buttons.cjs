/* Every button (23 Oct): on a signed-in phone, every control on every tab
   (buttons, menus, chips, rows with a hand cursor, pickers) is tapped like
   a finger does, at its centre. Each must
   - be reachable (nothing transparent lying on top of it),
   - do something a person could see (open, change, show a message, ask the
     phone for a picture, go somewhere), within 3.5 s,
   - and cause no page error.
   Sign out and delete are not tapped here (they have their own checks). */
const { makeStore } = require('../lib/store.cjs');
const { phone, seedPair, sleep } = require('../lib/phones.cjs');
const A = require('../lib/tapaudit.cjs');
const SKIP = 'sign ?out|log ?out|^delete|delete account|delete history|wipe|erase|close my account';
/* controls that rightly show nothing new when tapped in this test, and why */
const QUIET_OK = [
  /cdial-station on/,          /* the dial station already chosen */
  /bcast-view-tab active/,     /* the Broadcast view already open */
  /bcast-tune-btn on/,         /* the filter already chosen */
];
module.exports = {
  name: 'buttons',
  async run(G) {
    const out = [];
    const store = makeStore({ deny: require('../lib/rules.cjs').deny, opDelayMs: 40 });
    require('../lib/rules.cjs').bindDocs(store.docs);
    seedPair(store);
    const now = Date.now();
    store.seed('users/alice/compassMessages/m1', { from: 'user', text: 'hello', ts: now - 5000 });
    store.seed('users/alice/compassMessages/m2', { from: 'compass', text: 'Hi Alice.', ts: now - 4000 });
    const P = await phone(G, store, 'alice', [{ id: 'c-bob', name: 'Bob Test', firebaseUid: 'bob' }], { net: 'wifi', cached: true });
    await P.ctx.addInitScript(A.markTapHandlers);
    await P.p.reload(); await sleep(4500);
    await P.p.evaluate((ps) => { ps.forEach((c) => { if (!contacts.find((x) => x.id === c.id)) contacts.push(Object.assign({ isReal: true, initials: c.name[0], color: '#7CFFB2', lastActivityTs: Date.now() }, c)); }); try { renderAll && renderAll(); } catch (_) {} }, [{ id: 'c-bob', name: 'Bob Test', firebaseUid: 'bob' }]);
    await P.ctx.grantPermissions(['geolocation']).catch(() => {});
    await P.ctx.setGeolocation({ latitude: 0.35, longitude: 32.58 }).catch(() => {});
    /* something on every screen: a conversation, a Broadcast */
    store.seed('broadcasts/bc1', { title: 'Morning in Kampala', text: 'A short read.', kind: 'write', type: 'write', creatorUid: 'bob', creatorName: 'Bob Test', status: 'published', visibility: 'public', createdAt: { __ts: Date.now() - 3600e3 }, views: 3 });
    await P.p.evaluate(() => { try { openThread('c-bob'); document.getElementById('threadInput').value = 'Hello Bob'; sendThreadMessage(); } catch (_) {} });
    await sleep(1500);
    await P.p.evaluate(() => { try { closeThread(); } catch (_) {} try { const b = document.getElementById('threadBack'); b && b.click(); } catch (_) {} });
    await sleep(500);
    const fresh = async () => {
      await P.p.evaluate(() => { try { localStorage.setItem('nalunoLegalSeen', NALUNO_LEGAL_VERSION); } catch (_) {} document.querySelectorAll('#nalunoLegalNotice').forEach((x) => x.remove()); });
      await A.install(P.p);
    };
    let errSeen = P.log.filter((l) => /PAGEERROR/.test(l)).length;
    const newErrs = () => { const e = P.log.filter((l) => /PAGEERROR/.test(l)); const n = e.slice(errSeen); errSeen = e.length; return n; };
    const extra = () => ({ toast: P.toasts.length, net: P.worker.length });
    try {
      await fresh();
      const base0 = await A.layersNow(P.p);
      const heal = async (t) => {
        await A.reset(P.p, t);
        if ((await A.layersNow(P.p)) !== base0) { await P.p.reload(); await sleep(4500); await fresh(); await A.reset(P.p, t); await sleep(400); }
      };
      const tabs = await P.p.evaluate(() => Array.from(document.querySelectorAll('.navbtn[data-tab]')).map((b) => b.getAttribute('data-tab')));
      /* the tab bar itself */
      for (const t of tabs) {
        const r = await P.p.evaluate((t) => { const b = document.querySelector('.navbtn[data-tab="' + t + '"]'); const rr = b.getBoundingClientRect(); const top = document.elementFromPoint(rr.left + rr.width / 2, rr.top + rr.height / 2); return { x: rr.left + rr.width / 2, y: rr.top + rr.height / 2, ok: !!top && (top === b || b.contains(top)) }; }, t);
        await P.p.mouse.click(r.x, r.y);
        await sleep(500);
        const on = await P.p.evaluate((t) => { const s = document.getElementById('tab-' + t); return !!(s && s.classList.contains('active')); }, t);
        out.push({ check: 'tab bar: ' + t + ' opens', ok: r.ok && on, detail: r.ok ? '' : 'covered' });
      }
      const problems = [];
      let tapped = 0;
      for (const t of tabs) {
        await heal(t); await sleep(500);
        const list = await A.controls(P.p, '#tab-' + t, SKIP);
        for (const c of list) {
          if (c.risky) continue;
          const again = await A.controls(P.p, '#tab-' + t, SKIP);
          const me = again.find((x) => x.label === c.label && x.id === c.id && x.cls === c.cls);
          if (!me) continue;
          const r = await A.tap(P.p, me.i, extra);
          tapped++;
          const name = t + ': "' + (c.label || c.id || c.cls) + '"';
          const errs = newErrs();
          if (r.gone) { /* redrawn under the finger: tried again once */
            const a3 = await A.controls(P.p, '#tab-' + t, SKIP);
            const m3 = a3.find((x) => x.label === c.label && x.id === c.id && x.cls === c.cls);
            if (m3) { const r3 = await A.tap(P.p, m3.i, extra); if (!r3.gone && r3.ok && r3.fx.length) { await heal(t); continue; } }
            problems.push(name + ' keeps being redrawn under the finger');
          } else if (!r.ok) problems.push(name + ' is covered by ' + r.covered);
          else if (!r.fx.length && !QUIET_OK.some((q) => q.test(c.cls + ' ' + c.label))) problems.push(name + ' does nothing');
          if (errs.length) problems.push(name + ' page error: ' + errs[0].slice(0, 160));
          await heal(t);
        }
      }
      out.push({ check: 'every control on every tab can be tapped and does something (' + tapped + ' tapped)', ok: !problems.length && tapped >= 25, detail: problems.slice(0, 6).join(' · ') });
      out.push({ check: 'no page errors while tapping', ok: !P.log.some((l) => /PAGEERROR/.test(l)), detail: P.log.filter((l) => /PAGEERROR/.test(l)).slice(0, 2).join(' / ') });
    } finally { await P.b.close().catch(() => {}); }
    return out;
  },
};
