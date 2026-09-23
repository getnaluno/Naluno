/* Share-link previews: what a chat app sees before anyone opens the link. */
import assert from "node:assert/strict";
import test from "node:test";
import { handleRequest, resetMemory, setFetchImpl } from "./handler.mjs";

const ENV0 = { FIREBASE_PROJECT_ID: "naluno-28a00", FIREBASE_WEB_API_KEY: "k" };
async function saEnv() {
  const pair = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
  const b = new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey));
  let bin = ""; for (let i = 0; i < b.length; i++) bin += String.fromCharCode(b[i]);
  const pem = "-----BEGIN PRIVATE KEY-----\n" + btoa(bin).replace(/(.{64})/g, "$1\n") + "\n-----END PRIVATE KEY-----\n";
  return { ...ENV0, GOOGLE_SERVICE_ACCOUNT: JSON.stringify({ client_email: "sa@x.iam.gserviceaccount.com",
    private_key: pem, project_id: "naluno-28a00", token_uri: "https://oauth2.googleapis.com/token" }) };
}
function firestore(doc) {
  setFetchImpl(async (url) => {
    const u = String(url);
    if (u.includes("oauth2")) return new Response(JSON.stringify({ access_token: "sa", expires_in: 3600 }), { status: 200 });
    if (u.includes("/broadcasts/")) {
      if (!doc) return new Response("{}", { status: 404 });
      const fields = {};
      Object.entries(doc).forEach(([k, v]) => {
        fields[k] = typeof v === "boolean" ? { booleanValue: v } : { stringValue: String(v) };
      });
      return new Response(JSON.stringify({ name: "x/broadcasts/b1", fields }), { status: 200 });
    }
    return new Response("{}", { status: 200 });
  });
}
const get = (p, env) => handleRequest(new Request("https://relay.example" + p), env);

test("a shared link carries the Broadcast's own picture and title — no sign-in needed", async () => {
  resetMemory(); const env = await saEnv();
  firestore({ title: "Rain over Kampala", creatorName: "Joel", thumbUrl: "https://media.naluno/x.jpg", listed: true });
  const res = await get("/b/b1", env);
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.ok(html.includes('property="og:title" content="Rain over Kampala"'));
  assert.ok(html.includes('content="https://media.naluno/x.jpg"'));
  assert.ok(html.includes("by Joel"));
  assert.ok(html.includes("summary_large_image"));
  assert.ok(html.includes('property="og:url" content="https://relay.example/b/b1"'), "crawlers must stay on this page");
  assert.ok(!html.includes('og:url" content="https://getnaluno.com'), "og:url must not bounce to the generic site");
  assert.ok(html.includes("getnaluno.com/app/?broadcast=b1"), "forwards into the app");
  setFetchImpl(null);
});

test("a Broadcast taken down keeps NO preview of itself", async () => {
  for (const doc of [
    { title: "Bad clip", thumbUrl: "https://media.naluno/x.jpg", hidden: true },
    { title: "Bad clip", thumbUrl: "https://media.naluno/x.jpg", held: true },
    { title: "Bad clip", thumbUrl: "https://media.naluno/x.jpg", deleted: true },
    { title: "Bad clip", thumbUrl: "https://media.naluno/x.jpg", listed: false },
  ]) {
    resetMemory(); const env = await saEnv(); firestore(doc);
    const html = await (await get("/b/b1", env)).text();
    assert.ok(!html.includes("Bad clip"), "the title must not leak");
    assert.ok(!html.includes("media.naluno/x.jpg"), "the picture must not leak");
    assert.ok(html.includes("isn\u2019t available"));
    setFetchImpl(null);
  }
});

test("a made-up id shows a plain card, never an error page", async () => {
  resetMemory(); const env = await saEnv(); firestore(null);
  const res = await get("/b/nope", env);
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.ok(html.includes("Naluno"));
  assert.ok(!html.includes("og:image"));
  setFetchImpl(null);
});

test("without a service account it still forwards, just without a picture", async () => {
  resetMemory(); setFetchImpl(async () => new Response("{}", { status: 404 }));
  const html = await (await get("/b/b1", ENV0)).text();
  assert.ok(html.includes("getnaluno.com/app/?broadcast=b1"));
  assert.ok(!html.includes("og:image"));
  setFetchImpl(null);
});

test("a title cannot break out of the page", async () => {
  resetMemory(); const env = await saEnv();
  firestore({ title: '"><script>alert(1)</script>', creatorName: "<b>x</b>", thumbUrl: "https://m/x.jpg", listed: true });
  const html = await (await get("/b/b1", env)).text();
  assert.ok(!html.includes("<script>alert(1)</script>"), "script must be escaped");
  assert.ok(html.includes("&lt;script&gt;"), "and shown as text");
  assert.ok(!/content="[^"]*"><script/.test(html), "cannot close the attribute");
  setFetchImpl(null);
});

test("a non-https thumbnail is refused (a chat app would drop it anyway)", async () => {
  resetMemory(); const env = await saEnv();
  firestore({ title: "T", thumbUrl: "javascript:alert(1)", listed: true });
  const html = await (await get("/b/b1", env)).text();
  assert.ok(!html.includes("javascript:"));
  setFetchImpl(null);
});

test("junk paths are not treated as Broadcast ids", async () => {
  resetMemory(); const env = await saEnv(); firestore({ title: "T", listed: true });
  for (const p of ["/b/", "/b/../secret", "/b/" + "x".repeat(200), "/b/a b"]) {
    const r = await get(p, env);
    assert.notEqual(r.headers.get("Content-Type"), "text/html; charset=utf-8");
  }
  setFetchImpl(null);
});
