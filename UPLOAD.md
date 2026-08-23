# Naluno — consolidated ship 20260823c

## What this is
Full latest shell. Built by **merging**, not replacing:

| Layer | Source | Kept |
|-------|--------|------|
| Signal / HEVC / media bleed / calls / camera | `naluno-hevc-upload-20260822g` | signal-ui blob recovery, media-contain, calls, camera |
| Circle · Strand · Origin · Toga · views | `naluno-circle-strand-origin-20260823a` | circle.js, strand.js, origin.js, broadcast UI |
| Sign-in gate | retry + inject Firebase, **no soft reload** | SW v78 never intercepts gstatic |
| Wireline contact-only | identical across recent zips | WhatsApp-style contacted-only list |

## Cache
- Scripts: `?v=20260823c`
- Service worker: `naluno-shell-v78` (same-origin only)

## After upload
1. Close every Naluno tab.
2. Chrome → site info → **Delete cookies and site data** for getnaluno.com.
3. Reopen once so SW v78 installs.

## Ship rule (locked)
Never base a “small fix” zip on an older tree. Always start from the **previous latest full zip**, then add the fix. Module sizes for Signal/Broadcast/Calls must not shrink without an explicit reason.
