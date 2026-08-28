/* ============================================================
   MODULE: js/media-contain.js
   Keep Broadcast / Signal / Band media INSIDE Naluno.
   Samsung + Chrome publish a shade Media card for any HTMLMediaElement
   that looks like a "session". We never set MediaMetadata.title, strip
   controls from in-app players, deny remote playback, and keep nulling
   the session while media runs. Calls are NOT paused on hide.
   ============================================================ */

/** REVERTED ("live camera reads sideways — make it like Calls"): the
 *  previous two rounds of this function tried to manually detect and
 *  correct a supposed landscape/portrait mismatch by rotating the video
 *  element with CSS. Checked directly against Calls' own self-view video
 *  (`#incomingSelfVideo` in index.html), which has never had this
 *  complaint: its entire style is `width:100%;height:100%;object-fit:cover;
 *  transform:scaleX(-1);` — nothing else. No rotation, no capture-resolution
 *  math, no width/height swapping. That's proof the browser on this device
 *  already applies the camera's orientation metadata correctly on its own
 *  — the manual "correction" here was based on a false premise, and was
 *  actively rotating video that would otherwise have displayed correctly
 *  by itself, which is exactly the sideways face in the report. Rebuilt to
 *  do exactly what Calls does and nothing more: fill the container,
 *  `object-fit: cover`, and mirror only the broadcaster's own front-camera
 *  self-view — never a viewer's received stream, same as before. */
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
  const wantMirror = !!(isLocalSelfView && isFrontCamera);
  videoEl.style.width = '100%';
  videoEl.style.height = '100%';
  videoEl.style.objectFit = 'cover';
  videoEl.style.transform = wantMirror ? 'scaleX(-1)' : '';
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
      if(el.dataset && el.dataset.nalunoPreview === '1') continue;
      if(!el.paused && !el.ended) return true;
    }
  }catch(_){}
  return false;
}

function nalunoViewerWantsMedia(){
  try{
    const bv = document.getElementById('bviewer');
    if(bv && bv.classList.contains('active')) return true;
    const bs = document.getElementById('bspace');
    if(bs && bs.classList.contains('active')) return true;
  }catch(_){}
  try{
    const els = document.querySelectorAll('video[data-naluno-want-play="1"], video[data-naluno-keep-alive="1"]');
    for(let i = 0; i < els.length; i++){
      const el = els[i];
      if(el.dataset && el.dataset.nalunoWantPlay === '0') continue;
      if(el.dataset && el.dataset.nalunoUserPaused === '1') continue;
      return true;
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
 *  28l: also treat an open Signal story / Broadcast space as "playing" so the
 *  2s lock timer cannot pause a clip that is still buffering.
 */
function lockOutChromeMediaSession(){
  if(!navigator.mediaSession) return;
  try{ navigator.mediaSession.metadata = null; }catch(_){}
  try{
    if(typeof MediaMetadata !== 'undefined'){
      navigator.mediaSession.metadata = new MediaMetadata({ title: '', artist: '', album: '', artwork: [] });
      navigator.mediaSession.metadata = null;
    }
  }catch(_){}
  const playing = nalunoAnyAppMediaPlaying() || nalunoViewerWantsMedia();
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
  ['play','pause','seekbackward','seekforward','seekto','previoustrack','nexttrack','stop'].forEach(function(a){
    try{ navigator.mediaSession.setActionHandler(a, null); }catch(_){}
    try{
      navigator.mediaSession.setActionHandler(a, function(){});
    }catch(_){}
  });
}

function nalunoLiveOrCameraEl(el){
  try{
    if(!el) return false;
    if(el.srcObject) return true;
    if(el.id === 'bspaceViewerLiveVideo') return true;
    if(el.closest && (
      el.closest('#callOverlay') ||
      el.closest('#bcomposer') ||
      el.closest('#camStage') ||
      el.closest('#adjustStage')
    )) return true;
  }catch(_){}
  return false;
}

/** Pause every non-call media element and kill the OS media session card. */
function stopAllAppMediaAndLockSession(){
  try{
    document.querySelectorAll('video, audio').forEach(function(el){
      try{
        if(nalunoLiveOrCameraEl(el)) return;
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

/** Only one Naluno surface may play. Keep `keepEl` running; pause the rest. */
function nalunoExclusiveMedia(keepEl){
  try{
    document.querySelectorAll('video, audio').forEach(function(el){
      try{
        if(keepEl && el === keepEl) return;
        if(nalunoLiveOrCameraEl(el)) return;
        if(el.closest && el.closest('#callOverlay')) return;
        if(nalunoClipElement(el)) return;
        el.dataset.nalunoWantPlay = '0';
        delete el.dataset.nalunoKeepAlive;
        if(el.dataset && el.dataset.nalunoPreview === '1'){
          try{ el.pause(); }catch(_){}
          return;
        }
        el.dataset.nalunoUserPaused = '1';
        el.pause();
      }catch(_){}
    });
  }catch(_){}
  try{
    if(typeof pauseAllStrandPreviews === 'function' && !(keepEl && keepEl.dataset && keepEl.dataset.nalunoPreview === '1')){
      pauseAllStrandPreviews();
    }
  }catch(_){}
  lockOutChromeMediaSession();
}
window.nalunoExclusiveMedia = nalunoExclusiveMedia;

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
