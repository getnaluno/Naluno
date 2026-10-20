/* What Naluno measures, and how (20 Oct c).
 *
 * Counts, times and outcomes — never words, pictures, sound, search text
 * or a phone's location. Each phone sends small batches of events; this
 * worker checks every event against the catalogue below (an event or a
 * value that is not in it is dropped), then:
 *   - adds them to that day's totals (measureDays/{YYYY-MM-DD}), kept;
 *   - keeps the batch as sent (measureBatches/{id}) for 180 days, so the
 *     desk can look closer, then deletes it (runMeasureSweep).
 * The country of the network a batch came from (Cloudflare's own reading,
 * a country code only) is added to the day's totals for some events. A
 * person's chosen country is on their profile.
 */

export const MEASURE_KEEP_DAYS = 180;
export const MEASURE_MAX_EVENTS = 100;

/* Bucket labels a phone may send. */
const B = {
  len: ["lt1m", "1to5m", "5to20m", "20mplus"],
  ring: ["lt5s", "5to15s", "15to30s", "30splus", "none"],
  lag: ["lt2s", "2to10s", "10to60s", "1to10m", "10mplus"],
  slow: ["lt1m", "1to10m", "10to60m", "1hplus"],
  wait: ["lt1h", "1to24h", "1to7d", "7dplus"],
  vlen: ["lt10s", "10to30s", "30to60s", "1to2m", "2mplus"],
  count: ["0", "1to2", "3to9", "10plus"],
  people: ["1", "2", "3to5", "6to12", "13to50", "51plus"],
  ms: ["lt1s", "1to2s", "2to4s", "4to8s", "8splus"],
  pub: ["lt10s", "10to30s", "30to120s", "2mplus"],
  live: ["lt5m", "5to15m", "15to60m", "1hplus"],
  bit: ["0", "1"],
};
const LANG = /^[a-z]{2,3}(-[a-z]{2,3})?$/;
const BUILD = /^\d{8}[a-z]$/;
const TOPIC = /^[a-z0-9-]{1,24}$/;
const one = (list) => (v) => list.indexOf(v) >= 0;

/* name -> { key: check }. A value that fails its check is dropped. */
export const CATALOGUE = {
  /* calls */
  call_end: {
    role: one(["caller", "callee"]), kind: one(["audio", "video"]),
    outcome: one(["connected", "missed", "declined", "cancelled", "failed", "busy"]),
    len: one(B.len), ring: one(B.ring), end: one(["hangup", "network", "closed", "other"]),
    path: one(["direct", "relay", "unknown"]), net: one(["wifi", "cell", "unknown"]),
    videooff: one(B.bit), flip: one(B.bit), pip: one(B.bit),
    freezes: one(B.count), drops: one(B.count), switched: one(["recovered", "lost", "none"]),
  },
  /* Wireline */
  msg_sent: { type: one(["text", "voice", "photo", "video", "file"]), route: one(["online", "queued"]), wait: one(B.slow) },
  msg_delivered: { type: one(["text", "voice", "photo", "video", "file"]), lag: one(B.lag) },
  msg_read: { lag: one(B.slow) },
  voice_note: { len: one(B.vlen), cap: one(B.bit) },
  translate_shown: { from: (v) => LANG.test(v), to: (v) => LANG.test(v) },
  /* Band */
  band_join: {},
  band_send: { kind: one(["text", "audio", "video"]) },
  band_clip: { kind: one(["audio", "video"]), len: one(B.vlen), cap: one(B.bit) },
  band_clip_fail: { kind: one(["audio", "video"]), reason: one(["size", "network", "other"]) },
  /* Broadcast */
  watch_depth: { q: one(["25", "50", "75", "100"]) },
  publish: { kind: one(["video", "photo", "writing", "live"]), ms: one(B.pub) },
  publish_fail: { kind: one(["video", "photo", "writing", "live"]), reason: one(["upload", "reach", "screen", "network", "other"]) },
  composer_abandon: { kind: one(["video", "photo", "writing", "none"]), stage: one(["opened", "picked", "titled"]) },
  live_end: { peak: one(B.people), avg: one(B.people), len: one(B.live), drops: one(B.count), sfu: one(B.bit) },
  strand_add: {},
  pass_on: {},
  circle_join: {},
  offline_save: {},
  replace_media: { kind: one(["cover", "chapter", "live"]) },
  /* Signals */
  signal_post: { aud: one(["public", "connections"]), type: one(["photo", "video", "text"]) },
  signal_view: { done: one(B.bit) },
  signal_swipe: {},
  /* getting connected */
  spark: { stage: one(["start", "done"]) },
  find_search: { found: one(B.bit) },
  connect_request: { stage: one(["sent", "accepted", "declined"]), wait: one(B.wait) },
  first_connection: { since: one(B.wait) },
  /* Lifeline */
  lifeline: { route: one(["relay", "mesh", "sms", "queued"]), ok: one(B.bit), wait: one(B.slow) },
  offline: { len: one(B.slow) },
  /* language */
  listen: { voice: one(["sunbird", "african", "phone", "recording"]), ok: one(B.bit) },
  listen_fallback: { from: one(["sunbird", "african"]), to: one(["african", "phone"]) },
  spark_translate: { stage: one(["used", "abandoned"]) },
  /* onboarding */
  onboard: { step: one(["welcome", "agreed", "country-shown", "country-chosen", "country-skipped", "tour-finished", "tour-skipped", "signup", "callsign", "first-message", "first-call"]) },
  notif_permission: { result: one(["granted", "denied", "default"]) },
  /* app health */
  app_open: { platform: one(["android", "pwa", "browser"]), build: (v) => BUILD.test(v), lang: one(["en", "lg"]), cold: one(B.bit) },
  app_ready: { ms: one(B.ms), first: one(["feed", "frequencies", "other"]) },
  crash_reload: {},
  storage_full: {},
  /* Compass and Find Naluno */
  compass_q: { topic: (v) => TOPIC.test(v), answered: one(B.bit) },
  find_map_open: {},
  find_on: { state: one(["on", "off"]) },
  /* the desk's look at a Screen hold (sent by the console) */
  desk_screen_review: { result: one(["let-out", "take-down"]), reason: one(["single-frame", "found-on-fabric", "other"]) },
};
/* Events allowed before there is a Callsign (welcome, agreement, country). */
export const ANONYMOUS_OK = { onboard: 1, app_open: 1, app_ready: 1, crash_reload: 1, storage_full: 1, notif_permission: 1 };
/* Events whose day totals also count the network's country. */
export const BY_COUNTRY = { app_open: 1, msg_sent: 1, call_end: 1, lifeline: 1, offline: 1, publish: 1, signal_post: 1 };

/* Cleans one event. Returns { n, p } or null. */
export function cleanEvent(ev, signedIn) {
  if (!ev || typeof ev !== "object") return null;
  const n = String(ev.n || "");
  const spec = Object.prototype.hasOwnProperty.call(CATALOGUE, n) ? CATALOGUE[n] : null;
  if (!spec) return null;
  if (!signedIn && !ANONYMOUS_OK[n]) return null;
  const p = {};
  const src = (ev.p && typeof ev.p === "object") ? ev.p : {};
  for (const k of Object.keys(spec)) {
    if (!Object.prototype.hasOwnProperty.call(src, k)) continue;
    const v = String(src[k]);
    if (v.length > 24) continue;
    if (spec[k](v)) p[k] = v;
  }
  return { n, p };
}
function seg(s) { return String(s).replace(/[^A-Za-z0-9]/g, "_").slice(0, 32); }
/* The day totals a batch adds: a flat map of counter -> amount. */
export function dayCounters(events, country) {
  const out = {};
  const add = (k) => { out[k] = (out[k] || 0) + 1; };
  const cc = /^[A-Z]{2}$/.test(String(country || "")) ? String(country) : "";
  for (const e of events) {
    add("n__" + seg(e.n));
    for (const k of Object.keys(e.p)) add("p__" + seg(e.n) + "__" + seg(k) + "__" + seg(e.p[k]));
    if (cc && BY_COUNTRY[e.n]) add("c__" + seg(e.n) + "__" + cc);
  }
  return out;
}
export function measureDayKey(ms) { return new Date(ms).toISOString().slice(0, 10); }

/* Takes a batch from a phone. deps: { now, write(dayKey, counters), keep(batch) }. */
export async function takeMeasureBatch(body, who, deps) {
  const list = Array.isArray(body && body.events) ? body.events.slice(0, MEASURE_MAX_EVENTS) : [];
  const signedIn = !!(who && who.uid);
  const events = [];
  for (const ev of list) { const c = cleanEvent(ev, signedIn); if (c) events.push(c); }
  if (!events.length) return { status: 200, body: { ok: true, kept: 0 } };
  const now = deps.now ? deps.now() : Date.now();
  const country = String((who && who.country) || "").toUpperCase();
  const counters = dayCounters(events, country);
  await deps.write(measureDayKey(now), counters);
  const device = String((body && body.d) || "").replace(/[^A-Za-z0-9-]/g, "").slice(0, 40);
  await deps.keep({
    at: now, expireAt: now + MEASURE_KEEP_DAYS * 86400000,
    uid: signedIn ? String(who.uid).slice(0, 128) : "", device,
    country: /^[A-Z]{2}$/.test(country) ? country : "",
    events: events.map((e) => ({ n: e.n, p: e.p })),
  });
  return { status: 200, body: { ok: true, kept: events.length } };
}
