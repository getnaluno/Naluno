/* 13a: Launch & Capacity, end to end against an in-memory Firestore REST API
   that applies preconditions and commits atomically, with random delays so
   concurrent requests really interleave. */
import assert from "node:assert/strict";
import { handleRequest, resetMemory, setFetchImpl } from "./handler.mjs";
import { defaultConfig, validateConfig, activatePhase, compareLimits, registrationState, evaluateGuard, withDefaults, MIB, GIB } from "./launch.mjs";

/* ---------------- pure logic ---------------- */
{
  const c = defaultConfig();
  assert.equal(validateConfig(c).ok, true);
  assert.equal(c.activePhase, "founding");
  assert.equal(c.registration.maxAccounts, 50, "room for the 29 accounts and 12+ Play testers");
  assert.equal(c.media.broadcast.maxVideoBytes, 8 * GIB, "founding keeps today's 8 GB");
  assert.equal(c.media.broadcast.maxVideoSec, 3 * 3600, "founding keeps today's 3 h ceiling (Reach still decides per account)");
  assert.equal(c.media.signal.maxVideoBytes, 95 * MIB);
  assert.equal(c.media.live.maxLiveSec, 0, "founding: no live time limit, as today");
  assert.equal(c.guard.budgets.monthlyUsd, 0, "no money is filled in");
  // validation catches nonsense
  const bad = JSON.parse(JSON.stringify(c));
  bad.media.broadcast.maxVideoBytes = 9 * GIB;
  bad.media.signal.maxVideoBytes = 200 * MIB;
  bad.guard.thresholds = { watch: 80, warning: 60, critical: 95 };
  bad.features.sports = true;
  bad.registration.maxAccounts = -1;
  bad.media.formats.image.push("image/svg+xml");
  const v = validateConfig(bad);
  assert.equal(v.ok, false);
  ["8 GB", "95 MiB", "thresholds", "features.sports", "maxAccounts", "SVG"].forEach((w) => assert.ok(v.errors.some((e) => e.includes(w)), "catches " + w));
  // a phase change reports every limit that goes down
  const beta = activatePhase(c, "beta");
  const cmp = compareLimits(c.media, beta.media);
  assert.ok(cmp.lowered.some((x) => x.key === "live.maxLiveSec"));
  assert.equal(beta.registration.maxAccounts, 500);
  assert.equal(beta.registration.emergencyPause, false);
  const paused = activatePhase(Object.assign({}, c, { registration: Object.assign({}, c.registration, { emergencyPause: true }) }), "beta");
  assert.equal(paused.registration.emergencyPause, true, "a phase change never lifts the emergency pause");
  // registration states
  assert.equal(registrationState(c, 29).accepting, true);
  assert.equal(registrationState(c, 50).reason, "full");
  assert.equal(registrationState(Object.assign({}, c, { registration: Object.assign({}, c.registration, { maxAccounts: 10 }) }), 29).reason, "full", "a cap below the count stops new sign-ups, nothing else");
  // guard
  const g = evaluateGuard(c.guard, { storageBytes: 48 * GIB, todayUploadBytes: 5 });
  assert.equal(g.level, "critical");
  assert.equal(g.restricting.largeUploads, true);
  assert.equal(g.items.find((i) => i.key === "monthCost").level, "not set", "an empty budget is not 0");
  assert.equal(evaluateGuard(c.guard, { storageBytes: 31 * GIB }).level, "watch");
  assert.equal(evaluateGuard(c.guard, {}).level, "normal");
  assert.equal(evaluateGuard(c.guard, { storageBytes: null }).items[0].level, "unknown");
  // a stored config missing new fields is filled, nothing set is changed
  const old = withDefaults({ activePhase: "closed", registration: { open: false, maxAccounts: 70 } });
  assert.equal(old.activePhase, "closed");
  assert.equal(old.registration.open, false);
  assert.equal(old.registration.maxAccounts, 70);
  assert.equal(old.registration.waitlist, true);
}

/* ---------------- fake Firestore ---------------- */
const pair = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
const kb = new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey));
let bin = ""; for (let i = 0; i < kb.length; i++) bin += String.fromCharCode(kb[i]);
const pem = "-----BEGIN PRIVATE KEY-----\n" + btoa(bin).replace(/(.{64})/g, "$1\n") + "\n-----END PRIVATE KEY-----\n";
const env = { FIREBASE_PROJECT_ID: "naluno-28a00", FIREBASE_WEB_API_KEY: "k", SWEEP_KEY: "s".repeat(32),
  GOOGLE_SERVICE_ACCOUNT: JSON.stringify({ client_email: "sa@x.iam.gserviceaccount.com", private_key: pem, project_id: "naluno-28a00", token_uri: "https://oauth2.googleapis.com/token" }) };
const ROOT = "https://firestore.googleapis.com/v1/projects/naluno-28a00/databases/(default)/documents";
const NAME = "projects/naluno-28a00/databases/(default)/documents/";

function enc(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === "boolean") return { booleanValue: v };
  if (typeof v === "number") return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === "string") return { stringValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(enc) } };
  const f = {}; Object.keys(v).forEach((k) => { f[k] = enc(v[k]); }); return { mapValue: { fields: f } };
}
function dec(v) {
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return v.doubleValue;
  if ("booleanValue" in v) return v.booleanValue;
  if ("nullValue" in v) return null;
  if ("stringValue" in v) return v.stringValue;
  if ("arrayValue" in v) return (v.arrayValue.values || []).map(dec);
  if ("mapValue" in v) { const o = {}; const f = v.mapValue.fields || {}; Object.keys(f).forEach((k) => { o[k] = dec(f[k]); }); return o; }
  return undefined;
}
const store = new Map();
let tick = 0;
const stamp = () => new Date(1_800_000_000_000 + (++tick)).toISOString();
function setDoc(path, fields, mask) {
  const cur = store.get(path);
  const next = mask && cur ? Object.assign({}, cur.fields) : {};
  Object.keys(fields).forEach((k) => { if (!mask || mask.includes(k)) next[k] = fields[k]; });
  if (mask && cur) mask.forEach((k) => { if (!(k in fields)) delete next[k]; });
  store.set(path, { fields: next, updateTime: stamp() });
}
const plain = (path) => { const d = store.get(path); if (!d) return null; const o = {}; Object.keys(d.fields).forEach((k) => { o[k] = dec(d.fields[k]); }); return o; };
const docOf = (path) => { const d = store.get(path); return d && { name: NAME + path, fields: d.fields, updateTime: d.updateTime }; };
function preOk(path, pre) {
  if (!pre) return true;
  const cur = store.get(path);
  if (pre.exists === false) return !cur;
  if (pre.exists === true) return !!cur;
  if (pre.updateTime) return !!cur && cur.updateTime === pre.updateTime;
  return true;
}
function matches(fields, filter) {
  if (!filter) return true;
  if (filter.compositeFilter) return filter.compositeFilter.filters.every((f) => matches(fields, f));
  const f = filter.fieldFilter;
  const have = fields[f.field.fieldPath];
  if (!have) return false;
  const a = dec(have), b = dec(f.value);
  if (f.op === "EQUAL") return a === b;
  if (f.op === "GREATER_THAN_OR_EQUAL") return a >= b;
  return false;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let users = { u_reporter: "reporter1" };
setFetchImpl(async (url, opts) => {
  const u = String(url);
  const method = (opts && opts.method) || "GET";
  await sleep(Math.floor(Math.random() * 6));
  if (u.includes("oauth2")) return new Response(JSON.stringify({ access_token: "sa", expires_in: 3600 }), { status: 200 });
  if (u.includes("accounts:lookup")) {
    const tok = JSON.parse(opts.body).idToken;
    const uid = tok.replace(/^tok-/, "");
    const op = uid === "operator1";
    return new Response(JSON.stringify({ users: [{ localId: uid, email: op ? "magjoed@gmail.com" : "", emailVerified: op }] }), { status: 200 });
  }
  if (u.includes("cloudflare.com") || u.includes("monitoring")) return new Response("{}", { status: 404 });
  if (!u.startsWith(ROOT)) return new Response("{}", { status: 200 });
  const rest = u.slice(ROOT.length);
  const body = opts && opts.body ? JSON.parse(opts.body) : null;
  if (rest.startsWith(":commit")) {
    const writes = body.writes;
    for (const w of writes) {
      const path = (w.update ? w.update.name : w.delete || "").replace(NAME, "");
      if (!preOk(path, w.currentDocument)) return new Response(JSON.stringify({ error: { status: "FAILED_PRECONDITION" } }), { status: 400 });
    }
    for (const w of writes) {
      if (w.update) setDoc(w.update.name.replace(NAME, ""), w.update.fields, w.updateMask && w.updateMask.fieldPaths);
      if (w.transform) {
        const path = w.transform.document.replace(NAME, "");
        const cur = store.get(path) ? Object.assign({}, store.get(path).fields) : {};
        w.transform.fieldTransforms.forEach((t) => {
          const k = t.fieldPath.replace(/^`|`$/g, "");
          cur[k] = { integerValue: String((cur[k] ? Number(dec(cur[k])) : 0) + Number(t.increment.integerValue)) };
        });
        store.set(path, { fields: cur, updateTime: stamp() });
      }
    }
    return new Response(JSON.stringify({ writeResults: [] }), { status: 200 });
  }
  if (rest.startsWith(":runAggregationQuery")) {
    const q = body.structuredAggregationQuery.structuredQuery;
    const col = q.from[0].collectionId;
    const n = [...store.keys()].filter((k) => k.split("/").length === 2 && k.startsWith(col + "/") && matches(store.get(k).fields, q.where)).length;
    return new Response(JSON.stringify([{ result: { aggregateFields: { n: { integerValue: String(n) } } } }]), { status: 200 });
  }
  const [pathPart, query] = rest.slice(1).split("?");
  const path = decodeURIComponent(pathPart);
  const params = new URLSearchParams(query || "");
  if (method === "GET") {
    if (path.split("/").length % 2 === 1) { // a collection
      const docs = [...store.keys()].filter((k) => k.startsWith(path + "/") && k.split("/").length === path.split("/").length + 1).map(docOf);
      return new Response(JSON.stringify({ documents: docs }), { status: 200 });
    }
    const d = docOf(path);
    return d ? new Response(JSON.stringify(d), { status: 200 }) : new Response(JSON.stringify({ error: { code: 404 } }), { status: 404 });
  }
  if (method === "DELETE") { store.delete(path); return new Response("{}", { status: 200 }); }
  if (method === "POST" && path.split("/").length % 2 === 1) {
    const id = "auto" + (++tick);
    setDoc(path + "/" + id, body.fields || {});
    return new Response(JSON.stringify(docOf(path + "/" + id)), { status: 200 });
  }
  if (method === "PATCH") {
    const pre = {};
    if (params.get("currentDocument.updateTime")) pre.updateTime = params.get("currentDocument.updateTime");
    if (params.get("currentDocument.exists")) pre.exists = params.get("currentDocument.exists") === "true";
    if (!preOk(path, Object.keys(pre).length ? pre : null)) return new Response(JSON.stringify({ error: { status: "FAILED_PRECONDITION" } }), { status: 400 });
    const mask = params.getAll("updateMask.fieldPaths");
    setDoc(path, body.fields || {}, mask.length ? mask : null);
    return new Response(JSON.stringify(docOf(path)), { status: 200 });
  }
  return new Response("{}", { status: 200 });
});

const call = async (path, o) => {
  o = o || {};
  const headers = { "Content-Type": "application/json" };
  if (o.uid) headers.Authorization = "Bearer tok-" + o.uid;
  if (o.admin) headers["X-Naluno-Admin"] = "pw";
  if (o.sweep) headers["X-Naluno-Sweep"] = o.sweep;
  const res = await handleRequest(new Request("https://w.example" + path, { method: o.body ? "POST" : "GET", headers, body: o.body ? JSON.stringify(o.body) : undefined }), env);
  return { status: res.status, body: await res.json() };
};

resetMemory();
// 29 existing accounts
for (let i = 0; i < 29; i++) setDoc("users/old" + String(i).padStart(4, "0") + "xx", { name: enc("Old " + i) });

/* ---- status before any config: defaults, counter started from the profiles ---- */
let st = await call("/v1/launch/status");
assert.equal(st.status, 200);
assert.equal(st.body.accepting, true);
assert.equal(plain("launchState/production").registered, 29, "the counter starts from the 29 accounts");

/* ---- an existing account is never refused, uses no place ---- */
let r = await call("/v1/register/claim", { uid: "old0000xx", body: {} });
assert.equal(r.body.ok, true);
assert.equal(r.body.already, "profile");
assert.equal(plain("launchState/production").registered, 29);

/* ---- concurrent sign-ups at the cap: exactly the free places are given ---- */
const cfgPath = "launchPrivate/production";
{
  const c = defaultConfig();
  c.registration.maxAccounts = 34; // 5 places left
  setDoc(cfgPath, Object.fromEntries(Object.entries(c).map(([k, v]) => [k, enc(v)])));
}
const racers = Array.from({ length: 25 }, (_, i) => "new" + String(i).padStart(4, "0") + "zz");
const results = await Promise.all(racers.map((uid) => call("/v1/register/claim", { uid, body: {} })));
const won = results.filter((x) => x.body.ok).length;
assert.equal(won, 5, "exactly 5 seats for 25 people at once (got " + won + ")");
assert.equal(plain("launchState/production").registered, 34);
assert.equal([...store.keys()].filter((k) => k.startsWith("registrations/")).length, 5);
const refused = results.find((x) => !x.body.ok);
assert.equal(refused.status, 403);
assert.equal(refused.body.reason, "full");
assert.equal(refused.body.waitlist, true);
assert.ok(plain("launchState/production").refused >= 20);
// the same person asking twice keeps one seat
const winner = racers[results.findIndex((x) => x.body.ok)];
r = await call("/v1/register/claim", { uid: winner, body: {} });
assert.equal(r.body.already, "seat");
assert.equal(plain("launchState/production").registered, 34);

/* ---- waiting list ---- */
st = await call("/v1/launch/status");
// status is cached for 10 s in the isolate; a claim clears it
assert.equal(st.body.accepting, false);
assert.equal(st.body.reason, "full");
r = await call("/v1/waitlist/join", { body: { email: "not-an-email" } });
assert.equal(r.status, 400);
r = await call("/v1/waitlist/join", { body: { email: "  Ama@Example.com " } });
assert.equal(r.body.ok, true);
const wlId = r.body.id, wlKey = r.body.key;
const entry = plain("waitlist/" + wlId);
assert.equal(entry.email, "ama@example.com");
assert.deepEqual(Object.keys(entry).sort(), ["at", "email", "env", "keyHash", "phase", "reason"].sort(), "only the email and when; no country, phone or name");
assert.ok(!JSON.stringify(entry).includes(wlKey), "the removal code itself is not stored");
r = await call("/v1/waitlist/leave", { body: { id: wlId, key: "0".repeat(36) } });
assert.equal(r.status, 403);
r = await call("/v1/waitlist/leave", { body: { id: wlId, key: wlKey } });
assert.equal(r.body.removed, true);
assert.equal(plain("waitlist/" + wlId), null);

/* ---- admin: needs operator + console password ---- */
r = await call("/v1/admin/launch", { uid: "someone1" });
assert.equal(r.status, 403, "not an operator");
r = await call("/v1/admin/launch", { uid: "operator1", admin: true });
assert.equal(r.status, 200);
const v0 = r.body.config.version || 0;
assert.equal(r.body.counter.registered, 34);

// raise the cap with a reason: saved, versioned, audited with old and new value
const next = JSON.parse(JSON.stringify(r.body.config));
next.registration.maxAccounts = 60;
r = await call("/v1/admin/launch/save", { uid: "operator1", admin: true, body: { config: next, reason: "Play testers", expectVersion: v0 } });
assert.equal(r.body.ok, true);
assert.equal(r.body.version, v0 + 1);
const audits = [...store.keys()].filter((k) => k.startsWith("launchAudit/")).map(plain);
const saveAudit = audits.find((a) => a.action === "save" && a.result === "ok");
assert.equal(saveAudit.actorUid, "operator1");
assert.equal(saveAudit.actorEmail, "magjoed@gmail.com");
assert.equal(saveAudit.reason, "Play testers");
const ch = saveAudit.changes.find((c) => c.setting === "registration.maxAccounts");
assert.deepEqual([ch.from, ch.to], ["34", "60"]);
assert.ok(plain("launchHistory/production-" + (v0 + 1)), "the version is kept for rollback");
assert.equal(plain("launchConfig/production").registration.open, true, "the public part is published");
assert.equal(plain("launchConfig/production").guard, undefined, "budgets are not public");
r = await call("/v1/launch/status");
// cache cleared by save
assert.equal(r.body.accepting, true);

// a stale editor cannot overwrite
r = await call("/v1/admin/launch/save", { uid: "operator1", admin: true, body: { config: next, reason: "old tab", expectVersion: v0 } });
assert.equal(r.status, 409);

// invalid settings are refused, recorded, and nothing changes
const broken = JSON.parse(JSON.stringify(next));
broken.media.signal.maxVideoBytes = 500 * MIB;
r = await call("/v1/admin/launch/save", { uid: "operator1", admin: true, body: { config: broken, reason: "try", expectVersion: v0 + 1 } });
assert.equal(r.status, 400);
assert.ok(r.body.errors.some((e) => e.includes("95 MiB")));
assert.ok([...store.keys()].filter((k) => k.startsWith("launchAudit/")).map(plain).some((a) => a.result && a.result.startsWith("refused")));
r = await call("/v1/admin/launch", { uid: "operator1", admin: true });
assert.equal(r.body.config.version, v0 + 1, "a refused save changes nothing");

// emergency pause: new sign-ups stop, existing accounts unaffected
r = await call("/v1/admin/launch/pause", { uid: "operator1", admin: true, body: { on: true, reason: "spam wave" } });
assert.equal(r.body.ok, true);
r = await call("/v1/register/claim", { uid: "late0001zz", body: {} });
assert.equal(r.status, 403);
assert.equal(r.body.reason, "paused");
r = await call("/v1/register/claim", { uid: "old0001xx", body: {} });
assert.equal(r.body.ok, true, "an existing account still gets in");

// switching phase keeps the pause, applies the phase cap and limits
r = await call("/v1/admin/launch/activate", { uid: "operator1", admin: true, body: { phase: "beta", reason: "open beta", expectVersion: v0 + 2 } });
assert.equal(r.body.ok, true);
assert.ok(r.body.lowered.length > 0, "the console is told what goes down");
r = await call("/v1/admin/launch", { uid: "operator1", admin: true });
assert.equal(r.body.config.activePhase, "beta");
assert.equal(r.body.config.registration.maxAccounts, 500);
assert.equal(r.body.config.registration.emergencyPause, true);
assert.equal(plain("launchConfig/production").media.live.maxLiveSec, 3 * 3600);
assert.equal([...store.keys()].filter((k) => k.startsWith("users/")).length, 29, "no account touched");

// pause off: sign-ups resume under the new cap
await call("/v1/admin/launch/pause", { uid: "operator1", admin: true, body: { on: false, reason: "calm" } });
r = await call("/v1/register/claim", { uid: "late0001zz", body: {} });
assert.equal(r.body.ok, true);

// closing registration
let cfgNow = (await call("/v1/admin/launch", { uid: "operator1", admin: true })).body.config;
cfgNow.registration.open = false;
cfgNow.registration.waitlist = false;
r = await call("/v1/admin/launch/save", { uid: "operator1", admin: true, body: { config: cfgNow, reason: "close", expectVersion: cfgNow.version } });
assert.equal(r.body.ok, true);
r = await call("/v1/register/claim", { uid: "late0002zz", body: {} });
assert.equal(r.body.reason, "closed");
assert.equal(r.body.waitlist, false);
r = await call("/v1/waitlist/join", { body: { email: "kato@example.com" } });
assert.equal(r.status, 403, "waiting list off: nothing is collected");

// rollback to the version with cap 60 (founding), recorded
r = await call("/v1/admin/launch/rollback", { uid: "operator1", admin: true, body: { version: v0 + 1, reason: "back" } });
assert.equal(r.body.ok, true);
r = await call("/v1/admin/launch", { uid: "operator1", admin: true });
assert.equal(r.body.config.activePhase, "founding");
assert.equal(r.body.config.registration.maxAccounts, 60);
assert.equal(r.body.config.registration.open, true);
assert.ok(r.body.history.length >= 5);

// recount: 29 profiles counted beside the 35 places given out. 14 Oct: it
// no longer lowers the place count (a seat whose Callsign is not made yet
// still holds its place; the cap would otherwise be passed).
r = await call("/v1/admin/launch/recount", { uid: "operator1", admin: true, body: { reason: "check" } });
assert.equal(r.body.profiles, 29);
assert.equal(r.body.registered, 35);
assert.equal(r.body.before, 35);

// upload reports: only with the shared key
r = await call("/v1/launch/event", { body: { ok: true, bytes: 1000, worker: "broadcast" } });
assert.equal(r.status, 403);
r = await call("/v1/launch/event", { sweep: env.SWEEP_KEY, body: { ok: true, bytes: 1000, worker: "broadcast" } });
assert.equal(r.status, 200);

// metrics: each figure carries its source
r = await call("/v1/admin/launch/metrics", { uid: "operator1", admin: true });
assert.equal(r.status, 200);
assert.equal(r.body.metrics.accounts.profiles, 29);
assert.match(r.body.metrics.delivered.source, /not measured/);
assert.match(r.body.metrics.processing.source, /no server-side video processing/);
assert.equal(r.body.metrics.cost.cloudflareMonthUsd, null, "no billing connected: no cost is invented");

setFetchImpl(null);
console.log("launch-rest: all checks passed");
