import { isoToMajor, majorToIso, stripeToMajor } from "./money.mjs";

/**
 * Payments. The phone never decides that money moved.
 * A Checkout session is opened only when Stripe and the service account
 * are both configured. A row becomes paid only after the webhook signature
 * checks out and Stripe says the session is paid.
 */

export function paymentsReady(env) {
  return !!(env && env.STRIPE_SECRET_KEY && env.STRIPE_WEBHOOK_SECRET);
}

export function aedMajorToMinor(major) {
  const n = Number(major);
  if (!isFinite(n) || n <= 0) return 0;
  return Math.round(n * 100);
}

export function checkoutForm(fields) {
  const p = new URLSearchParams();
  const cur = String(fields.currency || "").toLowerCase();
  p.set("mode", "payment");
  p.set("success_url", fields.successUrl);
  p.set("cancel_url", fields.cancelUrl);
  p.set("client_reference_id", String(fields.ref || "").slice(0, 200));
  p.set("metadata[kind]", fields.kind);
  p.set("metadata[payer_uid]", fields.payerUid || "");
  p.set("metadata[creator_user_id]", fields.creatorUid || "");
  p.set("metadata[ad_id]", fields.adId || "");
  p.set("metadata[mail_id]", fields.mailId || "");
  p.set("metadata[broadcast_id]", fields.broadcastId || "");
  p.set("metadata[support_id]", fields.supportId || "");
  /* What the server decided to charge. The webhook checks the payment
     against these, not against anything the phone said. */
  p.set("metadata[expected_amount]", String(fields.amountMinor));
  p.set("metadata[expected_currency]", cur);
  p.set("metadata[book_amount]", fields.bookAmount != null ? String(fields.bookAmount) : "");
  p.set("metadata[book_currency]", fields.bookCurrency ? String(fields.bookCurrency).toUpperCase() : "");
  p.set("line_items[0][quantity]", "1");
  p.set("line_items[0][price_data][currency]", cur);
  p.set("line_items[0][price_data][unit_amount]", String(fields.amountMinor));
  p.set("line_items[0][price_data][product_data][name]", fields.name || "Naluno");
  return p.toString();
}

/** Shape check only. Amounts for Known and ads are decided on the server
 *  from the operator's price book at the running rate. */
export function validateCheckout(body, payerUid) {
  const kind = String((body && body.kind) || "");
  const currency = String((body && body.currency) || "").toLowerCase();
  if (kind !== "support" && kind !== "ad" && kind !== "known") return { error: "Unknown payment" };
  if (!/^[a-z]{3}$/.test(currency)) return { error: "Unknown currency" };
  if (kind === "support") {
    const creator = String((body && body.creator_user_id) || "");
    if (!creator || creator === payerUid) return { error: "Pick a creator" };
    let major = Number(body && body.amount_major);
    if (!(major > 0) && body && body.amount_minor != null) major = isoToMajor(Number(body.amount_minor), currency);
    if (!(major > 0) || !isFinite(major) || major > 100000000) return { error: "That amount cannot be charged" };
    return { kind, currency, amountMajor: major };
  }
  if (kind === "ad") {
    const adId = String((body && body.ad_id) || "");
    const mailId = String((body && body.mail_id) || "");
    if (adId.length < 4 && mailId.length < 4) return { error: "This ad is not saved yet" };
  }
  return { kind, currency };
}

function safeEqual(a, b) {
  const x = String(a || "");
  const y = String(b || "");
  if (x.length !== y.length) return false;
  let out = 0;
  for (let i = 0; i < x.length; i++) out |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return out === 0;
}

async function hmacHex(secret, msg) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(msg));
  return Array.from(new Uint8Array(sig)).map(function (b) {
    return (b < 16 ? "0" : "") + b.toString(16);
  }).join("");
}

export async function verifyStripeSignature(raw, header, secret, nowMs) {
  if (!raw || !header || !secret) return false;
  const parts = {};
  String(header).split(",").forEach(function (bit) {
    const i = bit.indexOf("=");
    if (i < 1) return;
    const k = bit.slice(0, i).trim();
    const v = bit.slice(i + 1).trim();
    if (!parts[k]) parts[k] = [];
    parts[k].push(v);
  });
  const t = parts.t && parts.t[0];
  const v1 = parts.v1 || [];
  if (!t || !v1.length) return false;
  const ts = Number(t);
  if (!isFinite(ts)) return false;
  const now = Math.floor(Number(nowMs || Date.now()) / 1000);
  if (Math.abs(now - ts) > 300) return false;
  const expect = await hmacHex(secret, t + "." + raw);
  return v1.some(function (got) { return safeEqual(expect, got); });
}

/** Null unless Stripe says this checkout is paid. */
export function applyCheckoutEvent(event) {
  if (!event || event.type !== "checkout.session.completed") return null;
  const s = (event.data && event.data.object) || {};
  if (s.payment_status !== "paid" || !s.id) return null;
  const meta = s.metadata || {};
  const kind = String(meta.kind || "");
  if (kind !== "support" && kind !== "ad" && kind !== "known") return null;
  const cur = String(s.currency || "").toUpperCase();
  const major = stripeToMajor(Number(s.amount_total) || 0, cur);
  return {
    id: String(s.id),
    status: "paid",
    kind: kind,
    stripe_amount: Number(s.amount_total) || 0,
    amount_major: major,
    /* ISO minor units, the unit the Control Centre reads. */
    amount_minor: majorToIso(major, cur),
    currency: cur,
    expected_amount: Number(meta.expected_amount) || 0,
    expected_currency: String(meta.expected_currency || "").toUpperCase(),
    book_amount: Number(meta.book_amount) || 0,
    book_currency: String(meta.book_currency || "").toUpperCase(),
    /* Sessions opened by the previous worker carry book_minor instead of
       expected_amount. Stripe charged what that server set, so they are
       honoured once, the old way. */
    legacy_book_minor: Math.round(Number(meta.book_minor) || 0),
    payer_uid: String(meta.payer_uid || ""),
    creator_user_id: String(meta.creator_user_id || ""),
    ad_id: String(meta.ad_id || ""),
    mail_id: String(meta.mail_id || ""),
    broadcast_id: String(meta.broadcast_id || ""),
    support_id: String(meta.support_id || ""),
  };
}

export function mediaKeysForUser(urls, uid) {
  const prefix = "u/" + String(uid || "") + "/";
  const out = [];
  (urls || []).forEach(function (raw) {
    const s = String(raw || "");
    const m = s.match(/(?:^|\/o\/)(u\/[^?#\s]+)/);
    const key = m ? decodeURIComponent(m[1]) : (s.indexOf(prefix) === 0 ? s : "");
    if (key.indexOf(prefix) === 0 && out.indexOf(key) < 0) out.push(key);
  });
  return out;
}
