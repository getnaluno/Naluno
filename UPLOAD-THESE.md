# GitHub — 2026.09.19d

Leftover security that does **not** change Broadcast playback URLs or existing videos.

## Must publish (Firebase)

1. **firestore.rules** — `firebase deploy --only firestore:rules`

Until this is published, listing every member and reading Spark codes as a list still works.

## Must upload (GitHub)

2. firestore.rules
3. js/vault.js (new)
4. js/auth.js
5. js/compass.js
6. js/crypto.js
7. js/admin-console.js
8. js/firestore-rules.test.cjs
9. app/index.html
10. sw.js
11. admin/index.html
12. SECURITY-REPORT.md
13. UPLOAD-THESE.md

## Also publish (Cloudflare)

14. workers/economy/handler.mjs (2.2.4-vault)

Stamps `operator: true` on the desk account when `/v1/admin/status` is called. The uid check stays, so the desk still opens if the stamp fails.

## What this does not change

- Broadcast / Signal media URLs (`/o/…`) stay public. Existing videos keep playing.
- Call wake tokens stay on the public profile so the current call-notify worker still rings a closed phone.
