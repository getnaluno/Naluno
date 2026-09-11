# Naluno — upload these

One zip. Every file that still needs publishing. Paths inside match GitHub.

The inbox address is **not** in any of these files.

## 1. Worker (do this first)

From `workers/economy`:

    npx wrangler deploy

`INBOX_TO` is already on the worker. Do not put it in a file.

## 2. Firestore

    firebase deploy --only firestore:rules

## 3. GitHub Pages

Upload the rest as they sit in this zip (`index.html` at the site root, `app/`, `admin/`, `js/`, `sw.js`, `privacy/`, `terms/`).

## After

Close every Naluno tab once, then send again. The earlier “Hei” never left the phone.

First FormSubmit mail: open the inbox and click the confirmation link they send. After that, every contact lands there. Control Centre **Mail** still receives it if that click is still waiting.
