/* ============================================================
   MODULE: js/call-filters.js
   Outbound call video: either the live camera or the same
   Naluno filter canvas the local preview uses.
   OWNERSHIP: which track goes into RTCPeerConnection.
   Do not replaceTrack after connect unless the person
   changes filter mid-call — late swap is what hid video.
   ============================================================ */

function callOutboundWantsFilter(){
  try{
    if(typeof greenroomEnabled !== 'undefined' && !greenroomEnabled) return false;
    const id = (typeof selectedFilterId !== 'undefined') ? selectedFilterId : 'original';
    if(!id || id === 'none' || id === 'original') return false;
    return !!(typeof nalunoFilters !== 'undefined' && nalunoFilters[id]);
  }catch(_){ return false; }
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
    setTimeout(function(){ finish(video.readyState >= 2 && video.videoWidth); }, ms || 900);
  });
}

async function primeSendPreview(){
  const video = $('sendRawVideo');
  const canvas = $('sendCanvas');
  if(!video || !canvas || !stream) return false;
  video.muted = true;
  video.setAttribute('playsinline', '');
  video.setAttribute('webkit-playsinline', '');
  if(video.srcObject !== stream) video.srcObject = stream;
  try{ await video.play(); }catch(_){}
  await waitForVideoFrame(video, 900);
  try{ if(typeof drawSendCanvas === 'function') drawSendCanvas(); }catch(_){}
  return !!(video.videoWidth && canvas.width);
}

async function getCallOutboundVideoTrack(){
  const raw = stream && stream.getVideoTracks && stream.getVideoTracks().find(function(t){
    return t.readyState === 'live';
  });
  if(!raw) return null;
  if(!callOutboundWantsFilter()) return raw;
  const ok = await primeSendPreview();
  const canvas = $('sendCanvas');
  if(!ok || !canvas || typeof canvas.captureStream !== 'function') return raw;
  let fx = null;
  try{ fx = canvas.captureStream(24); }catch(_){ return raw; }
  const t = fx && fx.getVideoTracks && fx.getVideoTracks().find(function(x){ return x.readyState === 'live'; });
  if(!t) return raw;
  try{ t.contentHint = 'motion'; }catch(_){}
  return t;
}

async function applyCallFilterNow(){
  if(!peerConnection) return;
  const sender = peerConnection.getSenders().find(function(s){ return s.track && s.track.kind === 'video'; });
  if(!sender) return;
  const next = await getCallOutboundVideoTrack();
  if(!next || sender.track === next) return;
  try{ await sender.replaceTrack(next); }catch(e){
    console.warn('[call-filters] mid-call replace', e);
  }
}

window.callOutboundWantsFilter = callOutboundWantsFilter;
window.getCallOutboundVideoTrack = getCallOutboundVideoTrack;
window.applyCallFilterNow = applyCallFilterNow;
window.primeSendPreview = primeSendPreview;
