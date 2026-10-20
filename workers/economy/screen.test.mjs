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
  videoScreenSpots,
} from "./screen.mjs";

const W = 96;
const H = 96;

test("screen version", () => {
  assert.equal(SCREEN_VERSION, 3);
});

test("video samples more than the first still", () => {
  assert.ok(videoScreenSpots(1).length >= 3);
  assert.ok(videoScreenSpots(12).length >= 8);
  assert.ok(videoScreenSpots(12).at(-1) >= 0.9);
});

test("one late sexual still blocks even if earlier stills are clear", () => {
  assert.equal(decideFromHints([0.12, 0.14, 0.18, 0.86]).decision, "block");
});

test("beach swimwear allows", () => {
  const rgb = fillRgb(W, H, (x, y, w, h) => {
    if (y < h * 0.3) {
      const cx = w / 2, cy = h * 0.16, r = w * 0.16;
      if ((x - cx) * (x - cx) + (y - cy) * (y - cy) < r * r) return [210, 160, 130];
      return [80, 165, 225];
    }
    if (x < w * 0.14 || x > w * 0.86) return [35, 110, 45];
    if (y > h * 0.38 && y < h * 0.52 && x > w * 0.32 && x < w * 0.68) return [235, 60, 80];
    if (y > h * 0.86) return [210, 185, 130];
    return [200, 150, 118];
  });
  const d = decideFromHints([hintFromFeatures(featuresFromRgb(rgb, W, H))]);
  assert.equal(d.decision, "allow");
});

test("bedroom close-up blocks", () => {
  const rgb = fillRgb(W, H, (x, y, w, h) => {
    if (y < h * 0.18) return [155, 170, 188];
    return [200, 140, 110];
  });
  const d = decideFromHints([hintFromFeatures(featuresFromRgb(rgb, W, H))]);
  assert.equal(d.decision, "block");
});

test("indoor couple with faces still blocks", () => {
  const rgb = fillRgb(W, H, (x, y, w, h) => {
    const nx = x / w, ny = y / h;
    const h1 = (nx - 0.32) * (nx - 0.32) + (ny - 0.2) * (ny - 0.2);
    const h2 = (nx - 0.64) * (nx - 0.64) + (ny - 0.22) * (ny - 0.22);
    if (h1 < 0.03 || h2 < 0.03) return [210, 160, 130];
    if (ny > 0.32 && ny < 0.82 && nx > 0.16 && nx < 0.84) return [200, 145, 115];
    return [48, 32, 24];
  });
  const d = decideFromHints([hintFromFeatures(featuresFromRgb(rgb, W, H))]);
  assert.equal(d.decision, "block");
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
  /* CHANGED DELIBERATELY (19 Oct e). A flat patch of skin colour is not
     nudity. The skin check never holds and never rejects; only the
     detector's clear findings do. The worker still reads the stills itself
     (the client's word is not what decides) and it says so: engine heuristic. */
  assert.equal(j.engine, "heuristic");
  assert.equal(j.decision, "allow");
  assert.equal(listingFromScreen({ trusted: true, hasScreen: true, decision: j.decision }).listed, true);
});

test("skin colour never holds: light, brown and dark skin, every shade, goes out", () => {
  for (const c of [[240, 205, 180], [210, 155, 125], [150, 95, 60], [105, 65, 40], [70, 42, 28], [45, 28, 20], [30, 20, 14]]) {
    for (const frames of [1, 4]) {
      const fr = [];
      for (let i = 0; i < frames; i++) fr.push({ rgb: rgbToB64(fillRgb(W, H, () => c)) });
      for (const title of ["Family day", "Kampala at night", "Dance"]) {
        const j = judgeScreenPayload({ v: 1, w: W, h: H, frames: fr }, { title });
        assert.equal(j.decision, "allow", JSON.stringify(c) + " x" + frames + " " + title);
        assert.equal(listingFromScreen({ trusted: true, hasScreen: true, decision: j.decision }).listed, true);
      }
    }
  }
});

test("listing: allow goes out, unread goes out, a detector hold waits, block hides even trusted", () => {
  assert.equal(listingFromScreen({ trusted: false, hasScreen: true, decision: "allow" }).listed, true);
  /* 19 Oct e: no reading is not a sign of nudity. */
  assert.equal(listingFromScreen({ trusted: false, hasScreen: false, decision: "unread" }).listed, true);
  assert.equal(listingFromScreen({ trusted: true, hasScreen: false, decision: "unread" }).listed, true);
  /* The only Screen hold: the detector found nudity in one still. */
  const h = listingFromScreen({ trusted: true, hasScreen: true, decision: "hold" });
  assert.equal(h.held, true); assert.equal(h.listed, false); assert.equal(h.heldReason, "screen");
  /* An account the desk stopped still waits — about the account, not the picture. */
  assert.equal(listingFromScreen({ trusted: false, holdReason: "not-trusted", hasScreen: true, decision: "allow" }).held, true);
  const blocked = listingFromScreen({ trusted: true, hasScreen: true, decision: "block" });
  assert.equal(blocked.hidden, true);
  assert.equal(blocked.listed, false);
});
