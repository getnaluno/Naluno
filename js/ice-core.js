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
let cachedIceUid = '';

/* 30d: TURN is kept ready, so a call never waits for it and never starts
   without it.
   - The credentials are kept for this signed-in person across an app
     restart (a call answered from a notification starts a fresh app), for
     20 minutes, inside the 25 minutes they are trusted for.
   - They are fetched again before they run out while Naluno is open, and
     when Naluno comes back to the screen or back online.
   A call on a phone without TURN could not connect on most mobile
   networks, and waited up to 0.6-0.8 s for it before ringing or answering. */
const ICE_STORE_KEY = 'nalunoIceCache';
const ICE_STORE_TTL_MS = 20 * 60 * 1000;
const ICE_REFRESH_AFTER_MS = 18 * 60 * 1000;
function iceUid(){
  try{ return (typeof currentUser !== 'undefined' && currentUser && currentUser.uid) || ''; }catch(_){ return ''; }
}
function iceSave(){
  try{
    if(!cachedIceServers || !cachedIceUid) return;
    localStorage.setItem(ICE_STORE_KEY, JSON.stringify({ uid: cachedIceUid, at: cachedIceServersAt, cfg: cachedIceServers }));
  }catch(_){}
}
function iceLoad(){
  try{
    const raw = localStorage.getItem(ICE_STORE_KEY);
    if(!raw) return;
    const d = JSON.parse(raw);
    if(!d || !d.cfg || !d.cfg.iceServers || !d.uid || typeof d.at !== 'number') return;
    if(Date.now() - d.at >= ICE_STORE_TTL_MS || d.at > Date.now() + 60000){ localStorage.removeItem(ICE_STORE_KEY); return; }
    cachedIceServers = d.cfg;
    cachedIceServersAt = d.at;
    cachedIceUid = d.uid;
  }catch(_){}
}
iceLoad();
let lastIceFailAt = 0;

function iceFromCache(){
  if(cachedIceServers && (Date.now() - cachedIceServersAt) < ICE_CACHE_TTL_MS){
    /* Only this person's credentials. */
    const uid = iceUid();
    if(cachedIceUid && uid && cachedIceUid !== uid) return null;
    return cachedIceServers;
  }
  return null;
}

/** 0ms: cached TURN, else STUN. Never waits. Use this for the first offer. */
function iceNow(){
  return iceFromCache() || RTC_CONFIG;
}

async function fetchTurnServers(force){
  try{
    if(typeof currentUser === 'undefined' || !currentUser) return RTC_CONFIG;
  }catch(_){ return RTC_CONFIG; }

  const hit = force ? null : iceFromCache();
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
        lastIceFailAt = Date.now();
        return RTC_CONFIG;
      }
      const data = await res.json();
      if(!data.iceServers || !data.iceServers.length){
        console.log('[ice] TURN response empty — STUN only');
        lastIceFailAt = Date.now();
        return RTC_CONFIG;
      }
      cachedIceServers = {
        iceServers: data.iceServers,
        iceCandidatePoolSize: 4,
        bundlePolicy: 'max-bundle',
        rtcpMuxPolicy: 'require',
      };
      cachedIceServersAt = Date.now();
      cachedIceUid = iceUid();
      iceSave();
      console.log('[ice] TURN ok —', data.iceServers.length, 'server(s)');
      return cachedIceServers;
    }catch(e){
      console.log('[ice] TURN failed — STUN only', e && e.message);
      lastIceFailAt = Date.now();
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

/* Fetch again before the credentials run out, while Naluno is open. */
function iceKeepWarm(){
  try{
    if(typeof document !== 'undefined' && document.hidden) return;
    if(!iceUid()) return;
    const fresh = iceFromCache() && (Date.now() - cachedIceServersAt) < ICE_REFRESH_AFTER_MS;
    if(fresh || inflightIce) return;
    if(lastIceFailAt && Date.now() - lastIceFailAt < 30000) return;
    /* Still usable ones stay in place until the new ones arrive. */
    fetchTurnServers(true).catch(function(){});
    return;
  }catch(_){}
}
if(typeof window !== 'undefined' && window.addEventListener){
  try{
    setInterval(iceKeepWarm, 60 * 1000);
    window.addEventListener('online', function(){ lastIceFailAt = 0; setTimeout(iceKeepWarm, 800); });
    if(typeof document !== 'undefined') document.addEventListener('visibilitychange', function(){ if(!document.hidden) setTimeout(iceKeepWarm, 300); });
  }catch(_){}
}

const IceCore = {
  get: getIceServers,
  getPatient: getIceServersPatient,
  now: iceNow,
  prewarm: prewarmIceServers,
  stunOnly: function(){ return RTC_CONFIG; },
  cached: iceFromCache,
  invalidate: function(){ cachedIceServers = null; cachedIceServersAt = 0; try{ localStorage.removeItem(ICE_STORE_KEY); }catch(_){} },
  /* True while a TURN fetch is still on its way. */
  pending: function(){ return !!inflightIce; },
  keepWarm: iceKeepWarm,
};
