# Upload Naluno to getnaluno.com

This zip is the real PWA (GitHub Pages), not the Grok preview studio.

Unzip. Files sit at the **archive root** — you should see `index.html` immediately, not a nested folder.

```
index.html
firebase-config.js
manifest.json
sw.js
CNAME
icon-192.png
icon-512.png
css/app.css
js/*.js
firestore.rules
workers/          (optional redeploy)
UPLOAD.md
```

Firebase project: **naluno-28a00**. Custom domain: **getnaluno.com**.

## 1. Push to GitHub Pages

Pages serves the **repo root** (not `/docs`).

```bash
unzip naluno-circle-strand-origin-20260823a.zip
# copy this tree over the live clone, keeping .git
rsync -a --exclude .git --exclude UPLOAD.md --exclude workers ./ live/
cd live
git add -A
git commit -m "Circle join, views, Toga, Strand, Origin"
git push origin main
```

## 2. Cache bust

`index.html` pins scripts at `?v=20260823a`. Service worker is `naluno-shell-v77`. After push, open the site once; old phones pick up the new SW on the next visit.

## 3. Firestore rules

Publish `firestore.rules` (Firebase console or CLI). New paths:

- `users/{uid}/circle/{memberUid}` — joining a creator
- `broadcasts/{id}` views + `viewers/{uid}`
- `strands/{id}`
- `originMarks/{id}`
- `toga/{uid}`

Without these, join / views / Toga / Origin marks will fail permission checks.

## 4. What this build adds

- **Join the creator.** Join on any Broadcast enters that creator’s Circle. Their other rooms already show you in.
- **Views** on each Broadcast, plus a total across all of theirs. Creators toggle **share views**. Hidden to others when private.
- **Toga** — opt-in standing of Circles that share views.
- **Strand** — the folder for related Broadcasts. Chosen on upload. Related rooms come from the Strand; if it is empty, another creator’s Strand is offered.
- **Origin** — in-app file identity + frame hashes against Naluno, plus Wikipedia / iTunes on the open web. Close matches must be acknowledged before publish.

Calls, Signal playback, and the original-file upload path are untouched.

## 5. Do not touch

- `firebase-config.js`
- `CNAME`
- Existing catalog (compat lock)
- TURN / call-notify workers
