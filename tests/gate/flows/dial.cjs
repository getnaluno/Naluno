/* Callsign dial (23 Oct e): a guide line above the dial; call notifications,
   country and "stopped from reaching you" are stations on it, each opening
   its own working controls; under the dial only Sign out and Privacy/Terms. */
const { makeStore } = require('../lib/store.cjs');
const { phone, seedPair, sleep } = require('../lib/phones.cjs');
module.exports = {
  name: 'dial',
  async run(G) {
    const out = [];
    const add = (check, ok, detail) => out.push({ check, ok: !!ok, detail: detail || '' });
    const store = makeStore({});
    seedPair(store);
    const P = await phone(G, store, 'alice', [], { net: 'wifi', cached: true });
    try {
      await P.p.evaluate(() => { try { localStorage.setItem('nalunoLegalSeen', NALUNO_LEGAL_VERSION); } catch (_) {} document.querySelectorAll('#nalunoLegalNotice').forEach((x) => x.remove()); });
      await P.p.click('.navbtn[data-tab="callsign"]'); await sleep(900);
      const lay = await P.p.evaluate(() => {
        const g = document.getElementById('callsignDialGuide');
        const d = document.getElementById('callsignDial');
        const vis = (el) => !!el && el.offsetParent !== null && el.getBoundingClientRect().height > 0;
        const page = document.getElementById('callsignDialDock').parentNode;
        const after = []; let n = document.getElementById('callsignDialDock').nextElementSibling;
        while (n) { if (vis(n)) after.push(n.id || n.className); n = n.nextElementSibling; }
        return {
          guide: vis(g) ? g.textContent.trim() : '',
          guideAbove: vis(g) && vis(d) && g.getBoundingClientRect().bottom <= d.getBoundingClientRect().top + 1,
          stations: Array.from(document.querySelectorAll('.cdial-station')).map((b) => b.textContent),
          after, pageId: page.id,
        };
      });
      add('a short guide sits above the dial', lay.guide.length > 20 && lay.guideAbove, lay.guide);
      add('the dial has Alerts, Country and Stopped', ['Alerts', 'Country', 'Stopped'].every((s) => lay.stations.includes(s)), lay.stations.join(','));
      add('under the dial: only Sign out and Privacy/Terms', lay.after.length === 2 && lay.after[0] === 'signOutBtn' && /welcome-legal-line/.test(lay.after[1]), lay.after.join(' | '));
      const open = async (short) => {
        const b = await P.p.evaluateHandle((s) => Array.from(document.querySelectorAll('.cdial-station')).find((x) => x.textContent === s), short);
        await b.asElement().click(); await sleep(700);
        return P.p.evaluate(() => {
          const pl = document.getElementById('callsignDialPlate');
          const body = document.getElementById('callsignDialPlateBody');
          const r = (id) => { const e = document.getElementById(id); if (!e || !body.contains(e)) return null; const b = e.getBoundingClientRect(); return b.width > 0 && b.height > 0; };
          return { shown: !pl.hidden, title: document.getElementById('callsignDialPlateTitle').textContent, notif: r('enableCallNotifsBtn'), country: r('countrySetting'), blocked: r('blockedPeopleSub'), countries: (document.getElementById('countrySetting') || {}).options ? document.getElementById('countrySetting').options.length : 0 };
        });
      };
      const a = await open('Alerts');
      add('Alerts opens call notifications on the dial', a.shown && a.title === 'Call notifications' && a.notif, JSON.stringify(a));
      const c = await open('Country');
      add('Country opens the country picker on the dial', c.shown && c.title === 'Country' && c.country && c.countries > 10, JSON.stringify(c));
      const s = await open('Stopped');
      add('Stopped opens the list of people stopped from reaching you', s.shown && /Stopped from reaching you/.test(s.title) && s.blocked, JSON.stringify(s));
      /* the button still does its job from the plate */
      await P.p.evaluate(() => { window.__askedNotif = 0; try { const o = Notification.requestPermission; Notification.requestPermission = function () { window.__askedNotif++; return o.apply(this, arguments); }; } catch (_) {} });
      await open('Alerts');
      await P.p.click('#enableCallNotifsBtn').catch(() => {}); await sleep(1200);
      const asked = await P.p.evaluate(() => ({ n: window.__askedNotif, status: (document.getElementById('callNotifStatus') || {}).textContent || '' }));
      add('Enable call notifications still works from the dial', asked.n > 0 || /on|enabled|blocked|allow|turned/i.test(asked.status), JSON.stringify(asked));
      if (G.shots) await P.p.screenshot({ path: G.shots + '/dial.png', fullPage: true }).catch(() => {});
      const errs = P.log.filter((l) => /PAGEERROR/.test(l));
      add('no page errors', errs.length === 0, errs.slice(0, 3).join(' | '));
    } finally { await P.b.close().catch(() => {}); }
    return out;
  },
};
