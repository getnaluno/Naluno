import test from "node:test";
import assert from "node:assert/strict";
import { reachTier, reachLimits } from "./reach.mjs";

const DAY = 24 * 60 * 60 * 1000;
const now = Date.UTC(2026, 9, 10);

test("a new Callsign stays on the short room", () => {
  assert.equal(reachTier({ createdAt: now, reachPlaced: 0 }, now), "open");
  assert.equal(reachLimits("open").maxSec, 40 * 60);
  assert.equal(reachLimits("open").perDay, 3);
});

test("two weeks and four Broadcasts that went out open the length", () => {
  const tier = reachTier({ createdAt: now - 14 * DAY, reachPlaced: 4 }, now);
  assert.equal(tier, "kept");
  assert.equal(reachLimits(tier).maxSec, 3 * 60 * 60);
  assert.equal(reachLimits(tier).perDay, 3);
});

test("a long record opens the full day, and the desk can open or close it", () => {
  assert.equal(reachTier({ createdAt: now - 60 * DAY, reachPlaced: 10 }, now), "full");
  assert.equal(reachLimits("full").perDay, 12);
  assert.equal(reachTier({ createdAt: now - 60 * DAY, reachPlaced: 10, reach: "open" }, now), "open");
  assert.equal(reachTier({ createdAt: now, reachPlaced: 0, reach: "full" }, now), "full");
});
