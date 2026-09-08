# GitHub update — 2026.09.08c

The economy worker is **up** (`health 200`) but its service account
**cannot read Firestore** (`degraded: true`, status `500 Economy service
error`). That is why a password set on one phone never reached the next.

This build stops using the worker for the console password.

The password is hashed (PBKDF2) and saved on the signed-in Naluno
account. Sign in as the same Google account on any device and Unlock
works. The worker is still used for flags; those stay empty until its
Firestore access is repaired.

## You must also publish rules

`firestore.rules` now allows the owner to read/write:

- `adminConsole/{uid}`
- `users/{uid}/consoleGate/{docId}`

From the machine that has Firebase:

```
firebase deploy --only firestore:rules
```

Until that lands, the desk falls back to an owner-only path that current
rules already allow. After rules land, the dedicated collection is used.

## After the GitHub push

1. Hard-reload `https://getnaluno.com/admin/`
2. Sign in with magjoed@gmail.com
3. You should see **Set your password** (first time on the account)
4. Create it once
5. On another phone: sign in as the same Google account → **Unlock**

uid locked as operator: `ibMOMY6Q3sVTCxIrwO2FGk43zw93`
