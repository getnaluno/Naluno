/* Money: prices come from the operator's book, converted on the server at
   the running rate. The phone's number is never what gets charged. */
import assert from "node:assert/strict";
import test from "node:test";
import { handleRequest, resetMemory, setFetchImpl, _resetMoneyCaches } from "./handler.mjs";
import {
  majorToStripe, stripeToMajor, isoDigits, majorToIso, convertMajor, priceIn, readPrice,
} from "./money.mjs";
import { applyCheckoutEvent, validateCheckout } from "./pay.mjs";
import { readFileSync } from "node:fs";

const ENV0 = { FIREBASE_PROJECT_ID: "naluno-28a00", FIREBASE_WEB_API_KEY: "k", OPERATOR_UID: "op1",
  STRIPE_SECRET_KEY: "sk_test", STRIPE_WEBHOOK_SECRET: "whsec" };
const RATES = { USD: 1, AED: 3.6725, UGX: 3700, EUR: 0.9, JPY: 150, KWD: 0.307 };

function req(path, opts = {}) { return new Request("https://naluno-economy.naluno.workers.dev" + path, opts); }
function fsVal(v) {
  if (typeof v === "number") return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === "string") return { stringValue: v };
  if (typeof v === "boolean") return { booleanValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(fsVal) } };
  if (v && typeof v === "object") return { mapValue: { fields: fsFields(v) } };
  return { nullValue: null };
}
function fsFields(o) { const f = {}; Object.keys(o).forEach((k) => { f[k] = fsVal(o[k]); }); return f; }

async function genSaJson() {
  const pair = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey));
  let bin = ""; for (let i = 0; i < pkcs8.length; i++) bin += String.fromCharCode(pkcs8[i]);
  const pem = "-----BEGIN PRIVATE KEY-----\n" + btoa(bin).replace(/(.{64})/g, "$1\n") + "\n-----END PRIVATE KEY-----\n";
  return JSON.stringify({ client_email: "sa@naluno-28a00.iam.gserviceaccount.com", private_key: pem,
    project_id: "naluno-28a00", token_uri: "https://oauth2.googleapis.com/token" });
}
let SA = null;
async function env() { if (!SA) SA = await genSaJson(); return Object.assign({}, ENV0, { GOOGLE_SERVICE_ACCOUNT: SA }); }

function world(docs, log) {
  setFetchImpl(async (url, opts) => {
    const u = String(url);
    const m = (opts && opts.method) || "GET";
    if (u.includes("accounts:lookup")) {
      return new Response(JSON.stringify({ users: [{ localId: "payer1", email: "p@x.y", emailVerified: true }] }), { status: 200 });
    }
    if (u.includes("oauth2.googleapis.com/token")) {
      return new Response(JSON.stringify({ access_token: "sa", expires_in: 3600 }), { status: 200 });
    }
    if (u.includes("api.stripe.com/v1/checkout/sessions")) {
      log.push({ stripe: String(opts.body), key: opts.headers["Idempotency-Key"] });
      return new Response(JSON.stringify({ url: "https://checkout.stripe.com/x" }), { status: 200 });
    }
    if (u.includes("open.er-api.com")) {
      log.push({ liveFx: true });
      return new Response(JSON.stringify({ result: "success", rates: RATES }), { status: 200 });
    }
    if (u.includes("firestore.googleapis.com")) {
      if (m === "GET") {
        for (const k of Object.keys(docs)) {
          if (u.split("?")[0].endsWith(k)) {
            return new Response(JSON.stringify({ name: "x" + k, fields: fsFields(docs[k]) }), { status: 200 });
          }
        }
        return new Response("{}", { status: 404 });
      }
      log.push({ write: u, method: m, body: opts && opts.body });
      return new Response("{}", { status: 200 });
    }
    return new Response("{}", { status: 404 });
  });
}
function formOf(entry) { return new URLSearchParams(entry.stripe); }
async function checkout(body) {
  const res = await handleRequest(req("/v1/pay/checkout", {
    method: "POST", headers: { Authorization: "Bearer t", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }), await env());
  return { status: res.status, body: await res.json() };
}

test("unit rules: UGX and ISK go to Stripe ×100; JPY as is; KWD 3 digits", () => {
  assert.equal(isoDigits("UGX"), 0);
  assert.equal(majorToStripe(51000, "UGX"), 5100000);
  assert.equal(stripeToMajor(5100000, "UGX"), 51000);
  assert.equal(majorToIso(51000, "UGX"), 51000);
  assert.equal(majorToStripe(1200, "JPY"), 1200);
  assert.equal(majorToStripe(15.02, "KWD"), 15020);
  assert.equal(majorToStripe(49, "AED"), 4900);
  assert.ok(Number.isNaN(convertMajor(1, "AED", "ZZZ", RATES)));
  assert.equal(readPrice({ amount: 0, currency: "AED" }), null);
  assert.deepEqual(priceIn(null, "AED", RATES), { error: "not-set" });
});

test("Known is charged from the price book, converted at the running rate", async () => {
  resetMemory(); _resetMoneyCaches();
  const log = [];
  world({
    "/economyConfig/prices": { knownMonthly: { amount: 49, currency: "AED" } },
    "/economyConfig/fxRates": { rates: RATES, fetchedAt: Date.now() },
    "/knownApps/payer1": { status: "accepted" },
  }, log);
  const r = await checkout({ kind: "known", currency: "UGX", amount_minor: 1 });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const f = formOf(log.find((x) => x.stripe));
  const expectMajor = Math.round(49 / 3.6725 * 3700);
  assert.equal(f.get("line_items[0][price_data][currency]"), "ugx");
  assert.equal(Number(f.get("line_items[0][price_data][unit_amount]")), expectMajor * 100, "UGX sent ×100");
  assert.equal(f.get("metadata[book_amount]"), "49");
  assert.equal(f.get("metadata[book_currency]"), "AED");
  setFetchImpl(null);
});

test("a phone asking for a cheap Known month is ignored", async () => {
  resetMemory(); _resetMoneyCaches();
  const log = [];
  world({
    "/economyConfig/prices": { knownMonthly: { amount: 49, currency: "AED" } },
    "/economyConfig/fxRates": { rates: RATES, fetchedAt: Date.now() },
    "/knownApps/payer1": { status: "known" },
  }, log);
  const r = await checkout({ kind: "known", currency: "USD", amount_minor: 50, book_minor: 4900 });
  assert.equal(r.status, 200);
  const f = formOf(log.find((x) => x.stripe));
  assert.equal(Number(f.get("line_items[0][price_data][unit_amount]")), Math.round(49 / 3.6725 * 100));
  setFetchImpl(null);
});

test("a stale on-screen price is caught instead of charged", async () => {
  resetMemory(); _resetMoneyCaches();
  const log = [];
  world({
    "/economyConfig/prices": { knownMonthly: { amount: 49, currency: "AED" } },
    "/economyConfig/fxRates": { rates: RATES, fetchedAt: Date.now() },
    "/knownApps/payer1": { status: "accepted" },
  }, log);
  const r = await checkout({ kind: "known", currency: "AED", amount_major: 30 });
  assert.equal(r.status, 409);
  assert.equal(r.body.code, "price_changed");
  assert.equal(r.body.amount_major, 49);
  assert.ok(!log.some((x) => x.stripe));
  setFetchImpl(null);
});

test("no price in the book: nothing is charged and the reason is plain", async () => {
  resetMemory(); _resetMoneyCaches();
  const log = [];
  world({ "/economyConfig/fxRates": { rates: RATES, fetchedAt: Date.now() }, "/knownApps/payer1": { status: "accepted" } }, log);
  const r = await checkout({ kind: "known", currency: "AED" });
  assert.equal(r.status, 503);
  assert.match(r.body.error, /price is not set/);
  assert.ok(!log.some((x) => x.stripe));
  setFetchImpl(null);
});

test("old rate book is refreshed from the live source", async () => {
  resetMemory(); _resetMoneyCaches();
  const log = [];
  world({
    "/economyConfig/prices": { knownMonthly: { amount: 10, currency: "USD" } },
    "/economyConfig/fxRates": { rates: { USD: 1, EUR: 0.1 }, fetchedAt: Date.now() - 5 * 86400000 },
    "/knownApps/payer1": { status: "accepted" },
  }, log);
  const r = await checkout({ kind: "known", currency: "EUR" });
  assert.equal(r.status, 200);
  assert.ok(log.some((x) => x.liveFx));
  const f = formOf(log.find((x) => x.stripe));
  assert.equal(Number(f.get("line_items[0][price_data][unit_amount]")), 900);
  setFetchImpl(null);
});

test("ads follow the running currency, from the AED book", async () => {
  resetMemory(); _resetMoneyCaches();
  const log = [];
  world({
    "/economyConfig/fxRates": { rates: RATES, fetchedAt: Date.now() },
    "/deskAds/ad_1234": { paidAed: 367.25, creatorUid: "payer1" },
  }, log);
  const r = await checkout({ kind: "ad", ad_id: "ad_1234", currency: "USD", amount_minor: 1 });
  assert.equal(r.status, 200);
  const f = formOf(log.find((x) => x.stripe));
  assert.equal(f.get("line_items[0][price_data][currency]"), "usd");
  assert.equal(Number(f.get("line_items[0][price_data][unit_amount]")), 10000);
  setFetchImpl(null);
});

test("support: the chosen amount, in the chosen currency, with UGX sent right", async () => {
  const v = validateCheckout({ kind: "support", currency: "UGX", amount_major: 20000, creator_user_id: "b" }, "a");
  assert.equal(v.amountMajor, 20000);
  const legacy = validateCheckout({ kind: "support", currency: "UGX", amount_minor: 20000, creator_user_id: "b" }, "a");
  assert.equal(legacy.amountMajor, 20000, "old phones send ISO minor units");
  assert.equal(validateCheckout({ kind: "support", currency: "AED", amount_major: 0, creator_user_id: "b" }, "a").error, "That amount cannot be charged");
});

test("webhook: a payment in the wrong currency or short does not grant anything", async () => {
  const good = applyCheckoutEvent({ type: "checkout.session.completed", data: { object: {
    id: "cs_1", payment_status: "paid", amount_total: 5100000, currency: "ugx",
    metadata: { kind: "known", payer_uid: "u", expected_amount: "5100000", expected_currency: "ugx", book_amount: "49", book_currency: "AED" },
  } } });
  assert.equal(good.amount_major, 51000);
  assert.equal(good.amount_minor, 51000);
  assert.equal(good.expected_currency, "UGX");

  resetMemory(); _resetMoneyCaches();
  for (const [cur, amt, grant] of [["ugx", 5100000, true], ["usd", 5100000, false], ["ugx", 510000, false]]) {
    const log = [];
    world({ "/knownApps/u": { status: "accepted" } }, log);
    const handler = await import("./handler.mjs");
    const event = { type: "checkout.session.completed", data: { object: {
      id: "cs_" + cur + amt, payment_status: "paid", amount_total: amt, currency: cur,
      metadata: { kind: "known", payer_uid: "u", expected_amount: "5100000", expected_currency: "ugx" },
    } } };
    const raw = JSON.stringify(event);
    const t = String(Math.floor(Date.now() / 1000));
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode("whsec"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const sig = Array.from(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(t + "." + raw))))
      .map((b) => (b < 16 ? "0" : "") + b.toString(16)).join("");
    const res = await handler.handleRequest(req("/v1/pay/webhook", {
      method: "POST", headers: { "Stripe-Signature": "t=" + t + ",v1=" + sig }, body: raw,
    }), await env());
    assert.equal(res.status, 200);
    const granted = log.some((x) => x.write && x.write.includes("/knownApps/u") && x.body.includes('"known"'));
    assert.equal(granted, grant, cur + " " + amt);
    setFetchImpl(null);
  }
});

test("no price is written into the payment code", () => {
  const pay = readFileSync(new URL("./pay.mjs", import.meta.url), "utf8");
  const h = readFileSync(new URL("./handler.mjs", import.meta.url), "utf8");
  assert.ok(!/KNOWN_MONTH_MINOR|4900/.test(pay + h));
});

/* ---------- adversary ---------- */
async function webhook(event) {
  const handler = await import("./handler.mjs");
  const raw = JSON.stringify(event);
  const t = String(Math.floor(Date.now() / 1000));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode("whsec"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = Array.from(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(t + "." + raw))))
    .map((b) => (b < 16 ? "0" : "") + b.toString(16)).join("");
  return handler.handleRequest(req("/v1/pay/webhook", { method: "POST", headers: { "Stripe-Signature": "t=" + t + ",v1=" + sig }, body: raw }), await env());
}
function sess(id, cur, amt, meta) {
  return { type: "checkout.session.completed", data: { object: { id, payment_status: "paid", amount_total: amt, currency: cur, metadata: meta } } };
}

test("adversary: a session opened by the previous worker still grants once (paid customers are not stranded)", async () => {
  resetMemory(); _resetMoneyCaches();
  const log = []; world({ "/knownApps/u": { status: "accepted" } }, log);
  await webhook(sess("cs_legacy", "aed", 4900, { kind: "known", payer_uid: "u", book_minor: "4900" }));
  assert.ok(log.some((x) => x.write && x.write.includes("/knownApps/u") && x.body.includes('"known"')));
  setFetchImpl(null);
});

test("adversary: a session with neither the new nor the old server marks grants nothing", async () => {
  resetMemory(); _resetMoneyCaches();
  const log = []; world({ "/knownApps/u": { status: "accepted" } }, log);
  await webhook(sess("cs_bare", "usd", 50, { kind: "known", payer_uid: "u" }));
  assert.ok(!log.some((x) => x.write && x.write.includes("/knownApps/u")));
  setFetchImpl(null);
});

test("adversary: forged signature is refused", async () => {
  const handler = await import("./handler.mjs");
  resetMemory(); _resetMoneyCaches(); world({}, []);
  const res = await handler.handleRequest(req("/v1/pay/webhook", { method: "POST", headers: { "Stripe-Signature": "t=1,v1=00" },
    body: JSON.stringify(sess("x", "aed", 1, { kind: "known", payer_uid: "u", expected_amount: "1", expected_currency: "aed" })) }), await env());
  assert.equal(res.status, 400);
  setFetchImpl(null);
});

test("adversary: unknown currency, missing rate, silly amounts", async () => {
  resetMemory(); _resetMoneyCaches();
  const log = [];
  world({ "/economyConfig/prices": { knownMonthly: { amount: 49, currency: "AED" } },
    "/economyConfig/fxRates": { rates: { USD: 1, AED: 3.67 }, fetchedAt: Date.now() }, "/knownApps/payer1": { status: "accepted" } }, log);
  let r = await checkout({ kind: "known", currency: "XYZ" });
  assert.equal(r.status, 503, "no rate for XYZ: nothing charged");
  r = await checkout({ kind: "known", currency: "12" });
  assert.equal(r.status, 400);
  r = await checkout({ kind: "support", currency: "AED", amount_major: -5, creator_user_id: "c" });
  assert.equal(r.status, 400);
  r = await checkout({ kind: "support", currency: "AED", amount_major: 1e12, creator_user_id: "c" });
  assert.equal(r.status, 400);
  r = await checkout({ kind: "support", currency: "AED", amount_major: 5, creator_user_id: "payer1" });
  assert.equal(r.status, 400, "cannot support yourself");
  assert.ok(!log.some((x) => x.stripe));
  setFetchImpl(null);
});

test("adversary: Known for someone not accepted is refused before any charge", async () => {
  resetMemory(); _resetMoneyCaches();
  const log = [];
  world({ "/economyConfig/prices": { knownMonthly: { amount: 49, currency: "AED" } },
    "/economyConfig/fxRates": { rates: RATES, fetchedAt: Date.now() }, "/knownApps/payer1": { status: "applied" } }, log);
  const r = await checkout({ kind: "known", currency: "AED" });
  assert.equal(r.status, 403);
  assert.ok(!log.some((x) => x.stripe));
  setFetchImpl(null);
});

test("adversary: someone else's ad cannot be paid into", async () => {
  resetMemory(); _resetMoneyCaches();
  const log = [];
  world({ "/economyConfig/fxRates": { rates: RATES, fetchedAt: Date.now() }, "/deskAds/ad_9999": { paidAed: 100, creatorUid: "other" } }, log);
  const r = await checkout({ kind: "ad", ad_id: "ad_9999", currency: "AED" });
  assert.equal(r.status, 403);
  setFetchImpl(null);
});
