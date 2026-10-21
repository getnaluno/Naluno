/* ============================================================
   MODULE: js/admin-compass-check.js
   Health → "How good is Compass?" (21 Oct f).
   OWNERSHIP: this file.

   Asks the live Compass the same eight everyday questions, as you, and
   shows each answer, how long it took, which model answered, and whether
   it refused something it can do. Run it after deploying the Compass
   worker, and whenever Compass seems worse. Each run uses about 8 of the
   day's free Compass answers.
   ============================================================ */
(function (root) {
  const URL = 'https://naluno-compass.naluno.workers.dev';
  const QUESTIONS = [
    'What is the capital of Uganda, and roughly how many people live there?',
    'Write a two-line birthday message for my sister, in English and then in Luganda.',
    'Explain how vaccines work, simply, for a 12-year-old.',
    'Give me a 3-day plan to revise for a maths exam.',
    'What is 15% of 240,000 shillings?',
    'Summarise the story of Things Fall Apart in three sentences.',
    'How can I save money on a small monthly salary? Five ideas.',
    'My friend is sad after losing her job. What could I say to her?',
  ];
  const REFUSAL = /\b(i (do not|don't|dont) have (access|the ability|the capability|real-?time|browsing|internet)|i (cannot|can't|cant|am unable to|'m unable to|am not able to|'m not able to) (access|browse|search|look up|check|provide (links?|real-?time)|share links?|see|view|open|locate|find your|track|translate|help with that)|as an ai\b|as a language model|i'?m (just )?an ai|beyond my capabilities)\b/i;
  let rows = null;
  let running = false;

  async function token() {
    try {
      const u = root.firebase && root.firebase.auth && root.firebase.auth().currentUser;
      return u ? await u.getIdToken() : '';
    } catch (_) { return ''; }
  }
  async function run(onStep) {
    if (running) return rows;
    running = true;
    rows = [];
    const tok = await token();
    for (const q of QUESTIONS) {
      const t = Date.now();
      let row = { q: q, ms: 0, reply: '', model: '', refused: false, error: '' };
      try {
        const res = await fetch(URL, { method: 'POST', headers: { 'Authorization': 'Bearer ' + tok, 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: [{ role: 'user', content: q }] }) });
        const d = await res.json().catch(function () { return {}; });
        row.ms = Date.now() - t;
        row.reply = String(d.reply || '');
        row.model = String(d.model || '');
        row.error = res.ok ? '' : String(d.error || ('status ' + res.status));
        row.refused = !!row.reply && REFUSAL.test(row.reply.slice(0, 400));
      } catch (e) { row.ms = Date.now() - t; row.error = (e && e.message) || 'no answer'; }
      rows.push(row);
      try { if (onStep) onStep(); } catch (_) {}
    }
    running = false;
    return rows;
  }
  function html(h) {
    const esc = h.escapeHtml;
    let body;
    if (!rows) body = '<p class="sub">Asks the live Compass eight everyday questions as you and shows the answers. Uses about 8 of today’s free Compass answers.</p>';
    else {
      const done = rows.length;
      const ok = rows.filter(function (r) { return r.reply && !r.refused && !r.error; }).length;
      const avg = done ? Math.round(rows.reduce(function (s, r) { return s + r.ms; }, 0) / done / 100) / 10 : 0;
      const models = Array.from(new Set(rows.map(function (r) { return r.model; }).filter(Boolean))).join(', ') || 'unknown (the older Compass worker does not say)';
      body = '<p class="sub">' + (running ? 'Asking… ' : '') + ok + ' of ' + done + ' answered properly · ' + avg + ' s on average · ' + esc(models) + '</p>'
        + '<div class="desk-list" data-fold-title="The answers">' + rows.map(function (r) {
          const tag = r.error ? 'ERROR: ' + esc(r.error) : (r.refused ? 'REFUSED' : (Math.round(r.ms / 100) / 10) + ' s');
          return '<div class="flag-row" style="display:block;"><div style="font-weight:600;">' + esc(r.q) + ' <span class="sub" style="color:' + (r.error || r.refused ? '#FF8A9A' : 'var(--mint)') + ';">' + tag + '</span></div>'
            + '<div class="sub" style="white-space:pre-wrap;margin-top:4px;">' + esc(r.reply.slice(0, 700)) + '</div></div>';
        }).join('') + '</div>';
    }
    return h.card('How good is Compass?', body + '<div class="row"><button type="button" class="ghost" id="compassCheckBtn"' + (running ? ' disabled' : '') + '>' + (rows ? 'Ask again' : 'Ask Compass') + '</button></div>');
  }
  function bind(repaint) {
    if (root.__nalunoCompassCheckBound) return;
    root.__nalunoCompassCheckBound = true;
    document.addEventListener('click', function (e) {
      const b = e.target && e.target.closest ? e.target.closest('#compassCheckBtn') : null;
      if (!b || running) return;
      b.disabled = true;
      const p = run(repaint);
      try { repaint(); } catch (_) {}
      p.then(function () { try { repaint(); } catch (_) {} });
    });
  }
  root.NalunoCompassCheck = { run: run, html: html, bind: bind, QUESTIONS: QUESTIONS };
})(typeof window !== 'undefined' ? window : globalThis);
