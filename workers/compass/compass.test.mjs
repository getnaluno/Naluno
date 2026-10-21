/* 21 Oct f: the Compass worker. Run: node workers/compass/compass.test.mjs */
import assert from "node:assert/strict";
import test from "node:test";
import { handleRequest, setFetchImpl, resetMemory, shapeMessages, modelsFor, isRefusal, SYSTEM, VERSION } from "./index.js";

const signedIn = async (u) => /accounts:lookup/.test(String(u)) ? new Response(JSON.stringify({ users: [{ localId: "u1" }] }), { status: 200 }) : new Response("{}", { status: 404 });
const req = (body, token = "tok") => new Request("https://naluno-compass.x/", { method: "POST", headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" }, body: JSON.stringify(body) });

test("one instruction message in front; the app's notes kept; roles cleaned", () => {
  const m = shapeMessages([
    { role: "system", content: "Notes: Kampala is the capital." },
    { role: "assistant", content: "orphan reply" },
    { role: "user", content: "hi" },
    { role: "user", content: "capital?" },
    { role: "system", content: "Weather: sunny" },
    { role: "tool", content: "x" },
  ]);
  assert.equal(m[0].role, "system");
  assert.ok(m[0].content.startsWith(SYSTEM) && /Kampala/.test(m[0].content) && /sunny/.test(m[0].content));
  assert.equal(m.filter((x) => x.role === "system").length, 1);
  assert.equal(m[1].role, "user", "starts with the person");
  assert.equal(m[1].content, "hi\n\ncapital?\n\nx", "no two turns of the same kind in a row");
  assert.ok(!/you (do not|don.t|cannot) (have )?access|no access to/i.test(SYSTEM) && /Never say you cannot browse/.test(SYSTEM));
});

test("a strong model first; small talk goes to the fast one first; the list can be set", () => {
  assert.match(modelsFor({}, "Explain photosynthesis")[0], /70b/);
  assert.match(modelsFor({}, "hello")[0], /8b/);
  assert.deepEqual(modelsFor({ COMPASS_MODELS: "a, b" }, "x"), ["a", "b"]);
});

test("a false refusal is asked again once; a model that fails hands over to the next", async () => {
  resetMemory();
  setFetchImpl(signedIn);
  const calls = [];
  const env = { AI: { run: async (model, input) => {
    calls.push(model);
    if (/70b/.test(model)) throw new Error("5007: model busy");
    const last = input.messages[input.messages.length - 1].content;
    if (/You can do this/.test(last)) return { response: "<think>hmm</think>Kampala is the capital of Uganda." };
    return { response: "I'm sorry, but I don't have access to real-time information." };
  } } };
  const res = await handleRequest(req({ messages: [{ role: "user", content: "What is the capital of Uganda?" }] }), env);
  const d = await res.json();
  setFetchImpl(null);
  assert.equal(res.status, 200);
  assert.equal(d.reply, "Kampala is the capital of Uganda.");
  assert.match(d.model, /8b/);
  assert.equal(calls.length, 3, "70B failed, 8B refused, 8B asked again");
});

test("OpenAI-style answers are read too", async () => {
  resetMemory();
  setFetchImpl(signedIn);
  const env = { AI: { run: async () => ({ choices: [{ message: { content: "Sure — here it is." } }] }) } };
  const d = await (await handleRequest(req({ messages: [{ role: "user", content: "Write a short toast" }] }), env)).json();
  setFetchImpl(null);
  assert.equal(d.reply, "Sure — here it is.");
});

test("sign-in, limits, errors and health", async () => {
  resetMemory();
  setFetchImpl(async () => new Response("{}", { status: 400 }));
  assert.equal((await handleRequest(req({ messages: [{ role: "user", content: "x" }] }, "bad"), { AI: { run: async () => ({ response: "y" }) } })).status, 401);
  setFetchImpl(signedIn);
  const env = { AI: { run: async () => ({ response: "ok" }) } };
  for (let i = 0; i < 20; i++) assert.equal((await handleRequest(req({ messages: [{ role: "user", content: "q" + i }] }), env)).status, 200);
  assert.equal((await handleRequest(req({ messages: [{ role: "user", content: "again" }] }), env)).status, 429, "20 a minute per person");
  resetMemory();
  assert.equal((await handleRequest(req({ messages: [] }), env)).status, 400);
  assert.equal((await handleRequest(req({ messages: [{ role: "user", content: "x" }] }), {})).status, 503, "no AI binding");
  const down = { AI: { run: async () => { throw new Error("4006: daily allocation used"); } } };
  const r = await handleRequest(req({ messages: [{ role: "user", content: "x" }] }), down);
  assert.equal(r.status, 503);
  assert.ok(!/4006/.test(await r.text()), "no internal detail to the phone");
  setFetchImpl(null);
  const h = await (await handleRequest(new Request("https://x/health"), { AI: { run() {} } })).json();
  assert.equal(h.version, VERSION); assert.equal(h.ai, true);
  assert.equal((await handleRequest(new Request("https://x/"), {})).status, 405);
});

test("refusals are told apart from good answers", () => {
  assert.equal(isRefusal("I'm sorry, but I don't have access to real-time data."), true);
  assert.equal(isRefusal("As an AI language model, I can't."), true);
  assert.equal(isRefusal("If you are not able to sign in, tap Forgot password."), false);
  assert.equal(isRefusal("I cannot stress enough how good this is."), false);
  assert.equal(isRefusal(""), true);
});
