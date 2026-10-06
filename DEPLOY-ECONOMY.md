# Naluno economy worker 2.11.0-lg: deploy

Live now: `2.9.0-lock` (from before 05 Oct). This build adds:
- Wireline alerts that arrive (05g);
- one moderation rule, the same on phone and server (05h);
- the optional Luganda voice route (05h).

All 19 worker test files pass. Your secrets and settings in Cloudflare
(GOOGLE_SERVICE_ACCOUNT, INBOX_TO, payment keys, variables) are not touched
by either way below.

## Way 1: Cloudflare dashboard (no computer tools)
1. dash.cloudflare.com → Workers & Pages → **naluno-economy** → **Edit code**.
2. Open the main file (index.mjs / worker.js). Select all, delete, and paste
   the whole of `naluno-economy-worker.js` from this zip. It is one
   self-contained file, so the worker needs nothing else.
3. Click **Deploy**.

## Way 2: wrangler (a computer with Node.js)
```
cd workers/economy
npx wrangler deploy
```

## Check it is live
Open https://naluno-economy.naluno.workers.dev/health. It must say
`"version":"2.11.0-lg"` and `"hasServiceAccount":true`.
