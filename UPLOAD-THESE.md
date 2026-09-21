# GitHub — 2026.09.21j

Broadcast was not going out. Screen-allow was only listed by the economy worker, and the live worker has no service account, so every new Callsign stayed Waiting. Listing is now decided when the Broadcast is saved. A bikini/clear file goes onto the public feed. Unsure still waits. Sexual is still stopped.

## Upload to GitHub

1. firestore.rules
2. workers/economy/handler.mjs
3. workers/economy/economy.test.mjs
4. js/broadcast-core.js
5. js/broadcast-composer.js
6. js/origin.js
7. js/auth.js
8. js/pwa.js
9. js/firestore-rules.test.cjs
10. js/broadcast-core.test.cjs
11. app/index.html
12. sw.js

## Then

1. Publish firestore.rules (required — new publishers may create listed when Screen is clear).
2. Deploy economy worker **2.6.2-place** (`handler.mjs` + `screen.mjs`).
3. Upload the app files.

Do not skip the rules publish. An older rules file that only allows trusted publishers to create listed will deny Screen-allow posts.

A Google service account on the worker is still needed for sexual-report auto-hide and for the worker to hide after a late Screen block. Let out / Take down on the desk already writes directly and does not need it.
