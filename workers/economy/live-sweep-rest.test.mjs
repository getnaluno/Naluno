/* 12c: the worker's live sweep and the report → pending flag, end to end
   against an in-memory Firestore REST API (the same calls production makes). */
import assert from "node:assert/strict";
import { handleRequest, resetMemory, setFetchImpl, runLiveSweep } from "./handler.mjs";
import { resetWireNotify } from "./wire-notify.mjs";

const pair = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048,
  publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
const kb = new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey));
let bin = ""; for (let i = 0; i < kb.length; i++) bin += String.fromCharCode(kb[i]);
const pem = "-----BEGIN PRIVATE KEY-----\n" + btoa(bin).replace(/(.{64})/g, "$1\n") + "\n-----END PRIVATE KEY-----\n";
const env = { FIREBASE_PROJECT_ID: "naluno-28a00", FIREBASE_WEB_API_KEY: "k",
  GOOGLE_SERVICE_ACCOUNT: JSON.stringify({ client_email: "sa@x.iam.gserviceaccount.com", private_key: pem, project_id: "naluno-28a00", token_uri: "https://oauth2.googleapis.com/token" }) };
const ROOT = "https://firestore.googleapis.com/v1/projects/naluno-28a00/databases/(default)/documents";

const NOW = Date.now();
const MIN = 60000;
const enc = (v) => v === null ? { nullValue: null } : typeof v === "number" ? (Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v })
  : typeof v === "boolean" ? { booleanValue: v } : { stringValue: String(v) };
const dec = (v) => "integerValue" in v ? Number(v.integerValue) : "doubleValue" in v ? v.doubleValue : "booleanValue" in v ? v.booleanValue
  : "nullValue" in v ? null : "stringValue" in v ? v.stringValue : undefined;
const store = new Map(); // path -> { fields, updateTime }
let tick = 0;
function put(path, obj) {
  const cur = store.get(path) || { fields: {} };
  const fields = Object.assign({}, cur.fields);
  Object.keys(obj).forEach((k) => { fields[k] = enc(obj[k]); });
  store.set(path, { fields, updateTime: new Date(NOW - 100000 + (++tick)).toISOString() });
}
function doc(path) { const d = store.get(path); return d && { name: "projects/naluno-28a00/databases/(default)/documents/" + path, fields: d.fields, updateTime: d.updateTime }; }
function plain(path) { const d = store.get(path); if (!d) return null; const o = {}; Object.keys(d.fields).forEach((k) => { o[k] = dec(d.fields[k]); }); return o; }

const sent = { fcm: [], said: [], deleted: [] };
setFetchImpl(async (url, opts) => {
  const u = String(url);
  const method = (opts && opts.method) || "GET";
  if (u.includes("oauth2")) return new Response(JSON.stringify({ access_token: "sa", expires_in: 3600 }), { status: 200 });
  if (u.includes("accounts:lookup")) return new Response(JSON.stringify({ users: [{ localId: "reporter1" }] }), { status: 200 });
  if (u.includes("fcm.googleapis.com")) { sent.fcm.push(JSON.parse(opts.body)); return new Response("{}", { status: 200 }); }
  if (!u.startsWith(ROOT)) return new Response("{}", { status: 200 });
  const rest = u.slice(ROOT.length);
  if (rest.startsWith(":runQuery")) {
    const q = JSON.parse(opts.body).structuredQuery;
    const col = q.from[0].collectionId;
    const rows = [...store.keys()].filter((k) => k.split("/").length === 2 && k.startsWith(col + "/"))
      .filter((k) => { const f = q.where && q.where.fieldFilter; return !f || JSON.stringify(store.get(k).fields[f.field.fieldPath]) === JSON.stringify(f.value); })
      .map((k) => ({ document: doc(k) }));
    return new Response(JSON.stringify(rows), { status: 200 });
  }
  const [pathPart, query] = rest.slice(1).split("?");
  const path = decodeURIComponent(pathPart);
  const params = new URLSearchParams(query || "");
  if (method === "GET") {
    if (path.endsWith("/liveSessions")) {
      const docs = [...store.keys()].filter((k) => k.startsWith(path + "/") && k.split("/").length === path.split("/").length + 1).map(doc);
      return new Response(JSON.stringify({ documents: docs }), { status: 200 });
    }
    const d = doc(path);
    return d ? new Response(JSON.stringify(d), { status: 200 }) : new Response(JSON.stringify({ error: { code: 404 } }), { status: 404 });
  }
  if (method === "DELETE") { sent.deleted.push(path); store.delete(path); return new Response("{}", { status: 200 }); }
  if (method === "POST") { // createDocument
    const body = JSON.parse(opts.body);
    const id = "auto" + (++tick);
    store.set(path + "/" + id, { fields: body.fields, updateTime: new Date().toISOString() });
    if (path.endsWith("/conversation")) sent.said.push(dec(body.fields.text));
    return new Response(JSON.stringify(doc(path + "/" + id)), { status: 200 });
  }
  if (method === "PATCH") {
    const pre = params.get("currentDocument.updateTime");
    const mustNotExist = params.get("currentDocument.exists") === "false";
    const cur = store.get(path);
    if (pre && (!cur || cur.updateTime !== pre)) return new Response(JSON.stringify({ error: { status: "FAILED_PRECONDITION" } }), { status: 400 });
    if (mustNotExist && cur) return new Response(JSON.stringify({ error: { status: "ALREADY_EXISTS" } }), { status: 409 });
    const body = JSON.parse(opts.body);
    const mask = params.getAll("updateMask.fieldPaths");
    const o = {};
    Object.keys(body.fields || {}).forEach((k) => { if (!mask.length || mask.includes(k)) o[k] = dec(body.fields[k]); });
    put(path, o);
    return new Response(JSON.stringify(doc(path)), { status: 200 });
  }
  return new Response("{}", { status: 200 });
});

/* ---- the sweep ---- */
resetMemory(); resetWireNotify();
put("users/c1", { name: "Ama" });
put("users/c1/vault/main", { fcmTokenWeb: "w".repeat(40) });
const base = { creatorUid: "c1", title: "Morning show", live: true, liveBy: "c1" };
put("broadcasts/drop", Object.assign({}, base, { liveAt: NOW - 30 * MIN }));
put("broadcasts/drop/livePreview/frame", { from: "c1", at: NOW - 4 * MIN });
store.get("broadcasts/drop/livePreview/frame").updateTime = new Date(NOW - 4 * MIN).toISOString();
put("broadcasts/gone", Object.assign({}, base, { liveAt: NOW - 60 * MIN }));
put("broadcasts/gone/livePreview/frame", { from: "c1", at: NOW - 25 * MIN });
store.get("broadcasts/gone/livePreview/frame").updateTime = new Date(NOW - 25 * MIN).toISOString();
put("broadcasts/gone/liveSessions/v1", { from: "v1" });
put("broadcasts/run", Object.assign({}, base, { creatorUid: "c2", liveAt: NOW - 10 * MIN }));
put("broadcasts/run/livePreview/frame", { from: "c2", at: NOW - 2000 });
store.get("broadcasts/run/livePreview/frame").updateTime = new Date(NOW - 2000).toISOString();
put("broadcasts/off", Object.assign({}, base, { live: false }));

const r1 = await runLiveSweep(env, NOW);
assert.equal(r1.ok, true);
assert.deepEqual({ checked: r1.checked, running: r1.running, dropped: r1.dropped, notified: r1.notified, ended: r1.ended }, { checked: 3, running: 1, dropped: 1, notified: 1, ended: 1 });
assert.equal(sent.fcm.length, 1, "one limelight push");
const msg = sent.fcm[0].message;
assert.equal(msg.data.type, "live_dropped");
assert.equal(msg.data.broadcastId, "drop");
assert.equal(msg.webpush.notification.tag, "naluno-live:drop");
assert.equal(plain("broadcasts/drop").live, true, "still live during its limelight");
assert.equal(plain("broadcasts/drop").liveLimelightUntil, NOW - 4 * MIN + 15 * MIN);
const g = plain("broadcasts/gone");
assert.equal(g.live, false);
assert.equal(g.liveEndReason, "host-gone");
assert.equal(g.lastLiveEndedAt, NOW - 25 * MIN, "server time of the last still");
assert.ok(!store.has("broadcasts/gone/livePreview/frame") && !store.has("broadcasts/gone/liveSessions/v1"), "still and sessions cleared");
assert.deepEqual(sent.said, ["Ama was live for 35 minutes."]);
assert.equal(plain("broadcasts/run").live, true);

// the next sweep does not push again for the same drop
const r2 = await runLiveSweep(env, NOW + 60000);
assert.equal(r2.notified, 0);
assert.equal(sent.fcm.length, 1);

// a creator who resumed between the read and the write is never overwritten
put("broadcasts/race", Object.assign({}, base, { liveAt: NOW - 90 * MIN }));
let raced = false;
const realGet = store.get.bind(store);
store.get = function (k) {
  const v = realGet(k);
  if (k === "broadcasts/race/livePreview/frame" && !raced) { raced = true; put("broadcasts/race", { liveResumedAt: NOW, liveAt: NOW - 90 * MIN }); }
  return v;
};
const r3 = await runLiveSweep(env, NOW + 120000);
store.get = realGet;
assert.equal(plain("broadcasts/race").live, true, "the resume wins");
assert.ok(r3.skipped >= 1);

/* ---- a report puts the creator on pending; nothing else about them changes ---- */
put("broadcasts/b9", { creatorUid: "c9", title: "x", listed: true, held: false, hidden: false, visibility: "public" });
put("users/c9", { name: "Kato" });
const res = await handleRequest(new Request("https://w.example/v1/report", {
  method: "POST",
  headers: { Authorization: "Bearer usertoken", "Content-Type": "application/json" },
  body: JSON.stringify({ reason: "This is misleading and copies my work", reason_code: "other", broadcast_id: "b9", target_type: "broadcast", target_id: "b9" }),
}), env);
assert.equal(res.status, 200);
const c9 = plain("users/c9");
assert.equal(c9.publisherReview, "pending");
assert.ok(c9.publisherReviewReport);
assert.equal(c9.name, "Kato");
assert.equal(plain("broadcasts/b9").listed, true, "a non-urgent report does not take down what is already up");

// reporting yourself changes nothing
put("broadcasts/mine", { creatorUid: "reporter1", title: "y" });
put("users/reporter1", { name: "R" });
await handleRequest(new Request("https://w.example/v1/report", {
  method: "POST",
  headers: { Authorization: "Bearer usertoken", "Content-Type": "application/json" },
  body: JSON.stringify({ reason: "testing my own report path", reason_code: "other", broadcast_id: "mine", report_id: "rep_self" }),
}), env);
assert.equal(plain("users/reporter1").publisherReview, undefined);

setFetchImpl(null);
console.log("live-sweep-rest: all checks passed");
