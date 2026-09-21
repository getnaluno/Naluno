# Landscape: the app now fills the screen, like WhatsApp

See `screenshots/` — BEFORE is blank, AFTER is the full app.

## What was wrong

Measured in a real browser at your phone's landscape size: **the app was
0 pixels wide.** Everything was there — header, content, tab bar — inside a
box with no width, sitting in the dead centre of the screen. That was the
blank screen.

The cause was one CSS rule for landscape phones. It set the app's width to
`auto`. The page centres the app in a flex container, where `auto` means
"shrink to fit your content" — and the content has no width of its own, so
the app shrank to nothing. The rule was also trying to keep a narrow
portrait-shaped column, which isn't what a rotated phone app should do.

A second rule hid the tab names in landscape — the opposite of what you
wanted.

## What it does now

Like WhatsApp in landscape:

- The app **fills the whole screen**, edge to edge.
- The header stays, with Spark and Connect.
- The **tab bar stays at the bottom with every tab's name** (Frequencies,
  Wireline, Band, Broadcast, Compass, Callsign). Only the small second line
  under each name ("people", "messages") is dropped, because landscape has
  half the height.
- The header and tab bar are a little tighter, so the content gets the room.
- The tab bar is nearly solid in landscape, so content scrolling under it
  doesn't show through.

## Tested in a real browser

| | before | after |
|---|---|---|
| Rotate a running app to landscape | 0 px wide, no tab names | full screen, all 6 names |
| Small / mid / large phones in landscape | 0 px wide | full width |
| Rotate back to portrait | fine | fine |
| Tablet and desktop | 460 px card | 460 px card — unchanged |

Every tab checked in landscape: each fills the width, nothing scrolls
sideways.

## One side effect, deliberately kept

The old rule hid tab names on **desktop and tablet** too, because any screen
wider than it is tall counted as "landscape". They now show there as well,
matching the phone. That hiding was never intended.

## How I checked — including a mistake I nearly made

I rendered the app in a headless browser and measured it. Twice the test
itself misled me, and I checked before trusting it:

- The app went blank after a second in **both** orientations — but that's
  because there is no internet in the test environment, so the sign-in code
  re-hides the app. Not a bug on your phone.
- Some runs showed a huge unstyled page. The stylesheet loads *after* the
  page (a speed trick), and the test was measuring too early. The test now
  waits for it.

Had I not checked either, I'd have "fixed" problems that don't exist.

## Files

```
css/app.css        the landscape fix
app/index.html     stylesheet version bumped, so phones fetch the new one
sw.js              cache bumped, so installed apps update
```

Built on your live repo, which already has the moderation rulebook — so this
does not undo it.

`js/nsfw-model.js` is still in the repo. It's no longer loaded, so it's
harmless, but it can be deleted.
