# naluno-call-notify (1.1.0-20261014a)

## 14 Oct 2026 (1.1.0-20261014a)
- Every alert kind is checked, and a missing record is refused (only an answer
  Google could not give still lets an alert through, so an outage never
  silences a real call):
  - call: the call exists, the sender is its caller, it is still ringing;
  - Band invite: the Band exists, the sender is in it, the receiver has the
    sender as a connection;
  - live: names its Broadcast, the sender created it, it is live, the receiver
    is a member, a connection, or in the sender's Circle;
  - Wireline: the receiver has the sender as a connection. (Any account could
    put any title and text on anyone's lock screen.)
- Lists (memberUids) are read from Firestore. They were read as nothing, so a
  Band invite from any member but the creator was refused.
- Live and Band alerts carry an Android notification, so they show when
  Naluno is closed (the Android app only builds its own screen for calls and
  dropped these).
- Push addresses are read from the private vault (users/{uid}/vault/main),
  where the app now keeps them; the public profile copy is being removed.
- Tests: `node --test call-notify.test.mjs` (12).

## Earlier (2026.08.27b)

## What it does
- Verifies caller Firebase ID token (soft-fail on Google outage)
- Prefers tokens passed by the caller; falls back to Firestore SA read
- Sends FCM to **every** distinct token (android, primary, web)
- Android/primary: **data-only** HIGH priority (killed-state CallMessagingService)
- Web: visible notification + deep link (`/?call=` for calls, `/?broadcast=` for live alerts)
- Retries once on 429/500/503, and once more with a fresh token on 401
- Caches Google OAuth access token ~1h
- Forwards the real event type the client asked for — does not relabel
  everything as a call

## Fixed 2026.08.27b
- **The FCM `data.type` field was hardcoded to `'incoming_call'` on every
  single push this worker ever sent — including "someone went live" alerts,
  which the client explicitly requests as `type: 'broadcast_live'`.** That
  field was silently discarded and overwritten, so every device-side
  handler — the native Android service and the web service worker alike —
  received something indistinguishable from a real incoming call, with no
  real call behind it to resolve (no matching `calls/{callId}` document, a
  synthetic `callId` like `live-<broadcastId>`). This is the most likely
  reason "went live" push notifications weren't arriving at all: a handler
  built to treat this as a genuine call has nothing real to find. Now
  forwards `payload.type` as-is, defaulting to `'incoming_call'` only when a
  request doesn't specify one (existing call requests already send it
  explicitly, so real calls are unaffected). Web pushes for a non-call type
  also now correctly de-escalate — no `requireInteraction`, no `renotify`,
  and the deep link goes to `?broadcast=<id>` instead of a fake `?call=` id.

## Fixed 2026.08.27a
- Removed a dead network call on every single request (`accounts:lookup?key=unused`
  — always fails, its result was never even read). Pure wasted latency on the
  critical path of waking someone's phone; verification already runs for real
  via `tokeninfo` right after it.
- A 401 mid-send (cached Google token expired right as a call came in) used to
  only invalidate the cache for the *next* notify — the current, most
  time-critical wake attempt just failed outright. It now gets a fresh token
  and retries once, in the same request.
- The two follow-up "pulses" for web tokens (2.2s + 3.5s apart) used to run
  inline before the worker replied at all, so a call to a person with both an
  Android and a Web token could sit waiting 6+ seconds for a response even
  though the phone had already been notified almost instantly. They now run
  in the background via `ctx.waitUntil()` instead of delaying the reply.

All fixes were verified with a simulation harness using a real generated RSA
test key (so the actual JWT-signing path was exercised, not stubbed around).
The 2026.08.27b fix was specifically verified two ways: a real call request
(explicit `type: 'incoming_call'`) still arrives tagged as a call, and a
`broadcast_live` request now arrives tagged correctly instead of being
silently relabeled — both for Android (data-only) and web (visible
notification, with the de-escalated non-call styling and the correct deep
link).

## Secrets
```bash
npx wrangler secret put GOOGLE_CLIENT_EMAIL
npx wrangler secret put GOOGLE_PRIVATE_KEY
npx wrangler secret put FIREBASE_PROJECT_ID   # naluno-28a00
```

## Deploy
```bash
cd call-notify-worker
npx wrangler deploy
```

## Health
GET https://naluno-call-notify.naluno.workers.dev/
→ `{ ok, hasEmail, hasKey, version: 2026.08.27b }`

## Required GCP
1. Enable FCM API: https://console.cloud.google.com/apis/library/fcm.googleapis.com?project=naluno-28a00
2. Service account role: Firebase Cloud Messaging API Admin

## One important caveat, honestly stated
This fix ensures the *worker* forwards the real event type correctly, and
that the *web* service worker (already updated to branch on it) behaves
correctly. Naluno's native Android shell almost certainly has its own
`CallMessagingService`-style handler for these data-only pushes — its source
isn't part of this package, so its exact behavior on receiving a
`broadcast_live`-typed message (versus the `incoming_call` it was presumably
only ever tested against before) couldn't be verified here. If "went live"
pushes still don't arrive on Android after deploying this, that native
handler is the next place to check — it may need a small update to treat
`type !== 'incoming_call'` as a normal notification rather than discarding
anything that isn't a recognized call shape.

