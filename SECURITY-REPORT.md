# Naluno security report — 20 September 2026

Threat model you asked for: **an attacker has the complete frontend and can send requests to every endpoint by hand.** Hiding a button, a URL, or a tab does not count as security. Only authentication, authorisation and validation on the server count.

This is a source-and-rules audit of the live product (Firebase project `naluno-28a00`, GitHub Pages at getnaluno.com, Cloudflare Workers). Production Firebase was not attacked from this environment.

---

## Verdict

Naluno is **not** an open database. Money, contribution points, trust scores, Wireline ciphertext, Compass notebooks, Find-Naluno pins, and operator mail are locked on the server.

It is **not** yet safe against a signed-in attacker with the source. The main holes were: anyone signed in could read every member profile (including recovery emails and push tokens), inflate ad meters and Toga scores, write into anyone’s notification inbox, join Band WebRTC as a stranger, and the desk password was only a screen lock. Several of those are closed in this pack. **They do not take effect until `firestore.rules` is published to Firebase.**

---

## What is already protected (server-side)

| Surface | How it is enforced |
|---|---|
| Desk powers (mail, ads create, flags, audit, presence, closed-account restore) | Firestore `isOperator()` — the signed-in Firebase uid, not a hidden `/admin` URL |
| Contribution / trust / payouts / creator support | Client writes denied (`allow write: if false`). Points are computed in the economy worker |
| Wireline drops | Sender must be signed in as `from`, recipient must match `to`. Recipient reads and deletes |
| Compass notebook | Owner only |
| Find Naluno beacons | Owner write; owner or operator read. Members cannot map other people |
| Call signalling | Caller/callee only. ICE candidates the same |
| Signal posts | Owner write; connections may read |
| Broadcast create | `creatorUid` must be the signer |
| Handle uniqueness | `handles/{handle}` create requires `uid == auth.uid`; second claim at the same path fails |
| Closed Callsign | Owner cannot write the profile once `accountState == 'closed'`. Restore is operator-only |
| R2 upload (Signal / Broadcast) | Firebase ID token required. Object key is `u/{uid}/…` and the worker refuses any other prefix. You cannot overwrite someone else’s file |
| TURN credentials | ID token required. Long-term Cloudflare token never reaches the browser |
| Public mail `/v1/mail` | Honeypot, length limits, invest requires name+email+country, IP rate limit (8/hour, 2/8s, in-memory) |
| Economy `/v1/events` | Bearer token; actor is the token uid; points not accepted from the client |
| `adminCredentials` | Read and write denied to all clients |

The Firebase web API key, VAPID key, and project id in `firebase-config.js` are **supposed** to be public. Access is the rules, not hiding that file.

---

## What was not protected (before this pack)

Severity is from the attacker-has-the-source model.

### Critical

1. **Desk password is a screen lock.** Firestore and the economy worker authorise the operator **uid**. Anyone who signs in as that Google/handle account can read mail, users, ads, flags and GPS from the SDK or `/v1/admin/*` without the desk password. Worker code even says `still allow` when the password header is wrong.

2. **Every signed-in member can read every `users/{uid}` document.** That is how names and photos work today. It also dumps `recoveryEmail`, FCM tokens, Compass lock hash, and E2E key backups. Combined with public `handles/{handle}` (readable with no sign-in), a member can build a directory of people and tokens.

3. **Ad meters.** Members could set `impressions` / `clicks` / `viewCompletes` to any number. That would burn a prepaid budget.

4. **Toga scores and display name.** Any signed-in user could write another person’s monthly counters (and rename the row).

5. **Notifications.** Any signed-in user could create a document in anyone’s inbox.

6. **Band invites and mesh.** Any signed-in user could read/write another Band’s invites and WebRTC mesh.

7. **Spark room messages.** The parent room was participant-only; nested messages were readable by anyone signed in. Room ids are `uidA_uidB`.

8. **Self-unsuspend.** A suspended member could set `suspended: false` on their own profile. Closed Callsign was already locked; suspension was not.

### High

9. **Wireline `messages` update** allowed any participant to rewrite another person’s body.

10. **Call docs** allowed either party to change `callerUid` / `calleeUid`.

11. **Broadcast subcollections** (conversation, journey, liveSessions) allowed any signed-in create with no uid stamp.

12. **Origin marks** — any signed-in create, no creator stamp.

13. **Reports** — worker required a reason; direct Firestore create did not.

14. **Band message delete** — after a square had been emptied, *any* signed-in user could delete messages, not only members.

15. **Band posts** — no membership check (anyone signed in could post into a Band they were not in).

16. **Unauthenticated `siteSessions` / `siteDays`.** Needed for the public website pulse. No auth, no durable rate limit. An attacker can fake traffic and spend Spark-plan writes.

17. **Public R2 playback** `GET /o/**`. Anyone with the URL can stream the file. Keys are unguessable; leaked URLs are public.

18. **Call-notify worker** (source not in this repo) is called with **client-supplied FCM tokens** and title/body. If the worker trusts the body, any member who read tokens from `users` can push to anyone.

### Medium

19. Operator uid (and operator email in JS/worker) live in the public repo. That is a targeting list, not a password.

20. Mail rate limit is per Cloudflare isolate (resets when the worker moves).

21. Economy worker used to try an **unauthenticated** Firestore write with the public API key as a last resort for mail. Current rules would deny it; a loosened rule would not.

22. No Firebase Storage rules file in the repo. Media is on R2. If Storage was ever left on default, it is not visible from git.

23. Spark codes are 5 characters and listable to anyone signed in.

24. Compass lock is unsalted SHA-256 on the user doc (readable by members). UI only.

---

## What this pack fixes (server-side)

None of these depend on hiding UI.

| Fix | Where | Attacker with the source |
|---|---|---|
| Ad counters may rise by at most 1 per write | `deskAds` rules | Cannot set impressions to 999999 |
| Toga counters may rise by at most 1; others cannot rename | `toga` rules | Cannot mint rank |
| Owner cannot clear `suspended` / `restricted` | `users` rules | Suspended account stays suspended until the desk lifts it |
| Notifications / Origin / Broadcast subdocs must stamp the signer | rules | Cannot forge “from” as someone else (can still notify a person — product needs that for Band invite and “is live”) |
| Spark room messages: participants only | rules | Strangers cannot read the Spark transcript |
| Band invites + mesh: members or creator | rules | Strangers cannot join the WebRTC mesh or plant invites |
| Band posts: members or creator; prune-delete: members only | rules | Cannot spam or wipe a Band you are not in |
| Wireline: others may only mark read/delivered | rules | Cannot rewrite someone else’s message |
| Calls: caller/callee uids frozen on update | rules | Cannot hijack the call doc |
| Reports: reason 10–4000 chars in rules | rules | Cannot bypass `/v1/report` with an empty Firestore create |
| Mail worker no longer writes `deskMail` with the public API key | economy worker 2.2.3-security | A loosened rule cannot be used as an open mailbox |

**Not changed here (would break the product or needs a second project):**

- Splitting `users` into a public profile vs private doc (emails, tokens, hashes). This is the next real lock. It needs a data migration.
- App Check on `siteSessions` / `siteDays`.
- Custom claims instead of a hardcoded operator uid.
- Making R2 playback require a signed cookie (breaks in-feed video on other phones).
- Call-notify source (not in this repo) — bind tokens to the callee uid on the server.
- Durable mail rate limits (KV/Durable Object).

---

## How each fix was tested

Production Firebase was not written to from this environment.

1. **Rules contract tests** (`js/firestore-rules.test.cjs`) — asserts the new deny/allow phrases are actually in `firestore.rules` (impressions +1, self-unsuspend block, Spark participants, frozen caller/callee, stamped notifications, Band invite membership). **Pass.**

2. **Economy worker tests** (`workers/economy/economy.test.mjs`) — 22 tests, all pass, including:
   - member token → `/v1/admin/flags` is **403**
   - member token → `/v1/admin/user-action` is **403**
   - public mail **does not** write `deskMail` via `?key=`
   - honeypot swallowed, invest validation, inbox address never in the JSON

3. **Call-site review** against the real client writes so the app still functions:
   - Ads: `FieldValue.increment(1)` only (`js/ads.js`)
   - Toga: `increment(1)` on `viewsTotal` / `mv_*` (`js/circle.js`); owner path still unrestricted
   - Close Callsign still sets `accountState: 'closed'` (not a moderation field)
   - Band invite still written by a member/creator
   - Notifications still send `fromUid: currentUser.uid`
   - Origin marks still send `creatorUid: currentUser.uid`
   - Live conversation/journey still send `from` / `by` as the signer

4. **What we could not run here:** the Firebase rules emulator. After you publish rules, the live check is: sign in as a **member** in the browser console and confirm these fail with `permission-denied`:
   - `users/{yourUid}.update({ suspended: false })` while the desk has you suspended
   - `deskAds/{id}.update({ impressions: 999999 })`
   - `toga/{someoneElse}.update({ viewsTotal: 999999, name: 'x' })`
   - `users/{someoneElse}/notifications.add({ type: 'x', fromUid: 'not-you' })`
   - `bands/{notYours}/mesh/x.set({ ice: 1 })`
   - `sparkRooms/{uidA_uidB}/messages` get when you are neither uid

---

## What you need to do

1. **Publish `firestore.rules` to Firebase.** GitHub Pages does not apply them. Until this file is deployed, the live product is still the old rules.

   `firebase deploy --only firestore:rules`

2. **Publish economy worker 2.2.3-security** (`workers/economy/handler.mjs`) so mail stops attempting an unauthenticated Firestore write.

3. **Protect the operator Google account** (2FA, recovery codes, not reused). The desk password does not save you if that session is stolen. Treat that account as production root.

4. Next engineering pass (ask for it as a separate job): private user docs, App Check on the website pulse, custom claims for the desk, call-notify token binding.

---

## Secrets in the repo (honest)

| In git | Secret? |
|---|---|
| Firebase web API key, project id, VAPID, Google web client id | No — required in the browser |
| Operator uid | Targeting id, not a password. Lives in rules because rules cannot hide it |
| Operator email in admin JS / worker | Targeting. Does not grant Firestore desk powers (rules are uid-only) |
| TURN key id | Not the TURN secret |
| Service account JSON, R2 keys, TURN token, inbox address, Resend key | Not in git. Must stay in `wrangler secret put` only |

No FCM server key, GitHub token, or private key is in this tree.
