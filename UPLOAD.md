# Naluno — upload (20260822d)

## What this zip is
Finished PWA root (index.html, js/, css/, sw.js, …). Unzip so those files sit at the **root** of your GitHub Pages branch (not inside a nested folder).

## GitHub Pages
1. Unzip `naluno-compass-signal-20260822d.zip`
2. Commit/push the contents to the branch your Pages site serves (usually `main` or `gh-pages`)
3. Hard-refresh the installed PWA (or clear site data once) so `naluno-shell-v73` replaces the old SW

## Fixes in this build
- **Compass weather**: Open-Meteo hourly precip — answers “rain tonight” with a real % estimate (still free, no paid APIs)
- **Compass memory framing**: system prompt no longer lets the model claim it forgot this chat
- **Signal stills**: native aspect + contain, stalled recovery, hard fallback timer so poster is never permanent
- **Signal type normalize**: segments with `videoUrl` always play as video
- **Broadcast aspect**: adapts to uploaded portrait/landscape; Fit/Fill toggle; orientation-aware stage
- **Pickers**: `video/*` only (no extensions) + fresh `<input>` per Signal video pick (reduces Gallery “Preparing”)

## Notes
- Google Photos may still show “Preparing” when *it* decides to export a file — that is the Photos app, not Naluno re-encoding. Prefer **Files / My Files** when you want the exact original bytes with no dialog.
- Signal TTL UI (24h / 3d / 7d) vs R2 lifecycle (~25h) is documented only; do not change UI without worker lifecycle.
