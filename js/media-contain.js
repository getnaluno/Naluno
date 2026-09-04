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

function nalunoActiveViewerContains(el){
  try{
    const bv = document.getElementById('bviewer');
    if(bv && bv.classList.contains('active') && el && bv.contains(el)) return true;
    const bs = document.getElementById('bspace');
    if(bs && bs.classList.contains('active') && el && bs.contains(el)) return true;
  }catch(_){}
  return false;
}

function nalunoMediaMayKeepAlive(el){
  if(!el) return false;
  try{
    if(el.dataset && el.dataset.nalunoWantPlay === '0') return false;
    if(el.dataset && el.dataset.nalunoUserPaused === '1') return false;
    if(nalunoActiveViewerContains(el)) return true;
    if(el.dataset && el.dataset.nalunoPreview === '1'){
      const tab = document.getElementById('tab-broadcast');
      if(tab && tab.classList.contains('active') && el.__nalunoOn) return true;
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
      if(!nalunoMediaMayKeepAlive(el)) continue;
      return true;
    }
  }catch(_){}
  return false;
}

/** Pause feed/preview players that are no longer on screen. Does not clear src
 *  (unlike stopAllAppMediaAndLockSession) so coming back can resume. */
function nalunoPauseDetachedMedia(){
  try{
    const onBroadcast = !!(document.getElementById('tab-broadcast') && document.getElementById('tab-broadcast').classList.contains('active'));
    const bspaceOpen = !!(document.getElementById('bspace') && document.getElementById('bspace').classList.contains('active'));
    document.querySelectorAll('video, audio').forEach(function(el){
      try{
        if(typeof nalunoLiveOrCameraEl === 'function' && nalunoLiveOrCameraEl(el)) return;
        if(el.closest && el.closest('#callOverlay')) return;
        if(typeof nalunoClipElement === 'function' && nalunoClipElement(el)) return;
        if(nalunoActiveViewerContains(el)) return;
        if(el.dataset && el.dataset.nalunoPreview === '1' && onBroadcast && el.__nalunoOn) return;
        try{ if(!el.paused) el.dataset.nalunoPauseAt = String(el.currentTime || 0); }catch(_){}
        el.dataset.nalunoWantPlay = '0';
        delete el.dataset.nalunoKeepAlive;
        try{ el.pause(); }catch(_){}
        if(!bspaceOpen && el.closest && el.closest('#bspace')){
          try{
            if(el.src && !el.dataset.nalunoPrevSrc) el.dataset.nalunoPrevSrc = el.src;
            el.removeAttribute('src');
            el.srcObject = null;
            el.load();
          }catch(_){}
        }
      }catch(_){}
    });
    if(!onBroadcast && typeof pauseAllStrandPreviews === 'function') pauseAllStrandPreviews();
  }catch(_){}
  try{ lockOutChromeMediaSession(); }catch(_){}
}
window.nalunoPauseDetachedMedia = nalunoPauseDetachedMedia;
window.nalunoMediaMayKeepAlive = nalunoMediaMayKeepAlive;

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
  }
  // FIX (the shade card that kept appearing): this used to clear each action
  // handler to null and then immediately RE-REGISTER a no-op function on the
  // same action. Registering ANY handler — even an empty one — is precisely
  // how a page tells Chrome "I support this control", so Chrome responded by
  // rendering the media card WITH previous/pause/next buttons and keeping it
  // alive. The intent was "make the shade buttons do nothing"; the actual
  // effect was "advertise that these buttons exist". Clearing to null and
  // stopping there is what actually removes them.
  ['play','pause','seekbackward','seekforward','seekto','previoustrack','nexttrack','stop'].forEach(function(a){
    try{ navigator.mediaSession.setActionHandler(a, null); }catch(_){}
  });
  // Position state is what draws the scrubber on that card. Clearing it
  // unconditionally (not only when paused, as before) means there's no
  // progress bar to render even while media is genuinely playing in-app.
  try{
    if(typeof navigator.mediaSession.setPositionState === 'function'){
      navigator.mediaSession.setPositionState(null);
    }
  }catch(_){
    try{ navigator.mediaSession.setPositionState({ duration: 0, playbackRate: 1, position: 0 }); }catch(_2){}
  }
}

function nalunoLiveOrCameraEl(el){
  try{
    if(!el) return false;
    if(el.srcObject) return true;
    if(el.id === 'bspaceViewerLiveVideo' || el.id === 'bspaceLiveVideo') return true;
    if(el.id === 'bviewerActiveVideo') return false;
    if(el.closest && (
      el.closest('#callOverlay') ||
      el.closest('#composer') ||
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
        // CORRECTION (I previously claimed clearing the mediaSession action
        // handlers would remove Chrome's media card — that was wrong, and
        // this is the actual mechanism). Chrome's own docs: a media
        // notification is created AUTOMATICALLY for any audible media of 5s
        // or more, and when no MediaMetadata is set the browser falls back
        // to "the document's title and the largest icon image it can find"
        // — which is precisely why the card read "NALUNO / getnaluno.com".
        // Nulling metadata never removed the card; it only chose what the
        // card displayed. Chrome documents exactly one way to dismiss it:
        // clear the element's src. Doing that here, on the genuine
        // "we're finished with this media" path only (never mid-playback,
        // never for calls or the live camera, both already excluded above),
        // so the notification actually goes away instead of lingering.
        // The src is stashed first so anything that re-shows this element
        // can restore it rather than finding an empty player.
        if(el.src && !el.dataset.nalunoPrevSrc){
          el.dataset.nalunoPrevSrc = el.src;
        }
        try{
          el.removeAttribute('src');
          el.srcObject = null;
          el.load();
        }catch(_){}
      }catch(_){}
    });
  }catch(_){}
  lockOutChromeMediaSession();
  try{ if(navigator.mediaSession) navigator.mediaSession.playbackState = 'none'; }catch(_){}
}
/** Restore a src cleared by stopAllAppMediaAndLockSession() so re-opening a
 *  player doesn't find an empty element. */
function nalunoRestoreClearedSrc(el){
  try{
    if(el && el.dataset && el.dataset.nalunoPrevSrc && !el.src){
      el.src = el.dataset.nalunoPrevSrc;
      delete el.dataset.nalunoPrevSrc;
      try{ el.load(); }catch(_){}
    }
  }catch(_){}
}
window.nalunoRestoreClearedSrc = nalunoRestoreClearedSrc;
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
        if(typeof nalunoLiveOrCameraEl === 'function' && nalunoLiveOrCameraEl(el)) return;
        if(el.srcObject) return;
        if(el.paused) return;
        try{ el.dataset.nalunoPauseAt = String(el.currentTime || 0); }catch(_){}
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
      const want = nalunoMediaMayKeepAlive(el);
      if(!want) return;
      if(el.ended) return;
      try{
        const at = parseFloat(el.dataset.nalunoPauseAt);
        if(isFinite(at) && Math.abs((el.currentTime || 0) - at) > 1.2){
          el.currentTime = at;
        }
      }catch(_){}
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
        if(!nalunoMediaMayKeepAlive(el)){
          if(el.dataset) el.dataset.nalunoWantPlay = '0';
          try{ el.pause(); }catch(_){}
          return;
        }
        if(el.ended) return;
        if(el.closest && el.closest('#callOverlay')) return;
        if(!el.paused) return;
        if((el.readyState || 0) < 3) return;
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
