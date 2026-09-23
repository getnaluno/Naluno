/* Adversary pass: the things a hostile client, a brigade, or a bad share
   must not be able to do. These are invariants, not a tour of the happy path. */
import assert from "node:assert/strict";
import test from "node:test";
import {
  scorePublicText, buildCase, decideHuman, weighReports, combineRisk, scrubCase,
} from "./safety.mjs";
import { handleRequest, resetMemory, setFetchImpl } from "./handler.mjs";

test("journalism is not recruitment, and nothing auto-bans", () => {
  const news = scorePublicText("I am reporting on ISIS propaganda for a documentary.", { surface: "broadcast" });
  const recruit = scorePublicText("Join ISIS and support our cause.", { surface: "broadcast" });
  assert.ok(news.score < recruit.score, "reporting scores under recruitment");
  assert.equal(news.decision, "ALLOW");
  assert.equal(news.auto_ban, false);
  assert.equal(recruit.auto_ban, false);
  assert.notEqual(recruit.decision, "ALLOW");
});

test("private chat is not collected, even if the caller asks for the body", () => {
  const r = scorePublicText("meet me at the usual place", { surface: "wireline" });
  assert.equal(r.decision, "PRIVATE");
  assert.equal(r.contents_collected, false);
  assert.equal(r.auto_ban, false);
  assert.throws(() => buildCase({ surface: "wireline", include_body: true, body: "secret" }));
  const scrubbed = scrubCase({ body: "nope", message: "nope", public_text: "nope", case_id: "c1", decision: "REVIEW" });
  assert.equal(scrubbed.body, undefined);
  assert.equal(scrubbed.message, undefined);
  assert.equal(scrubbed.public_text, undefined);
  assert.equal(scrubbed.case_id, "c1");
});

test("a human suspend is not a permanent ban", () => {
  const row = { case_id: "c", decision: "REVIEW", review_status: "open" };
  const out = decideHuman(row, "SUSPEND", "operator", "repeated public abuse");
  assert.equal(out.auto_ban, false);
  assert.equal(out.decision, "SUSPEND");
  assert.equal(out.permanent_ban, false);
});

test("a fresh brigade cannot pile a score", () => {
  const now = Date.now();
  const rows = [];
  for (let i = 0; i < 6; i++) rows.push({ reporter_uid: "n" + i, reporter_age_hours: 1 });
  const w = weighReports(rows);
  assert.equal(w.brigade, true);
  const blended = combineRisk({ score: 40, decision: "ALLOW" }, null, w.boost || w.count || 6, w);
  assert.equal(blended.auto_ban, false);
  assert.ok((blended.score || 0) < 80, "brigade boost stays capped");
});

test("a share page does not send the crawler at the generic site, and hides a private broadcast", async () => {
  resetMemory();
  const pair = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
  const b = new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey));
  let bin = ""; for (let i = 0; i < b.length; i++) bin += String.fromCharCode(b[i]);
  const pem = "-----BEGIN PRIVATE KEY-----\n" + btoa(bin).replace(/(.{64})/g, "$1\n") + "\n-----END PRIVATE KEY-----\n";
  const env = { FIREBASE_PROJECT_ID: "naluno-28a00", FIREBASE_WEB_API_KEY: "k",
    GOOGLE_SERVICE_ACCOUNT: JSON.stringify({ client_email: "sa@x.iam.gserviceaccount.com", private_key: pem, project_id: "naluno-28a00", token_uri: "https://oauth2.googleapis.com/token" }) };
  setFetchImpl(async (url) => {
    const u = String(url);
    if (u.includes("oauth2")) return new Response(JSON.stringify({ access_token: "sa", expires_in: 3600 }), { status: 200 });
    const fields = {
      title: { stringValue: "Private tape" },
      thumbUrl: { stringValue: "https://media.naluno/secret.jpg" },
      visibility: { stringValue: "private" },
      listed: { booleanValue: true },
    };
    return new Response(JSON.stringify({ name: "x/broadcasts/p1", fields }), { status: 200 });
  });
  const res = await handleRequest(new Request("https://relay.example/b/p1"), env);
  const html = await res.text();
  assert.ok(!html.includes("Private tape"));
  assert.ok(!html.includes("secret.jpg"));
  assert.ok(html.includes('og:url" content="https://relay.example/b/p1"'));
  setFetchImpl(null);
});
