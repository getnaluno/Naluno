# GitHub update — 2026.09.04d

Copy these files over the root of `getnaluno/Naluno`. Keep the folder
structure. Commit and push. Force-close the webapp after it deploys
(not just swipe away). Re-open. Console should show:

`[naluno] build 2026.09.04d`

Service worker cache: **naluno-shell-v141**.

Do not rebuild architecture. Signal / Broadcast upload paths were not
changed.

## What this fixes

1. **Avatars everywhere** — Callsign photos now resolve live for every
   face: Band card stack (“What if?” initials), Band roster, Band
   messages, Find, Signal viewer, Circle/Toga, calls. The stack no
   longer paints a frozen `memberInfo` snapshot that was copied before
   photos hydrated.
2. **Callsign crop** — Saving bakes pan/zoom into a square JPEG, then
   uploads that. The circle no longer applies `translate(-50%,-50%)` on
   an inset image (that is what pushed faces out of bounds). Avatar
   adjust is a circular clip so drag stays inside the face.
3. **Go live** — Opening a live Broadcast joins automatically so the
   host is visible without a second tap. Host track attach maps
   recvonly transceivers more strictly and retries a failed PC.
4. **Broadcast after a phone notification** — pause stores
   `currentTime` and restore snaps back if Chrome jumped or restarted.
   Swiping off a plate still sets want-play off, so resume cannot
   restart a video you already left.
5. **Band wipe** — After 2h empty, messages are cut at
   `max(lastEmptiedAt, messageEpoch)` even if Firestore delete is slow.
   Rules allow prune when `messageEpoch` is set. Timestamp objects no
   longer make the 2h clock `NaN`.
6. **Wireline decrypt** — Each text is sealed in envelopes for both
   people (plus the legacy ciphertext). Decrypt cache persists on
   device. Failed lines no longer show a fake empty bubble.
7. **Community count** — The Impact number is the Circle roster
   size, the same list the sheet opens. Not the Broadcast’s own
   `memberUids` (that is why it showed 1 while two people were listed).

## After push

Force-close Naluno. Re-open. Confirm `2026.09.04d`. Then:

- Re-save your Callsign photo once so the baked `photoUrl` lands
- Band “What if?” stack should show photos, not MM / M / K / AW
- Band “Cleared” should show an empty thread, not last night’s clips
- Open a live as a viewer — picture should appear without a second Join
- Community tap number = people in the sheet
