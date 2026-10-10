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
  /* The phone still only carries a few direct connections. Everyone else
     watches the one upload. A connected room must not raise that phone cap. */
  return 12;
}

function sfuOrMeshViewerCap() {
  return sfuLiveMaxViewers();
}

async function sfuAsk(path, body, maxMs) {
  if (typeof currentUser === 'undefined' || !currentUser) return { ok: false, code: 'signed-out' };
  const cap = (typeof maxMs === 'number' && maxMs > 0) ? maxMs : 1200;
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const kill = setTimeout(function () { try { if (ctrl) ctrl.abort(); } catch (_) {} }, cap);
  try {
    const token = await currentUser.getIdToken(false);
    const res = await fetch(sfuWorker() + path, {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
      signal: ctrl ? ctrl.signal : undefined,
    });
    clearTimeout(kill);
    const data = await res.json().catch(function () { return {}; });
    if (!res.ok || !data || !data.ok) {
      const code = (data && data.code) || (res.status === 404 ? 'no_room' : 'down');
      try { window.__nalunoSfuCode = code; } catch (_) {}
      return { ok: false, code: code, status: res.status };
    }
    try { window.__nalunoSfuCode = ''; } catch (_) {}
    return data;
  } catch (e) {
    clearTimeout(kill);
    const code = (e && e.name === 'AbortError') ? 'timeout' : 'down';
    try { window.__nalunoSfuCode = code; } catch (_) {}
    return { ok: false, code: code };
  }
}

async function sfuPost(path, body) {
  const data = await sfuAsk(path, body, 8000);
  if (!data || !data.ok) return null;
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
    let desc = offer;
    if (typeof bLiveDescribeWhenReady === 'function') {
      try {
        const ready = await bLiveDescribeWhenReady(pc, 700);
        if (ready && ready.sdp) desc = ready;
      } catch (_) {}
    }
    const data = await sfuAsk('/v1/live/host', {
      broadcastId: opts.broadcastId,
      sdp: desc.sdp,
      type: desc.type,
    }, 8000);
    if (!data || !data.ok || !data.sdp) {
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
    const data = await sfuAsk('/v1/live/watch', { broadcastId: opts.broadcastId }, opts.budgetMs || 1100);
    if (!data || !data.ok || !data.sdp || !data.sessionId) return null;
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
      if (typeof opts.onStream === 'function') {
        try { opts.onStream(remote); } catch (_) {}
      }
      const v = opts.videoEl || document.getElementById('bspaceViewerLiveVideo');
      if (v) {
        v.srcObject = remote;
        if (opts.muted) { try { v.muted = true; } catch (_) {} }
        v.play && v.play().catch(function () {});
      }
    };
    await pc.setRemoteDescription({ type: data.type || 'offer', sdp: data.sdp });
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    const sent = await sfuAsk('/v1/live/answer', {
      sessionId: data.sessionId,
      sdp: answer.sdp,
      type: answer.type,
    }, 2000);
    if (!sent || !sent.ok) {
      try { pc.close(); } catch (_) {}
      return null;
    }
    return {
      leave: function () { try { pc.close(); } catch (_) {} },
      stream: remote,
    };
  } catch (_) {
    try { if (pc) pc.close(); } catch (__) {}
    return null;
  }
}
