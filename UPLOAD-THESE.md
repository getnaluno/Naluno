# GitHub — 2026.09.22b

Signing out of Naluno was also signing out of Control Centre, and the other way around. Same browser, same email, one shared sign-in.

They are separate now. The app keeps its session. The console keeps its own. Same email is fine.

## Upload to GitHub

1. admin/index.html
2. js/admin-console.js
3. js/currency.js
4. js/auth-isolation.test.cjs

## Then

Hard-refresh Control Centre so it loads **2026.09.22b**. Google-sign-in there once — that first sign-in binds the console only. The app stays as it is.

After that: sign out of Naluno and Control Centre should still be in. Sign out of Control Centre and Naluno should still be in.
