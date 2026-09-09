/* ============================================================
   MODULE: js/admin-console.js
   Operator Control Centre at /admin/. Not loaded by the member app.

   Two gates, in this order:
     1. Firebase sign-in (same handle / Google as the app)
     2. Console password — hashed on the signed-in Naluno account, so it
        unlocks on every device, not just the phone that set it.
        The economy worker is still used for flags. It is not required
        to set or check this password (its Firestore access is degraded).

   The window MUST change after (1) and after (2). Every failure has a
   visible message. Nothing stays on Sign in with no explanation.
   ============================================================ */
(function(){
  const $ = function(id){ return document.getElementById(id); };
  const WORKER = 'https://naluno-economy.naluno.workers.dev';
  const HANDLE_DOMAIN = 'users.getnaluno.com';
  const LOCAL_KEY = 'nalunoAdminLocal.';
  /* Operator lock that does not depend on the degraded worker. Add a uid
     here when a new operator is trusted. Email match is a convenience for
     the Google account already running this desk. */
  const OPERATOR_UIDS = {
    'ibMOMY6Q3sVTCxIrwO2FGk43zw93': true
  };
  const OPERATOR_EMAILS = {
    'magjoed@gmail.com': true
  };
  let fbAuth = null;
  let fbDbAdmin = null;
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
      try{ fbDbAdmin = firebase.firestore(); }catch(_){ fbDbAdmin = null; }
      return true;
    }catch(e){
      console.error('[naluno-admin] firebase init', e);
      return false;
    }
  }
  function ensureConfig(done){
    if(firebaseReady()){ if(done) done(true); return; }
    const s = document.createElement('script');
    s.src = '/firebase-config.js?v=20260908c';
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

  function isOperator(user){
    if(!user) return false;
    if(OPERATOR_UIDS[user.uid]) return true;
    const mail = String(user.email || '').trim().toLowerCase();
    return !!(mail && OPERATOR_EMAILS[mail]);
  }

  function adminDb(){
    if(fbDbAdmin) return fbDbAdmin;
    try{
      if(typeof firebase !== 'undefined' && firebase.firestore){
        fbDbAdmin = firebase.firestore();
        return fbDbAdmin;
      }
    }catch(_){}
    return null;
  }

  async function cloudGetHash(uid){
    const db = adminDb();
    if(!db || !uid) return '';
    const paths = [
      function(){ return db.collection('adminConsole').doc(uid).get(); },
      function(){ return db.collection('users').doc(uid).collection('consoleGate').doc('main').get(); },
      function(){ return db.collection('users').doc(uid).collection('wirelineHidden').doc('__nalunoConsoleGate').get(); },
      function(){ return db.collection('users').doc(uid).get(); }
    ];
    for(let i = 0; i < paths.length; i++){
      try{
        const snap = await paths[i]();
        if(!snap || !snap.exists) continue;
        const data = snap.data() || {};
        const hash = data.hash || (data._consoleGate && data._consoleGate.hash) || '';
        if(hash) return String(hash);
      }catch(_){}
    }
    return '';
  }

  async function cloudSetHash(uid, hash){
    const db = adminDb();
    if(!db || !uid || !hash) return { ok:false, where:'no-db' };
    const payload = { hash: hash, v: 1, at: Date.now(), kind: 'console-gate' };
    try{
      await db.collection('adminConsole').doc(uid).set(payload);
      return { ok:true, where:'adminConsole' };
    }catch(_){}
    try{
      await db.collection('users').doc(uid).collection('consoleGate').doc('main').set(payload);
      return { ok:true, where:'consoleGate' };
    }catch(_){}
    try{
      await db.collection('users').doc(uid).collection('wirelineHidden').doc('__nalunoConsoleGate').set(payload);
      return { ok:true, where:'account' };
    }catch(_){}
    try{
      await db.collection('users').doc(uid).set({ _consoleGate: payload }, { merge: true });
      return { ok:true, where:'profile' };
    }catch(e){
      return { ok:false, where: (e && (e.code || e.message)) || 'write-denied' };
    }
  }

  async function cloudOk(uid, pass){
    const stored = await cloudGetHash(uid);
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

  /* ---------------- Tabs (spec §30) ----------------
     Each tab fetches only its own data, on first open, and caches it. The
     console used to render everything into one block on unlock, which meant
     one slow or failing query held up the whole screen. */

  let __tabCache = {};
  let __activeTab = 'broadcast';

  function money(minor, ccy){
    const v = (Number(minor) || 0) / 100;
    return v.toFixed(2) + (ccy ? ' ' + ccy : '');
  }
  function kpi(label, value){
    return '<div class="kpi"><b>' + escapeHtml(String(value)) + '</b><span>' + escapeHtml(label) + '</span></div>';
  }
  function kpis(pairs){
    return '<div class="kpi-row">' + pairs.map(function(p){ return kpi(p[0], p[1]); }).join('') + '</div>';
  }
  function table(headers, rows){
    if(!rows.length) return '<p class="sub">Nothing recorded yet.</p>';
    return '<table class="tbl"><thead><tr>'
      + headers.map(function(h){ return '<th>' + escapeHtml(h) + '</th>'; }).join('')
      + '</tr></thead><tbody>'
      + rows.map(function(r){
          return '<tr>' + r.map(function(c){ return '<td>' + escapeHtml(String(c == null ? '' : c)) + '</td>'; }).join('') + '</tr>';
        }).join('')
      + '</tbody></table>';
  }
  function card(title, inner){
    return '<div class="card"><div class="who">' + escapeHtml(title) + '</div>' + inner + '</div>';
  }
  /* An explicit, visible note when a system is switched off. A tab that shows
     zeros for something that was never activated reads as "nobody used it",
     which is a different and misleading claim. */
  function inactiveNote(text){
    return '<div class="inactive-note">' + escapeHtml(text) + '</div>';
  }

  async function loadTab(tab, force){
    const el = $('adminBody');
    if(!el) return;
    if(!force && __tabCache[tab]){ renderTab(tab, __tabCache[tab]); return; }
    el.innerHTML = '<p class="sub">Loading\u2026</p>';
    if(tab === 'system'){
      try{
        const res = await adminFetch('overview');
        if(!res.ok) throw new Error('overview ' + res.status);
        const d = await res.json();
        __tabCache[tab] = d; renderTab(tab, d);
      }catch(_){ el.innerHTML = '<p class="sub">Couldn\u2019t load this section.</p>'; }
      return;
    }
    const route = { broadcast:'broadcasts', contribution:'contribution', trust:'trust',
                    value:'value', support:'support', rewards:'rewards', financial:'financial' }[tab];
    try{
      const res = await adminFetch(route);
      if(res.status === 404){
        el.innerHTML = '<p class="sub">This section needs a newer economy worker. Deploy it, then reload.</p>';
        return;
      }
      if(!res.ok) throw new Error(route + ' ' + res.status);
      const d = await res.json();
      __tabCache[tab] = d; renderTab(tab, d);
    }catch(_){
      el.innerHTML = '<p class="sub">Couldn\u2019t load this section.</p>';
    }
  }

  function renderTab(tab, d){
    const el = $('adminBody');
    if(!el) return;
    d = d || {};
    if(tab === 'system'){ renderAdminOverview(d); return; }

    if(tab === 'broadcast'){
      el.innerHTML =
        kpis([['Broadcasts', d.total || 0], ['Total views', d.total_views || 0],
              ['Creators', (d.creators || []).length], ['Deleted', d.deleted || 0]])
        + card('Creators by views', table(['Creator', 'Broadcasts', 'Views'],
            (d.creators || []).map(function(c){ return [String(c.creator_uid).slice(0,12) + '\u2026', c.broadcasts, c.views]; })))
        + card('Recent Broadcasts', table(['Title', 'Creator', 'Views', 'Live'],
            (d.recent || []).map(function(b){
              return [b.title, String(b.creator_uid).slice(0,10) + '\u2026', b.views, b.live ? 'LIVE' : ''];
            })))
        + card('Reports & moderation', '<p class="sub">No reporting queue is wired yet. Content removal currently happens in the app by the author or the Broadcast creator, and each removal is recorded in the audit log.</p>');
      return;
    }

    if(tab === 'contribution'){
      const r = d.rules || {};
      el.innerHTML =
        kpis([['Counted', d.counted || 0], ['Points', d.total_points || 0],
              ['Eligible', d.total_eligible || 0], ['Pending review', d.pending_review || 0],
              ['Reversed', d.reversed || 0]])
        + card('Rules version ' + (d.rules_version || '\u2014'),
            table(['Event', 'Base points', 'Daily cap'],
              Object.keys((r.events) || {}).map(function(k){
                return [k, r.events[k].base, r.events[k].dailyCap || '\u2014'];
              })))
        + card('Multipliers',
            '<p class="sub">Low-effort \u00d7' + ((r.quality && r.quality.lowEffortMultiplier) || '\u2014')
            + ' \u00b7 substantive \u00d7' + ((r.quality && r.quality.substantiveMultiplier) || '\u2014')
            + ' \u00b7 creator replied \u00d7' + ((r.quality && r.quality.creatorRepliedBonus) || '\u2014')
            + ' \u00b7 sparked discussion \u00d7' + ((r.quality && r.quality.sparkedDiscussionBonus) || '\u2014')
            + '. Repeat interaction with the same Broadcast decays to \u00d7'
            + ((r.diminishing && r.diminishing.perBroadcastDecay) || '\u2014') + ' each time.</p>')
        + card('By event type', table(['Event', 'Count', 'Points'],
            (d.by_type || []).map(function(t){ return [t.event_type, t.count, t.points]; })))
        + card('Recent ledger', table(['Event', 'Points', 'Eligible', 'Tier', 'Status'],
            (d.recent || []).map(function(x){
              return [x.event_type, x.points, x.eligible_points, x.trust_tier, x.status];
            })));
      return;
    }

    if(tab === 'trust'){
      const t = d.tiers || {};
      el.innerHTML =
        kpis([['Profiles', d.profiles || 0], ['High', t.HIGH || 0], ['Medium', t.MEDIUM || 0],
              ['Low', t.LOW || 0], ['New', t.NEW || 0]])
        + '<p class="sub">Trust is never shown to the person it describes, and the formula is not exposed (§13, §37). Points are still earned at every tier \u2014 the tier only limits what counts as <em>eligible</em>.</p>'
        + card('Flagged accounts', table(['User', 'Tier', 'Risk flags', 'Removed', 'Restricted'],
            (d.flagged || []).map(function(f){
              return [String(f.user_id).slice(0,14) + '\u2026', f.tier, f.riskFlags, f.removedContentCount, f.restricted ? 'YES' : ''];
            })));
      return;
    }

    if(tab === 'value'){
      el.innerHTML =
        kpis([['Broadcasts with value', d.broadcasts_with_value || 0], ['Total value', d.total_value || 0]])
        + '<p class="sub">Community Value is an analytical measurement of contribution around a Broadcast. It is <strong>not</strong> a currency amount and must never be presented as one (§15, §16).</p>'
        + card('Highest value Broadcasts', table(['Broadcast', 'Value', 'Events'],
            (d.top || []).map(function(v){ return [String(v.broadcast_id).slice(0,16) + '\u2026', v.value, v.events]; })));
      return;
    }

    if(tab === 'support'){
      const bs = d.by_status || {};
      el.innerHTML =
        (d.inactive ? inactiveNote('Creator Support is switched off. No payment provider is connected and no money can move. These figures are the ledger structure only.') : '')
        + kpis([['Transactions', d.transactions || 0], ['Pending', bs.PENDING || 0],
                ['Succeeded', bs.SUCCEEDED || 0], ['Failed', bs.FAILED || 0],
                ['Refunded', bs.REFUNDED || 0], ['Disputed', bs.DISPUTED || 0]])
        + card('Recent transactions', table(['Supporter', 'Creator', 'Amount', 'Status'],
            (d.recent || []).map(function(t){
              return [String(t.supporter_user_id||'').slice(0,10)+'\u2026', String(t.creator_user_id||'').slice(0,10)+'\u2026',
                      money(t.amount_minor, t.currency), t.status];
            })));
      return;
    }

    if(tab === 'rewards'){
      el.innerHTML =
        (d.inactive ? inactiveNote('Community Rewards is switched off. Pools can be drafted and simulations run, but no allocation is ever paid out while this is off.') : '')
        + kpis([['Pools', (d.pools || []).length], ['Allocations', d.allocations || 0]])
        + card('Reward pools', table(['Period', 'Amount', 'Status', 'Funding'],
            (d.pools || []).map(function(p){ return [p.period_id, money(p.amount_minor, p.currency), p.status, p.funding_source]; })))
        + card('Simulation (§29 \u2014 nothing moves)',
            '<input id="admSimPeriod" placeholder="Period e.g. 2026-09" />'
          + '<input id="admSimPool" placeholder="Pool amount e.g. 10000" inputmode="decimal" />'
          + '<div class="row"><button type="button" class="ghost" id="admSavePool">Save pool</button>'
          + '<button type="button" class="primary" id="admRunSim">Run simulation</button></div>'
          + '<div id="admSimOut" class="sub"></div>');
      wireRewardControls();
      return;
    }

    if(tab === 'financial'){
      const cs = d.creator_support || {}, ce = d.creator_earnings || {},
            cr = d.community_rewards || {}, rp = d.reward_pools || {};
      el.innerHTML =
        (d.no_money_has_moved ? inactiveNote('Real payouts are disabled. No money has moved through any of these ledgers. They are shown so the structure is auditable before it is ever activated.') : '')
        + '<p class="sub">Each ledger is reported separately and never combined into a single balance (§24, §25, §52).</p>'
        + card('Creator Support', kpis([
            ['Transactions', cs.transactions || 0], ['Succeeded', cs.succeeded || 0],
            ['Gross', money(cs.gross_minor, d.currency)], ['Fees', money(cs.fees_minor, d.currency)],
            ['Net to creators', money(cs.net_minor, d.currency)]]))
        + card('Creator earnings', kpis([['Entries', ce.entries || 0], ['Total', money(ce.total_minor, d.currency)]]))
        + card('Community rewards', kpis([['Allocations', cr.allocations || 0], ['Total', money(cr.total_minor, d.currency)]]))
        + card('Reward pools', kpis([['Pools', rp.count || 0], ['Committed', money(rp.committed_minor, d.currency)]]))
        + card('Platform revenue, refunds, chargebacks',
            '<p class="sub">Not yet recorded. These require a payment provider, which is deliberately not connected until payment, KYC/AML and tax requirements are settled (§27, §28, §41).</p>');
      return;
    }
  }

  /* Shared by the System overview and the Rewards tab, which both render
     the pool + simulation controls. Extracted so the two cannot drift. */
  function wireRewardControls(){
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

  }

  function wireAdminTabs(){
    const nav = $('adminTabs');
    if(!nav) return;
    nav.querySelectorAll('.atab').forEach(function(btn){
      btn.onclick = function(){
        const tab = btn.getAttribute('data-tab');
        if(!tab || tab === __activeTab) return;
        __activeTab = tab;
        nav.querySelectorAll('.atab').forEach(function(b){ b.classList.toggle('on', b === btn); });
        loadTab(tab, false);
      };
    });
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
      ? adminCard('Flags', '<div class="sub" style="margin:0;">This account can open the desk. The economy worker has not accepted it as an operator for feature flags yet. Diagnostics still work.</div>')
      : (__serverMode === 'unreachable')
        ? adminCard('Flags', '<div class="sub" style="margin:0;">Economy worker Firestore is degraded, so flags and the ledger are empty. The console password lives on the account and works on every device.</div>')
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
    /* Spec §30: the console opens into tabs rather than rendering every
       section into one block. The overview payload we already have is seeded
       into the System tab so it is not fetched twice, and each other tab
       loads its own data the first time it is opened — so one slow or failing
       query can no longer hold up the whole screen. */
    __tabCache = { system: data || {} };
    __activeTab = 'broadcast';
    wireAdminTabs();
    loadTab('broadcast', false);
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
      if(hint) hint.textContent = 'First time on this account. Choose a password for the Control Centre — at least 8 characters. It is saved to this Naluno account, so any device you sign in on can unlock with it.';
    } else {
      if(confirmRow) confirmRow.style.display = 'none';
      if(btn) btn.textContent = 'Unlock';
      if(title) title.textContent = 'Unlock';
      if(hint) hint.textContent = 'Same password you set for this console. It follows the account, not the phone.';
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
    const ping = $('workerPing');
    if(ping) ping.textContent = 'Checking account…';

    if(!isOperator(currentUser)){
      __serverMode = 'denied';
      __needsSetup = false;
      setGateMode('locked');
      const note = await workerHealthNote();
      if(ping) ping.textContent = note;
      setMsg('adminGateMsg',
        'This account is not an operator. uid: ' + uid
        + (currentUser.email ? (' · ' + currentUser.email) : '')
        + '. Sign in with the Google account that runs this desk.');
      return;
    }

    let cloudHash = '';
    try{ cloudHash = await cloudGetHash(uid); }catch(_){}
    const hasCloud = !!cloudHash;
    const hasLocal = !!localGet(uid);
    __needsSetup = !hasCloud && !hasLocal;
    setGateMode(__needsSetup ? 'setup' : 'locked');

    const note = await workerHealthNote();
    if(ping) ping.textContent = (hasCloud ? 'password on account · ' : '') + note;

    try{
      const idToken = await currentUser.getIdToken(true);
      const res = await fetch(WORKER + '/v1/admin/status', {
        headers: { 'Authorization': 'Bearer ' + idToken },
      });
      const b = await readJson(res);
      const err = b.error || b.code || ('HTTP ' + res.status);

      if(res.status === 404 || res.status === 403){
        __serverMode = 'denied';
      } else if(res.status === 401){
        __serverMode = 'unreachable';
      } else if(!res.ok){
        __serverMode = 'unreachable';
      } else {
        __serverMode = 'password';
      }

      if(__needsSetup){
        setMsg('adminGateMsg', hasCloud ? '' : '');
        return;
      }
      if(hasCloud){
        setMsg('adminGateMsg',
          res.ok ? '' : ('Flags service: ' + err + '. Unlock still uses the account password.'),
          !!res.ok);
        return;
      }
      setMsg('adminGateMsg',
        'No account password yet — this phone has a local copy. Unlock, then it will be saved to the account.');
    }catch(e){
      if(__serverMode === 'unknown') __serverMode = 'unreachable';
      if(ping) ping.textContent = (hasCloud ? 'password on account · ' : '') + (await workerHealthNote());
      if(!__needsSetup){
        setMsg('adminGateMsg', hasCloud
          ? 'Unlock with the account password. Flags will fill in when the worker is healthy.'
          : 'Unlock with the password on this phone — it will then be saved to the account.');
      }
    }
  }

  async function adminUnlock(){
    const inp = $('adminPassInput');
    if(!inp || !currentUser) return;
    if(!isOperator(currentUser)){
      setMsg('adminGateMsg', 'This account is not an operator.');
      return;
    }
    const typed = (inp.value || '').trim();
    if(!typed){ setMsg('adminGateMsg', 'Enter your password.'); return; }
    const uid = currentUser.uid;

    if(__needsSetup){
      const confirmEl = $('adminPassConfirm');
      const confirmVal = ((confirmEl && confirmEl.value) || '').trim();
      if(typed.length < 8){ setMsg('adminGateMsg', 'Use at least 8 characters.'); return; }
      if(typed !== confirmVal){ setMsg('adminGateMsg', 'The two passwords do not match.'); return; }
      setMsg('adminGateMsg', 'Saving to your account…', true);
      const hash = await hashLocal(uid, typed);
      try{ localSet(uid, hash); }catch(_){}
      const saved = await cloudSetHash(uid, hash);
      if(!saved.ok){
        setMsg('adminGateMsg', 'Could not save to your account (' + saved.where + '). Publish firestore.rules from this zip and try again.');
        return;
      }
      try{
        const idToken = await currentUser.getIdToken(true);
        await fetch(WORKER + '/v1/admin/password', {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + idToken, 'Content-Type': 'application/json' },
          body: JSON.stringify({ next_password: typed }),
        });
      }catch(_){}
      __needsSetup = false;
      setGateMode('locked');
      if($('adminPassConfirm')) $('adminPassConfirm').value = '';
    } else {
      const storedCloud = await cloudGetHash(uid);
      const typedHash = await hashLocal(uid, typed);
      const okCloud = !!(storedCloud && storedCloud === typedHash);
      const okLocal = await localOk(uid, typed);
      if(storedCloud){
        if(!okCloud){
          setMsg('adminGateMsg', 'Password not accepted.');
          return;
        }
        if(!okLocal){ try{ localSet(uid, typedHash); }catch(_){} }
      } else {
        if(!okLocal){
          setMsg('adminGateMsg', 'Password not accepted.');
          return;
        }
        const saved = await cloudSetHash(uid, typedHash);
        if(!saved.ok){
          setMsg('adminGateMsg', 'Password is right on this phone but could not be copied to the account (' + saved.where + '). Publish firestore.rules from this zip and try again.');
          return;
        }
      }
    }

    __adminPass = typed;
    setMsg('adminGateMsg', 'Opening…', true);
    try{
      const res = await adminFetch('overview');
      if(res.ok){
        __serverMode = 'password';
        try{ localSet(uid, await hashLocal(uid, typed)); }catch(_){}
        openConsole(await res.json());
        return;
      }
      if(res.status === 404 || res.status === 403) __serverMode = 'denied';
      else __serverMode = 'unreachable';
      openConsole({});
    }catch(_){
      __serverMode = 'unreachable';
      openConsole({});
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
    const curTrim = (cur || '').trim();
    const nextTrim = (next || '').trim();
    const okCloud = await cloudOk(uid, curTrim);
    const okLocal = await localOk(uid, curTrim);
    const hasAny = !!(await cloudGetHash(uid) || localGet(uid));
    if(hasAny && !okCloud && !okLocal){
      toast('Current password is wrong');
      return;
    }
    const hash = await hashLocal(uid, nextTrim);
    try{ localSet(uid, hash); }catch(_){}
    const saved = await cloudSetHash(uid, hash);
    __adminPass = nextTrim;
    try{
      const idToken = await currentUser.getIdToken(true);
      await fetch(WORKER + '/v1/admin/password', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + idToken, 'Content-Type': 'application/json' },
        body: JSON.stringify({ current_password: curTrim, next_password: nextTrim }),
      });
    }catch(_){}
    toast(saved.ok ? 'Password changed on the account' : ('Phone updated. Account: ' + saved.where));
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
