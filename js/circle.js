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
    return ref.get().then(function(snap){
      const d = snap.exists ? (snap.data() || {}) : {};
      const same = d.monthKey === monthKey;
      const next = Object.assign({}, patch, {
        monthKey: monthKey,
        viewsMonth: (same ? (d.viewsMonth || 0) : 0) + (patch.viewsMonthDelta || 0),
        circleMonth: (same ? (d.circleMonth || 0) : 0) + (patch.circleMonthDelta || 0),
        engageMonth: (same ? (d.engageMonth || 0) : 0) + (patch.engageMonthDelta || 0),
        updatedAt: Date.now(),
      });
      delete next.viewsMonthDelta;
      delete next.circleMonthDelta;
      delete next.engageMonthDelta;
      next.scoreMonth = (next.viewsMonth || 0) + (next.circleMonth || 0) * 12 + (next.engageMonth || 0) * 3;
      return ref.set(next, { merge: true });
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
      await fbDb.collection('broadcasts').doc(broadcastId).set({
        views: firebase.firestore.FieldValue.increment(1),
        uniqueViews: firebase.firestore.FieldValue.increment(1),
      }, { merge: true });
      if(creatorUid){
        await bumpTogaMonth(creatorUid, {
          viewsMonthDelta: 1,
          featuredBroadcastId: broadcastId,
        });
        await fbDb.collection('toga').doc(creatorUid).set({
          viewsTotal: firebase.firestore.FieldValue.increment(1),
          featuredBroadcastId: broadcastId,
          updatedAt: Date.now(),
        }, { merge: true });
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
          recordBroadcastView(broadcastId, creatorUid);
          try{ if(typeof paintBspaceViews === 'function') paintBspaceViews(window.activeBroadcastMeta || { creatorUid: creatorUid, views: 0 }); }catch(_){}
        }
      }catch(_){}
    }, 1000);
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
      shareEl.textContent = myShareViews ? 'Views shared — you can stand in Toga' : 'Views private — hidden from Toga';
      shareEl.classList.toggle('on', myShareViews);
    }
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
    try{
      const snap = await fbDb.collection('toga').limit(80).get();
      const rows = snap.docs.map(function(d){ return { id: d.id, ...(d.data() || {}) }; })
        .filter(function(r){ return r.shareViews !== false; })
        .map(function(r){
          const same = r.monthKey === monthKey;
          const viewsM = same ? (r.viewsMonth || 0) : 0;
          const circleM = same ? (r.circleMonth || 0) : 0;
          const engageM = same ? (r.engageMonth || 0) : 0;
          const score = same && r.scoreMonth
            ? r.scoreMonth
            : (viewsM + circleM * 12 + engageM * 3) || (r.viewsTotal || 0);
          return Object.assign(r, { _score: score, _viewsM: viewsM, _circleM: circleM });
        })
        .sort(function(a,b){ return (b._score||0) - (a._score||0); })
        .slice(0, 10);
      if(!rows.length){
        el.innerHTML = '<div class="lobby-sub">Share your views. Watch time, Circle joins, and conversation write the Wall of Fame each month.</div>';
        return;
      }
      el.innerHTML = '<div class="toga-grid">' + rows.map(function(r, i){
        const openId = r.featuredBroadcastId || '';
        return '<button type="button" class="toga-card" data-toga-uid="'+escapeHtml(r.id)+'" data-bcast="'+(openId ? escapeHtml(openId) : '')+'">'
          + '<div class="toga-card-k">#' + (i+1) + ' · this month</div>'
          + '<div class="toga-card-name">' + escapeHtml(r.name || 'Creator') + '</div>'
          + '<div class="toga-card-v">' + formatNalunoViews(r._viewsM || r.viewsTotal || 0) + '</div>'
          + '<div class="toga-card-h">' + formatNalunoViews(r._circleM || 0) + ' joined Circle</div>'
          + '</button>';
      }).join('') + '</div>';
      el.querySelectorAll('[data-toga-uid]').forEach(function(card){
        card.onclick = function(){
          const bid = card.getAttribute('data-bcast');
          const uid = card.getAttribute('data-toga-uid');
          if(bid && typeof openBroadcastById === 'function'){
            openBroadcastById(bid);
            return;
          }
          const pool = (typeof feedBroadcasts !== 'undefined' && feedBroadcasts) ? feedBroadcasts : [];
          const hit = pool.find(function(b){ return b.creatorUid === uid && !b.deleted; });
          if(hit && typeof openBroadcastById === 'function') openBroadcastById(hit.id);
          else toast('Open a Broadcast from their plates below');
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
})();
