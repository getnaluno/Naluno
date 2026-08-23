# Naluno — 20260823e (full latest + audit)

Built on the current full PWA (Circle · Strand · Origin · sign-in retry).
This is **not** a thin-base zip.

## Fixed in this ship
- Chrome shade player: MediaSession metadata is always empty (no titled "Naluno" session).
- Signal: blob fallback when HEVC/Range hangs; play kick; default Video pick; `accept="video/*"` only (stops Google Photos Preparing).
- Short Samsung HEVC converts to WebM on Signal and Broadcast upload so other phones can play.
- Broadcast **Fit / Fill** restored; stage follows uploaded aspect.
- Views are **cards**. Viewers see **this Broadcast only**. Totals are **creator-only**.
- Toga board is cards, not word rows.
- Calls: remote video is no longer hidden while paused (that left both sides on avatars).
- Sign-in retry + SW never intercepts gstatic (kept).

## Cache
- `?v=20260823e`
- Service worker `naluno-shell-v79`

## After upload
Close every Naluno tab → Chrome site info → delete cookies/site data for getnaluno.com → open once.
