/* ============================================================
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
const RTC_CONFIG = {
  iceServers: [
    { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
  ],
  iceCandidatePoolSize: 10,
  bundlePolicy: 'max-bundle',
  rtcpMuxPolicy: 'require',
};
const TURN_CREDENTIALS_WORKER_URL = 'https://naluno-turn-credentials.naluno.workers.dev';
/* Fetches fresh, short-lived TURN relay credentials from Cloudflare's Realtime
   service — the actual fix for calls that connect but never show a feed between two
   devices on different networks (confirmed by real console evidence: tracks send and
   receive correctly, but ICE never finds a route without a relay to fall back on).
   Falls back to the STUN-only config if this fails for any reason — a call can still
   attempt a direct connection without TURN, it just won't have the relay fallback for
   networks that genuinely need one. */
/* Cache TURN credentials so answering a call does not wait on a network round-trip.
   Credentials are short-lived (~2h from the Worker); we refresh after 25 minutes. */
let cachedIceServers = null;
let cachedIceServersAt = 0;
const ICE_CACHE_TTL_MS = 25 * 60 * 1000;
async function getIceServers(){
  if(!currentUser) return RTC_CONFIG;
  if(cachedIceServers && (Date.now() - cachedIceServersAt) < ICE_CACHE_TTL_MS){
    return cachedIceServers;
  }
  try{
    const idToken = await currentUser.getIdToken();
    const res = await fetch(TURN_CREDENTIALS_WORKER_URL, {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + idToken },
    });
    if(!res.ok){
      console.log('[call] TURN credentials HTTP', res.status, '— falling back to STUN-only');
      return RTC_CONFIG;
    }
    const data = await res.json();
    if(!data.iceServers || !data.iceServers.length){
      console.log('[call] TURN response had no iceServers — falling back to STUN-only');
      return RTC_CONFIG;
    }
    console.log('[call] TURN credentials received —', data.iceServers.length, 'server(s)');
    cachedIceServers = {
      iceServers: data.iceServers,
      iceCandidatePoolSize: 10,
      bundlePolicy: 'max-bundle',
      rtcpMuxPolicy: 'require',
    };
    cachedIceServersAt = Date.now();
    return cachedIceServers;
  }catch(e){
    console.log('[call] Could not fetch TURN credentials, falling back to STUN-only:', e);
    return RTC_CONFIG;
  }
}
function prewarmIceServers(){
  getIceServers().catch(()=>{});
}
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
function ensureRemoteVideoPlaying(){
  const videoEl = document.getElementById('remoteVideo');
  if(!videoEl) return false;
  try{
    videoEl.removeAttribute('controls');
    videoEl.controls = false;
    videoEl.setAttribute('playsinline', 'true');
    videoEl.setAttribute('webkit-playsinline', 'true');
    videoEl.playsInline = true;
    videoEl.autoplay = true;
  }catch(_){}

  if(!videoEl.srcObject){
    if(remoteCombinedStream && remoteCombinedStream.getTracks().length){
      try{ videoEl.srcObject = remoteCombinedStream; }catch(_){}
    } else {
      return false;
    }
  }

  // Reveal stage — hide placeholder so only the stream (or black) shows, never a stuck UI chrome
  try{
    videoEl.style.display = 'block';
    const ph = document.getElementById('remotePlaceholder');
    if(ph) ph.style.display = 'none';
  }catch(_){}

  // Prefer muted autoplay first (always allowed), then unmute — avoids permanent pause + big play button
  let ok = false;
  try{
    videoEl.muted = true;
    const p = videoEl.play();
    if(p && p.then){
      p.then(function(){
        ok = true;
        try{ videoEl.muted = false; videoEl.volume = 1; }catch(_){}
      }).catch(function(){
        try{
          videoEl.muted = true;
          videoEl.play().then(function(){
            setTimeout(function(){ try{ videoEl.muted = false; }catch(_){} }, 200);
          }).catch(function(){});
        }catch(_){}
      });
    } else {
      try{ videoEl.muted = false; }catch(_){}
      ok = true;
    }
  }catch(_){}
  return ok;
}

let remotePlayWatch = null;
function startRemotePlayWatch(){
  stopRemotePlayWatch();
  remotePlayWatch = setInterval(function(){
    try{
      if(!activeCallId){ stopRemotePlayWatch(); return; }
      const el = document.getElementById('remoteVideo');
      if(!el) return;
      if(!el.srcObject && remoteCombinedStream && remoteCombinedStream.getTracks().length){
        el.srcObject = remoteCombinedStream;
      }
      if(!el.srcObject) return;
      // Stuck paused = big play button on Android WebView
      if(el.paused){
        ensureRemoteVideoPlaying();
      }
      // Track live but no dimensions: rebind stream
      const vt = el.srcObject.getVideoTracks && el.srcObject.getVideoTracks()[0];
      if(vt && vt.readyState === 'live' && el.videoWidth === 0 && !el.paused){
        const s = el.srcObject;
        el.srcObject = null;
        el.srcObject = s;
        ensureRemoteVideoPlaying();
      }
    }catch(_){}
  }, 700);
}
function stopRemotePlayWatch(){
  if(remotePlayWatch){ clearInterval(remotePlayWatch); remotePlayWatch = null; }
}

async function ensureCallMediaReady(){
  const hasA = stream && stream.getAudioTracks().some(t => t.readyState === 'live');
  const hasV = stream && stream.getVideoTracks().some(t => t.readyState === 'live');
  if(hasA && hasV){
    // Fast path — do not re-negotiate camera (keeps answer quick)
    try{
      stream.getAudioTracks().forEach(t => { t.enabled = true; });
      stream.getVideoTracks().forEach(t => { t.enabled = (typeof camOn === 'undefined') ? true : !!camOn; });
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
        video: { facingMode: { ideal: (typeof cameraFacingMode!=='undefined'?cameraFacingMode:'user') }, width:{ideal:1280}, height:{ideal:720} },
        audio: false
      });
      if(!stream) stream = v;
      else v.getVideoTracks().forEach(t => stream.addTrack(t));
      okV = true;
      ['camRawVideo','pipRawVideo','sendRawVideo','incomingSelfVideo'].forEach(id=>{
        const el = $(id);
        if(el && stream){ el.srcObject = stream; el.play && el.play().catch(()=>{}); }
      });
    }catch(e){ console.warn('[call] video reopen failed', e); }
  }
  return !!(stream && stream.getAudioTracks().some(t=>t.readyState==='live') && stream.getVideoTracks().some(t=>t.readyState==='live'));
}

async function createPeerConnection(){
  try{ if(typeof metricStart === 'function') window._callMediaMetric = metricStart('call_time_to_media'); }catch(_){}
  const ice = await getIceServers();
  const pc = new RTCPeerConnection(ice);
  remoteCombinedStream = new MediaStream();
  pc.ontrack = e=>{
    console.log('[call] ontrack —', e.track.kind, e.track.readyState, 'streams:', (e.streams||[]).length);
    try{
      if(e.track.kind === 'video' && typeof metricEnd === 'function' && window._callMediaMetric){
        metricEnd(window._callMediaMetric, true, { kind: 'video' });
        window._callMediaMetric = null;
      }
      if(typeof trackMetric === 'function') trackMetric('call_ontrack', { kind: e.track.kind });
    }catch(_){}
    try{ e.track.enabled = true; }catch(_){}
    try{ e.track.contentHint = e.track.kind === 'video' ? 'motion' : 'speech'; }catch(_){}
    // Prefer stream from event when present (more reliable on some browsers)
    if(e.streams && e.streams[0]){
      e.streams[0].getTracks().forEach(t=>{
        if(!remoteCombinedStream.getTracks().includes(t)) remoteCombinedStream.addTrack(t);
      });
    } else if(!remoteCombinedStream.getTracks().includes(e.track)){
      remoteCombinedStream.addTrack(e.track);
    }
    const videoEl = $('remoteVideo');
    if(videoEl){
      if(videoEl.srcObject !== remoteCombinedStream) videoEl.srcObject = remoteCombinedStream;
      videoEl.playsInline = true;
      videoEl.autoplay = true;
      videoEl.muted = false;
      videoEl.volume = 1;
      if(e.track.kind === 'video'){
        videoEl.style.display = 'block';
        const ph = $('remotePlaceholder');
        if(ph) ph.style.display = 'none';
      }
      if(remotePlayTimer) clearTimeout(remotePlayTimer);
      remotePlayTimer = setTimeout(function(){ ensureRemoteVideoPlaying(); }, 20);
      e.track.onunmute = function(){ ensureRemoteVideoPlaying(); };
    }
    if(e.track.kind === 'audio'){
      try{ if(typeof ensureAudioContext === 'function') ensureAudioContext(); }catch(_){}
      ensureRemoteVideoPlaying();
    }
  };
  pc.onicegatheringstatechange = ()=> console.log('[call] ICE gathering:', pc.iceGatheringState);
  // connectionstate + filter schedule live in attachConnectionWatchdogs (single handler)
  attachConnectionWatchdogs(pc);

  // addTrack alone creates sendrecv m-lines. Do NOT also addTransceiver of same kind
  // (that doubles m-lines and often yields silent/black calls).
  if(stream){
    await attachLocalTracksToPc(pc);
  } else {
    console.warn('[call] createPeerConnection with no local stream');
    // Last resort empty recv so we can still receive if remote sends
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

  if(audioTracks[0]){
    const t = audioTracks[0];
    try{
      t.enabled = true;
      t.contentHint = 'speech';
      if(t.applyConstraints){
        t.applyConstraints({
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        }).catch(()=>{});
      }
    }catch(_){}
    pc.addTrack(t, stream);
  } else {
    console.warn('[call] NO audio track to send');
  }
  if(videoTracks[0]){
    const t = videoTracks[0];
    try{
      t.enabled = (typeof camOn === 'undefined') ? true : !!camOn;
      t.contentHint = 'motion';
    }catch(_){}
    pc.addTrack(t, stream);
  } else {
    console.warn('[call] NO video track to send');
  }
  console.log('[call] senders', pc.getSenders().map(s=>({kind:s.track&&s.track.kind, state:s.track&&s.track.readyState})));
}

/* ---- Outbound filters (safe): raw A/V first, then sendCanvas replaceTrack ----
   sendCanvas is painted every frame with compositeFrame (same filters you see).
   We never touch audio. If anything fails, the original camera track stays. */
let _callFilterPc = null;
let _callFilterSender = null;
let _callRawVideoTrack = null;
let _callFilterTrack = null;
let _callFilterUpgradeTimer = null;
let _callFilterUpgraded = false;

function callWantsOutboundFilter(){
  try{
    if(typeof greenroomEnabled !== 'undefined' && !greenroomEnabled) return false;
    const fid = (typeof selectedFilterId !== 'undefined') ? selectedFilterId : 'original';
    const bid = (typeof selectedBackgroundId !== 'undefined') ? selectedBackgroundId : 'none';
    return (fid && fid !== 'original') || (bid && bid !== 'none');
  }catch(_){ return false; }
}

function scheduleFilteredUpgrade(pc){
  if(!pc) return;
  _callFilterPc = pc;
  const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
  if(!sender) return;
  _callFilterSender = sender;
  // Remember the real camera track for safe rollback
  if(sender.track && sender.track.readyState === 'live' && !sender.track.label.includes('canvas')){
    _callRawVideoTrack = sender.track;
  } else if(stream){
    const vt = stream.getVideoTracks().find(t => t.readyState === 'live');
    if(vt) _callRawVideoTrack = vt;
  }
  if(_callFilterUpgradeTimer) clearTimeout(_callFilterUpgradeTimer);
  // Short delay so ICE + first frames settle; answer path stays untouched
  _callFilterUpgradeTimer = setTimeout(()=>{
    upgradeCallVideoToFiltered().catch(e => console.warn('[call] filter upgrade', e));
  }, 350);
}

async function upgradeCallVideoToFiltered(){
  const pc = _callFilterPc;
  const videoSender = _callFilterSender;
  if(!pc || !videoSender) return;
  if(pc.connectionState !== 'connected' && pc.iceConnectionState !== 'connected' && pc.iceConnectionState !== 'completed') return;
  if(_callFilterUpgraded && callWantsOutboundFilter()) return; // already on filter

  if(!callWantsOutboundFilter()){
    if(_callRawVideoTrack && _callRawVideoTrack.readyState === 'live' && videoSender.track !== _callRawVideoTrack){
      try{ await videoSender.replaceTrack(_callRawVideoTrack); _callFilterUpgraded = false; }catch(_){}
    }
    return;
  }

  try{
    const srv = $('sendRawVideo');
    if(srv && stream){
      if(srv.srcObject !== stream) srv.srcObject = stream;
      try{ await srv.play(); }catch(_){}
    }
  }catch(_){}

  const canvas = $('sendCanvas');
  if(!canvas || typeof canvas.captureStream !== 'function') return;
  try{ if(typeof drawSendCanvas === 'function') drawSendCanvas(); }catch(_){}
  if(canvas.width < 16 || canvas.height < 16){
    // one soft retry next frame only — never a long loop on answer path
    requestAnimationFrame(()=>{
      try{ if(typeof drawSendCanvas === 'function') drawSendCanvas(); }catch(_){}
      if(canvas.width >= 16) upgradeCallVideoToFiltered().catch(()=>{});
    });
    return;
  }

  let fxStream;
  try{ fxStream = canvas.captureStream(30); }catch(e){
    console.warn('[call] captureStream failed', e);
    return;
  }
  const vTrack = fxStream.getVideoTracks().find(t => t.readyState === 'live');
  if(!vTrack) return;
  try{ vTrack.contentHint = 'motion'; }catch(_){}

  try{
    await videoSender.replaceTrack(vTrack);
    _callFilterTrack = vTrack;
    _callFilterUpgraded = true;
    console.log('[call] outbound → filtered', canvas.width + 'x' + canvas.height);
    vTrack.onended = ()=>{
      if(_callRawVideoTrack && _callRawVideoTrack.readyState === 'live' && _callFilterSender){
        _callFilterSender.replaceTrack(_callRawVideoTrack).catch(()=>{});
        _callFilterUpgraded = false;
      }
    };
  }catch(e){
    console.warn('[call] filter replaceTrack failed — camera kept', e);
  }
}

function refreshOutboundFilterIfInCall(){
  try{
    if(!_callFilterPc || _callFilterPc.connectionState !== 'connected') return;
    if(!_callFilterSender) return;
    upgradeCallVideoToFiltered().catch(()=>{});
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
  if(notifyRepeatInterval){ clearInterval(notifyRepeatInterval); notifyRepeatInterval = null; }
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
      // Filters: only after media is flowing (does not block answer)
      try{ scheduleFilteredUpgrade(pc); }catch(_){}
    }
    if(s === 'failed' || s === 'closed'){
      if($('callOverlay').classList.contains('active')){
        endActiveCall('remote');
      }
    }
  };
  pc.oniceconnectionstatechange = ()=>{
    const s = pc.iceConnectionState;
    console.log('[call] ICE connection state:', s);
    if(s === 'connected' || s === 'completed'){
      try{ ensureRemoteVideoPlaying(); }catch(_){}
      try{ scheduleFilteredUpgrade(pc); }catch(_){}
    }
    if(s === 'failed' || s === 'closed'){
      if($('callOverlay').classList.contains('active')){
        endActiveCall('remote');
      }
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
        if(notifyRepeatInterval){ clearInterval(notifyRepeatInterval); notifyRepeatInterval = null; }
        stopRepeats = true;
      } else if(!res.ok){
        if(firstAttempt) console.warn('[call] push wake failed', res.status, data);
        if(firstAttempt) toast('Push wake failed (' + res.status + ') — open app still rings');
      } else if(data.sent === false){
        if(firstAttempt && (data.reason === 'no_token' || data.reason === 'missing_token')){
          toast('No push token on their device — they must open Naluno APK once');
          stopRepeats = true;
        } else if(firstAttempt && data.error){
          toast('Push error: ' + String(data.error).slice(0, 70));
        } else if(firstAttempt && data.reason === 'all_failed'){
          toast('FCM rejected push — enable FCM API + check worker key');
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
  let repeats = 0;
  notifyRepeatInterval = setInterval(()=>{
    if(stopRepeats){ clearInterval(notifyRepeatInterval); notifyRepeatInterval = null; return; }
    repeats++;
    if(repeats >= 3){ clearInterval(notifyRepeatInterval); notifyRepeatInterval = null; return; }
    sendOnce();
  }, 8000);
}


async function startRealCall(c){
  // Definitive reset before every outbound call — long calls leave dead tracks,
  // half-closed PCs, and stuck flags that break the next dial to the same person.
  if(notifyRepeatInterval){ clearInterval(notifyRepeatInterval); notifyRepeatInterval = null; }
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

  // Kick TURN + camera in parallel (speed).
  const icePromise = getIceServers().catch(()=> RTC_CONFIG);
  prewarmIceServers();
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
  await icePromise;
  // Re-enable tracks in case a previous call muted them.
  try{
    stream.getAudioTracks().forEach(t => { t.enabled = true; });
    stream.getVideoTracks().forEach(t => { t.enabled = camOn; });
  }catch(e){}
  remoteDescriptionSet = false;
  pendingRemoteCandidates = [];

  // doc() generates an ID locally with no network round-trip — lets us attach the ICE
  // handler before any SDP operation ever runs, so no candidate can be generated before
  // something is listening for it. This ordering was the actual cause of calls
  // "connecting" (signaling completed) while carrying no audio or video (ICE never did).
  const callRef = fbDb.collection('calls').doc();
  activeCallId = callRef.id;

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
        if(notifyRepeatInterval){ clearInterval(notifyRepeatInterval); notifyRepeatInterval = null; }
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
      if(notifyRepeatInterval){ clearInterval(notifyRepeatInterval); notifyRepeatInterval = null; }
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
      if(notifyRepeatInterval){ clearInterval(notifyRepeatInterval); notifyRepeatInterval = null; }
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
  if(notifyRepeatInterval){ clearInterval(notifyRepeatInterval); notifyRepeatInterval = null; }
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
  if(!stream) await enableCamera();
  try{ await startRealCall(c); startCallerTone(); }
  catch(e){ toast(e.message || 'Couldn\u2019t retry the call'); closeCallOverlayAndStopCamera(); }
  finally{ callActionInProgress = false; }
};
$('asyncCancelBtn').onclick = closeCallOverlayAndStopCamera;

function closeCallOverlayAndStopCamera(){
  /* used for cancel from lobby / failed start — restore previous screen */
  clearTimeout(ringTimeoutHandle); ringTimeoutHandle = null;
  if(notifyRepeatInterval){ clearInterval(notifyRepeatInterval); notifyRepeatInterval = null; }
  stopCallerTone();
  stopRingtone();
  teardownCallConnection();
  closeCallOverlay();
  stopCameraStream();
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
    // Parallel: media ready + TURN credentials (often already cached from prewarm)
    const iceP = getIceServers().catch(()=> RTC_CONFIG);
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

    await iceP;
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
    setTimeout(()=> ensureRemoteVideoPlaying(), 300);
    setTimeout(()=> ensureRemoteVideoPlaying(), 1200);

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
        if(notifyRepeatInterval){ clearInterval(notifyRepeatInterval); notifyRepeatInterval = null; }
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
  // Reset view mode at the start of every call.
  $('incall').classList.remove('swap-focus');
  if($('localPip')) $('localPip').classList.remove('large');
  if(typeof resetPipLayoutStyles === 'function') resetPipLayoutStyles();
  if(stream) startCamView('pip');
  callSeconds = 0; $('callTimer').textContent = '00:00';
  clearInterval(callInterval);
  callInterval = setInterval(()=>{
    callSeconds++;
    const m = String(Math.floor(callSeconds/60)).padStart(2,'0');
    const s = String(callSeconds%60).padStart(2,'0');
    $('callTimer').textContent = m+':'+s;
  }, 1000);
  if(currentCallContactId) bumpContactActivity(currentCallContactId);
  bumpTodayActivity();
  // Kill the Android WebView "big play button" — play while still in the answer/call gesture chain
  try{
    if(remoteCombinedStream && remoteCombinedStream.getTracks().length){
      const rv = $('remoteVideo');
      if(rv){
        rv.style.display = 'block';
        if(rv.srcObject !== remoteCombinedStream) rv.srcObject = remoteCombinedStream;
      }
      const ph = $('remotePlaceholder');
      if(ph) ph.style.display = 'none';
    }
    ensureRemoteVideoPlaying();
    startRemotePlayWatch();
  }catch(_){}
  setTimeout(function(){ try{ ensureRemoteVideoPlaying(); }catch(_){} }, 100);
  setTimeout(function(){ try{ ensureRemoteVideoPlaying(); }catch(_){} }, 500);
  setTimeout(function(){ try{ ensureRemoteVideoPlaying(); }catch(_){} }, 1500);
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
