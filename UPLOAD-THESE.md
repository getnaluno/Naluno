# GitHub update — 2026.09.03b (upload unblock)

Copy these files over the root of `getnaluno/Naluno`. Keep the folder
structure. Commit and push. Force-close the webapp after it deploys.

## Why nothing changed last time

Live workers are healthy (CORS, auth, `/b/init` all respond).
The 09.03a zip reached GitHub. Uploads still did nothing and the
console stayed empty because:

1. Broadcast file input was nested inside a `<button>` (invalid HTML).
   Samsung Chrome never fires `change`. Publish stayed disabled.
   Disabled buttons do not fire click — so no log, no toast, no fetch.
2. Signal used a hidden `display:none` input plus a programmatic
   `.click()`. Same Samsung failure mode.
3. Service worker matched JS with `ignoreSearch: true` and a 2.5s
   timeout, so a slow phone kept yesterday’s uploader.
4. `keepalive: true` on 8MB chunk PUTs hits Chrome’s 64KB keepalive
   quota and aborts the request.

## Files

- `index.html`
- `sw.js` (cache **v134**)
- `css/app.css`
- `js/core.js`
- `js/signal-core.js`
- `js/broadcast-upload.js`
- `js/broadcast-composer.js`
- `js/compass.js`
- `js/pwa.js`
- `js/signal-ui.js`
- `signal-worker-index.js` (optional — see below)

## After push

Force-close Naluno (not just swipe away). Re-open. You should see
`[naluno] build 2026.09.03b` in the console, and a green chip at the
top of the screen the moment you tap Choose / Post.

Workers do **not** need a redeploy for this ship. They already accept
uploads. `signal-worker-index.js` only adds a `/health` GET if you
later run `npx wrangler deploy` on `naluno-signal-upload`.

## Still config, not this zip

R2 `naluno-signal` still deletes objects at ~25h. That is a bucket
lifecycle rule, not this code.
