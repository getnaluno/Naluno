/* Signals as Naluno's reels in our diamond (24 Oct b): tall diamonds with
   the clip filling the diamond and the name under it, a few on screen at once, the first
   Broadcast still in view, and every card still opens what it opened. */
const { makeStore } = require('../lib/store.cjs');
const { phone, seedPair, sleep } = require('../lib/phones.cjs');
module.exports = {
  name: 'signals-strip',
  async run(G) {
    const out = [];
    const add = (check, ok, detail) => out.push({ check, ok: !!ok, detail: detail || '' });
    const store = makeStore({}); seedPair(store);
    const P = await phone(G, store, 'alice', [], { net: 'wifi', cached: true });
    try {
      await P.p.evaluate(() => { try { localStorage.setItem('nalunoLegalSeen', NALUNO_LEGAL_VERSION); } catch (_) {} document.querySelectorAll('#nalunoLegalNotice').forEach((x) => x.remove()); });
      await P.p.click('.navbtn[data-tab="broadcast"]'); await sleep(1500);
      await P.p.evaluate(() => {
        const pic = (a, b) => { const c = document.createElement('canvas'); c.width = 90; c.height = 160; const g = c.getContext('2d'); const gr = g.createLinearGradient(0, 0, 90, 160); gr.addColorStop(0, a); gr.addColorStop(1, b); g.fillStyle = gr; g.fillRect(0, 0, 90, 160); return c.toDataURL('image/jpeg', .8); };
        const now = Date.now();
        const mk = (id, name, latest) => ({ contact: { id, name, initials: name[0], color: '#7CFFB2', firebaseUid: id }, latest: Object.assign({ createdAt: now - 7200e3, expiresAt: now + 36e6 }, latest) });
        connectionsSignals.length = 0;
        connectionsSignals.push(mk('c1', 'Emma Shoots', { type: 'video', thumbDataUrl: pic('#f7971e', '#ffd200') }));
        connectionsSignals.push(mk('c2', 'Bob Test', { type: 'text', text: 'Gwe, tugenda ku mukolo leero? Nja kukusanga ku ssomero.', bg: '#7C4DFF' }));
        connectionsSignals.push(mk('c3', 'Nakato', { type: 'photo', photoUrl: pic('#11998e', '#38ef7d') }));
        renderBroadcastTab();
      });
      await sleep(1500);
      const L = await P.p.evaluate(() => {
        const strip = document.getElementById('myBcastStrip').getBoundingClientRect();
        const tiles = Array.from(document.querySelectorAll('#myBcastStrip .signal-tile'));
        const one = (t) => { const w = t.querySelector('.signal-window').getBoundingClientRect(); const cap = t.querySelector('.signal-tile-cap').getBoundingClientRect(); const img = t.querySelector('.signal-window-in img, .signal-window-in .avatar'); const ir = img ? img.getBoundingClientRect() : null; const dia = (el) => /polygon\(50% 0(px)?, 100% 50%, 50% 100%, 0(px)? 50%\)/.test(getComputedStyle(el).clipPath); return { w: Math.round(w.width), h: Math.round(w.height), rim: dia(t.querySelector('.signal-edge')), clipDia: img ? dia(img) : null, capUnder: cap.top >= w.bottom - 8, fill: ir ? Math.round(ir.width * ir.height / (w.width * w.height) * 100) : 0 }; };
        const text = document.querySelector('#myBcastStrip [data-signal="c2"] .avatar');
        const onScreen = tiles.filter((t) => { const r = t.getBoundingClientRect(); const vis = Math.min(r.right, innerWidth) - Math.max(r.left, 0); return vis >= r.width * 0.8; }).length;
        return { n: tiles.length, cards: tiles.map(one), stripBottom: Math.round(strip.bottom), vh: innerHeight, onScreen, textShown: text ? text.textContent : '' };
      });
      const cards = L.cards;
      add('Signals are reels in our diamond: tall diamonds, big enough to see', cards.length === 4 && cards.every((c) => c.rim && c.w >= 100 && c.h >= 150 && c.h / c.w > 1.3), JSON.stringify(cards.map((c) => c.w + 'x' + c.h + (c.rim ? ' diamond' : ''))));
      add('the clip fills the whole diamond and the name sits under it', cards.slice(1).every((c) => c.fill >= 85 && c.clipDia && c.capUnder) && cards[0].capUnder, JSON.stringify(cards));
      add('about three Signals on screen at once (the rest scroll)', L.onScreen >= 3, L.onScreen + ' of ' + L.n);
      add('the strip leaves most of the screen to the Broadcasts', L.stripBottom < L.vh * 0.5, L.stripBottom + ' of ' + L.vh);
      add('a written Signal shows more than a few words', L.textShown.length > 40, L.textShown);
      await P.p.click('#newSignalItem'); await sleep(1200);
      const comp = await P.p.evaluate(() => { const c = document.getElementById('composer'); return !!(c && c.classList.contains('active')); });
      add('New Signal still opens the composer', comp);
      const errs = P.log.filter((l) => /PAGEERROR/.test(l));
      add('no page errors', errs.length === 0, errs.slice(0, 2).join(' | '));
    } finally { await P.b.close().catch(() => {}); }
    return out;
  },
};
