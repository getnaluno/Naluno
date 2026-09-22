/* Lifeline relay (dead drop) — end to end through the real worker, with real
   sealed packets produced by js/lifeline.js and a fake Firestore that stores
   and queries for real. */
import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import vm from "node:vm";
import { handleRequest, resetMemory, setFetchImpl } from "./handler.mjs";

const ENV0 = { FIREBASE_PROJECT_ID: "naluno-28a00", FIREBASE_WEB_API_KEY: "test-key" };
async function saEnv() {
  const pair = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
  const b = new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey));
  let bin = ""; for (let i = 0; i < b.length; i++) bin += String.fromCharCode(b[i]);
  const pem = "-----BEGIN PRIVATE KEY-----\n" + btoa(bin).replace(/(.{64})/g, "$1\n") + "\n-----END PRIVATE KEY-----\n";
  return { ...ENV0, GOOGLE_SERVICE_ACCOUNT: JSON.stringify({ client_email: "sa@naluno-28a00.iam.gserviceaccount.com",
    private_key: pem, project_id: "naluno-28a00", token_uri: "https://oauth2.googleapis.com/token" }) };
}
function fakeFirestore() {
  const docs = new Map();
  setFetchImpl(async (url, opts) => {
    const u = String(url);
    if (u.includes("oauth2.googleapis.com/token")) return new Response(JSON.stringify({ access_token: "sa", expires_in: 3600 }), { status: 200 });
    if (u.includes("/lifelineDrops/") && opts.method === "PATCH") {
      const id = u.split("/lifelineDrops/")[1].split("?")[0];
      docs.set(id, JSON.parse(opts.body).fields);
      return new Response(JSON.stringify({ name: "x/lifelineDrops/" + id }), { status: 200 });
    }
    if (u.endsWith(":runQuery")) {
      const q = JSON.parse(opts.body).structuredQuery;
      const want = new Set(q.where.fieldFilter.value.arrayValue.values.map((v) => v.stringValue));
      const rows = [...docs.entries()].filter(([, f]) => want.has(f.tag.stringValue))
        .map(([id, f]) => ({ document: { name: "x/lifelineDrops/" + id, fields: f } }));
      return new Response(JSON.stringify(rows.length ? rows : [{}]), { status: 200 });
    }
    return new Response("{}", { status: 404 });
  });
  return docs;
}
async function phone() {
  const kp = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveKey", "deriveBits"]);
  const publicJwk = await crypto.subtle.exportKey("jwk", kp.publicKey); const st = {};
  const root = { crypto, localStorage: { getItem: (k) => st[k] ?? null, setItem: (k, v) => { st[k] = String(v); } },
    ensureMyKeyPair: async () => ({ privateKey: kp.privateKey, publicJwk }), TextEncoder, TextDecoder, btoa, atob, setTimeout, clearTimeout, AbortController };
  root.window = root;
  vm.runInContext(fs.readFileSync(new URL("../../js/lifeline.js", import.meta.url), "utf8"), vm.createContext(root));
  return { L: root.NalunoLifeline, publicJwk };
}
const post = (path, body, headers = {}) => new Request("https://relay.example" + path,
  { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });

test("a message dropped from Kampala is picked up and opened in London — no sign-in", async () => {
  resetMemory(); const env = await saEnv(); fakeFirestore();
  const k = await phone(), l = await phone();
  k.L.keyringPut("L", l.publicJwk); l.L.keyringPut("K", k.publicJwk);
  const s = await k.L.seal("L", "Tell mum we are okay", "c9", Date.now());
  const dropped = await handleRequest(post("/v1/lifeline/drop", { p: k.L.b64u(s.bytes) }), env);
  assert.equal(dropped.status, 200);
  const idx = await l.L.myTagIndex(["K"]);
  const picked = await handleRequest(post("/v1/lifeline/pick", { tags: Object.keys(idx) }), env);
  const j = await picked.json();
  assert.equal(j.packets.length, 1);
  const opened = await l.L.open(l.L.unb64u(j.packets[0]), idx);
  assert.equal(opened.text, "Tell mum we are okay");
  assert.equal(opened.from, "K");
});

test("the relay stores nothing readable: no text, no sender, no recipient", async () => {
  resetMemory(); const env = await saEnv(); const docs = fakeFirestore();
  const k = await phone(), l = await phone(); k.L.keyringPut("L", l.publicJwk);
  const s = await k.L.seal("L", "secret plans for Sunday", "c1", Date.now());
  await handleRequest(post("/v1/lifeline/drop", { p: k.L.b64u(s.bytes) }), env);
  const stored = JSON.stringify([...docs.values()]);
  assert.ok(!stored.includes("secret") && !stored.includes("Sunday"));
  assert.ok(!/"(from|to|uid|sender|recipient)"/.test(stored));
});

test("someone else's tags get nothing", async () => {
  resetMemory(); const env = await saEnv(); fakeFirestore();
  const k = await phone(), l = await phone(), x = await phone();
  k.L.keyringPut("L", l.publicJwk); x.L.keyringPut("K", k.publicJwk);
  const s = await k.L.seal("L", "private", "c1", Date.now());
  await handleRequest(post("/v1/lifeline/drop", { p: k.L.b64u(s.bytes) }), env);
  const idx = await x.L.myTagIndex(["K"]);
  const j = await (await handleRequest(post("/v1/lifeline/pick", { tags: Object.keys(idx) }), env)).json();
  assert.equal(j.packets.length, 0);
});

test("garbage, oversized and malformed packets are refused", async () => {
  resetMemory(); const env = await saEnv(); fakeFirestore();
  for (const p of ["", "short", "A".repeat(6000), "has spaces and !!", "B".repeat(80)]) {
    const r = await handleRequest(post("/v1/lifeline/drop", { p }), env);
    assert.equal(r.status, 400, "should refuse: " + p.slice(0, 12));
  }
  const bad = await handleRequest(post("/v1/lifeline/pick", { tags: ["not-hex", 5, "zz".repeat(12)] }), env);
  assert.deepEqual((await bad.json()).packets, []);
});

test("flooding the drop from one address is slowed down", async () => {
  resetMemory(); const env = await saEnv(); fakeFirestore();
  const k = await phone(), l = await phone(); k.L.keyringPut("L", l.publicJwk);
  let limited = false;
  for (let i = 0; i < 70; i++) {
    const s = await k.L.seal("L", "m" + i, "c" + i, Date.now());
    const r = await handleRequest(post("/v1/lifeline/drop", { p: k.L.b64u(s.bytes) }, { "CF-Connecting-IP": "9.9.9.9" }), env);
    if (r.status === 429) { limited = true; break; }
  }
  assert.ok(limited);
});

test("without relay storage configured it says so instead of pretending", async () => {
  resetMemory(); setFetchImpl(async () => new Response("{}", { status: 404 }));
  const r = await handleRequest(post("/v1/lifeline/drop", { p: "A".repeat(80) }), ENV0);
  assert.equal(r.status, 503);
});
