/* Real calls between two phones: on Wi-Fi, on mobile networks (relay
   only), video, declined, cancelled. Each must ring, connect and carry
   sound both ways; the alert must leave quickly. */
const { pair, oneCall, hangUp, state, waitFor, sleep, dial } = require('../lib/phones.cjs');
const SCEN = [
  { name: 'voice call, Wi-Fi to Wi-Fi', a: { net: 'wifi', cached: true }, b: { net: 'wifi', cached: true } },
  { name: 'voice call, mobile to mobile (relay)', a: { net: 'mobile', cached: true }, b: { net: 'mobile', cached: true }, relay: true },
  { name: 'video call, mobile to mobile (relay)', a: { net: 'mobile', cached: true }, b: { net: 'mobile', cached: true }, video: true, relay: true },
  { name: 'voice call, cold relay credentials', a: { net: 'mobile' }, b: { net: 'mobile', cached: true }, relay: true },
];
module.exports = {
  name: 'calls',
  needs: ['relay'],
  async run(G) {
    const out = [];
    for (const sc of SCEN) {
      if (sc.relay && !G.relay) { out.push({ check: sc.name, ok: null, detail: 'not run: no relay address' }); continue; }
      const S = await pair(G, sc.a, sc.b);
      try {
        const t0 = Date.now();
        const r = await oneCall(S, { video: !!sc.video });
        const push = S.A.worker.find((w) => /call-notify/.test(w.url) && w.at >= t0);
        out.push({ check: sc.name + ': rings', ok: r.rang, detail: r.rang ? r.ringMs + ' ms' : 'no ring in 20 s' });
        out.push({ check: sc.name + ': connects', ok: !!r.connected, detail: '' });
        out.push({ check: sc.name + ': sound both ways', ok: !!(r.media && r.media.audio), detail: '' });
        if (sc.video) out.push({ check: sc.name + ': picture both ways', ok: !!(r.media && r.media.video), detail: '' });
        out.push({ check: sc.name + ': alert sent', ok: !!push, detail: push ? (push.at - t0) + ' ms after dial' : 'none' });
        await hangUp(S.A); await sleep(1500);
        const ended = !(await state(S.A.p)).overlay && !(await state(S.B.p)).overlay;
        out.push({ check: sc.name + ': both screens close on hang-up', ok: ended, detail: '' });
        const errs = S.A.log.concat(S.B.log).filter((l) => /PAGEERROR/.test(l));
        out.push({ check: sc.name + ': no page errors', ok: !errs.length, detail: errs.slice(0, 2).join(' / ') });
      } finally { await S.close(); }
    }
    /* declined and cancelled */
    for (const kind of ['decline', 'cancel']) {
      const S = await pair(G, { net: 'wifi', cached: true }, { net: 'wifi', cached: true });
      try {
        await dial(S.A, false);
        const rang = await waitFor(async () => (await state(S.B.p)).ring, 20000);
        await sleep(800);
        if (kind === 'decline') await S.B.p.evaluate(() => { document.getElementById('declineIncoming').click(); });
        else await S.A.p.evaluate(() => { document.getElementById('cancelCall').click(); });
        await sleep(2500);
        const closed = !(await state(S.A.p)).overlay && !(await state(S.B.p)).overlay && !(await state(S.B.p)).ring;
        out.push({ check: 'call ' + kind + 'd: rang, then both screens closed', ok: rang != null && closed, detail: '' });
      } finally { await S.close(); }
    }
    return out;
  },
};
