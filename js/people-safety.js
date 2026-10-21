/* ============================================================
   MODULE: js/people-safety.js
   Drop, block and report a person (21 Oct e).
   OWNERSHIP: this file.

   - Drop removes someone from your Frequencies, as before. Ticking "Also
     stop <name> from reaching me" blocks them as well: they cannot send a
     Frequency request, a Wireline message or a call until you undo it.
     The block is a document only you can read or change
     (users/<you>/blocked/<them>); firestore.rules refuses their writes,
     so a changed app cannot get past it.
   - Report sends the reason you give to the people who run Naluno. It never
     sends your Wireline messages.
   - Everything sits in a small ⋮ menu, never as a button on the screen.
   ============================================================ */
(function (root) {
  const blocked = new Map();
  let unsub = null;
  let boundFor = '';

  function db() { try { if (typeof fbDb !== 'undefined' && fbDb) return fbDb; } catch (_) {} return null; }
  function me() { try { if (typeof currentUser !== 'undefined' && currentUser) return currentUser; } catch (_) {} return null; }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function say(t) { try { if (typeof toast === 'function') toast(t); } catch (_) {} }
  function cleanUid(u) { const s = String(u || '').trim(); return /^[A-Za-z0-9_-]{1,128}$/.test(s) ? s : ''; }

  /* ---------- the block list (live) ---------- */
  function watch() {
    const u = me();
    const d = db();
    if (!u || !d) {
      if (unsub) { try { unsub(); } catch (_) {} unsub = null; }
      if (boundFor) { boundFor = ''; blocked.clear(); }
      return;
    }
    if (boundFor === u.uid && unsub) return;
    if (unsub) { try { unsub(); } catch (_) {} }
    boundFor = u.uid;
    blocked.clear();
    try {
      unsub = d.collection('users').doc(u.uid).collection('blocked').onSnapshot(function (snap) {
        blocked.clear();
        snap.forEach(function (doc) { blocked.set(doc.id, doc.data() || {}); });
        paintBlockedList();
        try { document.dispatchEvent(new CustomEvent('naluno-blocks-changed')); } catch (_) {}
      }, function () { unsub = null; boundFor = ''; });
    } catch (_) { unsub = null; boundFor = ''; }
  }
  setInterval(watch, 2500);
  setTimeout(watch, 600);

  function isBlocked(uid) { return blocked.has(String(uid || '')); }
  function blockedList() {
    return Array.from(blocked.entries()).map(function (e) { return { uid: e[0], name: (e[1] && e[1].name) || '', at: Number(e[1] && e[1].at) || 0 }; })
      .sort(function (a, b) { return b.at - a.at; });
  }

  async function block(uid, name) {
    const u = me(); const d = db(); const them = cleanUid(uid);
    if (!u || !d || !them || them === u.uid) return false;
    await d.collection('users').doc(u.uid).collection('blocked').doc(them).set({ at: Date.now(), name: String(name || '').slice(0, 80) });
    blocked.set(them, { at: Date.now(), name: String(name || '') });
    /* A request they already sent is taken off your list. */
    try { await d.collection('users').doc(u.uid).collection('connectionRequests').doc(them).delete(); } catch (_) {}
    paintBlockedList();
    try { if (typeof nalunoMeasure === 'function') nalunoMeasure('person_block', { state: 'on' }); } catch (_) {}
    return true;
  }
  async function unblock(uid) {
    const u = me(); const d = db(); const them = cleanUid(uid);
    if (!u || !d || !them) return false;
    await d.collection('users').doc(u.uid).collection('blocked').doc(them).delete();
    blocked.delete(them);
    paintBlockedList();
    try { if (typeof nalunoMeasure === 'function') nalunoMeasure('person_block', { state: 'off' }); } catch (_) {}
    return true;
  }

  /* ---------- the ⋮ menu ---------- */
  let openMenuEl = null;
  function closeMenu() {
    if (openMenuEl) { try { openMenuEl.remove(); } catch (_) {} openMenuEl = null; }
    document.removeEventListener('pointerdown', outside, true);
  }
  function outside(e) { if (openMenuEl && !openMenuEl.contains(e.target)) closeMenu(); }
  function menu(anchor, items) {
    closeMenu();
    const list = (items || []).filter(Boolean);
    if (!list.length) return null;
    const el = document.createElement('div');
    el.className = 'nl-menu';
    el.setAttribute('role', 'menu');
    list.forEach(function (it) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'nl-menu-item' + (it.danger ? ' danger' : '');
      b.setAttribute('role', 'menuitem');
      b.textContent = it.label;
      b.onclick = function (e) { e.stopPropagation(); closeMenu(); try { it.onClick && it.onClick(); } catch (err) { console.warn('[menu]', err); } };
      el.appendChild(b);
    });
    document.body.appendChild(el);
    const r = anchor && anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : { right: window.innerWidth - 12, bottom: 60, top: 60, left: window.innerWidth - 12 };
    const w = el.offsetWidth || 200;
    const h = el.offsetHeight || 120;
    let left = Math.min(window.innerWidth - w - 8, Math.max(8, r.right - w));
    let top = r.bottom + 6;
    if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 6);
    el.style.left = left + 'px';
    el.style.top = top + 'px';
    openMenuEl = el;
    setTimeout(function () { document.addEventListener('pointerdown', outside, true); }, 0);
    return el;
  }

  /* ---------- a small sheet ---------- */
  function sheet(html) {
    const wrap = document.createElement('div');
    wrap.className = 'nl-sheet-wrap';
    wrap.innerHTML = '<div class="nl-sheet" role="dialog" aria-modal="true">' + html + '</div>';
    wrap.addEventListener('pointerdown', function (e) { if (e.target === wrap) wrap.remove(); });
    document.body.appendChild(wrap);
    return wrap;
  }

  function personOf(p) {
    const o = p || {};
    return { uid: cleanUid(o.uid || o.firebaseUid), name: String(o.name || 'this person'), localId: o.localId != null ? o.localId : o.id };
  }

  /* Drop (and, if ticked, block). */
  function dropPerson(p) {
    const who = personOf(p);
    if (!who.uid) return;
    const connected = (typeof contacts !== 'undefined' && contacts || []).some(function (c) { return c && c.firebaseUid === who.uid; });
    const already = isBlocked(who.uid);
    const first = esc(who.name.split(' ')[0] || who.name);
    const w = sheet(
      '<div class="nl-sheet-title">' + (connected ? 'Drop ' + esc(who.name) + ' from your frequencies?' : 'Stop ' + esc(who.name) + ' reaching you?') + '</div>'
      + (connected
        ? '<label class="nl-check"><input type="checkbox" id="nlAlsoBlock"' + (already ? ' checked disabled' : '') + ' /> <span>Also stop ' + first + ' from reaching me<br><small>No requests, Wireline or calls, until you undo it.</small></span></label>'
        : '<p class="nl-sheet-sub">No requests, Wireline or calls from ' + first + ', until you undo it under Callsign.</p>')
      + '<div class="nl-sheet-row"><button type="button" class="nl-btn" id="nlCancel">Cancel</button><button type="button" class="nl-btn primary" id="nlGo">' + (connected ? 'Drop' : 'Stop them') + '</button></div>'
      + '<p class="nl-sheet-msg" id="nlMsg"></p>'
    );
    w.querySelector('#nlCancel').onclick = function () { w.remove(); };
    w.querySelector('#nlGo').onclick = async function () {
      const go = w.querySelector('#nlGo');
      go.disabled = true;
      const alsoBlock = !connected || !!(w.querySelector('#nlAlsoBlock') && w.querySelector('#nlAlsoBlock').checked);
      try {
        if (alsoBlock && !already) await block(who.uid, who.name);
        if (connected) {
          const c = contacts.find(function (x) { return x && x.firebaseUid === who.uid; });
          if (c && typeof dropFrequency === 'function') await dropFrequency(c.id, { skipConfirm: true, quiet: true });
        }
        w.remove();
        say(alsoBlock ? (who.name + ' can no longer reach you') : ('Dropped ' + who.name));
        try { if (typeof nalunoMeasure === 'function') nalunoMeasure('person_drop', { block: alsoBlock ? '1' : '0' }); } catch (_) {}
        try { if (typeof p.after === 'function') p.after(); } catch (_) {}
      } catch (e) {
        go.disabled = false;
        const m = w.querySelector('#nlMsg');
        if (m) m.textContent = 'Could not do that just now. Check the connection and try again.';
      }
    };
  }

  function reportPerson(p, where) {
    const who = personOf(p);
    if (!who.uid) return;
    if (typeof openReportSheet !== 'function') { say('Reporting isn’t available right now'); return; }
    openReportSheet({ target_type: 'person', target_id: String(where || 'person'), target_user_id: who.uid, name: who.name });
  }

  /* The standard menu for a person. extra: more items placed first. */
  function personMenu(anchor, p, where, extra) {
    const who = personOf(p);
    if (!who.uid) return null;
    const items = (extra || []).slice();
    if (isBlocked(who.uid)) {
      items.push({ label: 'Let ' + (who.name.split(' ')[0] || 'them') + ' reach you again', onClick: function () { unblock(who.uid).then(function () { say(who.name + ' can reach you again'); }).catch(function () { say('Could not change that just now'); }); } });
    } else {
      const connected = (typeof contacts !== 'undefined' && contacts || []).some(function (c) { return c && c.firebaseUid === who.uid; });
      items.push({ label: connected ? 'Drop' : 'Stop them reaching me', danger: true, onClick: function () { dropPerson(p); } });
    }
    items.push({ label: 'Report', danger: true, onClick: function () { reportPerson(p, where); } });
    return menu(anchor, items);
  }

  /* Long-press (or right-click) on an element opens the person menu. */
  function longPress(el, getPerson, where) {
    if (!el || el.__nlLong) return;
    el.__nlLong = true;
    let t = null;
    const start = function (e) {
      clear();
      t = setTimeout(function () {
        t = null;
        const p = getPerson();
        if (p && cleanUid(p.uid || p.firebaseUid) && (!me() || cleanUid(p.uid || p.firebaseUid) !== me().uid)) {
          try { if (navigator.vibrate) navigator.vibrate(15); } catch (_) {}
          personMenu(el, p, where);
        }
      }, 550);
    };
    const clear = function () { if (t) { clearTimeout(t); t = null; } };
    el.addEventListener('pointerdown', start);
    ['pointerup', 'pointerleave', 'pointercancel', 'pointermove'].forEach(function (k) { el.addEventListener(k, function (e) { if (k !== 'pointermove' || (e.movementX * e.movementX + e.movementY * e.movementY) > 36) clear(); }); });
    el.addEventListener('contextmenu', function (e) {
      const p = getPerson();
      if (p && cleanUid(p.uid || p.firebaseUid)) { e.preventDefault(); personMenu(el, p, where); }
    });
  }

  /* Long-press on a row inside a list that is redrawn often (Band). */
  function delegateLongPress(container, rowSelector, where) {
    if (!container || container.__nlDelegate) return;
    container.__nlDelegate = true;
    let t = null; let sx = 0; let sy = 0;
    const personFromRow = function (row) {
      const k = row && row.querySelector('[data-known-uid]');
      const uid = k ? cleanUid(k.getAttribute('data-known-uid')) : '';
      if (!uid || (me() && uid === me().uid)) return null;
      return { uid: uid, name: (k.textContent || '').trim() || 'this person' };
    };
    container.addEventListener('pointerdown', function (e) {
      const row = e.target && e.target.closest ? e.target.closest(rowSelector) : null;
      if (!row) return;
      sx = e.clientX; sy = e.clientY;
      if (t) clearTimeout(t);
      t = setTimeout(function () {
        t = null;
        const p = personFromRow(row);
        if (p) { try { if (navigator.vibrate) navigator.vibrate(15); } catch (_) {} personMenu(row, p, where); }
      }, 600);
    });
    const stop = function () { if (t) { clearTimeout(t); t = null; } };
    container.addEventListener('pointerup', stop);
    container.addEventListener('pointercancel', stop);
    container.addEventListener('pointermove', function (e) { if (Math.abs(e.clientX - sx) + Math.abs(e.clientY - sy) > 10) stop(); });
    container.addEventListener('contextmenu', function (e) {
      const row = e.target && e.target.closest ? e.target.closest(rowSelector) : null;
      const p = personFromRow(row);
      if (p) { e.preventDefault(); personMenu(row, p, where); }
    });
  }

  /* Calls (the caller's name) and Band (a message's row): long-press. */
  function bindScreens() {
    ['incomingName', 'remoteName', 'ringName'].forEach(function (id) {
      const el = document.getElementById(id);
      if (el) longPress(el, function () { return { uid: el.getAttribute('data-known-uid') || '', name: (el.textContent || '').trim() }; }, 'call');
    });
    const band = document.getElementById('bandMessages');
    if (band) delegateLongPress(band, '.msg-row.them', 'band');
  }
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bindScreens);
    else setTimeout(bindScreens, 0);
  }

  /* ---------- Callsign → Blocked people ---------- */
  function paintBlockedList() {
    const box = document.getElementById('blockedPeopleList');
    const sub = document.getElementById('blockedPeopleSub');
    if (!box) return;
    const rows = blockedList();
    if (sub) sub.textContent = rows.length
      ? (rows.length === 1 ? 'One person can’t reach you.' : rows.length + ' people can’t reach you.')
      : 'No one. Use ⋮ → Drop in a chat or on Frequencies to stop someone reaching you.';
    box.innerHTML = rows.map(function (r) {
      return '<div class="nl-blocked-row"><span>' + esc(r.name || 'Someone') + '</span><button type="button" class="nl-btn" data-nl-unblock="' + esc(r.uid) + '">Undo</button></div>';
    }).join('');
    box.querySelectorAll('[data-nl-unblock]').forEach(function (b) {
      b.onclick = function () {
        const uid = b.getAttribute('data-nl-unblock');
        b.disabled = true;
        unblock(uid).then(function () { say('They can reach you again'); }).catch(function () { b.disabled = false; say('Could not change that just now'); });
      };
    });
  }

  root.NalunoPeople = { isBlocked: isBlocked, blockedList: blockedList, block: block, unblock: unblock, menu: menu, closeMenu: closeMenu, personMenu: personMenu, dropPerson: dropPerson, reportPerson: reportPerson, longPress: longPress, paintBlockedList: paintBlockedList, _watch: watch };
  root.nalunoIsBlocked = isBlocked;
})(typeof window !== 'undefined' ? window : this);
