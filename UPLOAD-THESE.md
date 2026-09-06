# GitHub update — 2026.09.06a

Copy these files over the root of `getnaluno/Naluno`. Keep the folder
structure. Commit and push. Force-close the webapp after it deploys
(not just swipe away). Re-open. Console should show:

`[naluno] build 2026.09.06a`

Service worker cache: **naluno-shell-v147**.

Do not rebuild architecture. Signal / Broadcast upload paths were not
changed.

## What this fixes

**The web app rings while it is open in the background.** Chrome will
not play in-page audio once Naluno is not on screen. Incoming calls now:

1. Keep a Firestore listener alive and retry if it dies.
2. Start the in-app ringtone (and do not pause it on hide).
3. Ask the service worker to show a noisy incoming-call notification.
4. If you have switched away, that notification **keeps sounding every
   ~2 seconds** until you answer, decline, or the caller hangs up.
5. Push wake is sent to **both** the web token and the Android token
   (`preferPlatform: both`).

Turn on Call notifications once under Callsign if you have not already.
The OS sound is what you hear when Naluno is open but unused.

## After push

Force-close Naluno. Re-open. Confirm `2026.09.06a`.

Leave Naluno running, switch to another app, have someone call you.
You should hear the notification ring and see Answer / Decline.
