/* ============================================================
   MODULE: js/calls.js
   OWNED PEER CONNECTION: `peerConnection` (1:1 calls ONLY).
   MUST NOT touch: bandMeshPcs, bandLiveLocalStream, bLive* PCs, bspaceVideoEl.
   Uses: getIceServers() from ice-core, stream via camera.js enableCameraForCall.
   UI coupling (intentional): call overlay preempts band/broadcast/wireline via
   snapshotUiBeforeCall / restoreUiAfterCall only — no media internals shared.
   ============================================================
   MODULE: js/calls.js
   Call lobby/ring/UI, ringtone, WebRTC peer connection
   OWNERSHIP: change this domain here only.
   Scripts share globals (intentional) so load order matches the old monolith.
   ============================================================ */
/* ---------------- CALL FLOW ---------------- */

function pauseBackgroundMediaForCall(){
  /* A Signal open behind the call screen kept its timer running: it moved
     on to the next person or closed itself during the call, leaving a stale
     Back step, so after the call Back did nothing or left the app. It now
     waits, and carries on from the same Signal when the call is over. */
  try{
    const bv = document.getElementById('bviewer');
    if(bv && bv.classList.contains('active') && !window.__nalunoStoryHeldForCall){
      window.__nalunoStoryHeldForCall = true;
      if(typeof clearSegTimer === 'function') clearSegTimer();
      const bar = document.querySelectorAll('#bviewerBars .bar i')[typeof currentSegmentIndex !== 'undefined' ? currentSegmentIndex : 0];
      if(bar){ const w = bar.getBoundingClientRect().width, pw = (bar.parentElement.getBoundingClientRect().width || 1); bar.style.transition = 'none'; bar.style.width = Math.round(100 * w / pw) + '%'; }
    }
  }catch(_){}
  try{
    document.querySelectorAll('video, audio').forEach(function(el){
      try{
        if(el.closest && el.closest('#callOverlay')) return;
        const id = el.id || '';
        if(id === 'remoteVideo' || id === 'incomingSelfVideo' || id === 'pipRawVideo' || id === 'camRawVideo' || id === 'sendRawVideo') return;
        if(el.paused === false){
          el.dataset.nalunoWasPlaying = '1';
          el.pause();
        }
      }catch(_){}
    });
  }catch(_){}
}
function resumeBackgroundMediaAfterCall(){
  try{
    if(window.__nalunoStoryHeldForCall){
      window.__nalunoStoryHeldForCall = false;
      const bv = document.getElementById('bviewer');
      if(bv && bv.classList.contains('active') && typeof playSegment === 'function' && typeof currentSegmentIndex !== 'undefined'){
        setTimeout(function(){ try{ if(bv.classList.contains('active') && !document.getElementById('callOverlay').classList.contains('active')) playSegment(currentSegmentIndex, 1); }catch(_){} }, 60);
      }
    }
  }catch(_){}
  try{
    document.querySelectorAll('video, audio').forEach(function(el){
      try{
        if(el.dataset && el.dataset.nalunoWasPlaying === '1'){
          el.dataset.nalunoWasPlaying = '';
          const p = el.play();
          if(p && p.catch) p.catch(function(){});
        }
      }catch(_){}
    });
  }catch(_){}
}

function showCallScreen(id){
  try{ if(typeof prewarmCameraForCall === 'function' && arguments[0] !== 'incall' && nalunoCallKind !== 'audio') prewarmCameraForCall(); }catch(_){}

  document.querySelectorAll('.callscreen').forEach(s=>s.classList.remove('active'));
  const screen = $(id);
  if(screen) screen.classList.add('active');
  if(id !== 'incall'){
    try{ closeIncallWire(); }catch(_){}
  }
  const ov = $('callOverlay');
  if(ov){
    ov.classList.add('active');
    // Above Broadcast (80), Band, Wireline, live chrome.
    // LOCK (cosmetic fix): was set to 200 here then unconditionally overwritten to
    // 300 a few lines below in the same call — dead write, removed. Final value
    // (300, set further down) is unchanged.
    ov.style.opacity = '1';
    ov.style.pointerEvents = 'auto';
    ov.style.display = 'flex';
    ov.style.visibility = 'visible';
  }
  try{ pauseBackgroundMediaForCall(); }catch(_){}
  try{
    if($('wirelineThread')){
      $('wirelineThread').style.zIndex = '110';
      $('wirelineThread').style.pointerEvents = 'none';
    }
    if($('bspace')){ $('bspace').style.zIndex = '100'; }
    if($('bandRoom')){ $('bandRoom').style.zIndex = '100'; }
    const ov = $('callOverlay');
    if(ov){
      ov.style.zIndex = '300';
      ov.style.pointerEvents = 'auto';
    }
    if($('bspaceLiveBanner')) $('bspaceLiveBanner').style.pointerEvents = 'none';
  }catch(_){}
  try{
    if(!window.__nalunoCallHist){
      window.__nalunoCallHist = true;
      history.pushState({ nalunoCall: 1 }, '', location.pathname + location.search + '#call/' + Date.now());
    }
  }catch(_){}
}
function nalunoTellSw(msg){
  try{
    if(navigator.serviceWorker && navigator.serviceWorker.controller){
      navigator.serviceWorker.controller.postMessage(msg);
    }
    if(navigator.serviceWorker && navigator.serviceWorker.ready){
      navigator.serviceWorker.ready.then(function(reg){
        try{ if(reg.active) reg.active.postMessage(msg); }catch(_){}
      }).catch(function(){});
    }
  }catch(_){}
}
function nalunoTellSwCallHandled(callId){
  nalunoTellSw({ type: 'naluno-call-handled', callId: callId || '' });
}
function nalunoStartBackgroundRing(callId, name){
  const title = (name || 'Someone') + ' is calling';
  const body = 'Naluno · tap to answer';
  nalunoTellSw({ type: 'naluno-start-ring', callId: callId || '', title: title, body: body, loop: true });
  try{
    if(typeof document !== 'undefined' && document.hidden && typeof Notification !== 'undefined' && Notification.permission === 'granted'){
      if(!(navigator.serviceWorker && navigator.serviceWorker.controller)){
        const n = new Notification(title, {
          body: body,
          tag: callId ? ('naluno-call:' + callId) : 'naluno-call',
          renotify: true,
          requireInteraction: true,
          icon: '/icon-192.png',
          data: { callId: callId || '', type: 'incoming_call' }
        });
        n.onclick = function(){
          try{ n.close(); }catch(_){}
          try{ window.focus(); }catch(_){}
          if(callId && typeof handleIncomingCallFromPush === 'function') handleIncomingCallFromPush(callId);
        };
      }
    }
  }catch(_){}
}
function nalunoShowCallNotice(callId, name){
  const title = (name || 'Someone') + ' is calling';
  const body = 'Naluno · tap to answer';
  nalunoTellSw({ type: 'naluno-start-ring', callId: callId || '', title: title, body: body, loop: false });
}
function incomingCallStillRinging(){
  try{
    const ov = $('callOverlay');
    const incoming = $('incoming');
    return !!(activeCallId && ov && ov.classList.contains('active') && incoming && incoming.classList.contains('active'));
  }catch(_){ return false; }
}
let incomingCallKeepAlive = false;
function startIncomingKeepAlive(){
  if(incomingCallKeepAlive) return;
  incomingCallKeepAlive = true;
  try{ if(typeof nalunoKeepAliveStart === 'function') nalunoKeepAliveStart('incoming-call'); }catch(_){}
}
function stopIncomingKeepAlive(){
  if(!incomingCallKeepAlive) return;
  incomingCallKeepAlive = false;
  try{ if(typeof nalunoKeepAliveStop === 'function') nalunoKeepAliveStop(); }catch(_){}
}
function nalunoDismissCallNotifications(callId){
  try{ nalunoTellSwCallHandled(callId); }catch(_){}
  try{
    if(!navigator.serviceWorker || !navigator.serviceWorker.ready) return;
    navigator.serviceWorker.ready.then(function(reg){
      return reg.getNotifications();
    }).then(function(list){
      (list || []).forEach(function(n){
        const d = n.data || {};
        if(d.type === 'incoming_call' && (!callId || !d.callId || d.callId === callId)){
          try{ n.close(); }catch(_){}
        }
      });
    }).catch(function(){});
  }catch(_){}
}
function closeCallOverlay(opts){
  const keepHistory = !!(opts && opts.keepHistory);
  try{ stopCallerTone(); }catch(_){}
  try{ stopRingtone(); }catch(_){}
  try{
    if(ringtoneAudioEl){
      ringtoneAudioEl.pause();
      ringtoneAudioEl.removeAttribute('src');
      ringtoneAudioEl.load();
    }
  }catch(_){}
  try{ nalunoDismissCallNotifications(activeCallId); }catch(_){}
  try{ stopIncomingKeepAlive(); }catch(_){}
  const ov = $('callOverlay');
  if(ov){
    ov.classList.remove('active');
    ov.style.zIndex = '';
    ov.style.display = '';
    ov.style.opacity = '';
    ov.style.pointerEvents = '';
  }
  document.querySelectorAll('.callscreen').forEach(s=>s.classList.remove('active'));
  try{
    if($('bspace')) $('bspace').style.zIndex = '';
    if($('bandRoom')) $('bandRoom').style.zIndex = '';
    if($('wirelineThread')){
      $('wirelineThread').style.zIndex = '';
      $('wirelineThread').style.pointerEvents = '';
    }
    if($('bspaceLiveBanner')) $('bspaceLiveBanner').style.pointerEvents = '';
  }catch(_){}
  /* keepHistory: another call screen is about to open in its place (an
     incoming call replacing the lobby). Going Back here landed AFTER the new
     screen pushed its own entry, so the Back handler ended the new call the
     moment it appeared. The existing call entry is simply reused. */
  if(keepHistory) return;
  const hadHist = !!window.__nalunoCallHist;
  try{ window.__nalunoCallHist = false; }catch(_){}
  if(hadHist){
    try{
      /* Only mark a pop as ours when we actually go back. Setting it and
         not going back swallowed the next Back press after a call. */
      if(history.state && history.state.nalunoCall){
        window.__nalunoCallPop = Date.now();
        history.back();
      }
    }catch(_){}
  }
}

/* ---- A call's status only moves forward ----
   ringing -> accepted / declined / missed / busy / ended, accepted -> ended.
   Each phone used to overwrite the status blindly, so whoever wrote last
   won: an Answer landing just after the caller hung up turned an ended call
   back into 'accepted' and left the answering phone alone in a dead call.
   Now the move is checked inside a transaction (and by firestore.rules). */
const NALUNO_CALL_NEXT = { ringing: ['accepted', 'declined', 'missed', 'busy', 'ended'], accepted: ['ended'] };
function nalunoCallMoveOk(from, to){
  if(from === to) return to === 'ended' ? 'same' : false;
  return (NALUNO_CALL_NEXT[from] || []).indexOf(to) >= 0;
}
function nalunoCallMove(callId, to, extra){
  if(!callId || typeof fbDb === 'undefined' || !fbDb) return Promise.resolve(false);
  const ref = fbDb.collection('calls').doc(callId);
  const patch = Object.assign({ status: to }, extra || {});
  /* Fallback: a plain read-then-write. firestore.rules is what really holds
     the line (a status only moves forward there), so if the call moved on in
     the meantime the write is refused and this answers false. */
  const plain = function(){
    return ref.get().then(function(snap){
      if(!snap || !snap.exists) return false;
      const ok = nalunoCallMoveOk((snap.data() || {}).status || '', to);
      if(ok === 'same') return true;
      if(!ok) return false;
      return ref.update(patch).then(function(){ return true; }, function(e){ return !(e && e.code === 'permission-denied'); });
    }, function(){
      // Could not even read it (offline): write anyway; the rules still refuse a backwards move.
      return ref.update(patch).then(function(){ return true; }, function(e){ return !(e && e.code === 'permission-denied'); });
    });
  };
  if(typeof fbDb.runTransaction !== 'function') return plain();
  /* The transaction stops two of the same person's phones from both
     answering. It used to be the only path: when the transaction itself
     failed on a phone (a flaky connection, the SDK giving up after retries),
     that looked exactly like "the call is gone", and the caller never heard
     the answer or the decline. A failed transaction now falls back to the
     plain checked write; a clear "no, it already moved on" does not. */
  return fbDb.runTransaction(function(tx){
    return tx.get(ref).then(function(snap){
      if(!snap || !snap.exists) return false;
      const ok = nalunoCallMoveOk((snap.data() || {}).status || '', to);
      if(ok === 'same') return true;
      if(!ok) return false;
      tx.update(ref, patch);
      return true;
    });
  }).catch(function(e){
    if(e && e.code === 'permission-denied') return false;
    return plain();
  });
}
window.nalunoCallMove = nalunoCallMove;
/* Server time, from the web server's own Date header (one tiny request), so
   a phone whose clock is wrong can still tell an old ring from a new one. */
let nalunoServerSkew = null;
function nalunoMeasureSkew(){
  try{
    fetch('/manifest.json?skew=' + Date.now(), { method: 'HEAD', cache: 'no-store' }).then(function(r){
      const d = r && r.headers && r.headers.get('Date');
      const t = d ? Date.parse(d) : NaN;
      if(isFinite(t)) nalunoServerSkew = t - Date.now();
    }).catch(function(){});
  }catch(_){}
}
try{ nalunoMeasureSkew(); }catch(_){}
/* A ring whose caller's phone died is left 'ringing' in the database. The
   incoming-call listener delivers every ringing call when it (re)attaches,
   so it rang again hours later with nobody there. */
function nalunoRingIsStale(data){
  try{
    const c = data && data.createdAt;
    const ms = !c ? 0 : (typeof c.toMillis === 'function' ? c.toMillis() : (c.seconds ? c.seconds * 1000 : Number(c)));
    if(!ms) return false;
    const serverNow = Date.now() + (nalunoServerSkew || 0);
    const limit = (nalunoServerSkew == null) ? 10 * 60000 : 100000;
    return serverNow - ms > limit;
  }catch(_){ return false; }
}
window.nalunoRingIsStale = nalunoRingIsStale;

window.addEventListener('popstate', function(){
  if(window.__nalunoCallPop && !window.__nalunoCallHist){
    return;
  }
  if(!window.__nalunoCallHist) return;
  window.__nalunoCallHist = false;
  /* This pop was the phone's Back, already seen by the Back handler in
     profile.js. Marking it "ours" here left the mark standing, and it
     swallowed the next real Back press after the call. */
  window.__nalunoCallPop = false;
  try{
    if($('callOverlay') && $('callOverlay').classList.contains('active')){
      if(typeof endActiveCall === 'function') endActiveCall('back');
      else closeCallOverlayAndStopCamera();
    }
  }catch(_){}
});


/* Remember which full-screen surface was open so hangup can restore it.
   Missing definition was throwing and aborting startOutgoingCall mid-way. */
let _callUiSnapshot = null;
function snapshotUiBeforeCall(){
  try{
    _callUiSnapshot = {
      bspace: !!( $('bspace') && $('bspace').classList.contains('active') ),
      bandRoom: !!( $('bandRoom') && $('bandRoom').classList.contains('active') ),
      wireline: !!( $('wirelineThread') && $('wirelineThread').classList.contains('active') ),
      threadContactId: (typeof activeThreadContactId !== 'undefined' ? activeThreadContactId : null)
        || (typeof window !== 'undefined' && window.__wirelineCallContactId)
        || currentCallContactId || null,
      activeTab: (document.querySelector('.tabscreen.active') || {}).id || null,
      bandLive: !!(typeof bandLiveLocalStream !== 'undefined' && bandLiveLocalStream),
    };
  }catch(_){
    _callUiSnapshot = null;
  }
}
function restoreUiAfterCall(){
  try{
    try{ resumeBackgroundMediaAfterCall(); }catch(_){}
    const s = _callUiSnapshot;
    _callUiSnapshot = null;
    // Always clear blank call shell
    const ov = $('callOverlay');
    if(ov){
      ov.classList.remove('active');
      ov.style.zIndex = '';
      ov.style.display = '';
      ov.style.opacity = '';
      ov.style.pointerEvents = '';
    }
    document.querySelectorAll('.callscreen').forEach(sc=>sc.classList.remove('active'));
    /* Tabs change through the app's own switch, so the tab bar and the Back
       history stay in step (setting classes by hand left them out of sync). */
    const showTab = function(id){
      const key = String(id || '').replace(/^tab-/, '');
      if(!key) return;
      try{ if(typeof nalunoShowTab === 'function'){ nalunoShowTab(key); return; } }catch(_){}
      document.querySelectorAll('.tabscreen').forEach(t=>t.classList.remove('active'));
      if($('tab-' + key)) $('tab-' + key).classList.add('active');
    };
    if(!s){
      // No snapshot: keep the current tab; only fall back if none is showing.
      if(!document.querySelector('.tabscreen.active')) showTab('frequencies');
      return;
    }
    if(s.bandRoom && $('bandRoom')){
      $('bandRoom').classList.add('active');
      $('bandRoom').style.zIndex = '';
    } else if(s.bspace && $('bspace')){
      /* No inline display here. `display:flex` set inline outlived the room:
         after Back removed .active the Broadcast stayed drawn over the whole
         app, so its back button, the phone's Back and the page below all
         stopped responding (only the tab bar showed above it). */
      $('bspace').classList.add('active');
      $('bspace').style.zIndex = '';
      $('bspace').style.display = '';
    } else if(s.wireline && typeof openThread === 'function'){
      const id = (typeof activeThreadContactId !== 'undefined' && activeThreadContactId)
        || s.threadContactId
        || currentCallContactId;
      if(id){
        try{ openThread(id); }catch(_){}
      } else {
        showTab('wireline');
      }
    } else if(s.activeTab && $(s.activeTab)){
      if(!$(s.activeTab).classList.contains('active')) showTab(s.activeTab);
    } else if(!document.querySelector('.tabscreen.active')){
      showTab('frequencies');
    }
  }catch(e){ console.warn('[call] restore', e); }
}

let currentCallContactId = null;
let ringTimeoutHandle = null;

/* ---------------- CALL AUDIO (ringback + ringtone) ----------------
   Synthesized procedurally with the Web Audio API — no audio files, same principle as
   every other "live" element in this app being generated rather than pre-recorded.
   Browsers block audio from starting without a real prior user gesture, so the shared
   AudioContext piggybacks on the exact same click/keydown/touchstart listeners that
   already track your own activity — by the time a real call happens, it's unlocked. */
let sharedAudioCtx = null;
function ensureAudioContext(){
  if(!sharedAudioCtx){
    try{ sharedAudioCtx = new (window.AudioContext || window.webkitAudioContext)(); }catch(e){ return null; }
  }
  if(sharedAudioCtx.state === 'suspended') sharedAudioCtx.resume().catch(()=>{});
  return sharedAudioCtx;
}
['click','keydown','touchstart','pointerdown'].forEach(evt => document.addEventListener(evt, ensureAudioContext, { passive:true }));
document.addEventListener('visibilitychange', function(){
  if(!incomingCallStillRinging()) return;
  const name = ($('incomingName') && $('incomingName').textContent) || 'Someone';
  if(document.hidden){
    try{ if(sharedAudioCtx && sharedAudioCtx.state === 'suspended') sharedAudioCtx.resume().catch(function(){}); }catch(_){}
    try{ startRingtone(); }catch(_){}
    nalunoStartBackgroundRing(activeCallId, name);
  } else {
    try{ startRingtone(); }catch(_){}
  }
});

/* In-app ring levels (Web Audio). Device volume still applies on top.
   Previous peaks were ~0.06–0.09 — far too quiet. ~4× keeps headroom under 1.0. */
const RING_GAIN_CALLER = 0.28;   // was 0.06
const RING_GAIN_CALLEE = 0.36;   // was 0.09
const RING_GAIN_CUSTOM = 1.0;    // HTMLAudioElement max; boosted via Web Audio when possible

let callerToneTimer = null;
let callerToneActiveNodes = [];
/* Caller-side ringback — a soft two-tone pulse, echoing the classic telecom ringback
   pattern (paired tones, ring then pause) without literally imitating a phone ring. */
function startCallerTone(){
  stopCallerTone();
  const ctx = ensureAudioContext(); if(!ctx) return;
  function pulse(){
    const osc1 = ctx.createOscillator(), osc2 = ctx.createOscillator(), gain = ctx.createGain();
    osc1.type = 'sine'; osc1.frequency.value = 440;
    osc2.type = 'sine'; osc2.frequency.value = 480;
    const now = ctx.currentTime;
    const peak = (typeof RING_GAIN_CALLER === 'number') ? RING_GAIN_CALLER : 0.28;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(peak, now + 0.04);
    gain.gain.setValueAtTime(peak, now + 1.9);
    gain.gain.linearRampToValueAtTime(0, now + 2.0);
    osc1.connect(gain); osc2.connect(gain); gain.connect(ctx.destination);
    osc1.start(now); osc2.start(now);
    osc1.stop(now + 2.0); osc2.stop(now + 2.0);
    callerToneActiveNodes.push(osc1, osc2);
  }
  pulse();
  callerToneTimer = setInterval(pulse, 4000); // ~2s tone, ~2s pause, repeating
}
/* clearInterval alone only stops FUTURE pulses from being scheduled — any oscillators
   already playing from the last pulse were still scheduled to run out their full 2s
   regardless, which is exactly what let the ringback linger into an already-connected
   call. Explicitly stopping every active node makes this genuinely immediate. */
function stopCallerTone(){
  clearInterval(callerToneTimer); callerToneTimer = null;
  callerToneActiveNodes.forEach(osc=>{ try{ osc.stop(); }catch(e){} });
  callerToneActiveNodes = [];
}

let ringtoneTimer = null;
let ringtoneActiveNodes = [];
let customRingtoneUrl = null;
let customRingtoneName = '';
let customRingtoneObjectUrl = null;
let ringtoneAudioEl = null;
let ringtoneBuffer = null;
let ringtoneWebSource = null;
function startRingtone(){
  stopRingtone();
  try{ ensureAudioContext(); }catch(_){}
  if(customRingtoneUrl){
    playCustomRingtoneWebAudio().catch(function(){ startSynthRingtone(); });
    return;
  }
  startSynthRingtone();
}
function playCustomRingtoneWebAudio(){
  const ctx = ensureAudioContext();
  if(!ctx) return Promise.reject(new Error('no audio'));
  const startBuf = function(buffer){
    if(ctx.state === 'suspended') ctx.resume().catch(function(){});
    try{ if(ringtoneWebSource) ringtoneWebSource.stop(); }catch(_){}
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    const g = ctx.createGain();
    g.gain.value = 1.6;
    src.connect(g);
    g.connect(ctx.destination);
    src.start(0);
    ringtoneWebSource = src;
    ringtoneActiveNodes.push(src);
  };
  if(ringtoneBuffer){
    startBuf(ringtoneBuffer);
    return Promise.resolve();
  }
  return fetch(customRingtoneUrl).then(function(r){ return r.arrayBuffer(); }).then(function(ab){
    return ctx.decodeAudioData(ab.slice ? ab.slice(0) : ab);
  }).then(function(buffer){
    ringtoneBuffer = buffer;
    startBuf(buffer);
  });
}
function startSynthRingtone(){
  const ctx = ensureAudioContext();
  if(!ctx){
    if(document.hidden) nalunoStartBackgroundRing(activeCallId, ($('incomingName') && $('incomingName').textContent) || 'Someone');
    return;
  }
  if(ctx.state === 'suspended') ctx.resume().catch(function(){});
  function chime(){
    const notes = [660, 880, 1046.5];
    const now = ctx.currentTime;
    notes.forEach((freq, i)=>{
      const osc = ctx.createOscillator(), gain = ctx.createGain();
      osc.type = 'sine'; osc.frequency.value = freq;
      const t0 = now + i*0.13;
      const peak = (typeof RING_GAIN_CALLEE === 'number') ? RING_GAIN_CALLEE : 0.36;
      gain.gain.setValueAtTime(0, t0);
      gain.gain.linearRampToValueAtTime(peak, t0+0.02);
      gain.gain.linearRampToValueAtTime(0, t0+0.25);
      osc.connect(gain); gain.connect(ctx.destination);
      osc.start(t0); osc.stop(t0+0.24);
      ringtoneActiveNodes.push(osc);
    });
  }
  chime();
  ringtoneTimer = setInterval(chime, 1800);
}
/* clearInterval alone only stops FUTURE chimes from being scheduled — any oscillators
   already playing from the last chime were still scheduled to run out their full
   duration regardless, which is exactly what let the ringtone keep sounding even
   after answering. Same bug as the caller's ringback tone had, fixed the same way:
   explicitly stopping every active node makes this genuinely immediate. */
function stopRingtone(){
  clearInterval(ringtoneTimer); ringtoneTimer = null;
  ringtoneActiveNodes.forEach(osc=>{ try{ osc.stop(); }catch(e){} });
  ringtoneActiveNodes = [];
  if(ringtoneWebSource){
    try{ ringtoneWebSource.stop(); }catch(_){}
    try{ ringtoneWebSource.disconnect(); }catch(_){}
    ringtoneWebSource = null;
  }
  if(ringtoneAudioEl){
    try{ ringtoneAudioEl.pause(); }catch(_){}
    try{ ringtoneAudioEl.removeAttribute('src'); ringtoneAudioEl.load(); }catch(_){}
  }
}

/* Custom ringtone — a full song on this phone. IndexedDB holds the file
   (localStorage's 4MB cap is why a track used to be refused). No accept=
   filter on the picker: Android's audio/* sheet is short sounds, and a
   short extension list hid flac/wma/aiff and the rest. Files opens with
   every file; we only refuse photos/docs and oversized tracks. */
const RINGTONE_MAX_BYTES = 80 * 1024 * 1024;
function ringtoneDbOpen(){
  return new Promise(function(resolve, reject){
    try{
      const req = indexedDB.open('naluno-ringtone', 1);
      req.onupgradeneeded = function(){
        const db = req.result;
        if(!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
      };
      req.onsuccess = function(){ resolve(req.result); };
      req.onerror = function(){ reject(req.error); };
    }catch(e){ reject(e); }
  });
}
function ringtoneDbPut(record){
  return ringtoneDbOpen().then(function(db){
    return new Promise(function(resolve, reject){
      const tx = db.transaction('meta', 'readwrite');
      tx.objectStore('meta').put(record, 'current');
      tx.oncomplete = function(){ resolve(); };
      tx.onerror = function(){ reject(tx.error); };
    });
  });
}
function ringtoneDbGet(){
  return ringtoneDbOpen().then(function(db){
    return new Promise(function(resolve, reject){
      const tx = db.transaction('meta', 'readonly');
      const req = tx.objectStore('meta').get('current');
      req.onsuccess = function(){ resolve(req.result || null); };
      req.onerror = function(){ reject(req.error); };
    });
  });
}
function ringtoneDbClear(){
  return ringtoneDbOpen().then(function(db){
    return new Promise(function(resolve){
      try{
        const tx = db.transaction('meta', 'readwrite');
        tx.objectStore('meta').delete('current');
        tx.oncomplete = function(){ resolve(); };
        tx.onerror = function(){ resolve(); };
      }catch(_){ resolve(); }
    });
  });
}
function setCustomRingtoneFromBlob(blob, name){
  if(customRingtoneObjectUrl){
    try{ URL.revokeObjectURL(customRingtoneObjectUrl); }catch(_){}
    customRingtoneObjectUrl = null;
  }
  customRingtoneObjectUrl = URL.createObjectURL(blob);
  customRingtoneUrl = customRingtoneObjectUrl;
  customRingtoneName = name || '';
  ringtoneBuffer = null;
}
if($('uploadRingtoneBtn')) $('uploadRingtoneBtn').onclick = function(){ /* overlay input is the tap target */ };
$('ringtoneFileInput').onchange = async (e)=>{
  const file = e.target.files[0];
  e.target.value = '';
  if(!file) return;
  const mime = String(file.type || '').toLowerCase();
  const name = String(file.name || 'song');
  const looksDoc = /^(image|text)\//.test(mime) || /^application\/(pdf|zip|msword|vnd\.|json|xml)/.test(mime)
    || /\.(png|jpe?g|gif|webp|heic|bmp|svg|pdf|txt|doc|docx|xls|xlsx|ppt|pptx|zip|html?)$/i.test(name);
  if(looksDoc){ toast('Pick a song, not that file'); return; }
  if(file.size > RINGTONE_MAX_BYTES){ toast('That track is too large — pick one under 80MB'); return; }
  try{
    await ringtoneDbPut({ blob: file, name: name, type: file.type || 'application/octet-stream', at: Date.now() });
    try{ localStorage.removeItem('naluno:customRingtone'); }catch(_){}
    try{ localStorage.setItem('naluno:customRingtoneName', name); }catch(_){}
    setCustomRingtoneFromBlob(file, name);
    if($('ringtoneStatus')) $('ringtoneStatus').textContent = 'Using “' + name + '” — the whole track, looping.';
    if($('resetRingtoneBtn')) $('resetRingtoneBtn').style.display = 'block';
    toast('Ringtone updated');
  }catch(err){
    toast('Couldn\u2019t keep that song on this phone');
  }
};
$('resetRingtoneBtn').onclick = ()=>{
  try{ localStorage.removeItem('naluno:customRingtone'); }catch(e){}
  try{ localStorage.removeItem('naluno:customRingtoneName'); }catch(e){}
  ringtoneDbClear().catch(function(){});
  if(customRingtoneObjectUrl){
    try{ URL.revokeObjectURL(customRingtoneObjectUrl); }catch(_){}
    customRingtoneObjectUrl = null;
  }
  customRingtoneUrl = null;
  customRingtoneName = '';
  if($('ringtoneStatus')) $('ringtoneStatus').textContent = 'Using the built-in tone. Any music file on this phone — this device only.';
  if($('resetRingtoneBtn')) $('resetRingtoneBtn').style.display = 'none';
  toast('Back to the built-in tone');
};
$('signOutBtn').onclick = ()=>{
  if(!fbAuth){ toast('Not signed in'); return; }
  window.__nalunoSigningOut = true;
  try{ localStorage.removeItem('nalunoLastUid'); }catch(_){}
  const go = function(){ fbAuth.signOut().catch(e=> toast(e.message || 'Couldn\u2019t sign out')); };
  if(window.NalunoSecurity && NalunoSecurity.note){
    NalunoSecurity.note('logout').then(go, go);
  } else go();
};
(function loadCustomRingtone(){
  ringtoneDbGet().then(function(rec){
    if(rec && rec.blob){
      setCustomRingtoneFromBlob(rec.blob, rec.name || '');
      const label = rec.name ? ('Using “' + rec.name + '” — the whole track, looping.') : 'Using your song.';
      if($('ringtoneStatus')) $('ringtoneStatus').textContent = label;
      if($('resetRingtoneBtn')) $('resetRingtoneBtn').style.display = 'block';
      return;
    }
    try{
      const saved = localStorage.getItem('naluno:customRingtone');
      if(saved){
        customRingtoneUrl = saved;
        if($('ringtoneStatus')) $('ringtoneStatus').textContent = 'Using your uploaded sound.';
        if($('resetRingtoneBtn')) $('resetRingtoneBtn').style.display = 'block';
      }
    }catch(e){}
  }).catch(function(){
    try{
      const saved = localStorage.getItem('naluno:customRingtone');
      if(saved){
        customRingtoneUrl = saved;
        if($('ringtoneStatus')) $('ringtoneStatus').textContent = 'Using your uploaded sound.';
        if($('resetRingtoneBtn')) $('resetRingtoneBtn').style.display = 'block';
      }
    }catch(e){}
  });
})();

/* ---------------- REAL CALLS (WebRTC, Firestore signaling) ----------------
   Each call is one Firestore document: the caller writes an offer, the callee writes
   an answer, and both sides exchange ICE candidates as documents in subcollections.
   No TURN server is configured here — only public STUN — so two people both behind
   strict/symmetric NATs may fail to connect to each other specifically. Add a TURN
   entry to RTC_CONFIG once you have one (Twilio, Xirsys, metered.ca all have options). */
/* ICE/TURN moved to js/ice-core.js — use getIceServers() / IceCore */
let peerConnection = null;
/* Neither "Start call" nor "Accept" had any protection against firing twice — a real,
   easy-to-trigger double-tap on a touchscreen (or just impatience while a screen
   transition is mid-flight) would run the whole offer/answer flow twice, creating two
   separate call documents and two separate peer connections for what should be one
   attempt. If the other person's answer landed on the attempt the caller *wasn't*
   still listening to, the caller would never see it — exactly "still ringing while the
   other side already has video." This flag makes a second tap during setup a no-op. */
let callActionInProgress = false;
let activeCallId = null;
let iAmCaller = false;
let remoteDescriptionSet = false;
let pendingRemoteCandidates = [];
let activeCallDocUnsub = null;
let callerCandidatesUnsub = null;
let calleeCandidatesUnsub = null;
let incomingCallUnsub = null;

let remoteCombinedStream = null;
let remotePlayTimer = null;
let remotePlayWatch = null;
let remoteFrameRaf = null;

/* ============================================================
   REMOTE MEDIA — rewritten state machine (2026.08.16f)
   Rules:
   - Avatar is default while in-call until real video frames exist.
   - A visible paused <video> draws Android WebView's big play logo — never allowed.
   - Audio plays from the same MediaStream on the (possibly hidden) video element.
   - Filters stay optional outbound replaceTrack after connect.
   ============================================================ */

function getRemoteMediaState(){
  const stream = remoteCombinedStream;
  const videoEl = document.getElementById('remoteVideo');
  if(!stream){
    return {
      hasAudio: false,
      hasVideo: false,
      videoLive: false,
      trackCount: 0,
      videoTrackCount: 0,
      playing: false,
      hasFrames: false,
    };
  }
  const audioTracks = stream.getAudioTracks();
  const videoTracks = stream.getVideoTracks();
  const hasAudio = audioTracks.some(t => t.readyState === 'live');
  const liveVideo = videoTracks.filter(t => t.readyState === 'live');
  const hasVideo = liveVideo.length > 0;
  const videoLive = liveVideo.some(t => t.enabled !== false);
  const playing = !!(videoEl && videoEl.srcObject && !videoEl.paused);
  const hasFrames = !!(videoEl && videoEl.videoWidth > 0 && videoEl.videoHeight > 0);
  return {
    hasAudio,
    hasVideo,
    videoLive,
    trackCount: stream.getTracks().length,
    videoTrackCount: videoTracks.length,
    playing,
    hasFrames,
  };
}

/* ---- What the screen shows for the other person (29d) ----
   It used to switch between the avatar, a black box and the video several
   times while a call connected: the video element was shown the moment it
   was "playing" (before any picture had arrived), hidden again whenever a
   check found it paused, and every 3.5 s without a picture the watcher tore
   the stream off the element and put it back (srcObject = null), which
   restarted the decoder and started the whole cycle again.

   Now: the element is kept on screen but fully transparent (so the phone
   keeps decoding it and never draws its play logo), the avatar stays in
   front until the first real frame has been painted, and then the video
   stays. It only goes back to the avatar when the other camera is really
   gone (track ended, or switched off / silent for more than 2.5 s). */
let remoteFirstFrame = false;
let nalunoCallLive = false;
function nalunoMarkCallLive(){
  if(nalunoCallLive) return;
  nalunoCallLive = true;
  try{
    if(typeof nalunoSessionHold === 'function') nalunoSessionHold(nalunoIsVoiceCall() ? 'voice' : 'video');
  }catch(_){}
  try{ if(window.nalunoPip && nalunoPip.arm) nalunoPip.arm(); }catch(_){}
  try{ nalunoApplyEarpiece(); }catch(_){}
  try{ nalunoBoostRemoteAudio(remoteCombinedStream); }catch(_){}
  if(nalunoIsVoiceCall()){ try{ nalunoApplyEarpiece(); }catch(_){} }
  try{ const eb = document.querySelector('#incall .call-info-pill .eyebrow'); if(eb) eb.textContent = 'Connected'; }catch(_){}
  callSeconds = 0;
  try{ $('callTimer').textContent = '00:00'; }catch(_){}
  clearInterval(callInterval);
  callInterval = setInterval(function(){
    callSeconds++;
    const m = String(Math.floor(callSeconds/60)).padStart(2,'0');
    const sec = String(callSeconds%60).padStart(2,'0');
    $('callTimer').textContent = m+':'+sec;
  }, 1000);
}
let remoteVideoGoneSince = 0;
function nalunoRemoteFrameArrived(){
  if(remoteFirstFrame) return;
  remoteFirstFrame = true;
  try{ nalunoMarkCallLive(); }catch(_){}
  showRemoteVideo();
}
function nalunoWatchFirstFrame(videoEl){
  if(!videoEl || remoteFirstFrame || videoEl._nalunoFrameWatch) return;
  videoEl._nalunoFrameWatch = true;
  const done = function(){ videoEl._nalunoFrameWatch = false; nalunoRemoteFrameArrived(); };
  try{
    if(typeof videoEl.requestVideoFrameCallback === 'function'){
      videoEl.requestVideoFrameCallback(function(){ done(); });
      return;
    }
  }catch(_){}
  // No frame callback: first decoded frame shows up as a size, with time moving.
  const t0 = videoEl.currentTime;
  const poll = function(){
    if(remoteFirstFrame){ videoEl._nalunoFrameWatch = false; return; }
    if(videoEl.videoWidth > 0 && videoEl.currentTime > t0){ done(); return; }
    remoteFrameRaf = requestAnimationFrame(poll);
  };
  remoteFrameRaf = requestAnimationFrame(poll);
}
function nalunoRemoteVideoAlive(){
  const t = remoteCombinedStream && remoteCombinedStream.getVideoTracks().find(function(x){ return x.readyState === 'live'; });
  if(!t || t.enabled === false){ return false; }
  if(t.muted){
    if(!remoteVideoGoneSince) remoteVideoGoneSince = Date.now();
    return (Date.now() - remoteVideoGoneSince) < 2500;
  }
  remoteVideoGoneSince = 0;
  return true;
}
function nalunoSetRemoteLayers(showVideo){
  const videoEl = document.getElementById('remoteVideo');
  const ph = document.getElementById('remotePlaceholder');
  if(videoEl){
    if(videoEl.srcObject) videoEl.style.display = 'block';
    videoEl.style.opacity = showVideo ? '1' : '0';
    try{
      if(showVideo) videoEl.setAttribute('data-has-frames', '1');
      else videoEl.removeAttribute('data-has-frames');
    }catch(_){}
  }
  if(ph){
    ph.style.display = showVideo ? 'none' : 'flex';
    ph.style.visibility = 'visible';
    ph.style.opacity = '1';
  }
}
function showRemoteAvatar(){
  // Once the picture is up, a passing hiccup (a paused tick, a short mute)
  // does not take it down again; only a camera that is really gone does.
  if(remoteFirstFrame && nalunoRemoteVideoAlive()){
    const v = document.getElementById('remoteVideo');
    if(v && v.paused){ try{ const pr = v.play(); if(pr && pr.catch) pr.catch(function(){}); }catch(_){} }
    return;
  }
  nalunoSetRemoteLayers(false);
  const v = document.getElementById('remoteVideo');
  if(v && v.srcObject) nalunoWatchFirstFrame(v);
}

function showRemoteVideo(){
  const videoEl = document.getElementById('remoteVideo');
  if(!videoEl) return;
  if(!videoEl.srcObject){ nalunoSetRemoteLayers(false); return; }
  videoEl.style.display = 'block';
  nalunoHearRemote(videoEl);
  if(!remoteFirstFrame){
    // Playing is not a picture: keep the avatar in front until a frame is painted.
    nalunoSetRemoteLayers(false);
    nalunoWatchFirstFrame(videoEl);
    return;
  }
  if(!nalunoRemoteVideoAlive()){ nalunoSetRemoteLayers(false); return; }
  nalunoSetRemoteLayers(true);
}

let nalunoRemoteBoost = null;
function nalunoDropRemoteBoost(){
  window.__nalunoRemoteBoosted = false;
  const b = nalunoRemoteBoost;
  nalunoRemoteBoost = null;
  if(!b) return;
  try{ b.src.disconnect(); }catch(_){}
  try{ b.gain.disconnect(); }catch(_){}
  try{ if(b.comp) b.comp.disconnect(); }catch(_){}
}
function nalunoBoostRemoteAudio(stream){
  const srcStream = stream || (typeof remoteCombinedStream !== 'undefined' ? remoteCombinedStream : null);
  if(!srcStream || !srcStream.getAudioTracks || !srcStream.getAudioTracks().length) return false;
  if(typeof nalunoEarpiece !== 'undefined' && nalunoEarpiece) return false;
  const ctx = (typeof ensureAudioContext === 'function') ? ensureAudioContext() : null;
  if(!ctx) return false;
  try{ if(ctx.state === 'suspended') ctx.resume(); }catch(_){}
  try{
    if(nalunoRemoteBoost && nalunoRemoteBoost.stream === srcStream){
      window.__nalunoRemoteBoosted = true;
      return true;
    }
    nalunoDropRemoteBoost();
    const src = ctx.createMediaStreamSource(srcStream);
    const gain = ctx.createGain();
    /* The element volume cannot go past 1, and a phone call is still quiet
       there. This is the extra level, with a limiter so it does not crackle. */
    gain.gain.value = 2.8;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.knee.value = 8;
    comp.ratio.value = 4;
    comp.attack.value = 0.003;
    comp.release.value = 0.16;
    src.connect(gain);
    gain.connect(comp);
    comp.connect(ctx.destination);
    nalunoRemoteBoost = { src: src, gain: gain, comp: comp, stream: srcStream };
    window.__nalunoRemoteBoosted = true;
    return true;
  }catch(_){
    window.__nalunoRemoteBoosted = false;
    return false;
  }
}
function nalunoHearRemote(videoEl){
  if(!videoEl) return;
  try{ videoEl.volume = 1; }catch(_){}
  /* Earpiece uses the call stream itself. The boost plays through the media
     stream, which would stay on the loudspeaker. */
  if(typeof nalunoEarpiece !== 'undefined' && nalunoEarpiece){
    nalunoDropRemoteBoost();
    try{ videoEl.muted = false; }catch(_){}
    return;
  }
  const boosted = nalunoBoostRemoteAudio(videoEl.srcObject);
  const ctx = (typeof sharedAudioCtx !== 'undefined') ? sharedAudioCtx : null;
  const running = !!(ctx && ctx.state === 'running');
  try{ videoEl.muted = !!(boosted && running); }catch(_){}
  if(boosted && ctx && !running && !videoEl._nalunoBoostWait){
    videoEl._nalunoBoostWait = true;
    const on = function(){
      if(ctx.state !== 'running') return;
      videoEl._nalunoBoostWait = false;
      try{ ctx.removeEventListener('statechange', on); }catch(_){}
      if(typeof nalunoEarpiece !== 'undefined' && nalunoEarpiece) return;
      try{ videoEl.muted = true; }catch(_){}
    };
    try{ ctx.addEventListener('statechange', on); }catch(_){}
  }
}
function bindRemoteVideoElement(stream, forceRebind){
  const videoEl = document.getElementById('remoteVideo');
  if(!videoEl || !stream) return;
  try{
    videoEl.removeAttribute('controls');
    videoEl.controls = false;
    videoEl.setAttribute('playsinline', 'true');
    videoEl.setAttribute('webkit-playsinline', 'true');
    videoEl.playsInline = true;
    videoEl.autoplay = true;
    videoEl.muted = true; // autoplay policy; unmute after play + frames
  }catch(_){}

  // Re-assign when stream object changes, or when a NEW video track appeared.
  // Avoid nulling srcObject if the same stream is already playing (causes black gap).
  if(videoEl.srcObject !== stream){
    try{
      videoEl.srcObject = stream;
    }catch(e){
      console.warn('[call] srcObject failed', e);
      return;
    }
  } else if(forceRebind && !remoteFirstFrame){
    // Same MediaStream, new track, and no picture yet — rebind once.
    try{
      const wasPlaying = !videoEl.paused;
      videoEl.srcObject = null;
      videoEl.srcObject = stream;
      if(wasPlaying){
        const p = videoEl.play();
        if(p && p.catch) p.catch(function(){});
      }
    }catch(e){
      console.warn('[call] force rebind failed', e);
    }
  }

  // The element stays on screen (transparent until the first frame) so the
  // phone keeps decoding it; the avatar sits in front until then.
  if(videoEl.srcObject){ videoEl.style.display = 'block'; nalunoWatchFirstFrame(videoEl); }

  const promoteIfReady = function(){
    try{
      if(videoEl.srcObject){
        showRemoteVideo();
      } else if(videoEl.paused){
        showRemoteAvatar();
      }
    }catch(_){}
  };

  try{
    videoEl.onloadedmetadata = promoteIfReady;
    videoEl.onloadeddata = promoteIfReady;
    videoEl.onplaying = promoteIfReady;
    videoEl.onresize = promoteIfReady;
  }catch(_){}

  // Decode path: play muted while hidden
  try{
    const p = videoEl.play();
    if(p && p.then){
      p.then(function(){
        nalunoHearRemote(videoEl);
        promoteIfReady();
        // requestVideoFrameCallback when available
        try{
          if(typeof videoEl.requestVideoFrameCallback === 'function'){
            const onFrame = function(){
              promoteIfReady();
            };
            videoEl.requestVideoFrameCallback(onFrame);
          }
        }catch(_){}
      }).catch(function(err){
        console.warn('[call] remote play failed', err && err.name);
        showRemoteAvatar();
        // Retry muted
        try{
          videoEl.muted = true;
          videoEl.play().then(function(){
            setTimeout(function(){
              nalunoHearRemote(videoEl);
              promoteIfReady();
            }, 200);
          }).catch(function(){ showRemoteAvatar(); });
        }catch(_){}
      });
    }
  }catch(_){
    showRemoteAvatar();
  }
}

function ingestRemoteTrack(track, streams){
  if(!track) return;
  if(!remoteCombinedStream) remoteCombinedStream = new MediaStream();

  try{ track.enabled = true; }catch(_){}
  try{ track.contentHint = track.kind === 'video' ? 'motion' : 'speech'; }catch(_){}

  const liveVideoBefore = remoteCombinedStream.getVideoTracks().filter(function(t){
    return t.readyState === 'live';
  }).length;

  // Prefer whole remote stream when browser supplies it
  if(streams && streams[0]){
    streams[0].getTracks().forEach(function(t){
      if(remoteCombinedStream.getTracks().indexOf(t) === -1){
        remoteCombinedStream.addTrack(t);
      }
    });
  } else if(remoteCombinedStream.getTracks().indexOf(track) === -1){
    remoteCombinedStream.addTrack(track);
  }

  const liveVideoAfter = remoteCombinedStream.getVideoTracks().filter(function(t){
    return t.readyState === 'live';
  }).length;
  // New video track on an already-bound stream must rebind srcObject (Samsung/Chrome WebView)
  const forceRebind = liveVideoAfter > liveVideoBefore && liveVideoBefore === 0 && !!(document.getElementById('remoteVideo') || {}).srcObject;

  try{
    // A short mute (bandwidth dip, the other side switching camera or filter)
    // is checked again after the grace period instead of flipping the screen.
    track.onmute = function(){ renderRemoteMediaStage(); setTimeout(renderRemoteMediaStage, 2600); };
    track.onunmute = function(){ remoteVideoGoneSince = 0; renderRemoteMediaStage(); };
    track.onended = function(){ renderRemoteMediaStage(); };
  }catch(_){}

  bindRemoteVideoElement(remoteCombinedStream, forceRebind);
  renderRemoteMediaStage();
  startRemotePlayWatch();

  if(track.kind === 'audio'){
    try{ if(typeof ensureAudioContext === 'function') ensureAudioContext(); }catch(_){}
  }
  console.log('[call] remote media', getRemoteMediaState());
}

function renderRemoteMediaStage(){
  const videoEl = document.getElementById('remoteVideo');
  if(!videoEl) return;

  const state = getRemoteMediaState();

  if(remoteCombinedStream && remoteCombinedStream.getTracks().length){
    if(videoEl.srcObject !== remoteCombinedStream){
      bindRemoteVideoElement(remoteCombinedStream);
    }
  }

  // No video track → avatar; keep audio playing if present
  if(!state.hasVideo){
    showRemoteAvatar();
    if(state.hasAudio){
      nalunoHearRemote(videoEl);
      try{
        const p = videoEl.play();
        if(p && p.catch) p.catch(function(){});
      }catch(_){}
    }
    return;
  }

  // Has video track — show as soon as element is playing (frames may lag 1–2 frames)
  if(state.playing){
    showRemoteVideo();
    return;
  }

  // Not playing yet — keep avatar, kick play immediately
  showRemoteAvatar();
  try{
    videoEl.muted = true;
    const p = videoEl.play();
    if(p && p.then){
      p.then(function(){
        nalunoHearRemote(videoEl);
        showRemoteVideo();
      }).catch(function(){});
    }
  }catch(_){}
}

function ensureRemoteVideoPlaying(){
  renderRemoteMediaStage();
}

function startRemotePlayWatch(){
  stopRemotePlayWatch();
  let ticks = 0;
  let lastRebind = 0;
  let rebinds = 0;
  /* A rebind (srcObject off and on) restarts the decoder. It is the last
     resort, only when the connection is up, the other video is really
     arriving (track not muted), and still no picture after 5 s; at most
     twice. It used to fire every 3.5 s while a slow call was still
     connecting, which is what made the screen flash. */
  const mayRebind = function(){
    if(remoteFirstFrame || rebinds >= 2 || ticks - lastRebind <= 10) return false;
    const pc = peerConnection;
    if(!pc || pc.connectionState !== 'connected') return false;
    const vt = remoteCombinedStream && remoteCombinedStream.getVideoTracks().find(function(t){ return t.readyState === 'live'; });
    if(!vt || vt.muted) return false;
    rebinds++;
    return true;
  };
  remotePlayWatch = setInterval(function(){
    try{
      if(!activeCallId){ stopRemotePlayWatch(); return; }
      const el = document.getElementById('remoteVideo');
      if(!el) return;
      ticks++;

      // Keep every remote track enabled — muted tracks look like "no video"
      if(remoteCombinedStream){
        remoteCombinedStream.getTracks().forEach(function(t){
          try{ if(t.readyState === 'live' && t.enabled === false) t.enabled = true; }catch(_){}
        });
      }

      if(remoteCombinedStream && remoteCombinedStream.getTracks().length){
        if(el.srcObject !== remoteCombinedStream){
          bindRemoteVideoElement(remoteCombinedStream, true);
          lastRebind = ticks;
        }
      }

      // Absolute rule: visible + paused = remove from screen (kills play logo)
      if(el.style.display !== 'none' && el.paused){
        showRemoteAvatar();
      }

      const state = getRemoteMediaState();
      if(state.hasVideo && !el.paused){
        showRemoteVideo();
        // Playing but zero frames for a long while → one careful rebind (Samsung WebView)
        if(!state.hasFrames && mayRebind()){
          lastRebind = ticks;
          try{ bindRemoteVideoElement(remoteCombinedStream, true); }catch(_){}
        }
      } else if(state.hasVideo && el.paused){
        showRemoteAvatar();
        try{
          el.muted = true;
          el.play().then(function(){
            nalunoHearRemote(el);
            showRemoteVideo();
          }).catch(function(){
            // Force srcObject rebind once then retry play
            if(mayRebind()){
              lastRebind = ticks;
              try{ bindRemoteVideoElement(remoteCombinedStream, true); }catch(_){}
            }
          });
        }catch(_){}
      } else if(!state.hasVideo){
        showRemoteAvatar();
        if(state.hasAudio && el.paused){
          nalunoHearRemote(el);
          try{ el.play().catch(function(){}); }catch(_){}
        }
        // Pull receivers if ontrack never fired tracks into our combined stream
        try{
          if(peerConnection && ticks % 8 === 0){
            const recvs = peerConnection.getReceivers ? peerConnection.getReceivers() : [];
            recvs.forEach(function(r){
              if(r && r.track && r.track.readyState === 'live'){
                ingestRemoteTrack(r.track, null);
              }
            });
          }
        }catch(_){}
      }
    }catch(_){}
  }, 500);
}

function stopRemotePlayWatch(){
  if(remotePlayWatch){ clearInterval(remotePlayWatch); remotePlayWatch = null; }
  if(remotePlayTimer){ clearTimeout(remotePlayTimer); remotePlayTimer = null; }
  if(remoteFrameRaf){ try{ cancelAnimationFrame(remoteFrameRaf); }catch(_){} remoteFrameRaf = null; }
}

async function ensureCallMediaReady(){
  const hasA = stream && stream.getAudioTracks().some(t => t.readyState === 'live');
  const hasV = stream && stream.getVideoTracks().some(t => t.readyState === 'live');
  if(hasA && hasV){
    try{
      stream.getAudioTracks().forEach(t => { t.enabled = true; });
      stream.getVideoTracks().forEach(t => {
        t.enabled = (typeof camOn === 'undefined') ? true : !!camOn;
      });
    }catch(_){}
    return true;
  }
  /* If the call ends (the camera is stopped) while this is still opening
     it, whatever arrives late is switched straight off: the fallbacks below
     used to put a camera and mic back on after a quick hang-up. */
  const camGen = (typeof nalunoCamGen !== 'undefined') ? nalunoCamGen : 0;
  const late = function(got){
    if(typeof nalunoCamGen === 'undefined' || nalunoCamGen === camGen) return false;
    try{ got && got.getTracks().forEach(function(t){ t.stop(); }); }catch(_){}
    return true;
  };
  try{
    if(typeof enableCameraForCall === 'function') await enableCameraForCall();
    else if(typeof enableCamera === 'function') await enableCamera();
  }catch(e){ console.warn('[call] enable camera', e); }
  if(late(null)) return false;
  let okA = stream && stream.getAudioTracks().some(t => t.readyState === 'live');
  let okV = stream && stream.getVideoTracks().some(t => t.readyState === 'live');
  if(!okA){
    try{
      const a = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation:true, noiseSuppression:true, autoGainControl:true },
        video: false
      });
      if(late(a)) return false;
      if(!stream) stream = a;
      else a.getAudioTracks().forEach(t => stream.addTrack(t));
      okA = true;
    }catch(e){ console.warn('[call] audio reopen failed', e); }
  }
  if(!okV){
    try{
      const v = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: (typeof cameraFacingMode !== 'undefined' ? cameraFacingMode : 'user') },
          width: { ideal: 720 },
          height: { ideal: 1280 },
          frameRate: { ideal: 24, max: 30 }
        },
        audio: false
      });
      if(late(v)) return false;
      if(!stream) stream = v;
      else v.getVideoTracks().forEach(t => stream.addTrack(t));
      okV = true;
      ['camRawVideo','pipRawVideo','sendRawVideo','incomingSelfVideo'].forEach(function(id){
        const el = $(id);
        if(el && stream){ el.srcObject = stream; if(el.play) el.play().catch(function(){}); }
      });
    }catch(e){ console.warn('[call] video reopen failed', e); }
  }
  return !!(stream && stream.getAudioTracks().some(t => t.readyState === 'live') &&
            stream.getVideoTracks().some(t => t.readyState === 'live'));
}

function nalunoCfgHasTurn(cfg){
  try{
    return !!((cfg && cfg.iceServers) || []).some(function(s){
      const u = (s && (s.urls || s.url)) || '';
      if(Array.isArray(u)) return u.some(function(x){ return /^turns?:/i.test(String(x)); });
      return /^turns?:/i.test(String(u));
    });
  }catch(_){ return false; }
}
/* Wait until cached TURN is actually there, or give up at maxMs.
   getIceServers() returns STUN at 250ms while the worker is still going, and
   getIceServersPatient() then waits another 1.2s. Neither belongs on the
   path after Answer: a cold cache used to eat the whole 2 seconds before
   any SDP existed. Callers wait a short beat BEFORE the offer (the other
   phone is not ringing yet). The answer is built during the ring. */
function nalunoWaitForTurn(maxMs){
  try{ if(typeof prewarmIceServers === 'function') prewarmIceServers(); }catch(_){}
  const cap = (typeof maxMs === 'number' && maxMs >= 0) ? maxMs : 600;
  return new Promise(function(resolve){
    const t0 = Date.now();
    const tick = function(){
      let cfg = null;
      try{ if(typeof IceCore !== 'undefined' && IceCore.now) cfg = IceCore.now(); }catch(_){}
      /* 30d: once the TURN fetch has come back without TURN (service down,
         offline), there is nothing to wait for: waiting out the cap only
         delayed the ring or the answer. */
      let gaveUp = false;
      try{ gaveUp = (Date.now() - t0) >= 80 && typeof IceCore !== 'undefined' && IceCore.pending && !IceCore.pending(); }catch(_){}
      if(nalunoCfgHasTurn(cfg) || gaveUp || (Date.now() - t0) >= cap){ resolve(cfg); return; }
      setTimeout(tick, 40);
    };
    tick();
  });
}
window.nalunoCfgHasTurn = nalunoCfgHasTurn;
window.nalunoWaitForTurn = nalunoWaitForTurn;

async function createPeerConnection(){
  try{
    if(typeof metricStart === 'function') window._callMediaMetric = metricStart('call_time_to_media');
  }catch(_){}
  try{ resetCallFilterState(); }catch(_){}
  try{ stopRemotePlayWatch(); }catch(_){}
  // Never stall the offer on TURN. Cached TURN if warm; STUN otherwise.
  // Auth already prewarms, so the second call (and most first calls) have TURN.
  let ice = null;
  try{
    if(typeof IceCore !== 'undefined' && IceCore.now) ice = IceCore.now();
  }catch(_){}
  if(!ice){
    ice = { iceServers: [{ urls:'stun:stun.l.google.com:19302' }, { urls:'stun:stun1.l.google.com:19302' }], iceCandidatePoolSize: 4, bundlePolicy: 'max-bundle', rtcpMuxPolicy: 'require' };
  }
  try{ if(typeof prewarmIceServers === 'function') prewarmIceServers(); }catch(_){}
  const pc = new RTCPeerConnection(ice);

  /* FIX — "calls sometimes don't go through / take long to connect".
     The connection above is deliberately built with IceCore.now(), which is
     the CACHED TURN config if warm and STUN-ONLY if not. That part is right:
     stalling the offer on a TURN fetch would make every call slow.

     What was missing is the other half. On a cold cache (first call after
     sign-in, or 25+ minutes idle — the cache TTL) the connection was created
     STUN-only and the TURN servers fetched by prewarmIceServers() were NEVER
     applied to it. STUN-only fails on symmetric NAT, which is most mobile
     carrier networks, so that call simply never connects.

     The existing `pc.restartIce()` recovery could not help either: restartIce
     re-gathers using the connection's CURRENT configuration, which was still
     STUN-only. So the recovery path was re-trying the exact thing that had
     just failed.

     This applies TURN with setConfiguration() the moment credentials
     arrive, but ONLY before any offer or answer exists. After the SDP is
     built, restartIce() would change the ufrag and the other phone would
     keep the old one. The short nalunoWaitForTurn() before the SDP is what
     gets TURN onto the connection in time. */
  try{
    if(typeof getIceServers === 'function'){
      getIceServers().then(function(fresh){
        try{
          if(!pc || !fresh || !fresh.iceServers || !fresh.iceServers.length) return;
          if(pc.signalingState === 'closed') return;
          const st = pc.connectionState;
          if(st === 'connected' || st === 'completed' || st === 'closed') return;
          // Only worth doing if we actually gained a TURN server we lacked.
          // Array urls (Cloudflare returns stun+turn together) must count.
          const hadTurn = nalunoCfgHasTurn(ice);
          const hasTurn = nalunoCfgHasTurn(fresh);
          if(hadTurn || !hasTurn) return;
          if(typeof pc.setConfiguration !== 'function') return;
          /* Gathering starts at setLocalDescription. Changing ICE after that
             (or while createOffer is already running) needs a new offer the
             other phone never gets, so the call pairs with the wrong ufrag.
             Before any SDP, setConfiguration is enough — restartIce is not. */
          if(pc._nalunoIceFrozen || pc.localDescription) return;
          console.log('[call] TURN arrived before the SDP — upgrading ICE config');
          pc.setConfiguration(fresh);
        }catch(e){ console.warn('[call] ICE upgrade skipped', e && e.message); }
      }).catch(function(){});
    }
  }catch(_){}
  remoteCombinedStream = new MediaStream();
  remoteFirstFrame = false;
  remoteVideoGoneSince = 0;
  nalunoCallLive = false;

  pc.ontrack = function(e){
    console.log('[call] ontrack', e.track && e.track.kind, e.track && e.track.readyState,
      'streams', (e.streams && e.streams.length) || 0);
    try{
      if(e.track && e.track.kind === 'video' && typeof metricEnd === 'function' && window._callMediaMetric){
        metricEnd(window._callMediaMetric, true, { kind: 'video' });
        window._callMediaMetric = null;
      }
      if(typeof trackMetric === 'function') trackMetric('call_ontrack', { kind: e.track && e.track.kind });
    }catch(_){}
    ingestRemoteTrack(e.track, e.streams);
  };

  pc.onicegatheringstatechange = function(){
    console.log('[call] ICE gathering:', pc.iceGatheringState);
  };

  attachConnectionWatchdogs(pc);

  // Local tracks: addTrack only (sendrecv). No duplicate transceivers.
  if(stream){
    await attachLocalTracksToPc(pc);
  } else {
    console.warn('[call] createPeerConnection with no local stream — recvonly fallback');
    try{
      pc.addTransceiver('audio', { direction: 'recvonly' });
      pc.addTransceiver('video', { direction: 'recvonly' });
    }catch(_){}
  }
  return pc;
}

async function attachLocalTracksToPc(pc){
  if(!stream || !pc) return;
  const audioTracks = stream.getAudioTracks().filter(t => t.readyState === 'live');
  const videoTracks = stream.getVideoTracks().filter(t => t.readyState === 'live');
  console.log('[call] local live tracks a/v', audioTracks.length, videoTracks.length);

  // Avoid double-adding if called twice
  const existing = pc.getSenders().map(s => s.track).filter(Boolean);
  const hasKind = function(kind){
    return existing.some(t => t.kind === kind && t.readyState === 'live');
  };

  if(audioTracks[0] && !hasKind('audio')){
    const t = audioTracks[0];
    try{
      t.enabled = true;
      t.contentHint = 'speech';
      if(t.applyConstraints){
        t.applyConstraints({
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        }).catch(function(){});
      }
    }catch(_){}
    pc.addTrack(t, stream);
  }

  _callRawVideoTrack = videoTracks[0] || _callRawVideoTrack;
  if(!hasKind('video')){
    /* The picture the call starts with is the one it keeps: the filtered
       canvas if a filter is on and the canvas is already drawing a real
       frame, otherwise the raw camera. Switching mid-connect restarted the
       other person's video. */
    let out = _callRawVideoTrack;
    try{
      const needsFrame = (typeof nalunoOutboundPortrait === 'function' && nalunoOutboundPortrait())
        || (typeof callOutboundWantsFilter === 'function' && callOutboundWantsFilter());
      if(needsFrame && typeof primeSendPreview === 'function'){
        await primeSendPreview();
      }
      if(typeof getCallOutboundVideoTrackSync === 'function'){
        const got = getCallOutboundVideoTrackSync();
        if(got && got !== out){ out = got; window.__nalunoFxDraw = true; }
      }
    }catch(_){}
    if(out){
      try{ out.enabled = true; out.contentHint = 'motion'; }catch(_){}
      const sender = pc.addTrack(out, stream);
      try{ tuneVideoSender(sender); }catch(_){}
    }
  }

  if(!audioTracks[0]) console.warn('[call] no local audio track');
  if(!videoTracks[0]) console.warn('[call] no local video track');
  try{ preferFastVideoCodecs(pc); }catch(_){}
}

/* ---- Outbound filters (safe): raw A/V first, then sendCanvas replaceTrack ---- */
let _callFilterPc = null;
let _callFilterSender = null;
let _callRawVideoTrack = null;
let _callFilterTrack = null;
let _callFilterUpgraded = false;
let _callFilterUpgradeTimer = null;

function callWantsOutboundFilter(){
  try{
    if(typeof greenroomEnabled !== 'undefined' && !greenroomEnabled) return false;
    const id = (typeof selectedFilterId !== 'undefined' && selectedFilterId)
      || (typeof currentFilter !== 'undefined' && currentFilter)
      || 'original';
    if(!id || id === 'none' || id === 'original') return false;
    return true;
  }catch(_){ return false; }
}

function preferFastVideoCodecs(pc){
  if(!pc || typeof RTCRtpSender === 'undefined' || !RTCRtpSender.getCapabilities) return;
  const caps = RTCRtpSender.getCapabilities('video');
  if(!caps || !caps.codecs) return;
  const prefer = caps.codecs.filter(function(c){ return /vp8|h264/i.test(c.mimeType); });
  const rest = caps.codecs.filter(function(c){ return !/vp8|h264/i.test(c.mimeType); });
  if(!prefer.length) return;
  pc.getTransceivers().forEach(function(tr){
    if(!tr || !tr.sender || !tr.sender.track || tr.sender.track.kind !== 'video') return;
    if(typeof tr.setCodecPreferences === 'function'){
      try{ tr.setCodecPreferences(prefer.concat(rest)); }catch(_){}
    }
  });
}

function tuneVideoSender(sender){
  if(!sender || typeof sender.getParameters !== 'function') return;
  try{
    const params = sender.getParameters() || {};
    if(!params.encodings || !params.encodings.length) params.encodings = [{}];
    params.encodings[0].maxBitrate = 2500000;
    params.encodings[0].maxFramerate = 30;
    sender.setParameters(params).catch(function(){});
  }catch(_){}
}

function scheduleFilteredUpgrade(pc){
  // Kept for mid-call filter changes. First negotiation already
  // sends the filtered track when a grade is on.
  _callFilterPc = pc || _callFilterPc;
  if(typeof applyCallFilterNow === 'function'){
    applyCallFilterNow().catch(function(){});
  }
}

/* The picture the other person sees is drawn on a canvas. That canvas
   stops the moment this page is covered, so they get a frozen frame.
   While the call is in the background or the system window, send the
   camera itself — it keeps moving without being drawn. */
let nalunoOutboundHeld = false;
function nalunoHoldOutbound(hold){
  if(typeof peerConnection === 'undefined' || !peerConnection) return;
  let sender = null;
  try{
    sender = peerConnection.getSenders().find(function(s){ return s.track && s.track.kind === 'video'; });
  }catch(_){}
  if(!sender) return;
  const raw = (typeof stream !== 'undefined' && stream && stream.getVideoTracks)
    ? stream.getVideoTracks().find(function(t){ return t.readyState === 'live'; })
    : null;
  if(hold){
    if(!raw || (typeof camOn !== 'undefined' && camOn === false)) return;
    if(sender.track !== raw){
      nalunoOutboundHeld = true;
      sender.replaceTrack(raw).catch(function(){});
    }
    try{ raw.enabled = true; }catch(_){}
    ['pipRawVideo','sendRawVideo'].forEach(function(id){
      const v = document.getElementById(id);
      if(!v) return;
      try{
        if(v.srcObject !== stream) v.srcObject = stream;
        const p = v.play();
        if(p && p.catch) p.catch(function(){});
      }catch(_){}
    });
    return;
  }
  if(!nalunoOutboundHeld) return;
  nalunoOutboundHeld = false;
  try{
    const fx = (typeof getCallOutboundVideoTrackSync === 'function') ? getCallOutboundVideoTrackSync() : null;
    if(fx && sender.track !== fx) sender.replaceTrack(fx).catch(function(){});
  }catch(_){}
}
window.nalunoHoldOutbound = nalunoHoldOutbound;

async function upgradeCallVideoToFiltered(){
  if(_callFilterUpgraded) return;
  const pc = _callFilterPc || peerConnection;
  if(!pc) return;
  if(!callWantsOutboundFilter()) return;

  // Find video sender
  let videoSender = null;
  try{
    videoSender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
  }catch(_){}
  if(!videoSender) return;
  _callFilterSender = videoSender;

  // Prefer existing call filter canvas path from camera module
  const canvas = document.getElementById('sendCanvas');
  if(!canvas || typeof canvas.captureStream !== 'function') return;

  // Ensure filter pipeline is drawing
  try{
    if(typeof startCamView === 'function'){
      // keep pip drawing; filter canvas used for outbound
    }
  }catch(_){}

  try{
    if(typeof startCamView === 'function') startCamView('pip');
  }catch(_){}
  try{
    const ctx = canvas.getContext('2d');
    const sample = ctx.getImageData(Math.floor(canvas.width/2)||1, Math.floor(canvas.height/2)||1, 1, 1).data;
    if((sample[0]+sample[1]+sample[2]+sample[3]) < 8){
      setTimeout(function(){ upgradeCallVideoToFiltered().catch(function(){}); }, 600);
      return;
    }
  }catch(_){}
  let fxStream = null;
  try{ fxStream = canvas.captureStream(24); }catch(e){
    console.warn('[call] captureStream', e);
    return;
  }
  const vTrack = fxStream.getVideoTracks().find(t => t.readyState === 'live');
  if(!vTrack) return;

  try{
    if(!_callRawVideoTrack && videoSender.track) _callRawVideoTrack = videoSender.track;
    await videoSender.replaceTrack(vTrack);
    _callFilterTrack = vTrack;
    _callFilterUpgraded = true;
    console.log('[call] outbound → filtered', canvas.width + 'x' + canvas.height);

    // If filter canvas dies, fall back to raw camera
    vTrack.onended = function(){
      if(_callRawVideoTrack && _callRawVideoTrack.readyState === 'live' && _callFilterSender){
        _callFilterSender.replaceTrack(_callRawVideoTrack).catch(function(){});
        _callFilterUpgraded = false;
      }
    };
  }catch(e){
    console.warn('[call] filter replaceTrack failed — camera kept', e);
  }
}

function refreshOutboundFilterIfInCall(){
  try{
    if(!_callFilterPc && !peerConnection) return;
    if(typeof applyCallFilterNow === 'function') applyCallFilterNow().catch(function(){});
  }catch(_){}
}

function resetCallFilterState(){
  if(_callFilterUpgradeTimer){ clearTimeout(_callFilterUpgradeTimer); _callFilterUpgradeTimer = null; }
  try{ if(_callFilterTrack) _callFilterTrack.stop(); }catch(_){}
  _callFilterPc = null;
  _callFilterSender = null;
  _callRawVideoTrack = null;
  _callFilterTrack = null;
  _callFilterUpgraded = false;
}

/* An outgoing call is "dialing" from the tap on Join until its record is
   written (the camera alone can take seconds on a phone). In that window
   there is no activeCallId yet, so an incoming call took the screen and the
   dial then carried on underneath it, and Cancel could not reach a record
   that did not exist yet: the other phone rang with nobody on this end. */
let nalunoDialing = null;
function nalunoCancelDial(reason){
  if(nalunoDialing){ nalunoDialing.cancelled = true; nalunoDialing.reason = reason || nalunoDialing.reason || 'cancel'; }
  nalunoDialing = null;
}
function teardownCallConnection(){
  /* 05 Oct: every way a call ends stands the floating window down. Only the
     local hang-up did; when the other person hung up, the Android app stayed
     armed and later floated an empty Naluno whenever you left it. */
  try{ if(window.nalunoPip && nalunoPip.disarm) nalunoPip.disarm(); }catch(_){}
  try{ nalunoCancelDial(); }catch(_){}
  try{ window.__nalunoConnectedAt = 0; window.__nalunoFxDraw = false; }catch(_){}
  try{ if(typeof nalunoDropPrepared === 'function') nalunoDropPrepared(); }catch(_){}
  try{ clearInterval(window.__nalunoWatchBackup); window.__nalunoWatchBackup = null; }catch(_){}
  try{ stopRemotePlayWatch(); }catch(_){}
  try{ resetCallFilterState(); }catch(_){}
  if(activeCallDocUnsub){ activeCallDocUnsub(); activeCallDocUnsub = null; }
  if(callerCandidatesUnsub){ callerCandidatesUnsub(); callerCandidatesUnsub = null; }
  if(calleeCandidatesUnsub){ calleeCandidatesUnsub(); calleeCandidatesUnsub = null; }
  if(peerConnection){
    try{
      peerConnection.ontrack = null;
      peerConnection.onicecandidate = null;
      peerConnection.onconnectionstatechange = null;
      peerConnection.oniceconnectionstatechange = null;
      peerConnection.close();
    }catch(e){}
    peerConnection = null;
  }
  activeCallId = null;
  pendingIncomingOffer = null;
  remoteDescriptionSet = false;
  pendingRemoteCandidates = [];
  iAmCaller = false;
  try{
    const rv = $('remoteVideo');
    if(rv){ rv.srcObject = null; rv.style.display = 'none'; rv.muted = true; }
    nalunoDropRemoteBoost();
    const rp = $('remotePlaceholder');
    if(rp) rp.style.display = 'flex';
  }catch(e){}
  remoteCombinedStream = null;
  remoteFirstFrame = false;
  remoteVideoGoneSince = 0;
  nalunoCallLive = false;
  clearInterval(callInterval); callInterval = null;
  callActionInProgress = false;
}

function nalunoTalkSeconds(){
  let fromClock = 0;
  try{
    const at = window.__nalunoConnectedAt || 0;
    if(at > 0) fromClock = Math.max(0, Math.round((Date.now() - at) / 1000));
  }catch(_){}
  const fromTimer = Math.max(0, Math.round(Number(callSeconds) || 0));
  return Math.max(fromClock, fromTimer);
}
/* Written once, from whichever phone still has the clock, before teardown
   wipes it. The caller used to be the only writer, and a hangup from the
   other phone never called this at all, so a finished call was invisible
   in Records. */
function nalunoRememberCall(reason){
  const callId = activeCallId;
  if(!callId || window.__nalunoNotedCall === callId) return;
  const seconds = nalunoTalkSeconds();
  const ok = seconds >= 1;
  window.__nalunoNotedCall = callId;
  const meta = window.__nalunoCallPeers || {};
  try{
    if(typeof nalunoNoteTraffic === 'function' && typeof currentUser !== 'undefined' && currentUser){
      nalunoNoteTraffic({
        kind: 'call',
        ok: ok,
        callId: callId,
        actorUid: currentUser.uid,
        peerUid: meta.peerUid || '',
        actorName: meta.actorName || (currentProfile && currentProfile.name) || '',
        peerName: meta.peerName || '',
        seconds: seconds,
        status: ok ? 'connected' : (reason || 'ended'),
      });
    }
  }catch(_){}
  try{
    if(fbDb && seconds > 0){
      fbDb.collection('calls').doc(callId).update({
        durationSec: seconds,
        connectedAt: window.__nalunoConnectedAt || (Date.now() - seconds * 1000),
      }).catch(function(){});
    }
  }catch(_){}
}
function nalunoStampCallConnected(){
  try{
    if(!activeCallId || !fbDb || window.__nalunoStampedCall === activeCallId) return;
    if(!window.__nalunoConnectedAt) window.__nalunoConnectedAt = Date.now();
    window.__nalunoConnectedCall = activeCallId;
    window.__nalunoStampedCall = activeCallId;
    fbDb.collection('calls').doc(activeCallId).update({
      connectedAt: window.__nalunoConnectedAt,
    }).catch(function(){});
  }catch(_){}
}
/* Single path for ending a live call from either side.
   Captures callId BEFORE teardown nulls it, writes status, then fully closes UI. */
function endActiveCall(reason){
  const callId = activeCallId;
  const wasInCall = !!$('incall') && $('incall').classList.contains('active');
  const wasRinging = !!$('ringing') && $('ringing').classList.contains('active');
  const wasIncoming = !!$('incoming') && $('incoming').classList.contains('active');
  if(!callId && !wasInCall && !wasRinging && !wasIncoming && !$('callOverlay').classList.contains('active')){
    return; // nothing to end
  }
  try{ if(window.nalunoPip && nalunoPip.disarm) nalunoPip.disarm(); }catch(_){}
  clearTimeout(ringTimeoutHandle); ringTimeoutHandle = null;
  if(notifyRepeatInterval){ try{ clearInterval(notifyRepeatInterval); }catch(_){} try{ clearTimeout(notifyRepeatInterval); }catch(_){} notifyRepeatInterval = null; }
  stopCallerTone();
  stopRingtone();
  if(callId && fbDb){
    const talk = nalunoTalkSeconds();
    fbDb.collection('calls').doc(callId).update({
      status: 'ended',
      endedAt: firebase.firestore.FieldValue.serverTimestamp(),
      endedBy: currentUser ? currentUser.uid : null,
      endReason: reason || 'hangup',
      durationSec: talk,
      connectedAt: (window.__nalunoConnectedAt || (talk ? Date.now() - talk * 1000 : 0)) || 0,
    }).catch(()=>{});
  }
  try{ nalunoRememberCall(reason || 'hangup'); }catch(_){}
  try{ window.__nalunoConnectedAt = 0; }catch(_){}
  teardownCallConnection();
  closeCallOverlay();
  stopCameraStream();
  try{ if(typeof nalunoSessionRelease === 'function') nalunoSessionRelease('call'); }catch(_){}
  try{ nalunoClearEarpiece(); }catch(_){}
  try{ if(typeof cameraRelease === 'function') cameraRelease('call'); }catch(_){}
  currentCallContactId = null;
  callActionInProgress = false;
  incallViewMode = 0;
  try{ closeIncallWire(); }catch(_){}
  try{
    $('incall').classList.remove('swap-focus');
    if($('localPip')) $('localPip').classList.remove('large');
  }catch(e){}
  if(wasInCall || wasRinging || wasIncoming){
    toast(reason === 'remote' ? 'Call ended' : 'Call ended');
  }
  // Full return-to-normal: media toggles + PC leftovers so the next call is clean
  try{
    if(typeof camOn !== 'undefined') camOn = true;
    if(typeof micOn !== 'undefined') micOn = true;
    if($('camBtn')) $('camBtn').classList.remove('active');
    if($('micBtn')) $('micBtn').classList.remove('active');
    if($('toggleCam')) $('toggleCam').classList.remove('off');
    if($('toggleMic')) $('toggleMic').classList.remove('off');
    if($('localPip')) $('localPip').classList.remove('muted');
  }catch(_){}
  try{ stopRemotePlayWatch(); }catch(_){}
  restoreUiAfterCall();
  // Re-show publish chip if background job still running
  try{
    if(typeof publishBusy !== 'undefined' && publishBusy && typeof showPublishChip === 'function'){
      showPublishChip('Still publishing…');
    }
  }catch(_){}
}

/* A far call (another city, another country) often needs the relay.
   A call that is already connected is left alone. A first failure gets
   one relay restart and a longer wait before the call is given up. */
function nalunoCallStillThis(pc){
  return !!(pc && peerConnection === pc && pc.signalingState !== 'closed' && pc.connectionState !== 'closed');
}
function nalunoCallMediaUp(pc){
  if(!pc) return false;
  const ice = pc.iceConnectionState;
  const st = pc.connectionState;
  return ice === 'connected' || ice === 'completed' || st === 'connected';
}
function nalunoTryRelay(pc){
  try{
    const apply = function(fresh){
      if(!nalunoCallStillThis(pc) || nalunoCallMediaUp(pc)) return;
      if(fresh && nalunoCfgHasTurn(fresh) && typeof pc.setConfiguration === 'function'){
        try{ pc.setConfiguration(fresh); }catch(_){}
      }
      try{ pc.restartIce(); }catch(_){}
    };
    if(typeof getIceServers === 'function'){
      getIceServers().then(apply).catch(function(){ apply(null); });
    } else {
      apply(null);
    }
  }catch(_){}
}
function nalunoScheduleCallFail(pc){
  if(!pc || pc._nalunoFailTimer) return;
  const awayNow = function(){
    try{ return !!(window.nalunoPip && nalunoPip.backgrounded && nalunoPip.backgrounded()); }catch(_){ return false; }
  };
  const wait = pc._nalunoRelayTried ? (awayNow() ? 20000 : 8000) : 3200;
  pc._nalunoFailTimer = setTimeout(function(){
    pc._nalunoFailTimer = null;
    if(!nalunoCallStillThis(pc) || nalunoCallMediaUp(pc)) return;
    if(!pc._nalunoRelayTried){
      pc._nalunoRelayTried = true;
      nalunoTryRelay(pc);
      nalunoScheduleCallFail(pc);
      return;
    }
    const ice = pc.iceConnectionState;
    const st = pc.connectionState;
    if(ice === 'failed' || st === 'failed'){
      if(awayNow() && !pc._nalunoBgRetry){
        pc._nalunoBgRetry = true;
        nalunoTryRelay(pc);
        nalunoScheduleCallFail(pc);
        return;
      }
      if($('callOverlay') && $('callOverlay').classList.contains('active')){
        endActiveCall('remote');
      }
    }
  }, wait);
}
function nalunoMarkIfMediaUp(pc){
  try{
    if(!pc || peerConnection !== pc || nalunoCallLive) return;
    if(!nalunoCallMediaUp(pc)) return;
    /* The link is up. Waiting out a painted video frame kept the screen
       on "Connecting…" for several seconds after the call had already
       connected. The picture still appears on its first frame. */
    nalunoMarkCallLive();
  }catch(_){}
}
function attachConnectionWatchdogs(pc){
  if(!pc) return;
  pc.onconnectionstatechange = ()=>{
    const s = pc.connectionState;
    console.log('[call] connection state:', s);
    if(s === 'connected'){
      try{ window.__nalunoConnectedCall = activeCallId; }catch(_){}
      try{ if(peerConnection === pc && !window.__nalunoConnectedAt) window.__nalunoConnectedAt = Date.now(); }catch(_){}
      try{ nalunoStampCallConnected(); }catch(_){}
      try{ nalunoMarkIfMediaUp(pc); }catch(_){}
      try{ if(typeof trackMetric === 'function') trackMetric('call_connected', {}); }catch(_){}
      try{
        pc.getSenders().forEach(snd=>{
          if(snd.track){ try{ snd.track.enabled = true; }catch(_){} }
          try{ if(snd.track && snd.track.kind === 'video') tuneVideoSender(snd); }catch(_){}
        });
      }catch(_){}
      try{ ensureRemoteVideoPlaying(); }catch(_){}
      try{ scheduleFilteredUpgrade(pc); }catch(_){}
    }
    if(s === 'failed'){
      nalunoScheduleCallFail(pc);
    }
  };
  pc.oniceconnectionstatechange = ()=>{
    const s = pc.iceConnectionState;
    console.log('[call] ICE connection state:', s);
    if(s === 'connected' || s === 'completed'){
      try{ window.__nalunoConnectedCall = activeCallId; }catch(_){}
      try{ if(peerConnection === pc && !window.__nalunoConnectedAt) window.__nalunoConnectedAt = Date.now(); }catch(_){}
      try{ nalunoStampCallConnected(); }catch(_){}
      try{ nalunoMarkIfMediaUp(pc); }catch(_){}
      try{ ensureRemoteVideoPlaying(); }catch(_){}
      try{ scheduleFilteredUpgrade(pc); }catch(_){}
    }
    if(s === 'failed'){
      nalunoScheduleCallFail(pc);
    }
  };
}
/* App-wide listener for real incoming calls — starts at sign-in, runs regardless of
   which screen is open, same as the presence and Wireline-preview listeners. */
let missedCallUnsub = null;
let missedCallListenerInitialized = false;
/* The data side of this already existed — showAsyncFallback() already marks a call
   'missed' in Firestore when it times out unanswered. What was actually missing is
   this: nothing ever watched for it on the receiving end or showed it anywhere. */
function startMissedCallListener(){
  if(!fbDb || !currentUser) return;
  if(missedCallUnsub) missedCallUnsub();
  missedCallListenerInitialized = false;
  missedCallUnsub = fbDb.collection('calls')
    .where('calleeUid','==',currentUser.uid)
    .where('status','==','missed')
    .onSnapshot(snap=>{
      try{ nalunoListenOk('missedCalls'); }catch(_){}
      const unseen = snap.docs.filter(d => !d.data().seenByCallee);
      updateMissedCallBadge(unseen.length);
      // Only toast for calls that arrive while this listener is already running —
      // the initial snapshot fires for every existing unseen missed call too, and
      // toasting for all of those on every single app open would be excessive. The
      // badge alone (set above, unconditionally) already surfaces those correctly.
      if(missedCallListenerInitialized){
        snap.docChanges().forEach(change=>{
          if(change.type==='added' && !change.doc.data().seenByCallee){
            const data = change.doc.data();
            const c = contacts.find(x=>x.firebaseUid===data.callerUid);
            toast((c ? c.name.split(' ')[0] : 'Someone') + ' tried to call you');
            try{
              if(c && typeof recordMissedCallInWireline === 'function'){
                recordMissedCallInWireline(c.id, {
                  callId: change.doc.id,
                  incoming: true,
                  ts: Date.now(),
                  callerUid: data.callerUid || c.firebaseUid,
                  calleeUid: (typeof currentUser !== 'undefined' && currentUser) ? currentUser.uid : null,
                });
              }
            }catch(_){}
          }
        });
      }
      missedCallListenerInitialized = true;
    }, function(err){
      // Used to stop the missed-call badge until the app was restarted.
      console.warn('[call] missed-call listener error, subscribing again', err && err.message);
      missedCallUnsub = null;
      try{ nalunoRelisten('missedCalls', startMissedCallListener); }catch(_){}
    });
}
function updateMissedCallBadge(count){
  const badge = $('missedCallBadge');
  if(!badge) return;
  badge.textContent = count > 0 ? String(count) : '';
  badge.style.display = count > 0 ? 'block' : 'none';
}
async function clearMissedCallBadge(){
  if(!fbDb || !currentUser) return;
  try{
    const snap = await fbDb.collection('calls')
      .where('calleeUid','==',currentUser.uid)
      .where('status','==','missed')
      .get();
    const unseen = snap.docs.filter(d => !d.data().seenByCallee);
    if(unseen.length === 0) return;
    const batch = fbDb.batch();
    unseen.forEach(d => batch.update(d.ref, { seenByCallee:true }));
    await batch.commit();
    updateMissedCallBadge(0);
  }catch(e){ /* badge just stays until next successful attempt */ }
}

let incomingListenerRetries = 0;
let incomingListenerRetryTimer = null;

/* FIX — "calls sometimes refuse to ring".
   This listener is started exactly ONCE, from auth.js on sign-in. Its error
   handler used to be an empty function whose own comment said "incoming calls
   just won't be detected this session" — and that is precisely what happened.
   A single transient snapshot error (a network blip, a token refresh, the
   phone sleeping and the stream closing) silently killed the listener for the
   rest of the session. The person stays signed in, the app looks completely
   normal, and their phone simply never rings again until they restart it.

   That is also why it looked intermittent and unreproducible: nothing is
   broken at the moment of the failed call, something broke minutes or hours
   earlier and left no trace.

   Now it re-subscribes with backoff, and re-subscribes on reconnect and on
   returning to the foreground — the two moments a dead listener is most
   likely and most cheaply repaired. */
function startIncomingCallListener(){
  if(!fbDb || !currentUser) return;
  if(incomingCallUnsub){ try{ incomingCallUnsub(); }catch(_){} incomingCallUnsub = null; }
  if(incomingListenerRetryTimer){ clearTimeout(incomingListenerRetryTimer); incomingListenerRetryTimer = null; }
  try{
    incomingCallUnsub = fbDb.collection('calls')
      .where('calleeUid','==',currentUser.uid)
      .where('status','==','ringing')
      .onSnapshot(snap=>{
        incomingListenerRetries = 0;   // a healthy snapshot clears the backoff
        snap.docChanges().forEach(change=>{
          if(change.type==='added') handleIncomingCall(change.doc.id, change.doc.data());
        });
      }, function(err){
        console.warn('[call] incoming listener error — will retry', err && err.message);
        incomingCallUnsub = null;
        scheduleIncomingListenerRetry();
      });
  }catch(e){
    console.warn('[call] incoming listener could not start — will retry', e && e.message);
    scheduleIncomingListenerRetry();
  }
}

function scheduleIncomingListenerRetry(){
  if(incomingListenerRetryTimer) return;
  // 1s, 2s, 4s, 8s, capped at 30s. Never gives up entirely: an unringable
  // phone is worse than a few retries, and this costs nothing when idle.
  const delay = Math.min(30000, 1000 * Math.pow(2, Math.min(incomingListenerRetries, 5)));
  incomingListenerRetries++;
  incomingListenerRetryTimer = setTimeout(function(){
    incomingListenerRetryTimer = null;
    if(typeof currentUser !== 'undefined' && currentUser) startIncomingCallListener();
  }, delay);
}

/* Re-arm at the two moments a dead listener is most likely: coming back
   online, and returning to the foreground after the phone slept. Both simply
   re-subscribe, which is a no-op cost when the listener is already healthy. */
(function watchIncomingListenerHealth(){
  function rearm(){
    try{
      if(typeof currentUser === 'undefined' || !currentUser) return;
      if(!incomingCallUnsub) startIncomingCallListener();
    }catch(_){}
  }
  try{
    window.addEventListener('online', function(){ setTimeout(rearm, 800); });
    document.addEventListener('visibilitychange', function(){
      if(!document.hidden) setTimeout(rearm, 500);
    });
    setInterval(function(){
      try{
        if(typeof currentUser === 'undefined' || !currentUser) return;
        if(!incomingCallUnsub) startIncomingCallListener();
      }catch(_){}
    }, 15000);
  }catch(_){}
})();
/* Who the ring on screen (or the call this phone answered) is from, so a
   second ring from the same person is recognised. */
let nalunoIncomingFrom = null;
function nalunoRingMs(data){
  try{
    const c = data && data.createdAt;
    if(!c) return 0;
    return typeof c.toMillis === 'function' ? c.toMillis() : (c.seconds ? c.seconds * 1000 : Number(c) || 0);
  }catch(_){ return 0; }
}
function handleIncomingCall(callId, data){
  data = data || {};
  if(nalunoRingIsStale(data)){ nalunoCallMove(callId, 'missed'); return; }
  let autoAccept = false;
  /* The same person ringing twice: they hung up and called again, or an
     older ring of theirs was left behind in the database. The newer ring is
     the live one. Keeping the older one on screen (and telling the new call
     "busy") answered a call nobody was on while the caller kept ringing. */
  if($('callOverlay').classList.contains('active') && nalunoIncomingFrom && activeCallId === nalunoIncomingFrom.id
     && activeCallId !== callId && !iAmCaller && data.callerUid && nalunoIncomingFrom.uid === data.callerUid){
    const theirMs = nalunoRingMs(data);
    if(theirMs && nalunoIncomingFrom.ms && theirMs < nalunoIncomingFrom.ms){
      nalunoCallMove(callId, 'missed');   // an older ring of theirs: not the live one
      return;
    }
    const old = activeCallId;
    const wasInCall = !!($('incall') && $('incall').classList.contains('active'));
    const wasAnswering = !!callActionInProgress;
    if(wasInCall || wasAnswering){
      try{ fbDb.collection('calls').doc(old).update({ status: 'ended', endReason: 'recalled' }).catch(function(){}); }catch(_){}
      // They had already picked up (or were talking): take the new call from the same person straight away.
      autoAccept = true;
    } else {
      nalunoCallMove(old, 'missed');
    }
    try{ stopRingtone(); }catch(_){}
    teardownCallConnection();
    try{ closeCallOverlay({ keepHistory: true }); }catch(_){}
  }
  /* Replacing another call screen (the lobby, "No answer yet", crossed
     calls): keep the snapshot of where the person was before that screen,
     or they would come back to the tab instead of the chat or room. */
  const replacingCallScreen = $('callOverlay').classList.contains('active') && !!_callUiSnapshot;
  if($('callOverlay').classList.contains('active')){
    if(activeCallId === callId) return;
    const dialingOut = !!(nalunoDialing && !nalunoDialing.cancelled);
    const ringingOut = dialingOut || !!(iAmCaller && activeCallId && $('ringing') && $('ringing').classList.contains('active'));
    const calling = (typeof contacts !== 'undefined' && contacts) ? contacts.find(function(x){ return x.id === currentCallContactId; }) : null;
    const outUid = dialingOut ? nalunoDialing.uid : (calling && calling.firebaseUid);
    if(ringingOut && outUid && outUid === data.callerUid && currentUser){
      /* Two people called each other at the same moment. Each app used to
         ignore the other's ring, so both rang out and neither connected.
         The lower uid gives up its own call and answers theirs; the other
         side simply keeps ringing and gets answered. */
      if(currentUser.uid > data.callerUid) return;
      const mine = activeCallId;
      try{ nalunoCancelDial('crossed'); }catch(_){}
      if(mine){ try{ fbDb.collection('calls').doc(mine).update({ status: 'ended', endReason: 'crossed' }).catch(function(){}); }catch(_){} }
      try{ clearTimeout(ringTimeoutHandle); ringTimeoutHandle = null; }catch(_){}
      try{ stopCallerTone(); }catch(_){}
      teardownCallConnection();
      try{ closeCallOverlay({ keepHistory: true }); }catch(_){}
      autoAccept = true;
    } else if(activeCallId || dialingOut){
      /* Busy: in a call, ringing someone, or already ringing with another
         call. The ring used to be ignored silently (the caller rang for a
         minute) or it replaced the first ring without telling its caller. */
      nalunoCallMove(callId, 'busy');
      return;
    } else {
      // The lobby or the "No answer yet" screen: the incoming call takes over.
      try{ closeCallOverlay({ keepHistory: true }); }catch(e){}
    }
  }
  // Calls always win over live / band / lobby camera preview.
  callActionInProgress = false;
  // Drop leftover peer from last session (do NOT stop user camera yet — reuse)
  if(peerConnection){
    try{ peerConnection.close(); }catch(e){}
    peerConnection = null;
  }
  if(callerCandidatesUnsub){ callerCandidatesUnsub(); callerCandidatesUnsub = null; }
  if(calleeCandidatesUnsub){ calleeCandidatesUnsub(); calleeCandidatesUnsub = null; }

  activeCallId = callId;
  iAmCaller = false;
  try{
    window.__nalunoCallPeers = {
      peerUid: data.callerUid || '',
      peerName: (data.callerName || ''),
      actorName: (currentProfile && currentProfile.name) || '',
    };
  }catch(_){}
  nalunoSetCallKind(data.kind === 'audio' ? 'audio' : 'video');
  nalunoIncomingFrom = { id: callId, uid: data.callerUid || null, ms: nalunoRingMs(data) };
  remoteDescriptionSet = false;
  pendingRemoteCandidates = [];
  callActionInProgress = false;
  // Cache SDP offer now — Answer must not wait on another Firestore get()
  pendingIncomingOffer = (data && data.offer) ? data.offer : null;
  const c = contacts.find(x=>x.firebaseUid===data.callerUid);
  const name = (c ? c.name : null) || data.callerName || 'Someone';
  const color = (c ? c.color : null) || data.callerColor || '#8B90A8';
  const initials = (c ? c.initials : null) || data.callerInitials || (name[0] || '?');
  currentCallContactId = c ? c.id : null;
  ['incomingName', 'remoteName'].forEach(function(k){ try{ $(k).setAttribute('data-known-uid', data.callerUid || (c && c.firebaseUid) || ''); }catch(_){} });
  $('incomingName').textContent = name;
  $('remoteName').textContent = name;
  const callerPic = data.callerPhotoUrl || data.callerPhoto || null;
  if(c && callerPic && typeof mergeContactPhoto === 'function') mergeContactPhoto(c, callerPic);
  const face = c || { name: name, color: color, initials: initials, photoUrl: callerPic, photo: callerPic ? { dataUrl: callerPic } : null };
  if(typeof applyContactAvatarToEl === 'function'){
    applyContactAvatarToEl($('incomingAvatar'), face);
    applyContactAvatarToEl($('remoteAvatar'), face);
  } else {
    $('incomingAvatar').style.background = color; $('incomingAvatar').textContent = initials;
    $('remoteAvatar').style.background = color; $('remoteAvatar').textContent = initials;
  }
  $('incomingSceneNote').style.display = 'none';
  $('incomingSelfTag').textContent = 'prepping…';
  if(!replacingCallScreen) snapshotUiBeforeCall();
  showCallScreen('incoming');
  startRingtone();
  try{ startIncomingKeepAlive(); }catch(_){}
  try{
    if(typeof document !== 'undefined' && document.hidden) nalunoStartBackgroundRing(callId, name);
    else nalunoShowCallNotice(callId, name);
  }catch(_){}
  // Pre-warm camera (or only the mic, for a voice call) + TURN so Answer is nearly instant.
  prewarmIceServers();
  const showReady = ()=>{ $('incomingSceneNote').style.display = nalunoIsVoiceCall() ? 'none' : 'inline-flex'; $('incomingSelfTag').textContent = 'scene ready'; };
  const camFn = nalunoIsVoiceCall() ? nalunoOpenMic : ((typeof enableCameraForCall === 'function') ? enableCameraForCall : enableCamera);
  const camReady = camFn();
  camReady.then(()=> setTimeout(showReady, 150)).catch(()=> showReady());
  if(!autoAccept && data.offer){ try{ nalunoPrepareAnswer(callId, data.offer, camReady); }catch(_){} }

  if(autoAccept) setTimeout(function(){ try{ if(activeCallId === callId && $('acceptIncoming').onclick) $('acceptIncoming').onclick(); }catch(_){} }, 80);
  /* Backstop: a caller whose phone died cannot say so. Stop ringing after
     80s (the caller's own ring gives up at 60–75s). */
  try{ clearTimeout(window.__nalunoRingBackstop); }catch(_){}
  window.__nalunoRingBackstop = setTimeout(function(){
    try{
      if(activeCallId !== callId || !$('incoming') || !$('incoming').classList.contains('active')) return;
      nalunoCallMove(callId, 'missed');
      stopRingtone();
      teardownCallConnection();
      closeCallOverlay();
      stopCameraStream();
      currentCallContactId = null;
      callActionInProgress = false;
      try{ restoreUiAfterCall(); }catch(_){}
    }catch(_){}
  }, 80000);

  // Watches for the caller hanging up before this side answers.
  const onRingDoc = snap=>{
    if(activeCallId !== callId) return;
    const d = snap && snap.data && snap.data();
    if(!d) return;
    const otherDeviceAnswered = d.status === 'accepted' && !callActionInProgress && $('incoming') && $('incoming').classList.contains('active');
    if(otherDeviceAnswered || ((d.status === 'ended' || d.status === 'missed' || d.status === 'declined' || d.status === 'busy') && $('callOverlay').classList.contains('active') && !$('incall').classList.contains('active'))){
      if(otherDeviceAnswered){ toast('Answered on another device'); }
      else
      toast(d.status === 'missed' ? ('Missed call from ' + name) : 'Call ended');
      stopRingtone();
      teardownCallConnection();
      closeCallOverlay();
      stopCameraStream();
      currentCallContactId = null;
      callActionInProgress = false;
      try{ restoreUiAfterCall(); }catch(_){}
    }
  };
  activeCallDocUnsub = fbDb.collection('calls').doc(callId).onSnapshot(onRingDoc, function(err){ console.warn('[call] ring watch', err && err.message); });
  nalunoWatchBackup(callId, 'incoming', onRingDoc);
}

/* A second, slow check beside the live listener while a ring is on screen.
   If a phone's listener stalls (a flaky connection, the app coming back
   from the background), the ring used to carry on after the other side had
   answered, declined or hung up. One small read every 3 seconds, only while
   the ring shows. */
function nalunoWatchBackup(callId, screenId, onDoc){
  try{ clearInterval(window.__nalunoWatchBackup); }catch(_){}
  window.__nalunoWatchBackup = setInterval(function(){
    try{
      const scr = $(screenId);
      if(activeCallId !== callId || !scr || !scr.classList.contains('active') || !$('callOverlay').classList.contains('active')){
        clearInterval(window.__nalunoWatchBackup); window.__nalunoWatchBackup = null; return;
      }
      fbDb.collection('calls').doc(callId).get().then(function(snap){
        if(activeCallId === callId && scr.classList.contains('active')) onDoc(snap);
      }).catch(function(){});
    }catch(_){}
  }, 3000);
}

/* The other phone's ICE candidates. A listener that errors (a network blip,
   the app coming back from the background) used to die for good, leaving
   both people on "connecting". It subscribes again, a little later each
   time, for as long as this call is still the one on screen. A fresh
   subscription replays every candidate, so ones already used are skipped. */
function nalunoWatchCandidates(callRef, sub, callId, onCand, setUnsub){
  const seen = new Set();
  let tries = 0;
  const attach = function(){
    if(activeCallId !== callId) return;
    const unsub = callRef.collection(sub).onSnapshot(function(snap){
      tries = 0;
      snap.docChanges().forEach(function(change){
        if(change.type !== 'added' || seen.has(change.doc.id)) return;
        seen.add(change.doc.id);
        try{ onCand(change.doc.data()); }catch(_){}
      });
    }, function(err){
      console.warn('[call] ' + sub + ' listener error, subscribing again', err && err.message);
      setUnsub(null);
      if(activeCallId !== callId) return;
      const wait = Math.min(8000, 500 * Math.pow(2, tries++));
      setTimeout(attach, wait);
    });
    setUnsub(unsub);
  };
  attach();
}

/* ---- Voice calls and video calls (29f) ----
   Every call used to be a video call: the camera opened for the lobby, for
   an incoming ring, and on answer. Someone who only wanted to talk had no
   way to keep their camera off. A voice call now goes straight to ringing
   (no lobby), opens only the microphone on both phones, and carries only
   audio. The call record says which kind it is (kind: 'audio' | 'video');
   a record without it is a video call, as before. */
let nalunoCallKind = 'video';
function nalunoSetCallKind(kind){
  nalunoCallKind = (kind === 'audio') ? 'audio' : 'video';
  try{
    const ov = $('callOverlay');
    if(ov) ov.classList.toggle('voice-call', nalunoCallKind === 'audio');
    const label = nalunoCallKind === 'audio' ? 'Voice call' : 'Video call';
    const r = document.querySelector('#ringing .topbar .eyebrow'); if(r) r.textContent = 'Outgoing · ' + label.toLowerCase();
    const i = document.querySelector('#incoming .topbar .eyebrow'); if(i) i.textContent = 'Incoming ' + label.toLowerCase();
    const st = document.querySelector('#incoming .ring-status'); if(st) st.textContent = nalunoCallKind === 'audio' ? 'voice call…' : 'video call…';
  }catch(_){}
  return nalunoCallKind;
}
window.nalunoSetCallKind = nalunoSetCallKind;
function nalunoIsVoiceCall(){ return nalunoCallKind === 'audio'; }
window.nalunoIsVoiceCall = nalunoIsVoiceCall;
let nalunoEarpiece = false;
function nalunoNativeRoute(route){
  try{
    const n = window.NalunoNative;
    if(!n) return false;
    n.setCallAudioRoute(route);
    return true;
  }catch(_){ return false; }
}
function nalunoApplyEarpiece(){
  const btn = $('earBtn');
  if(btn){
    btn.classList.toggle('active', nalunoEarpiece);
    btn.title = nalunoEarpiece ? 'Earpiece' : 'Loudspeaker';
    btn.setAttribute('aria-label', nalunoEarpiece ? 'Listening on the earpiece' : 'Listening on the loudspeaker');
  }
  nalunoNativeRoute(nalunoEarpiece ? 'ear' : 'speaker');
  try{
    const v = document.getElementById('remoteVideo');
    if(v && v.srcObject) nalunoHearRemote(v);
  }catch(_){}
}
function nalunoClearEarpiece(){
  nalunoEarpiece = false;
  try{
    if(window.NalunoNative && typeof window.NalunoNative.clearCallAudioRoute === 'function'){
      window.NalunoNative.clearCallAudioRoute();
    }
  }catch(_){}
  const btn = $('earBtn');
  if(btn){ btn.classList.remove('active'); btn.title = 'Loudspeaker'; }
}
function nalunoWireEarpiece(){
  const btn = $('earBtn');
  if(!btn || btn.dataset.wired) return;
  btn.dataset.wired = '1';
  btn.onclick = function(){
    const wantEar = !nalunoEarpiece;
    if(wantEar && !nalunoNativeRoute('ear')){
      nalunoEarpiece = false;
      nalunoApplyEarpiece();
      toast('Loudspeaker');
      return;
    }
    nalunoEarpiece = wantEar;
    nalunoApplyEarpiece();
    toast(nalunoEarpiece ? 'Earpiece' : 'Loudspeaker');
  };
}
if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', nalunoWireEarpiece);
else nalunoWireEarpiece();
/* The microphone alone. A camera left open from an earlier screen is closed
   first, so a voice call never shows or sends a picture. */
async function nalunoOpenMic(){
  try{ if(typeof nalunoSessionHold === 'function') nalunoSessionHold('voice'); }catch(_){}
  const live = function(t){ return t.readyState === 'live'; };
  if(stream && stream.getAudioTracks().some(live) && !stream.getVideoTracks().some(live)){
    stream.getAudioTracks().forEach(function(t){ t.enabled = true; });
    return;
  }
  const gen = (typeof nalunoCamGen !== 'undefined') ? nalunoCamGen : 0;
  if(stream){ try{ stream.getTracks().forEach(function(t){ t.stop(); }); }catch(_){} stream = null; }
  const got = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    video: false,
  });
  if(typeof nalunoCamGen !== 'undefined' && nalunoCamGen !== gen){
    try{ got.getTracks().forEach(function(t){ t.stop(); }); }catch(_){}
    return;
  }
  stream = got;
}
window.nalunoOpenMic = nalunoOpenMic;

function nalunoEnsureCallAuth(){
  try{
    if((typeof currentUser === 'undefined' || !currentUser) && typeof fbAuth !== 'undefined' && fbAuth && fbAuth.currentUser){
      currentUser = fbAuth.currentUser;
    }
  }catch(_){}
  try{
    if((typeof fbDb === 'undefined' || !fbDb) && typeof initFirebaseApp === 'function') initFirebaseApp();
  }catch(_){}
  return !!(currentUser && fbDb);
}
/* Voice call: no lobby, no camera. Straight to ringing. */
function startAudioCall(contactId){
  const c = contacts.find(x=>x.id===contactId);
  if(!c){ toast('Contact not found'); return; }
  if(!c.isReal || !c.firebaseUid){ toast('Real calls only work with real connections right now'); return; }
  if(!nalunoEnsureCallAuth()){ toast('Sign in required for calls'); return; }
  if(callActionInProgress || ($('callOverlay') && $('callOverlay').classList.contains('active'))){ toast('Already on a call'); return; }
  currentCallContactId = contactId;
  nalunoSetCallKind('audio');
  const sig = computeSignal(c);
  ['ringName', 'remoteName'].forEach(function(k){ try{ $(k).setAttribute('data-known-uid', c.firebaseUid || ''); }catch(_){} });
  $('ringName').textContent = c.name;
  $('remoteName').textContent = c.name;
  if(typeof applyContactAvatarToEl === 'function'){
    applyContactAvatarToEl($('ringAvatar'), c);
    applyContactAvatarToEl($('remoteAvatar'), c);
  } else {
    $('ringAvatar').style.background = c.color; $('ringAvatar').textContent = c.initials;
    $('remoteAvatar').style.background = c.color; $('remoteAvatar').textContent = c.initials;
  }
  $('sceneReadyNote').style.display = 'none';
  $('ringFallbackHint').style.display = (sig.tier === 'fading' || sig.tier === 'off') ? 'flex' : 'none';
  snapshotUiBeforeCall();
  try{ if($('wirelineThread')) $('wirelineThread').classList.remove('active'); }catch(_){}
  nalunoPlaceCall(c);
}
window.startAudioCall = startAudioCall;

function startOutgoingCall(contactId){
  const c = contacts.find(x=>x.id===contactId);
  if(!c){ toast('Contact not found'); return; }
  currentCallContactId = contactId;
  if(!c.isReal || !c.firebaseUid){
    toast('Real calls only work with real connections right now');
    return;
  }
  if(!nalunoEnsureCallAuth()){ toast('Sign in required for calls'); return; }
  nalunoSetCallKind('video');
  // Always open the lobby. Off-grid used to skip straight to the fallback,
  // so tapping Call never showed camera/Greenroom — lastActivityTs is a
  // local last-exchange guess, not live presence, so looking "off the grid"
  // must not block the lobby.
  const sig = computeSignal(c);
  $('lobbyContactName').textContent = 'Call ' + c.name.split(' ')[0] + '?';
  ['ringName', 'remoteName'].forEach(function(k){ try{ $(k).setAttribute('data-known-uid', c.firebaseUid || ''); }catch(_){} });
  $('ringName').textContent = c.name;
  $('remoteName').textContent = c.name;
  if(typeof applyContactAvatarToEl === 'function'){
    applyContactAvatarToEl($('ringAvatar'), c);
    applyContactAvatarToEl($('remoteAvatar'), c);
  } else {
    $('ringAvatar').style.background = c.color; $('ringAvatar').textContent = c.initials;
    $('remoteAvatar').style.background = c.color; $('remoteAvatar').textContent = c.initials;
  }
  $('sceneReadyNote').style.display = 'none';
  $('ringFallbackHint').style.display = (sig.tier === 'fading' || sig.tier === 'off') ? 'flex' : 'none';
  snapshotUiBeforeCall();
  // Soft-hide wireline without clearing contact id (needed for hangup restore)
  try{
    if($('wirelineThread')) $('wirelineThread').classList.remove('active');
  }catch(_){}
  showCallScreen('lobby');
  console.log('[call] lobby open for', contactId, 'signal', sig.tier);
  // Camera async — lobby must appear immediately even if gUM is slow
  const camPromise = (typeof enableCameraForCall === 'function')
    ? enableCameraForCall()
    : enableCamera();
  Promise.resolve(camPromise).then(()=>{
    try{ if(typeof runGreenroom === 'function') runGreenroom(); }catch(_){}
    try{ if(typeof startCamView === 'function') startCamView('lobby'); }catch(_){}
  }).catch(e=>{
    console.warn('[call] lobby camera', e);
    toast('Enable camera to continue the call');
  });
}

/* Creates the real call doc + WebRTC offer, and starts exchanging ICE candidates.
   The answer arriving (caught in the call-doc listener below) is what actually
   connects the call — nothing here simulates that part anymore. */
/* Fires the moment a real call starts — this is what reaches the other person even if
   Naluno isn't open on their device at all. Deliberately fire-and-forget: the in-app
   ring already works fine on its own, so a failed or slow notification must never
   block or delay the actual call from proceeding. */
const CALL_NOTIFY_WORKER_URL = 'https://naluno-call-notify.naluno.workers.dev';
let notifyRepeatInterval = null;
/* Fires the moment a real call starts, then keeps re-firing every 5 seconds for up to
   30 seconds total — a single push can only trigger one alert, so genuine "still
   ringing" reach means sending several, each retriggering the vibration burst and
   sound via renotify (already configured in sw.js). Stops the instant the call is
   answered, cancelled, or times out — see the matching clearInterval calls alongside
   every existing clearTimeout(ringTimeoutHandle), which already reliably marks every
   place ringing itself ends. Deliberately fire-and-forget: the in-app ring already
   works fine on its own, so this must never block or delay the actual call. */
async function notifyCalleeOfIncomingCall(calleeUid, callerName, callId){
  if(!currentUser || !calleeUid) return;
  let firstAttempt = true;

  // Callers can read users/{uid} (rules: any signed-in). Pass tokens to the worker
  // so wake does not depend on the service account reading Firestore.
  async function loadCalleePushTokens(){
    const out = { android: null, web: null, primary: null };
    try{
      if(!fbDb) return out;
      const snap = await fbDb.collection('users').doc(calleeUid).get();
      if(!snap.exists) return out;
      const d = snap.data() || {};
      out.android = d.fcmTokenAndroid || null;
      out.web = d.fcmTokenWeb || null;
      out.primary = d.fcmToken || null;
      out.platform = d.fcmTokenPlatform || null;
    }catch(e){ console.warn('[call] load callee tokens', e); }
    return out;
  }

  const sendOnce = async ()=>{
    try{
      const idToken = await currentUser.getIdToken(firstAttempt ? false : true);
      const tokens = await loadCalleePushTokens();
      const pingId = (typeof nalunoPushId === 'function') ? nalunoPushId() : '';
      const payload = {
        calleeUid,
        callerName: callerName || (currentProfile && currentProfile.name) || 'Someone',
        callId: callId || activeCallId || null,
        type: 'incoming_call',
        title: (callerName || (currentProfile && currentProfile.name) || 'Someone') + (nalunoIsVoiceCall() ? ' · voice call' : ' is calling'),
        body: nalunoIsVoiceCall() ? 'Voice call — tap to answer on Naluno' : 'Tap to answer on Naluno',
        callKind: nalunoIsVoiceCall() ? 'audio' : 'video',
        preferPlatform: 'both',
        pingId: pingId,
        // Explicit tokens — worker uses these first
        fcmTokenAndroid: tokens.android,
        fcmTokenWeb: tokens.web,
        fcmToken: tokens.primary,
        fcmTokenPlatform: tokens.platform,
      };
      if(firstAttempt){
        console.log('[call] push tokens for callee', {
          hasAndroid: !!tokens.android,
          hasWeb: !!tokens.web,
          hasPrimary: !!tokens.primary,
          platform: tokens.platform,
        });
      }
      const res = await fetch(CALL_NOTIFY_WORKER_URL, {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + idToken,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(()=>({}));
      if(pingId && typeof nalunoNotePush === 'function' && firstAttempt){
        nalunoNotePush({
          pingId: pingId, toUid: calleeUid, type: 'incoming_call',
          httpStatus: res.status, sent: data.sent, reason: data.reason || data.error || '',
        });
      }
      if(firstAttempt) console.log('[call] push response', res.status, data);
      const detail = String((data && (data.detail || data.error || data.message || JSON.stringify(data))) || '');
      const unregistered = /UNREGISTERED|NotRegistered|NOT_FOUND|no_token|missing_token/i.test(detail + JSON.stringify(data));
      if(res.ok && data.sent !== false){
        console.log('[call] push wake sent', data);
      } else if(unregistered){
        if(firstAttempt){
          console.info('[call] push token stale or missing — in-app ring if Naluno is open');
        }
        if(notifyRepeatInterval){ try{ clearInterval(notifyRepeatInterval); }catch(_){} try{ clearTimeout(notifyRepeatInterval); }catch(_){} notifyRepeatInterval = null; }
        stopRepeats = true;
      } else if(!res.ok){
        if(firstAttempt) console.warn('[call] push wake failed', res.status, data);
      } else if(data.sent === false){
        if(firstAttempt && (data.reason === 'no_token' || data.reason === 'missing_token')){
          stopRepeats = true;
        } else if(firstAttempt){
          console.warn('[call] push not sent', data.reason || data.error || '');
        }
      }
    }catch(e){
      /* A wake that cannot leave is not "no network". The call is already
         connecting. Saying the connection is gone made people hang up. */
      if(firstAttempt) console.warn('[call] push wake request failed', e);
    }
    firstAttempt = false;
  };
  let stopRepeats = false;
  sendOnce();
  if(notifyRepeatInterval) clearInterval(notifyRepeatInterval);
  // Aggressive wake attempts: 0s (above), then 2s, 6s, 14s — covers slow FCM + retries
  const delays = [2000, 6000, 14000];
  let attempt = 0;
  function scheduleNext(){
    if(stopRepeats || attempt >= delays.length){
      if(notifyRepeatInterval){ clearTimeout(notifyRepeatInterval); notifyRepeatInterval = null; }
      return;
    }
    notifyRepeatInterval = setTimeout(function(){
      attempt++;
      if(stopRepeats) return;
      sendOnce();
      scheduleNext();
    }, delays[attempt]);
  }
  scheduleNext();
}


let nalunoLastDial = null;
/* Rings this phone started earlier and never finished (the app was closed
   mid-ring, the network dropped as it hung up, an older version of the app)
   stay 'ringing' in the database, and the other phone shows them as a ghost
   ring that nobody is on. Each new call finishes them first. */
function nalunoEndMyOldRings(keepId){
  if(!fbDb || !currentUser) return;
  /* Only rings that were already there when this was asked. The answer can
     come back after the new call has been written (a slow network), and 29d
     then ended the new call too: the ring stopped a few seconds after it
     started. Anything newer than a few seconds, the call on screen, or a
     record whose time is not stamped yet is left alone. */
  const cutoff = Date.now() + (typeof nalunoServerSkew === 'number' && nalunoServerSkew ? nalunoServerSkew : 0) - 5000;
  fbDb.collection('calls').where('callerUid', '==', currentUser.uid).where('status', '==', 'ringing').get().then(function(snap){
    snap.docs.forEach(function(doc){
      if(doc.id === keepId || doc.id === activeCallId) return;
      const ms = nalunoRingMs(doc.data() || {});
      if(!ms || ms > cutoff) return;
      doc.ref.update({ status: 'ended', endReason: 'stale' }).catch(function(){});
    });
  }).catch(function(){});
}
async function startRealCall(c){
  try{ return await startRealCallInner(c); }
  catch(e){ if(nalunoLastDial && nalunoLastDial.cancelled) return false; throw e; }
}
async function startRealCallInner(c){
  // Kick camera early if a prior prewarm already has a live stream (0ms path).
  try{ if(typeof prewarmCameraForCall === 'function') prewarmCameraForCall(); }catch(_){}
  // Definitive reset before every outbound call — long calls leave dead tracks,
  // half-closed PCs, and stuck flags that break the next dial to the same person.
  if(notifyRepeatInterval){ try{ clearInterval(notifyRepeatInterval); }catch(_){} try{ clearTimeout(notifyRepeatInterval); }catch(_){} notifyRepeatInterval = null; }
  clearTimeout(ringTimeoutHandle); ringTimeoutHandle = null;
  stopRingtone();
  if(peerConnection || activeCallDocUnsub || callerCandidatesUnsub || calleeCandidatesUnsub || activeCallId){
    teardownCallConnection();
  }
  callActionInProgress = false;
  remoteDescriptionSet = false;
  pendingRemoteCandidates = [];
  iAmCaller = true;
  try{
    window.__nalunoCallPeers = {
      peerUid: (c && c.firebaseUid) || '',
      peerName: (c && c.name) || '',
      actorName: (currentProfile && currentProfile.name) || '',
    };
    window.__nalunoConnectedAt = 0;
  }catch(_){}
  const dial = nalunoDialing = nalunoLastDial = { uid: c.firebaseUid, cancelled: false, reason: null };
  // Clear this phone's own leftover rings now, not only once the new record
  // is written: a call cancelled while the camera opened left the old ghost
  // ring showing on the other phone.
  try{ nalunoEndMyOldRings(null); }catch(_){}
  const gone = () => dial.cancelled || nalunoDialing !== dial;

  // Kick TURN in the background. Camera is the only await before the offer.
  if(typeof prewarmIceServers === 'function') prewarmIceServers();
  const icePromise = (typeof getIceServers === 'function')
    ? getIceServers().catch(()=> (typeof RTC_CONFIG !== 'undefined' ? RTC_CONFIG : { iceServers:[{urls:'stun:stun.l.google.com:19302'}] }))
    : Promise.resolve(null);
  const voice = nalunoIsVoiceCall();
  /* 30d: TURN is waited for while the microphone/camera opens, not after it.
     With TURN already kept ready this is instant. */
  const turnReady = nalunoWaitForTurn(1000);
  if(voice){
    try{ await nalunoOpenMic(); }catch(e){
      if(gone()) return false;
      throw new Error((e && e.name === 'NotAllowedError') ? 'Microphone access was denied \u2014 allow it, then try again' : 'Microphone unavailable \u2014 fix that first, then try calling again');
    }
  } else if(typeof enableCameraForCall === 'function') await enableCameraForCall();
  else await enableCamera();
  if(gone()) return false;
  if(!mediaStreamIsLive(stream)){
    throw new Error('Camera/mic unavailable \u2014 fix that first, then try calling again');
  }
  // If mic was denied or missing, try a quick audio-only reopen so remote isn't silent
  if(!stream.getAudioTracks().some(t => t.readyState === 'live')){
    try{
      const a = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation:true, noiseSuppression:true }, video: false });
      if(gone() || !stream){ try{ a.getTracks().forEach(t => t.stop()); }catch(_){} return false; }
      a.getAudioTracks().forEach(t => stream.addTrack(t));
    }catch(e){ console.warn('[call] could not add audio track', e); }
    if(gone()) return false;
  }
  // Do not await icePromise — createPeerConnection uses iceNow() (0ms).
  icePromise.catch(function(){});
  // Re-enable tracks in case a previous call muted them.
  try{
    stream.getAudioTracks().forEach(t => { t.enabled = true; });
    // Always send video on a fresh call; in-call cam button can disable later
    stream.getVideoTracks().forEach(t => { t.enabled = true; });
    if(typeof camOn !== 'undefined') camOn = true;
  }catch(e){}
  remoteDescriptionSet = false;
  pendingRemoteCandidates = [];

  // doc() generates an ID locally with no network round-trip — lets us attach the ICE
  // handler before any SDP operation ever runs, so no candidate can be generated before
  // something is listening for it. This ordering was the actual cause of calls
  // "connecting" (signaling completed) while carrying no audio or video (ICE never did).
  const callRef = fbDb.collection('calls').doc();
  activeCallId = callRef.id;

  // Do NOT await a 900ms canvas prime. Draw one frame if the lobby already has video.
  try{ if(typeof drawSendCanvas === 'function') drawSendCanvas(); }catch(_){}
  // TURN into the offer when it is already on the way. The other phone is
  // not ringing yet, so this does not come out of the 2 seconds after Answer.
  try{ await turnReady; }catch(_){}
  if(gone()) return false;
  const pc = await createPeerConnection();
  const dropPc = () => { try{ pc.ontrack = null; pc.onicecandidate = null; pc.onconnectionstatechange = null; pc.oniceconnectionstatechange = null; pc.close(); }catch(_){} };
  if(gone()){ dropPc(); return false; }
  peerConnection = pc;
  /* ICE starts gathering at setLocalDescription, before the call record
     below is written. firestore.rules only lets a candidate in once the call
     exists, so those first candidates were refused and lost; a call could
     finish signalling and still carry no audio or video. They wait here
     until the record is in, then go. */
  let recordIn = false;
  const heldCands = [];
  const sendCand = function(json){ callRef.collection('callerCandidates').add(json).catch(()=>{}); };
  peerConnection.onicecandidate = e=>{
    if(!e.candidate) return;
    const json = e.candidate.toJSON();
    if(recordIn) sendCand(json); else heldCands.push(json);
  };

  pc._nalunoIceFrozen = true;
  const offer = await pc.createOffer();
  if(gone()){ dropPc(); return false; }
  await pc.setLocalDescription(offer);
  if(gone()){ dropPc(); return false; }

  await callRef.set({
    callerUid: currentUser.uid,
    calleeUid: c.firebaseUid,
    status: 'ringing',
    kind: voice ? 'audio' : 'video',
    offer: { type: offer.type, sdp: offer.sdp },
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    callerName: (currentProfile && currentProfile.name) || 'Someone',
    callerColor: (currentProfile && currentProfile.color) || '#7CFFB2',
    callerInitials: (typeof initialsFor === 'function' && currentProfile)
      ? initialsFor(currentProfile.name || 'You')
      : ((currentProfile && currentProfile.name) || 'Y').slice(0,2),
    callerPhotoUrl: (function(){
      try{
        if(typeof contactPhotoSrc === 'function' && currentProfile){
          return contactPhotoSrc(currentProfile, { skipData: true }) || currentProfile.photoUrl || null;
        }
      }catch(_){}
      return (currentProfile && currentProfile.photoUrl) || null;
    })(),
  });
  if(gone()){
    // Cancelled (or replaced by an incoming call) while the record was being
    // written: finish it at once so the other phone stops ringing.
    callRef.update({ status: 'ended', endedAt: firebase.firestore.FieldValue.serverTimestamp(), endReason: dial.reason || 'cancel' }).catch(()=>{});
    dropPc();
    return false;
  }
  recordIn = true;
  heldCands.splice(0).forEach(sendCand);
  nalunoDialing = null;
  nalunoIncomingFrom = null;
  try{ nalunoEndMyOldRings(callRef.id); }catch(_){}
  notifyCalleeOfIncomingCall(c.firebaseUid, currentProfile ? currentProfile.name : null, callRef.id);

  const myCallId = callRef.id;
  const onMyCallDoc = snap=>{
    if(activeCallId !== myCallId) return;
    const d = snap && snap.data && snap.data();
    if(!d) return;

    // Stop ringing the instant the other side taps Answer (status becomes
    // 'accepted'), even if their SDP answer is still being prepared.
    // Previously we only reacted to d.answer, which arrived 10–20s later.
    /* An answer left on a call that has already finished (ended, missed,
       declined, busy) is history, not a live answer. */
    const finished = d.status === 'ended' || d.status === 'missed' || d.status === 'declined' || d.status === 'busy';
    if(!finished && (d.status === 'accepted' || d.answer)){
      const onRing = $('ringing') && $('ringing').classList.contains('active');
      const onLobby = $('lobby') && $('lobby').classList.contains('active');
      const notInCall = !$('incall') || !$('incall').classList.contains('active');
      if(onRing || onLobby || notInCall){
        clearTimeout(ringTimeoutHandle);
        if(notifyRepeatInterval){ try{ clearInterval(notifyRepeatInterval); }catch(_){} try{ clearTimeout(notifyRepeatInterval); }catch(_){} notifyRepeatInterval = null; }
        try{ stopCallerTone(); }catch(_){}
        try{ stopRingtone(); }catch(_){}
        if(notInCall || onRing || onLobby) startInCall();
      }
    }

    if(!finished && d.answer && !remoteDescriptionSet && peerConnection){
      remoteDescriptionSet = true;
      peerConnection.setRemoteDescription(new RTCSessionDescription(d.answer)).then(()=>{
        if(peerConnection) pendingRemoteCandidates.forEach(cand => { try{ peerConnection.addIceCandidate(new RTCIceCandidate(cand)).catch(()=>{}); }catch(_){} });
        pendingRemoteCandidates = [];
      }).catch(err => console.log('[call] setRemoteDescription(answer) failed:', err));
    }

    if(d.status === 'busy' || d.status === 'declined'){
      toast(c.name.split(' ')[0] + (d.status === 'busy' ? ' is on another call' : ' declined'));
      clearTimeout(ringTimeoutHandle); ringTimeoutHandle = null;
      if(notifyRepeatInterval){ try{ clearInterval(notifyRepeatInterval); }catch(_){} try{ clearTimeout(notifyRepeatInterval); }catch(_){} notifyRepeatInterval = null; }
      stopCallerTone();
      stopRingtone();
      teardownCallConnection();
      closeCallOverlay();
      stopCameraStream();
      currentCallContactId = null;
      callActionInProgress = false;
      try{ restoreUiAfterCall(); }catch(_){}
    }
    // The other phone stopped ringing on its own (its 80s backstop): same as no answer.
    if(d.status === 'missed' && $('ringing') && $('ringing').classList.contains('active') && currentCallContactId){
      showAsyncFallback(currentCallContactId, 'timeout');
      return;
    }
    // React to remote hangup even if we're mid-transition (not only when incall is active).
    if(d.status === 'ended' && $('callOverlay').classList.contains('active')){
      try{ nalunoRememberCall('remote'); }catch(_){}
      clearTimeout(ringTimeoutHandle); ringTimeoutHandle = null;
      if(notifyRepeatInterval){ try{ clearInterval(notifyRepeatInterval); }catch(_){} try{ clearTimeout(notifyRepeatInterval); }catch(_){} notifyRepeatInterval = null; }
      stopCallerTone();
      stopRingtone();
      teardownCallConnection();
      closeCallOverlay();
      stopCameraStream();
      currentCallContactId = null;
      callActionInProgress = false;
      toast('Call ended');
      try{ restoreUiAfterCall(); }catch(_){}
    }
  };
  activeCallDocUnsub = callRef.onSnapshot(onMyCallDoc, function(err){ console.warn('[call] call watch', err && err.message); });
  nalunoWatchBackup(myCallId, 'ringing', onMyCallDoc);

  nalunoWatchCandidates(callRef, 'calleeCandidates', myCallId, function(cand){
      // Null guard: these snapshot callbacks can still fire after the call has
      // been torn down (Firestore delivers a final batch as listeners detach),
      // and `peerConnection` is set to null on teardown. Calling
      // .addIceCandidate on null throws SYNCHRONOUSLY, so the trailing
      // .catch() never sees it — the error escapes into the snapshot handler
      // and aborts the rest of that batch.
      if(remoteDescriptionSet && peerConnection){
        try{ peerConnection.addIceCandidate(new RTCIceCandidate(cand)).catch(()=>{}); }catch(_){}
      } else if(!remoteDescriptionSet){
        pendingRemoteCandidates.push(cand);
      }
  }, function(u){ calleeCandidatesUnsub = u; });

  armRingTimeout(currentCallContactId);
}

/* How long a real ring genuinely waits before offering the fallback — sized by signal
   tier, but the connection itself is fully real: this only decides when to stop
   waiting for a real answer, never fakes one arriving. */
function armRingTimeout(contactId){
  clearTimeout(ringTimeoutHandle);
  const c = contacts.find(x=>x.id===contactId); if(!c) return;
  // A real phone genuinely rings for a while before giving up — matching that instead
  // of the much shorter placeholder window this used to have.
  const waitMs = computeSignal(c).tier === 'strong' ? 75000 : 60000;
  ringTimeoutHandle = setTimeout(()=>{
    if(!$('ringing').classList.contains('active')) return; // already connected, cancelled, etc.
    showAsyncFallback(contactId, 'timeout');
  }, waitMs);
}

function showAsyncFallback(contactId, reason){
  const c = contacts.find(x=>x.id===contactId); if(!c) return;
  clearTimeout(ringTimeoutHandle);
  if(notifyRepeatInterval){ try{ clearInterval(notifyRepeatInterval); }catch(_){} try{ clearTimeout(notifyRepeatInterval); }catch(_){} notifyRepeatInterval = null; }
  currentCallContactId = contactId;
  $('asyncAvatar').style.background = c.color; $('asyncAvatar').textContent = c.initials;
  if(typeof applyContactAvatarToEl === 'function') applyContactAvatarToEl($('asyncAvatar'), c);
  $('asyncName').setAttribute('data-known-uid', c.firebaseUid || '');
  $('asyncName').textContent = c.name;
  const first = c.name.split(' ')[0];
  if(reason === 'off'){
    $('asyncEyebrow').textContent = 'Off the grid';
    $('asyncMessage').textContent = first + ' is off the grid right now';
    $('asyncKeepRingingBtn').style.display = 'none';
  } else {
    $('asyncEyebrow').textContent = 'No answer yet';
    $('asyncMessage').textContent = first + " hasn't picked up";
    $('asyncKeepRingingBtn').style.display = 'block';
  }
  // A real call attempt may already be in flight — mark it missed so it stops
  // ringing on their side too, rather than leaving a dangling "ringing" document.
  if(activeCallId && fbDb){
    nalunoCallMove(activeCallId, 'missed');
  }
  try{
    if(typeof recordMissedCallInWireline === 'function' && contactId){
      const cMiss = contacts.find(x=>x.id===contactId);
      recordMissedCallInWireline(contactId, {
        callId: activeCallId,
        incoming: false,
        ts: Date.now(),
        callerUid: (typeof currentUser !== 'undefined' && currentUser) ? currentUser.uid : null,
        calleeUid: cMiss && cMiss.firebaseUid ? cMiss.firebaseUid : null,
      });
    }
  }catch(_){}
  stopCallerTone();
  teardownCallConnection();
  if(stream) stopCameraStream(); // no need to hold a camera open for a call that isn't connecting
  showCallScreen('asyncFallback');
}
$('asyncLeaveVoiceBtn').onclick = ()=>{
  const id = currentCallContactId;
  closeCallOverlayAndStopCamera();
  if(id){ openWirelineFromFrequencies(id); setTimeout(startVoiceRecording, 350); }
};
$('asyncSendTextBtn').onclick = ()=>{
  const id = currentCallContactId;
  closeCallOverlayAndStopCamera();
  if(id) openWirelineFromFrequencies(id);
};
$('asyncKeepRingingBtn').onclick = async ()=>{
  if(callActionInProgress || !currentCallContactId) return;
  const c = contacts.find(x=>x.id===currentCallContactId); if(!c) return;
  callActionInProgress = true;
  showCallScreen('ringing');
  if(!stream){
    if(nalunoIsVoiceCall()){ try{ await nalunoOpenMic(); }catch(_){} }
    else await (typeof enableCameraForCall === 'function' ? enableCameraForCall() : enableCamera());
  }
  let placed = true;
  try{ placed = (await startRealCall(c)) !== false; if(placed) startCallerTone(); }
  catch(e){ toast(e.message || 'Couldn\u2019t retry the call'); closeCallOverlayAndStopCamera(); }
  finally{ if(placed) callActionInProgress = false; }
};
$('asyncCancelBtn').onclick = closeCallOverlayAndStopCamera;

function closeCallOverlayAndStopCamera(){
  /* used for cancel from lobby / failed start — restore previous screen */
  clearTimeout(ringTimeoutHandle); ringTimeoutHandle = null;
  if(notifyRepeatInterval){ try{ clearInterval(notifyRepeatInterval); }catch(_){} try{ clearTimeout(notifyRepeatInterval); }catch(_){} notifyRepeatInterval = null; }
  stopCallerTone();
  stopRingtone();
  teardownCallConnection();
  closeCallOverlay();
  stopCameraStream();
  try{ if(typeof nalunoSessionRelease === 'function') nalunoSessionRelease('call'); }catch(_){}
  try{ nalunoClearEarpiece(); }catch(_){}
  try{ if(typeof cameraRelease === 'function') cameraRelease('call'); }catch(_){}
  currentCallContactId = null;
  callActionInProgress = false;
  incallViewMode = 0;
  try{ closeIncallWire(); }catch(_){}
  try{
    $('incall').classList.remove('swap-focus');
    if($('localPip')) $('localPip').classList.remove('large');
  }catch(e){}
  try{ restoreUiAfterCall(); }catch(_){}
}
$('lobbyBack').onclick = closeCallOverlayAndStopCamera;
async function nalunoPlaceCall(c){
  if(callActionInProgress) return;
  if(!c || !c.isReal || !c.firebaseUid || !fbDb || !currentUser){
    toast('Can\u2019t place a real call right now');
    return;
  }
  callActionInProgress = true;
  showCallScreen('ringing');
  try{ startCallerTone(); }catch(_){}
  let placed = true;
  try{ placed = (await startRealCall(c)) !== false; }
  catch(e){ toast(e.message || 'Couldn\u2019t start the call'); closeCallOverlayAndStopCamera(); }
  finally{ if(placed) callActionInProgress = false; }
}
$('joinBtn').onclick = function(){
  nalunoSetCallKind('video');
  return nalunoPlaceCall(contacts.find(x=>x.id===currentCallContactId));
};
$('cancelCall').onclick = ()=>{
  // Caller hanging up while still ringing — let the callee's side know it's over.
  endActiveCall('cancel');
};
$('ringFallbackHint').onclick = ()=>{ if(currentCallContactId) showAsyncFallback(currentCallContactId, 'timeout'); };

$('declineIncoming').onclick = ()=>{
  declineIncomingCall(activeCallId);
};
function declineIncomingCall(callId){
  stopRingtone();
  const id = callId || activeCallId;
  try{ nalunoTellSwCallHandled(id); }catch(_){}
  if(id && typeof fbDb !== 'undefined' && fbDb){
    nalunoCallMove(id, 'declined');
  }
  if(id && activeCallId && id !== activeCallId) return;
  const overlayOpen = $('callOverlay') && $('callOverlay').classList.contains('active');
  if(!overlayOpen && !activeCallId) return;
  teardownCallConnection();
  closeCallOverlay();
  stopCameraStream();
  try{ if(typeof nalunoSessionRelease === 'function') nalunoSessionRelease('call'); }catch(_){}
  try{ nalunoClearEarpiece(); }catch(_){}
  try{ if(typeof cameraRelease === 'function') cameraRelease('call'); }catch(_){}
  currentCallContactId = null;
  callActionInProgress = false;
  try{ restoreUiAfterCall(); }catch(_){}
}
window.declineIncomingCall = declineIncomingCall;
/* Watches an answered call (this phone answered) for the other side hanging up. */
function nalunoWatchAnsweredCall(callRef, callId){
  if(activeCallDocUnsub){ try{ activeCallDocUnsub(); }catch(_){} }
  activeCallDocUnsub = callRef.onSnapshot(snap=>{
    if(activeCallId !== callId) return;
    const d = snap.data();
    if(d && d.status === 'ended' && $('callOverlay').classList.contains('active')){
      try{ nalunoRememberCall('remote'); }catch(_){}
      clearTimeout(ringTimeoutHandle); ringTimeoutHandle = null;
      if(notifyRepeatInterval){ try{ clearInterval(notifyRepeatInterval); }catch(_){} try{ clearTimeout(notifyRepeatInterval); }catch(_){} notifyRepeatInterval = null; }
      stopCallerTone();
      stopRingtone();
      teardownCallConnection();
      closeCallOverlay();
      stopCameraStream();
      currentCallContactId = null;
      callActionInProgress = false;
      toast('Call ended');
      try{ restoreUiAfterCall(); }catch(_){}
    }
  }, function(err){ console.warn('[call] answered-call watch', err && err.message); });
}

/* ---- The answer is ready before Answer is tapped ----
   Answering used to start from nothing: mark the call accepted (a round
   trip), open the camera, build the connection, read the offer, make the
   answer, write it (another round trip), and only then could the caller
   even start connecting. On a phone that is seconds of "connecting".
   While the phone rings (the camera is already warming for the preview),
   the connection and the answer are now built in the background and held
   here. Tapping Answer sends "accepted" and the answer in ONE write and
   releases the held candidates, so both phones start connecting at once.
   Nothing is sent before the tap; a decline, a missed ring or a replaced
   ring just closes it. */
let nalunoPrepared = null;
function nalunoDropPrepared(){
  const p = nalunoPrepared;
  nalunoPrepared = null;
  if(!p) return;
  try{ if(p.candUnsub) p.candUnsub(); }catch(_){}
  if(!p.used && p.pc){
    try{ p.pc.ontrack = null; p.pc.onicecandidate = null; p.pc.onconnectionstatechange = null; p.pc.oniceconnectionstatechange = null; p.pc.close(); }catch(_){}
  }
}
async function nalunoPrepareAnswer(callId, offer, camReady){
  if(!offer || !fbDb) return;
  if(nalunoPrepared && nalunoPrepared.callId === callId) return;
  nalunoDropPrepared();
  const prep = { callId, pc: null, answer: null, held: [], remoteHeld: [], ready: false, used: false, candUnsub: null };
  nalunoPrepared = prep;
  const still = function(){ return nalunoPrepared === prep && activeCallId === callId && $('incoming') && $('incoming').classList.contains('active'); };
  try{
    // Camera and TURN at the same time. Patient ICE waits up to 3.7s and
    // was still running when people tapped Answer, so the prepared answer
    // was thrown away and built again from nothing.
    await Promise.all([
      Promise.resolve(camReady).catch(function(){}),
      nalunoWaitForTurn(800),
    ]);
    if(!still()){ nalunoDropPrepared(); return; }
    if(!mediaStreamIsLive(stream)){ nalunoDropPrepared(); return; } // no camera/mic yet: Answer takes the normal path
    // With a filter on, give the filtered picture a moment to be ready so the
    // call starts on it (switching to it after connecting made the video jump).
    try{
      if(!nalunoIsVoiceCall() && typeof primeSendPreview === 'function'
         && ((typeof callOutboundWantsFilter === 'function' && callOutboundWantsFilter())
          || (typeof nalunoOutboundPortrait === 'function' && nalunoOutboundPortrait()))
         && (typeof nalunoSendCanvasAffordable !== 'function' || nalunoSendCanvasAffordable()
          || (typeof nalunoOutboundPortrait === 'function' && nalunoOutboundPortrait()))){
        const until = Date.now() + 600;
        while(!callCanvasReady() && Date.now() < until && still()){
          try{ if(typeof primeSendPreview === 'function') await primeSendPreview(); }catch(_){}
          if(!callCanvasReady()) await new Promise(function(r){ setTimeout(r, 40); });
        }
      }
    }catch(_){}
    if(!still()){ nalunoDropPrepared(); return; }
    const pc = await createPeerConnection();
    prep.pc = pc;
    if(!still()){ nalunoDropPrepared(); return; }
    pc.onicecandidate = function(e){
      if(!e.candidate) return;
      const json = e.candidate.toJSON();
      if(prep.used) fbDb.collection('calls').doc(callId).collection('calleeCandidates').add(json).catch(function(){});
      else prep.held.push(json);
    };
    pc._nalunoIceFrozen = true;
    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    if(!still()){ nalunoDropPrepared(); return; }
    // The caller's candidates, so the connection can be checked the moment Answer is tapped.
    // Collected now, used only once Answer is tapped: connectivity checks must
    // not start (or fail) while the phone is still ringing.
    nalunoWatchCandidates(fbDb.collection('calls').doc(callId), 'callerCandidates', callId, function(cand){
      if(!prep.used){ prep.remoteHeld.push(cand); return; }
      if(prep.pc && prep.pc.signalingState !== 'closed'){ try{ prep.pc.addIceCandidate(new RTCIceCandidate(cand)).catch(function(){}); }catch(_){} }
    }, function(u){ prep.candUnsub = u; if(prep.used) callerCandidatesUnsub = u; });
    const answer = await pc.createAnswer();
    if(!still()){ nalunoDropPrepared(); return; }
    await pc.setLocalDescription(answer);
    if(!still()){ nalunoDropPrepared(); return; }
    prep.answer = { type: answer.type, sdp: answer.sdp };
    prep.ready = true;
  }catch(e){
    console.warn('[call] answer could not be prepared early; Answer will build it', e && e.message);
    if(nalunoPrepared === prep) nalunoDropPrepared();
  }
}
function nalunoPreparedFor(callId){
  const p = nalunoPrepared;
  if(!p || !p.ready || p.used || p.callId !== callId || !p.pc) return null;
  if(p.pc.signalingState !== 'stable' || p.pc.connectionState === 'closed' || p.pc.connectionState === 'failed') return null;
  // The tracks it was built with must still be the live camera and mic.
  const live = p.pc.getSenders().filter(function(sn){ return sn.track && sn.track.readyState === 'live'; });
  if(live.length < 1 || !mediaStreamIsLive(stream)) return null;
  return p;
}

let nalunoAnsweredId = null;
$('acceptIncoming').onclick = async (ev)=>{
  if(callActionInProgress) return;
  /* 05 Oct: one tap is a pointerup (or touchend), which answers, and then a
     click a moment later. Once the first had finished, the click answered a
     second time, found the call already answered, said "That call is no
     longer available" and closed it. The same call is answered once. */
  try{
    const b = $('acceptIncoming');
    if(ev && ev.type === 'click' && b && b._nalunoAnswerAt && Date.now() - b._nalunoAnswerAt < 1500) return;
  }catch(_){}
  if(activeCallId && nalunoAnsweredId === activeCallId) return;
  stopRingtone();
  try{
    const st = document.querySelector('#incoming .ring-status');
    if(st) st.textContent = 'Answering…';
  }catch(_){}
  if(!activeCallId || !fbDb){ toast('That call is no longer available'); closeCallOverlayAndStopCamera(); return; }
  callActionInProgress = true;
  const acceptingId = activeCallId;
  nalunoAnsweredId = acceptingId;
  const callRef = fbDb.collection('calls').doc(acceptingId);
  /* The ring on screen can be replaced while this runs (the same person
     called again). The rest of this answer then belongs to a call that is
     gone, and must not touch the new one. */
  const NOT_MINE = new Error('replaced');
  const guard = function(){ if(activeCallId !== acceptingId) throw NOT_MINE; };

  let prep = nalunoPreparedFor(acceptingId);
  /* Answer tapped while the answer is still being built (camera or TURN
     not finished). Waiting out the rest is faster than dropping it and
     starting over, and it is capped so a stuck prepare cannot hold the tap. */
  if(!prep && nalunoPrepared && nalunoPrepared.callId === acceptingId && !nalunoPrepared.ready){
    const deadline = Date.now() + 1000;
    while(activeCallId === acceptingId && Date.now() < deadline){
      await new Promise(function(r){ setTimeout(r, 40); });
      prep = nalunoPreparedFor(acceptingId);
      if(prep) break;
      if(!nalunoPrepared || nalunoPrepared.callId !== acceptingId) break;
    }
  }
  if(prep){
    prep.used = true;   // from here the held candidates go straight out
    try{
      const moved = await nalunoCallMove(acceptingId, 'accepted', { acceptedAt: firebase.firestore.FieldValue.serverTimestamp(), answer: prep.answer });
      if(activeCallId !== acceptingId){
        if(moved){ try{ callRef.update({ status: 'ended', endReason: 'recalled' }).catch(function(){}); }catch(_){} }
        return;
      }
      if(!moved) throw new Error('gone');
    }catch(e){
      nalunoPrepared = prep; prep.used = false; nalunoDropPrepared();
      toast('That call is no longer available');
      closeCallOverlayAndStopCamera();
      callActionInProgress = false;
      return;
    }
    try{
      if(peerConnection && peerConnection !== prep.pc){ try{ peerConnection.close(); }catch(_){} }
      peerConnection = prep.pc;
      remoteDescriptionSet = true;
      pendingRemoteCandidates = [];
      pendingIncomingOffer = null;
      callerCandidatesUnsub = prep.candUnsub;
      nalunoPrepared = null;
      prep.held.splice(0).forEach(function(json){ callRef.collection('calleeCandidates').add(json).catch(function(){}); });
      prep.remoteHeld.splice(0).forEach(function(cand){ try{ prep.pc.addIceCandidate(new RTCIceCandidate(cand)).catch(function(){}); }catch(_){} });
      startInCall();
      nalunoWatchAnsweredCall(callRef, acceptingId);
      try{ if(typeof startCamView === 'function') startCamView('pip'); }catch(_){}
      try{ scheduleFilteredUpgrade(peerConnection); }catch(_){}
      try{ ensureRemoteVideoPlaying(); }catch(_){}
      setTimeout(()=> ensureRemoteVideoPlaying(), 300);
      setTimeout(()=> ensureRemoteVideoPlaying(), 1200);
      setTimeout(()=> ensureRemoteVideoPlaying(), 3000);
    }finally{
      if(activeCallId === acceptingId || !activeCallId) callActionInProgress = false;
    }
    return;
  }
  nalunoDropPrepared();

  // CRITICAL: signal "accepted" to the caller IMMEDIATELY so their ring stops
  // before any camera / WebRTC / TURN work. Previously the caller kept ringing
  // for 10–20s while the receiver was still preparing media.
  try{
    /* Only a ringing call can be answered: if the caller already hung up,
       or another device answered, this fails instead of reviving it. */
    const moved = await nalunoCallMove(acceptingId, 'accepted', { acceptedAt: firebase.firestore.FieldValue.serverTimestamp() });
    if(activeCallId !== acceptingId){
      if(moved){ try{ callRef.update({ status: 'ended', endReason: 'recalled' }).catch(function(){}); }catch(_){} }
      return;
    }
    if(!moved) throw new Error('gone');
  }catch(e){
    toast('That call is no longer available');
    closeCallOverlayAndStopCamera();
    callActionInProgress = false;
    return;
  }

  // Show in-call UI right away (remote video will appear when tracks arrive).
  startInCall();
  if($('incomingSelfTag')) $('incomingSelfTag').textContent = 'connecting…';

  try{
    // Parallel: media ready and a short TURN wait. iceNow() is 0ms once
    // that wait lands, so the answer is not built STUN-only on a cold cache.
    if(typeof prewarmIceServers === 'function') prewarmIceServers();
    const turnWait = nalunoWaitForTurn(800);
    let mediaOk;
    if(nalunoIsVoiceCall()){
      try{ await nalunoOpenMic(); }catch(_){}
      mediaOk = !!(stream && stream.getAudioTracks().some(function(t){ return t.readyState === 'live'; }));
      if(!mediaOk){ guard(); throw new Error('Microphone unavailable — allow access, then try answering again'); }
    } else {
      mediaOk = await ensureCallMediaReady();
    }
    guard();
    if(!mediaOk) throw new Error('Camera/mic unavailable — allow access, then try answering again');
    try{ await turnWait; }catch(_){}
    guard();

    if(peerConnection){
      try{ peerConnection.close(); }catch(e){}
      peerConnection = null;
    }
    remoteDescriptionSet = false;
    pendingRemoteCandidates = [];

    // Prefer offer cached at ring time — skip network get when possible
    let offer = pendingIncomingOffer;
    if(!offer){
      const doc = await callRef.get();
      guard();
      const data = doc.data();
      offer = data && data.offer;
    }
    if(!offer){
      // A ring with nothing to connect to (left behind by the other phone): finish it.
      try{ callRef.update({ status: 'ended', endReason: 'nooffer' }).catch(function(){}); }catch(_){}
      toast('That call is no longer available'); closeCallOverlayAndStopCamera(); return;
    }

    const answerPc = await createPeerConnection();
    if(activeCallId !== acceptingId){ try{ answerPc.close(); }catch(_){} throw NOT_MINE; }
    peerConnection = answerPc;
    peerConnection.onicecandidate = e=>{
      if(e.candidate) callRef.collection('calleeCandidates').add(e.candidate.toJSON()).catch(()=>{});
    };

    answerPc._nalunoIceFrozen = true;
    await answerPc.setRemoteDescription(new RTCSessionDescription(offer));
    guard();
    remoteDescriptionSet = true;
    if(peerConnection) pendingRemoteCandidates.forEach(cand => { try{ peerConnection.addIceCandidate(new RTCIceCandidate(cand)).catch(()=>{}); }catch(_){} });
    pendingRemoteCandidates = [];
    /* The caller's candidates, from the moment their offer is set (not after
       our answer is written, a round trip later), and subscribed again if
       the listener drops mid-call. */
    if(callerCandidatesUnsub){ try{ callerCandidatesUnsub(); }catch(_){} callerCandidatesUnsub = null; }
    nalunoWatchCandidates(callRef, 'callerCandidates', acceptingId, function(cand){
      if(peerConnection === answerPc){ try{ answerPc.addIceCandidate(new RTCIceCandidate(cand)).catch(()=>{}); }catch(_){} }
    }, function(u){ callerCandidatesUnsub = u; });

    const answer = await answerPc.createAnswer();
    guard();
    // setLocalDescription without waiting for full ICE gather — trickle candidates via onicecandidate
    await answerPc.setLocalDescription(answer);
    guard();
    await callRef.update({ answer: { type: answer.type, sdp: answer.sdp } });
    guard();
    pendingIncomingOffer = null;
    // Nudge remote media as soon as ICE may complete
    try{ if(typeof startCamView === 'function') startCamView('pip'); }catch(_){}
    try{ scheduleFilteredUpgrade(peerConnection); }catch(_){}
    setTimeout(()=> ensureRemoteVideoPlaying(), 300);
    setTimeout(()=> ensureRemoteVideoPlaying(), 1200);
    setTimeout(()=> ensureRemoteVideoPlaying(), 3000);


    nalunoWatchAnsweredCall(callRef, acceptingId);
  }catch(e){
    if(e === NOT_MINE){
      // Replaced by a newer ring: that one owns the screen now. Just finish this record.
      try{ callRef.update({ status: 'ended', endReason: 'recalled' }).catch(function(){}); }catch(_){}
      return;
    }
    toast(e.message || 'Couldn\u2019t answer the call');
    // Mark ended so the caller does not hang in a half-connected state.
    try{ await callRef.update({ status: 'ended' }); }catch(_){}
    teardownCallConnection();
    closeCallOverlay();
    stopCameraStream();
    currentCallContactId = null;
    callActionInProgress = false;
  }finally{
    if(activeCallId === acceptingId || !activeCallId) callActionInProgress = false;
  }
};

(function nalunoWireAnswer(){
  function wire(){
    const btn = $('acceptIncoming');
    if(!btn || btn.dataset.answerWired) return;
    btn.dataset.answerWired = '1';
    btn.style.touchAction = 'manipulation';
    const go = function(e){
      /* Touch pointerup often reports button -1. Treating that as "not the
         left button" dropped the first tap, so Answer needed a second one. */
      if(e && e.pointerType === 'mouse' && e.button != null && e.button > 0) return;
      if(btn._nalunoAnswerAt && Date.now() - btn._nalunoAnswerAt < 700) return;
      btn._nalunoAnswerAt = Date.now();
      if(typeof btn.onclick === 'function') btn.onclick(e);
    };
    btn.addEventListener('pointerup', go);
    btn.addEventListener('touchend', go, { passive: true });
    /* The click that follows the answering touch lands wherever the finger
       is, and by then the call screen may already be showing there (End sits
       where Answer was). That click is swallowed. */
    document.addEventListener('click', function(e){
      try{
        if(!btn._nalunoAnswerAt || Date.now() - btn._nalunoAnswerAt > 700) return;
        if(e.target && btn.contains(e.target)) return;
        e.stopPropagation();
        e.preventDefault();
      }catch(_){}
    }, true);
  }
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire);
  wire();
})();

let callSeconds = 0, callInterval = null;
function startInCall(){
  stopCallerTone();
  stopRingtone();
  showCallScreen('incall');
  $('incall').classList.remove('swap-focus');
  if($('localPip')) $('localPip').classList.remove('large');
  if(typeof resetPipLayoutStyles === 'function') resetPipLayoutStyles();
  if(stream && !nalunoIsVoiceCall()) startCamView('pip');
  try{
    const row = $('incallBgChipRow');
    if(row) row.style.display = 'flex';
    if(typeof renderBackgroundChips === 'function') renderBackgroundChips();
  }catch(_){}
  try{ if(typeof applyCallFilterNow === 'function') applyCallFilterNow(); }catch(_){}
  /* "Connected" and the timer wait for the call to really be up (the other
     person's picture, or their voice when their camera is off). Showing
     "Connected" at 00:00 while the screen was still waiting read as a call
     that kept dropping. */
  callSeconds = 0; $('callTimer').textContent = '00:00';
  clearInterval(callInterval); callInterval = null;
  try{ const eb = document.querySelector('#incall .call-info-pill .eyebrow'); if(eb) eb.textContent = nalunoCallLive ? 'Connected' : 'Connecting…'; }catch(_){}
  if(nalunoCallLive){ nalunoCallLive = false; nalunoMarkCallLive(); }
  if(currentCallContactId) bumpContactActivity(currentCallContactId);
  bumpTodayActivity();
  // Avatar until frames; never flash play-button
  try{ showRemoteAvatar(); }catch(_){}
  try{
    if(!nalunoIsVoiceCall() && typeof camOn !== 'undefined' && !camOn && typeof setCam === 'function') setCam(true);
    if(typeof micOn !== 'undefined' && !micOn && typeof setMic === 'function') setMic(true);
  }catch(_){}
  try{
    if(remoteCombinedStream && remoteCombinedStream.getTracks().length){
      bindRemoteVideoElement(remoteCombinedStream);
    }
    renderRemoteMediaStage();
    startRemotePlayWatch();
  }catch(_){}
  setTimeout(function(){ try{ renderRemoteMediaStage(); }catch(_){} }, 50);
  setTimeout(function(){ try{ renderRemoteMediaStage(); }catch(_){} }, 300);
  setTimeout(function(){ try{ renderRemoteMediaStage(); }catch(_){} }, 900);
  /* A call answered on one side whose other side never arrives (its phone
     died, or it hung up in the same instant) used to sit on "connecting"
     until someone gave up. If it has never connected after 40s, end it. */
  try{ clearTimeout(window.__nalunoConnectWatch); }catch(_){}
  const watchId = activeCallId;
  window.__nalunoConnectWatch = setTimeout(function(){
    try{
      if(!watchId || activeCallId !== watchId) return;
      if(!$('incall') || !$('incall').classList.contains('active')) return;
      if(window.__nalunoConnectedCall === watchId) return;
      const st = peerConnection ? peerConnection.connectionState : '';
      const ice = peerConnection ? peerConnection.iceConnectionState : '';
      if(st === 'connected' || ice === 'connected' || ice === 'completed') return;
      endActiveCall('noconnect');
      toast('The call could not connect');
    }catch(_){}
  }, 40000);
}
/* Cycles: normal (remote full + small local PiP) → large local PiP → swap (you full, them small) → normal */
let incallViewMode = 0;
function resetPipLayoutStyles(){
  // Dragging writes inline left/top; those fight CSS when we toggle size/swap.
  // Clearing them forces the stylesheet positions to take effect again.
  const pip = $('localPip');
  if(!pip) return;
  pip.style.left = '';
  pip.style.top = '';
  pip.style.right = '';
  pip.style.bottom = '';
  pip.style.width = '';
  pip.style.height = '';
  const remote = document.querySelector('#incall .remote-stage');
  if(remote){
    remote.style.left = '';
    remote.style.top = '';
    remote.style.right = '';
    remote.style.bottom = '';
    remote.style.width = '';
    remote.style.height = '';
  }
}
if($('viewToggleBtn')){
  $('viewToggleBtn').onclick = ()=>{
    incallViewMode = (incallViewMode + 1) % 3;
    const incall = $('incall');
    const pip = $('localPip');
    if(!incall) return;
    incall.classList.remove('swap-focus');
    if(pip) pip.classList.remove('large');
    resetPipLayoutStyles();
    if(incallViewMode === 1 && pip) pip.classList.add('large');
    if(incallViewMode === 2) incall.classList.add('swap-focus');
    try{
      const stage = $('pipStageCanvas');
      if(stage) stage._lastSizeCheck = 0;
    }catch(_){}
  };
}
$('endBtn').onclick = ()=>{
  endActiveCall('hangup');
};

function incallIsLive(){
  try{
    return !!( $('incall') && $('incall').classList.contains('active')
      && $('callOverlay') && $('callOverlay').classList.contains('active') );
  }catch(_){ return false; }
}
function incallWireContact(){
  const id = (typeof currentCallContactId !== 'undefined') ? currentCallContactId : null;
  if(id == null) return null;
  const list = (typeof contacts !== 'undefined' && Array.isArray(contacts)) ? contacts : [];
  return list.find(function(x){ return x && x.id === id; })
    || list.find(function(x){ return x && String(x.id) === String(id); })
    || null;
}
function incallWireEscape(s){
  if(typeof escapeHtml === 'function') return escapeHtml(String(s || ''));
  return String(s || '').replace(/[<>&"]/g, '');
}
function incallWirePreview(m){
  if(!m) return '';
  if(m.type === 'voice') return 'Voice';
  if(m.type === 'mood') return 'Feeling';
  if(m.type === 'photo') return 'Photo';
  if(m.type === 'video') return 'Video';
  if(m.type === 'document') return 'File';
  if(m.type === 'missed_call') return m.text || 'Missed call';
  if(m.type === 'system') return m.text || 'Note';
  return String(m.text || '').trim();
}
function renderIncallWire(){
  const box = $('incallWireMsgs');
  const incall = $('incall');
  if(!box || !incall || !incall.classList.contains('wire-open')) return;
  const c = incallWireContact();
  const cid = c ? c.id : currentCallContactId;
  const queued = (typeof localQueuedMessages !== 'undefined' && localQueuedMessages[cid])
    ? localQueuedMessages[cid].map(function(q){ return Object.assign({ id:q.queueId, from:'me', ts:q.queuedAt, status:'queued' }, q.payload); })
    : [];
  let msgs = [];
  try{
    const live = (typeof wirelineThreads !== 'undefined' && wirelineThreads[cid]) ? wirelineThreads[cid] : [];
    msgs = live.concat(queued);
    if(typeof collapseMissedCallRows === 'function') msgs = collapseMissedCallRows(msgs);
    if(typeof collapseDuplicateTexts === 'function') msgs = collapseDuplicateTexts(msgs);
    const cut = (c && typeof clearedAtForContact === 'function') ? clearedAtForContact(c) : 0;
    msgs = msgs.filter(function(m){
      if(!m) return false;
      if(typeof isWireMessageHidden === 'function' && isWireMessageHidden(m)) return false;
      const ts = Number(m.ts) || 0;
      return ts > (cut || 0);
    }).sort(function(a,b){ return (a.ts||0) - (b.ts||0); });
  }catch(_){ msgs = []; }
  msgs = msgs.slice(-40);
  if(!msgs.length){
    box.innerHTML = '<div class="incall-wire-empty">Type here. They stay on screen, and so do you.</div>';
    return;
  }
  box.innerHTML = msgs.map(function(m){
    const kind = (m.type === 'system' || m.type === 'missed_call') ? 'system' : (m.from === 'me' ? 'me' : 'them');
    const text = incallWirePreview(m) || '·';
    return '<div class="incall-wire-row ' + kind + '"><div class="incall-wire-bubble">' + incallWireEscape(text) + '</div></div>';
  }).join('');
  box.scrollTop = box.scrollHeight;
}
function pinIncallWireKeyboard(){
  const incall = $('incall');
  if(!incall) return;
  if(!incall.classList.contains('wire-open')){
    incall.style.setProperty('--incall-kb', '0px');
    incall.classList.remove('wire-typing');
    return;
  }
  let occluded = 0;
  try{
    const vv = window.visualViewport;
    if(vv) occluded = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
  }catch(_){}
  incall.style.setProperty('--incall-kb', Math.round(occluded) + 'px');
  incall.classList.toggle('wire-typing', occluded > 80);
}
function closeIncallWire(){
  const incall = $('incall');
  const panel = $('incallWire');
  if(incall){
    incall.classList.remove('wire-open');
    incall.classList.remove('wire-typing');
    incall.style.setProperty('--incall-kb', '0px');
  }
  if(panel) panel.setAttribute('aria-hidden', 'true');
  if($('chatBtn')) $('chatBtn').classList.remove('active');
  try{
    const inp = $('incallWireInput');
    if(inp && document.activeElement === inp) inp.blur();
  }catch(_){}
}
function openIncallWire(){
  if(!incallIsLive()) return;
  const c = incallWireContact();
  if(!c){ try{ toast('No one on this call'); }catch(_){ } return; }
  const incall = $('incall');
  const panel = $('incallWire');
  if(!incall || !panel) return;
  try{
    if($('wirelineThread')){
      $('wirelineThread').classList.remove('active');
      $('wirelineThread').style.pointerEvents = 'none';
    }
  }catch(_){}
  try{
    if(typeof activeThreadContactId !== 'undefined') activeThreadContactId = c.id;
  }catch(_){}
  incall.classList.add('wire-open');
  panel.setAttribute('aria-hidden', 'false');
  try{
    if($('localPip')) $('localPip').classList.remove('large');
    if(typeof resetPipLayoutStyles === 'function') resetPipLayoutStyles();
  }catch(_){}
  if($('chatBtn')){
    $('chatBtn').classList.add('active');
    $('chatBtn').classList.remove('has-wire');
  }
  const title = $('incallWireTitle');
  if(title) title.textContent = (c.name || 'Wireline').split(' ')[0];
  try{ if(typeof hydrateWirelineFromStore === 'function') hydrateWirelineFromStore(); }catch(_){}
  renderIncallWire();
  pinIncallWireKeyboard();
  const box = $('incallWireMsgs');
  if(box) box.scrollTop = box.scrollHeight;
}
function toggleIncallWire(){
  const incall = $('incall');
  if(incall && incall.classList.contains('wire-open')) closeIncallWire();
  else openIncallWire();
}
function sendIncallWire(){
  if(!incallIsLive()) return;
  const inp = $('incallWireInput');
  const text = ((inp && inp.value) || '').trim();
  if(!text) return;
  const c = incallWireContact();
  if(!c){ try{ toast('No one on this call'); }catch(_){ } return; }
  try{ if(typeof activeThreadContactId !== 'undefined') activeThreadContactId = c.id; }catch(_){}
  if(inp) inp.value = '';
  try{
    if($('threadInput')) $('threadInput').value = text;
    if(typeof sendThreadMessage === 'function') sendThreadMessage();
  }catch(_){}
  renderIncallWire();
}
function notifyIncallWire(contactId){
  if(!incallIsLive()) return;
  if(contactId == null || currentCallContactId == null) return;
  if(String(contactId) !== String(currentCallContactId)) return;
  const incall = $('incall');
  if(incall && incall.classList.contains('wire-open')){
    renderIncallWire();
    return;
  }
  if($('chatBtn')) $('chatBtn').classList.add('has-wire');
}

if($('chatBtn')){
  $('chatBtn').onclick = function(e){
    try{ if(e) e.stopPropagation(); }catch(_){}
    toggleIncallWire();
  };
}
if($('incallWireClose')) $('incallWireClose').onclick = function(){ closeIncallWire(); };
if($('incallWireForm')){
  $('incallWireForm').addEventListener('submit', function(e){
    try{ e.preventDefault(); }catch(_){}
    sendIncallWire();
  });
}
if($('incallWireInput')){
  $('incallWireInput').addEventListener('keydown', function(e){
    if(e.key === 'Enter' && !e.shiftKey){
      e.preventDefault();
      sendIncallWire();
    }
  });
  $('incallWireInput').addEventListener('input', function(){
    const el = $('incallWireInput');
    if(!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 88) + 'px';
  });
  $('incallWireInput').addEventListener('focus', pinIncallWireKeyboard);
  $('incallWireInput').addEventListener('blur', function(){
    setTimeout(pinIncallWireKeyboard, 80);
  });
}
try{
  if(window.visualViewport){
    window.visualViewport.addEventListener('resize', pinIncallWireKeyboard);
    window.visualViewport.addEventListener('scroll', pinIncallWireKeyboard);
  }
}catch(_){}
window.addEventListener('resize', pinIncallWireKeyboard);

/* draggable local pip */
const pip = $('localPip');
let dragging=false, offX=0, offY=0;
function endPipDrag(){ dragging=false; pip.style.cursor='grab'; }
pip.addEventListener('pointerdown', e=>{
  dragging=true;
  const r=pip.getBoundingClientRect(); offX=e.clientX-r.left; offY=e.clientY-r.top;
  pip.setPointerCapture(e.pointerId);
  pip.style.cursor='grabbing';
  e.preventDefault(); // stop the browser treating a vertical drag as a page/scroll gesture
});
pip.addEventListener('pointermove', e=>{
  if(!dragging) return;
  e.preventDefault();
  const parent = pip.parentElement.getBoundingClientRect();
  let x = e.clientX - parent.left - offX, y = e.clientY - parent.top - offY;
  x = Math.max(10, Math.min(parent.width - pip.offsetWidth - 10, x));
  y = Math.max(70, Math.min(parent.height - pip.offsetHeight - 10, y));
  pip.style.left=x+'px'; pip.style.top=y+'px'; pip.style.right='auto'; pip.style.bottom='auto';
});
pip.addEventListener('pointerup', endPipDrag);
pip.addEventListener('pointercancel', endPipDrag); // otherwise a hijacked gesture can leave the pip stuck "dragging"



/* Tap remote video area — forces play (removes WebView big-play overlay) */
(function wireRemoteStageTap(){
  function bind(){
    const stage = document.querySelector('#incall .remote-stage');
    if(!stage || stage.dataset.nalunoRemoteStageTap) return;
    stage.dataset.nalunoRemoteStageTap = '1';
    const kick = function(){
      try{ ensureRemoteVideoPlaying(); }catch(_){}
    };
    stage.addEventListener('pointerdown', kick, { passive: true });
    stage.addEventListener('click', kick, { passive: true });
  }
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind);
  else bind();
  setTimeout(bind, 2000);
})();

/* Cover fills the phone when the picture is already close to that shape.
   A wide frame on a tall phone used to be covered down to about a quarter
   of itself. That one is shown whole. */
const NALUNO_REMOTE_MIN_SHOWN = 0.75;
function nalunoFitRemoteVideo(){
  const v = document.getElementById('remoteVideo');
  if(!v) return;
  let fit = 'cover';
  try{
    const vw = v.videoWidth, vh = v.videoHeight;
    const r = v.getBoundingClientRect();
    if(vw > 0 && vh > 0 && r.width > 0 && r.height > 0){
      const src = vw / vh;
      const box = r.width / r.height;
      const shown = src > box ? (box / src) : (src / box);
      if(shown < NALUNO_REMOTE_MIN_SHOWN) fit = 'contain';
    }
  }catch(_){}
  v.style.setProperty('object-fit', fit, 'important');
  try{ v.style.objectPosition = 'center center'; }catch(_){}
  v.dataset.nalunoFit = fit;
}
(function wireRemoteFit(){
  function bind(){
    const v = document.getElementById('remoteVideo');
    if(!v || v.dataset.nalunoFitWired) return;
    v.dataset.nalunoFitWired = '1';
    ['loadedmetadata', 'resize', 'playing'].forEach(function(ev){ v.addEventListener(ev, nalunoFitRemoteVideo); });
    window.addEventListener('resize', nalunoFitRemoteVideo);
    window.addEventListener('orientationchange', function(){ setTimeout(nalunoFitRemoteVideo, 300); });
  }
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind);
  else bind();
  setTimeout(bind, 2000);
})();
window.nalunoFitRemoteVideo = nalunoFitRemoteVideo;
