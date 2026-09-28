/**
 * Money on the server. No price lives in code.
 *
 *  - Prices come from economyConfig/prices, which the operator sets in the
 *    Control Centre (Known monthly price, support amounts).
 *  - Exchange rates come from economyConfig/fxRates (published by the
 *    Control Centre from the live book). When that copy is older than a day,
 *    the worker reads the same live book itself.
 *  - Every charge is converted on the server at the running rate into the
 *    currency the person pays in. The phone's number is never trusted.
 *
 * Units:
 *   "major"  = 49.00 AED
 *   "iso"    = ISO 4217 minor units, what the app stores (UGX has 0 digits)
 *   "stripe" = what Stripe's API wants (UGX and ISK are sent ×100)
 */

/* ISO 4217 minor digits that are not 2. Same table as js/currency.js. */
const ISO_ZERO = ["BIF", "CLP", "DJF", "GNF", "ISK", "JPY", "KMF", "KRW", "PYG", "RWF", "UGX", "VND", "VUV", "XAF", "XOF", "XPF"];
const ISO_THREE = ["BHD", "IQD", "JOD", "KWD", "LYD", "OMR", "TND"];

/* Stripe's own rules (docs.stripe.com/currencies). */
const STRIPE_ZERO = ["BIF", "CLP", "DJF", "GNF", "JPY", "KMF", "KRW", "MGA", "PYG", "RWF", "VND", "VUV", "XAF", "XOF", "XPF"];
const STRIPE_WHOLE_AS_TWO = ["UGX", "ISK"];
const STRIPE_THREE = ["BHD", "JOD", "KWD", "OMR", "TND"];

export function normCode(c) {
  const s = String(c || "").trim().toUpperCase();
  return /^[A-Z]{3}$/.test(s) ? s : "";
}

export function isoDigits(code) {
  const c = normCode(code);
  if (ISO_ZERO.indexOf(c) >= 0) return 0;
  if (ISO_THREE.indexOf(c) >= 0) return 3;
  return 2;
}
export function majorToIso(major, code) {
  const d = isoDigits(code);
  return Math.round(Number(major) * Math.pow(10, d));
}
export function isoToMajor(minor, code) {
  const d = isoDigits(code);
  return Number(minor) / Math.pow(10, d);
}

/** Amount Stripe expects, from a major amount. */
export function majorToStripe(major, code) {
  const c = normCode(code);
  const n = Number(major);
  if (!isFinite(n) || n <= 0) return 0;
  if (STRIPE_ZERO.indexOf(c) >= 0) return Math.round(n);
  if (STRIPE_WHOLE_AS_TWO.indexOf(c) >= 0) return Math.round(n) * 100;
  if (STRIPE_THREE.indexOf(c) >= 0) return Math.round(n * 100) * 10;
  return Math.round(n * 100);
}
/** Major amount from what Stripe reports (amount_total). */
export function stripeToMajor(amount, code) {
  const c = normCode(code);
  const n = Number(amount) || 0;
  if (STRIPE_ZERO.indexOf(c) >= 0) return n;
  if (STRIPE_THREE.indexOf(c) >= 0) return n / 1000;
  return n / 100;
}

/** rates: units of each currency per 1 USD. */
export function convertMajor(major, from, to, rates) {
  const a = normCode(from);
  const b = normCode(to);
  const n = Number(major);
  if (!isFinite(n)) return NaN;
  if (!a || !b) return NaN;
  if (a === b) return n;
  const ra = a === "USD" ? 1 : Number(rates && rates[a]);
  const rb = b === "USD" ? 1 : Number(rates && rates[b]);
  if (!(ra > 0) || !(rb > 0)) return NaN;
  return n * (rb / ra);
}

/** Round a converted amount to what the currency can actually be charged in. */
export function roundForCharge(major, code) {
  const c = normCode(code);
  if (STRIPE_ZERO.indexOf(c) >= 0 || STRIPE_WHOLE_AS_TWO.indexOf(c) >= 0) return Math.round(major);
  if (STRIPE_THREE.indexOf(c) >= 0) return Math.round(major * 100) / 100;
  return Math.round(major * 100) / 100;
}

/** Reads a price from the operator's book. Returns null when it is not set. */
export function readPrice(entry) {
  if (!entry || typeof entry !== "object") return null;
  const amount = Number(entry.amount);
  const currency = normCode(entry.currency);
  if (!(amount > 0) || !currency) return null;
  return { amount, currency };
}
export function readSupportPresets(entry) {
  if (!entry || typeof entry !== "object") return null;
  const currency = normCode(entry.currency);
  const list = Array.isArray(entry.amounts) ? entry.amounts.map(Number).filter((n) => n > 0) : [];
  if (!currency || !list.length) return null;
  return { currency, amounts: list.slice(0, 6) };
}

/** The price, in the currency the person pays in, at the running rate. */
export function priceIn(price, payCurrency, rates) {
  if (!price) return { error: "not-set" };
  const to = normCode(payCurrency) || price.currency;
  const raw = convertMajor(price.amount, price.currency, to, rates);
  if (!isFinite(raw) || raw <= 0) return { error: "no-rate" };
  const major = roundForCharge(raw, to);
  return { major, currency: to, stripe: majorToStripe(major, to), iso: majorToIso(major, to) };
}

/** Within a few percent: the phone's rate book can be a few minutes older. */
export function closeEnough(a, b, pct) {
  const x = Number(a), y = Number(b);
  if (!(x > 0) || !(y > 0)) return false;
  return Math.abs(x - y) / y <= (pct || 0.05);
}
