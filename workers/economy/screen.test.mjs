import assert from "node:assert/strict";
import test from "node:test";
import {
  SCREEN_VERSION,
  featuresFromRgb,
  hintFromFeatures,
  decideFromHints,
  judgeScreenPayload,
  listingFromScreen,
  fillRgb,
  rgbToB64,
} from "./screen.mjs";

const W = 96;
const H = 96;

test("screen version", () => {
  assert.equal(SCREEN_VERSION, 1);
});

test("green field allows", () => {
  const rgb = fillRgb(W, H, () => [40, 160, 50]);
  const hint = hintFromFeatures(featuresFromRgb(rgb, W, H));
  const d = decideFromHints([hint]);
  assert.equal(d.decision, "allow");
});

test("smooth skin fill blocks, including darker skin", () => {
  const light = fillRgb(W, H, () => [210, 155, 125]);
  const dark = fillRgb(W, H, () => [110, 70, 48]);
  assert.equal(decideFromHints([hintFromFeatures(featuresFromRgb(light, W, H))]).decision, "block");
  assert.equal(decideFromHints([hintFromFeatures(featuresFromRgb(dark, W, H))]).decision, "block");
});

test("face on a shirt is not blocked", () => {
  const rgb = fillRgb(W, H, (x, y, w, h) => {
    const cx = w / 2, cy = h * 0.22, r = w * 0.18;
    const d = (x - cx) * (x - cx) + (y - cy) * (y - cy);
    if (d < r * r) return [210, 160, 130];
    return [28, 42, 92];
  });
  const d = decideFromHints([hintFromFeatures(featuresFromRgb(rgb, W, H))]);
  assert.notEqual(d.decision, "block");
});

test("mid scores hold", () => {
  assert.equal(decideFromHints([0.45, 0.4]).decision, "hold");
  assert.equal(decideFromHints([]).decision, "unread");
});

test("payload without rgb is unread", () => {
  const j = judgeScreenPayload({ v: 1, decision: "allow", score: 1, frames: [] });
  assert.equal(j.decision, "unread");
  assert.equal(j.hasScreen, false);
});

test("worker re-scores rgb and ignores client allow", () => {
  const rgb = fillRgb(W, H, () => [210, 155, 125]);
  const j = judgeScreenPayload({
    v: 1,
    w: W,
    h: H,
    decision: "allow",
    frames: [{ rgb: rgbToB64(rgb) }],
  });
  assert.equal(j.hasScreen, true);
  assert.equal(j.decision, "block");
});

test("listing: new publisher allow goes out, unread holds, block hides even trusted", () => {
  assert.equal(listingFromScreen({ trusted: false, hasScreen: true, decision: "allow" }).listed, true);
  assert.equal(listingFromScreen({ trusted: false, hasScreen: false, decision: "unread" }).held, true);
  assert.equal(listingFromScreen({ trusted: false, hasScreen: false, decision: "unread" }).heldReason, "new-publisher");
  assert.equal(listingFromScreen({ trusted: false, hasScreen: true, decision: "hold" }).heldReason, "screen");
  const blocked = listingFromScreen({ trusted: true, hasScreen: true, decision: "block" });
  assert.equal(blocked.hidden, true);
  assert.equal(blocked.listed, false);
  assert.equal(listingFromScreen({ trusted: true, hasScreen: false, decision: "unread" }).listed, true);
});
