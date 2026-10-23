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

/* ---- 23 Oct c: 3 wrong tries, then a 6-digit code ---- */
async function unlockJson(pass, extra, env) {
  const res = await handleRequest(req("/v1/admin/unlock", {
    method: "POST",
    headers: { Authorization: "Bearer tok", "Content-Type": "application/json" },
    body: JSON.stringify(Object.assign({ password: pass }, extra || {})),
  }), env || ENV);
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
function withCode(code) { return Object.assign({}, ENV, { CONSOLE_RECOVERY_CODE: code }); }

test("with a worker-secret code: 3 wrong tries lock the password, the code lets you back in", async () => {
  resetMemory();
  serve({ ["/users/" + UID + "/vault/main"]: { _consoleGate: { mapValue: { fields: { hash: sv(consoleCopy(PASS)), v: iv(1) } } } } });
  const ENVC = withCode("246813");
  for (let i = 1; i <= 3; i++) {
    const r = await unlockJson("wrong" + i, null, ENVC);
    assert.equal(r.status, 401, "wrong try " + i);
    assert.equal(r.body.tries_left, Math.max(0, 3 - i), "tries_left after " + i);
  }
  /* now even the RIGHT password is refused — the code is required */
  const blocked = await unlockJson(PASS, null, ENVC);
  assert.equal(blocked.status, 401);
  assert.equal(blocked.body.code_required, true);
  /* a wrong code does not let you in */
  assert.equal((await unlockJson(PASS, { recovery_code: "000000" }, ENVC)).status, 401);
  /* the right code gets in and asks for a reset */
  const ok = await unlockJson(PASS, { recovery_code: "246813" }, ENVC);
  assert.equal(ok.status, 200);
  assert.ok(ok.body.code_used && ok.body.must_reset);
  /* and the counter is cleared: the password works again */
  assert.equal((await unlockJson(PASS, null, ENVC)).status, 200);
  setFetchImpl(null);
});

test("the right password within 3 tries resets the counter (no lock)", async () => {
  resetMemory();
  serve({ ["/users/" + UID + "/vault/main"]: { _consoleGate: { mapValue: { fields: { hash: sv(consoleCopy(PASS)), v: iv(1) } } } } });
  const ENVC = withCode("111111");
  assert.equal((await unlockJson("nope1", null, ENVC)).status, 401);
  assert.equal((await unlockJson("nope2", null, ENVC)).status, 401);
  assert.equal((await unlockJson(PASS, null, ENVC)).status, 200);  // 3rd try correct
  // counter reset: two more wrong tries do not immediately require a code
  assert.equal((await unlockJson("nope3", null, ENVC)).body.code_required, false);
  setFetchImpl(null);
});

test("with NO code set anywhere, the owner is never bricked — cooldown, not a code wall", async () => {
  resetMemory();
  serve({ ["/users/" + UID + "/vault/main"]: { _consoleGate: { mapValue: { fields: { hash: sv(consoleCopy(PASS)), v: iv(1) } } } } });
  for (let i = 1; i <= 3; i++) await unlockJson("x" + i);
  const r = await unlockJson(PASS); // right password, but in cooldown
  assert.equal(r.status, 429);
  assert.ok(r.body.cooldown_s > 0 && !r.body.code_required, "cooldown, no code wall");
  setFetchImpl(null);
});

test("a saved 6-digit code (hashed) is checked, and only as a code; a 5/7-digit code is refused", async () => {
  resetMemory();
  // set a code (operator is unlocked: provide the password via header gate)
  serve({ ["/users/" + UID + "/vault/main"]: { _consoleGate: { mapValue: { fields: { hash: sv(consoleCopy(PASS)), v: iv(1) } } } } });
  const setRes = await handleRequest(req("/v1/admin/recovery-code", {
    method: "POST",
    headers: { Authorization: "Bearer tok", "X-Naluno-Admin": PASS, "Content-Type": "application/json" },
    body: JSON.stringify({ code: "654321" }),
  }), ENV);
  assert.equal(setRes.status, 200);
  const bad = await handleRequest(req("/v1/admin/recovery-code", {
    method: "POST",
    headers: { Authorization: "Bearer tok", "X-Naluno-Admin": PASS, "Content-Type": "application/json" },
    body: JSON.stringify({ code: "12345" }),
  }), ENV);
  assert.equal(bad.status, 400, "5 digits refused");
  // now lock and use the saved code
  for (let i = 1; i <= 3; i++) await unlockJson("w" + i);
  assert.equal((await unlockJson(PASS)).body.code_required, true);
  assert.equal((await unlockJson(PASS, { recovery_code: "654321" })).status, 200);
  setFetchImpl(null);
});

test("a non-operator cannot set a recovery code or reach the gate", async () => {
  resetMemory();
  setFetchImpl(async (url) => {
    if (String(url).includes("accounts:lookup")) {
      return new Response(JSON.stringify({ users: [{ localId: "intruder", email: "x@y.z", emailVerified: true }] }), { status: 200 });
    }
    return new Response("{}", { status: 404 });
  });
  const r = await handleRequest(req("/v1/admin/recovery-code", {
    method: "POST",
    headers: { Authorization: "Bearer tok", "Content-Type": "application/json" },
    body: JSON.stringify({ code: "999999" }),
  }), ENV);
  assert.equal(r.status, 403);
  setFetchImpl(null);
});

/* ---- 23 Oct c (final audit): the lock holds everywhere, never locks the owner ---- */
async function call(path, { method = "GET", pass, body, env } = {}) {
  const headers = { Authorization: "Bearer tok", "Content-Type": "application/json" };
  if (pass !== undefined) headers["X-Naluno-Admin"] = pass;
  const res = await handleRequest(req(path, { method, headers, body: body ? JSON.stringify(body) : undefined }), env || ENV);
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
const VAULT = () => ({ ["/users/" + UID + "/vault/main"]: { _consoleGate: { mapValue: { fields: { hash: sv(consoleCopy(PASS)), v: iv(1) } } } } });

test("guessing through another admin route counts too, and then the lock holds there", async () => {
  resetMemory(); serve(VAULT());
  const E = withCode("135790");
  for (const g of ["g1", "g2", "g3"]) assert.equal((await call("/v1/admin/overview", { pass: g, env: E })).status, 401);
  const r = await call("/v1/admin/overview", { pass: PASS, env: E });   // right password, but locked
  assert.equal(r.status, 401); assert.equal(r.body.code_required, true);
  assert.equal((await unlockJson(PASS, null, E)).body.code_required, true);
  assert.equal((await unlockJson(PASS, { recovery_code: "135790" }, E)).status, 200);
  assert.equal((await call("/v1/admin/overview", { pass: PASS, env: E })).status, 200, "open again after the code");
  setFetchImpl(null);
});

test("a console sending the SAME old password on every call counts once (cannot lock its owner out)", async () => {
  resetMemory(); serve(VAULT());
  const E = withCode("135790");
  for (let i = 0; i < 12; i++) await call("/v1/admin/overview", { pass: "stale-old-pass", env: E });
  assert.equal((await unlockJson(PASS, null, E)).status, 200, "owner still gets in with the right password");
  setFetchImpl(null);
});

test("status and change-password are not free ways to test guesses", async () => {
  resetMemory(); serve(VAULT());
  const E = withCode("135790");
  await call("/v1/admin/status", { pass: "s1", env: E });
  await call("/v1/admin/password", { method: "POST", body: { current_password: "s2", next_password: "whatever-123" }, env: E });
  await call("/v1/admin/status", { pass: "s3", env: E });
  assert.equal((await unlockJson(PASS, null, E)).body.code_required, true);
  setFetchImpl(null);
});

test("five wrong codes mean a wait for codes, never a permanent lock", async () => {
  resetMemory(); serve(VAULT());
  const E = withCode("135790");
  for (let i = 1; i <= 3; i++) await unlockJson("w" + i, null, E);
  for (let i = 0; i < 5; i++) assert.equal((await unlockJson(PASS, { recovery_code: "00000" + i }, E)).status, 401);
  const r = await unlockJson(PASS, { recovery_code: "135790" }, E);   // even the right code waits now
  assert.equal(r.status, 429); assert.ok(r.body.cooldown_s > 0);
  setFetchImpl(null);
});

test("the worker reads the console's last-resort account copy (wirelineHidden)", async () => {
  resetMemory();
  serve({ ["/users/" + UID + "/wirelineHidden/__nalunoConsoleGate"]: { hash: sv(consoleCopy(PASS)), v: iv(1) } });
  assert.equal(await unlock(PASS), 200);
  setFetchImpl(null);
});

test("the signup cap is generous by default, configurable, and 0 turns it off", async () => {
  const src = (await import("node:fs")).readFileSync(new URL("./handler.mjs", import.meta.url), "utf8");
  assert.ok(/if \(raw === undefined \|\| raw === null \|\| raw === ""\) return 300;/.test(src));
  assert.ok(/CLAIM_IP_PER_HOUR/.test(src) && /cap > 0 && !claimIpRate/.test(src));
});
