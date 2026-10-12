/* Launch & Capacity (13 Oct a).

   One configuration document per environment, launchConfig/{production|staging},
   written only by this worker (service account) after an operator with the
   console password asks, and read by:
   - the app (public read): which features are on, the media limits it should
     tell people about, whether the guard is restricting anything;
   - the upload worker (public read): the same limits, enforced on the bytes;
   - firestore.rules: feature switches and the live restriction;
   - this worker: registration, the waiting list, the cron guard.

   A registered account is a Callsign profile (users/{uid}). Since 13 Oct a
   profile can only be created with a registration seat (registrations/{uid}),
   which only this worker issues, one at a time against launchState/{env}
   .registered, in a single Firestore commit with a precondition on that
   counter. Nothing here deletes, suspends or changes an existing account.

   Nothing here holds money. Budgets are empty until the desk enters them. */

export const LAUNCH_ENVS = ["production", "staging"];
export const MIB = 1024 * 1024;
export const GIB = 1024 * MIB;

/* Hard technical ceilings of the existing pipeline (signal-worker-index.js):
   a finished Broadcast object is at most 8 GB, a Signal is one POST of at
   most 95 MiB. A phase can lower these; it cannot raise them. */
export const HARD = {
  broadcastObjectBytes: 8 * GIB,
  singlePostBytes: 95 * MIB,
  maxAccounts: 10000000,
  maxVideoSec: 3 * 60 * 60,
  maxLiveSec: 12 * 60 * 60,
};

/* Media limits for one phase. 0 means "no limit of its own" (the existing
   rules still apply: Reach, the 8 GB object, the 95 MiB Signal). */
function media(o) {
  return {
    broadcast: {
      maxVideoBytes: o.bVideoBytes,
      maxVideoSec: o.bVideoSec,
      maxImageBytes: o.imageBytes,
      maxImageSide: o.imageSide,
      uploadsPerDay: o.bPerDay,
      bytesPerDay: o.bBytesDay,
      maxResolution: o.resolution,
    },
    signal: {
      maxVideoBytes: o.sVideoBytes,
      maxVideoSec: o.sVideoSec,
      maxImageBytes: o.imageBytes,
      maxImageSide: o.imageSide,
      uploadsPerDay: o.sPerDay,
      bytesPerDay: o.sBytesDay,
    },
    account: {
      maxStorageBytes: o.storagePerAccount,
      concurrentUploads: o.concurrent,
    },
    live: {
      maxLiveSec: o.liveSec,
      maxSimultaneous: 1,
    },
    formats: {
      video: ["video/mp4", "video/webm", "video/quicktime", "video/3gpp", "video/x-m4v"],
      image: ["image/jpeg", "image/png", "image/webp", "image/gif"],
      audio: ["audio/webm", "audio/mp4", "audio/mpeg", "audio/ogg", "audio/wav", "audio/aac"],
    },
    incompleteUploadHours: 24,
    // A video whose length cannot be read from its file (WebM from the
    // in-app recorder has none) is checked by size only, or refused.
    unreadableDuration: "size-only",
  };
}

/* The phases, redesigned for where Naluno is (13 Oct 2026):
   - 29 accounts already exist, so the spec's 20-account private test is
     behind us; nothing here may lock them out.
   - Google Play: a personal developer account created after 13 Nov 2023
     needs a closed test with at least 12 testers opted in for 14 days in a
     row before it can apply for production.
   - The pipeline today allows an 8 GB, 3-hour Broadcast (Reach gives a new
     Callsign 40 minutes, 3 a day), a 95 MiB / 4-minute Signal, and lives with
     no time limit. Founding keeps exactly that, so deploying this changes
     nothing anyone can do; later phases change limits only when the desk
     activates them, after a warning that lists every limit that goes down.
   Capacity grows by phase; per-video ceilings stay at today's values so a
   phase change never takes away what people already use. The desk can edit
   every number. */
export function defaultPhases() {
  const today = {
    bVideoBytes: 8 * GIB, bVideoSec: 3 * 60 * 60, imageBytes: 25 * MIB, imageSide: 8192,
    bPerDay: 40, bBytesDay: 20 * GIB, resolution: "1080p",
    sVideoBytes: 95 * MIB, sVideoSec: 4 * 60, sPerDay: 100, sBytesDay: 2 * GIB,
    storagePerAccount: 0, concurrent: 3, liveSec: 0,
  };
  return {
    founding: {
      name: "Founding Circle", order: 1,
      purpose: "Where Naluno is now: the 29 founding accounts and room for the 12+ Google Play closed-test testers.",
      maxAccounts: 50, registrationOpen: true, waitlist: true,
      storageAllowanceBytes: 50 * GIB,
      // today: no limit on live length; one creator rarely runs two lives
      media: Object.assign(media(today), { live: { maxLiveSec: 0, maxSimultaneous: 2 } }),
    },
    closed: {
      name: "Play Closed Test", order: 2,
      purpose: "Google Play closed testing: at least 12 testers opted in for 14 days in a row before production access.",
      maxAccounts: 100, registrationOpen: true, waitlist: true,
      storageAllowanceBytes: 100 * GIB,
      media: media(Object.assign({}, today, { storagePerAccount: 25 * GIB, liveSec: 3 * 60 * 60 })),
    },
    beta: {
      name: "Play Open Beta", order: 3,
      purpose: "Open testing on Google Play: anyone can join from the listing. Per-account allowances keep one person from using the shared budget.",
      maxAccounts: 500, registrationOpen: true, waitlist: true,
      storageAllowanceBytes: 250 * GIB,
      media: media(Object.assign({}, today, { bBytesDay: 10 * GIB, storagePerAccount: 20 * GIB, liveSec: 3 * 60 * 60, concurrent: 2 })),
    },
    launch: {
      name: "Public Launch", order: 4,
      purpose: "Production on Google Play. Start at 2,000 and raise as the guardrails allow.",
      maxAccounts: 2000, registrationOpen: true, waitlist: true,
      storageAllowanceBytes: 1000 * GIB,
      media: media(Object.assign({}, today, { bBytesDay: 10 * GIB, storagePerAccount: 20 * GIB, liveSec: 3 * 60 * 60, concurrent: 2 })),
    },
  };
}

export const FEATURES = {
  signals: "Signal publishing",
  broadcasts: "Broadcast publishing",
  live: "Live Broadcast",
  uploads: "Media uploads",
  comments: "Comments and replies",
  questions: "Questions and community contributions",
  bands: "Band creation",
};

export function defaultConfig() {
  const phases = defaultPhases();
  return {
    schema: 1,
    version: 0,
    activePhase: "founding",
    registration: {
      open: phases.founding.registrationOpen,
      emergencyPause: false,
      maxAccounts: phases.founding.maxAccounts,
      waitlist: phases.founding.waitlist,
    },
    features: { signals: true, broadcasts: true, live: true, uploads: true, comments: true, questions: true, bands: true },
    phases: phases,
    media: phases.founding.media,
    guard: {
      thresholds: { watch: 60, warning: 80, critical: 95 },
      budgets: {
        monthlyUsd: 0,            // empty until the desk enters it
        storageBytes: phases.founding.storageAllowanceBytes,
        dailyUploadBytes: 0,
        dailyFirestoreReads: 0,
        dailyR2ClassA: 0,
      },
      autoRestrict: { largeUploads: true, largeUploadBytes: 500 * MIB, newLives: true },
    },
  };
}

/* ---------------- validation ---------------- */

function isInt(n) { return typeof n === "number" && isFinite(n) && Math.floor(n) === n; }
function nonNeg(n) { return isInt(n) && n >= 0; }

export function validateMedia(m, where, errors) {
  const e = function (msg) { errors.push(where + ": " + msg); };
  if (!m || typeof m !== "object") { e("media limits missing"); return; }
  const b = m.broadcast || {}, s = m.signal || {}, a = m.account || {}, l = m.live || {};
  [["broadcast", b], ["signal", s]].forEach(function (pair) {
    const n = pair[0], x = pair[1];
    ["maxVideoBytes", "maxVideoSec", "maxImageBytes", "maxImageSide", "uploadsPerDay", "bytesPerDay"].forEach(function (k) {
      if (!nonNeg(x[k])) e(n + "." + k + " must be a whole number, 0 or more");
    });
  });
  if (b.maxVideoBytes > HARD.broadcastObjectBytes) e("broadcast.maxVideoBytes is above the 8 GB the upload pipeline can join");
  if (b.maxVideoBytes === 0) e("broadcast.maxVideoBytes cannot be 0 (use the 8 GB ceiling for no extra limit)");
  if (s.maxVideoBytes > HARD.singlePostBytes) e("signal.maxVideoBytes is above the 95 MiB a Signal upload can carry");
  if (s.maxVideoBytes === 0) e("signal.maxVideoBytes cannot be 0");
  if (b.maxVideoSec > HARD.maxVideoSec) e("broadcast.maxVideoSec is above 3 hours");
  if (s.maxVideoSec > HARD.maxVideoSec) e("signal.maxVideoSec is above 3 hours");
  if (b.maxImageBytes > HARD.singlePostBytes || s.maxImageBytes > HARD.singlePostBytes) e("an image limit is above 95 MiB");
  if (!nonNeg(a.maxStorageBytes)) e("account.maxStorageBytes must be 0 or more");
  if (!isInt(a.concurrentUploads) || a.concurrentUploads < 1 || a.concurrentUploads > 20) e("account.concurrentUploads must be 1–20");
  if (!nonNeg(l.maxLiveSec) || l.maxLiveSec > HARD.maxLiveSec) e("live.maxLiveSec must be 0 (no limit) to 12 hours");
  if (!isInt(l.maxSimultaneous) || l.maxSimultaneous < 1 || l.maxSimultaneous > 5) e("live.maxSimultaneous must be 1–5");
  if (!isInt(m.incompleteUploadHours) || m.incompleteUploadHours < 1 || m.incompleteUploadHours > 168) e("incompleteUploadHours must be 1–168");
  if (m.unreadableDuration !== "size-only" && m.unreadableDuration !== "reject") e("unreadableDuration must be size-only or reject");
  const f = m.formats || {};
  ["video", "image", "audio"].forEach(function (k) {
    if (!Array.isArray(f[k]) || f[k].some(function (t) { return typeof t !== "string" || !/^(video|image|audio)\/[a-z0-9.+-]{1,40}$/.test(t); })) e("formats." + k + " must be a list of media types");
  });
  if (Array.isArray(f.image) && f.image.indexOf("image/svg+xml") >= 0) e("SVG images are never allowed");
}

export function validateConfig(c) {
  const errors = [];
  if (!c || typeof c !== "object") return { ok: false, errors: ["configuration missing"] };
  const phases = c.phases || {};
  const ids = Object.keys(phases);
  if (!ids.length) errors.push("at least one phase is needed");
  ids.forEach(function (id) {
    const p = phases[id] || {};
    if (!/^[a-z][a-z0-9_-]{1,23}$/.test(id)) errors.push("phase id " + id + " is not a short lowercase name");
    if (typeof p.name !== "string" || !p.name.trim() || p.name.length > 60) errors.push(id + ": name 1–60 characters");
    if (!nonNeg(p.maxAccounts) || p.maxAccounts > HARD.maxAccounts) errors.push(id + ": maxAccounts must be 0–" + HARD.maxAccounts);
    if (typeof p.registrationOpen !== "boolean") errors.push(id + ": registrationOpen must be on or off");
    if (typeof p.waitlist !== "boolean") errors.push(id + ": waitlist must be on or off");
    if (!nonNeg(p.storageAllowanceBytes)) errors.push(id + ": storageAllowanceBytes must be 0 or more");
    validateMedia(p.media, id, errors);
  });
  if (!phases[c.activePhase]) errors.push("the active phase " + c.activePhase + " does not exist");
  const r = c.registration || {};
  if (typeof r.open !== "boolean") errors.push("registration.open must be on or off");
  if (typeof r.emergencyPause !== "boolean") errors.push("registration.emergencyPause must be on or off");
  if (typeof r.waitlist !== "boolean") errors.push("registration.waitlist must be on or off");
  if (!nonNeg(r.maxAccounts) || r.maxAccounts > HARD.maxAccounts) errors.push("registration.maxAccounts must be 0–" + HARD.maxAccounts);
  const f = c.features || {};
  Object.keys(FEATURES).forEach(function (k) { if (typeof f[k] !== "boolean") errors.push("features." + k + " must be on or off"); });
  Object.keys(f).forEach(function (k) { if (!FEATURES[k]) errors.push("features." + k + " is not a feature Naluno has"); });
  validateMedia(c.media, "active limits", errors);
  const g = c.guard || {}, t = g.thresholds || {}, b = g.budgets || {}, a = g.autoRestrict || {};
  if (!(isInt(t.watch) && isInt(t.warning) && isInt(t.critical) && t.watch > 0 && t.watch < t.warning && t.warning < t.critical && t.critical <= 100)) {
    errors.push("thresholds must rise: 0 < watch < warning < critical ≤ 100");
  }
  ["storageBytes", "dailyUploadBytes", "dailyFirestoreReads", "dailyR2ClassA"].forEach(function (k) {
    if (!nonNeg(b[k])) errors.push("budgets." + k + " must be a whole number, 0 = not set");
  });
  if (!(typeof b.monthlyUsd === "number" && isFinite(b.monthlyUsd) && b.monthlyUsd >= 0 && b.monthlyUsd < 1e7)) errors.push("budgets.monthlyUsd must be 0 (not set) or more");
  if (typeof a.largeUploads !== "boolean" || typeof a.newLives !== "boolean") errors.push("autoRestrict switches must be on or off");
  if (!isInt(a.largeUploadBytes) || a.largeUploadBytes < MIB) errors.push("autoRestrict.largeUploadBytes must be at least 1 MiB");
  return { ok: errors.length === 0, errors: errors };
}

/* ---------------- phases ---------------- */

const LIMIT_LABELS = [
  ["broadcast.maxVideoBytes", "Broadcast video size"], ["broadcast.maxVideoSec", "Broadcast video length"],
  ["broadcast.maxImageBytes", "Broadcast image size"], ["broadcast.maxImageSide", "Broadcast image side"],
  ["broadcast.uploadsPerDay", "Broadcast uploads a day"], ["broadcast.bytesPerDay", "Broadcast data a day"],
  ["signal.maxVideoBytes", "Signal video size"], ["signal.maxVideoSec", "Signal video length"],
  ["signal.maxImageBytes", "Signal/photo image size"], ["signal.uploadsPerDay", "Signal uploads a day"],
  ["signal.bytesPerDay", "Signal data a day"], ["account.maxStorageBytes", "Storage per account"],
  ["account.concurrentUploads", "Uploads at once"], ["live.maxLiveSec", "Live length"],
  ["live.maxSimultaneous", "Lives at once"],
];
function pick(m, path) { return path.split(".").reduce(function (o, k) { return o && o[k]; }, m); }

/* What goes down (tighter) and up when moving from one set of limits to
   another. 0 means "no limit of its own", which is the loosest. */
export function compareLimits(from, to) {
  const lowered = [], raised = [];
  LIMIT_LABELS.forEach(function (pair) {
    const a = Number(pick(from, pair[0])) || 0, b = Number(pick(to, pair[0])) || 0;
    if (a === b) return;
    const tighter = (a === 0 && b > 0) || (b > 0 && b < a);
    (tighter ? lowered : raised).push({ key: pair[0], label: pair[1], from: a, to: b });
  });
  return { lowered: lowered, raised: raised };
}

/* Activating a phase: its limits become the active limits, and its
   registration settings become the registration settings. The emergency
   pause is separate and is never cleared by a phase change. */
export function activatePhase(cfg, phaseId) {
  const p = cfg.phases && cfg.phases[phaseId];
  if (!p) throw new Error("unknown phase " + phaseId);
  const next = JSON.parse(JSON.stringify(cfg));
  next.activePhase = phaseId;
  next.media = JSON.parse(JSON.stringify(p.media));
  next.registration = Object.assign({}, next.registration, {
    open: p.registrationOpen,
    maxAccounts: p.maxAccounts,
    waitlist: p.waitlist,
  });
  next.guard = Object.assign({}, next.guard, {
    budgets: Object.assign({}, (next.guard || {}).budgets, { storageBytes: p.storageAllowanceBytes }),
  });
  return next;
}

/* ---------------- registration ---------------- */

export function registrationState(cfg, registered) {
  const r = (cfg && cfg.registration) || {};
  const n = Math.max(0, Number(registered) || 0);
  const max = Math.max(0, Number(r.maxAccounts) || 0);
  const paused = r.emergencyPause === true;
  const open = r.open === true;
  const full = n >= max;
  const accepting = open && !paused && !full;
  let reason = "";
  if (paused) reason = "paused";
  else if (!open) reason = "closed";
  else if (full) reason = "full";
  return {
    accepting: accepting,
    reason: reason,
    waitlist: !accepting && r.waitlist === true,
    registered: n,
    maxAccounts: max,
    remaining: Math.max(0, max - n),
  };
}

export function registrationMessage(state) {
  if (state.accepting) return "";
  const base = state.reason === "full"
    ? "Naluno is full for now. New accounts open again as places are added."
    : (state.reason === "paused"
      ? "New accounts are paused for a moment. If you already have an account, sign in as usual."
      : "New accounts are closed for now. If you already have an account, sign in as usual.");
  return state.waitlist ? base + " You can join the waiting list." : base;
}

/* hasSeat: this uid already holds a seat. hasProfile: a Callsign profile
   already exists (every account made before 13 Oct). Both are let through
   without using a place. */
export function claimDecision(cfg, registered, who) {
  if (who && who.hasSeat) return { ok: true, already: "seat" };
  if (who && who.hasProfile) return { ok: true, already: "profile" };
  const st = registrationState(cfg, registered);
  if (!st.accepting) return { ok: false, reason: st.reason, waitlist: st.waitlist, message: registrationMessage(st) };
  return { ok: true, take: true };
}

/* ---------------- waiting list ---------------- */

export function cleanEmail(raw) {
  const e = String(raw || "").trim().toLowerCase();
  if (e.length < 6 || e.length > 254) return "";
  if (!/^[^\s@<>"']{1,64}@[a-z0-9.-]{1,253}\.[a-z]{2,24}$/.test(e)) return "";
  return e;
}

/* ---------------- guardrails ---------------- */

export function levelFor(pct, t) {
  if (!(pct >= 0)) return "unknown";
  if (pct >= t.critical) return "critical";
  if (pct >= t.warning) return "warning";
  if (pct >= t.watch) return "watch";
  return "normal";
}
const RANK = { unknown: -1, normal: 0, watch: 1, warning: 2, critical: 3 };

/* metrics: { storageBytes, monthCostUsd, todayUploadBytes, todayFirestoreReads, todayR2ClassA }
   each with a source: "measured" | "billed" | "reported" | missing. A budget
   of 0 is "not set" and is skipped, not treated as 0. */
export function evaluateGuard(guard, metrics) {
  const g = guard || {}, b = g.budgets || {}, t = g.thresholds || { watch: 60, warning: 80, critical: 95 };
  const m = metrics || {};
  const items = [];
  function add(key, label, used, limit, source) {
    if (!(limit > 0)) { items.push({ key: key, label: label, used: used == null ? null : used, limit: 0, pct: null, level: "not set", source: source || "" }); return; }
    if (used == null || !(used >= 0)) { items.push({ key: key, label: label, used: null, limit: limit, pct: null, level: "unknown", source: "not measured" }); return; }
    const pct = Math.round((used / limit) * 1000) / 10;
    items.push({ key: key, label: label, used: used, limit: limit, pct: pct, level: levelFor(pct, t), source: source || "" });
  }
  add("storage", "Media storage", m.storageBytes, b.storageBytes, m.storageSource);
  add("monthCost", "Infrastructure cost this month (USD)", m.monthCostUsd, b.monthlyUsd, m.monthCostSource);
  add("uploadToday", "Uploaded today", m.todayUploadBytes, b.dailyUploadBytes, m.uploadSource);
  add("firestoreReads", "Database reads today", m.todayFirestoreReads, b.dailyFirestoreReads, m.firestoreSource);
  add("r2ClassA", "Storage writes today (R2 class A)", m.todayR2ClassA, b.dailyR2ClassA, m.r2Source);
  let level = "normal";
  items.forEach(function (it) { if ((RANK[it.level] || -1) > RANK[level]) level = it.level; });
  const ar = g.autoRestrict || {};
  const critical = level === "critical";
  return {
    level: level,
    items: items,
    restricting: {
      largeUploads: critical && ar.largeUploads === true,
      largeUploadBytes: Number(ar.largeUploadBytes) || 0,
      newLives: critical && ar.newLives === true,
    },
  };
}

/* ---------------- the settings record ---------------- */

/* What changed, for the audit: one row per leaf that differs. */
export function diffSettings(a, b, prefix, out) {
  out = out || [];
  prefix = prefix || "";
  const keys = {};
  Object.keys(a || {}).forEach(function (k) { keys[k] = 1; });
  Object.keys(b || {}).forEach(function (k) { keys[k] = 1; });
  Object.keys(keys).sort().forEach(function (k) {
    if (k === "version" || k === "updatedAt" || k === "updatedBy" || k === "guardState") return;
    const x = a ? a[k] : undefined, y = b ? b[k] : undefined;
    const path = prefix ? prefix + "." + k : k;
    const bothObj = x && y && typeof x === "object" && typeof y === "object" && !Array.isArray(x) && !Array.isArray(y);
    if (bothObj) diffSettings(x, y, path, out);
    else if (JSON.stringify(x) !== JSON.stringify(y)) out.push({ setting: path, from: x === undefined ? null : x, to: y === undefined ? null : y });
  });
  return out;
}

/* A stored config may predate a field; fill what is missing from defaults
   without changing anything that is set. */
export function withDefaults(stored) {
  const d = defaultConfig();
  if (!stored || typeof stored !== "object") return d;
  function fill(base, have) {
    if (have === undefined || have === null) return base;
    if (typeof base !== "object" || Array.isArray(base) || typeof have !== "object" || Array.isArray(have)) return have;
    const out = {};
    Object.keys(base).forEach(function (k) { out[k] = fill(base[k], have[k]); });
    Object.keys(have).forEach(function (k) { if (!(k in out)) out[k] = have[k]; });
    return out;
  }
  const merged = fill(d, stored);
  // phases are the desk's: keep exactly the stored set when there is one
  if (stored.phases && typeof stored.phases === "object" && Object.keys(stored.phases).length) {
    merged.phases = {};
    Object.keys(stored.phases).forEach(function (id) {
      merged.phases[id] = fill(d.phases[id] || d.phases.founding, stored.phases[id]);
    });
  }
  return merged;
}

/* The public part of the config: everything the app and the upload worker
   need; nothing about budgets or counts. */
export function publicView(cfg) {
  return {
    env: cfg.env || "production",
    version: cfg.version || 0,
    activePhase: cfg.activePhase,
    phaseName: (cfg.phases && cfg.phases[cfg.activePhase] && cfg.phases[cfg.activePhase].name) || "",
    features: cfg.features,
    media: cfg.media,
    registration: {
      open: !!(cfg.registration && cfg.registration.open),
      emergencyPause: !!(cfg.registration && cfg.registration.emergencyPause),
      waitlist: !!(cfg.registration && cfg.registration.waitlist),
    },
  };
}
