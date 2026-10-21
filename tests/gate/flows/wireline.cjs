/* Two phones: a Wireline message each way arrives, the alert request leaves
   the sender with only who and which message (never the words), and leaves
   quickly. */
const { pair, sleep, waitFor } = require('../lib/phones.cjs');
module.exports = {
  name: 'wireline',
  async run(G) {
    const out = [];
    const S = await pair(G, { net: 'wifi', cached: true }, { net: 'wifi', cached: true }, { fsMs: 300 });
    try {
      const send = async (P, cid, text) => {
        await P.p.evaluate((id) => { const c = contacts.find((x) => x.id === id); openThread(c.id); }, cid);
        await sleep(700);
        const t0 = Date.now();
        await P.p.evaluate((t) => { document.getElementById('threadInput').value = t; sendThreadMessage(); }, text);
        return t0;
      };
      const arrived = (P, text) => P.p.evaluate((t) => { try { return Object.values(wirelineThreads || {}).some((rows) => (rows || []).some((m) => m && m.text === t)); } catch (_) { return false; } }, text);
      const text1 = 'gate hello ' + Date.now();
      const t0 = await send(S.A, 'c-bob', text1);
      const got = await waitFor(() => arrived(S.B, text1), 15000);
      out.push({ check: 'Alice → Bob arrives', ok: got != null, detail: got != null ? got + ' ms' : 'not within 15 s' });
      const alert = S.A.worker.find((w) => /\/v1\/wire\/notify/.test(w.url) && w.at >= t0);
      out.push({ check: 'alert requested for the message', ok: !!alert, detail: alert ? (alert.at - t0) + ' ms after tap' : 'no request' });
      if (alert) {
        const keys = Object.keys(alert.body || {}).sort().join(',');
        out.push({ check: 'alert carries who and which message only', ok: /^clientMsgId,(pingId,)?to$/.test(keys) && !JSON.stringify(alert.body).includes('gate hello'), detail: keys });
        out.push({ check: 'alert leaves within 2.5 s on a slow database (300 ms a trip)', ok: alert.at - t0 < 2500, detail: (alert.at - t0) + ' ms' });
      }
      const text2 = 'gate reply ' + Date.now();
      await send(S.B, 'c-alice', text2);
      const back = await waitFor(() => arrived(S.A, text2), 15000);
      out.push({ check: 'Bob → Alice arrives', ok: back != null, detail: back != null ? back + ' ms' : 'not within 15 s' });
      const sealed = [...S.store.docs.entries()].filter(([k]) => /^wireDrop\//.test(k)).every(([, d]) => !('text' in d) || d.type === 'missed_call');
      out.push({ check: 'no message words stored on the server', ok: sealed, detail: '' });
      const errs = S.A.log.concat(S.B.log).filter((l) => /PAGEERROR/.test(l));
      out.push({ check: 'no page errors', ok: !errs.length, detail: errs.slice(0, 2).join(' / ') });
    } finally { await S.close(); }
    return out;
  },
};
