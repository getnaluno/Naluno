/* ============================================================
   MODULE: js/call-filters.js
   Outbound call video: raw camera first (so connect stays under 2s),
   then the same Naluno filter canvas the local preview uses —
   only once that canvas is actually drawing a real camera frame
   (never a 2px black track, never a 720 placeholder with no pixels).
   OWNERSHIP: which track goes into RTCPeerConnection.
   ============================================================ */

let _fxStream = null;
let _fxCanvas = null;

function callOutboundWantsFilter(){
  try{
    if(typeof greenroomEnabled !== 'undefined' && !greenroomEnabled) return false;
    const id = (typeof selectedFilterId !== 'undefined') ? selectedFilterId : 'original';
    if(!id || id === 'none' || id === 'original') return false;
    return !!(typeof nalunoFilters !== 'undefined' && nalunoFilters[id]);
  }catch(_){ return false; }
}

/* A landscape camera is the thin strip on the other phone. Send the
   upright canvas instead, even when no colour filter is on. */
function nalunoOutboundPortrait(){
  try{
    const video = typeof $ === 'function' ? $('sendRawVideo') : document.getElementById('sendRawVideo');
    if(video && video.videoWidth && video.videoHeight){
      return (video.videoWidth / video.videoHeight) > 1.05;
    }
    const raw = (typeof stream !== 'undefined' && stream && stream.getVideoTracks)
      ? stream.getVideoTracks().find(function(t){ return t.readyState === 'live'; })
      : null;
    if(raw && raw.getSettings){
      const s = raw.getSettings();
      if(s.width && s.height) return (s.width / s.height) > 1.05;
    }
  }catch(_){}
  return false;
}

function callCanvasReady(){
  const canvas = typeof $ === 'function' ? $('sendCanvas') : document.getElementById('sendCanvas');
  const video = typeof $ === 'function' ? $('sendRawVideo') : document.getElementById('sendRawVideo');
  return !!(canvas && canvas.width >= 160 && canvas.height >= 160
    && video && video.videoWidth >= 160 && video.readyState >= 2);
}

function waitForVideoFrame(video, ms){
  return new Promise(function(resolve){
    if(!video){ resolve(false); return; }
    if(video.readyState >= 2 && video.videoWidth){ resolve(true); return; }
    let done = false;
    const finish = function(ok){
      if(done) return;
      done = true;
      try{ video.removeEventListener('loadeddata', onReady); }catch(_){}
      resolve(!!ok);
    };
    const onReady = function(){ finish(true); };
    video.addEventListener('loadeddata', onReady);
    setTimeout(function(){ finish(video.readyState >= 2 && video.videoWidth); }, ms || 80);
  });
}

async function primeSendPreview(){
  const video = typeof $ === 'function' ? $('sendRawVideo') : document.getElementById('sendRawVideo');
  const canvas = typeof $ === 'function' ? $('sendCanvas') : document.getElementById('sendCanvas');
  if(!video || !canvas || typeof stream === 'undefined' || !stream) return callCanvasReady();
  video.muted = true;
  video.setAttribute('playsinline', '');
  video.setAttribute('webkit-playsinline', '');
  if(video.srcObject !== stream) video.srcObject = stream;
  try{ await video.play(); }catch(_){}
  if(!video.videoWidth) await waitForVideoFrame(video, 80);
  try{ if(typeof drawSendCanvas === 'function') drawSendCanvas(true); }catch(_){}
  return callCanvasReady();
}

function getOrCreateFxTrack(){
  const canvas = typeof $ === 'function' ? $('sendCanvas') : document.getElementById('sendCanvas');
  if(!callCanvasReady() || !canvas || typeof canvas.captureStream !== 'function') return null;
  if(_fxStream && _fxCanvas === canvas){
    const live = _fxStream.getVideoTracks().find(function(t){ return t.readyState === 'live'; });
    if(live) return live;
  }
  try{
    _fxStream = canvas.captureStream(30);
    _fxCanvas = canvas;
  }catch(_){ return null; }
  const t = _fxStream.getVideoTracks().find(function(x){ return x.readyState === 'live'; });
  if(t){
    try{ t.contentHint = 'motion'; }catch(_){}
  }
  return t || null;
}

function getCallOutboundVideoTrackSync(){
  const raw = (typeof stream !== 'undefined' && stream && stream.getVideoTracks)
    ? stream.getVideoTracks().find(function(t){ return t.readyState === 'live'; })
    : null;
  if(!raw) return null;
  const wantsFx = callOutboundWantsFilter();
  const wantsPortrait = nalunoOutboundPortrait();
  if((!wantsFx && !wantsPortrait) || (wantsFx && !nalunoSendCanvasAffordable() && !wantsPortrait)) return raw;
  try{ if(typeof drawSendCanvas === 'function') drawSendCanvas(true); }catch(_){}
  const fx = getOrCreateFxTrack();
  return fx || raw;
}

async function getCallOutboundVideoTrack(){
  const raw = (typeof stream !== 'undefined' && stream && stream.getVideoTracks)
    ? stream.getVideoTracks().find(function(t){ return t.readyState === 'live'; })
    : null;
  if(!raw) return null;
  if(!callOutboundWantsFilter() && !nalunoOutboundPortrait()) return raw;
  if(!callCanvasReady()){
    try{ await primeSendPreview(); }catch(_){}
  }
  const fx = getOrCreateFxTrack();
  return fx || raw;
}

/* Which picture a call sends (29d).
   The filter is decided before the call connects and then kept. The call
   starts on the filtered canvas when a filter is on, the canvas is already
   drawing, and this phone can draw it quickly enough; otherwise it starts on
   the raw camera and stays there. Switching from one to the other a moment
   after connecting (as before) made the other person's video jump: a new
   picture size, a fresh keyframe, a short freeze, a sudden change of look.
   Only a filter picked by hand during the call switches it. */
async function applyCallFilterNow(opts){
  const manual = !!(opts && opts.manual);
  if(typeof peerConnection === 'undefined' || !peerConnection) return;
  const sender = peerConnection.getSenders().find(function(s){
    return s.track && s.track.kind === 'video';
  });
  if(!sender) return;
  const raw = (typeof stream !== 'undefined' && stream && stream.getVideoTracks) ? stream.getVideoTracks().find(function(t){ return t.readyState === 'live'; }) : null;
  const onRaw = !!(raw && sender.track === raw);
  const wantsFx = (callOutboundWantsFilter() && nalunoSendCanvasAffordable()) || nalunoOutboundPortrait();
  if(!manual){
    // Automatic calls (the call screen opening, the connection coming up)
    // never change the picture that is already being sent.
    if(onRaw || !wantsFx) return;
  }
  window.__nalunoFxDraw = wantsFx;
  const next = wantsFx ? await getCallOutboundVideoTrack() : raw;
  if(!next || sender.track === next) return;
  // Never replace with a 2px / dead canvas — that is what hid remote video.
  if(next !== raw && !callCanvasReady()) return;
  try{ await sender.replaceTrack(next); }catch(e){
    console.warn('[call-filters] mid-call replace', e);
  }
}

/* The send canvas is redrawn for every frame the other person receives. On
   a phone that draws it slowly (no graphics acceleration, an old device)
   that is a choppy, late picture for them; the raw camera is sent instead. */
function nalunoSendCanvasAffordable(){
  try{
    const st = window.__nalunoSendCanvasCost;
    if(!st || st.n < 5) return true;   // not measured yet: assume a normal phone
    return st.avg <= 14;
  }catch(_){ return true; }
}

window.callOutboundWantsFilter = callOutboundWantsFilter;
window.nalunoOutboundPortrait = nalunoOutboundPortrait;
window.callCanvasReady = callCanvasReady;
window.getCallOutboundVideoTrack = getCallOutboundVideoTrack;
window.getCallOutboundVideoTrackSync = getCallOutboundVideoTrackSync;
window.applyCallFilterNow = applyCallFilterNow;
window.nalunoSendCanvasAffordable = nalunoSendCanvasAffordable;
window.primeSendPreview = primeSendPreview;
window.getOrCreateFxTrack = getOrCreateFxTrack;
