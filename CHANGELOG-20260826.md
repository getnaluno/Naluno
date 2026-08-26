# Naluno — Fix Pass 20260826

This package contains the full app plus the Cloudflare Workers, with every
confirmed bug from the review passes fixed, verified against the real call
sites, and syntax/logic-tested (see "How this was tested" below). Nothing
visual or behavioral was changed for normal use — every fix is either a
correction to broken/dead logic or a narrowing of something that was too
permissive.

## New in this package: `broadcast-worker/`

The dedicated Cloudflare Worker for Broadcast uploads, now pointed at its own
permanent R2 bucket instead of sharing the ephemeral Signal bucket. **This is
the fix for "Broadcast videos die after about a day."** Deployment steps and
a migration guide for already-posted content are in
`broadcast-worker/README.md` and `broadcast-worker/migrate-broadcast-media.md`.
This is the one change in this package that requires action outside the code
itself (creating the new R2 bucket in Cloudflare) before it takes effect.

---

## Fixes in this pass

### Critical

**Broadcast media was permanently stored in the same bucket as ephemeral
Signals, which auto-deletes objects after 25 hours.**
- `broadcast-worker/wrangler.toml` — now binds `BROADCAST_BUCKET` → new
  `naluno-broadcast` bucket (no expiry rule), not `naluno-signal`.
- `broadcast-worker/index.js` — uses the new binding throughout; Broadcast
  keys now use a `b/` prefix (Signal keeps `u/`) so the two can never be
  confused again; playback is served from the Broadcast worker's own `/o/**`
  route instead of being proxied through the Signal worker.
- `js/broadcast-upload.js` — removed the silent fallback that rerouted a
  failed Broadcast upload to the Signal worker (and its bucket) with no error
  shown. A failed upload now retries the correct endpoint and fails loudly if
  that doesn't work, instead of quietly succeeding somewhere unsafe.
- `js/signal-core.js` (`resolveMediaUrl`, `nalunoPlayCandidates`) and
  `js/compat-lock.js` (`looksLikeVideoUrl`) — updated to recognize `b/`-
  prefixed keys and always route them to the Broadcast worker, never guessed
  onto Signal's.
- `broadcast-worker/migrate-broadcast-media.md` — one-time script + steps to
  rescue Broadcast videos already sitting in the ephemeral bucket before they
  age out, and update their Firestore `mediaUrl`.

### High

**`firestore.rules` — `/bands/{bandId}` update was open to any signed-in
user.** Scoped to the Band's creator, or to the exact fields real membership
actions touch (`memberUids`, `lastEmptiedAt`, `messageEpoch`, `bellAt`,
`bellBy`) — checked against every actual `.update()`/`.set()` call site in
`band-room.js` and `band-list.js` so no existing write path breaks.

**`js/core.js` — the `window.storage` shim's `get()` returned a bare string
instead of `{key, value}`.** Every call site in the app (`auth.js`,
`band-list.js`, `wireline.js`, `atmosphere.js`, `signal-core.js`) does
`const res = await window.storage.get(key); if(res && res.value){...}`. With
the old shim shape, `res.value` was always `undefined`, so demo Bands,
Wireline threads/voice notes, and the Callsign local-fallback still silently
failed to persist even though `storageAvailable` now read `true`. Fixed the
shim's return shape to match every consumer, verified with a round-trip
simulation (see below).

**`js/band-room.js` — Band "load older messages" pagination was fully
broken, in two independent ways:**
1. It referenced `currentBandId`, a variable never declared anywhere in the
   codebase — if it had ever actually run, it would have thrown.
2. `renderBandMessagesFromDocs`, the function it called to display the
   result, didn't exist.

Both fixed: corrected the variable to `activeBandId`, implemented
`renderBandMessagesFromDocs()` properly, and wired a scroll-to-top listener
on the messages panel so it actually triggers. Older pages are kept in a
separate buffer (`bandOlderMessages`) so they can't be wiped out by the live
message listener's normal overwrite-on-new-message behavior, deduped by
message id, and merged in with scroll-position preserved (loading older
messages doesn't jump the view to the bottom). State resets cleanly when a
Band room is closed so it can't leak into the next Band opened. Verified with
a merge/dedupe/ordering simulation (see below) — behavior for anyone who
never scrolls up is completely unchanged.

### Medium

**`js/calls.js` — redundant `zIndex` assignment in `showCallScreen`.** Was
set to `'200'` then unconditionally overwritten to `'300'` a few lines later
in the same call. Removed the dead first assignment; the final rendered value
is unchanged.

**`js/keep-alive.js`** — added an explanatory comment on the
increment/decrement pairing between `nalunoKeepAliveStart` and the
visibility-resume handler, so a future edit to either function doesn't
accidentally desync the depth counter. No behavior change.

---

## Already fixed before this pass (confirmed, not re-touched)

These were flagged in earlier review passes and were found already corrected
in the code you provided — verified, not modified further:

- Vault (`media-vault.js`) no longer revokes blob URLs still attached to a
  live `<video>` element; eviction is now last-*used*, not last-*inserted*.
- Broadcast media never enters the vault at all (`signal-core.js`,
  `bindMediaElement`) — plays directly from the network URL.
- The `urlIndex` off-by-one in the media error-recovery path is fixed —
  the correct primary URL is retried before any other candidate.
- Icon filenames (`icon-192.png` / `icon-512.png`) now match across
  `manifest.json`, `index.html`, and `sw.js`.
- Band message encryption is no longer computed and then discarded.
- The `crypto.js` doc comment now accurately describes that Wireline/Band
  text is plaintext-by-design, not silently mismatched from reality.
- The "you're live" notification pipeline now actually has a listener that
  dispatches to `handleBroadcastLiveNotification`.
- `sendPushToContact` is now defined.
- The camera resolution "climb" no longer has a dual-timer race that could
  downgrade an already-succeeded higher resolution.
- Signal auto-split now uploads the source video once per group and shares
  the result across all split parts, instead of re-uploading the full file
  once per part.
- `circle.js`'s `bumpTogaMonth` now uses a real Firestore transaction instead
  of a read-then-write, so concurrent views/joins can't silently lose
  increments.
- `broadcast-live.js` now unsubscribes a departed viewer's ICE listener
  immediately instead of leaking one permanent listener per viewer for the
  rest of a multi-hour host session.
- `profile.js`'s boot-time nav-state restore now only applies once
  (`_navRestoredOnce` guard), instead of running twice on every normal boot.
- `isNativeShell()` is still defined in both `auth.js` and `pwa.js`, but the
  two definitions are now identical, so the duplication is harmless. Left
  as-is rather than removing either copy, since both currently serve as
  working fallbacks for each other.

---

## How this was tested

Everything below was actually run, not just reasoned about:

1. **Syntax check** — `node --check` against every `.js` file in the app and
   both Workers. All pass.
2. **Firestore rules** — brace/paren balance check; structurally sound.
3. **`wrangler.toml`** — parsed with a real TOML parser to confirm validity.
4. **Broadcast Worker end-to-end simulation** — a Node harness with an
   in-memory mock R2 bucket drove the full `/b/init` → `/b/part` →
   `/b/complete` → `GET /o/**` flow (both full and Range requests), plus
   negative cases (unknown key → 404, cross-account key write → 403).
   Confirmed: uploads use the `b/` prefix, land only in `BROADCAST_BUCKET`,
   and the returned playback URL points at the Broadcast worker itself —
   never the Signal worker.
5. **Client-side URL routing simulation** — ran the real `resolveMediaUrl()`
   and `nalunoPlayCandidates()` functions against bare keys and full URLs for
   both buckets, confirming a Broadcast key can never resolve onto the
   Signal worker or vice versa.
6. **Band pagination simulation** — modeled the older-page load, a live
   message arriving mid-session, a second older page, and closing the Band
   room; confirmed no duplicate messages, correct chronological order, and
   that the older-messages buffer is cleared on close.
7. **`window.storage` shim simulation** — a Node-side `localStorage` mock
   confirmed `set()` → `get()` round-trips correctly, a missing key returns
   `null` (not throws), and `list()` returns prefixed keys — matching what
   every real call site in the app expects.
8. **Diff review** — confirmed the final change set touches only the 8 files
   (plus the new `broadcast-worker/` directory) actually intended, with no
   incidental changes anywhere else in the app.

## What still needs a human, outside this code

- **Create the `naluno-broadcast` R2 bucket in Cloudflare** and confirm it
  has no lifecycle/expiry rule, before deploying `broadcast-worker/`.
- **Run the migration** in `broadcast-worker/migrate-broadcast-media.md` for
  any Broadcast videos posted before this fix — they may still be sitting in
  the ephemeral bucket on borrowed time.
- Deploy `broadcast-worker/` (`cd broadcast-worker && npx wrangler deploy`)
  and publish updated `firestore.rules`.
