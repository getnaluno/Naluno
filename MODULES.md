# Naluno module ownership (2026.08.17f)

Hard boundaries — fix bugs **in the owner file only**. Do not copy functions across modules.

## Platform (shared, thin)

| Module | Owns | Consumers |
|--------|------|-----------|
| `js/ice-core.js` | STUN/TURN `getIceServers`, `prewarmIceServers`, `IceCore` | calls, band mesh, broadcast-live |
| `js/camera.js` | Shared **call/greenroom** `stream`, flip, filters, `cameraAcquire/Release` | calls, lobby only |

## Product domains (isolated media)

| Module | Owns | Must NOT touch |
|--------|------|----------------|
| `js/calls.js` | `peerConnection`, call signaling, ringtone, remote call video UI | `bandMeshPcs`, `bandLiveLocalStream`, `bLive*`, `bspaceVideoEl` |
| `js/band-room.js` | Band presence/messages, `bandLiveLocalStream`, `bandMeshPcs` | `peerConnection`, `remoteCombinedStream`, `stopCameraStream` for live |
| `js/broadcast-space.js` | Broadcast community UI, VOD `<video id=bspaceVideoEl>` | call PC, band mesh |
| `js/broadcast-live.js` | Broadcast live host/viewer PCs | call PC, band mesh |
| `js/broadcast-core.js` | Permanent broadcast CRUD + feed | media graphs |
| `js/signal-core.js` | Ephemeral signals + R2 upload + `resolveMediaUrl` | WebRTC |

## Intentional UI coupling (only)

- **Call overlay preempts** Band / Broadcast / Wireline (`snapshotUiBeforeCall` / `restoreUiAfterCall` in calls.js).
- This is product behavior, not shared media state.

## Load order (index.html)

`ice-core` → `camera` → `calls` → `broadcast-live` → `band-room` → …

## Rule for future fixes

1. Identify owner from the table.
2. Change only that file (+ ice-core/camera if the bug is platform).
3. Re-run syntax check on touched modules.
4. Never “quick-fix” call media inside band-room or band mesh inside calls.js.
