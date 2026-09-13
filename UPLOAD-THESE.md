# GitHub update — 2026.09.14c

**Zip:** `naluno-play-20260914c-github-update.zip`

Upload this. Do **not** upload `20260913s` (Support still on the nav) or `20260914b` (Strand bar still splits off For You).

## What this drop does

- Creator Support lives **only** inside a Broadcast, under Circle. No nav tab.
- A Strand’s bar stays **on that Strand**. Signals, Toga, For You / My Broadcasts / Search hide while you are inside it. Back returns you.
- “Was live” on a Broadcast disappears after **24 hours**. Live-now still shows while it is live.
- Ad that plays through resumes the Broadcast, with audio. Operator picks the currency (ISO list, including UGX); amounts convert live.

Cache: `naluno-shell-v168`, `?v=20260914c`.

## Must publish

sw.js, js/pwa.js, app/index.html, css/app.css,
js/economy-ui.js, js/economy.js, js/profile.js, js/currency.js,
js/ads.js, js/broadcast-space.js, js/strand.js, js/signal-ui.js,
admin/index.html, js/admin-console.js, js/admin-data.js.

## After upload

Close every Naluno tab → site info → clear site data once → open. The new worker (`v168`) has to take, or the phone will keep the old shell.
