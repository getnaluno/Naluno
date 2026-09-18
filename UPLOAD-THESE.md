# GitHub / Firebase — 2026.09.18a

People can close their own Callsign, with a reason that lands on the Control Centre. The desk can restore a closed Callsign, and can close one for a violation, also with a reason. The public site has night stills and a frequency map. The “Missing or insufficient permissions” toast is mapped to a plain line; ad listeners wait until someone is signed in.

Only these files. Do not upload a full tree.

The operator inbox address is not in any of these files.

**Publish firestore.rules** or close / restore / ads counters will be blocked.

## Must publish

1. **firestore.rules** — closed Callsigns, accountEvents, handle tombstones, ad counter writes, operator mail.
2. **app/index.html**, **css/app.css**, **js/auth.js**, **js/core.js**, **js/compass.js**, **js/find.js**, **js/ads.js**, **js/currency.js**, **js/onboard.js**, **js/pwa.js**, **sw.js** — Callsign close, closed gate, friendly errors, ads after sign-in.
3. **admin/index.html**, **js/admin-console.js**, **js/admin-data.js** — Close for violation, Restore Callsign, Closed count.
4. **index.html**, **img/site-night.jpg**, **img/site-together.jpg** — public site.
5. **privacy.html**, **privacy/index.html**, **terms.html**, **terms/index.html** — close / restore copy.

Cache `naluno-shell-v173`, `?v=20260918a`.

## After upload

Close Naluno tabs once so the new service worker takes. Refresh Control Centre once. Publish the new Firestore rules from this zip (Firebase console → Firestore → Rules, or `firebase deploy --only firestore:rules`).
