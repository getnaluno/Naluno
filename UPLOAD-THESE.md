# GitHub / Cloudflare / Firebase — 2026.09.11e

Contact form, genuine Compass delete request, Control Centre Mail.
Only these files. Do not upload a full tree.

The inbox address is **not** in any of these files. Put it on the worker as a secret.

## Must publish

1. **index.html** — contact form on the website
2. **privacy.html** + **privacy/index.html**, **terms.html** + **terms/index.html**
3. **firestore.rules** — `deskMail` collection  
   `firebase deploy --only firestore:rules`
4. **js/compass.js**, **app/index.html** — Ask to delete my account / Write to Naluno
5. **admin/index.html**, **js/admin-console.js**, **js/admin-data.js** — Mail tab
6. **workers/economy/** — `POST /v1/mail` (deploy with Wrangler, **not** GitHub Pages)
7. **sw.js**, **js/pwa.js** — cache `naluno-shell-v161`, `?v=20260911e`

## Worker (Gmail delivery)

From `workers/economy`:

    npx wrangler deploy
    npx wrangler secret put INBOX_TO

Paste the mailbox you already use for Naluno. Do not put that address on the website, in Compass, or in this note.

First FormSubmit mail: open that inbox and click the confirmation link FormSubmit sends. After that, every contact lands there.

Control Centre **Mail** still receives every message even if Gmail is not confirmed yet — `deskMail` is the record.

## After GitHub upload

Close Naluno tabs once so the new service worker takes.

Keep **js/band-room.js** from 09.11c and the 09.11d landing/OG files if those are not live yet.
