# 2026.09.23c — safety on top of tonight’s GitHub

Built on the latest GitHub copy (commit 4e6b913). Lifeline SMS, chat translation, the faster service worker, the on-call Wireline, and the console password are still in these files.

Do not upload a folder named public. The live site is the root of the Naluno repo. Unzip this, then replace each file in the folder that already has that name.

## Replace these

- app/index.html
- admin/index.html
- sw.js
- firestore.rules
- js/pwa.js
- js/report.js
- js/signal-core.js
- js/broadcast-core.js
- js/broadcast-space.js
- js/auth.js
- js/admin-console.js
- workers/economy/handler.mjs
- workers/economy/safety.mjs
- workers/economy/safety-boot.mjs
- workers/economy/safety.test.mjs

## Leave these alone

css/app.css, js/calls.js, js/wireline.js, js/lifeline.js, and js/wireline-translate.js are already correct on GitHub. This pack does not replace them.

## After GitHub

Deploy the economy worker from workers/economy (version 2.6.9-safety). Deploy firestore.rules. GitHub Pages alone does not run the safety queue.

Then hard-refresh. In the console, open Safety.
