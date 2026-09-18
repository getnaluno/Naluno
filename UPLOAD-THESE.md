# GitHub — 2026.09.18g

Website analytics now write into Firestore and show on Control Centre → **Analytics** (and a strip on Overview).

**You must publish `firestore.rules`** or the public site cannot record visits and the tab stays at zero.

Only these files. Do not upload a full tree.

## Must upload

1. **firestore.rules** — publish in Firebase after upload
2. **index.html**, **privacy.html**, **terms.html**
3. **js/site-pulse.js** (new)
4. **js/admin-data.js**, **js/admin-console.js**, **admin/index.html**
5. **app/index.html** — counts Open Naluno (once per browser per day)

What is recorded (not a Callsign, not GPS):

- visits, unique browsers, time on the page, bounce
- country / city (network), device, OS, browser, language, screen
- referrer, UTM, page path, hour of day
- Open Naluno taps and actual /app opens
- contact-form sends, tuner taps
- people on the site right now (heartbeat in the last 2 minutes)

The operator inbox address is not in any of these files.
