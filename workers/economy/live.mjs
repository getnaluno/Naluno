/**
 * Cloudflare Realtime SFU. The app secret never leaves the worker.
 * Viewers receive their own session, not the publisher's.
 */

const rooms = new Map();

export function callsReady(env) {
  return !!(env && env.CF_CALLS_APP_ID && env.CF_CALLS_APP_SECRET);
}

export function rememberRoom(id, row) {
  if (!id || !row) return;
  rooms.set(String(id), row);
}
export function takeRoom(id) {
  return rooms.get(String(id)) || null;
}
export function forgetRoom(id) {
  rooms.delete(String(id));
}

export function midsFromSdp(sdp) {
  const lines = String(sdp || "").split(/\r?\n/);
  const out = [];
  let mid = "";
  let kind = "";
  lines.forEach(function (line) {
    if (line.indexOf("m=") === 0) {
      if (mid) out.push({ mid: mid, kind: kind || "video" });
      kind = line.slice(2).split(" ")[0] || "video";
      mid = "";
    } else if (line.indexOf("a=mid:") === 0) {
      mid = line.slice(6).trim();
    }
  });
  if (mid) out.push({ mid: mid, kind: kind || "video" });
  return out;
}

export function publishTracks(sdp) {
  return midsFromSdp(sdp).map(function (row, i) {
    const kind = row.kind === "audio" ? "audio" : "video";
    return { location: "local", mid: row.mid, trackName: kind + (i > 1 ? String(i) : "") };
  });
}

export async function cfCalls(env, fetchImpl, path, method, body) {
  const root = "https://rtc.live.cloudflare.com/v1/apps/" + encodeURIComponent(env.CF_CALLS_APP_ID);
  const res = await fetchImpl(root + path, {
    method: method || "POST",
    headers: {
      Authorization: "Bearer " + env.CF_CALLS_APP_SECRET,
      "Content-Type": "application/json",
    },
    body: body == null ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(function () { return {}; });
  return { ok: res.ok, status: res.status, data: data || {} };
}
