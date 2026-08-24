/* ============================================================
   MODULE: js/media-contain.js
   Keep Broadcast / Signal / Band media INSIDE Naluno.
   Samsung + Chrome publish a shade Media card for any HTMLMediaElement
   that looks like a "session". We never set MediaMetadata.title, strip
   controls from in-app players, deny remote playback, and keep nulling
   the session while media runs. Calls are NOT paused on hide.
   ============================================================ */

function nalunoCallUiOpen(){
  try{
    const ov = document.getElementById('callOverlay');
    if(ov && ov.classList.contains('active')) return true;
  }catch(_){}
  try{ if(window.__nalunoCallActive) return true; }catch(_){}
  return false;
}

function containMediaElement(el){
  if(!el) return;
  // Intentional native controls (rare) — leave alone
  try{
    if(el.classList && el.classList.contains('native-controls')) return;
    if(el.dataset && el.dataset.nativeControls === '1') return;
  }catch(_){}
  try{ el.disableRemotePlayback = true; }catch(_){}
  try{ el.disablePictureInPicture = true; }catch(_){}
  try{ el.setAttribute('disablepictureinpicture', ''); }catch(_){}
  try{ el.setAttribute('x-webkit-airplay', 'deny'); }catch(_){}
  try{ el.setAttribute('playsinline', ''); }catch(_){}
  try{ el.setAttribute('webkit-playsinline', ''); }catch(_){}
  // Band voice used to set controls=true which publishes the shade player.
  // Custom UI is preferred; strip native controls for containment.
  try{ el.removeAttribute('controls'); }catch(_){}
  try{ el.controls = false; }catch(_){}
}

function lockOutChromeMediaSession(){
  if(!navigator.mediaSession) return;
  try{ navigator.mediaSession.metadata = null; }catch(_){}
  try{ navigator.mediaSession.playbackState = 'none'; }catch(_){}
  try{
    if(typeof navigator.mediaSession.setPositionState === 'function'){
      // Empty position state prevents the scrubber shade on some Samsung builds
      navigator.mediaSession.setPositionState({ duration: 0, playbackRate: 1, position: 0 });
    }
  }catch(_){
    try{ navigator.mediaSession.setPositionState(undefined); }catch(_2){}
  }
  ['play','pause','seekbackward','seekforward','seekto','previoustrack','nexttrack','stop'].forEach(function(a){
    try{ navigator.mediaSession.setActionHandler(a, null); }catch(_){}
    try{
      navigator.mediaSession.setActionHandler(a, function(){
        // Swallow shade controls — media lives only inside the app
      });
    }catch(_){}
  });
}

function pauseAppMediaForBackground(){
  if(nalunoCallUiOpen()) return;
  document.querySelectorAll('video, audio').forEach(function(el){
    try{
      if(el.closest && el.closest('#callOverlay')) return;
      if(el.classList && el.classList.contains('native-controls')) return;
      if(el.dataset && el.dataset.nativeControls === '1') return;
      if(el.paused) return;
      el.dataset.nalunoPausedHide = '1';
      el.pause();
    }catch(_){}
  });
  lockOutChromeMediaSession();
}

function resumeAppMediaAfterForeground(){
  document.querySelectorAll('video, audio').forEach(function(el){
    try{
      if(el.dataset && el.dataset.nalunoPausedHide === '1'){
        delete el.dataset.nalunoPausedHide;
      }
    }catch(_){}
  });
  lockOutChromeMediaSession();
}

function hookMediaContainment(){
  lockOutChromeMediaSession();
  document.querySelectorAll('video, audio').forEach(containMediaElement);
}

document.addEventListener('play', function(e){
  const el = e.target;
  if(!el || (el.tagName !== 'VIDEO' && el.tagName !== 'AUDIO')) return;
  if(el.closest && el.closest('#callOverlay')) return;
  containMediaElement(el);
  lockOutChromeMediaSession();
  setTimeout(lockOutChromeMediaSession, 30);
  setTimeout(lockOutChromeMediaSession, 200);
  setTimeout(lockOutChromeMediaSession, 800);
  setTimeout(lockOutChromeMediaSession, 2000);
}, true);

document.addEventListener('playing', function(e){
  const el = e.target;
  if(!el || (el.tagName !== 'VIDEO' && el.tagName !== 'AUDIO')) return;
  if(el.closest && el.closest('#callOverlay')) return;
  containMediaElement(el);
  lockOutChromeMediaSession();
}, true);

document.addEventListener('pause', function(e){
  const el = e.target;
  if(el && el.closest && el.closest('#callOverlay')) return;
  lockOutChromeMediaSession();
}, true);

document.addEventListener('visibilitychange', function(){
  if(document.hidden) pauseAppMediaForBackground();
  else resumeAppMediaAfterForeground();
});
window.addEventListener('pagehide', pauseAppMediaForBackground);
window.addEventListener('freeze', pauseAppMediaForBackground);

if(document.readyState === 'loading'){
  document.addEventListener('DOMContentLoaded', hookMediaContainment);
} else {
  hookMediaContainment();
}

setInterval(function(){
  lockOutChromeMediaSession();
  // Re-contain any element that re-gained controls
  document.querySelectorAll('video[controls], audio[controls]').forEach(function(el){
    if(el.classList && el.classList.contains('native-controls')) return;
    if(el.dataset && el.dataset.nativeControls === '1') return;
    if(el.closest && el.closest('#callOverlay')) return;
    containMediaElement(el);
  });
}, 2000);

window.containMediaElement = containMediaElement;
window.lockOutChromeMediaSession = lockOutChromeMediaSession;
