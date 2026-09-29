/**
 * Broadcast views, decided on the server (29g).
 *
 * The phone only reports "I opened this Broadcast" and, later, "count it".
 * The worker keeps the open time itself, reads how many seconds a view needs
 * from economyConfig/viewRules (set in the Control Centre), and counts the
 * view only when that much time has passed on the server's own clock. One
 * view per person per Broadcast: the viewer document is created with a
 * "must not exist" precondition in the same atomic commit as the counters,
 * so a replay or a second phone cannot count twice.
 */

export const VIEW_SEC_DEFAULT = 4;
export const VIEW_SEC_MIN = 1;
export const VIEW_SEC_MAX = 120;
/* An open older than this is stale: open again. */
export const VIEW_OPEN_TTL_MS = 6 * 60 * 60 * 1000;

export function clampViewSec(n) {
  const v = Math.round(Number(n));
  if (!isFinite(v) || v < VIEW_SEC_MIN) return VIEW_SEC_DEFAULT;
  return Math.min(VIEW_SEC_MAX, v);
}

export function viewMonthKey(now) {
  const d = new Date(Number(now) || Date.now());
  return d.getUTCFullYear() + "-" + String(d.getUTCMonth() + 1).padStart(2, "0");
}

export function viewOpenId(uid, broadcastId) {
  return String(uid || "").replace(/[^A-Za-z0-9_-]/g, "") + "_" + String(broadcastId || "").replace(/[^A-Za-z0-9_-]/g, "");
}

export function cleanBroadcastId(raw) {
  const id = String(raw || "");
  if (id.length < 4 || id.length > 120 || !/^[A-Za-z0-9_-]+$/.test(id)) return "";
  return id;
}

/** Should this "count it" call count? */
export function viewDecision(o) {
  const now = Number(o && o.now) || Date.now();
  const need = clampViewSec(o && o.needSec) * 1000;
  if (!o || !o.broadcast) return { error: "not_found" };
  if (o.broadcast.deleted) return { error: "not_found" };
  if (o.uid && o.broadcast.creatorUid && o.uid === o.broadcast.creatorUid) return { error: "own" };
  const opened = Number(o.openedAt) || 0;
  if (!opened) return { error: "not_open" };
  if (now - opened > VIEW_OPEN_TTL_MS) return { error: "not_open" };
  const spent = now - opened;
  if (spent < need) return { wait_ms: need - spent };
  return { count: true, dwell_ms: spent };
}

/** The atomic commit for one counted view. */
export function viewWrites(docRoot, v) {
  const month = viewMonthKey(v.now);
  const viewer = docRoot + "/broadcasts/" + v.broadcastId + "/viewers/" + v.uid;
  const bcast = docRoot + "/broadcasts/" + v.broadcastId;
  const inc = function (path) { return { fieldPath: path, increment: { integerValue: "1" } }; };
  const writes = [
    {
      update: {
        name: viewer,
        fields: {
          ts: { integerValue: String(Math.round(v.now)) },
          dwellMs: { integerValue: String(Math.round(v.dwellMs || 0)) },
          countedBy: { stringValue: "server" },
        },
      },
      currentDocument: { exists: false },
    },
    { transform: { document: bcast, fieldTransforms: [inc("views"), inc("uniqueViews")] } },
  ];
  if (v.creatorUid) {
    const toga = docRoot + "/toga/" + v.creatorUid;
    writes.push({
      update: {
        name: toga,
        fields: {
          monthKey: { stringValue: month },
          featuredBroadcastId: { stringValue: v.broadcastId },
          updatedAt: { integerValue: String(Math.round(v.now)) },
        },
      },
      updateMask: { fieldPaths: ["monthKey", "featuredBroadcastId", "updatedAt"] },
    });
    writes.push({ transform: { document: toga, fieldTransforms: [inc("viewsTotal"), inc("`mv_" + month + "`")] } });
  }
  return writes;
}
