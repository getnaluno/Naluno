/* Console lock-out guard.

   Cloudflare Workers refuse PBKDF2 above 100,000 iterations. This file makes
   Node behave the same way, then proves that every kind of console password
   copy that exists in the wild is still accepted — and wrong ones are not. */
import assert from "node:assert/strict";
import test from "node:test";
import nodeCrypto from "node:crypto";
import { handleRequest, resetMemory, setFetchImpl } from "./handler.mjs";

const ENV = {
  FIREBASE_PROJECT_ID: "naluno-28a00",
  FIREBASE_WEB_API_KEY: "test-key",
  OPERATOR_UID: "ibMOMY6Q3sVTCxIrwO2FGk43zw93",
};
const UID = ENV.OPERATOR_UID;
const PASS = "my-console-pass-1";

/* Behave like workerd. */
const realDerive = crypto.subtle.deriveBits.bind(crypto.subtle);
crypto.subtle.deriveBits = async function (alg, key, len) {
  if (alg && alg.name === "PBKDF2" && Number(alg.iterations) > 100000) {
    const e = new Error("Pbkdf2 failed: iteration counts above 100000 are not supported");
    e.name = "NotSupportedError";
    throw e;
  }
  return realDerive(alg, key, len);
};

function req(path, opts = {}) {
  return new Request("https://naluno-economy.naluno.workers.dev" + path, opts);
}
function sv(v) { return { stringValue: String(v) }; }
function iv(v) { return { integerValue: String(v) }; }

/* The console's own copy: PBKDF2-120k, base64, salt "naluno-admin-v1|uid". */
function consoleCopy(pass) {
  return nodeCrypto.pbkdf2Sync(pass, "naluno-admin-v1|" + UID, 120000, 32, "sha256").toString("base64");
}
/* The worker's old v2 copy at 150k. */
function v2Copy(pass, iters) {
  const salt = nodeCrypto.randomBytes(16);
  return {
    v: 2, iters: iters, salt: salt.toString("base64"),
    hash: nodeCrypto.pbkdf2Sync(pass, salt, iters, 32, "sha256").toString("hex"),
  };
}
function shaCopy(pass) {
  return nodeCrypto.createHash("sha256").update(UID + ":" + pass).digest("hex");
}

function serve(docs, writes) {
  setFetchImpl(async (url, opts) => {
    const u = String(url);
    if (u.includes("accounts:lookup")) {
      return new Response(JSON.stringify({
        users: [{ localId: UID, email: "magjoed@gmail.com", emailVerified: true }],
      }), { status: 200 });
    }
    const method = (opts && opts.method) || "GET";
    for (const path of Object.keys(docs)) {
      if (u.includes(path) && method === "GET") {
        return new Response(JSON.stringify({ name: "x/" + path, fields: docs[path] }), { status: 200 });
      }
    }
    if (method !== "GET" && writes) writes.push({ url: u, body: opts && opts.body });
    if (method === "GET") return new Response("{}", { status: 404 });
    return new Response("{}", { status: 200 });
  });
}

async function unlock(pass) {
  const res = await handleRequest(req("/v1/admin/unlock", {
    method: "POST",
    headers: { Authorization: "Bearer tok", "Content-Type": "application/json" },
    body: JSON.stringify({ password: pass }),
  }), ENV);
  return res.status;
}
async function flagsWith(pass) {
  const res = await handleRequest(req("/v1/admin/overview", {
    method: "GET",
    headers: { Authorization: "Bearer tok", "X-Naluno-Admin": pass },
  }), ENV);
  return res.status;
}

test("the console's own 120k copy is accepted by the worker", async () => {
  resetMemory();
  serve({ ["/users/" + UID + "/vault/main"]: { _consoleGate: { mapValue: { fields: { hash: sv(consoleCopy(PASS)), v: iv(1) } } } } });
  assert.equal(await unlock(PASS), 200);
  assert.equal(await flagsWith(PASS), 200);
  resetMemory();
  assert.equal(await unlock("wrong-pass-123"), 401);
  setFetchImpl(null);
});

test("the old 150k v2 copy is accepted", async () => {
  resetMemory();
  const c = v2Copy(PASS, 150000);
  serve({ ["/users/" + UID + "/vault/main"]: { _consoleGate: { mapValue: { fields: {
    v: iv(2), iters: iv(150000), salt: sv(c.salt), hash: sv(c.hash),
  } } } } });
  assert.equal(await unlock(PASS), 200);
  resetMemory();
  assert.equal(await unlock("nope-nope-1"), 401);
  setFetchImpl(null);
});

test("the oldest sha copy still works, and wins without the slow path", async () => {
  resetMemory();
  serve({ ["/adminConsole/" + UID]: { hash: sv(shaCopy(PASS)) } });
  const t = Date.now();
  assert.equal(await unlock(PASS), 200);
  assert.ok(Date.now() - t < 2000);
  setFetchImpl(null);
});

test("any one good copy is enough even when another copy is a different password", async () => {
  resetMemory();
  const other = v2Copy("some-older-password", 150000);
  serve({
    ["/users/" + UID + "/vault/main"]: { _consoleGate: { mapValue: { fields: { hash: sv(consoleCopy(PASS)), v: iv(1) } } } },
    ["/users/" + UID + "/consoleGate/main"]: { v: iv(2), iters: iv(150000), salt: sv(other.salt), hash: sv(other.hash) },
  });
  assert.equal(await unlock(PASS), 200);
  resetMemory();
  assert.equal(await unlock("some-older-password"), 200);
  setFetchImpl(null);
});

test("setting a password no longer crashes the worker, and the new copy is checkable natively", async () => {
  resetMemory();
  const writes = [];
  serve({}, writes);
  const res = await handleRequest(req("/v1/admin/password", {
    method: "POST",
    headers: { Authorization: "Bearer tok", "Content-Type": "application/json" },
    body: JSON.stringify({ next_password: PASS }),
  }), ENV);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  const w = writes.find((x) => /vault\/main|adminCredentials|adminConsole/.test(x.url));
  assert.ok(w, "a copy was written");
  assert.ok(String(w.body).includes('"100000"'), "new copy uses 100k");
  setFetchImpl(null);
});

test("no password on file: the console is not asked for one (unchanged)", async () => {
  resetMemory();
  serve({});
  const res = await handleRequest(req("/v1/admin/overview", {
    method: "GET", headers: { Authorization: "Bearer tok" },
  }), ENV);
  assert.equal(res.status, 200);
  setFetchImpl(null);
});
