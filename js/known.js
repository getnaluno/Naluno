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

  function paintMine(block, app) {
    if (!block) return;
    const fee = (MONTH_MINOR / 100).toFixed(0) + ' AED';
    if (!app) {
      block.hidden = false;
      block.innerHTML = '<p class="known-copy">Ask to be Known. Naluno looks at the note. If it is accepted, one month is ' + fee + '. The mark appears only after that payment.</p>'
        + '<textarea id="knownNote" maxlength="500" rows="3" placeholder="Who you are, in a few sentences"></textarea>'
        + '<button type="button" class="save-btn" id="knownApply">Ask to be Known</button>';
      return;
    }
    block.hidden = false;
    if (app.status === 'applied') {
      block.innerHTML = '<p class="known-copy">Naluno has your note. The mark is not on your name yet.</p>';
      return;
    }
    if (app.status === 'declined' || app.status === 'revoked') {
      block.innerHTML = '<p class="known-copy">This was not accepted. You can write again.</p>'
        + '<textarea id="knownNote" maxlength="500" rows="3" placeholder="Who you are, in a few sentences"></textarea>'
        + '<button type="button" class="save-btn" id="knownApply">Ask again</button>';
      return;
    }
    if (app.status === 'accepted' || app.status === 'lapsed') {
      block.innerHTML = '<p class="known-copy">Accepted. Pay ' + fee + ' for this month. The mark appears when the payment is confirmed. Nothing is marked before that.</p>'
        + '<button type="button" class="save-btn" id="knownPay">Pay for this month</button>'
        + '<p class="known-copy" id="knownPayMsg"></p>';
      return;
    }
    if (isKnown(app)) {
      block.innerHTML = '<p class="known-copy"><span class="naluno-known">Known</span> This month is paid. It ends ' + new Date(app.paidUntil).toLocaleDateString() + '.</p>'
        + '<button type="button" class="save-btn" id="knownPay">Pay the next month</button>'
        + '<p class="known-copy" id="knownPayMsg"></p>';
      return;
    }
    block.innerHTML = '<p class="known-copy">The month has ended. Pay again for the mark to return.</p>'
      + '<button type="button" class="save-btn" id="knownPay">Pay for this month</button>'
      + '<p class="known-copy" id="knownPayMsg"></p>';
  }

  function wireMine() {
    const block = document.getElementById('knownBlock');
    if (!block || block.dataset.wired === '1') return;
    block.dataset.wired = '1';
    block.addEventListener('click', function (e) {
      const t = e.target;
      if (!t || !t.id) return;
      if (t.id === 'knownApply') submitApply();
      if (t.id === 'knownPay') startPay();
    });
    refreshMine();
  }

  async function refreshMine() {
    const block = document.getElementById('knownBlock');
    if (!block || typeof currentUser === 'undefined' || !currentUser || typeof fbDb === 'undefined' || !fbDb) return;
    try {
      const snap = await fbDb.collection('knownApps').doc(currentUser.uid).get();
      paintMine(block, snap.exists ? snap.data() : null);
      const view = document.getElementById('viewName');
      if (view && snap.exists && isKnown(snap.data())) {
        if (!view.querySelector('.naluno-known')) view.insertAdjacentHTML('beforeend', markHtml());
      }
    } catch (_) {}
  }

  async function submitApply() {
    const box = document.getElementById('knownNote');
    const note = cleanNote(box && box.value);
    if (note.length < 12) {
      if (typeof toast === 'function') toast('Write a little more about who you are');
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
      if (typeof toast === 'function') toast('Sent. Naluno will look at it.');
      refreshMine();
    } catch (err) {
      if (typeof toast === 'function') toast((err && err.message) || 'Could not send that');
    }
  }

  async function startPay() {
    const msg = document.getElementById('knownPayMsg');
    if (typeof currentUser === 'undefined' || !currentUser) return;
    try {
      const body = {
        kind: 'known',
        amount_minor: MONTH_MINOR,
        currency: 'AED',
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
    document.addEventListener('DOMContentLoaded', wireMine);
    setTimeout(wireMine, 1200);
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
  };
});
