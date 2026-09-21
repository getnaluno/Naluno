# Moderation: topless rejected, and "explicit" defined precisely

Includes last round's rebuild (not yet deployed), so this is one complete set.

## Your two decisions

**Topless women and breastfeeding are rejected**, for now. It is one line in
the rulebook to change later — see `MODERATION-RULEBOOK.md`.

**"Explicit" is now defined explicitly**, in one place, and applied the same
way by the detector and by human reviewers:

- **Rejected:** exposed genitals, exposed anus, an exposed female nipple
  (including breastfeeding), nudity, and sexual acts even when the genitals
  are hidden.
- **Accepted however sexy:** bikinis, lingerie, thongs, shirtless men,
  cleavage, twerking, pole and stage shows, suggestive poses, bedroom and
  beach photos — as long as nipples and genitals are covered.

**The test is what is exposed, never how much skin shows or how provocative
it looks.**

## How errors are kept down

**Confidence bands, not a single line.** Each rule has a *reject* level and a
lower *hold* level. A confident detection rejects; an uncertain one goes to a
person. So a misread costs a short review, not a wrongful rejection. The
topless line is set higher than the genital one because cleavage and bikini
tops are what it most often misreads.

**Videos need agreement.** This is the biggest protection for "sexy shows". A
video over 8 seconds is checked at 8 frames. Previously, **one** frame that
looked explicit rejected the whole video — so a single misread moment in a
dance performance killed it. Now a video is rejected only if one frame is
near-certain or **two or more** frames agree. One questionable frame out of
eight sends it to a person instead. Real explicit video shows it repeatedly.

**Reviewers use the same rules.** The rulebook sits at the top of the
console's Trust tab, and each held item says why in plain words — and for a
video, which frame to check. A test confirms the console and the detector use
identical wording.

**Uploaders are told what was found and what is allowed.** A rejection now
says, for example, *"it shows an exposed female breast. Naluno allows
swimwear, lingerie, shirtless men and sensual content — not exposed genitals,
exposed female breasts, or sexual acts."* Someone posting a legitimate
swimwear shot can see where the line is.

## What I tested, and what that proves

- **Your three real images**, through the shipped code and the real model:
  explicit act → held; lingerie → accepted; shirtless man → accepted.
- **38 rulebook cases**: every explicit type rejected; ten "sexy show" scenes
  accepted; uncertain cases held rather than rejected; the video agreement
  rule; phone and server identical on 5,000 random inputs; console wording
  matches the detector's.
- **Economy suite 41/41**, including new tests through the real endpoint that
  topless is rejected even for a trusted publisher, and that a stage-show
  video with one misread frame is held rather than rejected.

**Being straight about the limit of that:** the "sexy show" cases are the
detections the model *would* report for those scenes, not real photos. They
prove the rules draw the line correctly. They do not prove the detector
always reads a scene correctly — only real uploads can do that. The console
now records the score and reason for every held or rejected item, so after a
few weeks you will be able to see real misreads and adjust the bands with
evidence rather than guesswork.

## What still gets through

A sexual act where nothing is exposed and there is no video-player overlay.
The detector sees body parts; if none are exposed, it has nothing to find.
Reports and review cover this.

## Files

```
js/nudenet.js                    detector + rulebook (NEW last round)
models/nudenet/320n.int8.onnx    the model, 3.1 MB (NEW last round)
js/admin-console.js              rulebook on the review tab; plain reasons
admin/index.html                 rulebook styling
js/broadcast-composer.js         detector verdict first; explains rejections
js/compass.js                    Signals screened; explains rejections
js/broadcast-core.js             holds apply to trusted publishers
js/signal-core.js, signal-ui.js  held Signals hidden from connections
js/auth.js                       held Signals kept out of the cache
app/index.html                   loads nudenet.js
sw.js                            cache bumped
workers/economy/screen.mjs       same rulebook; heuristic may only hold
workers/economy/handler.mjs      saves reason, frame and engine for reviewers
workers/economy/economy.test.mjs tests (one changed last round, see before)
MODERATION-RULEBOOK.md           the rules in plain words — keep for reviewers
```

## Deploy

1. Push everything, **including `models/nudenet/`**.
2. **Delete** `js/nsfw-model.js` and `models/nsfw/`.
3. `cd workers/economy && npx wrangler deploy` — **required**, or the server
   keeps the old rules.
