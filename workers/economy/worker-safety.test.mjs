/* Writes to a member's profile must name their fields. A Firestore PATCH
   without updateMask replaces the whole document. */
import assert from "node:assert/strict";
import test from "node:test";
import { handleRequest, resetMemory, setFetchImpl } from "./handler.mjs";

const ENV = { FIREBASE_PROJECT_ID: "naluno-28a00", FIREBASE_WEB_API_KEY: "k", OPERATOR_UID: "op1" };
function req(path, opts = {}) { return new Request("https://naluno-economy.naluno.workers.dev" + path, opts); }

function capture(uid, writes) {
  setFetchImpl(async (url, opts) => {
    const u = String(url);
    if (u.includes("accounts:lookup")) {
      return new Response(JSON.stringify({ users: [{ localId: uid, email: "x@y.z", emailVerified: true }] }), { status: 200 });
    }
    const m = (opts && opts.method) || "GET";
    if (m !== "GET") writes.push({ url: u, method: m });
    return new Response(m === "GET" ? "{}" : "{}", { status: m === "GET" ? 404 : 200 });
  });
}

test("presence never replaces the profile", async () => {
  resetMemory();
  const writes = [];
  capture("member1", writes);
  const res = await handleRequest(req("/v1/presence", {
    method: "POST", headers: { Authorization: "Bearer t", "Content-Type": "application/json" },
    body: JSON.stringify({ platform: "android", reason: "beat" }),
  }), ENV);
  assert.equal(res.status, 200);
  const prof = writes.filter((w) => /\/documents\/users\/member1(\?|$)/.test(w.url));
  assert.ok(prof.length >= 1, "profile write happened");
  prof.forEach((w) => assert.ok(w.url.includes("updateMask.fieldPaths=lastSeen"), "masked: " + w.url));
  prof.forEach((w) => assert.ok(!w.url.includes("updateMask.fieldPaths=name")));
  setFetchImpl(null);
});

test("suspending someone only touches the suspension fields", async () => {
  resetMemory();
  const writes = [];
  capture("op1", writes);
  const res = await handleRequest(req("/v1/admin/user-action", {
    method: "POST", headers: { Authorization: "Bearer t", "Content-Type": "application/json" },
    body: JSON.stringify({ user_id: "victim", action: "suspend", reason: "spam" }),
  }), ENV);
  assert.equal(res.status, 200);
  const prof = writes.filter((w) => /\/documents\/users\/victim(\?|$)/.test(w.url));
  assert.ok(prof.length === 1);
  assert.ok(prof[0].url.includes("updateMask.fieldPaths=suspended"));
  setFetchImpl(null);
});
