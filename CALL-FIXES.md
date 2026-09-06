# Calls — three real bugs found and fixed

A note first: I have treated `calls.js` as untouchable for this whole
project. You have now explicitly asked me to fix calls, so I have — but I
kept every change narrow and additive, and **`calls.js` is the only file
changed** (plus a service-worker cache bump so browsers pick it up).

## 1. Cold TURN cache → the call is STUN-only FOREVER

This is the big one, and it explains "sometimes doesn't go through".

`createPeerConnection()` builds the connection with `IceCore.now()` — the
**cached** TURN config if warm, **STUN-only** if not. That choice is correct
on its own: stalling the offer on a TURN fetch would make every call slow,
and the code says so.

What was missing is the other half. On a cold cache — the first call after
sign-in, or any call after ~25 minutes idle (the cache TTL) — the connection
was created STUN-only, and the TURN servers that `prewarmIceServers()` then
fetched were **never applied to it**. STUN-only fails on symmetric NAT, which
is most mobile carrier networks. That call could not connect, ever.

The existing `pc.restartIce()` recovery could not save it either: `restartIce`
re-gathers using the connection's *current* configuration — still STUN-only.
The recovery path was retrying the exact thing that had just failed.

Worse, `startCall()` already fetches ICE properly into `icePromise` (line
1611) and then deliberately throws the result away (`icePromise.catch(...)`).
The credentials were being fetched and discarded.

**Fixed** by upgrading the live connection when real TURN credentials arrive:
`setConfiguration(fresh)` then `restartIce()`. Non-blocking — the offer still
goes out immediately with whatever was available. Guarded so it only fires
while the call is still *trying* to connect, only when TURN was genuinely
missing and genuinely gained, and never on a closed connection. **A call that
is already connected is never touched.**

## 2. "Refuses to ring" — the incoming listener died silently

`startIncomingCallListener()` is started **once**, from `auth.js` on sign-in.
Its error handler was an empty function whose own comment read:

> `/* incoming calls just won't be detected this session */`

That is exactly what happened. One transient snapshot error — a network blip,
a token refresh, the phone sleeping and the stream closing — permanently
killed the listener. The person stays signed in, the app looks completely
normal, and their phone never rings again until they restart it.

That is also why this felt random and unreproducible: **nothing is broken at
the moment of the failed call.** Something broke minutes or hours earlier and
left no trace.

**Fixed** with re-subscription on backoff (1s → 30s cap, never gives up), plus
re-arming on `online` and on returning to the foreground — the two moments a
dead listener is most likely and most cheaply repaired. Re-arming checks
whether the listener is actually dead first, so a healthy one is never
double-subscribed, and it does nothing when signed out.

## 3. ICE candidate handlers threw after teardown

Four sites called `peerConnection.addIceCandidate(...)` on the global with no
null check. Firestore delivers a final batch as listeners detach, and
`peerConnection` is nulled on teardown — so calling `.addIceCandidate` on
`null` throws **synchronously**, which the trailing `.catch()` never sees. The
error escaped into the snapshot handler and aborted the rest of that batch.

All four guarded. Buffering behaviour is unchanged.

## Tests

22 assertions, all passing.

**14 functional**, including: cold cache upgrades and restarts; warm cache
does nothing; already-connected call is left alone; closed connection is a
no-op; a TURN fetch that returns no TURN doesn't trigger a pointless restart;
null/empty responses are safe; the listener retries after an error and resets
its backoff on success; and candidates still flow on a live connection.

**8 adversarial**, specifically trying to break the fixes: a call that
connects *before* TURN arrives is not disturbed; concurrent errors schedule
only one retry timer (no spin, no timer leak); the online/visibility re-arm
does not double-subscribe a healthy listener; and a signed-out user never
resurrects one.

## What I deliberately did NOT change

The offer/push ordering (already correct — the offer is written with the call
document *before* the push fires), the candidate buffering design, the ring
timeout, and every media/camera path. I also confirmed the live-video ICE
rules in `firestore.rules` are still intact, so nothing here regresses the
Broadcast live fix.

## Files

`js/calls.js`, `sw.js` (cache v146). No Firestore rules change, no worker
deploy.
