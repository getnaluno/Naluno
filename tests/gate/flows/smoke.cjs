/* One signed-in phone: every tab opens, and every ordinary button on every
   tab can be tapped, without a page error. (Buttons that sign out, delete,
   block, report, leave or end are skipped.) */
const { makeStore } = require('../lib/store.cjs');
const { phone, seedPair, sleep } = require('../lib/phones.cjs');
module.exports = {
  name: 'smoke',
  async run(G) {
    const out = [];
    const store = makeStore({ deny: require('../lib/rules.cjs').deny, opDelayMs: 40 });
    require('../lib/rules.cjs').bindDocs(store.docs);
    seedPair(store);
    const P = await phone(G, store, 'alice', [{ id: 'c-bob', name: 'Bob Test', firebaseUid: 'bob' }], { net: 'wifi', cached: true });
    try {
      const build = await P.p.evaluate(() => (document.querySelector('meta[name="app-version"]') || {}).content);
      out.push({ check: 'app opens on this build', ok: build === G.build, detail: String(build) });
      const tabs = await P.p.evaluate(() => Array.from(document.querySelectorAll('.navbtn[data-tab]')).map((b) => b.getAttribute('data-tab')));
      out.push({ check: 'the tab bar is there', ok: tabs.length >= 5, detail: tabs.join(', ') });
      for (const t of tabs) {
        const before = P.log.length;
        try { await P.p.click('.navbtn[data-tab="' + t + '"]', { timeout: 3000, force: true }); } catch (_) {}
        await sleep(1500);
        const shown = await P.p.evaluate((t) => { const s = document.getElementById('tab-' + t); return !!(s && (s.classList.contains('active') || getComputedStyle(s).display !== 'none')); }, t);
        const n = await P.p.evaluate((t) => {
          const scr = document.getElementById('tab-' + t);
          if (!scr) return 0;
          window.__gateEls = Array.from(scr.querySelectorAll('button, [role=button], .icon-btn, .chip')).filter((e) => {
            const r = e.getBoundingClientRect();
            const tx = (e.textContent || '') + ' ' + (e.getAttribute('aria-label') || '') + ' ' + (e.id || '');
            return r.width > 0 && r.height > 0 && !/sign ?out|log ?out|delete|remove|block|report|leave|end|wipe|erase|drop|close my|nl-dots/i.test(tx + ' ' + e.className) && !e.closest('a');
          });
          return window.__gateEls.length;
        }, t);
        for (let i = 0; i < n; i++) {
          await P.p.evaluate((i) => { const e = window.__gateEls[i]; if (e && e.isConnected) { try { e.click(); } catch (_) {} } }, i);
          await sleep(250);
          await P.p.keyboard.press('Escape').catch(() => {});
          await P.p.evaluate(() => { document.querySelectorAll('.call-overlay.active, .sheet.active, .modal.active').forEach((x) => { if (x.id !== 'callOverlay') x.classList.remove('active'); }); document.querySelectorAll('.nl-sheet-wrap, .nl-menu').forEach((x) => x.remove()); });
          try { await P.p.click('.navbtn[data-tab="' + t + '"]', { timeout: 1500, force: true }); } catch (_) {}
        }
        const errs = P.log.slice(before).filter((l) => /PAGEERROR/.test(l));
        out.push({ check: 'tab ' + t + ': opens and ' + n + ' buttons tapped without errors', ok: shown && !errs.length, detail: errs.slice(0, 2).join(' / ') });
      }
    } finally { await P.b.close().catch(() => {}); }
    return out;
  },
};
