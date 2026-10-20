/* Sunbird AI proxy (translate, speech-to-text, chat) — 19 Oct e.
   The key stays in env.SUNBIRD_API_KEY and never reaches a phone. Every
   call is signed in (the router checks that first), size-capped, slowed
   per person per minute, and counted against a daily allowance, so one
   account cannot run up Naluno's Sunbird bill. */

export const SUNBIRD_MAX_TEXT = 2000;            // characters, translate
export const SUNBIRD_MAX_PROMPT = 2000;          // characters, chat
export const SUNBIRD_MAX_AUDIO = 5 * 1024 * 1024; // bytes, speech-to-text
export const SUNBIRD_AUDIO_UNITS = 1000;          // one audio call counts as 1,000 characters
const LANG = /^[a-z]{2,3}$/;
/* Sunbird's own limit is per Naluno key, shared by everyone: 50 requests a
   minute on its standard account, 100 on premium (SALT API docs, Oct 2026).
   One person is kept to 10 a minute (a sentence translated every 6 s), so a
   single account cannot take the whole key. SUNBIRD_PER_MINUTE changes it. */
export const SUNBIRD_PER_MINUTE = 10;

const minute = new Map();
const dailyMem = new Map();
function rateOk(uid, now, perMinute) {
  const k = uid + "|" + Math.floor(now / 60000);
  const n = (minute.get(k) || 0) + 1;
  minute.set(k, n);
  if (minute.size > 5000) { for (const key of minute.keys()) { if (!key.endsWith("|" + Math.floor(now / 60000))) minute.delete(key); } }
  return n <= perMinute;
}
export function sunbirdDayKey(now) { return new Date(now).toISOString().slice(0, 10); }
export function sunbirdDailyLimit(env) { return Math.max(1000, Number(env && env.SUNBIRD_DAILY_UNITS) || 20000); }

async function reserve(deps, uid, day, n, limit, now) {
  if (deps.usage) {
    try { return await deps.usage.reserve(uid, day, n, limit); } catch (_) { return false; }
  }
  const k = uid + "|" + day;
  const used = dailyMem.get(k) || 0;
  if (used + n > limit) return false;
  dailyMem.set(k, used + n);
  return true;
}
async function giveBack(deps, uid, day, n) {
  if (deps.usage) { try { await deps.usage.release(uid, day, n); } catch (_) {} return; }
  const k = uid + "|" + day;
  dailyMem.set(k, Math.max(0, (dailyMem.get(k) || 0) - n));
}

/* Returns { status, body } or null when the path is not a Sunbird path. */
export async function handleSunbird(path, request, user, deps) {
  const routes = { "/v1/sunbird/translate": 1, "/v1/sunbird/transcribe": 1, "/v1/sunbird/chat": 1 };
  if (!routes[path] || request.method !== "POST") return null;
  const env = deps.env || {};
  const key = String(env.SUNBIRD_API_KEY || "").trim();
  if (!key) return { status: 503, body: { ok: false, error: "sunbird not configured" } };
  if (!user || !user.uid) return { status: 401, body: { ok: false, error: "sign in" } };
  const now = deps.now ? deps.now() : Date.now();
  const perMinute = Math.max(1, Math.min(50, Number(env.SUNBIRD_PER_MINUTE) || SUNBIRD_PER_MINUTE));
  if (!rateOk(user.uid, now, perMinute)) return { status: 429, body: { ok: false, error: "slow down" } };
  const day = sunbirdDayKey(now);
  const limit = sunbirdDailyLimit(env);

  let upstream, init, units;
  if (path === "/v1/sunbird/transcribe") {
    const len = Number(request.headers.get("Content-Length") || 0);
    if (len > SUNBIRD_MAX_AUDIO + 64 * 1024) return { status: 413, body: { ok: false, error: "audio too large" } };
    let form;
    try { form = await request.formData(); } catch (_) { return { status: 400, body: { ok: false, error: "form" } }; }
    const audio = form.get("audio");
    const language = String(form.get("language") || "lug");
    if (!audio || typeof audio === "string") return { status: 400, body: { ok: false, error: "no audio" } };
    if (!(audio.size > 0) || audio.size > SUNBIRD_MAX_AUDIO) return { status: 413, body: { ok: false, error: "audio too large" } };
    if (!LANG.test(language)) return { status: 400, body: { ok: false, error: "language" } };
    const fd = new FormData();
    fd.append("audio", audio);
    fd.append("language", language);
    upstream = "https://api.sunbird.ai/tasks/audio/transcriptions";
    init = { method: "POST", headers: { Authorization: "Bearer " + key }, body: fd };
    units = SUNBIRD_AUDIO_UNITS;
  } else {
    const len = Number(request.headers.get("Content-Length") || 0);
    if (len > 64 * 1024) return { status: 413, body: { ok: false, error: "too large" } };
    const body = await request.json().catch(() => ({}));
    if (path === "/v1/sunbird/translate") {
      const text = String((body && body.text) || "");
      const src = String((body && body.source_language) || "eng");
      const dst = String((body && body.target_language) || "lug");
      if (!text.trim()) return { status: 400, body: { ok: false, error: "text" } };
      if (text.length > SUNBIRD_MAX_TEXT) return { status: 413, body: { ok: false, error: "text too long" } };
      if (!LANG.test(src) || !LANG.test(dst)) return { status: 400, body: { ok: false, error: "language" } };
      upstream = "https://api.sunbird.ai/tasks/translate";
      init = { method: "POST", headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
        body: JSON.stringify({ text, source_language: src, target_language: dst }) };
      units = text.length;
    } else {
      const prompt = String((body && body.prompt) || "");
      if (!prompt.trim()) return { status: 400, body: { ok: false, error: "prompt" } };
      if (prompt.length > SUNBIRD_MAX_PROMPT) return { status: 413, body: { ok: false, error: "prompt too long" } };
      upstream = "https://api.sunbird.ai/tasks/chat/completions";
      init = { method: "POST", headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
        body: JSON.stringify({ model: "sunflower-14b", messages: [{ role: "user", content: prompt }] }) };
      units = prompt.length;
    }
  }
  if (!(await reserve(deps, user.uid, day, units, limit, now))) {
    return { status: 429, body: { ok: false, error: "daily limit" } };
  }
  let r;
  try { r = await deps.fetch(upstream, init); } catch (_) { r = null; }
  if (!r || !r.ok) {
    await giveBack(deps, user.uid, day, units);
    return { status: r ? (r.status >= 500 ? 502 : r.status) : 502, body: { ok: false, error: "sunbird unavailable" } };
  }
  const data = await r.json().catch(() => ({}));
  return { status: 200, body: data };
}
