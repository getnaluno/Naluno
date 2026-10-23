/* Mixed app versions (23 Oct d): while phones update, a new app calls an
   older one and the other way round. Both directions, voice and video,
   must connect with sound (and picture) both ways. The older app is the
   calls.js of build 2026.10.23b (fixtures/). */
const path = require('path');
const { pair, state, sleep, waitFor } = require('../lib/phones.cjs');
const OLD = path.join(__dirname, '..', 'fixtures', 'calls-live-20261023b.js');
const PROBE = () => { window.__hear = null; window.__see = null; let a0 = null, v0 = null; const iv = setInterval(async () => { try { const pc = (typeof peerConnection !== 'undefined' && peerConnection); if (!pc) return; const r = await pc.getStats(); let a = 0, v = 0; r.forEach((x) => { if (x.type === 'inbound-rtp') { if (x.kind === 'audio') a += x.packetsReceived || 0; else v += x.framesDecoded || 0; } }); if (a0 === null) { a0 = a; v0 = v; } if (window.__hear === null && a > a0 + 5) window.__hear = 1; if (window.__see === null && v > v0 + 2) window.__see = 1; } catch (_) {} }, 80); setTimeout(() => clearInterval(iv), 25000); };
module.exports = {
  name: 'call-mixed',
  async run(G) {
    const out = [];
    const base = { net: 'wifi', cached: true, micMs: 300, camMs: 900 };
    const cases = [
      { name: 'new app calls an older app (voice)', a: base, b: Object.assign({ callsJs: OLD }, base), video: false },
      { name: 'older app calls the new app (voice)', a: Object.assign({ callsJs: OLD }, base), b: base, video: false },
      { name: 'new app calls an older app (video)', a: base, b: Object.assign({ callsJs: OLD }, base), video: true },
      { name: 'older app calls the new app (video)', a: Object.assign({ callsJs: OLD }, base), b: base, video: true },
    ];
    for (const c of cases) {
      const S = await pair(G, c.a, c.b, { fsMs: 150 });
      try {
        await sleep(1200);
        await S.A.p.evaluate((v) => { if (v) startOutgoingCall('c-bob'); else startAudioCall('c-bob'); }, c.video);
        if (c.video) { await sleep(500); await S.A.p.evaluate(() => { const b = document.getElementById('joinBtn'); b && b.click(); }); }
        const rang = await waitFor(async () => (await state(S.B.p)).ring, 20000, 50);
        if (rang == null) { out.push({ check: c.name + ': rings', ok: false, detail: 'no ring' }); continue; }
        await sleep(1500);
        await Promise.all([S.A.p.evaluate(PROBE), S.B.p.evaluate(PROBE)]);
        await S.B.p.evaluate(() => { const b = document.getElementById('acceptIncoming'); b.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'touch', button: 0 })); });
        let h = {};
        for (let i = 0; i < 50; i++) {
          await sleep(200);
          h = { aHear: await S.A.p.evaluate(() => window.__hear), bHear: await S.B.p.evaluate(() => window.__hear), aSee: await S.A.p.evaluate(() => window.__see), bSee: await S.B.p.evaluate(() => window.__see) };
          if (h.aHear && h.bHear && (!c.video || (h.aSee && h.bSee))) break;
        }
        const ok = !!(h.aHear && h.bHear && (!c.video || (h.aSee && h.bSee)));
        out.push({ check: c.name + ': ' + (c.video ? 'sound and picture' : 'sound') + ' both ways', ok, detail: JSON.stringify(h) });
        const errs = S.A.log.concat(S.B.log).filter((l) => /PAGEERROR/.test(l));
        out.push({ check: c.name + ': no page errors', ok: !errs.length, detail: errs.slice(0, 2).join(' / ') });
      } finally { await S.close(); }
    }
    return out;
  },
};
