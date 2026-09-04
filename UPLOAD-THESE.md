# GitHub update — 2026.09.04b (six-bug sweep)

Copy these files over the root of `getnaluno/Naluno`. Keep the folder
structure. Commit and push. Force-close the webapp after it deploys
(not just swipe away). Re-open. Console should show:

`[naluno] build 2026.09.04b`

Service worker cache: **naluno-shell-v139**.

Do not rebuild architecture. Signal / Broadcast upload paths were not
touched in this sweep.

## What this fixes

1. **Call lobby** — tapping Call always opens the Greenroom lobby.
   Off-grid no longer jumps to “Leave a voice signal”. That screen is
   still the fallback after a ring that nobody answers.
2. **Strand bar + Search overlap** — Broadcast sticky is always a
   column. The Strand title and the search field sit *under* For You /
   My Broadcasts / SEARCH, never in the same row.
3. **Broadcast search** — Samsung `type=search` chip is gone
   (`type=text` + `inputmode=search`). Search runs over the local feed
   even if Firestore is slow, including titles, people, and Strand names.
4. **Band messages returning** — presence no longer resets the 2h
   clock after the window has elapsed. Wipe stamps `messageEpoch`,
   deletes old lines, then starts a fresh clock. Timestamp parsing no
   longer treats old messages as “now”.
5. **Videos after swipe** — leaving a plate, swiping For You / Mine,
   or leaving the Broadcast tab pauses feed/preview media. Keep-alive
   cannot resume a player that is no longer on an open surface.
6. **Avatars in Wireline + Frequencies** — photos resolve from
   `photo.dataUrl`, `photo.url`, and `photoUrl` (same as Toga). Live
   profile refresh no longer wipes a good photo when the users doc
   omitted a huge dataUrl.

## Files

- `index.html` (build 2026.09.04b, search input type)
- `sw.js` (cache **v139**)
- `css/app.css`
- `js/core.js`
- `js/pwa.js`
- `js/find.js`
- `js/auth.js`
- `js/calls.js`
- `js/atmosphere.js`
- `js/band-room.js`
- `js/band-list.js`
- `js/broadcast-core.js`
- `js/signal-ui.js`
- `js/wireline.js`
- `js/media-contain.js`
- `js/profile.js`
- `js/strand.js`
- `UPLOAD-THESE.md` (this file)

A full-repo zip is also provided: `naluno-play-20260904b-full.zip`.
You can upload the whole zip contents over the repo root.

## After push

Force-close Naluno. Re-open. Confirm the build chip / console line
`2026.09.04b`. Then:

- Frequencies → Call on someone off-grid → lobby with camera, not the
  voice-signal screen
- Broadcast → Search → type under the tabs, results below
- Open a Strand → title bar under the tabs, SEARCH still readable
- Leave a Band 2h+ → messages stay gone after reopen
- Swipe off a playing plate / leave Broadcast → audio stops
- Wireline + Frequencies show the same face Toga already showed
