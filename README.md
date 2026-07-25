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

**Still simulated (next phases):**
- Frequencies still shows demo contacts (ids 1–6) alongside real ones — not removed yet,
  on purpose, so nothing else breaks while real contacts prove themselves out
- Band — still local, ephemeral chat only; no real presence or real multi-person messages
- Calls / Band Live video — still your own camera only, no real second participant, no
  real multi-party video (that needs WebRTC + likely a media server, its own project)
- Voice notes to real contacts are capped around 30 seconds — there's no Firebase Storage
  bucket wired up yet, so audio has to fit inside a single Firestore document (1MB limit)

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
threads/{threadId}   → participants: [uidA, uidB]
  /messages/{id}      → from, type, text/mood, ts, status, reaction
bands/{bandId}       → name, vibe, memberUids, createdBy
  /presence/{uid}     → tunedInAt   (who's actually live right now)
  /messages/{id}       → ephemeral room chat
```

`threadId` is the two participants' uids, sorted and joined with `_` — deterministic,
so both people always resolve to the same thread document without a lookup step.

## Next phases (in order)

1. **Remove demo contacts** — now that real search/connect and real Wireline both work,
   retire the hardcoded `contacts` array entries (ids 1–6) once you've tested enough
   with real accounts to trust it.
2. **Real Band** — same live pattern as Wireline now uses, applied to
   `bands/{bandId}/messages` and `bands/{bandId}/presence/{uid}`, so "who's tuned in"
   reflects real people instead of `computeSignal()` running against fake timestamps.
3. **Real calls** — WebRTC with Firestore as the signaling channel (offer/answer/ICE
   candidates as documents), plus a TURN server for people behind restrictive NATs.
   Multi-party Band Live (closer to a real video-call room) needs this same foundation
   plus likely a media server once more than 2–3 people are live at once — its own project.
4. **Voice note storage** — add a Firebase Storage bucket so real voice notes aren't
   capped by Firestore's 1MB document limit.
