/* 12c — lives whose host is gone.

   While a host is really on air, their phone writes a camera still to
   broadcasts/{id}/livePreview/frame every 2 s (js/live-preview.js), and going
   live needs the camera. When the host's phone dies or Naluno is killed,
   nothing ends the live, so it used to stay "live" for ever.

   Every 10 minutes (the worker's cron), for each Broadcast marked live:
   - running:  a still in the last LIVE_QUIET_MS. Nothing to do.
   - dropped:  no still for LIVE_QUIET_MS. The creator gets a LIMELIGHT, once
               per drop: a push "Your live dropped — open Naluno to carry on",
               and the app shows a card with Resume live / End live. The live
               stays up until LIVE_LIMELIGHT_MS after its last still.
   - expired:  no still for LIVE_LIMELIGHT_MS. The live is stopped exactly as
               the End live button stops it (live false, "was live for …"),
               and its preview still and viewer sessions are cleared.

   Time of the last still: the server's own write time of the frame document
   (no phone clock involved); without a still, when the live started.
   The writes carry a precondition on the Broadcast's update time, so a
   creator who resumes at the same moment is never overwritten. */

export const LIVE_QUIET_MS = 2 * 60 * 1000;
export const LIVE_LIMELIGHT_MS = 15 * 60 * 1000;

function num(v) { const n = Number(v); return isFinite(n) && n > 0 ? n : 0; }

/* b: the Broadcast; frame: { from, at, serverAt } or null; now: ms. */
export function liveDropState(b, frame, now) {
  const row = b || {};
  const creator = String(row.creatorUid || "");
  const f = frame && (!creator || String(frame.from || "") === creator) ? frame : null;
  const fromFrame = f ? (num(f.serverAt) || num(f.at)) : 0;
  const lastAt = Math.max(fromFrame, num(row.liveAt), num(row.liveResumedAt));
  if (!lastAt) return { state: "expired", lastAt: 0, endsAt: 0 };
  const quiet = now - lastAt;
  const endsAt = lastAt + LIVE_LIMELIGHT_MS;
  if (quiet < LIVE_QUIET_MS) return { state: "running", lastAt, endsAt };
  if (quiet < LIVE_LIMELIGHT_MS) return { state: "dropped", lastAt, endsAt };
  return { state: "expired", lastAt, endsAt };
}

export function formatLiveFor(ms) {
  const m = Math.max(0, Math.round((Number(ms) || 0) / 60000));
  if (m < 1) return "under a minute";
  if (m < 60) return m + (m === 1 ? " minute" : " minutes");
  const h = Math.floor(m / 60), r = m % 60;
  return h + (h === 1 ? " hour" : " hours") + (r ? " " + r + " min" : "");
}

/* The fields End live writes, for a live that stopped at lastAt. */
export function endedLivePatch(b, lastAt, now) {
  const started = num((b || {}).liveAt) || null;
  const ended = num(lastAt) || now;
  return {
    live: false,
    liveAt: null,
    liveBy: null,
    lastLiveStartedAt: started,
    lastLiveEndedAt: ended,
    lastLiveDurationMs: started ? Math.max(0, ended - started) : null,
    liveEndReason: "host-gone",
    liveDroppedAt: null,
    liveDroppedNotifiedAt: null,
    liveLimelightUntil: null,
    updatedAt: now,
  };
}

/* io: {
     liveBroadcasts() -> [{ id, data, updateTime }],
     frame(id) -> { from, at, serverAt } | null,
     patch(id, fields, updateTime) -> bool,
     clearFrame(id), clearSessions(id),
     say(id, message), name(uid) -> string,
     push(uid, data) -> any } */
/* 13a: the phase's live limits (launch.mjs media.live): how long one live
   may run (0 = no limit) and how many lives one creator may run at once.
   A live past either is stopped like End live, with its reason. */
export function overLimit(rows, limits, now) {
  const out = {};
  const L = limits || {};
  const maxSec = Number(L.maxLiveSec) || 0;
  const maxAt = Number(L.maxSimultaneous) || 0;
  const byCreator = {};
  (rows || []).forEach(function (r) {
    const b = r.data || {};
    if (b.live !== true) return;
    if (maxSec > 0 && num(b.liveAt) && now - num(b.liveAt) > maxSec * 1000) out[r.id] = "time-limit";
    const c = String(b.creatorUid || "");
    (byCreator[c] = byCreator[c] || []).push(r);
  });
  if (maxAt > 0) {
    Object.keys(byCreator).forEach(function (c) {
      const list = byCreator[c].filter(function (r) { return !out[r.id]; })
        .sort(function (a, b) { return num(a.data.liveAt) - num(b.data.liveAt); });
      list.slice(maxAt).forEach(function (r) { out[r.id] = "too-many-lives"; });
    });
  }
  return out;
}

export async function sweepLives(io, now, limits) {
  const out = { checked: 0, running: 0, dropped: 0, notified: 0, ended: 0, skipped: 0, limited: 0 };
  const rows = (await io.liveBroadcasts()) || [];
  const over = overLimit(rows, limits, now);
  for (const row of rows) {
    const b = row.data || {};
    if (b.live !== true) continue;
    out.checked++;
    if (over[row.id]) {
      const patch = endedLivePatch(b, now, now);
      patch.liveEndReason = over[row.id];
      const ok = await io.patch(row.id, patch, row.updateTime);
      if (!ok) { out.skipped++; continue; }
      out.limited++;
      try { await io.clearFrame(row.id); } catch (_) {}
      try { await io.clearSessions(row.id); } catch (_) {}
      try {
        const who = (await io.name(String(b.creatorUid || ""))) || "The creator";
        await io.say(row.id, {
          type: "system", kind: "was_live", durationMs: patch.lastLiveDurationMs,
          text: who + " was live" + (patch.lastLiveDurationMs != null ? " for " + formatLiveFor(patch.lastLiveDurationMs) : "") + (over[row.id] === "time-limit" ? " (the live time limit)." : "."),
          from: String(b.creatorUid || ""), ts: now,
        });
      } catch (_) {}
      continue;
    }
    let frame = null;
    try { frame = await io.frame(row.id); } catch (_) { out.skipped++; continue; }
    const st = liveDropState(b, frame, now);
    if (st.state === "running") {
      out.running++;
      if (b.liveDroppedAt) await io.patch(row.id, { liveDroppedAt: null, liveDroppedNotifiedAt: null, liveLimelightUntil: null }, row.updateTime);
      continue;
    }
    if (st.state === "dropped") {
      out.dropped++;
      if (num(b.liveDroppedNotifiedAt) >= st.lastAt) continue; // already told about this drop
      const ok = await io.patch(row.id, { liveDroppedAt: st.lastAt, liveDroppedNotifiedAt: now, liveLimelightUntil: st.endsAt }, row.updateTime);
      if (!ok) { out.skipped++; continue; }
      const mins = Math.max(1, Math.round((st.endsAt - now) / 60000));
      try {
        await io.push(String(b.creatorUid || ""), {
          type: "live_dropped",
          broadcastId: row.id,
          title: "Your live dropped",
          body: "“" + String(b.title || "Your live").slice(0, 60) + "” stopped sending. Open Naluno within " + mins + " min to carry on, or it ends.",
          url: "/app/?broadcast=" + encodeURIComponent(row.id),
        });
        out.notified++;
      } catch (_) { /* the card in the app still shows */ }
      continue;
    }
    const patch = endedLivePatch(b, st.lastAt, now);
    const ok = await io.patch(row.id, patch, row.updateTime);
    if (!ok) { out.skipped++; continue; }
    out.ended++;
    try { await io.clearFrame(row.id); } catch (_) {}
    try { await io.clearSessions(row.id); } catch (_) {}
    try {
      const who = (await io.name(String(b.creatorUid || ""))) || "The creator";
      const dur = patch.lastLiveDurationMs != null ? " for " + formatLiveFor(patch.lastLiveDurationMs) : "";
      await io.say(row.id, {
        type: "system",
        kind: "was_live",
        durationMs: patch.lastLiveDurationMs,
        text: who + " was live" + dur + ".",
        from: String(b.creatorUid || ""),
        ts: now,
      });
    } catch (_) {}
  }
  return out;
}
