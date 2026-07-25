# Naluno

A statement from the future, not another WhatsApp. This repo is the real, hostable
version of the app — GitHub Pages for the frontend, Firebase (Auth + Firestore) for
the backend.

## What's real vs. what's still simulated

**Real in this build:**
- Sign-in (Google)
- Callsign profile (name, tagline, handle, color, photo) — synced to Firestore
- Presence heartbeat — your own `lastActivityTs` is written to Firestore while the
  app is open and focused, which is the exact field `computeSignal()` already reads
- Real contacts — search anyone by handle, connect, and they show up in your real
  Frequencies list (merged alongside demo contacts, distinguished by `isReal: true`)
- Real Wireline — text, voice notes (size-limited without Storage, see below), moods,
  and emotion reactions all sync live over Firestore between two real signed-in people.
  Read receipts are driven by the actual other person opening the thread, not simulated.
- Real Band — presence and messages are both live Firestore data for any Band made of
  real connections. No simulated banter in a real Band, ever.
- Real 1:1 calls — WebRTC with Firestore as the signaling channel (offer/answer/ICE
  candidates as documents). Actually connects two real people's audio/video.
  **No TURN server is configured** — only public STUN — so most direct connections
  work, but two people both behind strict/symmetric NATs (common on some corporate
  networks) may fail to connect to each other specifically. See "Adding a TURN server"
  below when that becomes a real problem for real users.

**Still simulated / not built (next phases):**
- Real Broadcast (posts visible to real connections) isn't built — Broadcast is
  currently just your own posts, nothing shared between real accounts yet
- Multi-party Band Live (closer to an actual video-call room for lessons, screen share)
  needs a different foundation than 1:1 calls — likely a media server (SFU) once more
  than 2–3 people are live at once, since mesh peer-to-peer degrades badly past that
- Voice notes to real contacts are capped around 30 seconds — there's no Firebase Storage
  bucket wired up yet, so audio has to fit inside a single Firestore document (1MB limit)

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

## Data model

```
users/{uid}          → handle, name, tagline, color, photoURL, lastActivityTs
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
