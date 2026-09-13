# GitHub / Firebase — 2026.09.13a

Booked ad revenue on the Control Centre, completed-view tracking in the app.
Only these files. Do not upload a full tree.

The operator inbox address is not in any of these files.

## Must publish

1. **firestore.rules** — signed-in members may increment `viewCompletes` on live `deskAds` rows, along with impressions, clicks and skips. Older rows without `viewCompletes` still accept the other counters.
2. **js/admin-data.js**, **js/admin-console.js**, **admin/index.html** — Ads and Money show booked revenue from the rate card × observed events. eCPM, CPC and CPV (with acronyms defined) live on `economyConfig/adRates`. Each unit books one model. Cash has not moved. There is no third-party auction.
3. **js/ads.js**, **js/broadcast-space.js** — a completed view is counted after the rate-card seconds of actual play (default 15). Skip before that does not count a view. Skip is not a click.
4. **app/index.html**, **js/pwa.js**, **sw.js** — cache `naluno-shell-v165`, `?v=20260913a`.

## After upload

Close Naluno tabs once so the new service worker takes.

Publish the Firestore rules before expecting completed-view counts. Then type eCPM / CPC / CPV on Control Centre → Ads. The math runs at AED 0.00 until rates are set.

ARPDAU on this desk is lifetime booked ÷ today’s daily active users until a day rollup exists. That is not a day’s take.
