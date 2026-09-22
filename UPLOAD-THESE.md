# GitHub — 2026.09.22c

Control Centre password now lives on the Naluno account, not only on this phone.

The last save never stuck: the worker kept it in memory, then forgot it. That is why the desk said “first time” after Google sign-in.

## Upload to GitHub

1. admin/index.html
2. js/admin-console.js
3. js/currency.js (from 22b — keep it)
4. js/auth-isolation.test.cjs
5. workers/economy/handler.mjs
6. workers/economy/economy.test.mjs

## Deploy the worker

Same `workers/economy/handler.mjs` to the economy worker. Version **2.6.5-console-pass**.

## Then

Hard-refresh Control Centre. Set the password **once more**. After that it follows the account: any signed-in device can unlock with it. This phone also keeps a copy so it still works if the worker is down.

Do not create the password until this pack is live, or it will not land on the account.
