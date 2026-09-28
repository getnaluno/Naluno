/* Known: a reviewed name, then either a paid month or a grant.
   A grant puts the mark on with no cash. A payment is the only cash. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.NalunoKnown = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  /* No price lives here. The monthly price is the operator's, in
     economyConfig/prices (Control Centre → Money → Prices), read through
     NalunoCurrency. */
  const MONTH_MS = 30 * 24 * 60 * 60 * 1000;
  const LABEL = 'Known';

  function cleanNote(note) {
    return String(note || '').replace(/\s+/g, ' ').trim().slice(0, 500);
  }

  function freshApply(uid, name, note, now) {
    const text = cleanNote(note);
    if (!uid || text.length < 12) return null;
    const at = Number(now) || Date.now();
    return {
      uid: String(uid),
      name: String(name || '').trim().slice(0, 80),
      note: text,
      status: 'applied',
      createdAt: at,
      updatedAt: at,
    };
  }

  function review(app, action, now) {
    if (!app || !app.uid) return null;
    const at = Number(now) || Date.now();
    if (action === 'accept' && app.status === 'applied') {
      return Object.assign({}, app, { status: 'accepted', reviewedAt: at, updatedAt: at });
    }
    if (action === 'decline' && (app.status === 'applied' || app.status === 'accepted')) {
      return Object.assign({}, app, { status: 'declined', reviewedAt: at, updatedAt: at });
    }
    if (action === 'revoke' && app.status !== 'declined') {
      return Object.assign({}, app, { status: 'revoked', updatedAt: at, paidUntil: at });
    }
    return null;
  }

  function currentPrice() {
    try {
      const C = typeof window !== 'undefined' ? window.NalunoCurrency : (typeof globalThis !== 'undefined' ? globalThis.NalunoCurrency : null);
      if (C && typeof C.knownPrice === 'function') return C.knownPrice();
    } catch (_) {}
    return null;
  }
  function isoMinor(amount, currency) {
    try {
      const C = typeof window !== 'undefined' ? window.NalunoCurrency : null;
      if (C && typeof C.toMinor === 'function') return C.toMinor(amount, currency);
    } catch (_) {}
    return Math.round(Number(amount) * 100);
  }
  /* price: { amount, currency } from the price book. The desk passes the
     book at the moment it records the month. */
  function recordPayment(app, paidAt, ref, price) {
    if (!app) return null;
    const at = Number(paidAt);
    if (!(at > 0)) return null;
    if (app.status !== 'accepted' && app.status !== 'known' && app.status !== 'lapsed') return null;
    const carry = (app.status === 'known' && Number(app.paidUntil) > at) ? Number(app.paidUntil) : at;
    const p = price || currentPrice();
    const row = Object.assign({}, app, {
      status: 'known',
      paidAt: at,
      paidUntil: carry + MONTH_MS,
      payRef: String(ref || '').slice(0, 120),
      updatedAt: at,
    });
    if (p && Number(p.amount) > 0) {
      row.amount_major = Number(p.amount);
      row.currency = String(p.currency || '').toUpperCase();
      row.amount_minor = isoMinor(p.amount, row.currency);
    }
    return row;
  }

  function voidPayment(app, now) {
    if (!app || !app.uid) return null;
    if (!app.paidAt && !(Number(app.amount_minor) > 0)) return null;
    const at = Number(now) || Date.now();
    const status = (app.status === 'revoked' || app.status === 'declined') ? app.status : 'accepted';
    const next = Object.assign({}, app, { status: status, updatedAt: at, voidedAt: at });
    delete next.paidAt;
    delete next.paidUntil;
    delete next.amount_minor;
    delete next.payRef;
    return next;
  }

  function grantKnown(app, now, months, price) {
    if (!app || !app.uid) return null;
    const span = Number(months);
    if (span !== 6 && span !== 12) return null;
    if (app.status !== 'accepted') return null;
    if (app.paidAt || app.grant) return null;
    const at = Number(now) || Date.now();
    return Object.assign({}, app, {
      status: 'known',
      grant: true,
      grantMonths: span,
      grantedAt: at,
      paidUntil: at + span * MONTH_MS,
      amount_minor: 0,
      payRef: '',
      updatedAt: at,
    }, (function () {
      const p = price || currentPrice();
      if (!p || !(Number(p.amount) > 0)) return {};
      const cur = String(p.currency || '').toUpperCase();
      return { list_amount: Number(p.amount), list_currency: cur, list_minor: isoMinor(p.amount, cur) };
    })());
  }

  function voidGrant(app, now) {
    if (!app || !app.uid || !app.grant || app.paidAt) return null;
    const at = Number(now) || Date.now();
    const next = Object.assign({}, app, { status: 'accepted', grant: false, updatedAt: at, voidedAt: at });
    delete next.grantedAt;
    delete next.grantMonths;
    delete next.paidUntil;
    delete next.list_minor;
    delete next.list_amount;
    delete next.list_currency;
    delete next.amount_minor;
    delete next.payRef;
    return next;
  }

  function isKnown(row, now) {
    if (!row) return false;
    const until = Number(row.paidUntil != null ? row.paidUntil : row.knownUntil);
    if (!(until > (Number(now) || Date.now()))) return false;
    if (row.status && row.status !== 'known') return false;
    if (row.known === false) return false;
    if (row.known === true || row.status === 'known') return true;
    return false;
  }

  function markHtml() {
    return '<span class="naluno-known" title="Known"><span>' + LABEL + '</span></span>';
  }

  const knownCache = {};
  function publicKnown(row) {
    if (!row) return false;
    if (isKnown(row)) return true;
    const until = Number(row.until || row.paidUntil || row.knownUntil || 0);
    if (!(until > Date.now())) return false;
    if (row.status && row.status !== 'known') return false;
    return true;
  }
  function paintBeside(el, uid) {
    if (!el) return;
    const existing = el.querySelector && el.querySelector('.naluno-known');
    if (existing) existing.remove();
    if (!uid || typeof fbDb === 'undefined' || !fbDb) return;
    const key = String(uid);
    const put = function (on) {
      if (!el.isConnected || !on) return;
      if (!el.querySelector('.naluno-known')) el.insertAdjacentHTML('beforeend', markHtml());
    };
    if (Object.prototype.hasOwnProperty.call(knownCache, key)) {
      put(knownCache[key]);
      return;
    }
    fbDb.collection('knownPublic').doc(key).get().then(function (snap) {
      if (snap && snap.exists && publicKnown(snap.data() || {})) {
        knownCache[key] = true;
        put(true);
        return null;
      }
      return fbDb.collection('knownApps').doc(key).get();
    }).catch(function () {
      return fbDb.collection('knownApps').doc(key).get();
    }).then(function (snap) {
      if (!snap) return;
      const on = !!(snap.exists && isKnown(snap.data() || {}));
      knownCache[key] = on;
      put(on);
    }).catch(function () {});
  }
  function paintAll(root) {
    const scope = root && root.querySelectorAll ? root : (typeof document !== 'undefined' ? document : null);
    if (!scope || !scope.querySelectorAll) return;
    scope.querySelectorAll('[data-known-uid]').forEach(function (node) {
      paintBeside(node, node.getAttribute('data-known-uid'));
    });
  }

  const NOTE_MIN = 12;
  const NOTE_MAX = 500;

  function payQuote() {
    try {
      const C = typeof window !== 'undefined' ? window.NalunoCurrency : null;
      if (C && typeof C.knownIn === 'function') return C.knownIn(C.code && C.code());
    } catch (_) {}
    return null;
  }
  function feeLabel() {
    const q = payQuote();
    return q ? (q.label + ' a month') : '';
  }

  function formHtml(fee) {
    const price = fee ? (' · ' + fee) : '';
    return '<p class="known-copy">A reviewed name on your Callsign<span class="known-fee">' + price + '</span>. The mark shows only after it is paid.</p>'
      + '<textarea class="known-note" maxlength="' + NOTE_MAX + '" rows="4" placeholder="Who you are"></textarea>'
      + '<p class="known-count">0 / ' + NOTE_MAX + ' characters · at least ' + NOTE_MIN + '</p>'
      + '<button type="button" class="save-btn" id="knownApply">Send</button>';
  }

  let mineRow = null;
  function stampView() {
    if (typeof document === 'undefined') return;
    const view = document.getElementById('viewName');
    if (!view) return;
    const badge = view.querySelector('.naluno-known');
    if (badge) badge.remove();
    if (isKnown(mineRow)) view.insertAdjacentHTML('beforeend', markHtml());
  }

  function wireCount(block) {
    const note = block.querySelector('textarea');
    const count = block.querySelector('.known-count');
    if (!note || !count || note.dataset.counted === '1') return;
    note.dataset.counted = '1';
    const tick = function () {
      const n = cleanNote(note.value).length;
      count.textContent = n + ' / ' + NOTE_MAX + ' characters' + (n < NOTE_MIN ? (' · at least ' + NOTE_MIN) : '');
    };
    note.addEventListener('input', tick);
    tick();
  }

  function paintMine(block, app, opts) {
    if (!block) return;
    const bare = !!(opts && opts.bare);
    const fee = feeLabel();
    const stamp = app && app.status ? app.status : 'fresh';
    if (!bare && block.dataset.status === stamp && block.dataset.painted === '1') {
      const feeEl = block.querySelector('.known-fee');
      if (feeEl) feeEl.textContent = fee ? (' · ' + fee) : '';
      return;
    }
    const wasOpen = block.dataset.open === '1';
    let button = 'Ask to be Known';
    let body = formHtml(fee);
    if (app && app.status === 'applied') {
      button = 'Asked';
      body = '<p class="known-copy">Your note is in.</p>';
    } else if (app && (app.status === 'declined' || app.status === 'revoked')) {
      button = 'Ask again';
      body = formHtml(fee);
    } else if (app && (app.status === 'accepted' || app.status === 'lapsed')) {
      /* The fold opens onto its own Pay button; two "Pay" buttons on top
         of each other read as a glitch. */
      button = 'Known · accepted';
      body = '<p class="known-copy">Accepted<span class="known-fee">' + (fee ? (' · ' + fee) : '') + '</span>. Pay, then the mark appears.</p>'
        + '<button type="button" class="save-btn" id="knownPay">Pay</button>'
        + '<p class="known-copy" id="knownPayMsg"></p>';
    } else if (app && app.grant && isKnown(app) && !app.paidAt) {
      button = 'Known';
      body = '<p class="known-copy">Granted until ' + new Date(Number(app.paidUntil)).toLocaleDateString() + '. No charge for this period.</p>';
    } else if (app && isKnown(app)) {
      button = 'Known';
      body = '<p class="known-copy">Until ' + new Date(app.paidUntil).toLocaleDateString() + '.</p>'
        + '<button type="button" class="save-btn" id="knownPay">Next month</button>'
        + '<p class="known-copy" id="knownPayMsg"></p>';
    } else if (app) {
      button = 'Known · renew';
      body = '<p class="known-copy">The month ended<span class="known-fee">' + (fee ? (' · ' + fee) : '') + '</span>.</p>'
        + '<button type="button" class="save-btn" id="knownPay">Pay</button>'
        + '<p class="known-copy" id="knownPayMsg"></p>';
    }
    block.hidden = false;
    block.dataset.status = stamp;
    block.dataset.painted = '1';
    if (bare) {
      block.dataset.open = '1';
      block.innerHTML = body;
      wireCount(block);
      return;
    }
    block.dataset.open = wasOpen ? '1' : '';
    block.innerHTML = '<button type="button" class="save-btn known-open" id="knownOpen">' + button + '</button>'
      + '<div class="known-fold"' + (wasOpen ? '' : ' hidden') + '>' + body + '</div>';
    wireCount(block);
  }

  function wireMine() {
    const block = document.getElementById('knownBlock');
    if (!block) return;
    if (block.dataset.wired !== '1') {
      block.dataset.wired = '1';
      block.addEventListener('click', function (e) {
        const t = e.target && e.target.closest ? e.target.closest('button') : e.target;
        if (!t || !t.id) return;
        if (t.id === 'knownOpen') {
          const open = block.dataset.open === '1';
          block.dataset.open = open ? '' : '1';
          const fold = block.querySelector('.known-fold');
          if (fold) fold.hidden = open;
          return;
        }
        if (t.id === 'knownApply') submitApply(block);
        if (t.id === 'knownPay') startPay(block);
      });
    }
    refreshMine();
  }

  async function refreshMine() {
    const block = document.getElementById('knownBlock');
    if (!block) return;
    if (typeof currentUser === 'undefined' || !currentUser || typeof fbDb === 'undefined' || !fbDb) {
      mineRow = null;
      paintMine(block, null);
      stampView();
      return;
    }
    try {
      const snap = await fbDb.collection('knownApps').doc(currentUser.uid).get();
      mineRow = snap.exists ? snap.data() : null;
      if (!snap.exists) {
        try {
          const user = await fbDb.collection('users').doc(currentUser.uid).get();
          if (user.exists && isKnown(user.data())) mineRow = user.data();
        } catch (_) {}
      }
      paintMine(block, mineRow);
      stampView();
    } catch (_) {
      mineRow = null;
      paintMine(block, null);
      stampView();
    }
  }

  function ensureSheet() {
    let sheet = document.getElementById('knownSheet');
    if (sheet) return sheet;
    sheet = document.createElement('div');
    sheet.id = 'knownSheet';
    sheet.className = 'bspace-room-sheet';
    sheet.innerHTML = '<div class="bspace-room-card" role="dialog">'
      + '<div class="bspace-room-head"><b>Known</b><button type="button" id="knownSheetClose">Close</button></div>'
      + '<div id="knownSheetBody" class="known-block"></div></div>';
    document.body.appendChild(sheet);
    sheet.addEventListener('click', function (e) {
      if (e.target === sheet) sheet.classList.remove('active');
    });
    const close = document.getElementById('knownSheetClose');
    if (close) close.onclick = function () { sheet.classList.remove('active'); };
    const body = document.getElementById('knownSheetBody');
    if (body) body.addEventListener('click', function (e) {
      const t = e.target && e.target.closest ? e.target.closest('button') : e.target;
      if (!t || !t.id) return;
      if (t.id === 'knownApply') submitApply(body);
      if (t.id === 'knownPay') startPay(body);
    });
    return sheet;
  }

  async function openInto(host) {
    if (!host) return;
    if (host.dataset.wired !== '1') {
      host.dataset.wired = '1';
      host.addEventListener('click', function (e) {
        const t = e.target && e.target.closest ? e.target.closest('button') : null;
        if (!t || !t.id) return;
        if (t.id === 'knownApply') submitApply(host);
        if (t.id === 'knownPay') startPay(host);
      });
    }
    host.dataset.painted = '';
    host.dataset.status = '';
    if (typeof currentUser === 'undefined' || !currentUser || typeof fbDb === 'undefined' || !fbDb) {
      paintMine(host, null, { bare: true });
      return;
    }
    try {
      const snap = await fbDb.collection('knownApps').doc(currentUser.uid).get();
      host.dataset.painted = '';
      host.dataset.status = '';
      paintMine(host, snap.exists ? snap.data() : null, { bare: true });
    } catch (_) {
      host.dataset.painted = '';
      paintMine(host, null, { bare: true });
    }
  }

  async function openSheet() {
    const sheet = ensureSheet();
    const body = document.getElementById('knownSheetBody');
    sheet.classList.add('active');
    if (!body) return;
    if (typeof currentUser === 'undefined' || !currentUser || typeof fbDb === 'undefined' || !fbDb) {
      paintMine(body, null, { bare: true });
      return;
    }
    try {
      const snap = await fbDb.collection('knownApps').doc(currentUser.uid).get();
      paintMine(body, snap.exists ? snap.data() : null, { bare: true });
    } catch (_) {
      paintMine(body, null, { bare: true });
    }
  }

  async function submitApply(host) {
    const box = host && host.querySelector ? host.querySelector('textarea') : null;
    const note = cleanNote(box && box.value);
    const count = host && host.querySelector ? host.querySelector('.known-count') : null;
    if (note.length < NOTE_MIN) {
      if (count) count.textContent = note.length + ' / ' + NOTE_MAX + ' characters · at least ' + NOTE_MIN;
      return;
    }
    if (typeof currentUser === 'undefined' || !currentUser || typeof fbDb === 'undefined' || !fbDb) {
      if (typeof toast === 'function') toast('Sign in first');
      return;
    }
    const name = (typeof currentProfile !== 'undefined' && currentProfile && currentProfile.name) || '';
    const row = freshApply(currentUser.uid, name, note, Date.now());
    if (!row) return;
    try {
      await fbDb.collection('knownApps').doc(currentUser.uid).set(row);
      if (typeof toast === 'function') toast('Sent');
      const bare = host && host.id === 'knownSheetBody';
      if (host) {
        host.dataset.painted = '';
        paintMine(host, row, bare ? { bare: true } : null);
      }
    } catch (err) {
      if (typeof toast === 'function') toast((err && err.message) || 'Could not send that');
    }
  }

  async function startPay(host) {
    const msg = (host && host.querySelector && host.querySelector('#knownPayMsg')) || document.getElementById('knownPayMsg');
    if (typeof currentUser === 'undefined' || !currentUser) return;
    let q = payQuote();
    /* After the worker said the price moved, use its number (10 minutes). */
    const srv = startPay.__server;
    if (srv && q && srv.currency === q.currency && Date.now() - srv.at < 10 * 60 * 1000) {
      q = Object.assign({}, q, { major: srv.major });
    }
    if (!q) {
      const text = 'The Known price is not set yet. Nothing was charged.';
      if (msg) msg.textContent = text;
      if (typeof toast === 'function') toast(text);
      return;
    }
    try {
      /* The worker prices this itself at the running rate. amount_major is
         what this screen showed, so a big gap is caught, not charged. */
      const body = {
        kind: 'known',
        amount_major: q.major,
        currency: q.currency,
        idempotency_key: 'known_' + currentUser.uid + '_' + new Date().toISOString().slice(0, 7),
      };
      let url = '';
      if (typeof nalunoCheckout === 'function') url = await nalunoCheckout(body);
      else throw new Error('Payments aren’t available yet. Nothing was charged.');
      window.location.href = url;
    } catch (err) {
      let text = (err && err.message) || 'Payments aren’t available yet. Nothing was charged.';
      const d = err && err.data;
      if (d && d.code === 'price_changed' && d.amount_major > 0) {
        try {
          const C = window.NalunoCurrency;
          const now = (C && C.formatMajor) ? C.formatMajor(d.amount_major, d.currency) : (d.currency + ' ' + d.amount_major);
          startPay.__server = { major: Number(d.amount_major), currency: String(d.currency || ''), at: Date.now() };
          text = 'The price is now ' + now + ' a month. Tap Pay again to continue. Nothing was charged.';
          if (host && host.querySelectorAll) host.querySelectorAll('.known-fee').forEach(function (el) { el.textContent = ' · ' + now + ' a month'; });
        } catch (_) {}
      }
      if (msg) msg.textContent = text;
      if (typeof toast === 'function') toast(text);
    }
  }

  if (typeof document !== 'undefined') {
    let knownBoots = 0;
    function bootKnown() {
      wireMine();
      knownBoots += 1;
      const ready = typeof currentUser !== 'undefined' && currentUser;
      if (!ready && knownBoots < 24) setTimeout(bootKnown, 700);
    }
    document.addEventListener('DOMContentLoaded', bootKnown);
    setTimeout(bootKnown, 400);
    try {
      if (window.firebase && firebase.auth) firebase.auth().onAuthStateChanged(function () { wireMine(); });
    } catch (_) {}
    document.addEventListener('naluno-currency', function () {
      const fee = feeLabel();
      document.querySelectorAll('.known-fee').forEach(function (el) {
        el.textContent = fee ? (' · ' + fee) : '';
      });
    });
  }

  return {
    MONTH_MS: MONTH_MS,
    freshApply: freshApply,
    review: review,
    recordPayment: recordPayment,
    grantKnown: grantKnown,
    voidGrant: voidGrant,
    voidPayment: voidPayment,
    isKnown: isKnown,
    stampView: stampView,
    markHtml: markHtml,
    paintBeside: paintBeside,
    paintAll: paintAll,
    paintMine: paintMine,
    refreshMine: refreshMine,
    openSheet: openSheet,
    openInto: openInto,
  };
});
