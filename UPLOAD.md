# Naluno GitHub zip — 20260824c

Full **24b** tree plus:

## Broadcast keep-alive (LOCK)
- Videos that paused on Android hide (notification shade / freeze) **resume** on return
- Debounced background pause (700ms) so brief flaps do not kill play
- `nalunoWantPlay` / keep-alive watchdog re-kicks stalled progressive streams
- Hard recovery: after 3 underruns, same-bucket blob fetch (never cross-bucket hop)
- Already-uploaded assets re-resolve via `resolveMediaUrl` on error

## Call connect (LOCK)
- `enableCameraForCall` opens **720p first** (was 1080-first → 3–7s lag)
- `prewarmCameraForCall` on call UI / dial so the next offer is near-0ms
- ICE still `iceNow()` (0ms) — never blocks the offer on TURN

## Unchanged
- Strand folders, Toga wall of fame, OriginID, Band, Wireline, Find, COMPAT
- Cache `?v=20260824c` · SW `naluno-shell-v86`

## After upload
Close every Naluno tab → site info → delete cookies/site data → open once.
