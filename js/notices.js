/* ============================================================
   MODULE: js/notices.js
   Notices from Naluno, and the appeal.

   When a report takes a Broadcast off the feed, the person it belongs to
   should be told — not left to notice it missing. The worker writes a notice
   to users/{uid}/notices; this shows it and offers the appeal.

   It is a notice FROM NALUNO, never a message from a person. Wireline is end
   to end encrypted and the worker holds no keys, so it could not forge one
   even if that were acceptable — and a platform message dressed up as a
   person's message would be a lie either way. It is labelled as Naluno's.
   ============================================================ */
(function (root) {
  'use strict';
  const SEEN = 'nalunoNoticesSeen';
  let started = false;

  function seen() { try { return JSON.parse(root.localStorage.getItem(SEEN) || '{}'); } catch (_) { return {}; } }
  function markSeen(id) {
    try { const s = seen(); s[id] = Date.now(); root.localStorage.setItem(SEEN, JSON.stringify(s)); } catch (_) {}
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  const WHY = {
    sexual: 'sexual content',
    terrorism: 'terrorism or violent extremism',
    recruitment: 'recruitment to violence',
    child_exploitation: 'child exploitation',
    sexual_exploitation: 'sexual exploitation',
    violence: 'a threat of violence',
  };

  function noticeText(n) {
    const why = WHY[n.reason_code] || 'a report';
    return n.kind === 'broadcast_hidden'
      ? 'One of your Broadcasts has been taken off Naluno after a report about ' + why
        + '. A person will review it. If you think this is wrong, you can appeal.'
      : 'One of your Broadcasts is held off the feed after a report about ' + why
        + '. It is waiting for a person to look at it. You can appeal if you think this is wrong.';
  }

  async function appeal(n, btn) {
    const note = root.prompt('Tell us why this is wrong (a sentence is enough):');
    if (note === null) return;
    if (!String(note).trim()) { root.toast('An appeal needs a reason'); return; }
    if (btn) { btn.disabled = true; btn.textContent = 'Sending\u2026'; }
    try {
      const idToken = await root.currentUser.getIdToken(false);
      const res = await fetch('https://naluno-economy.naluno.workers.dev/v1/safety/appeal', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + idToken, 'Content-Type': 'application/json' },
        body: JSON.stringify({ case_id: n.case_id, note: String(note).trim() }),
      });
      const b = await res.json().catch(function () { return {}; });
      if (!res.ok || !b.ok) {
        root.toast(b.error || 'Could not send the appeal');
        if (btn) { btn.disabled = false; btn.textContent = 'Appeal'; }
        return;
      }
      root.toast('Appeal sent \u2014 a person will look at it');
      if (btn) { btn.textContent = 'Appeal sent'; btn.disabled = true; }
      try { await root.fbDb.collection('users').doc(root.currentUser.uid)
        .collection('notices').doc(n.notice_id).set({ appealed: true, appealedAt: Date.now() }, { merge: true }); } catch (_) {}
    } catch (_) {
      root.toast('Couldn\u2019t reach the service');
      if (btn) { btn.disabled = false; btn.textContent = 'Appeal'; }
    }
  }

  function render(list) {
    const box = root.document.getElementById('noticeBar');
    if (!box) return;
    const open = (list || []).filter(function (n) { return n && !n.appealed; });
    if (!open.length) { box.style.display = 'none'; box.innerHTML = ''; return; }
    const n = open[0];
    box.style.display = 'block';
    box.innerHTML = '<div class="notice-from">Naluno</div>'
      + '<div class="notice-text">' + esc(noticeText(n)) + '</div>'
      + '<div class="row" style="margin-top:8px;">'
      + (n.appealable ? '<button type="button" class="notice-appeal" id="noticeAppealBtn">Appeal</button>' : '')
      + '<button type="button" class="notice-dismiss" id="noticeSeenBtn">Got it</button></div>';
    const a = root.document.getElementById('noticeAppealBtn');
    if (a) a.onclick = function () { appeal(n, a); };
    const d = root.document.getElementById('noticeSeenBtn');
    if (d) d.onclick = function () { markSeen(n.notice_id); render(open.slice(1)); };
  }

  function start() {
    if (started || !root.currentUser || !root.fbDb) return;
    started = true;
    try {
      root.fbDb.collection('users').doc(root.currentUser.uid).collection('notices')
        .orderBy('ts', 'desc').limit(10)
        .onSnapshot(function (snap) {
          const s = seen();
          const rows = [];
          snap.forEach(function (doc) {
            const d = doc.data() || {};
            d.notice_id = d.notice_id || doc.id;
            if (!s[d.notice_id]) rows.push(d);
          });
          render(rows);
        }, function () { /* a notice failing to load must not break the app */ });
    } catch (_) {}
  }

  (function boot() {
    let tries = 0;
    const t = setInterval(function () {
      tries++;
      if (root.currentUser && root.fbDb) { clearInterval(t); start(); return; }
      if (tries > 60) clearInterval(t);
    }, 1000);
  })();

  root.nalunoNoticesStart = start;
  root.__notices = { render: render, noticeText: noticeText, appeal: appeal };
})(typeof window !== 'undefined' ? window : globalThis);
