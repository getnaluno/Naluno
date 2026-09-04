# GitHub update — 2026.09.04c (avatars, Wireline send, calls, notifications)

Copy these files over the root of `getnaluno/Naluno`. Keep the folder
structure. Commit and push. Force-close the webapp after it deploys
(not just swipe away). Re-open. Console should show:

`[naluno] build 2026.09.04c`

Service worker cache: **naluno-shell-v140**.

Do not rebuild architecture. Signal / Broadcast upload paths were not
changed in this sweep.

## What this fixes

1. **Avatars in Frequencies + Wireline** — list rows always show color +
   initials. Photos are an `<img>` overlay and only from an https URL.
   Failed loads remove the image; they no longer leave a black disc.
   Saving your Callsign photo now uploads to R2 and writes `photoUrl` on
   `users/{uid}` so the other phone can actually fetch the face.
2. **Callee sees the caller’s face** — the call document now carries
   `callerPhotoUrl` (https only) plus name / color / initials. Incoming
   UI paints that with the same `<img>` overlay.
3. **Wireline composer** — text leaves the box immediately. A 450ms lock
   stops double-send. The bubble is optimistic; encrypt only uses a
   public key already on the contact (no extra Firestore wait).
4. **Call ring after leaving** — closing the lobby / overlay stops
   ringback and ringtone, clears the audio element, and tells the
   service worker the call is handled. Android Back hangs up.
5. **Call notification** — Decline is Decline (it no longer answers).
   One follow-up ring at 2.5s, cancelled if you already handled it.
   Tapping Decline writes `declined` on the call doc.
6. **Broadcast leftover audio** — leaving the Broadcast room pauses and
   unloads every `#bspace` video/audio, clears the media host, and
   locks Chrome’s media session.

## Files

- `index.html` (build 2026.09.04c)
- `sw.js` (cache **v140**)
- `css/app.css`
- `js/core.js`
- `js/pwa.js`
- `js/find.js`
- `js/auth.js`
- `js/profile.js`
- `js/calls.js`
- `js/wireline.js`
- `js/signal-ui.js`
- `js/band-list.js`
- `js/band-room.js`
- `js/broadcast-space.js`
- `js/media-contain.js`
- `UPLOAD-THESE.md` (this file)

A full-repo zip is also provided: `naluno-play-20260904c-full.zip`.
You can upload the whole zip contents over the repo root.

## After push

Force-close Naluno. Re-open. Confirm the build chip / console line
`2026.09.04c`. Then:

- Wireline + Frequencies show initials immediately; faces appear once
  that person has a `photoUrl` (re-save your Callsign photo once)
- Place a call — callee sees your name, color, and photo
- Send a Wireline text — it leaves the box at once, one copy
- Leave a ringing call with Back — ring and notification stop
- Notification Decline does not open the incoming screen
- Leave a Broadcast — audio does not keep playing in the shade
