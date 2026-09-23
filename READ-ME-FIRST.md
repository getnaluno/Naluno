# Points recovery + the counting fixes you never received

Built against **6c57600**, the live commit. I diffed every file in this
package against it before packaging: all nine are files I actually changed,
none would overwrite anything newer.

## First — the build you never got

The counting audit package was never committed. I checked: `fsIncrement`, the
share event, the ads fix and the console refresh hold are all absent from the
live repo. **Everything from that package is folded into this one**, rebuilt
on 6c57600, so there is one thing to deploy rather than two.

That package fixed:

- **Points being destroyed.** Totals were read from a Worker's memory and
  written back whole. A cold isolate starts at zero, so someone on 500 points
  could be written down to 3. Totals now move by Firestore **increment** — no
  read step, nothing to lose.
- **Replays double-counting.** De-duplication was also in memory. The event id
  is now claimed in Firestore before scoring.
- **Sharing never counting.** `BROADCAST_SHARE` is worth 2 points and the app
  never sent it. Now emitted when a share actually succeeds.
- **Ad counters being reset** by one phone writing an absolute count.
- **Reward simulation** computed from a nearly-empty isolate memory. It reads
  the stored profiles now.
- **The console refreshing while you read.** Held until you are done, with a
  "New activity · Refresh" button.
- **Four tests pinned to a fixed date**, failing whenever anything was rebuilt.

## New — recovering the lost points

The ledger survived. Every scored event wrote its own row keyed by event id,
so rows were never overwritten — only the summed totals were. Adding the rows
back up gives what each total should have been.

**In the console: Community → "Repair contribution totals".**

- **Check what would change** — a dry run. Writes nothing. Shows rows scanned,
  people affected, points to restore, and the first fifteen changes.
- **Apply the repair** — asks for confirmation, writes the totals, logs to the
  audit trail.

Run the dry run first, and run it again after applying: if it reports
`more rows remain`, or anything was skipped, a second pass finishes the job.

### Two safety rules, and why

**It never lowers a total** unless you explicitly force it. The fault made
totals too *small*. If a stored total is *higher* than the ledger says, that
points to missing ledger rows rather than extra points — and silently deleting
someone's points to "fix" them would repeat the original mistake in the other
direction.

**A profile it cannot read is skipped, not assumed to be zero.** My own
adversarial test caught this one: treating a failed read as zero made the
"never lower" rule blind, so a stored 900 could have been written down to 3
purely because a read failed. Absent (404) means zero; an error means unknown,
and unknown means leave it alone.

## Adversarial testing — 19 checks, all passing

I tried to break the repair rather than confirm it works:

- an **empty ledger does not wipe everyone to zero**
- a stored total **higher** than the ledger is refused (and says so)
- `force: true` is required to lower one
- an **unreadable profile is skipped**, and a failed read cannot write 900 → 3
- **1,200 rows page correctly** with none lost or double-counted
- a **reversal row subtracts** rather than being ignored
- a row with **no user** is not credited to anyone
- **junk numbers** count as zero rather than NaN
- the repair still applies if the **audit write fails**
- **no sign-in is refused**
- nothing to change → writes nothing even with `apply`

Plus the full suite: **10/10 repo tests, 47/47 worker tests, 29/29 counting
audit checks.**

## Honest limits

- The repair rebuilds totals from ledger rows. **If a ledger row itself was
  never written** — an event lost before it reached the worker — those points
  cannot be recovered, because nothing recorded them.
- Run it when things are quiet. It reads the ledger, then writes totals; an
  event landing in between would be overwritten by the absolute write. Its row
  survives, so running it again picks that up.
- It repairs `contributionProfiles` only. Broadcast view counts and ad
  counters were never affected by this fault.

## Files

```
workers/economy/handler.mjs   atomic totals, durable de-dup, real simulation,
                              and the new /v1/admin/recompute-profiles
js/admin-console.js           repair buttons + refreshes held while you read
admin/index.html              the Refresh pill, stamp bump
js/broadcast-space.js         BROADCAST_SHARE emitted
js/ads.js                     no absolute-count fallback
js/*.test.cjs (4)             unpinned from fixed dates
```

Deploy the web files, then `cd workers/economy && npx wrangler deploy` — the
worker must go first, or the repair button has nothing to call.
