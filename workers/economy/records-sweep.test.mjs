/* 20 Oct d: call and message records are deleted after 12 months unless kept
   for an open matter. Run: node workers/economy/records-sweep.test.mjs */
import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { RECORDS_KEEP_DAYS, RECORD_KINDS, recordMayGo, recordsCutoff, sweepRecords } from "./records-sweep.mjs";
import { setFetchImpl, runRecordsSweep } from "./handler.mjs";

const DAY = 86400000;
const NOW = 1_830_000_000_000;

async function genSa() {
  const pair = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
  const bytes = new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey));
  let bin = ""; for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  const pem = "-----BEGIN PRIVATE KEY-----\n" + btoa(bin).replace(/(.{64})/g, "$1\n") + "\n-----END PRIVATE KEY-----\n";
  return JSON.stringify({ client_email: "x@y.iam.gserviceaccount.com", private_key: pem, project_id: "p", token_uri: "https://oauth2.googleapis.com/token" });
}

test("12 months, and every kind of call and message record", () => {
  assert.equal(RECORDS_KEEP_DAYS, 365);
  assert.equal(recordsCutoff(NOW), NOW - 365 * DAY);
  assert.deepEqual(RECORD_KINDS.map((k) => k.col).sort(), ["calls", "pushPings", "pushReceipts", "traffic"]);
});

test("a kept account or a kept record is never deleted", () => {
  const held = new Set(["u7"]);
  assert.equal(recordMayGo({ actorUid: "u1", peerUid: "u2" }, held), true);
  assert.equal(recordMayGo({ actorUid: "u1", peerUid: "u7" }, held), false, "either side kept");
  assert.equal(recordMayGo({ callerUid: "u7", calleeUid: "u2" }, held), false);
  assert.equal(recordMayGo({ fromUid: "u3", toUid: "u7" }, held), false);
  assert.equal(recordMayGo({ uid: "u7" }, held), false);
  assert.equal(recordMayGo({ actorUid: "u1", legalHold: true }, held), false);
  assert.equal(recordMayGo({ actorUid: "u1", legalHold: "yes" }, held), true, "only a real true keeps a row");
});

test("pages of kept records do not stop the run reaching later ones; a failed delete stops it", async () => {
  const rows = { traffic: [], calls: [], pushPings: [], pushReceipts: [] };
  for (let i = 0; i < 700; i++) rows.traffic.push({ name: "traffic/t" + i, at: NOW - 400 * DAY + i, data: { actorUid: i < 350 ? "kept" : "u" + i, peerUid: "x", at: NOW - 400 * DAY + i } });
  rows.traffic.push({ name: "traffic/new", at: NOW - 10 * DAY, data: { actorUid: "u", at: NOW - 10 * DAY } });
  const removed = [];
  const io = {
    held: async () => new Set(["kept"]),
    older: async (kind, cutoff, limit, after) => rows[kind.col].filter((r) => r.at < cutoff && (after == null || r.at > after) && !removed.includes(r.name)).sort((a, b) => a.at - b.at).slice(0, limit),
    remove: async (names) => { removed.push(...names); return true; },
  };
  const out = await sweepRecords(io, NOW);
  assert.equal(out.ok, true);
  assert.equal(out.byKind.traffic.deleted, 350);
  assert.equal(out.byKind.traffic.kept, 350);
  assert.ok(!removed.includes("traffic/new"), "a record newer than 12 months stays");
  assert.ok(!removed.some((n) => Number(n.slice(9)) < 350), "kept accounts' records stay");
  const bad = await sweepRecords({ held: async () => new Set(), older: async () => [{ name: "calls/a", at: 1, data: {} }], remove: async () => false }, NOW);
  assert.equal(bad.ok, false);
  assert.equal(bad.deleted, 0);
});

test("the worker run: reads the keep marks, asks with the right time type, deletes only what may go", async () => {
  const env = { FIREBASE_SERVICE_ACCOUNT: await genSa(), FIREBASE_PROJECT_ID: "p" };
  const queries = [], commits = [];
  const old = NOW - 400 * DAY;
  setFetchImpl(async (url, init) => {
    const u = String(url);
    if (/oauth2/.test(u)) return new Response(JSON.stringify({ access_token: "t", expires_in: 3600 }), { status: 200 });
    if (/legalHolds/.test(u)) return new Response(JSON.stringify({ documents: [{ name: "projects/p/databases/(default)/documents/legalHolds/kept" }] }), { status: 200 });
    if (/:runQuery/.test(u)) {
      const q = JSON.parse(init.body).structuredQuery;
      queries.push(q);
      const col = q.from[0].collectionId;
      const f = q.where.fieldFilter || q.where.compositeFilter.filters[0].fieldFilter;
      if (col === "calls") {
        assert.ok(f.value.timestampValue, "calls use a timestamp");
        return new Response(JSON.stringify([
          { document: { name: "projects/p/databases/(default)/documents/calls/c1", fields: { callerUid: { stringValue: "a" }, calleeUid: { stringValue: "b" }, createdAt: { timestampValue: new Date(old).toISOString() } } } },
          { document: { name: "projects/p/databases/(default)/documents/calls/c2", fields: { callerUid: { stringValue: "kept" }, calleeUid: { stringValue: "b" }, createdAt: { timestampValue: new Date(old).toISOString() } } } },
        ]), { status: 200 });
      }
      assert.ok(f.value.integerValue, col + " uses a number");
      assert.equal(Number(f.value.integerValue), NOW - 365 * DAY);
      if (col === "traffic") return new Response(JSON.stringify([{ document: { name: "projects/p/databases/(default)/documents/traffic/t1", fields: { actorUid: { stringValue: "a" }, at: { integerValue: String(old) } } } }]), { status: 200 });
      return new Response(JSON.stringify([{ readTime: "x" }]), { status: 200 });
    }
    if (/:commit/.test(u)) { commits.push(JSON.parse(init.body)); return new Response("{}", { status: 200 }); }
    return new Response("{}", { status: 404 });
  });
  const out = await runRecordsSweep(env, NOW);
  setFetchImpl(null);
  assert.equal(out.ok, true, JSON.stringify(out));
  assert.equal(out.deleted, 2);
  assert.equal(out.kept, 1);
  const gone = commits.flatMap((c) => c.writes.map((w) => w.delete.split("/").pop()));
  assert.deepEqual(gone.sort(), ["c1", "t1"]);
  assert.ok(queries.every((q) => q.orderBy[0].direction === "ASCENDING"));
  assert.deepEqual((await runRecordsSweep({}, NOW)).error, "no-service-account");
});

test("if the keep marks cannot all be read, nothing is deleted", async () => {
  const env = { FIREBASE_SERVICE_ACCOUNT: await genSa(), FIREBASE_PROJECT_ID: "p" };
  let commits = 0, pages = 0;
  setFetchImpl(async (url) => {
    const u = String(url);
    if (/oauth2/.test(u)) return new Response(JSON.stringify({ access_token: "t", expires_in: 3600 }), { status: 200 });
    if (/legalHolds/.test(u)) { pages++; return pages === 1 ? new Response(JSON.stringify({ documents: [], nextPageToken: "n2" }), { status: 200 }) : new Response("{}", { status: 503 }); }
    if (/:runQuery/.test(u)) return new Response(JSON.stringify([{ document: { name: "projects/p/databases/(default)/documents/traffic/t1", fields: { at: { integerValue: "1" } } } }]), { status: 200 });
    if (/:commit/.test(u)) { commits++; return new Response("{}", { status: 200 }); }
    return new Response("{}", { status: 404 });
  });
  await assert.rejects(runRecordsSweep(env, NOW));
  setFetchImpl(null);
  assert.equal(pages, 2, "the second page was asked for");
  assert.equal(commits, 0);
});

test("it runs on the worker's schedule", () => {
  const idx = fs.readFileSync(new URL("./index.mjs", import.meta.url), "utf8");
  assert.ok(/runRecordsSweep\(env\)\.catch\(/.test(idx));
});
