/**
 * naluno-signal-upload
 * POST /          — auth required, body = media bytes, max 95 MiB
 * GET|HEAD /o/**  — public stream with proper Range support (required for mobile video)
 */
const MAX_BYTES = 95 * 1024 * 1024; // aligned with client UPLOAD_MAX_BYTES

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
        return new Response(hit.body, { status: hit.status, statusText: hit.statusText, headers });
      }
    } catch (_) {}
  }

  // Always try full metadata first when range is present so we can compute length
  let obj;
  if (rangeHeader) {
    const head = await env.SIGNAL_BUCKET.head(key);
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
    obj = await env.SIGNAL_BUCKET.get(key, { range: r2range });
    if (!obj) {
      return new Response('Not found', { status: 404, headers: corsHeaders(origin) });
    }
    const offset = obj.range ? obj.range.offset : (r2range.offset || 0);
    const length = obj.range ? obj.range.length : (r2range.length || (total - offset));
    const headers = corsHeaders(origin, {
      'Content-Type': (obj.httpMetadata && obj.httpMetadata.contentType) || head.httpMetadata?.contentType || 'application/octet-stream',
      'Accept-Ranges': 'bytes',
      'Content-Length': String(length),
      'Content-Range': `bytes ${offset}-${offset + length - 1}/${total}`,
      'Cache-Control': 'public, max-age=3600',
    });
    if (request.method === 'HEAD') {
      return new Response(null, { status: 206, headers });
    }
    return new Response(obj.body, { status: 206, headers });
  }

  obj = await env.SIGNAL_BUCKET.get(key);
  if (!obj) {
    return new Response('Not found', { status: 404, headers: corsHeaders(origin) });
  }
  const headers = corsHeaders(origin, {
    'Content-Type': (obj.httpMetadata && obj.httpMetadata.contentType) || 'application/octet-stream',
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'public, max-age=31536000, immutable',
  });
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

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin');
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/health')) {
      return json({ ok: true, service: 'naluno-signal-upload', routes: ['POST /', 'POST /b/init', 'PUT /b/part', 'POST /b/complete', 'GET /o/**'] }, 200, origin);
    }

    if ((request.method === 'GET' || request.method === 'HEAD') && url.pathname.startsWith('/o/')) {
      if (!env.SIGNAL_BUCKET) {
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

    const authHeader = request.headers.get('Authorization') || '';
    const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!idToken) return json({ error: 'Missing auth token' }, 401, origin);

    const uid = await verifyFirebaseIdToken(idToken, env);
    if (!uid) return json({ error: 'Invalid or expired sign-in' }, 401, origin);

    if (!env.SIGNAL_BUCKET) {
      return json({ error: 'R2 binding missing (SIGNAL_BUCKET)' }, 500, origin);
    }

    /* Chunked Broadcast upload — same bucket, no 95MB whole-file POST */
    if (url.pathname === '/b/init' && request.method === 'POST') {
      let body = {};
      try { body = await request.json(); } catch (_) {}
      const ct = ((body.contentType || 'application/octet-stream').split(';')[0] || '').trim();
      const ext =
        ct.includes('mp4') ? 'mp4' :
        ct.includes('webm') ? 'webm' :
        ct.includes('quicktime') ? 'mov' :
        ct.includes('jpeg') || ct.includes('jpg') ? 'jpg' :
        ct.includes('png') ? 'png' : 'bin';
      const key = `u/${uid}/${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${ext}`;
      try {
        const mpu = await env.SIGNAL_BUCKET.createMultipartUpload(key, {
          httpMetadata: { contentType: ct },
          customMetadata: { uid, uploadedAt: String(Date.now()) },
        });
        return json({ key, uploadId: mpu.uploadId }, 200, origin);
      } catch (e) {
        return json({ error: e.message || 'Could not start upload' }, 500, origin);
      }
    }
    if (url.pathname === '/b/part' && (request.method === 'PUT' || request.method === 'POST')) {
      const key = url.searchParams.get('key') || '';
      const uploadId = url.searchParams.get('uploadId') || '';
      const part = parseInt(url.searchParams.get('part') || '0', 10);
      if (!key.startsWith('u/' + uid + '/')) return json({ error: 'Forbidden' }, 403, origin);
      if (!uploadId || part < 1) return json({ error: 'Missing uploadId or part' }, 400, origin);
      const buf = await request.arrayBuffer();
      if (buf.byteLength < 1) return json({ error: 'Empty part' }, 400, origin);
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
      if (!key.startsWith('u/' + uid + '/')) return json({ error: 'Forbidden' }, 403, origin);
      if (!uploadId || !parts.length) return json({ error: 'Missing parts' }, 400, origin);
      try {
        const mpu = env.SIGNAL_BUCKET.resumeMultipartUpload(key, uploadId);
        await mpu.complete(parts.map(p => ({ partNumber: p.part || p.partNumber, etag: p.etag })));
        return json({ url: `${url.origin}/o/${key}`, key, bytes: body.bytes || null }, 200, origin);
      } catch (e) {
        return json({ error: e.message || 'Complete failed' }, 500, origin);
      }
    }

    if (request.method === 'PUT') {
      return json({ error: 'Method not allowed' }, 405, origin);
    }

    const contentType = request.headers.get('Content-Type') || 'application/octet-stream';
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

    const ext =
      contentType.includes('mp4') ? 'mp4' :
      contentType.includes('webm') ? 'webm' :
      contentType.includes('quicktime') ? 'mov' :
      contentType.includes('jpeg') || contentType.includes('jpg') ? 'jpg' :
      contentType.includes('png') ? 'png' :
      contentType.includes('audio') ? 'webm' : 'bin';

    const key = `u/${uid}/${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${ext}`;

    try {
      await env.SIGNAL_BUCKET.put(key, buf, {
        httpMetadata: { contentType: contentType.split(';')[0].trim() || contentType },
        customMetadata: { uid, uploadedAt: String(Date.now()) },
      });
    } catch (e) {
      return json({ error: e.message || 'R2 put failed' }, 500, origin);
    }

    // Always Worker proxy URL — never depend on R2 public bucket
    const publicUrl = `${url.origin}/o/${key}`;
    return json({ url: publicUrl, key, bytes: buf.byteLength }, 200, origin);
  },
};
