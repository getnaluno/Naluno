# GitHub update — 2026.09.10a

Control Centre rebuild. Unlock no longer depends on the economy worker.
Tabs read Naluno through the signed-in operator. Clock is local, not Zulu.

## Must publish

1. **firestore.rules** — operator can read economy collections and write
   `economyConfig/flags`. Until this is published, flag toggles and
   suspend/restrict will say so instead of silently failing.
2. **admin/index.html**, **js/admin-data.js**, **js/admin-console.js**
3. **sw.js**, **js/pwa.js**, **js/presence.js**, **js/economy.js**
4. **app/index.html** (script versions)

## What changed

- Time in the header is the admin device timezone (Asia/Dubai on a
  UAE phone), never `04:30:23Z`.
- Unlock does not print the Google service-account error. That belongs
  on Health, as a warning, and does not block the desk.
- Feature flags are stored at `economyConfig/flags` and read by the
  member app from Firestore first. Worker flags are a fallback only.
- Presence also writes `users/{uid}.lastSeen`, so DAU / active-now
  still work when the worker cannot write.
- The service worker registers on the desk, answers a hello ping, and
  no longer 404s `/admin/` when the network blips.

Copy over, then in Chrome: Settings → Site settings → getnaluno.com →
Clear & reset if an old worker is stuck. Hard reload `/admin/`.
