/* Adversary pass for the 10 Oct audit. A hostile signed-in client, not the
   happy path. Points, lock-screen push, and the upload worker. */
import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { handleRequest, resetMemory, setFetchImpl } from "./handler.mjs";
import { usdToAed, setBookRates } from "./books.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "../..");

function req(pathname, opts = {}) {
  return new Request("https://naluno-economy.naluno.workers.dev" + pathname, opts);
}
function fsString(v) { return { stringValue: String(v) }; }
function fsBool(v) { return { booleanValue: !!v }; }
function doc(fields) {
  return new Response(JSON.stringify({ fields }), { status: 200 });
}

async function genSa() {
  const pair = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true, ["sign", "verify"],
  );
  const pkcs8 = await crypto.subtle.exportKey("pkcs8", pair.privateKey);
  const bytes = new Uint8Array(pkcs8);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  const pem = "-----BEGIN PRIVATE KEY-----\n" + btoa(bin).replace(/(.{64})/g, "$1\n") + "\n-----END PRIVATE KEY-----\n";
  return JSON.stringify({
    client_email: "sa@naluno-28a00.iam.gserviceaccount.com",
    private_key: pem,
    project_id: "naluno-28a00",
    token_uri: "https://oauth2.googleapis.com/token",
  });
}

function authed(body) {
  return req("/v1/events", {
    method: "POST",
    headers: { Authorization: "Bearer tok", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("books do not invent an AED price", () => {
  setBookRates({ USD: 1 });
  assert.equal(usdToAed(10), null);
  setBookRates({ USD: 1, AED: 3.67 });
  assert.equal(usdToAed(2), 7.34);
  setBookRates(null);
});

test("a hostile client cannot mint points, and cannot replay one real comment", async () => {
  resetMemory();
  const proofs = new Set();
  const env = {
    FIREBASE_PROJECT_ID: "naluno-28a00",
    FIREBASE_WEB_API_KEY: "k",
    GOOGLE_SERVICE_ACCOUNT: await genSa(),
  };
  setFetchImpl(async (url) => {
    const u = String(url);
    if (u.includes("accounts:lookup")) {
      return new Response(JSON.stringify({ users: [{ localId: "attacker" }] }), { status: 200 });
    }
    if (u.includes("oauth2.googleapis.com/token")) {
      return new Response(JSON.stringify({ access_token: "sa", expires_in: 3600 }), { status: 200 });
    }
    if (u.includes("/scoreProof/")) {
      const id = decodeURIComponent(u.split("/scoreProof/")[1].split("?")[0]);
      if (proofs.has(id)) return new Response("{}", { status: 409 });
      proofs.add(id);
      return new Response("{}", { status: 200 });
    }
    if (u.includes("/broadcasts/bcast100/conversation/cmtGood")) {
      return doc({ from: fsString("attacker") });
    }
    if (u.includes("/broadcasts/bcast100/conversation/cmtOther")) {
      return doc({ from: fsString("victim") });
    }
    if (u.includes("/broadcasts/bcast100/viewers/attacker")) {
      return doc({ countedBy: fsString("phone") });
    }
    if (u.includes("firestore.googleapis.com")) return new Response("{}", { status: 403 });
    return new Response("{}", { status: 404 });
  });

  const bare = await handleRequest(authed({
    event_id: "evt_bare_1", event_type: "BROADCAST_COMMENT",
    text: "This comment was never written.", broadcast_id: "bcast100", target_id: "missing99",
  }), env);
  assert.equal((await bare.json()).status, "IGNORED");

  const stolen = await handleRequest(authed({
    event_id: "evt_stolen_1", event_type: "BROADCAST_COMMENT",
    text: "I did not write this comment.", broadcast_id: "bcast100", target_id: "cmtOther",
    target_type: "conversation",
  }), env);
  assert.equal((await stolen.json()).status, "IGNORED");

  const fakeView = await handleRequest(authed({
    event_id: "evt_view_1", event_type: "WATCH_COMPLETION", broadcast_id: "bcast100",
  }), env);
  assert.equal((await fakeView.json()).status, "IGNORED");

  const first = await handleRequest(authed({
    event_id: "evt_real_1", event_type: "BROADCAST_COMMENT",
    text: "A real comment on the show.", broadcast_id: "bcast100", target_id: "cmtGood",
  }), env);
  assert.equal((await first.json()).status, "COUNTED");

  const replay = await handleRequest(authed({
    event_id: "evt_real_2", event_type: "BROADCAST_COMMENT",
    text: "A real comment on the show.", broadcast_id: "bcast100", target_id: "cmtGood",
  }), env);
  const replayBody = await replay.json();
  assert.equal(replayBody.status, "IGNORED");

  const me = await handleRequest(req("/v1/me", { headers: { Authorization: "Bearer tok" } }), env);
  const mine = await me.json();
  assert.equal(mine.contribution_points, 3);
  setFetchImpl(null);
});

test("lock-screen push ignores client words and refuses a call that is not ringing to that person", async () => {
  resetMemory();
  const pushed = [];
  const env = {
    FIREBASE_PROJECT_ID: "naluno-28a00",
    FIREBASE_WEB_API_KEY: "k",
    GOOGLE_SERVICE_ACCOUNT: await genSa(),
  };
  const web = "web-token-0123456789abcdef";
  const android = "android-token-0123456789abcdef";
  setFetchImpl(async (url, opts) => {
    const u = String(url);
    if (u.includes("accounts:lookup")) {
      return new Response(JSON.stringify({ users: [{ localId: "attacker" }] }), { status: 200 });
    }
    if (u.includes("oauth2.googleapis.com/token")) {
      return new Response(JSON.stringify({ access_token: "sa", expires_in: 3600 }), { status: 200 });
    }
    if (u.includes("fcm.googleapis.com")) {
      pushed.push(JSON.parse(opts.body));
      return new Response("{}", { status: 200 });
    }
    if (u.includes("/calls/callGood1")) {
      return doc({
        callerUid: fsString("attacker"), calleeUid: fsString("victim01"),
        status: fsString("ringing"), kind: fsString("video"),
      });
    }
    if (u.includes("/calls/callEnded")) {
      return doc({
        callerUid: fsString("attacker"), calleeUid: fsString("victim01"),
        status: fsString("ended"), kind: fsString("audio"),
      });
    }
    if (u.includes("/calls/callOther")) {
      return doc({
        callerUid: fsString("someone"), calleeUid: fsString("victim01"),
        status: fsString("ringing"), kind: fsString("video"),
      });
    }
    if (u.includes("/users/attacker/circle/") || u.includes("/users/attacker/connections/")) {
      return new Response("{}", { status: 404 });
    }
    if (u.includes("/users/attacker")) return doc({ name: fsString("Magambo") });
    if (u.includes("/users/victim01/vault/")) return new Response("{}", { status: 404 });
    if (u.includes("/users/victim01")) {
      return doc({ fcmTokenWeb: fsString(web), fcmTokenAndroid: fsString(android), name: fsString("Victim") });
    }
    if (u.includes("/broadcasts/livecast01")) {
      return doc({ creatorUid: fsString("attacker"), live: fsBool(true), title: fsString("Night set") });
    }
    return new Response("{}", { status: 404 });
  });
  const headers = { Authorization: "Bearer tok", "Content-Type": "application/json" };
  const spoof = await handleRequest(req("/v1/push/lock", {
    method: "POST", headers,
    body: JSON.stringify({
      to: "victim01", type: "incoming_call", callId: "callGood1",
      title: "SEND MONEY", body: "Your account is locked", voice: true,
    }),
  }), env);
  const spoofBody = await spoof.json();
  assert.equal(spoofBody.sent, 1);
  assert.equal(pushed.length, 1);
  const msg = pushed[0].message;
  assert.equal(msg.token, web);
  assert.ok(!JSON.stringify(msg).includes("SEND MONEY"));
  assert.ok(!JSON.stringify(msg).includes("account is locked"));
  assert.ok(String(msg.webpush.notification.title).includes("Magambo"));
  assert.equal(String(msg.webpush.notification.title).includes("voice"), false);

  const ended = await handleRequest(req("/v1/push/lock", {
    method: "POST", headers,
    body: JSON.stringify({ to: "victim01", type: "incoming_call", callId: "callEnded" }),
  }), env);
  assert.equal((await ended.json()).reason, "not ringing");

  const stolen = await handleRequest(req("/v1/push/lock", {
    method: "POST", headers,
    body: JSON.stringify({ to: "victim01", type: "incoming_call", callId: "callOther" }),
  }), env);
  assert.equal(stolen.status, 403);

  const stranger = await handleRequest(req("/v1/push/lock", {
    method: "POST", headers,
    body: JSON.stringify({ to: "victim01", type: "broadcast_live", broadcastId: "livecast01", title: "click" }),
  }), env);
  assert.equal(stranger.status, 403);
  assert.equal(pushed.length, 1);
  setFetchImpl(null);
});

test("upload worker refuses active content and will not run it on download", async () => {
  const src = fs.readFileSync(path.join(root, "signal-worker-index.js"), "utf8");
  const mod = await import("data:text/javascript," + encodeURIComponent(src));
  const worker = mod.default;
  const stored = new Map();
  let deleted = 0;
  const env = {
    FIREBASE_WEB_API_KEY: "k",
    SIGNAL_BUCKET: {
      put: async (key, buf, meta) => { stored.set(key, { buf, meta, size: buf.byteLength }); },
      get: async (key) => {
        const row = stored.get(key);
        if (!row) return null;
        return { body: row.buf, size: row.size, httpMetadata: row.meta && row.meta.httpMetadata };
      },
      head: async (key) => {
        if (key.endsWith("huge.bin")) return { size: (8 * 1024 * 1024 * 1024) + 1, httpMetadata: {} };
        if (key.endsWith("large.bin")) return { size: 96 * 1024 * 1024, httpMetadata: {} };
        const row = stored.get(key);
        return row ? { size: row.size, httpMetadata: row.meta.httpMetadata } : null;
      },
      delete: async (key) => { deleted += 1; stored.delete(key); },
      createMultipartUpload: async (key, meta) => ({ uploadId: "up1", key, meta }),
      resumeMultipartUpload: () => ({
        uploadPart: async () => ({ etag: "etag1" }),
        complete: async () => {},
      }),
    },
  };
  const orig = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes("accounts:lookup")) {
      return new Response(JSON.stringify({ users: [{ localId: "attacker" }] }), { status: 200 });
    }
    return new Response("{}", { status: 404 });
  };
  try {
    const html = await worker.fetch(new Request("https://upload.test/", {
      method: "POST",
      headers: { Authorization: "Bearer t", "Content-Type": "text/html" },
      body: "<html><script>alert(1)</script>",
    }), env);
    assert.equal(html.status, 415);

    const svg = await worker.fetch(new Request("https://upload.test/", {
      method: "POST",
      headers: { Authorization: "Bearer t", "Content-Type": "image/svg+xml" },
      body: "<svg onload='alert(1)'>",
    }), env);
    assert.equal(svg.status, 415);

    const sniff = await worker.fetch(new Request("https://upload.test/", {
      method: "POST",
      headers: { Authorization: "Bearer t", "Content-Type": "application/octet-stream" },
      body: "<html><script>alert(1)</script>",
    }), env);
    assert.equal(sniff.status, 415);

    const open = await worker.fetch(new Request("https://upload.test/", { method: "POST", body: "jpeg-bytes" }), env);
    assert.equal(open.status, 401);

    const init = await worker.fetch(new Request("https://upload.test/b/init", {
      method: "POST",
      headers: { Authorization: "Bearer t", "Content-Type": "application/json" },
      body: JSON.stringify({ contentType: "text/html" }),
    }), env);
    assert.equal(init.status, 415);

    const ok = await worker.fetch(new Request("https://upload.test/", {
      method: "POST",
      headers: { Authorization: "Bearer t", "Content-Type": "image/jpeg" },
      body: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
    }), env);
    assert.equal(ok.status, 200);
    const saved = await ok.json();
    const got = await worker.fetch(new Request("https://upload.test/o/" + saved.key), env);
    assert.equal(got.headers.get("X-Content-Type-Options"), "nosniff");
    assert.equal(got.headers.get("Content-Security-Policy"), null);
    assert.equal(got.headers.get("Content-Type"), "image/jpeg");

    const large = await worker.fetch(new Request("https://upload.test/b/complete", {
      method: "POST",
      headers: { Authorization: "Bearer t", "Content-Type": "application/json" },
      body: JSON.stringify({
        key: "u/attacker/large.bin", uploadId: "up1",
        parts: [{ part: 1, etag: "etag1" }],
        bytes: 96 * 1024 * 1024,
      }),
    }), env);
    assert.equal(large.status, 200);
    assert.equal(deleted, 0);

    const huge = await worker.fetch(new Request("https://upload.test/b/complete", {
      method: "POST",
      headers: { Authorization: "Bearer t", "Content-Type": "application/json" },
      body: JSON.stringify({
        key: "u/attacker/huge.bin", uploadId: "up1",
        parts: [{ part: 1, etag: "etag1" }],
      }),
    }), env);
    assert.equal(huge.status, 413);
    assert.equal(deleted, 1);

    const over = await worker.fetch(new Request("https://upload.test/b/init", {
      method: "POST",
      headers: { Authorization: "Bearer t", "Content-Type": "application/json" },
      body: JSON.stringify({ contentType: "video/mp4", bytes: (8 * 1024 * 1024 * 1024) + 1 }),
    }), env);
    assert.equal(over.status, 413);

    const phone = await worker.fetch(new Request("https://upload.test/b/init", {
      method: "POST",
      headers: { Authorization: "Bearer t", "Content-Type": "application/json" },
      body: JSON.stringify({ contentType: "video/3gpp", bytes: 800 * 1024 * 1024 }),
    }), env);
    assert.equal(phone.status, 200, "a phone gallery video is a video");
    const phoneBody = await phone.json();
    assert.ok(String(phoneBody.key || "").startsWith("u/attacker/"), phoneBody.key);
    assert.ok(String(phoneBody.key || "").endsWith(".3gp"), phoneBody.key);
  } finally {
    globalThis.fetch = orig;
  }
});

test("broadcast bucket accepts a gallery video and plays it without a sandbox", async () => {
  const src = fs.readFileSync(path.join(root, "signal-worker-index.js"), "utf8");
  const mod = await import("data:text/javascript," + encodeURIComponent(src + "\n//" + Date.now()));
  const worker = mod.default;
  const stored = new Map();
  const env = {
    FIREBASE_WEB_API_KEY: "k",
    BROADCAST_BUCKET: {
      put: async (key, buf, meta) => { stored.set(key, { buf, meta, size: buf.byteLength }); },
      get: async (key, opts) => {
        const row = stored.get(key);
        if (!row) return null;
        const body = row.buf;
        if (opts && opts.range) {
          const offset = opts.range.offset || 0;
          const length = opts.range.length || (body.byteLength - offset);
          return { body: body.slice(offset, offset + length), size: length, range: { offset, length }, httpMetadata: row.meta.httpMetadata };
        }
        return { body, size: row.size, httpMetadata: row.meta.httpMetadata };
      },
      head: async (key) => {
        const row = stored.get(key);
        return row ? { size: row.size, httpMetadata: row.meta.httpMetadata } : null;
      },
      createMultipartUpload: async (key, meta) => {
        stored.set(key, { buf: new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]), meta, size: 8 });
        return { uploadId: "upb", key, meta };
      },
      resumeMultipartUpload: () => ({
        uploadPart: async () => ({ etag: "e" }),
        complete: async () => {},
      }),
    },
  };
  const orig = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes("accounts:lookup")) {
      return new Response(JSON.stringify({ users: [{ localId: "u1" }] }), { status: 200 });
    }
    return new Response("{}", { status: 404 });
  };
  try {
    const init = await worker.fetch(new Request("https://bcast.test/b/init", {
      method: "POST",
      headers: { Authorization: "Bearer t", "Content-Type": "application/json" },
      body: JSON.stringify({ contentType: "video/3gpp", bytes: 12 * 1024 * 1024 }),
    }), env);
    assert.equal(init.status, 200);
    const body = await init.json();
    assert.ok(String(body.key).startsWith("b/u1/"), body.key);
    assert.ok(String(body.key).endsWith(".3gp"), body.key);
    const play = await worker.fetch(new Request("https://bcast.test/o/" + body.key, {
      headers: { Range: "bytes=0-3" },
    }), env);
    assert.equal(play.status, 206);
    assert.equal(play.headers.get("Content-Type"), "video/3gpp");
    assert.equal(play.headers.get("Content-Security-Policy"), null);
    assert.equal(play.headers.get("X-Content-Type-Options"), "nosniff");
  } finally {
    globalThis.fetch = orig;
  }
});
