/* ============================================================
   MODULE: js/economy-ui.js
   The visible surface of the Community Economy: the person's own
   contribution dashboard (§36), the Creator Support control (§20), and the
   hidden Admin Console (§30–§33).

   Everything shown here is READ from the server. Nothing in this file
   computes a point, a balance or an eligibility decision — it renders what
   the naluno-economy Worker returns, and if the Worker is unreachable it
   renders an honest "unavailable" rather than a zero that looks like fact.
   ============================================================ */

const ECONOMY_UI_WORKER = 'https://naluno-economy.naluno.workers.dev';

/* ---------------- My Contribution (§36) ---------------- */

function openContributionPanel(){
  const panel = $('contributionPanel');
  if(!panel) return;
  panel.classList.add('active');
  renderContributionPanel();
}
function closeContributionPanel(){
  const panel = $('contributionPanel');
  if(panel) panel.classList.remove('active');
}

async function renderContributionPanel(){
  const el = $('contributionBody');
  if(!el) return;
  el.innerHTML = '<div class="lobby-sub" style="text-align:left;max-width:none;">Loading…</div>';
  const me = (typeof fetchMyContribution === 'function') ? await fetchMyContribution() : null;
  if(!me || !me.ok){
    // Honest failure. A zero here would read as "you have contributed
    // nothing", which is a different and much worse claim than "we could
    // not load this".
    el.innerHTML = '<div class="lobby-sub" style="text-align:left;max-width:none;">Couldn’t load your contribution just now. Nothing has been lost — try again in a moment.</div>';
    return;
  }
  const trustLabel = { HIGH:'High', MEDIUM:'Building', LOW:'Limited', NEW:'New account' }[me.contribution_trust] || '—';
  el.innerHTML =
    '<div class="bspace-card" style="margin-bottom:10px;">'
    + '<div class="who">Contribution Points</div>'
    + '<div style="font-family:var(--font-futuristic);font-size:26px;color:var(--mint);">' + escapeHtml(String(me.contribution_points)) + '</div>'
    + '<div class="lobby-sub" style="text-align:left;max-width:none;font-size:11.5px;margin-top:4px;">A measure of what you have added — not money, and not a promise of money.</div>'
    + '</div>'
    + '<div class="bspace-card" style="margin-bottom:10px;">'
    + '<div class="who">Eligible Contribution</div>'
    + '<div style="font-family:var(--font-futuristic);font-size:22px;">' + escapeHtml(String(me.eligible_contribution)) + '</div>'
    + '<div class="lobby-sub" style="text-align:left;max-width:none;font-size:11.5px;margin-top:4px;">The part that would count toward any future community rewards.</div>'
    + '</div>'
    + '<div class="bspace-card">'
    + '<div class="who">Contribution Trust</div>'
    + '<div style="font-family:var(--font-futuristic);font-size:18px;">' + escapeHtml(trustLabel) + '</div>'
    + '<div class="lobby-sub" style="text-align:left;max-width:none;font-size:11.5px;margin-top:4px;">Grows as your account establishes a normal, genuine history.</div>'
    + '</div>'
    + '<div class="lobby-sub" style="text-align:left;max-width:none;margin-top:14px;font-size:11.5px;">'
    + 'Community rewards are not active. Nothing here is currency, and no payment is owed to or by anyone.'
    + '</div>';
}

/* ---------------- Creator Support (§19–§22, §40) ----------------
   Rendered ONLY when the server-side flag says so, so an unfinished
   monetary feature can never appear early. Voluntary and non-aggressive by
   design (§22, §39): no pressure, no gating of participation, and a person
   can use every part of Naluno without ever paying anyone. */

function nalunoSupportButtonHtml(){
  if(typeof nalunoEconomyFlag !== 'function' || !nalunoEconomyFlag('creator_support_enabled')) return '';
  return '<button type="button" id="bspaceSupportBtn" class="bspace-mini" style="margin-top:10px;">Support creator</button>';
}

async function openSupportSheet(creatorUid, creatorName, broadcastId){
  if(typeof nalunoEconomyFlag !== 'function' || !nalunoEconomyFlag('creator_support_enabled')){
    toast('Creator Support isn’t available yet');
    return;
  }
  if(!currentUser){ toast('Sign in first'); return; }
  if(creatorUid === currentUser.uid){ toast('You can’t support yourself'); return; }
  const amounts = [500, 1000, 2500]; // integer minor units (§43) — never floats
  const pick = window.prompt(
    'Support ' + (creatorName || 'this creator') + '\n\n'
    + 'This is voluntary and separate from anything you earn.\n'
    + 'Enter an amount: 5, 10 or 25', '10');
  if(pick === null) return;
  const major = Number(String(pick).replace(/[^0-9.]/g, ''));
  if(!(major > 0)){ toast('Enter a valid amount'); return; }
  const amountMinor = Math.round(major * 100);
  try{
    const idToken = await currentUser.getIdToken(false);
    const res = await fetch(ECONOMY_UI_WORKER + '/v1/support/intent', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + idToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        creator_user_id: creatorUid,
        broadcast_id: broadcastId || '',
        amount_minor: amountMinor,
        currency: 'AED',
        // §44: one key per attempt, so a retry can never charge twice.
        idempotency_key: 'sup_' + (crypto.randomUUID ? crypto.randomUUID() : (Date.now() + '' + Math.random())),
      }),
    });
    const body = await res.json().catch(()=>({}));
    if(!res.ok || !body.ok){
      toast(body.error || 'Support isn’t available yet');
      return;
    }
    // §21: the client NEVER treats this as paid. There is no provider wired,
    // and even when there is, only a verified webhook may mark it succeeded.
    toast('Recorded — no payment was taken. Payments aren’t live yet.');
  }catch(_){
    toast('Couldn’t reach the service — nothing was charged');
  }
}

/* ---------------- Admin Console (§30–§33) ----------------
   The dot below Sign out needs 6 taps. That is deliberately NOT the security
   boundary — the real gates are the server-side allowlist, the passphrase,
   and Firestore rules that refuse every client write regardless. This just
   keeps an internal tool out of the way. */

let __adminTaps = 0;
let __adminTapTimer = null;
let __adminPass = '';

(function wireAdminDot(){
  function bind(){
    const dot = $('adminDot');
    if(!dot) return;
    dot.addEventListener('click', function(){
      __adminTaps++;
      clearTimeout(__adminTapTimer);
      // Taps must be deliberate and consecutive — the count resets if they
      // trail off, so a stray tap never leaves it half-armed.
      __adminTapTimer = setTimeout(function(){ __adminTaps = 0; }, 1800);
      if(__adminTaps >= 6){
        __adminTaps = 0;
        clearTimeout(__adminTapTimer);
        openAdminPanel();
      }
    });
    const close = $('adminCloseBtn');
    if(close) close.onclick = closeAdminPanel;
    const unlock = $('adminUnlockBtn');
    if(unlock) unlock.onclick = adminUnlock;
    const cc = $('contributionCloseBtn');
    if(cc) cc.onclick = closeContributionPanel;
    const openBtn = $('myContributionBtn');
    if(openBtn) openBtn.onclick = openContributionPanel;
  }
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind);
  else bind();
})();

function openAdminPanel(){
  const p = $('adminPanel');
  if(!p) return;
  p.classList.add('active');
  // Always re-lock on open. The passphrase is held only in memory for the
  // life of the panel and is never persisted anywhere.
  __adminPass = '';
  const gate = $('adminGate'), body = $('adminBody');
  if(gate) gate.style.display = 'block';
  if(body){ body.style.display = 'none'; body.innerHTML = ''; }
  const msg = $('adminGateMsg'); if(msg) msg.textContent = '';
  const inp = $('adminPassInput'); if(inp) inp.value = '';
  try{ if(typeof renderDiagPanel === 'function') renderDiagPanel(); }catch(_){}
}
function closeAdminPanel(){
  const p = $('adminPanel');
  if(p) p.classList.remove('active');
  __adminPass = '';
}

async function adminFetch(path, opts){
  const idToken = await currentUser.getIdToken(false);
  return fetch(ECONOMY_UI_WORKER + '/v1/admin/' + path, Object.assign({
    headers: {
      'Authorization': 'Bearer ' + idToken,
      'X-Naluno-Admin': __adminPass,
      'Content-Type': 'application/json',
    },
  }, opts || {}));
}

async function adminUnlock(){
  const inp = $('adminPassInput');
  const msg = $('adminGateMsg');
  if(!inp || !currentUser) return;
  __adminPass = inp.value || '';
  if(msg) msg.textContent = 'Checking…';
  try{
    const res = await adminFetch('overview');
    if(res.status === 404){
      // The server returns 404 for a non-allowlisted account on purpose, so
      // the console's existence isn't confirmed to the wrong person. Mirror
      // that here rather than saying "you are not an admin".
      if(msg) msg.textContent = 'Not available.';
      __adminPass = '';
      return;
    }
    if(!res.ok){
      if(msg) msg.textContent = 'Passphrase not accepted.';
      __adminPass = '';
      return;
    }
    const data = await res.json();
    const gate = $('adminGate'); if(gate) gate.style.display = 'none';
    const body = $('adminBody'); if(body) body.style.display = 'block';
    renderAdminOverview(data);
  }catch(_){
    if(msg) msg.textContent = 'Couldn’t reach the service.';
    __adminPass = '';
  }
}

function adminCard(title, inner){
  return '<div class="bspace-card" style="margin-bottom:10px;"><div class="who">' + escapeHtml(title) + '</div>' + inner + '</div>';
}

function renderAdminOverview(data){
  const el = $('adminBody');
  if(!el) return;
  const f = data.flags || {};
  const flagRows = Object.keys(f).map(function(k){
    const on = !!f[k];
    const locked = (k === 'real_payouts_enabled');
    return '<div style="display:flex;align-items:center;gap:8px;padding:5px 0;">'
      + '<span style="flex:1;font-family:var(--font-mono);font-size:11.5px;">' + escapeHtml(k) + '</span>'
      + '<span style="font-family:var(--font-mono);font-size:11px;color:' + (on ? 'var(--mint)' : 'var(--text-dim)') + ';">' + (on ? 'ON' : 'OFF') + '</span>'
      + (locked
          ? '<span class="lobby-sub" style="font-size:10px;max-width:none;">sign-off required</span>'
          : '<button type="button" class="bspace-mini admin-flag" data-flag="' + escapeHtml(k) + '" data-next="' + (on ? '0' : '1') + '">' + (on ? 'Turn off' : 'Turn on') + '</button>')
      + '</div>';
  }).join('');

  el.innerHTML =
    adminCard('System', '<div class="lobby-sub" style="text-align:left;max-width:none;font-size:11.5px;">'
      + 'Rules version <strong>' + escapeHtml(String(data.rules_version || '—')) + '</strong><br>'
      + 'Ledger rows sampled: ' + escapeHtml(String(data.ledger_rows_sampled || 0)) + '<br>'
      + 'Counted: ' + escapeHtml(String(data.counted || 0)) + ' · Pending review: ' + escapeHtml(String(data.pending_review || 0)) + '<br>'
      + 'Points (sampled): ' + escapeHtml(String(data.total_points_sampled || 0))
      + ' · Eligible: ' + escapeHtml(String(data.total_eligible_sampled || 0))
      + '</div>')
    + adminCard('Feature flags', flagRows)
    + adminCard('Reward simulation (§29 — no money moves)',
        '<input id="admSimPeriod" placeholder="Period e.g. 2026-09" style="width:100%;background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:9px 11px;color:var(--text);margin-bottom:8px;" />'
      + '<input id="admSimPool" placeholder="Pool amount e.g. 10000" inputmode="decimal" style="width:100%;background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:9px 11px;color:var(--text);margin-bottom:8px;" />'
      + '<button type="button" id="admSavePool" class="bspace-mini" style="margin-right:6px;">Save pool</button>'
      + '<button type="button" id="admRunSim" class="bspace-mini primary">Run simulation</button>'
      + '<div id="admSimOut" class="lobby-sub" style="text-align:left;max-width:none;margin-top:10px;font-size:11.5px;"></div>')
    + adminCard('Recent ledger', (data.recent || []).slice(0, 12).map(function(r){
        return '<div style="font-family:var(--font-mono);font-size:10.5px;color:var(--text-dim);padding:3px 0;border-bottom:1px solid var(--line);">'
          + escapeHtml(String(r.event_type || '')) + ' · ' + escapeHtml(String(r.points))
          + ' pts (elig ' + escapeHtml(String(r.eligible_points)) + ') · ' + escapeHtml(String(r.status || ''))
          + '</div>';
      }).join('') || '<div class="lobby-sub" style="text-align:left;max-width:none;">No ledger rows yet.</div>')
    + '<button type="button" id="admAuditBtn" class="bspace-mini" style="width:100%;margin-top:6px;">View audit log</button>'
    + '<div id="admAuditOut" style="margin-top:10px;"></div>';

  el.querySelectorAll('.admin-flag').forEach(function(btn){
    btn.onclick = async function(){
      const flag = btn.getAttribute('data-flag');
      const next = btn.getAttribute('data-next') === '1';
      const reason = window.prompt('Reason for this change (recorded in the audit log):', '');
      if(reason === null) return;
      const payload = { reason: reason };
      payload[flag] = next;
      const res = await adminFetch('flags', { method: 'POST', body: JSON.stringify(payload) });
      const body = await res.json().catch(()=>({}));
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
    const reason = window.prompt('Reason (audit log):', '') ;
    if(reason === null) return;
    const res = await adminFetch('pools', { method:'POST', body: JSON.stringify({
      period_id: period, amount_minor: Math.round(major * 100), currency: 'AED',
      funding_source: 'UNSPECIFIED', status: 'DRAFT', reason: reason,
    })});
    const b = await res.json().catch(()=>({}));
    toast(res.ok && b.ok ? 'Pool saved (draft)' : (b.error || 'Could not save'));
  };

  const runSim = $('admRunSim');
  if(runSim) runSim.onclick = async function(){
    const period = ($('admSimPeriod') && $('admSimPeriod').value || '').trim();
    const out = $('admSimOut');
    if(!period){ toast('Enter a period'); return; }
    if(out) out.textContent = 'Simulating…';
    const res = await adminFetch('simulate', { method:'POST', body: JSON.stringify({ period_id: period, limit: 20 }) });
    const b = await res.json().catch(()=>({}));
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
    if(out) out.innerHTML = '<div class="lobby-sub" style="text-align:left;max-width:none;">Loading…</div>';
    const res = await adminFetch('audit');
    const b = await res.json().catch(()=>({}));
    if(!res.ok || !b.ok){ if(out) out.textContent = 'Could not load audit log'; return; }
    if(out) out.innerHTML = (b.entries || []).slice(0, 30).map(function(e){
      return '<div style="font-family:var(--font-mono);font-size:10px;color:var(--text-dim);padding:4px 0;border-bottom:1px solid var(--line);">'
        + escapeHtml(new Date(Number(e.created_at) || 0).toLocaleString()) + ' · '
        + escapeHtml(String(e.action || '')) + ' · ' + escapeHtml(String(e.target || '')) + '<br>'
        + 'reason: ' + escapeHtml(String(e.reason || '—'))
        + '</div>';
    }).join('') || '<div class="lobby-sub" style="text-align:left;max-width:none;">No entries.</div>';
  };
}

window.openContributionPanel = openContributionPanel;
window.openSupportSheet = openSupportSheet;
window.nalunoSupportButtonHtml = nalunoSupportButtonHtml;
