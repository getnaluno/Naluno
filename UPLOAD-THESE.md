# GitHub update — 2026.09.05a

Copy these files over the root of `getnaluno/Naluno`. Keep the folder
structure. Commit and push. Force-close the webapp after it deploys
(not just swipe away). Re-open. Console should show:

`[naluno] build 2026.09.05a`

Service worker cache: **naluno-shell-v144**.

New file: **js/onboard.js** (must be copied — first-run welcome lives there).

Do not rebuild architecture. Signal / Broadcast upload paths were not
changed.

## What this adds

1. **Welcome for a brand-new person.** After the drawing logo, someone
   who has never used Naluno on this phone sees a landing: Welcome,
   real Privacy Policy, real Terms of Service, language (English /
   Luganda), then **Agree and continue**. Same shape as a first-run
   messenger, Naluno’s own look.
2. **The legal text is real.** It describes this app as it works:
   no phone number, Firebase accounts, Wireline encryption, Band’s
   2-hour wipe, Signal expiry, Broadcast, Find Naluno off-by-default,
   weather from this phone, Compass, Origin copyright. Not filler.
3. **How Naluno works.** Seven short Next pages, Skip any time, then
   the existing sign-in. A new person should not need someone else
   to explain the bar at the bottom.
4. **Returning phones skip it.** If this phone already had a Naluno
   account, welcome and tour never appear. Privacy and Terms stay
   readable from Callsign and from the sign-in screen.

## After push

Force-close Naluno. Re-open. Confirm `2026.09.05a`.

To preview the welcome on a phone that already has an account: clear
this site’s data (or the two keys `nalunoWelcomeOk` and `nalunoTourOk`
plus `nalunoLastUid`), then reopen signed out.
