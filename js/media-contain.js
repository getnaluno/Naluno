/* ============================================================
   MODULE: js/media-contain.js
   Keep Broadcast / Signal / Band media INSIDE Naluno.
   Samsung + Chrome publish a shade Media card for any HTMLMediaElement
   that looks like a "session". We never set MediaMetadata.title, strip
   controls from in-app players, deny remote playback, and keep nulling
   the session while media runs. Calls are NOT paused on hide.
   ============================================================ */

/** Shared by nalunoCorrectVideoOrientation() below — a Set of currently
 *  live-tracked video elements, so orientation changes are handled by one
 *  window-level listener instead of accumulating one per element. */
const nalunoOrientWatchedEls = new Set();

/** FIX ("box is 9:16 but the camera is still landscape", and "feels mirrored
 *  — head left goes right"): this function had two real, separate bugs,
 *  found on a second, skeptical read rather than assumed fixed.
 *
 *  Bug 1 (why it could still look landscape/wrong after the first fix):
 *  the pre-rotation box was sized using the camera's CAPTURE resolution
 *  (track.getSettings().width/height — e.g. 1280x720, or up to 3840x2160 at
 *  the "4k" quality tier) as literal CSS PIXEL dimensions on the video
 *  element. A phone's actual CSS viewport is typically only ~360-430px
 *  wide. Setting width:720px (or worse, width:2160px) inside a ~390px-wide
 *  container doesn't just look wrong, it's massively oversized — only a
 *  small, arbitrarily zoomed-in slice of the corrected video would ever be
 *  visible at all, which would look "still wrong" regardless of whether the
 *  rotation direction itself was right. Fixed to size the pre-rotation box
 *  from the CONTAINER's actual on-screen CSS pixel dimensions
 *  (clientWidth/clientHeight), which is what every standard reference for
 *  this exact CSS pattern (rotate a video 90° to fill a container) actually
 *  uses — capture resolution and CSS layout size are unrelated numbers.
 *
 *  Bug 2 (the mirroring): there was no mirroring logic here at all. A front
 *  camera's self-view is a universal UX convention — mirrored, like a real
 *  mirror, so moving your head left appears to move left on screen. Without
 *  it, a front camera shows the "camera's-eye" view instead, which is
 *  exactly backwards from what anyone expects looking at themselves. Only
 *  applies to isLocalSelfView (the broadcaster's own preview) — a VIEWER
 *  watching someone else's stream should NOT have it mirrored; they should
 *  see the broadcaster the way everyone else does, same as any video call.
 *
 *  Honest uncertainty, stated rather than hidden: the exact rotation
 *  direction (90deg vs -90deg) genuinely varies by device/OS/browser
 *  combination for this exact class of bug, and could not be confirmed
 *  against a real device from here. ROTATE_DEG below is the one thing to
 *  flip (90 to -90, or back) if the correction is now rotating the wrong
 *  way on a specific device — everything else in this function does not
 *  depend on getting that sign right. */
const NALUNO_ROTATE_DEG = 90;
function nalunoCorrectVideoOrientation(videoEl, stream, isLocalSelfView){
  if(!videoEl || !stream) return;
  const track = stream.getVideoTracks && stream.getVideoTracks()[0];
  if(!track) return;
  const isFrontCamera = (function(){
    try{
      const fm = track.getSettings && track.getSettings().facingMode;
      if(fm) return fm === 'user' || fm === 'face';
    }catch(_){}
    return true; // Broadcast-live only ever requests facingMode:'user' — safe default
  })();
  const apply = function(){
    try{
      const settings = (track.getSettings && track.getSettings()) || {};
      let w = settings.width || videoEl.videoWidth || 0;
      let h = settings.height || videoEl.videoHeight || 0;
      if(!w || !h) return;
      const deviceIsPortrait = (typeof nalunoIsPortraitDevice === 'function') ? nalunoIsPortraitDevice() : (window.innerHeight >= window.innerWidth);
      const streamIsLandscape = w > h;
      const wantMirror = !!(isLocalSelfView && isFrontCamera);
      const parent = videoEl.parentElement;
      if(deviceIsPortrait && streamIsLandscape && parent){
        const cw = parent.clientWidth, ch = parent.clientHeight;
        if(!cw || !ch){
          // Container not laid out yet (can genuinely happen right when a
          // fresh video element's metadata fires, before layout catches up)
          // — retry shortly instead of silently giving up on the correction
          // for good, since nothing else would ever call apply() again
          // until an actual device rotation.
          if(!videoEl.__nalunoOrientRetries) videoEl.__nalunoOrientRetries = 0;
          if(videoEl.__nalunoOrientRetries < 10){
            videoEl.__nalunoOrientRetries++;
            setTimeout(apply, 150);
          }
          return;
        }
        videoEl.style.position = 'absolute';
        videoEl.style.top = '50%';
        videoEl.style.left = '50%';
        // Pre-rotation box uses the CONTAINER's real dimensions, swapped —
        // NOT the camera's capture resolution — so after rotating 90° it
        // exactly fills the actual portrait container on screen.
        videoEl.style.width = ch + 'px';
        videoEl.style.height = cw + 'px';
        videoEl.style.maxWidth = 'none';
        videoEl.style.maxHeight = 'none';
        videoEl.style.objectFit = 'cover';
        videoEl.style.transform = 'translate(-50%, -50%) rotate(' + NALUNO_ROTATE_DEG + 'deg)' + (wantMirror ? ' scaleX(-1)' : '');
        videoEl.style.transformOrigin = 'center center';
        videoEl.dataset.nalunoOrientCorrected = '1';
      } else if(videoEl.dataset.nalunoOrientCorrected === '1'){
        // Stream/orientation changed back to matching — undo the correction.
        videoEl.style.position = '';
        videoEl.style.top = '';
        videoEl.style.left = '';
        videoEl.style.width = '100%';
        videoEl.style.height = '100%';
        videoEl.style.maxWidth = '';
        videoEl.style.maxHeight = '';
        videoEl.style.transform = wantMirror ? 'scaleX(-1)' : '';
        delete videoEl.dataset.nalunoOrientCorrected;
      } else if(wantMirror && videoEl.style.transform !== 'scaleX(-1)'){
        // Not landscape-mismatched, but still needs the plain self-view
        // mirror (the far more common case — most devices already deliver
        // correctly-oriented portrait frames; almost every front-camera
        // preview needs mirroring regardless of whether rotation-correction
        // was ever needed at all).
        videoEl.style.transform = 'scaleX(-1)';
        delete videoEl.dataset.nalunoOrientCorrected;
      }
    }catch(_){}
  };
  if(track.getSettings && track.getSettings().width){
    apply();
  } else {
    videoEl.addEventListener('loadedmetadata', apply, { once: true });
  }
  // FIX (found in adversarial review): binding a fresh window-level
  // orientationchange listener per video element meant every leave/rejoin
  // cycle on a live broadcast left the PREVIOUS element's listener still
  // registered on window forever — a slow leak over a session with many
  // join/leave cycles, since window never releases it and the closure keeps
  // the detached video element alive too. One shared listener, re-resolving
  // whichever elements are actually live right now, instead of one per call.
  nalunoOrientWatchedEls.add(videoEl);
  if(!window.__nalunoOrientListenerBound){
    window.__nalunoOrientListenerBound = true;
    window.addEventListener('orientationchange', function(){
      setTimeout(function(){
        nalunoOrientWatchedEls.forEach(function(el){
          if(!el.isConnected){ nalunoOrientWatchedEls.delete(el); return; }
          try{ if(typeof el.__nalunoOrientReapply === 'function') el.__nalunoOrientReapply(); }catch(_){}
        });
      }, 200);
    });
  }
  videoEl.__nalunoOrientReapply = apply;
}

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
    if(el.closest && el.closest('.naluno-clip, .spark-row, .band-voice-bubble, .band-audio-player')) return true;
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

function nalunoAnyAppMediaPlaying(){
  try{
    const els = document.querySelectorAll('video, audio');
    for(let i = 0; i < els.length; i++){
      const el = els[i];
      if(el.closest && el.closest('#callOverlay')) continue;
      if(!el.paused && !el.ended) return true;
    }
  }catch(_){}
  return false;
}

/** LOCK (20260825c): Chrome / One UI must NEVER own Naluno media.
 *  - Always null metadata (no title/artist → no shade card content).
 *  - Action handlers are no-ops so shade play/pause cannot drive a second stream.
 *  - When nothing in-app is playing, force playbackState='none' so the OS card dies.
 *  - While playing we still avoid playbackState='none' (Samsung treats that as pause
 *    and was the Signal "loads but never plays" bug) — but we never publish metadata.
 */
function lockOutChromeMediaSession(){
  if(!navigator.mediaSession) return;
  try{ navigator.mediaSession.metadata = null; }catch(_){}
  try{
    // Empty metadata is still better than a branded NALUNO card if null is ignored.
    if(typeof MediaMetadata !== 'undefined'){
      navigator.mediaSession.metadata = new MediaMetadata({ title: '', artist: '', album: '', artwork: [] });
      navigator.mediaSession.metadata = null;
    }
  }catch(_){}
  const playing = nalunoAnyAppMediaPlaying();
  if(!playing){
    try{ navigator.mediaSession.playbackState = 'none'; }catch(_){}
    try{
      if(typeof navigator.mediaSession.setPositionState === 'function'){
        navigator.mediaSession.setPositionState({ duration: 0, playbackRate: 1, position: 0 });
      }
    }catch(_){
      try{ navigator.mediaSession.setPositionState(undefined); }catch(_2){}
    }
  }
  // Shade controls must not start a parallel play path outside Naluno UI.
  ['play','pause','seekbackward','seekforward','seekto','previoustrack','nexttrack','stop'].forEach(function(a){
    try{ navigator.mediaSession.setActionHandler(a, null); }catch(_){}
    try{
      navigator.mediaSession.setActionHandler(a, function(){
        // Explicit no-op: media lives only in Naluno chrome.
      });
    }catch(_){}
  });
}

/** Pause every non-call media element and kill the OS media session card. */
function stopAllAppMediaAndLockSession(){
  try{
    document.querySelectorAll('video, audio').forEach(function(el){
      try{
        if(el.closest && el.closest('#callOverlay')) return;
        if(nalunoClipElement(el)) return;
        el.dataset.nalunoWantPlay = '0';
        el.dataset.nalunoUserPaused = '1';
        delete el.dataset.nalunoKeepAlive;
        el.pause();
      }catch(_){}
    });
  }catch(_){}
  lockOutChromeMediaSession();
  try{ if(navigator.mediaSession) navigator.mediaSession.playbackState = 'none'; }catch(_){}
}
window.stopAllAppMediaAndLockSession = stopAllAppMediaAndLockSession;
window.lockOutChromeMediaSession = lockOutChromeMediaSession;

/* LOCK: Broadcast/Signal must not die after a brief Android hide.
   Notification shade, task switch, and freeze used to pause every
   <video> and never call play() again — that was "stops after sometime".
   Debounce the pause; on return, actually resume anything that still
   wants to play (nalunoWantPlay / nalunoKeepAlive). */
let nalunoPauseHideTimer = null;

function pauseAppMediaForBackground(){
  if(nalunoCallUiOpen()) return;
  if(nalunoPauseHideTimer){ try{ clearTimeout(nalunoPauseHideTimer); }catch(_){} }
  nalunoPauseHideTimer = setTimeout(function(){
    nalunoPauseHideTimer = null;
    try{ if(!document.hidden) return; }catch(_){}
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
  }, 700);
}

function resumeAppMediaAfterForeground(){
  if(nalunoPauseHideTimer){
    try{ clearTimeout(nalunoPauseHideTimer); }catch(_){}
    nalunoPauseHideTimer = null;
  }
  document.querySelectorAll('video, audio').forEach(function(el){
    try{
      if(!(el.dataset && el.dataset.nalunoPausedHide === '1')) return;
      delete el.dataset.nalunoPausedHide;
      // Resume only if this element still wants to play (user did not pause it).
      const want = el.dataset.nalunoWantPlay === '1' || el.dataset.nalunoKeepAlive === '1';
      if(!want) return;
      if(el.ended) return;
      const p = el.play();
      if(p && p.catch) p.catch(function(){});
    }catch(_){}
  });
  lockOutChromeMediaSession();
}

/** Watchdog: if a keep-alive player is paused while the tab is visible,
 *  kick it. Never touches user-paused media (nalunoWantPlay !== '1'). */
function nalunoKeepAliveWatch(){
  try{
    if(document.hidden) return;
    if(nalunoCallUiOpen()) return;
    document.querySelectorAll('video[data-naluno-want-play="1"], video[data-naluno-keep-alive="1"]').forEach(function(el){
      try{
        if(el.dataset.nalunoWantPlay === '0') return;
        if(el.ended) return;
        if(el.closest && el.closest('#callOverlay')) return;
        if(!el.paused) return;
        // User explicitly paused → kick button is visible; leave it.
        if(el.dataset.nalunoUserPaused === '1') return;
        const p = el.play();
        if(p && p.catch) p.catch(function(){});
      }catch(_){}
    });
  }catch(_){}
}
window.nalunoKeepAliveWatch = nalunoKeepAliveWatch;

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
  // User paused inside Naluno → kill the OS media card so Chrome cannot keep playing.
  lockOutChromeMediaSession();
  setTimeout(lockOutChromeMediaSession, 40);
  setTimeout(lockOutChromeMediaSession, 300);
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
  try{ nalunoKeepAliveWatch(); }catch(_){}
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
