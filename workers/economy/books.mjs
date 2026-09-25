/* Pull a real Cloudflare bill when a token is on this worker.
   Without the token, Books keeps the list-price lines it already
   computes from Naluno's own records. */

const cache = { at: 0, value: null };

export async function billingSnapshot(env) {
  const token = env && (env.CF_API_TOKEN || env.CLOUDFLARE_API_TOKEN);
  const account = env && (env.CF_ACCOUNT_ID || env.CLOUDFLARE_ACCOUNT_ID);
  if (!token || !account) return { connected: false, invoices: [] };
  const now = Date.now();
  if (cache.value && now - cache.at < 10 * 60 * 1000) return cache.value;
  const value = { connected: true, invoices: [] };
  try {
    const res = await fetch(
      "https://api.cloudflare.com/client/v4/accounts/" + encodeURIComponent(account) + "/billing/history",
      { headers: { Authorization: "Bearer " + token } }
    );
    const data = await res.json().catch(function () { return {}; });
    const rows = (data && data.result) || [];
    rows.forEach(function (row) {
      if (!row) return;
      const raw = Number(row.amount != null ? row.amount : row.total);
      if (!isFinite(raw) || raw === 0) return;
      const currency = String(row.currency || "USD").toUpperCase();
      const aed = currency === "AED" ? raw : raw * 3.6725;
      const when = Date.parse(row.occurred_at || row.created_on || row.period || "") || now;
      value.invoices.push({
        key: "cloudflare",
        vendor: "Cloudflare",
        amount_aed: Math.round(aed * 100) / 100,
        status: "invoiced",
        source: "cloudflare",
        note: row.type || row.action || row.description || "Cloudflare billing history",
        updatedAt: when,
      });
    });
  } catch (_) {
    value.connected = false;
  }
  cache.at = now;
  cache.value = value;
  return value;
}
