# GitHub + worker — 2026.09.19h

Admin password now actually gates. Your operator account is not locked out.

## Upload to GitHub

1. js/admin-console.js
2. admin/index.html
3. firestore.rules
4. js/firestore-rules.test.cjs
5. workers/economy/handler.mjs
6. workers/economy/economy.test.mjs

## Then

1. Publish firestore.rules in Firebase.
2. Deploy the economy worker (`naluno-economy`) with this handler.mjs.

## First open after this

Sign in with the same Google account. Unlock with the password you already use.
If the console asks you to create a password, set the same one.

You will not be locked out: your uid still opens the desk, a verified
magjoed@gmail.com still opens it, and if no password is stored yet the
first visit is setup — not a wall.
