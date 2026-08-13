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
window.addEventListener('beforeinstallprompt', e=>{
  e.preventDefault(); // stop the browser's default mini-infobar — we show our own banner instead
  deferredInstallPrompt = e;
  $('installBanner').style.display = 'flex';
});
$('installBannerBtn').onclick = async ()=>{
  if(!deferredInstallPrompt) return;
  $('installBanner').style.display = 'none';
  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice; // resolves once the person accepts or dismisses the OS-level dialog
  deferredInstallPrompt = null;
};
$('installBannerClose').onclick = ()=>{ $('installBanner').style.display = 'none'; };
window.addEventListener('appinstalled', ()=>{ $('installBanner').style.display = 'none'; deferredInstallPrompt = null; });
