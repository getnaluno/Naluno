# Naluno website at getnaluno.com, app on top

## What this is

`/` is now a real website. `/app/` is the app, unchanged.

## The design thinking

Naluno's own vocabulary — Callsign, Frequencies, Signal, Broadcast, Band —
is radio language, and that is not decoration: it is genuinely how the
product works. So the page is built as a **tuning dial** rather than the
usual stack of identical feature cards. Each part of the app sits at its own
"frequency" down a left spine, read top to bottom like a band.

The hero is a waveform, not a big number with a gradient wash. One piece of
ambient motion on the whole page (a slow drift on the trace), and it is
disabled under `prefers-reduced-motion`.

Type: Orbitron carries over from the app so the site and product read as the
same thing; Space Grotesk for body because Orbitron is unreadable at
paragraph length; IBM Plex Mono only where the content is genuinely
instrument-like — frequencies and readouts.

Copy avoids the category's usual claims. "Calls that ring. Messages that
arrive." is the honest pitch for an app whose hardest problems have been
exactly those.

## ⚠️ The part that would have broken things

Three things pointed at the root and would have broken silently:

1. **Every link already shared** — `?broadcast=`, `?strand=`, `?spark=`,
   `?call=` all resolve at `/`.
2. **Every installed PWA** — `start_url` was `"./"`, so they open `/`.
3. **The service worker**, registered at scope `/` with *cache-first
   navigation*. On any device with Naluno installed it would have served the
   **cached app shell at the new website address** — the site would look like
   it had never deployed, and re-uploading would not have fixed it.

All three are handled:

- The root page forwards deep links and standalone launches straight to
  `/app/` with the query and hash intact, before paint.
- `sw.js` now treats `/` as **network-first** and never caches it, while
  `/app/` keeps the existing cache-first behaviour that makes the app open
  instantly and work offline. Offline on the landing page falls through to
  the cached app rather than a browser error.
- `manifest.json` `start_url` → `/app/`, `scope` stays `/` so the redirect
  path remains in-scope.

The app's own `index.html` had **45 relative asset references**
(`js/…`, `css/…`) which would all 404 from `/app/`. All 45 rewritten to
absolute paths. `js/` and `css/` stay exactly where they are — no other file
moves.

## Files

```
/index.html          the website
/app/index.html      the member app
/admin/index.html    operator Control Centre — not linked, not cached
/manifest.json       start_url -> /app/
/sw.js               root network-first, /admin never cached, cache v150
/robots.txt          Disallow: /admin/
```

Everything else — `js/`, `css/`, icons, workers — is untouched and stays put.

## Deploy

Copy these four into the repo root, keeping the `app/` folder. Nothing to
delete: the old root `index.html` is replaced by the website, and its content
now lives at `app/index.html`.

## Tested

24 assertions: shared deep links still open the app with the query preserved,
installed PWAs land in the app, plain visitors get the site, the service
worker never serves the cached shell at `/`, all 45 asset paths resolve, and
the page is responsive with keyboard focus and reduced-motion respected.

## Worth knowing

First load after deploying, a device with the old service worker still
active may show the app once at `/` before the new worker takes over. A
single refresh settles it. That is inherent to replacing a service worker
and is why the cache version is bumped.
