# GitHub — 2026.09.22e

Unlock was saying no to the right password.

Three copies exist: this phone, the Naluno account, and the worker. The worker kept an older hash in memory and answered first. Unlock treated that no as final, so the phone copy and the account copy never got a turn.

This pack lets any matching copy open the desk. The worker copy is refreshed to the one that worked.

## Upload to GitHub

1. admin/index.html
2. js/admin-console.js
3. js/console-pass.test.cjs
4. workers/economy/handler.mjs
5. workers/economy/economy.test.mjs

Keep the Ads files from 22d (admin-data.js and the Ads tests). Do not replace them.

## Deploy the worker

Same `workers/economy/handler.mjs` to the economy worker. Version **2.6.6-console-pass**.

## Then

Hard-refresh Control Centre. Type the password you last set on this phone. Unlock now counts this phone and the account even if the worker still says no.

Do not skip the second gate. If this phone has never saved a password and the account copy is empty, you will see Set a password — that is first time, not a rejection.
