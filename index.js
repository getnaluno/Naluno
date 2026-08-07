/*
 * Naluno TURN Credentials Worker
 *
 * This is the actual fix for calls that connect but never show a video/audio feed
 * between two devices on different networks — confirmed by real browser console
 * evidence: tracks are added and received correctly on both sides, but ICE never
 * finds a working route (checking -> disconnected -> failed). Naluno was only using
 * STUN, which can't traverse every real-world network combination. This adds a real
 * TURN relay as a fallback, using Cloudflare's own Realtime TURN service — the same
 * platform already used for the other two Workers tonight.
 *
 * Unlike the notification Worker, this one doesn't need to sign anything itself —
 * Cloudflare's own API handles generating the actual short-lived credentials. This
 * Worker's whole job is: confirm the caller is a real signed-in Naluno user, then
 * safely proxy a request to Cloudflare using a long-term secret that must never reach
 * the browser.
 *
 * Required secrets/vars (see README in this folder for the exact setup steps):
 *   TURN_KEY_API_TOKEN  (secret) — the "key" value from creating a Cloudflare Calls
 *     TURN key. This is a genuine bearer secret — set only via `wrangler secret put`,
 *     never written to any file.
 *   TURN_KEY_ID  (var) — the "uid" value from that same TURN key.
 *   FIREBASE_WEB_API_KEY  (var) — same public key already used in the other Workers.
 */

async function verifyFirebaseIdToken(idToken, env) {
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${env.FIREBASE_WEB_API_KEY}`,
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

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  };
}
function json(body, status, origin) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' },
  });
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin');
    if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders(origin) });
    if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405, origin);

    const authHeader = request.headers.get('Authorization') || '';
    const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!idToken) return json({ error: 'Missing auth token' }, 401, origin);

    const uid = await verifyFirebaseIdToken(idToken, env);
    if (!uid) return json({ error: 'Invalid or expired sign-in' }, 401, origin);

    try {
      const cfRes = await fetch(
        `https://rtc.live.cloudflare.com/v1/turn/keys/${env.TURN_KEY_ID}/credentials/generate-ice-servers`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${env.TURN_KEY_API_TOKEN}`,
            'Content-Type': 'application/json',
          },
          // A real call is short — a few minutes at most — so these only need to stay
          // valid for a couple of hours, not the full day Cloudflare's own example
          // uses. Shorter-lived credentials are a real, small security improvement:
          // less time a leaked credential could ever be reused.
          body: JSON.stringify({ ttl: 7200 }),
        }
      );
      if (!cfRes.ok) {
        return json({ error: 'Could not get TURN credentials', detail: await cfRes.text() }, 502, origin);
      }
      const data = await cfRes.json();
      return json({ iceServers: data.iceServers }, 200, origin);
    } catch (e) {
      return json({ error: 'TURN credential request failed', detail: String(e) }, 500, origin);
    }
  },
};
