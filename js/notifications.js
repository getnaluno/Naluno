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
  // FIX (found during a repo audit): this checked whether a broadcastId and
  // openBroadcastById() were available specifically to decide whether
  // navigation was possible — then never actually navigated anywhere. The
  // base toast() had no way to be tapped at all, so this was structured to
  // do something it could never actually do. toast() now optionally
  // supports a tap handler; wired through here so "X is live" is actually
  // tappable when there's somewhere real to go, and stays a plain,
  // non-interactive toast when there isn't.
  if(n.broadcastId && typeof openBroadcastById === 'function'){
    toast(who + ' is live' + title + ' — tap to watch', function(){
      openBroadcastById(n.broadcastId);
    });
  } else {
    toast(who + ' is live' + title);
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
    try{ localStorage.setItem('nalunoPushTokenAt', String(Date.now())); }catch(_){}
    try{ localStorage.setItem('nalunoPushToken', token); }catch(_){}
    if(existing.fcmTokenWeb && existing.fcmTokenWeb !== token){
      console.log('[push] web token ROTATED — stored token was stale, now updated');
      try{ if(typeof nalunoDiag === 'function') nalunoDiag('push-token-rotated', 'stale token replaced'); }catch(_){}
    } else {
      console.log('[push] web token registered');
    }
    return token;
  }catch(e){
    console.warn('[push] registerWebPushToken', e);
    try{ if(typeof nalunoDiag === 'function') nalunoDiag('push-register-failed', (e && e.message) || String(e)); }catch(_){}
    return null;
  }
}

/* FIX — "background calling works, then suddenly stops".

   The push token was written to Firestore exactly ONCE, at sign-in, and never
   looked at again. FCM web tokens are not permanent: they rotate when the
   browser updates, when the service worker is replaced, when push
   subscriptions are reset, or after long inactivity. When that happens the
   token stored on the user document is dead. The call-notify worker keeps
   sending to it, FCM keeps accepting the request, and the phone simply never
   rings again — with nothing failing visibly anywhere.

   That is exactly the reported shape: it works, and then one day it stops,
   with no action from the person and no error to point at.

   getToken() always returns the CURRENT token, so re-registering is all that
   is needed — it writes whatever is live now. Done on returning to the
   foreground, throttled so it costs one Firestore write at most every few
   hours, plus an immediate check if the locally-remembered token no longer
   matches. */
const NALUNO_PUSH_REFRESH_MS = 6 * 60 * 60 * 1000; // 6 hours

async function keepPushTokenFresh(force){
  try{
    if(typeof currentUser === 'undefined' || !currentUser || !fbDb) return;
    if(typeof isNativeShell === 'function' && isNativeShell()) return; // native has its own path
    if(typeof Notification === 'undefined' || Notification.permission !== 'granted') return;

    let lastAt = 0, lastToken = '';
    try{
      lastAt = parseInt(localStorage.getItem('nalunoPushTokenAt') || '0', 10) || 0;
      lastToken = localStorage.getItem('nalunoPushToken') || '';
    }catch(_){}

    const due = force || !lastAt || (Date.now() - lastAt) > NALUNO_PUSH_REFRESH_MS;

    // Cheap check first: ask for the current token and compare. If it has
    // rotated, re-register immediately regardless of the throttle — a stale
    // token means the phone cannot ring, which is worth a write straight away.
    if(!due){
      try{
        const registration = await navigator.serviceWorker.ready;
        const current = await firebase.messaging().getToken({ vapidKey: VAPID_KEY, serviceWorkerRegistration: registration });
        if(current && lastToken && current === lastToken) return; // still valid, nothing to do
      }catch(_){ return; }
    }
    await registerWebPushToken();
  }catch(e){
    console.warn('[push] keepPushTokenFresh', e && e.message);
  }
}

(function watchPushTokenHealth(){
  try{
    document.addEventListener('visibilitychange', function(){
      if(!document.hidden) setTimeout(function(){ keepPushTokenFresh(false); }, 2500);
    });
    window.addEventListener('online', function(){
      setTimeout(function(){ keepPushTokenFresh(false); }, 3000);
    });
  }catch(_){}
})();
try{ window.keepPushTokenFresh = keepPushTokenFresh; }catch(_){}


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

(function autoAskCallNotifs(){
  let asked = false;
  function maybe(){
    try{
      if(asked) return;
      if(typeof currentUser === 'undefined' || !currentUser) return;
      if(typeof isNativeShell === 'function' && isNativeShell()) return;
      if(!('Notification' in window)) return;
      if(Notification.permission === 'granted'){
        asked = true;
        if(typeof ensureCallPushReady === 'function') ensureCallPushReady();
        return;
      }
      if(Notification.permission !== 'default') return;
      asked = true;
      Notification.requestPermission().then(function(p){
        if(p === 'granted' && typeof ensureCallPushReady === 'function') ensureCallPushReady();
      }).catch(function(){});
    }catch(_){}
  }
  ['pointerdown','click','keydown'].forEach(function(evt){
    document.addEventListener(evt, maybe, { passive:true });
  });
})();
