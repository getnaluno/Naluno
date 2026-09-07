/* ============================================================
   MODULE: js/admin-console.js
   Operator Control Centre at /admin/. Not loaded by the member app.
   Real gates: Firebase sign-in + Worker ADMIN_UIDS + passphrase.
   The passphrase is held in memory for this page only.
   ============================================================ */
(function(){
  const $ = function(id){ return document.getElementById(id); };
  const WORKER = 'https://naluno-economy.naluno.workers.dev';
  const HANDLE_DOMAIN = 'users.getnaluno.com';
  let fbAuth = null;
  let currentUser = null;
  let __adminPass = '';

  function escapeHtml(str){
    return String(str == null ? '' : str)
      .replace(/&/g,'&').replace(/</g,'<').replace(/>/g,'>')
      .replace(/"/g,'"').replace(/'/g,'&#39;');
  }
  function toast(msg){
    const t = $('toast');
    if(!t) return;
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(function(){ t.classList.remove('show'); }, 2200);
  }
  try{ window.toast = toast; window.$ = $; window.escapeHtml = escapeHtml; }catch(_){}

  function setMsg(id, text, ok){
    const el = $(id);
    if(!el) return;
    el.textContent = text || '';
    el.className = 'msg' + (ok ? ' ok' : '');
  }
  function show(id, on){
    const el = $(id);
    if(!el) return;
    el.classList.toggle('hidden', !on);
  }
  function tickClock(){
    const el = $('liveClock');
    if(!el) return;
    const d = new Date();
    el.textContent = d.toISOString().slice(11, 19) + 'Z';
  }
  tickClock();
  setInterval(tickClock, 1000);

  function normalizeHandle(raw){
    return String(raw || '').trim().replace(/^@+/, '').toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 24);
  }
  function handleToEmail(handle){
    const h = normalizeHandle(handle);
    return h ? (h + '@' + HANDLE_DOMAIN) : '';
  }

  function firebaseReady(){
    return typeof firebase !== 'undefined'
      && typeof firebaseConfig !== 'undefined'
      && firebaseConfig.apiKey && firebaseConfig.apiKey !== 'YOUR_API_KEY';
  }
  function initFirebase(){
    if(fbAuth) return true;
    if(!firebaseReady()) return false;
    try{
      if(!(firebase.apps && firebase.apps.length)) firebase.initializeApp(firebaseConfig);
      fbAuth = firebase.auth();
      fbAuth.setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch(function(){});
      return true;
    }catch(e){
      console.error('[naluno-admin] firebase init', e);
      return false;
    }
  }
  function ensureConfig(done){
    if(firebaseReady()){ if(done) done(true); return; }
    const s = document.createElement('script');
    s.src = '/firebase-config.js?v=20260907a';
    s.onload = function(){ if(done) done(true); };
    s.onerror = function(){ if(done) done(false); };
    document.head.appendChild(s);
  }

  function whoLine(user){
    if(!user) return '';
    const mail = user.email || '';
    const handle = mail.indexOf('@' + HANDLE_DOMAIN) > 0 ? mail.split('@')[0] : mail;
    return (handle || 'signed in') + ' · ' + String(user.uid).slice(0, 8) + '…';
  }

  function lockConsole(){
    __adminPass = '';
    const body = $('adminBody');
    if(body) body.innerHTML = '';
    show('consoleView', false);
    show('gatePanel', !!currentUser);
    show('signPanel', !currentUser);
    const inp = $('adminPassInput'); if(inp) inp.value = '';
    setMsg('adminGateMsg', '');
  }

  async function adminFetch(path, opts){
    if(!currentUser) throw new Error('not signed in');
    const idToken = await currentUser.getIdToken(false);
    return fetch(WORKER + '/v1/admin/' + path, Object.assign({
      headers: {
        'Authorization': 'Bearer ' + idToken,
        'X-Naluno-Admin': __adminPass,
        'Content-Type': 'application/json',
      },
    }, opts || {}));
  }

  function adminCard(title, inner){
    return '<div class="card"><div class="who">' + escapeHtml(title) + '</div>' + inner + '</div>';
  }

  function renderAdminOverview(data){
    const el = $('adminBody');
    if(!el) return;
    const f = data.flags || {};
    const flagRows = Object.keys(f).map(function(k){
      const on = !!f[k];
      const locked = (k === 'real_payouts_enabled');
      return '<div class="flag-row">'
        + '<span style="flex:1;">' + escapeHtml(k) + '</span>'
        + '<span style="color:' + (on ? 'var(--mint)' : 'var(--ink-dim)') + ';">' + (on ? 'ON' : 'OFF') + '</span>'
        + (locked
            ? '<span style="font-size:10px;color:var(--ink-dim);">sign-off required</span>'
            : '<button type="button" class="ghost admin-flag" data-flag="' + escapeHtml(k) + '" data-next="' + (on ? '0' : '1') + '">' + (on ? 'Turn off' : 'Turn on') + '</button>')
        + '</div>';
    }).join('');

    el.innerHTML =
      adminCard('System',
        '<div class="sub" style="margin:0;">Rules version <strong>' + escapeHtml(String(data.rules_version || '—')) + '</strong><br>'
        + 'Ledger rows sampled: ' + escapeHtml(String(data.ledger_rows_sampled || 0)) + '<br>'
        + 'Counted: ' + escapeHtml(String(data.counted || 0)) + ' · Pending review: ' + escapeHtml(String(data.pending_review || 0)) + '<br>'
        + 'Points (sampled): ' + escapeHtml(String(data.total_points_sampled || 0))
        + ' · Eligible: ' + escapeHtml(String(data.total_eligible_sampled || 0))
        + '</div>')
      + adminCard('Feature flags', flagRows || '<div class="sub" style="margin:0;">No flags returned.</div>')
      + adminCard('Reward simulation — no money moves',
          '<label for="admSimPeriod">Period</label>'
        + '<input id="admSimPeriod" placeholder="e.g. 2026-09" />'
        + '<label for="admSimPool">Pool amount</label>'
        + '<input id="admSimPool" placeholder="e.g. 10000" inputmode="decimal" />'
        + '<div class="row">'
        + '<button type="button" class="ghost" id="admSavePool">Save pool</button>'
        + '<button type="button" class="primary" id="admRunSim">Run simulation</button>'
        + '</div>'
        + '<div id="admSimOut" class="sub" style="margin-top:10px;"></div>')
      + adminCard('Recent ledger', (data.recent || []).slice(0, 12).map(function(r){
          return '<div style="font-family:var(--dial);font-size:11px;color:var(--ink-dim);padding:4px 0;border-bottom:1px solid var(--line);">'
            + escapeHtml(String(r.event_type || '')) + ' · ' + escapeHtml(String(r.points))
            + ' pts (elig ' + escapeHtml(String(r.eligible_points)) + ') · ' + escapeHtml(String(r.status || ''))
            + '</div>';
        }).join('') || '<div class="sub" style="margin:0;">No ledger rows yet.</div>')
      + '<button type="button" class="ghost" id="admAuditBtn" style="width:100%;margin:4px 0 12px;">View audit log</button>'
      + '<div id="admAuditOut"></div>';

    el.querySelectorAll('.admin-flag').forEach(function(btn){
      btn.onclick = async function(){
        const flag = btn.getAttribute('data-flag');
        const next = btn.getAttribute('data-next') === '1';
        const reason = window.prompt('Reason for this change (recorded in the audit log):', '');
        if(reason === null) return;
        const payload = { reason: reason };
        payload[flag] = next;
        const res = await adminFetch('flags', { method: 'POST', body: JSON.stringify(payload) });
        const body = await res.json().catch(function(){ return {}; });
        if(!res.ok || !body.ok){ toast(body.error || 'Change refused'); return; }
        toast('Updated');
        const ov = await adminFetch('overview');
        if(ov.ok) renderAdminOverview(await ov.json());
      };
    });

    const savePool = $('admSavePool');
    if(savePool) savePool.onclick = async function(){
      const period = ($('admSimPeriod') && $('admSimPeriod').value || '').trim();
      const major = Number(($('admSimPool') && $('admSimPool').value || '').replace(/[^0-9.]/g, ''));
      if(!period || !(major >= 0)){ toast('Period and amount are needed'); return; }
      const reason = window.prompt('Reason (audit log):', '');
      if(reason === null) return;
      const res = await adminFetch('pools', { method:'POST', body: JSON.stringify({
        period_id: period, amount_minor: Math.round(major * 100), currency: 'AED',
        funding_source: 'UNSPECIFIED', status: 'DRAFT', reason: reason,
      })});
      const b = await res.json().catch(function(){ return {}; });
      toast(res.ok && b.ok ? 'Pool saved (draft)' : (b.error || 'Could not save'));
    };

    const runSim = $('admRunSim');
    if(runSim) runSim.onclick = async function(){
      const period = ($('admSimPeriod') && $('admSimPeriod').value || '').trim();
      const out = $('admSimOut');
      if(!period){ toast('Enter a period'); return; }
      if(out) out.textContent = 'Simulating…';
      const res = await adminFetch('simulate', { method:'POST', body: JSON.stringify({ period_id: period, limit: 20 }) });
      const b = await res.json().catch(function(){ return {}; });
      if(!res.ok || !b.ok){ if(out) out.textContent = b.error || 'Simulation failed'; return; }
      const money = function(minor){ return (minor / 100).toFixed(2); };
      if(out) out.innerHTML =
        '<strong>Simulation only — no money moves.</strong><br>'
        + 'Pool: ' + escapeHtml(money(b.pool_amount_minor)) + ' ' + escapeHtml(b.currency) + '<br>'
        + 'Eligible contributors: ' + escapeHtml(String(b.eligible_contributors)) + '<br>'
        + 'Total eligible contribution: ' + escapeHtml(String(b.total_eligible_contribution)) + '<br>'
        + 'Allocated: ' + escapeHtml(money(b.allocated_minor)) + ' · Undistributed: ' + escapeHtml(money(b.undistributed_minor)) + '<br><br>'
        + (b.projected || []).map(function(r, i){
            return (i+1) + '. ' + escapeHtml(String(r.user_id).slice(0,10)) + '… — '
              + escapeHtml(money(r.amount_minor)) + ' (' + escapeHtml(String(r.eligible)) + ' eligible)';
          }).join('<br>');
    };

    const auditBtn = $('admAuditBtn');
    if(auditBtn) auditBtn.onclick = async function(){
      const out = $('admAuditOut');
      if(out) out.innerHTML = '<div class="sub">Loading…</div>';
      const res = await adminFetch('audit');
      const b = await res.json().catch(function(){ return {}; });
      if(!res.ok || !b.ok){ if(out) out.textContent = 'Could not load audit log'; return; }
      if(out) out.innerHTML = (b.entries || []).slice(0, 30).map(function(e){
        return '<div style="font-family:var(--dial);font-size:11px;color:var(--ink-dim);padding:4px 0;border-bottom:1px solid var(--line);">'
          + escapeHtml(new Date(Number(e.created_at) || 0).toLocaleString()) + ' · '
          + escapeHtml(String(e.action || '')) + ' · ' + escapeHtml(String(e.target || '')) + '<br>'
          + 'reason: ' + escapeHtml(String(e.reason || '—'))
          + '</div>';
      }).join('') || '<div class="sub">No entries.</div>';
    };

    try{ if(typeof renderDiagPanel === 'function') renderDiagPanel(); }catch(_){}
  }

  async function adminUnlock(){
    const inp = $('adminPassInput');
    if(!inp || !currentUser) return;
    __adminPass = inp.value || '';
    setMsg('adminGateMsg', 'Checking…');
    try{
      const res = await adminFetch('overview');
      if(res.status === 404){
        setMsg('adminGateMsg', 'Not available.');
        __adminPass = '';
        return;
      }
      if(res.status === 503){
        // The worker is reachable but ADMIN_PASSPHRASE was never set on it.
        // This used to render as "Passphrase not accepted", which meant a
        // secret that did not exist looked exactly like one typed wrong —
        // you could retype a correct passphrase forever and never learn that.
        const b = await res.json().catch(function(){ return {}; });
        setMsg('adminGateMsg', b.error || 'Admin passphrase is not configured on the server.');
        __adminPass = '';
        return;
      }
      if(!res.ok){
        setMsg('adminGateMsg', 'Passphrase not accepted.');
        __adminPass = '';
        return;
      }
      const data = await res.json();
      show('gatePanel', false);
      show('signPanel', false);
      show('consoleView', true);
      const who = $('consoleWho');
      if(who) who.textContent = whoLine(currentUser) + ' · every change is logged.';
      try{ document.title = 'Naluno · Control'; }catch(_){}
      renderAdminOverview(data);
    }catch(_){
      setMsg('adminGateMsg', 'Couldn’t reach the service.');
      __adminPass = '';
    }
  }

  async function signInHandle(){
    if(!initFirebase()){ setMsg('signMsg', 'Sign-in is not ready.'); return; }
    const handle = normalizeHandle(($('adminHandle') && $('adminHandle').value) || '');
    const password = ($('adminPassword') && $('adminPassword').value) || '';
    if(!handle || handle.length < 3){ setMsg('signMsg', 'Enter your handle.'); return; }
    if(!password || password.length < 6){ setMsg('signMsg', 'Enter your password.'); return; }
    setMsg('signMsg', 'Signing in…', true);
    try{
      await fbAuth.signInWithEmailAndPassword(handleToEmail(handle), password);
    }catch(e){
      const bad = e && (e.code === 'auth/user-not-found' || e.code === 'auth/wrong-password' || e.code === 'auth/invalid-credential');
      setMsg('signMsg', bad ? 'Not recognized.' : ((e && e.message) || 'Could not sign in.'));
    }
  }

  async function signInGoogle(){
    if(!initFirebase()){ setMsg('signMsg', 'Sign-in is not ready.'); return; }
    setMsg('signMsg', 'Opening Google…', true);
    try{
      const provider = new firebase.auth.GoogleAuthProvider();
      await fbAuth.signInWithPopup(provider);
    }catch(e){
      if(e && (e.code === 'auth/popup-closed-by-user' || e.code === 'auth/cancelled-popup-request')){
        setMsg('signMsg', '');
        return;
      }
      setMsg('signMsg', (e && e.message) || 'Google sign-in failed.');
    }
  }

  function signOut(){
    __adminPass = '';
    currentUser = null;
    lockConsole();
    try{ document.title = 'Naluno'; }catch(_){}
    if(fbAuth) fbAuth.signOut().catch(function(){});
  }

  function onUser(user){
    currentUser = user || null;
    if(!user){
      lockConsole();
      return;
    }
    show('signPanel', false);
    show('consoleView', false);
    show('gatePanel', true);
    const who = $('gateWho');
    if(who) who.textContent = whoLine(user);
    setMsg('signMsg', '');
    try{ if(typeof renderDiagPanel === 'function') renderDiagPanel(); }catch(_){}
  }

  function bind(){
    const si = $('adminSignInBtn'); if(si) si.onclick = signInHandle;
    const gg = $('adminGoogleBtn'); if(gg) gg.onclick = signInGoogle;
    const un = $('adminUnlockBtn'); if(un) un.onclick = adminUnlock;
    const so = $('adminSignOutBtn'); if(so) so.onclick = signOut;
    const so2 = $('adminSignOutBtn2'); if(so2) so2.onclick = signOut;
    const lk = $('adminLockBtn'); if(lk) lk.onclick = lockConsole;
    const pass = $('adminPassInput');
    if(pass) pass.addEventListener('keydown', function(e){ if(e.key === 'Enter') adminUnlock(); });
    const pw = $('adminPassword');
    if(pw) pw.addEventListener('keydown', function(e){ if(e.key === 'Enter') signInHandle(); });
  }

  function boot(){
    bind();
    ensureConfig(function(){
      if(!initFirebase()){
        setMsg('signMsg', 'Sign-in could not start.');
        return;
      }
      fbAuth.onAuthStateChanged(onUser);
    });
  }
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
