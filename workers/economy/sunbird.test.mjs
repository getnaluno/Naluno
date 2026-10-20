/* 20 Oct a: the Sunbird proxy is capped. Run: node workers/economy/sunbird.test.mjs */
import assert from "node:assert/strict";
import test from "node:test";
import { handleSunbird, SUNBIRD_MAX_TEXT, SUNBIRD_MAX_PROMPT, SUNBIRD_MAX_AUDIO } from "./sunbird.mjs";
import { handleRequest, resetMemory, setFetchImpl } from "./handler.mjs";

const env = { SUNBIRD_API_KEY: "secret-key", SUNBIRD_DAILY_UNITS: "3000" };
let seen = [];
const okFetch = async (u, init) => { seen.push({ u, init }); return new Response(JSON.stringify({ output: { translated_text: "x" } }), { status: 200 }); };
const jreq = (path, body) => new Request("https://w.example" + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
let n = 0;
const fresh = () => ({ uid: "u" + (++n) });

test("not set up: 503, nothing sent", async () => {
  seen = [];
  const r = await handleSunbird("/v1/sunbird/translate", jreq("/v1/sunbird/translate", { text: "hi" }), fresh(), { env: {}, fetch: okFetch });
  assert.equal(r.status, 503);
  assert.equal(seen.length, 0);
});

test("translate: size cap, language codes, the key stays on the server", async () => {
  seen = [];
  const u = fresh();
  let r = await handleSunbird("/v1/sunbird/translate", jreq("", { text: "a".repeat(SUNBIRD_MAX_TEXT + 1) }), u, { env, fetch: okFetch });
  assert.equal(r.status, 413);
  r = await handleSunbird("/v1/sunbird/translate", jreq("", { text: "hello", target_language: "lug; drop" }), u, { env, fetch: okFetch });
  assert.equal(r.status, 400);
  r = await handleSunbird("/v1/sunbird/translate", jreq("", { text: "hello", source_language: "en", target_language: "lug" }), u, { env, fetch: okFetch });
  assert.equal(r.status, 200);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].init.headers.Authorization, "Bearer secret-key");
  assert.ok(!JSON.stringify(r.body).includes("secret-key"));
});

test("chat: prompt cap", async () => {
  const r = await handleSunbird("/v1/sunbird/chat", jreq("", { prompt: "p".repeat(SUNBIRD_MAX_PROMPT + 1) }), fresh(), { env, fetch: okFetch });
  assert.equal(r.status, 413);
});

test("transcribe: audio cap", async () => {
  const fd = new FormData();
  fd.append("audio", new Blob([new Uint8Array(SUNBIRD_MAX_AUDIO + 1)]), "a.webm");
  const big = new Request("https://w.example/v1/sunbird/transcribe", { method: "POST", body: fd });
  const r = await handleSunbird("/v1/sunbird/transcribe", big, fresh(), { env, fetch: okFetch });
  assert.equal(r.status, 413);
  const fd2 = new FormData();
  fd2.append("audio", new Blob([new Uint8Array(1000)]), "a.webm");
  const ok = await handleSunbird("/v1/sunbird/transcribe", new Request("https://w.example/x", { method: "POST", body: fd2 }), fresh(), { env, fetch: okFetch });
  assert.equal(ok.status, 200);
});

test("a daily allowance per person; a failed call is given back", async () => {
  const u = fresh();
  for (let i = 0; i < 3; i++) {
    const r = await handleSunbird("/v1/sunbird/translate", jreq("", { text: "x".repeat(1000) }), u, { env, fetch: okFetch });
    assert.equal(r.status, 200);
  }
  let r = await handleSunbird("/v1/sunbird/translate", jreq("", { text: "x" }), u, { env, fetch: okFetch });
  assert.equal(r.status, 429);
  assert.equal(r.body.error, "daily limit");
  const v = fresh();
  r = await handleSunbird("/v1/sunbird/translate", jreq("", { text: "x".repeat(2000) }), v, { env, fetch: async () => new Response("{}", { status: 500 }) });
  assert.equal(r.status, 502);
  r = await handleSunbird("/v1/sunbird/translate", jreq("", { text: "x".repeat(2000) }), v, { env, fetch: okFetch });
  assert.equal(r.status, 200, "the failed call did not use the allowance");
});

test("a per-minute pace", async () => {
  const u = fresh();
  let last;
  for (let i = 0; i < 11; i++) last = await handleSunbird("/v1/sunbird/translate", jreq("", { text: "x" }), u, { env: { SUNBIRD_API_KEY: "k" }, fetch: okFetch });
  assert.equal(last.status, 429);
  assert.equal(last.body.error, "slow down");
  /* configurable, never above Sunbird's own standard 50 a minute */
  const v = fresh();
  for (let i = 0; i < 12; i++) last = await handleSunbird("/v1/sunbird/translate", jreq("", { text: "x" }), v, { env: { SUNBIRD_API_KEY: "k", SUNBIRD_PER_MINUTE: "12" }, fetch: okFetch });
  assert.equal(last.status, 200);
});

test("through the worker: signed out is refused before Sunbird is asked", async () => {
  resetMemory();
  seen = [];
  setFetchImpl(async (u, i) => { seen.push(String(u)); return new Response("{}", { status: 200 }); });
  const res = await handleRequest(new Request("https://w.example/v1/sunbird/translate", { method: "POST", body: JSON.stringify({ text: "hi" }) }),
    { FIREBASE_PROJECT_ID: "p", FIREBASE_WEB_API_KEY: "k", SUNBIRD_API_KEY: "secret" });
  assert.equal(res.status, 401);
  assert.ok(!seen.some((u) => u.includes("sunbird.ai")));
  setFetchImpl(null);
});
