/* 20 Oct b: a photo or video replaced after a post is out is checked too.
   Run: node workers/economy/replace-recheck.test.mjs */
import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import vm from "node:vm";
import { handleRequest, resetMemory, setFetchImpl } from "./handler.mjs";
import { screenMediaKey } from "./screen.mjs";

const ENV = { FIREBASE_PROJECT_ID: "p", FIREBASE_WEB_API_KEY: "k", OPERATOR_UID: "op" };
const f = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === "boolean" ? { booleanValue: v } : { stringValue: String(v) }]));
async function recheck(row, screen, trusted = true) {
  resetMemory();
  setFetchImpl(async (url) => {
    const u = String(url);
    if (u.includes("accounts:lookup")) return new Response(JSON.stringify({ users: [{ localId: "user_t" }] }), { status: 200 });
    if (u.includes("/broadcasts/br")) return new Response(JSON.stringify({ name: "x/broadcasts/br", fields: f(Object.assign({ creatorUid: "user_t", title: "Piece", mediaUrl: "https://m/new.jpg", visibility: "public" }, row)) }), { status: 200 });
    if (u.includes("/users/user_t")) return new Response(JSON.stringify({ fields: f({ name: "T", trustedPublisher: trusted }) }), { status: 200 });
    return new Response("{}", { status: 200 });
  });
  const res = await handleRequest(new Request("https://w.example/v1/broadcast/place", {
    method: "POST", headers: { Authorization: "Bearer tok", "Content-Type": "application/json" },
    body: JSON.stringify({ broadcast_id: "br", screen, recheck: true }),
  }), ENV);
  const body = await res.json();
  setFetchImpl(null);
  return body;
}
const clean = { v: 1, nudenet: { v: 1, frames: [{ d: [[1, 0.8]], p: 0 }] } };
const explicit = { v: 1, nudenet: { v: 1, frames: [{ d: [[14, 0.9]], p: 0 }] } };
const oneStill = { v: 1, nudenet: { v: 1, frames: [{ d: [], p: 0 }, { d: [[4, 0.6]], p: 0 }, { d: [], p: 0 }] } };

test("a clean replacement leaves a public post where it is", async () => {
  const b = await recheck({ listed: true, held: false, hidden: false }, clean);
  assert.equal(b.recheck, true);
  assert.equal(b.screen, "allow");
  assert.equal(b.listed, true); assert.equal(b.held, false); assert.equal(b.hidden, false);
});
test("a clean replacement never lets out a post the desk is holding", async () => {
  const b = await recheck({ listed: false, held: true, heldReason: "review", hidden: false }, clean);
  assert.equal(b.listed, false); assert.equal(b.held, true); assert.equal(b.heldReason, "review");
});
test("clear nudity in the new file takes the post down", async () => {
  const b = await recheck({ listed: true, held: false, hidden: false }, explicit);
  assert.equal(b.screen, "block");
  assert.equal(b.hidden, true); assert.equal(b.listed, false);
});
test("nudity found in one still of a new video holds the post for a person", async () => {
  const b = await recheck({ listed: true, held: false, hidden: false, mediaType: "video" }, oneStill);
  assert.equal(b.screen, "hold");
  assert.equal(b.held, true); assert.equal(b.listed, false); assert.equal(b.heldReason, "screen");
});
test("an unread replacement stays out and is marked for the desk", async () => {
  const b = await recheck({ listed: true, held: false, hidden: false }, null);
  assert.equal(b.screen, "unread");
  assert.equal(b.listed, true);
});
test("skin colour in the new file never holds it", async () => {
  const rgb = Buffer.alloc(96 * 96 * 3); for (let i = 0; i < rgb.length; i += 3) { rgb[i] = 70; rgb[i + 1] = 42; rgb[i + 2] = 28; }
  const b = await recheck({ listed: true, held: false, hidden: false }, { v: 3, w: 96, h: 96, frames: [{ rgb: rgb.toString("base64") }] });
  assert.equal(b.listed, true); assert.equal(b.held, false);
});
test("the worker records which files it judged; the desk computes the same key", () => {
  const src = fs.readFileSync(new URL("../../js/admin-console.js", import.meta.url), "utf8").replace(/\n  /g, "\n");
  const i = src.indexOf("function mediaKeyOf(");
  let d = 0, j = src.indexOf("{", i);
  for (; j < src.length; j++) { if (src[j] === "{") d++; else if (src[j] === "}" && --d === 0) break; }
  const ctx = {}; vm.createContext(ctx);
  vm.runInContext(src.slice(i, j + 1) + "\nthis.k = mediaKeyOf;", ctx);
  const rows = [
    {}, { mediaUrl: "https://m/a.mp4" }, { mediaUrl: "data:x", thumbUrl: "https://t" },
    { mediaUrl: "https://m/a.mp4", chapters: [{ mediaUrl: "https://m/b.mp4" }, { mediaUrl: "https://m/a.mp4", replacementUrl: "https://m/c.mp4" }, null] },
    { chapters: [{ mediaUrl: "https://m/z.mp4" }, { mediaUrl: "https://m/y.mp4" }] },
  ];
  for (const r of rows) assert.equal(ctx.k(r), screenMediaKey(r), JSON.stringify(r));
  assert.notEqual(screenMediaKey(rows[3]), screenMediaKey(Object.assign({}, rows[3], { chapters: [{ mediaUrl: "https://m/b.mp4" }] })), "a replaced chapter changes the key");
  assert.equal(screenMediaKey({ mediaUrl: "https://m/a", thumbUrl: "https://t1" }), screenMediaKey({ mediaUrl: "https://m/a", thumbUrl: "https://t2" }), "a new thumbnail does not");
  const h = fs.readFileSync(new URL("./handler.mjs", import.meta.url), "utf8");
  assert.ok(/screenMedia: screenMediaKey\(row\),/.test(h));
  const rules = fs.readFileSync(new URL("../../firestore.rules", import.meta.url), "utf8");
  const keep = rules.slice(rules.indexOf("function keepsBroadcastListing"), rules.indexOf("function isOriginalVideoFile"));
  assert.ok(keep.includes("'screenMedia'") && keep.includes("'screenLookedMedia'"), "a creator cannot forge the record");
});
