/* Luganda voice (05 Oct h).

   POST /v1/voice/lg  { text, voice: "female"|"male", speaker? }  -> audio bytes

   Luganda is spoken by a voice trained on Luganda speakers (Sunbird AI's
   Orpheus Luganda voices, language "lug"), not by an English voice. The
   phone sends one sentence; this worker asks Sunbird, fetches the audio
   itself (the phone never talks to Sunbird or Google Cloud), keeps a copy
   so the same sentence is never paid for twice, and returns the sound.

   Settings (Cloudflare → naluno-economy → Settings → Variables):
     SUNBIRD_API_KEY   secret, from the Sunbird AI dashboard. Without it this
                       answers 503 and the phone uses Naluno's own voice with
                       Luganda sounds instead.
     LG_VOICE_FEMALE   optional, default "salt_lug_0001".
     LG_VOICE_MALE     optional. Unset: a male listener also hears the
                       Luganda voice above (correct Luganda comes before the
                       voice's sex).
     LG_DAILY_CHARS    optional, characters per person per day (default 30000).
     SUNBIRD_TTS_URL   optional, default below. */

export const LG_TTS_URL = "https://api.sunbird.ai/tasks/audio/speech";
const PER_MINUTE = 40;
const MAX_TEXT = 600;
const MAX_BYTES = 8 * 1024 * 1024;
const SPEAKER = /^[a-z]{2,12}_lug_\d{4}$/;
const hits = new Map();
const daily = new Map();

export function resetLgVoice() { hits.clear(); daily.clear(); }

function rateOk(uid, now) {
  const minute = Math.floor(now / 60000);
  const k = uid + "|" + minute;
  const n = (hits.get(k) || 0) + 1;
  if (hits.size > 5000) for (const key of hits.keys()) { if (!(Number(String(key).split("|").pop()) >= minute - 1)) hits.delete(key); }
  hits.set(k, n);
  return n <= PER_MINUTE;
}
function charsOk(uid, now, n, limit) {
  const day = Math.floor(now / 86400000);
  const k = uid + "|" + day;
  const used = daily.get(k) || 0;
  if (used + n > limit) return false;
  if (daily.size > 20000) for (const key of daily.keys()) { if (!(Number(String(key).split("|").pop()) >= day)) daily.delete(key); }
  daily.set(k, used + n);
  return true;
}
async function sha256Hex(s) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
function isAudio(type) { return /^audio\//i.test(type || "") || /octet-stream/i.test(type || ""); }

/* deps: { env, fetch, cache: { match(key) -> Response|undefined, put(key, Response) } | null, now } */
export async function handleLgVoice(body, user, deps) {
  const env = deps.env || {};
  const now = deps.now ? deps.now() : Date.now();
  if (!user || !user.uid) return { status: 401, json: { ok: false, error: "sign in" } };
  const key = String(env.SUNBIRD_API_KEY || "").trim();
  if (!key) return { status: 503, json: { ok: false, error: "luganda voice not configured" } };
  const text = String((body && body.text) || "").replace(/\s+/g, " ").trim();
  if (!text || text.length > MAX_TEXT || !/[A-Za-z]/.test(text)) return { status: 400, json: { ok: false, error: "text" } };
  const want = String((body && body.speaker) || "");
  if (want && !SPEAKER.test(want)) return { status: 400, json: { ok: false, error: "speaker" } };
  const male = body && body.voice === "male";
  const speaker = want
    || (male && SPEAKER.test(String(env.LG_VOICE_MALE || "")) ? String(env.LG_VOICE_MALE) : "")
    || (SPEAKER.test(String(env.LG_VOICE_FEMALE || "")) ? String(env.LG_VOICE_FEMALE) : "salt_lug_0001");
  if (!rateOk(user.uid, now)) return { status: 429, json: { ok: false, error: "slow down" } };

  const cacheKey = "https://naluno-lg-voice.cache/v1/" + await sha256Hex(speaker + "\n" + text);
  if (deps.cache) {
    try {
      const hit = await deps.cache.match(cacheKey);
      if (hit && hit.ok) {
        const bytes = await hit.arrayBuffer();
        if (bytes.byteLength) return { status: 200, bytes, type: hit.headers.get("Content-Type") || "audio/wav", cached: true, speaker };
      }
    } catch (_) {}
  }
  const limit = Math.max(1000, Number(env.LG_DAILY_CHARS) || 30000);
  if (!charsOk(user.uid, now, text.length, limit)) return { status: 429, json: { ok: false, error: "daily limit" } };

  let res;
  try {
    res = await deps.fetch(String(env.SUNBIRD_TTS_URL || LG_TTS_URL), {
      method: "POST",
      headers: { Authorization: "Bearer " + key, "Content-Type": "application/json", Accept: "audio/wav, audio/mpeg, application/json" },
      body: JSON.stringify({ text, language: "lug", voice: speaker, response_mode: "stream" }),
    });
  } catch (_) {
    return { status: 502, json: { ok: false, error: "luganda voice unreachable" } };
  }
  if (res.status === 401 || res.status === 403) return { status: 503, json: { ok: false, error: "luganda voice key refused" } };
  if (!res.ok) return { status: 502, json: { ok: false, error: "luganda voice " + res.status } };
  let type = res.headers.get("Content-Type") || "";
  let bytes;
  if (isAudio(type)) {
    bytes = await res.arrayBuffer();
  } else {
    /* Some answers are a link to the audio instead of the audio. */
    const j = await res.json().catch(() => null);
    const url = j && (j.audio_url || (j.output && j.output.audio_url));
    if (!url || !/^https:\/\//.test(String(url))) return { status: 502, json: { ok: false, error: "luganda voice gave no audio" } };
    let a;
    try { a = await deps.fetch(String(url)); } catch (_) { a = null; }
    if (!a || !a.ok) return { status: 502, json: { ok: false, error: "luganda audio unreachable" } };
    type = a.headers.get("Content-Type") || "audio/wav";
    bytes = await a.arrayBuffer();
  }
  if (!bytes || !bytes.byteLength || bytes.byteLength > MAX_BYTES) return { status: 502, json: { ok: false, error: "luganda audio size" } };
  if (!/^audio\//i.test(type)) type = "audio/wav";
  if (deps.cache) {
    try {
      await deps.cache.put(cacheKey, new Response(bytes.slice(0), { headers: { "Content-Type": type, "Cache-Control": "public, max-age=2592000" } }));
    } catch (_) {}
  }
  return { status: 200, bytes, type, cached: false, speaker };
}
