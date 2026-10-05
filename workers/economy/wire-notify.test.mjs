/* Wireline alerts: only for a real, fresh message between two connected
   people; the alert text comes from the server and never carries the words. */
import assert from "node:assert/strict";
import test from "node:test";
import { handleRequest, resetMemory, setFetchImpl } from "./handler.mjs";
import { handleWireNotify, resetWireNotify, wireKindLabel } from "./wire-notify.mjs";

async function pemKey() {
  const pair = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
  const b = new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey));
  let bin = ""; for (let i = 0; i < b.length; i++) bin += String.fromCharCode(b[i]);
  return "-----BEGIN PRIVATE KEY-----\n" + btoa(bin).replace(/(.{64})/g, "$1\n") + "\n-----END PRIVATE KEY-----\n";
}
function fsValue(v) {
  if (typeof v === "string") return { stringValue: v };
  if (typeof v === "number") return { integerValue: String(v) };
  if (typeof v === "boolean") return { booleanValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(fsValue) } };
  if (v && v.ts) return { timestampValue: new Date(v.ts).toISOString() };
  return { nullValue: null };
}
function world(now) {
  const docs = {
    "users/alice": { name: "Alice Namu" },
    "users/bob": { name: "Bob", fcmTokenWeb: "web-token-bob-0123456789abcdef", fcmToken: "web-token-bob-0123456789abcdef" },
    "users/bob/vault/main": { fcmTokenAndroid: "android-token-bob-0123456789abcdef" },
    "users/alice/connections/bob": { name: "Bob" },
    "users/bob/connections/alice": { name: "Alice" },
    "threads/alice_bob": { participants: ["alice", "bob"], lastMessageFrom: "alice", lastMessageAt: { ts: now - 5000 }, lastKind: "voice" },
    "wireDrop/bob/inbox/c123-abc": { from: "alice", to: "bob", ts: now - 4000, type: "voice", encrypted: true, ciphertext: "SECRETCIPHER" },
    "users/mallory": { name: "Mallory" },
    "users/carol": { name: "Carol", fcmTokenWeb: "web-token-carol-0123456789abcdef" },
  };
  return docs;
}
function env(pem) {
  return { FIREBASE_PROJECT_ID: "naluno-28a00", FIREBASE_WEB_API_KEY: "k",
    GOOGLE_SERVICE_ACCOUNT: JSON.stringify({ client_email: "sa@x.iam.gserviceaccount.com", private_key: pem, project_id: "naluno-28a00", token_uri: "https://oauth2.googleapis.com/token" }) };
}
function fake(docs, sent, opts = {}) {
  return async (url, init) => {
    const u = String(url);
    if (u.includes("identitytoolkit")) {
      const tok = JSON.parse(init.body).idToken;
      const uid = { "tok-alice": "alice", "tok-mallory": "mallory", "tok-bob": "bob" }[tok];
      return uid ? new Response(JSON.stringify({ users: [{ localId: uid }] }), { status: 200 }) : new Response("{}", { status: 400 });
    }
    if (u.includes("oauth2")) return new Response(JSON.stringify({ access_token: "sa-" + (sent.scopes = (sent.scopes || 0) + 1), expires_in: 3600 }), { status: 200 });
    if (u.includes("fcm.googleapis.com")) {
      const m = JSON.parse(init.body).message;
      sent.push(m);
      if (opts.unregistered && m.token === opts.unregistered) return new Response('{"error":{"status":"NOT_FOUND","details":[{"errorCode":"UNREGISTERED"}]}}', { status: 404 });
      return new Response('{"name":"projects/x/messages/1"}', { status: 200 });
    }
    const m = /documents\/(.+?)(\?|$)/.exec(u);
    if (m) {
      const key = decodeURIComponent(m[1]);
      const d = docs[key];
      if (!d) return new Response('{"error":{"code":404}}', { status: 404 });
      const fields = {};
      Object.keys(d).forEach((k) => { fields[k] = fsValue(d[k]); });
      return new Response(JSON.stringify({ name: "projects/x/databases/(default)/documents/" + key, fields }), { status: 200 });
    }
    return new Response("{}", { status: 404 });
  };
}
async function post(e, token, body) {
  const res = await handleRequest(new Request("https://economy.example/v1/wire/notify", {
    method: "POST",
    headers: Object.assign({ "Content-Type": "application/json" }, token ? { Authorization: "Bearer " + token } : {}),
    body: JSON.stringify(body),
  }), e);
  return { status: res.status, body: await res.json() };
}

test("a real message alerts every phone of the other person, with no message text", async () => {
  resetMemory(); resetWireNotify();
  const pem = await pemKey();
  const now = Date.now();
  const sent = [];
  setFetchImpl(fake(world(now), sent));
  const r = await post(env(pem), "tok-alice", { to: "bob", clientMsgId: "c123-abc", text: "do not forward this" });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.sent, 2, "web and android");
  const tokens = sent.map((m) => m.token).sort();
  assert.deepEqual(tokens, ["android-token-bob-0123456789abcdef", "web-token-bob-0123456789abcdef"]);
  sent.forEach((m) => {
    assert.equal(m.data.type, "wireline");
    assert.equal(m.data.title, "Alice Namu", "name from the profile, not the client");
    assert.equal(m.data.body, "Voice message");
    assert.equal(m.data.fromUid, "alice");
    assert.equal(m.android.priority, "HIGH");
    assert.equal(m.webpush.headers.Urgency, "high");
    assert.ok(!m.notification, "data-only: the phone's own code shows it");
    const all = JSON.stringify(m);
    assert.ok(!all.includes("do not forward") && !all.includes("SECRETCIPHER"), "no words, no ciphertext");
  });
  setFetchImpl(null);
});

test("strangers, old messages, self-alerts and floods are refused", async () => {
  resetMemory(); resetWireNotify();
  const pem = await pemKey();
  const now = Date.now();
  const docs = world(now);
  const sent = [];
  setFetchImpl(fake(docs, sent));
  assert.equal((await post(env(pem), "", { to: "bob", clientMsgId: "c1" })).status, 401, "signed in only");
  assert.equal((await post(env(pem), "tok-mallory", { to: "carol", clientMsgId: "c1" })).status, 403, "not connected");
  assert.equal((await post(env(pem), "tok-alice", { to: "alice", clientMsgId: "c1" })).status, 400, "not to yourself");
  assert.equal((await post(env(pem), "tok-alice", { to: "bob/../x", clientMsgId: "c1" })).status, 400, "no path tricks");
  assert.equal((await post(env(pem), "tok-alice", { to: "bob", clientMsgId: "a/b" })).status, 400);
  /* Bob's drop claims to come from someone else. */
  docs["wireDrop/bob/inbox/forged"] = { from: "mallory", to: "bob", ts: now };
  assert.equal((await post(env(pem), "tok-alice", { to: "bob", clientMsgId: "forged" })).status, 403);
  /* Last message is Bob's, not Alice's, and no drop: nothing to announce. */
  docs["threads/alice_bob"].lastMessageFrom = "bob";
  const old = await post(env(pem), "tok-alice", { to: "bob", clientMsgId: "gone" });
  assert.equal(old.body.sent, 0); assert.equal(old.body.reason, "old");
  docs["threads/alice_bob"].lastMessageFrom = "alice";
  docs["threads/alice_bob"].lastMessageAt = { ts: now - 20 * 60 * 1000 };
  assert.equal((await post(env(pem), "tok-alice", { to: "bob", clientMsgId: "gone" })).body.reason, "old", "older than 10 minutes");
  /* Picked up already (drop gone) but just sent: still alerted. */
  docs["threads/alice_bob"].lastMessageAt = { ts: now - 3000 };
  docs["threads/alice_bob"].lastKind = "photo";
  const picked = await post(env(pem), "tok-alice", { to: "bob", clientMsgId: "picked" });
  assert.equal(picked.body.sent, 2);
  assert.equal(sent[sent.length - 1].data.body, "Photo");
  /* Reactions do not ring. */
  docs["wireDrop/bob/inbox/r1"] = { from: "alice", to: "bob", ts: now, type: "reaction" };
  assert.equal((await post(env(pem), "tok-alice", { to: "bob", clientMsgId: "r1" })).body.reason, "silent");
  /* A flood to one person stops. */
  let limited = false;
  for (let i = 0; i < 20; i++) {
    const r = await post(env(pem), "tok-alice", { to: "bob", clientMsgId: "c123-abc" });
    if (r.status === 429) { limited = true; break; }
  }
  assert.ok(limited, "per-person limit");
  setFetchImpl(null);
});

test("no service account: says so (the app then uses the old route)", async () => {
  resetMemory(); resetWireNotify();
  setFetchImpl(fake(world(Date.now()), []));
  const r = await post({ FIREBASE_PROJECT_ID: "naluno-28a00", FIREBASE_WEB_API_KEY: "k" }, "tok-alice", { to: "bob", clientMsgId: "c123-abc" });
  assert.equal(r.status, 503);
  setFetchImpl(null);
});

test("a dead token is reported, the live one still gets it; the push token is reused", async () => {
  resetWireNotify();
  const now = Date.now();
  const docs = world(now);
  const sent = [];
  let scopes = 0;
  const deps = {
    getDoc: async (p) => docs[p.replace(/^\//, "").replace(/%3A/g, ":")] || null,
    accessToken: async () => { scopes++; return "fcm-bearer"; },
    fetch: fake(docs, sent, { unregistered: "web-token-bob-0123456789abcdef" }),
    projectId: "naluno-28a00",
    now: () => now,
  };
  const a = await handleWireNotify({ to: "bob", clientMsgId: "c123-abc" }, { uid: "alice" }, deps);
  assert.equal(a.body.sent, 1);
  assert.deepEqual(a.body.failures, ["unregistered"]);
  await handleWireNotify({ to: "bob", clientMsgId: "c123-abc" }, { uid: "alice" }, deps);
  assert.equal(scopes, 1, "one push sign-in per hour, not per message");
  docs["users/bob"] = { name: "Bob" }; delete docs["users/bob/vault/main"];
  const none = await handleWireNotify({ to: "bob", clientMsgId: "c123-abc" }, { uid: "alice" }, deps);
  assert.equal(none.body.reason, "no_token");
  assert.equal(wireKindLabel("voice"), "Voice message");
  assert.equal(wireKindLabel("anything"), "New message");
});
