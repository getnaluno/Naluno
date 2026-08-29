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

## Full list of files touched this session

`firestore.rules`, `js/circle.js`, `js/keep-alive.js`, `js/core.js`,
`js/notifications.js`, `js/pwa.js`, `js/spark.js`, `js/spark-page.js`,
`js/spark-lg.js`, `index.html`, `css/app.css`, `sw.js` (cache version
bump), plus native files `AndroidManifest.xml` and
`BeaconFindService.java`. `js/calls.js` untouched — confirmed byte-identical
to the original package.
