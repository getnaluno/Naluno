# GitHub update — 2026.09.08b

The worker **is answering**. `/health` returns 200
`2.0.0-admin-password`. `/v1/flags` returns `"degraded": true`.

The red line on your screen was a lie: the client called
`/v1/admin/status` with your Google token, got a real error that was
not 401 and not 404 (almost certainly **403 not on the operator list**
or **500 Firestore degraded**), and printed “Worker did not answer”.

This build prints the actual HTTP status and error, shows the full
uid (`ibMOMY6Q…` was truncated), and still lets Unlock open the desk
with the password saved on that computer.

## After push

Hard-reload `https://getnaluno.com/admin/`. The cyan line under Unlock
should show health + version. The red line should name the status.

If it says this account is not on the operator list, on the machine
that deploys the economy worker:

```
npx wrangler secret put ADMIN_UIDS
```

Paste the **full uid** shown on the Unlock screen (the magjoed@gmail.com
account), then reload `/admin/`.

If it says Firestore degraded, the worker secret `GOOGLE_PRIVATE_KEY` /
`GOOGLE_CLIENT_EMAIL` cannot read Firestore — that is why flags are
`degraded: true` and why `/status` cannot see whether a password exists.

Unlock with the console password still opens the desk on this computer
either way.
