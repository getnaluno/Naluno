/* ============================================================
   MODULE: js/sfu-live.js
   Broadcast LIVE scale path (Phase 2 of scale order).
   1:1 calls.js is NEVER used here.

   Mode:
   - If window.NALUNO_SFU is configured (url + token endpoint), use SFU client path.
   - Otherwise fall back to existing mesh in broadcast-live.js (≤12 viewers).

   For 100k+ concurrent viewers you MUST provision a real SFU
   (LiveKit / Cloudflare Calls / Daily / mediasoup) and set:
     window.NALUNO_SFU = {
       enabled: true,
       // Provider-specific; filled when you have keys
       provider: 'livekit', // or 'cloudflare' | 'custom'
       url: '',             // wss://... or https token API
       getToken: async function({ roomName, uid, role }){ return { token, url }; }
     };

   This module only defines the contract + feature detection so mesh
   and SFU can coexist without breaking modules.
   ============================================================ */

function sfuIsConfigured(){
  try{
    const c = window.NALUNO_SFU;
    return !!(c && c.enabled && typeof c.getToken === 'function');
  }catch(_){ return false; }
}

function sfuLiveMaxViewers(){
  // Mesh hard limit stays in broadcast-live.js; SFU has no small hard cap client-side
  return sfuIsConfigured() ? 100000 : 12;
}

/**
 * Publish local media into an SFU room for a broadcast live session.
 * Returns a handle with { leave } or null if SFU not configured (caller uses mesh).
 */
async function sfuPublishLive(opts){
  if(!sfuIsConfigured()) return null;
  const roomName = opts.roomName || ('bcast_' + (opts.broadcastId || 'x'));
  const role = 'host';
  const creds = await window.NALUNO_SFU.getToken({
    roomName: roomName,
    uid: (typeof currentUser !== 'undefined' && currentUser) ? currentUser.uid : 'anon',
    role: role,
  });
  trackMetric && trackMetric('sfu_publish_start', { room: roomName });
  // Provider adapters can be plugged here without touching mesh code.
  if(window.NALUNO_SFU.provider === 'custom' && typeof window.NALUNO_SFU.publish === 'function'){
    const handle = await window.NALUNO_SFU.publish({
      creds: creds,
      stream: opts.stream,
      roomName: roomName,
    });
    trackMetric && trackMetric('sfu_publish_ok', { room: roomName });
    return handle;
  }
  console.warn('[sfu] provider adapter not installed — set NALUNO_SFU.publish or use mesh');
  trackMetric && trackMetric('sfu_publish_fail', { reason: 'no_adapter' });
  return null;
}

/**
 * Viewer joins SFU room; attaches remote media to videoEl.
 * Returns handle { leave } or null → caller falls back to mesh.
 */
async function sfuJoinLive(opts){
  if(!sfuIsConfigured()) return null;
  const roomName = opts.roomName || ('bcast_' + (opts.broadcastId || 'x'));
  const creds = await window.NALUNO_SFU.getToken({
    roomName: roomName,
    uid: (typeof currentUser !== 'undefined' && currentUser) ? currentUser.uid : 'anon',
    role: 'viewer',
  });
  trackMetric && trackMetric('sfu_join_start', { room: roomName });
  if(window.NALUNO_SFU.provider === 'custom' && typeof window.NALUNO_SFU.join === 'function'){
    const handle = await window.NALUNO_SFU.join({
      creds: creds,
      videoEl: opts.videoEl,
      roomName: roomName,
    });
    trackMetric && trackMetric('sfu_join_ok', { room: roomName });
    return handle;
  }
  trackMetric && trackMetric('sfu_join_fail', { reason: 'no_adapter' });
  return null;
}

/** Call from broadcast-live before enforcing mesh cap.
 *  Never raise the cap unless an SFU handle is actually live. */
function sfuOrMeshViewerCap(){
  try{
    if(window.__nalunoSfuLiveHandle) return sfuLiveMaxViewers();
  }catch(_){}
  return 12;
}
