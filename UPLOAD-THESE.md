# GitHub update — exact files

Every file is already at its correct repo path. Copy over the root of your
`getnaluno/Naluno` checkout, keep the folder structure, commit.

Verified: byte-identical to the tested working copy, all JS passes
`node --check` from a fresh extraction, and this covers every file that
differs from the live repo.

## Files (20 changed + 3 new)

**Root** — `index.html`, `sw.js` (cache v121), `firestore.rules`,
`AndroidManifest.xml`, `BeaconFindService.java`

**css/** — `app.css`

**js/** — `broadcast-core.js`, `broadcast-space.js`, `circle.js`, `core.js`,
`keep-alive.js`, `notifications.js`, `pwa.js`, `signal-core.js`,
`signal-ui.js`, `spark-lg.js`, `spark-page.js`, `spark.js`, `strand.js`,
`wireline.js`

**signal-worker/** (new) — `index.js`, `wrangler.toml`, `README.md`

`js/calls.js` deliberately NOT here — untouched throughout.

## Not just a file upload

1. `firebase deploy --only firestore:rules` — or Spark's in-person Callsign
   swap stays broken.
2. `cd signal-worker && npx wrangler deploy` — or photo/document content
   types are still served wrong.
3. The two native Android files go in the Capacitor project, and
   `BeaconFindService.java` needs this in Gradle before it compiles:
   `implementation "androidx.security:security-crypto:1.1.0-alpha06"`

## Still outstanding (config, not code)

R2 `naluno-signal` deletes objects at 25h, so 3-day/7-day Signal options are
capped for now. Restore steps in `signal-worker/README.md`.

Sharded counters for viral-scale creators are documented in the changelog
(Round 5) as a known architectural limit, deliberately not half-implemented.
