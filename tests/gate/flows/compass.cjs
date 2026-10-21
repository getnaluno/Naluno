/* Compass: the AI notice is there, every answer has a tiny ⚑, and it opens
   the report sheet with the words optional. */
const { pair, sleep } = require('../lib/phones.cjs');
module.exports = {
  name: 'compass',
  async run(G) {
    const out = [];
    /* The Compass worker, played here: it refuses the first time, as the
       small model used to, and answers when asked again. */
    const compassWorker = (u, body) => {
      if (!/naluno-compass/.test(u)) return null;
      const msgs = (body && body.messages) || [];
      const last = (msgs[msgs.length - 1] || {}).content || '';
      if (/newest Avatar/.test(last)) return { reply: 'From the app: ' + Array(8).fill('The newest movie is "Avatar 3" no. I have the correct title: The newest movie is "Avatar: The Last Shadow" no.').join(' '), model: 'test-model' };
      if (/You can do this/.test(last)) return { reply: 'The Nile is about 6,650 km long.', model: 'test-model' };
      return { reply: "I'm sorry, but I don't have access to real-time information or the internet.", model: 'test-model' };
    };
    const S = await pair(G, { net: 'wifi', cached: true, workerAnswer: compassWorker }, { net: 'wifi', cached: true });
    try {
      const P = S.A;
      S.store.seed('users/alice/compassMessages/m1', { from: 'user', text: 'what is the capital of Uganda', ts: Date.now() - 2000 });
      S.store.seed('users/alice/compassMessages/m2', { from: 'compass', text: 'Kampala.', ts: Date.now() - 1000 });
      await P.p.evaluate(() => { try { nalunoShowTab('compass'); } catch (_) {} try { loadCompassMessages(); } catch (_) {} });
      await sleep(2500);
      const r = await P.p.evaluate(() => {
        const note = document.getElementById('compassAiNote');
        const flags = document.querySelectorAll('#compassMessages .compass-flag');
        const f = flags[0];
        const bubble = f && f.closest('.msg-bubble');
        const fs = f ? parseFloat(getComputedStyle(f).fontSize) : 0;
        const bs = bubble ? parseFloat(getComputedStyle(bubble).fontSize) : 0;
        return { note: note ? note.textContent : '', flags: flags.length, small: fs > 0 && fs < bs, fs, bs, onMine: !!document.querySelector('#compassMessages .msg-row.me .compass-flag') };
      });
      out.push({ check: 'AI notice under the Compass box', ok: /Compass is AI and can make mistakes/.test(r.note), detail: r.note });
      out.push({ check: 'one ⚑ per answer, none on your own question', ok: r.flags === 1 && !r.onMine, detail: r.flags + ' flags' });
      out.push({ check: 'the ⚑ is smaller than the answer text', ok: r.small, detail: r.fs + 'px vs ' + r.bs + 'px' });
      await P.p.evaluate(() => document.querySelector('#compassMessages .compass-flag').click());
      await sleep(500);
      const sh = await P.p.evaluate(() => {
        const s = document.getElementById('reportSheet');
        return { open: !!(s && s.classList.contains('active')), quick: s && s.dataset.quick, sendable: !document.getElementById('reportSendBtn').disabled, opts: Array.from(document.getElementById('reportReasonCode').options).map((o) => o.textContent) };
      });
      out.push({ check: 'report sheet opens for the answer, words optional', ok: sh.open && sh.quick === '1' && sh.sendable, detail: sh.opts.join(', ') });
      await P.p.evaluate(() => document.getElementById('reportSendBtn').click());
      await sleep(1200);
      const sent = P.worker.find((w) => /\/v1\/report/.test(w.url));
      out.push({ check: 'report sends the answer, not the question', ok: !!sent && /Kampala\./.test(sent.body.reason) && !/capital of Uganda/.test(sent.body.reason) && sent.body.target_type === 'compass', detail: sent ? sent.body.reason_code : 'not sent' });
      /* 21 Oct f: one instruction message, the question last, and a refusal asked again */
      await P.p.evaluate(() => { document.querySelectorAll('.call-overlay.active').forEach((x) => x.classList.remove('active')); });
      const before = P.worker.length;
      await P.p.evaluate(() => { document.getElementById('compassInput').value = 'How long is the Nile?'; sendCompassMessage(); });
      await sleep(6000);
      const calls = P.worker.slice(before).filter((w) => /naluno-compass/.test(w.url));
      const firstReq = calls[0] && calls[0].body && calls[0].body.messages || [];
      out.push({ check: 'Compass sends one instruction message, the question last', ok: firstReq.filter((m) => m.role === 'system').length === 1 && firstReq[0].role === 'system' && /How long is the Nile\?/.test(firstReq[firstReq.length - 1].content), detail: firstReq.map((m) => m.role).join(',') });
      out.push({ check: 'the earlier refusal is not sent back as history', ok: !firstReq.some((m) => m.role === 'assistant' && /don't have access/.test(m.content)), detail: '' });
      out.push({ check: 'a refusal is asked again once, and the real answer shown', ok: calls.length === 2 && (await P.p.evaluate(() => /6,650 km/.test(document.getElementById('compassMessages').innerText))), detail: calls.length + ' requests' });
      out.push({ check: 'no place sent with a question that is not about the phone', ok: !JSON.stringify(firstReq).includes('own phones, last Find Naluno ping'), detail: '' });
      /* 22 Oct a: an answer that goes round in circles is never shown */
      await P.p.evaluate(() => { document.getElementById('compassInput').value = 'What is the newest Avatar film?'; sendCompassMessage(); });
      await sleep(7000);
      const lastMsg = await P.p.evaluate(() => { const b = document.querySelectorAll('#compassMessages .msg-row:not(.me) .msg-bubble'); return b.length ? b[b.length - 1].innerText : ''; });
      out.push({ check: 'a looping answer is not shown, and no "From the app:"', ok: !!lastMsg && !/no\. I have the correct title/.test(lastMsg) && !/From the app/.test(lastMsg) && !/Last Shadow/.test(lastMsg), detail: lastMsg.slice(0, 120) });
      const errs = P.log.filter((l) => /PAGEERROR/.test(l));
      out.push({ check: 'no page errors', ok: !errs.length, detail: errs.slice(0, 2).join(' / ') });
    } finally { await S.close(); }
    return out;
  },
};
