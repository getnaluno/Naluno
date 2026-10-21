/* naluno-compass — the Compass worker (21 Oct f).

   Free: runs on Cloudflare Workers AI on Naluno's own Cloudflare account
   (open models Cloudflare hosts; no outside AI company, no API key).
   The free allowance is 10,000 "neurons" a day.

   What changed from the first Compass worker:
   - A stronger model first (Llama 3.3 70B), a fast small one for small
     talk and as the fallback, so a quiet day still answers well and a busy
     one still answers.
   - One instruction message. The app's instructions and Naluno's are
     merged into one, in front. Several separate instruction messages are
     what many chat formats drop, which is when the model "forgot" what it
     had been given and said it could not do it.
   - No "you have no access to anything" line. The app sends what it looked
     up (web notes, weather, Find Naluno ping, the Naluno guide) with the
     question; the model is told to use it.
   - A refusal of something it can do is asked again once.
   - Thinking text some models write (<think>…</think>) is removed.

   POST /           { messages: [{ role, content }] }  → { reply, model }
   GET  /health     → { ok, version, models }
   Sign-in: the Firebase ID token of the person (Authorization: Bearer). */

export const VERSION = "2.0.0-20261021f";
const DEFAULT_MODELS = [
  "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
  "@cf/meta/llama-3.1-8b-instruct-fast",
  "@cf/meta/llama-3.1-8b-instruct",
];
const SMALL_FIRST = /^(hi|hey|hello|thanks|thank you|ok|okay|good (morning|evening|night)|how are you|oli otya|gyebale|webale)\b/i;

export const SYSTEM = [
  "You are Compass, the companion inside the Naluno app. Warm, direct and genuinely useful, like a knowledgeable friend.",
  "Answer what was asked first, in plain language, usually in 2 to 6 sentences; use numbered steps only for how-to answers. Reply in the language the person wrote in.",
  "You can explain and teach, advise, plan, write and rewrite, summarise, brainstorm, do maths, and translate. When the app attaches notes (web results, encyclopedia text, weather, the person's own Find Naluno ping, the Naluno guide), they are real and current: use them as your own knowledge. Never say you cannot browse, search, see links, check weather or find a phone.",
  "Never invent a link; share only links that appear in the notes. Never invent a Naluno feature, price or rule; if the guide does not cover it, say so and suggest Write to Naluno.",
  "Never describe how Naluno is built (code, servers, vendors, databases).",
  "Refuse only what is harmful: instructions for weapons or serious crime, sexual content involving minors, or content that targets a real private person. For anything else, help.",
].join(" ");

const REFUSAL = /\b(i (do not|don't|dont) have (access|the ability|the capability|real-?time|browsing|internet)|i (cannot|can't|cant|am unable to|'m unable to|am not able to|'m not able to) (access|browse|search|look up|check|provide (links?|real-?time)|share links?|see|view|open|locate|find your|track|translate|help with that)|as an ai\b|as a language model|i'?m (just )?an ai|my (training|knowledge) (data|cutoff)|beyond my capabilities|outside (of )?my capabilities)\b/i;
export function isRefusal(text) {
  const t = String(text || "");
  return !t.trim() || REFUSAL.test(t.slice(0, 400));
}

const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, content-type",
  "access-control-allow-methods": "GET, POST, OPTIONS",
};
function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: Object.assign({ "content-type": "application/json; charset=utf-8" }, cors) });
}

let _fetch = (u, o) => fetch(u, o);
export function setFetchImpl(fn) { _fetch = fn || ((u, o) => fetch(u, o)); }
const hits = new Map();
export function resetMemory() { hits.clear(); }
function rateOk(uid, now) {
  const k = uid + "|" + Math.floor(now / 60000);
  const n = (hits.get(k) || 0) + 1;
  if (hits.size > 5000) hits.clear();
  hits.set(k, n);
  return n <= 20;
}

async function whoIs(env, token) {
  if (!token) return null;
  const key = env.FIREBASE_WEB_API_KEY || env.FIREBASE_API_KEY || "";
  const res = await _fetch("https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=" + encodeURIComponent(key), {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ idToken: token }),
  });
  if (!res.ok) return null;
  const d = await res.json().catch(() => ({}));
  const u = d.users && d.users[0];
  return u && u.localId ? { uid: u.localId } : null;
}

/* One instruction message in front; roles cleaned; long turns cut; at most 12. */
export function shapeMessages(input) {
  const list = Array.isArray(input) ? input.slice(-24) : [];
  const sys = [SYSTEM];
  const turns = [];
  list.forEach((m) => {
    if (!m || typeof m.content !== "string") return;
    const content = m.content.slice(0, 6000);
    if (!content.trim()) return;
    if (m.role === "system") { sys.push(content); return; }
    const role = m.role === "assistant" ? "assistant" : "user";
    const last = turns[turns.length - 1];
    if (last && last.role === role) last.content += "\n\n" + content;
    else turns.push({ role, content });
  });
  while (turns.length && turns[0].role !== "user") turns.shift();
  const kept = turns.slice(-12);
  while (kept.length && kept[0].role !== "user") kept.shift();
  return [{ role: "system", content: sys.join("\n\n").slice(0, 12000) }].concat(kept);
}

function replyOf(r) {
  if (!r) return "";
  if (typeof r === "string") return r;
  const t = r.response != null ? r.response
    : (r.choices && r.choices[0] && (r.choices[0].message ? r.choices[0].message.content : r.choices[0].text))
    || (r.result && r.result.response) || "";
  return String(t || "").replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/^\s*<think>[\s\S]*$/i, "").trim();
}

export function modelsFor(env, lastUser) {
  const list = String(env.COMPASS_MODELS || "").split(",").map((s) => s.trim()).filter(Boolean);
  const models = list.length ? list : DEFAULT_MODELS.slice();
  const t = String(lastUser || "").trim();
  if (t.length < 40 && SMALL_FIRST.test(t) && models.length > 1) return models.slice(1).concat(models[0]);
  return models;
}

export async function answer(env, messages) {
  const shaped = shapeMessages(messages);
  const lastUser = (shaped.filter((m) => m.role === "user").pop() || {}).content || "";
  const errors = [];
  for (const model of modelsFor(env, lastUser)) {
    try {
      let r = await env.AI.run(model, { messages: shaped, max_tokens: 900, temperature: 0.4 });
      let text = replyOf(r);
      if (text && isRefusal(text)) {
        const again = shaped.concat([
          { role: "assistant", content: text.slice(0, 600) },
          { role: "user", content: "You can do this. Answer my question directly and helpfully now, using your own knowledge and anything in the notes above. Do not say what you cannot do." },
        ]);
        const r2 = await env.AI.run(model, { messages: again, max_tokens: 900, temperature: 0.4 }).catch(() => null);
        const t2 = replyOf(r2);
        if (t2 && !isRefusal(t2)) text = t2;
      }
      if (text) return { reply: text, model };
      errors.push(model + ": empty");
    } catch (e) {
      errors.push(model + ": " + String((e && e.message) || e).slice(0, 120));
    }
  }
  const err = new Error("no model answered");
  err.details = errors;
  throw err;
}

export async function handleRequest(request, env = {}) {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  const url = new URL(request.url);
  if (request.method === "GET" && url.pathname === "/health") {
    return json({ ok: true, service: "naluno-compass", version: VERSION, ai: !!(env.AI && env.AI.run), models: modelsFor(env, "") });
  }
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const auth = request.headers.get("Authorization") || "";
  const token = /^Bearer\s+(.+)$/i.test(auth) ? auth.replace(/^Bearer\s+/i, "").trim() : "";
  const user = await whoIs(env, token).catch(() => null);
  if (!user) return json({ error: "Sign in to use Compass" }, 401);
  if (!rateOk(user.uid, Date.now())) return json({ error: "Slow down a little" }, 429);
  if (!env.AI || typeof env.AI.run !== "function") return json({ error: "Compass is not connected to its AI" }, 503);
  const body = await request.json().catch(() => ({}));
  if (!Array.isArray(body.messages) || !body.messages.length) return json({ error: "No question" }, 400);
  try {
    const out = await answer(env, body.messages);
    return json(out);
  } catch (e) {
    console.log("compass: no answer", JSON.stringify(e.details || String(e)));
    return json({ error: "Compass is resting. Try again in a moment." }, 503);
  }
}

export default { fetch: (request, env) => handleRequest(request, env) };
