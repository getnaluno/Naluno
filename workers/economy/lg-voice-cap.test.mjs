/* 14 Oct: the Luganda voice's daily allowance is shared by every worker
   process (a store, not memory), a failed answer gives the characters back,
   and a returned link is fetched only from Sunbird's own places. */
import assert from "node:assert/strict";
import { handleLgVoice, lgAudioHostOk, resetLgVoice } from "./lg-voice.mjs";

function usageStore() {
  const days = new Map();
  return {
    days,
    reserve: async (uid, day, n, limit) => { const k = uid + "_" + day; const u = days.get(k) || 0; if (u + n > limit) return false; days.set(k, u + n); return true; },
    release: async (uid, day, n) => { const k = uid + "_" + day; days.set(k, Math.max(0, (days.get(k) || 0) - n)); },
  };
}
const user = { uid: "lgUser01" };
const env = { SUNBIRD_API_KEY: "k", LG_DAILY_CHARS: "1000" };
const wav = () => new Response(new Uint8Array([82, 73, 70, 70, 1, 2, 3]), { status: 200, headers: { "Content-Type": "audio/wav" } });
const text = (n) => ("Oli otya nnyabo ").repeat(40).slice(0, n);

resetLgVoice();
// Two "processes" (no shared memory) share one store: the second sees the first's use.
const store = usageStore();
let r = await handleLgVoice({ text: text(600) }, user, { env, fetch: async () => wav(), usage: store, now: () => 1e12 });
assert.equal(r.status, 200);
resetLgVoice(); // a fresh process
r = await handleLgVoice({ text: text(500) + "x" }, user, { env, fetch: async () => wav(), usage: store, now: () => 1e12 });
assert.equal(r.status, 429, "the day's allowance holds across processes");
// A Sunbird failure gives the characters back.
const store2 = usageStore();
r = await handleLgVoice({ text: text(400) }, user, { env, fetch: async () => new Response("no", { status: 500 }), usage: store2, now: () => 1e12 });
assert.equal(r.status, 502);
assert.equal([...store2.days.values()][0], 0, "a failed answer does not use the day");
// A link to audio somewhere else is not fetched.
let fetched = [];
r = await handleLgVoice({ text: "Webale nnyo ssebo" }, user, { env, usage: usageStore(), now: () => 1e12, fetch: async (u) => {
  fetched.push(String(u));
  if (fetched.length === 1) return new Response(JSON.stringify({ audio_url: "https://evil.example/a.wav" }), { status: 200, headers: { "Content-Type": "application/json" } });
  return wav();
} });
assert.equal(r.status, 502);
assert.equal(fetched.length, 1, "the unknown host was never asked");
// A Sunbird storage link is fetched, and must be audio.
fetched = [];
r = await handleLgVoice({ text: "Webale nnyo nnyabo" }, user, { env, usage: usageStore(), now: () => 1e12, fetch: async (u) => {
  fetched.push(String(u));
  if (fetched.length === 1) return new Response(JSON.stringify({ output: { audio_url: "https://storage.googleapis.com/sb/tts/x.wav?sig=1" } }), { status: 200, headers: { "Content-Type": "application/json" } });
  return new Response("<html>", { status: 200, headers: { "Content-Type": "text/html" } });
} });
assert.equal(r.status, 502, "a page that is not audio is not passed on");
assert.equal(fetched.length, 2);
assert.ok(lgAudioHostOk("https://api.sunbird.ai/x.wav", {}) && lgAudioHostOk("https://storage.googleapis.com/b/x", {}));
assert.ok(!lgAudioHostOk("http://storage.googleapis.com/b/x", {}) && !lgAudioHostOk("https://sunbird.ai.evil.com/x", {}) && !lgAudioHostOk("https://169.254.169.254/", {}));
console.log("lg-voice-cap: all checks passed");
