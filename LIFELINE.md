# Lifeline — Wireline when the internet is taken away

Naluno exists because Uganda cut social media and then the whole internet,
and people could not reach the ones they love. In both the 2021 and the
January 2026 shutdowns the internet went dark and VPN servers were blocked
too — **but voice calls and basic SMS kept working.** Lifeline is built on
that fact rather than on hope.

## Three situations, three routes

Wireline already queues a message it cannot send. Lifeline actually
**delivers** it. When a text message cannot go out normally, it is still
queued for the internet **and** handed to Lifeline, which tries:

| | situation | route |
|---|---|---|
| 1 | **Blocked** — internet up, Naluno or Google blocked | **Relay**: sealed packets go to a dead drop on Naluno's own domains, which never needs Google sign-in |
| 2 | **Shutdown, nearby** — no internet at all | **Mesh**: phones pass sealed packets to each other over Bluetooth/Wi-Fi until one reaches the recipient |
| 3 | **Shutdown, abroad** | **SMS**: the message rides inside an ordinary text message — the thing that survived both shutdowns |

Every route carries the **same** message id, so when the internet returns and
the ordinary copy arrives too, the thread shows the message **once**.

## The two rules I would not bend

**Nothing unsealed ever leaves.** Mesh relays are strangers' phones and SMS is
readable by the carrier and the government. If a message cannot be sealed —
because Naluno has no stored key for that person — Lifeline **refuses and
says so** instead of quietly sending readable text. Keys are now stored
durably the moment Naluno learns them, so a restart in the middle of a
shutdown does not leave you unable to write safely.

**Packets name nobody.** No sender, no recipient, no callsign. Each pair of
people can compute a shared **tag that changes daily**, and that is all a
packet carries. A relay, a carrier or an observer sees random bytes under a
random label. The recipient recognises the tag, and that alone tells them who
it is from. The mesh advertises a rotating neutral name, never your callsign,
so a phone cannot be followed around a city.

## What the tests actually showed

**Cryptography (19 checks, real keys):** a stranger cannot open a message or
pose as your contact; one flipped bit is rejected; neither the text nor either
person's id appears in the packet; a packet carried for two days still opens.

**SMS size, measured:** *"I am safe"* = **one SMS**. A full sentence = **two**.
The encoding stays inside the GSM-7 alphabet, so it does not fall to the
70-character Unicode limit. Long messages cost more segments — your carrier's
international rate applies, and that is the honest price of the route.

**Mesh, simulated over 48 hours with phones moving normally:**

| neighbourhood | delivered | median |
|---|---|---|
| dense city, 600 phones in 3×3 km | 8/8 runs | 4.5 h |
| neighbourhood, 300 phones in 3×3 km | 8/8 runs | 3 h |
| sparse town, 100 phones in 5×5 km | 8/8 runs | 6.7 h |

Once delivered, receipts spread and **every carrier deletes its copy** — no
phone is left holding someone else's message. Copies are capped by design, so
it does not flood a city's batteries.

**Relay (6 checks through the real worker):** a message dropped in Kampala is
picked up and opened in London **with no Google sign-in**; the stored record
contains no text, no sender, no recipient; other people's tags get nothing;
garbage is refused; flooding is slowed.

**Wiring (18 checks):** blocked send → relay → lands in the right thread with
the same id; polling twice does not duplicate; an SMS pasted with chatter
around it is found; two messages in one SMS body both work; a message already
received by relay is not added again by SMS.

## Translation between distant frequencies

Spark translates between two people standing together. Wireline threads can
now do the same across countries: open a chat, tap **Translate this chat**,
choose the language they write in, and their messages appear in yours,
**under** the original — a translation never replaces someone's own words.

It uses Spark's engine, so the offline Luganda book works with no internet.
It translates on the reading side, so it works even if the other person's
Naluno is older, and only their messages are translated, never yours.
16 checks, including that a translation cannot inject HTML.

## Honest limits — please read these

- **Mesh reaches as far as a chain of Naluno phones reaches.** Tens of metres
  per hop. It crosses a market, a campus, a dense neighbourhood. **It cannot
  leave the country.** SMS is the route abroad.
- **Mesh delivery is eventual** — hours, not seconds — and depends on how many
  Naluno phones are moving nearby. With few users it is slow or does not
  arrive. The figures above assume hundreds of phones.
- **The browser cannot do mesh.** Phone-to-phone needs the Android app and
  Google Play services. Relay and SMS work everywhere.
- **The mesh plugin is written but has never been compiled or run.** It needs
  Android Studio and two physical phones. Everything else in this package is
  tested; that file is not. Treat it as a first draft.
- **SMS costs money**, and the recipient must have Naluno to read it.
- **The relay only helps if one of its domains is reachable.** If the block is
  total, mesh and SMS are what remain. Put the relay behind several domains,
  and prefer a provider that supports Encrypted Client Hello so one name
  cannot be picked out and blocked.
- Lifeline protects **what** you write and **who** you write to. It is not
  anonymity: a carrier still sees that your phone sent an SMS, and anyone
  nearby can see a phone using Bluetooth. Please do not present it as more
  than it is to people who may be at risk.

## Files

```
js/lifeline.js             sealing, daily tags, SMS codec, mesh router
js/lifeline-wire.js        keyring, outbox, relay polling, SMS import, thread bar
js/wireline-translate.js   translation for a thread
js/wireline.js             stable message id on the queue + hand-off to Lifeline
app/index.html, css/app.css, manifest.json (share target), sw.js
workers/economy/handler.mjs        the relay dead drop
workers/economy/lifeline.test.mjs  NEW tests
workers/economy/economy.test.mjs   restores the suite to green (see note)
NalunoMeshPlugin.java, MainActivity.java, AndroidManifest.xml   the mesh
```

**Note on `economy.test.mjs`:** your live repo had the new `screen.mjs` from
the moderation work but the **old** test file, so the suite was already
failing before I touched anything. The updated file is included, and both
suites now pass: **41/41 and 6/6**.

## Deploy

1. Push the web files.
2. `cd workers/economy && npx wrangler deploy` — the relay lives there.
3. In Firestore, add a TTL policy on `lifelineDrops.exp` so dropped packets
   delete themselves, and deny all client access to that collection.
4. Android: add `implementation 'com.google.android.gms:play-services-nearby:19.3.0'`,
   put `NalunoMeshPlugin.java` beside `MainActivity.java`, build, and test the
   mesh with two phones in aeroplane mode with Bluetooth on.

## What I would do next

- **Move getnaluno.com behind Cloudflare** and add more relay domains. Right
  now one domain is one thing to block.
- **A "shutdown mode" screen** that explains plainly what still works.
- **Voice notes over mesh** — they are too big for SMS, but a mesh can carry
  them.
