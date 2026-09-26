import assert from "node:assert";
import {
  verifyStripeSignature,
  applyCheckoutEvent,
  validateCheckout,
  aedMajorToMinor,
  mediaKeysForUser,
  paymentsReady,
} from "./pay.mjs";
import { midsFromSdp, publishTracks, callsReady } from "./live.mjs";

const secret = "whsec_test";
const raw = JSON.stringify({
  id: "evt_1",
  type: "checkout.session.completed",
  data: { object: {
    id: "cs_1",
    payment_status: "paid",
    amount_total: 1000,
    currency: "aed",
    metadata: { kind: "support", payer_uid: "a", creator_user_id: "b", support_id: "sup_1" },
  } },
});

const now = 1_700_000_000_000;
const t = String(Math.floor(now / 1000));
const key = await crypto.subtle.importKey(
  "raw",
  new TextEncoder().encode(secret),
  { name: "HMAC", hash: "SHA-256" },
  false,
  ["sign"]
);
const sigBuf = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(t + "." + raw));
const sig = Array.from(new Uint8Array(sigBuf)).map(function (b) {
  return (b < 16 ? "0" : "") + b.toString(16);
}).join("");

assert.strictEqual(await verifyStripeSignature(raw, "t=" + t + ",v1=" + sig, secret, now), true);
assert.strictEqual(await verifyStripeSignature(raw, "t=" + t + ",v1=deadbeef", secret, now), false);
assert.strictEqual(await verifyStripeSignature(raw, "t=" + (Number(t) - 1000) + ",v1=" + sig, secret, now), false);

const paid = applyCheckoutEvent(JSON.parse(raw));
assert.strictEqual(paid.status, "paid");
assert.strictEqual(paid.amount_minor, 1000);
assert.strictEqual(applyCheckoutEvent({ type: "checkout.session.completed", data: { object: { id: "x", payment_status: "unpaid", metadata: { kind: "ad" } } } }), null);
assert.strictEqual(applyCheckoutEvent({ type: "other" }), null);

assert.strictEqual(validateCheckout({ kind: "support", amount_minor: 100, currency: "AED", creator_user_id: "b" }, "a").error, "That amount cannot be charged");
assert.strictEqual(validateCheckout({ kind: "support", amount_minor: 500, currency: "AED", creator_user_id: "a" }, "a").error, "Pick a creator");
assert.strictEqual(validateCheckout({ kind: "known", amount_minor: 4900, currency: "AED" }, "a").kind, "known");
assert.strictEqual(validateCheckout({ kind: "known", amount_minor: 1000, currency: "AED" }, "a").error, "That is not the monthly amount");
assert.strictEqual(aedMajorToMinor(12.5), 1250);
assert.deepStrictEqual(
  mediaKeysForUser(["https://x/o/u/abc/file.mp4", "u/abc/other.jpg", "u/zzz/nope.mp4"], "abc"),
  ["u/abc/file.mp4", "u/abc/other.jpg"]
);
assert.strictEqual(paymentsReady({}), false);
assert.strictEqual(paymentsReady({ STRIPE_SECRET_KEY: "sk", STRIPE_WEBHOOK_SECRET: "wh" }), true);

const sdp = "v=0\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\na=mid:0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=mid:1\r\n";
assert.strictEqual(publishTracks(sdp).length, 2);
assert.strictEqual(publishTracks(sdp)[0].trackName, "video");
assert.strictEqual(publishTracks(sdp)[1].trackName, "audio");
assert.strictEqual(midsFromSdp(sdp)[1].mid, "1");
assert.strictEqual(callsReady({}), false);

console.log("pay.test ok");
