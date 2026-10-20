/* 14 Oct e: new videos stayed off the public feed. On a phone the content
   detector never finished, the heuristic held every video for a person, and
   a video switched from Private to public was held as "unscreened" for good.
   These are the worker's side of the fix. */
import assert from "node:assert/strict";
import { handleRequest, resetMemory, setFetchImpl } from "./handler.mjs";

const ENV = { FIREBASE_PROJECT_ID: "naluno-28a00", FIREBASE_WEB_API_KEY: "k", OPERATOR_UID: "op" };
let wrote = null;
function place(row, screen) {
  wrote = null;
  setFetchImpl(async (url, init) => {
    const u = String(url);
    const f = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === "boolean" ? { booleanValue: v } : (typeof v === "number" ? { integerValue: String(v) } : { stringValue: String(v) })]));
    if (u.includes("accounts:lookup")) return new Response(JSON.stringify({ users: [{ localId: "user_t" }] }), { status: 200 });
    if (u.includes("/broadcasts/bv") && (!init || !init.method || init.method === "GET")) return new Response(JSON.stringify({ name: "x/broadcasts/bv", fields: f(Object.assign({ creatorUid: "user_t", title: "My video", mediaType: "video", mediaUrl: "https://media.test/v.mp4" }, row)) }), { status: 200 });
    if (u.includes("/broadcasts/bv")) { wrote = init && init.body; return new Response("{}", { status: 200 }); }
    if (u.includes("/users/user_t")) return new Response(JSON.stringify({ fields: f({ name: "T" }) }), { status: 200 });
    return new Response("{}", { status: 200 });
  });
  return handleRequest(new Request("https://w.example/v1/broadcast/place", {
    method: "POST", headers: { Authorization: "Bearer tok", "Content-Type": "application/json" },
    body: JSON.stringify({ broadcast_id: "bv", screen }),
  }), ENV).then((res) => res.json());
}
resetMemory();
const clean = { v: 1, nudenet: { v: 1, frames: [{ d: [[1, 0.8]], p: 0 }, { d: [], p: 0 }] } };

// A new video read by the detector, clean: on the feed.
let b = await place({}, clean);
assert.equal(b.listed, true, "a clean video read by the detector is listed");
assert.equal(b.screen, "allow");

// Switched from Private to public: no pictures sent; the worker's earlier verdict stands.
b = await place({ visibility: "public", listed: false, held: true, screenDecision: "allow", screenVersion: 1, screenScore: 3 }, null);
assert.equal(b.listed, true, "a checked video made public is listed, not held as unscreened");
// ... one the detector held (nudity in one still) stays held.
b = await place({ visibility: "public", listed: false, held: true, screenDecision: "hold", screenVersion: 1, screenReason: "single-frame" }, null);
assert.equal(b.listed, false);
assert.equal(b.held, true, "a video the detector held stays held when made public");
// ... one held by an older rule (a weak sign, the skin check) was never a clear finding: listed (19 Oct e).
for (const why of ["possible-nudity", "possible-topless", "video-player-screenshot", "heuristic-only", "screen"]) {
  b = await place({ visibility: "public", listed: false, held: true, screenDecision: "hold", screenVersion: 1, screenReason: why }, null);
  assert.equal(b.listed, true, why + ": not a clear finding, goes out");
  assert.equal(b.screen, "allow");
}
// ... a stored block stays stopped.
b = await place({ visibility: "public", listed: false, held: true, screenDecision: "block", screenVersion: 1, screenReason: "genitals" }, null);
assert.equal(b.listed, false); assert.equal(b.hidden, true);
// ... with no verdict of the worker's on it: no reading is not nudity, it goes out marked unread.
b = await place({ visibility: "public", listed: false, held: true }, null);
assert.equal(b.listed, true, "no earlier verdict: listed, marked unread");
assert.equal(b.screen, "unread");
b = await place({ visibility: "public", listed: false, held: true, screenDecision: "block" }, null);
assert.equal(b.screen, "unread", "a verdict without the worker's version stamp is not trusted (re-read)");
// A fresh reading always wins over the stored one: explicit is stopped.
b = await place({ screenDecision: "allow", screenVersion: 1 }, { v: 1, nudenet: { v: 1, frames: [{ d: [[14, 0.9]], p: 0 }] } });
assert.equal(b.hidden, true, "a new explicit reading takes it down despite an old allow");
setFetchImpl(null);
console.log("video-feed 1014e tests passed");
