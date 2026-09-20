import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_FLAGS,
  VERSION,
  b64url,
  handleRequest,
  parseServiceAccount,
  resetMemory,
  setFetchImpl,
  signRs256Jwt,
  getMemory,
  SEED_RESERVED,
  matchReserved,
  normHandle,
} from "./handler.mjs";

const ENV = {
  FIREBASE_PROJECT_ID: "naluno-28a00",
  FIREBASE_WEB_API_KEY: "test-key",
  OPERATOR_UID: "ibMOMY6Q3sVTCxIrwO2FGk43zw93",
};

function req(path, opts = {}) {
  return new Request("https://naluno-economy.naluno.workers.dev" + path, opts);
}

async function genSa() {
  const pair = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );
  const pkcs8 = await crypto.subtle.exportKey("pkcs8", pair.privateKey);
  const bytes = new Uint8Array(pkcs8);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  const b64 = btoa(bin).replace(/(.{64})/g, "$1\n");
  const pem = "-----BEGIN PRIVATE KEY-----\n" + b64 + "\n-----END PRIVATE KEY-----\n";
  return {
    client_email: "naluno-economy@naluno-28a00.iam.gserviceaccount.com",
    private_key: pem,
    project_id: "naluno-28a00",
    token_uri: "https://oauth2.googleapis.com/token",
    _pair: pair,
  };
}

test("parseServiceAccount unescapes Wrangler newlines and double JSON", () => {
  const inner = {
    client_email: "sa@naluno-28a00.iam.gserviceaccount.com",
    private_key: "-----BEGIN PRIVATE KEY-----\nABC\n-----END PRIVATE KEY-----\n",
    project_id: "naluno-28a00",
  };
  const fromGoogle = parseServiceAccount(JSON.stringify(inner));
  assert.ok(fromGoogle);
  assert.equal(fromGoogle.client_email, inner.client_email);
  assert.ok(fromGoogle.private_key.includes("BEGIN PRIVATE KEY"));
  assert.equal(fromGoogle.private_key.includes("\\n"), false);

  const wrangler = JSON.stringify(JSON.stringify(inner));
  const sa = parseServiceAccount(JSON.parse(wrangler));
  assert.ok(sa);
  assert.equal(sa.client_email, inner.client_email);
  assert.equal(sa.private_key.includes("\\n"), false);
  assert.match(sa.private_key, /\n$/);
});

test("signRs256Jwt produces a three-part RS256 token", async () => {
  const sa = await genSa();
  const jwt = await signRs256Jwt(sa, { now: 1_700_000_000 });
  const parts = jwt.split(".");
  assert.equal(parts.length, 3);
  const header = JSON.parse(Buffer.from(parts[0].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString());
  assert.equal(header.alg, "RS256");
  const payload = JSON.parse(Buffer.from(parts[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString());
  assert.equal(payload.iss, sa.client_email);
  assert.equal(payload.aud, "https://oauth2.googleapis.com/token");
  assert.ok(String(payload.scope).includes("datastore"));
});

test("health is 200 and names this build", async () => {
  resetMemory();
  const res = await handleRequest(req("/health"), ENV);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.service, "naluno-economy");
  assert.equal(body.version, VERSION);
  assert.equal(body.adminAuth, "password");
  assert.equal(body.hasWebApiKey, true);
});

test("/v1/flags is never degraded when flags are served", async () => {
  resetMemory();
  const res = await handleRequest(req("/v1/flags"), ENV);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.degraded, false);
  assert.equal(body.flags.broadcast_enabled, true);
  assert.equal(body.flags.real_payouts_enabled, false);
  assert.equal(body.flags.contribution_enabled, DEFAULT_FLAGS.contribution_enabled);
  assert.ok(body.persist === "user-token" || body.persist === "firestore-sa" || body.persist === "memory");
});

test("CORS preflight allows the admin header", async () => {
  const res = await handleRequest(req("/v1/flags", { method: "OPTIONS" }), ENV);
  assert.equal(res.status, 204);
  const allow = res.headers.get("Access-Control-Allow-Headers") || "";
  assert.ok(allow.includes("X-Naluno-Admin"));
  assert.equal(res.headers.get("Access-Control-Allow-Origin"), "*");
});

test("events without a token are 401", async () => {
  const res = await handleRequest(req("/v1/events", { method: "POST", body: "{}" }), ENV);
  assert.equal(res.status, 401);
});

test("a signed-in comment is stored and /v1/me reflects points", async () => {
  resetMemory();
  setFetchImpl(async (url, opts) => {
    const u = String(url);
    if (u.includes("accounts:lookup")) {
      return new Response(JSON.stringify({ users: [{ localId: "user_a", email: "a@x.com" }] }), { status: 200 });
    }
    if (u.includes("firestore.googleapis.com")) {
      return new Response(JSON.stringify({ error: { status: "PERMISSION_DENIED" } }), { status: 403 });
    }
    return new Response("{}", { status: 404 });
  });
  const ev = await handleRequest(
    req("/v1/events", {
      method: "POST",
      headers: { Authorization: "Bearer tok", "Content-Type": "application/json" },
      body: JSON.stringify({
        event_id: "evt_test_1",
        event_type: "BROADCAST_COMMENT",
        text: "This is a real comment on the show.",
        broadcast_id: "b1",
      }),
    }),
    ENV,
  );
  assert.equal(ev.status, 200);
  const posted = await ev.json();
  assert.equal(posted.ok, true);
  assert.equal(posted.degraded, undefined);

  const me = await handleRequest(
    req("/v1/me", { headers: { Authorization: "Bearer tok" } }),
    ENV,
  );
  const body = await me.json();
  assert.equal(body.ok, true);
  assert.equal(body.contribution_points, 3);
  assert.equal(body.eligible_contribution, 3);
  setFetchImpl(null);
});

test("short comments are pending, not minted", async () => {
  resetMemory();
  setFetchImpl(async (url) => {
    if (String(url).includes("accounts:lookup")) {
      return new Response(JSON.stringify({ users: [{ localId: "user_a" }] }), { status: 200 });
    }
    return new Response("{}", { status: 403 });
  });
  const ev = await handleRequest(
    req("/v1/events", {
      method: "POST",
      headers: { Authorization: "Bearer tok", "Content-Type": "application/json" },
      body: JSON.stringify({ event_id: "evt_short", event_type: "BROADCAST_COMMENT", text: "hi" }),
    }),
    ENV,
  );
  const posted = await ev.json();
  assert.equal(posted.ok, true);
  assert.equal(posted.status, "PENDING_REVIEW");
  const me = await handleRequest(req("/v1/me", { headers: { Authorization: "Bearer tok" } }), ENV);
  const body = await me.json();
  assert.equal(body.contribution_points, 0);
  setFetchImpl(null);
});

test("b64url has no plus or slash", () => {
  const s = b64url("??>>");
  assert.equal(s.includes("+"), false);
  assert.equal(s.includes("/"), false);
});

test("public /v1/mail writes deskMail and never returns the inbox address", async () => {
  resetMemory();
  const calls = [];
  setFetchImpl(async (url, opts) => {
    const u = String(url);
    calls.push({ u, body: opts && opts.body });
    if (u.includes("oauth2.googleapis.com/token")) {
      return new Response(JSON.stringify({ access_token: "sa", expires_in: 3600 }), { status: 200 });
    }
    if (u.includes("firestore.googleapis.com") && u.includes("/deskMail/")) {
      return new Response(JSON.stringify({ name: "projects/x/databases/(default)/documents/deskMail/m1" }), { status: 200 });
    }
    if (u.includes("formsubmit.co")) {
      return new Response(JSON.stringify({ success: true }), { status: 200 });
    }
    return new Response("{}", { status: 404 });
  });
  const sa = await genSa();
  const env = {
    ...ENV,
    GOOGLE_SERVICE_ACCOUNT: JSON.stringify({
      client_email: sa.client_email,
      private_key: sa.private_key,
      project_id: sa.project_id,
      token_uri: sa.token_uri,
    }),
    INBOX_TO: "secret-inbox@example.com",
  };
  const res = await handleRequest(
    req("/v1/mail", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        source: "web",
        kind: "contact",
        name: "Amina",
        email: "amina@example.com",
        text: "Hello — I have a question about Naluno.",
      }),
    }),
    env,
  );
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.ok(body.id);
  assert.equal(body.emailed, true);
  const dump = JSON.stringify(body);
  assert.equal(dump.includes("secret-inbox@example.com"), false);
  assert.equal(dump.includes("nolegoafrica"), false);
  assert.ok(calls.some((c) => c.u.includes("/deskMail/")));
  assert.ok(calls.some((c) => c.u.includes("formsubmit.co/ajax/secret-inbox%40example.com")));
  setFetchImpl(null);
});

test("honeypot mail is swallowed", async () => {
  resetMemory();
  let firestore = 0;
  setFetchImpl(async (url) => {
    if (String(url).includes("firestore")) { firestore += 1; }
    return new Response("{}", { status: 200 });
  });
  const res = await handleRequest(
    req("/v1/mail", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "spam", company: "Buy now", source: "web" }),
    }),
    ENV,
  );
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(firestore, 0);
  assert.equal(getMemory().mail.size, 0);
  setFetchImpl(null);
});

test("empty mail is 400", async () => {
  resetMemory();
  const res = await handleRequest(
    req("/v1/mail", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: " " }),
    }),
    ENV,
  );
  assert.equal(res.status, 400);
});

test("public delete-account without identity is 400", async () => {
  resetMemory();
  const res = await handleRequest(
    req("/v1/mail", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "delete-account", text: "Please delete my account." }),
    }),
    ENV,
  );
  assert.equal(res.status, 400);
});

test("signed-in Compass delete-account lands without leaking the inbox", async () => {
  resetMemory();
  setFetchImpl(async (url) => {
    const u = String(url);
    if (u.includes("accounts:lookup")) {
      return new Response(JSON.stringify({ users: [{ localId: "user_del", email: "u@x.com", displayName: "U" }] }), { status: 200 });
    }
    if (u.includes("/deskMail/")) {
      return new Response(JSON.stringify({ name: "ok" }), { status: 200 });
    }
    return new Response("{}", { status: 403 });
  });
  const res = await handleRequest(
    req("/v1/mail", {
      method: "POST",
      headers: { Authorization: "Bearer tok", "Content-Type": "application/json" },
      body: JSON.stringify({
        source: "compass",
        kind: "delete-account",
        handle: "amina",
        text: "Please delete my Naluno account.",
      }),
    }),
    ENV,
  );
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(JSON.stringify(body).includes("@gmail.com"), false);
  const stored = [...getMemory().mail.values()][0];
  assert.equal(stored.uid, "user_del");
  assert.equal(stored.kind, "delete-account");
  assert.equal(stored.source, "compass");
  setFetchImpl(null);
});

test("public mail without inbox and without persist is 503", async () => {
  resetMemory();
  setFetchImpl(async (url) => {
    if (String(url).includes("firestore.googleapis.com")) {
      return new Response("{}", { status: 403 });
    }
    return new Response("{}", { status: 404 });
  });
  const res = await handleRequest(
    req("/v1/mail", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "Hello from the site." }),
    }),
    ENV,
  );
  assert.equal(res.status, 503);
  setFetchImpl(null);
});

test("public mail without a service account still emails and does not leak the inbox", async () => {
  resetMemory();
  const calls = [];
  setFetchImpl(async (url, opts) => {
    const u = String(url);
    calls.push({ u, body: opts && opts.body });
    if (u.includes("firestore.googleapis.com") && u.includes("/deskMail/")) {
      return new Response("{}", { status: 403 });
    }
    if (u.includes("formsubmit.co")) {
      return new Response(JSON.stringify({ success: true }), { status: 200 });
    }
    return new Response("{}", { status: 404 });
  });
  const env = { ...ENV, INBOX_TO: "secret-inbox@example.com" };
  const res = await handleRequest(
    req("/v1/mail", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        source: "web",
        kind: "contact",
        handle: "magjoed",
        email: "visitor@example.com",
        text: "Hei",
      }),
    }),
    env,
  );
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.emailed, true);
  const dump = JSON.stringify(body);
  assert.equal(dump.includes("secret-inbox@example.com"), false);
  assert.equal(dump.includes("nolegoafrica"), false);
  assert.ok(calls.some((c) => c.u.includes("formsubmit.co/ajax/secret-inbox%40example.com")));
  assert.equal(calls.some((c) => String(c.body || "").includes("secret-inbox@example.com")), false);
  setFetchImpl(null);
});

test("public mail without inbox does not write deskMail via the public API key", async () => {
  resetMemory();
  const calls = [];
  setFetchImpl(async (url) => {
    const u = String(url);
    calls.push(u);
    return new Response("{}", { status: 403 });
  });
  const res = await handleRequest(
    req("/v1/mail", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source: "web", text: "Hei from the site." }),
    }),
    ENV,
  );
  assert.equal(res.status, 503);
  const body = await res.json();
  assert.equal(body.ok, false);
  assert.equal(calls.some((u) => u.includes("/deskMail/") && u.includes("key=")), false);
  setFetchImpl(null);
});

test("invest mail stores contact fields and does not leak the inbox", async () => {
  resetMemory();
  const calls = [];
  setFetchImpl(async (url, opts) => {
    const u = String(url);
    calls.push({ u, body: opts && opts.body });
    if (u.includes("firestore.googleapis.com") && u.includes("/deskMail/")) {
      return new Response(JSON.stringify({ name: "ok" }), { status: 200 });
    }
    if (u.includes("formsubmit.co")) {
      return new Response(JSON.stringify({ success: true }), { status: 200 });
    }
    return new Response("{}", { status: 404 });
  });
  const res = await handleRequest(
    req("/v1/mail", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        source: "web",
        kind: "investment",
        name: "Sam Okello",
        email: "sam@example.com",
        phone: "+256700000000",
        organisation: "River Hold",
        country: "Uganda",
        interest: "strategic partnership",
        text: "We would like to talk about the next stage.",
      }),
    }),
    { ...ENV, INBOX_TO: "secret-inbox@example.com" },
  );
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(JSON.stringify(body).includes("secret-inbox"), false);
  const stored = [...getMemory().mail.values()][0];
  assert.equal(stored.kind, "invest");
  assert.equal(stored.interest, "partnership");
  assert.equal(stored.country, "Uganda");
  assert.equal(stored.organisation, "River Hold");
  assert.equal(stored.phone, "+256700000000");
  assert.ok(calls.some((c) => String(c.body || "").includes("Naluno · strategic partnership")));
  setFetchImpl(null);
});

test("invest mail without a name and email is 400", async () => {
  resetMemory();
  const res = await handleRequest(
    req("/v1/mail", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "invest", country: "UAE", text: "Hello from an investor." }),
    }),
    ENV,
  );
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.ok, false);
  assert.equal(getMemory().mail.size, 0);
});

test("health reports hasInbox without returning the mailbox", async () => {
  resetMemory();
  setFetchImpl(null);
  const res = await handleRequest(req("/health"), { ...ENV, INBOX_TO: "secret-inbox@example.com" });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.hasInbox, true);
  assert.equal(body.version, VERSION);
  const dump = JSON.stringify(body);
  assert.equal(dump.includes("secret-inbox"), false);
  assert.equal(dump.includes("nolegoafrica"), false);
});


test("a member token cannot call /v1/admin/flags", async () => {
  resetMemory();
  setFetchImpl(async (url) => {
    if (String(url).includes("accounts:lookup")) {
      return new Response(JSON.stringify({ users: [{ localId: "user_a", email: "a@x.com" }] }), { status: 200 });
    }
    return new Response("{}", { status: 403 });
  });
  const res = await handleRequest(
    req("/v1/admin/flags", {
      method: "POST",
      headers: { Authorization: "Bearer tok", "Content-Type": "application/json" },
      body: JSON.stringify({ broadcast_enabled: false }),
    }),
    ENV,
  );
  assert.equal(res.status, 403);
  const body = await res.json();
  assert.equal(body.ok, false);
  assert.match(String(body.error || ""), /operator/i);
  setFetchImpl(null);
});

test("a member token cannot call /v1/admin/user-action", async () => {
  resetMemory();
  setFetchImpl(async (url) => {
    if (String(url).includes("accounts:lookup")) {
      return new Response(JSON.stringify({ users: [{ localId: "user_a", email: "member@x.com" }] }), { status: 200 });
    }
    return new Response("{}", { status: 403 });
  });
  const res = await handleRequest(
    req("/v1/admin/user-action", {
      method: "POST",
      headers: { Authorization: "Bearer tok", "Content-Type": "application/json" },
      body: JSON.stringify({ uid: "someone", action: "suspend" }),
    }),
    ENV,
  );
  assert.equal(res.status, 403);
  setFetchImpl(null);
});

test("an operator custom claim can call /v1/admin/status", async () => {
  resetMemory();
  setFetchImpl(async (url) => {
    if (String(url).includes("accounts:lookup")) {
      return new Response(JSON.stringify({
        users: [{ localId: "claim_op", email: "desk@x.com", customAttributes: JSON.stringify({ operator: true }) }],
      }), { status: 200 });
    }
    if (String(url).includes("oauth2.googleapis.com/token")) {
      return new Response(JSON.stringify({ access_token: "sa", expires_in: 3600 }), { status: 200 });
    }
    return new Response("{}", { status: 200 });
  });
  const res = await handleRequest(
    req("/v1/admin/status", { headers: { Authorization: "Bearer tok" } }),
    ENV,
  );
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.operator, true);
  assert.equal(body.uid, "claim_op");
  setFetchImpl(null);
});

function mockOperatorLookup(extra) {
  setFetchImpl(async (url) => {
    if (String(url).includes("accounts:lookup")) {
      return new Response(JSON.stringify({
        users: [Object.assign({
          localId: ENV.OPERATOR_UID,
          email: "magjoed@gmail.com",
          emailVerified: true,
        }, extra || {})],
      }), { status: 200 });
    }
    return new Response("{}", { status: 200 });
  });
}

test("admin password is required after it is set", async () => {
  resetMemory();
  mockOperatorLookup();
  const headers = { Authorization: "Bearer tok", "Content-Type": "application/json" };
  let res = await handleRequest(
    req("/v1/admin/flags", { method: "POST", headers, body: JSON.stringify({ toga_enabled: false }) }),
    ENV,
  );
  assert.equal(res.status, 200);

  res = await handleRequest(
    req("/v1/admin/password", { method: "POST", headers, body: JSON.stringify({ next_password: "correcthorse" }) }),
    ENV,
  );
  assert.equal(res.status, 200);

  res = await handleRequest(
    req("/v1/admin/flags", { method: "POST", headers, body: JSON.stringify({ toga_enabled: true }) }),
    ENV,
  );
  assert.equal(res.status, 401);

  res = await handleRequest(
    req("/v1/admin/flags", {
      method: "POST",
      headers: Object.assign({ "X-Naluno-Admin": "wrong-password" }, headers),
      body: JSON.stringify({ toga_enabled: true }),
    }),
    ENV,
  );
  assert.equal(res.status, 401);

  res = await handleRequest(
    req("/v1/admin/flags", {
      method: "POST",
      headers: Object.assign({ "X-Naluno-Admin": "correcthorse" }, headers),
      body: JSON.stringify({ toga_enabled: true }),
    }),
    ENV,
  );
  assert.equal(res.status, 200);
  setFetchImpl(null);
});

test("unverified operator email is not enough", async () => {
  resetMemory();
  setFetchImpl(async (url) => {
    if (String(url).includes("accounts:lookup")) {
      return new Response(JSON.stringify({
        users: [{ localId: "intruder", email: "magjoed@gmail.com", emailVerified: false }],
      }), { status: 200 });
    }
    return new Response("{}", { status: 200 });
  });
  const res = await handleRequest(
    req("/v1/admin/status", { headers: { Authorization: "Bearer tok" } }),
    ENV,
  );
  assert.equal(res.status, 403);
  setFetchImpl(null);
});

test("verified operator email still opens status so the admin is not locked out", async () => {
  resetMemory();
  setFetchImpl(async (url) => {
    if (String(url).includes("accounts:lookup")) {
      return new Response(JSON.stringify({
        users: [{ localId: "rebuilt_uid", email: "magjoed@gmail.com", emailVerified: true }],
      }), { status: 200 });
    }
    return new Response("{}", { status: 200 });
  });
  const res = await handleRequest(
    req("/v1/admin/status", { headers: { Authorization: "Bearer tok" } }),
    ENV,
  );
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.operator, true);
  setFetchImpl(null);
});

test("handle check blocks reserved names and allows ordinary ones", async () => {
  resetMemory();
  setFetchImpl(async (url) => {
    if (String(url).includes("firestore.googleapis.com")) {
      return new Response("{}", { status: 404 });
    }
    return new Response("{}", { status: 404 });
  });
  const blocked = await handleRequest(req("/v1/handle/check?h=Naluno"), ENV);
  const b = await blocked.json();
  assert.equal(b.ok, false);
  assert.equal(b.code, "reserved");
  assert.match(b.error, /reserved and cannot be claimed/i);
  assert.equal(b.similar, undefined);

  const underscore = await handleRequest(req("/v1/handle/check?h=n_aluno"), ENV);
  const u = await underscore.json();
  assert.equal(u.ok, false);
  assert.equal(u.code, "reserved");

  const ok = await handleRequest(req("/v1/handle/check?h=amina"), ENV);
  const a = await ok.json();
  assert.equal(a.ok, true);
  assert.equal(a.handle, "amina");
  setFetchImpl(null);
});

test("handle claim refuses reserved names and logs a flag", async () => {
  resetMemory();
  setFetchImpl(async (url) => {
    if (String(url).includes("accounts:lookup")) {
      return new Response(JSON.stringify({ users: [{ localId: "user_a" }] }), { status: 200 });
    }
    return new Response("{}", { status: 404 });
  });
  const res = await handleRequest(
    req("/v1/handle/claim", {
      method: "POST",
      headers: { Authorization: "Bearer tok", "Content-Type": "application/json" },
      body: JSON.stringify({ handle: "nalunosupport" }),
    }),
    ENV,
  );
  assert.equal(res.status, 409);
  const body = await res.json();
  assert.equal(body.reserved, true);
  assert.match(body.error, /reserved and cannot be claimed/i);
  const flags = Array.from(getMemory().handleFlags.values());
  assert.ok(flags.some((f) => f.kind === "reserved-block" && f.handle === "nalunosupport"));
  setFetchImpl(null);
});

test("handle claim allows a free name and flags a lookalike", async () => {
  resetMemory();
  setFetchImpl(async (url) => {
    if (String(url).includes("accounts:lookup")) {
      return new Response(JSON.stringify({ users: [{ localId: "user_a" }] }), { status: 200 });
    }
    return new Response("{}", { status: 404 });
  });
  const res = await handleRequest(
    req("/v1/handle/claim", {
      method: "POST",
      headers: { Authorization: "Bearer tok", "Content-Type": "application/json" },
      body: JSON.stringify({ handle: "nalun0" }),
    }),
    ENV,
  );
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.handle, "nalun0");
  const flags = Array.from(getMemory().handleFlags.values());
  assert.ok(flags.some((f) => f.handle === "nalun0" && f.kind === "similar"));
  setFetchImpl(null);
});

test("two claims of the same handle cannot both win", async () => {
  resetMemory();
  setFetchImpl(async (url) => {
    if (String(url).includes("accounts:lookup")) {
      return new Response(JSON.stringify({ users: [{ localId: "user_a" }] }), { status: 200 });
    }
    return new Response("{}", { status: 404 });
  });
  const first = await handleRequest(
    req("/v1/handle/claim", {
      method: "POST",
      headers: { Authorization: "Bearer tok", "Content-Type": "application/json" },
      body: JSON.stringify({ handle: "kato" }),
    }),
    ENV,
  );
  assert.equal((await first.json()).ok, true);
  setFetchImpl(async (url) => {
    if (String(url).includes("accounts:lookup")) {
      return new Response(JSON.stringify({ users: [{ localId: "user_b" }] }), { status: 200 });
    }
    return new Response("{}", { status: 404 });
  });
  const second = await handleRequest(
    req("/v1/handle/claim", {
      method: "POST",
      headers: { Authorization: "Bearer tok2", "Content-Type": "application/json" },
      body: JSON.stringify({ handle: "kato" }),
    }),
    ENV,
  );
  assert.equal(second.status, 409);
  const body = await second.json();
  assert.equal(body.taken, true);
  setFetchImpl(null);
});

test("operator can seed, add, list and remove reserved handles", async () => {
  resetMemory();
  setFetchImpl(async (url) => {
    if (String(url).includes("accounts:lookup")) {
      return new Response(JSON.stringify({
        users: [{ localId: ENV.OPERATOR_UID, email: "magjoed@gmail.com", emailVerified: true }],
      }), { status: 200 });
    }
    return new Response("{}", { status: 200 });
  });
  const headers = { Authorization: "Bearer tok", "Content-Type": "application/json" };
  const seed = await handleRequest(req("/v1/admin/handles/seed", { method: "POST", headers, body: "{}" }), ENV);
  const seeded = await seed.json();
  assert.equal(seeded.ok, true);
  assert.ok(seeded.total >= SEED_RESERVED.length);

  const add = await handleRequest(
    req("/v1/admin/handles", {
      method: "POST",
      headers,
      body: JSON.stringify({ handle: "nalunostudio", category: "official", reason: "Studio" }),
    }),
    ENV,
  );
  assert.equal((await add.json()).ok, true);

  const list = await handleRequest(req("/v1/admin/handles", { headers }), ENV);
  const listed = await list.json();
  assert.equal(listed.ok, true);
  assert.ok(listed.reserved.some((r) => r.handle === "naluno" && r.category === "official"));
  assert.ok(listed.reserved.some((r) => r.handle === "nalunostudio"));

  const drop = await handleRequest(
    req("/v1/admin/handles/remove", {
      method: "POST",
      headers,
      body: JSON.stringify({ handle: "nalunostudio", reason: "no longer used" }),
    }),
    ENV,
  );
  assert.equal((await drop.json()).ok, true);
  const after = await (await handleRequest(req("/v1/admin/handles", { headers }), ENV)).json();
  assert.ok(!after.reserved.some((r) => r.handle === "nalunostudio"));
  assert.equal(normHandle("NALUNO"), "naluno");
  assert.ok(matchReserved("naluno_help", SEED_RESERVED));
  setFetchImpl(null);
});
