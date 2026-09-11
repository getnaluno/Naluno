# GitHub update — 2026.09.11c

Band live chat: audio and video drop into the square immediately.

## Must publish

1. **js/band-room.js**
2. **firestore.rules** — the author can update `mediaUrl` / `thumb` / `pending` on their own Band message. Until this is published the clip still appears, then a fallback write fills the file.
3. **sw.js**, **js/pwa.js**, **app/index.html** (cache `naluno-shell-v159`, `?v=20260911c`)

## What changed

- Stop recording → the bubble is in the Band at once (you see the clip, everyone else sees “sending…”).
- File upload no longer blocks the drop-in. Thumbnail is grabbed from the local clip, not re-downloaded.
- Message time is stamped on the phone so the live query does not hide the row until the server clock arrives.
- Text does the same: it is on screen before encrypt/write finishes.

Copy over, then close Naluno tabs → site info → clear & reset if an old worker is stuck → open once.
