# Naluno — Build Log

Living reference for anyone (including a future Claude session) picking this project
back up. The actual files are the source of truth — this is the map, not the territory.

## What Naluno is
A mobile-first messaging/calling app built as a single HTML file (`index.html`) with
Firebase as the backend. Core philosophy: presence should be computed from real
activity, not declared. "A statement from the future, not another WhatsApp."

## Live infrastructure (all real, all deployed)
- **Hosting:** GitHub Pages — `nolegoafrica/Naluno`, live at `getnaluno.com` (connected via Cloudflare)
- **Firebase project:** `naluno-28a00` (Spark/free plan — Blaze deliberately declined)
- **Cloudflare account:** used for four Workers, all live
  - `naluno-signal-upload` — video storage for Broadcast (R2 bucket `naluno-signal`)
  - `naluno-call-notify` — push notifications for incoming calls (FCM via a signed
    Google service-account JWT)
  - `naluno-turn-credentials` — real TURN relay credentials (Cloudflare Realtime),
    the actual fix for calls that connected but showed no video/audio between
    devices on different networks
  - `naluno-compass` — powers the Compass AI companion tab (Cloudflare Workers AI,
    free daily allowance)

## Core systems, current state
- **Real WebRTC calls** — Firestore signaling, ICE candidate exchange, composited
  border+camera video sent (not raw camera). Double-tap re-entrancy guards on
  start/accept/retry. 1440p capture (tuned down from 4K for speed/lag reasons).
- **Wireline (DMs)** — real-time Firestore messages, voice notes, mood cards,
  reactions, read receipts. Real E2E encryption for text (ECDH P-256 + AES-GCM,
  private key in IndexedDB, verified against Node's real WebCrypto).
- **Offline message queue** — composes/queues while offline, auto-sends the moment
  connectivity returns. Checks `navigator.onLine` *before* attempting a Firestore
  write, not after — critical, because Firestore's offline persistence makes a write
  hang pending rather than reject when offline.
- **Broadcast (Signal)** — 25-hour ephemeral posts. Video goes to R2 (not Firestore,
  which caps at 1MB) via the signal-upload Worker. Real object lifecycle rule
  auto-deletes files after 1 day.
- **Call notifications** — Worker signs a real JWT with a Google service account,
  exchanges for OAuth, reads the callee's FCM token from Firestore, sends a data-only
  push (not `notification`-payload, which bypasses custom handling). Repeats every 5s
  for ~30s while ringing, stops cleanly on answer/cancel/timeout.
- **Offline app shell** — service worker now actually caches the app shell
  (previously did nothing), so Naluno opens looking like itself when offline instead
  of the browser's blank error page. Scoped to never touch Firestore's own real-time
  traffic.
- **Video trim/split** — real audio confirmed working as of tonight, after two failed
  patches led to a full architectural rewrite: replaced canvas.captureStream() + a
  hand-rolled Web Audio mixing graph with the browser's native video.captureStream()
  (captures audio+video together by design). 2-minute segments, real bitrate control
  (~3.2Mbps video/96kbps audio, keeps output safely under the 60MB upload cap
  regardless of source encoding), background-processable (composer closes
  immediately, a persistent progress banner tracks real progress while the person can
  use the rest of the app), and fully resilient to an interrupted browser session (the
  original file + exact trim selection persist in IndexedDB, offered back as a resume
  prompt on next sign-in). One user-reported issue still open: see "Known open items."

## Scaling roadmap — technical debt to pay down before real growth
Written after the first real scaling bug (see below) prompted the question "how do we
stay fast at hundreds of thousands of users." Honest answer: that's a different regime
from anything built so far, not a bigger version of the same thing. This is the running
list of what to actually address, in rough priority order, **before** it's urgent —
not a todo for right now at ~20 users.

- **Firestore's per-connection query pattern is the single most important item here.**
  The scaling bug just fixed (see "Known open items" below) was papered over with a
  debounce — real, meaningful at current scale, but the underlying pattern (one
  separate query per connection) still exists and would become a genuine bottleneck
  again at real scale (hundreds of connections firing hundreds of parallel queries on
  every real refresh). The real fix is a Firestore collection-group query instead of N
  separate ones — requires adding an explicit owner field to all future signal posts
  (won't help existing data) and a new Firestore composite index. Worth doing well
  before this becomes painful again, not after.
- **"Free" stops being the goal at real scale, on purpose.** Every architecture
  decision tonight optimized for zero cost at low volume, correctly. At real scale the
  goal shifts to "spend efficiently, not wastefully" — Firestore's free tier would be
  consumed in minutes of real activity at hundreds of thousands of users, and that's
  an expected, normal cost of a real product, not a problem to engineer around.
- **The Cloudflare-hosted pieces (R2, the four Workers, TURN) scale without needing
  architectural changes** — same infrastructure Cloudflare runs its own global traffic
  on. This is a genuine advantage of having built on Cloudflare rather than smaller
  platforms; these don't need to be revisited for scale, only paid for as real
  usage-based cost instead of free tier.
- **Two costs that scale directly with real usage, not with code quality:** TURN
  relay bandwidth (only used when a direct connection fails, but at volume even a
  modest failure rate becomes real bandwidth cost billed per GB), and Compass's AI
  usage (the free daily Neuron allowance is shared across every Naluno user combined —
  at real scale this becomes a genuine variable cost tied directly to how much people
  actually talk to it, likely the single most cost-sensitive feature in the app).
- **Real observability needs to exist before real scale, not be built reactively
  after something breaks.** Right now "is something wrong" has meant manually opening
  DevTools together during a live debugging session. That doesn't work at real
  volume — needs actual Firebase usage dashboards under regular watch, and real error
  tracking that surfaces problems before users report them.
- **Moving off the Spark (free) plan should be a deliberate, planned decision when
  it happens** — not another surprise mid-deploy the way the Blaze prepayment nearly
  was. Worth deciding this consciously, ahead of time, once real growth actually
  calls for it.

## Known open items / current state
- **Broadcast video: brief static thumbnail visible before real playback begins,
  with audio starting ahead of the video.** Reported by user, not yet diagnosed —
  the thumbnail feature (`thumbDataUrl`) is confirmed used only in the ring preview
  (`renderBroadcasts`), NOT anywhere in the actual playback viewer (`playSegment`) —
  no `poster` attribute exists anywhere in the codebase, so the mechanism isn't yet
  understood. Needs a closer look at what actually renders in the moment between
  tapping the ring and real video playback starting.
- **Call regression under investigation:** user reports the caller sees/hears
  themselves but never sees or hears the other person. Re-read the entire call
  connection code (createPeerConnection, ontrack, ICE handling) end to end — it is
  byte-for-byte unchanged since the version the user confirmed working with real
  TURN relay. Nothing else built later in the session (Compass, the scaling fix)
  touches call code at all. Waiting on fresh console logs from a real test — the
  same `[call]` diagnostic logging from the TURN investigation is still in place and
  should reveal what's actually happening this time, since this can't be diagnosed
  by reading code that's already confirmed correct.
- User's original, long-held ask: **real background replacement/blur** (Zoom/Meet
  style, not the current border+camera composite). Important context: this was
  already attempted **five times earlier in this project** and abandoned each time
  due to ghosting artifacts. Technically possible in a browser (Meet itself is a web
  app), unlike the hard platform walls — but a genuinely harder, riskier problem than
  anything else in this log, with a real track record of failing. Treat as its own
  dedicated, carefully-scoped attempt, not something to fold into a batch of smaller
  fixes. Not yet started.
- The Compass "Personalisation Permission" system (reading Wireline/Bands/Broadcast
  with consent), action-taking, and visual generation are all deliberately deferred —
  v1 Compass is conversational only, see its own section above.


## Deferred by deliberate choice, not forgotten
- **Bluetooth / Wi-Fi Direct / true offline mesh** — impossible from a website, full
  stop; no browser exposes this to any web page. Needs the Android shell (native).
- **Full-screen lock-screen incoming-call UI** — same hard wall, needs
  `USE_FULL_SCREEN_INTENT`, native-only.
- **Android Shell** — full architecture locked (Capacitor-style wrapper, Naluno Core
  stays the web app unchanged, native bridge for OS-only capabilities). Not started.
- **Custom notification sound** — confirmed impossible on web push, removed from the
  entire W3C standard in 2018. Real workaround: user can change Chrome's own
  notification sound via Android system settings (not Naluno-specific).

## Working conventions worth preserving
- Every JS change gets validated: syntax check, brace-balance check, dangling
  `$('id')` reference check, and a real Node execution harness run before shipping.
- Crypto/signing code gets *proven*, not just reasoned about — real keys generated,
  real round-trips tested, wrong-key/tamper cases checked too.
- Secrets (Firebase service account, etc.) are never written to any file — only ever
  set via `wrangler secret put`, piped from a local file rather than pasted
  interactively (interactive multi-line paste has repeatedly failed in this user's
  Windows Terminal — always use `type file.json | npx wrangler secret put NAME`).
- Big, delicate features (E2E encryption, Android shell, background replacement) get
  their own focused pass rather than being folded into a batch of smaller fixes.
