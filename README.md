# Naluno

A quieter way to reach people.

Live: [getnaluno.com](https://getnaluno.com)

You take a **Callsign** — a handle, not a phone number. People who know it can find you. **Wireline** is the private line between two of you. **Band** is a room that belongs to nobody; it fades when the last person leaves. **Broadcast** is what you leave behind on purpose. Calls cut through whatever else is on screen.

## Try it

Open [getnaluno.com/app](https://getnaluno.com/app/). Create a handle. Add it to the home screen. Find someone by theirs, or Spark in person.

[Privacy](https://getnaluno.com/privacy) · [Terms](https://getnaluno.com/terms)

## Run it

This folder on a host that serves the site. Firebase Auth + Firestore (`firebase-config.js`, `firestore.rules`). Workers already pointed at from the app (TURN, call wake, media). Do not put secrets in the repo.

## Native shell

The Android files are a Capacitor wrap of the same web app, so a closed phone can still be asked to wake. Battery on that device must stay Unrestricted or the OS will sleep it.
