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
    // Community Economy (spec §5) — action reported, value decided server-side.
    try{
      if(typeof nalunoTrack === 'function'){
        nalunoTrack('CREATOR_FOLLOW', {
          broadcast_id: broadcastId || '',
          target_type: 'creator',
          target_id: creatorUid,
          creator_uid: creatorUid,
        });
      }
    }catch(_){}
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

  async function leaveCreatorCircle(creatorUid, broadcastId){
    if(!currentUser || !fbDb || !creatorUid) throw new Error('Sign in to leave');
    if(creatorUid === currentUser.uid) return;
    await fbDb.collection('users').doc(creatorUid).collection('circle').doc(currentUser.uid).delete();
    delete joinedCreators[creatorUid];
    if(broadcastId){
      try{
        await fbDb.collection('broadcasts').doc(broadcastId).set({
          memberUids: firebase.firestore.FieldValue.arrayRemove(currentUser.uid),
          updatedAt: Date.now(),
        }, { merge: true });
      }catch(_){}
    }
  }

  function nalunoMonthKey(){
    const d = new Date();
    return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0');
  }

  /* Month-keyed field names. Writing this month's counters under their own
     field names means a new month simply starts at zero on its own — no read
     needed to detect rollover, which is what let this drop the transaction. */
  function togaMonthFields(monthKey){
    return {
      views:  'mv_' + monthKey,
      circle: 'mc_' + monthKey,
      engage: 'me_' + monthKey,
    };
  }

  /** Returns the plain-increment patch for this month's counters, so callers
   *  can fold it into an existing batch instead of issuing a separate write.
   *
   *  STRESS-TEST FIX (hot-document contention): this used to be a
   *  runTransaction() — read the toga doc, compute the new monthly totals,
   *  write them back. A transaction on a contended document retries and then
   *  FAILS. Simulating a popular creator with viewers all crossing the 4s
   *  view threshold in the same window showed the failure rate hitting 100%
   *  above roughly 20 concurrent viewers: every one of those views was
   *  silently lost, and Toga — the thing that ranks creators by exactly this
   *  number — under-counted precisely the creators doing best.
   *
   *  FieldValue.increment() is applied server-side without a read, so it has
   *  no read-write conflict to retry over. The month rollover logic that
   *  needed the read is gone because each month now writes to its own field
   *  names. Honest remaining limit: Firestore still guides ~1 sustained
   *  write/second per document, so a genuinely viral creator can still
   *  saturate this one doc. Fixing THAT properly needs sharded counters
   *  (N shard docs summed on read), which is a real architectural change and
   *  is written up rather than half-done here. This removes the failure mode
   *  that was losing data at ordinary scale. */
  function togaMonthIncrements(patch){
    const monthKey = nalunoMonthKey();
    const f = togaMonthFields(monthKey);
    const out = { monthKey: monthKey, updatedAt: Date.now() };
    if(patch.viewsMonthDelta)  out[f.views]  = firebase.firestore.FieldValue.increment(patch.viewsMonthDelta);
    if(patch.circleMonthDelta) out[f.circle] = firebase.firestore.FieldValue.increment(patch.circleMonthDelta);
    if(patch.engageMonthDelta) out[f.engage] = firebase.firestore.FieldValue.increment(patch.engageMonthDelta);
    if(patch.featuredBroadcastId) out.featuredBroadcastId = patch.featuredBroadcastId;
    if(patch.name) out.name = patch.name;
    return out;
  }

  function bumpTogaMonth(creatorUid, patch){
    if(!fbDb || !creatorUid) return Promise.resolve();
    return fbDb.collection('toga').doc(creatorUid)
      .set(togaMonthIncrements(patch || {}), { merge: true })
      .catch(function(){});
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
        // The monthly counters fold into this SAME write now that they're
        // plain increments rather than a transaction — one write to the toga
        // doc per view instead of two, which halves the pressure on it and
        // removes the retry-and-fail path entirely.
        batch.set(fbDb.collection('toga').doc(creatorUid), Object.assign({
          viewsTotal: firebase.firestore.FieldValue.increment(1),
        }, togaMonthIncrements({ viewsMonthDelta: 1, featuredBroadcastId: broadcastId })), { merge: true });
      }
      await batch.commit();
    }catch(e){ console.warn('[circle] view', e); }
  }

  /* 29g: what counts as a view is decided by the economy worker. The
     phone says "opened" when the Broadcast opens and "count it" once it has
     played for the console's number of seconds (economyConfig/viewRules);
     the worker checks that time on its own clock and counts at most one view
     per person. Only if the worker does not have the view route yet (an
     older deploy answers 404) does the phone fall back to writing the view
     itself, after the same console-set seconds. */
  const VIEW_WORKER = 'https://naluno-economy.naluno.workers.dev';
  let viewSecCache = null;
  /* 29h: follows the console setting live. */
  let viewRulesUnsub = null;
  function consoleViewSec(){
    if(!viewRulesUnsub && fbDb){
      try{
        viewRulesUnsub = fbDb.collection('economyConfig').doc('viewRules').onSnapshot(function(d){
          let n = Math.round(Number(d && d.exists ? (d.data() || {}).countAfterSec : 0));
          if(!isFinite(n) || n < 1) n = 4;
          viewSecCache = { at: Date.now(), sec: Math.min(120, n) };
        }, function(){ viewRulesUnsub = null; });
      }catch(_){ viewRulesUnsub = null; }
    }
    if(viewSecCache) return Promise.resolve(viewSecCache.sec);
    if(!fbDb) return Promise.resolve(4);
    return fbDb.collection('economyConfig').doc('viewRules').get().then(function(d){
      let n = Math.round(Number(d && d.exists ? (d.data() || {}).countAfterSec : 0));
      if(!isFinite(n) || n < 1) n = 4;
      n = Math.min(120, n);
      viewSecCache = { at: Date.now(), sec: n };
      return n;
    }).catch(function(){ return 4; });
  }
  async function viewCall(route, broadcastId){
    if(!currentUser) return { status: 0, data: {} };
    const token = await currentUser.getIdToken(false);
    const res = await fetch(VIEW_WORKER + '/v1/view/' + route, {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ broadcast_id: broadcastId }),
    });
    const data = await res.json().catch(function(){ return {}; });
    return { status: res.status, data: data || {} };
  }
  function viewCounted(broadcastId, creatorUid, views){
    try{
      if(typeof nalunoTrack === 'function'){
        nalunoTrack('WATCH_COMPLETION', { broadcast_id: broadcastId, target_type: 'broadcast', creator_uid: creatorUid || '' });
      }
    }catch(_){}
    try{
      const m = window.activeBroadcastMeta;
      if(m && typeof views === 'number' && (typeof activeBroadcastId === 'undefined' || activeBroadcastId === broadcastId)) m.views = Math.max(m.views || 0, views);
      if(typeof paintBspaceViews === 'function') paintBspaceViews(m || { creatorUid: creatorUid, views: views || 0 });
    }catch(_){}
  }
  async function serverCountView(broadcastId, creatorUid, tries){
    let r;
    try{ r = await viewCall('count', broadcastId); }catch(_){ return; }
    const d = r.data || {};
    if(d.code === 'wait' && (tries || 0) < 3){
      setTimeout(function(){ serverCountView(broadcastId, creatorUid, (tries || 0) + 1); }, Math.min(30000, (Number(d.wait_ms) || 1000) + 250));
      return;
    }
    if(d.ok && d.counted) viewCounted(broadcastId, creatorUid, d.views);
  }

  let viewWatchTimer = null;
  let viewWatchSeq = 0;
  function armBroadcastViewWatch(broadcastId, creatorUid, isMine){
    if(viewWatchTimer){ clearInterval(viewWatchTimer); viewWatchTimer = null; }
    const seq = ++viewWatchSeq;
    if(isMine || !broadcastId || !currentUser) return;
    if(currentUser && creatorUid && currentUser.uid === creatorUid) return;
    const key = broadcastId + ':' + currentUser.uid;
    if(viewedLocal[key]) return;
    let need = null;       // seconds, from the worker (or the console setting on fallback)
    let mode = null;       // 'server' | 'legacy' | 'off'
    viewCall('open', broadcastId).then(function(r){
      if(seq !== viewWatchSeq) return;
      if(r.data && r.data.ok){ mode = 'server'; need = Number(r.data.count_after_sec) || 4; return; }
      // Refused (bad sign-in, bad id): not a view. Anything else means the
      // worker cannot count right now (an older deploy, not configured, down).
      if(r.status === 400 || r.status === 401 || r.status === 403){ mode = 'off'; return; }
      mode = 'legacy';
      return consoleViewSec().then(function(n){ need = n; });
    }).catch(function(){
      if(seq !== viewWatchSeq) return;
      mode = 'legacy';
      return consoleViewSec().then(function(n){ need = n; });
    });
    let seconds = 0;
    viewWatchTimer = setInterval(function(){
      try{
        const space = document.getElementById('bspace');
        if(!space || !space.classList.contains('active') || seq !== viewWatchSeq){
          clearInterval(viewWatchTimer); viewWatchTimer = null; return;
        }
        const v = document.getElementById('bspaceVideoEl');
        const watching = v
          ? (!v.paused && (v.currentTime || 0) > 0.25)
          : true; // text/photo rooms: overlay open counts as watching
        if(watching) seconds += 1;
        if(mode === 'off'){ clearInterval(viewWatchTimer); viewWatchTimer = null; return; }
        if(mode === null || need === null || seconds < need) return;
        clearInterval(viewWatchTimer); viewWatchTimer = null;
        if(mode === 'server'){
          viewedLocal[key] = true;
          serverCountView(broadcastId, creatorUid, 0);
        } else {
          recordBroadcastView(broadcastId, creatorUid).then(function(){
            viewCounted(broadcastId, creatorUid);
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
  /* The board redraws on every live change. The comparison baseline is the
     ranks frozen at the start of this visit (or the last visit, if that
     freeze is still inside six hours). Writing the ranks we just painted
     and then reading them back on the next redraw turned every NEW into
     "same" before anyone could see it. A person who was not in that
     freeze stays NEW for this visit. */
  const __togaRankSession = { key: '', base: null };
  function nalunoTogaRankDelta(monthKey, currentRanksByUid){
    const key = 'togaRanks:' + monthKey;
    if (__togaRankSession.key !== key || __togaRankSession.base == null) {
      let stored = null;
      let keptAt = 0;
      try {
        const raw = (typeof nalunoCacheRead === 'function') ? nalunoCacheRead(key) : null;
        if (raw && raw.__ranks && typeof raw.__ranks === 'object') {
          stored = raw.__ranks;
          keptAt = Number(raw.__at) || 0;
        }
      } catch (_) {}
      const fresh = !!(stored && keptAt && (Date.now() - keptAt) < 6 * 60 * 60 * 1000);
      __togaRankSession.key = key;
      __togaRankSession.base = fresh ? stored : {};
      try {
        if (!fresh && typeof nalunoCacheWrite === 'function') {
          nalunoCacheWrite(key, { __at: Date.now(), __ranks: currentRanksByUid });
        }
      } catch (_) {}
    }
    const prev = __togaRankSession.base || {};
    const deltas = {};
    Object.keys(currentRanksByUid || {}).forEach(function (uid) {
      const nowRank = currentRanksByUid[uid];
      const before = prev[uid];
      if (before == null) deltas[uid] = { kind: 'new' };
      else if (before === nowRank) deltas[uid] = { kind: 'same' };
      else if (before > nowRank) deltas[uid] = { kind: 'up', by: before - nowRank };
      else deltas[uid] = { kind: 'down', by: nowRank - before };
    });
    return deltas;
  }

  function openCreatorTogaBroadcast(uid, bid, who){
    const name = who || 'them';
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
    // Every remaining path now says something. Previously a missing fbDb/uid
    // returned with only a vague hint, and any thrown error was swallowed —
    // so tapping a name could genuinely do nothing at all.
    if(!fbDb || !uid){
      toast('Could not look up ' + name + '\u2019s Broadcasts right now');
      return;
    }
    toast('Opening ' + name + '\u2019s Broadcasts\u2026');
    fbDb.collection('broadcasts').where('creatorUid', '==', uid).limit(12).get().then(function(snap){
      const docs = snap.docs.map(function(d){ return { id: d.id, ...(d.data() || {}) }; })
        .filter(function(b){ return !b.deleted; })
        .sort(function(a,b){ return (b.createdAt||0) - (a.createdAt||0); });
      if(docs[0]){ go(docs[0].id); return; }
      toast(name + ' hasn\u2019t published a Broadcast yet');
    }).catch(function(e){
      console.warn('[circle] open creator broadcasts', e);
      toast('Could not open ' + name + '\u2019s Broadcasts');
    });
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

  /* 29g: the board follows the numbers live. The listener used to be set
     up only if the database was ready when the page loaded (it usually is
     not, before sign-in), and it died on its first error, so the board
     showed whatever it read once. It now starts with the first render after
     sign-in, subscribes again after an error, and each change redraws from
     the snapshot it already has instead of reading the collection again. */
  let togaLiveUnsub = null;
  let togaLiveSnap = null;
  let togaLiveTimer = null;
  function watchTogaLive(){
    if(togaLiveUnsub || !fbDb || typeof currentUser === 'undefined' || !currentUser) return;
    try{
      togaLiveUnsub = fbDb.collection('toga').limit(80).onSnapshot(function(snap){
        togaLiveSnap = snap;
        try{ if(typeof nalunoListenOk === 'function') nalunoListenOk('toga'); }catch(_){}
        if(togaLiveTimer) return;
        togaLiveTimer = setTimeout(function(){ togaLiveTimer = null; renderTogaBoard(); }, 600);
      }, function(err){
        togaLiveUnsub = null;
        togaLiveSnap = null;
        try{ if(typeof nalunoRelisten === 'function') nalunoRelisten('toga', watchTogaLive); }catch(_){}
      });
    }catch(_){ togaLiveUnsub = null; }
  }
  async function renderTogaBoard(){
    const el = $('togaBoard');
    if(!el || !fbDb) return;
    watchTogaLive();
    const monthKey = nalunoMonthKey();
    const monthEl = $('togaMonthLabel');
    if(monthEl) monthEl.textContent = nalunoMonthLabel();
    try{
      const snap = togaLiveSnap || await fbDb.collection('toga').limit(80).get();
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
          // Reads the month-keyed counters written by togaMonthIncrements().
          // Falls back to the older monthKey/viewsMonth shape for rows written
          // before that change, so an existing board doesn't reset to zero on
          // the day this ships — old rows keep their numbers until the next
          // month naturally takes over.
          const f = togaMonthFields(monthKey);
          const hasNew = (r[f.views] != null || r[f.circle] != null || r[f.engage] != null);
          const legacySame = r.monthKey === monthKey;
          const viewsM  = hasNew ? (r[f.views]  || 0) : (legacySame ? (r.viewsMonth  || 0) : 0);
          const circleM = hasNew ? (r[f.circle] || 0) : (legacySame ? (r.circleMonth || 0) : 0);
          const engageM = hasNew ? (r[f.engage] || 0) : (legacySame ? (r.engageMonth || 0) : 0);
          // FIX: this board is explicitly monthly ("Wall of Fame · list lives 30
          // days"). The score AND every number shown next to a name must be the
          // same monthly figures — no falling back to lifetime totals for rows
          // with 0 activity this month, since that silently swapped what "views"
          // meant row-to-row (one person's monthly count next to another
          // person's all-time count, both under the same "views" label) and let
          // stale lifetime totals outrank real monthly activity.
          // Score is computed on read now rather than stored, because a stored
          // score would need a read-modify-write — exactly the transaction that
          // was failing under load.
          const score = viewsM + circleM * 12 + engageM * 3;
          return Object.assign(r, { _score: score, _viewsM: viewsM, _circleM: circleM, _engageM: engageM });
        })
        /* A Wall of Fame of zeros is not a Wall of Fame: only people with
           something this month are listed. */
        .filter(function(r){ return (r._score || 0) > 0; })
        .sort(function(a,b){ return (b._score||0) - (a._score||0); })
        .slice(0, 10);
      await attachTogaPhotos(rows);
      paintTogaFaceStack(rows);
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
      el.innerHTML = '<div class="toga-key">The big number is <strong>Toga points</strong>: 1 for each view, 12 for each Circle join and 3 for each talk message, this month. The line under it shows those counts.</div>'
        + '<div class="toga-strip-hint">Slide names →</div><ol class="toga-list">' + rows.map(function(r, i){
        const openId = r.featuredBroadcastId || '';
        const rank = i + 1;
        const d = deltas[r.id] || { kind: 'same' };
        let badge = '';
        if(d.kind === 'new') badge = '<span class="toga-delta toga-delta-new">NEW</span>';
        else if(d.kind === 'up') badge = '<span class="toga-delta toga-delta-up">▲' + d.by + '</span>';
        else if(d.kind === 'down') badge = '<span class="toga-delta toga-delta-down">▼' + d.by + '</span>';
        else badge = '<span class="toga-delta toga-delta-same">—</span>';
        return '<li><button type="button" class="toga-name-row toga-rank-' + Math.min(rank,4) + '" data-toga-uid="'+escapeHtml(r.id)+'" data-bcast="'+(openId ? escapeHtml(openId) : '')+'">'
          + togaFaceHtml(r, rank)
          + '<span class="toga-rank">#' + rank + '</span>'
          + '<span class="toga-name-block">'
          +   '<span class="toga-card-name"><span data-known-uid="' + escapeHtml(r.id || '') + '">' + escapeHtml(r.name || 'Creator') + '</span>' + badge + '</span>'
          +   '<span class="toga-card-v">' + formatNalunoViews(r._score || 0) + ' <em class="toga-card-unit">Toga points</em></span>'
          +   '<span class="toga-card-h">This month: ' + formatNalunoViews(r._viewsM) + (r._viewsM === 1 ? ' view' : ' views') + ' · '
          +     formatNalunoViews(r._circleM || 0) + ' Circle ' + ((r._circleM || 0) === 1 ? 'join' : 'joins') + ' · '
          +     formatNalunoViews(r._engageM || 0) + ' talk</span>'
          + '</span>'
          + '</button></li>';
      }).join('') + '</ol>'
      + '<div class="toga-period-note">' + nalunoMonthLabel() + ' · ' + (function(n){ return n + (n === 1 ? ' day' : ' days'); })(nalunoDaysRemainingInPeriod()) + ' remaining in this Wall of Fame</div>';
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

  function togaPhotoSrc(r){
    if(!r) return '';
    try{
      if(typeof contactPhotoSrc === 'function'){
        const live = contactPhotoSrc(r, { skipData: true }) || contactPhotoSrc(r);
        if(live) return live;
      }
      if(r.photoUrl) return r.photoUrl;
      if(r.photo && r.photo.dataUrl) return r.photo.dataUrl;
      const selfId = r.id || r.uid;
      if(typeof currentUser !== 'undefined' && currentUser && selfId === currentUser.uid
        && typeof currentProfile !== 'undefined' && currentProfile){
        if(typeof contactPhotoSrc === 'function'){
          const self = contactPhotoSrc(currentProfile, { skipData: true }) || contactPhotoSrc(currentProfile);
          if(self) return self;
        }
        if(currentProfile.photoUrl) return currentProfile.photoUrl;
        if(currentProfile.photo && currentProfile.photo.dataUrl) return currentProfile.photo.dataUrl;
      }
    }catch(_){}
    return '';
  }
  function togaFaceHtml(r, rank){
    const src = togaPhotoSrc(r);
    const ch = String((r && r.name) || 'C').trim().charAt(0).toUpperCase() || 'C';
    const hues = ['#7CFFB2', '#00E5FF', '#7C4DFF', '#FF7A8A'];
    const raw = (r && r.color) || hues[(rank ? rank - 1 : 0) % hues.length];
    const bg = /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$/.test(String(raw)) ? raw : '#7CFFB2';
    if(src){
      return '<span class="toga-face toga-face-pic" style="background:'+bg+'"><img src="'+escapeHtml(src)+'" alt=""></span>';
    }
    return '<span class="toga-face" style="background:'+bg+'">'+escapeHtml(ch)+'</span>';
  }
  /* FIX (flagged during the repo audit): every renderTogaBoard() call fetched
     each of the top 10 creators' photos fresh from Firestore, in parallel,
     with no caching at all — 10 extra reads on every single render, even
     when nothing about those creators' photos had changed since the last
     time this ran moments earlier. Photos change rarely; a simple in-memory
     cache turns "10 reads every render" into "10 reads the first time a
     creator is seen this session, then free." Not cleared on sign-out —
     this holds public creator profile data (photo/name/color), the same
     thing anyone would see on that creator's own Broadcast page, not
     anything tied to who's currently viewing it, so there's no correctness
     reason to invalidate it there. A creator changing their photo mid-
     session won't show up here until the next full page load, which is an
     acceptable, minor tradeoff for cutting 10 reads down to effectively
     zero on every re-render after the first. */
  const togaPhotoCache = {};
  async function attachTogaPhotos(rows){
    if(!fbDb || !rows || !rows.length) return;
    await Promise.all(rows.map(function(r){
      if(!r || !r.id || togaPhotoSrc(r)) return Promise.resolve();
      if(togaPhotoCache[r.id]){
        const cached = togaPhotoCache[r.id];
        if(cached.photo) r.photo = cached.photo;
        if(cached.photoUrl) r.photoUrl = cached.photoUrl;
        if(cached.color) r.color = cached.color;
        if(!r.name && cached.name) r.name = cached.name;
        return Promise.resolve();
      }
      return fbDb.collection('users').doc(r.id).get().then(function(snap){
        if(!snap.exists) return;
        const d = snap.data() || {};
        if(d.photoUrl) r.photoUrl = d.photoUrl;
        if(d.photo) r.photo = d.photo;
        if(d.color) r.color = d.color;
        if(!r.name && d.name) r.name = d.name;
        togaPhotoCache[r.id] = { photo: d.photo || null, photoUrl: d.photoUrl || null, color: d.color || null, name: d.name || null };
      }).catch(function(){});
    }));
  }
  function paintTogaFaceStack(rows){
    const stack = $('togaFaceStack');
    if(!stack) return;
    const list = (rows || []).slice(0, 3);
    if(!list.length){
      stack.innerHTML = '<span class="toga-face toga-face-empty">★</span>';
      return;
    }
    stack.innerHTML = list.map(function(r, i){
      return '<span style="z-index:'+(3-i)+'">' + togaFaceHtml(r, i + 1) + '</span>';
    }).join('');
  }

  function wireToga(){
    const share = $('togaShareBtn');
    if(share) share.onclick = function(){ setMyToga(!myShareViews, myShareViews); };
    const exp = $('togaExpandBtn');
    const body = $('togaBody');
    const monthEl = $('togaMonthLabel');
    if(monthEl) monthEl.textContent = nalunoMonthLabel();
    try{ renderTogaBoard(); }catch(_){}
    watchTogaLive();
    function setTogaOpen(open){
      if(!body) return;
      body.style.display = 'block';
      try{ body.hidden = false; }catch(_){}
      if(exp){
        exp.setAttribute('aria-expanded', 'true');
        exp.classList.add('open');
      }
      if(open) renderTogaBoard();
    }
    setTogaOpen(true);
  }
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wireToga);
  else wireToga();

  window.formatNalunoViews = formatNalunoViews;
  window.canShowViews = canShowViews;
  /* ---------------- CIRCLE MEMBERS SHEET ----------------
     Who has actually joined this creator's Circle. Deliberately lazy: this
     reads users/{creator}/circle only when someone taps the Community cell
     in the Impact dashboard, never as part of the dashboard's own render
     (which runs on every Broadcast open). Tapping a name opens that
     person's most recent Broadcast, so the list is a real way into their
     work rather than a dead roster. */
  let circleMembersUnsub = null;
  async function openCircleMembers(creatorUid, fallbackMemberUids){
    const sheet = $('circleMembersSheet');
    const list = $('circleMembersList');
    if(!sheet || !list) return;
    sheet.classList.add('active');
    if(!list.querySelector('.circle-member-row')) list.innerHTML = '<div class="lobby-sub">Loading\u2026</div>';
    let rows = [];
    try{
      if(fbDb && creatorUid){
        const snap = await fbDb.collection('users').doc(creatorUid).collection('circle').limit(200).get();
        snap.forEach(function(d){
          const x = d.data() || {};
          rows.push({ uid: d.id, name: x.name || 'Someone', joinedAt: x.joinedAt || 0 });
        });
      }
    }catch(e){ console.warn('[circle] members', e); }
    // Fall back to the Broadcast's own memberUids if the circle subcollection
    // is empty or unreadable — those are real joins too, just recorded on the
    // Broadcast rather than in the creator's circle collection.
    if(!rows.length && Array.isArray(fallbackMemberUids) && fallbackMemberUids.length){
      rows = fallbackMemberUids.map(function(uid){ return { uid: uid, name: '', joinedAt: 0 }; });
    }
    if(!rows.length){
      list.innerHTML = '<div class="lobby-sub" style="text-align:left;max-width:none;">No one has joined this Circle yet. When people do, they show up here.</div>';
      return;
    }
    rows.sort(function(a,b){ return (b.joinedAt || 0) - (a.joinedAt || 0); });
    // Resolve any missing names/photos from the users collection, reusing the
    // same photo cache the Toga board already fills so this is usually free.
    await Promise.all(rows.map(async function(r){
      if(togaPhotoCache[r.uid]){
        const c = togaPhotoCache[r.uid];
        r.photo = c.photo; r.photoUrl = c.photoUrl; r.color = c.color;
        if(!r.name) r.name = c.name || 'Someone';
        return;
      }
      if(!fbDb){ if(!r.name) r.name = 'Someone'; return; }
      try{
        const doc = await fbDb.collection('users').doc(r.uid).get();
        if(doc.exists){
          const d = doc.data() || {};
          if(!r.name) r.name = d.name || 'Someone';
          r.photo = d.photo || null;
          r.photoUrl = d.photoUrl || null;
          r.color = d.color || null;
          togaPhotoCache[r.uid] = { photo: r.photo, photoUrl: r.photoUrl, color: r.color, name: r.name };
        }
      }catch(_){ if(!r.name) r.name = 'Someone'; }
    }));
    list.innerHTML = rows.map(function(r){
      const src = togaPhotoSrc(r);
      const initial = escapeHtml(String(r.name || '?').trim().charAt(0).toUpperCase() || '?');
      const avatar = src
        ? '<img class="circle-member-face" src="' + escapeHtml(src) + '" alt="" />'
        : '<span class="circle-member-face circle-member-initial" style="background:' + escapeHtml(r.color || '#2A2F45') + ';">' + initial + '</span>';
      return '<button type="button" class="circle-member-row" data-member-uid="' + escapeHtml(r.uid) + '" data-member-name="' + escapeHtml(r.name || 'them') + '">'
        + avatar
        + '<span class="circle-member-name" data-known-uid="' + escapeHtml(r.uid || '') + '">' + escapeHtml(r.name || 'Someone') + '</span>'
        + '<span class="circle-member-go">\u203a</span>'
        + '</button>';
    }).join('');
    list.querySelectorAll('[data-member-uid]').forEach(function(btn){
      btn.onclick = function(){
        const uid = btn.getAttribute('data-member-uid');
        const who = btn.getAttribute('data-member-name') || 'them';
        closeCircleMembers();
        // FIX (reported: tapping a Community name did nothing — no navigation
        // and no message either way). Two real problems:
        //  1. This fired openBroadcastById() while the Broadcast space was
        //     ALREADY open, re-entering the same overlay. Closing the current
        //     space first makes it a clean open rather than a re-entry.
        //  2. openCreatorTogaBroadcast()'s "none found" path only toasts from
        //     inside its own Firestore lookup, so any earlier bail-out (no
        //     fbDb, no uid) returned silently. This now always says something.
        try{ if(typeof closeBroadcastSpace === 'function') closeBroadcastSpace(); }catch(_){}
        setTimeout(function(){
          try{
            if(typeof openCreatorTogaBroadcast === 'function'){
              openCreatorTogaBroadcast(uid, '', who);
            } else {
              toast('Could not open ' + who + '\u2019s Broadcasts');
            }
          }catch(e){
            toast('Could not open ' + who + '\u2019s Broadcasts');
          }
        }, 220);
      };
    });
    if(fbDb && creatorUid && !circleMembersUnsub){
      let skipFirst = true;
      try{
        circleMembersUnsub = fbDb.collection('users').doc(creatorUid).collection('circle').limit(200).onSnapshot(function(){
          if(skipFirst){ skipFirst = false; return; }
          const sheet = $('circleMembersSheet');
          if(!sheet || !sheet.classList.contains('active')) return;
          openCircleMembers(creatorUid, fallbackMemberUids);
        }, function(){});
      }catch(_){}
    }
  }
  function closeCircleMembers(){
    if(circleMembersUnsub){ try{ circleMembersUnsub(); }catch(_){} circleMembersUnsub = null; }
    const sheet = $('circleMembersSheet');
    if(sheet) sheet.classList.remove('active');
  }

  window.creatorCircleJoined = creatorCircleJoined;
  window.openCircleMembers = openCircleMembers;
  window.closeCircleMembers = closeCircleMembers;
  (function bindCircleMembersUi(){
    function bind(){
      const close = document.getElementById('circleMembersClose');
      if(close) close.onclick = closeCircleMembers;
      const sheet = document.getElementById('circleMembersSheet');
      // Backdrop tap closes; a tap inside the panel must not (hence the
      // explicit target check rather than a bare handler on the sheet).
      if(sheet) sheet.onclick = function(e){ if(e && e.target === sheet) closeCircleMembers(); };
    }
    if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind);
    else bind();
  })();
  window.joinCreatorCircle = joinCreatorCircle;
  window.leaveCreatorCircle = leaveCreatorCircle;
  window.recordBroadcastView = recordBroadcastView;
  window.armBroadcastViewWatch = armBroadcastViewWatch;
  window.loadMyTogaSettings = loadMyTogaSettings;
  window.setMyToga = setMyToga;
  window.renderTogaBoard = renderTogaBoard;
  window.nalunoTogaRankDelta = nalunoTogaRankDelta;
  window.creatorShareViews = creatorShareViews;
  window.bumpTogaMonth = bumpTogaMonth;
})();
