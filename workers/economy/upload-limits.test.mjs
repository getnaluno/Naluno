/* 13a: the upload worker enforces the launch limits on the real bytes.
   A fake R2 bucket and a fake Firestore/Identity behind global fetch. */
import assert from "node:assert/strict";
import worker from "../../signal-worker-index.js";
import { defaultConfig, MIB, GIB } from "./launch.mjs";

/* ---- fake R2 ---- */
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
    async head(key) { const o = objs.get(key); return o ? { size: o.bytes.length, httpMetadata: o.httpMetadata, customMetadata: o.customMetadata } : null; },
    async get(key, opts) {
      const o = objs.get(key); if (!o) return null;
      let b = o.bytes;
      if (opts && opts.range) b = b.subarray(opts.range.offset || 0, (opts.range.offset || 0) + (opts.range.length || b.length));
      return { arrayBuffer: async () => b.slice().buffer, size: o.bytes.length, httpMetadata: o.httpMetadata };
    },
    async delete(key) { objs.delete(key); },
    async list({ prefix, limit }) {
      const keys = [...objs.keys()].filter((k) => k.startsWith(prefix)).slice(0, limit || 1000);
      return { objects: keys.map((k) => ({ key: k, size: objs.get(k).bytes.length, uploaded: objs.get(k).uploaded, customMetadata: objs.get(k).customMetadata })), truncated: false };
    },
    async createMultipartUpload(key, opts) {
      const id = "mpu" + (++n);
      mpus.set(id, { key, parts: [], opts });
      return { uploadId: id };
    },
    resumeMultipartUpload(key, id) {
      const self = this;
      return {
        async uploadPart(num, buf) { mpus.get(id).parts[num] = new Uint8Array(buf); return { etag: "e" + num }; },
        async complete() {
          const m = mpus.get(id);
          const total = m.parts.filter(Boolean).reduce((s, p) => s + p.length, 0);
          const out = new Uint8Array(total); let off = 0;
          m.parts.filter(Boolean).forEach((p) => { out.set(p, off); off += p.length; });
          await self.put(key, out, m.opts);
          mpus.delete(id);
        },
        async abort() { mpus.delete(id); },
      };
    },
  };
}

/* ---- real-format files ---- */
function be32(n) { return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]; }
function ascii(s) { return [...s].map((c) => c.charCodeAt(0)); }
function mp4(seconds, padBytes) {
  const ftyp = [...be32(16), ...ascii("ftypisom"), 0, 0, 0, 0];
  const mdat = [...be32(8 + padBytes), ...ascii("mdat"), ...new Array(padBytes).fill(0)];
  const mvhdBody = [0, 0, 0, 0, ...be32(0), ...be32(0), ...be32(1000), ...be32(Math.round(seconds * 1000)), ...new Array(80).fill(0)];
  const mvhd = [...be32(8 + mvhdBody.length), ...ascii("mvhd"), ...mvhdBody];
  const moov = [...be32(8 + mvhd.length), ...ascii("moov"), ...mvhd];
  return new Uint8Array([...ftyp, ...mdat, ...moov]); // moov at the end, as phone cameras write it
}
function webm(seconds) {
  const head = [0x1a, 0x45, 0xdf, 0xa3, 0x80, 0x18, 0x53, 0x80, 0x67, 0x80];
  const scale = [0x2a, 0xd7, 0xb1, 0x83, 0x0f, 0x42, 0x40]; // 1,000,000 ns
  const d = new DataView(new ArrayBuffer(8)); d.setFloat64(0, seconds * 1000);
  const dur = [0x44, 0x89, 0x88, ...new Uint8Array(d.buffer)];
  return new Uint8Array([...head, ...scale, ...dur, ...new Array(200).fill(0)]);
}
function png(w, h) { return new Uint8Array([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10, 0, 0, 0, 13, ...ascii("IHDR"), ...be32(w), ...be32(h), 8, 6, 0, 0, 0, ...new Array(64).fill(0)]); }
function jpeg(w, h) { return new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 17, 8, (h >> 8) & 255, h & 255, (w >> 8) & 255, w & 255, 3, ...new Array(64).fill(0)]); }

/* ---- fake Google ---- */
function fsEnc(v) {
  if (v === null) return { nullValue: null };
  if (typeof v === "boolean") return { booleanValue: v };
  if (typeof v === "number") return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === "string") return { stringValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(fsEnc) } };
  const f = {}; Object.keys(v).forEach((k) => { f[k] = fsEnc(v[k]); }); return { mapValue: { fields: f } };
}
let launchDoc = null; // the published public config
const registered = new Set(["alice", "bob"]);
const events = [];
globalThis.fetch = async (url, opts) => {
  const u = String(url);
  if (u.includes("accounts:lookup")) return new Response(JSON.stringify({ users: [{ localId: JSON.parse(opts.body).idToken.slice(4) }] }), { status: 200 });
  if (u.includes("/launchConfig/")) {
    if (!launchDoc) return new Response("{}", { status: 404 });
    const f = {}; Object.keys(launchDoc).forEach((k) => { f[k] = fsEnc(launchDoc[k]); });
    return new Response(JSON.stringify({ fields: f }), { status: 200 });
  }
  const m = /\/users\/([^?/]+)/.exec(u);
  if (m) return new Response("{}", { status: registered.has(m[1]) ? 200 : 404 });
  if (u.includes("/v1/launch/event")) { events.push(JSON.parse(opts.body)); return new Response("{}", { status: 200 }); }
  return new Response("{}", { status: 404 });
};

const ctx = { waitUntil: (p) => p };
async function send(env, path, uid, body, ct, method) {
  const headers = { Authorization: "Bearer tok-" + uid };
  if (ct) headers["Content-Type"] = ct;
  const res = await worker.fetch(new Request("https://up.example" + path, { method: method || "POST", headers, body }), env, ctx);
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
function publish(cfg, guardState) {
  launchDoc = { features: cfg.features, media: cfg.media, registration: cfg.registration, guardState: guardState || null };
}
const fresh = () => { /* the worker caches config for 60 s; tests move its clock */ };

const SIG = { SIGNAL_BUCKET: makeBucket(), FIREBASE_WEB_API_KEY: "k", SWEEP_KEY: "s".repeat(32) };
const BC = { BROADCAST_BUCKET: makeBucket(), FIREBASE_WEB_API_KEY: "k", SWEEP_KEY: "s".repeat(32) };

/* 1. No config published: today's behaviour (anyone signed in, 95 MiB ceiling). */
let r = await send(SIG, "/", "carol", png(100, 100), "image/png");
assert.equal(r.status, 200, "no launch config: nothing new is enforced");

/* From here a config is published. The worker caches it for 60 s, so each
   change below waits that out by moving Date.now. */
const realNow = Date.now;
let shift = 0;
Date.now = () => realNow() + shift;
const step = () => { shift += 61000; };
const cfg = defaultConfig();
publish(cfg);
step();

/* 2. Not registered (auth account without a Callsign profile): refused. */
r = await send(SIG, "/", "carol", png(100, 100), "image/png");
assert.equal(r.status, 403);
assert.equal(r.body.limit, "not-registered");

/* 3. Images: real pixels and real size. */
r = await send(SIG, "/", "alice", png(9000, 100), "image/png");
assert.equal(r.status, 413);
assert.equal(r.body.limit, "pixels");
assert.match(r.body.error, /9000×100/);
r = await send(SIG, "/", "alice", jpeg(800, 600), "image/jpeg");
assert.equal(r.status, 200);

/* 4. Signal video: real length from the MP4 header (moov at the end). */
r = await send(SIG, "/", "alice", mp4(300, 2000), "video/mp4");
assert.equal(r.status, 413);
assert.equal(r.body.limit, "length");
assert.match(r.body.error, /5 minutes long/);
r = await send(SIG, "/", "alice", mp4(30, 2000), "video/mp4");
assert.equal(r.status, 200);
r = await send(SIG, "/", "alice", webm(500), "video/webm");
assert.equal(r.body.limit, "length", "a WebM that states its length is checked");
const lenless = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, ...new Array(300).fill(0)]);
r = await send(SIG, "/", "alice", lenless, "video/webm");
assert.equal(r.status, 200, "an in-app recording without a stated length goes by size (size-only)");
cfg.media.unreadableDuration = "reject"; publish(cfg); step();
r = await send(SIG, "/", "alice", lenless, "video/webm");
assert.equal(r.body.limit, "length-unknown");
cfg.media.unreadableDuration = "size-only";

/* 5. Format list. */
r = await send(SIG, "/", "alice", new Uint8Array(100), "video/ogg");
assert.equal(r.body.limit, "format");

/* 6. Uploads a day and storage, from what is really stored. */
cfg.media.signal.uploadsPerDay = 3; publish(cfg); step();
r = await send(SIG, "/", "alice", png(10, 10), "image/png");
assert.equal(r.status, 429, "alice already has 3 stored today");
assert.equal(r.body.limit, "per-day");
r = await send(SIG, "/", "bob", png(10, 10), "image/png");
assert.equal(r.status, 200, "another person is not affected");
cfg.media.signal.uploadsPerDay = 100;
cfg.media.account.maxStorageBytes = 1500; publish(cfg); step();
r = await send(SIG, "/", "bob", new Uint8Array(2000).fill(1), "image/png");
assert.equal(r.body.limit, "storage");
cfg.media.account.maxStorageBytes = 0;

/* 7. Feature switch and guard. */
cfg.features.uploads = false; publish(cfg); step();
r = await send(SIG, "/", "alice", png(10, 10), "image/png");
assert.equal(r.status, 403);
assert.equal(r.body.limit, "uploads-off");
cfg.features.uploads = true;
publish(cfg, { level: "critical", restricting: { largeUploads: true, largeUploadBytes: 1000, newLives: true } }); step();
r = await send(SIG, "/", "bob", mp4(10, 3000), "video/mp4");
assert.equal(r.body.limit, "guard");
r = await send(SIG, "/", "bob", png(10, 10), "image/png");
assert.equal(r.status, 200, "small files still go through");
publish(cfg); step();

/* 8. Broadcast multipart: concurrency markers, the real file checked at the
      end and deleted if over, abort cleans up. */
cfg.media.broadcast.maxVideoSec = 60;
cfg.media.account.concurrentUploads = 1;
publish(cfg); step();
const init = async (uid, bytes) => send(BC, "/b/init", uid, JSON.stringify({ contentType: "video/mp4", bytes }), "application/json");
let a = await init("alice", 5000);
assert.equal(a.status, 200);
r = await init("alice", 5000);
assert.equal(r.status, 429);
assert.equal(r.body.limit, "at-once");
const file = mp4(120, 4000); // 2 minutes, over the 60 s limit
let p = await send(BC, "/b/part?key=" + encodeURIComponent(a.body.key) + "&uploadId=" + a.body.uploadId + "&part=1", "alice", file, "application/octet-stream", "PUT");
assert.equal(p.status, 200);
r = await send(BC, "/b/complete", "alice", JSON.stringify({ key: a.body.key, uploadId: a.body.uploadId, parts: [{ part: 1, etag: p.body.etag }], bytes: 10 }), "application/json");
assert.equal(r.status, 413, "the phone said 10 bytes; the stored file is measured");
assert.equal(r.body.limit, "length");
assert.ok(!BC.BROADCAST_BUCKET.objs.has(a.body.key), "the over-limit file is deleted");
assert.ok(![...BC.BROADCAST_BUCKET.objs.keys()].some((k) => k.startsWith("p/alice/")), "its marker is gone");
a = await init("alice", 5000);
assert.equal(a.status, 200, "a new upload can start");
r = await send(BC, "/b/abort", "alice", JSON.stringify({ key: a.body.key, uploadId: a.body.uploadId }), "application/json");
assert.equal(r.status, 200);
assert.ok(![...BC.BROADCAST_BUCKET.objs.keys()].some((k) => k.startsWith("p/alice/")));
r = await send(BC, "/b/abort", "bob", JSON.stringify({ key: a.body.key, uploadId: "x" }), "application/json");
assert.equal(r.status, 403, "nobody aborts another person's upload");
a = await init("alice", 5000);
const ok = mp4(45, 4000);
p = await send(BC, "/b/part?key=" + encodeURIComponent(a.body.key) + "&uploadId=" + a.body.uploadId + "&part=1", "alice", ok, "application/octet-stream", "PUT");
r = await send(BC, "/b/complete", "alice", JSON.stringify({ key: a.body.key, uploadId: a.body.uploadId, parts: [{ part: 1, etag: p.body.etag }], bytes: ok.length }), "application/json");
assert.equal(r.status, 200);
assert.equal(r.body.bytes, ok.length);
// a stale marker (an upload abandoned 2 days ago) is cleaned at the next start
await BC.BROADCAST_BUCKET.put("p/alice/old1", "", { customMetadata: { key: "b/alice/x.mp4", uploadId: "gone" } });
BC.BROADCAST_BUCKET.objs.get("p/alice/old1").uploaded = new Date(realNow() - 48 * 3600 * 1000);
a = await init("alice", 5000);
assert.equal(a.status, 200, "the abandoned upload does not count");
assert.ok(!BC.BROADCAST_BUCKET.objs.has("p/alice/old1"));

/* 9. Every outcome is reported to the economy worker, server to server. */
assert.ok(events.some((e) => e.ok === true && e.bytes > 0));
assert.ok(events.some((e) => e.ok === false && e.reason === "length"));
assert.ok(events.every((e) => e.worker === "signal" || e.worker === "broadcast"));

Date.now = realNow;
console.log("upload-limits: all checks passed");
