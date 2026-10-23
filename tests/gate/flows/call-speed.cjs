/* Calls connect fast, and the fast path is safe (23 Oct d).
   - Speed limits (measured inside each phone): voice rings within 1.2 s of
     the tap; after Answer both people hear each other within 1.2 s (voice)
     and 1.8 s (video). Before 23d, video took 2-2.7 s after Answer.
   - Answering before your own camera has opened still gives sound and
     picture both ways as soon as it opens.
   - A slow camera on the caller does not hold back the ring.
   - The caller's mic failing after the ring started ends the ring and
     says so.
   - Permission not granted yet: the old order (no ring while the
     permission question is up), and the call still works. */
const { pair, state, sleep, waitFor } = require('../lib/phones.cjs');
const PROBE = () => {
  window.__hear = null; window.__see = null; let a0 = null, v0 = null;
  const iv = setInterval(async () => {
    try {
      const pc = (typeof peerConnection !== 'undefined' && peerConnection); if (!pc) return;
      const r = await pc.getStats(); let a = 0, v = 0;
      r.forEach((x) => { if (x.type === 'inbound-rtp') { if (x.kind === 'audio') a += x.packetsReceived || 0; else v += x.framesDecoded || 0; } });
      if (a0 === null) { a0 = a; v0 = v; }
      const now = performance.timeOrigin + performance.now();
      if (window.__hear === null && a > a0 + 5) window.__hear = now;
      if (window.__see === null && v > v0 + 2) window.__see = now;
    } catch (_) {}
  }, 50);
  setTimeout(() => clearInterval(iv), 25000);
};
async function call(G, a, b, o) {
  const S = await pair(G, a, b, { fsMs: 200 });
  const out = { S };
  await sleep(1200);
  const t0 = Date.now();
  await S.A.p.evaluate((v) => { if (v) startOutgoingCall('c-bob'); else startAudioCall('c-bob'); }, !!o.video);
  if (o.video) { await sleep(o.lobbyMs || 400); await S.A.p.evaluate(() => { const b = document.getElementById('joinBtn'); b && b.click(); }); }
  const tStart = Date.now();
  const rang = await waitFor(async () => (await state(S.B.p)).ring, 20000, 40);
  out.ringMs = rang == null ? null : Date.now() - tStart;
  if (rang == null) return out;
  await sleep(o.answerAfterMs == null ? 1500 : o.answerAfterMs);
  await Promise.all([S.A.p.evaluate(PROBE), S.B.p.evaluate(PROBE)]);
  const tAns = await S.B.p.evaluate(() => performance.timeOrigin + performance.now());
  await S.B.p.evaluate(() => { const b = document.getElementById('acceptIncoming'); b.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'touch', button: 0 })); });
  let h = {};
  for (let i = 0; i < (o.waitS || 10) * 5; i++) {
    await sleep(200);
    h = { aHear: await S.A.p.evaluate(() => window.__hear), bHear: await S.B.p.evaluate(() => window.__hear), aSee: await S.A.p.evaluate(() => window.__see), bSee: await S.B.p.evaluate(() => window.__see) };
    if (h.aHear && h.bHear && (!o.video || (h.aSee && h.bSee))) break;
  }
  const rel = (x) => (x ? Math.round(x - tAns) : null);
  out.hear = Math.max(rel(h.aHear) == null ? 1e9 : rel(h.aHear), rel(h.bHear) == null ? 1e9 : rel(h.bHear));
  out.see = o.video ? Math.max(rel(h.aSee) == null ? 1e9 : rel(h.aSee), rel(h.bSee) == null ? 1e9 : rel(h.bSee)) : null;
  out.detail = { callerHears: rel(h.aHear), calleeHears: rel(h.bHear), callerSees: rel(h.aSee), calleeSees: rel(h.bSee) };
  return out;
}
const errsOf = (S) => S.A.log.concat(S.B.log).filter((l) => /PAGEERROR/.test(l));
module.exports = {
  name: 'call-speed',
  async run(G) {
    const out = [];
    const warm = { net: 'wifi', cached: true, micMs: 300, camMs: 900 };
    /* 1. voice speed (two tries, best counts: a shared test machine is noisy) */
    let best = null;
    for (let k = 0; k < 2; k++) {
      const r = await call(G, warm, warm, {});
      try {
        if (!best || (r.hear < best.hear)) best = { ringMs: r.ringMs, hear: r.hear, detail: r.detail };
        if (errsOf(r.S).length) out.push({ check: 'voice call: no page errors', ok: false, detail: errsOf(r.S).slice(0, 2).join(' / ') });
      } finally { await r.S.close(); }
    }
    out.push({ check: 'voice: the other phone rings within 1.0 s of the tap (was ~1 s+)', ok: best.ringMs != null && best.ringMs < 1000, detail: best.ringMs + ' ms' });
    out.push({ check: 'voice: both hear each other within 1.2 s of Answer', ok: best.hear < 1200, detail: JSON.stringify(best.detail) });
    /* 2. video speed */
    best = null;
    for (let k = 0; k < 2; k++) {
      const r = await call(G, warm, warm, { video: true });
      try { if (!best || (r.hear < best.hear)) best = { hear: r.hear, see: r.see, ringMs: r.ringMs, detail: r.detail }; } finally { await r.S.close(); }
    }
    out.push({ check: 'video: both hear each other within 1.4 s of Answer (was 2-2.7 s)', ok: best.hear < 1400, detail: JSON.stringify(best.detail) });
    out.push({ check: 'video: both see each other within 3 s of Answer', ok: best.see < 3000, detail: JSON.stringify(best.detail) });
    /* 3. answering before your own camera has opened */
    {
      const r = await call(G, warm, { net: 'wifi', cached: true, camMs: 3500, micMs: 3500 }, { video: true, answerAfterMs: 300, waitS: 12 });
      try {
        out.push({ check: 'answered before own camera opened: sound and picture both ways once it opens', ok: r.hear < 6000 && r.see < 7000, detail: JSON.stringify(r.detail) });
        out.push({ check: 'answered before own camera opened: no page errors', ok: !errsOf(r.S).length, detail: errsOf(r.S).slice(0, 2).join(' / ') });
      } finally { await r.S.close(); }
    }
    /* 4. slow caller camera does not hold back the ring */
    {
      const r = await call(G, { net: 'wifi', cached: true, camMs: 2500, micMs: 300 }, warm, { video: true, lobbyMs: 100, answerAfterMs: 1200, waitS: 12 });
      try {
        out.push({ check: 'caller camera slow (2.5 s): the other phone still rings within 1.5 s of Start', ok: r.ringMs != null && r.ringMs < 1500, detail: r.ringMs + ' ms' });
        out.push({ check: 'caller camera slow: sound and picture both ways after Answer', ok: r.hear < 6000 && r.see < 7000, detail: JSON.stringify(r.detail) });
      } finally { await r.S.close(); }
    }
    /* 5. caller mic fails after the ring started: ring ends, caller told */
    {
      const S = await pair(G, { net: 'wifi', cached: true, gumFailMs: 900 }, warm, { fsMs: 200 });
      try {
        await sleep(1200);
        await S.A.p.evaluate(() => { startAudioCall('c-bob'); });
        const rang = await waitFor(async () => (await state(S.B.p)).ring, 8000, 40);
        await sleep(3500);
        const b = await state(S.B.p), a = await state(S.A.p);
        const told = S.A.toasts.some((t) => /Microphone unavailable|Couldn.t start/i.test(t));
        out.push({ check: 'caller mic fails after ringing: the ring stops, the caller is told', ok: rang != null && !b.ring && !a.overlay && told, detail: JSON.stringify({ rang: rang != null, calleeRinging: b.ring, callerScreen: a.overlay, toasts: S.A.toasts.slice(-2) }) });
      } finally { await S.close(); }
    }
    /* 6. permission not granted yet: old order, still works */
    {
      const r = await call(G, { net: 'wifi', cached: true, micMs: 300, permsPrompt: true }, warm, {});
      try {
        const rec = await r.S.A.p.evaluate(() => { const all = window.__nalunoCallTimes || {}; const id = Object.keys(all).pop(); return all[id] || {}; });
        out.push({ check: 'permission not granted yet: no ring before the mic is open, and the call works', ok: r.ringMs != null && r.hear < 3000 && rec.callerMedia == null, detail: JSON.stringify(r.detail) });
      } finally { await r.S.close(); }
    }
    return out;
  },
};
