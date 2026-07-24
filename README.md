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

**Still simulated (next phases):**
- Contacts / Frequencies — still the hardcoded array
- Wireline messaging — still local, not backed by the `threads` collection yet
- Band — still local, not backed by real presence documents yet
- Calls / Band Live video — still your own camera only, no real second participant

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

1. **Real contacts** — replace the hardcoded `contacts` array with handle search
   (`handles/{handle}` lookup) and a real `users` read.
2. **Real Wireline** — swap `wirelineThreads` local state for `onSnapshot` listeners
   on `threads/{threadId}/messages`, and route sends through `addDoc`.
3. **Real Band** — same pattern for `bands/{bandId}/messages`, plus writing/reading
   `bands/{bandId}/presence/{uid}` so "who's tuned in" reflects real people instead
   of `computeSignal()` running against fake timestamps.
4. **Real calls** — WebRTC with Firestore as the signaling channel (offer/answer/ICE
   candidates as documents), plus a TURN server for people behind restrictive NATs.
   This is the hardest phase — deliberately last.
