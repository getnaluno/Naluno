import assert from "node:assert/strict";
import test from "node:test";
import { handleRequest, setFetchImpl, resetMemory, setSaToken } from "./handler.mjs";

const ENV = { FIREBASE_PROJECT_ID: "naluno-28a00", FIREBASE_WEB_API_KEY: "test-key" };

function req(body, headers = {}) {
  return new Request("https://naluno-call-notify.naluno.workers.dev/", {
    method: "POST",
    headers: Object.assign({ "Content-Type": "application/json" }, headers),
    body: JSON.stringify(body),
  });
}

test("no token is 401", async () => {
  resetMemory();
  const res = await handleRequest(req({ calleeUid: "b" }), ENV);
  assert.equal(res.status, 401);
});

test("invalid token is 401", async () => {
  resetMemory();
  setFetchImpl(async () => new Response("{}", { status: 400 }));
  const res = await handleRequest(req({ calleeUid: "b" }, { Authorization: "Bearer bad" }), ENV);
  assert.equal(res.status, 401);
  setFetchImpl(null);
});

test("cannot notify yourself", async () => {
  resetMemory();
  setFetchImpl(async (url) => {
    if (String(url).includes("accounts:lookup")) {
      return new Response(JSON.stringify({ users: [{ localId: "user_a" }] }), { status: 200 });
    }
    return new Response("{}", { status: 200 });
  });
  const res = await handleRequest(
    req({ calleeUid: "user_a", type: "incoming_call", callId: "c1" }, { Authorization: "Bearer tok" }),
    ENV,
  );
  assert.equal(res.status, 400);
  setFetchImpl(null);
});

test("unknown type is 400", async () => {
  resetMemory();
  setFetchImpl(async (url) => {
    if (String(url).includes("accounts:lookup")) {
      return new Response(JSON.stringify({ users: [{ localId: "user_a" }] }), { status: 200 });
    }
    return new Response("{}", { status: 200 });
  });
  const res = await handleRequest(
    req({ calleeUid: "user_b", type: "promo" }, { Authorization: "Bearer tok" }),
    ENV,
  );
  assert.equal(res.status, 400);
  setFetchImpl(null);
});

test("a rewritten client cannot push a stranger's call", async () => {
  resetMemory();
  setSaToken("sa");
  setFetchImpl(async (url) => {
    const u = String(url);
    if (u.includes("accounts:lookup")) {
      return new Response(JSON.stringify({ users: [{ localId: "user_a" }] }), { status: 200 });
    }
    if (u.includes("/calls/c1")) {
      return new Response(JSON.stringify({
        fields: {
          callerUid: { stringValue: "someone_else" },
          calleeUid: { stringValue: "user_b" },
        },
      }), { status: 200 });
    }
    return new Response("{}", { status: 200 });
  });
  const res = await handleRequest(
    req({
      calleeUid: "user_b",
      type: "incoming_call",
      callId: "c1",
      fcmToken: "attacker-token",
    }, { Authorization: "Bearer tok" }),
    ENV,
  );
  assert.equal(res.status, 403);
  const body = await res.json();
  assert.match(String(body.error || ""), /party/i);
  setFetchImpl(null);
});

test("server tokens win over a client-supplied token", async () => {
  resetMemory();
  setSaToken("sa");
  const sent = [];
  setFetchImpl(async (url, opts) => {
    const u = String(url);
    if (u.includes("accounts:lookup")) {
      return new Response(JSON.stringify({ users: [{ localId: "user_a" }] }), { status: 200 });
    }
    if (u.includes("/calls/c1")) {
      return new Response(JSON.stringify({
        fields: {
          callerUid: { stringValue: "user_a" },
          calleeUid: { stringValue: "user_b" },
        },
      }), { status: 200 });
    }
    if (u.includes("/users/user_b/vault/main")) {
      return new Response(JSON.stringify({ fields: { fcmTokenAndroid: { stringValue: "real-android" } } }), { status: 200 });
    }
    if (u.includes("/users/user_b")) {
      return new Response(JSON.stringify({ fields: {} }), { status: 200 });
    }
    if (u.includes("fcm.googleapis.com")) {
      const body = JSON.parse((opts && opts.body) || "{}");
      sent.push(body.message && body.message.token);
      return new Response(JSON.stringify({ name: "projects/x/messages/1" }), { status: 200 });
    }
    return new Response("{}", { status: 200 });
  });
  const res = await handleRequest(
    req({
      calleeUid: "user_b",
      type: "incoming_call",
      callId: "c1",
      fcmToken: "attacker-token",
    }, { Authorization: "Bearer tok" }),
    ENV,
  );
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.sent, true);
  assert.equal(body.tokenSource, "firestore");
  assert.deepEqual(sent, ["real-android"]);
  setFetchImpl(null);
});

test("health of the contract: missing callee is 400 after auth", async () => {
  resetMemory();
  setFetchImpl(async (url) => {
    if (String(url).includes("accounts:lookup")) {
      return new Response(JSON.stringify({ users: [{ localId: "user_a" }] }), { status: 200 });
    }
    return new Response("{}", { status: 200 });
  });
  const res = await handleRequest(req({ type: "incoming_call" }, { Authorization: "Bearer tok" }), ENV);
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.reason, "missing_token");
  setFetchImpl(null);
});

/* 14 Oct audit additions. */
function fakeGoogle(docs, sent, opts) {
  opts = opts || {};
  return async (url, o) => {
    const u = String(url);
    if (u.includes("accounts:lookup")) return new Response(JSON.stringify({ users: [{ localId: "user_a" }] }), { status: 200 });
    if (u.includes("fcm.googleapis.com")) { sent.push(JSON.parse(o.body).message); return new Response(JSON.stringify({ name: "m" }), { status: 200 }); }
    if (u.includes("firestore.googleapis.com")) {
      if (opts.outage) return new Response("{}", { status: 503 });
      const path = decodeURIComponent(u.split("/documents")[1] || "");
      const d = docs[path];
      if (!d) return new Response(JSON.stringify({ error: { code: 404 } }), { status: 404 });
      const fields = {};
      Object.keys(d).forEach((k) => { const v = d[k]; fields[k] = typeof v === "boolean" ? { booleanValue: v } : Array.isArray(v) ? { arrayValue: { values: v.map((x) => ({ stringValue: x })) } } : { stringValue: String(v) }; });
      return new Response(JSON.stringify({ fields }), { status: 200 });
    }
    return new Response("{}", { status: 200 });
  };
}
const TOK = { "/users/user_b/vault/main": { fcmTokenAndroid: "android-b" }, "/users/user_b": {} };

test("a stranger cannot put a Wireline alert on someone's phone", async () => {
  resetMemory(); setSaToken("sa");
  const sent = [];
  setFetchImpl(fakeGoogle(Object.assign({}, TOK), sent));
  const res = await handleRequest(req({ calleeUid: "user_b", type: "wireline", title: "Your bank", body: "Click here", clientMsgId: "m1" }, { Authorization: "Bearer tok" }), ENV);
  assert.equal(res.status, 403);
  assert.equal(sent.length, 0);
  setFetchImpl(null);
});

test("a connection's Wireline alert goes through", async () => {
  resetMemory(); setSaToken("sa");
  const sent = [];
  setFetchImpl(fakeGoogle(Object.assign({ "/users/user_b/connections/user_a": { name: "A" } }, TOK), sent));
  const res = await handleRequest(req({ calleeUid: "user_b", type: "wireline", title: "A", body: "Message", clientMsgId: "m2" }, { Authorization: "Bearer tok" }), ENV);
  assert.equal(res.status, 200);
  assert.equal(sent.length, 1);
  setFetchImpl(null);
});

test("a live alert shows on Android when Naluno is closed, and only for a live of your own", async () => {
  resetMemory(); setSaToken("sa");
  const sent = [];
  const docs = Object.assign({ "/broadcasts/b1": { creatorUid: "user_a", live: true, memberUids: ["user_b"] }, "/broadcasts/b2": { creatorUid: "someone", live: true } }, TOK);
  setFetchImpl(fakeGoogle(docs, sent));
  let res = await handleRequest(req({ calleeUid: "user_b", type: "broadcast_live", broadcastId: "b1", title: "Live on Naluno", body: "A is live" }, { Authorization: "Bearer tok" }), ENV);
  assert.equal(res.status, 200);
  assert.equal(sent[0].android.notification.channel_id, "naluno_wireline");
  assert.equal(sent[0].data.url, "/app/?broadcast=b1");
  res = await handleRequest(req({ calleeUid: "user_b", type: "broadcast_live", broadcastId: "b2" }, { Authorization: "Bearer tok" }), ENV);
  assert.equal(res.status, 403);
  res = await handleRequest(req({ calleeUid: "user_b", type: "broadcast_live" }, { Authorization: "Bearer tok" }), ENV);
  assert.equal(res.status, 403, "a live alert must name the Broadcast");
  setFetchImpl(null);
});

test("a call alert for a call that does not exist is refused; a Google outage still rings", async () => {
  resetMemory(); setSaToken("sa");
  const sent = [];
  setFetchImpl(fakeGoogle(Object.assign({}, TOK), sent));
  let res = await handleRequest(req({ calleeUid: "user_b", type: "incoming_call", callId: "nope", fcmToken: "x".repeat(30) }, { Authorization: "Bearer tok" }), ENV);
  assert.equal(res.status, 403);
  resetMemory(); setSaToken("sa");
  setFetchImpl(fakeGoogle({}, sent, { outage: true }));
  res = await handleRequest(req({ calleeUid: "user_b", type: "incoming_call", callId: "c9", fcmTokenAndroid: "client-android-token-xxxxxxxx" }, { Authorization: "Bearer tok" }), ENV);
  assert.equal(res.status, 200, "an outage does not silence a real call");
  const body = await res.json();
  assert.equal(body.tokenSource, "client-fallback");
  setFetchImpl(null);
});

test("a Band member (not only its creator) can invite a connection", async () => {
  resetMemory(); setSaToken("sa");
  const sent = [];
  const docs = Object.assign({ "/bands/band1": { creatorUid: "someone", memberUids: ["someone", "user_a"] }, "/users/user_b/connections/user_a": { name: "A" } }, TOK);
  setFetchImpl(fakeGoogle(docs, sent));
  const res = await handleRequest(req({ calleeUid: "user_b", type: "band_invite", bandId: "band1", title: "Band", body: "Join" }, { Authorization: "Bearer tok" }), ENV);
  assert.equal(res.status, 200);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].android.notification.tag, "naluno-band:band1");
  setFetchImpl(null);
});
