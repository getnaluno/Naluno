# Naluno

A statement from the future — not another WhatsApp.

Mobile-first messaging and calling, built as a single hostable HTML file with Firebase (Auth + Firestore) and Cloudflare Workers (TURN, R2 video, call push, Compass AI).

**Live:** [getnaluno.com](https://getnaluno.com) · GitHub Pages · Firebase project `naluno-28a00` (Spark)

## What is real today

- **Sign-in** — Google or email/password
- **Callsign** — name, tagline, handle, color, photo (Firestore)
- **Presence** — computed from real activity (`lastActivityTs`), not a status toggle
- **Frequencies / connections** — search by handle, mutual connect, live list
- **Wireline (DMs)** — text (real E2E: ECDH P-256 + AES-GCM), voice notes, moods, reactions, read receipts, hard delete. Offline compose queue that only attempts Firestore writes when `navigator.onLine` is true
- **Band** — live shared frequency with real presence and messages
- **Broadcast (Signal)** — 25-hour ephemeral posts; video uploaded to R2 via Worker (Firestore 1 MB limit avoided); auto-delete after 1 day
- **1:1 calls** — WebRTC + Firestore signaling + real TURN (Cloudflare Realtime) via Worker. Composited border+camera video is what the other person receives. Double-tap guards on start/accept. Call push notifications even when the app is closed (Cloudflare Worker signs JWT → FCM)
- **Compass** — conversational AI companion (Cloudflare Workers AI, free daily Neuron allowance). Password lock optional. Personalisation of other Naluno data is deliberately deferred
- **Offline shell** — service worker caches the app shell so the app opens looking like itself when offline
- **Video trim/split** — native `video.captureStream()`, background processing with progress banner, resume-from-IndexedDB after interrupted session

## Architecture notes

| Piece | Where |
|-------|--------|
| Frontend | `index.html` (single file: HTML + CSS + JS) · GitHub Pages |
| Auth / DB | Firebase Auth + Firestore · rules in `firestore.rules` |
| TURN credentials | Cloudflare Worker `naluno-turn-credentials` |
| Call push | Cloudflare Worker `naluno-call-notify` (JWT → FCM) |
| Broadcast video | Cloudflare Worker `naluno-signal-upload` + R2 bucket `naluno-signal` |
| Compass AI | Cloudflare Worker `naluno-compass` (Workers AI binding) |

Secrets never live in the repo — only via `wrangler secret put`.

## Local / deploy workflow

1. Edit `index.html` (and `sw.js` / `manifest.json` if needed).
2. Bump `<meta name="app-version">` so clients detect the update.
3. Commit + push to the GitHub repo that powers Pages.
4. Cloudflare Workers are already deployed; only re-deploy a Worker if you change its source.

## Data model (summary)

```
users/{uid}                    handle, name, tagline, color, photoURL, lastActivityTs, fcmToken, …
handles/{handle}               uid
users/{uid}/connections/{otherUid}
users/{uid}/signal/{segId}     Broadcast segments (text / photo / video URL + thumb)
users/{uid}/compassMessages/{id}
threads/{threadId}/messages/{id}   threadId = sorted uids joined with _
bands/{bandId}/presence|messages
calls/{callId}/callerCandidates|calleeCandidates
```

## Known limitations (by design or deferred)

- E2E currently covers Wireline **text** only (voice notes / moods remain plaintext). Private keys are device-local (IndexedDB).
- Voice notes are size-capped by Firestore document limits until a Storage bucket is wired.
- Multi-party Band Live and real background replacement/blur are deliberately not started.
- True offline mesh / full-screen lock-screen call UI / custom push sound require a native Android shell (architecture locked, not started).
- Firestore signal loading still uses one query per connection (debounced). A collection-group query + owner field is the proper scale fix and is documented in `BUILD_LOG.md`.

## Working conventions

- Validate every JS change (syntax, brace balance, dangling `$('id')` refs, Node harness where useful).
- Crypto and signing code is proven with real keys and round-trips, not only reasoned about.
- Secrets only via `wrangler secret put` (prefer piping from a file on Windows Terminal).
- Large delicate features get their own focused pass.

See **BUILD_LOG.md** for the living technical map, scaling notes, and the exact state of open items.
