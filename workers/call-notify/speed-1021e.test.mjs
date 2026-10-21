/* 21 Oct e: a call alert no longer fetches two new Google tokens every
   time, reads the push addresses alongside the check, sends to every phone
   at once, and reaches every browser the person uses.
   Run: node workers/call-notify/speed-1021e.test.mjs */
import assert from "node:assert/strict";
import test from "node:test";
import { handleRequest, setFetchImpl, resetMemory, webPushTokens, VERSION } from "./handler.mjs";

async function genSa() {
  const pair = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
  const bytes = new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey));
  let bin = ""; for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  const pem = "-----BEGIN PRIVATE KEY-----\n" + btoa(bin).replace(/(.{64})/g, "$1\n") + "\n-----END PRIVATE KEY-----\n";
  return JSON.stringify({ client_email: "x@y.iam.gserviceaccount.com", private_key: pem, project_id: "p", token_uri: "https://oauth2.googleapis.com/token" });
}
const fsStr = (o) => { const f = {}; Object.keys(o).forEach((k) => { const v = o[k]; f[k] = typeof v === "object" ? { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([a, b]) => [a, { mapValue: { fields: { t: { stringValue: b.t }, at: { integerValue: String(b.at) } } } }])) } } : { stringValue: v }; }); return { fields: f }; };

test("version", () => assert.match(VERSION, /20261021e/));

test("two rings in a row: one Google token per kind, not two per ring", async () => {
  resetMemory();
  const env = { GOOGLE_SERVICE_ACCOUNT: await genSa(), FIREBASE_PROJECT_ID: "p", FIREBASE_WEB_API_KEY: "k" };
  const hits = { oauth: 0, fcm: 0, reads: [] };
  let inflight = 0, maxInflight = 0;
  const tA = "a".repeat(40), tW1 = "w".repeat(40), tW2 = "v".repeat(40);
  setFetchImpl(async (url, init) => {
    const u = String(url);
    if (u.includes("accounts:lookup")) return new Response(JSON.stringify({ users: [{ localId: "alice" }] }), { status: 200 });
    if (u.includes("oauth2")) { hits.oauth++; return new Response(JSON.stringify({ access_token: "t" + hits.oauth, expires_in: 3600 }), { status: 200 }); }
    if (u.includes("/calls/")) return new Response(JSON.stringify(fsStr({ callerUid: "alice", calleeUid: "bob", status: "ringing" })), { status: 200 });
    if (u.endsWith("/users/bob")) { hits.reads.push("user"); return new Response(JSON.stringify(fsStr({ fcmTokenAndroid: tA })), { status: 200 }); }
    if (u.endsWith("/users/bob/vault/main")) { hits.reads.push("vault"); return new Response(JSON.stringify(fsStr({ webPush: { d1: { t: tW1, at: Date.now() - 1000 }, d2: { t: tW2, at: Date.now() - 5000 } } })), { status: 200 }); }
    if (u.includes("messages:send")) {
      hits.fcm++; inflight++; maxInflight = Math.max(maxInflight, inflight);
      await new Promise((r) => setTimeout(r, 20)); inflight--;
      return new Response("{}", { status: 200 });
    }
    return new Response("{}", { status: 404 });
  });
  const ring = () => handleRequest(new Request("https://x/", { method: "POST", headers: { Authorization: "Bearer tok", "Content-Type": "application/json" }, body: JSON.stringify({ calleeUid: "bob", type: "incoming_call", callId: "c1" }) }), env);
  const r1 = await (await ring()).json();
  const r2 = await (await ring()).json();
  setFetchImpl(null);
  assert.equal(r1.sent, true); assert.equal(r2.sent, true);
  assert.equal(hits.oauth, 2, "one database token and one push token, kept for the next ring (was 4)");
  assert.equal(hits.fcm, 6, "the Android app and both browsers, on each ring");
  assert.ok(maxInflight >= 2, "phones are sent to at the same time");
});

test("browser push addresses: newest first, at most 4, none older than 60 days", () => {
  const now = Date.now();
  const map = {};
  for (let i = 0; i < 6; i++) map["d" + i] = { t: "tok" + i + "x".repeat(30), at: now - i * 1000 };
  map.old = { t: "old" + "x".repeat(30), at: now - 61 * 86400000 };
  map.bad = { t: "short", at: now };
  const got = webPushTokens({ webPush: map });
  assert.equal(got.length, 4);
  assert.ok(got[0].startsWith("tok0"));
  assert.ok(!got.some((t) => t.startsWith("old")));
  assert.deepEqual(webPushTokens({}), []);
});
