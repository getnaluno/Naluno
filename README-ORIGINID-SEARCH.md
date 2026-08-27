# Turning on real Google Search for OriginID

OriginID's copyright-similarity check works today without this — it already
compares against Naluno's own catalog (so it can name another creator and
their exact work on a genuine match) and searches Wikipedia, iTunes,
MusicBrainz, Deezer, TVmaze, Open Library, Internet Archive, and Openverse,
none of which need a key. This document is for the specific ask of adding
*general* Google Search results on top of that — being upfront that this
needs real credentials that weren't available while building this, so the
code is wired to activate the moment you add them, rather than faked.

## What you need

Two free values from Google, both take a few minutes:

1. **A Custom Search JSON API key**
   - Go to https://console.cloud.google.com/apis/library/customsearch.googleapis.com
   - Enable the "Custom Search API" on your project (the same `naluno-28a00`
     project everything else already uses is fine, or a separate one if you'd
     rather keep it isolated).
   - Credentials → Create Credentials → API key. Restrict it to the Custom
     Search API only, and optionally to your domain, for safety.

2. **A Programmable Search Engine ID**
   - Go to https://programmablesearchengine.google.com/controlpanel/create
   - Create a search engine set to "Search the entire web."
   - Copy its Search engine ID (looks like `a1b2c3d4e5f6g7h8i`).

## Wiring it in

Open `firebase-config.js` and fill in the two blank constants already sitting
there for this:

```js
const GOOGLE_CSE_API_KEY = "your-api-key-here";
const GOOGLE_CSE_ID = "your-search-engine-id-here";
```

That's the entire integration — `origin.js`'s `scanOpenWeb()` already checks
for these on every OriginID scan and only calls the Google Search API when
both are present. Nothing else needs to change, and no redeploy of any
Worker is needed — this is a pure client-side config value, same as the
Firebase config above it.

## Cost

Google's Custom Search API free tier is 100 queries/day. Past that, it's
$5 per 1,000 queries (Google's current published pricing — verify at
https://developers.google.com/custom-search/v1/overview since this can
change). Since OriginID already screens with the free sources first and
only reaches the web/Google step for non-generic titles, actual Google
query volume will typically be well under total scan volume.

## What this does and doesn't add

Adding this genuinely broadens web coverage beyond the seven catalog-style
sources already wired in — it's real general search, not another curated
catalog. It does **not** change how Naluno-internal matches work (the part
that names another creator by name on a close match) — that's entirely
separate and already fully working without this.
