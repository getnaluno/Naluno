# GitHub — 2026.09.21d

Reserved handles. Identity bind. Economy worker 2.4.0-handles.

## Upload to GitHub

1. firestore.rules
2. workers/economy/handler.mjs
3. js/handle-guard.js
4. js/auth.js
5. js/admin-data.js
6. js/admin-console.js
7. admin/index.html
8. app/index.html
9. sw.js

Tests can go up too. They are not required for the live product.

## Then

1. Publish firestore.rules in Firebase.
2. Deploy the economy worker 2.4.0-handles.
3. Open Admin → Identity once. That seeds the list and binds the existing @naluno account.

If 21c is already live (rules published, worker 2.4.0-handles deployed):
only replace js/admin-console.js and admin/index.html.
Do not remove reserved names to use them. Bind an account on Identity instead.
