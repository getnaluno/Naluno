/* 14 Oct — an ad's counters move only through the worker.

   Any signed-in account could raise impressions, clicks, skips and
   completed views of a live ad by one per write, as often as it liked.
   Booked money is those counters times the rate card, so a script could
   invent ad revenue or spend a paid campaign to nothing.

   Now the phone tells the worker what happened (POST /v1/ads/event
   { adId, kind }) and the worker counts it at most once per person, ad and
   kind in a window: the window's marker document is created only if it does
   not exist (adEvents/{uid}_{adId}_{kind}_{window}), and the counter moves
   by one in the same commit. A repeat inside the window does nothing. The
   rules no longer let a member write the counters at all.

   io: { getAd(id) -> ad|null, countOnce(markerId, adId, field, marker) -> bool } */

export const AD_WINDOWS = {
  impression: 30 * 60 * 1000,   // one impression per person per ad per half hour
  view: 30 * 60 * 1000,         // a completed view, likewise
  skip: 30 * 60 * 1000,
  click: 24 * 3600 * 1000,      // one click per person per ad per day
};
const FIELD = { impression: "impressions", view: "viewCompletes", skip: "skips", click: "clicks" };

export async function countAdEvent(io, uid, body, now) {
  const adId = String((body && body.adId) || "");
  const kind = String((body && body.kind) || "");
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(adId)) return { status: 400, body: { ok: false, error: "bad ad" } };
  if (!FIELD[kind]) return { status: 400, body: { ok: false, error: "bad kind" } };
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(String(uid || ""))) return { status: 401, body: { ok: false, error: "sign in" } };
  const ad = await io.getAd(adId);
  if (!ad || ad.status !== "live") return { status: 200, body: { ok: true, counted: false, reason: "not live" } };
  if (String(ad.creatorUid || "") === uid) return { status: 200, body: { ok: true, counted: false, reason: "own ad" } };
  const window = Math.floor(now / AD_WINDOWS[kind]);
  const marker = uid + "_" + adId + "_" + kind + "_" + window;
  const counted = await io.countOnce(marker, adId, FIELD[kind], { uid, adId, kind, at: now });
  return { status: 200, body: { ok: true, counted: !!counted } };
}
