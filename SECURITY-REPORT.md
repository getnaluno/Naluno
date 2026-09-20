# Naluno security report — 20 September 2026

Threat model you asked for: **an attacker has the complete frontend and can send requests to every endpoint by hand.** Hiding a button, a URL, or a tab does not count as security. Only authentication, authorisation and validation on the server count.

This is a source-and-rules audit of the live product (Firebase project `naluno-28a00`, GitHub Pages at getnaluno.com, Cloudflare Workers). Production Firebase was not attacked from this environment.

---

## Verdict

Naluno is **not** an open database. Money, contribution points, trust scores, Wireline ciphertext, Compass notebooks, Find-Naluno pins, and operator mail are locked on the server.

It is **not** yet safe against a signed-in attacker with the source unless the new `firestore.rules` are published. **GitHub Pages does not apply rules. You must run `firebase deploy --only firestore:rules`.**

Broadcast videos were not touched. Playback URLs (`/o/…`) stay as they are so every existing Broadcast keeps playing.

---

## What is protected (server-side)

| Surface | How it is enforced |
|---|---|
| Desk powers | `isOperator()` — uid **or** Firebase custom claim `operator: true`. Not the password screen, not `/admin` |
| Contribution / trust / payouts | Client writes denied. Points computed in the worker |
| Wireline drops | `from` / `to` bound to the signer |
| Compass notebook | Owner only |
| Find Naluno beacons | Owner write; owner or operator read |
| Calls | Caller/callee only. Uids frozen on update |
| Broadcast / Signal create | Must stamp your own uid |
| Closed Callsign | Owner cannot write once closed |
| R2 upload | ID token. Key is `u/{yourUid}/…` |
| Ad meters / Toga scores | +1 per write. Others cannot rename a Toga row |
| Band invites / mesh / posts | Members or creator |
| Spark room messages | Participants only |
| Reports | Reason required in rules |

---

## This pack (19d) — leftover work that does not break the app

| Change | Why it is safe for current videos and calls |
|---|---|
| Members can **get** a known `users/{uid}` but cannot **list** the whole collection | Names and photos for Frequencies / Spark / Toga still load. A rewritten client can no longer dump every recovery email and token in one query |
| Handles and Spark codes: get, not list | Looking up `@nova` still works. Listing every Spark code does not |
| Private **vault** (`users/{uid}/vault/main`) for recovery email, Compass lock, E2E backup, desk password | On next sign-in those fields move off the public profile. Call wake **tokens stay public** so the current call-notify worker still rings a closed phone |
| Website pulse: known fields only; visit counters +1 | Analytics still write. An attacker cannot invent arbitrary counters or jump visits by a million |
| Operator custom claim | Additive. The hardcoded uid still works if the stamp fails. Desk does not lock you out |
| **Not done:** signed playback URLs | Would break every existing Broadcast file in the feed |

---

## Still open (honest)

1. A member who already knows a uid can still `get` that public profile, including FCM tokens, until call-notify looks tokens up server-side (worker source is not in this repo).
2. Website pulse is still unauthenticated. App Check would kill analytics until you enrol reCAPTCHA in Firebase — left off on purpose.
3. Desk password is still a screen lock. Steal the operator Google session and the SDK is enough.
4. Media `GET /o/**` is still public if the URL leaks. Required for in-feed video.

---

## How this pack was tested

| Test | Result |
|---|---|
| `js/firestore-rules.test.cjs` (19c + 19d contracts) | Pass |
| Economy worker 23 tests, including member 403 on admin routes and **custom-claim operator 200** on `/v1/admin/status` | 23/23 pass |
| Call-site review: vault writes are own-uid only; public profile still has name/photo/publicKey/fcmToken; Broadcast upload URLs unchanged | Matches |

After you publish rules, as a member in the browser:

- `db.collection('users').limit(5).get()` → permission-denied
- `db.collection('users').doc(knownUid).get()` → still works (name/photo)
- `db.collection('sparks').get()` → permission-denied
- `db.collection('sparks').doc(code).get()` → still works if you have the code
- Existing Broadcast videos play as before

---

## What you need to do

1. Upload the 19d GitHub files (see `UPLOAD-THESE.md`).
2. **Publish `firestore.rules` to Firebase.**
3. Publish economy worker **2.2.4-vault**.
4. Open the desk once (Unlock). That stamps `operator: true` on the account. The uid check still works if the stamp fails.
5. Sign in to the app once on your phone so your recovery email / Compass lock / E2E backup move into the vault.
