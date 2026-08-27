/* OWNERSHIP (circle.js): join the creator, views, Toga.
   MUST NOT touch calls / WebRTC. */
(function(){
  const joinedCreators = {};
  const viewedLocal = {};
  let myShareViews = true;
  let myTogaIn = false;

  function formatNalunoViews(n){
    n = Number(n) || 0;
    if(n < 1000) return String(Math.floor(n));
    if(n < 10000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
    if(n < 1000000) return Math.round(n / 1000) + 'k';
    return (n / 1000000).toFixed(1).replace(/\.0$/, '') + 'm';
  }

  function canShowViews(creatorUid, shareFlag){
    if(currentUser && creatorUid === currentUser.uid) return true;
    if(typeof shareFlag === 'boolean') return shareFlag;
    return true;
  }

  async function creatorCircleJoined(creatorUid){
    if(!creatorUid) return false;
    if(currentUser && creatorUid === currentUser.uid) return true;
    if(joinedCreators[creatorUid]) return true;
    if(!fbDb || !currentUser) return false;
    try{
      const snap = await fbDb.collection('users').doc(creatorUid).collection('circle').doc(currentUser.uid).get();
      if(snap.exists){ joinedCreators[creatorUid] = true; return true; }
    }catch(_){}
    return false;
  }

  async function joinCreatorCircle(creatorUid, broadcastId){
    if(!currentUser || !fbDb || !creatorUid) throw new Error('Sign in to join');
    if(creatorUid === currentUser.uid) return;
    const name = (currentProfile && currentProfile.name) || currentUser.displayName || 'Someone';
    await fbDb.collection('users').doc(creatorUid).collection('circle').doc(currentUser.uid).set({
      joinedAt: Date.now(),
      name: name,
    }, { merge: true });
    joinedCreators[creatorUid] = true;
    try{ await bumpTogaMonth(creatorUid, { circleMonthDelta: 1 }); }catch(_){}
    if(broadcastId){
      try{
        await fbDb.collection('broadcasts').doc(broadcastId).set({
          memberUids: firebase.firestore.FieldValue.arrayUnion(currentUser.uid),
          updatedAt: Date.now(),
        }, { merge: true });
        await fbDb.collection('broadcasts').doc(broadcastId).collection('journey').add({
          type: 'join',
          text: name + ' joined ' + 'this creator',
          ts: Date.now(),
          by: currentUser.uid,
        });
      }catch(_){}
    }
  }

  function nalunoMonthKey(){
    const d = new Date();
    return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0');
  }

  function bumpTogaMonth(creatorUid, patch){
    if(!fbDb || !creatorUid) return Promise.resolve();
    const monthKey = nalunoMonthKey();
    const ref = fbDb.collection('toga').doc(creatorUid);
    // LOCK (bug 3.2): transaction so concurrent views/joins cannot overwrite each other.
    return fbDb.runTransaction(function(tx){
      return tx.get(ref).then(function(snap){
        const d = snap.exists ? (snap.data() || {}) : {};
        const same = d.monthKey === monthKey;
        const viewsMonth = (same ? (d.viewsMonth || 0) : 0) + (patch.viewsMonthDelta || 0);
        const circleMonth = (same ? (d.circleMonth || 0) : 0) + (patch.circleMonthDelta || 0);
        const engageMonth = (same ? (d.engageMonth || 0) : 0) + (patch.engageMonthDelta || 0);
        const next = {
          monthKey: monthKey,
          viewsMonth: viewsMonth,
          circleMonth: circleMonth,
          engageMonth: engageMonth,
          scoreMonth: viewsMonth + circleMonth * 12 + engageMonth * 3,
          updatedAt: Date.now(),
        };
        if(patch.featuredBroadcastId) next.featuredBroadcastId = patch.featuredBroadcastId;
        if(patch.name) next.name = patch.name;
        if(patch.viewsTotal != null) next.viewsTotal = patch.viewsTotal;
        tx.set(ref, next, { merge: true });
      });
    }).catch(function(){});
  }

  async function recordBroadcastView(broadcastId, creatorUid){
    if(!fbDb || !broadcastId) return;
    if(currentUser && creatorUid && currentUser.uid === creatorUid) return;
    const key = broadcastId + ':' + ((currentUser && currentUser.uid) || 'anon');
    if(viewedLocal[key]) return;
    viewedLocal[key] = true;
    if(!currentUser) return;
    try{
      const viewerRef = fbDb.collection('broadcasts').doc(broadcastId).collection('viewers').doc(currentUser.uid);
      const snap = await viewerRef.get();
      if(snap.exists) return;
      await viewerRef.set({ ts: Date.now() });
      // FIX (data-integrity risk found while investigating the view-count
      // mismatch report): "This Broadcast" (broadcasts/{id}.views) and "All
      // of yours" (toga/{creator}.viewsTotal) used to be written as two
      // separate, non-atomic Firestore calls, with a whole extra async step
      // (bumpTogaMonth's own transaction) in between them. Anything
      // interrupting execution between those two writes — navigating away,
      // losing connection, the tab closing — could leave one incremented
      // and the other not, a real, permanent mismatch between the two
      // numbers, not just a display timing issue. Batched so both the
      // broadcast's own view count and the creator's aggregate total commit
      // together or not at all.
      const batch = fbDb.batch();
      batch.set(fbDb.collection('broadcasts').doc(broadcastId), {
        views: firebase.firestore.FieldValue.increment(1),
        uniqueViews: firebase.firestore.FieldValue.increment(1),
      }, { merge: true });
      if(creatorUid){
        batch.set(fbDb.collection('toga').doc(creatorUid), {
          viewsTotal: firebase.firestore.FieldValue.increment(1),
          featuredBroadcastId: broadcastId,
          updatedAt: Date.now(),
        }, { merge: true });
      }
      await batch.commit();
      if(creatorUid){
        // bumpTogaMonth is its own transaction (reads-then-writes monthly
        // fields with rollover logic) — kept separate from the batch above
        // since Firestore batches can't include a transaction's reads, but
        // still awaited before this function returns so a caller who awaits
        // recordBroadcastView() sees fully-settled numbers either way.
        await bumpTogaMonth(creatorUid, {
          viewsMonthDelta: 1,
          featuredBroadcastId: broadcastId,
        });
      }
    }catch(e){ console.warn('[circle] view', e); }
  }

  let viewWatchTimer = null;
  function armBroadcastViewWatch(broadcastId, creatorUid, isMine){
    if(viewWatchTimer){ clearInterval(viewWatchTimer); viewWatchTimer = null; }
    if(isMine || !broadcastId) return;
    let seconds = 0;
    viewWatchTimer = setInterval(function(){
      try{
        const space = document.getElementById('bspace');
        if(!space || !space.classList.contains('active')){
          clearInterval(viewWatchTimer); viewWatchTimer = null; return;
        }
        const v = document.getElementById('bspaceVideoEl');
        const watching = v
          ? (!v.paused && (v.currentTime || 0) > 0.25)
          : true; // text/photo rooms: overlay open counts as watching
        if(watching) seconds += 1;
        if(seconds >= 4){
          clearInterval(viewWatchTimer); viewWatchTimer = null;
          // FIX ("This Broadcast" not reflecting a view that "All of yours"
          // seemed to): recordBroadcastView() was fired without awaiting it,
          // with the repaint called on the very next line — a real race.
          // recordBroadcastView does several chained Firestore writes
          // (checking/creating a viewers doc, then incrementing views,
          // then the toga totals) that take real network time; the repaint
          // was reading the broadcast and toga docs back before any of that
          // had actually landed, so it always showed the count from
          // *before* this view, on both stats equally — not a difference
          // between them, just neither one reflecting the view that had
          // only just been kicked off. Awaiting it first means the repaint
          // reads the real, post-increment numbers.
          recordBroadcastView(broadcastId, creatorUid).then(function(){
            try{ if(typeof paintBspaceViews === 'function') paintBspaceViews(window.activeBroadcastMeta || { creatorUid: creatorUid, views: 0 }); }catch(_){}
          }).catch(function(){});
        }
      }catch(_){}
    }, 1000);
  }

  function nalunoMonthLabel(){
    try{
      return new Date().toLocaleString('en', { month: 'long', year: 'numeric' });
    }catch(_){
      const d = new Date();
      return d.toUTCString().split(' ')[2] + ' ' + d.getUTCFullYear();
    }
  }

  /** Days left in the current calendar-month Toga period (UTC, matching
   *  nalunoMonthKey() above) — purely a display computation, no new data. */
  function nalunoDaysRemainingInPeriod(){
    const now = new Date();
    const y = now.getUTCFullYear(), m = now.getUTCMonth();
    const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    return Math.max(1, lastDay - now.getUTCDate());
  }

  /** Visual-refresh only: remembers each creator's rank position from the
   *  last time this rendered, purely to show ↑ / ↓ / NEW / — next to their
   *  name — the ranking itself is entirely unchanged, this only diffs
   *  against what was already computed. Stored client-side (same pattern
   *  used throughout the app for instant-paint caches), keyed by month so
   *  it naturally resets when a new Toga period begins, exactly like the
   *  real ranking does. Never read by anything that decides who's actually
   *  in the list or in what order. */
  function nalunoTogaRankDelta(monthKey, currentRanksByUid){
    let prev = {};
    try{
      const raw = (typeof nalunoCacheRead === 'function') ? nalunoCacheRead('togaRanks:' + monthKey) : null;
      if(raw && typeof raw === 'object') prev = raw;
    }catch(_){}
    const deltas = {};
    Object.keys(currentRanksByUid).forEach(function(uid){
      const now = currentRanksByUid[uid];
      const before = prev[uid];
      if(before == null) deltas[uid] = { kind: 'new' };
      else if(before === now) deltas[uid] = { kind: 'same' };
      else if(before > now) deltas[uid] = { kind: 'up', by: before - now };
      else deltas[uid] = { kind: 'down', by: now - before };
    });
    try{
      if(typeof nalunoCacheWrite === 'function') nalunoCacheWrite('togaRanks:' + monthKey, currentRanksByUid);
    }catch(_){}
    return deltas;
  }

  function openCreatorTogaBroadcast(uid, bid){
    function go(id){
      if(id && typeof openBroadcastById === 'function'){
        openBroadcastById(id);
        return true;
      }
      return false;
    }
    if(bid && go(bid)) return;
    const pool = (typeof feedBroadcasts !== 'undefined' && feedBroadcasts) ? feedBroadcasts : [];
    const hit = pool.filter(function(b){ return b && b.creatorUid === uid && !b.deleted; })
      .sort(function(a,b){ return (b.createdAt||0) - (a.createdAt||0); })[0];
    if(hit && go(hit.id)) return;
    if(!fbDb || !uid){
      toast('Open a Broadcast from their plates below');
      return;
    }
    fbDb.collection('broadcasts').where('creatorUid', '==', uid).limit(12).get().then(function(snap){
      const docs = snap.docs.map(function(d){ return { id: d.id, ...(d.data() || {}) }; })
        .filter(function(b){ return !b.deleted; })
        .sort(function(a,b){ return (b.createdAt||0) - (a.createdAt||0); });
      if(docs[0]) go(docs[0].id);
      else toast('No Broadcast from them yet');
    }).catch(function(){ toast('Open a Broadcast from their plates below'); });
  }

  async function loadMyTogaSettings(){
    if(!fbDb || !currentUser) return;
    try{
      const snap = await fbDb.collection('toga').doc(currentUser.uid).get();
      if(snap.exists){
        const d = snap.data() || {};
        myShareViews = d.shareViews !== false;
        myTogaIn = !!d.togaIn && myShareViews;
      }
    }catch(_){}
    const shareEl = $('togaShareBtn');
    if(shareEl){
      shareEl.textContent = myShareViews ? 'Views public — you can stand in Toga' : 'Views private — hidden from Toga';
      shareEl.classList.toggle('on', myShareViews);
    }
    const monthEl = $('togaMonthLabel');
    if(monthEl) monthEl.textContent = nalunoMonthLabel();
  }

  async function setMyToga(shareViews, togaIn){
    if(!currentUser || !fbDb){ toast('Sign in to change Toga'); return; }
    myShareViews = !!shareViews;
    myTogaIn = myShareViews;
    const name = (currentProfile && currentProfile.name) || currentUser.displayName || 'Someone';
    await fbDb.collection('toga').doc(currentUser.uid).set({
      shareViews: myShareViews,
      togaIn: myTogaIn,
      name: name,
      monthKey: nalunoMonthKey(),
      updatedAt: Date.now(),
    }, { merge: true });
    try{
      await fbDb.collection('users').doc(currentUser.uid).set({
        shareViews: myShareViews,
        togaIn: myTogaIn,
      }, { merge: true });
    }catch(_){}
    await loadMyTogaSettings();
    await renderTogaBoard();
  }

  async function renderTogaBoard(){
    const el = $('togaBoard');
    if(!el || !fbDb) return;
    const monthKey = nalunoMonthKey();
    const monthEl = $('togaMonthLabel');
    if(monthEl) monthEl.textContent = nalunoMonthLabel();
    try{
      const snap = await fbDb.collection('toga').limit(80).get();
      const byId = {};
      snap.docs.forEach(function(d){
        byId[d.id] = Object.assign({ id: d.id }, d.data() || {});
      });
      // Fill names / featured Broadcast from the live feed so a tap always has somewhere to go.
      try{
        const pool = (typeof feedBroadcasts !== 'undefined' && feedBroadcasts) ? feedBroadcasts : [];
        pool.forEach(function(b){
          if(!b || b.deleted || !b.creatorUid) return;
          if(b.shareViews === false) return;
          if(!byId[b.creatorUid]){
            byId[b.creatorUid] = {
              id: b.creatorUid,
              name: b.creatorName || 'Creator',
              shareViews: true,
              viewsTotal: 0,
              featuredBroadcastId: b.id,
            };
          }
          const row = byId[b.creatorUid];
          if(!row.name && b.creatorName) row.name = b.creatorName;
          row.viewsTotal = (row.viewsTotal || 0);
          if(!row.featuredBroadcastId || (b.createdAt || 0) > (row._featTs || 0)){
            row.featuredBroadcastId = b.id;
            row._featTs = b.createdAt || 0;
          }
        });
      }catch(_){}
      const rows = Object.keys(byId).map(function(k){ return byId[k]; })
        .filter(function(r){ return r.shareViews !== false; })
        .map(function(r){
          const same = r.monthKey === monthKey;
          const viewsM = same ? (r.viewsMonth || 0) : 0;
          const circleM = same ? (r.circleMonth || 0) : 0;
          const engageM = same ? (r.engageMonth || 0) : 0;
          // FIX: this board is explicitly monthly ("Wall of Fame · list lives 30
          // days"). The score AND every number shown next to a name must be the
          // same monthly figures — no falling back to lifetime totals for rows
          // with 0 activity this month, since that silently swapped what "views"
          // meant row-to-row (one person's monthly count next to another
          // person's all-time count, both under the same "views" label) and let
          // stale lifetime totals outrank real monthly activity.
          const score = (same && r.scoreMonth) ? r.scoreMonth : (viewsM + circleM * 12 + engageM * 3);
          return Object.assign(r, { _score: score, _viewsM: viewsM, _circleM: circleM, _engageM: engageM });
        })
        .sort(function(a,b){ return (b._score||0) - (a._score||0); })
        .slice(0, 10);
      if(!rows.length){
        el.innerHTML = '<div class="lobby-sub" style="text-align:left;max-width:none;">This month’s Wall of Fame is empty. Share your views, then watch time, Circle joins, and conversation write the ten names. Views must be public to qualify. The list lives 30 days.</div>';
        return;
      }
      // Visual refresh only — see nalunoTogaRankDelta() above. Ranking order
      // and who qualifies are entirely unchanged above this line; this just
      // decides what badge (↑ / ↓ / NEW / —) shows next to each name.
      const ranksByUid = {};
      rows.forEach(function(r, i){ ranksByUid[r.id] = i + 1; });
      const deltas = nalunoTogaRankDelta(monthKey, ranksByUid);
      el.innerHTML = '<ol class="toga-list">' + rows.map(function(r, i){
        const openId = r.featuredBroadcastId || '';
        const rank = i + 1;
        const d = deltas[r.id] || { kind: 'same' };
        let badge = '';
        if(d.kind === 'new') badge = '<span class="toga-delta toga-delta-new">NEW</span>';
        else if(d.kind === 'up') badge = '<span class="toga-delta toga-delta-up">▲' + d.by + '</span>';
        else if(d.kind === 'down') badge = '<span class="toga-delta toga-delta-down">▼' + d.by + '</span>';
        else badge = '<span class="toga-delta toga-delta-same">—</span>';
        return '<li><button type="button" class="toga-name-row toga-rank-' + Math.min(rank,4) + '" data-toga-uid="'+escapeHtml(r.id)+'" data-bcast="'+(openId ? escapeHtml(openId) : '')+'">'
          + '<span class="toga-rank">#' + rank + '</span>'
          + '<span class="toga-name-block">'
          +   '<span class="toga-card-name">' + escapeHtml(r.name || 'Creator') + badge + '</span>'
          +   '<span class="toga-card-h">' + formatNalunoViews(r._viewsM) + ' views this month · '
          +     formatNalunoViews(r._circleM || 0) + ' Circle · '
          +     formatNalunoViews(r._engageM || 0) + ' talk</span>'
          + '</span>'
          + '<span class="toga-card-v">' + formatNalunoViews(r._score || 0) + '</span>'
          + '</button></li>';
      }).join('') + '</ol>'
      + '<div class="toga-period-note">' + nalunoMonthLabel() + ' · ' + nalunoDaysRemainingInPeriod() + ' days remaining in this Wall of Fame</div>';
      el.querySelectorAll('[data-toga-uid]').forEach(function(card){
        card.onclick = function(e){
          if(e){ e.preventDefault(); e.stopPropagation(); }
          openCreatorTogaBroadcast(card.getAttribute('data-toga-uid'), card.getAttribute('data-bcast'));
        };
      });
    }catch(e){
      el.innerHTML = '<div class="lobby-sub">Toga loads after sign-in.</div>';
    }
  }

  async function creatorShareViews(creatorUid){
    if(!creatorUid || !fbDb) return true;
    try{
      const snap = await fbDb.collection('toga').doc(creatorUid).get();
      if(snap.exists){
        const d = snap.data() || {};
        return d.shareViews !== false;
      }
    }catch(_){}
    return true;
  }

  function wireToga(){
    const share = $('togaShareBtn');
    if(share) share.onclick = function(){ setMyToga(!myShareViews, myShareViews); };
    const exp = $('togaExpandBtn');
    const body = $('togaBody');
    const monthEl = $('togaMonthLabel');
    if(monthEl) monthEl.textContent = nalunoMonthLabel();
    function setTogaOpen(open){
      if(!exp || !body) return;
      body.style.display = open ? 'block' : 'none';
      try{ body.hidden = !open; }catch(_){}
      exp.setAttribute('aria-expanded', open ? 'true' : 'false');
      exp.classList.toggle('open', !!open);
      const hint = $('togaExpandHint');
      if(hint) hint.textContent = open ? 'close' : 'Wall of Fame · tap';
      if(open) renderTogaBoard();
    }
    if(exp && body){
      exp.onclick = function(e){
        if(e){ e.preventDefault(); e.stopPropagation(); }
        const isOpen = body.style.display !== 'none' && !body.hidden;
        setTogaOpen(!isOpen);
      };
    }
  }
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wireToga);
  else wireToga();

  window.formatNalunoViews = formatNalunoViews;
  window.canShowViews = canShowViews;
  window.creatorCircleJoined = creatorCircleJoined;
  window.joinCreatorCircle = joinCreatorCircle;
  window.recordBroadcastView = recordBroadcastView;
  window.armBroadcastViewWatch = armBroadcastViewWatch;
  window.loadMyTogaSettings = loadMyTogaSettings;
  window.setMyToga = setMyToga;
  window.renderTogaBoard = renderTogaBoard;
  window.creatorShareViews = creatorShareViews;
  window.bumpTogaMonth = bumpTogaMonth;
})();
