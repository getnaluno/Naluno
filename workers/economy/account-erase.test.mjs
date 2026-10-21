/* 21 Oct e: a Callsign the person deleted is erased 30 days later.
   Run: node workers/economy/account-erase.test.mjs */
import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { ERASE_AFTER_DAYS, dueForErase, eraseClosedAccounts } from "./account-erase.mjs";
import { setFetchImpl, runAccountErase } from "./handler.mjs";
import { handleWireNotify, webPushOf, resetWireNotify } from "./wire-notify.mjs";

const DAY = 86400000;
const NOW = 1_830_000_000_000;
async function genSa() {
  const pair = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
  const bytes = new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey));
  let bin = ""; for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  const pem = "-----BEGIN PRIVATE KEY-----\n" + btoa(bin).replace(/(.{64})/g, "$1\n") + "\n-----END PRIVATE KEY-----\n";
  return JSON.stringify({ client_email: "x@y.iam.gserviceaccount.com", private_key: pem, project_id: "p", token_uri: "https://oauth2.googleapis.com/token" });
}

test("only a Callsign its owner deleted, 30 days on, with no keep mark", () => {
  assert.equal(ERASE_AFTER_DAYS, 30);
  const base = { uid: "u1", accountState: "closed", closedKind: "self", closedAt: NOW - 31 * DAY };
  assert.equal(dueForErase(base, NOW, new Set()), true);
  assert.equal(dueForErase({ ...base, closedAt: NOW - 29 * DAY }, NOW, new Set()), false, "not before 30 days");
  assert.equal(dueForErase({ ...base, closedKind: "desk" }, NOW, new Set()), false, "a ban stays as the record of why");
  assert.equal(dueForErase({ ...base, accountState: "active" }, NOW, new Set()), false, "restored");
  assert.equal(dueForErase(base, NOW, new Set(["u1"])), false, "kept for an open matter");
  assert.equal(dueForErase({ ...base, erasedAt: NOW - DAY }, NOW, new Set()), false, "already erased");
});

test("everything under the account and its mailbox goes, then the marker; a failed delete leaves it for the next run", async () => {
  const store = new Map();
  for (let i = 0; i < 650; i++) store.set("users/u1/beaconTrail/t" + i, 1);
  store.set("users/u1/vault/main", 1); store.set("users/u1/compassMessages/m1", 1); store.set("wireDrop/u1/inbox/x", 1);
  store.set("users/u2/vault/main", 1);
  const rows = [
    ...Array.from({ length: 100 }, (_, i) => ({ uid: "ban" + i, data: { accountState: "closed", closedKind: "desk", closedAt: NOW - 400 * DAY + i } })),
    { uid: "u1", data: { accountState: "closed", closedKind: "self", closedAt: NOW - 40 * DAY } },
  ];
  const marks = [];
  let failNext = false;
  const io = {
    held: async () => new Set(),
    closedBefore: async (cutoff, limit, after) => rows.filter((r) => r.data.closedAt < cutoff && (after == null || r.data.closedAt > after)).slice(0, limit),
    descendants: async (parent, limit) => [...store.keys()].filter((k) => k.startsWith(parent.slice(1) + "/")).slice(0, limit),
    remove: async (names) => { if (failNext) return false; names.forEach((n) => store.delete(n)); return true; },
    tombstone: async (uid) => { marks.push(uid); return true; },
  };
  failNext = true;
  const bad = await eraseClosedAccounts(io, NOW);
  assert.equal(bad.ok, false); assert.deepEqual(marks, [], "no marker while data is still there");
  failNext = false;
  const out = await eraseClosedAccounts(io, NOW);
  assert.equal(out.ok, true);
  assert.deepEqual(out.erased, ["u1"], "reached past a page of bans");
  assert.ok(![...store.keys()].some((k) => k.startsWith("users/u1/") || k.startsWith("wireDrop/u1/")));
  assert.ok(store.has("users/u2/vault/main"), "nobody else is touched");
});

test("the worker run: kind-less query under the account, and the whole record replaced by the marker", async () => {
  const env = { FIREBASE_SERVICE_ACCOUNT: await genSa(), FIREBASE_PROJECT_ID: "p" };
  const seen = { desc: [], commits: 0, patch: null };
  setFetchImpl(async (url, init) => {
    const u = String(url);
    if (/oauth2/.test(u)) return new Response(JSON.stringify({ access_token: "t", expires_in: 3600 }), { status: 200 });
    if (/legalHolds/.test(u)) return new Response(JSON.stringify({}), { status: 200 });
    if (/documents:runQuery$/.test(u)) {
      return new Response(JSON.stringify([{ document: { name: "projects/p/databases/(default)/documents/users/u9", fields: { accountState: { stringValue: "closed" }, closedKind: { stringValue: "self" }, closedAt: { integerValue: String(NOW - 45 * DAY) } } } }]), { status: 200 });
    }
    if (/:runQuery$/.test(u)) {
      const q = JSON.parse(init.body).structuredQuery;
      seen.desc.push(u.replace(/^.*documents/, ""));
      assert.deepEqual(q.from, [{ allDescendants: true }]);
      if (seen.desc.length === 1) return new Response(JSON.stringify([{ document: { name: "projects/p/databases/(default)/documents/users/u9/vault/main" } }]), { status: 200 });
      return new Response(JSON.stringify([{ readTime: "x" }]), { status: 200 });
    }
    if (/:commit$/.test(u)) { seen.commits++; return new Response("{}", { status: 200 }); }
    if (init && init.method === "PATCH") { seen.patch = { u, body: JSON.parse(init.body) }; return new Response("{}", { status: 200 }); }
    return new Response("{}", { status: 404 });
  });
  const out = await runAccountErase(env, NOW);
  setFetchImpl(null);
  assert.equal(out.ok, true, JSON.stringify(out));
  assert.deepEqual(out.erased, ["u9"]);
  assert.deepEqual(seen.desc, ["/users/u9:runQuery", "/wireDrop/u9:runQuery"]);
  assert.equal(seen.commits, 1);
  assert.ok(!/updateMask/.test(seen.patch.u), "no mask: every other field is removed");
  assert.deepEqual(Object.keys(seen.patch.body.fields).sort(), ["accountState", "closedKind", "deleted", "erasedAt"]);
  const idx = fs.readFileSync(new URL("./index.mjs", import.meta.url), "utf8");
  assert.ok(/runAccountErase\(env\)\.catch\(/.test(idx), "on the 10-minute schedule");
});

test("Wireline alerts: every browser of the person, and the timing id passed through", async () => {
  resetWireNotify();
  const sent = [];
  const docs = {
    "/users/me/connections/you": { a: 1 }, "/users/you/connections/me": { a: 1 },
    "/threads/me_you": { participants: ["me", "you"], lastMessageFrom: "me", lastMessageAt: NOW - 1000, lastKind: "text" },
    "/users/me": { name: "Me" }, "/users/you": {},
    "/users/you/vault/main": { fcmTokenAndroid: "A".repeat(30), webPush: { d1: { t: "W".repeat(30), at: NOW - 5 }, d2: { t: "V".repeat(30), at: NOW - 9 } } },
  };
  const out = await handleWireNotify({ to: "you", clientMsgId: "c1", pingId: "pabc123" }, { uid: "me" }, {
    now: () => NOW, projectId: "p", getDoc: async (p) => docs[p] || null, accessToken: async () => "tok",
    fetch: async (u, o) => { sent.push(JSON.parse(o.body).message); return new Response("{}", { status: 200 }); },
  });
  assert.equal(out.body.sent, 3);
  assert.ok(sent.every((m) => m.data.pingId === "pabc123"));
  assert.equal(sent.filter((m) => m.webpush && m.webpush.notification).length, 2, "both browsers get a visible alert");
  assert.deepEqual(webPushOf({ webPush: { x: { t: "short" } } }), []);
  resetWireNotify();
  const out2 = await handleWireNotify({ to: "you", clientMsgId: "c2", pingId: "<script>" }, { uid: "me" }, {
    now: () => NOW, projectId: "p", getDoc: async (p) => docs[p] || null, accessToken: async () => "tok",
    fetch: async (u, o) => { sent.push(JSON.parse(o.body).message); return new Response("{}", { status: 200 }); },
  });
  assert.equal(out2.body.sent, 3);
  assert.ok(!sent.slice(-3).some((m) => "pingId" in m.data), "a bad id is dropped");
});
