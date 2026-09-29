/* 29g: what happens after "Continue to pay", end to end with Stripe mocked. */
import assert from "node:assert/strict";
import { handleRequest, resetMemory, setFetchImpl } from "./handler.mjs";
import { payReturnUrl, supportFeeMinor, payoutState, checkoutForm } from "./pay.mjs";

// ---- pure ----
assert.equal(supportFeeMinor(10000, undefined), 0, "no share unless the console sets one");
assert.equal(supportFeeMinor(10000, 10), 1000);
assert.equal(supportFeeMinor(10000, 90), 5000, "capped at half");
assert.equal(supportFeeMinor(1, 10), 0);
assert.deepEqual(payoutState(null), { connected: false, ready: false });
assert.equal(payoutState({ id: "acct_1", charges_enabled: true, payouts_enabled: true, capabilities: { transfers: "active" } }).ready, true);
assert.equal(payoutState({ id: "acct_1", charges_enabled: true, payouts_enabled: false, capabilities: { transfers: "active" } }).ready, false);
const back = payReturnUrl("https://getnaluno.com", { outcome: "return", kind: "support", broadcastId: "bcast1", ref: "sup_abc" });
assert.ok(back.startsWith("https://getnaluno.com/app/?pay=return&k=support&b=bcast1&r=sup_abc"));
assert.ok(back.endsWith("&s={CHECKOUT_SESSION_ID}"));
assert.ok(!payReturnUrl("https://getnaluno.com", { outcome: "cancel", kind: "ad", broadcastId: "<script>" }).includes("script"), "junk ids are dropped");
const f = new URLSearchParams(checkoutForm({ kind: "support", currency: "UGX", amountMinor: 5000, successUrl: "s", cancelUrl: "c", collectPhone: true, customerEmail: "a@b.co", destination: "acct_9", feeMinor: 500 }));
assert.equal(f.get("phone_number_collection[enabled]"), "true");
assert.equal(f.get("customer_email"), "a@b.co");
assert.equal(f.get("payment_intent_data[transfer_data][destination]"), "acct_9");
assert.equal(f.get("payment_intent_data[application_fee_amount]"), "500");

// ---- endpoints ----
const pair = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048,
  publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
const kb = new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey));
let bin = ""; for (let i = 0; i < kb.length; i++) bin += String.fromCharCode(kb[i]);
const pem = "-----BEGIN PRIVATE KEY-----\n" + btoa(bin).replace(/(.{64})/g, "$1\n") + "\n-----END PRIVATE KEY-----\n";
const env = { FIREBASE_PROJECT_ID: "naluno-28a00", FIREBASE_WEB_API_KEY: "k", STRIPE_SECRET_KEY: "sk_test", STRIPE_WEBHOOK_SECRET: "whsec",
  GOOGLE_SERVICE_ACCOUNT: JSON.stringify({ client_email: "sa@x.iam.gserviceaccount.com", private_key: pem, project_id: "naluno-28a00", token_uri: "https://oauth2.googleapis.com/token" }) };
const ROOT = "https://firestore.googleapis.com/v1/projects/naluno-28a00/databases/(default)/documents";
const store = new Map();
const enc = (v) => typeof v === "number" ? (Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v }) : typeof v === "boolean" ? { booleanValue: v } : (v && typeof v === "object") ? { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, enc(x)])) } } : { stringValue: String(v) };
const dec = (v) => ("integerValue" in v ? Number(v.integerValue) : "doubleValue" in v ? v.doubleValue : "booleanValue" in v ? v.booleanValue : "stringValue" in v ? v.stringValue : "nullValue" in v ? null : null);
const stripe = [];
const accounts = {};
setFetchImpl(async (url, opts) => {
  const u = String(url); const method = (opts && opts.method) || "GET";
  if (u.includes("oauth2")) return new Response(JSON.stringify({ access_token: "sa", expires_in: 3600 }), { status: 200 });
  if (u.includes("identitytoolkit")) { const t = JSON.parse(opts.body).idToken; return new Response(JSON.stringify({ users: [{ localId: t.replace("tok-", ""), email: t.replace("tok-", "") + "@mail.test" }] }), { status: 200 }); }
  if (u.startsWith("https://api.stripe.com/v1/")) {
    const path = u.slice("https://api.stripe.com/v1".length);
    const form = opts && opts.body ? Object.fromEntries(new URLSearchParams(opts.body)) : {};
    stripe.push({ method, path, form, idem: opts.headers["Idempotency-Key"] || "" });
    if (path === "/accounts" && method === "POST") { const id = "acct_" + (Object.keys(accounts).length + 1); accounts[id] = { id, charges_enabled: false, payouts_enabled: false, capabilities: { transfers: "inactive" } }; return new Response(JSON.stringify(accounts[id]), { status: 200 }); }
    if (path.startsWith("/accounts/")) { const a = accounts[decodeURIComponent(path.slice(10))]; return new Response(JSON.stringify(a || { error: { message: "no" } }), { status: a ? 200 : 404 }); }
    if (path === "/account_links") return new Response(JSON.stringify({ url: "https://connect.stripe.com/setup/e/" + form.account }), { status: 200 });
    if (path === "/checkout/sessions") return new Response(JSON.stringify({ id: "cs_1", url: "https://checkout.stripe.com/c/pay/cs_1" }), { status: 200 });
  }
  if (u.startsWith(ROOT + "/")) {
    const k = decodeURIComponent(u.slice(ROOT.length + 1).split("?")[0]);
    if (method === "GET") { if (!store.has(k)) return new Response("{}", { status: 404 }); return new Response(JSON.stringify({ name: "x/" + k, fields: Object.fromEntries(Object.entries(store.get(k)).map(([a, b]) => [a, enc(b)])) }), { status: 200 }); }
    if (method === "PATCH") { const cur = store.get(k) || {}; const fl = JSON.parse(opts.body).fields || {}; Object.keys(fl).forEach((x) => { cur[x] = dec(fl[x]); }); store.set(k, cur); return new Response("{}", { status: 200 }); }
  }
  return new Response("{}", { status: 404 });
});
const call = async (path, who, body, method) => {
  const res = await handleRequest(new Request("https://w.example" + path, { method: method || "POST",
    headers: { Authorization: "Bearer tok-" + who, "Content-Type": "application/json" }, body: method === "GET" ? undefined : JSON.stringify(body || {}) }), env);
  return { status: res.status, data: await res.json() };
};
resetMemory();
store.set("economyConfig/flags", { creator_support_enabled: true });
store.set("economyConfig/fxRates", { rates: { USD: 1, UGX: 3700, AED: 3.6725 }, fetchedAt: Date.now() });

// A supporter pays a creator who has not set up payouts: the money goes to
// Naluno's Stripe, the pay page asks for a phone number, and Stripe sends
// the person back to the same Broadcast.
let r = await call("/v1/pay/checkout", "fan", { kind: "support", creator_user_id: "maker", broadcast_id: "bcast1", amount_major: 5000, currency: "UGX", idempotency_key: "sup_1" });
assert.equal(r.data.ok, true, JSON.stringify(r.data));
assert.equal(r.data.url, "https://checkout.stripe.com/c/pay/cs_1");
assert.equal(r.data.direct_to_creator, false);
let sess = stripe.filter((x) => x.path === "/checkout/sessions").pop().form;
assert.equal(sess["phone_number_collection[enabled]"], "true");
assert.equal(sess.customer_email, "fan@mail.test");
assert.ok(sess.success_url.includes("pay=return") && sess.success_url.includes("b=bcast1") && sess.success_url.includes("r=sup_1"));
assert.ok(sess.cancel_url.includes("pay=cancel") && sess.cancel_url.includes("b=bcast1"));
assert.equal(sess["payment_intent_data[transfer_data][destination]"], undefined);

// The creator sets up payouts: an Express account, then Stripe's own page.
r = await call("/v1/pay/connect/status", "maker", null, "GET");
assert.deepEqual([r.data.connected, r.data.ready], [false, false]);
r = await call("/v1/pay/connect", "maker");
assert.equal(r.data.ok, true);
assert.ok(r.data.url.startsWith("https://connect.stripe.com/"));
const made = stripe.find((x) => x.path === "/accounts" && x.method === "POST");
assert.equal(made.form.type, "express");
assert.equal(made.form["metadata[uid]"], "maker");
assert.equal(made.idem, "acct_maker", "tapping twice does not make two accounts");
const link = stripe.filter((x) => x.path === "/account_links").pop().form;
assert.ok(link.return_url.endsWith("/app/?payout=return"));
r = await call("/v1/pay/connect", "maker");
assert.equal(stripe.filter((x) => x.path === "/accounts" && x.method === "POST").length, 1, "second tap reuses the account");
// Not finished on Stripe yet: support still goes to Naluno.
r = await call("/v1/pay/checkout", "fan", { kind: "support", creator_user_id: "maker", broadcast_id: "bcast1", amount_major: 5000, currency: "UGX", idempotency_key: "sup_2" });
assert.equal(r.data.direct_to_creator, false);
// Finished: the account can take transfers. Status says so; support now goes straight to them,
// with the console's share (10%) kept.
accounts.acct_1 = { id: "acct_1", charges_enabled: true, payouts_enabled: true, details_submitted: true, capabilities: { transfers: "active" } };
r = await call("/v1/pay/connect/status", "maker", null, "GET");
assert.equal(r.data.ready, true);
store.set("economyConfig/payouts", { supportFeePct: 10 });
// The Control Centre's "Real payouts" switch is still off: nothing goes to the creator yet.
r = await call("/v1/pay/checkout", "fan", { kind: "support", creator_user_id: "maker", broadcast_id: "bcast1", amount_major: 5000, currency: "UGX", idempotency_key: "sup_2b" });
assert.equal(r.data.direct_to_creator, false, "payouts wait for the console switch");
store.set("economyConfig/flags", { creator_support_enabled: true, real_payouts_enabled: true });
resetMemory();
r = await call("/v1/pay/checkout", "fan", { kind: "support", creator_user_id: "maker", broadcast_id: "bcast1", amount_major: 5000, currency: "UGX", idempotency_key: "sup_3" });
assert.equal(r.data.direct_to_creator, true);
sess = stripe.filter((x) => x.path === "/checkout/sessions").pop().form;
assert.equal(sess["payment_intent_data[transfer_data][destination]"], "acct_1");
const amt = Number(sess["line_items[0][price_data][unit_amount]"]);
assert.equal(Number(sess["payment_intent_data[application_fee_amount]"]), Math.floor(amt * 10 / 100));
// Nobody can pay themselves, and payouts need sign-in.
r = await call("/v1/pay/checkout", "maker", { kind: "support", creator_user_id: "maker", amount_major: 5000, currency: "UGX" });
assert.equal(r.data.ok, false);
const anon = await handleRequest(new Request("https://w.example/v1/pay/connect", { method: "POST" }), env);
assert.equal(anon.status, 401);
// Without Stripe keys nothing starts.
const off = await handleRequest(new Request("https://w.example/v1/pay/connect", { method: "POST", headers: { Authorization: "Bearer tok-maker" } }), Object.assign({}, env, { STRIPE_SECRET_KEY: "" }));
assert.equal(off.status, 503);
setFetchImpl(null);
console.log("pay flow tests passed");
