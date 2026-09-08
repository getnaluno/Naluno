# GitHub update — 2026.09.08a

Copy over the repo root. Keep `app/` and `admin/`.
Force-close Naluno, then reopen. Console should show:

`[naluno] build 2026.09.08a`

Service worker cache: **naluno-shell-v151**.

Then open **https://getnaluno.com/admin/** and hard-reload that tab.

## Why login did nothing

Three separate bugs stacked:

1. **The phone kept the old admin script.** HTML still asked for
   `admin-console.js?v=20260907a`, so every rewrite you uploaded looked
   like “nothing changed”. Cache key is now `20260908a`.

2. **Google on Samsung Chrome.** Popup is blocked or unsupported in the
   installed app. The desk now falls back to redirect, and actually
   reads the result when you come back.

3. **Unlock never left the gate.** `/v1/admin/status` 404 (account not
   on the Worker allowlist) was treated as a hard stop. The password you
   set in the UI never opened the window. The desk now saves that
   password on this phone as well. After you create it, Control Centre
   opens. Server flags stay locked until the account is on the operator
   list — diagnostics still work.

Handle or email both work on the first screen. After Firebase accepts
you, Sign in is forced off and Unlock is forced on (class + display),
so the window cannot stay put.

## After push

Hard-reload `/admin/`. Sign in with the same handle or Google you use
in Naluno. First visit: **Set your password** (twice, 8+ characters).
That is the moment the window should switch to Control Centre.
