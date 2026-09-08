# My mistake — and it is fixed

## What went wrong

When I rewrote the admin auth, I started from the **original** worker file
instead of the one that already had the CORS fix. That silently reverted it.

`X-Naluno-Admin` was missing from `Access-Control-Allow-Headers` again, so the
browser's preflight failed, `fetch()` threw before the request was sent, and
you got **"Couldn't reach the service."** — the exact bug I had already fixed
once. That is on me, and it is why you saw the old screen with no way forward.

Restored, with a note on the line explaining why it must stay.

## Why you saw "Unlock" instead of "Set your password"

`/v1/admin/status` sends only an `Authorization` header, so it slipped past
the broken CORS. But if the worker deployed at that moment predates this
rewrite, it has no `/status` route and returns 404 — and my client reported
that as **"Not available for this account."**, which points at the allowlist
when the real problem is a stale deploy.

Two different problems, one misleading message. Fixed: `/health` now reports
`adminAuth: "password"`, and the console checks it. If the worker is older
than the page it now says so plainly:

> "The server is running an older version. Deploy the economy worker, then
> reload."

## Deploy in this order

**1. The worker — this one is essential.** Nothing else works until it is up:

```bash
cd workers/economy
npx wrangler deploy
```

**2. Confirm it took.** Open:
`https://naluno-economy.naluno.workers.dev/health`

You should see:
```json
"version": "2.0.0-admin-password",
"adminAuth": "password"
```
If it still says `1.0.0-phase1`, the deploy did not land — nothing else will
work until it does.

**3. Rules:** `firebase deploy --only firestore:rules`

**4. Push** `js/admin-console.js` and `admin/index.html`.

**5. Open `/admin/` and hard-reload** (Ctrl+Shift+R, or long-press reload on
mobile). The old JS may be cached.

You should then see **"Set your password"** with two fields.

## Verified

8 assertions on the preflight for every request the console makes — status,
password set/change, overview, flags, simulate, audit — plus confirmation
that the old header list blocked unlock (reproducing your screenshot) while
still allowing `/status`, which is exactly the split you saw.

The 19 auth assertions from the rewrite still pass: first-visit setup,
hashed storage, wrong/empty passwords, case sensitivity, changing with and
without the current password, allowlist enforcement, and recovery.

## Files

`workers/economy/index.js`, `js/admin-console.js`, `admin/index.html`,
`firestore.rules`.
