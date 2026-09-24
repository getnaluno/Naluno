/* ============================================================
   MODULE: js/signal-social.js
   Who watched your Signal, and what they felt about it.

   The name list is written two ways. The viewers row is the strict one
   (only a connection, only their own document). That write is denied until
   firestore.rules is published, and a denied write used to look exactly
   like "nobody watched". The second write is a pulse on the owner's
   notification inbox, which members can already create. It has no `ts`,
   so the Band invite listener (which orders by ts) does not toast it.
   The owner reads both and shows one person once.
   ============================================================ */
(function (root) {
  'use strict';
  const REACTIONS = ['👍', '🔥', '🐐', '❤️'];
  const seenLocal = {};
  const localReact = {};
  let lastListErr = '';

  /* fbDb and currentUser are top-level `let` bindings in auth.js. They are
     visible to this classic script by name, and they are not properties of
     window. Reading window.fbDb was always empty, so a view and a reaction
     returned before any write — which looked exactly like "nobody watched". */
  function db() {
    try { if (typeof fbDb !== 'undefined' && fbDb) return fbDb; } catch (_) {}
    return null;
  }
  function me() {
    try {
      if (typeof currentUser !== 'undefined' && currentUser && currentUser.uid) return currentUser.uid;
    } catch (_) {}
    return '';
  }
  function myName() {
    try {
      if (typeof currentProfile !== 'undefined' && currentProfile && currentProfile.name) {
        return String(currentProfile.name).slice(0, 80);
      }
    } catch (_) {}
    return 'Someone';
  }
  function codeOf(e) {
    return (e && (e.code || e.message)) ? String(e.code || e.message) : 'failed';
  }

  function viewerRef(ownerUid, segId, uid) {
    return db().collection('users').doc(ownerUid)
      .collection('signal').doc(String(segId))
      .collection('viewers').doc(uid);
  }
  function reactsRef(ownerUid, segId, uid) {
    return db().collection('users').doc(ownerUid)
      .collection('signal').doc(String(segId))
      .collection('reacts').doc(uid);
  }

  /* Inbox create is already allowed for a signed-in person. A full set()
     would be an update the second time, which the owner alone may do, so
     each pulse is a new document. The owner keeps the latest per person. */
  function pulseWrite(ownerUid, segId, extra) {
    const uid = me();
    if (!uid || !db() || !ownerUid || !segId) return Promise.resolve(false);
    const doc = {
      kind: 'signal-pulse',
      from: uid,
      fromUid: uid,
      name: myName(),
      segId: String(segId).slice(0, 120),
      viewedAt: Date.now(),
      reaction: '',
      at: Date.now(),
    };
    if (extra) {
      if (extra.reaction != null) doc.reaction = String(extra.reaction).slice(0, 8);
      if (extra.viewedAt) doc.viewedAt = extra.viewedAt;
    }
    return db().collection('users').doc(ownerUid).collection('notifications').add(doc)
      .then(function () { return true; })
      .catch(function (e) {
        try { console.warn('[signal] pulse', codeOf(e)); } catch (_) {}
        return false;
      });
  }

  async function markViewed(ownerUid, segId) {
    const uid = me();
    if (!uid || !db() || !ownerUid || !segId) return false;
    if (ownerUid === uid) return false;
    const key = ownerUid + '|' + segId;
    if (seenLocal[key]) return true;
    let ok = false;
    try {
      const prev = localReact[key] || '';
      await viewerRef(ownerUid, segId, uid).set({
        uid: uid,
        name: myName(),
        viewedAt: Date.now(),
        reaction: prev,
        reactedAt: prev ? Date.now() : 0,
      });
      ok = true;
    } catch (e) {
      try { console.warn('[signal] view not saved', codeOf(e)); } catch (_) {}
    }
    if (await pulseWrite(ownerUid, segId, { reaction: localReact[key] || '' })) ok = true;
    if (ok) seenLocal[key] = true;
    return ok;
  }

  async function react(ownerUid, segId, emoji) {
    const uid = me();
    if (!uid || !db() || !ownerUid || !segId) {
      try { root.toast(!uid || !db() ? 'Sign in again, then try that' : 'Couldn’t save that'); } catch (_) {}
      return null;
    }
    if (ownerUid === uid) { root.toast('That one is yours'); return null; }
    const key = ownerUid + '|' + segId;
    const had = localReact[key] || '';
    const next = (had === emoji) ? '' : emoji;
    const now = Date.now();
    let ok = false;
    let denied = false;
    try {
      await viewerRef(ownerUid, segId, uid).set({
        uid: uid,
        name: myName(),
        reaction: next,
        reactedAt: now,
        viewedAt: now,
      });
      ok = true;
      seenLocal[key] = true;
    } catch (e) {
      denied = codeOf(e) === 'permission-denied';
      try { console.warn('[signal] react', codeOf(e)); } catch (_) {}
    }
    try {
      const rr = reactsRef(ownerUid, segId, uid);
      if (next) await rr.set({ emoji: next, at: now });
      else await rr.delete();
      ok = true;
    } catch (e) {
      if (codeOf(e) === 'permission-denied') denied = true;
    }
    if (await pulseWrite(ownerUid, segId, { reaction: next, viewedAt: now })) ok = true;
    if (!ok) {
      root.toast(denied
        ? 'Reactions are for people you’re connected with'
        : 'Couldn’t save that');
      return null;
    }
    localReact[key] = next;
    return next;
  }

  function mergePulse(rows, segId, pulses) {
    const have = {};
    rows.forEach(function (r) { if (r && r.uid) have[r.uid] = r; });
    const best = {};
    (pulses || []).forEach(function (r) {
      if (!r || String(r.segId || '') !== String(segId)) return;
      const who = r.from || r.fromUid;
      if (!who) return;
      const prev = best[who];
      if (!prev || (Number(r.at) || 0) >= (Number(prev.at) || 0)) best[who] = r;
    });
    Object.keys(best).forEach(function (who) {
      const r = best[who];
      const row = {
        uid: who,
        name: r.name || 'Someone',
        viewedAt: r.viewedAt || r.at || 0,
        reaction: r.reaction || '',
      };
      if (!have[who]) {
        rows.push(row);
        have[who] = row;
      } else if (!have[who].reaction && row.reaction) {
        have[who].reaction = row.reaction;
      }
    });
  }

  async function viewersOf(segId) {
    const uid = me();
    lastListErr = '';
    if (!uid || !db() || !segId) {
      lastListErr = !uid || !db() ? 'not-signed-in' : '';
      return [];
    }
    const rows = [];
    let err = '';
    try {
      const snap = await db().collection('users').doc(uid)
        .collection('signal').doc(String(segId))
        .collection('viewers').limit(200).get();
      snap.forEach(function (d) {
        const row = d.data() || {};
        if (!row.uid) row.uid = d.id;
        rows.push(row);
      });
    } catch (e) {
      err = codeOf(e);
      try { console.warn('[signal] viewers', err); } catch (_) {}
    }
    try {
      const snap = await db().collection('users').doc(uid)
        .collection('notifications').where('kind', '==', 'signal-pulse').limit(300).get();
      const pulses = [];
      snap.forEach(function (d) { pulses.push(d.data() || {}); });
      mergePulse(rows, segId, pulses);
    } catch (e) {
      if (!rows.length) err = err || codeOf(e);
    }
    if (!rows.length) lastListErr = err;
    rows.sort(function (a, b) { return (Number(b.viewedAt) || 0) - (Number(a.viewedAt) || 0); });
    return rows;
  }

  async function reactionCounts(ownerUid, segId) {
    if (!db() || !ownerUid || !segId) return [];
    const counts = {};
    try {
      const snap = await db().collection('users').doc(ownerUid)
        .collection('signal').doc(String(segId))
        .collection('reacts').limit(200).get();
      snap.forEach(function (d) {
        const e = d.data() && d.data().emoji;
        if (e) counts[e] = (counts[e] || 0) + 1;
      });
    } catch (_) {}
    /* The owner can also count from the same pulses Seen by uses, so a
       reaction still shows a number when the reacts rules are not published. */
    const uid = me();
    if (uid && uid === ownerUid) {
      try {
        const snap = await db().collection('users').doc(uid)
          .collection('notifications').where('kind', '==', 'signal-pulse').limit(300).get();
        const best = {};
        snap.forEach(function (d) {
          const r = d.data() || {};
          if (String(r.segId || '') !== String(segId)) return;
          const who = r.from || r.fromUid;
          if (!who) return;
          const prev = best[who];
          if (!prev || (Number(r.at) || 0) >= (Number(prev.at) || 0)) best[who] = r;
        });
        if (!Object.keys(counts).length) {
          Object.keys(best).forEach(function (who) {
            const e = best[who].reaction;
            if (e) counts[e] = (counts[e] || 0) + 1;
          });
        }
      } catch (_) {}
    }
    return REACTIONS.filter(function (e) { return counts[e]; })
      .map(function (e) { return { emoji: e, n: counts[e] }; });
  }

  async function myReaction(ownerUid, segId) {
    const uid = me();
    if (!uid || !db() || !ownerUid || !segId || ownerUid === uid) return '';
    const key = ownerUid + '|' + segId;
    if (localReact[key]) return localReact[key];
    try {
      const snap = await reactsRef(ownerUid, segId, uid).get();
      const emoji = snap.exists ? (snap.data().emoji || '') : '';
      if (emoji) localReact[key] = emoji;
      return emoji;
    } catch (_) {
      try {
        const v = await viewerRef(ownerUid, segId, uid).get();
        const emoji = v.exists ? (v.data().reaction || '') : '';
        if (emoji) localReact[key] = emoji;
        return emoji;
      } catch (__) { return localReact[key] || ''; }
    }
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&', '<': '<', '>': '>', '"': '"', "'": '&#39;' }[c];
    });
  }

  function summarise(rows) {
    const counts = {};
    (rows || []).forEach(function (r) {
      const e = r && r.reaction;
      if (e) counts[e] = (counts[e] || 0) + 1;
    });
    return REACTIONS.filter(function (e) { return counts[e]; })
      .map(function (e) { return { emoji: e, n: counts[e] }; });
  }

  function liftViewers(sheet) {
    try {
      if (sheet.parentNode !== root.document.body) root.document.body.appendChild(sheet);
    } catch (_) {}
    sheet.style.position = 'fixed';
    sheet.style.inset = '0';
    sheet.style.zIndex = '2147483000';
  }

  function openViewers(segId) {
    const sheet = root.document.getElementById('signalViewers');
    if (!sheet) return;
    liftViewers(sheet);
    sheet.classList.add('active');
    try { if (root.nalunoBack && root.nalunoBack.push) root.nalunoBack.push(); } catch (_) {}
    const body = root.document.getElementById('signalViewersBody');
    if (body) body.innerHTML = '<p class="sub">Loading\u2026</p>';
    viewersOf(segId).then(function (rows) {
      const sum = summarise(rows);
      if (!body) return;
      if (!rows.length) {
        body.innerHTML = lastListErr
          ? ('<p class="sub">Couldn’t read who watched (' + esc(lastListErr) + '). Publish firestore.rules if this says permission-denied.</p>')
          : '<p class="sub">Nobody else has watched this one yet.</p>';
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
    try { if (root.nalunoBack && root.nalunoBack.drop) root.nalunoBack.drop('signalViewers'); } catch (_) {}
  }

  function reactionBarHtml(mine) {
    return '<div class="sig-react">' + REACTIONS.map(function (e) {
      return '<button type="button" class="sig-react-btn' + (mine === e ? ' on' : '')
        + '" data-react="' + e + '">' + e + '</button>';
    }).join('') + '</div>';
  }

  function linkedBroadcastHtml(seg) {
    const id = seg && (seg.linkedBroadcastId || seg.broadcastId);
    if (!id) return '';
    const title = (seg.broadcastTitle || 'the Broadcast');
    return '<button type="button" class="sig-bcast" data-bcast="' + esc(id) + '">'
      + '\u25b6 Watch ' + esc(String(title).slice(0, 40)) + '</button>';
  }
  function releaseSignalPlayer() {
    /* Hold history. The story entry stays underneath so the system back
       from the Broadcast closes the Broadcast, instead of also eating the
       story and leaving the app. */
    const prev = root.__nalunoBackHold;
    root.__nalunoBackHold = true;
    try {
      const v = root.document.getElementById('bviewerActiveVideo');
      if (v) {
        try { v.pause(); } catch (_) {}
        try { v.removeAttribute('src'); v.load(); } catch (_) {}
      }
      const body = root.document.getElementById('bviewerBody');
      if (body) body.innerHTML = '';
    } catch (_) {}
    try {
      if (typeof root.closeSignalViewer === 'function') root.closeSignalViewer();
      else if (typeof root.closeBroadcast === 'function') root.closeBroadcast();
    } catch (_) {}
    root.__nalunoBackHold = prev;
  }
  function wireLinkedBroadcast(scope) {
    (scope || root.document).querySelectorAll('[data-bcast]').forEach(function (b) {
      if (b.__nalunoBcast) return;
      b.__nalunoBcast = true;
      const go = function (e) {
        try { if (e) { e.preventDefault(); e.stopPropagation(); } } catch (_) {}
        if (b.__nalunoOpening) return;
        const id = b.getAttribute('data-bcast');
        if (!id) return;
        b.__nalunoOpening = true;
        /* One press. The story player is released in this same turn so the
           Broadcast does not wait on a second tap or a decoder gap. */
        releaseSignalPlayer();
        try {
          if (typeof root.openBroadcastById === 'function') root.openBroadcastById(id);
        } catch (_) {}
      };
      b.addEventListener('pointerdown', go);
      b.addEventListener('click', function (e) {
        try { if (e) { e.preventDefault(); e.stopPropagation(); } } catch (_) {}
      });
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
    mergePulse,
  };
})(typeof window !== 'undefined' ? window : globalThis);
