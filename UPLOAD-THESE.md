# GitHub — 2026.09.12d

Ads feeder in the Control Centre, live in the app. Swipe-away now pauses
the clip that was just left. Only these files. Do not upload a full tree.

The inbox address is **not** in any of these files.

## Must publish

1. **firestore.rules** — `deskAds` collection. Without this, upload from Ads will fail.
2. **admin/index.html**
3. **js/admin-data.js**
4. **js/admin-console.js**
5. **js/ads.js** (new)
6. **js/media-contain.js**
7. **js/signal-ui.js**
8. **js/broadcast-space.js**
9. **js/broadcast-core.js**
10. **js/strand.js**
11. **js/pwa.js**
12. **app/index.html**
13. **sw.js**

Cache bust `?v=20260912d`. Shell `naluno-shell-v162`. Close the app tab and the Control Centre tab once so they load.

`js/broadcast-upload.js` is already on the site. The Ads tab uses it to store creatives on Cloudflare R2 (object storage). Do not replace it.

## What changed

### Ads
- New **Ads** tab: upload a 9:16 video or image, set headline, advertiser, call to action (CTA) https address, placement, skip-after seconds, then **Upload and go live** or save paused.
- Live units appear in For You as native plates labelled **Ad** (every four cards) and as skippable chapter breaks inside a Broadcast.
- First-party inventory. No third-party network, no auction, no tracker.
- Live / Pause without deleting. Impressions, clicks and skips are counted on the desk.
- Members only read `status == live`. Counter writes cannot change the creative.

### Pause
- Swiping to the next Signal or Broadcast pauses and mutes the clip that was left, before the next one starts.
- A detached player can no longer keep audio in the background. The playback guard will not restart a clip marked as user-paused.

Keep Mail, Money, Band, and the landing as they already are.
