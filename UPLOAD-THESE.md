# GitHub — 2026.09.19e

Leftover security that does **not** change Broadcast playback URLs or existing videos.

## Must publish (Firebase)

1. **firestore.rules**
2. **storage.rules** (Firebase Storage is unused; this locks it)

Until (1) is published, listing every member still works.

## Must upload (GitHub)

3. firestore.rules, storage.rules
4. js/vault.js, js/auth.js, js/compass.js, js/crypto.js
5. js/pwa.js, js/notifications.js
6. js/admin-console.js, js/firestore-rules.test.cjs
7. app/index.html, sw.js, admin/index.html
8. SECURITY-REPORT.md, UPLOAD-THESE.md

## Also publish (Cloudflare)

9. workers/economy/handler.mjs (2.2.5-ratelimit)
10. **workers/call-notify/** (1.0.0-secure) → existing `naluno-call-notify` worker

   Copy the same `GOOGLE_SERVICE_ACCOUNT` secret the economy worker already has.

## What this does not change

- Broadcast / Signal media URLs (`/o/…`) stay public. Existing videos keep playing.
- Call wake tokens stay on the public profile (and are now also in the vault) so a delay in publishing call-notify cannot silence phones.
