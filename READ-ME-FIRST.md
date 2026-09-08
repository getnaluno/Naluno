# Admin login, rewritten

You were right to call it. The problem was never the string — it was the
design. The password lived in a Cloudflare Worker secret, which meant you
could not see it, could not verify it, could not change it without the CLI,
and every failure looked identical. I kept adding normalisation to compensate,
which was treating the symptom.

**`ADMIN_PASSPHRASE` is gone entirely.** It appears nowhere in the worker now.

## How it works instead

1. Sign in with Google at `/admin/`.
2. **First time:** the console sees no password for your account and offers to
   create one. Type it twice. That is it.
3. **Every time after:** type your password. Like any login.
4. **Change it** from a button inside the console. No CLI, no redeploy.
5. **Lost it?** Delete `adminCredentials/{yourUid}` in the Firestore console
   and the next visit offers to set a new one. That needs project access,
   which is the right bar for a reset.

No wrangler command is needed for the password at any point.

## What still lives in a secret, and why

`ADMIN_UIDS` — the allowlist. That stays server-side deliberately: it is the
actual security boundary, and it must not be changeable from a browser. Only
an allowlisted account can set or use a password at all.

The split is the point. The thing that must never be client-editable stays in
a secret; the thing you need to manage yourself became manageable.

## How the password is stored

PBKDF2-SHA256, 150,000 iterations, a random 16-byte salt per admin, in
`adminCredentials/{uid}`. The plaintext is never stored and never written to
the audit log. Comparison is constant-time, so the hash cannot be discovered
by timing.

`firestore.rules` denies **all** client read and write to that collection —
not even you can read your own hash from a browser. Only the worker's service
account touches it.

## What changed about matching

Only the ends are trimmed, exactly like every normal login form, so a stray
space from a paste is not a lockout.

Nothing else is normalised. The previous version lowercased and collapsed
whitespace because a CLI was mangling the value in ways you could not see.
There is no CLI in the path now — you type it into the browser — so a
password can mean exactly what you typed. **Case matters again**, which is
how a password should behave.

## Failures now say which thing is wrong

| message | meaning |
|---|---|
| "Set your password" screen | no password exists yet for this account |
| "Password not accepted." | genuinely the wrong password |
| "Enter your password." | the field was empty |
| "Not available for this account." | your UID is not on the allowlist |
| "Couldn't reach the service." | the worker is unreachable |

## Tests

19 assertions: first-visit setup, hash-not-plaintext storage, unique salts,
correct/wrong/empty passwords, case sensitivity preserved, changing with and
without the current password, a failed change leaving the old one intact, the
allowlist blocking both setup and entry, recovery after deleting the document,
and the 8-character minimum.

## Deploy

1. `cd workers/economy && npx wrangler deploy`
2. `firebase deploy --only firestore:rules`
3. Push `js/admin-console.js` and `admin/index.html`

Then open `/admin/`, sign in, and set your password.

You can delete the old `ADMIN_PASSPHRASE` secret if you like — nothing reads
it any more:
`npx wrangler secret delete ADMIN_PASSPHRASE`

## Files

`workers/economy/index.js`, `js/admin-console.js`, `admin/index.html`,
`firestore.rules`.
