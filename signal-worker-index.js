/**
 * naluno-signal-upload
 * POST /          — auth required, body = media bytes, max 95 MiB
 * GET|HEAD /o/**  — public stream with proper Range support (required for mobile video)
 */
const MAX_BYTES = 95 * 1024 * 1024; // one Worker request: a simple POST or a single part
const MAX_OBJECT_BYTES = 8 * 1024 * 1024 * 1024; // finished file after the parts are joined

const SAFE_TYPES = {
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
  'video/3gpp': '3gp',
  'video/3gpp2': '3g2',
  'video/x-m4v': 'm4v',
  'video/mpeg': 'mpg',
  'video/ogg': 'ogv',
  'audio/webm': 'webm',
  'audio/mp4': 'm4a',
  'audio/mpeg': 'mp3',
  'audio/ogg': 'ogg',
  'audio/wav': 'wav',
  'audio/aac': 'aac',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'application/pdf': 'pdf',
  'application/octet-stream': 'bin',
};
function cleanType(raw) {
  return String(raw || '').split(';')[0].trim().toLowerCase();
}
function allowedType(raw) {
  const t = cleanType(raw);
  if (!t) return '';
  if (SAFE_TYPES[t]) return t;
  if (t === 'image/svg+xml' || t === 'text/html' || t === 'application/xhtml+xml' || t.indexOf('javascript') >= 0 || t === 'text/xml') return '';
  if (t.indexOf('video/') === 0 || t.indexOf('audio/') === 0 || t.indexOf('image/') === 0) return t;
  return '';
}
function extFor(ct) {
  if (SAFE_TYPES[ct]) return SAFE_TYPES[ct];
  const sub = String(ct.split('/')[1] || 'bin').replace(/[^a-z0-9]/g, '').slice(0, 8);
  return sub || 'bin';
}
function ownsKey(key, uid) {
  return key.startsWith('u/' + uid + '/') || key.startsWith('b/' + uid + '/');
}
function looksActive(buf) {
  const u = new Uint8Array(buf.slice(0, Math.min(64, buf.byteLength)));
  let s = '';
  for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]);
  const head = s.replace(/^\uFEFF/, '').trim().slice(0, 24).toLowerCase();
  return head.startsWith('<html') || head.startsWith('<svg') || head.startsWith('<!doctype') || head.startsWith('<script');
}
function typeFromName(key) {
  const name = String(key || '').toLowerCase();
  if (/\.(mp4|m4v|hevc|h265)$/.test(name)) return 'video/mp4';
  if (/\.webm$/.test(name)) return 'video/webm';
  if (/\.(mov|qt)$/.test(name)) return 'video/quicktime';
  if (/\.3gp$/.test(name)) return 'video/3gpp';
  if (/\.3g2$/.test(name)) return 'video/3gpp2';
  if (/\.mkv$/.test(name)) return 'video/x-matroska';
  if (/\.(jpe?g)$/.test(name)) return 'image/jpeg';
  if (/\.png$/.test(name)) return 'image/png';
  if (/\.webp$/.test(name)) return 'image/webp';
  if (/\.gif$/.test(name)) return 'image/gif';
  if (/\.pdf$/.test(name)) return 'application/pdf';
  return '';
}
function sniffHeaders(contentType, extra, key) {
  let ct = allowedType(contentType);
  if (!ct || ct === 'application/octet-stream') {
    ct = typeFromName(key) || ct || cleanType(contentType) || 'application/octet-stream';
  }
  return Object.assign({
    'Content-Type': ct,
    'X-Content-Type-Options': 'nosniff',
  }, extra || {});
}
function bucketOf(env) {
  return (env && (env.SIGNAL_BUCKET || env.BROADCAST_BUCKET)) || null;
}

async function verifyFirebaseIdToken(idToken, env) {
  const apiKey = env.FIREBASE_WEB_API_KEY;
  if (!apiKey || !idToken) return null;
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken }),
    }
  );
  if (!res.ok) return null;
  const data = await res.json();
  const user = data.users && data.users[0];
  return user ? user.localId : null;
}

function corsHeaders(origin, extra) {
  return Object.assign({
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS, HEAD',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, Range, Content-Length, X-Requested-With',
    'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges, Content-Type',
    'Access-Control-Max-Age': '86400',
  }, extra || {});
}

function json(body, status, origin) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' },
  });
}

/** Parse "bytes=START-END" into R2 range option. */
function parseRangeHeader(rangeHeader, totalSize) {
  if (!rangeHeader || typeof rangeHeader !== 'string') return null;
  const m = /^bytes=(\d*)-(\d*)$/i.exec(rangeHeader.trim());
  if (!m) return null;
  const start = m[1] === '' ? null : parseInt(m[1], 10);
  const end = m[2] === '' ? null : parseInt(m[2], 10);
  if (start == null && end == null) return null;
  // suffix bytes: bytes=-500
  if (start == null && end != null) {
    return { suffix: end };
  }
  if (start != null && end != null) {
    if (start > end || start >= totalSize) return null;
    return { offset: start, length: end - start + 1 };
  }
  // bytes=START-
  if (start != null && end == null) {
    if (start >= totalSize) return null;
    return { offset: start };
  }
  return null;
}

async function serveObject(request, env, origin) {
  const url = new URL(request.url);
  // pathname: /o/u/uid/file.webm  → key u/uid/file.webm
  let key = decodeURIComponent(url.pathname.replace(/^\/o\//, ''));
  key = key.replace(/^\/+/, '');
  if (!key || key.includes('..')) {
    return new Response('Not found', { status: 404, headers: corsHeaders(origin) });
  }

  // HEAD/GET without range first to know size when needed
  const rangeHeader = request.headers.get('Range');

  // Edge cache for full (non-Range) GET /o/** — instant rewatch without re-hitting R2.
  // Range requests stay on the R2 path (browser progressive playback).
  // Pair with a Cloudflare Cache Rule on /o/** if dashboard caching is preferred.
  if (!rangeHeader && request.method === 'GET') {
    try {
      const cache = caches.default;
      const cacheKey = new Request(url.origin + url.pathname, { method: 'GET' });
      const hit = await cache.match(cacheKey);
      if (hit) {
        const headers = new Headers(hit.headers);
        const cors = corsHeaders(origin);
        Object.keys(cors).forEach(function (k) { headers.set(k, cors[k]); });
        headers.set('X-Content-Type-Options', 'nosniff');
        headers.delete('Content-Security-Policy');
        return new Response(hit.body, { status: hit.status, statusText: hit.statusText, headers });
      }
    } catch (_) {}
  }

  // Always try full metadata first when range is present so we can compute length
  let obj;
  if (rangeHeader) {
    const head = await bucketOf(env).head(key);
    if (!head) {
      return new Response('Not found', { status: 404, headers: corsHeaders(origin) });
    }
    const total = head.size;
    const r2range = parseRangeHeader(rangeHeader, total);
    if (!r2range) {
      // Invalid range → 416
      return new Response(null, {
        status: 416,
        headers: corsHeaders(origin, {
          'Content-Range': `bytes */${total}`,
          'Accept-Ranges': 'bytes',
        }),
      });
    }
    obj = await bucketOf(env).get(key, { range: r2range });
    if (!obj) {
      return new Response('Not found', { status: 404, headers: corsHeaders(origin) });
    }
    const offset = obj.range ? obj.range.offset : (r2range.offset || 0);
    const length = obj.range ? obj.range.length : (r2range.length || (total - offset));
    const headers = corsHeaders(origin, sniffHeaders((obj.httpMetadata && obj.httpMetadata.contentType) || head.httpMetadata?.contentType, {
      'Accept-Ranges': 'bytes',
      'Content-Length': String(length),
      'Content-Range': `bytes ${offset}-${offset + length - 1}/${total}`,
      'Cache-Control': 'public, max-age=3600',
    }, key));
    if (request.method === 'HEAD') {
      return new Response(null, { status: 206, headers });
    }
    return new Response(obj.body, { status: 206, headers });
  }

  obj = await bucketOf(env).get(key);
  if (!obj) {
    return new Response('Not found', { status: 404, headers: corsHeaders(origin) });
  }
  const headers = corsHeaders(origin, sniffHeaders((obj.httpMetadata && obj.httpMetadata.contentType), {
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'public, max-age=31536000, immutable',
  }, key));
  if (url.searchParams.get('dl') === '1') {
    const fn = (url.searchParams.get('fn') || key.split('/').pop() || 'slip').replace(/[^\w.\-]+/g, '_');
    headers['Content-Disposition'] = 'attachment; filename="' + fn + '"';
  }
  if (obj.size != null) headers['Content-Length'] = String(obj.size);
  if (request.method === 'HEAD') {
    return new Response(null, { status: 200, headers });
  }
  const response = new Response(obj.body, { status: 200, headers });
  // Populate edge cache for the next full GET (fire-and-forget).
  try {
    const cache = caches.default;
    const cacheKey = new Request(url.origin + url.pathname, { method: 'GET' });
    const toStore = response.clone();
    cache.put(cacheKey, toStore).catch(function () {});
  } catch (_) {}
  return response;
}


/* ================= 13a: Launch & Capacity limits =================
   The desk sets them in the console; the economy worker publishes them to
   launchConfig/{env} (public read). This worker enforces them on the bytes it
   actually receives: nothing the phone says about size, length or pixels is
   trusted. If the config cannot be read, today's behaviour stays (the 8 GB
   object and 95 MiB request ceilings above still apply). */
const LAUNCH_TTL_MS = 60 * 1000;
let launchCache = { at: 0, value: null };
function fsVal(v) {
  if (!v || typeof v !== 'object') return null;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return Number(v.doubleValue);
  if ('booleanValue' in v) return !!v.booleanValue;
  if ('nullValue' in v) return null;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(fsVal);
  if ('mapValue' in v) { const o = {}; const f = (v.mapValue && v.mapValue.fields) || {}; Object.keys(f).forEach(function (k) { o[k] = fsVal(f[k]); }); return o; }
  return null;
}
function fsDoc(d) { const o = {}; const f = (d && d.fields) || {}; Object.keys(f).forEach(function (k) { o[k] = fsVal(f[k]); }); return o; }
function fsBase(env) {
  const project = (env && env.FIREBASE_PROJECT_ID) || 'naluno-28a00';
  return 'https://firestore.googleapis.com/v1/projects/' + project + '/databases/(default)/documents';
}
async function launchConfig(env) {
  const now = Date.now();
  if (launchCache.value && now - launchCache.at < LAUNCH_TTL_MS) return launchCache.value;
  try {
    const which = String((env && env.LAUNCH_ENV) || '').toLowerCase() === 'staging' ? 'staging' : 'production';
    const res = await fetch(fsBase(env) + '/launchConfig/' + which + '?key=' + encodeURIComponent(env.FIREBASE_WEB_API_KEY || ''));
    if (res.status === 404) { launchCache = { at: now, value: { none: true } }; return launchCache.value; }
    if (!res.ok) return launchCache.value; // keep the last good one
    launchCache = { at: now, value: fsDoc(await res.json()) };
  } catch (_) {}
  return launchCache.value;
}
const registeredSeen = new Map();
/* A registered account has a Callsign profile. Read with the person's own
   sign-in (the rules let a signed-in person read a profile). */
async function isRegistered(env, uid, idToken) {
  const hit = registeredSeen.get(uid);
  if (hit && Date.now() - hit < 10 * 60 * 1000) return true;
  try {
    const res = await fetch(fsBase(env) + '/users/' + encodeURIComponent(uid) + '?mask.fieldPaths=createdAt', { headers: { Authorization: 'Bearer ' + idToken } });
    if (res.ok) { if (registeredSeen.size > 5000) registeredSeen.clear(); registeredSeen.set(uid, Date.now()); return true; }
    if (res.status === 404) return false;
  } catch (_) {}
  return true; // cannot tell (Google unreachable): do not lock out a person who may be registered
}
function kindOf(ct) {
  const t = String(ct || '');
  if (t.indexOf('video/') === 0) return 'video';
  if (t.indexOf('image/') === 0) return 'image';
  if (t.indexOf('audio/') === 0) return 'audio';
  return 'other';
}
function limitsFor(cfg, env) {
  const m = (cfg && cfg.media) || null;
  if (!m) return null;
  const which = env && env._nalunoBroadcast ? 'broadcast' : 'signal';
  return { kind: which, own: m[which] || {}, account: m.account || {}, formats: m.formats || {}, incompleteHours: Number(m.incompleteUploadHours) || 24, unreadable: m.unreadableDuration || 'size-only' };
}
function mb(n) { return n >= 1024 * 1024 * 1024 ? (Math.round(n / (1024 * 1024 * 1024) * 10) / 10) + ' GB' : Math.round(n / (1024 * 1024)) + ' MB'; }
function mins(sec) { return sec >= 3600 ? (Math.round(sec / 360) / 10) + ' hours' : (sec >= 60 ? Math.round(sec / 60) + ' minutes' : sec + ' seconds'); }
function refuse(reason, message, status) { return { ok: false, reason: reason, message: message, status: status || 413 }; }

/* What this person already holds in this store, and what they sent today. */
async function usageOf(env, uid) {
  const prefixes = ['u/' + uid + '/', 'b/' + uid + '/'];
  const midnight = new Date(); midnight.setUTCHours(0, 0, 0, 0);
  const out = { storedBytes: 0, todayCount: 0, todayBytes: 0 };
  for (const prefix of prefixes) {
    let cursor; let pages = 0;
    while (pages < 10) {
      pages++;
      const listed = await env.SIGNAL_BUCKET.list({ prefix: prefix, cursor: cursor, limit: 1000 });
      (listed.objects || []).forEach(function (o) {
        out.storedBytes += Number(o.size) || 0;
        const at = o.uploaded ? new Date(o.uploaded).getTime() : 0;
        if (at >= midnight.getTime()) { out.todayCount++; out.todayBytes += Number(o.size) || 0; }
      });
      if (!listed.truncated) break;
      cursor = listed.cursor;
    }
  }
  return out;
}

/* The checks before any bytes are stored (declaredBytes is only the phone's
   word here; the real size is checked again on the stored file). */
async function checkBefore(env, cfg, uid, ct, declaredBytes) {
  if (!cfg || cfg.none) return { ok: true };
  if (cfg.features && cfg.features.uploads === false) return refuse('uploads-off', 'Uploads are paused on Naluno for now. Nothing you posted before is affected.', 403);
  const L = limitsFor(cfg, env);
  if (!L) return { ok: true };
  const kind = kindOf(ct);
  if (kind !== 'other') {
    const list = L.formats[kind];
    if (Array.isArray(list) && list.length && list.indexOf(ct) < 0) return refuse('format', 'That ' + kind + ' format is not accepted right now. Try ' + list.map(function (t) { return t.split('/')[1]; }).join(', ') + '.', 415);
  }
  const max = kind === 'image' ? Number(L.own.maxImageBytes) || 0 : (kind === 'video' ? Number(L.own.maxVideoBytes) || 0 : 0);
  if (max > 0 && declaredBytes > max) return refuse('size', 'That file is ' + mb(declaredBytes) + '. The limit is ' + mb(max) + '.', 413);
  const g = cfg.guardState && cfg.guardState.restricting;
  if (g && g.largeUploads && Number(g.largeUploadBytes) > 0 && declaredBytes > Number(g.largeUploadBytes)) {
    return refuse('guard', 'Naluno is close to its storage budget, so uploads over ' + mb(Number(g.largeUploadBytes)) + ' are paused for now. Smaller files still go through.', 503);
  }
  const perDay = Number(L.own.uploadsPerDay) || 0, bytesDay = Number(L.own.bytesPerDay) || 0, store = Number(L.account.maxStorageBytes) || 0;
  if (perDay || bytesDay || store) {
    const u = await usageOf(env, uid);
    if (perDay && u.todayCount >= perDay) return refuse('per-day', 'You have sent ' + perDay + ' uploads today, the most for one day. It opens again at midnight (UTC).', 429);
    if (bytesDay && u.todayBytes + declaredBytes > bytesDay) return refuse('bytes-day', 'This would take you past ' + mb(bytesDay) + ' uploaded today. It opens again at midnight (UTC).', 429);
    if (store && u.storedBytes + declaredBytes > store) return refuse('storage', 'Your files would pass the ' + mb(store) + ' you can keep. Remove something you no longer need, then try again.', 413);
  }
  return { ok: true };
}

/* ---- reading the file itself ---- */
function u32(b, i) { return ((b[i] << 24) >>> 0) + (b[i + 1] << 16) + (b[i + 2] << 8) + b[i + 3]; }
function u64(b, i) { return u32(b, i) * 4294967296 + u32(b, i + 4); }
function fourcc(b, i) { return String.fromCharCode(b[i], b[i + 1], b[i + 2], b[i + 3]); }
/* MP4 / MOV: the movie header (mvhd) holds the length. readAt(offset, n). */
async function mp4Seconds(readAt, total) {
  let off = 0;
  for (let n = 0; n < 64 && off + 8 <= total; n++) {
    const h = await readAt(off, 16);
    if (!h || h.length < 8) return null;
    let size = u32(h, 0);
    const type = fourcc(h, 4);
    if (size === 1) size = u64(h, 8);
    else if (size === 0) size = total - off;
    if (size < 8) return null;
    if (type === 'moov') {
      const box = await readAt(off, Math.min(size, 8 * 1024 * 1024));
      for (let i = 4; i + 36 < box.length; i++) {
        if (box[i] === 0x6d && box[i + 1] === 0x76 && box[i + 2] === 0x68 && box[i + 3] === 0x64) { // 'mvhd'
          const v = box[i + 4];
          const scale = v === 1 ? u32(box, i + 24) : u32(box, i + 16);
          const dur = v === 1 ? u64(box, i + 28) : u32(box, i + 20);
          if (!scale || dur === 0xffffffff) return null;
          return dur / scale;
        }
      }
      return null;
    }
    off += size;
  }
  return null;
}
/* WebM: Segment Info Duration (0x4489), in TimecodeScale units (0x2AD7B1,
   default 1 ms). Files from a phone's recorder often leave it out. */
function webmSeconds(b) {
  let scale = 1000000;
  for (let i = 0; i + 4 < b.length; i++) {
    if (b[i] === 0x2a && b[i + 1] === 0xd7 && b[i + 2] === 0xb1) {
      const len = b[i + 3] & 0x7f;
      if (len > 0 && len <= 8) { let v = 0; for (let k = 0; k < len; k++) v = v * 256 + b[i + 4 + k]; if (v > 0) scale = v; }
    }
    if (b[i] === 0x44 && b[i + 1] === 0x89 && (b[i + 2] === 0x84 || b[i + 2] === 0x88)) {
      const dv = new DataView(b.buffer, b.byteOffset + i + 3, b[i + 2] === 0x84 ? 4 : 8);
      const d = b[i + 2] === 0x84 ? dv.getFloat32(0) : dv.getFloat64(0);
      if (isFinite(d) && d > 0) return d * scale / 1e9;
    }
  }
  return null;
}
function imageSize(b) {
  if (b.length > 24 && b[0] === 0x89 && b[1] === 0x50) return { w: u32(b, 16), h: u32(b, 20) }; // PNG
  if (b.length > 10 && b[0] === 0x47 && b[1] === 0x49) return { w: b[6] | (b[7] << 8), h: b[8] | (b[9] << 8) }; // GIF
  if (b.length > 30 && fourcc(b, 0) === 'RIFF' && fourcc(b, 8) === 'WEBP') {
    const t = fourcc(b, 12);
    if (t === 'VP8 ') return { w: (b[26] | (b[27] << 8)) & 0x3fff, h: (b[28] | (b[29] << 8)) & 0x3fff };
    if (t === 'VP8L') { const x = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24); return { w: (x & 0x3fff) + 1, h: ((x >> 14) & 0x3fff) + 1 }; }
    if (t === 'VP8X') return { w: 1 + (b[24] | (b[25] << 8) | (b[26] << 16)), h: 1 + (b[27] | (b[28] << 8) | (b[29] << 16)) };
  }
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) { // JPEG
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const m = b[i + 1];
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { h: (b[i + 5] << 8) | b[i + 6], w: (b[i + 7] << 8) | b[i + 8] };
      i += 2 + ((b[i + 2] << 8) | b[i + 3]);
    }
  }
  return null;
}
/* The checks on the stored (or received) file: real size, real length,
   real pixels. readAt reads from it; total is its real size. */
async function checkFile(env, cfg, ct, total, readAt) {
  if (!cfg || cfg.none) return { ok: true };
  const L = limitsFor(cfg, env);
  if (!L) return { ok: true };
  const kind = kindOf(ct);
  if (kind === 'image') {
    const max = Number(L.own.maxImageBytes) || 0;
    if (max && total > max) return refuse('size', 'That image is ' + mb(total) + '. The limit is ' + mb(max) + '.', 413);
    const side = Number(L.own.maxImageSide) || 0;
    if (side) {
      const dim = imageSize(await readAt(0, 256 * 1024));
      if (dim && (dim.w > side || dim.h > side)) return refuse('pixels', 'That image is ' + dim.w + '×' + dim.h + '. The longest side can be ' + side + ' pixels.', 413);
    }
  }
  if (kind === 'video') {
    const max = Number(L.own.maxVideoBytes) || 0;
    if (max && total > max) return refuse('size', 'That video is ' + mb(total) + '. The limit is ' + mb(max) + '.', 413);
    const maxSec = Number(L.own.maxVideoSec) || 0;
    if (maxSec) {
      let sec = null;
      if (ct === 'video/webm') sec = webmSeconds(await readAt(0, 64 * 1024));
      else sec = await mp4Seconds(readAt, total);
      if (sec == null && L.unreadable === 'reject') return refuse('length-unknown', 'The length of that video could not be read from the file, so it cannot be checked. Try saving it as MP4.', 415);
      if (sec != null && sec > maxSec + 1) return refuse('length', 'That video is ' + mins(Math.round(sec)) + ' long. The limit is ' + mins(maxSec) + '.', 413);
    }
  }
  return { ok: true };
}

/* Uploads in progress: a small marker per multipart upload, so "uploads at
   once" can be counted and an abandoned upload cleaned away. */
async function openUploads(env, uid, hours) {
  const listed = await env.SIGNAL_BUCKET.list({ prefix: 'p/' + uid + '/', limit: 100, include: ['customMetadata'] });
  const live = [];
  const stale = Date.now() - hours * 3600 * 1000;
  for (const o of (listed.objects || [])) {
    const at = o.uploaded ? new Date(o.uploaded).getTime() : 0;
    const meta = o.customMetadata || {};
    if (at && at < stale) {
      try { if (meta.key && meta.uploadId) await env.SIGNAL_BUCKET.resumeMultipartUpload(meta.key, meta.uploadId).abort(); } catch (_) {}
      try { await env.SIGNAL_BUCKET.delete(o.key); } catch (_) {}
    } else live.push(o);
  }
  return live.length;
}
function markerKey(uid, uploadId) { return 'p/' + uid + '/' + String(uploadId).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 120); }
async function dropMarker(env, uid, uploadId) {
  const k = markerKey(uid, uploadId);
  try { if (await env.SIGNAL_BUCKET.head(k)) await env.SIGNAL_BUCKET.delete(k); } catch (_) {}
}

/* Tell the economy worker what happened (counts for the console). */
function report(env, ctx, ok, bytes, reason) {
  try {
    if (!env.SWEEP_KEY) return;
    const base = env.ECONOMY_URL || 'https://naluno-economy.naluno.workers.dev';
    const job = fetch(base + '/v1/launch/event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Naluno-Sweep': env.SWEEP_KEY },
      body: JSON.stringify({ ok: !!ok, bytes: bytes || 0, reason: reason || '', worker: env._nalunoBroadcast ? 'broadcast' : 'signal' }),
    }).catch(function () {});
    if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(job);
  } catch (_) {}
}
function refused(env, ctx, r, origin) {
  report(env, ctx, false, 0, r.reason);
  return json({ error: r.message, limit: r.reason }, r.status, origin);
}

export default {
  async fetch(request, env, ctx) {
    const broadcastWorker = !!(env && env.BROADCAST_BUCKET && !env.SIGNAL_BUCKET);
    if (broadcastWorker) {
      env = Object.assign({}, env, { SIGNAL_BUCKET: env.BROADCAST_BUCKET, _nalunoBroadcast: true });
    }
    const origin = request.headers.get('Origin');
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/health')) {
      return json({ ok: true, service: 'naluno-signal-upload', launchLimits: true, routes: ['POST /', 'POST /b/init', 'PUT /b/part', 'POST /b/complete', 'POST /b/abort', 'POST /b/purge', 'POST /b/drop', 'GET /o/**'] }, 200, origin);
    }

    if ((request.method === 'GET' || request.method === 'HEAD') && url.pathname.startsWith('/o/')) {
      if (!bucketOf(env)) {
        return json({ error: 'R2 binding missing' }, 500, origin);
      }
      try {
        return await serveObject(request, env, origin);
      } catch (e) {
        return json({ error: e.message || 'Read failed' }, 500, origin);
      }
    }

    const isChunkRoute = url.pathname === '/b/init' || url.pathname === '/b/part' || url.pathname === '/b/complete' || url.pathname === '/b/abort';
    if (request.method !== 'POST' && !(request.method === 'PUT' && url.pathname === '/b/part')) {
      return json({ error: 'Method not allowed' }, 405, origin);
    }
    if (!isChunkRoute && request.method !== 'POST') {
      return json({ error: 'Method not allowed' }, 405, origin);
    }

    /* THE RULE OF BANDS (07 Oct d): the Naluno economy worker deletes a
       Band's clip files once its conversation is deleted. Only with the
       shared SWEEP_KEY secret, and only files under u/<uid>/ (the sweep
       checks each file belongs to the person who sent it). */
    if (url.pathname === '/b/drop' && request.method === 'POST') {
      const given = request.headers.get('X-Naluno-Sweep') || '';
      const want = env.SWEEP_KEY || '';
      let same = !!want && given.length === want.length;
      if (same) {
        let diff = 0;
        for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ given.charCodeAt(i);
        same = diff === 0;
      }
      if (!same) return json({ error: 'Forbidden' }, 403, origin);
      if (!env.SIGNAL_BUCKET) return json({ error: 'R2 binding missing (SIGNAL_BUCKET)' }, 500, origin);
      let body = {};
      try { body = await request.json(); } catch (_) {}
      const keys = Array.isArray(body.keys) ? body.keys.slice(0, 100) : [];
      let deleted = 0;
      for (let i = 0; i < keys.length; i++) {
        const key = String(keys[i] || '');
        if (!/^u\/[A-Za-z0-9_-]{6,128}\/[A-Za-z0-9._-]{1,120}$/.test(key) || key.indexOf('..') >= 0) continue;
        try {
          await env.SIGNAL_BUCKET.delete(key);
          deleted++;
          try { await caches.default.delete(new Request(url.origin + '/o/' + key, { method: 'GET' })); } catch (_) {}
        } catch (_) {}
      }
      return json({ ok: true, deleted: deleted }, 200, origin);
    }

    const authHeader = request.headers.get('Authorization') || '';
    const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!idToken) return json({ error: 'Missing auth token' }, 401, origin);

    const uid = await verifyFirebaseIdToken(idToken, env);
    if (!uid) return json({ error: 'Invalid or expired sign-in' }, 401, origin);

    if (!env.SIGNAL_BUCKET) {
      return json({ error: 'R2 binding missing (SIGNAL_BUCKET)' }, 500, origin);
    }

    /* 13a: who may start an upload, and with what. Parts and the finish of an
       upload already started are let through, so nothing is left half-sent. */
    const startsUpload = (url.pathname === '/b/init') || (request.method === 'POST' && url.pathname === '/');
    const cfg = startsUpload || url.pathname === '/b/complete' ? await launchConfig(env) : null;
    if (startsUpload && cfg && !cfg.none && !(await isRegistered(env, uid, idToken))) {
      return refused(env, ctx, refuse('not-registered', 'Finish creating your Naluno account first.', 403), origin);
    }

    /* Delete only this person's own files. The prefix is the signed-in uid. */
    if (url.pathname === '/b/purge' && request.method === 'POST') {
      const prefixes = env._nalunoBroadcast ? ['b/' + uid + '/', 'u/' + uid + '/'] : ['u/' + uid + '/'];
      let deleted = 0;
      try {
        for (let p = 0; p < prefixes.length; p++) {
          const prefix = prefixes[p];
          let cursor = undefined;
          let pages = 0;
          while (pages < 20) {
            pages++;
            const listed = await env.SIGNAL_BUCKET.list({ prefix: prefix, cursor: cursor, limit: 500 });
            const objs = (listed && listed.objects) || [];
            for (let i = 0; i < objs.length; i++) {
              const key = String(objs[i].key || '');
              if (key.indexOf(prefix) !== 0) continue;
              await env.SIGNAL_BUCKET.delete(key);
              deleted++;
            }
            if (!listed || !listed.truncated) break;
            cursor = listed.cursor;
          }
        }
        return json({ ok: true, deleted: deleted }, 200, origin);
      } catch (e) {
        return json({ error: e.message || 'Could not remove files' }, 500, origin);
      }
    }

    /* Chunked Broadcast upload — same bucket, no 95MB whole-file POST */
    if (url.pathname === '/b/init' && request.method === 'POST') {
      let body = {};
      try { body = await request.json(); } catch (_) {}
      const ct = allowedType(body.contentType || 'application/octet-stream');
      if (!ct) return json({ error: 'That file type is not allowed' }, 415, origin);
      if (Number(body.bytes) > MAX_OBJECT_BYTES) {
        return json({ error: 'File too large (max 8 GB)' }, 413, origin);
      }
      const L0 = limitsFor(cfg, env);
      if (L0) {
        const open = await openUploads(env, uid, L0.incompleteHours);
        const most = Number(L0.account.concurrentUploads) || 0;
        if (most && open >= most) return refused(env, ctx, refuse('at-once', 'You already have ' + open + ' uploads going. Let one finish first.', 429), origin);
      }
      const pre = await checkBefore(env, cfg, uid, ct, Math.max(0, Number(body.bytes) || 0));
      if (!pre.ok) return refused(env, ctx, pre, origin);
      const ext = extFor(ct);
      const prefix = env._nalunoBroadcast ? 'b' : 'u';
      const key = prefix + '/' + uid + '/' + Date.now() + '-' + crypto.randomUUID().slice(0, 8) + '.' + ext;
      try {
        const mpu = await env.SIGNAL_BUCKET.createMultipartUpload(key, {
          httpMetadata: { contentType: ct },
          customMetadata: { uid, uploadedAt: String(Date.now()) },
        });
        try { await env.SIGNAL_BUCKET.put(markerKey(uid, mpu.uploadId), '', { customMetadata: { key: key, uploadId: mpu.uploadId } }); } catch (_) {}
        return json({ key, uploadId: mpu.uploadId }, 200, origin);
      } catch (e) {
        return json({ error: e.message || 'Could not start upload' }, 500, origin);
      }
    }
    if (url.pathname === '/b/part' && (request.method === 'PUT' || request.method === 'POST')) {
      const key = url.searchParams.get('key') || '';
      const uploadId = url.searchParams.get('uploadId') || '';
      const part = parseInt(url.searchParams.get('part') || '0', 10);
      if (!ownsKey(key, uid)) return json({ error: 'Forbidden' }, 403, origin);
      if (!uploadId || part < 1) return json({ error: 'Missing uploadId or part' }, 400, origin);
      const buf = await request.arrayBuffer();
      if (buf.byteLength < 1) return json({ error: 'Empty part' }, 400, origin);
      if (buf.byteLength > MAX_BYTES) return json({ error: `Part too large (max ${MAX_BYTES / (1024 * 1024)} MB)` }, 413, origin);
      try {
        const mpu = env.SIGNAL_BUCKET.resumeMultipartUpload(key, uploadId);
        const uploaded = await mpu.uploadPart(part, buf);
        return json({ etag: uploaded.etag, part }, 200, origin);
      } catch (e) {
        return json({ error: e.message || 'Part upload failed' }, 500, origin);
      }
    }
    if (url.pathname === '/b/complete' && request.method === 'POST') {
      let body = {};
      try { body = await request.json(); } catch (_) {}
      const key = body.key || '';
      const uploadId = body.uploadId || '';
      const parts = Array.isArray(body.parts) ? body.parts : [];
      if (!ownsKey(key, uid)) return json({ error: 'Forbidden' }, 403, origin);
      if (!uploadId || !parts.length) return json({ error: 'Missing parts' }, 400, origin);
      try {
        const mpu = env.SIGNAL_BUCKET.resumeMultipartUpload(key, uploadId);
        if (Number(body.bytes) > MAX_OBJECT_BYTES) {
          try { if (typeof mpu.abort === 'function') await mpu.abort(); } catch (_) {}
          return json({ error: 'File too large (max 8 GB)' }, 413, origin);
        }
        await mpu.complete(parts.map(p => ({ partNumber: p.part || p.partNumber, etag: p.etag })));
        const head = await env.SIGNAL_BUCKET.head(key);
        const size = head && head.size != null ? head.size : 0;
        await dropMarker(env, uid, uploadId);
        if (size > MAX_OBJECT_BYTES) {
          try { await env.SIGNAL_BUCKET.delete(key); } catch (_) {}
          return json({ error: 'File too large (max 8 GB)' }, 413, origin);
        }
        /* 13a: the real file, measured here: size, length, pixels. A file
           over a limit is deleted, so nothing half-published stays. */
        const ctStored = cleanType((head && head.httpMetadata && head.httpMetadata.contentType) || '');
        const verdict = await checkFile(env, cfg, ctStored, size, async function (off, n) {
          const o = await env.SIGNAL_BUCKET.get(key, { range: { offset: off, length: Math.max(1, Math.min(n, size - off)) } });
          return o ? new Uint8Array(await o.arrayBuffer()) : new Uint8Array(0);
        });
        if (!verdict.ok) {
          try { await env.SIGNAL_BUCKET.delete(key); } catch (_) {}
          return refused(env, ctx, verdict, origin);
        }
        report(env, ctx, true, size, '');
        return json({ url: `${url.origin}/o/${key}`, key, bytes: size || body.bytes || null }, 200, origin);
      } catch (e) {
        return json({ error: e.message || 'Complete failed' }, 500, origin);
      }
    }

    /* 13a: an upload given up by the phone (error, cancel, a limit): its
       parts and marker are removed now, not left in storage. */
    if (url.pathname === '/b/abort' && request.method === 'POST') {
      let body = {};
      try { body = await request.json(); } catch (_) {}
      const key = String(body.key || '');
      const uploadId = String(body.uploadId || '');
      if (!ownsKey(key, uid)) return json({ error: 'Forbidden' }, 403, origin);
      try { await env.SIGNAL_BUCKET.resumeMultipartUpload(key, uploadId).abort(); } catch (_) {}
      await dropMarker(env, uid, uploadId);
      return json({ ok: true }, 200, origin);
    }

    if (request.method === 'PUT') {
      return json({ error: 'Method not allowed' }, 405, origin);
    }

    const contentType = allowedType(request.headers.get('Content-Type') || 'application/octet-stream');
    if (!contentType) return json({ error: 'That file type is not allowed' }, 415, origin);
    const lenHeader = request.headers.get('Content-Length');
    if (lenHeader && parseInt(lenHeader, 10) > MAX_BYTES) {
      return json({ error: `File too large (max ${MAX_BYTES / (1024 * 1024)} MB)` }, 413, origin);
    }

    const buf = await request.arrayBuffer();
    if (buf.byteLength > MAX_BYTES) {
      return json({ error: `File too large (max ${MAX_BYTES / (1024 * 1024)} MB)` }, 413, origin);
    }
    if (buf.byteLength < 1) {
      return json({ error: 'Empty body' }, 400, origin);
    }
    if (looksActive(buf)) {
      return json({ error: 'That file is not allowed' }, 415, origin);
    }
    /* 13a: the whole file is here, so every check uses its real bytes. */
    {
      const pre = await checkBefore(env, cfg, uid, cleanType(contentType), buf.byteLength);
      if (!pre.ok) return refused(env, ctx, pre, origin);
      const bytes = new Uint8Array(buf);
      const verdict = await checkFile(env, cfg, cleanType(contentType), buf.byteLength, async function (off, n) { return bytes.subarray(off, Math.min(bytes.length, off + n)); });
      if (!verdict.ok) return refused(env, ctx, verdict, origin);
    }

    const ext = extFor(contentType);

    const key = `u/${uid}/${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${ext}`;

    try {
      await env.SIGNAL_BUCKET.put(key, buf, {
        httpMetadata: { contentType: contentType.split(';')[0].trim() || contentType },
        customMetadata: { uid, uploadedAt: String(Date.now()) },
      });
    } catch (e) {
      return json({ error: e.message || 'R2 put failed' }, 500, origin);
    }

    report(env, ctx, true, buf.byteLength, '');
    // Always Worker proxy URL — never depend on R2 public bucket
    const publicUrl = `${url.origin}/o/${key}`;
    return json({ url: publicUrl, key, bytes: buf.byteLength }, 200, origin);
  },
};
