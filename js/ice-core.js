/* ============================================================
   MODULE: js/ice-core.js
   OWNERSHIP: STUN/TURN only. Calls, Band mesh, Broadcast-live all consume this.
   Fast path: cached TURN is returned immediately. A slow credential fetch
   never blocks the first offer — STUN is enough to start, and the next
   call uses the cache. iceNow() is the 0ms path used by createOffer.
   ============================================================ */
const RTC_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
  iceCandidatePoolSize: 4,
  bundlePolicy: 'max-bundle',
  rtcpMuxPolicy: 'require',
};

const TURN_CREDENTIALS_WORKER_URL = 'https://naluno-turn-credentials.naluno.workers.dev';
const ICE_CACHE_TTL_MS = 25 * 60 * 1000;
const CALL_ICE_BUDGET_MS = 250;

let cachedIceServers = null;
let cachedIceServersAt = 0;
let inflightIce = null;

function iceFromCache(){
  if(cachedIceServers && (Date.now() - cachedIceServersAt) < ICE_CACHE_TTL_MS){
    return cachedIceServers;
  }
  return null;
}

/** 0ms: cached TURN, else STUN. Never waits. Use this for the first offer. */
function iceNow(){
  return iceFromCache() || RTC_CONFIG;
}

async function fetchTurnServers(){
  try{
    if(typeof currentUser === 'undefined' || !currentUser) return RTC_CONFIG;
  }catch(_){ return RTC_CONFIG; }

  const hit = iceFromCache();
  if(hit) return hit;

  if(inflightIce) return inflightIce;

  inflightIce = (async function(){
    try{
      const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const kill = ctrl ? setTimeout(function(){ try{ ctrl.abort(); }catch(_){ } }, 1600) : null;
      const idToken = await currentUser.getIdToken();
      const res = await fetch(TURN_CREDENTIALS_WORKER_URL, {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + idToken },
        signal: ctrl ? ctrl.signal : undefined,
      });
      if(kill) clearTimeout(kill);
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
        iceCandidatePoolSize: 4,
        bundlePolicy: 'max-bundle',
        rtcpMuxPolicy: 'require',
      };
      cachedIceServersAt = Date.now();
      console.log('[ice] TURN ok —', data.iceServers.length, 'server(s)');
      return cachedIceServers;
    }catch(e){
      console.log('[ice] TURN failed — STUN only', e && e.message);
      return RTC_CONFIG;
    }finally{
      inflightIce = null;
    }
  })();

  return inflightIce;
}

/** Prefer cache. May wait up to CALL_ICE_BUDGET_MS once. Prefer iceNow() for offers. */
async function getIceServers(){
  const hit = iceFromCache();
  if(hit) return hit;
  const turn = fetchTurnServers();
  const raced = await Promise.race([
    turn,
    new Promise(function(resolve){
      setTimeout(function(){ resolve(RTC_CONFIG); }, CALL_ICE_BUDGET_MS);
    }),
  ]);
  turn.then(function(cfg){
    if(cfg && cfg.iceServers && cfg.iceServers.length > 2){
      cachedIceServers = cfg;
      cachedIceServersAt = Date.now();
    }
  }).catch(function(){});
  return raced || RTC_CONFIG;
}

function prewarmIceServers(){
  fetchTurnServers().catch(function(){});
}

const IceCore = {
  get: getIceServers,
  now: iceNow,
  prewarm: prewarmIceServers,
  stunOnly: function(){ return RTC_CONFIG; },
  cached: iceFromCache,
  invalidate: function(){ cachedIceServers = null; cachedIceServersAt = 0; },
};
