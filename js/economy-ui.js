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
  try{
    if(typeof NalunoCurrency !== 'undefined' && NalunoCurrency && NalunoCurrency.supportPresets){
      return NalunoCurrency.supportPresets();
    }
  }catch(_){}
  return [
    { major: 5, minor: 500, currency: 'AED', label: 'AED 5' },
    { major: 10, minor: 1000, currency: 'AED', label: 'AED 10' },
    { major: 25, minor: 2500, currency: 'AED', label: 'AED 25' },
  ];
}

function supportIsOn(){
  return typeof nalunoEconomyFlag === 'function' && nalunoEconomyFlag('creator_support_enabled');
}

function supportEsc(s){
  if(typeof escapeHtml === 'function') return escapeHtml(String(s == null ? '' : s));
  return String(s == null ? '' : s)
    .replace(/&/g, '&').replace(/</g, '<').replace(/>/g, '>')
    .replace(/"/g, '"');
}

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
    + '<div style="font-family:var(--font-futuristic);font-size:26px;color:var(--mint);">' + supportEsc(String(me.contribution_points)) + '</div>'
    + '<div class="lobby-sub" style="text-align:left;max-width:none;font-size:11.5px;margin-top:4px;">A measure of what you have added — not money, and not a promise of money.</div>'
    + '</div>'
    + '<div class="bspace-card" style="margin-bottom:10px;">'
    + '<div class="who">Eligible Contribution</div>'
    + '<div style="font-family:var(--font-futuristic);font-size:22px;">' + supportEsc(String(me.eligible_contribution)) + '</div>'
    + '<div class="lobby-sub" style="text-align:left;max-width:none;font-size:11.5px;margin-top:4px;">The part that would count toward any future community rewards.</div>'
    + '</div>'
    + '<div class="bspace-card">'
    + '<div class="who">Contribution Trust</div>'
    + '<div style="font-family:var(--font-futuristic);font-size:18px;">' + supportEsc(trustLabel) + '</div>'
    + '<div class="lobby-sub" style="text-align:left;max-width:none;font-size:11.5px;margin-top:4px;">Grows as your account establishes a normal, genuine history.</div>'
    + '</div>'
    + '<div class="lobby-sub" style="text-align:left;max-width:none;margin-top:14px;font-size:11.5px;">'
    + 'Community rewards are not active. Nothing here is currency, and no payment is owed to or by anyone.'
    + '</div>';
}

/* ---------------- Creator Support (Broadcast, below Circle) ----------------
   The panel is ALWAYS painted inside a Broadcast. The flag only flips
   active / inactive. Inactive still opens — it just cannot record an intent. */

function nalunoSupportButtonHtml(){
  const on = supportIsOn();
  return '<button type="button" id="bspaceSupportBtn" class="bspace-support-btn' + (on ? '' : ' off') + '"'
    + ' title="' + (on ? 'Support this creator' : 'Creator Support is off') + '">'
    + (on ? 'Support creator' : 'Support · off')
    + '</button>';
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

function paintBspaceSupportButton(){
  stripSupportNavTab();
  const host = $('bspaceSupportSlot') || $('bspaceJoinBtn');
  if(!host) return;
  let btn = $('bspaceSupportBtn');
  const on = supportIsOn();
  if(!btn){
    if($('bspaceSupportSlot')){
      const slot = $('bspaceSupportSlot');
      if(slot && !slot.querySelector('.bspace-support-panel')){
        slot.innerHTML = '<div class="bspace-support-panel">'
          + '<div class="bspace-support-head"><div class="bspace-support-kicker">Support creator</div>'
          + '<span class="support-flag-chip" id="supportFlagChip">Off</span></div>'
          + '<div class="support-banner" id="supportBanner"></div>'
          + nalunoSupportButtonHtml()
          + '<div id="supportMine"></div></div>';
      }
      btn = $('bspaceSupportBtn');
    } else {
      const wrap = document.createElement('div');
      wrap.id = 'bspaceSupportSlot';
      wrap.className = 'bspace-support-slot';
      wrap.innerHTML = '<div class="bspace-support-panel">'
        + '<div class="bspace-support-head"><div class="bspace-support-kicker">Support creator</div>'
        + '<span class="support-flag-chip" id="supportFlagChip">Off</span></div>'
        + '<div class="support-banner" id="supportBanner"></div>'
        + nalunoSupportButtonHtml()
        + '<div id="supportMine"></div></div>';
      host.insertAdjacentElement('afterend', wrap);
      btn = $('bspaceSupportBtn');
    }
  }
  if(!btn) return;
  btn.classList.toggle('off', !on);
  const meta = (typeof activeBroadcastMeta !== 'undefined') ? activeBroadcastMeta : null;
  const first = meta && meta.creatorName ? String(meta.creatorName).split(' ')[0] : '';
  btn.textContent = on
    ? (first ? ('Support ' + first) : 'Support creator')
    : 'Support · off';
  btn.title = on ? 'Support this creator' : 'Creator Support is off';
  btn.onclick = function(){
    const m = (typeof activeBroadcastMeta !== 'undefined') ? activeBroadcastMeta : null;
    const uid = m && m.creatorUid;
    const name = m && m.creatorName;
    const bid = (typeof activeBroadcastId !== 'undefined') ? activeBroadcastId : '';
    openSupportSheet(uid, name, bid);
  };
  try{ renderSupportTab(); }catch(_){}
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
      ? '<strong>On.</strong> Support is voluntary and separate from watching, talking, or publishing. No payment is taken until a provider is connected — an intent is recorded, nothing is charged.'
      : '<strong>Off.</strong> This stays under Circle so you can see it. The operator has not switched Creator Support on, so nothing can be charged and no intent is recorded.';
  }
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
          + '<span class="support-row-name">' + supportEsc(c.name.split(' ')[0])
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
    amount: presets[1] ? presets[1].minor : (presets[0] && presets[0].minor) || 0,
    currency: supportCcy(),
  };
  const panel = $('supportSheet');
  const who = $('supportSheetWho');
  const hint = $('supportSheetHint');
  if(who) who.textContent = 'Support ' + String(__supportSheet.name).split(' ')[0];
  if(hint) hint.textContent = 'Voluntary. Separate from anything you earn. No payment is taken until a provider is connected. Amounts are in ' + supportCcy() + '.';
  const row = $('supportAmountRow');
  if(row){
    row.innerHTML = presets.map(function(p, i){
      const on = p.minor === __supportSheet.amount || (!__supportSheet.amount && i === 1);
      if(on) __supportSheet.amount = p.minor;
      return '<button type="button" class="support-amt' + (on ? ' on' : '') + '" data-minor="' + p.minor + '">' + supportEsc(p.label) + '</button>';
    }).join('');
    row.querySelectorAll('.support-amt').forEach(function(b){
      b.onclick = function(){
        __supportSheet.amount = Number(b.getAttribute('data-minor')) || 0;
        row.querySelectorAll('.support-amt').forEach(function(x){
          x.classList.toggle('on', x === b);
        });
      };
    });
  }
  const msg = $('supportSheetMsg');
  if(msg) msg.textContent = '';
  if(panel) panel.classList.add('active');
}

async function submitSupportIntent(){
  if(!supportIsOn()){
    toast('Creator Support is off. Nothing was charged.');
    return;
  }
  if(typeof currentUser === 'undefined' || !currentUser){ toast('Sign in first'); return; }
  const uid = __supportSheet.uid;
  const amountMinor = Number(__supportSheet.amount) || 0;
  if(!uid || !(amountMinor > 0)){ toast('Pick an amount'); return; }
  const sendBtn = $('supportSheetSend');
  if(sendBtn){ sendBtn.disabled = true; sendBtn.textContent = 'Recording…'; }
  const msg = $('supportSheetMsg');
  try{
    const idToken = await currentUser.getIdToken(false);
    const res = await fetch(ECONOMY_UI_WORKER + '/v1/support/intent', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + idToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        creator_user_id: uid,
        broadcast_id: __supportSheet.broadcastId || '',
        amount_minor: amountMinor,
        currency: __supportSheet.currency || supportCcy(),
        // §44: one key per attempt, so a retry can never charge twice.
        idempotency_key: 'sup_' + (crypto.randomUUID ? crypto.randomUUID() : (Date.now() + '' + Math.random())),
      }),
    });
    const body = await res.json().catch(function(){ return {}; });
    if(!res.ok || !body.ok){
      if(msg) msg.textContent = body.error || 'Support isn’t available yet';
      toast(body.error || 'Support isn’t available yet');
      return;
    }
    // §21: the client NEVER treats this as paid. There is no provider wired,
    // and even when there is, only a verified webhook may mark it succeeded.
    toast('Recorded — no payment was taken. Payments aren’t live yet.');
    closeSupportSheet();
    renderSupportTab();
  }catch(_){
    toast('Couldn’t reach the service — nothing was charged');
  }finally{
    if(sendBtn){ sendBtn.disabled = false; sendBtn.textContent = 'Record support'; }
  }
}

function wireSupportSheet(){
  const close = $('supportSheetClose');
  if(close) close.onclick = closeSupportSheet;
  document.querySelectorAll('#supportAmountRow .support-amt').forEach(function(b){
    b.onclick = function(){
      __supportSheet.amount = Number(b.getAttribute('data-minor')) || 1000;
      document.querySelectorAll('#supportAmountRow .support-amt').forEach(function(x){
        x.classList.toggle('on', x === b);
      });
    };
  });
  const send = $('supportSheetSend');
  if(send) send.onclick = submitSupportIntent;
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

window.openContributionPanel = openContributionPanel;
window.openSupportSheet = openSupportSheet;
window.closeSupportSheet = closeSupportSheet;
window.nalunoSupportButtonHtml = nalunoSupportButtonHtml;
window.paintBspaceSupportButton = paintBspaceSupportButton;
window.renderSupportTab = renderSupportTab;
window.stripSupportNavTab = stripSupportNavTab;
