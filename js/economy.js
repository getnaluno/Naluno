/* ============================================================
   MODULE: js/economy.js
   Client side of the Naluno Community Economy.

   This file REPORTS ACTIONS. It does not compute, hold, or transmit any
   economic value (spec §3, §45). There is deliberately no code here that
   can produce a point, a balance, a trust score or an eligibility decision —
   the naluno-economy Worker owns all of that, and firestore.rules denies
   every client write to the economy collections so this file could not
   cheat even if it were rewritten by an attacker.

   THE MOST IMPORTANT PROPERTY OF THIS FILE (spec §47, §48):
   Broadcast must keep working perfectly if the economy service is slow,
   broken, or entirely switched off. So every call here is fire-and-forget:
   nothing awaits it, nothing branches on its result, and every failure path
   ends in a silent local queue rather than a thrown error or a toast. If
   this whole module failed to load, Broadcast would behave exactly as it
   does today.
   ============================================================ */

const ECONOMY_WORKER_URL = 'https://naluno-economy.naluno.workers.dev';

/* Feature flags are fetched once and cached. Until they arrive we assume the
   conservative default: engagement tracking on, ALL money features off
   (spec §28/§58) — so a slow flag fetch can never briefly expose an
   unfinished monetary feature. */
let nalunoEconomyFlags = {
  broadcast_enabled: true,
  contribution_enabled: true,
  community_value_enabled: true,
  creator_support_enabled: false,
  community_rewards_enabled: false,
  real_payouts_enabled: false,
};
let nalunoEconomyFlagsLoaded = false;

function nalunoEconomyFlag(name){
  return !!nalunoEconomyFlags[name];
}

async function loadEconomyFlags(){
  if(nalunoEconomyFlagsLoaded) return nalunoEconomyFlags;
  try{
    const res = await fetch(ECONOMY_WORKER_URL + '/v1/flags');
    if(res.ok){
      const body = await res.json();
      if(body && body.flags) nalunoEconomyFlags = Object.assign({}, nalunoEconomyFlags, body.flags);
    }
  }catch(_){ /* offline or worker down — keep the safe defaults */ }
  nalunoEconomyFlagsLoaded = true;
  try{ document.body.classList.toggle('naluno-support-on', nalunoEconomyFlag('creator_support_enabled')); }catch(_){}
  return nalunoEconomyFlags;
}

/* ---------------- Offline queue ----------------
   An engagement event is small and not urgent, but it also shouldn't be lost
   just because the phone was on a lift at that moment. Queued locally and
   flushed opportunistically. Bounded so it can never grow without limit. */

const ECON_QUEUE_KEY = 'nalunoEconomyQueue';
const ECON_QUEUE_MAX = 200;

function econQueueRead(){
  try{ return JSON.parse(localStorage.getItem(ECON_QUEUE_KEY) || '[]'); }
  catch(_){ return []; }
}
function econQueueWrite(rows){
  try{ localStorage.setItem(ECON_QUEUE_KEY, JSON.stringify(rows.slice(-ECON_QUEUE_MAX))); }catch(_){}
}
function econQueuePush(payload){
  const q = econQueueRead();
  q.push(payload);
  econQueueWrite(q);
}

/** Client-generated idempotency key (spec §44). The same id is reused on
 *  every retry of the same action, so a flaky connection can never turn one
 *  comment into three contributions. */
function nalunoEventId(){
  try{
    if(crypto && crypto.randomUUID) return 'evt_' + crypto.randomUUID();
  }catch(_){}
  return 'evt_' + Date.now() + '_' + Math.random().toString(36).slice(2, 12);
}

async function econPost(payload){
  if(typeof currentUser === 'undefined' || !currentUser) return false;
  const idToken = await currentUser.getIdToken(false);
  const res = await fetch(ECONOMY_WORKER_URL + '/v1/events', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + idToken, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if(!res.ok) throw new Error('economy ' + res.status);
  return true;
}

let econFlushing = false;
async function flushEconomyQueue(){
  if(econFlushing) return;
  if(typeof currentUser === 'undefined' || !currentUser) return;
  if(typeof navigator !== 'undefined' && navigator.onLine === false) return;
  const q = econQueueRead();
  if(!q.length) return;
  econFlushing = true;
  const remaining = [];
  for(const payload of q){
    try{ await econPost(payload); }
    catch(_){ remaining.push(payload); }
  }
  econQueueWrite(remaining);
  econFlushing = false;
}

/* ---------------- The one function the rest of the app calls ----------------

   nalunoTrack('BROADCAST_COMMENT', { broadcast_id, target_id, creator_uid, text })

   Returns nothing useful ON PURPOSE. No caller should ever branch on the
   result of an economy call — that's what keeps Broadcast independent of it
   (spec §48). Note what is NOT accepted here: no points, no multiplier, no
   balance. The Worker derives all of that, and ignores anything score-shaped
   that turns up in the body anyway. */
function nalunoTrack(eventType, detail){
  try{
    if(!nalunoEconomyFlag('contribution_enabled')) return;
    if(typeof currentUser === 'undefined' || !currentUser) return;
    const d = detail || {};
    const payload = {
      event_id: d.event_id || nalunoEventId(),
      event_type: eventType,
      target_type: d.target_type || '',
      target_id: d.target_id || '',
      broadcast_id: d.broadcast_id || '',
      parent_event_id: d.parent_event_id || null,
      creator_uid: d.creator_uid || '',
      session_id: nalunoEconomySessionId(),
      // Text is sent so the Worker can judge quality (spec §9). It is judged
      // there, never here — the client has no say in what it's worth.
      text: typeof d.text === 'string' ? d.text.slice(0, 2000) : '',
      client_ts: Date.now(),
    };
    // Fire and forget. A failure queues silently; it never surfaces to the
    // person and never interrupts what they were actually doing.
    econPost(payload).catch(function(){ econQueuePush(payload); });
  }catch(_){ /* economy must never throw into a UI path */ }
}

let __econSessionId = '';
function nalunoEconomySessionId(){
  if(__econSessionId) return __econSessionId;
  try{
    __econSessionId = sessionStorage.getItem('nalunoEconSession') || '';
    if(!__econSessionId){
      __econSessionId = 'ses_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      sessionStorage.setItem('nalunoEconSession', __econSessionId);
    }
  }catch(_){
    __econSessionId = 'ses_' + Date.now().toString(36);
  }
  return __econSessionId;
}

/** This user's own contribution summary, for the dashboard (spec §36).
 *  Read-only, server-computed, and safe to fail — callers render nothing
 *  rather than a wrong number. */
async function fetchMyContribution(){
  try{
    if(typeof currentUser === 'undefined' || !currentUser) return null;
    const idToken = await currentUser.getIdToken(false);
    const res = await fetch(ECONOMY_WORKER_URL + '/v1/me', {
      headers: { 'Authorization': 'Bearer ' + idToken },
    });
    if(!res.ok) return null;
    return await res.json();
  }catch(_){ return null; }
}

/** Community Value for one Broadcast. Explicitly NOT money (spec §16) — the
 *  response carries is_monetary:false and the UI must present it as a
 *  measurement, never as a currency amount. */
async function fetchCommunityValue(broadcastId){
  try{
    if(!broadcastId) return null;
    const res = await fetch(ECONOMY_WORKER_URL + '/v1/value/' + encodeURIComponent(broadcastId));
    if(!res.ok) return null;
    return await res.json();
  }catch(_){ return null; }
}

/* Boot: load flags, drain anything queued from a previous session, and retry
   on reconnect. All non-blocking. */
(function initEconomy(){
  try{
    loadEconomyFlags();
    setTimeout(flushEconomyQueue, 4000);
    window.addEventListener('online', function(){ setTimeout(flushEconomyQueue, 1200); });
    document.addEventListener('visibilitychange', function(){
      if(!document.hidden) setTimeout(flushEconomyQueue, 1500);
    });
  }catch(_){}
})();

window.nalunoTrack = nalunoTrack;
window.nalunoEconomyFlag = nalunoEconomyFlag;
window.fetchMyContribution = fetchMyContribution;
window.fetchCommunityValue = fetchCommunityValue;
