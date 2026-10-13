/* 14 Oct — "X is live" alerts, sent by the worker, not the creator's phone.

   The phone used to read up to 80 Circle members, the Broadcast's members
   and its contacts, cut the list at 120, and write a notification and a
   push for each one itself, at the moment the camera came on. Everyone past
   120 was never told, and the open notification rule that allowed it let
   any account write into anyone's inbox.

   Now the phone asks once (POST /v1/live/alert) and the worker pages the
   audience itself, a batch at a time:
     1. the Broadcast's members (memberUids),
     2. the creator's connections (users/{creator}/connections),
     3. the creator's Circle (users/{creator}/circle).
   Each person's notification has a fixed id for this live
   (live_{broadcastId}_{liveAt}) and is created only if it does not exist,
   so a person in two lists, a retried batch, or the cron finishing the job
   never tells anyone twice. Where it stopped is kept on the Broadcast
   (liveAlert), and the 10-minute cron finishes a list the phone did not.

   io: {
     listPage(kind, creatorUid, after, size) -> { ids: [uid], next: token|'' }
     notifyOnce(uid, docId, payload) -> true when created (false if it existed)
     push(uid, data) -> any
     patch(broadcastId, fields, updateTime) -> bool
   } */

export const LIVE_ALERT_BATCH = 20;
const PHASES = ["members", "connections", "circle"];

function okId(s) { return /^[A-Za-z0-9_-]{1,128}$/.test(String(s || "")); }

export function liveAlertKey(b) {
  const at = Number(b && b.liveAt);
  return isFinite(at) && at > 0 ? String(Math.round(at)) : "";
}

/* One batch. row: { id, data, updateTime }. Returns { sent, done, state }. */
export async function alertLiveBatch(io, row, now, size) {
  const b = (row && row.data) || {};
  const bid = String((row && row.id) || "");
  const creator = String(b.creatorUid || "");
  const key = liveAlertKey(b);
  if (b.live !== true || !okId(bid) || !okId(creator) || !key) return { sent: 0, done: true, reason: "not-live" };
  const prev = (b.liveAlert && typeof b.liveAlert === "object") ? b.liveAlert : {};
  let st = (prev.for === key) ? { for: key, phase: String(prev.phase || "members"), after: String(prev.after || ""), done: !!prev.done, sent: Number(prev.sent) || 0 }
    : { for: key, phase: "members", after: "", done: false, sent: 0 };
  if (st.done) return { sent: 0, done: true, state: st };
  const want = Math.max(1, Math.min(100, Number(size) || LIVE_ALERT_BATCH));
  const title = String(b.title || "Broadcast").slice(0, 80);
  const fromName = String(b.creatorName || "Someone").slice(0, 60);
  const payload = {
    type: "broadcast_live", fromUid: creator, fromName: fromName, broadcastId: bid,
    title: title, createdAt: now, read: false, by: "worker",
  };
  const data = {
    type: "broadcast_live", broadcastId: bid, fromUid: creator, fromName: fromName,
    title: "Live on Naluno", body: (fromName + " is live: " + title).slice(0, 140),
    url: "/app/?broadcast=" + encodeURIComponent(bid),
  };
  const docId = "live_" + bid + "_" + key;
  let sent = 0;
  let handled = 0;
  let turns = 0;
  while (handled < want && !st.done && turns++ < 12) {
    let ids = [];
    let next = "";
    if (st.phase === "members") {
      const all = Array.isArray(b.memberUids) ? b.memberUids.map(String) : [];
      const from = Number(st.after) || 0;
      ids = all.slice(from, from + (want - handled));
      next = (from + ids.length < all.length) ? String(from + ids.length) : "";
    } else {
      const page = await io.listPage(st.phase, creator, st.after, want - handled);
      ids = (page && page.ids) || [];
      next = (page && page.next) || "";
    }
    for (const uid of ids) {
      handled++;
      if (!okId(uid) || uid === creator) continue;
      let fresh = false;
      try { fresh = await io.notifyOnce(uid, docId, payload); } catch (_) { fresh = false; }
      if (!fresh) continue;   // already told (another list, an earlier batch)
      sent++;
      try { await io.push(uid, data); } catch (_) { /* the in-app notice is there */ }
    }
    if (next) { st.after = next; continue; }
    const at = PHASES.indexOf(st.phase);
    if (at < 0 || at === PHASES.length - 1) { st.done = true; st.after = ""; }
    else { st.phase = PHASES[at + 1]; st.after = ""; }
    if (!ids.length && handled >= want) break;
  }
  st.sent = (st.sent || 0) + sent;
  st.at = now;
  // Only the liveAlert field is written (viewers and reactions change the
  // Broadcast all the time; a precondition would lose the place).
  try { await io.patch(bid, { liveAlert: st }); } catch (_) {}
  return { sent: sent, done: st.done, state: st };
}
