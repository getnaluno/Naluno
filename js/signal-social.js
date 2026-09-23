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
   *  so watching twice is still one viewer. The "already seen" lock is set
   *  only AFTER the write succeeds — setting it first meant one failed
   *  attempt (rules, a cold token) silenced every later view in the session. */
  async function markViewed(ownerUid, segId) {
    const uid = me();
    if (!uid || !db() || !ownerUid || !segId) return false;
    if (ownerUid === uid) return false;
    const key = ownerUid + '|' + segId;
    if (seenLocal[key]) return true;
    try {
      await viewerRef(ownerUid, segId, uid).set({
        uid: uid,
        name: (root.currentProfile && root.currentProfile.name) || 'Someone',
        viewedAt: Date.now(),
      }, { merge: true });
      seenLocal[key] = true;
      return true;
    } catch (e) {
      try { console.warn('[signal] view not saved', e && (e.code || e.message)); } catch (_) {}
      return false;
    }
  }

  function reactsRef(ownerUid, segId, uid) {
    return db().collection('users').doc(ownerUid)
      .collection('signal').doc(String(segId))
      .collection('reacts').doc(uid);
  }

  /** Set or clear my reaction to this segment. Tapping the same one removes it.
   *  The name list stays on viewers (owner only). The emoji itself is a second
   *  row connections may count, without learning who watched. */
  async function react(ownerUid, segId, emoji) {
    const uid = me();
    if (!uid || !db() || !ownerUid || !segId) return null;
    if (ownerUid === uid) { root.toast('That one is yours'); return null; }
    try {
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
      try {
        const rr = reactsRef(ownerUid, segId, uid);
        if (next) await rr.set({ emoji: next, at: Date.now() }, { merge: true });
        else await rr.delete();
      } catch (_) { /* counts are extra; the reaction on the viewer row is the record */ }
      return next;
    } catch (e) {
      const code = (e && e.code) || '';
      root.toast(code === 'permission-denied'
        ? 'Reactions are for people you’re connected with'
        : 'Couldn’t save that');
      return null;
    }
  }

  /** Everyone who watched one of MY segments. Only the owner may read this.
   *  Sorted here, not with orderBy, so a missing index cannot blank the list. */
  async function viewersOf(segId) {
    const uid = me();
    if (!uid || !db() || !segId) return [];
    try {
      const snap = await db().collection('users').doc(uid)
        .collection('signal').doc(String(segId))
        .collection('viewers').limit(200).get();
      const out = [];
      snap.forEach(function (d) { out.push(d.data() || {}); });
      out.sort(function (a, b) { return (Number(b.viewedAt) || 0) - (Number(a.viewedAt) || 0); });
      return out;
    } catch (e) {
      try { console.warn('[signal] viewers', e && (e.code || e.message)); } catch (_) {}
      return [];
    }
  }

  /** Emoji totals a viewer is allowed to see. Names are not in these rows. */
  async function reactionCounts(ownerUid, segId) {
    if (!db() || !ownerUid || !segId) return [];
    try {
      const snap = await db().collection('users').doc(ownerUid)
        .collection('signal').doc(String(segId))
        .collection('reacts').limit(200).get();
      const counts = {};
      snap.forEach(function (d) {
        const e = d.data() && d.data().emoji;
        if (e) counts[e] = (counts[e] || 0) + 1;
      });
      return REACTIONS.filter(function (e) { return counts[e]; })
        .map(function (e) { return { emoji: e, n: counts[e] }; });
    } catch (_) { return []; }
  }

  async function myReaction(ownerUid, segId) {
    const uid = me();
    if (!uid || !db() || !ownerUid || !segId || ownerUid === uid) return '';
    try {
      const snap = await reactsRef(ownerUid, segId, uid).get();
      return snap.exists ? (snap.data().emoji || '') : '';
    } catch (_) {
      try {
        const v = await viewerRef(ownerUid, segId, uid).get();
        return v.exists ? (v.data().reaction || '') : '';
      } catch (__) { return ''; }
    }
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

  /** Lift the sheet onto the page itself. It used to be a call-overlay that
   *  opened underneath the Signal already on screen, so the tap looked dead. */
  function liftViewers(sheet) {
    try {
      if (sheet.parentNode !== root.document.body) root.document.body.appendChild(sheet);
    } catch (_) {}
    sheet.style.position = 'fixed';
    sheet.style.inset = '0';
    sheet.style.zIndex = '2147483000';
  }

  /** The owner's sheet: who watched, and what each of them felt.
   *  The sheet is visible BEFORE the list is fetched. Touch should not wait
   *  on the network to feel like it did something. */
  function openViewers(segId) {
    const sheet = root.document.getElementById('signalViewers');
    if (!sheet) return;
    liftViewers(sheet);
    sheet.classList.add('active');
    const body = root.document.getElementById('signalViewersBody');
    if (body) body.innerHTML = '<p class="sub">Loading\u2026</p>';
    viewersOf(segId).then(function (rows) {
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
    }).catch(function () {
      if (body) body.innerHTML = '<p class="sub">Couldn’t load who watched. Try again.</p>';
    });
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
    REACTIONS, markViewed, react, viewersOf, summarise, reactionCounts, myReaction,
    openViewers, closeViewers, reactionBarHtml, linkedBroadcastHtml, wireLinkedBroadcast,
  };
})(typeof window !== 'undefined' ? window : globalThis);
