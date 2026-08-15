/* ============================================================
   MODULE: js/pwa.js
   PWA install prompt + notification deep-link
   OWNERSHIP: change this domain here only.
   Scripts share globals (intentional) so load order matches the old monolith.
   ============================================================ */
/* ---------------- PWA INSTALL + CALL NOTIFICATION DEEP-LINK ---------------- */
if('serviceWorker' in navigator){
  navigator.serviceWorker.register('sw.js').catch(()=>{ /* installability just won't be offered — not fatal */ });

  // Notification click (or Capacitor bridge) posts here so we can open the incoming UI
  // even when the app was backgrounded or just cold-started from the push.
  navigator.serviceWorker.addEventListener('message', event=>{
    const msg = event.data || {};
    if(msg.type === 'naluno-incoming-call'){
      handleIncomingCallFromPush(msg.callId || null);
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

/* Capacitor native shell detection + FCM token registration.
   On Android the web VAPID path is weak; the native plugin token is what actually
   wakes the device. Same Firestore field (fcmToken) the call-notify Worker already reads. */
function isNativeShell(){
  try{
    return !!(window.Capacitor && (window.Capacitor.isNativePlatform ? window.Capacitor.isNativePlatform() : window.Capacitor.platform !== 'web'));
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
async function setupCapacitorPush(){
  console.log('[push] setupCapacitorPush start');
  const Push = getCapacitorPush();
  if(!Push || !currentUser || !fbDb) return false;
  try{
    const perm = await Push.requestPermissions();
    if(perm && perm.receive !== 'granted'){
      $('callNotifStatus').textContent = 'Notifications blocked — enable them in Android Settings → Apps → Naluno.';
      return false;
    }
    if(!nativePushWired){
      nativePushWired = true;
      await Push.addListener('registration', async (token)=>{
        try{
          if(!token || !token.value || !currentUser || !fbDb) return;
          // Keep both fields so web and Android never overwrite each other.
          // Primary fcmToken is what the existing call-notify Worker reads.
          await fbDb.collection('users').doc(currentUser.uid).set({
            fcmToken: token.value,
            fcmTokenAndroid: token.value,
            fcmTokenPlatform: 'android',
          }, { merge:true });
          $('callNotifStatus').textContent = 'Call notifications are on (Android) — calls can wake this phone.';
        }catch(e){ console.warn('[push] save token failed', e); }
      });
      await Push.addListener('registrationError', err=>{
        console.warn('[push] registrationError', err);
      });
      await Push.addListener('pushNotificationActionPerformed', (action)=>{
        try{
          const data = (action && action.notification && action.notification.data) || {};
          const callId = data.callId || data.call_id || null;
          if(callId) handleIncomingCallFromPush(callId);
        }catch(e){}
      });
    }
    await Push.register();
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
  if(navigator.onLine === false){
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
  let pulling = false;
  const THRESH = 90;
  document.addEventListener('touchstart', function(e){
    if(!e.touches || !e.touches[0]) return;
    const scrollTop = document.scrollingElement ? document.scrollingElement.scrollTop : window.scrollY;
    // Only when at top of main shell
    if(scrollTop > 2) { pulling = false; return; }
    if($('callOverlay') && $('callOverlay').classList.contains('active')) return;
    startY = e.touches[0].clientY;
    pulling = true;
  }, { passive: true });
  document.addEventListener('touchmove', function(e){
    if(!pulling || !e.touches || !e.touches[0]) return;
    const dy = e.touches[0].clientY - startY;
    let ind = document.getElementById('ptrIndicator');
    if(dy > 24){
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
    if(dy > THRESH){
      try{ if(typeof trackMetric === 'function') trackMetric('pull_refresh', {}); }catch(_){}
      // Soft refresh: reload so SW can update shell; preserves origin
      location.reload();
    }
  }, { passive: true });
})();
