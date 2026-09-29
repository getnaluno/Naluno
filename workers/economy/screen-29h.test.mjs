/* 29h: explicit pictures. The rulebook is keener where the detector cannot
   see directly (a naked body, a sexual act), and a picture that reaches the
   server with no Screen verdict is held for a person — trusted or not. */
import assert from "node:assert/strict";
import { handleRequest, resetMemory, setFetchImpl } from "./handler.mjs";
import { judgeScreenPayload } from "./screen.mjs";
import fs from "node:fs";

const L = { F_GEN_COV: 0, FACE_F: 1, BUTT: 2, BREAST: 3, F_GEN: 4, M_CHEST: 5, ANUS: 6, BELLY: 13, FACE_M: 12, M_GEN: 14, BREAST_COV: 16 };
const judge = (frames) => judgeScreenPayload({ v: 1, nudenet: { v: 1, frames } }, { title: "" });

// Exposed genitals: rejected, as before.
assert.equal(judge([{ d: [[L.M_GEN, 0.7]], p: 0 }]).decision, "block");
// A faint sign of genitals is now held (0.25–0.50), not let through.
let r = judge([{ d: [[L.F_GEN, 0.27]], p: 0 }]);
assert.equal(r.decision, "hold");
// An exposed bottom with a weak breast sign: a possibly naked body -> held.
r = judge([{ d: [[L.BUTT, 0.7], [L.BREAST, 0.3]], p: 0 }]);
assert.equal(r.decision, "hold");
assert.equal(r.reason, "possible-nudity");
// Two people with an exposed bottom: a possible sexual act -> held.
r = judge([{ d: [[L.FACE_F, 0.8], [L.FACE_M, 0.7], [L.BUTT, 0.6]], p: 0 }]);
assert.equal(r.decision, "hold");
assert.equal(r.reason, "possible-sexual-act");
// Still allowed: a thong from behind (bottom only), two shirtless friends, a couple clothed.
assert.equal(judge([{ d: [[L.BUTT, 0.83], [11, 0.66]], p: 0 }]).decision, "allow");
assert.equal(judge([{ d: [[L.FACE_M, 0.8], [L.FACE_M, 0.8], [L.M_CHEST, 0.9], [L.M_CHEST, 0.85], [L.BELLY, 0.8]], p: 0 }]).decision, "allow");
assert.equal(judge([{ d: [[L.FACE_F, 0.8], [L.FACE_M, 0.8], [L.BREAST_COV, 0.7]], p: 0 }]).decision, "allow");
// The rulebook text and rules are the same on the phone and on the server.
const a = fs.readFileSync(new URL("../../js/nudenet.js", import.meta.url), "utf8");
const b = fs.readFileSync(new URL("./screen.mjs", import.meta.url), "utf8");
const block = (s) => s.slice(s.indexOf("NALUNO MODERATION RULEBOOK"), s.indexOf("function modDecideFrame"));
assert.equal(block(a), block(b), "rulebook identical in js/nudenet.js and screen.mjs");
assert.ok(block(a).includes("WHAT AN EXPLICIT PICTURE LOOKS LIKE"));

// ---- placement ----
const ENV = { FIREBASE_PROJECT_ID: "naluno-28a00", FIREBASE_WEB_API_KEY: "k", OPERATOR_UID: "op" };
function placeRow(row, screen, trusted, orig) {
  setFetchImpl(async (url) => {
    const u = String(url);
    const f = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === "boolean" ? { booleanValue: v } : { stringValue: String(v) }]));
    if (u.includes("accounts:lookup")) return new Response(JSON.stringify({ users: [{ localId: "user_t" }] }), { status: 200 });
    if (u.includes("/broadcasts/orig1")) return new Response(JSON.stringify({ name: "x/broadcasts/orig1", fields: f(orig || {}) }), { status: orig ? 200 : 404 });
    if (u.includes("/broadcasts/bw")) return new Response(JSON.stringify({ name: "x/broadcasts/bw", fields: f(Object.assign({ creatorUid: "user_t", title: "Piece" }, row)) }), { status: 200 });
    if (u.includes("/users/user_t")) return new Response(JSON.stringify({ fields: f({ name: "T", trustedPublisher: !!trusted }) }), { status: 200 });
    return new Response("{}", { status: 200 });
  });
  return handleRequest(new Request("https://w.example/v1/broadcast/place", {
    method: "POST", headers: { Authorization: "Bearer tok", "Content-Type": "application/json" },
    body: JSON.stringify({ broadcast_id: "bw", screen }),
  }), ENV).then((res) => res.json());
}
resetMemory();
// The hole: a Writing post with a photo and no verdict, from a trusted account, was listed.
let body = await placeRow({ mediaType: "writing", mediaUrl: "https://media.test/p.jpg", thumbUrl: "https://media.test/p.jpg" }, null, true);
assert.equal(body.listed, false, "an unscreened photo is not published");
assert.equal(body.held, true);
assert.equal(body.heldReason, "screen");
// The same Writing photo WITH the detector's findings is judged like a video: explicit -> stopped.
body = await placeRow({ mediaType: "writing", mediaUrl: "https://media.test/p.jpg" }, { v: 1, nudenet: { v: 1, frames: [{ d: [[L.F_GEN, 0.9]], p: 0 }] } }, true);
assert.equal(body.hidden, true);
assert.equal(body.screen, "block");
// Writing with no photo: nothing to screen, trusted -> listed.
body = await placeRow({ mediaType: "writing" }, null, true);
assert.equal(body.listed, true);
// A Pass-on of a public, checked Broadcast inherits its check.
body = await placeRow({ mediaType: "video", mediaUrl: "https://media.test/v.mp4", repostOf: "orig1" }, null, true, { listed: true, screenDecision: "allow", creatorUid: "x" });
assert.equal(body.listed, true);
// A Pass-on of something that is held does not.
body = await placeRow({ mediaType: "video", mediaUrl: "https://media.test/v.mp4", repostOf: "orig1" }, null, true, { listed: false, held: true, creatorUid: "x" });
assert.equal(body.listed, false);
setFetchImpl(null);
console.log("screen 29h tests passed");
