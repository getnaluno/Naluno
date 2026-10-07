/* THE RULE OF BANDS on the server (07 Oct d): a Band conversation is deleted
   two hours after the last person leaves, even when no phone is open. */
import assert from "node:assert/strict";
import { handleRequest, resetMemory, setFetchImpl, runBandSweep, VERSION } from "./handler.mjs";
import worker from "./index.mjs";
import { bandSweepPlan, messageGoes, mediaKeyFor, bandNeedsSweep, BAND_SETTLE_MS } from "./band-sweep.mjs";

const H = 60 * 60 * 1000;
const T = 1_800_000_000_000;
const MEDIA = "https://naluno-broadcast-upload.naluno.workers.dev";

// ---- pure decisions ----
// 3 a.m. talk, everyone gone, 9 a.m.: dead, everything up to the deadline goes.
let p = bandSweepPlan({ band: { aliveAt: T - 6 * H }, presence: [], newestMsgMs: T - 6 * H, now: T });
assert.equal(p.dead, true);
assert.equal(p.deleteUpTo, T - 4 * H);
assert.equal(messageGoes(p, T - 6 * H), true);
// Still inside the two hours: nothing goes.
p = bandSweepPlan({ band: { aliveAt: T - H }, presence: [], newestMsgMs: T - H, now: T });
assert.equal(p.dead, false);
assert.equal(messageGoes(p, T - 3 * H), false, "an alive Band keeps its conversation");
// An alive Band with a line: only what is before the line goes.
p = bandSweepPlan({ band: { aliveAt: T - 60000, messageEpoch: T - 30 * 60000 }, presence: [], newestMsgMs: T, now: T });
assert.equal(messageGoes(p, T - 31 * 60000), true);
assert.equal(messageGoes(p, T - 29 * 60000), false);
// Older Band with no clock: nobody here, last message 6 h ago: dead, and the clock is stamped.
p = bandSweepPlan({ band: {}, presence: [{ tunedInAt: T - 6 * H }], newestMsgMs: T - 6 * H, now: T });
assert.equal(p.dead, true);
assert.equal(p.stampAliveAt, T - 6 * H);
assert.equal(p.dropStalePresence, true);
// Older Band, someone tuned in right now: untouched.
p = bandSweepPlan({ band: {}, presence: [{ tunedInAt: T - 10000 }], newestMsgMs: T - 6 * H, now: T });
assert.equal(p.dead, false);
// Older Band, silent but a message 30 min ago: untouched.
p = bandSweepPlan({ band: {}, presence: [], newestMsgMs: T - 30 * 60000, now: T });
assert.equal(p.dead, false);
// A planted message dated far ahead is deleted with the dead conversation.
p = bandSweepPlan({ band: { aliveAt: T - 6 * H }, presence: [], newestMsgMs: T + 99 * H, now: T });
assert.equal(messageGoes(p, T + 99 * H), true, 'a future-dated message cannot outlive the deletion');
assert.equal(messageGoes(p, T + 60000), false, 'a phone a minute fast is not punished');
// Clock ran out, but someone on an older app is tuned in right now: a new
// gathering. The old conversation still goes; the line is drawn where it died.
p = bandSweepPlan({ band: { aliveAt: T - 6 * H }, presence: [{ tunedInAt: T - 20000 }], newestMsgMs: T - 60000, now: T });
assert.equal(p.dead, false);
assert.deepEqual(p.revive, { aliveAt: T, epoch: T - 4 * H });
assert.equal(messageGoes(p, T - 6 * H), true, 'the old conversation still goes');
assert.equal(messageGoes(p, T - 60000), false, 'what they are saying now stays');
// A brand-new empty Band: no clock stamped (people may be about to start).
p = bandSweepPlan({ band: {}, presence: [], newestMsgMs: 0, now: T });
assert.equal(p.dead, false);
assert.equal(p.stampAliveAt, 0);
assert.equal(BAND_SETTLE_MS, 2 * H);
// Files: only the sender's own upload on Naluno's media worker.
assert.equal(mediaKeyFor(MEDIA + "/o/u/alice01/1-a.webm", "alice01", MEDIA), "u/alice01/1-a.webm");
assert.equal(mediaKeyFor(MEDIA + "/o/u/bobby01/1-a.webm", "alice01", MEDIA), "", "someone else's file is never removed");
assert.equal(mediaKeyFor("https://evil.example/o/u/alice01/1-a.webm", "alice01", MEDIA), "");
assert.equal(mediaKeyFor(MEDIA + "/o/u/alice01/../bobby01/x.webm", "alice01", MEDIA), "");
assert.equal(mediaKeyFor("http://naluno-broadcast-upload.naluno.workers.dev/o/u/alice01/1-a.webm", "alice01", MEDIA), "");
// Which Bands a scheduled run looks at.
assert.equal(bandNeedsSweep({ aliveAt: T - H }, T), false);
assert.equal(bandNeedsSweep({ aliveAt: T - 3 * H }, T), true);
assert.equal(bandNeedsSweep({ aliveAt: T - 3 * H, sweptAt: T - 30 * 60000 }, T), false, "already swept after it died");
assert.equal(bandNeedsSweep({}, T), true);
assert.equal(bandNeedsSweep({ checkedAt: T - H }, T), false, 'older Band checked an hour ago: not again yet');
assert.equal(bandNeedsSweep({ checkedAt: T - 4 * H }, T), true);
assert.deepEqual(mediaKeyFor(MEDIA + "/o/u/alice01/1-a.webm", "alice01", ["https://naluno-signal-upload.naluno.workers.dev", MEDIA]), { key: "u/alice01/1-a.webm", base: MEDIA }, 'either media host');

// ---- against an in-memory Firestore ----
const store = new Map();   // path -> { fields, updateTime }
let tick = 0;
const pair = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048,
  publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
const kb = new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey));
let bin = ""; for (let i = 0; i < kb.length; i++) bin += String.fromCharCode(kb[i]);
const pem = "-----BEGIN PRIVATE KEY-----\n" + btoa(bin).replace(/(.{64})/g, "$1\n") + "\n-----END PRIVATE KEY-----\n";
const env = { FIREBASE_PROJECT_ID: "naluno-28a00", FIREBASE_WEB_API_KEY: "k", SWEEP_KEY: "s3cret-sweep",
  GOOGLE_SERVICE_ACCOUNT: JSON.stringify({ client_email: "sa@x.iam.gserviceaccount.com", private_key: pem, project_id: "naluno-28a00", token_uri: "https://oauth2.googleapis.com/token" }) };
const ROOT = "https://firestore.googleapis.com/v1/projects/naluno-28a00/databases/(default)/documents";
const ts = (ms) => ({ timestampValue: new Date(ms).toISOString() });
const put = (path, fields) => store.set(path, { fields, updateTime: "u" + (++tick) });
const dropped = [];
let failCommits = false;
let clock = T;
const realNow = Date.now;
Date.now = () => clock;
setFetchImpl(async (url, opts) => {
  const u = String(url);
  const method = (opts && opts.method) || "GET";
  if (u.includes("oauth2")) return new Response(JSON.stringify({ access_token: "sa", expires_in: 3600 }), { status: 200 });
  if (u.includes("identitytoolkit")) {
    const tok = JSON.parse(opts.body).idToken;
    if (!/^tok-/.test(tok)) return new Response(JSON.stringify({ error: { message: "INVALID_ID_TOKEN" } }), { status: 400 });
    return new Response(JSON.stringify({ users: [{ localId: tok.replace("tok-", "") }] }), { status: 200 });
  }
  if (u === MEDIA + "/b/drop") {
    assert.equal(opts.headers["X-Naluno-Sweep"], "s3cret-sweep");
    const keys = JSON.parse(opts.body).keys;
    dropped.push(...keys);
    return new Response(JSON.stringify({ ok: true, deleted: keys.length }), { status: 200 });
  }
  if (u.startsWith(ROOT + ":commit")) {
    const body = JSON.parse(opts.body);
    if (failCommits && body.writes.some((w) => w.delete)) return new Response("{}", { status: 500 });
    const key = (name) => name.split("/documents/")[1];
    for (const wr of body.writes) {
      const cd = wr.currentDocument;
      if (cd && cd.updateTime && wr.update) {
        const cur = store.get(key(wr.update.name));
        if (!cur || cur.updateTime !== cd.updateTime) return new Response(JSON.stringify({ error: { status: "FAILED_PRECONDITION" } }), { status: 400 });
      }
    }
    for (const wr of body.writes) {
      if (wr.delete) store.delete(key(wr.delete));
      if (wr.update) {
        const k = key(wr.update.name); const cur = store.get(k) || { fields: {} };
        Object.assign(cur.fields, wr.update.fields);
        cur.updateTime = "u" + (++tick);
        store.set(k, cur);
      }
    }
    return new Response("{}", { status: 200 });
  }
  if (u.startsWith(ROOT + "/") && method === "GET") {
    const k = decodeURIComponent(u.slice(ROOT.length + 1).split("?")[0]);
    if (store.has(k)) {
      const d = store.get(k);
      return new Response(JSON.stringify({ name: "projects/p/databases/(default)/documents/" + k, fields: d.fields, updateTime: d.updateTime }), { status: 200 });
    }
    // A collection list.
    const docs = [];
    for (const [path, d] of store) {
      if (path.startsWith(k + "/") && !path.slice(k.length + 1).includes("/")) {
        docs.push({ name: "projects/p/databases/(default)/documents/" + path, fields: d.fields });
      }
    }
    return new Response(JSON.stringify(docs.length ? { documents: docs } : {}), { status: 200 });
  }
  return new Response("{}", { status: 404 });
});
const sweepCall = async (bandId, who = "alice01") => {
  const headers = { "Content-Type": "application/json" };
  if (who) headers.Authorization = "Bearer tok-" + who;
  const res = await handleRequest(new Request("https://w.example/v1/bands/sweep", { method: "POST",
    headers, body: JSON.stringify({ bandId }) }), env);
  return { status: res.status, data: await res.json() };
};
const has = (prefix) => [...store.keys()].filter((k) => k.startsWith(prefix));
resetMemory();

// The 3 a.m. Band: people talked, everyone left at 3:05, nobody came back.
put("bands/band3am", { name: { stringValue: "Late" }, aliveAt: ts(T - 6 * H + 5 * 60000) });
put("bands/band3am/messages/m1", { ts: ts(T - 6 * H), from: { stringValue: "alice01" }, text: { stringValue: "hi" } });
put("bands/band3am/messages/m2", { ts: ts(T - 6 * H + 60000), from: { stringValue: "alice01" }, mediaUrl: { stringValue: MEDIA + "/o/u/alice01/1-a.webm" } });
put("bands/band3am/messages/m3", { ts: ts(T - 6 * H + 90000), from: { stringValue: "bobby01" }, mediaUrl: { stringValue: MEDIA + "/o/u/alice01/1-b.webm" } });
put("bands/band3am/wipe/m1", { queuedAt: { integerValue: "1" } });
put("bands/band3am/presence/bobby01", { tunedInAt: ts(T - 6 * H) });
// A Band with people in it right now.
put("bands/bandNow", { aliveAt: ts(T - 60000) });
put("bands/bandNow/messages/n1", { ts: ts(T - 3 * H), from: { stringValue: "alice01" } });
put("bands/bandNow/presence/alice01", { tunedInAt: ts(T - 20000) });
// An older Band without a clock, quiet for a day.
put("bands/bandOld", { lastEmptiedAt: ts(T - 26 * H) });
put("bands/bandOld/messages/o1", { ts: ts(T - 25 * H), from: { stringValue: "alice01" } });

// Not signed in: refused.
let r = await sweepCall("band3am", "");
assert.equal(r.status, 401);
// A phone opens Naluno at 9 a.m. and asks for band3am.
r = await sweepCall("band3am");
assert.equal(r.status, 200);
assert.equal(r.data.dead, true);
assert.equal(r.data.deleted, 3);
assert.deepEqual(has("bands/band3am/messages"), [], "every message of the dead conversation is deleted");
assert.deepEqual(has("bands/band3am/wipe"), []);
assert.deepEqual(has("bands/band3am/presence"), [], "stale tuned-in marks go too");
assert.deepEqual(dropped, ["u/alice01/1-a.webm"], "only the sender's own clip file is removed");
assert.ok(store.get("bands/band3am").fields.sweptAt, "the sweep is recorded on the Band");
// Asking again within a minute does nothing more.
r = await sweepCall("band3am");
assert.equal(r.data.recent, true);
// Bad ids are refused.
r = await sweepCall("../x");
assert.equal(r.status, 400);
// The live Band is untouched.
r = await sweepCall("bandNow");
assert.equal(r.data.dead, false);
assert.equal(has("bands/bandNow/messages").length, 1, "an alive conversation is never deleted");

// The scheduled run: the older Band is found and cleared, the live one kept.
await worker.scheduled({}, env, { waitUntil: (p) => p });
await new Promise((res) => setTimeout(res, 50));
assert.deepEqual(has("bands/bandOld/messages"), [], "an older Band quiet for a day is deleted by the schedule");
assert.ok(store.get("bands/bandOld").fields.aliveAt, "and gets its clock so the rules hold the line");
assert.equal(new Date(store.get("bands/bandOld").fields.aliveAt.timestampValue).getTime(), T - 25 * H);
assert.equal(has("bands/bandNow/messages").length, 1);

// An older Band that is alive is marked checked, so rounds skip it for a while.
put("bands/bandQuiet", {});
put("bands/bandQuiet/messages/q1", { ts: ts(T - 30 * 60000), from: { stringValue: "alice01" } });
let res = await runBandSweep(env, "bandQuiet");
assert.equal(res.deleted, 0);
assert.ok(store.get("bands/bandQuiet").fields.checkedAt, 'checked, not swept');
assert.equal(has("bands/bandQuiet/messages").length, 1);
// An older-app gathering in a Band whose clock ran out: new conversation kept, old one gone.
put("bands/bandOldApp", { aliveAt: ts(T - 6 * H) });
put("bands/bandOldApp/messages/a1", { ts: ts(T - 6 * H - 60000), from: { stringValue: "alice01" } });
put("bands/bandOldApp/messages/a2", { ts: ts(T - 60000), from: { stringValue: "alice01" } });
put("bands/bandOldApp/presence/alice01", { tunedInAt: ts(T - 10000) });
res = await runBandSweep(env, "bandOldApp");
assert.equal(res.revived, true);
assert.deepEqual(has("bands/bandOldApp/messages"), ["bands/bandOldApp/messages/a2"]);
assert.equal(new Date(store.get("bands/bandOldApp").fields.messageEpoch.timestampValue).getTime(), T - 4 * H);
assert.ok(!store.get("bands/bandOldApp").fields.sweptAt);
// A failed delete is not recorded as swept, so the next round tries again.
put("bands/bandFail", { aliveAt: ts(T - 6 * H) });
put("bands/bandFail/messages/f1", { ts: ts(T - 6 * H - 60000), from: { stringValue: "alice01" } });
failCommits = true;
res = await runBandSweep(env, "bandFail");
failCommits = false;
assert.equal(res.ok, false);
assert.ok(!store.get("bands/bandFail").fields.sweptAt, 'not marked swept when deletion failed');

// Two hours pass in the live Band after everyone leaves: then it goes.
store.delete("bands/bandNow/presence/alice01");
clock = T + 2 * H + 1000;
r = await sweepCall("bandNow");
assert.equal(r.data.dead, true);
assert.deepEqual(has("bands/bandNow/messages"), []);

// Health says the sweep is there.
const health = await handleRequest(new Request("https://w.example/health"), env);
const hb = await health.json();
assert.equal(hb.version, VERSION);
assert.equal(hb.bandSweep, true);
assert.equal(hb.mediaSweep, true);
// Without the shared key, files are left (messages still go).
Date.now = realNow;
console.log("band-sweep.test.mjs: all passed");
