/* ============================================================
   MODULE: js/pwa.js
   PWA install prompt + notification deep-link
   OWNERSHIP: change this domain here only.
   Scripts share globals (intentional) so load order matches the old monolith.
   ============================================================ */
/* ---------------- PWA INSTALL + CALL NOTIFICATION DEEP-LINK ---------------- */
if('serviceWorker' in navigator){
  navigator.serviceWorker.register('sw.js?v=20260904e', { scope: './', updateViaCache: 'none' })
    .then(function(reg){ try{ reg.update(); }catch(_){} })
    .catch(function(e){ console.warn('[sw]', e); });
  // One automatic reload when a new SW takes control (clears stuck "sign-in not ready"
  // from an older worker that timed out Firebase CDN scripts).
  try{
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', function(){
      if(reloaded) return;
      try{ if(sessionStorage.getItem('nalunoSwReload') === '20260904e') return; }catch(_){}
      reloaded = true;
      try{ sessionStorage.setItem('nalunoSwReload', '20260904e'); }catch(_){}
      location.reload();
    });
  }catch(_){}

  // Notification click (or Capacitor bridge) posts here so we can open the incoming UI
  // even when the app was backgrounded or just cold-started from the push.
  navigator.serviceWorker.addEventListener('message', event=>{
    const msg = event.data || {};
    if(msg.type === 'naluno-incoming-call'){
      const id = msg.callId || null;
      const kick = ()=>{
        if(currentUser && fbDb) handleIncomingCallFromPush(id);
        else setTimeout(kick, 400);
      };
      kick();
    }
    if(msg.type === 'naluno-decline-call'){
      const id = msg.callId || null;
      const kick = ()=>{
        if(typeof declineIncomingCall === 'function'){
          declineIncomingCall(id);
          return;
        }
        if(currentUser && fbDb && id){
          fbDb.collection('calls').doc(id).update({ status:'declined' }).catch(function(){});
          return;
        }
        setTimeout(kick, 400);
      };
      kick();
    }
  });
}

// Cold start from notification: https://…/?call=<callId>
(function consumeCallDeepLink(){
  try{
    const params = new URLSearchParams(location.search);
    const callId = params.get('call');
    if(!callId) return;
    // Strip the query so a refresh does not re-open the same call forever.
    if(history.replaceState){
      const clean = location.pathname + (location.hash || '');
      history.replaceState(null, '', clean);
    }
    // Wait until auth + Firestore are ready enough to attach.
    const tryOpen = ()=>{
      if(currentUser && fbDb){
        handleIncomingCallFromPush(callId);
        return;
      }
      setTimeout(tryOpen, 400);
    };
    setTimeout(tryOpen, 600);
  }catch(e){}
})();

/* Opens / resumes an incoming call that arrived via push while the app was closed.
   Loads the call doc so we still show the right caller even if the live
   onSnapshot "ringing" listener has not fired yet. */
async function handleIncomingCallFromPush(callId){
  if(!callId || !fbDb || !currentUser) return;
  if($('callOverlay').classList.contains('active') && activeCallId === callId) return;
  try{
    const snap = await fbDb.collection('calls').doc(callId).get();
    if(!snap.exists) return;
    const data = snap.data() || {};
    if(data.calleeUid !== currentUser.uid) return;
    if(data.status !== 'ringing'){
      if(data.status === 'missed' || data.status === 'ended') toast('That call already ended');
      return;
    }
    handleIncomingCall(callId, data);
  }catch(e){
    console.warn('[call] push deep-link failed', e);
  }
}
// Native IncomingCallActivity / MainActivity call this via evaluateJavascript.
window.handleIncomingCallFromPush = handleIncomingCallFromPush;

function nalunoRequestPersistentStorage(){
  try{
    if(navigator.storage && navigator.storage.persist){
      navigator.storage.persist().catch(function(){});
    }
  }catch(_){}
}
nalunoRequestPersistentStorage();
document.addEventListener('pointerdown', nalunoRequestPersistentStorage, { once: true });
document.addEventListener('click', nalunoRequestPersistentStorage, { once: true });

/* Capacitor native shell detection + FCM token registration.
   On Android the web VAPID path is weak; the native plugin token is what actually
   wakes the device. Same Firestore field (fcmToken) the call-notify Worker already reads. */
function isNativeShell(){
  // LOCK (bug 1.6): same careful check as auth.js (android|ios only). pwa.js loads last
  // so this definition must not silently widen to platform !== 'web'.
  try{
    return !!(window.Capacitor && (
      (typeof window.Capacitor.isNativePlatform === 'function' && window.Capacitor.isNativePlatform()) ||
      window.Capacitor.platform === 'android' ||
      window.Capacitor.platform === 'ios'
    ));
  }catch(e){ return false; }
}
function getCapacitorPush(){
  try{
    if(window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.PushNotifications){
      return window.Capacitor.Plugins.PushNotifications;
    }
  }catch(e){}
  return null;
}
let nativePushWired = false;
async function saveNativeFcmToken(token){
  try{
    if(!token || !currentUser || !fbDb) {
      window.__nalunoNativeFcmToken = token || window.__nalunoNativeFcmToken;
      return false;
    }
    await fbDb.collection('users').doc(currentUser.uid).set({
      fcmToken: token,
      fcmTokenAndroid: token,
      fcmTokenPlatform: 'android',
      fcmTokenUpdatedAt: Date.now(),
    }, { merge: true });
    window.__nalunoNativeFcmToken = token;
    try{
      if($('callNotifStatus')){
        $('callNotifStatus').textContent = 'Call notifications are on (Android) — calls can wake this phone.';
      }
    }catch(_){}
    console.log('[push] native FCM token saved to Firestore');
    return true;
  }catch(e){
    console.warn('[push] saveNativeFcmToken', e);
    return false;
  }
}
window.saveNativeFcmToken = saveNativeFcmToken;

async function setupCapacitorPush(){
  console.log('[push] setupCapacitorPush start', !!getCapacitorPush(), !!currentUser);
  // Token may arrive from native MainActivity before Capacitor plugin fires
  if(window.__nalunoNativeFcmToken && currentUser && fbDb){
    await saveNativeFcmToken(window.__nalunoNativeFcmToken);
  }
  const Push = getCapacitorPush();
  if(!Push){
    console.warn('[push] PushNotifications plugin missing — rebuild Android shell with @capacitor/push-notifications');
    return false;
  }
  if(!currentUser || !fbDb) return false;
  try{
    let perm = await Push.checkPermissions();
    if(!perm || perm.receive !== 'granted'){
      perm = await Push.requestPermissions();
    }
    if(perm && perm.receive !== 'granted'){
      try{ $('callNotifStatus').textContent = 'Notifications blocked — enable them in Android Settings → Apps → Naluno.'; }catch(_){}
      return false;
    }
    if(!nativePushWired){
      nativePushWired = true;
      await Push.addListener('registration', async (token)=>{
        try{
          const value = token && (token.value || token);
          if(!value) return;
          await saveNativeFcmToken(value);
        }catch(e){ console.warn('[push] save token failed', e); }
      });
      await Push.addListener('registrationError', err=>{
        console.warn('[push] registrationError', err);
      });
      await Push.addListener('pushNotificationActionPerformed', (action)=>{
        try{
          const data = (action && action.notification && action.notification.data) || {};
          if(data.type === 'broadcast_live' || data.broadcastId){
            const broadcastId = data.broadcastId || null;
            if(broadcastId && typeof openBroadcastById === 'function'){
              openBroadcastById(broadcastId);
            }
            return;
          }
          const callId = data.callId || data.call_id || null;
          if(callId){ handleIncomingCallFromPush(callId); return; }
        }catch(e){}
      });
      await Push.addListener('pushNotificationReceived', (notif)=>{
        try{
          const data = (notif && notif.data) || {};
          if(data.type === 'broadcast_live' || data.broadcastId){
            if(typeof handleBroadcastLiveNotification === 'function'){
              handleBroadcastLiveNotification({
                type: 'broadcast_live',
                fromName: data.callerName || data.fromName || null,
                title: data.title || null,
                broadcastId: data.broadcastId || null,
              });
            }
            return;
          }
          const callId = data.callId || data.call_id || null;
          if(callId && typeof handleIncomingCallFromPush === 'function'){
            handleIncomingCallFromPush(callId);
          }
        }catch(e){}
      });
    }
    await Push.register();
    // registration event is async — also flush any token MainActivity already injected
    setTimeout(function(){
      try{
        if(window.__nalunoNativeFcmToken) saveNativeFcmToken(window.__nalunoNativeFcmToken);
      }catch(_){}
    }, 2000);
    return true;
  }catch(e){
    console.warn('[push] Capacitor setup failed', e);
    return false;
  }
}

// Foreground FCM (app open, tab focused) — still show a toast + open incoming UI.
if(typeof firebase !== 'undefined' && firebase.messaging){
  try{
    const fgMessaging = firebase.messaging();
    fgMessaging.onMessage(payload=>{
      const data = (payload && payload.data) || {};
      if(data.type === 'broadcast_live' || data.broadcastId){
        if(typeof handleBroadcastLiveNotification === 'function'){
          handleBroadcastLiveNotification({
            type: 'broadcast_live',
            fromName: data.fromName || data.callerName || 'Someone',
            title: data.title || '',
            broadcastId: data.broadcastId || '',
          });
        } else {
          toast((data.title || 'Live on Naluno'));
        }
        return;
      }
      const callId = data.callId || data.call_id || null;
      if(callId) handleIncomingCallFromPush(callId);
      else if(data.title) toast(data.title);
    });
  }catch(e){ /* messaging not available in this context */ }
}
let deferredInstallPrompt = null;

function isIosDevice(){
  try{
    return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }catch(_){ return false; }
}
function isStandalonePwa(){
  try{
    if(window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) return true;
    if(window.navigator.standalone === true) return true; // iOS Safari
    if(document.referrer && document.referrer.indexOf('android-app://') === 0) return true;
  }catch(_){}
  return false;
}
function installBannerDismissed(){
  try{ return localStorage.getItem('naluno:installDismiss') === '1'; }catch(_){ return false; }
}
function showInstallBanner(mode){
  // mode: 'android' | 'ios'
  if(isStandalonePwa() || installBannerDismissed()) return;
  const ban = $('installBanner');
  if(!ban) return;
  const btn = $('installBannerBtn');
  const label = ban.querySelector('[data-install-label]') || ban.children[1];
  if(mode === 'ios'){
    if(label) label.textContent = 'Add Naluno to your Home Screen — Share → Add to Home Screen';
    if(btn){ btn.textContent = 'How'; btn.style.display = ''; }
    ban.dataset.mode = 'ios';
  } else {
    if(label) label.textContent = 'Install Naluno for full-screen calls & faster open';
    if(btn){ btn.textContent = 'Install'; btn.style.display = ''; }
    ban.dataset.mode = 'android';
  }
  ban.style.display = 'flex';
}

window.addEventListener('beforeinstallprompt', e=>{
  e.preventDefault();
  deferredInstallPrompt = e;
  showInstallBanner('android');
});

if($('installBannerBtn')){
  $('installBannerBtn').onclick = async ()=>{
    const ban = $('installBanner');
    if(ban && ban.dataset.mode === 'ios'){
      toast('iPhone: tap Share (□↑) → “Add to Home Screen”');
      return;
    }
    if(!deferredInstallPrompt){
      toast('Open Chrome menu → Install app (or Add to Home screen)');
      return;
    }
    if(ban) ban.style.display = 'none';
    try{
      deferredInstallPrompt.prompt();
      await deferredInstallPrompt.userChoice;
    }catch(_){}
    deferredInstallPrompt = null;
  };
}
if($('installBannerClose')){
  $('installBannerClose').onclick = ()=>{
    if($('installBanner')) $('installBanner').style.display = 'none';
    try{ localStorage.setItem('naluno:installDismiss', '1'); }catch(_){}
  };
}
window.addEventListener('appinstalled', ()=>{
  if($('installBanner')) $('installBanner').style.display = 'none';
  deferredInstallPrompt = null;
  try{ localStorage.setItem('naluno:installDismiss', '1'); }catch(_){}
});

// iOS never fires beforeinstallprompt — show Add to Home Screen tip after load
(function scheduleIosInstallTip(){
  if(!isIosDevice() || isStandalonePwa() || installBannerDismissed()) return;
  // Wait until user is past the gate a bit
  setTimeout(()=>{
    if(isStandalonePwa() || installBannerDismissed()) return;
    if(deferredInstallPrompt) return; // Android path owns the banner
    showInstallBanner('ios');
  }, 2500);
})();

// Android Chrome: if event already missed (late script), still offer manual tip later
(function scheduleAndroidInstallTip(){
  if(isIosDevice() || isStandalonePwa() || installBannerDismissed()) return;
  setTimeout(()=>{
    if(isStandalonePwa() || installBannerDismissed()) return;
    if(deferredInstallPrompt){
      showInstallBanner('android');
      return;
    }
    // No deferred prompt yet — show soft tip so people know Install exists
    const ban = $('installBanner');
    if(!ban || ban.style.display === 'flex') return;
    showInstallBanner('android');
  }, 4000);
})();


/* ---- Offline badge (app stays usable; queue sends) ---- */
function updateOfflineBadge(){
  let el = document.getElementById('offlineBadge');
  if(!el){
    el = document.createElement('div');
    el.id = 'offlineBadge';
    el.setAttribute('role','status');
    el.style.cssText = 'display:none;position:fixed;top:calc(8px + env(safe-area-inset-top,0px));left:50%;transform:translateX(-50%);z-index:250;padding:6px 14px;border-radius:999px;font-size:12px;font-weight:600;background:rgba(20,22,30,.92);color:#fff;border:1px solid rgba(255,255,255,.12);pointer-events:none;';
    document.body.appendChild(el);
  }
  if((typeof nalunoIsOnline === 'function' ? !nalunoIsOnline() : navigator.onLine === false)){
    el.style.display = 'block';
    el.textContent = 'Offline — messages queue until you are back';
  } else {
    el.style.display = 'none';
  }
}
document.addEventListener('DOMContentLoaded', updateOfflineBadge);
window.addEventListener('online', updateOfflineBadge);
window.addEventListener('offline', updateOfflineBadge);

/* ---- Pull-to-refresh (soft reload without force-kill) ---- */
(function setupPullToRefresh(){
  let startY = 0;
  let startX = 0;
  let startT = 0;
  let pulling = false;
  const THRESH = 160;       // must pull farther
  const MIN_MS = 280;       // must hold the gesture briefly
  const EDGE_Y = 56;        // finger must start near top of screen

  function scrollableAncestorScrolled(el){
    let n = el;
    while(n && n !== document.body && n !== document.documentElement){
      try{
        if(n.scrollTop && n.scrollTop > 4) return true;
        const id = n.id || '';
        if(id === 'threadMessages' || id === 'bspaceScroll' || id === 'bandMessages' ||
           id === 'wirelineList' || id === 'freqList' || id === 'compassFeed'){
          if(n.scrollTop > 2) return true;
        }
        const oy = (window.getComputedStyle(n).overflowY || '');
        if((oy === 'auto' || oy === 'scroll') && n.scrollTop > 4) return true;
      }catch(_){}
      n = n.parentElement;
    }
    const st = document.scrollingElement ? document.scrollingElement.scrollTop : window.scrollY;
    return st > 4;
  }

  document.addEventListener('touchstart', function(e){
    pulling = false;
    if(!e.touches || !e.touches[0]) return;
    if($('callOverlay') && $('callOverlay').classList.contains('active')) return;
    const t = e.touches[0];
    // Only from top edge of the viewport — not mid-thread
    if(t.clientY > EDGE_Y) return;
    if(scrollableAncestorScrolled(e.target)) return;
    startY = t.clientY;
    startX = t.clientX;
    startT = Date.now();
    pulling = true;
  }, { passive: true });

  document.addEventListener('touchmove', function(e){
    if(!pulling || !e.touches || !e.touches[0]) return;
    if(scrollableAncestorScrolled(e.target)){
      pulling = false;
      const ind = document.getElementById('ptrIndicator');
      if(ind) ind.style.display = 'none';
      return;
    }
    const t = e.touches[0];
    const dy = t.clientY - startY;
    const dx = Math.abs(t.clientX - startX);
    // Horizontal-ish scroll cancel
    if(dx > dy && dx > 24){ pulling = false; return; }
    let ind = document.getElementById('ptrIndicator');
    if(dy > 48){
      if(!ind){
        ind = document.createElement('div');
        ind.id = 'ptrIndicator';
        ind.style.cssText = 'position:fixed;top:calc(12px + env(safe-area-inset-top,0px));left:50%;transform:translateX(-50%);z-index:260;padding:6px 12px;border-radius:999px;background:rgba(13,15,23,.9);color:#7CFFB2;font-size:12px;pointer-events:none;';
        document.body.appendChild(ind);
      }
      ind.style.display = 'block';
      ind.textContent = dy > THRESH ? 'Release to refresh' : 'Pull to refresh';
    } else if(ind){
      ind.style.display = 'none';
    }
  }, { passive: true });

  document.addEventListener('touchend', function(e){
    if(!pulling) return;
    pulling = false;
    const ind = document.getElementById('ptrIndicator');
    if(ind) ind.style.display = 'none';
    const touch = (e.changedTouches && e.changedTouches[0]) || null;
    if(!touch) return;
    const dy = touch.clientY - startY;
    const dt = Date.now() - startT;
    if(dy > THRESH && dt >= MIN_MS){
      try{ if(typeof trackMetric === 'function') trackMetric('pull_refresh', {}); }catch(_){}
      try{ if(typeof captureNavState==='function') captureNavState(); }catch(_){}
      location.reload();
    }
  }, { passive: true });
})();


/* ---- Full Android APK download (hosted file, not PWA) ---- */
function getAndroidApkUrl(){
  try{
    if(typeof ANDROID_APK_URL === 'string' && ANDROID_APK_URL.trim()) return ANDROID_APK_URL.trim();
  }catch(_){}
  return '';
}
function isAndroidDevice(){
  try{ return /Android/i.test(navigator.userAgent || ''); }catch(_){ return false; }
}
function apkBannerDismissed(){
  try{ return localStorage.getItem('naluno:apkDismiss') === '1'; }catch(_){ return false; }
}
function showApkBanner(){
  const url = getAndroidApkUrl();
  const ban = $('apkBanner');
  const btn = $('apkBannerBtn');
  const callsignBtn = $('downloadAndroidAppBtn');
  const hint = $('androidAppHint');
  if(callsignBtn){
    if(url){
      callsignBtn.href = url;
      callsignBtn.setAttribute('download', 'naluno.apk');
      callsignBtn.style.display = 'block';
      if(hint) hint.style.display = 'block';
    } else {
      callsignBtn.style.display = 'none';
      if(hint) hint.style.display = 'none';
    }
  }
  if(!ban || !url) return;
  if(typeof isNativeShell === 'function' && isNativeShell()) return; // already in APK
  if(apkBannerDismissed()) return;
  // Prefer showing on Android browsers; still available from Callsign everywhere
  if(!isAndroidDevice() && !isIosDevice()) {
    // desktop: only Callsign button, no top banner noise
  } else if(isAndroidDevice()){
    if(btn){ btn.href = url; btn.setAttribute('download', 'naluno.apk'); }
    // Sit below PWA banner if both visible
    const install = $('installBanner');
    if(install && install.style.display === 'flex'){
      ban.style.top = '52px';
    } else {
      ban.style.top = '0';
    }
    ban.style.display = 'flex';
  }
}
if($('apkBannerClose')){
  $('apkBannerClose').onclick = ()=>{
    if($('apkBanner')) $('apkBanner').style.display = 'none';
    try{ localStorage.setItem('naluno:apkDismiss', '1'); }catch(_){}
  };
}
if($('apkBannerBtn')){
  $('apkBannerBtn').addEventListener('click', function(){
    try{ if(typeof trackMetric === 'function') trackMetric('apk_download_click', {}); }catch(_){}
  });
}
// After load + after auth gate typically
setTimeout(showApkBanner, 1800);
setTimeout(showApkBanner, 5000);
document.addEventListener('visibilitychange', function(){
  if(!document.hidden) setTimeout(showApkBanner, 400);
});

function showInstallPromptSoon(){
  try{
    if(isStandalonePwa() || installBannerDismissed()) return;
    const ban = $('installBanner');
    if(!ban) return;
    const label = ban.querySelector('[data-install-label]');
    if(isIosDevice()){
      if(label) label.textContent = 'Add Naluno to your Home Screen — Share, then Add to Home Screen';
      if($('installBannerBtn')) $('installBannerBtn').textContent = 'How';
      $('installBannerBtn').onclick = function(){
        toast('Tap Share, then Add to Home Screen');
      };
    }
    ban.style.display = 'flex';
  }catch(_){}
}
window.showInstallPromptSoon = showInstallPromptSoon;
