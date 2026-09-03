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
      // Samsung / Android WebView can leave wakeLock.request() pending forever
      // (permission sheet never appears). That used to stall every Signal and
      // Broadcast publish because drainPublishQueue awaited this.
      const asked = navigator.wakeLock.request('screen');
      const raced = await Promise.race([
        asked,
        new Promise(function(res){ setTimeout(function(){ res(null); }, 700); }),
      ]);
      if(raced) nalunoWakeLock = raced;
      else {
        asked.then(function(lock){
          if(!lock) return;
          if(nalunoKeepAliveDepth <= 0){
            try{ lock.release(); }catch(_){}
          } else {
            nalunoWakeLock = lock;
          }
        }).catch(function(){});
      }
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
  // FIX (found during a fresh audit): the decrement used to be a bare
  // `nalunoKeepAliveDepth--`, which only touches the counter. If a genuine
  // nalunoKeepAliveStop() call (the real upload/call actually finishing)
  // happened while this refresh was still awaiting wakeLock.request(), that
  // real stop's own decrement could bring depth to 0 without ever running
  // release logic — since only nalunoKeepAliveStop() releases the wake lock
  // and tells the native side to stop, and this deferred callback bypassed
  // it. The wake lock (and the native foreground keep-alive service) could
  // then run indefinitely after every legitimate reason for it had ended.
  // Calling the real nalunoKeepAliveStop() here instead does the identical
  // decrement AND correctly releases if depth has genuinely reached 0 by
  // the time this resolves — verified with a simulation of the exact race
  // (a real stop() landing mid-flight) showing the old bare decrement
  // leaves the lock held forever, and this fix releases it correctly.
  if(nalunoKeepAliveDepth > 0){
    nalunoKeepAliveStart('resume').then(function(){ nalunoKeepAliveStop(); }).catch(function(){});
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
