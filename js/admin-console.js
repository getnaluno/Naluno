/* ============================================================
   MODULE: js/admin-console.js
   Operator Control Centre at /admin/. Not loaded by the member app.

   Two gates, in this order:
     1. Firebase sign-in (same handle / Google as the app)
     2. Console password — stored hashed on the economy Worker, with a
        device-local copy so this screen can still open when the Worker
        allowlist has not been updated yet.

   The window MUST change after (1) and after (2). Every failure has a
   visible message. Nothing stays on Sign in with no explanation.
   ============================================================ */
(function(){
  const $ = function(id){ return document.getElementById(id); };
  const WORKER = 'https://naluno-economy.naluno.workers.dev';
  const HANDLE_DOMAIN = 'users.getnaluno.com';
  const LOCAL_KEY = 'nalunoAdminLocal.';
  let fbAuth = null;
  let currentUser = null;
  let __adminPass = '';
  let __needsSetup = false;
  let __serverMode = 'unknown'; // password | unreachable | denied | unknown

  function escapeHtml(str){
    return String(str == null ? '' : str)
      .replace(/&/g, '&' + 'amp;')
      .replace(/</g, '&' + 'lt;')
      .replace(/>/g, '&' + 'gt;')
      .replace(/"/g, '&' + 'quot;')
      .replace(/'/g, '&#39;');
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

  /* Force the three panels. class + inline display, so a leftover style
     or a .hidden fight cannot leave the person staring at Sign in. */
  function setStage(stage){
    const map = { sign: 'signPanel', gate: 'gatePanel', console: 'consoleView' };
    Object.keys(map).forEach(function(k){
      const el = $(map[k]);
      if(!el) return;
      const on = (k === stage);
      el.classList.toggle('hidden', !on);
      if(k === 'console'){
        el.style.display = on ? 'block' : 'none';
      } else {
        el.style.display = on ? 'block' : 'none';
      }
    });
    try{
      document.title = stage === 'console' ? 'Naluno · Control' : 'Naluno';
    }catch(_){}
  }

  function tickClock(){
    const el = $('liveClock');
    if(!el) return;
    el.textContent = new Date().toISOString().slice(11, 19) + 'Z';
  }
  tickClock();
  setInterval(tickClock, 1000);

  function normalizeHandle(raw){
    return String(raw || '').trim().replace(/^@+/, '').toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 24);
  }
  function looksLikeEmail(raw){
    const s = String(raw || '').trim();
    return s.indexOf('@') > 0 && s.indexOf('.') > s.indexOf('@');
  }
  function handleToEmail(handle){
    const h = normalizeHandle(handle);
    return h ? (h + '@' + HANDLE_DOMAIN) : '';
  }
  function whoLine(user){
    if(!user) return '';
    const mail = user.email || '';
    const handle = mail.indexOf('@' + HANDLE_DOMAIN) > 0 ? mail.split('@')[0] : mail;
    return (handle || 'signed in') + ' · ' + String(user.uid);
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
    s.src = '/firebase-config.js?v=20260908b';
    s.onload = function(){ if(done) done(true); };
    s.onerror = function(){ if(done) done(false); };
    document.head.appendChild(s);
  }

  async function hashLocal(uid, pass){
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey('raw', enc.encode(String(pass)), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits({
      name: 'PBKDF2',
      salt: enc.encode('naluno-admin-v1|' + uid),
      iterations: 120000,
      hash: 'SHA-256',
    }, key, 256);
    const bytes = new Uint8Array(bits);
    let out = '';
    for(let i = 0; i < bytes.length; i++) out += String.fromCharCode(bytes[i]);
    return btoa(out);
  }
  function localGet(uid){
    try{ return localStorage.getItem(LOCAL_KEY + uid) || ''; }catch(_){ return ''; }
  }
  function localSet(uid, hash){
    try{ localStorage.setItem(LOCAL_KEY + uid, hash); }catch(_){}
  }
  async function localOk(uid, pass){
    const stored = localGet(uid);
    if(!stored) return false;
    try{ return stored === await hashLocal(uid, pass); }catch(_){ return false; }
  }

  async function adminFetch(path, opts){
    if(!currentUser) throw new Error('not signed in');
    opts = opts || {};
    const idToken = await currentUser.getIdToken(true);
    const headers = {
      'Authorization': 'Bearer ' + idToken,
      'X-Naluno-Admin': __adminPass || '',
    };
    const method = (opts.method || 'GET').toUpperCase();
    if(method !== 'GET' && method !== 'HEAD') headers['Content-Type'] = 'application/json';
    const next = {};
    for(const k in opts){ if(Object.prototype.hasOwnProperty.call(opts, k) && k !== 'headers') next[k] = opts[k]; }
    next.headers = headers;
    return fetch(WORKER + '/v1/admin/' + path, next);
  }

  function adminCard(title, inner){
    return '<div class="card"><div class="who">' + escapeHtml(title) + '</div>' + inner + '</div>';
  }

  function renderAdminOverview(data){
    const el = $('adminBody');
    if(!el) return;
    data = data || {};
    const f = data.flags || {};
    const flagKeys = Object.keys(f);
    const flagRows = flagKeys.map(function(k){
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

    const serverNote = (__serverMode === 'denied')
      ? adminCard('Server', '<div class="sub" style="margin:0;">This account is signed in, but the economy worker did not accept it as an operator. Diagnostics on this phone still work. Feature flags stay locked until the account is on the operator list.</div>')
      : (__serverMode === 'unreachable')
        ? adminCard('Server', '<div class="sub" style="margin:0;">Could not reach the economy worker. You are in on this device. Flags and ledger will fill in when the worker answers.</div>')
        : '';

    el.innerHTML =
      serverNote
      + adminCard('System',
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
        try{
          const res = await adminFetch('flags', { method: 'POST', body: JSON.stringify(payload) });
          const body = await res.json().catch(function(){ return {}; });
          if(!res.ok || !body.ok){ toast(body.error || 'Change refused'); return; }
          toast('Updated');
          const ov = await adminFetch('overview');
          if(ov.ok) renderAdminOverview(await ov.json());
        }catch(_){ toast('Couldn’t reach the service'); }
      };
    });

    const savePool = $('admSavePool');
    if(savePool) savePool.onclick = async function(){
      const period = ($('admSimPeriod') && $('admSimPeriod').value || '').trim();
      const major = Number(($('admSimPool') && $('admSimPool').value || '').replace(/[^0-9.]/g, ''));
      if(!period || !(major >= 0)){ toast('Period and amount are needed'); return; }
      const reason = window.prompt('Reason (audit log):', '');
      if(reason === null) return;
      try{
        const res = await adminFetch('pools', { method:'POST', body: JSON.stringify({
          period_id: period, amount_minor: Math.round(major * 100), currency: 'AED',
          funding_source: 'UNSPECIFIED', status: 'DRAFT', reason: reason,
        })});
        const b = await res.json().catch(function(){ return {}; });
        toast(res.ok && b.ok ? 'Pool saved (draft)' : (b.error || 'Could not save'));
      }catch(_){ toast('Couldn’t reach the service'); }
    };

    const runSim = $('admRunSim');
    if(runSim) runSim.onclick = async function(){
      const period = ($('admSimPeriod') && $('admSimPeriod').value || '').trim();
      const out = $('admSimOut');
      if(!period){ toast('Enter a period'); return; }
      if(out) out.textContent = 'Simulating…';
      try{
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
      }catch(_){ if(out) out.textContent = 'Couldn’t reach the service.'; }
    };

    const auditBtn = $('admAuditBtn');
    if(auditBtn) auditBtn.onclick = async function(){
      const out = $('admAuditOut');
      if(out) out.innerHTML = '<div class="sub">Loading…</div>';
      try{
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
      }catch(_){ if(out) out.textContent = 'Couldn’t reach the service.'; }
    };

    const chg = $('adminChangePwBtn');
    if(chg) chg.onclick = changeAdminPassword;
    try{ if(typeof renderDiagPanel === 'function') renderDiagPanel(); }catch(_){}
  }

  function openConsole(data){
    setStage('console');
    const who = $('consoleWho');
    if(who) who.textContent = whoLine(currentUser) + ' · every change is logged.';
    renderAdminOverview(data || {});
  }

  function setGateMode(mode){
    const confirmRow = $('adminPassConfirmRow');
    const btn = $('adminUnlockBtn');
    const title = $('adminGateTitle');
    const hint = $('adminGateHint');
    if(mode === 'setup'){
      if(confirmRow) confirmRow.style.display = 'block';
      if(btn) btn.textContent = 'Create password';
      if(title) title.textContent = 'Set your password';
      if(hint) hint.textContent = 'First time here. Choose a password for this console — at least 8 characters. You can change it later from inside.';
    } else {
      if(confirmRow) confirmRow.style.display = 'none';
      if(btn) btn.textContent = 'Unlock';
      if(title) title.textContent = 'Unlock';
      if(hint) hint.textContent = 'Same password you set for this console. Not your Naluno sign-in.';
    }
  }

  async function readJson(res){
    try{ return await res.json(); }catch(_){ return {}; }
  }
  async function workerHealthNote(){
    const bits = [];
    try{
      const h = await fetch(WORKER + '/health');
      const hb = await readJson(h);
      bits.push('health ' + (h.status) + ' ' + (hb.version || ''));
      if(hb.adminAuth) bits.push(String(hb.adminAuth));
    }catch(e){ bits.push('health unreachable'); }
    try{
      const f = await fetch(WORKER + '/v1/flags');
      const fb = await readJson(f);
      if(fb.degraded) bits.push('Firestore degraded');
    }catch(_){}
    return bits.filter(Boolean).join(' · ');
  }

  async function refreshGateState(){
    if(!currentUser) return;
    const uid = currentUser.uid;
    const hasLocal = !!localGet(uid);
    __needsSetup = !hasLocal;
    setGateMode(hasLocal ? 'locked' : 'setup');
    const ping = $('workerPing');
    if(ping) ping.textContent = 'Checking worker…';
    try{
      const idToken = await currentUser.getIdToken(true);
      const res = await fetch(WORKER + '/v1/admin/status', {
        headers: { 'Authorization': 'Bearer ' + idToken },
      });
      const b = await readJson(res);
      const note = await workerHealthNote();
      if(ping) ping.textContent = note || ('status ' + res.status);
      const err = b.error || b.code || ('HTTP ' + res.status);

      if(res.status === 404 || res.status === 403){
        __serverMode = 'denied';
        setMsg('adminGateMsg',
          'This Google account is not on the operator list. uid: ' + uid
          + ' — add it to ADMIN_UIDS on the economy worker, then reload. '
          + (hasLocal ? 'Unlock still works on this computer.' : 'You can still set a password for this computer; flags stay locked.'));
        return;
      }
      if(res.status === 401){
        __serverMode = 'unreachable';
        setMsg('adminGateMsg', 'Sign-in token was rejected (' + err + '). Sign out and sign in again.');
        return;
      }
      if(!res.ok){
        __serverMode = 'unreachable';
        setMsg('adminGateMsg',
          'Worker answered ' + res.status + ': ' + err
          + (note ? (' · ' + note) : '')
          + '. ' + (hasLocal ? 'Unlock with the password saved here anyway.' : 'You can still set a password for this computer.'));
        return;
      }
      __serverMode = 'password';
      if(b.needs_setup && !hasLocal){
        __needsSetup = true;
        setGateMode('setup');
        setMsg('adminGateMsg', '');
      } else if(b.needs_setup && hasLocal){
        __needsSetup = false;
        setGateMode('locked');
        setMsg('adminGateMsg', 'A password is saved here. The server has none yet — Unlock will try to create it.');
      } else {
        __needsSetup = !hasLocal;
        setGateMode(__needsSetup ? 'setup' : 'locked');
        setMsg('adminGateMsg', '');
      }
    }catch(e){
      __serverMode = 'unreachable';
      const note = await workerHealthNote();
      if($('workerPing')) $('workerPing').textContent = note || 'worker unreachable';
      setMsg('adminGateMsg', hasLocal
        ? ('Could not call /v1/admin/status (' + ((e && e.message) || 'network') + '). ' + note + '. Unlock with the password saved here.')
        : ('Could not call /v1/admin/status. ' + note + '. You can still set a password for this computer.'));
    }
  }

  async function adminUnlock(){
    const inp = $('adminPassInput');
    if(!inp || !currentUser) return;
    const typed = (inp.value || '').trim();
    if(!typed){ setMsg('adminGateMsg', 'Enter your password.'); return; }
    const uid = currentUser.uid;

    if(__needsSetup){
      const confirmEl = $('adminPassConfirm');
      const confirmVal = ((confirmEl && confirmEl.value) || '').trim();
      if(typed.length < 8){ setMsg('adminGateMsg', 'Use at least 8 characters.'); return; }
      if(typed !== confirmVal){ setMsg('adminGateMsg', 'The two passwords do not match.'); return; }
      setMsg('adminGateMsg', 'Saving…', true);
      try{ localSet(uid, await hashLocal(uid, typed)); }catch(_){}
      try{
        const idToken = await currentUser.getIdToken(true);
        const res = await fetch(WORKER + '/v1/admin/password', {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + idToken, 'Content-Type': 'application/json' },
          body: JSON.stringify({ next_password: typed }),
        });
        const b = await res.json().catch(function(){ return {}; });
        if(res.ok && b.ok){
          __serverMode = 'password';
        } else if(res.status === 404){
          __serverMode = 'denied';
        } else {
          __serverMode = 'unreachable';
        }
      }catch(_){
        __serverMode = 'unreachable';
      }
      __needsSetup = false;
      setGateMode('locked');
      if($('adminPassConfirm')) $('adminPassConfirm').value = '';
    } else {
      const okLocal = await localOk(uid, typed);
      if(!okLocal && localGet(uid)){
        setMsg('adminGateMsg', 'Password not accepted.');
        return;
      }
    }

    __adminPass = typed;
    setMsg('adminGateMsg', 'Checking…', true);
    try{
      const res = await adminFetch('overview');
      if(res.ok){
        __serverMode = 'password';
        try{ localSet(uid, await hashLocal(uid, typed)); }catch(_){}
        openConsole(await res.json());
        return;
      }
      if(res.status === 409 || res.status === 404 || res.status === 403){
        if(res.status === 404 || res.status === 403) __serverMode = 'denied';
        if(!localGet(uid)){
          try{ localSet(uid, await hashLocal(uid, typed)); }catch(_){}
        }
        openConsole({});
        return;
      }
      const b = await res.json().catch(function(){ return {}; });
      if(!localGet(uid) && !await localOk(uid, typed)){
        setMsg('adminGateMsg', b.code === 'no_password' ? 'Enter your password.' : (b.error || 'Password not accepted.'));
        __adminPass = '';
        return;
      }
      openConsole({});
    }catch(_){
      if(localGet(uid) || __needsSetup === false){
        __serverMode = 'unreachable';
        openConsole({});
        return;
      }
      setMsg('adminGateMsg', 'Couldn’t reach the service.');
      __adminPass = '';
    }
  }

  async function changeAdminPassword(){
    if(!currentUser) return;
    const cur = window.prompt('Current password:');
    if(cur === null) return;
    const next = window.prompt('New password (at least 8 characters):');
    if(next === null) return;
    const again = window.prompt('Type the new password again:');
    if(again === null) return;
    if((next || '').trim() !== (again || '').trim()){ toast('The two new passwords do not match'); return; }
    if((next || '').trim().length < 8){ toast('Use at least 8 characters'); return; }
    const uid = currentUser.uid;
    if(localGet(uid) && !(await localOk(uid, (cur||'').trim()))){
      toast('Current password is wrong');
      return;
    }
    try{ localSet(uid, await hashLocal(uid, (next||'').trim())); }catch(_){}
    __adminPass = (next||'').trim();
    try{
      const idToken = await currentUser.getIdToken(true);
      const res = await fetch(WORKER + '/v1/admin/password', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + idToken, 'Content-Type': 'application/json' },
        body: JSON.stringify({ current_password: (cur||'').trim(), next_password: (next||'').trim() }),
      });
      const b = await res.json().catch(function(){ return {}; });
      if(!res.ok || !b.ok){ toast('Saved on this phone. Server: ' + (b.error || 'not updated')); return; }
      toast('Password changed');
    }catch(_){ toast('Saved on this phone. Server could not be reached.'); }
  }
  try{ window.changeAdminPassword = changeAdminPassword; }catch(_){}

  async function signInHandle(){
    if(!initFirebase()){ setMsg('signMsg', 'Sign-in is not ready.'); return; }
    const raw = (($('adminHandle') && $('adminHandle').value) || '').trim();
    const password = ($('adminPassword') && $('adminPassword').value) || '';
    if(!password || password.length < 6){ setMsg('signMsg', 'Enter your password.'); return; }
    let email = '';
    if(looksLikeEmail(raw)) email = raw;
    else {
      const handle = normalizeHandle(raw);
      if(!handle || handle.length < 3){ setMsg('signMsg', 'Enter your handle or email.'); return; }
      email = handleToEmail(handle);
    }
    setMsg('signMsg', 'Signing in…', true);
    try{
      await fbAuth.signInWithEmailAndPassword(email, password);
    }catch(e){
      const bad = e && (e.code === 'auth/user-not-found' || e.code === 'auth/wrong-password' || e.code === 'auth/invalid-credential');
      setMsg('signMsg', bad ? 'Not recognized.' : ((e && (e.message || e.code)) || 'Could not sign in.'));
    }
  }

  async function signInGoogle(){
    if(!initFirebase()){ setMsg('signMsg', 'Sign-in is not ready.'); return; }
    setMsg('signMsg', 'Opening Google…', true);
    const provider = new firebase.auth.GoogleAuthProvider();
    try{
      await fbAuth.signInWithPopup(provider);
    }catch(e){
      const popupCant = e && (e.code === 'auth/popup-blocked'
        || e.code === 'auth/operation-not-supported-in-this-environment');
      if(popupCant){
        setMsg('signMsg', 'Popup blocked — switching to redirect…', true);
        try{ await fbAuth.signInWithRedirect(provider); }
        catch(e2){ setMsg('signMsg', (e2 && e2.message) || 'Google sign-in failed.'); }
        return;
      }
      if(e && (e.code === 'auth/popup-closed-by-user' || e.code === 'auth/cancelled-popup-request')){
        setMsg('signMsg', 'Sign-in window closed — tap Google again.');
        return;
      }
      setMsg('signMsg', (e && (e.message || e.code)) || 'Google sign-in failed.');
    }
  }

  function signOut(){
    __adminPass = '';
    currentUser = null;
    setStage('sign');
    setMsg('signMsg', '');
    setMsg('adminGateMsg', '');
    try{ document.title = 'Naluno'; }catch(_){}
    if(fbAuth) fbAuth.signOut().catch(function(){});
  }

  function lockConsole(){
    __adminPass = '';
    const body = $('adminBody');
    if(body) body.innerHTML = '';
    if(!currentUser){
      setStage('sign');
      setMsg('adminGateMsg', '');
      return;
    }
    setStage('gate');
    const who = $('gateWho');
    if(who) who.textContent = whoLine(currentUser);
    const inp = $('adminPassInput'); if(inp) inp.value = '';
    setMsg('adminGateMsg', '');
    refreshGateState();
  }

  function onUser(user){
    currentUser = user || null;
    if(!user){
      setStage('sign');
      return;
    }
    /* This is the line that was failing you: Firebase succeeded and the
       gate never took over the screen. setStage writes display + class. */
    setStage('gate');
    const who = $('gateWho');
    if(who) who.textContent = whoLine(user);
    setMsg('signMsg', '');
    refreshGateState();
    try{ if(typeof renderDiagPanel === 'function') renderDiagPanel(); }catch(_){}
  }

  function bind(){
    const si = $('adminSignInBtn'); if(si) si.onclick = signInHandle;
    const gg = $('adminGoogleBtn'); if(gg) gg.onclick = signInGoogle;
    const un = $('adminUnlockBtn'); if(un) un.onclick = adminUnlock;
    const so = $('adminSignOutBtn'); if(so) so.onclick = signOut;
    const so2 = $('adminSignOutBtn2'); if(so2) so2.onclick = signOut;
    const lk = $('adminLockBtn'); if(lk) lk.onclick = lockConsole;
    ['adminPassInput','adminPassConfirm'].forEach(function(id){
      const el = $(id);
      if(el) el.addEventListener('keydown', function(e){ if(e.key === 'Enter') adminUnlock(); });
    });
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
      fbAuth.getRedirectResult().then(function(){}).catch(function(e){
        if(e && e.code !== 'auth/popup-closed-by-user'){
          setMsg('signMsg', (e && e.message) || 'Google redirect did not finish.');
        }
      }).finally(function(){
        fbAuth.onAuthStateChanged(onUser);
      });
    });
  }
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
