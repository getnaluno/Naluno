# Naluno

A statement from the future, not another WhatsApp. This repo is the real, hostable
version of the app — GitHub Pages for the frontend, Firebase (Auth + Firestore) for
the backend.

## What's real vs. what's still simulated

**Real in this build:**
- Sign-in — Google, or email/password as a more reliable alternative if Google's
  popup/redirect flow proves flaky on a given device
- Callsign profile (name, tagline, handle, color, photo) — synced to Firestore
- Presence heartbeat — your own `lastActivityTs` is written to Firestore while the
  app is open and focused, which is the exact field `computeSignal()` already reads
- Real contacts — search anyone by handle, connect, and they show up in your real
  Frequencies list, loaded live (not a one-time fetch, so it doesn't lag on open)
- Real Wireline — text, voice notes (size-limited without Storage, see below), moods,
  and emotion reactions all sync live over Firestore between two real signed-in people.
  Read receipts are driven by the actual other person opening the thread, not simulated.
  Messages can be hard-deleted, no "deleted" stamp left behind.
- Real Band — presence and messages are both live Firestore data for any Band made of
  real connections. No simulated banter in a real Band, ever.
- Real Broadcast — posts sync to Firestore per real account, and your real connections'
  broadcasts show up for you and vice versa. Frequencies and Broadcast are now the same
  set of real people, not two disconnected screens.
- Real 1:1 calls — WebRTC with Firestore as the signaling channel. A real ICE-candidate
  ordering bug (candidates generated before anything was listening for them) used to
  make calls "connect" with no audio or video ever arriving — fixed. **No TURN server
  is configured** — only public STUN — so most direct connections work, but two people
  both behind strict/symmetric NATs may fail to connect to each other specifically.
  See "Adding a TURN server" below when that becomes a real problem for real users.
- Real ringback (caller) and ringtone (receiver) tones, synthesized — or upload your
  own sound in Callsign → Ringtone (stored on-device only for now, see below).

**Still simulated / not built (next phases):**
- Multi-party Band Live (closer to an actual video-call room for lessons, screen share)
  needs a different foundation than 1:1 calls — likely a media server (SFU) once more
  than 2–3 people are live at once, since mesh peer-to-peer degrades badly past that
- Voice notes to real contacts are capped around 30 seconds, and a custom ringtone only
  works on the device you uploaded it from — both need a Firebase Storage bucket, which
  isn't wired up yet
- A ring genuinely reaching a closed app needs the Cloud Function deployed (see below) —
  without it, notifications only work while the app itself is open

## Adding a TURN server (when direct connections start failing for real users)

STUN alone (what's configured now) only helps two peers discover each other's public
address — it doesn't relay traffic. If someone's on a network that blocks direct
peer-to-peer connections outright (many offices, some mobile carriers), the call will
just never connect, with no clear error beyond "no answer."

To fix that, add a TURN server entry to `RTC_CONFIG` in `index.html`:
```js
const RTC_CONFIG = {
  iceServers: [
    { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
    { urls: 'turn:your.turn.server:3478', username: 'user', credential: 'pass' },
  ],
};
```
Options to actually get one: [Twilio Network Traversal Service](https://www.twilio.com/docs/stun-turn),
[Xirsys](https://xirsys.com), or [metered.ca](https://www.metered.ca/tools/openrelay/)
(has a small free tier, good for testing). These credentials are usually short-lived
tokens fetched from your own backend in a production setup, rather than a static value
committed to the repo — a reasonable hardening step once this matters for real.

Nothing above is an oversight — it's staged on purpose. Identity has to be real
before anything built on top of it (messaging, presence between real people, calls)
can be. See "Next phases" below.

## 1. Create the Firebase project

1. Go to [console.firebase.google.com](https://console.firebase.google.com) → **Add project**.
2. Once created, click the **Web** icon (`</>`) to register a web app. Name it anything.
3. Firebase will show you a config object like this — copy it:
   ```js
   const firebaseConfig = {
     apiKey: "...",
     authDomain: "...",
     projectId: "...",
     storageBucket: "...",
     messagingSenderId: "...",
     appId: "..."
   };
   ```
   This is **not a secret** — it's meant to be public in client code. Security is
   enforced by `firestore.rules`, not by hiding this object.
4. Paste it into `firebase-config.js` in this repo, replacing the placeholder.

## 2. Enable Authentication

1. In the Firebase console: **Build → Authentication → Get started**.
2. Enable **Google** as a sign-in provider (simplest to set up, no email server needed).
3. Add your GitHub Pages domain (e.g. `yourname.github.io`) under
   **Authentication → Settings → Authorized domains**.

## 3. Enable Firestore

1. **Build → Firestore Database → Create database**. Start in production mode.
2. Deploy the security rules in this repo:
   ```bash
   npm install -g firebase-tools
   firebase login
   firebase init firestore   # point it at this project, keep firestore.rules as-is
   firebase deploy --only firestore:rules
   ```
   (Or paste the contents of `firestore.rules` directly into the Firebase console's
   Rules tab and click Publish — no CLI needed if you'd rather not install tooling.)

## 4. Deploy to GitHub Pages

1. Push this repo to GitHub.
2. Repo **Settings → Pages → Deploy from branch → main → / (root)**.
3. Your app is live at `https://yourname.github.io/naluno` within a minute or two.

## Enabling email/password sign-in (a reliable alternative to Google)

Google sign-in's popup/redirect flow has proven fragile on some real devices — if it
keeps closing before finishing, use this instead. It doesn't depend on any cross-window
or cross-domain handoff at all, so there's nothing for a browser's privacy features to
interfere with.

1. Firebase console → your project → **Authentication** → **Sign-in method** tab.
2. Enable **Email/Password**.
3. That's it — the app already has the UI for it (the "OR" divider on the sign-in
   screen). No other setup needed.

## Enabling call notifications (rings even with the app closed)

This is a bigger step than everything else in this README — it needs a real server-side
piece (a Cloud Function), which means **upgrading your Firebase project to the Blaze
(pay-as-you-go) plan**. Cloud Functions don't run at all on the free Spark plan,
regardless of whether you ever use enough to actually be billed for it (this workload
is normally well within the free monthly allowance). It also needs Node.js and the
Firebase CLI installed on a computer — this one specific piece can't be done through
GitHub's website the way everything else so far has been.

**1. Upgrade to Blaze.** Firebase console → your project → the plan name near the
bottom of the left sidebar → Modify plan → Blaze. Requires a billing account, but
functions this small (one trigger, low volume) typically cost nothing.

**2. Generate a Web Push certificate (VAPID key).** Firebase console → ⚙️ Project
settings → Cloud Messaging tab → Web configuration → Web Push certificates →
Generate key pair. Copy the key.

**3. Paste that key into `firebase-config.js`** as the `VAPID_KEY` value, replacing
the placeholder. Commit to GitHub like any other change here.

**4. Install the Firebase CLI and deploy the function** (needs Node.js installed):
```bash
npm install -g firebase-tools
firebase login
firebase init functions   # choose "Use an existing project" → your Naluno project
                          # when it asks to overwrite functions/index.js and package.json,
                          # say NO — this repo's functions/ folder already has the real code
firebase deploy --only functions
```

**5. In the app, go to Callsign → Call notifications → Enable call notifications.**
Accept the browser's permission prompt. That registers your device's token in Firestore.

Once both people testing have done step 5, a real call between them will trigger a real
push notification through the Cloud Function — reaching a closed tab or a phone with
the browser backgrounded, the same way a real phone call would.

## Data model

```
users/{uid}          → handle, name, tagline, color, photoURL, lastActivityTs, fcmToken
handles/{handle}     → uid          (enforces unique @handles)
users/{uid}/connections/{otherUid} → name, handle, color, connectedAt
threads/{threadId}   → participants: [uidA, uidB], lastMessageText/At/From, readBy
  /messages/{id}      → from, type, text/mood, ts, status, reaction
bands/{bandId}       → name, vibe, memberUids, createdBy
  /presence/{uid}     → tunedInAt   (who's actually live right now)
  /messages/{id}       → ephemeral room chat
calls/{callId}       → callerUid, calleeUid, status, offer, answer, createdAt
  /callerCandidates/{id}, /calleeCandidates/{id} → ICE candidates
```

`threadId` is the two participants' uids, sorted and joined with `_` — deterministic,
so both people always resolve to the same thread document without a lookup step.
`callId` is a fresh random doc ID per attempt — unlike a thread, a call isn't a
persistent channel; every attempt gets its own document.

## Next phases (in order)

1. **Real Broadcast** — posts visible to real connections, not just your own signal.
2. **A TURN server** — see "Adding a TURN server" above. Worth doing as soon as a real
   call fails to connect between two real users on restrictive networks.
3. **Voice note storage** — add a Firebase Storage bucket so real voice notes aren't
   capped by Firestore's 1MB document limit.
4. **Multi-party Band Live** — closer to an actual video-call room (for lessons, screen
   share). Needs a different foundation than 1:1 calls: likely a media server (SFU)
   once more than 2–3 people are live at once, since mesh peer-to-peer degrades badly
   past that. Its own project, deliberately not folded into the 1:1 call work above.
