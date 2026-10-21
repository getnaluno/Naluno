/**
 * naluno-call-notify — wake a closed phone.
 *
 * Threat model: the caller has the frontend. They must not be able to
 * push an arbitrary FCM token (spam / steal a session). Tokens are
 * loaded from Firestore (public profile + vault) using the service
 * account. Client-supplied tokens are used only when the lookup fails,
 * so an unpublished worker swap does not silence existing calls.
 */
export const VERSION = "1.2.0-20261021e";
export const PROJECT_ID = "naluno-28a00";

const ALLOWED = { incoming_call: 1, band_invite: 1, broadcast_live: 1, wireline: 1 };

const memory = { hits: new Map() };
let _fetch = globalThis.fetch.bind(globalThis);
/* 21 Oct e: one access token per scope. A single slot meant every call
   alert fetched two new Google tokens (the database one, then the push one,
   each pushing the other out): two extra round trips to Google, about half
   a second to two seconds, on every ring. */
let saCache = { token: "", exp: 0, scope: "", err: "" };
const saByScope = new Map();

let testSa = "";

export function setFetchImpl(fn) {
  _fetch = fn || globalThis.fetch.bind(globalThis);
}
export function setSaToken(t) {
  testSa = t || "";
}
export function resetMemory() {
  memory.hits.clear();
  saCache = { token: "", exp: 0, scope: "", err: "" };
  saByScope.clear();
  saPending.clear();
  testSa = "";
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "authorization, content-type",
      "access-control-allow-methods": "POST, OPTIONS",
    },
  });
}
function corsPreflight() {
  return json({ ok: true }, 204);
}
function bearer(request) {
  const h = request.headers.get("Authorization") || request.headers.get("authorization") || "";
  const m = /^Bearer\s+(.+)$/i.exec(h.trim());
  return m ? m[1].trim() : "";
}
function projectId(env) {
  return (env && (env.FIREBASE_PROJECT_ID || env.GCP_PROJECT)) || PROJECT_ID;
}
function apiKey(env) {
  return (env && (env.FIREBASE_WEB_API_KEY || env.FIREBASE_API_KEY)) || "AIzaSyD0j1W7-gFJqbMd6rz4kMhQd5AiB8B2ox0";
}
function fsRoot(env) {
  return "https://firestore.googleapis.com/v1/projects/" + projectId(env) + "/databases/(default)/documents";
}

function parseServiceAccount(raw) {
  if (!raw) return null;
  let s = String(raw).trim();
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) s = s.slice(1, -1);
  for (let i = 0; i < 4; i++) {
    try {
      const obj = JSON.parse(s);
      if (typeof obj === "string") { s = obj; continue; }
      if (obj && typeof obj === "object") return normalizeSa(obj);
    } catch { /* not json */ }
    const unescaped = s.replace(/\\n/g, "\n");
    if (unescaped !== s) {
      try {
        const obj = JSON.parse(unescaped);
        if (obj && typeof obj === "object") return normalizeSa(obj);
      } catch { /* continue */ }
    }
    break;
  }
  return null;
}
function normalizeSa(obj) {
  if (!obj || typeof obj !== "object") return null;
  const email = obj.client_email || obj.clientEmail || "";
  let pk = String(obj.private_key || obj.privateKey || "");
  pk = pk.replace(/\\n/g, "\n").trim();
  if (!email || !pk.includes("BEGIN")) return null;
  if (!pk.endsWith("\n")) pk += "\n";
  return { client_email: email, private_key: pk, token_uri: obj.token_uri || "https://oauth2.googleapis.com/token" };
}
function pemToArrayBuffer(pem) {
  const body = String(pem).replace(/-----BEGIN [^-]+-----/g, "").replace(/-----END [^-]+-----/g, "").replace(/\s+/g, "");
  const bin = atob(body);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}
function b64url(buf) {
  const bytes = buf instanceof ArrayBuffer ? new Uint8Array(buf) : new TextEncoder().encode(String(buf));
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
async function signRs256Jwt(sa, scope) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64url(JSON.stringify({
    iss: sa.client_email, sub: sa.client_email, scope, aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600,
  }));
  const unsigned = header + "." + claim;
  const key = await crypto.subtle.importKey("pkcs8", pemToArrayBuffer(sa.private_key), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned));
  return unsigned + "." + b64url(sig);
}
/* Several reads and sends ask for the same token at once: one request to
   Google, shared. */
const saPending = new Map();
function saAccessToken(env, scope) {
  if (testSa) return Promise.resolve(testSa);
  const now = Math.floor(Date.now() / 1000);
  const held = saByScope.get(scope);
  if (held && held.token && held.exp - 60 > now) return Promise.resolve(held.token);
  if (saPending.has(scope)) return saPending.get(scope);
  const p = saAccessTokenFetch(env, scope).finally(() => saPending.delete(scope));
  saPending.set(scope, p);
  return p;
}
async function saAccessTokenFetch(env, scope) {
  const now = Math.floor(Date.now() / 1000);
  const held = saByScope.get(scope);
  if (held && held.token && held.exp - 60 > now) return held.token;
  const sa = parseServiceAccount(env.GOOGLE_SERVICE_ACCOUNT || env.FIREBASE_SERVICE_ACCOUNT || env.SERVICE_ACCOUNT_JSON || "");
  if (!sa) { saCache.err = "no-service-account"; return ""; }
  try {
    const jwt = await signRs256Jwt(sa, scope);
    const res = await _fetch(sa.token_uri, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "grant_type=" + encodeURIComponent("urn:ietf:params:oauth:grant-type:jwt-bearer") + "&assertion=" + encodeURIComponent(jwt),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.access_token) { saCache.err = String(body.error || ("http-" + res.status)); return ""; }
    saCache = { token: body.access_token, exp: now + Number(body.expires_in || 3600), scope, err: "" };
    saByScope.set(scope, { token: saCache.token, exp: saCache.exp });
    return saCache.token;
  } catch (e) {
    saCache.err = (e && e.message) || "jwt-failed";
    return "";
  }
}

function fromFsValue(v) {
  if (!v || typeof v !== "object") return null;
  if ("stringValue" in v) return v.stringValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return Number(v.doubleValue);
  if ("booleanValue" in v) return !!v.booleanValue;
  if ("nullValue" in v) return null;
  /* 14 Oct: lists (memberUids) were read as nothing, so a Band invite from
     any member but its creator was refused. */
  if ("arrayValue" in v) return ((v.arrayValue && v.arrayValue.values) || []).map(fromFsValue);
  if ("timestampValue" in v) return v.timestampValue;
  if ("mapValue" in v) {
    const out = {};
    const f = (v.mapValue && v.mapValue.fields) || {};
    Object.keys(f).forEach((k) => { out[k] = fromFsValue(f[k]); });
    return out;
  }
  return null;
}
function fromFsDoc(doc) {
  const fields = (doc && doc.fields) || {};
  const out = {};
  Object.keys(fields).forEach((k) => { out[k] = fromFsValue(fields[k]); });
  return out;
}
async function fsGet(env, token, path) {
  if (!token) return null;
  const res = await _fetch(fsRoot(env) + path, { headers: { Authorization: "Bearer " + token } });
  if (!res.ok) return null;
  const data = await res.json().catch(() => null);
  return data ? fromFsDoc(data) : null;
}
/* 14 Oct: tells "this document does not exist" (refuse) apart from "Google
   could not be asked" (let it through, as before, so an outage never
   silences a real call). */
async function fsLook(env, token, path) {
  if (!token) return { state: "unknown" };
  let res;
  try { res = await _fetch(fsRoot(env) + path, { headers: { Authorization: "Bearer " + token } }); }
  catch (_) { return { state: "unknown" }; }
  if (res.status === 404) return { state: "missing" };
  if (!res.ok) return { state: "unknown" };
  const data = await res.json().catch(() => null);
  return data ? { state: "found", doc: fromFsDoc(data) } : { state: "unknown" };
}
/* A tie between sender and receiver: the receiver has the sender as a
   connection, or is in the sender's Circle. */
async function tied(env, token, from, to) {
  const a = await fsLook(env, token, "/users/" + encodeURIComponent(to) + "/connections/" + encodeURIComponent(from));
  if (a.state === "found") return "yes";
  const b = await fsLook(env, token, "/users/" + encodeURIComponent(from) + "/circle/" + encodeURIComponent(to));
  if (b.state === "found") return "yes";
  return (a.state === "unknown" || b.state === "unknown") ? "unknown" : "no";
}

export async function verifyIdToken(env, idToken) {
  if (!idToken) return null;

  const res = await _fetch(
    "https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=" + encodeURIComponent(apiKey(env)),
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ idToken }) },
  );
  if (!res.ok) return null;
  const data = await res.json().catch(() => ({}));
  const u = data.users && data.users[0];
  if (!u || !u.localId) return null;
  return { uid: u.localId, email: u.email || "" };
}

function rateLimited(uid, cap, bucket, dedupe) {
  const max = cap || 24;
  const key = String(uid || "") + "|" + String(bucket || "call");
  const now = Date.now();
  /* A repeat of the same call (the ring fires again at 2s, 6s and 14s)
     is one alert. It must not use up the burst, and it must not be refused
     as if it were a new person. */
  const seenKey = key + "|seen";
  const seen = memory.hits.get(seenKey) || {};
  Object.keys(seen).forEach((id) => {
    if (typeof seen[id] !== "number" || now - seen[id] >= 10 * 60 * 1000) delete seen[id];
  });
  if (dedupe && seen[dedupe]) {
    memory.hits.set(seenKey, seen);
    return false;
  }
  const arr = (memory.hits.get(key) || []).filter((t) => typeof t === "number" && now - t < 10 * 60 * 1000);
  if (arr.length >= max) {
    memory.hits.set(key, arr);
    memory.hits.set(seenKey, seen);
    return true;
  }
  arr.push(now);
  if (dedupe) seen[dedupe] = now;
  memory.hits.set(key, arr);
  memory.hits.set(seenKey, seen);
  return false;
}

function pickTokens(d) {
  if (!d) return [];
  const out = [];
  ["fcmTokenAndroid", "fcmTokenWeb", "fcmToken"].forEach((k) => {
    const v = String(d[k] || "").trim();
    if (v && out.indexOf(v) < 0) out.push(v);
  });
  webPushTokens(d).forEach((v) => { if (out.indexOf(v) < 0) out.push(v); });
  return out;
}
/* 21 Oct e: each browser or home-screen app keeps its own push address
   (vault.webPush.<device>). One shared field meant the last device to open
   Naluno took the alerts and every other one went quiet. Newest first,
   at most 4, none older than 60 days. */
export function webPushTokens(d) {
  const map = d && d.webPush;
  if (!map || typeof map !== "object") return [];
  const now = Date.now();
  return Object.keys(map).map((k) => map[k]).filter((x) => x && typeof x.t === "string" && x.t.length > 20 && x.t.length < 4096
    && (!x.at || now - Number(x.at) < 60 * 86400000))
    .sort((a, b) => Number(b.at || 0) - Number(a.at || 0)).slice(0, 4).map((x) => x.t);
}

async function loadServerTokens(env, calleeUid) {
  const token = await saAccessToken(env, "https://www.googleapis.com/auth/datastore");
  if (!token) return { tokens: [], source: "none" };
  const [pub, vault] = await Promise.all([
    fsGet(env, token, "/users/" + encodeURIComponent(calleeUid)),
    fsGet(env, token, "/users/" + encodeURIComponent(calleeUid) + "/vault/main"),
  ]);
  const tokens = pickTokens(Object.assign({}, pub || {}, vault || {}));
  return { tokens, source: tokens.length ? "firestore" : "empty" };
}

function clientTokens(body) {
  return pickTokens({
    fcmTokenAndroid: body.fcmTokenAndroid,
    fcmTokenWeb: body.fcmTokenWeb,
    fcmToken: body.fcmToken,
  });
}

async function assertAllowed(env, user, body) {
  const type = String(body.type || "incoming_call");
  const token = await saAccessToken(env, "https://www.googleapis.com/auth/datastore");
  if (!token) return { ok: true, checked: false };
  /* 14 Oct: every kind is checked. A missing record is refused; only an
     answer Google could not give lets the alert through unchecked. */
  if (type === "incoming_call") {
    const callId = String(body.callId || "").trim();
    if (!callId) return { ok: false, error: "missing call" };
    const got = await fsLook(env, token, "/calls/" + encodeURIComponent(callId));
    if (got.state === "missing") return { ok: false, error: "no such call" };
    if (got.state !== "found") return { ok: true, checked: false };
    const call = got.doc;
    if (call.callerUid !== user.uid || call.calleeUid !== body.calleeUid) {
      return { ok: false, error: "not a party to this call" };
    }
    if (call.status && call.status !== "ringing") return { ok: false, error: "that call is not ringing" };
    return { ok: true, checked: true };
  }
  if (type === "band_invite") {
    const bandId = String(body.bandId || "").trim();
    if (!bandId) return { ok: false, error: "missing band" };
    const got = await fsLook(env, token, "/bands/" + encodeURIComponent(bandId));
    if (got.state === "missing") return { ok: false, error: "no such Band" };
    if (got.state !== "found") return { ok: true, checked: false };
    const band = got.doc;
    const members = Array.isArray(band.memberUids) ? band.memberUids : [];
    if (band.creatorUid !== user.uid && band.createdBy !== user.uid && members.indexOf(user.uid) < 0) {
      return { ok: false, error: "not a member of this Band" };
    }
    if ((await tied(env, token, user.uid, body.calleeUid)) === "no") return { ok: false, error: "not connected" };
    return { ok: true, checked: true };
  }
  if (type === "broadcast_live") {
    const id = String(body.broadcastId || "").trim();
    if (!id) return { ok: false, error: "missing broadcast" };
    const got = await fsLook(env, token, "/broadcasts/" + encodeURIComponent(id));
    if (got.state === "missing") return { ok: false, error: "no such Broadcast" };
    if (got.state !== "found") return { ok: true, checked: false };
    const row = got.doc;
    if (row.creatorUid !== user.uid) return { ok: false, error: "not the creator of this Broadcast" };
    if (row.live !== true) return { ok: false, error: "that Broadcast is not live" };
    const members = Array.isArray(row.memberUids) ? row.memberUids : [];
    if (members.indexOf(body.calleeUid) < 0 && (await tied(env, token, user.uid, body.calleeUid)) === "no") {
      return { ok: false, error: "not connected" };
    }
    return { ok: true, checked: true };
  }
  if (type === "wireline") {
    /* The alert carries the sender's own words as its title and body, so it
       goes only to someone who has the sender as a connection (a stranger
       could otherwise put any text on anyone's lock screen). */
    if ((await tied(env, token, user.uid, body.calleeUid)) === "no") return { ok: false, error: "not connected" };
    return { ok: true, checked: true };
  }
  return { ok: false, error: "unknown type" };
}

async function sendFcm(env, deviceToken, payload) {
  const access = await saAccessToken(env, "https://www.googleapis.com/auth/firebase.messaging");
  if (!access) return { ok: false, error: "no-fcm-auth" };
  const title = String(payload.title || "Naluno").slice(0, 80);
  const isWire = String(payload.type || "") === "wireline";
  const body = String(payload.body || "Open Naluno").slice(0, isWire ? 140 : 120);
  const callId = String(payload.callId || "");
  const fromUid = String(payload.fromUid || "");
  const clientMsgId = String(payload.clientMsgId || "");
  let url = "/app/";
  if (payload.type === "incoming_call" && callId) url = "/app/?call=" + encodeURIComponent(callId);
  else if (isWire && fromUid) url = "/app/?wire=" + encodeURIComponent(fromUid);
  else if (payload.type === "broadcast_live" && payload.broadcastId) url = "/app/?broadcast=" + encodeURIComponent(String(payload.broadcastId));
  const data = {
    type: String(payload.type || ""),
    title,
    body,
    callId,
    bandId: String(payload.bandId || ""),
    broadcastId: String(payload.broadcastId || ""),
    fromUid,
    clientMsgId,
    senderName: title,
    url,
  };
  const isCall = data.type === "incoming_call" && !!callId;
  const callTag = isCall ? ("naluno-call:" + callId.slice(0, 80)) : "";
  const wireTag = isWire
    ? ("naluno-wire:" + fromUid.slice(0, 40) + ":" + (clientMsgId || String(Date.now())).slice(0, 48))
    : "";
  const message = {
    token: deviceToken,
    data,
    android: { priority: "HIGH", ttl: isCall ? "45s" : "86400s" },
    webpush: {
      headers: { Urgency: "high", TTL: isCall ? "60" : "86400" },
      notification: {
        title,
        body,
        icon: "https://getnaluno.com/icon-192.png",
        tag: callTag || wireTag || (data.type ? "naluno-" + data.type : "naluno"),
        renotify: true,
        requireInteraction: isCall ? true : undefined,
        silent: false,
        vibrate: isWire ? [180, 80, 180] : undefined,
        data: isCall
          ? { type: "incoming_call", callId, url }
          : (isWire ? { type: "wireline", fromUid, url, clientMsgId } : undefined),
      },
      fcm_options: { link: "https://getnaluno.com" + data.url },
    },
  };
  if (callTag) message.android.collapse_key = callTag;
  if (!isCall && !isWire && (data.type === "broadcast_live" || data.type === "band_invite")) {
    /* 14 Oct: the Android app only builds its own screen for calls; a
       data-only live or Band alert was dropped when Naluno was closed. It
       now carries a notification the phone shows by itself. */
    message.android.notification = {
      title,
      body,
      channel_id: "naluno_wireline",
      sound: "default",
      tag: data.type === "broadcast_live" ? ("naluno-live:" + data.broadcastId.slice(0, 80)) : ("naluno-band:" + data.bandId.slice(0, 80)),
      notification_priority: "PRIORITY_HIGH",
      visibility: "PUBLIC",
    };
  }
  if (isWire) {
    /* A notification payload is what the phone shows when Naluno is
       closed. Data alone never reaches the tray if the process is dead.
       A new tag per message so the sound plays again, like a new chat. */
    message.android.notification = {
      title,
      body,
      channel_id: "naluno_wireline",
      sound: "default",
      tag: wireTag || "naluno-wire",
      notification_priority: "PRIORITY_HIGH",
      visibility: "PUBLIC",
      default_sound: true,
      default_vibrate_timings: true,
    };
    message.apns = {
      headers: {
        "apns-priority": "10",
        "apns-push-type": "alert",
      },
      payload: {
        aps: {
          alert: { title, body },
          sound: "default",
          "thread-id": "naluno-wire:" + fromUid.slice(0, 40),
        },
        type: "wireline",
        fromUid,
      },
    };
  }
  if (isCall) {
    message.apns = {
      headers: {
        "apns-priority": "10",
        "apns-push-type": "alert",
        "apns-collapse-id": callTag,
      },
      payload: {
        aps: {
          alert: { title, body },
          sound: "default",
          category: "incoming_call",
          "thread-id": callTag,
          "interruption-level": "time-sensitive",
        },
        callId,
        type: "incoming_call",
      },
    };
  }
  const res = await _fetch(
    "https://fcm.googleapis.com/v1/projects/" + projectId(env) + "/messages:send",
    {
      method: "POST",
      headers: { Authorization: "Bearer " + access, "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
    },
  );
  const out = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, detail: out.error || out.name || "" };
}

function fcmWhy(detail) {
  if (!detail) return "";
  if (typeof detail === "string") return detail.slice(0, 80);
  return String(detail.status || detail.message || detail.code || "").slice(0, 80);
}

export async function handleRequest(request, env = {}) {
  if (request.method === "OPTIONS") return corsPreflight();
  /* 21 Oct e: which version is deployed (the console's deploy check). */
  if (request.method === "GET" && new URL(request.url).pathname === "/health") {
    return json({ ok: true, service: "naluno-call-notify", version: VERSION, hasServiceAccount: !!(env.GOOGLE_SERVICE_ACCOUNT || env.FIREBASE_SERVICE_ACCOUNT || env.SERVICE_ACCOUNT_JSON) });
  }
  if (request.method !== "POST") return json({ ok: false, error: "POST only" }, 405);

  const idToken = bearer(request);
  if (!idToken) return json({ ok: false, error: "Missing auth token" }, 401);
  const user = await verifyIdToken(env, idToken);
  if (!user) return json({ ok: false, error: "Invalid auth token" }, 401);

  const body = await request.json().catch(() => ({}));
  const calleeUid = String(body.calleeUid || "").trim();
  const type = String(body.type || "incoming_call");
  const bucket = type === "broadcast_live" ? "live" : (type === "band_invite" ? "band" : (type === "wireline" ? "wire" : "call"));
  const cap = type === "broadcast_live" ? 120 : (type === "wireline" ? 60 : 24);
  const wireId = type === "wireline" ? String(body.clientMsgId || "").trim().slice(0, 80) : "";
  if (type === "wireline" && wireId && memory.hits.get("wiresent|" + user.uid + "|" + wireId)) {
    return json({ ok: true, sent: true, reason: "deduped" });
  }
  const dedupe = type === "incoming_call" ? String(body.callId || "").trim() : (wireId || "");
  if (rateLimited(user.uid, cap, bucket, dedupe)) {
    return json({ ok: false, sent: false, reason: "rate" }, 429);
  }
  if (type === "wireline" && wireId) memory.hits.set("wiresent|" + user.uid + "|" + wireId, Date.now());
  if (!calleeUid) return json({ ok: false, sent: false, reason: "missing_token" }, 400);
  if (calleeUid === user.uid) return json({ ok: false, error: "cannot notify yourself" }, 400);
  if (!ALLOWED[type]) return json({ ok: false, error: "unknown type" }, 400);

  /* The check and the push addresses are read together; nothing is sent
     unless the check passes. */
  const [allowed, looked] = await Promise.all([
    assertAllowed(env, user, Object.assign({}, body, { calleeUid, type })),
    loadServerTokens(env, calleeUid).catch(() => ({ tokens: [], source: "none" })),
  ]);
  if (!allowed.ok) return json({ ok: false, error: allowed.error }, 403);

  let tokens = looked.tokens;
  let tokenSource = looked.source;
  if (!tokens.length) {
    tokens = clientTokens(body);
    tokenSource = tokens.length ? "client-fallback" : "empty";
  }
  if (!tokens.length) return json({ ok: true, sent: false, reason: "no_token", tokenSource });

  /* Every phone at once, not one after another. */
  const results = await Promise.all(tokens.slice(0, 5).map((t) => sendFcm(env, t, {
      type,
      title: String(body.title || "").slice(0, 80) || (type === "incoming_call" ? "Incoming call" : "Naluno"),
      body: String(body.body || "").slice(0, type === "wireline" ? 140 : 120) || "Open Naluno",
      callId: String(body.callId || ""),
      bandId: String(body.bandId || ""),
      broadcastId: String(body.broadcastId || ""),
      fromUid: String(body.fromUid || ""),
      clientMsgId: String(body.clientMsgId || ""),
    }).catch(() => ({ ok: false, error: "network" }))));
  const sent = results.some((r) => r.ok);
  const allFailed = results.length && results.every((r) => !r.ok);
  const why = results.map((r) => (r.ok ? "" : (r.error || fcmWhy(r.detail)))).filter(Boolean)[0] || "";
  return json({
    ok: true,
    sent,
    reason: sent ? "ok" : (allFailed ? (why || "all_failed") : "no_token"),
    tokenSource,
    version: VERSION,
  });
}
