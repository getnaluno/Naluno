# Call stress test — 1,000,000 calls (build 2026-09-28h)

## How it was run, and why not live
A real million calls against the live Firebase project would have cost real
money and broken limits (below). So there were three parts:

1. **Simulation.** A model of the call signalling (how both phones write and
   read the call record), run with 1,000,000 calls all started inside the
   same minute. There were 2.2 million users, callers and receivers were
   picked at random, and the network was realistic, with 1% of messages
   delayed 5–15 s. It included the awkward cases:
   - two people calling each other at once (2% of calls);
   - phones dying mid-call (1%);
   - receivers offline;
   - Answer landing at the same instant the caller hangs up;
   - Cancel tapped while the camera was still opening;
   - network drops that replay old rings.

   It was run once with the old behaviour and once with the new.
2. **The real app in a browser.** The real call code ran with a stand-in
   database, starting calls from and receiving calls in Frequencies, a chat,
   a Broadcast, a Signal, the Band list, a Band room, Compass and Callsign.
3. **Capacity and cost** for a real million at once.

## 1. Simulation: 1,000,000 calls in one minute

| Problem | Before | After |
|---|---:|---:|
| Busy person: the caller rang a full minute, never told | 129,478 | 16 |
| A ring cut off by another call (never answerable) | 50,630 | 0 |
| Dead call (answered after the caller hung up) | 9,669 | 0 |
| Ghost ring (still ringing long after the caller left) | 4,748 | 225 |
| Crossed calls where nobody connected | 4,713 | 1 |
| Live call taken over by a second ring | 2,790 | 0 |
| Phone stuck on a call screen at the end | 0 | 0 |
| **Total** | **202,028** | **251** |

- Connected calls rose from 341,765 to 364,912.
- Crossed pairs that connected rose from 55 to 3,288.
- The 251 left all depend on the network, not the code:
  - Rings that stopped late on very slow connections (a hang-up needs up
    to 80 s to arrive).
  - Busy replies to people who went offline.
  - Receivers whose phone had died.

  These are timing limits of any phone call over mobile data.

## 2. Real app in a browser
- 16 outgoing cases from four places, each ending four ways (lobby Back,
  cancel while ringing, the other person hanging up, the phone's Back):
  **16/16 pass**.
- 9 incoming cases (declined, missed, dismissed with Back): **9/9 pass**.
- 13 race cases: **13/13 pass**. They cover:
  - an incoming call while you are in the lobby, while ringing out, or
    while the camera is still opening;
  - crossed calls, from both sides;
  - Answer after the caller hung up;
  - another device answering;
  - a busy reply;
  - an old ring;
  - the 40 s connect limit;
  - the 80 s ring limit;
  - Cancel while the camera opens.

  The old code failed 12 of the 13.
- Random fuzz on the final code: 420 random call cycles across all app
  locations. None were left stuck, left the camera on, lost the screen you
  were on, or broke Back.
  - 4 checks caught the phone's Back history in the tenth of a second while
    it was still stepping back. A re-check a moment later showed it clean.
- App test suites 31/31 and worker suites 10/10 (money, console lock-out,
  adversary) pass. Journeys and gestures match the previous build.

## 3. A real million at once: limits and cost
- **Write limit.** Firestore limits a collection to about 500 new records
  per second when a time field is indexed. A million calls in a minute is
  about 16,700 per second, so most calls would have failed to start. The
  three call time fields are now exempt from indexing (see the upload
  notes, step 3). No query needs them.
- **Firestore cost.** About 16 writes and 25 reads per call. For 1,000,000
  calls:
  - writes: 16M × $0.09 per 100k ≈ $14;
  - reads: 25M × $0.03 per 100k ≈ $7.50.
- **TURN relay** (Cloudflare, $0.05/GB after the first 1,000 GB). This is
  the real cost. Roughly 1 call in 5 needs the relay, and a relayed video
  call sends about 5 Mbps. That is about 7.5 TB per minute of talk: about
  $325 for the first minute, and much more for longer calls.
- **Workers.** The TURN-credential worker gets one request per call, and a
  million is over the Workers free plan (100,000 requests a day).

## Recommended before relying on it
Make one real call between two phones on different networks (Wi-Fi and
mobile data). Try the crossed-call case once: both of you tap Call together.

Sources:
- [Firestore pricing](https://cloud.google.com/firestore/pricing)
- [Firestore best practices (500 writes/s with sequential indexed fields)](https://firebase.google.com/docs/firestore/best-practices)
- [Firestore quotas](https://firebase.google.com/docs/firestore/quotas)
- [Cloudflare TURN FAQ (pricing)](https://developers.cloudflare.com/realtime/turn/faq/)
