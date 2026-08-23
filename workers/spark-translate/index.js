/* Naluno Spark translate — no paid APIs, never echo the source as a translation.
   Deploy: wrangler deploy
   POST { text, from, to } → { text }  or 503 { text:'', error:'untranslated' } */
function parseGtx(data){
  try{
    if(!Array.isArray(data) || !Array.isArray(data[0])) return '';
    return data[0].map((row) => (row && row[0] ? row[0] : '')).join('');
  }catch(_){ return ''; }
}

function isEcho(src, out){
  const a = String(src || '').trim().toLowerCase().replace(/\s+/g, ' ');
  const b = String(out || '').trim().toLowerCase().replace(/\s+/g, ' ');
  return !b || a === b;
}

function junk(s){
  return /MYMEMORY|QUERY LENGTH LIMIT|QUOTA|VISIT HTTPS:\/\/MYMEMORY/i.test(String(s || ''));
}

async function fetchMs(url, opts, ms){
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms || 4000);
  try{
    return await fetch(url, Object.assign({}, opts || {}, { signal: ctl.signal }));
  } finally {
    clearTimeout(t);
  }
}

function mapLang(id){
  const s = String(id || 'en').toLowerCase();
  if(s === 'zh') return 'zh-CN';
  return s;
}

export default {
  async fetch(request) {
    const origin = request.headers.get('Origin') || '*';
    const cors = {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Vary': 'Origin',
    };
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
    if (request.method !== 'POST') return new Response('POST only', { status: 405, headers: cors });
    let body = {};
    try { body = await request.json(); } catch (_) {}
    const text = String(body.text || '').slice(0, 800);
    const from = mapLang(body.from || 'en').slice(0, 8);
    const to = mapLang(body.to || 'en').slice(0, 8);
    if (!text) return Response.json({ text: '' }, { headers: cors });
    if (from === to) return Response.json({ text }, { headers: cors });

    try {
      const gtx = 'https://translate.googleapis.com/translate_a/single?client=gtx&sl='
        + encodeURIComponent(from) + '&tl=' + encodeURIComponent(to)
        + '&dt=t&q=' + encodeURIComponent(text);
      const g = await fetchMs(gtx, {}, 4000);
      if (g.ok) {
        const data = await g.json();
        const out = parseGtx(data);
        if (out && !junk(out) && !isEcho(text, out)) {
          return Response.json({ text: out }, { headers: cors });
        }
      }
    } catch (_) {}

    const hosts = ['https://lingva.ml', 'https://lingva.garudalinux.org'];
    for (const host of hosts) {
      try {
        const lingva = await fetchMs(
          host + '/api/v1/' + encodeURIComponent(from) + '/' + encodeURIComponent(to) + '/' + encodeURIComponent(text),
          {},
          3500,
        );
        if (lingva.ok) {
          const data = await lingva.json();
          const out = data && (data.translation || data.text);
          if (out && !junk(out) && !isEcho(text, out)) {
            return Response.json({ text: out }, { headers: cors });
          }
        }
      } catch (_) {}
    }

    if (!/^(lg|sw|so|am)$/i.test(to) && !/^(lg|sw|so|am)$/i.test(from)) {
      try {
        const lt = await fetchMs('https://libretranslate.de/translate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ q: text, source: from, target: to, format: 'text' }),
        }, 3500);
        if (lt.ok) {
          const data = await lt.json();
          const out = data && data.translatedText;
          if (out && !junk(out) && !isEcho(text, out)) {
            return Response.json({ text: out }, { headers: cors });
          }
        }
      } catch (_) {}
    }

    return Response.json({ text: '', error: 'untranslated' }, { status: 503, headers: cors });
  }
};
