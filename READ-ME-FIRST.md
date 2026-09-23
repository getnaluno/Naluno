# One upload: reports, notices, Compass, and share-link previews

Everything from the previous round **plus** the link job, in a single package
built against **7deaaa4**. All 12 files are ones I changed; I diffed the whole
package against live before handing it over.

---

# NEW: share links now carry a preview

A link's picture and title come from `og:` tags in the page it points to.
`getnaluno.com` is static hosting, so **every Broadcast served the same tags**
— WhatsApp showed the same generic image for all of them, and nobody could
tell what they were being sent.

Share links now go through the worker: `…/b/<id>`. That page returns the
Broadcast's **own thumbnail, its title and who made it**, then forwards
straight into the app. It returns a normal page rather than a redirect on
purpose, because several link crawlers do not follow redirects and would show
nothing at all.

**The safety part.** A Broadcast that is deleted, hidden, held or unlisted
gets **no preview** — no title, no picture, just "This Broadcast isn't
available". Without that, a Broadcast removed after a report would keep
showing its own snapshot in every chat it had been shared into. Previews are
cached for five minutes so a takedown takes effect quickly.

`NALUNO_LINK_BASE` in `js/broadcast-core.js` is one constant — point it at a
custom domain whenever you want prettier links.

**7 tests**, including: a taken-down Broadcast leaks neither title nor
picture; a title containing `<script>` cannot break out of the page; a
`javascript:` thumbnail is refused; junk paths are not treated as ids; and it
still forwards correctly with no service account, just without a picture.

---

# From the previous round (unchanged, included here)

**The console player is back, on the reports themselves.** Reports were a text
table — you could read that something was reported but not see it. They now
render with the same player, the reporter's words, whether it is still on the
feed, and Action / Dismiss / Take down / Put back. Urgent reports outlined in
red.

**Why your test report never disappeared.** The removal was the *last* thing
the report handler did, after scoring and several other writes, and only ran
when a service account was configured — yet the response said `hidden: true`
regardless. The existing test asserted that false success. Removal now happens
**immediately** after the report is recorded, and a failure is reported as
`hide_error` instead of claiming success. **Check `/health` for
`hasServiceAccount`** — without it nothing can be removed automatically.

**Terrorism and the rest.** terrorism, recruitment, child exploitation, sexual
exploitation and threats of violence now take a Broadcast off the feed
immediately, recorded as `reported-<code>`. Sexual is hidden outright. An
ordinary report changes nothing.

**The owner is told, and can appeal.** Wireline is end-to-end encrypted and
the worker holds no keys, so it cannot send a Wireline message — and a
platform message disguised as a person's would be dishonest anyway. It writes
a notice shown at the top of Wireline, clearly from Naluno, with an **Appeal**
button feeding the appeals the console already lists.

**Compass kept losing its password** because the vault cache is memory-only —
empty after a restart or offline, so the lock check said "not locked". A local
copy of the hash now holds it.

**Shared links open the Broadcast** instead of flashing Frequencies first.

---

## Still owed: a clearer explanation of "Open a Naluno SMS"

Noted and kept. We return to it now the link job is done.

## Tested

- Worker **57/57** (7 new link tests, 3 report tests)
- All **10 repo tests**
- **30 adversarial checks** from the previous round, re-run and passing

## Files

```
workers/economy/handler.mjs    link previews, removal-first, terrorism, owner notice
workers/economy/link.test.mjs  NEW
workers/economy/economy.test.mjs  the test that asserted a false success, corrected
js/broadcast-core.js           share URL -> preview route; links open directly
js/admin-console.js            the player on reports
js/notices.js                  NEW — notice + Appeal
js/compass.js                  password survives restarts and offline
app/index.html, css/app.css, admin/index.html, firestore.rules, sw.js
```

## Deploy

1. Push the web files.
2. `firebase deploy --only firestore:rules`
3. `cd workers/economy && npx wrangler deploy` — **required**: share links now
   point at the worker, so without it a shared link will not open.

Then send yourself a Broadcast link and check the preview shows that
Broadcast's own picture.
