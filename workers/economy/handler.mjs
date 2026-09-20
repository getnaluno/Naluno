/**
 * naluno-economy — Community Economy worker.
 *
 * Version 2.1.0-firestore
 *
 * The previous deploy answered /health 200 (secret present) then stamped
 * /v1/flags with degraded:true because a Google service-account JWT failed
 * when it actually talked to Firestore. Flags were still returned. The desk
 * painted NALUNO DEGRADED from that one bit.
 *
 * This rewrite:
 *   1. Parses the service-account JSON the way Wrangler actually stores it
 *      (escaped newlines, double-encoded JSON, quoted PEM) and signs a real
 *      RS256 JWT against oauth2.googleapis.com.
 *   2. If that path still fails, writes as the signed-in person using their
 *      Firebase ID token — economyInbox (new rules) and metrics (already
 *      allowed). Points are computed here, never accepted from the client.
 *   3. /v1/flags returns degraded:false whenever flags are served. Persist
 *      mode is a separate field. The product is not "degraded" because a
 *      key rotation hiccuped.
 */

export const VERSION = "2.3.0-admin-gate";
export const PROJECT_ID = "naluno-28a00";
export const OPERATOR_UID = "ibMOMY6Q3sVTCxIrwO2FGk43zw93";

export const DEFAULT_FLAGS = {
  broadcast_enabled: true,
  signals_enabled: true,
  toga_enabled: true,
  contribution_enabled: true,
  community_value_enabled: true,
  creator_support_enabled: false,
  community_rewards_enabled: false,
  real_payouts_enabled: false,
  content_hub_enabled: false,
  sports_enabled: false,
  movies_enabled: false,
};

const POINTS = {
  BROADCAST_COMMENT: { points: 3, eligible: 3 },
  COMMENT_REPLY: { points: 2, eligible: 2 },
  CREATOR_FOLLOW: { points: 1, eligible: 1 },
  WATCH_COMPLETION: { points: 2, eligible: 2 },
  BROADCAST_SHARE: { points: 2, eligible: 2 },
  SIGNAL_POST: { points: 1, eligible: 1 },
};

const REPORT_CODES = {
  harassment: 1, hate: 1, violence: 1, sexual: 1, scam: 1,
  impersonation: 1, stolen: 1, spam: 1, other: 1,
};

const memory = {
  events: new Map(),
  ledger: new Map(),
  profiles: new Map(),
  flags: { ...DEFAULT_FLAGS },
  reports: new Map(),
  presence: new Map(),
  audit: [],
  passwords: new Map(),
  pools: new Map(),
  mail: new Map(),
  mailHits: new Map(),
};

let _fetch = globalThis.fetch.bind(globalThis);
let saCache = { token: "", exp: 0, err: "" };

export function setFetchImpl(fn) {
  _fetch = fn || globalThis.fetch.bind(globalThis);
}
export function resetMemory() {
  memory.events.clear();
  memory.ledger.clear();
  memory.profiles.clear();
  memory.flags = { ...DEFAULT_FLAGS };
  memory.reports.clear();
  memory.presence.clear();
  memory.audit = [];
  memory.passwords.clear();
  memory.pools.clear();
  memory.mail.clear();
  memory.mailHits.clear();
  saCache = { token: "", exp: 0, err: "" };
}
export function getMemory() {
  return memory;
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Naluno-Admin",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    "Cache-Control": "no-store",
  };
}
function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(), "Content-Type": "application/json" },
  });
}
function corsPreflight() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

export function b64url(data) {
  let bin;
  if (typeof data === "string") {
    bin = unescape(encodeURIComponent(data));
  } else {
    const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data.buffer || data);
    bin = "";
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  }
  const s = btoa(bin);
  return s.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function parseServiceAccount(raw) {
  if (!raw) return null;
  if (typeof raw === "object") return normalizeSa(raw);
  let s = String(raw).trim();
  if (!s) return null;
  if ((s.startsWith("'") && s.endsWith("'")) || (s.startsWith('"') && s.endsWith('"'))) {
    s = s.slice(1, -1);
  }
  s = s.replace(/\r\n/g, "\n");
  for (let i = 0; i < 4; i++) {
    try {
      const obj = JSON.parse(s);
      if (typeof obj === "string") {
        s = obj;
        continue;
      }
      if (obj && typeof obj === "object") return normalizeSa(obj);
    } catch {
      /* not JSON yet */
    }
    const unescaped = s.replace(/\\n/g, "\n").replace(/\\"/g, '"').replace(/\\t/g, "\t");
    if (unescaped !== s) {
      try {
        const obj = JSON.parse(unescaped);
        if (typeof obj === "string") {
          s = obj;
          continue;
        }
        if (obj && typeof obj === "object") return normalizeSa(obj);
      } catch {
        /* continue */
      }
    }
    try {
      const pad = s.replace(/-/g, "+").replace(/_/g, "/");
      const padded = pad + "===".slice((pad.length + 3) % 4);
      const dec = atob(padded);
      if (dec && dec !== s && /[{"]/.test(dec)) {
        s = dec;
        continue;
      }
    } catch {
      break;
    }
    break;
  }
  return null;
}

function normalizeSa(obj) {
  if (!obj || typeof obj !== "object") return null;
  const email = obj.client_email || obj.clientEmail || "";
  let pk = String(obj.private_key || obj.privateKey || "");
  pk = pk.replace(/\\n/g, "\n").replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  if (!email || !pk.includes("BEGIN")) return null;
  if (!pk.endsWith("\n")) pk += "\n";
  return {
    client_email: email,
    private_key: pk,
    token_uri: obj.token_uri || "https://oauth2.googleapis.com/token",
    project_id: obj.project_id || obj.projectId || PROJECT_ID,
  };
}

function pemToArrayBuffer(pem) {
  const body = String(pem)
    .replace(/-----BEGIN [^-]+-----/g, "")
    .replace(/-----END [^-]+-----/g, "")
    .replace(/\s+/g, "");
  const bin = atob(body);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

export async function signRs256Jwt(sa, { now = Math.floor(Date.now() / 1000), scope } = {}) {
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64url(JSON.stringify({
    iss: sa.client_email,
    sub: sa.client_email,
    scope: scope || "https://www.googleapis.com/auth/datastore https://www.googleapis.com/auth/firebase.database",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  }));
  const unsigned = header + "." + claim;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToArrayBuffer(sa.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(unsigned),
  );
  return unsigned + "." + b64url(sig);
}

async function saAccessToken(env) {
  const now = Math.floor(Date.now() / 1000);
  if (saCache.token && saCache.exp - 60 > now) return saCache.token;
  const sa = parseServiceAccount(
    env.GOOGLE_SERVICE_ACCOUNT ||
      env.FIREBASE_SERVICE_ACCOUNT ||
      env.SERVICE_ACCOUNT_JSON ||
      env.GOOGLE_SA_JSON ||
      "",
  );
  if (!sa) {
    saCache.err = "no-service-account";
    return "";
  }
  try {
    const jwt = await signRs256Jwt(sa, { now });
    const res = await _fetch(sa.token_uri || "https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "grant_type=" + encodeURIComponent("urn:ietf:params:oauth:grant-type:jwt-bearer") + "&assertion=" + encodeURIComponent(jwt),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.access_token) {
      saCache.err = String(body.error || body.error_description || ("http-" + res.status));
      saCache.token = "";
      return "";
    }
    saCache.token = body.access_token;
    saCache.exp = now + Number(body.expires_in || 3600);
    saCache.err = "";
    return saCache.token;
  } catch (e) {
    saCache.err = (e && e.message) || "jwt-failed";
    return "";
  }
}

function projectId(env) {
  return env.FIREBASE_PROJECT_ID || env.GCP_PROJECT || PROJECT_ID;
}
function apiKey(env) {
  return env.FIREBASE_WEB_API_KEY || env.FIREBASE_API_KEY || "AIzaSyD0j1W7-gFJqbMd6rz4kMhQd5AiB8B2ox0";
}
function operatorUid(env) {
  return env.OPERATOR_UID || OPERATOR_UID;
}
function fsRoot(env) {
  return "https://firestore.googleapis.com/v1/projects/" + projectId(env) + "/databases/(default)/documents";
}

function toFsValue(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === "boolean") return { booleanValue: v };
  if (typeof v === "number") {
    if (Number.isInteger(v)) return { integerValue: String(v) };
    return { doubleValue: v };
  }
  if (typeof v === "string") return { stringValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toFsValue) } };
  if (typeof v === "object") {
    const fields = {};
    Object.keys(v).forEach((k) => {
      fields[k] = toFsValue(v[k]);
    });
    return { mapValue: { fields } };
  }
  return { stringValue: String(v) };
}
function fromFsValue(v) {
  if (!v || typeof v !== "object") return null;
  if ("stringValue" in v) return v.stringValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return Number(v.doubleValue);
  if ("booleanValue" in v) return !!v.booleanValue;
  if ("nullValue" in v) return null;
  if ("timestampValue" in v) return Date.parse(v.timestampValue) || 0;
  if ("arrayValue" in v) return (v.arrayValue.values || []).map(fromFsValue);
  if ("mapValue" in v) {
    const out = {};
    const f = (v.mapValue && v.mapValue.fields) || {};
    Object.keys(f).forEach((k) => {
      out[k] = fromFsValue(f[k]);
    });
    return out;
  }
  return null;
}
function fromFsDoc(doc) {
  const fields = (doc && doc.fields) || {};
  const out = {};
  Object.keys(fields).forEach((k) => {
    out[k] = fromFsValue(fields[k]);
  });
  if (doc && doc.name) {
    const parts = String(doc.name).split("/");
    out.id = parts[parts.length - 1];
  }
  return out;
}
function toFsFields(obj) {
  const fields = {};
  Object.keys(obj || {}).forEach((k) => {
    if (obj[k] === undefined) return;
    fields[k] = toFsValue(obj[k]);
  });
  return { fields };
}

async function fsFetch(env, token, method, path, body) {
  if (!token) return { ok: false, status: 0, data: null };
  const url = path.startsWith("http") ? path : fsRoot(env) + path;
  const res = await _fetch(url, {
    method,
    headers: {
      Authorization: "Bearer " + token,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

async function fsFetchPublic(env, method, path, body) {
  const key = apiKey(env);
  if (!key) return { ok: false, status: 0, data: null };
  const base = path.startsWith("http") ? path : fsRoot(env) + path;
  const url = base + (base.includes("?") ? "&" : "?") + "key=" + encodeURIComponent(key);
  const res = await _fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

async function verifyIdToken(env, idToken) {
  if (!idToken) return null;
  const res = await _fetch(
    "https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=" + encodeURIComponent(apiKey(env)),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken }),
    },
  );
  if (!res.ok) return null;
  const data = await res.json().catch(() => ({}));
  const u = data.users && data.users[0];
  if (!u || !u.localId) return null;
  return {
    uid: u.localId,
    email: u.email || "",
    name: u.displayName || "",
    emailVerified: u.emailVerified === true,
    customAttributes: u.customAttributes || "",
  };
}

function bearer(request) {
  const h = request.headers.get("Authorization") || request.headers.get("authorization") || "";
  const m = /^Bearer\s+(.+)$/i.exec(h.trim());
  return m ? m[1].trim() : "";
}

function stripPrefix(pathname) {
  let p = pathname || "/";
  if (p.startsWith("/__naluno-economy")) p = p.slice("/__naluno-economy".length) || "/";
  if (!p.startsWith("/")) p = "/" + p;
  return p;
}

function scoreEvent(eventType, text) {
  const spec = POINTS[eventType];
  if (!spec) return { points: 0, eligible: 0, status: "IGNORED", reason: "unknown event" };
  const t = typeof text === "string" ? text.trim() : "";
  if ((eventType === "BROADCAST_COMMENT" || eventType === "COMMENT_REPLY") && t.length < 8) {
    return { points: 0, eligible: 0, status: "PENDING_REVIEW", reason: "short text" };
  }
  return { points: spec.points, eligible: spec.eligible, status: "COUNTED", reason: "ok" };
}

function profileOf(uid) {
  if (!memory.profiles.has(uid)) {
    memory.profiles.set(uid, {
      user_id: uid,
      total_points: 0,
      eligible_points: 0,
      events: 0,
      updated_at: 0,
    });
  }
  return memory.profiles.get(uid);
}

function applyLedger(row) {
  memory.ledger.set(row.ledger_id, row);
  const p = profileOf(row.user_id);
  p.total_points += Number(row.points) || 0;
  p.eligible_points += Number(row.eligible_points) || 0;
  p.events += 1;
  p.updated_at = row.ts;
}

async function persistEvent(env, userToken, saToken, row) {
  const paths = [];
  const eventDoc = {
    event_id: row.event_id,
    event_type: row.event_type,
    actor_user_id: row.user_id,
    user_id: row.user_id,
    target_type: row.target_type || "",
    target_id: row.target_id || "",
    broadcast_id: row.broadcast_id || "",
    parent_event_id: row.parent_event_id || "",
    creator_uid: row.creator_uid || "",
    session_id: row.session_id || "",
    text: String(row.text || "").slice(0, 2000),
    ts: row.ts,
    client_ts: row.client_ts || row.ts,
  };
  const ledgerDoc = {
    ledger_id: row.ledger_id,
    event_id: row.event_id,
    user_id: row.user_id,
    event_type: row.event_type,
    points: row.points,
    eligible_points: row.eligible_points,
    status: row.status,
    reason: row.reason,
    ts: row.ts,
    broadcast_id: row.broadcast_id || "",
  };
  const inboxDoc = {
    event_id: row.event_id,
    event_type: row.event_type,
    actor_user_id: row.user_id,
    target_type: row.target_type || "",
    target_id: row.target_id || "",
    broadcast_id: row.broadcast_id || "",
    parent_event_id: row.parent_event_id || "",
    creator_uid: row.creator_uid || "",
    session_id: row.session_id || "",
    text: String(row.text || "").slice(0, 2000),
    ts: row.ts,
    client_ts: row.client_ts || row.ts,
  };
  const metricDoc = {
    uid: row.user_id,
    name: "economy." + row.event_type,
    event_type: row.event_type,
    event_id: row.event_id,
    target_id: row.target_id || "",
    broadcast_id: row.broadcast_id || "",
    at: row.ts,
  };

  memory.events.set(row.event_id, eventDoc);
  applyLedger(ledgerDoc);
  paths.push("memory");

  if (saToken) {
    const a = await fsFetch(env, saToken, "PATCH", "/engagementEvents/" + encodeURIComponent(row.event_id), toFsFields(eventDoc));
    const b = await fsFetch(env, saToken, "PATCH", "/contributionLedger/" + encodeURIComponent(row.ledger_id), toFsFields(ledgerDoc));
    const p = profileOf(row.user_id);
    await fsFetch(env, saToken, "PATCH", "/contributionProfiles/" + encodeURIComponent(row.user_id), toFsFields(p));
    if (a.ok || b.ok) paths.push("sa");
  }
  if (userToken) {
    const inbox = await fsFetch(
      env,
      userToken,
      "PATCH",
      "/economyInbox/" + encodeURIComponent(row.event_id) + "?currentDocument.exists=false",
      toFsFields(inboxDoc),
    );
    if (!inbox.ok) {
      await fsFetch(env, userToken, "PATCH", "/economyInbox/" + encodeURIComponent(row.event_id), toFsFields(inboxDoc));
    }
    const met = await fsFetch(
      env,
      userToken,
      "PATCH",
      "/metrics/" + encodeURIComponent(row.event_id),
      toFsFields(metricDoc),
    );
    if (inbox.ok || met.ok) paths.push("user-token");
  }
  return paths;
}

async function readFlags(env, saToken, userToken) {
  const tryRead = async (token) => {
    if (!token) return null;
    const r = await fsFetch(env, token, "GET", "/economyConfig/flags");
    if (!r.ok || !r.data || !r.data.fields) return null;
    return fromFsDoc(r.data);
  };
  const fromSa = await tryRead(saToken);
  if (fromSa) return { flags: { ...DEFAULT_FLAGS, ...fromSa }, source: "firestore-sa" };
  const fromUser = await tryRead(userToken);
  if (fromUser) return { flags: { ...DEFAULT_FLAGS, ...fromUser }, source: "firestore-user" };
  return { flags: { ...DEFAULT_FLAGS, ...memory.flags }, source: "defaults" };
}

async function writeFlags(env, saToken, userToken, flags) {
  memory.flags = { ...DEFAULT_FLAGS, ...flags };
  const doc = toFsFields(memory.flags);
  if (saToken) {
    const r = await fsFetch(env, saToken, "PATCH", "/economyConfig/flags", doc);
    if (r.ok) return "sa";
  }
  if (userToken) {
    const r = await fsFetch(env, userToken, "PATCH", "/economyConfig/flags", doc);
    if (r.ok) return "user-token";
  }
  return "memory";
}

function hasSaConfigured(env) {
  const raw = env.GOOGLE_SERVICE_ACCOUNT || env.FIREBASE_SERVICE_ACCOUNT || env.SERVICE_ACCOUNT_JSON || env.GOOGLE_SA_JSON || "";
  return !!raw;
}

function persistMode(saOk, paths) {
  if (saOk || (paths && paths.indexOf("sa") >= 0)) return "firestore-sa";
  if (paths && paths.indexOf("user-token") >= 0) return "user-token";
  return "memory";
}

async function requireUser(env, request) {
  const token = bearer(request);
  if (!token) return { error: json({ ok: false, error: "Missing auth token" }, 401) };
  const user = await verifyIdToken(env, token);
  if (!user) return { error: json({ ok: false, error: "Invalid auth token" }, 401) };
  return { user, token };
}

function isOperatorUser(env, user) {
  if (!user) return false;
  if (user.uid === operatorUid(env)) return true;
  const extra = String(env.OPERATOR_UIDS || "");
  if (extra && extra.split(/[,\s]+/).indexOf(user.uid) >= 0) return true;
  const raw = user.customAttributes || "";
  if (raw) {
    try {
      const c = typeof raw === "string" ? JSON.parse(raw) : raw;
      if (c && c.operator === true) return true;
    } catch {
      /* ignore */
    }
  }
  /* Email is a fallback so a rebuilt Google account is not locked out.
     It is not enough on its own: the address must be verified. */
  const mail = String(user.email || "").trim().toLowerCase();
  if (mail === "magjoed@gmail.com" && user.emailVerified === true) return true;
  return false;
}

async function saAccessTokenScoped(env, scope) {
  const sa = parseServiceAccount(
    env.GOOGLE_SERVICE_ACCOUNT ||
      env.FIREBASE_SERVICE_ACCOUNT ||
      env.SERVICE_ACCOUNT_JSON ||
      env.GOOGLE_SA_JSON ||
      "",
  );
  if (!sa) return "";
  try {
    const jwt = await signRs256Jwt(sa, { now: Math.floor(Date.now() / 1000), scope });
    const res = await _fetch(sa.token_uri || "https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "grant_type=" + encodeURIComponent("urn:ietf:params:oauth:grant-type:jwt-bearer") + "&assertion=" + encodeURIComponent(jwt),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.access_token) return "";
    return body.access_token;
  } catch {
    return "";
  }
}

async function stampOperatorClaim(env, uid) {
  if (!uid) return false;
  const token = await saAccessTokenScoped(
    env,
    "https://www.googleapis.com/auth/identitytoolkit",
  );
  if (!token) return false;
  try {
    const res = await _fetch(
      "https://identitytoolkit.googleapis.com/v1/projects/" + projectId(env) + "/accounts:update",
      {
        method: "POST",
        headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
        body: JSON.stringify({ localId: uid, customAttributes: JSON.stringify({ operator: true }) }),
      },
    );
    return res.ok;
  } catch {
    return false;
  }
}

async function sha256Hex(s) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return bytesToHex(new Uint8Array(buf));
}
function bytesToHex(bytes) {
  let hex = "";
  for (let i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, "0");
  return hex;
}
function bytesToB64(bytes) {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}
function b64ToBytes(s) {
  const bin = atob(String(s || ""));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
function timingEq(a, b) {
  const x = String(a || "");
  const y = String(b || "");
  if (x.length !== y.length) return false;
  let d = 0;
  for (let i = 0; i < x.length; i++) d |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return d === 0;
}
const PBKDF2_ITERS = 150000;
async function pbkdf2Bytes(password, saltBytes, iters) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(String(password)), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: saltBytes, iterations: iters || PBKDF2_ITERS },
    key,
    256,
  );
  return new Uint8Array(bits);
}
async function hashPasswordV2(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2Bytes(password, salt, PBKDF2_ITERS);
  return {
    v: 2,
    algo: "pbkdf2-sha256",
    iters: PBKDF2_ITERS,
    salt: bytesToB64(salt),
    hash: bytesToHex(hash),
    updated_at: Date.now(),
  };
}
async function passwordMatches(stored, uid, password) {
  if (!stored || !password) return false;
  if (typeof stored === "string") {
    const sha = await sha256Hex(uid + ":" + password);
    if (timingEq(sha, stored)) return true;
    const legacy = await pbkdf2Bytes(password, new TextEncoder().encode("naluno-admin-v1|" + uid), 120000);
    return timingEq(bytesToB64(legacy), stored);
  }
  if (stored && stored.v === 2 && stored.salt && stored.hash) {
    const got = await pbkdf2Bytes(password, b64ToBytes(stored.salt), Number(stored.iters) || PBKDF2_ITERS);
    return timingEq(bytesToHex(got), stored.hash);
  }
  if (stored && stored.hash) return passwordMatches(stored.hash, uid, password);
  return false;
}
function recordFromDoc(doc) {
  if (!doc) return null;
  if (doc.v === 2 && doc.hash && doc.salt) return doc;
  if (doc.hash) return doc.v === 2 ? doc : String(doc.hash);
  return null;
}
async function loadPasswordRecord(env, uid, saToken) {
  if (memory.passwords.has(uid)) return memory.passwords.get(uid);
  const token = saToken;
  if (!token || !uid) return null;
  const paths = [
    "/adminCredentials/" + encodeURIComponent(uid),
    "/adminConsole/" + encodeURIComponent(uid),
  ];
  for (let i = 0; i < paths.length; i++) {
    try {
      const r = await fsFetch(env, token, "GET", paths[i]);
      if (!r.ok) continue;
      const rec = recordFromDoc(fromFsDoc(r.data));
      if (rec) {
        memory.passwords.set(uid, rec);
        return rec;
      }
    } catch {
      /* try next */
    }
  }
  return null;
}
async function persistPasswordRecord(env, uid, rec, saToken, userToken) {
  memory.passwords.set(uid, rec);
  const body = toFsFields(typeof rec === "string" ? { hash: rec, v: 1, updated_at: Date.now() } : rec);
  if (saToken) {
    const r = await fsFetch(env, saToken, "PATCH", "/adminCredentials/" + encodeURIComponent(uid), body);
    if (r.ok) return "firestore-sa";
  }
  if (userToken) {
    const r = await fsFetch(env, userToken, "PATCH", "/adminConsole/" + encodeURIComponent(uid), body);
    if (r.ok) return "user-token";
  }
  return "memory";
}

async function handleAdmin(env, request, path, url, user, userToken, saToken) {
  if (!isOperatorUser(env, user)) return json({ ok: false, error: "not an operator" }, 403);
  const adminPass = request.headers.get("X-Naluno-Admin") || "";
  const stored = await loadPasswordRecord(env, user.uid, saToken);
  const openPath = path === "/v1/admin/status" || path === "/v1/admin/password" || path === "/v1/admin/unlock";
  if (!openPath && stored) {
    if (!adminPass) return json({ ok: false, error: "console password required" }, 401);
    if (!(await passwordMatches(stored, user.uid, adminPass))) {
      return json({ ok: false, error: "console password not accepted" }, 401);
    }
  }

  const listCol = async (name, limit) => {
    const token = saToken || userToken;
    const r = await fsFetch(env, token, "GET", "/" + name + "?pageSize=" + (limit || 200));
    if (!r.ok) return [];
    return (r.data.documents || []).map(fromFsDoc);
  };

  if (path === "/v1/admin/status" && request.method === "GET") {
    const stamped = await stampOperatorClaim(env, user.uid);
    const rec = stored || await loadPasswordRecord(env, user.uid, saToken);
    return json({
      ok: true,
      operator: true,
      uid: user.uid,
      hasPassword: !!rec,
      persist: saToken ? "firestore-sa" : "user-token",
      version: VERSION,
      claim: stamped ? "operator" : "",
    });
  }

  if (path === "/v1/admin/unlock" && request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    const pass = String(body.password || adminPass || "").trim();
    const rec = stored || await loadPasswordRecord(env, user.uid, saToken);
    if (!rec) return json({ ok: true, setup: true, hasPassword: false });
    if (!pass || !(await passwordMatches(rec, user.uid, pass))) {
      return json({ ok: false, error: "console password not accepted" }, 401);
    }
    return json({ ok: true, hasPassword: true });
  }

  if (path === "/v1/admin/password" && request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    const next = String(body.next_password || "").trim();
    if (next.length < 8) return json({ ok: false, error: "Use at least 8 characters" }, 400);
    const rec = stored || await loadPasswordRecord(env, user.uid, saToken);
    if (rec) {
      const current = String(body.current_password || adminPass || "").trim();
      if (!current || !(await passwordMatches(rec, user.uid, current))) {
        return json({ ok: false, error: "current password is wrong" }, 401);
      }
    }
    const hashed = await hashPasswordV2(next);
    const where = await persistPasswordRecord(env, user.uid, hashed, saToken, userToken);
    memory.audit.unshift({ action: "password-set", actor: user.uid, ts: Date.now() });
    return json({ ok: true, persist: where });
  }

  if (path === "/v1/admin/flags" && request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    const next = { ...DEFAULT_FLAGS };
    Object.keys(DEFAULT_FLAGS).forEach((k) => {
      if (k in body) next[k] = !!body[k];
    });
    next.real_payouts_enabled = false;
    const where = await writeFlags(env, saToken, userToken, next);
    memory.audit.unshift({ action: "flags", actor: user.uid, ts: Date.now(), extra: next });
    return json({ ok: true, flags: next, persist: where });
  }

  if (path === "/v1/admin/overview" && request.method === "GET") {
    const flags = await readFlags(env, saToken, userToken);
    const ledger = await listCol("contributionLedger", 200);
    const merged = ledger.length ? ledger : Array.from(memory.ledger.values());
    const pending = merged.filter((r) => String(r.status || "").toUpperCase() === "PENDING_REVIEW");
    return json({
      ok: true,
      flags: flags.flags,
      rules_version: VERSION,
      ledger_rows_sampled: merged.length,
      counted: merged.filter((r) => String(r.status || "").toUpperCase() === "COUNTED").length,
      pending_review: pending.length,
      total_points_sampled: merged.reduce((a, r) => a + Number(r.points || 0), 0),
      total_eligible_sampled: merged.reduce((a, r) => a + Number(r.eligible_points || 0), 0),
      recent: merged.slice(0, 20),
      persist: saToken ? "firestore-sa" : "user-token",
    });
  }

  if (path === "/v1/admin/activity" && request.method === "GET") {
    const events = Array.from(memory.events.values());
    const ledger = Array.from(memory.ledger.values());
    return json({
      ok: true,
      broadcasts_today: 0,
      comments: events.filter((e) => e.event_type === "BROADCAST_COMMENT").length,
      replies: events.filter((e) => e.event_type === "COMMENT_REPLY").length,
      shares: events.filter((e) => e.event_type === "BROADCAST_SHARE").length,
      views: events.filter((e) => e.event_type === "WATCH_COMPLETION").length,
      contributors: new Set(ledger.map((r) => r.user_id)).size,
      contribution_points: ledger.reduce((a, r) => a + Number(r.points || 0), 0),
      flagged_activity: 0,
      pending_review: ledger.filter((r) => r.status === "PENDING_REVIEW").length,
    });
  }

  if (path === "/v1/admin/users" && request.method === "GET") {
    const q = (url.searchParams.get("q") || "").toLowerCase();
    const users = await listCol("users", 400);
    const matched = q
      ? users.filter((u) => [u.name, u.handle, u.email, u.id, u.uid].join(" ").toLowerCase().includes(q))
      : users;
    return json({
      ok: true,
      total: users.length,
      matched: matched.length,
      users: matched.slice(0, 80).map((u) => {
        const p = profileOf(u.id || u.uid || "");
        return {
          uid: u.id || u.uid,
          name: u.name || "",
          handle: u.handle || "",
          tier: "NEW",
          contribution_points: p.total_points,
          risk_flags: 0,
          suspended: !!u.suspended,
          restricted: !!u.restricted,
        };
      }),
    });
  }

  if (path === "/v1/admin/user" && request.method === "GET") {
    const uid = url.searchParams.get("uid") || "";
    const p = profileOf(uid);
    const events = Array.from(memory.events.values()).filter((e) => e.actor_user_id === uid);
    const ledger = Array.from(memory.ledger.values()).filter((r) => r.user_id === uid);
    return json({
      ok: true,
      uid,
      profile: { name: "", handle: "", email: "" },
      trust: { risk_flags: 0, removed_content: 0, suspended: false, restricted: false },
      contribution: { total_points: p.total_points, eligible_points: p.eligible_points },
      tier: "NEW",
      broadcasts: [],
      events,
      ledger,
    });
  }

  if (path === "/v1/admin/user-action" && request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    const target = String(body.user_id || "");
    const action = String(body.action || "");
    const reason = String(body.reason || "").trim();
    if (!target || !action || !reason) return json({ ok: false, error: "user_id, action and reason are required" }, 400);
    const patch = { updatedAt: Date.now() };
    if (action === "suspend") {
      patch.suspended = true;
      patch.suspendedReason = reason;
    }
    if (action === "unsuspend") {
      patch.suspended = false;
      patch.suspendedReason = "";
    }
    if (action === "restrict") {
      patch.restricted = true;
      patch.restrictedReason = reason;
    }
    if (action === "unrestrict") {
      patch.restricted = false;
      patch.restrictedReason = "";
    }
    const token = saToken || userToken;
    await fsFetch(env, token, "PATCH", "/users/" + encodeURIComponent(target), toFsFields(patch));
    memory.audit.unshift({ action, target, reason, actor: user.uid, ts: Date.now() });
    if (userToken) {
      await fsFetch(env, userToken, "POST", "/adminAudit", toFsFields({
        action, target, reason, actor: user.uid, actorEmail: user.email, created_at: Date.now(),
      }));
    }
    return json({ ok: true });
  }

  if (path === "/v1/admin/reports" && request.method === "GET") {
    const rows = await listCol("reports", 80);
    const all = rows.length ? rows : Array.from(memory.reports.values());
    const open = all.filter((r) => String(r.status || "OPEN").toUpperCase() === "OPEN");
    return json({ ok: true, open: open.length, actioned: all.length - open.length, reports: all, by_reason: {} });
  }

  if (path === "/v1/admin/report-action" && request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    const id = String(body.report_id || body.id || "");
    const decision = String(body.decision || body.status || "OPEN");
    const reason = String(body.reason || "").trim();
    if (!id || !reason) return json({ ok: false, error: "report and reason required" }, 400);
    const token = saToken || userToken;
    await fsFetch(env, token, "PATCH", "/reports/" + encodeURIComponent(id), toFsFields({
      status: decision, decided_by: user.uid, decided_at: Date.now(), note: reason,
    }));
    memory.audit.unshift({ action: "report-" + decision, target: id, reason, actor: user.uid, ts: Date.now() });
    return json({ ok: true });
  }

  if (path === "/v1/admin/contribution" && request.method === "GET") {
    const ledger = Array.from(memory.ledger.values());
    return json({
      ok: true,
      rows: ledger,
      total_points: ledger.reduce((a, r) => a + Number(r.points || 0), 0),
      contributors: new Set(ledger.map((r) => r.user_id)).size,
    });
  }

  if (path === "/v1/admin/audit" && request.method === "GET") {
    const rows = await listCol("adminAudit", 80);
    return json({ ok: true, audit: rows.length ? rows : memory.audit });
  }

  if (path === "/v1/admin/simulate" && request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    const period = String(body.period_id || "");
    const pool = memory.pools.get(period);
    const amount = pool ? Number(pool.amount_minor) : 0;
    const eligible = Array.from(memory.profiles.values()).filter((p) => p.eligible_points > 0);
    const total = eligible.reduce((a, p) => a + p.eligible_points, 0) || 1;
    const projected = eligible
      .sort((a, b) => b.eligible_points - a.eligible_points)
      .slice(0, Number(body.limit || 20))
      .map((p) => ({
        user_id: p.user_id,
        eligible: p.eligible_points,
        amount_minor: Math.floor((p.eligible_points / total) * amount),
      }));
    const allocated = projected.reduce((a, r) => a + r.amount_minor, 0);
    return json({
      ok: true,
      pool_amount_minor: amount,
      currency: (pool && pool.currency) || "AED",
      eligible_contributors: eligible.length,
      total_eligible_contribution: total,
      allocated_minor: allocated,
      undistributed_minor: amount - allocated,
      projected,
    });
  }

  if (path === "/v1/admin/pools" && request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    const period = String(body.period_id || "");
    if (!period) return json({ ok: false, error: "period_id required" }, 400);
    const row = {
      period_id: period,
      amount_minor: Math.round(Number(body.amount_minor) || 0),
      currency: body.currency || "AED",
      funding_source: body.funding_source || "UNSPECIFIED",
      status: "DRAFT",
      reason: String(body.reason || ""),
    };
    memory.pools.set(period, row);
    memory.audit.unshift({ action: "pool-save", target: period, reason: row.reason, actor: user.uid, ts: Date.now() });
    return json({ ok: true });
  }

  if (path === "/v1/admin/broadcasts") {
    const rows = await listCol("broadcasts", 200);
    return json({ ok: true, broadcasts: rows });
  }
  if (path === "/v1/admin/trust") return json({ ok: true, flagged: 0, suspended: 0, restricted: 0 });
  if (path === "/v1/admin/value") return json({ ok: true, is_monetary: false, items: [] });
  if (path === "/v1/admin/support") return json({ ok: true, transactions: 0, succeeded: 0, gross_minor: 0 });
  if (path === "/v1/admin/rewards") return json({ ok: true, allocations: 0 });
  if (path === "/v1/admin/financial") {
    return json({
      ok: true,
      no_money_has_moved: true,
      currency: "AED",
      creator_support: { transactions: 0, succeeded: 0, gross_minor: 0, fees_minor: 0, net_minor: 0 },
      creator_earnings: { entries: 0, total_minor: 0 },
      community_rewards: { allocations: 0, total_minor: 0 },
      reward_pools: { count: memory.pools.size, committed_minor: 0 },
    });
  }
  if (path === "/v1/admin/trace") {
    const uid = url.searchParams.get("uid") || "";
    return json({ ok: true, uid, events: Array.from(memory.events.values()).filter((e) => e.actor_user_id === uid) });
  }
  if (path === "/v1/admin/user-cost") {
    return json({ ok: true, storage_bytes: 0, days: Number(url.searchParams.get("days") || 30) });
  }
  if (path === "/v1/admin/moderation") return json({ ok: true, pending: 0 });

  return json({ ok: false, error: "unknown admin route" }, 404);
}

const MAIL_KINDS = { contact: 1, "delete-account": 1, operator: 1, privacy: 1, invest: 1 };

function clientIp(request) {
  const cf = request.headers.get("CF-Connecting-IP") || request.headers.get("cf-connecting-ip");
  if (cf && cf.trim()) return cf.trim();
  const xff = request.headers.get("X-Forwarded-For") || request.headers.get("x-forwarded-for") || "";
  if (xff) return xff.split(",")[0].trim() || "unknown";
  return "unknown";
}

function looksLikeEmail(s) {
  const v = String(s || "").trim();
  return /^[^\s@]{1,64}@[^\s@]{1,190}\.[A-Za-z]{2,24}$/.test(v);
}

function mailInbox(env) {
  return String((env && (env.INBOX_TO || env.MAIL_TO)) || "").trim();
}

function mailRateLimited(ip) {
  const now = Date.now();
  const prune = (key, windowMs, limit) => {
    const arr = (memory.mailHits.get(key) || []).filter((t) => now - t < windowMs);
    if (arr.length >= limit) {
      memory.mailHits.set(key, arr);
      return true;
    }
    arr.push(now);
    memory.mailHits.set(key, arr);
    return false;
  };
  return prune(ip, 60 * 60 * 1000, 8) || prune(ip + ":burst", 8000, 2);
}

async function mailRateLimitedDurable(env, saToken, ip) {
  if (!saToken) return false;
  try {
    const hex = await sha256Hex("mail:" + String(ip || "unknown"));
    const id = "m" + hex.slice(0, 20);
    const got = await fsFetch(env, saToken, "GET", "/deskRate/" + encodeURIComponent(id));
    const now = Date.now();
    let hits = [];
    if (got.ok && got.data) {
      const d = fromFsDoc(got.data);
      hits = Array.isArray(d.hits) ? d.hits.map(Number).filter((t) => now - t < 60 * 60 * 1000) : [];
    }
    if (hits.length >= 12) return true;
    hits.push(now);
    await fsFetch(env, saToken, "PATCH", "/deskRate/" + encodeURIComponent(id), toFsFields({
      hits: hits.slice(-24),
      updatedAt: now,
    }));
    return false;
  } catch {
    return false;
  }
}

async function deliverInboxEmail(env, row) {
  const to = mailInbox(env);
  if (!to || !looksLikeEmail(to)) return { emailed: false, via: "" };
  const subject =
    row.kind === "delete-account"
      ? "Naluno · delete-account request"
      : row.kind === "privacy"
        ? "Naluno · privacy"
        : row.kind === "invest"
          ? "Naluno · " + (row.interest === "partnership"
            ? "strategic partnership"
            : row.interest === "mentorship"
              ? "mentorship"
              : row.interest === "other"
                ? "conversation"
                : "investment")
        : row.source === "compass"
          ? "Naluno · Compass"
          : "Naluno · contact";
  const text = [
    "Source: " + row.source,
    "Kind: " + row.kind,
    "Name: " + (row.name || "—"),
    "Handle: " + (row.handle || "—"),
    "Reply-to: " + (row.email || "—"),
    "Phone: " + (row.phone || "—"),
    "Organisation: " + (row.organisation || "—"),
    "Country: " + (row.country || "—"),
    "Interest: " + (row.interest || "—"),
    "Uid: " + (row.uid || "—"),
    "Id: " + row.id,
    "",
    row.text,
  ].join("\n");

  if (env.RESEND_API_KEY) {
    try {
      const payload = {
        from: env.MAIL_FROM || "Naluno <naluno@getnaluno.com>",
        to: [to],
        subject,
        text,
      };
      if (looksLikeEmail(row.email)) payload.reply_to = row.email;
      const res = await _fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: "Bearer " + env.RESEND_API_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      if (res.ok) return { emailed: true, via: "resend" };
    } catch (_) { /* fall through */ }
  }

  try {
    const body = {
      name: row.name || row.handle || "Naluno visitor",
      email: looksLikeEmail(row.email) ? row.email : "noreply@getnaluno.com",
      _subject: subject,
      _template: "box",
      _captcha: "false",
      message: text,
    };
    if (looksLikeEmail(row.email)) body._replyto = row.email;
    const headers = {
      "Content-Type": "application/json",
      Accept: "application/json",
      Origin: "https://getnaluno.com",
      Referer: "https://getnaluno.com/",
    };
    const res = await _fetch("https://formsubmit.co/ajax/" + encodeURIComponent(to), {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    if (res.ok) return { emailed: true, via: "formsubmit" };
    const params = new URLSearchParams();
    Object.keys(body).forEach((k) => params.set(k, String(body[k])));
    const res2 = await _fetch("https://formsubmit.co/" + encodeURIComponent(to), {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
        Origin: "https://getnaluno.com",
        Referer: "https://getnaluno.com/",
      },
      body: params.toString(),
    });
    if (res2.ok) return { emailed: true, via: "formsubmit" };
  } catch (_) { /* deskMail is the record */ }
  return { emailed: false, via: "" };
}

async function persistMail(env, saToken, userToken, row) {
  memory.mail.set(row.id, row);
  if (saToken) {
    const r = await fsFetch(env, saToken, "PATCH", "/deskMail/" + encodeURIComponent(row.id), toFsFields(row));
    if (r.ok) return "firestore-sa";
  }
  if (userToken && row.uid) {
    const r = await fsFetch(
      env,
      userToken,
      "PATCH",
      "/deskMail/" + encodeURIComponent(row.id) + "?currentDocument.exists=false",
      toFsFields(row),
    );
    if (r.ok) return "user-token";
  }
  /* Never write deskMail with only the public web API key. That path
     has no Firebase user, so a loosened rule would let anyone stamp
     operator mail. Memory + email remain the unauthenticated fallback. */
  return saToken || userToken ? "failed" : "memory";
}

async function handleMail(request, env, saToken) {
  const ip = clientIp(request);
  if (mailRateLimited(ip)) {
    return json({ ok: false, error: "Please wait a moment and try again." }, 429);
  }
  if (await mailRateLimitedDurable(env, saToken, ip)) {
    return json({ ok: false, error: "Please wait a moment and try again." }, 429);
  }
  const body = await request.json().catch(() => ({}));
  if (String(body.company || body.website || body._hp || "").trim()) {
    return json({ ok: true, ignored: true });
  }
  const text = String(body.text || body.message || "").trim();
  if (text.length < 2) return json({ ok: false, error: "Write a message first." }, 400);
  if (text.length > 6000) return json({ ok: false, error: "That message is too long." }, 400);

  let kind = String(body.kind || "contact").toLowerCase().replace(/\s+/g, "-");
  if (kind === "delete" || kind === "deleteaccount" || kind === "delete_account") kind = "delete-account";
  if (kind === "investment" || kind === "investor" || kind === "partnership" || kind === "mentor" || kind === "mentorship") kind = "invest";
  if (!MAIL_KINDS[kind]) kind = "contact";

  const token = bearer(request);
  const user = token ? await verifyIdToken(env, token) : null;

  if (kind === "delete-account" && !user && !String(body.email || body.handle || "").trim()) {
    return json({ ok: false, error: "Sign in, or leave a handle or email so we know which account." }, 400);
  }

  const INTERESTS = { investment: 1, partnership: 1, mentorship: 1, other: 1 };
  let interest = String(body.interest || "").toLowerCase().trim().replace(/\s+/g, "-").replace(/\//g, "-");
  if (interest === "strategic-partnership" || interest === "strategic_partnership" || interest === "partner") interest = "partnership";
  if (interest === "mentorship-advisory" || interest === "mentorship/advisory" || interest === "advisory" || interest === "mentor") interest = "mentorship";
  if (interest === "invest") interest = "investment";
  if (!INTERESTS[interest]) interest = kind === "invest" ? "investment" : "";

  const sourceRaw = String(body.source || (user ? "compass" : "web")).toLowerCase();
  const source = sourceRaw === "compass" ? "compass" : "web";

  const row = {
    id: "m" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
    source,
    kind,
    name: String(body.name || "").trim().slice(0, 80),
    handle: String(body.handle || "").trim().slice(0, 40),
    email: String(body.email || "").trim().slice(0, 120),
    phone: String(body.phone || body.whatsapp || "").trim().slice(0, 40),
    organisation: String(body.organisation || body.org || "").trim().slice(0, 80),
    country: String(body.country || "").trim().slice(0, 80),
    interest,
    uid: user ? user.uid : "",
    text,
    ts: Date.now(),
    status: "new",
  };
  if (user) {
    if (!row.email && user.email) row.email = String(user.email).slice(0, 120);
    if (!row.name && user.name) row.name = String(user.name).slice(0, 80);
  }
  if (kind === "invest") {
    if (!row.name || !looksLikeEmail(row.email)) {
      return json({ ok: false, error: "Leave a name and a reply-to email." }, 400);
    }
    if (!row.country) {
      return json({ ok: false, error: "Leave a country so we know where to start." }, 400);
    }
  }

  const persist = await persistMail(env, saToken, user ? token : "", row);
  const delivered = await deliverInboxEmail(env, row);
  const kept = persist === "firestore-sa" || persist === "user-token" || persist === "firestore";
  if (!delivered.emailed && !kept) {
    return json({ ok: false, error: "Could not send just now. Try again in a minute." }, 503);
  }
  return json({
    ok: true,
    id: row.id,
    emailed: !!delivered.emailed,
    persist: persist === "failed" ? "none" : persist,
  });
}

export async function handleRequest(request, env = {}, ctx = {}) {
  if (request.method === "OPTIONS") return corsPreflight();
  const url = new URL(request.url);
  const path = stripPrefix(url.pathname);

  try {
    if (path === "/health") {
      const configured = hasSaConfigured(env);
      const saToken = configured ? await saAccessToken(env) : "";
      return json({
        ok: true,
        service: "naluno-economy",
        version: VERSION,
        adminAuth: "password",
        hasServiceAccount: configured,
        hasWebApiKey: !!apiKey(env),
        hasInbox: !!(mailInbox(env) && looksLikeEmail(mailInbox(env))),
        persist: saToken ? "firestore-sa" : "user-token",
        saError: saToken ? "" : saCache.err || "",
      });
    }

    const saToken = hasSaConfigured(env) ? await saAccessToken(env) : "";

    if (path === "/v1/flags") {
      const token = bearer(request);
      const user = token ? await verifyIdToken(env, token) : null;
      const got = await readFlags(env, saToken, token);
      return json({
        ok: true,
        flags: got.flags,
        degraded: false,
        persist: saToken ? "firestore-sa" : "user-token",
        source: got.source,
        operator: !!(user && isOperatorUser(env, user)),
      });
    }

    if (path.startsWith("/v1/value/")) {
      const id = decodeURIComponent(path.slice("/v1/value/".length));
      return json({
        ok: true,
        broadcast_id: id,
        community_value: 0,
        is_monetary: false,
      });
    }

    if (path === "/v1/mail" && request.method === "POST") {
      return handleMail(request, env, saToken);
    }

    const auth = await requireUser(env, request);
    if (auth.error) {
      if (path === "/" || path.startsWith("/v1/")) return auth.error;
      return auth.error;
    }
    const { user, token: userToken } = auth;

    if (path === "/v1/events" && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      const eventType = String(body.event_type || "");
      const eventId = String(body.event_id || "").slice(0, 80) || ("evt_" + Date.now());
      if (memory.events.has(eventId)) {
        return json({ ok: true, duplicate: true, event_id: eventId, persist: persistMode(!!saToken, ["memory"]) });
      }
      const scored = scoreEvent(eventType, body.text);
      const row = {
        event_id: eventId,
        ledger_id: "led_" + eventId.replace(/^evt_/, ""),
        user_id: user.uid,
        event_type: eventType,
        target_type: String(body.target_type || ""),
        target_id: String(body.target_id || ""),
        broadcast_id: String(body.broadcast_id || ""),
        parent_event_id: body.parent_event_id || "",
        creator_uid: String(body.creator_uid || ""),
        session_id: String(body.session_id || ""),
        text: typeof body.text === "string" ? body.text.slice(0, 2000) : "",
        client_ts: Number(body.client_ts) || Date.now(),
        ts: Date.now(),
        points: scored.points,
        eligible_points: scored.eligible,
        status: scored.status,
        reason: scored.reason,
      };
      const paths = await persistEvent(env, userToken, saToken, row);
      return json({
        ok: true,
        event_id: eventId,
        status: scored.status,
        persist: persistMode(!!saToken, paths),
      });
    }

    if (path === "/v1/me" && request.method === "GET") {
      const p = profileOf(user.uid);
      let trust = "NEW";
      if (p.events >= 20) trust = "HIGH";
      else if (p.events >= 5) trust = "MEDIUM";
      else if (p.events >= 1) trust = "LOW";
      return json({
        ok: true,
        contribution_points: p.total_points,
        eligible_contribution: p.eligible_points,
        contribution_trust: trust,
        persist: saToken ? "firestore-sa" : "user-token",
      });
    }

    if (path === "/v1/presence" && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      const now = Date.now();
      memory.presence.set(user.uid, { uid: user.uid, at: now, platform: body.platform || "", reason: body.reason || "" });
      if (userToken) {
        await fsFetch(env, userToken, "PATCH", "/users/" + encodeURIComponent(user.uid), toFsFields({
          lastSeen: now,
          lastPlatform: body.platform || "",
          lastAppVersion: body.app_version || "",
          lastPresenceReason: body.reason || "beat",
        }));
      }
      if (saToken) {
        await fsFetch(env, saToken, "PATCH", "/presence/" + encodeURIComponent(user.uid), toFsFields({
          uid: user.uid, at: now, platform: body.platform || "",
        }));
      }
      return json({ ok: true });
    }

    if (path === "/v1/report" && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      const reason = String(body.reason || "").trim();
      const code = String(body.reason_code || "other");
      if (reason.length < 10) return json({ ok: false, error: "Please say a little more — at least a sentence." }, 400);
      if (!REPORT_CODES[code]) return json({ ok: false, error: "Unknown reason" }, 400);
      const id = String(body.report_id || ("rep_" + Date.now())).slice(0, 80);
      const doc = {
        report_id: id,
        reporter_uid: user.uid,
        target_type: String(body.target_type || ""),
        target_id: String(body.target_id || ""),
        target_user_id: String(body.target_user_id || ""),
        broadcast_id: String(body.broadcast_id || ""),
        reason_code: code,
        reason,
        status: "OPEN",
        ts: Date.now(),
      };
      memory.reports.set(id, doc);
      const token = userToken;
      await fsFetch(env, token, "PATCH", "/reports/" + encodeURIComponent(id), toFsFields(doc));
      return json({ ok: true, report_id: id });
    }

    if (path === "/v1/support/intent" && request.method === "POST") {
      return json({ ok: false, error: "Support isn’t available yet" }, 400);
    }

    if (path.startsWith("/v1/admin/")) {
      return handleAdmin(env, request, path, url, user, userToken, saToken);
    }

    return json({ ok: false, error: "Missing auth token" }, 401);
  } catch (e) {
    return json({ ok: false, error: (e && e.message) || "internal" }, 500);
  }
}
