# GitHub / Firebase — 2026.09.12f

Ad overlay sits on the paused video, stays until Skip, and the video comes back with sound.
Only these files. Do not upload a full tree.

## Must publish

1. **js/ads.js** — overlay z-index sits above Broadcast and Signal players. The unit covers the paused video. It loops until Skip (the 5s mark only unlocks Skip; it does not dismiss). Skip restores the original video with sound.
2. **js/media-contain.js** — pause / exclusive / detach leave the ad player alone so it cannot be killed from underneath.
3. **js/broadcast-space.js** — chapter-break unit fills the video frame. No auto-dismiss. Skip only. Sound restored on the Broadcast.
4. **app/index.html**, **js/pwa.js**, **sw.js** — cache `naluno-shell-v164`, `?v=20260912f`.

## After upload

Close Naluno tabs once so the new service worker takes.
