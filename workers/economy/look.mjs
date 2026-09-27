function decode(s) {
  return String(s || "")
    .replace(/&/g, "&")
    .replace(/"/g, "\"")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/</g, "<")
    .replace(/>/g, ">");
}

function clean(s) {
  return decode(s).replace(/<[^>]+>/g, "").replace(/[\u200e\u200f]/g, "").replace(/\s+/g, " ").trim();
}

export function parseLookHtml(html) {
  const text = String(html || "");
  const hits = [];
  const re = /class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]{0,1200}?class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
  let m;
  while ((m = re.exec(text)) && hits.length < 5) {
    const href = decode(m[1]);
    const uddg = href.match(/uddg=([^&]+)/);
    let url = "";
    try { url = uddg ? decodeURIComponent(uddg[1]) : ""; } catch (_) { url = ""; }
    if (!/^https:\/\//.test(url) || /duckduckgo\.com/i.test(url)) continue;
    const title = clean(m[2]).slice(0, 140);
    const snippet = clean(m[3]).slice(0, 320);
    if (!title && !snippet) continue;
    hits.push({ title, snippet, url });
  }
  return hits;
}

export async function lookQuery(q) {
  const query = String(q || "").replace(/\s+/g, " ").trim().slice(0, 80);
  if (query.length < 2) return [];
  const res = await fetch("https://html.duckduckgo.com/html/?q=" + encodeURIComponent(query), {
    headers: { "User-Agent": "Mozilla/5.0 NalunoCompass" },
  });
  if (!res.ok) return [];
  return parseLookHtml(await res.text());
}
