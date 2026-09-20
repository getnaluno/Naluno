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
| Desk powers | `isOperator()` — uid **or** Firebase custom claim `operator: true` |
| Contribution / trust / payouts | Client writes denied. Points computed in the worker |
| Wireline drops | `from` / `to` bound to the signer |
| Compass notebook | Owner only |
| Find Naluno beacons | Owner write; owner or operator read |
| Calls | Caller/callee only. Uids frozen on update |
| Broadcast / Signal create | Must stamp your own uid |
| Closed Callsign | Owner cannot write once closed |
| R2 upload | ID token. Key is `u/{yourUid}/…` |
| Ad meters / Toga scores | +1 per write |
| Band invites / mesh / posts | Members or creator |
| Spark room messages | Participants only |
| Reports | Reason required in rules |
| Firebase Storage | Locked (`allow read, write: if false`). Media is on R2 |

---

## 19d — leftover work that does not break the app

| Change | Why it is safe |
|---|---|
| Members **get** a known `users/{uid}` but cannot **list** the collection | Names still load. A rewritten client cannot dump every profile in one query |
| Handles and Spark codes: get, not list | Lookup still works |
| Private **vault** for recovery email, Compass lock, E2E backup, desk password | Moves off the public profile on next sign-in |
| Website pulse: known fields; visit counters +1 | Analytics still write |
| Operator custom claim | Additive. The uid check still works |

---

## 19e — this pack

| Change | Why it is safe |
|---|---|
| **Call-notify worker** looks tokens up on the server. A rewritten client cannot push a stranger's call, a Band they are not in, or a Broadcast they did not create. Client-supplied tokens are used **only** if the lookup is empty, so the current worker swap cannot silence existing phones | In-app ring still works even if push is delayed |
| Push tokens are **also** written to the vault. They stay on the public profile until this worker is live, so wake does not drop | Dual-write |
| Mail rate limit also stored in Firestore (`deskRate`, client-denied) | Survives a worker restart. Memory limit still applies first |
| Firebase Storage rules deny all | App does not use Storage. Media stays on R2. **Does not change Broadcast playback** |

---

## Still open (honest)

1. Public profiles still carry FCM tokens until the new call-notify worker is live **and** a later pack strips them. A member who already knows a uid can still `get` that token.
2. Website pulse is still unauthenticated. App Check would kill analytics until reCAPTCHA is enrolled — left off.
3. Desk password is still a screen lock. Steal the operator Google session and the SDK is enough.
4. Media `GET /o/**` is still public if the URL leaks. Required for in-feed video. **Not changing this.**
5. TURN credentials worker is not in this repo. The app already sends an ID token; without the worker source we cannot prove the other side checks it.

---

## How this pack was tested

| Test | Result |
|---|---|
| `js/firestore-rules.test.cjs` + Storage lock | Pass |
| Economy worker tests (mail, admin 403, custom-claim operator) | Pass |
| Call-notify: no token 401, cannot notify self, unknown type 400, stranger call 403, **server tokens win over a client-supplied token** | Pass |

After you publish rules, as a member:

- `db.collection('users').limit(5).get()` → permission-denied
- `db.collection('users').doc(knownUid).get()` → still works
- Existing Broadcast videos play as before

After you publish call-notify:

- POST with someone else's `callId` → 403
- POST with a random FCM token, when the vault has a real one → the random token is ignored

---

## What you need to do

1. Upload the 19e GitHub files (see `UPLOAD-THESE.md`).
2. **Publish `firestore.rules` and `storage.rules` to Firebase.**
3. Publish economy worker **2.2.5-ratelimit**.
4. Publish call-notify worker **1.0.0-secure** to the existing `naluno-call-notify` worker (copy the same service-account secret).
5. Open the desk once so `operator: true` is stamped.
6. Sign in to the app once so recovery / Compass / E2E move into the vault, and push tokens dual-write.
