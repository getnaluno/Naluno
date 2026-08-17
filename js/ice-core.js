/* ============================================================
   MODULE: js/ice-core.js
   OWNERSHIP: STUN/TURN only. Calls, Band mesh, Broadcast-live all consume this.
   Do not put call signaling, band presence, or VOD playback here.
   ============================================================ */
const RTC_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
  iceCandidatePoolSize: 10,
  bundlePolicy: 'max-bundle',
  rtcpMuxPolicy: 'require',
};

const TURN_CREDENTIALS_WORKER_URL = 'https://naluno-turn-credentials.naluno.workers.dev';
const ICE_CACHE_TTL_MS = 25 * 60 * 1000;

let cachedIceServers = null;
let cachedIceServersAt = 0;

async function getIceServers(){
  try{
    if(typeof currentUser === 'undefined' || !currentUser) return RTC_CONFIG;
  }catch(_){ return RTC_CONFIG; }

  if(cachedIceServers && (Date.now() - cachedIceServersAt) < ICE_CACHE_TTL_MS){
    return cachedIceServers;
  }
  try{
    const idToken = await currentUser.getIdToken();
    const res = await fetch(TURN_CREDENTIALS_WORKER_URL, {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + idToken },
    });
    if(!res.ok){
      console.log('[ice] TURN HTTP', res.status, '— STUN only');
      return RTC_CONFIG;
    }
    const data = await res.json();
    if(!data.iceServers || !data.iceServers.length){
      console.log('[ice] TURN response empty — STUN only');
      return RTC_CONFIG;
    }
    cachedIceServers = {
      iceServers: data.iceServers,
      iceCandidatePoolSize: 10,
      bundlePolicy: 'max-bundle',
      rtcpMuxPolicy: 'require',
    };
    cachedIceServersAt = Date.now();
    console.log('[ice] TURN ok —', data.iceServers.length, 'server(s)');
    return cachedIceServers;
  }catch(e){
    console.log('[ice] TURN failed — STUN only', e && e.message);
    return RTC_CONFIG;
  }
}

function prewarmIceServers(){
  getIceServers().catch(function(){});
}

/** Explicit API for modules that prefer namespaced access */
const IceCore = {
  get: getIceServers,
  prewarm: prewarmIceServers,
  stunOnly: function(){ return RTC_CONFIG; },
  invalidate: function(){ cachedIceServers = null; cachedIceServersAt = 0; },
};
