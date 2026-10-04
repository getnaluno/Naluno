/* ============================================================
   MODULE: js/economy-ui.js
   The visible surface of the Community Economy: the person's own
   contribution dashboard (§36) and Creator Support inside Broadcast,
   below Circle (§20). Not a nav tab.

   The operator Control Centre is a separate site at /admin/ — it is not
   loaded, linked, or reachable from this member app.

   Creator Support lives only inside a Broadcast, under Circle. Control
   Centre On/Off makes that panel active or inactive — it never removes
   it. Voluntary and non-aggressive (§22, §39): no pressure, no gating of
   watching, talking, or publishing. Nothing here is required to use Naluno.

   Everything shown here is READ from the server. Nothing in this file
   computes a point, a balance or an eligibility decision — it renders
   what the naluno-economy Worker returns, and if the Worker is
   unreachable it renders an honest "unavailable" rather than a zero
   that looks like fact.
   ============================================================ */

const ECONOMY_UI_WORKER = 'https://naluno-economy.naluno.workers.dev';

function supportCcy(){
  try{
    if(typeof NalunoCurrency !== 'undefined' && NalunoCurrency && NalunoCurrency.code){
      return NalunoCurrency.code() || 'AED';
    }
  }catch(_){}
  return 'AED';
}
function supportPresets(){
  /* Amounts come from the operator's price book, converted to the running
     currency. No amount lives in this file. */
  try{
    if(typeof NalunoCurrency !== 'undefined' && NalunoCurrency && NalunoCurrency.supportPresets){
      return NalunoCurrency.supportPresets() || [];
    }
  }catch(_){}
  return [];
}

function supportIsOn(){
  return typeof nalunoEconomyFlag === 'function' && nalunoEconomyFlag('creator_support_enabled');
}

function supportEsc(s){
  if(typeof escapeHtml === 'function') return escapeHtml(String(s == null ? '' : s));
  return String(s == null ? '' : s)
    .replace(/&/g, '&' + 'amp;').replace(/</g, '&' + 'lt;').replace(/>/g, '&' + 'gt;')
    .replace(/"/g, '&' + 'quot;');
}

function contribEventName(type){
  const map = {
    SIGNAL_POST: 'Signal',
    BROADCAST_COMMENT: 'Comment',
    COMMENT_REPLY: 'Reply',
    CREATOR_FOLLOW: 'Follow',
    WATCH_COMPLETION: 'Watched through',
    BROADCAST_SHARE: 'Share',
  };
  return map[type] || 'Activity';
}
function contribRecentHtml(rows){
  if(!rows || !rows.length) return '';
  const lines = rows.slice(0, 8).map(function(r){
    const waiting = String(r.status || '').toUpperCase() === 'PENDING_REVIEW';
    const name = contribEventName(r.event_type) + (waiting ? ' · waiting' : '');
    return '<div style="display:flex;justify-content:space-between;gap:12px;padding:8px 0;border-top:1px solid var(--line);">'
      + '<span>' + supportEsc(name) + '</span>'
      + '<span style="color:var(--mint);">' + supportEsc(String(Number(r.points) || 0)) + '</span>'
      + '</div>';
  }).join('');
  return '<div class="bspace-card" style="margin-bottom:10px;">'
    + '<div class="who">Counted</div>'
    + lines
    + '</div>';
}

/* ---------------- My Contribution (§36) ---------------- */

function openContributionPanel(){
  const panel = $('contributionPanel');
  if(!panel) return;
  panel.classList.add('active');
  try{ if(window.nalunoBack) window.nalunoBack.push(); }catch(_){}
  renderContributionPanel();
  if(openContributionPanel._timer) clearInterval(openContributionPanel._timer);
  openContributionPanel._timer = setInterval(function(){
    const open = $('contributionPanel');
    if(!open || !open.classList.contains('active')){
      clearInterval(openContributionPanel._timer);
      openContributionPanel._timer = null;
      return;
    }
    renderContributionPanel(true);
  }, 8000);
}
function closeContributionPanel(){
  const panel = $('contributionPanel');
  if(panel) panel.classList.remove('active');
  if(openContributionPanel._timer){ clearInterval(openContributionPanel._timer); openContributionPanel._timer = null; }
  try{ if(window.nalunoBack) window.nalunoBack.drop('contributionPanel'); }catch(_){}
}

async function renderContributionPanel(quiet){
  const el = $('contributionBody');
  if(!el) return;
  if(!quiet) el.innerHTML = '<div class="lobby-sub" style="text-align:left;max-width:none;">Loading…</div>';
  const me = (typeof fetchMyContribution === 'function') ? await fetchMyContribution() : null;
  if(!me || !me.ok){
    // Honest failure. A zero here would read as "you have contributed
    // nothing", which is a different and much worse claim than "we could
    // not load this".
    el.innerHTML = '<div class="lobby-sub" style="text-align:left;max-width:none;">Couldn’t load your contribution just now. Nothing has been lost — try again in a moment.</div>';
    return;
  }
  const trustLabel = { HIGH:'High', MEDIUM:'Building', LOW:'Limited', NEW:'New account' }[me.contribution_trust] || '—';
  const recent = contribRecentHtml(me.recent);
  const fromPhone = me.from_phone
    ? '<div class="lobby-sub" style="text-align:left;max-width:none;font-size:11.5px;margin-top:8px;">Last count saved on this phone. It will refresh when the network is back.</div>'
    : '';
  el.innerHTML =
    '<div class="bspace-card" style="margin-bottom:10px;">'
    + '<div class="who">Contribution Points</div>'
    + '<div style="font-family:var(--font-futuristic);font-size:26px;color:var(--mint);">' + supportEsc(String(me.contribution_points)) + '</div>'
    + '<div class="lobby-sub" style="text-align:left;max-width:none;font-size:11.5px;margin-top:4px;">Naluno counts a Signal as 1, a comment as 3, a reply as 2, a follow as 1, a watch through as 2, and a share as 2. A comment or reply shorter than 8 characters waits and counts as 0. These points are not money, and they are not a promise of money.</div>'
    + fromPhone
    + '</div>'
    + '<div class="bspace-card" style="margin-bottom:10px;">'
    + '<div class="who">Eligible Contribution</div>'
    + '<div style="font-family:var(--font-futuristic);font-size:22px;">' + supportEsc(String(me.eligible_contribution)) + '</div>'
    + '<div class="lobby-sub" style="text-align:left;max-width:none;font-size:11.5px;margin-top:4px;">The points Naluno has accepted. Community rewards are off, so this is not an amount anyone owes.</div>'
    + '</div>'
    + recent
    + '<div class="bspace-card">'
    + '<div class="who">Contribution Trust</div>'
    + '<div style="font-family:var(--font-futuristic);font-size:18px;">' + supportEsc(trustLabel) + '</div>'
    + '<div class="lobby-sub" style="text-align:left;max-width:none;font-size:11.5px;margin-top:4px;">New account before the first counted activity. Limited from 1, Building from 5, High from 20. This is not a payment rank, and it is not monetisation.</div>'
    + '</div>'
    + '<div class="lobby-sub" style="text-align:left;max-width:none;margin-top:14px;font-size:11.5px;">'
    + 'Community rewards are not active. Nothing here is currency. Monetisation, if Naluno turns it on, is a separate decision about a creator’s Broadcasts. It is not these points, and no payment is owed.'
    + '</div>';
}

/* ---------------- Creator Support (Broadcast, below Circle) ----------------
   The panel is ALWAYS painted inside a Broadcast. The flag only flips
   active / inactive. Inactive still opens — it just cannot record an intent. */

function nalunoSupportButtonHtml(){
  const on = supportIsOn();
  return '<button type="button" id="bspaceSupportBtn" class="bspace-support-btn' + (on ? '' : ' off') + '"'
    + ' title="' + (on ? 'Support this creator' : 'Support is off') + '">Support</button>';
}

/* Old shells (v166) still had a Support nav tab. Pull it out so a mixed
   cache can never put Support back on the bar. Lives only under Circle. */
function stripSupportNavTab(){
  try{
    const btn = document.getElementById('supportNavBtn')
      || document.querySelector('.navbar .navbtn[data-tab="support"]');
    if(btn && btn.parentNode) btn.parentNode.removeChild(btn);
    const tab = document.getElementById('tab-support');
    if(tab && tab.parentNode) tab.parentNode.removeChild(tab);
  }catch(_){}
}

function supportPanelHtml(){
  return '<div class="bspace-support-panel">'
    + '<button type="button" class="bspace-support-head" id="bspaceSupportToggle" aria-expanded="false">'
    + '<span class="bspace-support-kicker">Support creator</span>'
    + '<span class="support-flag-chip" id="supportFlagChip">Off</span></button>'
    + '<div class="support-body" id="bspaceSupportBody" hidden>'
    + '<div class="support-banner" id="supportBanner"></div>'
    + nalunoSupportButtonHtml()
    + '<div id="bspacePayoutSlot"></div>'
    + '<div id="supportMine"></div></div></div>';
}

function syncSupportChip(){
  const on = supportIsOn();
  const chip = $('supportFlagChip');
  if(chip) chip.textContent = on ? 'On' : 'Off';
  const toggle = $('bspaceSupportToggle');
  if(toggle) toggle.setAttribute('aria-expanded', ($('bspaceSupportBody') && !$('bspaceSupportBody').hasAttribute('hidden')) ? 'true' : 'false');
}

function toggleSupportBody(){
  const body = $('bspaceSupportBody');
  const toggle = $('bspaceSupportToggle');
  if(!body) return;
  const open = body.hasAttribute('hidden');
  if(open) body.removeAttribute('hidden');
  else body.setAttribute('hidden', '');
  if(toggle) toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  if(open){
    try{ renderSupportTab(); }catch(_){}
  }
}

function paintBspaceSupportButton(){
  stripSupportNavTab();
  const host = $('bspaceSupportSlot') || $('bspaceJoinBtn');
  if(!host) return;
  let btn = $('bspaceSupportBtn');
  if(!btn){
    if($('bspaceSupportSlot')){
      const slot = $('bspaceSupportSlot');
      if(slot && !slot.querySelector('.bspace-support-panel')){
        slot.innerHTML = supportPanelHtml();
      }
      btn = $('bspaceSupportBtn');
    } else {
      const wrap = document.createElement('div');
      wrap.id = 'bspaceSupportSlot';
      wrap.className = 'bspace-support-slot';
      wrap.innerHTML = supportPanelHtml();
      host.insertAdjacentElement('afterend', wrap);
      btn = $('bspaceSupportBtn');
    }
  }
  const toggle = $('bspaceSupportToggle');
  if(toggle && !toggle.__wired){
    toggle.__wired = true;
    toggle.onclick = function(e){
      if(e){ e.preventDefault(); e.stopPropagation(); }
      toggleSupportBody();
    };
  }
  if(!btn) { syncSupportChip(); return; }
  const on = supportIsOn();
  btn.classList.toggle('off', !on);
  btn.textContent = 'Support';
  btn.title = on ? 'Support this creator' : 'Support is off';
  btn.onclick = function(){
    const m = (typeof activeBroadcastMeta !== 'undefined') ? activeBroadcastMeta : null;
    const uid = m && m.creatorUid;
    const name = m && m.creatorName;
    const bid = (typeof activeBroadcastId !== 'undefined') ? activeBroadcastId : '';
    openSupportSheet(uid, name, bid);
  };
  syncSupportChip();
  const body = $('bspaceSupportBody');
  if(body && !body.hasAttribute('hidden')){
    try{ renderSupportTab(); }catch(_){}
  }
}

function listSupportCreators(){
  const seen = {};
  const out = [];
  function add(uid, name, broadcastId, extra){
    if(!uid) return;
    if(typeof currentUser !== 'undefined' && currentUser && uid === currentUser.uid) return;
    if(seen[uid]) return;
    seen[uid] = true;
    out.push({
      uid: uid,
      name: name || 'Someone',
      broadcastId: broadcastId || '',
      views: extra && extra.views || 0,
      live: !!(extra && extra.live),
    });
  }
  try{
    const feed = (typeof feedBroadcasts !== 'undefined' && feedBroadcasts) ? feedBroadcasts : [];
    feed.forEach(function(b){
      if(!b || b.deleted) return;
      add(b.creatorUid, b.creatorName, b.id, { views: b.views, live: b.live });
    });
  }catch(_){}
  try{
    const mine = (typeof myBroadcasts !== 'undefined' && myBroadcasts) ? myBroadcasts : [];
    mine.forEach(function(b){
      if(!b || b.deleted) return;
      add(b.creatorUid, b.creatorName, b.id, { views: b.views, live: b.live });
    });
  }catch(_){}
  out.sort(function(a, b){ return (b.views || 0) - (a.views || 0); });
  return out;
}

async function loadMySupportRows(){
  const empty = { given: [], received: [] };
  try{
    if(typeof currentUser === 'undefined' || !currentUser || typeof fbDb === 'undefined' || !fbDb) return empty;
    const uid = currentUser.uid;
    const givenSnap = await fbDb.collection('creatorSupport')
      .where('supporter_user_id', '==', uid).limit(40).get();
    const receivedSnap = await fbDb.collection('creatorSupport')
      .where('creator_user_id', '==', uid).limit(40).get();
    function rows(snap){
      const list = [];
      snap.forEach(function(d){
        const x = d.data() || {};
        list.push({
          id: d.id,
          amount: Number(x.amount_minor) || 0,
          currency: x.currency || supportCcy(),
          status: x.status || 'intent',
          name: x.creator_name || x.supporter_name || '',
          other: x.creator_user_id === uid ? x.supporter_user_id : x.creator_user_id,
          at: Number(x.created_at || x.createdAt) || 0,
        });
      });
      list.sort(function(a, b){ return (b.at || 0) - (a.at || 0); });
      return list;
    }
    return { given: rows(givenSnap), received: rows(receivedSnap) };
  }catch(_){
    return empty;
  }
}

function formatSupportMoney(minor, currency){
  const ccy = currency || supportCcy();
  try{
    if(typeof NalunoCurrency !== 'undefined' && NalunoCurrency && NalunoCurrency.formatMinor){
      return NalunoCurrency.formatMinor(minor, ccy);
    }
  }catch(_){}
  const n = Number(minor) || 0;
  return ccy + ' ' + (n / 100).toFixed(0);
}

function renderSupportTab(){
  const banner = $('supportBanner');
  const listEl = $('supportCreatorList');
  const mineEl = $('supportMine');
  const on = supportIsOn();
  if(banner){
    banner.className = 'support-banner' + (on ? ' on' : '');
    banner.innerHTML = on
      ? '<strong>On.</strong> Support is voluntary. You are taken to pay. Nothing is marked paid until that payment is confirmed.'
      : '<strong>Off.</strong> Nothing can be charged and nothing is recorded.';
  }
  syncSupportChip();
  if(listEl){
    const creators = listSupportCreators();
    if(!creators.length){
      listEl.innerHTML = '<div class="support-empty">Creators you watch will land here. Open Broadcast, then come back.</div>';
    } else {
      listEl.innerHTML = creators.map(function(c){
        const views = (typeof formatNalunoViews === 'function') ? formatNalunoViews(c.views || 0) : String(c.views || 0);
        return '<button type="button" class="support-row' + (on ? '' : ' off') + '" data-uid="' + supportEsc(c.uid)
          + '" data-name="' + supportEsc(c.name)
          + '" data-bid="' + supportEsc(c.broadcastId) + '">'
          + '<span class="support-row-av">' + supportEsc(String(c.name || '?').slice(0, 1).toUpperCase()) + '</span>'
          + '<span class="support-row-body">'
          + '<span class="support-row-name"><span data-known-uid="' + supportEsc(c.uid || '') + '">' + supportEsc(c.name.split(' ')[0]) + '</span>'
          + (c.live ? ' <em>LIVE</em>' : '') + '</span>'
          + '<span class="support-row-meta">' + supportEsc(views) + ' views</span>'
          + '</span>'
          + '<span class="support-row-cta">' + (on ? 'Support' : 'Off') + '</span>'
          + '</button>';
      }).join('');
      listEl.querySelectorAll('.support-row').forEach(function(btn){
        btn.onclick = function(){
          openSupportSheet(btn.getAttribute('data-uid'), btn.getAttribute('data-name'), btn.getAttribute('data-bid'));
        };
      });
    }
  }
  if(mineEl){
    mineEl.innerHTML = '<div class="lobby-sub" style="text-align:left;max-width:none;">Your support history loads when you are signed in.</div>';
    try{
      const pay = $('bspacePayoutSlot');
      const mine = !!(typeof activeBroadcastMeta !== 'undefined' && activeBroadcastMeta && typeof currentUser !== 'undefined' && currentUser && activeBroadcastMeta.creatorUid === currentUser.uid);
      if(pay && mine){ paintPayoutBlock(pay); paintMomoReceive(pay); }
      else if(pay) pay.innerHTML = '';
    }catch(_){}
    loadMySupportRows().then(function(rows){
      if(!mineEl) return;
      const given = rows.given || [];
      const received = rows.received || [];
      if(!given.length && !received.length){
        mineEl.innerHTML = '<div class="support-empty">No support recorded on this account yet.</div>';
        return;
      }
      function line(r, dir){
        const when = r.at ? new Date(r.at).toLocaleDateString() : '';
        return '<div class="support-hist">'
          + '<span>' + supportEsc(dir) + ' · ' + supportEsc(formatSupportMoney(r.amount, r.currency)) + '</span>'
          + '<span>' + supportEsc(r.status) + (when ? ' · ' + when : '') + '</span>'
          + '</div>';
      }
      mineEl.innerHTML =
        (given.length ? '<div class="section-label" style="padding:0 4px;">You sent</div>' + given.slice(0, 8).map(function(r){ return line(r, 'to a creator'); }).join('') : '')
        + (received.length ? '<div class="section-label" style="padding:0 4px;margin-top:12px;">You received</div>' + received.slice(0, 8).map(function(r){ return line(r, 'from someone'); }).join('') : '');
    }).catch(function(){});
  }
}

let __supportSheet = { uid: '', name: '', broadcastId: '', amount: 1000 };

function closeSupportSheet(){
  const panel = $('supportSheet');
  if(panel) panel.classList.remove('active');
  try{ if(window.nalunoBack) window.nalunoBack.drop('supportSheet'); }catch(_){}
}

function openSupportSheet(creatorUid, creatorName, broadcastId){
  if(!supportIsOn()){
    toast('Creator Support is off.');
    return;
  }
  if(typeof currentUser === 'undefined' || !currentUser){ toast('Sign in first'); return; }
  if(!creatorUid){ toast('Pick a creator'); return; }
  if(creatorUid === currentUser.uid){ toast('You can’t support yourself'); return; }
  const presets = supportPresets();
  __supportSheet = {
    uid: creatorUid,
    name: creatorName || 'this creator',
    broadcastId: broadcastId || '',
    amount: presets[1] ? presets[1].major : (presets[0] && presets[0].major) || 0,
    currency: supportCcy(),
  };
  const panel = $('supportSheet');
  const who = $('supportSheetWho');
  const hint = $('supportSheetHint');
  if(who){ who.setAttribute('data-known-uid', creatorUid || ''); who.textContent = 'Support ' + String(__supportSheet.name).split(' ')[0]; }
  if(hint) hint.textContent = 'Voluntary. Separate from anything you earn. You will be taken to pay. Nothing is marked paid until the payment is confirmed. Amounts are in ' + supportCcy() + '.';
  const row = $('supportAmountRow');
  const other = $('supportAmountOther');
  if(other){
    other.value = '';
    other.placeholder = 'Other amount (' + supportCcy() + ')';
    other.oninput = function(){
      const n = Number(String(other.value || '').replace(/,/g, ''));
      if(n > 0){
        __supportSheet.amount = n;
        if(row) row.querySelectorAll('.support-amt').forEach(function(x){ x.classList.remove('on'); });
      }
    };
  }
  if(row){
    row.innerHTML = presets.map(function(p, i){
      const on = p.major === __supportSheet.amount;
      return '<button type="button" class="support-amt' + (on ? ' on' : '') + '" data-major="' + supportEsc(p.major) + '">' + supportEsc(p.label) + '</button>';
    }).join('');
    row.hidden = !presets.length;
    row.querySelectorAll('.support-amt').forEach(function(b){
      b.onclick = function(){
        __supportSheet.amount = Number(b.getAttribute('data-major')) || 0;
        if(other) other.value = '';
        row.querySelectorAll('.support-amt').forEach(function(x){
          x.classList.toggle('on', x === b);
        });
      };
    });
  }
  const msg = $('supportSheetMsg');
  if(msg) msg.textContent = '';
  if(other && !other.__enter){
    other.__enter = true;
    other.addEventListener('keydown', function(e){ if(e.key === 'Enter'){ e.preventDefault(); submitSupportIntent(); } });
    other.addEventListener('input', supportSendLabel);
  }
  if(row) row.addEventListener('click', function(){ setTimeout(supportSendLabel, 0); });
  supportSendLabel();
  if(panel) panel.classList.add('active');
  try{ if(window.nalunoBack) window.nalunoBack.push(); }catch(_){}
}

/* 29g: the button says what happens next and for how much. */
function supportSendLabel(){
  const b = $('supportSheetSend');
  if(!b || b.disabled) return;
  const amt = Number(__supportSheet.amount) || 0;
  let shown = '';
  try{
    if(amt > 0 && typeof NalunoCurrency !== 'undefined' && NalunoCurrency && NalunoCurrency.formatMajor) shown = NalunoCurrency.formatMajor(amt, __supportSheet.currency || supportCcy());
  }catch(_){}
  if(!shown && amt > 0) shown = (__supportSheet.currency || supportCcy()) + ' ' + amt.toLocaleString();
  b.textContent = amt > 0 ? ((__supportRail === 'momo' ? 'Request ' : 'Continue to pay ') + shown) : (__supportRail === 'momo' ? 'Request mobile money' : 'Continue to pay');
}

async function nalunoCheckout(body){
  if(typeof currentUser === 'undefined' || !currentUser) throw new Error('Sign in first');
  const idToken = await currentUser.getIdToken(false);
  let res;
  try{
    res = await fetch(ECONOMY_UI_WORKER + '/v1/pay/checkout', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + idToken, 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    });
  }catch(_){
    throw new Error('Could not reach the payment service. Check your connection and try again. Nothing was charged.');
  }
  const data = await res.json().catch(function(){ return {}; });
  if(!res.ok || !data.ok || !data.url){
    const err = new Error(data.error || 'Payments aren’t available yet. Nothing was charged.');
    err.data = data;
    err.status = res.status;
    throw err;
  }
  return data.url;
}

/** Stripe's own page, only. A lookalike host is not opened. */
function nalunoStripeSetupUrl(err){
  const data = err && err.data;
  const raw = String((data && data.register_url) || (err && err.message) || '');
  const found = raw.match(/https:\/\/[^\s)'"<>]+/i);
  if(found){
    const url = found[0].replace(/[.,)]$/, '');
    try{
      const u = new URL(url);
      if(u.protocol !== 'https:') return '';
      if(u.hostname !== 'dashboard.stripe.com' && u.hostname !== 'connect.stripe.com') return '';
      return u.origin + u.pathname + u.search;
    }catch(_){ return ''; }
  }
  if(/activat|onboard|complete your account|signed up for Stripe Connect|live charges/i.test(raw)){
    return 'https://dashboard.stripe.com/account/onboarding';
  }
  return '';
}
function nalunoShowStripeSetup(anchor, err){
  if(!anchor || !anchor.parentNode) return;
  const url = err ? nalunoStripeSetupUrl(err) : '';
  let btn = anchor.parentNode.querySelector('.naluno-stripe-setup');
  if(!url){
    if(btn) btn.remove();
    return;
  }
  if(!btn){
    btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'naluno-stripe-setup';
    btn.textContent = 'Open Stripe';
    anchor.insertAdjacentElement('afterend', btn);
  }
  btn.onclick = function(){ window.location.href = url; };
}
window.nalunoShowStripeSetup = nalunoShowStripeSetup;

async function nalunoMomo(body){
  if(typeof currentUser === 'undefined' || !currentUser) throw new Error('Sign in first');
  const idToken = await currentUser.getIdToken(false);
  let res;
  try{
    res = await fetch(ECONOMY_UI_WORKER + '/v1/pay/momo', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + idToken, 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    });
  }catch(_){
    throw new Error('Could not reach the payment service. Check your connection and try again. Nothing was charged.');
  }
  const data = await res.json().catch(function(){ return {}; });
  if(!res.ok || !data.ok || data.status === 'paid' || data.paid === true){
    const err = new Error((data && data.error) || 'Mobile money did not start. Nothing was charged.');
    err.data = data;
    err.status = res.status;
    throw err;
  }
  if(data.status && data.status !== 'pending'){
    const err = new Error('That payment was not recorded. Nothing was charged.');
    err.data = data;
    throw err;
  }
  return data;
}
window.nalunoMomo = nalunoMomo;

let __supportRail = 'stripe';
let __supportNet = 'mtn';
function supportRailUi(){
  const momo = $('supportMomo');
  if(momo) momo.hidden = __supportRail !== 'momo';
  const card = $('supportRailCard');
  const mm = $('supportRailMomo');
  if(card) card.classList.toggle('on', __supportRail === 'stripe');
  if(mm) mm.classList.toggle('on', __supportRail === 'momo');
  supportSendLabel();
}

async function submitSupportIntent(){
  if(!supportIsOn()){
    toast('Creator Support is off. Nothing was charged.');
    return;
  }
  if(typeof currentUser === 'undefined' || !currentUser){ toast('Sign in first'); return; }
  const uid = __supportSheet.uid;
  const amountMajor = Number(__supportSheet.amount) || 0;
  const msg = $('supportSheetMsg');
  if(!uid || !(amountMajor > 0)){ if(msg) msg.textContent = 'Pick an amount, or type one.'; toast('Pick an amount'); return; }
  const sendBtn = $('supportSheetSend');
  const momo = __supportRail === 'momo';
  if(sendBtn){ sendBtn.disabled = true; sendBtn.textContent = momo ? 'Requesting…' : 'Opening Stripe…'; }
  if(msg) msg.textContent = momo
    ? 'Requesting mobile money. Nothing is marked paid until MTN or Airtel confirms.'
    : 'Taking you to Stripe’s secure page. You pay there by card, Apple Pay or Google Pay, and Stripe asks for your phone number. You come back here after.';
  nalunoShowStripeSetup(msg, null);
  try{
    const ikey = 'sup_' + (crypto.randomUUID ? crypto.randomUUID() : (Date.now() + '' + Math.random()).replace('.', ''));
    if(momo){
      const data = await nalunoMomo({
        kind: 'support',
        creator_user_id: uid,
        broadcast_id: __supportSheet.broadcastId || '',
        amount_major: amountMajor,
        currency: __supportSheet.currency || supportCcy(),
        phone: ($('supportMomoPhone') && $('supportMomoPhone').value) || '',
        network: __supportNet,
        idempotency_key: ikey,
      });
      if(msg) msg.textContent = (data && data.message) || 'Request recorded. Nothing is marked paid until the payment is confirmed.';
      return;
    }
    const url = await nalunoCheckout({
      kind: 'support',
      creator_user_id: uid,
      broadcast_id: __supportSheet.broadcastId || '',
      amount_major: amountMajor,
      currency: __supportSheet.currency || supportCcy(),
      idempotency_key: ikey,
    });
    nalunoPayRemember({ k: 'support', b: __supportSheet.broadcastId || '', r: ikey, name: __supportSheet.name || '' });
    window.location.href = url;
  }catch(e){
    const text = (e && e.message) || 'Payments aren’t available yet. Nothing was charged.';
    if(msg) msg.textContent = text;
    nalunoShowStripeSetup(msg, e);
    toast(text);
  }finally{
    if(sendBtn){ sendBtn.disabled = false; supportSendLabel(); }
  }
}

function wireSupportSheet(){
  const close = $('supportSheetClose');
  if(close) close.onclick = closeSupportSheet;
  const send = $('supportSheetSend');
  if(send) send.onclick = submitSupportIntent;
  const card = $('supportRailCard');
  const mm = $('supportRailMomo');
  if(card) card.onclick = function(){ __supportRail = 'stripe'; supportRailUi(); };
  if(mm) mm.onclick = function(){ __supportRail = 'momo'; supportRailUi(); };
  const nets = $('supportMomoNet');
  if(nets) nets.onclick = function(e){
    const b = e.target && e.target.closest ? e.target.closest('[data-net]') : null;
    if(!b) return;
    __supportNet = b.getAttribute('data-net') || 'mtn';
    nets.querySelectorAll('[data-net]').forEach(function(x){ x.classList.toggle('on', x === b); });
  };
  supportRailUi();
}

/* Operator Control Centre lives at /admin/. This file used to wire a
   6-tap dot on Callsign — that door is gone so the public app has no
   admin UI at all. Contribution + support stay here. */

(function wireEconomyUi(){
  function bind(){
    stripSupportNavTab();
    const cc = $('contributionCloseBtn');
    if(cc) cc.onclick = closeContributionPanel;
    const openBtn = $('myContributionBtn');
    if(openBtn) openBtn.onclick = openContributionPanel;
    wireSupportSheet();
    renderSupportTab();
    paintBspaceSupportButton();
    document.addEventListener('naluno-flags', function(){
      stripSupportNavTab();
      renderSupportTab();
      paintBspaceSupportButton();
    });
    document.addEventListener('naluno-currency', function(){
      renderSupportTab();
      paintBspaceSupportButton();
    });
  }
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind);
  else bind();
})();

/* ---------------- 29g: coming back from Stripe ----------------
   Stripe sends the person back to /app/?pay=return&k=…&b=<Broadcast>&r=<ref>.
   The app reopens that Broadcast and shows the result on top of it, and
   checks until the payment is confirmed (the webhook marks it paid). */
function nalunoPayRemember(o){
  try{ sessionStorage.setItem('nalunoPayPending', JSON.stringify(Object.assign({ at: Date.now() }, o || {}))); }catch(_){}
}
function nalunoPaySheet(){
  let el = $('payResultSheet');
  if(el) return el;
  el = document.createElement('div');
  el.className = 'call-overlay';
  el.id = 'payResultSheet';
  el.innerHTML = '<div class="topbar" style="padding-top:18px;"><div class="back-btn" id="payResultClose" role="button" aria-label="Back">'
    + '<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M15 18l-6-6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></div>'
    + '<div style="flex:1;font-family:var(--font-futuristic);font-weight:700;font-size:16px;" id="payResultTitle">Payment</div></div>'
    + '<div class="tab-scroll" style="padding:8px 18px 24px;"><div class="pay-result-mark" id="payResultMark">…</div>'
    + '<p class="lobby-sub" id="payResultText" style="text-align:left;max-width:none;font-size:13px;line-height:1.5;"></p>'
    + '<button type="button" class="save-btn" id="payResultDone" style="width:100%;margin-top:16px;">Back to the Broadcast</button></div>';
  document.body.appendChild(el);
  const close = function(){ el.classList.remove('active'); };
  el.querySelector('#payResultClose').onclick = close;
  el.querySelector('#payResultDone').onclick = close;
  return el;
}
function nalunoPayShow(title, mark, text, doneLabel){
  const el = nalunoPaySheet();
  $('payResultTitle').textContent = title;
  $('payResultMark').textContent = mark;
  $('payResultMark').className = 'pay-result-mark' + (mark === '✓' ? ' ok' : (mark === '×' ? ' off' : ''));
  $('payResultText').textContent = text;
  if(doneLabel) $('payResultDone').textContent = doneLabel;
  el.classList.add('active');
}
async function nalunoPayConfirmed(k, ref){
  if(typeof fbDb === 'undefined' || !fbDb || !ref || typeof currentUser === 'undefined' || !currentUser) return null;
  try{
    if(k === 'support'){
      const d = await fbDb.collection('creatorSupport').doc(ref).get();
      return d.exists && (d.data() || {}).status === 'succeeded' ? (d.data() || {}) : null;
    }
    if(k === 'ad'){
      const d = await fbDb.collection('deskAds').doc(ref).get();
      return d.exists && (d.data() || {}).paymentStatus === 'paid' ? (d.data() || {}) : null;
    }
    if(k === 'known'){
      const d = await fbDb.collection('knownApps').doc(currentUser.uid).get();
      return d.exists && (d.data() || {}).status === 'known' ? (d.data() || {}) : null;
    }
  }catch(_){}
  return null;
}
function nalunoPayWhat(k){
  return k === 'ad' ? 'Your ad' : (k === 'known' ? 'Known' : 'Your support');
}
async function nalunoHandlePayReturn(){
  let q;
  try{ q = new URLSearchParams(location.search); }catch(_){ return; }
  const pay = q.get('pay');
  const payout = q.get('payout');
  if(!pay && !payout) return;
  let pending = null;
  try{ pending = JSON.parse(sessionStorage.getItem('nalunoPayPending') || 'null'); sessionStorage.removeItem('nalunoPayPending'); }catch(_){}
  const k = q.get('k') || (pending && pending.k) || 'support';
  const bid = q.get('b') || (pending && pending.b) || '';
  const ref = q.get('r') || (pending && pending.r) || '';
  try{ history.replaceState(null, '', location.pathname + location.hash); }catch(_){}
  // Wait for sign-in (the app restores it on load).
  for(let i = 0; i < 60 && (typeof currentUser === 'undefined' || !currentUser || typeof fbDb === 'undefined' || !fbDb); i++){
    await new Promise(function(r){ setTimeout(r, 500); });
  }
  if(payout){
    if(payout === 'refresh'){ nalunoStartPayouts(); return; }
    nalunoPayShow('Payouts', '…', 'Checking your Stripe account…', 'Done');
    const st = await nalunoPayoutStatus(true);
    if(st && st.ready) nalunoPayShow('Payouts', '✓', 'Payouts are on. Support sent to you now goes straight to your Stripe account, and Stripe pays it out to your bank or card.', 'Done');
    else if(st && st.connected) nalunoPayShow('Payouts', '…', 'Stripe still needs a few details before it can pay you. Open Support in any Broadcast and tap “Finish setting up on Stripe”.', 'Done');
    else nalunoPayShow('Payouts', '×', 'Payouts are not set up yet.', 'Done');
    return;
  }
  if(bid && typeof openBroadcastById === 'function'){
    try{ if(typeof nalunoShowTab === 'function') nalunoShowTab('broadcast'); }catch(_){}
    try{ openBroadcastById(bid); }catch(_){}
    await new Promise(function(r){ setTimeout(r, 900); });
  }
  const what = nalunoPayWhat(k);
  if(pay === 'cancel'){
    nalunoPayShow('Payment', '×', 'You left the payment page. Nothing was charged.', bid ? 'Back to the Broadcast' : 'Done');
    return;
  }
  nalunoPayShow('Payment', '…', 'Stripe took you back here. Confirming the payment…', bid ? 'Back to the Broadcast' : 'Done');
  for(let i = 0; i < 20; i++){
    const done = await nalunoPayConfirmed(k, ref);
    if(done){
      let amount = '';
      try{ if(done.amount_minor && done.currency) amount = formatSupportMoney(done.amount_minor, done.currency) + ' '; }catch(_){}
      const tail = k === 'support' ? ('reached ' + ((pending && pending.name) ? String(pending.name).split(' ')[0] : 'the creator') + '. Thank you.')
        : (k === 'ad' ? 'is paid. It goes live once it is reviewed.' : 'is on your Callsign.');
      nalunoPayShow('Paid', '✓', what + ' ' + (amount ? '(' + amount.trim() + ') ' : '') + tail, bid ? 'Back to the Broadcast' : 'Done');
      try{ renderSupportTab(); }catch(_){}
      return;
    }
    await new Promise(function(r){ setTimeout(r, 2000); });
  }
  nalunoPayShow('Payment', '…', 'No confirmation from Stripe yet. If you paid, it can take a minute; it shows under Support as “succeeded” once Stripe confirms it. Paying again would charge you again.', bid ? 'Back to the Broadcast' : 'Done');
}

/* ---------------- 29g: creators get paid (Stripe Connect) ---------------- */
let __payoutCache = null;
async function nalunoPayoutCall(path, method){
  if(typeof currentUser === 'undefined' || !currentUser) throw new Error('Sign in first');
  const idToken = await currentUser.getIdToken(false);
  const res = await fetch(ECONOMY_UI_WORKER + path, { method: method || 'POST', headers: { 'Authorization': 'Bearer ' + idToken } });
  const data = await res.json().catch(function(){ return {}; });
  if(!res.ok || !data.ok){ const e = new Error(data.error || 'Payouts aren’t available right now.'); e.data = data; throw e; }
  return data;
}
async function nalunoPayoutStatus(force){
  if(!force && __payoutCache && Date.now() - __payoutCache.at < 60000) return __payoutCache.st;
  try{
    const st = await nalunoPayoutCall('/v1/pay/connect/status', 'GET');
    __payoutCache = { at: Date.now(), st: st };
    return st;
  }catch(_){ return null; }
}
async function nalunoStartPayouts(){
  const b = $('payoutStartBtn');
  if(b){ b.disabled = true; b.textContent = 'Opening Stripe…'; }
  try{
    const d = await nalunoPayoutCall('/v1/pay/connect', 'POST');
    window.location.href = d.url;
  }catch(e){
    if(b){ b.disabled = false; b.textContent = 'Set up payouts with Stripe'; }
    const line = $('payoutLine');
    nalunoShowStripeSetup(line || b, e);
    const msg = $('payoutMsg');
    const text = (e && e.message) || 'Payouts aren’t available right now.';
    if(msg) msg.textContent = text;
    toast(text);
  }
}
function paintPayoutBlock(host){
  if(!host || typeof currentUser === 'undefined' || !currentUser) return;
  let box = host.querySelector('.payout-block');
  if(!box){
    box = document.createElement('div');
    box.className = 'payout-block';
    host.insertBefore(box, host.firstChild);
  }
  box.innerHTML = '<div class="section-label" style="padding:0 4px;">Creator Support · Stripe</div>'
    + '<p class="lobby-sub" id="payoutLine" style="text-align:left;max-width:none;font-size:11.5px;margin:4px 0 8px;">Checking…</p>'
    + '<button type="button" class="support-row-cta payout-btn" id="payoutStartBtn" hidden>Set up payouts with Stripe</button>'
    + '<p class="lobby-sub" id="payoutMsg" style="text-align:left;max-width:none;font-size:11.5px;margin:6px 0 0;">Stripe here is only for Creator Support. It is not monetisation.</p>';
  const btn = box.querySelector('#payoutStartBtn');
  btn.onclick = nalunoStartPayouts;
  nalunoPayoutStatus(false).then(function(st){
    const line = box.querySelector('#payoutLine');
    if(!line) return;
    if(!st){ line.textContent = 'Creator Support payouts need the payment service. Support sent to you is still recorded. This is not monetisation.'; return; }
    if(st.ready){ line.textContent = 'Creator Support can go to your Stripe account. That is separate from monetisation.'; btn.hidden = true; return; }
    if(st.connected){ line.textContent = 'Stripe needs a few more details before it can pay you.'; btn.textContent = 'Finish setting up on Stripe'; btn.hidden = false; return; }
    line.textContent = 'To receive Creator Support, connect a Stripe account. This is not how monetisation is paid.';
    btn.hidden = false;
  });
}
function canonUgandaMomo(raw, network){
  let d = String(raw || '').replace(/\D/g, '');
  if(d.indexOf('0') === 0 && d.length === 10) d = '256' + d.slice(1);
  else if(d.length === 9 && d.charAt(0) === '7') d = '256' + d;
  if(!/^2567\d{8}$/.test(d)) return { error: 'Enter a Uganda mobile-money number. Nothing was saved.' };
  const pre = d.slice(3, 5);
  let guess = '';
  if(pre === '76' || pre === '77' || pre === '78' || pre === '79') guess = 'mtn';
  else if(pre === '70' || pre === '74' || pre === '75') guess = 'airtel';
  const net = network === 'mtn' || network === 'airtel' ? network : guess;
  if(net !== 'mtn' && net !== 'airtel') return { error: 'Choose MTN or Airtel. Nothing was saved.' };
  if(guess && guess !== net) return { error: 'That number is not on the network you chose. Nothing was saved.' };
  return { phone: d, network: net, phone_tail: d.slice(-4) };
}
function paintMomoReceive(host){
  if(!host || typeof currentUser === 'undefined' || !currentUser) return;
  let box = host.querySelector('.momo-receive');
  if(!box){
    box = document.createElement('div');
    box.className = 'momo-receive';
    box.style.marginTop = '14px';
    host.appendChild(box);
  }
  box.innerHTML = '<div class="section-label" style="padding:0 4px;">Receive on MTN or Airtel</div>'
    + '<p class="lobby-sub" style="text-align:left;max-width:none;font-size:11.5px;margin:4px 0 8px;">This is your number, for Creator Support people send you. Uganda only. Saving it does not pay you, and it does not turn monetisation on. If monetisation is turned on later, Naluno can use this same number.</p>'
    + '<select id="momoNet" style="width:100%;margin:0 0 8px;padding:10px;border-radius:10px;background:var(--surface);color:var(--text);border:1px solid var(--line);">'
    + '<option value="mtn">MTN</option><option value="airtel">Airtel</option></select>'
    + '<input id="momoPhone" type="tel" inputmode="tel" autocomplete="off" placeholder="07… mobile money number" style="width:100%;margin:0 0 8px;padding:10px;border-radius:10px;background:var(--surface);color:var(--text);border:1px solid var(--line);" />'
    + '<button type="button" class="support-row-cta" id="momoSaveBtn">Save number</button>'
    + '<p class="lobby-sub" id="momoLine" style="text-align:left;max-width:none;font-size:11.5px;margin:8px 0 0;"></p>';
  const line = box.querySelector('#momoLine');
  const net = box.querySelector('#momoNet');
  const phone = box.querySelector('#momoPhone');
  const btn = box.querySelector('#momoSaveBtn');
  function say(t){ if(line) line.textContent = t; }
  if(typeof fbDb !== 'undefined' && fbDb){
    fbDb.collection('creatorPayoutMethods').doc(currentUser.uid).get().then(function(snap){
      const d = snap && snap.exists && snap.data ? (snap.data() || {}) : {};
      if(d.network && net) net.value = d.network;
      if(d.network && d.phone_tail) say(String(d.network).toUpperCase() + ' ending ' + d.phone_tail + ' is saved. Nothing has been paid.');
    }).catch(function(){});
  }
  if(btn) btn.onclick = async function(){
    const got = canonUgandaMomo(phone && phone.value, net && net.value);
    if(got.error){ say(got.error); return; }
    if(typeof fbDb === 'undefined' || !fbDb){ say('Sign in again, then save. Nothing was saved.'); return; }
    btn.disabled = true;
    try{
      await fbDb.collection('creatorPayoutMethods').doc(currentUser.uid).set({
        phone: got.phone,
        network: got.network,
        phone_tail: got.phone_tail,
        updatedAt: Date.now(),
      });
      if(phone) phone.value = '';
      say(got.network.toUpperCase() + ' ending ' + got.phone_tail + ' is saved. Nothing has been paid.');
    }catch(e){
      say((e && e.message) || 'Could not save that number. Nothing was paid.');
    }
    btn.disabled = false;
  };
}

(function(){
  function go(){ try{ nalunoHandlePayReturn(); }catch(_){} }
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go);
  else setTimeout(go, 0);
})();

window.openContributionPanel = openContributionPanel;
window.nalunoHandlePayReturn = nalunoHandlePayReturn;
window.nalunoPayRemember = nalunoPayRemember;
window.openSupportSheet = openSupportSheet;
window.closeSupportSheet = closeSupportSheet;
window.nalunoSupportButtonHtml = nalunoSupportButtonHtml;
window.paintBspaceSupportButton = paintBspaceSupportButton;
window.renderSupportTab = renderSupportTab;
window.stripSupportNavTab = stripSupportNavTab;
window.canonUgandaMomo = canonUgandaMomo;
