# GitHub update — 2026.09.04f

Copy these files over the root of `getnaluno/Naluno`. Keep the folder
structure. Commit and push. Force-close the webapp after it deploys
(not just swipe away). Re-open. Console should show:

`[naluno] build 2026.09.04f`

Service worker cache: **naluno-shell-v143**.

Do not rebuild architecture. Signal / Broadcast upload paths were not
changed. Do not push unless asked.

## What this fixes

1. **Diagnostics live in the Admin Console.** 6 taps on the dot below
   Sign out. The device log is in that overlay (copy / clear), not on
   Callsign. Worker unlock is still required for economy admin; the
   log is visible as soon as the panel opens.
2. **Weather follows this phone.** Find Naluno’s live ping is the
   place weather reads. No more hardcoded Al Ain. High-accuracy GPS,
   Open-Meteo `minutely_15`, reverse-geocode via BigDataCloud. The
   strip waits for this phone’s place instead of inventing a city.
   Moving more than 250 m refreshes; otherwise it polls every 3
   minutes. Native Android Find writes also feed the same live place.
3. **09.04e Band 2h wipe** (hard delete + unreadability) stays in
   this build. Deploy **firestore.rules** if that is not live yet.

## After copy-over

Force-close Naluno. Re-open. Confirm `2026.09.04f`. Then:

- Weather strip should name the city you are actually in (Abu Dhabi
  when you are there), not Al Ain
- Turn Find Naluno on: weather should track that ping in real time
- 6 taps on the Callsign dot → Diagnostics, no Diagnostics button
  on Callsign itself
