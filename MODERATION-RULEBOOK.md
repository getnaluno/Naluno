# Naluno moderation rulebook

This is the standard the detector applies **and** the standard human reviewers
use in the console. It is written into the code once (`js/nudenet.js` and
`workers/economy/screen.mjs`, identical) and shown on the console's review tab.

## Explicit — rejected

A photo or video is explicit if it shows **any** of these, of any person, in
any setting:

1. **Genitals** — exposed male or female genitals.
2. **Anus** — exposed.
3. **Female breast** — an exposed female nipple ("topless"). **This includes
   breastfeeding, for now.** Owner decision, to revisit as Naluno grows.
4. **Nudity** — two or more of the above exposed together.
5. **Sexual acts** — intercourse, oral sex, masturbation, sexual touching of
   genitals — **even if the genitals themselves are hidden.**

"Pornographic" means content made to show 1–5. A video is pornographic if
those things appear in it; its title, music or intent do not change that.

## Not explicit — accepted, however sexy

- Bikinis, swimwear, lingerie, underwear, bodysuits — nipples and genitals
  covered.
- Thongs and G-strings: exposed **buttocks** are fine (the anus is not).
- Shirtless men.
- Cleavage, sideboob with the nipple covered, midriffs, bare backs and legs.
- Dancing, twerking, pole and stage shows, suggestive poses, sensual
  movement, modelling, fitness, beach, pool and bedroom photos.
- Kissing and affection between clothed people.
- Tight, short or sheer clothing that still covers nipples and genitals.

**The test is what is exposed — never how much skin shows or how provocative
it looks.**

## How the machine applies it

The detector reports body parts with a confidence from 0 to 1. The bands are
set so that **a wrong guess goes to a person, not straight to rejection**:

| | reject | hold for a person |
|---|---|---|
| genitals / anus | ≥ 0.50 | 0.25 – 0.50 |
| female breast (topless) | ≥ 0.55 | 0.35 – 0.55 |
| two intimate parts | each ≥ 0.40 | |
| exposed bottom + a weak intimate sign (≥ 0.25) | | held |
| two or more people + a clearly exposed bottom (≥ 0.60) | | held |
| video-player screenshot | | ≥ 0.85 |

The breast line is higher than the genital line because cleavage and bikini
tops are its most common misread. **One rule:** the phone and the server use
the same code, word for word (a test checks it).

### Clothes are not skin (05 Oct)

On 02 Oct a photo of two fully clothed people in bright clothes was flagged.
The detector knows shapes only: a bright shirt over a chest or a dress over a
lap can look to it like a breast or a bottom. A person tells them apart at
once, because an exposed part is **skin** and clothing is **fabric**. So the
phone now measures what lies inside every "exposed" box:

- **Skin** of every shade, very light to very dark, in any light. Pixels too
  dark to tell count as skin. A black-and-white picture gets no allowance.
- **Fabric**: white, grey and pale clothes; blue, green, purple, yellow; vivid
  dyed reds and oranges.

When less than a fifth of an "exposed" box is skin, the finding is halved:

- a breast or bottom on fabric drops below the hold bars (a shirt, a dress);
- genitals or anus on fabric are **still held for a person**, never let out on
  this alone;
- a near-certain finding (≥ 0.80) is never reduced;
- real skin, of any colour, is judged exactly as before.

### Videos

A video is sampled at 3, 5 or 8 frames depending on its length.

- **Rejected** if any single frame is near-certain (≥ 0.80), **or** if two or
  more frames reach the reject level. Real explicit video shows it
  repeatedly.
- **Held** if only one frame reaches the reject level. One frame out of eight
  is how a dancer's turn, a shadow or a lighting flash gets misread. That
  goes to a person — it does not reject a genuine show.

Nothing explicit becomes public under these rules: anything uncertain is
held.

## What the machine cannot do

**It cannot see rule 5 when nothing is exposed.** A sexual act with the
anatomy hidden — behind a head, a hand, a blanket or an overlay — has nothing
for a body-part detector to find. Three things cover this:

- A **screenshot of a video player** is held, because that overlay is the
  usual disguise for reposted porn.
- **Reports** from users.
- **Human review** in the console.

## For reviewers

- Open **Trust** in the console; the rulebook is at the top.
- Each held item says **why** in plain words, and for a held video **which
  frame** — check that moment first.
- *"Old skin check only"* means the detector did not run (a slow phone, a
  failed download). That verdict is weak: judge the item yourself.
