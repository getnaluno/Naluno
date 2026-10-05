/* Luganda voice: only for signed-in people, only Luganda voices, the key
   never leaves the worker, each sentence is paid for once, and with no key
   the phone is told to use its own voice. */
import assert from "node:assert/strict";
import test from "node:test";
import { handleRequest, resetMemory, setFetchImpl } from "./handler.mjs";
import { handleLgVoice, resetLgVoice, LG_TTS_URL } from "./lg-voice.mjs";

const WAV = new Uint8Array([82, 73, 70, 70, 1, 2, 3, 4, 87, 65, 86, 69]).buffer;
function sunbird(calls, opts = {}) {
  return async (url, init) => {
    const u = String(url);
    calls.push({ u, init });
    if (u.includes("identitytoolkit")) {
      const tok = JSON.parse(init.body).idToken;
      return tok === "tok-a" ? new Response(JSON.stringify({ users: [{ localId: "alice" }] }), { status: 200 }) : new Response("{}", { status: 400 });
    }
    if (u === LG_TTS_URL) {
      if (opts.refuse) return new Response("{}", { status: 401 });
      if (opts.link) return new Response(JSON.stringify({ audio_url: "https://storage.googleapis.com/x/a.wav?sig=1" }), { status: 200, headers: { "Content-Type": "application/json" } });
      return new Response(WAV, { status: 200, headers: { "Content-Type": "audio/wav" } });
    }
    if (u.startsWith("https://storage.googleapis.com/")) return new Response(WAV, { status: 200, headers: { "Content-Type": "audio/wav" } });
    return new Response("{}", { status: 404 });
  };
}
function memCache() {
  const m = new Map();
  return { m, match: async (k) => (m.has(k) ? new Response(m.get(k).slice(0), { headers: { "Content-Type": "audio/wav" } }) : undefined),
    put: async (k, r) => { m.set(k, await r.arrayBuffer()); } };
}
const ENV = { SUNBIRD_API_KEY: "sb-secret", FIREBASE_PROJECT_ID: "naluno-28a00", FIREBASE_WEB_API_KEY: "k" };

test("a Luganda sentence comes back as audio from a Luganda voice; the key stays on the worker", async () => {
  resetLgVoice();
  const calls = [];
  const cache = memCache();
  const r = await handleLgVoice({ text: "Weebale nnyo, ssebo.", voice: "female" }, { uid: "alice" }, { env: ENV, fetch: sunbird(calls), cache });
  assert.equal(r.status, 200);
  assert.equal(r.bytes.byteLength, WAV.byteLength);
  const sent = JSON.parse(calls[0].init.body);
  assert.deepEqual(sent, { text: "Weebale nnyo, ssebo.", language: "lug", voice: "salt_lug_0001", response_mode: "stream" });
  assert.equal(calls[0].init.headers.Authorization, "Bearer sb-secret");
  /* Same sentence again: from the copy, not paid for again. */
  const again = await handleLgVoice({ text: "Weebale  nnyo, ssebo. " }, { uid: "alice" }, { env: ENV, fetch: sunbird(calls), cache });
  assert.equal(again.cached, true);
  assert.equal(calls.length, 1);
});

test("male: the configured Luganda male voice, else the Luganda voice (never an English one)", async () => {
  resetLgVoice();
  const calls = [];
  await handleLgVoice({ text: "Oli otya?", voice: "male" }, { uid: "a" }, { env: ENV, fetch: sunbird(calls), cache: null });
  assert.equal(JSON.parse(calls[0].init.body).voice, "salt_lug_0001");
  await handleLgVoice({ text: "Oli otya?", voice: "male" }, { uid: "a" }, { env: { ...ENV, LG_VOICE_MALE: "waxal_lug_0003" }, fetch: sunbird(calls), cache: null });
  assert.equal(JSON.parse(calls[1].init.body).voice, "waxal_lug_0003");
  assert.equal(JSON.parse(calls[1].init.body).language, "lug");
  const bad = await handleLgVoice({ text: "Oli otya?", speaker: "salt_eng_0001" }, { uid: "a" }, { env: ENV, fetch: sunbird(calls), cache: null });
  assert.equal(bad.status, 400, "only Luganda voices");
});

test("a link answer is fetched by the worker", async () => {
  resetLgVoice();
  const calls = [];
  const r = await handleLgVoice({ text: "Kampala kibuga kinene." }, { uid: "a" }, { env: ENV, fetch: sunbird(calls, { link: true }), cache: null });
  assert.equal(r.status, 200);
  assert.ok(calls.some((c) => c.u.startsWith("https://storage.googleapis.com/")));
});

test("no key, refused key, bad text, floods, daily limit", async () => {
  resetLgVoice();
  const calls = [];
  assert.equal((await handleLgVoice({ text: "Weebale" }, { uid: "a" }, { env: {}, fetch: sunbird(calls) })).status, 503, "not set up: the phone uses its own voice");
  assert.equal(calls.length, 0);
  assert.equal((await handleLgVoice({ text: "Weebale" }, null, { env: ENV, fetch: sunbird(calls) })).status, 401);
  assert.equal((await handleLgVoice({ text: "" }, { uid: "a" }, { env: ENV, fetch: sunbird(calls) })).status, 400);
  assert.equal((await handleLgVoice({ text: "x".repeat(601) }, { uid: "a" }, { env: ENV, fetch: sunbird(calls) })).status, 400);
  assert.equal((await handleLgVoice({ text: "Weebale" }, { uid: "a" }, { env: ENV, fetch: sunbird(calls, { refuse: true }) })).status, 503);
  let limited = false;
  for (let i = 0; i < 60; i++) { if ((await handleLgVoice({ text: "Weebale " + i }, { uid: "b" }, { env: ENV, fetch: sunbird(calls) })).status === 429) { limited = true; break; } }
  assert.ok(limited, "per-minute limit");
  const day = { ...ENV, LG_DAILY_CHARS: "1000" };
  let daily = false;
  for (let i = 0; i < 30; i++) { if ((await handleLgVoice({ text: "Abantu bangi baagenda mu kibuga " + i + " ".padEnd(60, "a") }, { uid: "c" }, { env: day, fetch: sunbird(calls), now: () => 1e12 + i * 61000 })).status === 429) { daily = true; break; } }
  assert.ok(daily, "daily limit per person");
});

test("through the worker: signed in only, audio back with CORS", async () => {
  resetMemory(); resetLgVoice();
  const calls = [];
  setFetchImpl(sunbird(calls));
  const post = (tok) => handleRequest(new Request("https://economy.example/v1/voice/lg", {
    method: "POST", headers: Object.assign({ "Content-Type": "application/json" }, tok ? { Authorization: "Bearer " + tok } : {}),
    body: JSON.stringify({ text: "Weebale nnyo." }),
  }), ENV);
  assert.equal((await post("")).status, 401);
  const res = await post("tok-a");
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("Content-Type"), "audio/wav");
  assert.equal(res.headers.get("Access-Control-Allow-Origin"), "*");
  assert.equal((await res.arrayBuffer()).byteLength, WAV.byteLength);
  const health = await handleRequest(new Request("https://economy.example/health"), ENV);
  assert.match(JSON.stringify(await health.json()), /2\.11\.0-lg/);
  setFetchImpl(null);
});
