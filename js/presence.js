/* ============================================================
   MODULE: js/presence.js
   Session heartbeat — the thing that makes "who is using Naluno" answerable.

   Before this, the console could count what people had POSTED but not who was
   USING the app. DAU/WAU/MAU, "active now", and returning-user counts were
   all unanswerable, and the honest options were to fabricate them or leave
   them blank. This records the minimum needed to answer them truthfully:
   a uid, a timestamp, and a coarse platform string.

   Deliberately small. No page paths, no dwell times, no behavioural trail —
   this exists to answer "is anyone here and do they come back", not to build
   a profile of what someone read.

   Fire-and-forget, like the economy emitter: if it fails, nothing about the
   app changes.
   ============================================================ */

const PRESENCE_WORKER_URL = 'https://naluno-economy.naluno.workers.dev';
const PRESENCE_INTERVAL_MS = 5 * 60 * 1000;   // a beat every 5 minutes while open
let __presenceTimer = null;
let __presenceLastSent = 0;

function nalunoPlatform(){
  try{
    if(typeof isNativeShell === 'function' && isNativeShell()) return 'android-native';
    const standalone = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches)
      || window.navigator.standalone === true;
    if(standalone) return 'pwa';
    return /Android/i.test(navigator.userAgent) ? 'web-android'
         : /iPhone|iPad/i.test(navigator.userAgent) ? 'web-ios' : 'web-desktop';
  }catch(_){ return 'unknown'; }
}

async function sendPresence(reason){
  try{
    if(typeof currentUser === 'undefined' || !currentUser) return;
    if(document.hidden && reason !== 'hide') return;
    const now = Date.now();
    // Never more than one beat per minute, whatever triggers it.
    if(now - __presenceLastSent < 60000 && reason !== 'signin') return;
    __presenceLastSent = now;
    const platform = nalunoPlatform();
    const appVersion = (function(){
      try{ const m = document.querySelector('meta[name="app-version"]'); return m ? m.content : ''; }catch(_){ return ''; }
    })();

    /* Stamp the account itself. The economy worker used to be the only
       place "who is here" was written — and when Google rejects its
       service account, the Control Centre could not count anyone. The
       signed-in person is always allowed to update their own user doc,
       so lastSeen survives a dead worker. */
    try{
      const db = (typeof fbDb !== 'undefined' && fbDb)
        ? fbDb
        : (typeof firebase !== 'undefined' && firebase.firestore ? firebase.firestore() : null);
      if(db){
        db.collection('users').doc(currentUser.uid).set({
          lastSeen: now,
          lastPlatform: platform,
          lastAppVersion: appVersion,
          lastPresenceReason: reason || 'beat',
        }, { merge: true }).catch(function(){});
      }
    }catch(_){}

    try{
      const idToken = await currentUser.getIdToken(false);
      await fetch(PRESENCE_WORKER_URL + '/v1/presence', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + idToken, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          platform: platform,
          app_version: appVersion,
          reason: reason || 'beat',
        }),
        keepalive: reason === 'hide',
      });
    }catch(_){ /* worker optional — lastSeen already written */ }
  }catch(_){ /* presence must never affect the app */ }
}

function startPresence(){
  try{
    if(__presenceTimer) return;
    sendPresence('signin');
    __presenceTimer = setInterval(function(){ sendPresence('beat'); }, PRESENCE_INTERVAL_MS);
    document.addEventListener('visibilitychange', function(){
      if(document.hidden) sendPresence('hide');
      else sendPresence('return');
    });
  }catch(_){}
}

function stopPresence(){
  try{ if(__presenceTimer){ clearInterval(__presenceTimer); __presenceTimer = null; } }catch(_){}
}

/* Start once auth settles. Polls briefly rather than depending on load order,
   since this file must not care which script wins the race. */
(function bootPresence(){
  let tries = 0;
  const t = setInterval(function(){
    tries++;
    if(typeof currentUser !== 'undefined' && currentUser){ clearInterval(t); startPresence(); return; }
    if(tries > 60) clearInterval(t);   // ~1 minute, then stop looking
  }, 1000);
})();

try{ window.startPresence = startPresence; window.stopPresence = stopPresence; }catch(_){}
