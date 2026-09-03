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
      const idToken = await currentUser.getIdToken();
      const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      // Abort starts AFTER the token so a slow getIdToken cannot kill the fetch.
      const kill = ctrl ? setTimeout(function(){ try{ ctrl.abort(); }catch(_){ } }, 2500) : null;
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
    if(cfg && cfg.iceServers && cfg.iceServers.some(function(s){
      return String((s && (s.urls || s.url)) || '').indexOf('turn:') >= 0;
    })){
      cachedIceServers = cfg;
      cachedIceServersAt = Date.now();
    }
  }).catch(function(){});
  return raced || RTC_CONFIG;
}

/** FIX ("live video feed doesn't go through"): iceNow() — the 0ms path — never
 *  makes a network attempt at all; it only returns real TURN servers if an
 *  EARLIER, separate fetch already completed and cached them. Broadcast-live's
 *  join flow called prewarmIceServers() (fire-and-forget) and then, on the very
 *  next line, built the RTCPeerConnection with iceNow() — no realistic amount
 *  of time for that fetch to land, so it fell back to STUN-only almost every
 *  single time. Without TURN, WebRTC can only connect two peers directly —
 *  which fails outright on most real mobile/cellular networks (carrier-grade
 *  NAT) and many restrictive WiFi networks, producing exactly this symptom:
 *  signaling completes, "connected" may even fire, but no media ever flows.
 *  This actually waits for a real attempt, with a budget generous enough to
 *  usually land it (unlike the 250ms call-ring budget above, live-join
 *  already shows a "Connecting…" state, so correctness matters more here
 *  than shaving off a second). */
const LIVE_ICE_BUDGET_MS = 3500;
async function getIceServersPatient(budgetMs){
  const hit = iceFromCache();
  if(hit) return hit;
  const turn = fetchTurnServers();
  const raced = await Promise.race([
    turn,
    new Promise(function(resolve){
      setTimeout(function(){ resolve(null); }, budgetMs || LIVE_ICE_BUDGET_MS);
    }),
  ]);
  function hasTurn(cfg){
    return !!(cfg && cfg.iceServers && cfg.iceServers.some(function(s){
      return String((s && (s.urls || s.url)) || '').indexOf('turn:') >= 0;
    }));
  }
  if(hasTurn(raced)) return raced;
  // STUN-only is not a win for live — keep waiting a little more
  const late = await Promise.race([
    turn,
    new Promise(function(resolve){ setTimeout(function(){ resolve(null); }, 1200); }),
  ]);
  if(hasTurn(late)) return late;
  if(raced) return raced;
  // Budget ran out — give the fetch a little more room in the background
  // (it may still land and get cached for the NEXT connection this session,
  // e.g. the host's per-viewer connections after this first one) rather than
  // abandoning it outright, but don't make this call wait any longer.
  turn.then(function(cfg){
    if(hasTurn(cfg)){
      cachedIceServers = cfg;
      cachedIceServersAt = Date.now();
    }
  }).catch(function(){});
  return RTC_CONFIG;
}

function prewarmIceServers(){
  fetchTurnServers().catch(function(){});
}

const IceCore = {
  get: getIceServers,
  getPatient: getIceServersPatient,
  now: iceNow,
  prewarm: prewarmIceServers,
  stunOnly: function(){ return RTC_CONFIG; },
  cached: iceFromCache,
  invalidate: function(){ cachedIceServers = null; cachedIceServersAt = 0; },
};
