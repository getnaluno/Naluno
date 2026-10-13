/* 14 Oct audit: live alerts by the worker, ad counters once per person,
   Discover compiled by the worker. Each io is an in-memory stand-in for the
   Firestore calls the handler makes. */
import assert from "node:assert/strict";
import { alertLiveBatch } from "./live-alert.mjs";
import { countAdEvent } from "./ad-events.mjs";
import { compileDiscoverPage } from "./discover-compile.mjs";

/* ---- live alerts ---- */
{
  const notes = new Map();
  const pushes = [];
  let patched = null;
  const lists = {
    connections: ["c1aaaa", "c2aaaa", "both11"],
    circle: Array.from({ length: 130 }, (_, i) => "f" + String(i).padStart(4, "0")).concat(["both11", "creator1"]),
  };
  const io = {
    listPage: async (kind, creator, after, size) => {
      const all = lists[kind] || [];
      const from = Number(after) || 0;
      const ids = all.slice(from, from + size);
      return { ids, next: from + ids.length < all.length ? String(from + ids.length) : "" };
    },
    notifyOnce: async (uid, docId, payload) => { const k = uid + "/" + docId; if (notes.has(k)) return false; notes.set(k, payload); return true; },
    push: async (uid) => { pushes.push(uid); },
    patch: async (id, fields) => { patched = fields.liveAlert; return true; },
  };
  const b = { live: true, liveAt: 1760000000000, creatorUid: "creator1", creatorName: "Ama", title: "Morning", memberUids: ["creator1", "m1aaaa", "both11"] };
  let row = { id: "bcast01", data: b, updateTime: "t" };
  let rounds = 0, done = false, total = 0;
  while (!done && rounds < 40) {
    const r = await alertLiveBatch(io, row, 1, 20);
    total += r.sent; done = r.done; rounds++;
    row = { id: "bcast01", data: Object.assign({}, b, { liveAlert: patched }), updateTime: "t" };
  }
  assert.ok(done, "the whole audience is reached");
  const people = new Set(["m1aaaa", "both11", "c1aaaa", "c2aaaa", ...lists.circle.filter((x) => x !== "creator1")]);
  assert.equal(total, people.size, "everyone once: members, connections and the whole Circle (no cap of 120)");
  assert.equal(pushes.length, people.size);
  assert.ok(!pushes.includes("creator1"), "the creator is not told about their own live");
  assert.equal(new Set(pushes).size, pushes.length, "nobody twice, even when in two lists");
  const again = await alertLiveBatch(io, row, 2, 20);
  assert.equal(again.sent, 0, "a finished list sends nothing more");
  // a new live (new liveAt) starts again
  const next = await alertLiveBatch(io, { id: "bcast01", data: Object.assign({}, b, { liveAt: 1760000999000, liveAlert: patched }) }, 3, 5);
  assert.equal(next.sent, 4, "the next live tells people again (a batch of 5: the creator is skipped, 2 members, 2 connections)");
  const off = await alertLiveBatch(io, { id: "bcast01", data: Object.assign({}, b, { live: false }) }, 4, 5);
  assert.equal(off.sent, 0, "a live that ended tells nobody");
}

/* ---- ad counters ---- */
{
  const markers = new Set();
  const counts = { impressions: 0, clicks: 0, viewCompletes: 0, skips: 0 };
  const ad = { status: "live", creatorUid: "owner1" };
  const io = {
    getAd: async () => ad,
    countOnce: async (marker, adId, field) => { if (markers.has(marker)) return false; markers.add(marker); counts[field]++; return true; },
  };
  const t0 = 1760000000000;
  for (let i = 0; i < 50; i++) await countAdEvent(io, "viewer1", { adId: "ad1", kind: "impression" }, t0 + i * 1000);
  assert.equal(counts.impressions, 1, "fifty impressions in a minute from one person count once");
  await countAdEvent(io, "viewer1", { adId: "ad1", kind: "impression" }, t0 + 31 * 60 * 1000);
  assert.equal(counts.impressions, 2, "a new half hour counts again");
  for (let i = 0; i < 10; i++) await countAdEvent(io, "viewer1", { adId: "ad1", kind: "click" }, t0 + i * 3600 * 1000);
  assert.equal(counts.clicks, 1, "one click a day per person");
  await countAdEvent(io, "viewer2", { adId: "ad1", kind: "click" }, t0);
  assert.equal(counts.clicks, 2, "another person's click counts");
  const own = await countAdEvent(io, "owner1", { adId: "ad1", kind: "view" }, t0);
  assert.equal(own.body.counted, false, "an advertiser's own views do not count");
  assert.equal((await countAdEvent(io, "viewer1", { adId: "ad1", kind: "jackpot" }, t0)).status, 400);
  ad.status = "paused";
  assert.equal((await countAdEvent(io, "viewer3", { adId: "ad1", kind: "view" }, t0)).body.counted, false, "a paused ad counts nothing");
}

/* ---- Discover compile ---- */
{
  let mark = { lastEventAt: 0, updateTime: "" };
  const events = [];
  for (let i = 1; i <= 950; i++) events.push({ at: i, broadcastId: "b" + (i % 7), type: i % 5 === 0 ? "comment_down" : "broadcast_impression" });
  const feats = {};
  const io = {
    mark: async () => mark,
    events: async (after, limit) => events.filter((e) => e.at > after).slice(0, limit),
    features: async (ids) => Object.fromEntries(ids.map((id) => [id, feats[id] || null])),
    commit: async (map, lastAt) => { Object.assign(feats, map); mark = { lastEventAt: lastAt, updateTime: "t" + lastAt }; return true; },
  };
  let pages = 0, more = true;
  while (more && pages < 10) { const r = await compileDiscoverPage(io, 1, 400); more = r.more; pages++; }
  const impressions = Object.values(feats).reduce((n, f) => n + f.impressions, 0);
  const negatives = Object.values(feats).reduce((n, f) => n + f.negativeEvents, 0);
  const reacts = Object.values(feats).reduce((n, f) => n + f.commentReacts, 0);
  assert.equal(impressions, 760, "every impression counted once across pages");
  assert.equal(negatives, 190, "a comment downvote is a negative");
  assert.equal(reacts, 0, "and not a reaction that raises the community score");
  assert.equal(mark.lastEventAt, 950);
  const r = await compileDiscoverPage(io, 1, 400);
  assert.equal(r.events, 0, "nothing is counted twice");
}
console.log("audit-1014: all checks passed");

/* ---- push addresses move into the vault ---- */
import { movePushPage } from "./push-move.mjs";
{
  const users = {
    a1: { name: "A", fcmTokenAndroid: "and-a", fcmToken: "and-a", fcmTokenPlatform: "android" },
    b2: { name: "B", fcmTokenWeb: "web-b" },
    c3: { name: "C" },
  };
  const vaults = { b2: { fcmTokenWeb: "web-b-newer" } };
  let state = {};
  const io = {
    state: async () => state,
    page: async (tok, size) => ({ users: Object.keys(users).map((id) => ({ id, data: users[id] })), next: "" }),
    vault: async (uid) => vaults[uid] || null,
    commit: async (uid, patch, remove) => { vaults[uid] = Object.assign({}, vaults[uid] || {}, patch); remove.forEach((k) => { delete users[uid][k]; }); return true; },
    save: async (st) => { state = st; },
  };
  const r = await movePushPage(io, 100);
  assert.deepEqual([r.done, r.moved, r.checked], [true, 2, 2]);
  assert.deepEqual(vaults.a1, { fcmTokenAndroid: "and-a", fcmToken: "and-a", fcmTokenPlatform: "android" }, "copied into the vault");
  assert.equal(vaults.b2.fcmTokenWeb, "web-b-newer", "a newer vault address is never overwritten");
  assert.ok(!("fcmTokenAndroid" in users.a1) && !("fcmTokenWeb" in users.b2), "public copies removed");
  assert.equal(users.a1.name, "A", "nothing else on the profile is touched");
  assert.equal(users.a1.fcmTokenPlatform, "android", "the platform label (not an address) stays");
  const again = await movePushPage(io, 100);
  assert.equal(again.moved, 0, "runs once, then stops");
}
console.log("audit-1014 push-move: all checks passed");
