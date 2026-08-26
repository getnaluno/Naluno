/* ============================================================
   MODULE: js/keep-alive.js
   Keep uploads + offline queues alive when the screen sleeps or
   the app is backgrounded (not force-killed).
   Android 13+ WebView pauses JS timers unless a foreground service
   holds a wake lock — see UploadKeepAliveService.java.
   ============================================================ */
let nalunoWakeLock = null;
let nalunoKeepAliveDepth = 0;
let nalunoLastOnlineAt = Date.now();
let nalunoLastOfflineAt = 0;

function nalunoIsOnline(){
  // Android 13+ / Samsung One UI: navigator.onLine is often wrong.
  if(typeof navigator === 'undefined') return true;
  if(navigator.onLine === false) return false;
  if(nalunoLastOfflineAt && (Date.now() - nalunoLastOfflineAt) < 2000) return false;
  return true;
}

function nalunoMarkOnline(){
  nalunoLastOnlineAt = Date.now();
  nalunoLastOfflineAt = 0;
}
function nalunoMarkOffline(){
  nalunoLastOfflineAt = Date.now();
}

async function nalunoKeepAliveStart(reason){
  nalunoKeepAliveDepth++;
  try{ window.__nalunoUploadActive = nalunoKeepAliveDepth > 0; }catch(_){}
  try{
    if(navigator.wakeLock && navigator.wakeLock.request){
      nalunoWakeLock = await navigator.wakeLock.request('screen');
    }
  }catch(_){}
  try{
    if(window.NalunoNative && typeof window.NalunoNative.startUploadKeepAlive === 'function'){
      window.NalunoNative.startUploadKeepAlive(String(reason || 'upload'));
    }
  }catch(_){}
}

function nalunoKeepAliveStop(){
  nalunoKeepAliveDepth = Math.max(0, nalunoKeepAliveDepth - 1);
  try{ window.__nalunoUploadActive = nalunoKeepAliveDepth > 0; }catch(_){}
  if(nalunoKeepAliveDepth > 0) return;
  try{ if(nalunoWakeLock){ nalunoWakeLock.release(); nalunoWakeLock = null; } }catch(_){}
  try{
    if(window.NalunoNative && typeof window.NalunoNative.stopUploadKeepAlive === 'function'){
      window.NalunoNative.stopUploadKeepAlive();
    }
  }catch(_){}
}

document.addEventListener('visibilitychange', function(){
  if(document.hidden) return;
  // Wake locks are released by the OS whenever the tab is hidden, so an upload/call
  // still in progress needs a fresh request on return. nalunoKeepAliveStart() already
  // increments the depth counter itself; the decrement here is deliberate — it nets
  // to zero net change while still forcing a real wakeLock.request() call. Keep the
  // increment (inside Start) and this decrement paired if either function changes.
  if(nalunoKeepAliveDepth > 0){
    nalunoKeepAliveStart('resume').then(function(){ nalunoKeepAliveDepth--; }).catch(function(){});
  }
  try{ if(typeof flushMessageQueue === 'function') flushMessageQueue(); }catch(_){}
  try{ if(typeof flushBandOutbox === 'function') flushBandOutbox(); }catch(_){}
  try{ if(typeof drainPublishQueue === 'function') drainPublishQueue(); }catch(_){}
});

window.addEventListener('online', function(){
  nalunoMarkOnline();
  try{ if(typeof updateOfflineBadge === 'function') updateOfflineBadge(); }catch(_){}
  try{ if(typeof flushMessageQueue === 'function') flushMessageQueue(); }catch(_){}
  try{ if(typeof flushBandOutbox === 'function') flushBandOutbox(); }catch(_){}
  try{ if(typeof drainPublishQueue === 'function') drainPublishQueue(); }catch(_){}
});
window.addEventListener('offline', function(){
  nalunoMarkOffline();
  try{ if(typeof updateOfflineBadge === 'function') updateOfflineBadge(); }catch(_){}
});
