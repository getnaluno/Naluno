import { isoToMajor, majorToIso, stripeToMajor } from "./money.mjs";

/**
 * Payments. The phone never decides that money moved.
 * A Checkout session is opened only when Stripe and the service account
 * are both configured. A row becomes paid only after the webhook signature
 * checks out and Stripe says the session is paid.
 */

/** A Stripe page the operator can open when Checkout itself will not start.
 *  Only dashboard.stripe.com and connect.stripe.com. Anything else is dropped,
 *  including a lookalike host. */
export function stripeSetupUrl(message) {
  const msg = String(message || "");
  const found = msg.match(/https:\/\/[^\s)'"<>]+/i);
  if (found) {
    const url = found[0].replace(/[.,)]$/, "");
    try {
      const u = new URL(url);
      if (u.protocol !== "https:") return "";
      if (u.hostname !== "dashboard.stripe.com" && u.hostname !== "connect.stripe.com") return "";
      return u.origin + u.pathname + u.search;
    } catch {
      return "";
    }
  }
  if (/activat|onboard|complete your account|signed up for Stripe Connect|live charges/i.test(msg)) {
    return "https://dashboard.stripe.com/account/onboarding";
  }
  return "";
}

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
  /* 29g: Stripe asks for a phone number on the pay page, the email is
     filled in from the sign-in, and a creator who has set up payouts is
     paid straight to their Stripe account. */
  if (fields.collectPhone) p.set("phone_number_collection[enabled]", "true");
  if (fields.customerEmail) p.set("customer_email", String(fields.customerEmail).slice(0, 200));
  if (fields.destination) {
    p.set("payment_intent_data[transfer_data][destination]", fields.destination);
    if (fields.feeMinor > 0) p.set("payment_intent_data[application_fee_amount]", String(fields.feeMinor));
    p.set("metadata[destination]", fields.destination);
  }
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

/* ---- Creator payouts (Stripe Connect, Express accounts) ---- */
export function connectAccountForm(o) {
  const p = new URLSearchParams();
  p.set("type", "express");
  if (o && o.email) p.set("email", String(o.email).slice(0, 200));
  p.set("capabilities[transfers][requested]", "true");
  p.set("business_type", "individual");
  p.set("metadata[uid]", String((o && o.uid) || ""));
  return p.toString();
}
export function accountLinkForm(o) {
  const p = new URLSearchParams();
  p.set("account", o.account);
  p.set("refresh_url", o.refreshUrl);
  p.set("return_url", o.returnUrl);
  p.set("type", "account_onboarding");
  return p.toString();
}
/** What a creator's Stripe account can do right now. */
export function payoutState(acct) {
  if (!acct || !acct.id) return { connected: false, ready: false };
  const caps = acct.capabilities || {};
  const due = (acct.requirements && acct.requirements.currently_due) || [];
  const ready = !!(acct.charges_enabled && acct.payouts_enabled && caps.transfers === "active");
  return {
    connected: true,
    ready,
    details_submitted: !!acct.details_submitted,
    needs: Array.isArray(due) ? due.length : 0,
  };
}
/** The platform's share, from the console setting (percent, 0 when unset). */
export function supportFeeMinor(amountMinor, pct) {
  const a = Math.round(Number(amountMinor) || 0);
  let p = Number(pct);
  if (!isFinite(p) || p <= 0) return 0;
  if (p > 50) p = 50;
  return Math.max(0, Math.min(a - 1, Math.floor(a * p / 100)));
}
/** Where Stripe sends the person back: the Broadcast they paid from. */
export function payReturnUrl(origin, o) {
  const q = new URLSearchParams();
  q.set("pay", o.outcome === "cancel" ? "cancel" : "return");
  q.set("k", String(o.kind || ""));
  if (o.broadcastId && /^[A-Za-z0-9_-]{4,120}$/.test(o.broadcastId)) q.set("b", o.broadcastId);
  if (o.ref && /^[A-Za-z0-9_:.-]{1,150}$/.test(o.ref)) q.set("r", o.ref);
  let url = origin + "/app/?" + q.toString();
  if (o.outcome !== "cancel") url += "&s={CHECKOUT_SESSION_ID}";
  return url;
}

/* Uganda mobile money (MTN / Airtel). The phone never decides that cash
   moved. A request is pending until a signed notice matches this intent. */
export function momoPhone(raw) {
  let d = String(raw || "").replace(/\D/g, "");
  if (d.startsWith("0") && d.length === 10) d = "256" + d.slice(1);
  else if (d.length === 9 && d.charAt(0) === "7") d = "256" + d;
  if (!/^2567\d{8}$/.test(d)) return "";
  return d;
}
export function momoNetworkOf(phone) {
  const p = momoPhone(phone);
  if (!p) return "";
  const pre = p.slice(3, 5);
  if (pre === "76" || pre === "77" || pre === "78" || pre === "79") return "mtn";
  if (pre === "70" || pre === "74" || pre === "75") return "airtel";
  return "";
}
/** { phone, network, tail } or { error }. Never a paid flag. */
export function momoPayer(body) {
  const phone = momoPhone(body && body.phone);
  if (!phone) return { error: "Enter a Uganda mobile-money number. Nothing was charged." };
  const picked = String((body && body.network) || "").toLowerCase();
  const guessed = momoNetworkOf(phone);
  const network = picked === "mtn" || picked === "airtel" ? picked : guessed;
  if (network !== "mtn" && network !== "airtel") return { error: "Choose MTN or Airtel. Nothing was charged." };
  if (guessed && guessed !== network) return { error: "That number is not on the network you chose. Nothing was charged." };
  return { phone, network, tail: phone.slice(-4) };
}
export function momoCollectBody(intent) {
  return {
    amount: String(intent.amount_major),
    currency: String(intent.currency || "UGX"),
    externalId: String(intent.id),
    payer: { partyIdType: "MSISDN", partyId: String(intent.phone) },
    payerMessage: "Naluno",
    payeeNote: String(intent.kind || "naluno"),
  };
}
/** True only when the signature matches and the money matches the stored intent. */
export async function momoNoticeValid(raw, signature, secret, intent) {
  if (!raw || !signature || !secret || !intent || !intent.id) return false;
  const expect = await hmacHex(secret, raw);
  if (!safeEqual(String(signature).trim(), expect)) return false;
  let body;
  try { body = JSON.parse(raw); } catch (_) { return false; }
  if (!body || String(body.intent_id) !== String(intent.id)) return false;
  const st = String(body.status || "").toLowerCase();
  if (st !== "successful" && st !== "paid") return false;
  if (String(body.currency || "").toUpperCase() !== String(intent.currency || "").toUpperCase()) return false;
  const got = Number(body.amount_major);
  const want = Number(intent.amount_major);
  if (!(want > 0) || got !== want) return false;
  return true;
}
