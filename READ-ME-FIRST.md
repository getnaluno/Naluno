# Two separate problems — one bug, one "not deployed yet"

## 1. The app not opening — a real bug, fixed

```
ReferenceError: contactAvatarStyleAttr is not defined
  at band-list.js:41 → renderBandList → loadBands
```

`contactAvatarStyleAttr()` is defined in **find.js**, which loaded at
position **39**. But `auth.js` (position 33) calls `loadBands()` at **top
level** — so it ran while find.js had not yet executed, and the function
genuinely did not exist. That ReferenceError aborted the boot, which is why
the page never came up.

Four other files use the same helper (`band-room.js`, `wireline.js`,
`signal-ui.js`, plus `band-list.js`), so this was one crash waiting on
timing rather than a one-off.

**Fixed** by moving `find.js` to load immediately after `core.js`, before
every consumer. Verified in a real DOM: `find.js` only needs `$` (core.js,
now earlier) and four elements that exist in the page.

I then swept **every** top-level call in every script for the same bug class.
Three flagged, all confirmed harmless on inspection: one is a comment, one is
inside an onclick (runs on tap), one is a definition rather than a call.

## 2. The Admin Console rejecting your UID and passphrase — expected

Nothing is wrong. **The economy build has not been deployed yet.** Your
console log is build `2026.08.21d` with scripts at `?v=20260828y`, and
`economy.js` / `economy-ui.js` do not appear in it at all.

The passphrase is not something I set or that lives in any file — **you
create it on the Worker**:

```bash
cd workers/economy
npx wrangler secret put ADMIN_UIDS         # your Firebase Auth UID
npx wrangler secret put ADMIN_PASSPHRASE   # you choose this
npx wrangler secret put GOOGLE_CLIENT_EMAIL
npx wrangler secret put GOOGLE_PRIVATE_KEY
npx wrangler deploy
```

One thing to check: `ADMIN_UIDS` needs your **Firebase Authentication UID**,
not a Firestore document id. They are often the same for user documents, but
not always. Confirm with `firebase.auth().currentUser.uid` in the console
while signed in.

Until both secrets are set the console returns **503 and stays shut** — it
fails closed on purpose, so a missing passphrase can never mean "no
passphrase required".

## 3. The 404 images — the known R2 lifecycle issue, not new

Every 404 is `.../o/u/...` on **naluno-signal-upload**. That bucket deletes
objects after 25 hours, so those Broadcast thumbnails have aged out. This is
the same lifecycle rule documented earlier; it needs a Cloudflare dashboard
change, not code.

## Deploy

1. `firebase deploy --only firestore:rules`
2. `cd workers/economy && npx wrangler deploy` (after setting secrets)
3. Push the client files — **`index.html` is the one that fixes the crash**,
   and `sw.js` (cache v127) so browsers actually pick it up.

If you only want the crash fix right now, `index.html` + `sw.js` alone are
enough — the economy files are inert until the Worker is deployed.
