/* 14 Oct — Discover's shared record (broadcastFeatures), compiled by the
   worker on its cron, a page at a time, instead of by a person pressing a
   button that read at most 24 pages and stopped.

   It reads the events written since the last mark (discoveryConfig/compile
   .lastEventAt), adds them onto each Broadcast's record with the same rules
   the desk used (discover-engine rollup + mergeFeatures), and moves the mark
   in the same commit, so a page is never counted twice and never skipped.

   io: {
     mark() -> { lastEventAt, updateTime }
     events(after, limit) -> [event...] ordered by `at` ascending
     features(ids) -> { id: features|null }
     commit(featureMap, newMark, markUpdateTime) -> bool
   } */
import Engine from "../../js/discover-engine.js";

export const DISCOVER_PAGE = 400;

export async function compileDiscoverPage(io, now, limit) {
  const m = (await io.mark()) || {};
  const since = Number(m.lastEventAt) || 0;
  const size = Math.max(1, Math.min(500, Number(limit) || DISCOVER_PAGE));
  const events = (await io.events(since, size)) || [];
  if (!events.length) return { ok: true, events: 0, broadcasts: 0, more: false };
  /* Events sharing the last time stamp of a full page would be split
     between two pages; keep the page to the earlier stamps. */
  let use = events;
  if (events.length === size) {
    const lastAt = Number(events[events.length - 1].at) || 0;
    const head = events.filter((e) => (Number(e.at) || 0) < lastAt);
    if (head.length) use = head;
  }
  const rolled = Engine.rollup(use);
  const ids = Object.keys(rolled.features || {});
  const prev = ids.length ? (await io.features(ids)) || {} : {};
  const out = {};
  ids.forEach((id) => {
    const feat = Engine.mergeFeatures(prev[id] || null, rolled.features[id]);
    feat.updatedAt = now;
    feat.compiledBy = "worker";
    out[id] = feat;
  });
  const lastAt = use.reduce((x, e) => Math.max(x, Number(e.at) || 0), since);
  const ok = await io.commit(out, lastAt, m.updateTime || "");
  return { ok: !!ok, events: use.length, broadcasts: ids.length, more: events.length === size, lastEventAt: lastAt };
}
