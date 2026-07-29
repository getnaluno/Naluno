/*
 * Naluno Signal Upload Worker
 *
 * Accepts a video from a real, signed-in Naluno user and writes it to R2. This exists
 * because Firestore caps a single document at 1MB — nowhere near enough for a video —
 * and because Firebase Storage now requires the paid Blaze plan for any usage at all,
 * even the smallest file. R2 has a genuinely free tier (10GB, no card, no egress fees)
 * and this is the small piece of server-side glue needed to use it safely, since raw
 * upload credentials can never sit in the browser.
 *
 * Identity is verified by asking Google's own Identity Toolkit REST endpoint to check
 * the person's real Firebase ID token — this delegates the actual JWT signature
 * verification to Google's servers rather than hand-rolling it here, which is simpler
 * and just as trustworthy, at the cost of one extra network hop per upload.
 *
 * The bucket itself should have a real Object Lifecycle Rule configured (in the
 * Cloudflare dashboard, not in this code) to delete objects after 25 hours — matching
 * how long a Naluno signal already lives — so cleanup happens reliably on Cloudflare's
 * own servers, whether or not anyone's device is even online when it expires.
 */

// The Firebase Web API key — the same public value already sitting in
// firebase-config.js. This is not a secret; it identifies the project, it doesn't
// grant access to anything by itself.
const FIREBASE_WEB_API_KEY = 'YOUR_FIREBASE_WEB_API_KEY';

// Generous headroom above what a real 60-second video (the app's own composer limit)
// should need, while still bounding worst-case abuse.
const MAX_UPLOAD_BYTES = 60 * 1024 * 1024;

async function verifyFirebaseIdToken(idToken) {
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${FIREBASE_WEB_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken }),
    }
  );
  if (!res.ok) return null;
  const data = await res.json();
  const user = data.users && data.users[0];
  return user ? user.localId : null; // the real Firebase uid, confirmed by Google itself
}

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  };
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin');

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders(origin) });
    }
    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405, headers: corsHeaders(origin) });
    }

    const authHeader = request.headers.get('Authorization') || '';
    const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!idToken) {
      return json({ error: 'Missing auth token' }, 401, origin);
    }

    const uid = await verifyFirebaseIdToken(idToken);
    if (!uid) {
      return json({ error: 'Invalid or expired sign-in — reopen Naluno and try again' }, 401, origin);
    }

    const contentLength = parseInt(request.headers.get('Content-Length') || '0', 10);
    if (contentLength > MAX_UPLOAD_BYTES) {
      return json({ error: 'Video too large' }, 413, origin);
    }

    const contentType = request.headers.get('Content-Type') || 'video/webm';
    const ext = contentType.includes('mp4') ? 'mp4' : 'webm';
    const key = `signal/${uid}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

    try {
      await env.SIGNAL_BUCKET.put(key, request.body, {
        httpMetadata: { contentType },
      });
    } catch (e) {
      return json({ error: 'Upload failed' }, 500, origin);
    }

    // PUBLIC_BUCKET_URL is the bucket's public r2.dev URL (or a custom domain, once
    // set up) — kept as an environment variable so it can change without touching code.
    const url = `${env.PUBLIC_BUCKET_URL}/${key}`;
    return json({ url }, 200, origin);
  },
};

function json(body, status, origin) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' },
  });
}
