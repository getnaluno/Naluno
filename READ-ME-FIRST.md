# Explicit-content detector, the report button, and the attention alert

## 1. Why the report button looked "off"

The button existed and its click handler ran. Nothing appeared because of
where the sheet lived.

The report sheet uses the `.call-overlay` class, which is
**`position: absolute`** and sits inside `#app` — a `position: relative;
overflow: hidden` box. The Broadcast space it opens from is
**`position: fixed`** at `<body>` level and covers the whole viewport. So the
sheet was laid out and clipped inside `#app`, underneath a full-screen layer.
Its `z-index: 360` was meant to win, but it was competing from inside the
wrong box.

**Fixed** by moving the sheet to `<body>` when it opens and making it
`position: fixed`. Done at open time, so it is correct however the page was
cached. A closed sheet keeps `pointer-events: none`, so it never blocks taps.
12 assertions.

Also worth knowing: **Report is deliberately hidden on your own Broadcasts**
(you get Delete there instead). If you test on your own posts you will not
see it — that part is correct.

## 2. Why the existing detector could not do this

A screening system already existed (`screen.js`, `screen.mjs`), so I tested
it against your requirement before building anything:

| scene | score | verdict | wanted |
|---|---|---|---|
| Bikini **indoors** | **0.86** | **BLOCK** | allow |
| Nudity on a bed | **0.86** | block | block |
| Bikini outdoors | 0.29 | hold | allow |
| Nudity outdoors | 0.34 | hold | block |
| Fully clothed, indoors | 0.55 | hold | allow |

**A bikini indoors scored exactly the same as explicit nudity.** It could not
tell them apart.

The cause is structural, not a tuning problem. It measures **skin area** and
**background scenery** — its idea of "swimwear" was *"there is sky in the
picture"*. Neither says anything about whether a body is covered. No
threshold change can make skin area mean clothing.

(I also checked it for skin-tone bias, since that is common in pixel
detectors. It recognised all seven tones tested, lit and in shadow — so that
suspicion was wrong, and I am not claiming it.)

## 3. What replaces it

**NSFWJS** — MIT licence, MobileNetV2, ~90% accuracy — a model that
recognises what it is looking at. Its classes map straight onto your policy:

| class | covers | your policy |
|---|---|---|
| **Sexy** | revealing, not pornography — bikinis, swimwear | **ACCEPT** |
| **Porn** | pornographic images, sexual acts | explicit |
| **Hentai** | pornographic drawings | explicit |
| Neutral, Drawing | everyday safe content | accept |

**The rule:** explicit = Porn + Hentai. Sexy is never counted.

- explicit ≥ 0.70 → **rejected**
- explicit 0.30–0.70 → **held for review** (hidden from the feed until a
  person decides)
- below 0.30 → accepted, *including* strong Sexy scores

Two thresholds rather than one because the model is ~90% accurate, not
perfect: confident cases decide themselves, and the uncertain middle goes to
a person instead of being guessed. A video is judged by its **worst** frame —
one explicit frame is enough.

## 4. The part that would have silently undone this

The server does **not** trust the client's verdict. `judgeScreenPayload()`
**re-runs the check from raw pixels**. That is a good security property —
but it meant that if I had only upgraded the phone, the server would have
re-run the old skin heuristic and **overruled the model**, and bikinis
indoors would still have been blocked.

So the model's scores now travel to the server, which decides from them —
after validating them. Malformed scores (not summing to 1, out of range,
missing classes, non-numbers) are **not trusted**, and the server falls back
to the heuristic.

## 5. The honest limit — read this

**On-device screening can be bypassed.** The model runs on the phone, so a
deliberately modified client could skip it or send a well-formed "clean"
set of scores. I tested this explicitly: a plausible forgery is accepted.

What still catches it:
- untrusted/new publishers are held regardless
- the Report button and the console review queue
- validation rejects anything malformed

**The tamper-proof version needs the model to run on the server.** The
natural option is Google Cloud Vision SafeSearch — you already have a Google
service account, and its `adult` vs `racy` split is exactly "explicit vs
bikini". But it sends images to Google, which conflicts with the principle
written at the top of `screen.js` ("never sends video to a third-party
scanner"). That is your decision to make, so I have not made it for you.

## 6. The attention alert that would not clear

Two real causes.

**A race.** Actioning a report did a fresh read, while the live listeners
separately re-commit their own cached copy whenever *any* watched collection
changes. If a users or broadcasts listener fired before the reports update
arrived, it re-committed the **old** reports — still OPEN — and the alert
came straight back. Whether it stayed gone depended on which network
response won.

**Fixed** by resolving the report locally in *both* copies the instant the
write succeeds, then recomputing. There is no stale copy left for anything to
restore. Reproduced the race before fixing it; 7 assertions.

**The second cause is not a bug.** The health label has two independent
inputs. Clear the report and, if the economy worker is degraded, the strip
correctly reads **DEGRADED** instead of OPERATIONAL. That is the worker's
service account (flagged in the last audit), not the report.

## Files

```
app/index.html              loads nsfw-model.js after screen.js
js/nsfw-model.js            NEW — the model + policy
js/report.js                sheet lifted to <body> on open
js/admin-console.js         report resolves locally; race removed
sw.js                       /models/ bypasses the SW; cache bumped
workers/economy/screen.mjs  server decides from validated model scores
models/nsfw/model.json      NEW — self-hosted model (129 KB)
models/nsfw/group1-shard1of1 NEW — weights (2.6 MB)
```

## Deploy

1. Push everything, **including the `models/nsfw/` folder** — without it the
   model cannot load and every upload quietly falls back to the heuristic.
2. `cd workers/economy && npx wrangler deploy` — required, or the server keeps
   overruling the model.

The model is **self-hosted on purpose**. The maintainer warns their hosted
copy may move, and a moderation system that silently stops working when
someone else's server disappears is worse than none.

`sw.js` sends `/models/` straight to the network: the shell cache wraps
fetches in a short timeout meant for small files, which would have cut off
the 2.6 MB first download. The browser's HTTP cache still keeps it, so it
downloads once.

## Before you rely on it

I verified the policy, the thresholds, the server validation, the fallback,
and that client and server agree — across 3,000 random score sets. What I
**could not** do in this environment is run the neural network on real
photographs. **Test it with real images — a few bikini photos, indoors and
out — before trusting it.** The thresholds are easy to adjust in both files
if they need tuning.

## Tested

34 new assertions (report sheet 12, race 7, policy 15), plus 12 on server
validation — and the repo's **existing** suites still pass: economy 36/36
and the screen contract tests. Nothing that already worked is broken.
