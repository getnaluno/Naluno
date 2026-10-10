/** How far a video Broadcast may go.
 *  Open: a new Callsign. Kept: the work has stayed up. Full: the desk, or a long record.
 *  Not a phone check and not an identity document. */

const DAY = 24 * 60 * 60 * 1000;

export const REACH_LIMITS = {
  open: { maxSec: 40 * 60, perDay: 3 },
  kept: { maxSec: 3 * 60 * 60, perDay: 3 },
  full: { maxSec: 3 * 60 * 60, perDay: 12 },
};

export function reachTier(profile, now) {
  const p = profile || {};
  const set = String(p.reach || "");
  if (set === "full" || set === "kept" || set === "open") return set;
  const created = Number(p.createdAt) || now;
  const age = Math.max(0, now - created);
  const placed = Number(p.reachPlaced) || 0;
  if (age >= 60 * DAY && placed >= 10) return "full";
  if (age >= 14 * DAY && placed >= 4) return "kept";
  return "open";
}

export function reachLimits(tier) {
  return REACH_LIMITS[tier] || REACH_LIMITS.open;
}

export function reachDayKey(now) {
  return new Date(now).toISOString().slice(0, 10);
}
