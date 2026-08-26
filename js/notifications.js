/* ============================================================
   MODULE: js/notifications.js
   FCM push token + call notifications setup
   OWNERSHIP: change this domain here only.
   Scripts share globals (intentional) so load order matches the old monolith.
   ============================================================ */
/* ---------------- CALL NOTIFICATIONS (push, works even when the app is closed) ----------------
   A Firestore listener only runs while this tab's JavaScript is actually executing —
   there's no way around that from the client alone. Real background ringing needs a
   server to push a notification, which is what this wires up: register this device's
   token, and a Cloud Function (see functions/index.js) sends the actual push when a
   real call document is created. Requires the Firebase Blaze plan for that function —
   Cloud Functions aren't available on the free Spark plan at all. */
$('enableCallNotifsBtn').onclick = async ()=>{
  if(!fbDb || !currentUser){
    toast('Sign in first');
    return;
  }
  // Native Android shell path
  if(isNativeShell()){
    const ok = await setupCapacitorPush();
    if(ok) toast('Call notifications enabled on this phone');
    else toast('Couldn\u2019t enable notifications — check Android Settings');
    return;
  }
  if(!('Notification' in window) || !navigator.serviceWorker){
    toast('Notifications aren\u2019t supported in this browser');
    return;
  }
  if(typeof VAPID_KEY === 'undefined' || !VAPID_KEY || VAPID_KEY === 'YOUR_VAPID_KEY'){
    toast('Add your VAPID key to firebase-config.js first — see README');
    return;
  }
  try{
    const permission = await Notification.requestPermission();
    if(permission !== 'granted'){
      $('callNotifStatus').textContent = 'Notifications blocked — enable them in your browser\u2019s site settings to use this.';
      return;
    }
    const registration = await navigator.serviceWorker.ready;
    const messaging = firebase.messaging();
    const token = await messaging.getToken({ vapidKey: VAPID_KEY, serviceWorkerRegistration: registration });
    if(!token){ toast('Couldn\u2019t turn on notifications — try again'); return; }
    // Store web token separately. Do not overwrite primary fcmToken if an Android token already exists.
    const userRef = fbDb.collection('users').doc(currentUser.uid);
    const snap = await userRef.get();
    const existing = snap.exists ? snap.data() : {};
    const payload = { fcmTokenWeb: token, fcmTokenPlatform: 'web' };
    if(!existing.fcmTokenAndroid){
      payload.fcmToken = token;
    }
    await userRef.set(payload, { merge:true });
    $('callNotifStatus').textContent = 'Call notifications are on — you\u2019ll be notified even with the app closed.';
    toast('Call notifications enabled');
  }catch(e){
    toast(e.message || 'Couldn\u2019t enable notifications');
  }
};
$('autoTintToggle').onclick = function(){ this.classList.toggle('on'); };



/* Live Broadcast alerts from frequencies / community — present tense while live */
function handleBroadcastLiveNotification(n){
  if(!n || n.type !== 'broadcast_live') return;
  const who = n.fromName || 'Someone';
  const title = n.title ? (': ' + n.title) : '';
  toast(who + ' is live' + title);
  if(n.broadcastId && typeof openBroadcastById === 'function'){
    // soft prompt via toast; open path remains available via deep link / search
  }
}


async function registerWebPushToken(){
  if(!fbDb || !currentUser) return null;
  if(!('Notification' in window) || !navigator.serviceWorker) return null;
  if(typeof VAPID_KEY === 'undefined' || !VAPID_KEY || VAPID_KEY === 'YOUR_VAPID_KEY') return null;
  try{
    if(Notification.permission !== 'granted'){
      return null;
    }
    const registration = await navigator.serviceWorker.ready;
    const messaging = firebase.messaging();
    const token = await messaging.getToken({ vapidKey: VAPID_KEY, serviceWorkerRegistration: registration });
    if(!token) return null;
    const userRef = fbDb.collection('users').doc(currentUser.uid);
    const snap = await userRef.get();
    const existing = snap.exists ? snap.data() : {};
    const payload = { fcmTokenWeb: token, fcmTokenPlatform: 'web', fcmTokenUpdatedAt: Date.now() };
    if(!existing.fcmTokenAndroid) payload.fcmToken = token;
    await userRef.set(payload, { merge:true });
    console.log('[push] web token registered');
    return token;
  }catch(e){
    console.warn('[push] registerWebPushToken', e);
    return null;
  }
}


/** Call on every resume so killed-app wake keeps a fresh token. */
async function ensureCallPushReady(){
  try{
    if(!currentUser || !fbDb) return;
    if(typeof isNativeShell === 'function' && isNativeShell()){
      if(typeof setupCapacitorPush === 'function') await setupCapacitorPush();
      return;
    }
    if(typeof registerWebPushToken === 'function') await registerWebPushToken();
  }catch(e){ console.warn('[push] ensureCallPushReady', e); }
}

document.addEventListener('visibilitychange', function(){
  if(!document.hidden) setTimeout(function(){ try{ ensureCallPushReady(); }catch(_){} }, 400);
});
window.addEventListener('focus', function(){
  setTimeout(function(){ try{ ensureCallPushReady(); }catch(_){} }, 600);
});
