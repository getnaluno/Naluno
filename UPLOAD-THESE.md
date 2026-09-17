# GitHub / Firebase — 2026.09.15c

Empty states sit in the middle of the pane. Control Centre reads the live app build from `/app/index.html`, so a new app upload is what the desk reports.

Only these files. Do not upload a full tree.

The operator inbox address is not in any of these files.

## Must publish

1. **css/app.css**, **app/index.html**, **js/core.js**, **js/wireline.js**, **js/band-list.js**, **js/signal-ui.js** — centered empty states on Wireline, Band, Frequencies, and Broadcast. Compass actions stay grouped on the right.
2. **js/pwa.js**, **sw.js** — cache `naluno-shell-v171`, `?v=20260915c`. Service-worker handshake reports this build, not an old `v158`.
3. **admin/index.html**, **js/admin-console.js** — Health / strip **App version** is read from the live app. Upload these with the app so the desk and the member shell stay on the same stamp.

## After upload

Close Naluno tabs once so the new service worker takes. Refresh Control Centre once.
