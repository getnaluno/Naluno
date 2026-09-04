# GitHub update — 2026.09.04e

Copy these files over the root of `getnaluno/Naluno`. Keep the folder
structure. Commit and push. Force-close the webapp after it deploys
(not just swipe away). Re-open. Console should show:

`[naluno] build 2026.09.04e`

Service worker cache: **naluno-shell-v142**.

Also deploy **firestore.rules** (Firebase console or `firebase deploy --only firestore:rules`).
The 2h Band wipe cannot actually delete without the new rules.

Do not rebuild architecture. Signal / Broadcast upload paths were not
changed.

## What this fixes

1. **Band 2h wipe is a hard delete.** After the square has been empty
   for 2 hours, every message doc is removed from Firestore. A wipe
   queue is snapshotted at empty-time so deletes still run even after
   the docs become unreadable. `lastEmptiedAt` is only cleared when the
   session is actually gone — clearing it early is what let last
   night's clips stream back as "Cleared".
2. **Cannot be retrieved.** Rules deny read of any message with
   `ts < messageEpoch`. The live listener and "load older" query only
   ask for `ts > cutoff`. Offline outbox rows for a settled Band are
   dropped, not flushed. The previous session is not in memory, not in
   the cache, and not readable on the server.
3. **Empty clock always restamps.** Leaving the square writes a fresh
   `lastEmptiedAt`. A leftover stamp from an older cycle can no longer
   sit there while a new conversation is treated as already "Cleared".
4. **Avatars, crop, live, Community, Wireline** from 09.04d stay in
   this build.

## After push

Force-close Naluno. Re-open. Confirm `2026.09.04e`. Then:

- Deploy firestore.rules
- Band that has been empty > 2h should open Quiet, with no voice/video
  from the previous gathering
- New messages after that start a new session and get their own 2h clock
