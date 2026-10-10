/* One adversary pass over the whole 10 Oct surface.
   A signed-in client that ignores the app. Defenses must hold.
   The one remaining hole is recorded at the bottom, not hidden. */
import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { handleRequest, resetMemory, setFetchImpl } from "./handler.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");
const DAY = 24 * 60 * 60 * 1000;

function req(pathname, opts = {}) {
  return new Request("https://naluno-economy.naluno.workers.dev" + pathname, opts);
}
function enc(v) {
  if (typeof v === "boolean") return { booleanValue: v };
  if (typeof v === "number") return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === "string") return { stringValue: v };
  return { nullValue: null };
}
function dec(v) {
  if (!v) return null;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return v.doubleValue;
  if ("stringValue" in v) return v.stringValue;
  if ("booleanValue" in v) return v.booleanValue;
  return null;
}
function fieldsOf(obj) {
  const fields = {};
  Object.keys(obj || {}).forEach((k) => { fields[k] = enc(obj[k]); });
  return fields;
}

async function genSa() {
  const pair = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true, ["sign", "verify"],
  );
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey));
  let bin = "";
  for (let i = 0; i < pkcs8.length; i++) bin += String.fromCharCode(pkcs8[i]);
  const pem = "-----BEGIN PRIVATE KEY-----\n" + btoa(bin).replace(/(.{64})/g, "$1\n") + "\n-----END PRIVATE KEY-----\n";
  return JSON.stringify({
    client_email: "sa@naluno-28a00.iam.gserviceaccount.com",
    private_key: pem,
    project_id: "naluno-28a00",
    token_uri: "https://oauth2.googleapis.com/token",
  });
}

function world(docs) {
  const store = new Map(Object.entries(docs));
  setFetchImpl(async (url, opts) => {
    const u = String(url);
    const m = (opts && opts.method) || "GET";
    if (u.includes("accounts:lookup")) {
      return new Response(JSON.stringify({ users: [{ localId: "attacker" }] }), { status: 200 });
    }
    if (u.includes("oauth2.googleapis.com/token")) {
      return new Response(JSON.stringify({ access_token: "sa", expires_in: 3600 }), { status: 200 });
    }
    if (!u.includes("firestore.googleapis.com")) return new Response("{}", { status: 404 });
    if (u.includes(":commit")) {
      const body = JSON.parse(opts.body || "{}");
      for (const w of body.writes || []) {
        if (w.update) {
          const p = "/" + String(w.update.name).split("/documents/")[1];
          const exists = store.has(p);
          if (w.currentDocument && w.currentDocument.exists === false && exists) continue;
          const row = Object.assign({}, store.get(p) || {});
          const incoming = {};
          Object.keys(w.update.fields || {}).forEach((k) => { incoming[k] = dec(w.update.fields[k]); });
          const mask = w.updateMask && w.updateMask.fieldPaths;
          if (mask) mask.forEach((k) => { if (k in incoming) row[k] = incoming[k]; });
          else Object.assign(row, incoming);
          store.set(p, row);
        }
        if (w.transform) {
          const p = "/" + String(w.transform.document).split("/documents/")[1];
          const row = Object.assign({}, store.get(p) || {});
          for (const t of w.transform.fieldTransforms || []) {
            row[t.fieldPath] = (Number(row[t.fieldPath]) || 0) + Number(t.increment.integerValue);
          }
          store.set(p, row);
        }
      }
      return new Response(JSON.stringify({ writeResults: [] }), { status: 200 });
    }
    const p = decodeURIComponent(u.split("/documents")[1] || "").split("?")[0];
    if (m === "GET") {
      if (!store.has(p)) return new Response("{}", { status: 404 });
      return new Response(JSON.stringify({ name: "x", fields: fieldsOf(store.get(p)) }), { status: 200 });
    }
    if (m === "PATCH") {
      const body = JSON.parse(opts.body || "{}");
      const row = Object.assign({}, store.get(p) || {});
      Object.keys(body.fields || {}).forEach((k) => { row[k] = dec(body.fields[k]); });
      store.set(p, row);
      return new Response(JSON.stringify({ fields: fieldsOf(row) }), { status: 200 });
    }
    return new Response("{}", { status: 404 });
  });
  return store;
}

async function claim(env, seconds, extra) {
  const res = await handleRequest(req("/v1/reach/claim", {
    method: "POST",
    headers: { Authorization: "Bearer tok", "Content-Type": "application/json" },
    body: JSON.stringify(Object.assign({ seconds }, extra || {})),
  }), env);
  return { status: res.status, body: await res.json() };
}

test("adversary: rules, stamps, Reach, and the upload cap", async () => {
  const rules = read("firestore.rules");
  assert.equal((rules.match(/\{/g) || []).length, (rules.match(/\}/g) || []).length);
  assert.ok(rules.includes("'reach', 'reachPlaced'"), "a phone cannot grant itself Reach");
  const dayRule = rules.split("match /reachDays/{day}")[1].split("match /reachPasses/")[0];
  const passRule = rules.split("match /reachPasses/{passId}")[1].split("match /handles/")[0];
  assert.ok(!/allow (create|write|update):/.test(dayRule), "a phone cannot reset the day count");
  assert.ok(!/allow create:/.test(passRule), "a phone cannot write its own pass");
  assert.ok(rules.includes("resource.data.used == false") && rules.includes("request.resource.data.used == true"));
  assert.ok(rules.includes("reachPassOk(id)"), "a stored video cannot be created without a pass");
  assert.ok(rules.includes("data.broadcastId == broadcastId"));
  assert.ok(rules.includes("data.seconds >= request.resource.data.durationSec"));
  assert.ok(!/listed == false\s+\|\|\s+isTrustedPublisher/.test(rules));
  assert.ok(rules.includes("request.resource.data.listed == false"));

  const sw = (read("sw.js").match(/APP_BUILD = '([^']+)'/) || [])[1];
  const reg = (read("js/pwa.js").match(/register\('\/sw\.js\?v=([^']+)'/) || [])[1];
  const build = (read("js/admin-console.js").match(/const BUILD = '([^']+)'/) || [])[1];
  const html = (read("admin/index.html").match(/admin-console\.js\?v=([^"']+)/) || [])[1];
  assert.equal(sw, reg);
  assert.equal(sw, build);
  assert.equal(sw, html);

  const bundle = read("naluno-economy-worker.js");
  const ver = (read("workers/economy/handler.mjs").match(/export const VERSION = "([^"]+)"/) || [])[1];
  assert.ok(bundle.includes('var VERSION = "' + ver + '";'), "paste file is this worker");
  assert.ok(bundle.includes('"/v1/reach/claim"') || bundle.includes("reach/claim"));

  const env = {
    FIREBASE_PROJECT_ID: "naluno-28a00",
    FIREBASE_WEB_API_KEY: "k",
    GOOGLE_SERVICE_ACCOUNT: await genSa(),
  };
  const now = Date.now();

  resetMemory();
  world({ "/users/attacker": { createdAt: now, reachPlaced: 0 } });
  const anon = await handleRequest(req("/v1/reach/claim", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ seconds: 60 }),
  }), env);
  assert.equal(anon.status, 401);

  resetMemory();
  world({ "/users/attacker": { createdAt: now, reachPlaced: 0 } });
  const forged = await claim(env, 3 * 60 * 60, { tier: "full", reach: "full" });
  assert.equal(forged.status, 403, "the body cannot promote the account");
  assert.match(forged.body.error, /40 minutes/);

  resetMemory();
  world({ "/users/attacker": { createdAt: now, reachPlaced: 0, suspended: true } });
  const banned = await claim(env, 60);
  assert.equal(banned.status, 403);
  assert.match(banned.body.error, /cannot publish/);

  resetMemory();
  world({ "/users/attacker": { createdAt: now, reachPlaced: 0 } });
  const zero = await claim(env, 0);
  assert.equal(zero.status, 400);
  const short = await claim(env, 40 * 60);
  assert.equal(short.status, 200, JSON.stringify(short.body));
  assert.equal(short.body.tier, "open");
  assert.ok(short.body.passId);
  const second = await claim(env, 30 * 60);
  const third = await claim(env, 10 * 60);
  assert.equal(second.status, 200);
  assert.equal(third.status, 200);
  const fourth = await claim(env, 60);
  assert.equal(fourth.status, 403);
  assert.match(fourth.body.error, /3 videos today/);

  resetMemory();
  world({ "/users/attacker": { createdAt: now, reachPlaced: 0 } });
  const raced = await Promise.all([claim(env, 60), claim(env, 60), claim(env, 60), claim(env, 60)]);
  const issued = raced.filter((r) => r.status === 200);
  assert.equal(issued.length, 3, "four claims at once still only get three passes");
  assert.equal(new Set(issued.map((r) => r.body.passId)).size, 3);

  resetMemory();
  world({ "/users/attacker": { createdAt: now - 60 * DAY, reachPlaced: 10, reach: "open" } });
  const locked = await claim(env, 41 * 60);
  assert.equal(locked.status, 403, "the desk can keep a long-standing account on the short room");

  resetMemory();
  world({ "/users/attacker": { createdAt: now - 14 * DAY, reachPlaced: 4 } });
  const film = await claim(env, 3 * 60 * 60);
  assert.equal(film.status, 200);
  assert.equal(film.body.tier, "kept");
  assert.equal((await claim(env, 60)).status, 200);
  assert.equal((await claim(env, 60)).status, 200);
  assert.equal((await claim(env, 60)).status, 403, "kept still stops at 3 a day");

  resetMemory();
  world({ "/users/attacker": { createdAt: now, reach: "full" } });
  const long = await claim(env, 3 * 60 * 60);
  assert.equal(long.status, 200);
  assert.equal(long.body.tier, "full");
  const tooLong = await claim(env, 3 * 60 * 60 + 30);
  assert.equal(tooLong.status, 403);
  assert.match(tooLong.body.error, /3 hours/);

  const noSa = { FIREBASE_PROJECT_ID: "naluno-28a00", FIREBASE_WEB_API_KEY: "k" };
  resetMemory();
  setFetchImpl(async (url) => {
    if (String(url).includes("accounts:lookup")) {
      return new Response(JSON.stringify({ users: [{ localId: "attacker" }] }), { status: 200 });
    }
    return new Response("{}", { status: 404 });
  });
  const down = await claim(noSa, 60);
  assert.equal(down.status, 503);

  const src = read("signal-worker-index.js");
  const mod = await import("data:text/javascript," + encodeURIComponent(src));
  const worker = mod.default;
  let deleted = 0;
  const up = {
    FIREBASE_WEB_API_KEY: "k",
    SIGNAL_BUCKET: {
      put: async () => {},
      get: async () => null,
      head: async (key) => key.endsWith("huge.bin") ? { size: 8 * 1024 * 1024 * 1024 + 1, httpMetadata: {} } : null,
      delete: async () => { deleted += 1; },
      createMultipartUpload: async () => ({ uploadId: "up1" }),
      resumeMultipartUpload: () => ({ uploadPart: async () => ({ etag: "e" }), complete: async () => {} }),
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
      method: "POST", headers: { Authorization: "Bearer t", "Content-Type": "text/html" }, body: "<html><script>alert(1)</script>",
    }), up);
    assert.equal(html.status, 415);
    const open = await worker.fetch(new Request("https://upload.test/", { method: "POST", body: "x" }), up);
    assert.equal(open.status, 401);
    const huge = await worker.fetch(new Request("https://upload.test/b/complete", {
      method: "POST",
      headers: { Authorization: "Bearer t", "Content-Type": "application/json" },
      body: JSON.stringify({ key: "u/attacker/huge.bin", uploadId: "up1", parts: [{ part: 1, etag: "e" }] }),
    }), up);
    assert.equal(huge.status, 413);
    assert.equal(deleted, 1);
    const over = await worker.fetch(new Request("https://upload.test/b/init", {
      method: "POST",
      headers: { Authorization: "Bearer t", "Content-Type": "application/json" },
      body: JSON.stringify({ contentType: "video/mp4", bytes: 8 * 1024 * 1024 * 1024 + 1 }),
    }), up);
    assert.equal(over.status, 413);
  } finally {
    globalThis.fetch = orig;
    setFetchImpl(null);
  }

  /* The file itself is not measured. A modified app can ask for a 1-second
     pass and upload a long video. The Broadcast's written length is capped
     by that pass. Playback follows the file. */
  resetMemory();
  world({ "/users/attacker": { createdAt: Date.now(), reachPlaced: 0 } });
  const lie = await claim(env, 1);
  assert.equal(lie.status, 200);
  assert.equal(lie.body.tier, "open");
  setFetchImpl(null);
});
