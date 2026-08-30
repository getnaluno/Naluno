# Naluno — Full Repository Audit (cloned from getnaluno/Naluno)

This is a different kind of pass from the earlier rounds: rather than
iterating on a local working copy, the actual live GitHub repository was
cloned directly (`git clone https://github.com/getnaluno/Naluno.git`),
confirmed current via its latest commit, and read line by line — including
the native Android shell (Java + manifest), which had never been visible
before this session. A huge amount had changed independently since the
previous rounds (the live `sw.js` was at cache version v115, versus v90
locally — a real, substantial gap), so this treats the clone as the source
of truth throughout.

`js/calls.js` is confirmed byte-identical to the very first version from
this entire project, in the live repository, at the end of this session.

## Real bugs found and fixed

### 1. Spark (in-person Callsign swap) was completely broken

**File:** `firestore.rules`

The `sparks/{code}` document's `update` rule only ever permitted the
**host** to write to it. But claiming a Spark is fundamentally a **guest**
action — `joinSparkCode()` has the person who scanned/entered the code
update the document with their own `guestUid`, which this rule always
rejected (a guest's uid can never equal the host's). The failure was caught
by an empty `try/catch` in `spark.js`, so the guest saw "Spark complete" and
moved on while the host's own listener — the entire reason their screen
exists — never fired, leaving them stuck indefinitely with no indication
anything had gone wrong.

Fixed to let a guest claim an *unclaimed* spark with their own uid, and also
fixed the silent failure in `spark.js` so any residual failure surfaces
honestly instead of claiming success. **A second, adversarial pass on this
same fix** then found a real tightening gap: the fix checked the *values* of
`guestUid`/`hostUid` correctly but never restricted *which fields* a
guest-claim update could touch — a claiming guest could have smuggled
changes to `hostName`, `hostColor`, or `expiresAt` into the same write.
Scoped to exactly the four fields the real client code sends. Verified with
simulations at both stages: 6 cases for the original fix (the real bug case,
the host's own updates unaffected, four negative/security cases), then 6
more for the tightened version (the legitimate claim still works with the
exact real payload, three tampering attempts all correctly blocked, existing
security cases re-confirmed).

### 2. Voice notes in Spark never actually sent — a definite crash, every time

**File:** `js/spark-page.js`

`stopSparkVoice()` nulls the recorder variable immediately after calling
`.stop()` — but `.stop()` is asynchronous, and the `onstop` handler (which
builds the blob, uploads it, and sends the message) read
`sparkVoiceRec.mimeType` from that now-null variable. Reproduced the exact
`TypeError` in a simulation before touching anything, fixed by using `this`
inside the handler (correctly bound to the MediaRecorder instance regardless
of what the outer variable now points to, standard behavior for a
non-arrow function assigned to an `on*` handler property), then re-ran the
simulation to confirm the crash is actually gone.

### 3. A real, native-Android security exposure

**Files:** `AndroidManifest.xml`, `BeaconFindService.java`

Found while reading the native Android shell — visible for the first time
this session. `MainActivity.java`'s JavaScript bridge accepts and persists a
Firebase **refresh token** — a long-lived credential good for indefinite
re-authentication until explicitly revoked — into plain, unencrypted
`SharedPreferences`. Combined with `android:allowBackup="true"`, the token
could be extracted via `adb backup` with no root required. Fixed both
halves: `allowBackup` set to `false`, and all 5 read/write sites in
`BeaconFindService.java` migrated to Android's Keystore-backed
`EncryptedSharedPreferences`, with a logged (not silent) fallback if a
device's Keystore genuinely can't provide it. Honestly caveated: this repo
holds Android source files but not the Gradle project itself, so this
couldn't be compiled — it needs `androidx.security:security-crypto` added
wherever the real build config lives, and a real build to confirm.

### 4. A wake-lock race condition

**File:** `js/keep-alive.js`

Traced through a "deliberately tricky, documented as correct" pattern rather
than trusting its own comment. The wake-lock refresh-on-resume logic nets
its counter to zero via a bare decrement — but if the real upload/call
legitimately finishes while that refresh is still awaiting
`wakeLock.request()`, the deferred decrement could bring the counter to
zero without ever running the actual release logic (only the real
`nalunoKeepAliveStop()` does that). The wake lock — and the native
foreground keep-alive service — could then run indefinitely after every
legitimate reason for it had ended. Simulated the exact race before fixing,
confirmed the fix resolves it while leaving the normal case unchanged.

### 5. A half-built feature: "someone is live" alerts couldn't be tapped

**Files:** `js/core.js`, `js/notifications.js`

`handleBroadcastLiveNotification()` explicitly checked whether a
`broadcastId` and `openBroadcastById()` were available — specifically to
decide whether navigation was possible — then never actually navigated
anywhere; the base `toast()` had no way to be tapped at all. Added an
optional, fully backward-compatible tap handler to `toast()` (verified
against all ~290 existing call sites via simulation — untouched, and a
stale handler from an earlier tappable toast correctly can't leak into a
later plain one) and wired it through.

### 6. The same gap, missed entirely on native Android

**File:** `js/pwa.js`

The native Capacitor foreground push listeners only ever checked for
`callId` — a "went live" push (which carries `broadcastId`, not `callId`)
was silently dropped both when the app was open and when someone tapped the
notification from the tray. The web service worker already handled this
correctly (from an earlier round); the native listeners never had the
equivalent. Wired both to the same tappable-toast/navigate behavior already
used elsewhere.

### 7. The Toga photo-fetch cost (flagged in an earlier round, fixed this one)

**File:** `js/circle.js`

Every `renderTogaBoard()` call fetched each of the top-10 creators' photos
fresh from Firestore, with no caching — 10 reads on every single render.
Added an in-memory cache (not cleared on sign-out, since this holds public
creator data, not anything viewer-specific). Verified with a simulation:
first render does 10 reads, every re-render after that does zero, a
genuinely new creator entering the board triggers exactly one new read.

## New capability: Spark-LG self-teaching and verified online lookup

**Files:** `js/spark-lg.js`, `index.html`, `css/app.css`

Given real people use Spark for live, in-person conversation, this was
built with real safeguards throughout rather than anything that could
quietly fabricate a plausible-sounding but wrong translation:

- **Compositional learning, grounded only in what's actually taught.** When
  someone teaches a new full sentence, `sparkLgExtractNewFragment()` checks
  whether an already-confirmed shorter phrase appears on *both* sides of it.
  If so, what's left over after removing that known phrase is a genuine new
  atomic unit the teacher effectively taught without realizing it — e.g.
  teaching "I am going home" while "I am going" → "Ŋŋenda" is already known
  correctly extracts "home" → "eka". Never a guess. Verified with 5
  scenarios including four deliberately adversarial safety cases (no
  overlap, comparing against itself, the Luganda side not actually
  containing the known translation, an already-known fragment) — all
  correctly refuse to extract anything when the evidence doesn't genuinely
  support it. Surfaced as a tappable follow-up (reusing the toast tap
  feature above) rather than auto-saved.
- **Real, verified online lookup — not a fabricated integration.** Before
  writing any code, researched and confirmed PanLex (panlex.org) is a real,
  purpose-built lexical translation database with a documented public API,
  pulled their own worked query example, and confirmed Luganda's exact
  identifier (`lug-000`) against the ISO 639-3 registry rather than assuming
  it. Results are never auto-added to the book — they're surfaced with
  PanLex's own quality score plus a Wiktionary cross-reference link, for the
  same gated human teacher to review and explicitly accept, the identical
  trust boundary the book already had for anything typed in by hand.
  **Honestly stated limit:** this environment's network access couldn't
  make a live call to PanLex's API to verify the exact response end-to-end,
  so this is built correctly against their own documentation with defensive
  error handling, not confirmed against a live response — and PanLex's CORS
  policy for browser-origin requests wasn't verified either; if it doesn't
  allow cross-origin calls, this fails silently and gracefully into "no
  results" rather than breaking anything.

## Reviewed and confirmed sound, no changes needed

`broadcast-space.js`'s new fullscreen-landscape feature (referenced
functions all exist; a new Strand step-navigation function correctly avoids
an index-lookup bug found in an earlier round's own code), `strand.js`'s
scroll-triggered video preview system (correctly disconnects its old
`IntersectionObserver` before creating a new one), `spark-engine.js`'s
translation fallback chain, `data.js`, `compat-lock.js`, `profile.js`,
`band-list.js`, a sweep for loose-equality bugs across the whole codebase
(all 29 hits were the safe `== null` idiom), and a duplicate-ID check across
all of `index.html` (none found).

## Round 2 — three reported issues scrutinised, plus the Community feature

### 1. Signal stops working before the chosen number of days — ROOT CAUSE FOUND, NOT FIXABLE FROM THIS REPO

**Not a code bug.** The composer offers 24 hours / 3 days / 7 days
(`index.html` ttl-chips → `signalTtlChoice` → `signalTtlMs()`), and
Firestore stores and honours that choice correctly. But the R2 bucket the
video files live in has a hard, server-side object lifecycle rule that
**deletes every file after 25 hours** — stated explicitly in this codebase's
own comments in two separate places (`signal-core.js` line 27,
`broadcast-upload.js` line 11). So a Signal set to 3 or 7 days keeps
existing in Firestore, and keeps appearing in the strip, while its actual
video file is deleted at ~25 hours. This is the same 25h lifecycle rule that
caused the earlier "Broadcast videos die after about a day" bug, now
surfacing in a different feature.

**This could not be fixed from the repository** — the signal-worker isn't in
it (deployed separately), and the fix is a Cloudflare R2 bucket
configuration change, not code. Two viable options, both requiring action
outside this package:

- **Preferred:** extend the `naluno-signal` bucket's lifecycle rule to 7
  days (168h), so storage outlives the longest option the UI offers.
- **Alternative:** remove the 3-day and 7-day chips from the composer, so
  the UI stops promising a duration the storage layer can't keep.

Deliberately not "fixed" in code by silently capping the UI at 24h — that
would hide a real infrastructure mismatch rather than resolve it, and the
3-day/7-day options are presumably wanted.

### 2. Strand share bar leaking into the Toga page — FIXED

**Files:** `js/signal-ui.js`, `js/strand.js`

`nalunoSetBcastView()` (the For You / My Broadcasts switch) resets the
scroll position and tears down the search UI when switching, but never
cleared the open Strand folder. A Strand belongs to one creator's specific
set of Broadcasts and has no meaning in the other view — so swiping while
inside one left `openStrandFolderId` set and `#bcastStrandBar` still
`display:flex`, bleeding its title and share button into a view it doesn't
belong to, sitting directly above the Toga panel. Exactly what was
reported.

Fixed with a new `clearStrandFolderState()` — a state-only reset that
deliberately omits the re-render `closeStrandFolder()` does, because the
caller already re-renders a few lines later and a duplicate render
mid-switch is precisely what causes a visible flicker. Verified with three
simulated cases: the reported bug (state cleared, bar hidden, exactly one
render), a normal swipe with no strand open (completely unaffected), and a
same-view call (early return preserved, an open strand not clobbered).

### 3. "This Broadcast" views not adding up to "All of yours" — CONFIRMED REAL, FIXED

**Files:** `js/broadcast-core.js`, `js/broadcast-space.js`

The suspicion was correct. "This Broadcast" reads each Broadcast's own
`views` field; "All of yours" reads `toga/{creator}.viewsTotal`, a
cumulative counter incremented once per view. `deletePermanentBroadcast()`
soft-deletes a Broadcast — removing its views from anything summing the
surviving ones — but never decremented `viewsTotal`, leaving those views
permanently baked into the total. After any deletion the two numbers
diverged permanently, with no way to ever reconcile.

Fixed by subtracting the deleted Broadcast's view count from `viewsTotal`
at delete time (skipped entirely when the count is zero, avoiding a
pointless write), plus a `Math.max(0, …)` floor on read so any total already
driven negative by historical deletions can never render as a negative view
count. Verified with a simulation showing the old behavior diverging
(20 vs 32) and the fix reconciling exactly, plus both edge cases.

### 4. NEW: Community — who joined this Circle

**Files:** `js/broadcast-space.js`, `js/circle.js`, `index.html`,
`css/app.css`

The Community cell in the Impact dashboard is now tappable and opens a sheet
listing everyone who has joined that creator's Circle, with their photo and
name. Tapping a name opens that person's Broadcasts (reusing the existing
`openCreatorTogaBroadcast()`, which already handles the case where their
most recent Broadcast isn't in the local feed).

Built to the "only comes to life when tapped" requirement literally: the
member list is **never** fetched as part of the dashboard's own render
(which runs on every Broadcast open) — it loads only on tap. It reuses the
same photo cache the Toga board fills, so repeat opens usually cost zero
reads. Falls back to the Broadcast's own `memberUids` when the circle
subcollection is empty or unreadable, since those are real joins too.
Confirmed `users/{uid}/circle/{memberUid}` already allows any signed-in user
to read, so **no Firestore rules change is needed** for this feature.

**The adversarial pass caught two real bugs in this new code before it
shipped:** `togaPhotoSrc()` checked only `r.id`, but Circle member rows key
the person by `r.uid` — meaning the signed-in person's own photo would
silently never have rendered in the list (fixed to accept either shape);
and the name-resolution loop would have thrown if `fbDb` were unavailable
(fixed with an explicit guard). Also removed a redundant duplicate cache
branch found in the same review. Verified with five simulated scenarios
including three adversarial ones (offline, empty circle with fallback, both
empty).

## Round 3 — the Signal expiry stopgap, and the worker latency fix

The signal-worker source turned out to still be available from earlier in
this project, which allowed both remaining items to be closed properly.

### Signal expiry — worker source confirmed the diagnosis, UI capped as a stopgap

**Files:** `index.html`, `js/broadcast-core.js`, `signal-worker/` (added)

Reading the actual worker source settled the diagnosis completely: it writes
objects with `httpMetadata` and `customMetadata` only, sets **no expiry or
TTL of its own**, and contains no delete logic or scheduled cleanup
anywhere. So the 25-hour deletion is entirely the `naluno-signal` R2
bucket's own lifecycle rule — exactly as the client-side code comments
claimed. **There is no code fix**; the bucket configuration is the only
lever.

As a stopgap so the app stops promising what storage can't keep: the 3-day
and 7-day chips are removed from the composer, and — importantly — the cap
is *also* enforced in code via `SIGNAL_TTL_MAX_HOURS`, not just by hiding
the chips. Hiding UI alone wouldn't stop a stale cached page or an old saved
preference from still carrying 72 or 168. Verified with a simulation: 72 and
168 both correctly clamp to 24, garbage and null fall back safely, and
raising the one constant to 168 restores full behavior.

Both the removed chips and the constant carry comments pointing at
`signal-worker/README.md`, which documents the exact three-step restore
(extend the bucket rule to 168h → raise the constant → uncomment the chips)
along with the storage-cost tradeoff worth weighing first (R2's free tier is
10 GB; 7-day retention means roughly 7× the concurrent stored volume).

### Worker: per-request token verification latency

**File:** `signal-worker/index.js`

`verifyFirebaseIdToken()` made a blocking round-trip to Google's
`identitytoolkit` endpoint on **every single request** before accepting a
byte — real latency on the critical path of posting a Signal, repeated for
every chunk of a chunked upload from the same person. Added a short-lived
in-isolate cache of successful verifications.

Deliberate safety properties, each one a decision rather than an oversight:
a 5-minute window, far below a Firebase ID token's own ~1h lifetime, so a
revoked token can't keep working long; **failures are never cached**, since
caching a rejection could lock someone out after a legitimate re-auth and no
latency win justifies that; keys are SHA-256 hashes rather than raw tokens,
so credentials aren't sitting in memory as map keys; scoped per-isolate (a
plain `Map`, not KV) since it's purely a latency optimization with no shared
state to go stale; and bounded at 500 entries so a long-lived isolate can't
grow it without limit.

Verified with 15 simulated cases: the latency win (10 uploads → 1 Google
call), different users never confused with each other, genuine TTL expiry
forcing re-verification, rejected tokens never cached, a previously-failing
token not getting stuck, the memory bound holding under 550 distinct
tokens, and raw tokens never appearing as cache keys.

Added `signal-worker/wrangler.toml` and `README.md` so the worker is
actually deployable from the repo, with the R2 lifecycle caveat documented
prominently (wrangler.toml can't express lifecycle rules — that's dashboard
only).


`AndroidManifest.xml`, `BeaconFindService.java`, `css/app.css`,
`firestore.rules`, `index.html`, `sw.js`, and in `js/`: `broadcast-core.js`,
`broadcast-space.js`, `circle.js`, `core.js`, `keep-alive.js`,
`notifications.js`, `pwa.js`, `signal-ui.js`, `spark-lg.js`,
`spark-page.js`, `spark.js`, `strand.js`. Plus `signal-worker/` (index.js, wrangler.toml, README.md) added to the repo. `js/calls.js` untouched —
confirmed byte-identical to the original package.
