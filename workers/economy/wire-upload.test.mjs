/* Wireline uploads are not Broadcast uploads.
   Run: node workers/economy/wire-upload.test.mjs
   A long video is accepted on /w/ with no Reach pass.
   The same bytes are refused on /b/ when the Broadcast length limit says so.
   A docx is accepted. HTML is rejected and an over-limit object is deleted.
   Another account cannot finish a w/ key. */
import assert from "node:assert/strict";
import worker from "../../signal-worker-index.js";
import { defaultConfig } from "./launch.mjs";

function makeBucket() {
  const objs = new Map();
  const mpus = new Map();
  let n = 0;
  return {
    objs,
    async put(key, body, opts) {
      const bytes = typeof body === "string" ? new TextEncoder().encode(body) : new Uint8Array(body);
      objs.set(key, { bytes, uploaded: new Date(), httpMetadata: (opts && opts.httpMetadata) || {}, customMetadata: (opts && opts.customMetadata) || {} });
    },
    async head(key) {
      const o = objs.get(key);
      return o ? { size: o.bytes.length, httpMetadata: o.httpMetadata, customMetadata: o.customMetadata, uploaded: o.uploaded } : null;
    },
    async get(key, opts) {
      const o = objs.get(key);
      if (!o) return null;
      let b = o.bytes;
      if (opts && opts.range) b = b.subarray(opts.range.offset || 0, (opts.range.offset || 0) + (opts.range.length || b.length));
      return { arrayBuffer: async () => b.slice().buffer, size: o.bytes.length, httpMetadata: o.httpMetadata };
    },
    async delete(key) { objs.delete(key); },
    async list({ prefix, limit, cursor }) {
      const keys = [...objs.keys()].filter((k) => k.startsWith(prefix));
      const start = cursor ? Number(cursor) : 0;
      const slice = keys.slice(start, start + (limit || 1000));
      return {
        objects: slice.map((k) => ({ key: k, size: objs.get(k).bytes.length, uploaded: objs.get(k).uploaded, customMetadata: objs.get(k).customMetadata })),
        truncated: start + slice.length < keys.length,
        cursor: String(start + slice.length),
      };
    },
    async createMultipartUpload(key, opts) {
      const id = "mpu" + (++n);
      mpus.set(key + "|" + id, { key, parts: [], opts });
      return { uploadId: id };
    },
    resumeMultipartUpload(key, id) {
      const self = this;
      return {
        async uploadPart(num, buf) {
          const m = mpus.get(key + "|" + id);
          m.parts[num] = new Uint8Array(buf);
          return { etag: "e" + num };
        },
        async complete() {
          const m = mpus.get(key + "|" + id);
          const parts = m.parts.filter(Boolean);
          const total = parts.reduce((s, p) => s + p.length, 0);
          const out = new Uint8Array(total);
          let off = 0;
          parts.forEach((p) => { out.set(p, off); off += p.length; });
          await self.put(key, out, m.opts);
          mpus.delete(key + "|" + id);
        },
        async abort() { mpus.delete(key + "|" + id); },
      };
    },
  };
}

function be32(n) { return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]; }
function ascii(s) { return [...s].map((c) => c.charCodeAt(0)); }
function mp4(seconds, padBytes) {
  const ftyp = [...be32(16), ...ascii("ftypisom"), 0, 0, 0, 0];
  const mdat = [...be32(8 + padBytes), ...ascii("mdat"), ...new Array(padBytes).fill(0)];
  const mvhdBody = [0, 0, 0, 0, ...be32(0), ...be32(0), ...be32(1000), ...be32(Math.round(seconds * 1000)), ...new Array(80).fill(0)];
  const mvhd = [...be32(8 + mvhdBody.length), ...ascii("mvhd"), ...mvhdBody];
  const moov = [...be32(8 + mvhd.length), ...ascii("moov"), ...mvhd];
  return new Uint8Array([...ftyp, ...mdat, ...moov]);
}

function fsEnc(v) {
  if (v === null) return { nullValue: null };
  if (typeof v === "boolean") return { booleanValue: v };
  if (typeof v === "number") return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === "string") return { stringValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(fsEnc) } };
  const f = {};
  Object.keys(v).forEach((k) => { f[k] = fsEnc(v[k]); });
  return { mapValue: { fields: f } };
}

let launchDoc = null;
const registered = new Set(["alice", "bob", "dave"]);
globalThis.fetch = async (url, opts) => {
  const u = String(url);
  if (u.includes("accounts:lookup")) {
    return new Response(JSON.stringify({ users: [{ localId: JSON.parse(opts.body).idToken.slice(4) }] }), { status: 200 });
  }
  if (u.includes("/launchConfig/")) {
    if (!launchDoc) return new Response("{}", { status: 404 });
    const f = {};
    Object.keys(launchDoc).forEach((k) => { f[k] = fsEnc(launchDoc[k]); });
    return new Response(JSON.stringify({ fields: f }), { status: 200 });
  }
  const m = /\/users\/([^?/]+)/.exec(u);
  if (m) return new Response("{}", { status: registered.has(m[1]) ? 200 : 404 });
  return new Response("{}", { status: 404 });
};

const ctx = { waitUntil: (p) => p };
const bucket = makeBucket();
const env = { BROADCAST_BUCKET: bucket, FIREBASE_WEB_API_KEY: "k", SWEEP_KEY: "s".repeat(32) };

async function send(path, uid, body, ct, method) {
  const headers = { Authorization: "Bearer tok-" + uid };
  if (ct) headers["Content-Type"] = ct;
  const res = await worker.fetch(new Request("https://up.example" + path, { method: method || "POST", headers, body }), env, ctx);
  const text = await res.text();
  let parsed = {};
  try { parsed = text ? JSON.parse(text) : {}; } catch (_) { parsed = { raw: text }; }
  return { status: res.status, body: parsed };
}

const cfg = defaultConfig();
cfg.media.broadcast.maxVideoSec = 60;
launchDoc = { features: cfg.features, media: cfg.media, registration: cfg.registration };

const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

async function wirePut(uid, contentType, name, kind, file) {
  const init = await send("/w/init", uid, JSON.stringify({ contentType, bytes: file.length, name, kind }), "application/json");
  if (init.status !== 200) return { init, res: init };
  const part = await send("/w/part?key=" + encodeURIComponent(init.body.key) + "&uploadId=" + encodeURIComponent(init.body.uploadId) + "&part=1", uid, file, "application/octet-stream", "PUT");
  const done = await send("/w/complete", uid, JSON.stringify({
    key: init.body.key,
    uploadId: init.body.uploadId,
    parts: [{ part: 1, etag: part.body.etag }],
    bytes: file.length,
    reachPass: "should-be-ignored",
  }), "application/json");
  return { init, part, res: done, key: init.body.key };
}

let r = await send("/b/init", "alice", JSON.stringify({ contentType: DOCX, bytes: 80, name: "report.docx" }), "application/json");
assert.equal(r.status, 415, "Broadcast still refuses a Word file");

const docx = new Uint8Array([0x50, 0x4b, 0x03, 0x04, ...new Array(80).fill(0)]);
let w = await wirePut("alice", DOCX, "report.docx", "document", docx);
assert.equal(w.res.status, 200, w.res.body.error || "docx");
assert.ok(String(w.res.body.key).startsWith("w/alice/"), w.res.body.key);
assert.equal(w.res.body.purpose, "wireline");
assert.ok(![...bucket.objs.keys()].some((k) => k.startsWith("b/alice/") && k.endsWith(".docx")));

const long = mp4(120, 4000);
w = await wirePut("alice", "video/mp4", "long.mp4", "video", long);
assert.equal(w.res.status, 200, "a two-minute video needs no Reach pass on Wireline: " + (w.res.body.error || w.res.body.limit || ""));
assert.ok(String(w.key).startsWith("w/alice/"));
assert.equal(w.res.body.bytes, long.length);

const bInit = await send("/b/init", "alice", JSON.stringify({ contentType: "video/mp4", bytes: long.length }), "application/json");
assert.equal(bInit.status, 200);
const bPart = await send("/b/part?key=" + encodeURIComponent(bInit.body.key) + "&uploadId=" + encodeURIComponent(bInit.body.uploadId) + "&part=1", "alice", long, "application/octet-stream", "PUT");
r = await send("/b/complete", "alice", JSON.stringify({ key: bInit.body.key, uploadId: bInit.body.uploadId, parts: [{ part: 1, etag: bPart.body.etag }], bytes: long.length }), "application/json");
assert.equal(r.status, 413, "the same video is still under the Broadcast length rule");
assert.equal(r.body.limit, "length");
assert.ok(!bucket.objs.has(bInit.body.key), "Broadcast deletes the over-length file");

r = await send("/w/init", "alice", JSON.stringify({ contentType: "text/html", bytes: 32, name: "page.html", kind: "document" }), "application/json");
assert.equal(r.status, 415);
assert.equal(r.body.limit, "type");

r = await send("/w/init", "alice", JSON.stringify({ contentType: "image/svg+xml", bytes: 32, name: "x.svg", kind: "photo" }), "application/json");
assert.equal(r.status, 415);

const trap = new TextEncoder().encode("<html><script>alert(1)</script>");
w = await wirePut("alice", "text/plain", "notes.txt", "document", trap);
assert.equal(w.res.status, 415, "a document that is actually HTML is refused after it is stored");
assert.equal(w.res.body.limit, "type");
assert.ok(!bucket.objs.has(w.key), "and deleted");

r = await send("/w/init", "alice", JSON.stringify({ contentType: "image/jpeg", bytes: 0, name: "a.jpg", kind: "photo" }), "application/json");
assert.equal(r.status, 400);

r = await send("/w/init", "alice", JSON.stringify({ contentType: "audio/webm", bytes: 17 * 1024 * 1024, name: "voice.webm", kind: "voice" }), "application/json");
assert.equal(r.status, 413);
assert.equal(r.body.limit, "size");
assert.match(r.body.error, /Wireline limit/);

const jpegHead = [0xff, 0xd8, 0xff, 0xe0];
const tooBig = new Uint8Array(25 * 1024 * 1024 + 64);
jpegHead.forEach((b, i) => { tooBig[i] = b; });
const smallClaim = await send("/w/init", "alice", JSON.stringify({ contentType: "image/jpeg", bytes: 1000, name: "big.jpg", kind: "photo" }), "application/json");
assert.equal(smallClaim.status, 200, "the phone's claimed size is not trusted");
const bigPart = await send("/w/part?key=" + encodeURIComponent(smallClaim.body.key) + "&uploadId=" + encodeURIComponent(smallClaim.body.uploadId) + "&part=1", "alice", tooBig, "application/octet-stream", "PUT");
assert.equal(bigPart.status, 200);
r = await send("/w/complete", "alice", JSON.stringify({ key: smallClaim.body.key, uploadId: smallClaim.body.uploadId, parts: [{ part: 1, etag: bigPart.body.etag }], bytes: 1000 }), "application/json");
assert.equal(r.status, 413, "the stored size is what counts");
assert.ok(!bucket.objs.has(smallClaim.body.key), "an over-limit object is deleted");

const mine = await send("/w/init", "alice", JSON.stringify({ contentType: "image/jpeg", bytes: 8, name: "a.jpg", kind: "photo" }), "application/json");
assert.equal(mine.status, 200);
r = await send("/w/part?key=" + encodeURIComponent(mine.body.key) + "&uploadId=" + encodeURIComponent(mine.body.uploadId) + "&part=1", "bob", new Uint8Array(jpegHead), "application/octet-stream", "PUT");
assert.equal(r.status, 403, "bob cannot write alice's Wireline key");
r = await send("/w/complete", "bob", JSON.stringify({ key: mine.body.key, uploadId: mine.body.uploadId, parts: [{ part: 1, etag: "e1" }] }), "application/json");
assert.equal(r.status, 403);
assert.ok(!bucket.objs.has(mine.body.key));
await send("/w/abort", "alice", JSON.stringify({ key: mine.body.key, uploadId: mine.body.uploadId }), "application/json");

const open = [];
for (let i = 0; i < 3; i++) {
  const one = await send("/w/init", "dave", JSON.stringify({ contentType: "image/jpeg", bytes: 8, name: "c" + i + ".jpg", kind: "photo" }), "application/json");
  assert.equal(one.status, 200, one.body.error || "open " + i);
  open.push(one.body);
}
r = await send("/w/init", "dave", JSON.stringify({ contentType: "image/jpeg", bytes: 8, name: "c4.jpg", kind: "photo" }), "application/json");
assert.equal(r.status, 429);
assert.equal(r.body.limit, "at-once");
for (const one of open) {
  await send("/w/abort", "dave", JSON.stringify({ key: one.key, uploadId: one.uploadId }), "application/json");
}
r = await send("/w/init", "dave", JSON.stringify({ contentType: "image/jpeg", bytes: 8, name: "after.jpg", kind: "photo" }), "application/json");
assert.equal(r.status, 200, "abort frees the slot");
await send("/w/abort", "dave", JSON.stringify({ key: r.body.key, uploadId: r.body.uploadId }), "application/json");

for (let i = 0; i < 80; i++) {
  await bucket.put("w/bob/n" + i + ".jpg", new Uint8Array([0xff, 0xd8, 1]), { httpMetadata: { contentType: "image/jpeg" }, customMetadata: { kind: "photo" } });
}
r = await send("/w/init", "bob", JSON.stringify({ contentType: "image/jpeg", bytes: 8, name: "more.jpg", kind: "photo" }), "application/json");
assert.equal(r.status, 429);
assert.equal(r.body.limit, "per-day");
r = await send("/w/init", "alice", JSON.stringify({ contentType: "image/jpeg", bytes: 8, name: "alice-still.jpg", kind: "photo" }), "application/json");
assert.equal(r.status, 200, "bob's daily cap does not apply to alice");
await send("/w/abort", "alice", JSON.stringify({ key: r.body.key, uploadId: r.body.uploadId }), "application/json");

console.log("wire-upload: all checks passed");
