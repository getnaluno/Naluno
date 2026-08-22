# Naluno 20260822g — Samsung HEVC + upload

Unzip at GitHub Pages **root** (index.html beside js/, css/, sw.js).

## Critical for Samsung
- New Signal videos that are HEVC are converted to WebM (VP8/VP9) before upload so they play everywhere.
- Short Broadcast HEVC (≤6 min) also converts; longer ones upload original + blob play fallback.
- Empty picks (Google Photos prepare = 0 bytes) are rejected with a clear toast.
- Never upload Content-Type: application/octet-stream.

## Also redeploy signal-worker (optional but recommended)
```
cd signal-worker && npx wrangler deploy
```
Worker now serves .bin / octet-stream objects as video/mp4 so older uploads can play.

Phone: clear site data once → SW **v76**.
