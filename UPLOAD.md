# Naluno GitHub zip — 20260824b

This is the **full latest 23q tree** (Strand folders, Toga wall of fame, 23n Signal play, OriginID hold, Band settle, Wireline one-sided clear, Find Naluno auth-wait) plus media-stability layered on top. It is **not** the 24a overlay, which was built on an older tree and dropped folders / Toga / playback.

## This ship
- Strand folders at Broadcast entry stay: one mint/dark folder per Strand; tap opens the videos inside; only unattached videos stay free.
- Toga is the monthly Wall of Fame again. Tap to expand the ten names who moved Naluno this month. Score = public views + Circle + conversation. Tap a name to open that creator’s Broadcast. Views must be public to qualify. Lives 30 days.
- New Signals play again: no Broadcast↔Signal bucket hop, no `v.load()` during play, MEDIA_ERR_ABORTED does not retry, Signal playback stays on the Signal worker.
- Media identity: Broadcast ID → mediaId (storage path) → persistent asset. Player reuses `<video>` when mediaId is unchanged. Feed merges by Firestore id. Folder grouping is never replaced by index-only plate painting.
- Cache `?v=20260824b` · SW `naluno-shell-v85`

Already in this tree (kept): HEVC / Google Photos duration, Fit/Fill, nearby strip, OriginID hold ≥70, Band 2h settle, Wireline `clearedAt`, Find waits for ID token, COMPAT_LOCK.

## After upload
Close every Naluno tab → site info → delete cookies/site data → open once.

If Band wipe / Wireline hide / Find Naluno still fail after this zip, publish `firestore.rules` from this zip to Firebase.
