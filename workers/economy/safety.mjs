/**
 * Naluno Trust & Safety.
 * Public Broadcast / Signal / profile text can be scored.
 * Wireline, Band, and calls are a privacy boundary: this module refuses
 * their contents and never echoes them back.
 * Automation never permanently bans. A human decides removal and suspension.
 */

export const SAFETY_VERSION = "1.1.0";

export const PRIVATE_SURFACES = ["wireline", "band", "call", "secret", "dm"];
export const PUBLIC_SURFACES = ["broadcast", "signal", "profile", "comment", "public"];

const FORBIDDEN_KEYS = ["body", "message", "ciphertext", "plaintext", "wire_text", "transcript", "chat"];

export function normaliseSurface(raw) {
  return String(raw || "").trim().toLowerCase();
}

export function isPrivateSurface(surface) {
  return PRIVATE_SURFACES.indexOf(normaliseSurface(surface)) >= 0;
}

function normText(raw) {
  return String(raw || "")
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[^a-z0-9'+]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function shieldStrength(text) {
  let s = 0;
  if (/\b(reporting on|reported on|report on|documentary|journalism|journalist|news report|news coverage|historical|academic|according to|victims of|survivors of|prosecuted|prosecution|court ruled|court found|condemned|condemns|counter terror|counterterrorism|against terrorism|awareness campaign|educational)\b/.test(text)) {
    s += 40;
  }
  if (/\b(do not|don't|never|stop|refuse|against|not joining|i oppose)\b/.test(text)) s += 15;
  return Math.min(55, s);
}

const INTENT_RULES = [
  {
    id: "recruit_org",
    category: "extremism",
    weight: 72,
    re: /\b(join|pledge allegiance to|enlist with|become a member of|become a soldier of)\b.{0,48}\b(isis|isil|daesh|al qaeda|al qa'eda|al shabaab|boko haram|the caliphate|our cause)\b/,
  },
  {
    id: "support_cause",
    category: "extremism",
    weight: 58,
    re: /\b(support our cause|for the caliphate|wage jihad|strike the kuffar|strike the infidels)\b/,
  },
  {
    id: "praise_org",
    category: "extremism",
    weight: 54,
    re: /\b(glory to|praise be to|long live)\b.{0,36}\b(isis|isil|daesh|al qaeda|the martyrs|the fighters)\b/,
  },
  {
    id: "violent_instruction",
    category: "instruction",
    weight: 88,
    re: /\b(how to make|how to build|step by step|instructions for|recipe for)\b.{0,48}\b(a bomb|the bomb|an explosive|explosive|an ied|a weapon|the attack)\b/,
  },
  {
    id: "direct_threat",
    category: "threat",
    weight: 86,
    re: /\b(i will|i'm going to|im going to|we will|we're going to|going to)\b.{0,36}\b(kill|shoot|bomb|behead|stab|attack)\b/,
  },
  {
    id: "target_attack",
    category: "threat",
    weight: 78,
    re: /\b(bomb the|shoot up the|attack the|burn down the)\b/,
  },
  {
    id: "child_sexual",
    category: "child",
    weight: 92,
    re: /\b(child|minor|underage|kid)\b.{0,24}\b(sex|nude|nudes|porn|sexual)\b/,
  },
  {
    id: "child_trade",
    category: "child",
    weight: 92,
    re: /\b(sell|trade|share)\b.{0,24}\b(child|minor|underage)\b.{0,24}\b(porn|nudes|sex)\b/,
  },
  {
    id: "scam_payment",
    category: "scam",
    weight: 42,
    re: /\b(send bitcoin|send btc|send usdt|double your money|gift cards? to|wire the money now)\b/,
  },
  {
    id: "adult_trade",
    category: "adult",
    weight: 48,
    re: /\b(selling nudes|buy my nudes|nudes for sale|explicit content for sale|sex for money|pay for sex)\b/,
  },
  {
    id: "group_violence",
    category: "threat",
    weight: 80,
    re: /\b(kill all|exterminate|wipe out)\b.{0,32}\b(them|civilians|the infidels|the kuffar|women|children)\b/,
  },
];

const ENTITY_RE = /\b(isis|isil|daesh|al qaeda|al qa'eda|al shabaab|boko haram)\b/;

function adjustedWeight(rule, shield) {
  if (rule.category === "instruction" || rule.category === "threat") {
    return Math.max(0, rule.weight - Math.min(10, shield));
  }
  return Math.max(0, rule.weight - shield);
}

export function bandFor(score) {
  const n = Math.max(0, Math.min(100, Math.round(Number(score) || 0)));
  if (n <= 30) return "ALLOW";
  if (n <= 60) return "LIMIT";
  if (n <= 80) return "REVIEW";
  return "REMOVE";
}

function urgentFrom(signals) {
  return signals.some(function (s) {
    return s.category === "threat" || s.category === "instruction" || s.category === "child";
  });
}

/**
 * Score text the person chose to publish.
 * Private surfaces return immediately and do not include the text.
 */
export function scorePublicText(text, opts) {
  const surface = normaliseSurface(opts && opts.surface);
  if (isPrivateSurface(surface)) {
    return {
      ok: false,
      surface: surface,
      decision: "PRIVATE",
      score: 0,
      signals: [],
      urgent: false,
      human_required: false,
      auto_ban: false,
      account_action_applied: false,
      recommended_account_action: "none",
      contents_collected: false,
      error: "private boundary",
    };
  }
  if (surface && PUBLIC_SURFACES.indexOf(surface) < 0 && surface !== "") {
    return {
      ok: false,
      surface: surface,
      decision: "PRIVATE",
      score: 0,
      signals: [],
      urgent: false,
      human_required: false,
      auto_ban: false,
      account_action_applied: false,
      recommended_account_action: "none",
      contents_collected: false,
      error: "unknown surface",
    };
  }
  const clean = normText(text).slice(0, 4000);
  if (!clean) {
    return finishContent(surface, 0, [], false);
  }
  const shield = shieldStrength(clean);
  const signals = [];
  let score = 0;
  INTENT_RULES.forEach(function (rule) {
    if (!rule.re.test(clean)) return;
    const weight = adjustedWeight(rule, shield);
    if (weight <= 0) return;
    score += weight;
    signals.push({ id: rule.id, category: rule.category, weight: weight });
  });
  const intent = signals.some(function (s) { return s.category === "extremism" || s.category === "instruction" || s.category === "threat"; });
  if (ENTITY_RE.test(clean) && !intent) {
    const mention = shield >= 40 ? 0 : 8;
    if (mention > 0) {
      score += mention;
      signals.push({ id: "entity_mention", category: "context", weight: mention });
    }
  }
  score = Math.max(0, Math.min(100, score));
  const urgent = urgentFrom(signals) && score >= 61;
  return finishContent(surface, score, signals, urgent);
}

function finishContent(surface, score, signals, urgent) {
  let decision = bandFor(score);
  const adult = signals.some(function (s) { return s.category === "adult"; });
  const child = signals.some(function (s) { return s.category === "child"; });
  if (!child && adult && score >= 31 && score <= 80) decision = "AGE_RESTRICT";
  if (urgent && (decision === "REMOVE" || decision === "REVIEW")) decision = "ESCALATE";
  const human = decision === "REVIEW" || decision === "REMOVE" || decision === "ESCALATE" || decision === "AGE_RESTRICT";
  let recommend = "none";
  if (decision === "ESCALATE" || decision === "REMOVE" || decision === "AGE_RESTRICT") recommend = "review";
  return {
    ok: true,
    surface: surface || "public",
    decision: decision,
    score: score,
    signals: signals,
    urgent: urgent,
    monitor: decision === "LIMIT" || (decision === "ALLOW" && score >= 8),
    human_required: human,
    auto_ban: false,
    account_action_applied: false,
    recommended_account_action: recommend,
    contents_collected: true,
    version: SAFETY_VERSION,
  };
}

export function scoreBehaviour(input) {
  const src = input || {};
  const n = function (k) { return Math.max(0, Number(src[k]) || 0); };
  const signals = [];
  let score = 0;
  function add(id, weight, when) {
    if (!when) return;
    score += weight;
    signals.push({ id: id, category: "behaviour", weight: weight });
  }
  add("multi_account", 25, n("accountsCreated24h") >= 5);
  add("account_farm", 45, n("accountsCreated24h") >= 20);
  add("mass_follow", 15, n("follows24h") >= 200);
  add("mass_follow_extreme", 50, n("follows24h") >= 1000);
  add("identical_posts", 25, n("identicalPosts24h") >= 20);
  add("reupload_removed", 20, n("removedUploads7d") >= 3);
  add("connection_spam", 15, n("connectionRequests24h") >= 100);
  add("report_spike", 20, n("abuseReports7d") >= 5);
  add("report_wave", 20, n("abuseReports7d") >= 25);
  add("identity_churn", 10, n("identityChanges7d") >= 4);
  add("ban_evasion", 35, n("banEvasions") >= 1);
  add("known_hash_repeat", 40, n("knownHashHits") >= 1);
  score = Math.max(0, Math.min(100, score));
  const decision = bandFor(score);
  return {
    ok: true,
    surface: "behaviour",
    decision: decision,
    score: score,
    signals: signals,
    urgent: n("banEvasions") >= 1 && score >= 61,
    human_required: decision === "REVIEW" || decision === "REMOVE",
    auto_ban: false,
    account_action_applied: false,
    recommended_account_action: n("banEvasions") >= 1 && score >= 81 ? "suspend" : (score >= 61 ? "restrict" : "none"),
    contents_collected: false,
    version: SAFETY_VERSION,
  };
}

export function matchKnownHash(hex, list) {
  const h = String(hex || "").trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(h)) {
    return { ok: false, matched: false, error: "sha256 required" };
  }
  const rows = Array.isArray(list) ? list : [];
  const hit = rows.find(function (row) {
    return row && String(row.sha256 || "").toLowerCase() === h;
  });
  if (!hit) {
    return { ok: true, matched: false, score: 0, decision: "ALLOW", auto_ban: false, contents_collected: false };
  }
  return {
    ok: true,
    matched: true,
    score: 100,
    decision: "ESCALATE",
    category: String(hit.category || "known"),
    source: String(hit.source || "hash-list"),
    urgent: true,
    human_required: true,
    auto_ban: false,
    account_action_applied: false,
    recommended_account_action: "review",
    contents_collected: false,
    signals: [{ id: "known_hash", category: String(hit.category || "known"), weight: 100 }],
  };
}

export function combineRisk(content, behaviour, reportCount, extra) {
  const c = content && content.decision !== "PRIVATE" ? content : null;
  const b = behaviour || null;
  const reports = Math.max(0, Number(reportCount) || 0);
  const cScore = c ? c.score : 0;
  const bScore = b ? b.score : 0;
  const brigade = !!(extra && extra.brigade);
  let boost = Math.min(20, reports * 4);
  if (brigade) boost = Math.min(4, boost);
  if (reports === 1) boost = Math.min(boost, 4);
  const score = Math.max(cScore, Math.min(100, Math.round(cScore * 0.65 + bScore * 0.5 + boost)));
  let decision = bandFor(score);
  const urgent = !!(c && c.urgent) || !!(b && b.urgent) || (!brigade && reports >= 3 && score >= 61);
  if (urgent && (decision === "REMOVE" || decision === "REVIEW")) decision = "ESCALATE";
  const recommend = (b && b.recommended_account_action === "suspend" && score >= 81)
    ? "suspend"
    : (decision === "ESCALATE" || decision === "REMOVE" ? "review" : "none");
  const signals = []
    .concat(c && c.signals ? c.signals : [])
    .concat(b && b.signals ? b.signals : []);
  if (brigade) signals.push({ id: "report_brigade", category: "network", weight: 4 });
  return {
    ok: true,
    score: score,
    decision: decision,
    urgent: urgent,
    human_required: decision !== "ALLOW" && decision !== "LIMIT",
    auto_ban: false,
    account_action_applied: false,
    recommended_account_action: recommend,
    brigade: brigade,
    signals: signals,
  };
}

export function priorityFor(result, reasonCode) {
  const code = String(reasonCode || "");
  const urgentCode = code === "terrorism" || code === "recruitment" || code === "child_exploitation" || code === "violence";
  if ((result && result.urgent) || urgentCode && (result && result.score >= 61)) return "URGENT";
  if (urgentCode) return "HIGH";
  if (result && (result.decision === "REMOVE" || result.decision === "ESCALATE")) return "URGENT";
  if (result && result.decision === "REVIEW") return "HIGH";
  if (result && result.decision === "REGION_RESTRICT") return "HIGH";
  if (result && (result.decision === "LIMIT" || result.decision === "AGE_RESTRICT")) return "MEDIUM";
  return "LOW";
}

export function buildCase(input) {
  const src = input || {};
  const surface = normaliseSurface(src.surface || src.content_type);
  if (isPrivateSurface(surface) && src.include_body) {
    throw new Error("private contents are not collected");
  }
  FORBIDDEN_KEYS.forEach(function (k) {
    if (src[k]) throw new Error("forbidden field " + k);
  });
  const result = src.result || {};
  const id = String(src.case_id || ("TS-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 6))).slice(0, 80);
  return {
    case_id: id,
    reporter_id: String(src.reporter_id || "system").slice(0, 128),
    reported_user_id: String(src.reported_user_id || "").slice(0, 128),
    content_id: String(src.content_id || "").slice(0, 128),
    content_type: String(src.content_type || surface || "public").slice(0, 32),
    surface: isPrivateSurface(surface) ? surface : (surface || "public"),
    reason_code: String(src.reason_code || "").slice(0, 40),
    evidence_reference: String(src.evidence_reference || "").slice(0, 128),
    automated_risk_result: {
      score: Number(result.score) || 0,
      decision: String(result.decision || "ALLOW"),
      signals: (result.signals || []).map(function (s) { return s.id || s; }).slice(0, 12),
    },
    review_status: "open",
    priority: priorityFor(result, src.reason_code),
    reviewer: "",
    decision: "",
    decision_reason: "",
    appeal_status: "none",
    report_id: String(src.report_id || "").slice(0, 80),
    statement: String((result && result.statement) || statementFor(result) || "").slice(0, 400),
    contents_collected: isPrivateSurface(surface) ? false : src.contents_collected !== false,
    auto_ban: false,
    created_at: Date.now(),
  };
}

export function buildAudit(input) {
  const src = input || {};
  if (!src.case_id || !src.what) throw new Error("audit needs a case and an action");
  return Object.freeze({
    audit_id: String(src.audit_id || ("aud_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6))).slice(0, 80),
    case_id: String(src.case_id).slice(0, 80),
    who: String(src.who || "system").slice(0, 128),
    what: String(src.what).slice(0, 80),
    when: Number(src.when) || Date.now(),
    why: String(src.why || "").slice(0, 500),
    detected_by: String(src.detected_by || "classifier").slice(0, 40),
    human_reviewed: !!src.human_reviewed,
    action_taken: String(src.action_taken || src.what).slice(0, 80),
  });
}

export function assertAuditAppend(existing, next) {
  if (!next || !next.audit_id) throw new Error("audit row required");
  if ((existing || []).some(function (row) { return row && row.audit_id === next.audit_id; })) {
    throw new Error("audit rows are append-only");
  }
  if (next.deleted) throw new Error("audit cannot be deleted");
  return true;
}

export function decideHuman(caseRow, action, reviewer, why) {
  const allowed = ["ALLOW", "LIMIT", "AGE_RESTRICT", "REGION_RESTRICT", "REMOVE", "RESTORE", "RESTRICT", "SUSPEND", "ESCALATE", "DISMISS"];
  const act = String(action || "").toUpperCase();
  if (allowed.indexOf(act) < 0) throw new Error("unknown decision");
  if (!reviewer) throw new Error("a person has to decide");
  const row = Object.assign({}, caseRow || {});
  row.review_status = "decided";
  row.reviewer = String(reviewer).slice(0, 128);
  row.decision = act;
  row.decision_reason = String(why || "").slice(0, 500);
  row.decided_at = Date.now();
  row.auto_ban = false;
  row.permanent_ban = false;
  if (act === "ALLOW" || act === "RESTORE" || act === "DISMISS") row.appeal_status = row.appeal_status === "open" ? row.appeal_status : "none";
  return row;
}

export function buildAppeal(input) {
  const src = input || {};
  if (!src.case_id || !src.appellant_uid) throw new Error("appeal needs a case and the person");
  const note = String(src.note || "").trim();
  if (note.length < 10) throw new Error("say what was wrong with the decision");
  return {
    appeal_id: String(src.appeal_id || ("apl_" + Date.now().toString(36))).slice(0, 80),
    case_id: String(src.case_id).slice(0, 80),
    appellant_uid: String(src.appellant_uid).slice(0, 128),
    note: note.slice(0, 2000),
    status: "open",
    created_at: Date.now(),
  };
}

export function applyAppeal(caseRow, appeal) {
  const row = Object.assign({}, caseRow || {});
  row.appeal_status = "open";
  row.review_status = "review";
  row.appeal_id = appeal && appeal.appeal_id;
  return row;
}

export function statementFor(result) {
  const decision = result && result.decision;
  if (!result || decision === "PRIVATE") {
    return "Private conversations are not reviewed by this check.";
  }
  if (decision === "ALLOW" && result.monitor) {
    return "Allowed. It stays on the public feed and is watched. A name on its own is not recruitment.";
  }
  if (decision === "ALLOW") return "Allowed. This did not read as recruitment, a threat, or instructions.";
  if (decision === "LIMIT") return "Allowed on the public feed, and watched. One report is not enough to take it down.";
  if (decision === "AGE_RESTRICT") return "Held for an age check. This is not a ban. Appeal if it is educational or a mistake.";
  if (decision === "REGION_RESTRICT") return "Held for a region check by a person. This is not a ban.";
  if (decision === "REVIEW") return "Held so a person can review it. A machine does not remove it on its own.";
  if (decision === "ESCALATE") return "Held in the urgent queue. A person has to decide. You can appeal. Private messages were not opened.";
  if (decision === "REMOVE") return "Held off the public feed for urgent review. This is not a permanent ban. You can appeal.";
  return "Recorded for the safety desk.";
}

export const SAFETY_EVENT_TYPES = [
  "USER_CREATED",
  "ACCOUNT_VERIFIED",
  "CONTENT_UPLOADED",
  "SIGNAL_PUBLISHED",
  "BROADCAST_PUBLISHED",
  "CONTENT_REPORTED",
  "ACCOUNT_REPORTED",
  "CONTENT_REMOVED",
  "USER_BLOCKED",
  "SUSPICIOUS_ACTIVITY",
  "ADMIN_ACTION",
  "FOLLOW",
  "CONNECTION_REQUEST",
  "IDENTITY_CHANGED",
  "LEGAL_REQUEST",
];

const DAY_MS = 86400000;
const WEEK_MS = 7 * DAY_MS;

export function emptyLedger(uid) {
  return {
    uid: String(uid || ""),
    follows24h: { start: 0, n: 0 },
    connections24h: { start: 0, n: 0 },
    identical24h: { start: 0, n: 0 },
    removed7d: { start: 0, n: 0 },
    reports7d: { start: 0, n: 0 },
    identity7d: { start: 0, n: 0 },
    blocks7d: { start: 0, n: 0 },
    banEvasions: 0,
    knownHashHits: 0,
    accountsLinked: 0,
    verified: false,
  };
}

function bumpBucket(bucket, now, windowMs) {
  const b = bucket || { start: 0, n: 0 };
  if (!b.start || now - b.start > windowMs) return { start: now, n: 1 };
  return { start: b.start, n: Math.min(100000, (b.n || 0) + 1) };
}

function countBucket(bucket, now, windowMs) {
  if (!bucket || !bucket.start || now - bucket.start > windowMs) return 0;
  return bucket.n || 0;
}

export function ledgerCounts(ledger, now) {
  const t = Number(now) || Date.now();
  const src = ledger || emptyLedger();
  return {
    accountsCreated24h: src.accountsLinked || 0,
    follows24h: countBucket(src.follows24h, t, DAY_MS),
    identicalPosts24h: countBucket(src.identical24h, t, DAY_MS),
    removedUploads7d: countBucket(src.removed7d, t, WEEK_MS),
    connectionRequests24h: countBucket(src.connections24h, t, DAY_MS),
    abuseReports7d: countBucket(src.reports7d, t, WEEK_MS),
    identityChanges7d: countBucket(src.identity7d, t, WEEK_MS),
    banEvasions: src.banEvasions || 0,
    knownHashHits: src.knownHashHits || 0,
  };
}

export function applySafetyEvent(ledger, event, now) {
  const src = event || {};
  FORBIDDEN_KEYS.forEach(function (k) {
    if (src[k]) throw new Error("forbidden field " + k);
  });
  const type = String(src.type || "").toUpperCase();
  if (SAFETY_EVENT_TYPES.indexOf(type) < 0) throw new Error("unknown safety event");
  const surface = normaliseSurface(src.surface);
  if (surface && isPrivateSurface(surface)) throw new Error("private boundary");
  const t = Number(now) || Date.now();
  const base = ledger || emptyLedger(src.uid);
  const next = {
    uid: String(base.uid || src.uid || ""),
    follows24h: base.follows24h || { start: 0, n: 0 },
    connections24h: base.connections24h || { start: 0, n: 0 },
    identical24h: base.identical24h || { start: 0, n: 0 },
    removed7d: base.removed7d || { start: 0, n: 0 },
    reports7d: base.reports7d || { start: 0, n: 0 },
    identity7d: base.identity7d || { start: 0, n: 0 },
    blocks7d: base.blocks7d || { start: 0, n: 0 },
    banEvasions: base.banEvasions || 0,
    knownHashHits: base.knownHashHits || 0,
    accountsLinked: base.accountsLinked || 0,
    verified: !!base.verified,
  };
  if (type === "FOLLOW") next.follows24h = bumpBucket(next.follows24h, t, DAY_MS);
  if (type === "CONNECTION_REQUEST") next.connections24h = bumpBucket(next.connections24h, t, DAY_MS);
  if (type === "IDENTITY_CHANGED") next.identity7d = bumpBucket(next.identity7d, t, WEEK_MS);
  if (type === "CONTENT_REMOVED") next.removed7d = bumpBucket(next.removed7d, t, WEEK_MS);
  if (type === "CONTENT_REPORTED" || type === "ACCOUNT_REPORTED") next.reports7d = bumpBucket(next.reports7d, t, WEEK_MS);
  if (type === "USER_BLOCKED") next.blocks7d = bumpBucket(next.blocks7d, t, WEEK_MS);
  if (type === "USER_CREATED") {
    next.accountsLinked = Math.max(next.accountsLinked, Number(src.linked_accounts) || 0);
  }
  if (type === "SUSPICIOUS_ACTIVITY" && src.ban_evasion) next.banEvasions += 1;
  if (type === "SUSPICIOUS_ACTIVITY" && src.known_hash) next.knownHashHits += 1;
  if (src.repeat_public) next.identical24h = bumpBucket(next.identical24h, t, DAY_MS);
  if (type === "ACCOUNT_VERIFIED") next.verified = true;
  let content = null;
  const publish = type === "SIGNAL_PUBLISHED" || type === "BROADCAST_PUBLISHED" || type === "CONTENT_UPLOADED";
  if (publish && src.public_text) {
    const pubSurface = src.surface || (type === "SIGNAL_PUBLISHED" ? "signal" : type === "CONTENT_UPLOADED" ? "comment" : "broadcast");
    content = scorePublicText(String(src.public_text), { surface: pubSurface });
    content.statement = statementFor(content);
  }
  if (type === "LEGAL_REQUEST") {
    content = {
      ok: true,
      surface: "public",
      decision: "REGION_RESTRICT",
      score: 70,
      signals: [{ id: "legal_request", category: "legal", weight: 70 }],
      urgent: false,
      monitor: false,
      human_required: true,
      auto_ban: false,
      account_action_applied: false,
      recommended_account_action: "review",
      contents_collected: false,
      statement: statementFor({ decision: "REGION_RESTRICT" }),
    };
  }
  const counts = ledgerCounts(next, t);
  let behaviour = scoreBehaviour(counts);
  if (next.verified && behaviour.score > 0 && behaviour.score < 61) {
    const lowered = Math.max(0, behaviour.score - 8);
    behaviour = Object.assign({}, behaviour, { score: lowered, decision: bandFor(lowered) });
  }
  return {
    ledger: next,
    counts: counts,
    behaviour: behaviour,
    content: content,
    type: type,
    contents_collected: !!(content && content.contents_collected),
  };
}

export function fingerprintPublic(text) {
  const clean = normText(text);
  if (clean.length < 24) return "";
  let h = 2166136261;
  for (let i = 0; i < clean.length; i++) {
    h ^= clean.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

export function observeCluster(store, obs) {
  const src = obs || {};
  const fp = src.fingerprint || fingerprintPublic(src.text || "");
  const box = store || {};
  if (!fp) {
    return { fingerprint: "", accounts: 0, score: 0, decision: "ALLOW", auto_ban: false, contents_collected: false, signals: [] };
  }
  const now = Number(src.at) || Date.now();
  const bucket = (box[fp] || []).filter(function (r) { return r && now - r.at < DAY_MS; });
  const uid = String(src.uid || "");
  if (uid && !bucket.some(function (r) { return r.uid === uid; })) bucket.push({ uid: uid, at: now });
  box[fp] = bucket.slice(-40);
  const accounts = new Set(bucket.map(function (r) { return r.uid; })).size;
  let score = 0;
  if (accounts >= 4) score = 35;
  if (accounts >= 8) score = 62;
  if (accounts >= 15) score = 84;
  return {
    fingerprint: fp,
    accounts: accounts,
    score: score,
    decision: score >= 61 ? "REVIEW" : bandFor(score),
    urgent: accounts >= 15,
    human_required: score >= 61,
    auto_ban: false,
    account_action_applied: false,
    contents_collected: false,
    signals: score ? [{ id: "coordinated_publish", category: "network", weight: score }] : [],
  };
}

export function weighReports(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const distinct = new Set(list.map(function (r) { return r && r.reporter_uid; }).filter(Boolean)).size;
  if (list.length < 5) return { brigade: false, distinct: distinct, young: 0, weight: list.length };
  const young = list.filter(function (r) {
    return r && Number(r.reporter_age_hours) >= 0 && Number(r.reporter_age_hours) < 24;
  }).length;
  const brigade = distinct >= 5 && young / list.length >= 0.7;
  return { brigade: brigade, distinct: distinct, young: young, weight: brigade ? 1 : list.length };
}

const CONFIRM = { REMOVE: 1, RESTRICT: 1, SUSPEND: 1, ESCALATE: 1, AGE_RESTRICT: 1, REGION_RESTRICT: 1 };
const OVERTURN = { ALLOW: 1, RESTORE: 1, DISMISS: 1 };

export function repeatOffenders(cases, now) {
  const t = Number(now) || Date.now();
  const counts = {};
  (cases || []).forEach(function (c) {
    if (!c || !c.reported_user_id) return;
    if (c.decision !== "REMOVE" && c.decision !== "RESTRICT" && c.decision !== "SUSPEND") return;
    if (c.decided_at && t - c.decided_at > 30 * DAY_MS) return;
    counts[c.reported_user_id] = (counts[c.reported_user_id] || 0) + 1;
  });
  return Object.keys(counts)
    .filter(function (uid) { return counts[uid] >= 2; })
    .map(function (uid) { return { uid: uid, count: counts[uid] }; })
    .sort(function (a, b) { return b.count - a.count; });
}

export function safetyOverview(cases, appeals, now) {
  const t = Number(now) || Date.now();
  const list = cases || [];
  const open = list.filter(function (c) { return c && c.review_status !== "decided"; });
  let confirmed = 0;
  let fp = 0;
  list.forEach(function (c) {
    if (!c || c.review_status !== "decided") return;
    const auto = c.automated_risk_result && c.automated_risk_result.decision;
    if (!auto || auto === "ALLOW" || auto === "PRIVATE") return;
    if (CONFIRM[c.decision]) confirmed += 1;
    else if (OVERTURN[c.decision]) fp += 1;
  });
  const judged = confirmed + fp;
  const offenders = repeatOffenders(list, t);
  return {
    reports_today: list.filter(function (c) {
      return c && c.reporter_id && c.reporter_id !== "system" && t - (c.created_at || 0) < DAY_MS;
    }).length,
    open_cases: open.length,
    urgent: open.filter(function (c) { return c.priority === "URGENT"; }).length,
    high: open.filter(function (c) { return c.priority === "HIGH"; }).length,
    medium: open.filter(function (c) { return c.priority === "MEDIUM"; }).length,
    low: open.filter(function (c) { return c.priority === "LOW"; }).length,
    automated_detections: list.filter(function (c) {
      return c && c.reporter_id === "system" && t - (c.created_at || 0) < DAY_MS;
    }).length,
    content_removed: list.filter(function (c) { return c && c.decision === "REMOVE"; }).length,
    accounts_restricted: list.filter(function (c) {
      return c && (c.decision === "RESTRICT" || c.decision === "SUSPEND" || c.decision === "AGE_RESTRICT" || c.decision === "REGION_RESTRICT");
    }).length,
    appeals_open: (appeals || []).filter(function (a) { return a && a.status === "open"; }).length,
    repeat_offenders: offenders.length,
    repeat: offenders.slice(0, 12),
    detection_accuracy: judged ? Math.round((100 * confirmed) / judged) : null,
    false_positive_rate: judged ? Math.round((100 * fp) / judged) : null,
    judged: judged,
    private_read: false,
    auto_ban: false,
  };
}

export function scrubCase(row) {
  const out = Object.assign({}, row || {});
  FORBIDDEN_KEYS.concat(["public_text", "text", "caption", "reason", "note", "image", "bytes", "file"]).forEach(function (k) {
    delete out[k];
  });
  out.auto_ban = false;
  out.permanent_ban = false;
  return out;
}

