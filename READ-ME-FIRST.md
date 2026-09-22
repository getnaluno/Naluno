# Two fixes: the in-call chat bubble, and the translate bar

## 1. The bubble — my mistake, and how it happened

I built the Lifeline package from commit `405e6ac`. At that commit, in-call
Wireline **did not exist**. It was added afterwards, in `029bb90`, touching
`calls.js`, `app/index.html`, `css/app.css` and `wireline.js`.

My package shipped `app/index.html` and `js/wireline.js` from the **older**
commit. Deploying it put those two files back, which removed:

- the whole `#incallWire` sheet markup (`incallWireMsgs`, `incallWireInput`,
  `incallWireForm`, `incallWireClose`, `incallWireTitle`),
- `wirelineIsViewing()` from `wireline.js`,
- the call that repaints the sheet when the thread changes.

`calls.js` survived untouched, so the button still called `openIncallWire()` —
which added the `wire-open` class to nothing, then hit `renderIncallWire()`
and threw. The bubble looked dead because it had nothing to open.

**Restored:** the sheet markup back inside the live call section, the CSS, and
`wirelineIsViewing()`. The sheet is `position: absolute`, never `fixed`, so it
slides up **inside** the call — the other person stays on screen, your
self-view moves out of the way instead of disappearing, and the hangup button
stays where it is. Read receipts work from the sheet again, which they had
stopped doing.

Your own `js/incall-wire.test.cjs` now passes — it was failing on the live
repo before this. I updated four assertions in it for the new cache-bust
stamps (`2026.09.23a`) and added four checks: the send form and close button
exist, the bubble cannot switch tabs, and `wirelineIsViewing` is present.

**To avoid this repeating:** when I hand you a package, files I did not change
should not be in it. `app/index.html` and `wireline.js` were in that bundle
because Lifeline genuinely edited them — but built from a stale clone. From
now I will diff against the live repo immediately before packaging and tell
you if anything newer would be overwritten.

## 2. The translate bar was real, but unreachable

The script and the bar were deployed correctly. The problem was where I hooked
it: at the **bottom** of `renderThreadMessages()` — and that function
**returns early when a thread has no messages yet**. So in a new or empty
chat the bar never rendered at all. In a chat with messages it should have
appeared above the composer.

Moved to the top of the function, so it always renders. Open any Wireline
chat and you will see **"Translate this chat"** just above where you type;
tap it, choose the language they write in, and their messages appear in yours
underneath the original.

## 3. Two failing tests that are NOT from this

`js/ads-inventory.test.cjs` ("ads pack cache-bust") and
`js/console-pass.test.cjs` already fail on your live repo, before any of
today's changes. They look like the same pattern — a file changed without its
version stamp being bumped, or an older file uploaded over a newer one. I have
not touched either. Worth a look, as it suggests something else was
overwritten too.

## Files

```
app/index.html          in-call sheet restored, cache-bust to 23a
css/app.css             the sheet's styles
js/wireline.js          wirelineIsViewing() restored; translate bar moved up
js/incall-wire.test.cjs stamps updated + 4 extra checks
sw.js                   cache bumped
```

Nothing from Lifeline or the moderation work is affected — both worker suites
still pass 47/47, and the Lifeline and translation hooks in `wireline.js` are
intact.

## Test it

- **Bubble:** start a video call, tap the speech bubble. The sheet slides up
  over the bottom of the call; both videos keep playing. Type, send, close.
- **Translation:** open any chat; the bar sits above the composer.
