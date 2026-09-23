# Everything requested — one upload

Built against **f7deb80**. Fifteen files, all ones I changed. This completes
what the last two packages started, plus the two remaining pieces: sharing a
Broadcast to a Signal, and saving Broadcasts for offline watching.

---

## NEW this round

### A Broadcast can now be shared TO a Signal

Last round built the *display* half — a Signal linking to a Broadcast showed
a "Watch" button — but nothing created that link. Reading the code closely,
the composer already had a `linkedBroadcastId` field and a picker; the gap
was a direct entry point and one field-name mismatch (the composer writes
`linkedBroadcastId`, the display code was reading `broadcastId`).

**Fixed both.** Open a Broadcast, tap **To Signal**, and the Signal composer
opens with that Broadcast already selected in the link picker — no hunting
through a dropdown. The picker still offers "None" if you change your mind.

### Saving Broadcasts for offline — done properly, not bolted on

I held this back last round rather than half-build it. It is now a standalone
module (`js/broadcast-offline.js`) with its own tests.

- **Tap Save** on any Broadcast. **Saved Broadcasts** lives in Callsign
  settings — a budget bar, what is used, and a Remove button per item.
- **Playback falls back to the saved copy automatically** when the network
  copy cannot be reached, with a small **"Playing your saved copy · offline"**
  chip — the whole point of saving something is not needing to remember you
  did.
- **A visible storage budget** (500 MB by default). When a new save will not
  fit, the **oldest-WATCHED** item is evicted first — not oldest-saved.
  Something saved months ago and watched yesterday is clearly still wanted;
  something saved yesterday and never opened is the better thing to let go
  of. If nothing can be freed, the save is refused with a plain reason rather
  than silently exceeding the budget.
- Size is **measured from the actual bytes stored**, never guessed from a
  `Content-Length` header that can be missing or wrong.
- If a saved Broadcast is later taken down, **it is not deleted out from
  under the person** — it is marked "No longer public" in their downloads.
  They saved it; removing it silently would be a second, unannounced action.

**My own adversarial test caught a real bug before this shipped**: the
budget-setting function silently floored any request under 50 MB, so setting
a smaller budget did nothing and the app could exceed what someone actually
asked for. Fixed to a 1 MB floor that only rejects genuine mistakes (zero,
negative, garbage).

**Honest limits, stated in the module and worth repeating here:** this is
browser Cache Storage — bounded by whatever the browser allows a site, and it
can be evicted under OS storage pressure like any site data. It is a strong
best-effort, not a guarantee. Only the media is cached; comments and live
counts stay live.

---

## From the last two rounds, included here as one complete set

**Your SMS question, answered in the fix.** The receiver is the final
destination — the packet is sealed for them alone, so there was never a risk
of anyone reading someone else's messages. But the experience was wrong: the
SMS now carries a **tappable link** instead of a blob to paste. Tap it, Naluno
opens, the message lands in the right conversation.

**Compass** no longer rejects a password you know. Several stored copies had
drifted; unlocking now accepts any of them and re-syncs the rest. A
**"Forgot it? Reset"** on the lock screen clears every copy for a fresh start.

**Share links** are readable — `…/b/<id>/rain-over-kampala` — with the id
first so it is never ambiguous. Removing `workers.dev` needs a Cloudflare
route pointed at `getnaluno.com`, which is a hosting change, not code; the
steps are in `js/broadcast-core.js`.

**Signals** show who watched and how they felt — 👍 🔥 🐐 ❤️ — with two
things better than WhatsApp: reactions belong to the *segment* a person is
looking at, not the whole Signal, and the person watching sees the reactions
too, not just the owner. Enforced by `firestore.rules`, not only by the app.

**Scheduled and private Broadcasts** are in the publish sheet, and enforced
in the rules — a private Broadcast is unreadable by anyone but its creator
even if someone has the document path directly.

**The console report queue** now shows the reported clip with a player
instead of a bare text row, urgent categories (sexual, terrorism, and the
rest) are taken off the feed the moment the report lands rather than at the
end of a chain that could silently fail, and the reported person is told with
an in-app notice carrying an Appeal button.

---

## Tests — run before this zip, not after

- **Worker: 84/84**
- **All 10 repo `.test.cjs` suites**
- **26 checks** on offline saving — including the budget bug above
- **29 checks** on Signals, scheduling, privacy, and the rules that enforce
  them
- **21 checks** on the SMS link and Compass

## Files

```
js/broadcast-offline.js  NEW — offline saving, its budget, and eviction
js/compass.js            openSignalLinkedTo(); the "To Signal" entry point
js/broadcast-space.js    Save button, offline-fallback playback, To Signal
js/signal-social.js      field-name fix (linkedBroadcastId)
app/index.html           Save/To Signal buttons, offline chip, Downloads screen
css/app.css              styling for all of the above
js/lifeline-wire.js, index.html      the tappable SMS link
js/broadcast-core.js, js/broadcast-composer.js   schedule + private
firestore.rules          private/scheduled/viewer enforcement
js/signal-ui.js          per-segment social row
workers/economy/handler.mjs, screen.test.mjs
sw.js                    cache bumped
```

## Deploy

1. Push the web files.
2. `firebase deploy --only firestore:rules` — required for private and
   scheduled Broadcasts to be genuinely protected, not just hidden in the app.
3. `cd workers/economy && npx wrangler deploy`
