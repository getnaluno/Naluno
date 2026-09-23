/* ============================================================
   MODULE: js/signal-social.js
   Who watched your Signal, and what they felt about it.

   WhatsApp shows a list of names and, lately, a reaction. Two things are
   better here:

     1. The reaction is on the SEGMENT, not the whole Signal, so you can see
        that people reacted to the second clip and not the first.
     2. The person watching sees the reactions too — not just the owner.
        A Signal is a moment shared with your Frequencies; making the
        response one-way turns it into an audience measurement.

   Who watched is only ever shown to the person whose Signal it is, and the
   rules enforce that: a viewer can write their own row and read nothing else.
   ============================================================ */
(function (root) {
  'use strict';
  const REACTIONS = ['👍', '🔥', '🐐', '❤️'];
  const seenLocal = {};   // avoid re-writing the same view in one session

  function db() { return root.fbDb; }
  function me() { return root.currentUser && root.currentUser.uid; }

  function viewerRef(ownerUid, segId, uid) {
    return db().collection('users').doc(ownerUid)
      .collection('signal').doc(String(segId))
      .collection('viewers').doc(uid);
  }

  /** Record that I watched this segment. Idempotent: merge, never a counter,
   *  so watching twice is still one viewer. */
  async function markViewed(ownerUid, segId) {
    try {
      const uid = me();
      if (!uid || !db() || !ownerUid || !segId) return;
      if (ownerUid === uid) return;                 // your own Signal is not a view
      const key = ownerUid + '|' + segId;
      if (seenLocal[key]) return;
      seenLocal[key] = true;
      await viewerRef(ownerUid, segId, uid).set({
        uid: uid,
        name: (root.currentProfile && root.currentProfile.name) || 'Someone',
        viewedAt: Date.now(),
      }, { merge: true });
    } catch (_) { /* a view that cannot be recorded must not break playback */ }
  }

  /** Set or clear my reaction to this segment. Tapping the same one removes it. */
  async function react(ownerUid, segId, emoji) {
    try {
      const uid = me();
      if (!uid || !db() || !ownerUid || !segId) return null;
      if (ownerUid === uid) { root.toast('That one is yours'); return null; }
      const ref = viewerRef(ownerUid, segId, uid);
      const cur = await ref.get();
      const had = cur.exists ? (cur.data().reaction || '') : '';
      const next = (had === emoji) ? '' : emoji;
      await ref.set({
        uid: uid,
        name: (root.currentProfile && root.currentProfile.name) || 'Someone',
        reaction: next,
        reactedAt: Date.now(),
        viewedAt: (cur.exists && cur.data().viewedAt) || Date.now(),
      }, { merge: true });
      return next;
    } catch (_) { root.toast('Couldn\u2019t save that'); return null; }
  }

  /** Everyone who watched one of MY segments. Only the owner may read this. */
  async function viewersOf(segId) {
    const uid = me();
    if (!uid || !db() || !segId) return [];
    try {
      const snap = await db().collection('users').doc(uid)
        .collection('signal').doc(String(segId))
        .collection('viewers').orderBy('viewedAt', 'desc').limit(200).get();
      const out = [];
      snap.forEach(function (d) { out.push(d.data() || {}); });
      return out;
    } catch (_) { return []; }
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /** Group reactions for a compact summary: 🔥3 ❤️1 */
  function summarise(rows) {
    const counts = {};
    (rows || []).forEach(function (r) {
      const e = r && r.reaction;
      if (e) counts[e] = (counts[e] || 0) + 1;
    });
    return REACTIONS.filter(function (e) { return counts[e]; })
      .map(function (e) { return { emoji: e, n: counts[e] }; });
  }

  /** The owner's sheet: who watched, and what each of them felt. */
  async function openViewers(segId) {
    const sheet = root.document.getElementById('signalViewers');
    if (!sheet) return;
    sheet.classList.add('active');
    const body = root.document.getElementById('signalViewersBody');
    if (body) body.innerHTML = '<p class="sub">Loading\u2026</p>';
    const rows = await viewersOf(segId);
    const sum = summarise(rows);
    if (!body) return;
    if (!rows.length) {
      body.innerHTML = '<p class="sub">Nobody has watched this one yet.</p>';
      return;
    }
    body.innerHTML =
      '<div class="sv-count">' + rows.length + (rows.length === 1 ? ' person watched' : ' people watched') + '</div>'
      + (sum.length ? '<div class="sv-sum">' + sum.map(function (x) {
          return '<span class="sv-chip">' + x.emoji + ' ' + x.n + '</span>';
        }).join('') + '</div>' : '')
      + '<div class="sv-list">' + rows.map(function (r) {
          const when = r.viewedAt ? new Date(Number(r.viewedAt)).toLocaleString() : '';
          return '<div class="sv-row"><span class="sv-name">' + esc(r.name || 'Someone') + '</span>'
            + '<span class="sv-react">' + (r.reaction ? esc(r.reaction) : '') + '</span>'
            + '<span class="sv-when">' + esc(when) + '</span></div>';
        }).join('') + '</div>';
  }
  function closeViewers() {
    const sheet = root.document.getElementById('signalViewers');
    if (sheet) sheet.classList.remove('active');
  }

  /** The bar a viewer sees under someone else's Signal. */
  function reactionBarHtml(mine) {
    return '<div class="sig-react">' + REACTIONS.map(function (e) {
      return '<button type="button" class="sig-react-btn' + (mine === e ? ' on' : '')
        + '" data-react="' + e + '">' + e + '</button>';
    }).join('') + '</div>';
  }

  /** A Signal made from a Broadcast links back to it. */
  function linkedBroadcastHtml(seg) {
    // Written by the composer as linkedBroadcastId; broadcastId kept for any
    // older segment or caller using the other name.
    const id = seg && (seg.linkedBroadcastId || seg.broadcastId);
    if (!id) return '';
    const title = (seg.broadcastTitle || 'the Broadcast');
    return '<button type="button" class="sig-bcast" data-bcast="' + esc(id) + '">'
      + '\u25b6 Watch ' + esc(String(title).slice(0, 40)) + '</button>';
  }
  function wireLinkedBroadcast(scope) {
    (scope || root.document).querySelectorAll('[data-bcast]').forEach(function (b) {
      b.onclick = function (e) {
        try { e.stopPropagation(); } catch (_) {}
        const id = b.getAttribute('data-bcast');
        try { if (typeof root.closeSignalViewer === 'function') root.closeSignalViewer(); } catch (_) {}
        if (typeof root.openBroadcastById === 'function') root.openBroadcastById(id);
      };
    });
  }

  (function wireSheet(){
    function bind(){
      const c = root.document.getElementById('signalViewersClose');
      if (c) c.onclick = closeViewers;
      const sheet = root.document.getElementById('signalViewers');
      if (sheet) sheet.onclick = function (e) { if (e && e.target === sheet) closeViewers(); };
    }
    if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', bind);
    else bind();
  })();

  root.NalunoSignalSocial = {
    REACTIONS, markViewed, react, viewersOf, summarise,
    openViewers, closeViewers, reactionBarHtml, linkedBroadcastHtml, wireLinkedBroadcast,
  };
})(typeof window !== 'undefined' ? window : globalThis);
