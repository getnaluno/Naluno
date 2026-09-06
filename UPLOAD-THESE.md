# GitHub update — 2026.09.05b

Copy these files over the root of `getnaluno/Naluno`. Keep the folder
structure. Commit and push. Force-close the webapp after it deploys
(not just swipe away). Re-open. Console should show:

`[naluno] build 2026.09.05b`

Service worker cache: **naluno-shell-v145**.

Do not rebuild architecture. Signal / Broadcast upload paths were not
changed.

## What this fixes

1. **Wireline encryption actually opens.** Sends now fan-out like WhatsApp:
   fetch the other person's *current* public key, seal one envelope for
   them and one for this phone, stamp `senderPub` on the packet. If they
   have no key yet, the text stays readable — never a locked blob.
   Decrypt uses the key that sealed the message, not whoever's profile
   key happens to be published later. A phone that lost its private key
   mints a new identity so *new* messages work; old ones stay locked
   with a plain ask-them-to-send-again line.
2. **Welcome + tour no longer flash on refresh.** Returning phones are
   marked before paint (`data-naluno-known`). Both panels start `hidden`
   with empty titles, so even a slow stylesheet cannot stack
   “Welcome to Naluno” on top of “Your name here is a Callsign”.
3. **Wireline vibes are 3D.** Exhausted, Calm, Thinking of you, In awe,
   At peace, Missing you, Overwhelmed each have their own depth, light,
   and motion — not a flat Greenroom tint.

## After push

Force-close Naluno. Re-open. Confirm `2026.09.05b`.

Send a new Wireline text. Both phones should read it. Older locked
bubbles from before this build stay locked until that person sends
again.

To preview the welcome on a phone that already has an account: clear
this site’s data (or the keys `nalunoWelcomeOk`, `nalunoTourOk`, and
`nalunoLastUid`), then reopen signed out.
