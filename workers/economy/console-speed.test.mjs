/* 24 Oct a: a console request reads every password copy at the same time,
   and a right password does not write anything. Each database call here
   takes 120 ms, like a real round trip from Cloudflare to Firestore; the
   copies used to be read one after another (4 x 120 ms with a user token,
   6 with the service account, plus the lock-out state and a write). */
import assert from "node:assert/strict";
import test from "node:test";
import nodeCrypto from "node:crypto";
import { handleRequest, resetMemory, setFetchImpl } from "./handler.mjs";

const ENV = { FIREBASE_PROJECT_ID: "naluno-28a00", FIREBASE_WEB_API_KEY: "k", OPERATOR_UID: "ibMOMY6Q3sVTCxIrwO2FGk43zw93" };
const UID = ENV.OPERATOR_UID;
const PASS = "my-console-pass-1";
const RT = 120;
const copy = nodeCrypto.pbkdf2Sync(PASS, "naluno-admin-v1|" + UID, 120000, 32, "sha256").toString("base64");
let calls = 0, writes = 0, inflight = 0, maxInflight = 0;
setFetchImpl(async (url, opts) => {
  const u = String(url); const m = (opts && opts.method) || "GET";
  if (u.includes("accounts:lookup")) return new Response(JSON.stringify({ users: [{ localId: UID, email: "magjoed@gmail.com", emailVerified: true }] }));
  calls++; if (m !== "GET") writes++;
  inflight++; maxInflight = Math.max(maxInflight, inflight);
  await new Promise((r) => setTimeout(r, RT));
  inflight--;
  if (m === "GET" && u.includes("/vault/main")) return new Response(JSON.stringify({ name: "x", fields: { _consoleGate: { mapValue: { fields: { hash: { stringValue: copy }, v: { integerValue: "1" } } } } } }));
  if (m === "GET") return new Response("{}", { status: 404 });
  return new Response("{}");
});
const call = async (path, body, pass) => {
  calls = 0; writes = 0; maxInflight = 0;
  const t = Date.now();
  const r = await handleRequest(new Request("https://naluno-economy.naluno.workers.dev" + path, {
    method: body ? "POST" : "GET",
    headers: { Authorization: "Bearer tok", "Content-Type": "application/json", "X-Naluno-Admin": pass == null ? PASS : pass },
    body: body ? JSON.stringify(body) : undefined,
  }), ENV);
  return { status: r.status, body: await r.json().catch(() => ({})), ms: Date.now() - t, calls, writes, maxInflight };
};

test("unlock with the right password: copies read together, about one round trip, nothing written", async () => {
  if (resetMemory) resetMemory();
  await call("/v1/admin/unlock", { password: PASS });           // first: also pays the slow hash
  const r = await call("/v1/admin/unlock", { password: PASS });
  assert.equal(r.status, 200); assert.equal(r.body.ok, true);
  assert.ok(r.maxInflight >= 3, "the copies are read at the same time (" + r.maxInflight + ")");
  assert.ok(r.ms < RT * 2.2, "one round trip, not one per copy: " + r.ms + " ms");
  assert.equal(r.writes, 0, "a right password writes nothing");
});
test("any console request: one round trip for the checks", async () => {
  const r = await call("/v1/admin/status");
  assert.equal(r.status, 200);
  assert.ok(r.ms < RT * 2.2, r.ms + " ms");
});
test("a wrong password is still refused and still counted", async () => {
  if (resetMemory) resetMemory();
  const r = await call("/v1/admin/unlock", { password: "not-it-at-all" });
  assert.equal(r.status, 401);
  assert.equal(r.body.ok, false);
  assert.equal(typeof r.body.tries_left, "number");
});
