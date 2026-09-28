/**
 * PBKDF2-HMAC-SHA256 in plain JavaScript.
 *
 * Why this exists: Cloudflare Workers refuse PBKDF2 above 100,000
 * iterations ("iteration counts above 100000 are not supported"). The
 * Control Centre already has password copies made at 120,000 (the console's
 * own copy) and 150,000 (the worker's v2 copy). Inside a Worker those could
 * never be checked, so a correct password was reported as wrong.
 *
 * This computes exactly the same bytes as WebCrypto PBKDF2, so every
 * existing copy keeps working. Nothing about how anyone signs in changes.
 */

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);
const IV = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];

/* One compression of a 16-word block into an 8-word state (both Uint32Array). */
function compress(st, w) {
  let a = st[0], b = st[1], c = st[2], d = st[3], e = st[4], f = st[5], g = st[6], h = st[7];
  for (let i = 16; i < 64; i++) {
    const x = w[i - 15], y = w[i - 2];
    const s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
    const s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
    w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
  }
  for (let i = 0; i < 64; i++) {
    const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
    const ch = (e & f) ^ (~e & g);
    const t1 = (h + S1 + ch + K[i] + w[i]) | 0;
    const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
    const mj = (a & b) ^ (a & c) ^ (b & c);
    const t2 = (S0 + mj) | 0;
    h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
  }
  st[0] = (st[0] + a) | 0; st[1] = (st[1] + b) | 0; st[2] = (st[2] + c) | 0; st[3] = (st[3] + d) | 0;
  st[4] = (st[4] + e) | 0; st[5] = (st[5] + f) | 0; st[6] = (st[6] + g) | 0; st[7] = (st[7] + h) | 0;
}

/* Plain SHA-256 of bytes (used for the HMAC key when it is longer than a block). */
function sha256(bytes) {
  const len = bytes.length;
  const blocks = Math.ceil((len + 9) / 64);
  const buf = new Uint8Array(blocks * 64);
  buf.set(bytes);
  buf[len] = 0x80;
  const bits = len * 8;
  const dv = new DataView(buf.buffer);
  dv.setUint32(buf.length - 4, bits >>> 0);
  dv.setUint32(buf.length - 8, Math.floor(bits / 0x100000000));
  const st = new Uint32Array(IV);
  const w = new Uint32Array(64);
  for (let b = 0; b < blocks; b++) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(b * 64 + i * 4);
    compress(st, w);
  }
  const out = new Uint8Array(32);
  const ov = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) ov.setUint32(i * 4, st[i]);
  return out;
}

/* State after absorbing one 64-byte pad block. */
function padState(key, pad) {
  const w = new Uint32Array(64);
  for (let i = 0; i < 16; i++) {
    w[i] = (((key[i * 4] ^ pad) << 24) | ((key[i * 4 + 1] ^ pad) << 16)
      | ((key[i * 4 + 2] ^ pad) << 8) | (key[i * 4 + 3] ^ pad)) >>> 0;
  }
  const st = new Uint32Array(IV);
  compress(st, w);
  return st;
}

/* HMAC of a 32-byte message (as 8 words) given precomputed pad states.
   Writes the 8-word result into out. */
function hmac32(inner, outer, msg, out, w) {
  const st = new Uint32Array(inner);
  for (let i = 0; i < 8; i++) w[i] = msg[i];
  w[8] = 0x80000000;
  for (let i = 9; i < 15; i++) w[i] = 0;
  w[15] = (64 + 32) * 8;
  compress(st, w);
  const st2 = new Uint32Array(outer);
  for (let i = 0; i < 8; i++) w[i] = st[i];
  w[8] = 0x80000000;
  for (let i = 9; i < 15; i++) w[i] = 0;
  w[15] = (64 + 32) * 8;
  compress(st2, w);
  for (let i = 0; i < 8; i++) out[i] = st2[i];
}

/* HMAC of arbitrary bytes (used once per block for salt || INT(i)). */
function hmacBytes(inner, outer, msg) {
  const len = msg.length;
  const total = 64 + len;
  const blocks = Math.ceil((len + 9) / 64);
  const buf = new Uint8Array(blocks * 64);
  buf.set(msg);
  buf[len] = 0x80;
  const bits = total * 8;
  const dv = new DataView(buf.buffer);
  dv.setUint32(buf.length - 4, bits >>> 0);
  dv.setUint32(buf.length - 8, Math.floor(bits / 0x100000000));
  const st = new Uint32Array(inner);
  const w = new Uint32Array(64);
  for (let b = 0; b < blocks; b++) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(b * 64 + i * 4);
    compress(st, w);
  }
  const out = new Uint32Array(8);
  hmac32Finish(outer, st, out, w);
  return out;
}
function hmac32Finish(outer, innerDigest, out, w) {
  const st2 = new Uint32Array(outer);
  for (let i = 0; i < 8; i++) w[i] = innerDigest[i];
  w[8] = 0x80000000;
  for (let i = 9; i < 15; i++) w[i] = 0;
  w[15] = (64 + 32) * 8;
  compress(st2, w);
  for (let i = 0; i < 8; i++) out[i] = st2[i];
}

/**
 * PBKDF2-HMAC-SHA256. Returns `dkLen` bytes (default 32).
 * password: string or Uint8Array; salt: Uint8Array or string.
 */
export function pbkdf2Sha256Js(password, salt, iterations, dkLen) {
  const enc = new TextEncoder();
  let key = typeof password === "string" ? enc.encode(password) : new Uint8Array(password);
  const saltBytes = typeof salt === "string" ? enc.encode(salt) : new Uint8Array(salt);
  const iters = Math.max(1, Number(iterations) || 1);
  const length = dkLen || 32;
  if (key.length > 64) key = sha256(key);
  const k = new Uint8Array(64);
  k.set(key);
  const inner = padState(k, 0x36);
  const outer = padState(k, 0x5c);
  const out = new Uint8Array(length);
  const nBlocks = Math.ceil(length / 32);
  const w = new Uint32Array(64);
  for (let block = 1; block <= nBlocks; block++) {
    const msg = new Uint8Array(saltBytes.length + 4);
    msg.set(saltBytes);
    msg[saltBytes.length] = (block >>> 24) & 255;
    msg[saltBytes.length + 1] = (block >>> 16) & 255;
    msg[saltBytes.length + 2] = (block >>> 8) & 255;
    msg[saltBytes.length + 3] = block & 255;
    const u = hmacBytes(inner, outer, msg);
    const t = new Uint32Array(u);
    for (let i = 1; i < iters; i++) {
      hmac32(inner, outer, u, u, w);
      for (let j = 0; j < 8; j++) t[j] ^= u[j];
    }
    const off = (block - 1) * 32;
    for (let j = 0; j < 8 && off + j * 4 < length; j++) {
      const v = t[j];
      const bytes = [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];
      for (let q = 0; q < 4 && off + j * 4 + q < length; q++) out[off + j * 4 + q] = bytes[q];
    }
  }
  return out;
}

/** Cloudflare's WebCrypto ceiling. Above this, use the JS path. */
export const WORKER_PBKDF2_MAX = 100000;
