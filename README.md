# Naluno

A frequency you carry.

Naluno is a place to be reachable without handing over a phone number. You take a handle. People who know it can find you. The rest of the room stays quiet.

Live: [getnaluno.com](https://getnaluno.com)

## How it feels

You keep a **Callsign**. Frequencies are the people you have actually met here. **Wireline** is the private line between two of you. **Band** is a room that belongs to nobody — it fades when the last person leaves. **Broadcast** is what you leave behind on purpose. Calls cut through whatever else is on screen.

Slips (photo and video) travel on the same line as a message. They play where they land. Keeping a copy is optional.

## What you need to run it

- This folder on a host that serves `index.html`
- Firebase project with Auth + Firestore (`firebase-config.js`, `firestore.rules`)
- The Workers already pointed at from the app (TURN, call wake, media)

Do not put secrets in the repo. Workers take them with `wrangler secret put`.

## Deploy the site

Replace the live `index.html`, `js/`, `css/`, `sw.js`, and icons. Bump the version query on the scripts if you want clients to notice.

Publish `firestore.rules` whenever they change.

## Native shell

The Android folder is a Capacitor wrap of the same web app. It is how a closed phone can still be asked to wake. Battery must stay Unrestricted on the device or the OS will sleep it.

## What this file will not do

It will not list every collection, every Worker route, or every product decision. Those live in the code and in the people who ship it. If something is missing from this page, it is because it is easier to break when it is written down twice.
