# GitHub update — 2026.09.07a

Copy over the repo root. Keep `app/` and add `admin/`.
Force-close Naluno after it deploys, then reopen. Console should show:

`[naluno] build 2026.09.07a`

Service worker cache: **naluno-shell-v150**.

## What changed

The Admin Console is no longer inside the member app. There is no 6-tap
dot on Callsign. Operators open:

**https://getnaluno.com/admin/**

That address is not linked from the public website or the app. Search
engines are told to stay out. The service worker never caches it, so a
normal phone cannot keep a copy after visiting by accident.

Getting in still needs all three:

1. Sign in with an allowed Firebase account
2. The Worker `ADMIN_UIDS` list
3. The Worker `ADMIN_PASSPHRASE`

A signed-in person who is not on the list just sees “Not available.”

Device diagnostics (the on-phone error log) now live on that same desk,
same origin, so a break on this browser can still be copied there.

Signal / Broadcast upload paths were not changed.

## After push

Members: force-close, reopen, use the app as usual.
Operators: open getnaluno.com/admin/ in the browser, sign in, unlock.
