/* ============================================================
   MODULE: js/economy-ui.js
   The visible surface of the Community Economy: the person's own
   contribution dashboard (§36) and the Creator Support control (§20).

   The operator Control Centre is a separate site at /admin/ — it is not
   loaded, linked, or reachable from this member app.

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

/* Operator Control Centre lives at /admin/. This file used to wire a
   6-tap dot on Callsign — that door is gone so the public app has no
   admin UI at all. Contribution + support stay here. */

(function wireEconomyUi(){
  function bind(){
    const cc = $('contributionCloseBtn');
    if(cc) cc.onclick = closeContributionPanel;
    const openBtn = $('myContributionBtn');
    if(openBtn) openBtn.onclick = openContributionPanel;
  }
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind);
  else bind();
})();

window.openContributionPanel = openContributionPanel;
window.openSupportSheet = openSupportSheet;
window.nalunoSupportButtonHtml = nalunoSupportButtonHtml;
