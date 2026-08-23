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

function nalunoClipElement(el){
  try{
    if(!el) return false;
    if(el.classList && (el.classList.contains('native-controls') || el.classList.contains('naluno-clip'))) return true;
    if(el.dataset && (el.dataset.nativeControls === '1' || el.dataset.nalunoClip === '1')) return true;
    if(el.closest && el.closest('.naluno-clip, .spark-row, .band-voice-bubble')) return true;
  }catch(_){}
  return false;
}

function containMediaElement(el){
  if(!el) return;
  if(nalunoClipElement(el)) return;
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
      if(nalunoClipElement(el)) return;
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
    if(nalunoClipElement(el)) return;
    if(el.closest && el.closest('#callOverlay')) return;
    containMediaElement(el);
  });
}, 2000);

window.containMediaElement = containMediaElement;
window.lockOutChromeMediaSession = lockOutChromeMediaSession;
window.nalunoClipElement = nalunoClipElement;

function bindNalunoClips(root){
  const host = root || document;
  try{
    host.querySelectorAll('video.naluno-clip, audio.naluno-clip').forEach(function(el){
      if(el.dataset.clipBound === '1') return;
      el.dataset.clipBound = '1';
      try{ el.disableRemotePlayback = true; }catch(_){}
      const wrap = el.parentElement;
      const btn = wrap && wrap.querySelector && wrap.querySelector('.naluno-clip-play');
      const playIt = function(){
        document.querySelectorAll('video.naluno-clip, audio.naluno-clip').forEach(function(other){
          if(other !== el && !other.paused) try{ other.pause(); }catch(_){}
        });
        const p = el.play();
        if(p && p.catch){
          p.catch(function(){
            try{ el.muted = true; }catch(_){}
            el.play().then(function(){
              setTimeout(function(){ try{ el.muted = false; }catch(_){} }, 80);
            }).catch(function(){});
          });
        }
      };
      if(btn){
        btn.onclick = function(e){
          e.preventDefault();
          e.stopPropagation();
          if(el.paused) playIt();
          else el.pause();
        };
      }
      el.addEventListener('click', function(e){
        e.preventDefault();
        e.stopPropagation();
        if(el.paused) playIt();
        else el.pause();
      });
      el.addEventListener('playing', function(){ if(btn) btn.style.display = 'none'; });
      el.addEventListener('pause', function(){ if(btn && !el.ended) btn.style.display = ''; });
      el.addEventListener('ended', function(){ if(btn) btn.style.display = ''; });
    });
  }catch(_){}
}
window.bindNalunoClips = bindNalunoClips;
