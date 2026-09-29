/* Broadcast views are counted by the worker, not the phone (29g). */
import assert from "node:assert/strict";
import { handleRequest, resetMemory, setFetchImpl } from "./handler.mjs";
import { viewDecision, viewWrites, clampViewSec, viewMonthKey, cleanBroadcastId } from "./views.mjs";

// ---- pure rules ----
assert.equal(clampViewSec(undefined), 4);
assert.equal(clampViewSec(0), 4);
assert.equal(clampViewSec(9), 9);
assert.equal(clampViewSec(9999), 120);
assert.equal(viewMonthKey(Date.UTC(2026, 8, 30, 23, 59)), "2026-09");
assert.equal(cleanBroadcastId("../x"), "");
assert.equal(cleanBroadcastId("b1"), "", "too short");
assert.equal(cleanBroadcastId("abcd_12-X"), "abcd_12-X");
const b = { creatorUid: "c" };
assert.deepEqual(viewDecision({ now: 10000, needSec: 5, uid: "v", broadcast: b, openedAt: 8000 }), { wait_ms: 3000 });
assert.equal(viewDecision({ now: 13000, needSec: 5, uid: "v", broadcast: b, openedAt: 8000 }).count, true);
assert.equal(viewDecision({ now: 13000, needSec: 5, uid: "c", broadcast: b, openedAt: 8000 }).error, "own");
assert.equal(viewDecision({ now: 13000, needSec: 5, uid: "v", broadcast: b, openedAt: 0 }).error, "not_open");
assert.equal(viewDecision({ now: 13000, needSec: 5, uid: "v", broadcast: null, openedAt: 8000 }).error, "not_found");
const w = viewWrites("projects/p/databases/(default)/documents", { broadcastId: "bcast1", uid: "v", creatorUid: "c", now: Date.UTC(2026, 8, 1), dwellMs: 5000 });
assert.deepEqual(w[0].currentDocument, { exists: false }, "one view per person");
assert.ok(JSON.stringify(w).includes("`mv_2026-09`"), "month field is quoted");

// ---- the endpoints, against an in-memory Firestore ----
const store = new Map();
const pair = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048,
  publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
const kb = new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey));
let bin = ""; for (let i = 0; i < kb.length; i++) bin += String.fromCharCode(kb[i]);
const pem = "-----BEGIN PRIVATE KEY-----\n" + btoa(bin).replace(/(.{64})/g, "$1\n") + "\n-----END PRIVATE KEY-----\n";
const env = { FIREBASE_PROJECT_ID: "naluno-28a00", FIREBASE_WEB_API_KEY: "k",
  GOOGLE_SERVICE_ACCOUNT: JSON.stringify({ client_email: "sa@x.iam.gserviceaccount.com", private_key: pem, project_id: "naluno-28a00", token_uri: "https://oauth2.googleapis.com/token" }) };
const ROOT = "https://firestore.googleapis.com/v1/projects/naluno-28a00/databases/(default)/documents";
const val = (v) => ("integerValue" in v ? Number(v.integerValue) : "stringValue" in v ? v.stringValue : "booleanValue" in v ? v.booleanValue : null);
const enc = (o) => { const f = {}; Object.keys(o).forEach((k) => { const x = o[k]; f[k] = typeof x === "number" ? { integerValue: String(x) } : typeof x === "boolean" ? { booleanValue: x } : { stringValue: String(x) }; }); return f; };
let clock = 1_800_000_000_000;
const realNow = Date.now;
Date.now = () => clock;
let commits = 0;
setFetchImpl(async (url, opts) => {
  const u = String(url);
  const method = (opts && opts.method) || "GET";
  if (u.includes("oauth2")) return new Response(JSON.stringify({ access_token: "sa", expires_in: 3600 }), { status: 200 });
  if (u.includes("identitytoolkit")) {
    const tok = JSON.parse(opts.body).idToken;
    return new Response(JSON.stringify({ users: [{ localId: tok.replace("tok-", "") }] }), { status: 200 });
  }
  if (u.startsWith(ROOT + ":commit")) {
    commits++;
    const body = JSON.parse(opts.body);
    const key = (name) => name.split("/documents/")[1];
    for (const wr of body.writes) {
      if (wr.currentDocument && wr.currentDocument.exists === false && wr.update && store.has(key(wr.update.name))) {
        return new Response(JSON.stringify({ error: { status: "FAILED_PRECONDITION" } }), { status: 400 });
      }
    }
    for (const wr of body.writes) {
      if (wr.update) {
        const k = key(wr.update.name); const cur = store.get(k) || {};
        Object.keys(wr.update.fields).forEach((f) => { cur[f] = val(wr.update.fields[f]); });
        store.set(k, cur);
      }
      if (wr.transform) {
        const k = key(wr.transform.document); const cur = store.get(k) || {};
        wr.transform.fieldTransforms.forEach((t) => { const f = t.fieldPath.replace(/`/g, ""); cur[f] = (cur[f] || 0) + Number(t.increment.integerValue); });
        store.set(k, cur);
      }
    }
    return new Response("{}", { status: 200 });
  }
  if (u.startsWith(ROOT + "/")) {
    const k = decodeURIComponent(u.slice(ROOT.length + 1).split("?")[0]);
    if (method === "GET") {
      if (!store.has(k)) return new Response("{}", { status: 404 });
      return new Response(JSON.stringify({ name: "x/" + k, fields: enc(store.get(k)) }), { status: 200 });
    }
    if (method === "PATCH") {
      const cur = store.get(k) || {}; const f = JSON.parse(opts.body).fields || {};
      Object.keys(f).forEach((x) => { cur[x] = val(f[x]); });
      store.set(k, cur);
      return new Response("{}", { status: 200 });
    }
  }
  return new Response("{}", { status: 404 });
});
const call = async (path, who, body) => {
  const res = await handleRequest(new Request("https://w.example" + path, { method: "POST",
    headers: { Authorization: "Bearer tok-" + who, "Content-Type": "application/json" }, body: JSON.stringify(body) }), env);
  return { status: res.status, data: await res.json() };
};
resetMemory();
store.set("broadcasts/bcast1", { creatorUid: "creator", views: 10 });
store.set("economyConfig/viewRules", { countAfterSec: 6 });

// counting without opening does nothing
let r = await call("/v1/view/count", "v1", { broadcast_id: "bcast1" });
assert.equal(r.data.code, "not_open");
// open, then ask too early: the server says wait, with its own seconds
r = await call("/v1/view/open", "v1", { broadcast_id: "bcast1" });
assert.equal(r.data.count_after_sec, 6, "seconds come from the console setting");
clock += 2000;
r = await call("/v1/view/count", "v1", { broadcast_id: "bcast1" });
assert.equal(r.data.code, "wait");
assert.equal(r.data.wait_ms, 4000);
assert.equal(store.get("broadcasts/bcast1").views, 10, "nothing counted early");
// after the dwell: counted once, everywhere, atomically
clock += 4000;
r = await call("/v1/view/count", "v1", { broadcast_id: "bcast1" });
assert.equal(r.data.counted, true);
assert.equal(store.get("broadcasts/bcast1").views, 11);
assert.equal(store.get("broadcasts/bcast1").uniqueViews, 1);
assert.equal(store.get("toga/creator").viewsTotal, 1);
assert.equal(store.get("toga/creator")["mv_" + viewMonthKey(clock)], 1);
assert.equal(store.get("broadcasts/bcast1/viewers/v1").countedBy, "server");
// replay, and re-open + count again: never a second view
r = await call("/v1/view/count", "v1", { broadcast_id: "bcast1" });
assert.equal(r.data.counted, false);
await call("/v1/view/open", "v1", { broadcast_id: "bcast1" });
clock += 7000;
r = await call("/v1/view/count", "v1", { broadcast_id: "bcast1" });
assert.equal(r.data.counted, false);
assert.equal(store.get("broadcasts/bcast1").views, 11, "one view per person");
// the creator watching their own Broadcast is not a view
await call("/v1/view/open", "creator", { broadcast_id: "bcast1" });
clock += 7000;
r = await call("/v1/view/count", "creator", { broadcast_id: "bcast1" });
assert.equal(r.data.code, "own");
// someone else cannot ride another person's open
r = await call("/v1/view/count", "v2", { broadcast_id: "bcast1" });
assert.equal(r.data.code, "not_open");
// junk ids and missing Broadcasts
r = await call("/v1/view/open", "v2", { broadcast_id: "../../users/x" });
assert.equal(r.status, 400);
await call("/v1/view/open", "v2", { broadcast_id: "nothere" });
clock += 7000;
r = await call("/v1/view/count", "v2", { broadcast_id: "nothere" });
assert.equal(r.data.code, "not_found");
// no sign-in, no view
const anon = await handleRequest(new Request("https://w.example/v1/view/open", { method: "POST", body: "{}" }), env);
assert.equal(anon.status, 401);
setFetchImpl(null);
Date.now = realNow;
console.log("views tests passed");
