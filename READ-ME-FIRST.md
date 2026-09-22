# Offline speed, the two failing tests, and honest answers on translate + mesh

## 1. Offline open: 10.5 seconds of waiting, removed

The service worker asked the **network first** and only fell back to the
cache — waiting up to **8 seconds for the page** and **2.5 seconds for every
file**.

A phone is rarely cleanly offline. It is on Wi-Fi with no internet, or a dead
mobile connection. Those requests do not fail, they **hang** until the timeout
runs out. So opening Naluno meant sitting through them. WhatsApp opens
instantly because it reads its own storage first and talks to the network
afterwards.

Now the app is served **from cache first** and refreshed in the background.
Measured on the worker's own decision with a hanging network:

| | before | after |
|---|---|---|
| the page | 8,008 ms | **0 ms** |
| its files | 2,503 ms | **0 ms** |
| **total before anything is drawn** | **10,511 ms** | **0 ms** |

A new version still appears after one extra open (the worker already calls
`skipWaiting` and `clients.claim`).

**Honest about the measurement:** this is the service worker's decision,
proved in isolation. I could not reproduce a full dead-network boot in a
headless browser, so I am not claiming a measured whole-app figure — only
that the 10.5 seconds of waiting is gone from the path.

## 2. The two failing tests — both were test bugs, and one hid a real loss

**`ads-inventory`** expected `admin-console.js?v=20260922d` while
`console-pass` expected `22e`, and the file is `22e`. The two tests
contradicted each other. Fixed to `22e`.

**`console-pass`** read the worker from `../workers/economy/handler.mjs` —
one level too high, outside the repo. Fixed.

With the path fixed it then failed for a real reason: **the worker was
2.6.4, not 2.6.6.** My Lifeline package shipped `workers/economy/handler.mjs`
from the old commit and reverted someone's console-password work — the same
mistake as the in-call bubble, in a second file I did not notice.

**Restored** (`2.6.6-console-pass`): the worker now reads **every** stored
copy of the console password — its own record, the `adminConsole` doc, and
the account vault's `_consoleGate` — and accepts any that matches, then
remembers the one that worked. Reading only the first copy is why a password
set on one phone could be refused on another. Unlocking and changing the
password both use every copy now.

**Every test in the repo passes: 10/10, plus 47/47 in the worker.**

## 3. Translate — the code is right; your phone is not running it

I checked the deployed files: `wireline-translate.js` is loaded,
`#translateBar` sits inside the thread directly above the composer, and the
hook is above the early return. I ran the deployed app in a real browser and
called the hook: the bar renders, reading **"Translate this chat"**.

So the files on GitHub are correct and your phone has older ones.

**How to tell for certain:** open **Callsign → Diagnostics**. The build line
should read **2026.09.23a**. If it shows anything older you are running an
old bundle, and translate cannot appear no matter what is on GitHub.

Two ways that happens:

- **The installed Android app.** `capacitor.config.json` has `webDir: "."`
  and no `server.url`, so the APK **bundles its own copy** of the web files.
  Uploading to GitHub does not change an installed APK — it needs rebuilding
  and reinstalling.
- **A stale cached shell** in the PWA. With today's change the worker also
  refreshes in the background, so one extra open settles it.

## 4. Offline phone-to-phone — why nothing arrived, plainly

Bluetooth being on is not enough, and this is not a bug I can fix in these
files.

**The mesh needs the Android plugin compiled into the app.** I wrote
`NalunoMeshPlugin.java` last round and said then that it had never been
compiled or run. Until an APK is built that includes it, **there is no
phone-to-phone transport at all** — the web app cannot do it, because the
browser has no way to connect two phones directly. So a fully offline phone
had nothing to send through, and the message stayed queued. That is expected,
not a failure of the routing.

What works offline **today**, with no build:

- **SMS.** Open the chat; the Lifeline bar offers **Send by SMS** with the
  segment count. That is the route that survived both Uganda shutdowns, and
  it is the only one that reaches another country.

To get the mesh working:

1. Add `implementation 'com.google.android.gms:play-services-nearby:19.3.0'`.
2. Put `NalunoMeshPlugin.java` beside `MainActivity.java` (already registered).
3. Build, install on **both** phones.
4. Test: both in aeroplane mode with Bluetooth on, within about 10 metres.

Even then, delivery is **eventual** — the phones must be near each other or
near someone else running Naluno.

## Files

```
sw.js                            cache-first app shell
workers/economy/handler.mjs      restored to 2.6.6-console-pass
js/ads-inventory.test.cjs        stamp corrected
js/console-pass.test.cjs         worker path corrected
```

Deploy the web files, then `cd workers/economy && npx wrangler deploy` — the
worker restore matters for admin unlock across devices.

## What I am changing about how I work

Twice now I have handed you a package containing a file built from a stale
clone, which reverted someone else's newer work. From now on I will diff every
file in a package against the live repo immediately before I hand it over, and
tell you if anything would be overwritten.
