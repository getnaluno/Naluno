/* ============================================================
   MODULE: js/sfu-live.js
   Broadcast live for more than 12 viewers.
   The phone asks Naluno to open a room. If that room is not connected,
   these functions return null and the direct mesh (12 viewers) is used.
   The room secret never comes back to the phone.
   1:1 calls are not this module.
   ============================================================ */

function sfuWorker() {
  try {
    if (typeof ECONOMY_UI_WORKER === 'string' && ECONOMY_UI_WORKER) return ECONOMY_UI_WORKER;
  } catch (_) {}
  return 'https://naluno-economy.naluno.workers.dev';
}

function sfuIsConfigured() {
  return true;
}

function sfuLiveMaxViewers() {
  try {
    if (window.__nalunoSfuLiveHandle) return 100000;
  } catch (_) {}
  return 12;
}

function sfuOrMeshViewerCap() {
  return sfuLiveMaxViewers();
}

async function sfuPost(path, body) {
  if (typeof currentUser === 'undefined' || !currentUser) return null;
  const token = await currentUser.getIdToken(false);
  const res = await fetch(sfuWorker() + path, {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  const data = await res.json().catch(function () { return {}; });
  if (!res.ok || !data || !data.ok) return null;
  return data;
}

async function sfuPublishLive(opts) {
  opts = opts || {};
  if (!opts.stream || !opts.broadcastId) return null;
  let pc = null;
  try {
    pc = new RTCPeerConnection({ bundlePolicy: 'max-bundle', rtcpMuxPolicy: 'require' });
    opts.stream.getTracks().forEach(function (track) { pc.addTrack(track, opts.stream); });
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    const data = await sfuPost('/v1/live/host', {
      broadcastId: opts.broadcastId,
      sdp: offer.sdp,
      type: offer.type,
    });
    if (!data || !data.sdp) {
      try { pc.close(); } catch (_) {}
      return null;
    }
    await pc.setRemoteDescription({ type: data.type || 'answer', sdp: data.sdp });
    const broadcastId = opts.broadcastId;
    return {
      leave: async function () {
        try { pc.close(); } catch (_) {}
        try { await sfuPost('/v1/live/end', { broadcastId: broadcastId }); } catch (_) {}
      },
    };
  } catch (_) {
    try { if (pc) pc.close(); } catch (__) {}
    return null;
  }
}

async function sfuJoinLive(opts) {
  opts = opts || {};
  if (!opts.broadcastId) return null;
  let pc = null;
  try {
    const data = await sfuPost('/v1/live/watch', { broadcastId: opts.broadcastId });
    if (!data || !data.sdp || !data.sessionId) return null;
    pc = new RTCPeerConnection({ bundlePolicy: 'max-bundle', rtcpMuxPolicy: 'require' });
    const remote = new MediaStream();
    pc.ontrack = function (ev) {
      if (ev.streams && ev.streams[0]) {
        ev.streams[0].getTracks().forEach(function (t) {
          if (!remote.getTracks().some(function (x) { return x.id === t.id; })) remote.addTrack(t);
        });
      } else if (ev.track) {
        remote.addTrack(ev.track);
      }
      const v = opts.videoEl || document.getElementById('bspaceViewerLiveVideo');
      if (v) {
        v.srcObject = remote;
        v.play && v.play().catch(function () {});
      }
    };
    await pc.setRemoteDescription({ type: data.type || 'offer', sdp: data.sdp });
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    const sent = await sfuPost('/v1/live/answer', {
      sessionId: data.sessionId,
      sdp: answer.sdp,
      type: answer.type,
    });
    if (!sent) {
      try { pc.close(); } catch (_) {}
      return null;
    }
    return {
      leave: function () { try { pc.close(); } catch (_) {} },
    };
  } catch (_) {
    try { if (pc) pc.close(); } catch (__) {}
    return null;
  }
}
