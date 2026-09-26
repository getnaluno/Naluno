/* Known: a reviewed name, then a paid month. The mark is not a copied badge.
   Nothing here can mark a person Known without a payment time. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.NalunoKnown = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  const MONTH_MINOR = 4900;
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

  function recordPayment(app, paidAt, ref) {
    if (!app) return null;
    const at = Number(paidAt);
    if (!(at > 0)) return null;
    if (app.status !== 'accepted' && app.status !== 'known' && app.status !== 'lapsed') return null;
    const carry = (app.status === 'known' && Number(app.paidUntil) > at) ? Number(app.paidUntil) : at;
    return Object.assign({}, app, {
      status: 'known',
      paidAt: at,
      paidUntil: carry + MONTH_MS,
      amount_minor: MONTH_MINOR,
      payRef: String(ref || '').slice(0, 120),
      updatedAt: at,
    });
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
    return '<span class="naluno-known" title="Known">' + LABEL + '</span>';
  }

  function paintBeside(el, uid) {
    if (!el) return;
    const existing = el.querySelector && el.querySelector('.naluno-known');
    if (existing) existing.remove();
    if (!uid || typeof fbDb === 'undefined' || !fbDb) return;
    fbDb.collection('users').doc(String(uid)).get().then(function (snap) {
      const data = snap && snap.exists ? (snap.data() || {}) : null;
      if (!isKnown(data)) return;
      if (!el.querySelector('.naluno-known')) el.insertAdjacentHTML('beforeend', markHtml());
    }).catch(function () {});
  }

  const NOTE_MIN = 12;
  const NOTE_MAX = 500;

  function feeLabel() {
    try {
      const C = typeof window !== 'undefined' ? window.NalunoCurrency : null;
      if (C && typeof C.formatMinor === 'function') return C.formatMinor(MONTH_MINOR, 'AED');
    } catch (_) {}
    return '';
  }

  function formHtml(fee) {
    const price = fee ? ('<p class="known-copy known-price">One month · ' + fee + '</p>') : '<p class="known-copy known-price"></p>';
    return price
      + '<textarea class="known-note" maxlength="' + NOTE_MAX + '" rows="4" placeholder="Who you are"></textarea>'
      + '<p class="known-count">0 / ' + NOTE_MAX + ' · at least ' + NOTE_MIN + '</p>'
      + '<button type="button" class="save-btn" id="knownApply">Send</button>';
  }

  function wireCount(block) {
    const note = block.querySelector('textarea');
    const count = block.querySelector('.known-count');
    if (!note || !count || note.dataset.counted === '1') return;
    note.dataset.counted = '1';
    const tick = function () {
      const n = cleanNote(note.value).length;
      count.textContent = n + ' / ' + NOTE_MAX + (n < NOTE_MIN ? (' · at least ' + NOTE_MIN) : '');
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
      const price = block.querySelector('.known-price');
      if (price) price.textContent = fee ? ('One month · ' + fee) : '';
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
      button = 'Pay';
      body = '<p class="known-copy known-price">' + (fee ? ('One month · ' + fee) : '') + '</p>'
        + '<button type="button" class="save-btn" id="knownPay">Pay</button>'
        + '<p class="known-copy" id="knownPayMsg"></p>';
    } else if (app && isKnown(app)) {
      button = 'Known';
      body = '<p class="known-copy">Until ' + new Date(app.paidUntil).toLocaleDateString() + '.</p>'
        + '<button type="button" class="save-btn" id="knownPay">Next month</button>'
        + '<p class="known-copy" id="knownPayMsg"></p>';
    } else if (app) {
      button = 'Pay';
      body = '<p class="known-copy known-price">' + (fee ? ('One month · ' + fee) : '') + '</p>'
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
      paintMine(block, null);
      return;
    }
    try {
      const snap = await fbDb.collection('knownApps').doc(currentUser.uid).get();
      paintMine(block, snap.exists ? snap.data() : null);
      const view = document.getElementById('viewName');
      if (view && snap.exists && isKnown(snap.data())) {
        if (!view.querySelector('.naluno-known')) view.insertAdjacentHTML('beforeend', markHtml());
      }
    } catch (_) {
      paintMine(block, null);
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
      if (count) count.textContent = note.length + ' / ' + NOTE_MAX + ' · at least ' + NOTE_MIN;
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
    let code = 'AED';
    let minor = MONTH_MINOR;
    try {
      const C = window.NalunoCurrency;
      if (C && typeof C.code === 'function' && C.code()) code = C.code();
      if (C && typeof C.convertMinor === 'function') minor = C.convertMinor(MONTH_MINOR, 'AED', code);
    } catch (_) {}
    try {
      const body = {
        kind: 'known',
        amount_minor: minor,
        currency: code,
        book_minor: MONTH_MINOR,
        idempotency_key: 'known_' + currentUser.uid + '_' + new Date().toISOString().slice(0, 7),
      };
      let url = '';
      if (typeof nalunoCheckout === 'function') url = await nalunoCheckout(body);
      else throw new Error('Payments aren’t available yet. Nothing was charged.');
      window.location.href = url;
    } catch (err) {
      const text = (err && err.message) || 'Payments aren’t available yet. Nothing was charged.';
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
      document.querySelectorAll('.known-price').forEach(function (el) {
        el.textContent = fee ? ('One month · ' + fee) : '';
      });
    });
  }

  return {
    MONTH_MINOR: MONTH_MINOR,
    MONTH_MS: MONTH_MS,
    freshApply: freshApply,
    review: review,
    recordPayment: recordPayment,
    isKnown: isKnown,
    markHtml: markHtml,
    paintBeside: paintBeside,
    paintMine: paintMine,
    refreshMine: refreshMine,
    openSheet: openSheet,
  };
});
