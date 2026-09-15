# GitHub / Firebase — 2026.09.15a

Wireline history lives on the phone. The server is a mailbox.
Only these files. Do not upload a full tree.

The operator inbox address is not in any of these files.

## Must publish

1. **firestore.rules** — new `wireDrop/{uid}/inbox` and `…/receipts`. Recipient copies a drop onto the phone, then deletes it. Publish this first.
2. **js/chat-store.js**, **js/wire-mailbox.js**, **js/wireline.js**, **js/crypto.js** — IndexedDB chat database (the PWA stand-in for SQLite). New messages are encrypted drops, not a permanent Firestore transcript. **Save copy** / **Open copy** on Wireline puts backup on this phone (Drive / Files), not on Naluno.
3. **app/index.html**, **js/pwa.js**, **sw.js** — cache `naluno-shell-v169`, `?v=20260915a`.
4. **privacy.html**, **privacy/index.html**, **terms.html**, **terms/index.html** — say the same thing the app now does.
5. **js/admin-data.js**, **admin/index.html** — glossary (IndexedDB / SQLite) and the honest mailbox note.

## After upload

Close Naluno tabs once so the new service worker takes.

Older Wireline rows already in `threads/…/messages` are copied onto this phone the first time that chat is opened. New sends do not add to that archive.

A photo that is too large for the drop is still parked on Cloudflare R2 so the other phone can fetch it. That file is a holding tray, not the chat history.

A new phone starts empty unless a copy is imported.
