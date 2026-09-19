# GitHub — 2026.09.19c

Security hardening. Attacker-has-the-source model.

## Must publish (Firebase — this is the one that actually locks the live product)

1. **firestore.rules** — `firebase deploy --only firestore:rules`

Until this is published, the live app is still on the old rules.

## Must upload (GitHub)

2. **firestore.rules** (so git matches what Firebase has)
3. **SECURITY-REPORT.md** — the written report
4. **js/firestore-rules.test.cjs** — contract tests for the rules file

## Also publish (Cloudflare worker)

5. **workers/economy/handler.mjs** (2.2.3-security) and the test.

Mail no longer tries to write the operator inbox with the public web API key.
