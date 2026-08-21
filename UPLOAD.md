# Upload Naluno to getnaluno.com

This zip is the real PWA (GitHub Pages), not the Grok preview studio.

## What this zip is

Unzip. The site root is the `naluno-pwa/` folder:

```
index.html
firebase-config.js
manifest.json
sw.js
CNAME
icon-192.png
icon-512.png
css/app.css
js/*.js
```

Firebase project: **naluno-28a00**. Custom domain: **getnaluno.com**.

## 1. Push to GitHub Pages

The live repo is one of:

- `nolegoafrica/Naluno`
- `getnaluno/Naluno`

Pages serves the **repo root** (not `/docs`).

```bash
unzip naluno-fast-call-20260821o.zip
cd naluno-pwa
git clone git@github.com:nolegoafrica/Naluno.git live
# copy this tree over the clone, keeping .git
rsync -a --exclude .git ./ live/
cd live
git add -A
git status
git commit -m "Fast calls: sub-2s offer, filters on both sides, Go Live ICE"
git push origin main
```

GitHub Pages rebuilds. Cloudflare sits in front of getnaluno.com.

## 2. Cache bust

`index.html` already pins scripts at `?v=20260821o`. After push, a hard refresh is enough. This zip bumps the service worker to `naluno-shell-v69` (network-first for JS/CSS/HTML). Old phones pick up the new SW on the next visit.

## Notes that stay ops, not code

- **Signal 3-day / 7-day TTL:** the R2 bucket still deletes objects after ~25 hours unless you raise the lifecycle rule to 8 days. Until then a 7-day Signal can 404 after day 1.
- **100k live viewers:** mesh is capped at 12. SFU is a contract only (`window.NALUNO_SFU`). Do not set `enabled: true` until a provider adapter is real and you are on Blaze.

## 3. Do not touch

- `firebase-config.js` — keep the live `naluno-28a00` keys.
- `CNAME` — must stay `getnaluno.com`.
- Existing Signals / Broadcasts / accounts — catalog stays playable (compat lock).
- Cloudflare Workers (already live, do not redeploy unless you changed them):
  - `naluno-turn-credentials.naluno.workers.dev`
  - `naluno-call-notify.naluno.workers.dev`
  - `naluno-signal-upload`
  - spark translate worker

## 4. Confirm after upload

On two phones, same Wi-Fi then different networks:

1. Sign in, pick a filter in the lobby, call. Remote video must show **your** filter, not a plain camera. Connect after Answer should feel instant (offer is no longer waiting on TURN).
2. Mid-call, tap another filter chip. The other person sees it.
3. Hang up, call again (double-tap hangup must not freeze the next dial).
4. Open a Broadcast you own → **Go live**. A second account taps **Join live**.
5. Play an old Broadcast. Deleted chapters skip; they do not leave a 4-minute hole.
6. Signal is still the original file, max 4:00. No gallery “prepare”.

## 5. Scale (already ordered, do not skip)

1. Metrics are on (`js/metrics.js`).
2. Broadcast live mesh is capped at 12 until an SFU is configured (`window.NALUNO_SFU`). Do not turn that on until you are on Blaze and have a provider.
3. Chat/presence pagination is next after SFU.

1:1 calls scale per pair. 100k concurrent Broadcast viewers need the SFU, not more mesh.
