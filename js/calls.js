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
  try{ if(typeof prewarmCameraForCall === 'function' && arguments[0] !== 'incall') prewarmCameraForCall(); }catch(_){}

  document.querySelectorAll('.callscreen').forEach(s=>s.classList.remove('active'));
  const screen = $(id);
  if(screen) screen.classList.add('active');
  const ov = $('callOverlay');
  if(ov){
    ov.classList.add('active');
    // Above Broadcast (80), Band, Wireline, live chrome
    ov.style.zIndex = '200';
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
}
function closeCallOverlay(){
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
  }catch(_){}
}


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
    if(!s){
      // Default home: frequencies tab
      try{
        document.querySelectorAll('.tabscreen').forEach(t=>t.classList.remove('active'));
        if($('tab-frequencies')) $('tab-frequencies').classList.add('active');
      }catch(_){}
      return;
    }
    if(s.bandRoom && $('bandRoom')){
      $('bandRoom').classList.add('active');
      $('bandRoom').style.zIndex = '';
    } else if(s.bspace && $('bspace')){
      $('bspace').classList.add('active');
      $('bspace').style.zIndex = '';
      $('bspace').style.display = 'flex';
    } else if(s.wireline && typeof openThread === 'function'){
      const id = (typeof activeThreadContactId !== 'undefined' && activeThreadContactId)
        || s.threadContactId
        || currentCallContactId;
      if(id){
        try{ openThread(id); }catch(_){}
      } else {
        document.querySelectorAll('.tabscreen').forEach(t=>t.classList.remove('active'));
        if($('tab-wireline')) $('tab-wireline').classList.add('active');
      }
    } else if(s.activeTab && $(s.activeTab)){
      document.querySelectorAll('.tabscreen').forEach(t=>t.classList.remove('active'));
      $(s.activeTab).classList.add('active');
    } else {
      document.querySelectorAll('.tabscreen').forEach(t=>t.classList.remove('active'));
      if($('tab-frequencies')) $('tab-frequencies').classList.add('active');
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
['click','keydown','touchstart'].forEach(evt => document.addEventListener(evt, ensureAudioContext, { passive:true }));

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
let ringtoneAudioEl = null;
/* Receiver-side ringtone — a short rising chime, repeating, unless a custom sound has
   been uploaded in Callsign, in which case that plays instead. Deliberately more
   melodic/attention-grabbing than the caller's tone by default, since this is the one
   that actually needs to pull someone's attention away from whatever they're doing. */
function startRingtone(){
  stopRingtone();
  if(customRingtoneUrl){
    if(!ringtoneAudioEl){
      ringtoneAudioEl = new Audio();
      ringtoneAudioEl.loop = true;
      ringtoneAudioEl.preload = 'auto';
    }
    ringtoneAudioEl.src = customRingtoneUrl;
    ringtoneAudioEl.currentTime = 0;
    ringtoneAudioEl.volume = 1.0; // device volume still applies; this is max for the element
    // Extra boost via Web Audio (HTML volume cannot exceed 1.0)
    try{
      const ctx = ensureAudioContext();
      if(ctx && !ringtoneAudioEl._nalunoBoosted){
        const src = ctx.createMediaElementSource(ringtoneAudioEl);
        const g = ctx.createGain();
        g.gain.value = 2.5; // additional boost on top of element volume
        src.connect(g);
        g.connect(ctx.destination);
        ringtoneAudioEl._nalunoBoosted = true;
      }
    }catch(_){}
    ringtoneAudioEl.play().catch(()=>{ /* fall through to synthesized if needed */ });
    return;
  }
  const ctx = ensureAudioContext(); if(!ctx) return;
  function chime(){
    const notes = [660, 880, 1046.5]; // short rising arpeggio
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
  if(ringtoneAudioEl){ ringtoneAudioEl.pause(); }
}

/* Custom ringtone — stored in this browser's localStorage (not Firestore, so it's
   this-device-only for now; syncing it across your own devices would need a Storage
   bucket, the same real gap voice notes have). */
$('uploadRingtoneBtn').onclick = ()=> $('ringtoneFileInput').click();
$('ringtoneFileInput').onchange = async (e)=>{
  const file = e.target.files[0];
  e.target.value = '';
  if(!file) return;
  if(file.size > 4*1024*1024){ toast('Keep it under 4MB for now'); return; }
  try{
    const dataUrl = await new Promise((resolve, reject)=>{
      const r = new FileReader();
      r.onload = ()=> resolve(r.result);
      r.onerror = reject;
      r.readAsDataURL(file);
    });
    localStorage.setItem('naluno:customRingtone', dataUrl);
    customRingtoneUrl = dataUrl;
    $('ringtoneStatus').textContent = 'Using your uploaded sound: ' + file.name;
    $('resetRingtoneBtn').style.display = 'block';
    toast('Ringtone updated');
  }catch(err){
    toast('Couldn\u2019t use that file');
  }
};
$('resetRingtoneBtn').onclick = ()=>{
  try{ localStorage.removeItem('naluno:customRingtone'); }catch(e){}
  customRingtoneUrl = null;
  $('ringtoneStatus').textContent = 'Using the built-in tone. You can use your own sound instead — this device only, for now.';
  $('resetRingtoneBtn').style.display = 'none';
  toast('Back to the built-in tone');
};
$('signOutBtn').onclick = ()=>{
  if(!fbAuth){ toast('Not signed in'); return; }
  window.__nalunoSigningOut = true;
  try{ localStorage.removeItem('nalunoLastUid'); }catch(_){}
  fbAuth.signOut().catch(e=> toast(e.message || 'Couldn\u2019t sign out'));
  // onAuthStateChanged's signed-out branch handles showing the sign-in screen and
  // tearing down every live listener — nothing else needed here.
};
(function loadCustomRingtone(){
  try{
    const saved = localStorage.getItem('naluno:customRingtone');
    if(saved){
      customRingtoneUrl = saved;
      $('ringtoneStatus').textContent = 'Using your uploaded sound.';
      $('resetRingtoneBtn').style.display = 'block';
    }
  }catch(e){ /* localStorage unavailable — built-in tone still works fine */ }
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

function showRemoteAvatar(){
  const videoEl = document.getElementById('remoteVideo');
  const ph = document.getElementById('remotePlaceholder');
  if(videoEl){
    videoEl.style.display = 'none';
    try{ videoEl.removeAttribute('data-has-frames'); }catch(_){}
  }
  if(ph){
    ph.style.display = 'flex';
    ph.style.visibility = 'visible';
    ph.style.opacity = '1';
  }
}

function showRemoteVideo(){
  const videoEl = document.getElementById('remoteVideo');
  const ph = document.getElementById('remotePlaceholder');
  if(!videoEl) return;
  // Never show a paused video (Android play-logo). Frames optional for first paint —
  // waiting on videoWidth caused 10–12s blank/avatar while CONNECTED.
  if(videoEl.paused){
    showRemoteAvatar();
    return;
  }
  try{
    videoEl.muted = false;
    videoEl.volume = 1;
    videoEl.style.display = 'block';
    if(videoEl.videoWidth > 0) videoEl.setAttribute('data-has-frames', '1');
    else videoEl.removeAttribute('data-has-frames');
  }catch(_){}
  if(ph) ph.style.display = 'none';
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
  } else if(forceRebind){
    // Same MediaStream, new track — rebind without prolonged null if possible
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

  // Never hide after srcObject is set — hiding while paused left both
  // people looking at avatars instead of each other.
  if(!videoEl.srcObject){
    videoEl.style.display = 'none';
  }

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
        try{ videoEl.muted = false; }catch(_){}
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
              try{ videoEl.muted = false; }catch(_){}
              promoteIfReady();
            }, 200);
          }).catch(function(){ showRemoteAvatar(); });
        }catch(_){}
      });
    }
  }catch(_){
    showRemoteAvatar();
  }
  setTimeout(function(){
    try{ if(videoEl && videoEl.srcObject) showRemoteVideo(); }catch(_){}
  }, 700);
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
  const forceRebind = (track.kind === 'video') || (liveVideoAfter > liveVideoBefore);

  try{
    track.onmute = function(){ renderRemoteMediaStage(); };
    track.onunmute = function(){ renderRemoteMediaStage(); };
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
      try{
        videoEl.muted = false;
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
        try{ videoEl.muted = false; }catch(_){}
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
        // Playing but zero frames for a while → force rebind (Samsung WebView)
        if(!state.hasFrames && ticks - lastRebind > 6){
          lastRebind = ticks;
          try{ bindRemoteVideoElement(remoteCombinedStream, true); }catch(_){}
        }
      } else if(state.hasVideo && el.paused){
        showRemoteAvatar();
        try{
          el.muted = true;
          el.play().then(function(){
            try{ el.muted = false; }catch(_){}
            showRemoteVideo();
          }).catch(function(){
            // Force srcObject rebind once then retry play
            if(ticks - lastRebind > 4){
              lastRebind = ticks;
              try{ bindRemoteVideoElement(remoteCombinedStream, true); }catch(_){}
            }
          });
        }catch(_){}
      } else if(!state.hasVideo){
        showRemoteAvatar();
        if(state.hasAudio && el.paused){
          try{
            el.muted = false;
            el.play().catch(function(){});
          }catch(_){}
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
  try{
    if(typeof enableCameraForCall === 'function') await enableCameraForCall();
    else if(typeof enableCamera === 'function') await enableCamera();
  }catch(e){ console.warn('[call] enable camera', e); }
  let okA = stream && stream.getAudioTracks().some(t => t.readyState === 'live');
  let okV = stream && stream.getVideoTracks().some(t => t.readyState === 'live');
  if(!okA){
    try{
      const a = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation:true, noiseSuppression:true, autoGainControl:true },
        video: false
      });
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
  remoteCombinedStream = new MediaStream();

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
    let out = _callRawVideoTrack;
    // Use the filtered canvas ONLY if it is already drawing (≥160px).
    // Never await a 900ms prime here — that is what made connect feel slow.
    try{
      if(typeof getCallOutboundVideoTrackSync === 'function'){
        const got = getCallOutboundVideoTrackSync();
        if(got) out = got;
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
  try{
    if(typeof applyCallFilterNow === 'function'){
      queueMicrotask(function(){ applyCallFilterNow().catch(function(){}); });
      setTimeout(function(){ applyCallFilterNow().catch(function(){}); }, 400);
    }
  }catch(_){}
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
    params.encodings[0].maxBitrate = 900000;
    params.encodings[0].maxFramerate = 24;
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

function teardownCallConnection(){
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
    if(rv){ rv.srcObject = null; rv.style.display = 'none'; }
    const rp = $('remotePlaceholder');
    if(rp) rp.style.display = 'flex';
  }catch(e){}
  remoteCombinedStream = null;
  clearInterval(callInterval); callInterval = null;
  callActionInProgress = false;
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
  clearTimeout(ringTimeoutHandle); ringTimeoutHandle = null;
  if(notifyRepeatInterval){ try{ clearInterval(notifyRepeatInterval); }catch(_){} try{ clearTimeout(notifyRepeatInterval); }catch(_){} notifyRepeatInterval = null; }
  stopCallerTone();
  stopRingtone();
  if(callId && fbDb){
    fbDb.collection('calls').doc(callId).update({
      status: 'ended',
      endedAt: firebase.firestore.FieldValue.serverTimestamp(),
      endedBy: currentUser ? currentUser.uid : null,
      endReason: reason || 'hangup',
    }).catch(()=>{});
  }
  teardownCallConnection();
  closeCallOverlay();
  stopCameraStream();
  try{ if(typeof cameraRelease === 'function') cameraRelease('call'); }catch(_){}
  currentCallContactId = null;
  callActionInProgress = false;
  incallViewMode = 0;
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

/* When the other side hangs up (or the network drops), close our UI even if the
   Firestore snapshot is slow or missed. */
function attachConnectionWatchdogs(pc){
  if(!pc) return;
  pc.onconnectionstatechange = ()=>{
    const s = pc.connectionState;
    console.log('[call] connection state:', s);
    if(s === 'connected'){
      try{ if(typeof trackMetric === 'function') trackMetric('call_connected', {}); }catch(_){}
      try{
        pc.getSenders().forEach(snd=>{
          if(snd.track){ try{ snd.track.enabled = true; }catch(_){} }
        });
      }catch(_){}
      try{ ensureRemoteVideoPlaying(); }catch(_){}
      try{ scheduleFilteredUpgrade(pc); }catch(_){}
    }
    if(s === 'failed'){
      try{ pc.restartIce(); }catch(_){}
      setTimeout(function(){
        if(!pc || pc.connectionState === 'failed'){
          if($('callOverlay') && $('callOverlay').classList.contains('active')){
            endActiveCall('remote');
          }
        }
      }, 1400);
    }
  };
  pc.oniceconnectionstatechange = ()=>{
    const s = pc.iceConnectionState;
    console.log('[call] ICE connection state:', s);
    if(s === 'connected' || s === 'completed'){
      try{ ensureRemoteVideoPlaying(); }catch(_){}
      try{ scheduleFilteredUpgrade(pc); }catch(_){}
    }
    if(s === 'failed'){
      try{ pc.restartIce(); }catch(_){}
      setTimeout(function(){
        if(!pc || pc.iceConnectionState === 'failed'){
          if($('callOverlay') && $('callOverlay').classList.contains('active')){
            endActiveCall('remote');
          }
        }
      }, 1400);
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
    }, ()=>{ /* missed call badge just won't update this session */ });
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

function startIncomingCallListener(){
  if(!fbDb || !currentUser) return;
  if(incomingCallUnsub) incomingCallUnsub();
  incomingCallUnsub = fbDb.collection('calls')
    .where('calleeUid','==',currentUser.uid)
    .where('status','==','ringing')
    .onSnapshot(snap=>{
      snap.docChanges().forEach(change=>{
        if(change.type==='added') handleIncomingCall(change.doc.id, change.doc.data());
      });
    }, ()=>{ /* incoming calls just won't be detected this session */ });
}
function handleIncomingCall(callId, data){
  // Calls always win over live / band / lobby camera preview.
  callActionInProgress = false;
  if($('callOverlay').classList.contains('active')){
    if(activeCallId && activeCallId !== callId && peerConnection){
      // Truly in another live call — ignore competing ring
      return;
    }
    if(activeCallId === callId) return;
    try{ closeCallOverlay(); }catch(e){}
  }
  // Drop leftover peer from last session (do NOT stop user camera yet — reuse)
  if(peerConnection){
    try{ peerConnection.close(); }catch(e){}
    peerConnection = null;
  }
  if(callerCandidatesUnsub){ callerCandidatesUnsub(); callerCandidatesUnsub = null; }
  if(calleeCandidatesUnsub){ calleeCandidatesUnsub(); calleeCandidatesUnsub = null; }

  activeCallId = callId;
  iAmCaller = false;
  remoteDescriptionSet = false;
  pendingRemoteCandidates = [];
  callActionInProgress = false;
  // Cache SDP offer now — Answer must not wait on another Firestore get()
  pendingIncomingOffer = (data && data.offer) ? data.offer : null;
  const c = contacts.find(x=>x.firebaseUid===data.callerUid);
  const name = c ? c.name : 'Someone';
  const color = c ? c.color : '#8B90A8';
  const initials = c ? c.initials : '?';
  currentCallContactId = c ? c.id : null;
  $('incomingName').textContent = name;
  $('incomingAvatar').style.background = color; $('incomingAvatar').textContent = initials;
  $('remoteName').textContent = name; $('remoteAvatar').style.background = color; $('remoteAvatar').textContent = initials;
  $('incomingSceneNote').style.display = 'none';
  $('incomingSelfTag').textContent = 'prepping…';
  snapshotUiBeforeCall();
  showCallScreen('incoming');
  startRingtone();
  // Pre-warm camera + TURN so Answer is nearly instant.
  prewarmIceServers();
  const showReady = ()=>{ $('incomingSceneNote').style.display = 'inline-flex'; $('incomingSelfTag').textContent = 'scene ready'; };
  const camFn = (typeof enableCameraForCall === 'function') ? enableCameraForCall : enableCamera;
  camFn().then(()=> setTimeout(showReady, 150)).catch(()=> showReady());

  // Watches for the caller hanging up before this side answers.
  activeCallDocUnsub = fbDb.collection('calls').doc(callId).onSnapshot(snap=>{
    const d = snap.data();
    if(!d) return;
    if((d.status === 'ended' || d.status === 'missed' || d.status === 'declined') && $('callOverlay').classList.contains('active') && !$('incall').classList.contains('active')){
      toast(d.status === 'missed' ? ('Missed call from ' + name) : 'Call ended');
      stopRingtone();
      teardownCallConnection();
      closeCallOverlay();
      stopCameraStream();
      currentCallContactId = null;
      callActionInProgress = false;
      try{ restoreUiAfterCall(); }catch(_){}
    }
  });
}

function startOutgoingCall(contactId){
  const c = contacts.find(x=>x.id===contactId);
  if(!c){ toast('Contact not found'); return; }
  currentCallContactId = contactId;
  if(!c.isReal || !c.firebaseUid){
    toast('Real calls only work with real connections right now');
    return;
  }
  if(!currentUser || !fbDb){ toast('Sign in required for calls'); return; }
  if(computeSignal(c).tier === 'off'){
    // Off the grid means off the grid — don't waste the person's time pretending to ring.
    showAsyncFallback(contactId, 'off');
    return;
  }
  $('lobbyContactName').textContent = 'Call ' + c.name.split(' ')[0] + '?';
  $('ringName').textContent = c.name;
  $('ringAvatar').style.background = c.color; $('ringAvatar').textContent = c.initials;
  $('remoteName').textContent = c.name;
  $('remoteAvatar').style.background = c.color; $('remoteAvatar').textContent = c.initials;
  $('sceneReadyNote').style.display = 'none';
  $('ringFallbackHint').style.display = computeSignal(c).tier === 'fading' ? 'flex' : 'none';
  snapshotUiBeforeCall();
  // Soft-hide wireline without clearing contact id (needed for hangup restore)
  try{
    if($('wirelineThread')) $('wirelineThread').classList.remove('active');
  }catch(_){}
  showCallScreen('lobby');
  console.log('[call] lobby open for', contactId);
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
      const payload = {
        calleeUid,
        callerName: callerName || (currentProfile && currentProfile.name) || 'Someone',
        callId: callId || activeCallId || null,
        type: 'incoming_call',
        title: (callerName || (currentProfile && currentProfile.name) || 'Someone') + ' is calling',
        body: 'Tap to answer on Naluno',
        preferPlatform: 'android',
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
        if(firstAttempt) toast('Push wake failed (' + res.status + ') — open app still rings');
      } else if(data.sent === false){
        if(firstAttempt && (data.reason === 'no_token' || data.reason === 'missing_token')){
          toast('They need to open Naluno once so calls can reach them');
          stopRepeats = true;
        } else if(firstAttempt && data.error){
          toast('Push error: ' + String(data.error).slice(0, 70));
        } else if(firstAttempt && data.reason === 'all_failed'){
          toast('Call alert did not go through. Ask them to open Naluno.');
        }
      }
    }catch(e){
      if(firstAttempt) console.warn('[call] push wake request failed', e);
      if(firstAttempt) toast('Push wake failed — ' + String((e && e.message) || e).slice(0, 60));
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


async function startRealCall(c){
  // Kick camera early if a prior prewarm already has a live stream (0ms path).
  try{ if(typeof prewarmCameraForCall === 'function') prewarmCameraForCall(); }catch(_){}
  // Definitive reset before every outbound call — long calls leave dead tracks,
  // half-closed PCs, and stuck flags that break the next dial to the same person.
  if(notifyRepeatInterval){ try{ clearInterval(notifyRepeatInterval); }catch(_){} try{ clearTimeout(notifyRepeatInterval); }catch(_){} notifyRepeatInterval = null; }
  clearTimeout(ringTimeoutHandle); ringTimeoutHandle = null;
  stopCallerTone();
  stopRingtone();
  if(peerConnection || activeCallDocUnsub || callerCandidatesUnsub || calleeCandidatesUnsub || activeCallId){
    teardownCallConnection();
  }
  callActionInProgress = false;
  remoteDescriptionSet = false;
  pendingRemoteCandidates = [];
  iAmCaller = true;

  // Kick TURN in the background. Camera is the only await before the offer.
  if(typeof prewarmIceServers === 'function') prewarmIceServers();
  const icePromise = (typeof getIceServers === 'function')
    ? getIceServers().catch(()=> (typeof RTC_CONFIG !== 'undefined' ? RTC_CONFIG : { iceServers:[{urls:'stun:stun.l.google.com:19302'}] }))
    : Promise.resolve(null);
  if(typeof enableCameraForCall === 'function') await enableCameraForCall();
  else await enableCamera();
  if(!mediaStreamIsLive(stream)){
    throw new Error('Camera/mic unavailable \u2014 fix that first, then try calling again');
  }
  // If mic was denied or missing, try a quick audio-only reopen so remote isn't silent
  if(!stream.getAudioTracks().some(t => t.readyState === 'live')){
    try{
      const a = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation:true, noiseSuppression:true }, video: false });
      a.getAudioTracks().forEach(t => stream.addTrack(t));
    }catch(e){ console.warn('[call] could not add audio track', e); }
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
  peerConnection = await createPeerConnection();
  peerConnection.onicecandidate = e=>{
    if(e.candidate) callRef.collection('callerCandidates').add(e.candidate.toJSON()).catch(()=>{});
  };

  const offer = await peerConnection.createOffer();
  await peerConnection.setLocalDescription(offer);

  await callRef.set({
    callerUid: currentUser.uid,
    calleeUid: c.firebaseUid,
    status: 'ringing',
    offer: { type: offer.type, sdp: offer.sdp },
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
  });
  notifyCalleeOfIncomingCall(c.firebaseUid, currentProfile ? currentProfile.name : null, callRef.id);

  activeCallDocUnsub = callRef.onSnapshot(snap=>{
    const d = snap.data();
    if(!d) return;

    // Stop ringing the instant the other side taps Answer (status becomes
    // 'accepted'), even if their SDP answer is still being prepared.
    // Previously we only reacted to d.answer, which arrived 10–20s later.
    if(d.status === 'accepted' || d.answer){
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

    if(d.answer && !remoteDescriptionSet && peerConnection){
      remoteDescriptionSet = true;
      peerConnection.setRemoteDescription(new RTCSessionDescription(d.answer)).then(()=>{
        pendingRemoteCandidates.forEach(cand => peerConnection.addIceCandidate(new RTCIceCandidate(cand)).catch(()=>{}));
        pendingRemoteCandidates = [];
      }).catch(err => console.log('[call] setRemoteDescription(answer) failed:', err));
    }

    if(d.status === 'declined'){
      toast(c.name.split(' ')[0] + ' declined');
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
    // React to remote hangup even if we're mid-transition (not only when incall is active).
    if(d.status === 'ended' && $('callOverlay').classList.contains('active')){
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
  });

  calleeCandidatesUnsub = callRef.collection('calleeCandidates').onSnapshot(snap=>{
    snap.docChanges().forEach(change=>{
      if(change.type!=='added') return;
      const cand = change.doc.data();
      if(remoteDescriptionSet) peerConnection.addIceCandidate(new RTCIceCandidate(cand)).catch(()=>{});
      else pendingRemoteCandidates.push(cand);
    });
  });

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
    fbDb.collection('calls').doc(activeCallId).update({ status:'missed' }).catch(()=>{});
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
  if(!stream) await (typeof enableCameraForCall === 'function' ? enableCameraForCall() : enableCamera());
  try{ await startRealCall(c); startCallerTone(); }
  catch(e){ toast(e.message || 'Couldn\u2019t retry the call'); closeCallOverlayAndStopCamera(); }
  finally{ callActionInProgress = false; }
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
  try{ if(typeof cameraRelease === 'function') cameraRelease('call'); }catch(_){}
  currentCallContactId = null;
  callActionInProgress = false;
  incallViewMode = 0;
  try{
    $('incall').classList.remove('swap-focus');
    if($('localPip')) $('localPip').classList.remove('large');
  }catch(e){}
  try{ restoreUiAfterCall(); }catch(_){}
}
$('lobbyBack').onclick = closeCallOverlayAndStopCamera;
$('joinBtn').onclick = async ()=>{
  if(callActionInProgress) return;
  const c = contacts.find(x=>x.id===currentCallContactId);
  if(!c || !c.isReal || !c.firebaseUid || !fbDb || !currentUser){
    toast('Can\u2019t place a real call right now');
    return;
  }
  callActionInProgress = true;
  showCallScreen('ringing');
  try{ await startRealCall(c); startCallerTone(); }
  catch(e){ toast(e.message || 'Couldn\u2019t start the call'); closeCallOverlayAndStopCamera(); }
  finally{ callActionInProgress = false; }
};
$('cancelCall').onclick = ()=>{
  // Caller hanging up while still ringing — let the callee's side know it's over.
  endActiveCall('cancel');
};
$('ringFallbackHint').onclick = ()=>{ if(currentCallContactId) showAsyncFallback(currentCallContactId, 'timeout'); };

$('declineIncoming').onclick = ()=>{
  stopRingtone();
  const callId = activeCallId;
  if(callId && fbDb){
    fbDb.collection('calls').doc(callId).update({ status:'declined' }).catch(()=>{});
  }
  teardownCallConnection();
  closeCallOverlay();
  stopCameraStream();
  try{ if(typeof cameraRelease === 'function') cameraRelease('call'); }catch(_){}
  currentCallContactId = null;
  callActionInProgress = false;
};
$('acceptIncoming').onclick = async ()=>{
  if(callActionInProgress) return;
  stopRingtone();
  if(!activeCallId || !fbDb){ toast('That call is no longer available'); closeCallOverlayAndStopCamera(); return; }
  callActionInProgress = true;
  const callRef = fbDb.collection('calls').doc(activeCallId);

  // CRITICAL: signal "accepted" to the caller IMMEDIATELY so their ring stops
  // before any camera / WebRTC / TURN work. Previously the caller kept ringing
  // for 10–20s while the receiver was still preparing media.
  try{
    await callRef.update({ status: 'accepted', acceptedAt: firebase.firestore.FieldValue.serverTimestamp() });
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
    // Parallel: media ready. TURN is prewarmed; iceNow() is 0ms.
    if(typeof prewarmIceServers === 'function') prewarmIceServers();
    const mediaOk = await ensureCallMediaReady();
    if(!mediaOk) throw new Error('Camera/mic unavailable — allow access, then try answering again');

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
      const data = doc.data();
      offer = data && data.offer;
    }
    if(!offer){ toast('That call is no longer available'); closeCallOverlayAndStopCamera(); return; }

    peerConnection = await createPeerConnection();
    peerConnection.onicecandidate = e=>{
      if(e.candidate) callRef.collection('calleeCandidates').add(e.candidate.toJSON()).catch(()=>{});
    };

    await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
    remoteDescriptionSet = true;
    pendingRemoteCandidates.forEach(cand => peerConnection.addIceCandidate(new RTCIceCandidate(cand)).catch(()=>{}));
    pendingRemoteCandidates = [];

    const answer = await peerConnection.createAnswer();
    // setLocalDescription without waiting for full ICE gather — trickle candidates via onicecandidate
    await peerConnection.setLocalDescription(answer);
    await callRef.update({ answer: { type: answer.type, sdp: answer.sdp } });
    pendingIncomingOffer = null;
    // Nudge remote media as soon as ICE may complete
    try{ if(typeof startCamView === 'function') startCamView('pip'); }catch(_){}
    try{ scheduleFilteredUpgrade(peerConnection); }catch(_){}
    setTimeout(()=> ensureRemoteVideoPlaying(), 300);
    setTimeout(()=> ensureRemoteVideoPlaying(), 1200);
    setTimeout(()=> ensureRemoteVideoPlaying(), 3000);

    if(callerCandidatesUnsub) callerCandidatesUnsub();
    callerCandidatesUnsub = callRef.collection('callerCandidates').onSnapshot(snap=>{
      snap.docChanges().forEach(change=>{
        if(change.type==='added') peerConnection.addIceCandidate(new RTCIceCandidate(change.doc.data())).catch(()=>{});
      });
    });

    if(activeCallDocUnsub) activeCallDocUnsub();
    activeCallDocUnsub = callRef.onSnapshot(snap=>{
      const d = snap.data();
      if(d && d.status === 'ended' && $('callOverlay').classList.contains('active')){
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
    });
  }catch(e){
    toast(e.message || 'Couldn\u2019t answer the call');
    // Mark ended so the caller does not hang in a half-connected state.
    try{ await callRef.update({ status: 'ended' }); }catch(_){}
    teardownCallConnection();
    closeCallOverlay();
    stopCameraStream();
    currentCallContactId = null;
    callActionInProgress = false;
  }finally{
    callActionInProgress = false;
  }
};

let callSeconds = 0, callInterval = null;
function startInCall(){
  stopCallerTone();
  stopRingtone();
  showCallScreen('incall');
  $('incall').classList.remove('swap-focus');
  if($('localPip')) $('localPip').classList.remove('large');
  if(typeof resetPipLayoutStyles === 'function') resetPipLayoutStyles();
  if(stream) startCamView('pip');
  try{
    const row = $('incallBgChipRow');
    if(row) row.style.display = 'flex';
    if(typeof renderBackgroundChips === 'function') renderBackgroundChips();
  }catch(_){}
  try{ if(typeof applyCallFilterNow === 'function') applyCallFilterNow(); }catch(_){}
  callSeconds = 0; $('callTimer').textContent = '00:00';
  clearInterval(callInterval);
  callInterval = setInterval(function(){
    callSeconds++;
    const m = String(Math.floor(callSeconds/60)).padStart(2,'0');
    const s = String(callSeconds%60).padStart(2,'0');
    $('callTimer').textContent = m+':'+s;
  }, 1000);
  if(currentCallContactId) bumpContactActivity(currentCallContactId);
  bumpTodayActivity();
  // Avatar until frames; never flash play-button
  try{ showRemoteAvatar(); }catch(_){}
  try{
    if(typeof camOn !== 'undefined' && !camOn && typeof setCam === 'function') setCam(true);
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
  };
}
$('endBtn').onclick = ()=>{
  endActiveCall('hangup');
};

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
