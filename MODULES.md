# Naluno modules

Split from the single-file monolith so each domain has a home. Scripts load **in order** and share globals on purpose — runtime behavior matches the old `index.html` script. When you fix a bug, **edit only the module that owns that domain**.

| Module | Owns |
|--------|------|
| `js/core.js` | $, toast, version check · ~34 lines |
| `js/data.js` | Contacts + signal strength derivation · ~28 lines |
| `js/crypto.js` | E2E encryption + pending video job IDB + binary helpers · ~257 lines |
| `js/atmosphere.js` | Today's Frequency atmosphere · ~122 lines |
| `js/band-list.js` | Band list, create frequency, public bands publish · ~250 lines |
| `js/signal-core.js` | Signal posts + R2 upload + composer state · ~186 lines |
| `js/compass.js` | Compass privacy lock + anonymous board · ~845 lines |
| `js/signal-ui.js` | Crop/adjust, signal ring, story viewer · ~369 lines |
| `js/wireline.js` | Wireline DM, offline queue, voice notes, mood, emotion wheel · ~886 lines |
| `js/profile.js` | Tab navigation + Callsign profile · ~157 lines |
| `js/auth.js` | Firebase Auth, profile load, connections, threads listeners · ~438 lines |
| `js/notifications.js` | FCM push token + call notifications setup · ~54 lines |
| `js/camera.js` | Camera stream, flip, filters, borders, segmentation, quality · ~1198 lines |
| `js/calls.js` | Call lobby/ring/UI, ringtone, WebRTC peer connection · ~1032 lines |
| `js/band-room.js` | Band room UI, presence, settle clock, record audio/video, invites, band E2E · ~888 lines |
| `js/pwa.js` | PWA install prompt + notification deep-link · ~147 lines |
| `js/find.js` | Find People search + connect requests · ~164 lines |

| `css/app.css` | All styles |
| `firebase-config.js` | Firebase keys |
| `sw.js` | Service worker |
| `index.html` | HTML shell + ordered script tags |

## Rules
1. **Camera / flip / filters** → `js/camera.js`
2. **1:1 calls / WebRTC / ring** → `js/calls.js`
3. **Band presence, settle, record clips, invites** → `js/band-room.js` (+ list in `js/band-list.js`)
4. **Wireline text/voice** → `js/wireline.js`
5. **Auth / connections load** → `js/auth.js`
6. Do not copy-paste a function into another module “just to fix it” — import/call the owner.

## Deploy
Ship `index.html` + entire `js/` + `css/` together. For Capacitor: `copy-web.js` must copy folders (see updated script).


## Broadcast Space (2026-08-13)
- `js/broadcast-space.js` — living community around a Broadcast (conversation, questions, results, resources, journey). Not a video player.
- Firestore: `broadcasts/{id}` + subcollections `conversation`, `questions`, `results`, `resources`, `journey`.

## Band hall rules
- Messages are not user-deletable; they clear only via the 2h settle wipe after the last person leaves.
- Live video = draggable local camera (`#bandLiveFloat`).
- Invite via **Copy link** (`?band=firestoreId`).

## Complete pass 2026-08-13
- Broadcast Go Live = same space, live chapter (camera in hero + journey/conversation)
- Creator Impact dashboard (community, conversations, questions, results, resources)
- Broadcast Updates tab (grow without delete)
- Conversation photo + voice
- Best-answer marking for creators
- Discovery ranks by relationship strength, then recency
- Band live grid shows everyone with live:true; local camera draggable
- Firestore `broadcasts/.../updates` rules

## Signal vs Broadcast separation (2026-08-13)
- **Signal** = ephemeral short clip (24h / 3d / 7d). Ring `+` and ring strip. Story viewer 1:1 → dbl-tap full frame.
- **Broadcast** = permanent community media. Tab `+` publishes. Plates grid under rings. Space: conversation, questions, results, resources, journey, updates, Go Live, Share, Delete.
- `js/broadcast-core.js` — permanent CRUD, search, share URLs, live notify to frequencies.
- Optional: Signal can link to an existing Broadcast via composer select.

## Broadcast Live wow layer (2026-08-13)
- `js/broadcast-live.js` — multi-viewer WebRTC fan-out (viewer-offer, host answers up to 12)
- Floating reactions, watcher count, Join live button for frequencies
- Signaling: `broadcasts/{id}/liveSessions/{viewerUid}` + hostIce/viewerIce
