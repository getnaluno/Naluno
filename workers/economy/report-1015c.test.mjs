/* 15 Oct c: the public-feed report. Run: node report-1015c.test.mjs */
import assert from "node:assert/strict";
import test from "node:test";
import { judgeScreenPayload, listingFromScreen, fillRgb, rgbToB64 } from "./screen.mjs";
import { legacyCataloguePatch, feedFillPatch } from "./handler.mjs";

const W = 96, H = 96;
/* A face-sized patch of skin on a dark background: the skin check's middle
   band (hold before 15 Oct). Found by sweeping, see the UPLOAD notes. */
const face = fillRgb(W, H, (x, y, w, h) => { const nx = x / w - 0.5, ny = y / h - 0.45; return (nx * nx + ny * ny < 0.0625) ? [205, 150, 120] : [30, 40, 90]; });
const skinAll = fillRgb(W, H, () => [210, 155, 125]);
const clear = fillRgb(W, H, () => [40, 160, 50]);
const pay = (rgb) => ({ v: 3, w: W, h: H, frames: [{ rgb: rgbToB64(rgb) }] });

test("skin check alone: middle band goes out (was held)", () => {
  const j = judgeScreenPayload(pay(face), { title: "Night walk in Kampala" });
  assert.equal(j.decision, "allow");
  assert.equal(j.engine, "heuristic");
  const l = listingFromScreen({ trusted: true, hasScreen: j.hasScreen, decision: j.decision });
  assert.equal(l.listed, true);
  assert.equal(l.held, false);
  /* not trusted (reported, waiting for the desk) still goes out on an allow, as before */
  assert.equal(listingFromScreen({ trusted: false, hasScreen: true, decision: j.decision }).listed, true);
});
test("skin check alone: its nudity band is still held, never rejected by itself", () => {
  const j = judgeScreenPayload(pay(skinAll), { title: "hello" });
  assert.equal(j.decision, "hold");
  assert.equal(j.reason, "heuristic-only");
  assert.equal(listingFromScreen({ trusted: true, hasScreen: true, decision: j.decision }).held, true);
});
test("skin check alone: a sexual title keeps the middle band held", () => {
  const j = judgeScreenPayload(pay(face), { title: "my nudes" });
  assert.equal(j.decision, "hold");
  assert.equal(listingFromScreen({ trusted: true, hasScreen: true, decision: j.decision }).held, true);
});
test("clear picture still allowed; no picture still unread", () => {
  assert.equal(judgeScreenPayload(pay(clear), { title: "" }).decision, "allow");
  assert.equal(judgeScreenPayload(null).decision, "unread");
  assert.equal(judgeScreenPayload({ v: 3, w: W, h: H, frames: [] }).decision, "unread");
});
test("the detector's verdict still decides when it ran (a hold is kept)", () => {
  /* class 3 = FEMALE_BREAST_EXPOSED in NudeNet's label order */
  const j = judgeScreenPayload({ v: 3, w: W, h: H, frames: [{ rgb: rgbToB64(clear) }], nudenet: { v: 1, frames: [{ d: [[3, 0.5]], p: 0 }] } });
  assert.equal(j.engine, "nudenet");
  assert.notEqual(j.decision, "allow");
});

test("Let out / Restore fill only what the feed needs and is missing", () => {
  const now = 1_800_000_000_000;
  assert.deepEqual(feedFillPatch({ createdAt: now - 5000 }, now), { visibility: "public", publishAt: now - 5000 });
  assert.deepEqual(feedFillPatch({ visibility: "public", publishAt: now - 9 }, now), {});
  /* private stays private (no visibility written) */
  assert.equal("visibility" in feedFillPatch({ visibility: "private", publishAt: now - 9 }, now), false);
  /* a scheduled time is kept */
  assert.equal("publishAt" in feedFillPatch({ visibility: "public", publishAt: now + 86400000 }, now), false);
  /* no time at all, or a future createdAt: a moment in the past */
  assert.equal(feedFillPatch({}, now).publishAt, now - 1000);
  assert.equal(feedFillPatch({ createdAt: now + 60000 }, now).publishAt, now - 1000);
  /* a date-typed publishAt (not a number) is replaced by a number */
  assert.equal(typeof feedFillPatch({ publishAt: "2026-01-01" }, now).publishAt, "number");
});
test("the moderation route never fills from a post it could not read", async () => {
  const src = await import("node:fs").then((fs) => fs.readFileSync(new URL("./handler.mjs", import.meta.url), "utf8"));
  assert.match(src, /if \(row\) Object\.assign\(patch, feedFillPatch\(row, now\)\);/);
});
test("legacy repair: a post with no time of its own uses the document's creation time", () => {
  const now = 1_800_000_000_000;
  assert.equal("publishAt" in (legacyCataloguePatch({ title: "x" }, now) || {}), false);
  const p = legacyCataloguePatch({ title: "x" }, now, now - 86400000);
  assert.equal(p.publishAt, now - 86400000);
  assert.equal(p.visibility, "public");
  /* private, held, taken down, unlisted: still left alone */
  for (const row of [{ visibility: "private" }, { held: true }, { hidden: true }, { listed: false }, { deleted: true }]) {
    assert.equal(legacyCataloguePatch(row, now, now - 1000), null);
  }
  /* a creation time in the future is not used */
  assert.equal("publishAt" in (legacyCataloguePatch({ visibility: "public" }, now, now + 1000) || {}), false);
});
