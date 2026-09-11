# GitHub / Cloudflare / Firebase — 2026.09.11f

Contact send on the website was failing. The worker refused anonymous mail
before it ever wrote or emailed, and the service worker was standing in
front of that request — which is why Chrome painted “No internet
connection” on a live 5G tab.

Only these files. Do not upload a full tree.

The inbox address is **not** in any of these files.

## Must publish

1. **workers/economy/** — `npx wrangler deploy` from this folder.
   `INBOX_TO` is already on the worker. Do not put it in a file.
2. **firestore.rules** — `firebase deploy --only firestore:rules`
   (Control Centre Mail can then keep public contact even without a
   Google service account)
3. **index.html** — contact form
4. **sw.js**, **js/pwa.js**, **app/index.html** — cache `naluno-shell-v162`,
   `?v=20260911f`. Mail is no longer intercepted.

## After upload

Close every Naluno tab once so the new service worker takes, then send
again. The “Hei” from this phone never left the device.

First FormSubmit mail: open the inbox and click the confirmation link
FormSubmit sends. After that, every contact lands there.

Control Centre **Mail** still receives the message even if that
confirmation is still waiting.
