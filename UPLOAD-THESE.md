# GitHub — 2026.09.21c

Reserved Handle / Protected Identity. Lives in Firestore + the economy worker, not only in the app.

## Upload to GitHub

1. js/handle-guard.js
2. js/handle-guard.test.cjs
3. js/auth.js
4. js/admin-data.js
5. js/admin-console.js
6. js/admin-data.test.cjs
7. js/firestore-rules.test.cjs
8. firestore.rules
9. admin/index.html
10. app/index.html
11. sw.js
12. workers/economy/handler.mjs
13. workers/economy/economy.test.mjs

## Then

1. Publish firestore.rules in Firebase. Until that is live, a reserved name can still be written if someone bypasses the worker.
2. Deploy the economy worker (`2.4.0-handles`). Sign-up talks to `/v1/handle/check` and `/v1/handle/claim`.
3. Open Admin → Identity once. It seeds the reserved list and binds the existing @naluno account as the official holder.

The Identity desk is the live list. Adding a name there is enough — you do not need another code change.
