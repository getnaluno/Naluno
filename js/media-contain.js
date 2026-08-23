/* ============================================================
   MODULE: js/media-contain.js
   Broadcast / Signal / Band recordings stay INSIDE Naluno.
   Chrome Android otherwise publishes a system Media notification
   ("NALUNO · getnaluno.com") and audio keeps playing in the shade.
   Calls are not paused on hide — they keep their own path.
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
  if(el.hasAttribute('controls') || el.getAttribute('data-naluno-native-controls') != null) return;
  try{ el.disableRemotePlayback = true; }catch(_){}
  try{ el.disablePictureInPicture = true; }catch(_){}
  try{ el.setAttribute('disablepictureinpicture', ''); }catch(_){}
  try{ el.setAttribute('playsinline', ''); }catch(_){}
  try{ el.setAttribute('webkit-playsinline', ''); }catch(_){}
  try{ el.removeAttribute('controls'); }catch(_){}
  try{ el.controls = false; }catch(_){}
}

function lockOutChromeMediaSession(){
  if(!navigator.mediaSession) return;
  // NEVER publish titled metadata — that is what opens Chrome's shade player
  // and double-plays with Naluno. Keep the session empty even while video plays.
  try{ navigator.mediaSession.metadata = null; }catch(_){}
  try{ navigator.mediaSession.playbackState = 'none'; }catch(_){}
  ['play','pause','seekbackward','seekforward','seekto','previoustrack','nexttrack','stop'].forEach(function(a){
    try{ navigator.mediaSession.setActionHandler(a, function(){}); }catch(_){}
  });
}

function pauseAppMediaForBackground(){
  if(nalunoCallUiOpen()) return;
  document.querySelectorAll('video, audio').forEach(function(el){
    try{
      if(el.closest && el.closest('#callOverlay')) return;
      if(el.paused) return;
      el.dataset.nalunoPausedHide = '1';
      el.pause();
    }catch(_){}
  });
  lockOutChromeMediaSession();
}

function resumeAppMediaFromBackground(){
  lockOutChromeMediaSession();
  document.querySelectorAll('video[data-naluno-paused-hide], audio[data-naluno-paused-hide]').forEach(function(el){
    try{
      delete el.dataset.nalunoPausedHide;
      // Only resume if the overlay that owns it is still open.
      const inViewer = el.id === 'bviewerActiveVideo' && document.getElementById('bviewer') && document.getElementById('bviewer').classList.contains('active');
      const inSpace = el.id === 'bspaceVideoEl' && document.getElementById('bspace') && document.getElementById('bspace').classList.contains('active');
      if(!inViewer && !inSpace) return;
      const p = el.play();
      if(p && p.catch) p.catch(function(){});
    }catch(_){}
  });
}

function hookMediaContainment(){
  lockOutChromeMediaSession();
  document.querySelectorAll('video, audio').forEach(containMediaElement);
}

document.addEventListener('play', function(e){
  const el = e.target;
  if(!el || (el.tagName !== 'VIDEO' && el.tagName !== 'AUDIO')) return;
  containMediaElement(el);
  lockOutChromeMediaSession();
}, true);

document.addEventListener('visibilitychange', function(){
  if(document.hidden) pauseAppMediaForBackground();
  else resumeAppMediaFromBackground();
});
window.addEventListener('pagehide', pauseAppMediaForBackground);
window.addEventListener('freeze', pauseAppMediaForBackground);
window.addEventListener('pageshow', resumeAppMediaFromBackground);

if(document.readyState === 'loading'){
  document.addEventListener('DOMContentLoaded', hookMediaContainment);
} else {
  hookMediaContainment();
}

setInterval(lockOutChromeMediaSession, 2500);
