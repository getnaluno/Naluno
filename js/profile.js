/* ============================================================
   MODULE: js/profile.js
   Tab navigation + Callsign profile
   OWNERSHIP: change this domain here only.
   Scripts share globals (intentional) so load order matches the old monolith.
   ============================================================ */
/* ---------------- TAB NAV + surface restore after refresh ---------------- */
const NALUNO_NAV_KEY = 'naluno:navState:v1';

function captureNavState(){
  try{
    const tab = (document.querySelector('.tabscreen.active') || {}).id || 'tab-frequencies';
    const nav = (document.querySelector('.navbtn.active') || {}).dataset
      ? document.querySelector('.navbtn.active').dataset.tab
      : (tab || '').replace(/^tab-/, '');
    const state = {
      tabId: tab,
      navTab: nav,
      wirelineOpen: !!( $('wirelineThread') && $('wirelineThread').classList.contains('active') ),
      threadContactId: (typeof activeThreadContactId !== 'undefined') ? activeThreadContactId : null,
      /* Local ids are handed out per launch in whatever order people load,
         so after a reopen the same number can be someone else. Remember
         the permanent id too, and restore by that. */
      threadUid: (function(){
        try{
          const id = (typeof activeThreadContactId !== 'undefined') ? activeThreadContactId : null;
          const c = (id != null && typeof contacts !== 'undefined') ? contacts.find(function(x){ return x.id === id; }) : null;
          return c && c.firebaseUid ? c.firebaseUid : null;
        }catch(_){ return null; }
      })(),
      bandOpen: !!( $('bandRoom') && $('bandRoom').classList.contains('active') ),
      bandId: (typeof activeBandId !== 'undefined') ? activeBandId : null,
      bandFirestoreId: (function(){
        try{
          const id = (typeof activeBandId !== 'undefined') ? activeBandId : null;
          const b = (id != null && typeof bands !== 'undefined') ? bands.find(function(x){ return x.id === id; }) : null;
          return b && b.firestoreId ? b.firestoreId : null;
        }catch(_){ return null; }
      })(),
      bspaceOpen: !!( $('bspace') && $('bspace').classList.contains('active') ),
      broadcastId: (typeof activeBroadcastId !== 'undefined') ? activeBroadcastId : null,
      ts: Date.now(),
    };
    sessionStorage.setItem(NALUNO_NAV_KEY, JSON.stringify(state));
  }catch(_){}
}

function applyNavState(state){
  if(!state || !state.tabId) return;
  if(state.tabId === 'tab-support' || state.navTab === 'support'){
    state = Object.assign({}, state, { tabId: 'tab-broadcast', navTab: 'broadcast' });
  }
  try{
    document.querySelectorAll('.navbtn').forEach(b=>{
      b.classList.toggle('active', b.dataset.tab === state.navTab || ('tab-'+b.dataset.tab) === state.tabId);
    });
    document.querySelectorAll('.tabscreen').forEach(s=>{
      s.classList.toggle('active', s.id === state.tabId);
    });
    if(state.navTab === 'frequencies' && typeof clearMissedCallBadge === 'function') clearMissedCallBadge();
    if(state.navTab === 'compass' && typeof showCompassLockScreenIfNeeded === 'function') showCompassLockScreenIfNeeded();
  }catch(_){}
  // Defer overlays until modules/auth are ready. People and rooms arrive
  // from the network, so look them up by permanent id and wait for them.
  if(state.wirelineOpen && state.threadUid){
    let tries = 0;
    (function openWhenLoaded(){
      const c = (typeof contacts !== 'undefined') ? contacts.find(function(x){ return x.firebaseUid === state.threadUid; }) : null;
      if(c && typeof openThread === 'function'){ try{ openThread(c.id); }catch(e){ console.warn('[nav] restore thread', e); } return; }
      if(++tries < 20) setTimeout(openWhenLoaded, 400);
    })();
    return;
  }
  if(state.bandOpen && state.bandFirestoreId){
    let tries = 0;
    (function openWhenLoaded(){
      const b = (typeof bands !== 'undefined') ? bands.find(function(x){ return x.firestoreId === state.bandFirestoreId; }) : null;
      if(b && typeof openBandRoom === 'function'){ try{ openBandRoom(b.id); }catch(e){ console.warn('[nav] restore band', e); } return; }
      if(++tries < 20) setTimeout(openWhenLoaded, 400);
    })();
    return;
  }
  setTimeout(function(){
    try{
      if(state.wirelineOpen && state.threadContactId != null && !state.threadUid && typeof openThread === 'function'){
        /* Saved by an older build without the permanent id: skip rather
           than risk opening someone else's chat. */
      } else if(state.bandOpen && state.bandId && !state.bandFirestoreId && typeof openBandRoom === 'function'){
        const b = (typeof bands !== 'undefined') ? bands.find(function(x){ return x.id === state.bandId && !x.isReal; }) : null;
        if(b) openBandRoom(state.bandId);
      } else if(state.bspaceOpen && state.broadcastId && typeof openBroadcastSpaceById === 'function'){
        openBroadcastSpaceById(state.broadcastId);
      } else if(state.bspaceOpen && state.broadcastId && typeof openBroadcastSpace === 'function'){
        openBroadcastSpace(state.broadcastId);
      }
    }catch(e){ console.warn('[nav] restore overlay', e); }
  }, 700);
}

let _navRestoredOnce = false;
function restoreNavStateOnBoot(){
  try{
    if(_navRestoredOnce) return;
    const raw = sessionStorage.getItem(NALUNO_NAV_KEY);
    if(!raw) return;
    const state = JSON.parse(raw);
    if(!state || !state.ts || (Date.now() - state.ts) > 6*60*60*1000) return; // 6h max
    applyNavState(state);
    _navRestoredOnce = true;
  }catch(_){}
  try{ if(window.nalunoBack && window.nalunoBack.seed) window.nalunoBack.seed(); }catch(_){}
}

function nalunoShowTab(name){
  if(!name || name === 'support') name = 'broadcast';
  const btn = document.querySelector('.navbtn[data-tab="' + name + '"]');
  document.querySelectorAll('.navbtn').forEach(function(b){ b.classList.toggle('active', b === btn); });
  document.querySelectorAll('.tabscreen').forEach(function(s){ s.classList.remove('active'); });
  const screen = $('tab-' + name);
  if(screen) screen.classList.add('active');
  try{ if(typeof nalunoHideProgressChrome === 'function') nalunoHideProgressChrome(); }catch(_){}
  if(name === 'frequencies' && typeof clearMissedCallBadge === 'function') clearMissedCallBadge();
  if(name === 'compass' && typeof showCompassLockScreenIfNeeded === 'function') showCompassLockScreenIfNeeded();
  if(name !== 'broadcast'){
    try{ document.body.classList.remove('naluno-bcast-watch', 'naluno-bspace-open', 'naluno-feed-landscape'); }catch(_){}
    try{
      const scroller = document.getElementById('broadcastTabScroll');
      if(scroller) scroller.scrollTop = 0;
    }catch(_){}
    try{ if(typeof pauseAllStrandPreviews === 'function') pauseAllStrandPreviews(); }catch(_){}
    try{ if(typeof nalunoPauseDetachedMedia === 'function') nalunoPauseDetachedMedia(); }catch(_){}
  }
  try{ captureNavState(); }catch(_){}
}
function nalunoCurrentTab(){
  const b = document.querySelector('.navbtn.active');
  return (b && b.dataset && b.dataset.tab) || 'frequencies';
}

/* Android system back. Capacitor's WebView only treats a URL change as
   history, so a pushState that keeps the same address makes Back finish
   the activity. Each step writes a distinct #n/… address. The session
   stack is what we apply if that pop arrives without our state object.
   A call keeps its own history in calls.js. */
window.nalunoBack = (function(){
  /* Sheets that open without the 'active' class, or were never known to
     Back. Without them, Back skipped the sheet and closed what was under
     it — the room's ⋯ menu, Spark, Connect, trim, Band compose and more. */
  const EXTRA = {
    rightsReportSheet: { open: function(el){ return el.style.display !== 'none'; }, close: function(){ const e = document.getElementById('rightsReportSheet'); if(e) e.remove(); } },
    knownSheet: { open: function(el){ return el.classList.contains('active'); }, close: function(){ const e = document.getElementById('knownSheet'); if(e) e.classList.remove('active'); } },
    sparkSheet: { open: function(el){ return el.style.display && el.style.display !== 'none'; }, close: function(){ try{ if(typeof closeSparkSheet === 'function') closeSparkSheet(); }catch(_){} } },
    sparkPage: { open: function(el){ return el.classList.contains('active'); }, close: function(){ try{ if(typeof closeSparkPage === 'function') closeSparkPage(); }catch(_){} } },
    adjustOverlay: { open: function(el){ return el.classList.contains('active'); }, close: function(){ const b = document.getElementById('adjustCancel'); if(b) b.click(); } },
    trimOverlay: { open: function(el){ return el.classList.contains('active'); }, close: function(){ const b = document.getElementById('trimCancel'); if(b) b.click(); } },
    bandInviteSheet: { open: function(el){ return el.classList.contains('active'); }, close: function(){ const e = document.getElementById('bandInviteSheet'); if(e) e.classList.remove('active'); } },
    bandComposer: { open: function(el){ return el.classList.contains('active'); }, close: function(){ try{ if(typeof closeBandComposer === 'function') closeBandComposer(); }catch(_){} } },
    findPeopleOverlay: { open: function(el){ return el.classList.contains('active'); }, close: function(){ try{ if(typeof closeFindPeople === 'function') closeFindPeople(); }catch(_){} } },
    bspaceRoomSheet: { open: function(el){ return el.classList.contains('active'); }, close: function(){ try{ if(typeof closeRoomSheet === 'function') closeRoomSheet(); }catch(_){} } },
    bspaceMoreMenu: { open: function(el){ return !el.hasAttribute('hidden'); }, close: function(){ try{ if(typeof window.bspaceCloseMoreMenu === 'function') window.bspaceCloseMoreMenu(); }catch(_){} } },
  };
  const ORDER = Object.keys(EXTRA).concat(['bspaceLineSheet','bwriteSetup','bliveSetup','discoverSheet','appealSheet','contributionPanel','supportSheet','findNalunoPanel','wireBackupScreen','wireHistoryScreen','signalViewers','reportSheet','bcastAdSheet','downloadsPanel','bcomposer','composer','bviewer','bspace','bandRoom','wirelineThread']);
  function isOpen(id){
    const el = document.getElementById(id);
    if(!el) return false;
    if(EXTRA[id]) return !!EXTRA[id].open(el);
    return el.classList.contains('active');
  }
  const CLOSE = {
    rightsReportSheet: EXTRA.rightsReportSheet.close,
    knownSheet: EXTRA.knownSheet.close,
    sparkSheet: EXTRA.sparkSheet.close,
    sparkPage: EXTRA.sparkPage.close,
    adjustOverlay: EXTRA.adjustOverlay.close,
    trimOverlay: EXTRA.trimOverlay.close,
    bandInviteSheet: EXTRA.bandInviteSheet.close,
    bandComposer: EXTRA.bandComposer.close,
    findPeopleOverlay: EXTRA.findPeopleOverlay.close,
    bspaceRoomSheet: EXTRA.bspaceRoomSheet.close,
    bspaceMoreMenu: EXTRA.bspaceMoreMenu.close,
    bspaceLineSheet: function(){ try{ if(typeof bspaceCloseLine === 'function') bspaceCloseLine(); }catch(_){} },
    bliveSetup: function(){ try{ if(typeof bliveClose === 'function') bliveClose(); }catch(_){} },
    bwriteSetup: function(){ try{ if(typeof closeWriteEntry === 'function') closeWriteEntry(); }catch(_){} },
    discoverSheet: function(){ try{ if(window.NalunoDiscover && window.NalunoDiscover.close) window.NalunoDiscover.close(); }catch(_){} },
    appealSheet: function(){ try{ if(typeof closeSafetyAppeal === 'function') closeSafetyAppeal(); }catch(_){} },
    contributionPanel: function(){ try{ if(typeof closeContributionPanel === 'function') closeContributionPanel(); }catch(_){} },
    supportSheet: function(){ try{ if(typeof closeSupportSheet === 'function') closeSupportSheet(); }catch(_){} },
    findNalunoPanel: function(){ try{ if(typeof closeFindNaluno === 'function') closeFindNaluno(); }catch(_){} },
    wireBackupScreen: function(){ try{ if(typeof closeWireSetScreens === 'function') closeWireSetScreens(); }catch(_){} },
    wireHistoryScreen: function(){ try{ if(typeof closeWireSetScreens === 'function') closeWireSetScreens(); }catch(_){} },
    signalViewers: function(){ try{ if(window.NalunoSignalSocial) window.NalunoSignalSocial.closeViewers(); }catch(_){} },
    reportSheet: function(){ try{ if(typeof closeReportSheet === 'function') closeReportSheet(); }catch(_){} },
    bcastAdSheet: function(){ try{ if(window.NalunoAds && window.NalunoAds.closeFromBroadcast) window.NalunoAds.closeFromBroadcast(); }catch(_){} },
    downloadsPanel: function(){ try{ if(window.NalunoOfflineBroadcast) window.NalunoOfflineBroadcast.closeDownloads(); }catch(_){} },
    bcomposer: function(){ try{ if(typeof bcompClose === 'function') bcompClose(); }catch(_){} },
    composer: function(){ try{ if(typeof closeComposer === 'function') closeComposer(); }catch(_){} },
    bviewer: function(){ try{ if(typeof closeBroadcast === 'function') closeBroadcast(); }catch(_){} },
    bspace: function(){ try{ if(typeof closeBroadcastSpace === 'function') closeBroadcastSpace(); }catch(_){} },
    bandRoom: function(){ try{ if(typeof closeBandRoom === 'function') closeBandRoom(); }catch(_){} },
    wirelineThread: function(){ try{ if(typeof closeThread === 'function') closeThread(); }catch(_){} },
  };
  const STACK_KEY = 'naluno:tabStack:v2';
  let lock = false;
  let seeded = false;
  let seq = 1;
  let poppedAt = 0;
  function topOverlay(){
    for(let i = 0; i < ORDER.length; i++){
      if(isOpen(ORDER[i])) return ORDER[i];
    }
    return null;
  }
  function readStack(){
    try{
      const raw = sessionStorage.getItem(STACK_KEY);
      const arr = raw ? JSON.parse(raw) : null;
      if(Array.isArray(arr)) return arr.filter(Boolean).slice(-8);
    }catch(_){}
    return [];
  }
  function writeStack(tabs){
    try{ sessionStorage.setItem(STACK_KEY, JSON.stringify((tabs || []).filter(Boolean).slice(-8))); }catch(_){}
  }
  function noteTab(tab){
    if(!tab) return;
    const tabs = readStack();
    if(tabs[tabs.length - 1] === tab) return;
    tabs.push(tab);
    writeStack(tabs);
  }
  function syncStack(tab){
    if(!tab) return;
    let tabs = readStack();
    const idx = tabs.lastIndexOf(tab);
    if(idx >= 0) tabs = tabs.slice(0, idx + 1);
    else tabs.push(tab);
    writeStack(tabs);
  }
  function urlFor(st){
    const base = location.pathname + location.search;
    const tab = encodeURIComponent((st && st.tab) || 'frequencies');
    const over = st && st.overlay ? ('/' + encodeURIComponent(st.overlay)) : '';
    return base + '#n/' + (st && st.i != null ? st.i : 0) + '/' + tab + over + '/' + (st && st.seq != null ? st.seq : 0);
  }
  function snap(){
    return { naluno: 1, tab: nalunoCurrentTab(), overlay: topOverlay() };
  }
  function same(a, b){
    if(!a || !b) return false;
    return a.tab === b.tab && (a.overlay || null) === (b.overlay || null);
  }
  function apply(st){
    st = st || { tab: 'frequencies', overlay: null };
    lock = true;
    try{
      if(st.tab && st.tab !== nalunoCurrentTab()) nalunoShowTab(st.tab);
      ORDER.forEach(function(id){
        if(id === st.overlay) return;
        if(isOpen(id) && CLOSE[id]) CLOSE[id]();
      });
      if(st.tab) syncStack(st.tab);
    }catch(_){}
    lock = false;
  }
  function seed(){
    const cur = nalunoCurrentTab();
    const st = history.state;
    if(seeded && st && st.naluno && st.tab === cur && (st.overlay || null) === (topOverlay() || null)) return;
    let tabs = readStack();
    if(!tabs.length) tabs = ['frequencies'];
    if(tabs[tabs.length - 1] !== cur){
      const at = tabs.lastIndexOf(cur);
      if(at >= 0) tabs = tabs.slice(0, at + 1);
      else tabs.push(cur);
    }
    if(tabs.length === 1 && tabs[0] !== 'frequencies') tabs = ['frequencies', tabs[0]];
    if(tabs[tabs.length - 1] !== cur) tabs.push(cur);
    const clean = [];
    tabs.forEach(function(t){ if(t && clean[clean.length - 1] !== t) clean.push(t); });
    tabs = clean.slice(-8);
    writeStack(tabs);
    const overlay = topOverlay();
    try{
      history.replaceState({ naluno: 1, tab: tabs[0], overlay: null, i: 0, seq: 0 }, '', urlFor({ i: 0, tab: tabs[0], seq: 0 }));
      for(let i = 1; i < tabs.length; i++){
        const isLast = i === tabs.length - 1;
        history.pushState({
          naluno: 1,
          tab: tabs[i],
          overlay: isLast ? overlay : null,
          i: i,
          seq: i,
        }, '', urlFor({ i: i, tab: tabs[i], overlay: isLast ? overlay : null, seq: i }));
      }
      seq = Math.max(seq, tabs.length);
    }catch(_){}
    seeded = true;
  }
  function push(){
    if(lock) return;
    if(!seeded) seed();
    const next = snap();
    const prev = history.state;
    if(prev && prev.naluno && same(prev, next)){
      if(!next.overlay) noteTab(next.tab);
      return;
    }
    next.seq = ++seq;
    next.i = (prev && prev.naluno && typeof prev.i === 'number') ? prev.i + 1 : seq;
    try{ history.pushState(next, '', urlFor(next)); }catch(_){}
    if(!next.overlay) noteTab(next.tab);
  }
  function drop(id){
    if(lock || window.__nalunoBackHold) return;
    const st = history.state || {};
    if(!st.naluno || st.overlay !== id) return;
    lock = true;
    setTimeout(function(){ if(lock) lock = false; }, 700);
    try{ history.back(); }catch(_){ lock = false; }
  }
  function fallbackUndo(){
    const top = topOverlay();
    if(top && CLOSE[top]){ CLOSE[top](); return true; }
    const tabs = readStack();
    if(tabs.length > 1){
      const nextTabs = tabs.slice(0, -1);
      writeStack(nextTabs);
      apply({ tab: nextTabs[nextTabs.length - 1], overlay: null });
      return true;
    }
    return false;
  }
  function onNativeBack(){
    if(window.__nalunoCallHist){
      try{ history.back(); }catch(_){}
      return;
    }
    const top = topOverlay();
    const tabs = readStack();
    if(!top && tabs.length < 2){
      try{
        const App = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App;
        if(App && App.exitApp) App.exitApp();
      }catch(_){}
      return;
    }
    const before = history.state && history.state.seq;
    try{ history.back(); }catch(_){}
    setTimeout(function(){
      if(Date.now() - poppedAt < 500) return;
      const after = history.state && history.state.seq;
      if(before != null && after === before) fallbackUndo();
    }, 280);
  }
  function bindNative(){
    let tries = 0;
    const tick = function(){
      tries++;
      try{
        const App = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App;
        if(App && App.addListener && !bindNative.done){
          bindNative.done = true;
          App.addListener('backButton', onNativeBack);
          return;
        }
      }catch(_){}
      if(tries < 24) setTimeout(tick, 300);
    };
    tick();
  }
  window.addEventListener('popstate', function(){
    poppedAt = Date.now();
    if(window.__nalunoCallPop){ window.__nalunoCallPop = false; return; }
    if(window.__nalunoCallHist) return;
    if(lock){ lock = false; return; }
    const st = history.state;
    if(st && st.naluno){ apply(st); return; }
    /* The WebView popped an entry that was never ours. Still step the tab
       instead of leaving the screen where it is — the next Back would exit. */
    fallbackUndo();
  });
  function closeTop(){
    const top = topOverlay();
    if(!top || !CLOSE[top]) return;
    window.__nalunoBackHold = true;
    try{ CLOSE[top](); }catch(_){}
    window.__nalunoBackHold = false;
    const st = history.state;
    if(st && st.naluno && st.overlay === top){
      const next = { naluno: 1, tab: st.tab, overlay: null, i: st.i, seq: st.seq };
      try{ history.replaceState(next, '', urlFor(next)); }catch(_){}
    }
  }
  bindNative();
  /* The extra sheets open from many places. Rather than touch each opener,
     watch them: opening adds a Back step, closing by hand removes it. */
  const wasOpen = {};
  const watched = new WeakSet();
  function onChange(id){
    const now = isOpen(id);
    if(now === !!wasOpen[id]) return;
    wasOpen[id] = now;
    if(lock || window.__nalunoBackHold) return;
    try{ if(now) push(); else drop(id); }catch(_){}
  }
  function watch(el){
    if(!el || !el.id || !EXTRA[el.id] || watched.has(el)) return;
    watched.add(el);
    wasOpen[el.id] = isOpen(el.id);
    try{
      new MutationObserver(function(){ onChange(el.id); })
        .observe(el, { attributes: true, attributeFilter: ['class', 'style', 'hidden'] });
    }catch(_){}
  }
  function watchAll(){
    Object.keys(EXTRA).forEach(function(id){ watch(document.getElementById(id)); });
  }
  function bootWatch(){
    watchAll();
    try{
      new MutationObserver(function(list){
        for(let i = 0; i < list.length; i++){
          const added = list[i].addedNodes;
          for(let j = 0; j < added.length; j++){
            const n = added[j];
            if(n && n.id && EXTRA[n.id]){ watch(n); onChange(n.id); }
          }
          const removed = list[i].removedNodes;
          for(let j = 0; j < removed.length; j++){
            const n = removed[j];
            if(n && n.id && EXTRA[n.id] && wasOpen[n.id]){ wasOpen[n.id] = false; if(!lock) { try{ drop(n.id); }catch(_){} } }
          }
        }
      }).observe(document.body, { childList: true, subtree: true });
    }catch(_){}
  }
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bootWatch);
  else bootWatch();
  /* Close one named overlay the same way Back would (used by the
     pull-down-to-close gesture when no history entry is on top). */
  function closeById(id) {
    try { if (CLOSE[id] && isOpen(id)) { CLOSE[id](); drop(id); } } catch (_) {}
  }
  return { push: push, drop: drop, apply: apply, top: topOverlay, seed: seed, closeTop: closeTop, closeById: closeById };
})();

document.querySelectorAll('.navbtn').forEach(btn=>{
  btn.onclick = ()=>{
    if(btn.dataset.tab === 'support'){
      try{ if(typeof stripSupportNavTab === 'function') stripSupportNavTab(); }catch(_){}
      const bcast = document.querySelector('.navbtn[data-tab="broadcast"]');
      if(bcast && bcast !== btn){ bcast.click(); }
      return;
    }
    try{ if(window.nalunoBack && window.nalunoBack.closeTop) window.nalunoBack.closeTop(); }catch(_){}
    nalunoShowTab(btn.dataset.tab);
    try{ if(window.nalunoBack) window.nalunoBack.push(); }catch(_){}
  };
});

// Persist while using overlays / before unload / pull-refresh
['visibilitychange','pagehide','beforeunload'].forEach(ev=>{
  window.addEventListener(ev, function(){ try{ captureNavState(); }catch(_){} });
});
// Hook common open/close after load
document.addEventListener('DOMContentLoaded', function(){
  setTimeout(function(){
    restoreNavStateOnBoot();
    try{ if(window.nalunoBack && window.nalunoBack.seed) window.nalunoBack.seed(); }catch(_){}
  }, 200);
  setTimeout(function(){
    restoreNavStateOnBoot();
    try{ if(window.nalunoBack && window.nalunoBack.seed) window.nalunoBack.seed(); }catch(_){}
  }, 1200);
});
setInterval(function(){ try{ captureNavState(); }catch(_){} }, 8000);


/* ---------------- CALLSIGN (profile) — persisted via window.storage ---------------- */
const swatches = ['#7CFFB2','#FFB86B','#7C4DFF','#FF7676','#4FBF87','#8B90A8'];
$('swatchRow').innerHTML = swatches.map((c,i)=>`<div class="swatch ${i===0?'selected':''}" style="background:${c}" data-c="${c}"></div>`).join('');

function initialsFor(name){
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0]||'') + (parts[1]?.[0]||'')).toUpperCase() || 'Y';
}
/* Identity here is a handle, not a phone number — no SIM card or country code attached to
   it, so changing either changes nothing about who you are in the app. */
function normalizeHandle(raw, fallbackName){
  let h = (raw || '').trim().replace(/\s+/g,'');
  h = h.replace(/^@+/, '');
  if(!h) h = (fallbackName || 'you').replace(/[^a-zA-Z0-9]/g,'');
  if(!h) h = 'you';
  return '@' + h;
}

/* Renders either the uploaded+cropped photo or the color+initials fallback into an avatar element */
function applyAvatarVisual(el, profile){
  if(!el || !profile) return;
  const src = (typeof contactPhotoSrc === 'function')
    ? (contactPhotoSrc(profile, { skipData: true }) || contactPhotoSrc(profile))
    : ((profile.photoUrl) || (profile.photo && profile.photo.dataUrl) || '');
  const init = (typeof initialsFor === 'function') ? initialsFor(profile.name || 'You') : 'Y';
  const color = (typeof contactAvatarColor === 'function')
    ? contactAvatarColor(profile)
    : (profile.color || '#7CFFB2');
  el.style.background = src ? 'var(--surface-2)' : color;
  el.style.position = el.style.position || 'relative';
  el.style.overflow = 'hidden';
  el.style.color = '#0D0F17';
  if(src){
    // Baked avatars need no extra transform. Live drafts still pan/zoom
    // around center — never translate(-50%,-50%) on an inset:0 image.
    const crop = profile.photo && profile.photo.crop;
    const baked = !crop || (crop.scale === 1 && !crop.xPct && !crop.yPct);
    let extra = 'object-fit:cover;';
    if(!baked && crop){
      const s = (typeof crop.scale === 'number' && crop.scale > 0) ? crop.scale : 1;
      const x = crop.xPct || 0, y = crop.yPct || 0;
      extra += 'transform-origin:center center;transform:translate('+x+'%,'+y+'%) scale('+s+');';
    }
    const safe = String(src).replace(/"/g, '');
    el.innerHTML = init + '<img class="avatar-pic" alt="" referrerpolicy="no-referrer" src="'+safe+'" style="'+extra+'" onerror="this.onerror=null;this.remove();" draggable="false" />';
  } else {
    el.innerHTML = '';
    el.textContent = init;
  }
}

/* Reflects the given profile everywhere it's shown: view card, edit form, and story viewer header */
let draftPhoto = null; // the avatar photo currently being edited (not yet saved to currentProfile)
function applyProfileToUI(profile){
  $('nameInput').value = profile.name;
  $('taglineInput').value = profile.tagline;
  $('numberInput').value = profile.number;
  if($('recoveryEmailInput')) $('recoveryEmailInput').value = profile.recoveryEmail || '';
  applyAvatarVisual($('profileAvatarBig'), profile);
  document.querySelectorAll('#swatchRow .swatch').forEach(s=>{
    s.classList.toggle('selected', s.dataset.c === profile.color);
  });

  $('viewName').textContent = profile.name;
  try{ if(window.NalunoKnown && typeof NalunoKnown.stampView === 'function') NalunoKnown.stampView(); }catch(_){}
  $('viewTagline').textContent = profile.tagline;
  $('viewNumber').textContent = profile.number;
  applyAvatarVisual($('viewAvatar'), profile);
  renderMySignalStatus();
}

/* Your own presence in Callsign runs through the identical model as everyone else's in
   Frequencies — computeSignal() applied to a timestamp — except the timestamp here tracks
   real interaction with this device (clicks, keys, touches) rather than a contact's activity.
   Going idle or backgrounding the tab lets it decay exactly like anyone else's would. */
let myLastActivityTs = Date.now();
function markMyActivity(){
  myLastActivityTs = Date.now(); // instant local feedback — your own badge updates immediately
  // Throttled remote write — no real reader depends on this yet (Phase 1), but this is
  // the same lastActivityTs field computeSignal() already expects, written for real.
  if(currentUser && fbDb && Date.now() - lastRemoteHeartbeat > 20000){
    lastRemoteHeartbeat = Date.now();
    fbDb.collection('users').doc(currentUser.uid)
      .update({ lastActivityTs: firebase.firestore.FieldValue.serverTimestamp() })
      .catch(()=>{});
  }
}
['click','keydown','touchstart'].forEach(evt => document.addEventListener(evt, markMyActivity, { passive:true }));
document.addEventListener('visibilitychange', ()=>{ if(document.visibilityState==='visible') markMyActivity(); });
function renderMySignalStatus(){
  const el = $('viewMySignal'); if(!el) return;
  const { tier } = computeSignal({ lastActivityTs: myLastActivityTs });
  el.textContent = signalMeta[tier].label + ' · this device';
  el.style.color = signalMeta[tier].color;
  updateSignatureGlow();
}

function hexToRgba(hex, alpha){
  const h = (hex || '#7CFFB2').replace('#','');
  const r = parseInt(h.substring(0,2),16), g = parseInt(h.substring(2,4),16), b = parseInt(h.substring(4,6),16);
  return `rgba(${r},${g},${b},${alpha})`;
}
/* Applied to every masked video frame in the app (lobby, in-call pip, Band Live) from one
   place, so your Callsign color and your live signal tier are always in sync everywhere
   your camera shows up — same source of truth as everything else, no separate state. */
function updateSignatureGlow(){
  const color = (typeof currentProfile !== 'undefined' && currentProfile && currentProfile.color) ? currentProfile.color : '#7CFFB2';
  const { tier } = computeSignal({ lastActivityTs: myLastActivityTs });
  // Real, guaranteed-visible color at the edge — not dependent on blend-mode math
  // against whatever happens to be behind it, which is what made this vanish before.
  const glow = `inset 0 0 26px 4px ${hexToRgba(color,0.55)}, inset 0 0 6px 1px ${hexToRgba(color,0.85)}`;
  ['camSignatureGlow','pipSignatureGlow','bandSignatureGlow'].forEach(id=>{
    const el = $(id); if(!el) return;
    el.style.boxShadow = glow;
    el.classList.remove('tier-strong','tier-fading','tier-off');
    el.classList.add('tier-'+tier);
  });
}

function showCallsignView(){
  $('callsignView').style.display = 'block';
  $('callsignEdit').style.display = 'none';
  try{ if(window.NalunoKnown && typeof NalunoKnown.refreshMine === 'function') NalunoKnown.refreshMine(); }catch(_){}
}
function showCallsignEdit(){
  draftPhoto = currentProfile.photo ? { ...currentProfile.photo } : null;
  applyProfileToUI(currentProfile); // repopulate the form from the last saved state
  $('avatarRemoveLink').style.display = draftPhoto ? 'block' : 'none';
  $('callsignView').style.display = 'none';
  $('callsignEdit').style.display = 'block';
}

document.querySelectorAll('#swatchRow .swatch').forEach(s=>{
  s.onclick = ()=>{
    document.querySelectorAll('#swatchRow .swatch').forEach(x=>x.classList.remove('selected'));
    s.classList.add('selected');
    if(!draftPhoto) applyAvatarVisual($('profileAvatarBig'), { name:$('nameInput').value, color:s.dataset.c, photo:null });
  };
});
$('nameInput').addEventListener('input', e=>{
  if(!draftPhoto) $('profileAvatarBig').textContent = initialsFor(e.target.value);
});

/* --- avatar photo upload + crop/pan/zoom (reuses the Adjust overlay) --- */
if($('avatarEditBtn')) $('avatarEditBtn').onclick = function(){ /* overlay input is the tap target */ };
$('avatarFileInput').onchange = async (e)=>{
  const file = e.target.files[0];
  e.target.value = '';
  if(!file) return;
  const dataUrl = await readFileAsDataUrl(file);
  const startingCrop = draftPhoto ? draftPhoto.crop : { scale:1, xPct:0, yPct:0 };
  openAvatarAdjust(dataUrl, startingCrop, (result)=>{
    draftPhoto = result;
    const selectedSwatch = document.querySelector('#swatchRow .swatch.selected');
    applyAvatarVisual($('profileAvatarBig'), { name:$('nameInput').value, color: selectedSwatch ? selectedSwatch.dataset.c : swatches[0], photo: draftPhoto });
    $('avatarRemoveLink').style.display = 'block';
  });
};
$('avatarRemoveLink').onclick = ()=>{
  draftPhoto = null;
  const selectedSwatch = document.querySelector('#swatchRow .swatch.selected');
  applyAvatarVisual($('profileAvatarBig'), { name:$('nameInput').value, color: selectedSwatch ? selectedSwatch.dataset.c : swatches[0], photo:null });
  $('avatarRemoveLink').style.display = 'none';
};

const DEFAULT_PROFILE = { name:'You', tagline:'On air, mostly reachable.', number:'@you', color:'#7CFFB2', photo:null };
let currentProfile = { ...DEFAULT_PROFILE };
const storageAvailable = typeof window.storage !== 'undefined' && window.storage !== null;


(function wireCallsignDial(){
  const dial = document.getElementById('callsignDial');
  const rotor = document.getElementById('callsignRotor');
  const hub = document.getElementById('callsignDialHub');
  const nameEl = document.getElementById('callsignDialName');
  const plate = document.getElementById('callsignDialPlate');
  const plateBody = document.getElementById('callsignDialPlateBody');
  const plateTitle = document.getElementById('callsignDialPlateTitle');
  const dock = document.getElementById('callsignDialDock');
  if(!dial || !rotor || !hub || dial.dataset.wired === '1') return;
  dial.dataset.wired = '1';
  const stations = [
    { id:'greenroom', short:'Room', angle:0 },
    { id:'find', short:'Find', angle:60 },
    { id:'calls', short:'Calls', angle:120 },
    { id:'tone', short:'Tone', angle:180 },
    { id:'mine', short:'Mine', angle:240 },
    { id:'close', short:'Close', angle:300 },
  ];
  let rot = 0;
  let drag = null;
  stations.forEach(function(s){
    const node = dock && dock.querySelector('[data-dial="' + s.id + '"]');
    s.name = (node && node.getAttribute('data-dial-name')) || s.short;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'cdial-station';
    btn.textContent = s.short;
    rotor.appendChild(btn);
    s.el = btn;
    btn.addEventListener('click', function(e){
      if(e) e.stopPropagation();
      if(drag && drag.moved) return;
      const cur = current();
      if(cur && cur.id === s.id) openPlate(s);
      else { spinTo(s); openPlate(s); }
    });
  });
  function norm(n){ return ((n % 360) + 360) % 360; }
  function dist(n){ const a = norm(n); return a > 180 ? 360 - a : a; }
  function current(){
    let best = stations[0], bestD = 999;
    stations.forEach(function(s){
      const d = dist(s.angle + rot);
      if(d < bestD){ bestD = d; best = s; }
    });
    return best;
  }
  function applyRot(animate){
    rotor.style.transition = animate ? 'transform .45s cubic-bezier(.2,.8,.2,1)' : 'none';
    rotor.style.transform = 'rotate(' + rot + 'deg)';
    const cur = current();
    stations.forEach(function(s){
      s.el.style.transform = 'rotate(' + s.angle + 'deg) translateY(-108px) rotate(' + (-(s.angle + rot)) + 'deg)';
      s.el.classList.toggle('on', cur && cur.id === s.id);
    });
    if(nameEl && cur) nameEl.textContent = cur.short;
  }
  function spinTo(s){
    let delta = norm((-s.angle) - rot);
    if(delta > 180) delta -= 360;
    rot += delta;
    applyRot(true);
  }
  function openPlate(s){
    if(!plate || !plateBody || !dock) return;
    const node = dock.querySelector('[data-dial="' + s.id + '"]') || plateBody.querySelector('[data-dial="' + s.id + '"]');
    if(!node) return;
    const prev = plateBody.querySelector('[data-dial]');
    if(prev && prev !== node) dock.appendChild(prev);
    plateBody.appendChild(node);
    if(plateTitle) plateTitle.textContent = s.name;
    plate.hidden = false;
  }
  function closePlate(){
    if(!plate || !plateBody || !dock) return;
    const prev = plateBody.querySelector('[data-dial]');
    if(prev) dock.appendChild(prev);
    plate.hidden = true;
  }
  const closeBtn = document.getElementById('callsignDialClose');
  if(closeBtn) closeBtn.onclick = function(){ closePlate(); };
  hub.onclick = function(){ const cur = current(); if(cur) openPlate(cur); };
  dial.addEventListener('pointerdown', function(e){
    if(e.target.closest && (e.target.closest('.cdial-hub') || e.target.closest('.cdial-station'))) return;
    const box = dial.getBoundingClientRect();
    drag = {
      cx: box.left + box.width / 2,
      cy: box.top + box.height / 2,
      last: Math.atan2(e.clientY - (box.top + box.height / 2), e.clientX - (box.left + box.width / 2)),
      moved: false,
    };
    try{ dial.setPointerCapture(e.pointerId); }catch(_){}
  });
  dial.addEventListener('pointermove', function(e){
    if(!drag) return;
    const ang = Math.atan2(e.clientY - drag.cy, e.clientX - drag.cx);
    let delta = (ang - drag.last) * 180 / Math.PI;
    if(delta > 180) delta -= 360;
    if(delta < -180) delta += 360;
    if(Math.abs(delta) > 0.4) drag.moved = true;
    drag.last = ang;
    rot += delta;
    applyRot(false);
  });
  function endDrag(){
    if(!drag) return;
    drag = null;
    const cur = current();
    if(cur) spinTo(cur);
  }
  dial.addEventListener('pointerup', endDrag);
  dial.addEventListener('pointercancel', endDrag);
  applyRot(false);
})();
