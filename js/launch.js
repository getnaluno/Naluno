/* Launch & Capacity in the app (13 Oct a).

   - Reads launchConfig/production (public, live): which features are on and
     the media limits. Changes from the console arrive without an app update.
   - Before an account is created it asks the economy worker whether new
     accounts are being accepted, and right after the sign-in account exists
     it claims a registration seat. Without a seat no Callsign profile can be
     created (firestore.rules). An account that already has a profile never
     needs a seat and is never turned away.
   - When registration is closed, full or paused it says so, and offers the
     waiting list if the desk has it on: an email address and nothing else.
   - Feature switches and limits are enforced on the server (rules, upload
     worker). The messages here only say it kindly before a request fails. */
(function () {
  const WORKER = 'https://naluno-economy.naluno.workers.dev';
  const FEATURE_WORDS = {
    signals: 'Posting Signals', broadcasts: 'Publishing Broadcasts', live: 'Going live',
    uploads: 'Uploading media', comments: 'Comments and replies', questions: 'Questions and contributions',
    bands: 'Starting a Band',
  };
  let cfg = null;
  let unsub = null;

  function envName() {
    try { if (sessionStorage.getItem('nalunoLaunchEnv') === 'staging') return 'staging'; } catch (_) {}
    try {
      const q = new URLSearchParams(location.search || '').get('launchEnv');
      if (q === 'staging') { try { sessionStorage.setItem('nalunoLaunchEnv', 'staging'); } catch (_) {} return 'staging'; }
    } catch (_) {}
    return 'production';
  }
  function listen() {
    if (unsub || typeof fbDb === 'undefined' || !fbDb) return false;
    try {
      unsub = fbDb.collection('launchConfig').doc(envName()).onSnapshot(function (snap) {
        cfg = snap && snap.exists ? (snap.data() || null) : null;
        try { document.dispatchEvent(new CustomEvent('naluno-launch', { detail: cfg })); } catch (_) {}
      }, function () { unsub = null; setTimeout(listen, 15000); });
    } catch (_) { unsub = null; return false; }
    return true;
  }
  (function boot() { if (!listen()) setTimeout(boot, 1500); })();

  /* '' when allowed; otherwise a sentence to show. */
  function blocked(feature) {
    if (!cfg) return '';
    if (cfg.features && cfg.features[feature] === false) {
      return (FEATURE_WORDS[feature] || 'This') + ' is paused on Naluno for now. Nothing already posted is affected.';
    }
    if (feature === 'live' && cfg.guardState && cfg.guardState.restricting && cfg.guardState.restricting.newLives) {
      return 'New lives are paused for a while to keep Naluno within its budget. Lives already running carry on.';
    }
    return '';
  }
  function media() { return (cfg && cfg.media) || null; }

  async function status() {
    try {
      const r = await fetch(WORKER + '/v1/launch/status', { cache: 'no-store' });
      const b = await r.json().catch(function () { return {}; });
      return r.ok ? b : null;
    } catch (_) { return null; } // cannot tell: the claim after sign-up decides
  }

  async function claim(user) {
    if (!user || !user.getIdToken) return { ok: false, reason: 'network' };
    try {
      const tok = await user.getIdToken();
      const r = await fetch(WORKER + '/v1/register/claim', {
        method: 'POST', cache: 'no-store',
        headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' },
        body: '{}',
      });
      const b = await r.json().catch(function () { return {}; });
      if (r.ok && b.ok) return b;
      if (r.status === 403 && b.reason) return b;
      return { ok: false, reason: 'network', error: b.error || '' };
    } catch (_) { return { ok: false, reason: 'network' }; }
  }

  /* A brand-new sign-in account that got no seat: it has no Callsign and
     never will from this attempt, so it is removed again (only possible
     right after it was made), and the person is told why. */
  async function refuseNewUser(user, seat) {
    // Only a sign-in account made by this very attempt (minutes old) is
    // removed. An older one (a profile that was never written, years ago)
    // is only signed out: nothing that existed before is ever deleted here.
    let fresh = false;
    try {
      const made = Date.parse((user && user.metadata && user.metadata.creationTime) || '');
      fresh = isFinite(made) && Date.now() - made < 10 * 60 * 1000;
    } catch (_) {}
    let gone = false;
    if (fresh) { try { if (user && user.delete) { await user.delete(); gone = true; } } catch (_) {} }
    if (!gone) { try { if (typeof fbAuth !== 'undefined' && fbAuth) await fbAuth.signOut(); } catch (_) {} }
    setTimeout(function () { showClosed(seat); }, 300);
  }

  function saved() {
    try { return JSON.parse(localStorage.getItem('nalunoWaitlist') || 'null'); } catch (_) { return null; }
  }
  function save(v) {
    try { if (v) localStorage.setItem('nalunoWaitlist', JSON.stringify(v)); else localStorage.removeItem('nalunoWaitlist'); } catch (_) {}
  }
  function esc(s) { return String(s || '').replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  /* The panel in the sign-in screen. st: { message, waitlist } */
  function showClosed(st) {
    const form = document.getElementById('authGateForm');
    if (!form) return;
    let box = document.getElementById('nalunoClosedBox');
    if (!box) {
      box = document.createElement('div');
      box.id = 'nalunoClosedBox';
      box.setAttribute('role', 'status');
      box.style.cssText = 'width:100%;max-width:340px;margin-top:6px;padding:14px;border:1px solid var(--line);border-radius:14px;background:var(--surface);text-align:left;font-size:13px;line-height:1.5;color:var(--text);';
      form.appendChild(box);
    }
    const mine = saved();
    const msg = (st && (st.message || st.error)) || 'New accounts are closed for now. If you already have an account, sign in as usual.';
    let html = '<div style="font-weight:600;margin-bottom:6px;">' + esc(msg) + '</div>';
    if (mine && mine.id) {
      html += '<div style="color:var(--text-dim);">You are on the waiting list' + (mine.email ? ' as ' + esc(mine.email) : '') + '. We will write once when places open; nothing else.</div>'
        + '<button type="button" id="nalunoWaitLeave" style="margin-top:10px;background:none;border:1px solid var(--line);border-radius:10px;color:var(--text);padding:8px 12px;">Take me off the list</button>';
    } else if (st && st.waitlist) {
      html += '<div style="color:var(--text-dim);margin-bottom:8px;">Join the waiting list: we keep only your email address, to write once when places open. Nothing else is asked or kept, and you can take yourself off at any time.</div>'
        + '<input id="nalunoWaitEmail" type="email" autocomplete="email" placeholder="Email address" style="width:100%;box-sizing:border-box;background:var(--surface-2,#151926);border:1px solid var(--line);border-radius:10px;padding:10px 12px;color:var(--text);font-size:14px;" />'
        + '<button type="button" id="nalunoWaitJoin" class="join-btn" style="margin-top:8px;width:100%;padding:10px;">Join the waiting list</button>';
    }
    html += '<div id="nalunoWaitOut" style="margin-top:8px;color:var(--text-dim);"></div>';
    box.innerHTML = html;
    const out = document.getElementById('nalunoWaitOut');
    const join = document.getElementById('nalunoWaitJoin');
    if (join) join.onclick = async function () {
      const email = (document.getElementById('nalunoWaitEmail') || {}).value || '';
      join.disabled = true;
      try {
        const r = await fetch(WORKER + '/v1/waitlist/join', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: email }) });
        const b = await r.json().catch(function () { return {}; });
        if (r.ok && b.ok) { save({ id: b.id, key: b.key, email: String(email).trim().toLowerCase() }); showClosed(st); }
        else { out.textContent = b.error || 'That did not go through. Try again.'; join.disabled = false; }
      } catch (_) { out.textContent = 'No connection. Try again.'; join.disabled = false; }
    };
    const leave = document.getElementById('nalunoWaitLeave');
    if (leave) leave.onclick = async function () {
      const m = saved();
      leave.disabled = true;
      try {
        const r = await fetch(WORKER + '/v1/waitlist/leave', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: m.id, key: m.key }) });
        const b = await r.json().catch(function () { return {}; });
        if (r.ok && b.ok) { save(null); out.textContent = 'Done. Your email has been removed.'; showClosed(st); }
        else { out.textContent = b.error || 'That did not go through.'; leave.disabled = false; }
      } catch (_) { out.textContent = 'No connection. Try again.'; leave.disabled = false; }
    };
  }
  function hideClosed() { const b = document.getElementById('nalunoClosedBox'); if (b) b.remove(); }

  function fmtSec(sec) { return sec >= 3600 ? (Math.round(sec / 360) / 10) + ' h' : Math.round(sec / 60) + ' min'; }

  window.NalunoLaunch = {
    env: envName, config: function () { return cfg; }, media: media, blocked: blocked,
    status: status, claim: claim, refuseNewUser: refuseNewUser, showClosed: showClosed, hideClosed: hideClosed,
    fmtSec: fmtSec,
    _set: function (c) { cfg = c; }, // tests
  };
})();
