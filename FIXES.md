# Three fixes — vibes, sign-out on refresh, background calling

Cloned from `ed4582d` (2026-09-06). My earlier call fixes are already live in
that commit and are untouched here.

## 1. Vibes sent twice

`sendRealMessage()` already has a `clientMsgId` dedupe, but that protects
against **its own retries**. Each tap generates a *new* id, so two separate
invocations look like two genuinely different messages and sail straight
through — which is why the duplicates in your screenshot have the same
timestamp but both persisted.

The double invocation comes from the tap itself: a `click` handler on a touch
device can fire twice (the synthetic click following `touchend`, or a fast
double-tap landing before the picker finishes hiding). Hiding the picker first
did not help because both events were already queued in the same frame.

**Fixed** with a short re-entrancy latch: the same feeling to the same person
cannot be sent twice within 1.5s. Deliberately keyed on mood+contact rather
than a global lock — verified that two *different* feelings sent 100ms apart
both go through, the same feeling to two different people both go through, and
a deliberate resend after 1.6s works.

## 2. Some devices sign out on refresh

`setPersistence(LOCAL)` is backed by IndexedDB. When IndexedDB is unavailable
— private/incognito mode, storage pressure, some Android WebViews, partitioned
site data — that call **rejects**, and the old code only logged a warning and
carried on. Firebase then falls back to in-memory state, so the sign-in lives
exactly as long as the page does: every refresh looks like a fresh start.

That is why it hit "some devices" and looked random. It depends on the storage
environment, not on anything the person did.

**Fixed** to degrade in steps instead of falling straight to nothing:
**LOCAL → SESSION** (survives a refresh, dies with the tab) **→ in-memory** as
a last resort. Each outcome is recorded so Diagnostics shows which is actually
in force rather than leaving it a mystery. Confirmed an explicit sign-out
still signs out at every level — the fallback cannot resurrect a session.

## 3. Background calling works, then suddenly stops

**This is the root cause, and it matches the symptom exactly.**

The web push token was written to Firestore **once, at sign-in, and never
looked at again**. FCM web tokens are not permanent — they rotate when the
browser updates, when the service worker is replaced, when push subscriptions
reset, or after long inactivity. When that happens the stored token is dead.
The call-notify worker keeps sending to it, FCM keeps accepting the request,
and the phone simply never rings again, with nothing failing visibly anywhere.

No action from the person, no error to point at, works-then-stops. Exactly
what you described.

**Fixed** with a keep-fresh routine. `getToken()` always returns the *current*
token, so re-registering is all that is needed. It runs on returning to the
foreground and on reconnect, and rewrites immediately if the token has
rotated, regardless of throttle — a stale token means the phone cannot ring,
which is worth a write straight away.

Cost is controlled: verified **50 foregrounds in an hour produce zero writes**
when the token is unchanged, and a full day of normal use produces **3**. It
skips entirely when signed out, on the native shell (Capacitor owns that
path), or without notification permission.

## Tests

21 assertions, all passing — 11 functional, 10 adversarial specifically trying
to break the fixes: the vibe latch not blocking legitimate rapid sending, the
persistence fallback not masking a real sign-out, and the push refresh not
hammering Firestore.

## Honest limit on background ringing

These fixes repair the *delivery* path. A backgrounded browser tab still
cannot play a continuous custom ringtone — the service worker can show a
high-priority notification with vibration and Answer/Decline (which `sw.js`
already does), but sustained audio from a background tab is not something a
web app is permitted to do. Full ring-through-the-lock-screen behaviour is
what the Capacitor `IncomingCallActivity` path exists for. Worth knowing so
the expectation matches what the platform allows.

## Files

`js/wireline.js`, `js/auth.js`, `js/notifications.js`, `sw.js` (cache v148).
No Firestore rules change, no worker deploy.
