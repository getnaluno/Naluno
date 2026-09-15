# GitHub / Firebase — 2026.09.15b

Wireline three-dot menu → Chat backup and Chat history.
Only these files. Do not upload a full tree.

The operator inbox address is not in any of these files.

## Must publish

1. **app/index.html**, **css/app.css**, **js/wireline.js**, **js/wire-mailbox.js**, **js/chat-store.js** — kebab on Wireline. Chat backup saves a JSON copy on this phone (Files / Drive space is the person’s; Naluno does not keep it). Chat history lists conversations on this phone and can clear them here only.
2. **js/pwa.js**, **sw.js** — cache `naluno-shell-v170`, `?v=20260915b`.
3. **privacy.html**, **privacy/index.html**, **terms.html**, **terms/index.html** — copy now says Chat backup, not Save copy.

## After upload

Close Naluno tabs once so the new service worker takes.

A new phone still starts empty until a copy is opened from Chat backup.
