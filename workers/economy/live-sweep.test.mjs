/* 12c: lives whose host is gone, and publishers trusted until reported. */
import assert from "node:assert/strict";
import fs from "node:fs";
import { liveDropState, sweepLives, endedLivePatch, overLimit, LIVE_QUIET_MS, LIVE_LIMELIGHT_MS } from "./live-sweep.mjs";
import { publisherTrusted, publisherHoldReason, listingFromScreen } from "./screen.mjs";
import { webPushFor } from "./wire-notify.mjs";

const NOW = 1_800_000_000_000;
const MIN = 60000;

/* ---- states ---- */
const b = { creatorUid: "c1", title: "Morning show", live: true, liveAt: NOW - 60 * MIN };
assert.equal(liveDropState(b, { from: "c1", serverAt: NOW - 5000 }, NOW).state, "running");
assert.equal(liveDropState(b, { from: "c1", serverAt: NOW - 3 * MIN }, NOW).state, "dropped");
assert.equal(liveDropState(b, { from: "c1", serverAt: NOW - 16 * MIN }, NOW).state, "expired");
assert.equal(liveDropState(b, { from: "someone-else", serverAt: NOW - 1000 }, NOW).state, "expired", "a still from anyone but the creator is no heartbeat");
assert.equal(liveDropState({ creatorUid: "c1", live: true, liveAt: NOW - 30000 }, null, NOW).state, "running", "just went live, no still yet");
assert.equal(liveDropState({ creatorUid: "c1", live: true, liveAt: NOW - 20 * MIN, liveResumedAt: NOW - MIN }, null, NOW).state, "running", "resumed a minute ago");
assert.equal(liveDropState(b, { from: "c1", serverAt: NOW - 3 * MIN }, NOW).endsAt, NOW - 3 * MIN + LIVE_LIMELIGHT_MS);
assert.ok(LIVE_QUIET_MS < LIVE_LIMELIGHT_MS);

/* ---- the sweep ---- */
function world(rows, frames, opts) {
  const log = { patches: [], pushes: [], said: [], clearedFrame: [], clearedSessions: [] };
  const io = {
    liveBroadcasts: async () => rows.map((r) => ({ id: r.id, data: r.data, updateTime: "t-" + r.id })),
    frame: async (id) => frames[id] || null,
    patch: async (id, f, ut) => { if (opts && opts.conflict === id) return false; log.patches.push({ id, f, ut }); return true; },
    clearFrame: async (id) => { log.clearedFrame.push(id); },
    clearSessions: async (id) => { log.clearedSessions.push(id); },
    say: async (id, m) => { log.said.push({ id, m }); },
    name: async () => "Ama",
    push: async (uid, d) => { log.pushes.push({ uid, d }); return { ok: true }; },
  };
  return { io, log };
}
{
  const rows = [
    { id: "run", data: Object.assign({}, b) },
    { id: "drop", data: Object.assign({}, b) },
    { id: "gone", data: Object.assign({}, b) },
    { id: "told", data: Object.assign({}, b, { liveDroppedNotifiedAt: NOW - 2 * MIN }) },
    { id: "notlive", data: Object.assign({}, b, { live: false }) },
  ];
  const frames = {
    run: { from: "c1", serverAt: NOW - 4000 },
    drop: { from: "c1", serverAt: NOW - 4 * MIN },
    gone: { from: "c1", serverAt: NOW - 20 * MIN },
    told: { from: "c1", serverAt: NOW - 5 * MIN },
  };
  const { io, log } = world(rows, frames);
  const out = await sweepLives(io, NOW);
  assert.deepEqual({ checked: out.checked, running: out.running, dropped: out.dropped, notified: out.notified, ended: out.ended }, { checked: 4, running: 1, dropped: 2, notified: 1, ended: 1 });
  // the limelight: one push, to the creator, for the dropped live only, once per drop
  assert.equal(log.pushes.length, 1);
  assert.equal(log.pushes[0].uid, "c1");
  assert.equal(log.pushes[0].d.type, "live_dropped");
  assert.equal(log.pushes[0].d.broadcastId, "drop");
  assert.match(log.pushes[0].d.body, /within 11 min/);
  const dropPatch = log.patches.find((p) => p.id === "drop").f;
  assert.equal(dropPatch.liveDroppedAt, NOW - 4 * MIN);
  assert.equal(dropPatch.liveLimelightUntil, NOW - 4 * MIN + LIVE_LIMELIGHT_MS);
  assert.ok(!("live" in dropPatch), "a dropped live is not ended during its limelight");
  // expired: ended like End live, with the precondition, and tidied
  const gonePatch = log.patches.find((p) => p.id === "gone");
  assert.equal(gonePatch.ut, "t-gone", "never overwrites a creator who resumed at the same moment");
  assert.equal(gonePatch.f.live, false);
  assert.equal(gonePatch.f.lastLiveEndedAt, NOW - 20 * MIN, "ended at its last still, not at sweep time");
  assert.equal(gonePatch.f.lastLiveDurationMs, 40 * MIN);
  assert.equal(gonePatch.f.liveEndReason, "host-gone");
  assert.deepEqual(log.clearedFrame, ["gone"]);
  assert.deepEqual(log.clearedSessions, ["gone"]);
  assert.equal(log.said[0].m.text, "Ama was live for 40 minutes.");
  assert.equal(log.said[0].m.from, "c1");
  assert.ok(!log.patches.some((p) => p.id === "run" || p.id === "told" || p.id === "notlive"));
}
{
  // a creator who resumed at the same moment: the precondition fails, nothing else happens
  const { io, log } = world([{ id: "gone", data: Object.assign({}, b) }], { gone: { from: "c1", serverAt: NOW - 30 * MIN } }, { conflict: "gone" });
  const out = await sweepLives(io, NOW);
  assert.equal(out.ended, 0);
  assert.equal(log.clearedFrame.length + log.said.length, 0);
}
{
  // a host back on air clears the drop marks
  const { io, log } = world([{ id: "back", data: Object.assign({}, b, { liveDroppedAt: NOW - 6 * MIN }) }], { back: { from: "c1", serverAt: NOW - 1000 } });
  await sweepLives(io, NOW);
  assert.deepEqual(log.patches[0].f, { liveDroppedAt: null, liveDroppedNotifiedAt: null, liveLimelightUntil: null });
}
assert.equal(endedLivePatch({ liveAt: 0 }, 0, NOW).lastLiveEndedAt, NOW);

/* ---- 13a: the phase's live limits ---- */
{
  const rows = [
    { id: "long", data: { live: true, creatorUid: "a", liveAt: NOW - 4 * 3600000 } },
    { id: "ok", data: { live: true, creatorUid: "b", liveAt: NOW - 3600000 } },
    { id: "first", data: { live: true, creatorUid: "c", liveAt: NOW - 30 * MIN } },
    { id: "second", data: { live: true, creatorUid: "c", liveAt: NOW - 10 * MIN } },
  ];
  assert.deepEqual(overLimit(rows, { maxLiveSec: 3 * 3600, maxSimultaneous: 1 }, NOW), { long: "time-limit", second: "too-many-lives" });
  assert.deepEqual(overLimit(rows, { maxLiveSec: 0, maxSimultaneous: 2 }, NOW), {}, "0 = no time limit");
  assert.deepEqual(overLimit(rows, null, NOW), {}, "no limits loaded: nothing is stopped");
  const { io, log } = world(rows.map((r) => ({ id: r.id, data: Object.assign({ title: "t" }, r.data) })), { first: { from: "c", serverAt: NOW - 3000 }, ok: { from: "b", serverAt: NOW - 3000 } }, null);
  const out = await sweepLives(io, NOW, { maxLiveSec: 3 * 3600, maxSimultaneous: 1 });
  assert.equal(out.limited, 2);
  assert.equal(log.patches.find((p) => p.id === "long").f.liveEndReason, "time-limit");
  assert.equal(log.patches.find((p) => p.id === "second").f.liveEndReason, "too-many-lives");
  assert.ok(!log.patches.some((p) => p.id === "first" && p.f.live === false), "the oldest live of that creator keeps running");
}

/* ---- the limelight push on the web ---- */
const wp = webPushFor({ type: "live_dropped", broadcastId: "ab<c>d", title: "Your live dropped", body: "x" });
assert.equal(wp.notification.tag, "naluno-live:abcd", "same tag as the service worker's live alert, id cleaned");
assert.equal(wp.notification.data.url, "/app/?broadcast=abcd");

/* ---- trusted until reported ---- */
assert.equal(publisherTrusted({}), true, "a new account is trusted");
assert.equal(publisherTrusted(null), true);
assert.equal(publisherTrusted({ publisherReview: "pending" }), false, "a report puts trust on hold");
assert.equal(publisherTrusted({ publisherReview: "pending", trustedPublisher: true }), false, "a new report after an earlier yes waits again");
assert.equal(publisherTrusted({ publisherReview: "cleared", trustedPublisher: true }), true);
assert.equal(publisherTrusted({ trustedPublisher: false }), false, "the desk said no");
assert.equal(publisherTrusted({ restricted: true }), false);
assert.equal(publisherTrusted({ suspended: true }), false);
assert.equal(publisherHoldReason({ publisherReview: "pending" }), "under-review");
assert.equal(publisherHoldReason({ trustedPublisher: false }), "not-trusted");
assert.equal(listingFromScreen({ trusted: false, holdReason: "under-review", hasScreen: false }).heldReason, "under-review");
// content checks still apply to everyone
assert.equal(listingFromScreen({ trusted: true, hasScreen: true, decision: "hold" }).held, true);
assert.equal(listingFromScreen({ trusted: true, hasScreen: true, decision: "block" }).hidden, true);

/* ---- a report puts the creator on pending ---- */
const handler = fs.readFileSync(new URL("./handler.mjs", import.meta.url), "utf8");
const rep = handler.slice(handler.indexOf('if (path === "/v1/report"'), handler.indexOf("TAKE IT OUT OF PUBLIC VIEW FIRST"));
assert.match(rep, /publisherReview: "pending"/);
assert.match(rep, /about !== user\.uid/, "nobody can put themselves on pending, and a self-report changes nothing");
assert.match(handler, /const trusted = publisherTrusted\(profile\);/);
const index = fs.readFileSync(new URL("./index.mjs", import.meta.url), "utf8");
assert.match(index, /runLiveSweep\(env\)/, "the sweep runs on the cron");

console.log("live-sweep: all checks passed");
