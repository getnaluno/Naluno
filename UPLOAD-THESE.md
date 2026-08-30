# GitHub update — exact files

Every file in this bundle is already at its correct repo path. Copy the
contents of this folder over the root of your `getnaluno/Naluno` checkout,
keeping the folder structure, and commit.

Verified before packaging: all files are byte-identical to the tested
working copy, all JS passes `node --check`, and this bundle covers every
file that differs from the current live repo — nothing missing, nothing
extra.

## Files (20 changed + 3 new)

**Root**
- `index.html`
- `sw.js` — cache bumped to v120 (required, or browsers keep the old JS)
- `firestore.rules` — ⚠️ needs a separate deploy, see below
- `AndroidManifest.xml` — native, see below
- `BeaconFindService.java` — native, see below

**css/**
- `css/app.css`

**js/**
- `js/broadcast-core.js`
- `js/broadcast-space.js`
- `js/circle.js`
- `js/core.js`
- `js/keep-alive.js`
- `js/notifications.js`
- `js/pwa.js`
- `js/signal-core.js`
- `js/signal-ui.js`
- `js/spark-lg.js`
- `js/spark-page.js`
- `js/spark.js`
- `js/strand.js`
- `js/wireline.js`

**signal-worker/ (new folder)**
- `signal-worker/index.js`
- `signal-worker/wrangler.toml`
- `signal-worker/README.md`

`js/calls.js` is deliberately NOT here — untouched, byte-identical to the
original.

## Three things that are NOT just a file upload

**1. Firestore rules**

```bash
firebase deploy --only firestore:rules
```

Without this, the Spark in-person Callsign swap stays broken — the guest's
claim write is still rejected by the old rule.

**2. The signal worker**

```bash
cd signal-worker
npx wrangler deploy
```

Without this, photos and documents still get wrong content types served
back. Confirm the `SIGNAL_BUCKET` binding and the `FIREBASE_WEB_API_KEY`
secret are set first (see `signal-worker/README.md`).

**3. The native Android files**

`AndroidManifest.xml` and `BeaconFindService.java` belong to the Capacitor
Android project, not the web root — put them wherever they actually live in
that project. `BeaconFindService.java` also needs a Gradle dependency added
before it will compile:

```gradle
implementation "androidx.security:security-crypto:1.1.0-alpha06"
```

This one is a real security fix (a Firebase refresh token was stored
unencrypted with backup enabled), so it's worth doing rather than skipping.

## Still outstanding, not fixable in code

The `naluno-signal` R2 bucket deletes objects after 25 hours, which is why
Signals died before their chosen lifetime. The 3-day and 7-day options are
capped for now as a stopgap. To restore them: extend the bucket's lifecycle
rule to 168 hours in the Cloudflare dashboard, set
`SIGNAL_TTL_MAX_HOURS = 168` in `js/broadcast-core.js`, and uncomment the
two chips in `index.html`. Full detail in `signal-worker/README.md`.
