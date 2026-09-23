import test from "node:test";
import assert from "node:assert/strict";
import {
  scorePublicText,
  scoreBehaviour,
  matchKnownHash,
  buildCase,
  buildAudit,
  assertAuditAppend,
  decideHuman,
  buildAppeal,
  applyAppeal,
  combineRisk,
  applySafetyEvent,
  emptyLedger,
  fingerprintPublic,
  observeCluster,
  weighReports,
  safetyOverview,
  statementFor,
} from "./safety.mjs";

test("journalism about an extremist group is not treated as recruitment", () => {
  const r = scorePublicText("I am reporting on ISIS propaganda for a documentary.", { surface: "broadcast" });
  assert.equal(r.ok, true);
  assert.equal(r.decision, "ALLOW");
  assert.ok(r.score <= 30);
  assert.equal(r.auto_ban, false);
});

test("a bare name is not a deletion", () => {
  const r = scorePublicText("ISIS", { surface: "signal" });
  assert.equal(r.decision, "ALLOW");
  assert.ok(r.score < 31);
  assert.equal(r.auto_ban, false);
});

test("recruitment scores into urgent human review and does not ban", () => {
  const r = scorePublicText("Join ISIS and support our cause.", { surface: "broadcast" });
  assert.ok(r.score >= 81);
  assert.ok(r.decision === "REMOVE" || r.decision === "ESCALATE");
  assert.equal(r.human_required, true);
  assert.equal(r.auto_ban, false);
  assert.equal(r.account_action_applied, false);
  assert.notEqual(r.recommended_account_action, "suspend");
});

test("violent instructions and direct threats escalate", () => {
  const bomb = scorePublicText("Here is how to make a bomb step by step.", { surface: "signal" });
  assert.equal(bomb.decision, "ESCALATE");
  assert.equal(bomb.urgent, true);
  assert.equal(bomb.auto_ban, false);
  const threat = scorePublicText("I will kill you tomorrow at the station.", { surface: "comment" });
  assert.equal(threat.decision, "ESCALATE");
  assert.equal(threat.auto_ban, false);
});

test("private Wireline text is refused and not echoed", () => {
  const secret = "meet me at the old bridge, bring the notes";
  const r = scorePublicText(secret, { surface: "wireline" });
  assert.equal(r.decision, "PRIVATE");
  assert.equal(r.contents_collected, false);
  assert.equal(JSON.stringify(r).includes(secret), false);
  assert.throws(function () {
    buildCase({ surface: "wireline", include_body: true, body: secret });
  });
});

test("behaviour risk does not need message text", () => {
  const r = scoreBehaviour({
    accountsCreated24h: 20,
    follows24h: 1000,
    identicalPosts24h: 40,
    abuseReports7d: 6,
  });
  assert.ok(r.score >= 61);
  assert.equal(r.contents_collected, false);
  assert.equal(r.auto_ban, false);
  assert.equal(JSON.stringify(r).includes("chat"), false);
  const combined = combineRisk(null, r, 3);
  assert.equal(combined.account_action_applied, false);
});

test("known hash matches without storing the file", async () => {
  const bytes = new TextEncoder().encode("naluno-safety-test-vector");
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hex = Array.from(new Uint8Array(digest)).map(function (b) { return b.toString(16).padStart(2, "0"); }).join("");
  const hit = matchKnownHash(hex, [{ sha256: hex, category: "test-fixture", source: "unit" }]);
  assert.equal(hit.matched, true);
  assert.equal(hit.decision, "ESCALATE");
  assert.equal(hit.contents_collected, false);
  assert.equal(hit.auto_ban, false);
  const miss = matchKnownHash("ab".repeat(32), [{ sha256: hex, category: "test-fixture" }]);
  assert.equal(miss.matched, false);
});

test("a human decision and an appeal do not erase the audit", () => {
  const opened = buildCase({
    reporter_id: "rep",
    reported_user_id: "user",
    content_id: "b1",
    content_type: "broadcast",
    surface: "broadcast",
    reason_code: "violence",
    result: { score: 90, decision: "ESCALATE", signals: [{ id: "direct_threat" }] },
  });
  const audit = [buildAudit({
    case_id: opened.case_id,
    who: "system",
    what: "held-public",
    why: "classifier",
    detected_by: "classifier",
    action_taken: "temporarily held",
  })];
  const decided = decideHuman(opened, "REMOVE", "operator", "Confirmed recruitment, not journalism");
  assert.equal(decided.decision, "REMOVE");
  assert.equal(decided.auto_ban, false);
  const appeal = buildAppeal({ case_id: opened.case_id, appellant_uid: "user", note: "This was a news report about the group." });
  const withAppeal = applyAppeal(decided, appeal);
  assert.equal(withAppeal.appeal_status, "open");
  const next = buildAudit({
    case_id: opened.case_id,
    who: "operator",
    what: "human-decision",
    why: "Confirmed recruitment",
    detected_by: "human",
    human_reviewed: true,
    action_taken: "REMOVE",
  });
  assert.equal(assertAuditAppend(audit, next), true);
  assert.throws(function () { assertAuditAppend(audit.concat([next]), next); });
  assert.equal(audit[0].what, "held-public");
});

test("adult sexual trade is an age hold, not a ban, and not a child case", () => {
  const r = scorePublicText("Selling nudes, explicit content for sale.", { surface: "broadcast" });
  assert.equal(r.decision, "AGE_RESTRICT");
  assert.equal(r.auto_ban, false);
  assert.equal(r.urgent, false);
  assert.equal(statementFor(r).includes("not a ban"), true);
});

test("a quoted call for group violence is held for a person", () => {
  const r = scorePublicText("They said kill all civilians in the square.", { surface: "signal" });
  assert.equal(r.decision, "ESCALATE");
  assert.equal(r.auto_ban, false);
  assert.equal(r.account_action_applied, false);
});

test("behaviour events count follows and never keep private text", () => {
  let ledger = emptyLedger("u1");
  const secret = "wireline secret about the bridge";
  assert.throws(function () {
    applySafetyEvent(ledger, { type: "FOLLOW", surface: "wireline", message: secret });
  });
  for (let i = 0; i < 1000; i++) ledger = applySafetyEvent(ledger, { type: "FOLLOW" }, 1_700_000_000_000).ledger;
  const again = applySafetyEvent(ledger, { type: "FOLLOW" }, 1_700_000_000_000);
  assert.ok(again.behaviour.score >= 31);
  assert.equal(again.behaviour.auto_ban, false);
  assert.equal(again.contents_collected, false);
  assert.equal(JSON.stringify(again).includes(secret), false);
  assert.equal(JSON.stringify(again.ledger).includes("wire"), false);
});

test("identical public posts across accounts are a network flag and the text is not stored", () => {
  const text = "meet tonight and bring everyone to the same square now";
  const store = {};
  let last = null;
  for (let i = 0; i < 8; i++) {
    last = observeCluster(store, { text: text, uid: "acct" + i, at: 1_700_000_000_000 });
  }
  assert.equal(last.accounts, 8);
  assert.equal(last.decision, "REVIEW");
  assert.equal(last.contents_collected, false);
  assert.equal(JSON.stringify(store).includes(text), false);
  assert.ok(fingerprintPublic(text));
});

test("a brigade of new accounts does not outweigh one piece of content", () => {
  const rows = [];
  for (let i = 0; i < 6; i++) rows.push({ reporter_uid: "new" + i, reporter_age_hours: 1 });
  const weighed = weighReports(rows);
  assert.equal(weighed.brigade, true);
  const quiet = scorePublicText("A normal photo from the market.", { surface: "broadcast" });
  const blended = combineRisk(quiet, null, weighed.weight, weighed);
  assert.ok(blended.score < 61);
  assert.equal(blended.auto_ban, false);
  assert.equal(blended.brigade, true);
});

test("accuracy is earned from human decisions and appeals do not erase the audit", () => {
  const opened = buildCase({
    reporter_id: "system",
    reported_user_id: "user-a",
    content_id: "b2",
    content_type: "broadcast",
    surface: "broadcast",
    reason_code: "dangerous",
    result: { score: 70, decision: "REVIEW", signals: [{ id: "scam_payment" }] },
  });
  const kept = decideHuman(opened, "DISMISS", "operator", "It was a news clip");
  const other = decideHuman(Object.assign({}, opened, { case_id: "TS-other", reported_user_id: "user-a" }), "REMOVE", "operator", "Second one was real");
  const view = safetyOverview([kept, other], [{ status: "open" }]);
  assert.equal(view.false_positive_rate, 50);
  assert.equal(view.detection_accuracy, 50);
  assert.equal(view.private_read, false);
  assert.equal(view.auto_ban, false);
  assert.equal(JSON.stringify(kept).includes("news clip") , true);
  assert.equal(kept.permanent_ban, false);
});

