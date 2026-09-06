# GitHub update — 2026.09.06b

Copy over the repo root. Keep the `app/` folder. Force-close Naluno after
it deploys, then reopen. Console should show:

`[naluno] build 2026.09.06b`

Service worker cache: **naluno-shell-v149**.

## Why sign-in failed

The app moved to `/app/`. `firebase-config.js` was still loaded as a
**relative** file, so the phone asked for `/app/firebase-config.js`,
which does not exist. Firebase never started. After 16 seconds the form
said:

> Sign-in could not start — check the connection, then tap again.

The service worker was also being registered as `sw.js` with scope `./`,
which from `/app/` is `/app/sw.js` — another miss.

## What this fixes

- Config loads from `/firebase-config.js`
- Auth retries that path if the first load missed it
- Service worker registers at `/sw.js` with scope `/`
- App shell cache is `/app/index.html`, not the marketing page
- The public website is alive: aurora, live waveform, stations that
  tune in as you scroll

Signal / Broadcast upload paths were not changed.

## After push

Force-close. Re-open. Sign in with handle + password or Google.
The getnaluno.com landing should move.
