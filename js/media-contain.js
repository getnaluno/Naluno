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
  try{
    navigator.mediaSession.metadata = new MediaMetadata({
      title: 'Naluno',
      artist: '',
      album: '',
      artwork: [],
    });
  }catch(_){
    try{ navigator.mediaSession.metadata = null; }catch(_2){}
  }
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
});
window.addEventListener('pagehide', pauseAppMediaForBackground);
window.addEventListener('freeze', pauseAppMediaForBackground);

if(document.readyState === 'loading'){
  document.addEventListener('DOMContentLoaded', hookMediaContainment);
} else {
  hookMediaContainment();
}

setInterval(lockOutChromeMediaSession, 4000);
