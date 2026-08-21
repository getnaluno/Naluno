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
  try{ if(typeof drawSendCanvas === 'function') drawSendCanvas(); }catch(_){}
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
  if(!callOutboundWantsFilter()) return raw;
  const fx = getOrCreateFxTrack();
  return fx || raw;
}

async function getCallOutboundVideoTrack(){
  const raw = (typeof stream !== 'undefined' && stream && stream.getVideoTracks)
    ? stream.getVideoTracks().find(function(t){ return t.readyState === 'live'; })
    : null;
  if(!raw) return null;
  if(!callOutboundWantsFilter()) return raw;
  if(!callCanvasReady()){
    try{ await primeSendPreview(); }catch(_){}
  }
  const fx = getOrCreateFxTrack();
  return fx || raw;
}

async function applyCallFilterNow(){
  if(typeof peerConnection === 'undefined' || !peerConnection) return;
  const sender = peerConnection.getSenders().find(function(s){
    return s.track && s.track.kind === 'video';
  });
  if(!sender) return;
  const next = await getCallOutboundVideoTrack();
  if(!next || sender.track === next) return;
  // Never replace with a 2px / dead canvas — that is what hid remote video.
  if(next !== (typeof stream !== 'undefined' && stream && stream.getVideoTracks && stream.getVideoTracks()[0])
     && !callCanvasReady()) return;
  try{ await sender.replaceTrack(next); }catch(e){
    console.warn('[call-filters] mid-call replace', e);
  }
}

window.callOutboundWantsFilter = callOutboundWantsFilter;
window.callCanvasReady = callCanvasReady;
window.getCallOutboundVideoTrack = getCallOutboundVideoTrack;
window.getCallOutboundVideoTrackSync = getCallOutboundVideoTrackSync;
window.applyCallFilterNow = applyCallFilterNow;
window.primeSendPreview = primeSendPreview;
window.getOrCreateFxTrack = getOrCreateFxTrack;
