# GitHub — 2026.09.19a

Investor / partner pathway on the public site. Enquiries land in Mail. No app architecture change.

Only these files. Do not upload a full tree.

## Must upload

1. **index.html** — homepage “next layer” section
2. **invest/index.html** — the invest page
3. **invest.html**, **investment/index.html** — short redirects to /invest/
4. **js/admin-console.js**, **js/admin-data.js**, **admin/index.html** — Mail tab “Invest” filter

## Also publish (Cloudflare worker)

5. **workers/economy/handler.mjs** (and the test) so Invest is its own mail kind with name, email, phone, organisation, country, interest.

Until the worker is published, the form still arrives as website mail. The message itself already contains country, interest, organisation and phone.

No valuation, share price, or return on the public page. The operating-desk picture is a sanitised mock — it is not the live desk, and it does not link to it.
