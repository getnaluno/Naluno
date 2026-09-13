# GitHub / Firebase — 2026.09.12e

Watch-time ads, faster Control Centre, lighter first app install.
Only these files. Do not upload a full tree.

The operator inbox address is not in any of these files.

## Must publish

1. **js/ads.js** — skippable break after every N minutes of actual watching (default 1). The old every-four-cards weave is gone. Clock runs only while a Signal or Broadcast is playing, not on muted feed previews.
2. **js/admin-console.js**, **admin/index.html** — Ads tab has a How often control (1–30 minutes). Snapshot loads core numbers first, then fills the rest. Tab switches reuse a 90-second cache. Upload helper loads only when saving a unit.
3. **app/index.html**, **js/pwa.js**, **sw.js** — cache `naluno-shell-v163`, `?v=20260912e`. Admin and Spark files are no longer precached on first app install.

## After upload

Close Naluno tabs once so the new service worker takes.

Pacing is stored on `economyConfig/flags.adEveryMin` (already readable by signed-in accounts, writable by operators). No new Firestore rules.

The 30-second brand film is a separate download. To run it in the app, upload it from Control Centre → Ads as a live unit.
