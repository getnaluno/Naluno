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

import {
  judgeScreenPayload,
  listingFromScreen,
} from "./screen.mjs";
import {
  scorePublicText,
  scoreBehaviour,
  matchKnownHash,
  combineRisk,
  buildCase,
  buildAudit,
  assertAuditAppend,
  decideHuman,
  buildAppeal,
  applyAppeal,
  isPrivateSurface,
  applySafetyEvent,
  emptyLedger,
  fingerprintPublic,
  observeCluster,
  weighReports,
  safetyOverview,
  scrubCase,
  statementFor,
} from "./safety.mjs";

export const VERSION = "2.6.9-safety";
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
  terrorism: 1, recruitment: 1, child_exploitation: 1,
  sexual_exploitation: 1, fraud: 1, dangerous: 1, illegal: 1,
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
  reserved: new Map(),
  handleFlags: new Map(),
  handles: new Map(),
  safetyCases: new Map(),
  safetyAudit: [],
  safetyAppeals: new Map(),
  safetyLedgers: new Map(),
  safetyClusters: {},
  safetyBirths: new Map(),
  safetyPrints: new Map(),
  safetyReportHits: [],
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
  memory.reserved.clear();
  memory.handleFlags.clear();
  memory.handles.clear();
  memory.safetyCases.clear();
  memory.safetyAudit = [];
  memory.safetyAppeals.clear();
  memory.safetyLedgers.clear();
  memory.safetyClusters = {};
  memory.safetyBirths.clear();
  memory.safetyPrints.clear();
  memory.safetyReportHits = [];
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

/* Atomic field increments, done by Firestore itself.
   Every total in this worker used to be a read-modify-write from `memory`,
   an in-memory Map inside one Cloudflare isolate. Isolates are recycled
   constantly, so a fresh one started a person at ZERO and then wrote that
   back over their real lifetime total. Someone on 500 points who left a
   comment could be written down to 3. Points were being destroyed quietly,
   over and over, and reward simulations were computed from whatever little
   happened to be in that isolate's memory.
   An increment transform has no read step and no memory, so it cannot lose
   what it never held. */
async function fsIncrement(env, token, docPath, fields, setFields) {
  if (!token) return { ok: false };
  // Firestore's commit API wants the RESOURCE name
  // ("projects/x/databases/(default)/documents/..."), not the URL.
  const name = fsRoot(env).replace("https://firestore.googleapis.com/v1/", "") + docPath;
  const transforms = Object.keys(fields).map((k) => ({
    fieldPath: k,
    increment: { integerValue: String(Math.round(Number(fields[k]) || 0)) },
  }));
  const writes = [];
  if (setFields && Object.keys(setFields).length) {
    writes.push({
      update: { name, fields: toFsFields(setFields).fields },
      updateMask: { fieldPaths: Object.keys(setFields) },
    });
  }
  writes.push({ transform: { document: name, fieldTransforms: transforms } });
  const res = await _fetch(fsRoot(env) + ":commit", {
    method: "POST",
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify({ writes }),
  });
  return { ok: res.ok, status: res.status };
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
    // Totals move by increments so a cold isolate cannot write a person's
    // lifetime score back down to whatever it has seen since it started.
    await fsIncrement(env, saToken, "/contributionProfiles/" + encodeURIComponent(row.user_id), {
      total_points: Number(row.points) || 0,
      eligible_points: Number(row.eligible_points) || 0,
      events: 1,
    }, { user_id: row.user_id, updated_at: row.ts });
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

const HANDLE_RESERVED_MSG = "This handle is reserved and cannot be claimed.";
const HANDLE_TAKEN_MSG = "That handle is taken — try another.";
const HANDLE_FORMAT_MSG = "Choose a handle with at least 3 letters (a–z, 0–9, _).";
export const SEED_RESERVED = [
  { handle: "naluno", category: "official", reason: "Brand" },
  { handle: "getnaluno", category: "official", reason: "Brand" },
  { handle: "nalunoapp", category: "official", reason: "Brand" },
  { handle: "nalunohq", category: "official", reason: "Brand" },
  { handle: "nalunoofficial", category: "official", reason: "Brand" },
  { handle: "nalunoteam", category: "official", reason: "Brand" },
  { handle: "nalunofounder", category: "official", reason: "Brand" },
  { handle: "nalunocreators", category: "official", reason: "Brand" },
  { handle: "nalunoinvest", category: "official", reason: "Brand" },
  { handle: "nalunosupport", category: "support", reason: "Support" },
  { handle: "nalunohelp", category: "support", reason: "Support" },
  { handle: "nalunonews", category: "support", reason: "Support" },
  { handle: "admin", category: "system", reason: "System" },
  { handle: "administrator", category: "system", reason: "System" },
  { handle: "nalunoadmin", category: "system", reason: "System" },
  { handle: "nalunosystem", category: "system", reason: "System" },
  { handle: "nalunosecurity", category: "system", reason: "System" },
  { handle: "nalunomoderator", category: "system", reason: "System" },
  { handle: "nalunostaff", category: "system", reason: "System" },
  { handle: "official", category: "system", reason: "System" },
  { handle: "support", category: "support", reason: "Support" },
  { handle: "security", category: "system", reason: "System" },
  { handle: "system", category: "system", reason: "System" },
  { handle: "moderator", category: "system", reason: "System" },
];

export function normHandle(raw) {
  return String(raw || "")
    .trim()
    .replace(/^@+/, "")
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "")
    .slice(0, 24);
}
export function handleCore(raw) {
  return normHandle(raw).replace(/_/g, "");
}
function handleFormatOk(h) {
  return /^[a-z0-9_]{3,24}$/.test(h);
}
function foldLookalikes(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/0/g, "o")
    .replace(/1/g, "l")
    .replace(/i/g, "l")
    .replace(/3/g, "e")
    .replace(/5/g, "s")
    .replace(/8/g, "b")
    .replace(/_/g, "");
}
function levenshtein(a, b) {
  a = String(a || "");
  b = String(b || "");
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const row = [];
  for (let j = 0; j <= b.length; j++) row[j] = j;
  for (let i = 1; i <= a.length; i++) {
    let prev = i - 1;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cur = row[j];
      const cost = a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1;
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + cost);
      prev = cur;
    }
  }
  return row[b.length];
}
export function matchReserved(raw, list) {
  const h = normHandle(raw);
  const core = handleCore(h);
  for (let i = 0; i < (list || []).length; i++) {
    const row = list[i] || {};
    const rh = normHandle(row.handle || row.id || "");
    if (!rh) continue;
    if (h === rh || core === handleCore(rh) || core === String(row.core || "")) return row;
  }
  return null;
}
export function similarityAgainst(raw, list) {
  if (matchReserved(raw, list)) return null;
  const h = normHandle(raw);
  const core = handleCore(h);
  const folded = foldLookalikes(h);
  if (core.length < 3) return null;
  let best = null;
  for (let i = 0; i < (list || []).length; i++) {
    const row = list[i] || {};
    const rh = normHandle(row.handle || row.id || "");
    if (!rh) continue;
    const rc = handleCore(rh);
    const rf = foldLookalikes(rh);
    if (h === rh || core === rc) continue;
    let reason = "";
    let score = 0;
    if (folded === rf) { reason = "lookalike characters"; score = 90; }
    else if (core.indexOf(rc) === 0 && rc.length >= 5 && /^[0-9]+$/.test(core.slice(rc.length))) {
      reason = "protected name plus numbers"; score = 80;
    } else if (rc.length >= 5 && core.indexOf(rc) >= 0) {
      reason = "contains a protected name"; score = 75;
    } else if (rf.length >= 5 && folded.indexOf(rf) >= 0) {
      reason = "contains a protected name"; score = 72;
    } else if (rc.length >= 5 && levenshtein(core, rc) === 1) {
      reason = "one character from a protected name"; score = 70;
    } else if (rf.length >= 5 && levenshtein(folded, rf) === 1) {
      reason = "one character from a protected name"; score = 68;
    }
    if (reason && (!best || score > best.score)) {
      best = { handle: h, reserved: rh, category: row.category || "other", reason, score };
    }
  }
  return best;
}

function reservedList() {
  return Array.from(memory.reserved.values());
}
function canonicalReserved() {
  return reservedList()
    .filter((r) => !r.aliasOf)
    .sort((a, b) => String(a.handle || "").localeCompare(String(b.handle || "")));
}
function rememberReserved(row) {
  if (!row || !row.handle) return;
  memory.reserved.set(row.handle, row);
}
function rememberFlag(row) {
  if (!row) return;
  const id = row.id || ("f_" + String(row.handle || "") + "_" + String(row.uid || "").slice(0, 8));
  row.id = id;
  memory.handleFlags.set(id, row);
}

async function fsGetDoc(env, token, path) {
  const r = token
    ? await fsFetch(env, token, "GET", path)
    : await fsFetchPublic(env, "GET", path);
  if (!r.ok) return null;
  return fromFsDoc(r.data);
}
async function fsPutDoc(env, token, path, obj) {
  if (!token) return { ok: false };
  const keys = Object.keys(obj || {}).filter((k) => obj[k] !== undefined);
  if (!keys.length) return { ok: false };
  const mask = keys.map((k) => "updateMask.fieldPaths=" + encodeURIComponent(k)).join("&");
  const suffix = path.includes("?") ? "&" : "?";
  return fsFetch(env, token, "PATCH", path + suffix + mask, toFsFields(obj));
}
async function loadReservedFromFs(env, token) {
  const t = token;
  if (!t && !apiKey(env)) return reservedList();
  const r = t
    ? await fsFetch(env, t, "GET", "/reservedHandles?pageSize=400")
    : await fsFetchPublic(env, "GET", "/reservedHandles?pageSize=400");
  if (r.ok && r.data && r.data.documents) {
    r.data.documents.forEach((doc) => rememberReserved(fromFsDoc(doc)));
  }
  return reservedList();
}
function reservedPayload(row, actor, now) {
  const handle = normHandle(row.handle);
  const core = handleCore(handle);
  return {
    handle,
    core,
    category: ["official", "system", "support", "other"].indexOf(row.category) >= 0 ? row.category : "other",
    reason: String(row.reason || "").slice(0, 240),
    status: "reserved",
    holderUid: String(row.holderUid || "").slice(0, 80),
    createdAt: Number(row.createdAt) || now,
    createdBy: row.createdBy || actor || "",
    updatedAt: now,
    updatedBy: actor || "",
  };
}
async function writeReservedPair(env, token, row) {
  const handle = row.handle;
  const core = row.core || handleCore(handle);
  rememberReserved(row);
  if (!token) return;
  await fsPutDoc(env, token, "/reservedHandles/" + encodeURIComponent(handle), row);
  if (core) {
    await fsPutDoc(env, token, "/reservedCores/" + encodeURIComponent(core), {
      handle,
      core,
      holderUid: row.holderUid || "",
      category: row.category,
    });
  }
  if (core && core !== handle) {
    const alias = Object.assign({}, row, { handle: core, aliasOf: handle });
    await fsPutDoc(env, token, "/reservedHandles/" + encodeURIComponent(core), alias);
    rememberReserved(alias);
  }
}
async function deleteReservedPair(env, token, handle) {
  const h = normHandle(handle);
  const row = memory.reserved.get(h);
  const core = (row && row.core) || handleCore(h);
  memory.reserved.delete(h);
  if (core && core !== h) memory.reserved.delete(core);
  if (!token) return;
  await fsFetch(env, token, "DELETE", "/reservedHandles/" + encodeURIComponent(h));
  if (core) {
    await fsFetch(env, token, "DELETE", "/reservedCores/" + encodeURIComponent(core));
    if (core !== h) await fsFetch(env, token, "DELETE", "/reservedHandles/" + encodeURIComponent(core));
  }
}
async function writeAdminAudit(env, token, row) {
  const rec = Object.assign({ created_at: Date.now() }, row);
  memory.audit.unshift(rec);
  if (token) {
    await fsFetch(env, token, "POST", "/adminAudit", toFsFields(rec));
  }
}
async function loadHandleFlagsFromFs(env, token) {
  if (!token) return Array.from(memory.handleFlags.values());
  const r = await fsFetch(env, token, "GET", "/handleFlags?pageSize=200");
  if (r.ok && r.data && r.data.documents) {
    r.data.documents.forEach((doc) => rememberFlag(fromFsDoc(doc)));
  }
  return Array.from(memory.handleFlags.values());
}
async function flagHandle(env, token, flag) {
  const id = flag.id || ((flag.kind === "reserved-block" ? "b_" : "f_") + String(flag.handle || "") + "_" + String(flag.uid || "").slice(0, 8));
  const row = Object.assign({ id, status: "open", createdAt: Date.now() }, flag);
  rememberFlag(row);
  if (token) await fsPutDoc(env, token, "/handleFlags/" + encodeURIComponent(id), row);
  return row;
}
async function seedReserved(env, token, actor) {
  const now = Date.now();
  await loadReservedFromFs(env, token);
  const owner = await fsGetDoc(env, token, "/handles/naluno");
  const holder = (owner && owner.uid) || "";
  let wrote = 0;
  for (let i = 0; i < SEED_RESERVED.length; i++) {
    const seed = SEED_RESERVED[i];
    const existing = memory.reserved.get(seed.handle);
    if (existing && existing.handle) {
      if (seed.handle === "naluno" && holder && !existing.holderUid) {
        const next = Object.assign({}, existing, { holderUid: holder, updatedAt: now, updatedBy: actor || "seed" });
        await writeReservedPair(env, token, next);
        wrote += 1;
      }
      continue;
    }
    const row = reservedPayload(Object.assign({}, seed, {
      holderUid: seed.handle === "naluno" ? holder : "",
      createdBy: actor || "seed",
    }), actor || "seed", now);
    await writeReservedPair(env, token, row);
    wrote += 1;
  }
  return { ok: true, wrote, total: memory.reserved.size, nalunoHolder: holder };
}

async function handleCheck(env, url, saToken) {
  const h = normHandle(url.searchParams.get("h") || url.searchParams.get("handle") || "");
  if (!handleFormatOk(h)) {
    return json({ ok: false, handle: h, error: HANDLE_FORMAT_MSG, code: "format" });
  }
  await loadReservedFromFs(env, saToken);
  if (!memory.reserved.size) {
    SEED_RESERVED.forEach((s) => rememberReserved(reservedPayload(s, "seed", Date.now())));
  }
  const list = reservedList();
  const hit = matchReserved(h, list);
  if (hit) {
    return json({
      ok: false,
      handle: h,
      reserved: true,
      error: HANDLE_RESERVED_MSG,
      code: "reserved",
    });
  }
  const claimed = await fsGetDoc(env, saToken, "/handles/" + encodeURIComponent(h));
  const taken = !!(claimed && claimed.uid);
  if (taken) {
    return json({ ok: false, handle: h, taken: true, error: HANDLE_TAKEN_MSG, code: "taken" });
  }
  return json({
    ok: true,
    handle: h,
    available: true,
  });
}

async function handleClaim(env, user, userToken, saToken, body) {
  const h = normHandle(body && body.handle);
  if (!handleFormatOk(h)) return json({ ok: false, error: HANDLE_FORMAT_MSG, code: "format" }, 400);
  const token = saToken || userToken;
  await loadReservedFromFs(env, token);
  if (!memory.reserved.size) {
    SEED_RESERVED.forEach((s) => rememberReserved(reservedPayload(s, "seed", Date.now())));
  }
  const list = reservedList();
  const hit = matchReserved(h, list);
  if (hit && String(hit.holderUid || "") !== user.uid) {
    await flagHandle(env, token, {
      kind: "reserved-block",
      handle: h,
      uid: user.uid,
      reserved: hit.handle || h,
      reason: "reserved",
      score: 100,
      status: "open",
    });
    return json({ ok: false, error: HANDLE_RESERVED_MSG, code: "reserved", reserved: true }, 409);
  }
  const existing = memory.handles.get(h) || await fsGetDoc(env, token, "/handles/" + encodeURIComponent(h));
  if (existing && existing.uid && existing.uid !== user.uid) {
    return json({ ok: false, error: HANDLE_TAKEN_MSG, code: "taken", taken: true }, 409);
  }
  const doc = { uid: user.uid, claimedAt: Date.now() };
  memory.handles.set(h, doc);
  if (token) {
    const path = "/handles/" + encodeURIComponent(h);
    if (existing && existing.uid === user.uid) {
      await fsPutDoc(env, token, path, doc);
    } else {
      const wrote = await fsFetch(env, token, "PATCH", path + "?currentDocument.exists=false", toFsFields(doc));
      if (!wrote.ok) {
        const again = await fsGetDoc(env, token, path);
        if (again && again.uid && again.uid !== user.uid) {
          memory.handles.set(h, again);
          return json({ ok: false, error: HANDLE_TAKEN_MSG, code: "taken", taken: true }, 409);
        }
        if (!again || !again.uid) await fsPutDoc(env, token, path, doc);
      }
    }
  }
  const similar = similarityAgainst(h, list);
  if (similar) {
    await flagHandle(env, token, {
      kind: "similar",
      handle: h,
      uid: user.uid,
      reserved: similar.reserved,
      reason: similar.reason,
      score: similar.score,
      status: "open",
    });
  }
  return json({ ok: true, handle: h, official: !!(hit && hit.holderUid === user.uid) });
}

export function reportIsOpen(r) {
  if (!r) return false;
  if (r.resolvedAt || r.decided_at || r.resolved_at || r.decidedAt) return false;
  const st = String(r.status || "").trim().toUpperCase().replace(/[_-]+/g, " ");
  if (st === "ACTIONED" || st === "DISMISSED" || st === "CLOSED" || st === "DONE"
      || st === "RESOLVED" || st === "REJECTED" || st === "TAKEN DOWN") {
    return false;
  }
  if (st && st !== "OPEN" && st !== "NEW" && st !== "UNDER REVIEW" && st !== "PENDING") {
    return false;
  }
  return true;
}

async function hideBroadcastSexual(env, saToken, userToken, broadcastId) {
  const id = String(broadcastId || "").slice(0, 80);
  if (!id) return { ok: false };
  const token = saToken || userToken;
  const patch = {
    hidden: true,
    listed: false,
    held: false,
    hiddenReason: "sexual",
    hiddenAt: Date.now(),
    hiddenBy: "report",
    live: false,
  };
  if (saToken) await fsPutDoc(env, saToken, "/broadcasts/" + encodeURIComponent(id), patch);
  const row = await fsGetDoc(env, token, "/broadcasts/" + encodeURIComponent(id));
  const uid = row && row.creatorUid;
  let restricted = false;
  if (uid && saToken) {
    const profile = await fsGetDoc(env, saToken, "/users/" + encodeURIComponent(uid));
    const n = Number((profile && profile.sexualReports) || 0) + 1;
    const extra = { sexualReports: n, updatedAt: Date.now() };
    if (n >= 3) {
      extra.restricted = true;
      extra.restrictedReason = "Repeated sexual-content reports";
      extra.restrictedAt = Date.now();
      restricted = true;
    }
    await fsPutDoc(env, saToken, "/users/" + encodeURIComponent(uid), extra);
  }
  return { ok: true, id, restricted };
}

function hashList(env) {
  const raw = env && (env.SAFETY_HASHES || env.SAFETY_HASH_LIST) || "";
  if (!raw) return [];
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
async function persistSafetyCase(env, saToken, userToken, row) {
  memory.safetyCases.set(row.case_id, row);
  const token = saToken || userToken;
  if (!token) return "memory";
  const wrote = await fsPutDoc(env, token, "/safetyCases/" + encodeURIComponent(row.case_id), row);
  return wrote && wrote.ok ? (saToken ? "firestore-sa" : "user-token") : "memory";
}
async function persistSafetyAudit(env, saToken, userToken, row) {
  assertAuditAppend(memory.safetyAudit, row);
  memory.safetyAudit.unshift(row);
  if (memory.safetyAudit.length > 400) memory.safetyAudit.length = 400;
  const token = saToken || userToken;
  if (!token) return "memory";
  const wrote = await fsPutDoc(env, token, "/safetyAudit/" + encodeURIComponent(row.audit_id), row);
  return wrote && wrote.ok ? (saToken ? "firestore-sa" : "user-token") : "memory";
}
function safetyHold(decision) {
  return decision === "REVIEW" || decision === "REMOVE" || decision === "ESCALATE" || decision === "AGE_RESTRICT" || decision === "REGION_RESTRICT";
}
async function openHeldCase(env, saToken, userToken, fields, why, detectedBy) {
  const opened = buildCase(fields);
  await persistSafetyCase(env, saToken, userToken, opened);
  await persistSafetyAudit(env, saToken, userToken, buildAudit({
    case_id: opened.case_id,
    who: fields.reporter_id || "system",
    what: detectedBy === "report" ? "report-opened" : "held-public",
    why: String(why || opened.priority).slice(0, 180),
    detected_by: detectedBy || "classifier",
    human_reviewed: false,
    action_taken: opened.priority === "URGENT" ? "urgent queue" : "case opened",
  }));
  return opened;
}
function safetyQueue() {
  return Array.from(memory.safetyCases.values())
    .sort(function (a, b) {
      const rank = { URGENT: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
      return (rank[a.priority] ?? 4) - (rank[b.priority] ?? 4) || (b.created_at || 0) - (a.created_at || 0);
    });
}

async function placeBroadcast(env, user, userToken, saToken, body) {
  const id = String((body && body.broadcast_id) || "").slice(0, 80);
  if (!id) return json({ ok: false, error: "broadcast_id required" }, 400);
  const token = saToken || userToken;
  const row = await fsGetDoc(env, token, "/broadcasts/" + encodeURIComponent(id));
  if (!row) return json({ ok: false, error: "missing" }, 404);
  if (row.creatorUid && row.creatorUid !== user.uid && !isOperatorUser(env, user)) {
    return json({ ok: false, error: "not yours" }, 403);
  }
  const profile = await fsGetDoc(env, token, "/users/" + encodeURIComponent(row.creatorUid || user.uid));
  const trusted = !!(profile && profile.trustedPublisher)
    && !(profile && profile.restricted)
    && !(profile && profile.suspended);
  const judged = judgeScreenPayload(body && body.screen, { title: row.title || "" });
  const safety = scorePublicText(
    [row.title, row.caption, body && body.caption, body && body.title].filter(Boolean).join(" \n "),
    { surface: "broadcast" },
  );
  const listing = listingFromScreen({
    trusted,
    hidden: !!row.hidden,
    hasScreen: judged.hasScreen,
    decision: judged.decision,
  });
  const patch = Object.assign({}, listing, {
    screenDecision: judged.decision,
    screenScore: judged.score || 0,
    screenReason: judged.reason || "",
    screenVersion: 1,
    screenFrames: judged.frames || 0,
    safetyScore: safety.score,
    safetyDecision: safety.decision,
    safetyUrgent: !!safety.urgent,
    updatedAt: Date.now(),
  });
  let safetyCase = "";
  if (safetyHold(safety.decision)) {
    patch.listed = false;
    patch.held = true;
    patch.heldReason = safety.decision === "AGE_RESTRICT"
      ? "age-review"
      : (safety.urgent ? "safety-urgent" : "safety-review");
    const opened = await openHeldCase(env, saToken, userToken, {
      reporter_id: "system",
      reported_user_id: row.creatorUid || user.uid,
      content_id: id,
      content_type: "broadcast",
      surface: "broadcast",
      reason_code: safety.urgent ? "terrorism" : (safety.decision === "AGE_RESTRICT" ? "sexual" : "dangerous"),
      evidence_reference: "broadcast:" + id,
      result: safety,
      contents_collected: true,
    }, safety.decision + " " + safety.score, "classifier");
    safetyCase = opened.case_id;
  }
  if (row.hidden) {
    patch.listed = false;
    patch.held = false;
    patch.hidden = true;
  }
  const writeTok = saToken || ((patch.hidden || judged.decision === "block") ? userToken : "");
  if (writeTok) await fsPutDoc(env, writeTok, "/broadcasts/" + encodeURIComponent(id), patch);
  return json({
    ok: true,
    listed: !!patch.listed,
    held: !!patch.held,
    hidden: !!patch.hidden,
    heldReason: patch.heldReason || "",
    screen: judged.decision,
    screenScore: judged.score || 0,
    safety: safety.decision,
    safetyScore: safety.score,
    safetyUrgent: !!safety.urgent,
    safety_case: safetyCase,
    statement: statementFor(safety),
  });
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
  const inner = (doc._consoleGate && typeof doc._consoleGate === "object")
    ? doc._consoleGate
    : doc;
  if (inner.v === 2 && inner.hash && inner.salt) return inner;
  if (inner.hash) return inner.v === 2 ? inner : String(inner.hash);
  return null;
}
function recKey(rec) {
  if (!rec) return "";
  if (typeof rec === "string") return "s:" + rec;
  return "v" + String(rec.v || "") + ":" + String(rec.salt || "") + ":" + String(rec.hash || "");
}
async function collectPasswordRecords(env, uid, saToken, userToken) {
  const out = [];
  const seen = new Set();
  function add(rec) {
    if (!rec) return;
    const k = recKey(rec);
    if (!k || seen.has(k)) return;
    seen.add(k);
    out.push(rec);
  }
  if (uid && memory.passwords.has(uid)) add(memory.passwords.get(uid));
  if (!uid) return out;
  const attempts = [];
  if (saToken) {
    attempts.push([saToken, "/adminCredentials/" + encodeURIComponent(uid)]);
    attempts.push([saToken, "/adminConsole/" + encodeURIComponent(uid)]);
  }
  if (userToken) {
    attempts.push([userToken, "/users/" + encodeURIComponent(uid) + "/vault/main"]);
    attempts.push([userToken, "/adminConsole/" + encodeURIComponent(uid)]);
    attempts.push([userToken, "/users/" + encodeURIComponent(uid) + "/consoleGate/main"]);
  }
  for (let i = 0; i < attempts.length; i++) {
    try {
      const r = await fsFetch(env, attempts[i][0], "GET", attempts[i][1]);
      if (!r.ok) continue;
      add(recordFromDoc(fromFsDoc(r.data)));
    } catch {
      /* try next */
    }
  }
  return out;
}
async function matchPasswordRecord(recs, uid, password) {
  if (!password) return null;
  for (let i = 0; i < recs.length; i++) {
    try {
      if (await passwordMatches(recs[i], uid, password)) return recs[i];
    } catch {
      /* try next copy */
    }
  }
  return null;
}
async function loadPasswordRecord(env, uid, saToken, userToken) {
  const recs = await collectPasswordRecords(env, uid, saToken, userToken);
  if (!recs.length) return null;
  const rec = recs[0];
  if (uid && rec) memory.passwords.set(uid, rec);
  return rec;
}
async function persistPasswordRecord(env, uid, rec, saToken, userToken) {
  memory.passwords.set(uid, rec);
  const flat = typeof rec === "string"
    ? { hash: rec, v: 1, kind: "console-gate", updated_at: Date.now() }
    : Object.assign({}, rec, { kind: "console-gate", updated_at: rec.updated_at || Date.now() });
  if (saToken) {
    const r = await fsPutDoc(env, saToken, "/adminCredentials/" + encodeURIComponent(uid), flat);
    if (r && r.ok) return "firestore-sa";
  }
  if (userToken) {
    /* Vault is owner-writable. adminConsole is denied to every browser. */
    const v = await fsPutDoc(env, userToken, "/users/" + encodeURIComponent(uid) + "/vault/main", {
      _consoleGate: flat,
    });
    if (v && v.ok) return "user-token";
    const a = await fsPutDoc(env, userToken, "/adminConsole/" + encodeURIComponent(uid), flat);
    if (a && a.ok) return "user-token";
  }
  return "memory";
}

async function handleAdmin(env, request, path, url, user, userToken, saToken) {
  if (!isOperatorUser(env, user)) return json({ ok: false, error: "not an operator" }, 403);
  const adminPass = request.headers.get("X-Naluno-Admin") || "";
  const recs = await collectPasswordRecords(env, user.uid, saToken, userToken);
  const stored = recs[0] || null;
  const openPath = path === "/v1/admin/status" || path === "/v1/admin/password" || path === "/v1/admin/unlock";
  if (!openPath && stored) {
    if (!adminPass) return json({ ok: false, error: "console password required" }, 401);
    if (!(await matchPasswordRecord(recs, user.uid, adminPass))) {
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
    return json({
      ok: true,
      operator: true,
      uid: user.uid,
      hasPassword: recs.length > 0,
      persist: saToken ? "firestore-sa" : "user-token",
      version: VERSION,
      claim: stamped ? "operator" : "",
    });
  }

  if (path === "/v1/admin/safety" && request.method === "GET") {
    const q = (url.searchParams.get("q") || "").toLowerCase();
    const status = (url.searchParams.get("status") || "").toLowerCase();
    const priority = (url.searchParams.get("priority") || "").toUpperCase();
    const from = Number(url.searchParams.get("from") || 0);
    const to = Number(url.searchParams.get("to") || 0);
    const all = safetyQueue();
    let rows = all;
    if (q) {
      rows = rows.filter(function (c) {
        return [c.case_id, c.content_id, c.reported_user_id, c.reporter_id, c.reason_code, c.priority, c.report_id, c.decision, c.review_status]
          .join(" ").toLowerCase().includes(q);
      });
    }
    if (status === "open") rows = rows.filter(function (c) { return c.review_status !== "decided"; });
    else if (status === "decided") rows = rows.filter(function (c) { return c.review_status === "decided"; });
    else if (status === "review") rows = rows.filter(function (c) { return c.review_status === "review" || c.appeal_status === "open"; });
    if (priority) rows = rows.filter(function (c) { return c.priority === priority; });
    if (from) rows = rows.filter(function (c) { return (c.created_at || 0) >= from; });
    if (to) rows = rows.filter(function (c) { return (c.created_at || 0) <= to; });
    const overview = safetyOverview(all, Array.from(memory.safetyAppeals.values()));
    return json({
      ok: true,
      version: VERSION,
      open: overview.open_cases,
      urgent: overview.urgent,
      overview: overview,
      repeat_offenders: overview.repeat,
      cases: rows.slice(0, 120).map(scrubCase),
      behaviour: all.filter(function (c) {
        return c && (c.content_type === "account" || c.surface === "behaviour");
      }).slice(0, 40).map(scrubCase),
      audit: memory.safetyAudit.slice(0, 40).map(function (row) {
        const copy = Object.assign({}, row);
        delete copy.body;
        delete copy.message;
        delete copy.public_text;
        return copy;
      }),
      appeals: Array.from(memory.safetyAppeals.values()).slice(0, 40),
      private_read: false,
      auto_ban: false,
    });
  }

  if (path === "/v1/admin/safety/decide" && request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    const id = String(body.case_id || "");
    const row = memory.safetyCases.get(id);
    if (!row) return json({ ok: false, error: "case not found" }, 404);
    let next;
    try {
      next = decideHuman(row, body.action, user.uid, body.why || "");
    } catch (e) {
      return json({ ok: false, error: (e && e.message) || "decision rejected" }, 400);
    }
    await persistSafetyCase(env, saToken, userToken, next);
    const audit = buildAudit({
      case_id: id,
      who: user.uid,
      what: "human-decision",
      why: body.why || next.decision,
      detected_by: "human",
      human_reviewed: true,
      action_taken: next.decision,
    });
    await persistSafetyAudit(env, saToken, userToken, audit);
    const token = saToken || userToken;
    const bid = row.content_id;
    const isBroadcast = row.content_type === "broadcast" || row.surface === "broadcast";
    if (token && bid && isBroadcast) {
      if (next.decision === "REMOVE") {
        await fsPutDoc(env, token, "/broadcasts/" + encodeURIComponent(bid), {
          hidden: true, listed: false, held: false, hiddenReason: "safety", heldReason: "", updatedAt: Date.now(),
        });
      } else if (next.decision === "ALLOW" || next.decision === "RESTORE" || next.decision === "DISMISS") {
        await fsPutDoc(env, token, "/broadcasts/" + encodeURIComponent(bid), {
          hidden: false, listed: true, held: false, heldReason: "", updatedAt: Date.now(),
        });
      } else if (next.decision === "AGE_RESTRICT" || next.decision === "REGION_RESTRICT" || next.decision === "RESTRICT" || next.decision === "ESCALATE") {
        await fsPutDoc(env, token, "/broadcasts/" + encodeURIComponent(bid), {
          hidden: false,
          listed: false,
          held: true,
          heldReason: next.decision === "AGE_RESTRICT" ? "age-review" : "safety-review",
          updatedAt: Date.now(),
        });
      }
    }
    const who = row.reported_user_id;
    if (token && who && (next.decision === "SUSPEND" || next.decision === "RESTRICT")) {
      await fsPutDoc(env, token, "/users/" + encodeURIComponent(who), {
        suspended: next.decision === "SUSPEND",
        restricted: true,
        permanentBan: false,
        restrictedReason: String(body.why || "safety review").slice(0, 180),
        restrictedAt: Date.now(),
      });
    }
    if (token && who && row.content_type === "account" && (next.decision === "ALLOW" || next.decision === "RESTORE" || next.decision === "DISMISS")) {
      await fsPutDoc(env, token, "/users/" + encodeURIComponent(who), {
        suspended: false,
        restricted: false,
        permanentBan: false,
        restrictedReason: "",
      });
    }
    return json({ ok: true, case: scrubCase(next), audit_id: audit.audit_id, auto_ban: false, permanent_ban: false });
  }

  if (path === "/v1/admin/unlock" && request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    const pass = String(body.password || adminPass || "").trim();
    if (!recs.length) return json({ ok: true, setup: true, hasPassword: false });
    const matched = await matchPasswordRecord(recs, user.uid, pass);
    if (!matched) {
      return json({ ok: false, error: "console password not accepted" }, 401);
    }
    memory.passwords.set(user.uid, matched);
    return json({ ok: true, hasPassword: true });
  }

  if (path === "/v1/admin/password" && request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    const next = String(body.next_password || "").trim();
    if (next.length < 8) return json({ ok: false, error: "Use at least 8 characters" }, 400);
    if (recs.length) {
      const current = String(body.current_password || adminPass || "").trim();
      if (!current || !(await matchPasswordRecord(recs, user.uid, current))) {
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
    const open = all.filter((r) => reportIsOpen(r));
    return json({ ok: true, open: open.length, actioned: all.length - open.length, reports: all, by_reason: {} });
  }

  if (path === "/v1/admin/report-action" && request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    const id = String(body.report_id || body.id || "");
    const decision = String(body.decision || body.status || "ACTIONED");
    const reason = String(body.reason || "").trim();
    if (!id || !reason) return json({ ok: false, error: "report and reason required" }, 400);
    const token = saToken || userToken;
    const now = Date.now();
    const patch = {
      status: decision,
      resolution: reason,
      resolvedAt: now,
      resolvedBy: user.uid,
      decided_at: now,
      decided_by: user.uid,
      note: reason,
    };
    await fsPutDoc(env, token, "/reports/" + encodeURIComponent(id), patch);
    const prev = memory.reports.get(id) || { report_id: id };
    memory.reports.set(id, Object.assign({}, prev, patch));
    memory.audit.unshift({ action: "report-" + decision, target: id, reason, actor: user.uid, ts: now });
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

  if (path === "/v1/admin/handles/seed" && request.method === "POST") {
    const token = saToken || userToken;
    const result = await seedReserved(env, token, user.uid);
    await writeAdminAudit(env, token, {
      action: "handle-seed",
      target: "reservedHandles",
      reason: "seed",
      actor: user.uid,
      actorEmail: user.email || "",
      extra: { wrote: result.wrote, total: result.total },
    });
    return json(result);
  }

  if (path === "/v1/admin/handles" && request.method === "GET") {
    const token = saToken || userToken;
    await loadReservedFromFs(env, token);
    if (!memory.reserved.size) {
      SEED_RESERVED.forEach((s) => rememberReserved(reservedPayload(s, "seed", Date.now())));
    }
    const flags = await loadHandleFlagsFromFs(env, token);
    const naluno = memory.reserved.get("naluno") || {};
    return json({
      ok: true,
      reserved: canonicalReserved(),
      flags: flags.sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0)),
      nalunoHolder: naluno.holderUid || "",
      total: canonicalReserved().length,
    });
  }

  if (path === "/v1/admin/handles" && request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    const token = saToken || userToken;
    await loadReservedFromFs(env, token);
    const h = normHandle(body.handle);
    if (!handleFormatOk(h)) return json({ ok: false, error: HANDLE_FORMAT_MSG }, 400);
    const prev = memory.reserved.get(h) || null;
    const now = Date.now();
    const row = reservedPayload({
      handle: h,
      category: body.category || (prev && prev.category) || "other",
      reason: body.reason != null ? body.reason : ((prev && prev.reason) || ""),
      holderUid: body.holderUid != null ? body.holderUid : ((prev && prev.holderUid) || ""),
      createdAt: (prev && prev.createdAt) || now,
      createdBy: (prev && prev.createdBy) || user.uid,
    }, user.uid, now);
    await writeReservedPair(env, token, row);
    await writeAdminAudit(env, token, {
      action: prev ? "handle-update" : "handle-reserve",
      target: h,
      reason: row.reason,
      actor: user.uid,
      actorEmail: user.email || "",
      extra: {
        previous: prev ? { category: prev.category, reason: prev.reason, holderUid: prev.holderUid } : null,
        next: { category: row.category, reason: row.reason, holderUid: row.holderUid },
      },
    });
    return json({ ok: true, handle: h, reserved: row });
  }

  if (path === "/v1/admin/handles/remove" && request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    const token = saToken || userToken;
    await loadReservedFromFs(env, token);
    const h = normHandle(body.handle);
    if (!h) return json({ ok: false, error: "handle required" }, 400);
    const prev = memory.reserved.get(h) || null;
    await deleteReservedPair(env, token, h);
    await writeAdminAudit(env, token, {
      action: "handle-unreserve",
      target: h,
      reason: String(body.reason || ""),
      actor: user.uid,
      actorEmail: user.email || "",
      extra: { previous: prev },
    });
    return json({ ok: true, handle: h });
  }

  if (path === "/v1/admin/handles/flag" && request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    const token = saToken || userToken;
    const id = String(body.id || "");
    if (!id) return json({ ok: false, error: "id required" }, 400);
    await loadHandleFlagsFromFs(env, token);
    const prev = memory.handleFlags.get(id) || { id };
    const next = Object.assign({}, prev, {
      status: String(body.status || "reviewed").slice(0, 24),
      note: String(body.note || "").slice(0, 240),
      reviewedBy: user.uid,
      reviewedAt: Date.now(),
    });
    rememberFlag(next);
    if (token) await fsPutDoc(env, token, "/handleFlags/" + encodeURIComponent(id), next);
    await writeAdminAudit(env, token, {
      action: "handle-flag",
      target: id,
      reason: next.status,
      actor: user.uid,
      actorEmail: user.email || "",
      extra: { previous: prev.status || "open", next: next.status, handle: next.handle || "" },
    });
    return json({ ok: true, flag: next });
  }

  if (path === "/v1/admin/broadcast-moderation" && request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    const token = saToken || userToken;
    const id = String(body.broadcast_id || body.id || "").slice(0, 80);
    const action = String(body.action || "");
    const reason = String(body.reason || "").trim();
    if (!id || !action) return json({ ok: false, error: "broadcast and action required" }, 400);
    const now = Date.now();
    let patch = { updatedAt: now };
    if (action === "let-out") {
      patch = { listed: true, held: false, heldReason: "", hidden: false, live: false, updatedAt: now };
    } else if (action === "take-down") {
      patch = {
        listed: false, held: false, hidden: true,
        hiddenReason: reason || "taken down", hiddenAt: now, hiddenBy: user.uid, live: false, updatedAt: now,
      };
    } else if (action === "restore") {
      patch = { listed: true, held: false, hidden: false, hiddenReason: "", live: false, updatedAt: now };
    } else if (action === "trust-publisher") {
      const row = await fsGetDoc(env, token, "/broadcasts/" + encodeURIComponent(id));
      const uid = String(body.user_id || (row && row.creatorUid) || "");
      if (!uid) return json({ ok: false, error: "user_id required" }, 400);
      await fsPutDoc(env, token, "/users/" + encodeURIComponent(uid), {
        trustedPublisher: true, updatedAt: now,
      });
      await writeAdminAudit(env, token, {
        action: "trust-publisher", target: uid, reason: reason || "trusted publisher",
        actor: user.uid, actorEmail: user.email || "",
      });
      return json({ ok: true, trustedPublisher: uid });
    } else {
      return json({ ok: false, error: "unknown action" }, 400);
    }
    await fsPutDoc(env, token, "/broadcasts/" + encodeURIComponent(id), patch);
    await writeAdminAudit(env, token, {
      action: "broadcast-" + action, target: id, reason: reason || action,
      actor: user.uid, actorEmail: user.email || "", extra: patch,
    });
    return json({ ok: true, broadcast_id: id, action, patch });
  }

  /* ---- REPAIR: rebuild contribution totals from the ledger ----
     The worker used to write a person's lifetime total from a cold isolate's
     memory, which overwrote real totals with whatever it had seen since it
     started. That is fixed going forward (totals now move by increment), but
     it cannot undo what was already written down.

     The LEDGER survived: every scored event wrote its own row, keyed by event
     id, so the rows are intact and were never overwritten. This recomputes
     each person's totals by summing their rows — the same arithmetic
     applyLedger() does, so the result is what the total should have been.

     Two safety rules:
       - It is a DRY RUN unless apply:true. You see what would change first.
       - It will never LOWER someone's total unless force:true. The fault made
         totals too small; if a stored total is higher than the ledger says,
         that is more likely to be missing ledger rows than extra points, and
         quietly deleting someone's points to "fix" them would repeat the
         original mistake in the opposite direction. */
  if (path === "/v1/admin/recompute-profiles" && request.method === "POST") {
    if (!saToken) return json({ ok: false, error: "needs the service account" }, 503);
    const body = await request.json().catch(() => ({}));
    const apply = body.apply === true;
    const force = body.force === true;
    const totals = new Map();
    let scanned = 0, pages = 0, cursor = body.cursor || null, done = true;

    while (pages < 60) {
      const q = {
        from: [{ collectionId: "contributionLedger" }],
        orderBy: [{ field: { fieldPath: "__name__" }, direction: "ASCENDING" }],
        limit: 500,
      };
      if (cursor) q.startAt = { values: [{ referenceValue: cursor }], before: false };
      const r = await fsFetch(env, saToken, "POST", ":runQuery", { structuredQuery: q });
      const rows = (Array.isArray(r.data) ? r.data : []).filter((x) => x && x.document);
      if (!rows.length) break;
      rows.forEach((x) => {
        const d = fromFsDoc(x.document);
        const uid = String(d.user_id || "");
        if (!uid) return;
        const t = totals.get(uid) || { total_points: 0, eligible_points: 0, events: 0 };
        t.total_points += Number(d.points) || 0;
        t.eligible_points += Number(d.eligible_points) || 0;
        t.events += 1;
        totals.set(uid, t);
        scanned++;
      });
      cursor = rows[rows.length - 1].document.name;
      pages++;
      if (rows.length < 500) { done = true; break; }
      done = false;
    }

    const changes = [];
    for (const [uid, t] of totals) {
      /* A profile that is ABSENT (404) is genuinely zero. A profile we could
         not READ (an error) is unknown — and assuming zero there would blind
         the "never lower" guard below, letting a stored 900 be written down
         to 3 because the read happened to fail. Unknown means skip. */
      let before = { total_points: 0, eligible_points: 0, events: 0 };
      let unreadable = false;
      try {
        const cur = await fsFetch(env, saToken, "GET", "/contributionProfiles/" + encodeURIComponent(uid));
        if (cur.ok) {
          const d = fromFsDoc(cur.data) || {};
          before = {
            total_points: Number(d.total_points) || 0,
            eligible_points: Number(d.eligible_points) || 0,
            events: Number(d.events) || 0,
          };
        } else if (cur.status !== 404) {
          unreadable = true;
        }
      } catch { unreadable = true; }
      if (unreadable) {
        changes.push({ user_id: uid, before: null, after: t, gained: 0, action: "skipped-unreadable" });
        continue;
      }
      const lower = t.total_points < before.total_points || t.eligible_points < before.eligible_points;
      if (before.total_points === t.total_points && before.eligible_points === t.eligible_points) continue;
      const entry = {
        user_id: uid,
        before,
        after: t,
        gained: t.total_points - before.total_points,
        action: (lower && !force) ? "skipped-would-lower" : (apply ? "written" : "would-write"),
      };
      if (apply && !(lower && !force)) {
        await fsFetch(env, saToken, "PATCH", "/contributionProfiles/" + encodeURIComponent(uid), toFsFields({
          user_id: uid,
          total_points: t.total_points,
          eligible_points: t.eligible_points,
          events: t.events,
          updated_at: Date.now(),
          repaired_at: Date.now(),
        }));
        memory.profiles.set(uid, Object.assign({ user_id: uid, updated_at: Date.now() }, t));
      }
      changes.push(entry);
    }

    if (apply) {
      try {
        await writeAdminAudit(env, saToken, {
          action: "RECOMPUTE_PROFILES",
          actor: user.uid,
          people_changed: changes.length,
          rows_scanned: scanned,
          reason: String(body.reason || "repair totals from the contribution ledger"),
        });
      } catch { /* the repair itself still stands if the audit write fails */ }
    }
    changes.sort((a, b) => b.gained - a.gained);
    return json({
      ok: true,
      dry_run: !apply,
      ledger_rows_scanned: scanned,
      people: totals.size,
      changed: changes.length,
      points_restored: changes.filter((c) => c.action !== "skipped-would-lower").reduce((a, c) => a + Math.max(0, c.gained), 0),
      skipped_would_lower: changes.filter((c) => c.action === "skipped-would-lower").length,
      skipped_unreadable: changes.filter((c) => c.action === "skipped-unreadable").length,
      more: !done,
      cursor: done ? null : cursor,
      changes: changes.slice(0, 200),
    });
  }

  if (path === "/v1/admin/simulate" && request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    const period = String(body.period_id || "");
    const pool = memory.pools.get(period);
    const amount = pool ? Number(pool.amount_minor) : 0;
    /* Read the STORED profiles. This used to use memory.profiles, which on a
       fresh isolate is empty or nearly so — meaning a simulation could show
       one person receiving the entire pool simply because they were the only
       one this isolate had seen. A payout figure computed from that is not a
       number, it is an accident. */
    let eligible = [];
    if (saToken) {
      try {
        const q = await fsFetch(env, saToken, "POST", ":runQuery", { structuredQuery: {
          from: [{ collectionId: "contributionProfiles" }], limit: 2000 } });
        const rows = Array.isArray(q.data) ? q.data : [];
        eligible = rows.filter((r) => r && r.document).map((r) => {
          const d = fromFsDoc(r.document);
          return { user_id: d.user_id || "", eligible_points: Number(d.eligible_points) || 0 };
        }).filter((p) => p.eligible_points > 0);
      } catch { eligible = []; }
    }
    if (!eligible.length) {
      eligible = Array.from(memory.profiles.values()).filter((p) => p.eligible_points > 0);
    }
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

/* ---- Lifeline relay helpers ---- */
const _lifelineHits = new Map();
/** Best-effort per-IP rate limit (per isolate). Stops casual abuse of the
 *  dead drop as free storage; not a security boundary. */
function lifelineRate(ip, perMinute) {
  const now = Date.now(), k = ip + "|" + Math.floor(now / 60000);
  const n = (_lifelineHits.get(k) || 0) + 1;
  _lifelineHits.set(k, n);
  if (_lifelineHits.size > 5000) _lifelineHits.clear();
  return n <= perMinute;
}
function lifelineB64u(str) {
  try {
    let s = String(str).replace(/-/g, "+").replace(/_/g, "/"); while (s.length % 4) s += "=";
    const bin = atob(s), out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch (_) { return null; }
}
function lifelineHex(b) { let s = ""; for (let i = 0; i < b.length; i++) s += (b[i] < 16 ? "0" : "") + b[i].toString(16); return s; }

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

    /* ---- LIFELINE RELAY: an encrypted dead drop ----
       For when the internet is up but Naluno or Google is blocked. It works
       WITHOUT Firebase sign-in on purpose: refreshing a sign-in needs Google,
       which may be exactly what is blocked.
       It is safe to leave unauthenticated because it cannot learn anything:
       each packet is end-to-end sealed, and is filed under a tag that only
       the two people in the conversation can compute, changing daily. The
       relay sees random bytes under a random label. A forged packet simply
       fails to open on the recipient's phone. Limits stop it being used as
       free storage. */
    /* ---- SHARE LINKS WITH A PREVIEW ----
       A link's preview picture and title come from og: tags in the page it
       points at. getnaluno.com is static hosting, so every Broadcast served
       the same tags: WhatsApp showed the same generic image for all of them,
       and people could not tell what they were being sent.

       This serves per-Broadcast tags and then forwards into the app. It
       returns 200 HTML rather than a redirect on purpose — several link
       crawlers do not follow redirects, and would show nothing.

       SAFETY: only a Broadcast that is genuinely public gets a preview. One
       that is deleted, hidden, held or unlisted returns a plain page with no
       title and no picture. Otherwise a Broadcast removed after a report
       would keep showing its own snapshot in every chat it was shared to. */
    if (request.method === "GET" && /^\/b\/[A-Za-z0-9_-]{1,80}$/.test(path)) {
      const bid = path.slice(3);
      const appUrl = "https://getnaluno.com/app/?broadcast=" + encodeURIComponent(bid);
      const esc = (v) => String(v == null ? "" : v)
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
      let title = "Naluno", desc = "A quieter way to reach people.", image = "";
      try {
        const tok = hasSaConfigured(env) ? await saAccessToken(env) : "";
        if (tok) {
          const b = await fsGetDoc(env, tok, "/broadcasts/" + encodeURIComponent(bid));
          const publicOk = b && !b.deleted && !b.hidden && !b.held && b.listed !== false;
          if (publicOk) {
            if (b.title) title = String(b.title).slice(0, 110);
            const who = b.creatorName ? ("by " + String(b.creatorName).slice(0, 40)) : "";
            desc = (who ? who + " \u00b7 " : "") + "Watch on Naluno";
            const thumb = String(b.thumbUrl || b.thumb || "");
            if (/^https:\/\//.test(thumb)) image = thumb;
          } else if (b) {
            title = "This Broadcast isn\u2019t available";
            desc = "It may have been taken down or made private.";
          }
        }
      } catch { /* fall through to the generic card */ }
      const html = "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\">"
        + "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">"
        + "<title>" + esc(title) + "</title>"
        + "<meta property=\"og:type\" content=\"video.other\">"
        + "<meta property=\"og:site_name\" content=\"Naluno\">"
        + "<meta property=\"og:title\" content=\"" + esc(title) + "\">"
        + "<meta property=\"og:description\" content=\"" + esc(desc) + "\">"
        + "<meta property=\"og:url\" content=\"" + esc(appUrl) + "\">"
        + (image ? "<meta property=\"og:image\" content=\"" + esc(image) + "\">" : "")
        + "<meta name=\"twitter:card\" content=\"" + (image ? "summary_large_image" : "summary") + "\">"
        + "<meta name=\"twitter:title\" content=\"" + esc(title) + "\">"
        + "<meta name=\"twitter:description\" content=\"" + esc(desc) + "\">"
        + (image ? "<meta name=\"twitter:image\" content=\"" + esc(image) + "\">" : "")
        + "<link rel=\"canonical\" href=\"" + esc(appUrl) + "\">"
        + "<meta http-equiv=\"refresh\" content=\"0;url=" + esc(appUrl) + "\">"
        + "</head><body style=\"background:#0D0F17;color:#E8ECF5;font-family:system-ui;text-align:center;padding:48px 20px;\">"
        + "<p>Opening Naluno\u2026</p><p><a style=\"color:#7CFFB2\" href=\"" + esc(appUrl) + "\">Open this Broadcast</a></p>"
        + "<script>location.replace(" + JSON.stringify(appUrl) + ");</scr" + "ipt>"
        + "</body></html>";
      return new Response(html, { status: 200, headers: {
        "Content-Type": "text/html; charset=utf-8",
        // Crawlers re-fetch often; a short cache keeps a taken-down Broadcast
        // from keeping its preview for long.
        "Cache-Control": "public, max-age=300",
        "Access-Control-Allow-Origin": "*",
      } });
    }

    if (path === "/v1/lifeline/drop" && request.method === "POST") {
      if (!saToken) return json({ ok: false, error: "relay storage not configured" }, 503);
      const ip = request.headers.get("CF-Connecting-IP") || "?";
      if (!lifelineRate(ip, 60)) return json({ ok: false, error: "slow down" }, 429);
      const body = await request.json().catch(() => ({}));
      const p = String(body.p || "");
      if (!/^[A-Za-z0-9_-]{60,5600}$/.test(p)) return json({ ok: false, error: "bad packet" }, 400);
      const bytes = lifelineB64u(p);
      if (!bytes || bytes[0] !== 1 || bytes.length < 41 || bytes.length > 4096) return json({ ok: false, error: "bad packet" }, 400);
      const tag = lifelineHex(bytes.slice(1, 13));
      const id = lifelineHex(bytes.slice(13, 21));
      const exp = Date.now() + 72 * 3600 * 1000;
      const r = await fsFetch(env, saToken, "PATCH", "/lifelineDrops/" + tag + "_" + id,
        toFsFields({ tag, p, exp, at: Date.now() }));
      if (!r.ok) return json({ ok: false, error: "store failed" }, 502);
      return json({ ok: true });
    }
    if (path === "/v1/lifeline/pick" && request.method === "POST") {
      if (!saToken) return json({ ok: false, error: "relay storage not configured" }, 503);
      const ip = request.headers.get("CF-Connecting-IP") || "?";
      if (!lifelineRate(ip, 120)) return json({ ok: false, error: "slow down" }, 429);
      const body = await request.json().catch(() => ({}));
      const tags = (Array.isArray(body.tags) ? body.tags : [])
        .filter((t) => typeof t === "string" && /^[0-9a-f]{24}$/.test(t)).slice(0, 300);
      if (!tags.length) return json({ ok: true, packets: [] });
      const now = Date.now(), out = [];
      for (let i = 0; i < tags.length && out.length < 200; i += 30) {
        const chunk = tags.slice(i, i + 30);
        const q = await fsFetch(env, saToken, "POST", ":runQuery", { structuredQuery: {
          from: [{ collectionId: "lifelineDrops" }],
          where: { fieldFilter: { field: { fieldPath: "tag" }, op: "IN",
            value: { arrayValue: { values: chunk.map((t) => ({ stringValue: t })) } } } },
          limit: 100 } });
        const rows = Array.isArray(q.data) ? q.data : [];
        rows.forEach((row) => {
          if (!row || !row.document) return;
          const d = fromFsDoc(row.document);
          if (Number(d.exp) > now && d.p) out.push(String(d.p));
        });
      }
      return json({ ok: true, packets: out.slice(0, 200) });
    }

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

    if (path === "/v1/handle/check" && request.method === "GET") {
      return handleCheck(env, url, saToken);
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
      /* Durable de-duplication. The memory check above only holds within ONE
         isolate, so a retry landing on a fresh isolate was scored a second
         time. Claiming the event document first — create-only, which
         Firestore refuses if it already exists — makes "has this already
         counted?" a fact in the database rather than a guess in RAM.
         This matters now that retries actually happen: the client's queue of
         failed events is finally being flushed. */
      if (saToken) {
        const claim = await fsFetch(
          env, saToken, "PATCH",
          "/engagementEvents/" + encodeURIComponent(eventId) + "?currentDocument.exists=false",
          toFsFields({ event_id: eventId, user_id: user.uid, event_type: eventType, claimed_at: Date.now() }),
        );
        if (!claim.ok && (claim.status === 409 || claim.status === 400)) {
          memory.events.set(eventId, { event_id: eventId });
          return json({ ok: true, duplicate: true, event_id: eventId, persist: persistMode(true, ["firestore"]) });
        }
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

    if (path === "/v1/safety/event" && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      const type = String(body.type || "").toUpperCase();
      if (body.body || body.message || body.ciphertext || body.plaintext || body.wire_text || body.transcript || body.chat) {
        return json({ ok: false, error: "private boundary", contents_collected: false }, 403);
      }
      if ((type === "LEGAL_REQUEST" || type === "ADMIN_ACTION") && !isOperatorUser(env, user)) {
        return json({ ok: false, error: "operator only" }, 403);
      }
      const surface = String(body.surface || "");
      if (isPrivateSurface(surface)) {
        return json({ ok: false, error: "private boundary", decision: "PRIVATE", contents_collected: false }, 403);
      }
      let linked = 0;
      if (type === "USER_CREATED") {
        const device = String(body.device_key || "").slice(0, 80);
        if (device) {
          const now = Date.now();
          const rows = (memory.safetyBirths.get(device) || []).filter(function (r) { return now - r.at < 86400000; });
          if (!rows.some(function (r) { return r.uid === user.uid; })) rows.push({ uid: user.uid, at: now });
          memory.safetyBirths.set(device, rows);
          linked = rows.length;
        }
      }
      const publicText = String(body.public_text || "");
      const fp = publicText ? fingerprintPublic(publicText) : "";
      let repeat = false;
      if (fp) {
        const key = user.uid + ":" + fp;
        const prev = memory.safetyPrints.get(key) || 0;
        if (prev && Date.now() - prev < 86400000) repeat = true;
        memory.safetyPrints.set(key, Date.now());
      }
      const ledger = memory.safetyLedgers.get(user.uid) || emptyLedger(user.uid);
      let applied;
      try {
        applied = applySafetyEvent(ledger, {
          type: type,
          surface: surface,
          public_text: publicText,
          uid: user.uid,
          linked_accounts: linked,
          repeat_public: repeat,
          ban_evasion: !!body.ban_evasion,
          known_hash: !!body.known_hash,
        });
      } catch (e) {
        const msg = (e && e.message) || "rejected";
        const code = msg === "private boundary" ? 403 : 400;
        return json({ ok: false, error: msg, contents_collected: false }, code);
      }
      memory.safetyLedgers.set(user.uid, applied.ledger);
      if (saToken) {
        const counts = applied.counts;
        await fsPutDoc(env, saToken, "/safetyLedgers/" + encodeURIComponent(user.uid), {
          uid: user.uid,
          counts: counts,
          verified: !!applied.ledger.verified,
          updatedAt: Date.now(),
        });
      }
      let cluster = null;
      if (fp) cluster = observeCluster(memory.safetyClusters, { fingerprint: fp, uid: user.uid });
      let caseId = "";
      const content = applied.content;
      if (content && safetyHold(content.decision)) {
        const opened = await openHeldCase(env, saToken, userToken, {
          reporter_id: "system",
          reported_user_id: user.uid,
          content_id: String(body.content_id || ""),
          content_type: surface || (type === "SIGNAL_PUBLISHED" ? "signal" : "broadcast"),
          surface: surface || "public",
          reason_code: content.urgent ? "violence" : (content.decision === "AGE_RESTRICT" ? "sexual" : "dangerous"),
          evidence_reference: (surface || "public") + ":" + String(body.content_id || type),
          result: content,
          contents_collected: content.contents_collected !== false && type !== "LEGAL_REQUEST",
        }, content.decision + " " + content.score, "classifier");
        caseId = opened.case_id;
      } else if (applied.behaviour && (applied.behaviour.decision === "REVIEW" || applied.behaviour.decision === "REMOVE")) {
        const opened = await openHeldCase(env, saToken, userToken, {
          reporter_id: "system",
          reported_user_id: user.uid,
          content_id: user.uid,
          content_type: "account",
          surface: "behaviour",
          reason_code: "suspicious",
          evidence_reference: "behaviour:" + user.uid,
          result: applied.behaviour,
          contents_collected: false,
        }, applied.behaviour.signals.map(function (s) { return s.id; }).join(","), "behaviour");
        caseId = opened.case_id;
      } else if (cluster && cluster.human_required) {
        const opened = await openHeldCase(env, saToken, userToken, {
          reporter_id: "system",
          reported_user_id: user.uid,
          content_id: fp,
          content_type: "account",
          surface: "behaviour",
          reason_code: "suspicious",
          evidence_reference: "cluster:" + fp,
          result: cluster,
          contents_collected: false,
        }, "coordinated public posts " + cluster.accounts, "network");
        caseId = opened.case_id;
      }
      return json({
        ok: true,
        type: type,
        case_id: caseId,
        statement: content ? statementFor(content) : "",
        content: content ? {
          decision: content.decision,
          score: content.score,
          urgent: !!content.urgent,
          auto_ban: false,
          contents_collected: type === "LEGAL_REQUEST" ? false : !!content.contents_collected,
        } : null,
        behaviour: {
          decision: applied.behaviour.decision,
          score: applied.behaviour.score,
          auto_ban: false,
          contents_collected: false,
          signals: (applied.behaviour.signals || []).map(function (s) { return s.id; }),
        },
        cluster: cluster ? { accounts: cluster.accounts, decision: cluster.decision, score: cluster.score } : null,
        private_read: false,
      });
    }

    if (path === "/v1/safety/score" && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      const surface = String(body.surface || "public");
      if (isPrivateSurface(surface)) {
        return json({ ok: false, error: "private boundary", decision: "PRIVATE", contents_collected: false }, 403);
      }
      const result = scorePublicText(String(body.text || ""), { surface: surface });
      result.statement = statementFor(result);
      if (safetyHold(result.decision)) {
        const opened = await openHeldCase(env, saToken, userToken, {
          reporter_id: "system",
          reported_user_id: user.uid,
          content_id: String(body.content_id || ""),
          content_type: surface,
          surface: surface,
          reason_code: result.urgent ? "violence" : (result.decision === "AGE_RESTRICT" ? "sexual" : "dangerous"),
          evidence_reference: surface + ":" + String(body.content_id || "text"),
          result: result,
        }, result.decision + " " + result.score, "classifier");
        result.case_id = opened.case_id;
      }
      const safe = {
        ok: result.ok,
        surface: result.surface,
        decision: result.decision,
        score: result.score,
        signals: result.signals,
        urgent: result.urgent,
        monitor: result.monitor,
        human_required: result.human_required,
        auto_ban: false,
        account_action_applied: false,
        recommended_account_action: result.recommended_account_action,
        contents_collected: result.contents_collected,
        statement: result.statement,
        case_id: result.case_id || "",
        version: result.version,
      };
      return json({ ok: true, result: safe });
    }

    if (path === "/v1/safety/behaviour" && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      const result = scoreBehaviour(body.counts || body);
      if (result.decision === "REVIEW" || result.decision === "REMOVE") {
        const opened = buildCase({
          reporter_id: "system",
          reported_user_id: user.uid,
          content_id: user.uid,
          content_type: "account",
          surface: "behaviour",
          reason_code: "suspicious",
          evidence_reference: "behaviour:" + user.uid,
          result: result,
          contents_collected: false,
        });
        await persistSafetyCase(env, saToken, userToken, opened);
        await persistSafetyAudit(env, saToken, userToken, buildAudit({
          case_id: opened.case_id,
          who: "system",
          what: "behaviour-risk",
          why: result.signals.map(function (s) { return s.id; }).join(","),
          detected_by: "behaviour",
          human_reviewed: false,
          action_taken: "case opened",
        }));
        result.case_id = opened.case_id;
      }
      return json({ ok: true, result: result });
    }

    if (path === "/v1/safety/hash" && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      if (body.bytes || body.file || body.data || body.image || body.blob) {
        return json({ ok: false, error: "send the hash only" }, 400);
      }
      const result = matchKnownHash(body.sha256, hashList(env));
      if (!result.ok) return json(result, 400);
      if (result.matched) {
        const opened = buildCase({
          reporter_id: "system",
          reported_user_id: user.uid,
          content_id: String(body.content_id || ""),
          content_type: String(body.surface || "public"),
          surface: "public",
          reason_code: result.category || "known",
          evidence_reference: "hash:" + String(body.sha256 || "").slice(0, 16),
          result: result,
          contents_collected: false,
        });
        await persistSafetyCase(env, saToken, userToken, opened);
        await persistSafetyAudit(env, saToken, userToken, buildAudit({
          case_id: opened.case_id,
          who: "system",
          what: "known-hash",
          why: result.category || "known",
          detected_by: "hash",
          human_reviewed: false,
          action_taken: "held for review",
        }));
        result.case_id = opened.case_id;
      }
      return json({ ok: true, result: result });
    }

    if (path === "/v1/safety/appeal" && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      let appeal;
      try {
        appeal = buildAppeal({
          case_id: body.case_id,
          appellant_uid: user.uid,
          note: body.note,
        });
      } catch (e) {
        return json({ ok: false, error: (e && e.message) || "appeal rejected" }, 400);
      }
      const existing = memory.safetyCases.get(appeal.case_id);
      if (existing && existing.reported_user_id && existing.reported_user_id !== user.uid) {
        return json({ ok: false, error: "not your case" }, 403);
      }
      memory.safetyAppeals.set(appeal.appeal_id, appeal);
      if (existing) {
        const next = applyAppeal(existing, appeal);
        await persistSafetyCase(env, saToken, userToken, next);
      }
      if (userToken || saToken) {
        await fsPutDoc(env, saToken || userToken, "/safetyAppeals/" + encodeURIComponent(appeal.appeal_id), appeal);
      }
      await persistSafetyAudit(env, saToken, userToken, buildAudit({
        case_id: appeal.case_id,
        who: user.uid,
        what: "appeal-opened",
        why: "person challenged the decision",
        detected_by: "human",
        human_reviewed: false,
        action_taken: "appeal open",
      }));
      return json({ ok: true, appeal_id: appeal.appeal_id });
    }

    if (path === "/v1/report" && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      const reason = String(body.reason || "").trim();
      const code = String(body.reason_code || "other");
      if (reason.length < 10) return json({ ok: false, error: "Please say a little more — at least a sentence." }, 400);
      if (!REPORT_CODES[code]) return json({ ok: false, error: "Unknown reason" }, 400);
      const id = String(body.report_id || ("rep_" + Date.now())).slice(0, 80);
      const existing = memory.reports.get(id);
      if (existing && !reportIsOpen(existing)) {
        return json({ ok: true, report_id: id, hidden: false, already_decided: true });
      }
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
      const wrote = await fsFetch(
        env,
        token,
        "PATCH",
        "/reports/" + encodeURIComponent(id) + "?currentDocument.exists=false",
        toFsFields(doc),
      );
      if (!wrote.ok && existing) memory.reports.set(id, existing);

      /* TAKE IT OUT OF PUBLIC VIEW FIRST.
         This used to happen at the very END of the report handler, after
         scoring, case-opening and several other writes. Anything throwing in
         between left the report saved and the Broadcast still on the feed —
         which is what happened to the test report. Urgency is the whole point
         of these categories, so the removal now happens immediately after the
         report is recorded, and nothing after it can prevent it.

         sexual            -> hidden (off the feed entirely)
         terrorism and the other urgent categories -> held for a human
         Both are reversible by a person in the console. */
      const hideNow = String(body.broadcast_id || (body.target_type === "broadcast" ? body.target_id : "") || "");
      const URGENT_HOLD = { terrorism: 1, recruitment: 1, child_exploitation: 1, sexual_exploitation: 1, violence: 1 };
      let autoHidden = false, autoHeld = false, autoError = "";
      if (hideNow && (code === "sexual" || URGENT_HOLD[code])) {
        if (!saToken) {
          /* Only the service account may touch someone else's Broadcast, so
             without it nothing can be removed. Say so instead of returning a
             cheerful ok while the content stays up. */
          autoError = "no-service-account";
        } else {
          try {
            if (code === "sexual") {
              await hideBroadcastSexual(env, saToken, userToken, hideNow);
              autoHidden = true;
            } else {
              await fsPutDoc(env, saToken, "/broadcasts/" + encodeURIComponent(hideNow), {
                listed: false,
                held: true,
                live: false,
                heldReason: "reported-" + code,
                safetyDecision: "ESCALATE",
                updatedAt: Date.now(),
              });
              autoHeld = true;
            }
          } catch (e) {
            autoError = (e && e.message) ? String(e.message).slice(0, 120) : "hide failed";
          }
        }
      }

      const targetType = String(body.target_type || "public");
      const privateTarget = isPrivateSurface(targetType);
      const scored = privateTarget
        ? { decision: "PRIVATE", score: 0, signals: [], urgent: false, contents_collected: false }
        : scorePublicText(String(body.caption || body.public_text || ""), { surface: targetType === "broadcast" || targetType === "signal" ? targetType : "public" });
      const targetUser = String(body.target_user_id || "");
      const now = Date.now();
      memory.safetyReportHits.push({
        reporter_uid: user.uid,
        target_id: targetUser || String(body.target_id || ""),
        at: now,
        reporter_age_hours: Number(body.reporter_age_hours),
      });
      if (memory.safetyReportHits.length > 500) memory.safetyReportHits = memory.safetyReportHits.slice(-500);
      const recentHits = memory.safetyReportHits.filter(function (r) {
        return r.target_id && r.target_id === (targetUser || String(body.target_id || "")) && now - r.at < 3600000;
      });
      const weighed = weighReports(recentHits.filter(function (r) { return Number.isFinite(r.reporter_age_hours); }));
      if (targetUser) {
        const led = memory.safetyLedgers.get(targetUser) || emptyLedger(targetUser);
        try {
          const applied = applySafetyEvent(led, { type: "ACCOUNT_REPORTED", uid: targetUser });
          memory.safetyLedgers.set(targetUser, applied.ledger);
        } catch (_) {}
      }
      const prior = safetyQueue().filter(function (c) {
        return c.reported_user_id && c.reported_user_id === targetUser;
      }).length;
      const blended = combineRisk(
        scored.decision === "PRIVATE" ? null : scored,
        null,
        weighed.brigade ? weighed.weight : prior + 1,
        weighed,
      );
      const urgentCode = code === "terrorism" || code === "recruitment" || code === "child_exploitation" || code === "violence";
      const risk = urgentCode
        ? Object.assign({}, blended, {
          urgent: true,
          score: Math.max(blended.score, 70),
          decision: blended.decision === "REMOVE" || blended.decision === "ESCALATE" ? "ESCALATE" : "REVIEW",
          human_required: true,
          auto_ban: false,
        })
        : blended;
      const opened = buildCase({
        case_id: "TS-" + id.slice(0, 48),
        reporter_id: user.uid,
        reported_user_id: String(body.target_user_id || ""),
        content_id: String(body.broadcast_id || body.target_id || ""),
        content_type: targetType,
        surface: privateTarget ? targetType : (targetType || "public"),
        reason_code: code,
        report_id: id,
        evidence_reference: "report:" + id,
        result: risk,
        contents_collected: !privateTarget && !!(body.caption || body.public_text),
        include_body: false,
      });
      if (privateTarget) opened.contents_collected = false;
      await persistSafetyCase(env, saToken, userToken, opened);
      await persistSafetyAudit(env, saToken, userToken, buildAudit({
        case_id: opened.case_id,
        who: user.uid,
        what: "report-opened",
        why: code,
        detected_by: "report",
        human_reviewed: false,
        action_taken: "case opened",
      }));
      // (the removal already happened above, before any scoring could fail)
      /* Tell the person whose Broadcast it is. Nobody should discover their
         work was taken off the feed by noticing it missing. Wireline messages
         are end-to-end encrypted and the worker holds no keys, so this is a
         notice FROM Naluno rather than a forged message from a person — the
         app shows it in Wireline and offers the appeal. */
      try {
        const ownerUid = String(body.target_user_id || "")
          || (hideNow && saToken ? String(((await fsGetDoc(env, saToken, "/broadcasts/" + encodeURIComponent(hideNow))) || {}).creatorUid || "") : "");
        if (ownerUid && (autoHidden || autoHeld) && saToken) {
          await fsPutDoc(env, saToken, "/users/" + encodeURIComponent(ownerUid) + "/notices/" + encodeURIComponent(id), {
            notice_id: id,
            kind: autoHidden ? "broadcast_hidden" : "broadcast_held",
            broadcast_id: hideNow,
            reason_code: code,
            case_id: opened.case_id,
            appealable: true,
            ts: Date.now(),
          });
        }
      } catch { /* the removal stands even if the notice cannot be written */ }

      return json({
        ok: true,
        report_id: id,
        case_id: opened.case_id,
        priority: opened.priority,
        hidden: autoHidden,
        held: autoHeld,
        hide_error: autoError,
        contents_collected: opened.contents_collected,
      });
    }

    if (path === "/v1/support/intent" && request.method === "POST") {
      return json({ ok: false, error: "Support isn’t available yet" }, 400);
    }

    if (path === "/v1/broadcast/place" && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      return placeBroadcast(env, user, userToken, saToken, body);
    }

    if (path === "/v1/handle/claim" && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      return handleClaim(env, user, userToken, saToken, body);
    }

    if (path.startsWith("/v1/admin/")) {
      return handleAdmin(env, request, path, url, user, userToken, saToken);
    }

    return json({ ok: false, error: "Missing auth token" }, 401);
  } catch (e) {
    return json({ ok: false, error: (e && e.message) || "internal" }, 500);
  }
}
