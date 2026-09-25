Naluno 2026.09.25c

Unzip into the repo root so these files replace the ones already there.

Then publish:
- The site files (app, admin, website, sw, js, firestore.rules).
- The economy worker again, from workers/economy. Books reads Cloudflare's real invoices only after these two secrets exist on that worker:
    npx wrangler secret put CF_API_TOKEN
    npx wrangler secret put CF_ACCOUNT_ID
  The token needs Account Analytics and Billing read. The account id is on the Cloudflare account page.
  Until those secrets exist, Books still updates from Naluno's own usage and stays at zero while the free allowance covers it.

Do not redeploy the upload workers. They did not change.
