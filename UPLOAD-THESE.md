# GitHub — 2026.09.18d

One missed-call chip per call (stable id `miss-{callId}`; only the caller sends the drop).

Web call notify: the service worker now runs Firebase messaging `onBackgroundMessage`, so a PWA that is open but unused still gets a ringing OS notification.

Only these files. Do not upload a full tree.

## Must upload

1. **app/index.html**
2. **sw.js**, **js/pwa.js**
3. **js/calls.js**, **js/wireline.js**, **js/wire-mailbox.js**

Cache `naluno-shell-v175`, `?v=20260918d`.

Close Naluno tabs once so the new worker takes.

The operator inbox address is not in any of these files.
