# Naluno release gate

**Nothing ships unless this passes:**

```
node tests/gate/run.cjs
```

It runs in about 10 minutes and ends with `gate PASS` or `gate FAIL`. A zip is
only made after `gate PASS`, and the report (`tests/gate/last-run.json`) goes
with the build notes.

## Why it exists (21 Oct e)

Updates kept breaking things that had worked. Looking back over the builds, the
breaks came from four places:

1. **Tests that read the code instead of using the app.** Most test files check
   that a line of code is present. A change can keep the line and still break
   what people do. On 14 Oct, for example, push addresses moved to the vault and
   no phone could save one any more. Every text check still passed.
2. **The real-phone simulators lived only in one work session.** The two-phone
   call matrix, the console run and the update run were rebuilt by hand and run
   now and then. They were never kept in the project, and they were never run on
   every build.
3. **A changed file that kept its old `?v=` stamp.** Phones kept the cached old
   copy, so half the app ran one version and half another. Build 20d did this
   with `js/pwa.js`.
4. **Uploads and deploys that did not match the build.** A file was missed in an
   upload, or a worker was not redeployed. Also, the economy worker's version
   stayed "2.15.0-reach" through several builds, so nobody could tell which one
   was live.

The gate closes each of these:

| What | Where |
|---|---|
| Every unit test file | `js/*.test.cjs`, `workers/*/*.test.mjs` |
| Stamps and versions agree: every changed file has a new `?v=`, and sw.js, the app, the console and both workers name the same build | `release.cjs --check` |
| One phone: every tab opens and every ordinary button is tapped, with no page error | `flows/smoke.cjs` |
| Two phones: Wireline both ways, nothing readable stored, the alert leaves fast and carries no words | `flows/wireline.cjs` |
| Calls on Wi-Fi, mobile to mobile (relay only), video, cold relay, decline, cancel: rings, connects, sound (and picture) both ways, alert sent, both screens close | `flows/calls.cjs` |
| Drop + "also stop them reaching me": menus, the block is saved, their message and call are refused, Undo | `flows/block.cjs` |
| Compass: AI notice, a small ⚑ per answer, the report sends the answer and not the question | `flows/compass.cjs` |
| Console: the password gets you in (never a lockout), every tab draws, Legal's own password, keep marks audited, reports about a person, Measures | `flows/console.cjs` |
| A new phone: welcome → agreement → country → tour → sign in; the "updated Terms" notice shows once to people who agreed before | `flows/opening.cjs` |
| Updates: reach an open app without a tap, wait during a call, a closed phone opens on the newest, a half upload does not loop | `flows/update.cjs` |

After every upload, open the console's **Health → Is everything uploaded?**
It compares every file on getnaluno.com, and both workers, with
`RELEASE.json`.

## Running it

- Node 18 or newer.
- `cd tests/gate && npm install` once. This installs Playwright and node-turn.
  A Playwright installed globally works too.
- Calls on "mobile" networks use a TURN relay on `192.0.2.2`. The runner adds
  that address to this machine if it can (as root). If it cannot, those calls
  are reported as **not run**, and that fails the gate unless you pass
  `--allow-not-run`. Use that flag only when you say so in the build notes.
- Options: `--only=calls,wireline`, `--skip-unit`.

## Rules

- **When a behaviour changes on purpose**, change the flow that checks it in the
  same build, and say so in the build notes. Never weaken or delete a check to
  get a pass.
- **When something breaks in the field**, add a check here that fails on the
  broken build before fixing it.
- **A check that could not run** is reported as not run, never as passed.
