/* 20 Oct c: what Naluno measures. Run: node workers/economy/measure.test.mjs */
import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { CATALOGUE, cleanEvent, dayCounters, takeMeasureBatch, MEASURE_KEEP_DAYS, ANONYMOUS_OK } from "./measure.mjs";
import { handleRequest, resetMemory, setFetchImpl, runMeasureSweep } from "./handler.mjs";
import { bandRoomCounters } from "./band-sweep.mjs";

async function genSa() {
  const pair = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
  const bytes = new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey));
  let bin = ""; for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  const pem = "-----BEGIN PRIVATE KEY-----\n" + btoa(bin).replace(/(.{64})/g, "$1\n") + "\n-----END PRIVATE KEY-----\n";
  return JSON.stringify({ client_email: "x@y.iam.gserviceaccount.com", private_key: pem, project_id: "p", token_uri: "https://oauth2.googleapis.com/token" });
}

test("only listed events and listed values are kept — never free text", () => {
  assert.equal(cleanEvent({ n: "made_up", p: {} }, true), null);
  assert.equal(cleanEvent({ n: "__proto__", p: {} }, true), null);
  const e = cleanEvent({ n: "call_end", p: { outcome: "connected", len: "1to5m", text: "hello mum", peer: "uid123", kind: "hologram" } }, true);
  assert.deepEqual(e, { n: "call_end", p: { outcome: "connected", len: "1to5m" } });
  assert.deepEqual(cleanEvent({ n: "compass_q", p: { topic: "what is the weather in kampala today", answered: "1" } }, true).p, { answered: "1" }, "a question is not a topic");
  assert.deepEqual(cleanEvent({ n: "translate_shown", p: { from: "en", to: "lg" } }, true).p, { from: "en", to: "lg" });
  assert.deepEqual(cleanEvent({ n: "translate_shown", p: { from: "<script>", to: "lg" } }, true).p, { to: "lg" });
  assert.deepEqual(cleanEvent({ n: "app_open", p: { build: "20261020c", platform: "android" } }, false).p, { build: "20261020c", platform: "android" });
});

test("before a Callsign only the welcome and app-health events are taken", () => {
  assert.ok(cleanEvent({ n: "onboard", p: { step: "welcome" } }, false));
  assert.equal(cleanEvent({ n: "msg_sent", p: { type: "text" } }, false), null);
  for (const n of Object.keys(ANONYMOUS_OK)) assert.ok(CATALOGUE[n], n);
});

test("day totals: an event, each value, and the network's country for some events", () => {
  const c = dayCounters([{ n: "msg_sent", p: { type: "voice" } }, { n: "msg_sent", p: { type: "text" } }, { n: "watch_depth", p: { q: "50" } }], "UG");
  assert.equal(c.n__msg_sent, 2);
  assert.equal(c.p__msg_sent__type__voice, 1);
  assert.equal(c.c__msg_sent__UG, 2);
  assert.equal(c.c__watch_depth__UG, undefined, "watching is not counted by country");
  assert.equal(Object.keys(dayCounters([{ n: "msg_sent", p: {} }], "not-a-country")).filter((k) => k.startsWith("c__")).length, 0);
});

test("a batch: day totals added, the batch kept 180 days with the uid, nothing else", async () => {
  const writes = [], kept = [];
  const out = await takeMeasureBatch({ d: "dev-1", events: [{ n: "call_end", p: { outcome: "missed" } }, { n: "junk" }] }, { uid: "u1", country: "KE" }, {
    now: () => 1_800_000_000_000, write: async (day, c) => writes.push([day, c]), keep: async (b) => kept.push(b),
  });
  assert.equal(out.body.kept, 1);
  assert.equal(writes[0][0], new Date(1_800_000_000_000).toISOString().slice(0, 10));
  assert.equal(kept[0].uid, "u1"); assert.equal(kept[0].country, "KE"); assert.equal(kept[0].device, "dev-1");
  assert.equal(kept[0].expireAt - kept[0].at, MEASURE_KEEP_DAYS * 86400000);
  assert.equal(MEASURE_KEEP_DAYS, 180);
  assert.deepEqual(Object.keys(kept[0]).sort(), ["at", "country", "device", "events", "expireAt", "uid"]);
  const many = await takeMeasureBatch({ events: Array.from({ length: 500 }, () => ({ n: "app_open", p: {} })) }, {}, { write: async () => {}, keep: async () => {} });
  assert.equal(many.body.kept, 100, "at most 100 events a batch");
});

test("the worker route: signed-in uid from the token, country from the network, no Callsign needed for the welcome", async () => {
  resetMemory();
  const calls = [];
  setFetchImpl(async (url, init) => {
    const u = String(url);
    calls.push({ u, body: init && init.body ? String(init.body) : "" });
    if (u.includes("oauth2.googleapis.com/token")) return new Response(JSON.stringify({ access_token: "sa", expires_in: 3600 }), { status: 200 });
    if (u.includes("accounts:lookup")) return new Response(JSON.stringify({ users: [{ localId: "user_m" }] }), { status: 200 });
    return new Response("{}", { status: 200 });
  });
  const env = { FIREBASE_PROJECT_ID: "p", FIREBASE_WEB_API_KEY: "k", GOOGLE_SERVICE_ACCOUNT: await genSa() };
  const req = (headers, events) => { const r = new Request("https://w.example/v1/measure", { method: "POST", headers: Object.assign({ "Content-Type": "application/json", "CF-Connecting-IP": "9.9.9." + Math.random() }, headers), body: JSON.stringify({ d: "x", events }) }); Object.defineProperty(r, "cf", { value: { country: "UG" } }); return r; };
  let res = await handleRequest(req({}, [{ n: "onboard", p: { step: "welcome" } }, { n: "msg_sent", p: { type: "text" } }]), env);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).kept, 1, "signed out: the message event is dropped");
  const commit = calls.find((c) => c.u.endsWith(":commit") && c.body.includes("measureDays"));
  assert.ok(commit && /n__onboard/.test(commit.body));
  const batch = calls.find((c) => /\/measureBatches$/.test(c.u.split("?")[0]));
  assert.ok(batch && /"stringValue":"UG"/.test(batch.body) && /"uid":\{"stringValue":""\}/.test(batch.body));
  calls.length = 0;
  res = await handleRequest(req({ Authorization: "Bearer tok" }, [{ n: "msg_sent", p: { type: "text" } }]), env);
  assert.equal((await res.json()).kept, 1);
  assert.ok(calls.some((c) => /\/measureBatches/.test(c.u) && /user_m/.test(c.body)));
  assert.ok(calls.some((c) => c.u.endsWith(":commit") && /c__msg_sent__UG/.test(c.body)));
  setFetchImpl(null);
});

test("batches older than 180 days are deleted by the scheduled run; the day totals are not", async () => {
  resetMemory();
  const now = 1_800_000_000_000;
  let query = null, deleted = [];
  setFetchImpl(async (url, init) => {
    const u = String(url);
    if (u.includes("oauth2.googleapis.com/token")) return new Response(JSON.stringify({ access_token: "sa", expires_in: 3600 }), { status: 200 });
    if (u.endsWith(":runQuery")) {
      query = JSON.parse(init.body);
      return new Response(JSON.stringify([{ document: { name: "projects/p/databases/(default)/documents/measureBatches/a" } }, { document: { name: "projects/p/databases/(default)/documents/measureBatches/b" } }]), { status: 200 });
    }
    if (u.endsWith(":commit")) { deleted = JSON.parse(init.body).writes.map((w) => w.delete); return new Response("{}", { status: 200 }); }
    return new Response("{}", { status: 200 });
  });
  const out = await runMeasureSweep({ FIREBASE_PROJECT_ID: "p", GOOGLE_SERVICE_ACCOUNT: await genSa() }, now);
  assert.equal(out.ok, true); assert.equal(out.deleted, 2);
  assert.equal(query.structuredQuery.from[0].collectionId, "measureBatches");
  assert.equal(query.structuredQuery.where.fieldFilter.op, "LESS_THAN");
  assert.equal(Number(query.structuredQuery.where.fieldFilter.value.integerValue), now - 180 * 86400000);
  assert.ok(deleted.every((d) => /measureBatches\//.test(d)));
  const idx = fs.readFileSync(new URL("./index.mjs", import.meta.url), "utf8");
  assert.ok(/runMeasureSweep\(env\)/.test(idx), "on the 10-minute schedule");
  setFetchImpl(null);
});

test("a Band gathering's counts: people who spoke in bands, how long, whether anything was said — never who", () => {
  const c = bandRoomCounters([{ from: "a", ts: 1000 }, { from: "b", ts: 400000 }, { from: "a", ts: 600000 }]);
  assert.equal(c.p__band_room_end__people__2, 1);
  assert.equal(c.p__band_room_end__life__5to15m, 1);
  assert.equal(c.p__band_room_end__said__1, 1);
  assert.ok(!JSON.stringify(c).includes('"a"'));
  assert.deepEqual(bandRoomCounters([]), { n__band_room_end: 1, p__band_room_end__said__0: 1 });
});

test("every measure the app sends is in the catalogue, with keys the catalogue knows", () => {
  const dir = new URL("../../js/", import.meta.url);
  const used = {};
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith(".js") || f.includes(".test.")) continue;
    const src = fs.readFileSync(new URL(f, dir), "utf8");
    const re = /nalunoMeasure(?:Once)?\(\s*'([a-z_]+)'\s*,\s*\{([^}]*)\}/g;
    let m;
    while ((m = re.exec(src))) {
      const keys = (m[2].match(/(?:^|[,{]\s*)([a-z]+)\s*:/g) || []).map((x) => x.replace(/[,{\s:]/g, ""));
      used[m[1]] = used[m[1]] || new Set();
      keys.forEach((k) => used[m[1]].add(k));
      assert.ok(CATALOGUE[m[1]], f + ": " + m[1] + " is not in the catalogue");
      for (const k of keys) assert.ok(k in CATALOGUE[m[1]], f + ": " + m[1] + "." + k + " is not in the catalogue");
    }
  }
  assert.ok(Object.keys(used).length >= 30, "the app measures " + Object.keys(used).length + " kinds of event");
});
