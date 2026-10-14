/* Passing a Broadcast on, and noticing a word-for-word copy.
   The copy is still published. The original person stays on it. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.NalunoPass = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  function norm(text) {
    return String(text || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function textKey(text) {
    const n = norm(text);
    if (n.length < 80) return '';
    let h = 5381;
    for (let i = 0; i < n.length; i++) h = ((h * 33) ^ n.charCodeAt(i)) >>> 0;
    return h.toString(16);
  }

  function shingles(n, size) {
    const words = n.split(' ').filter(Boolean);
    const out = new Set();
    if (words.length < size) return out;
    for (let i = 0; i <= words.length - size; i++) out.add(words.slice(i, i + size).join(' '));
    return out;
  }

  function looksLikeShell(text) {
    const n = norm(text);
    if (!n) return false;
    const marks = ['search frequencies', 'open channels', 'your frequencies', 'steady frequency', 'continue the conversation'];
    let hits = 0;
    marks.forEach(function (m) { if (n.indexOf(m) !== -1) hits += 1; });
    return hits >= 2;
  }

  function isWordCopy(a, b) {
    const x = norm(a);
    const y = norm(b);
    if (x.length < 80 || y.length < 80) return false;
    if (x === y) return true;
    const A = shingles(x, 8);
    const B = shingles(y, 8);
    if (A.size < 4 || B.size < 4) return false;
    let inter = 0;
    A.forEach(function (s) { if (B.has(s)) inter += 1; });
    const union = A.size + B.size - inter;
    return union > 0 && inter / union >= 0.92;
  }

  function packCredit(row) {
    if (!row) return null;
    return {
      broadcastId: String(row.id || row.broadcastId || ''),
      creatorUid: String(row.creatorUid || ''),
      creatorName: String(row.creatorName || 'Someone').slice(0, 80),
      title: String(row.title || '').slice(0, 120),
      basis: 'paste',
      locked: true,
    };
  }

  function findCredit(text, rows, selfUid) {
    let best = null;
    (rows || []).forEach(function (row) {
      if (!row || !row.creatorUid || row.creatorUid === selfUid) return;
      const body = row.body || '';
      if (looksLikeShell(body) || looksLikeShell(text)) return;
      if (!isWordCopy(text, body)) return;
      if (!best || (Number(row.createdAt) || 0) < (Number(best.createdAt) || 0)) best = row;
    });
    return packCredit(best);
  }

  /* A resemblance (close title, a similar still, nearby sound) is not a copy.
     The line "Original Broadcast by …" is only for the same file, a
     frame-for-frame paste, a word-for-word paste, or an explicit pass-on. */
  /* 15 Oct: a photo or video is never marked "Original Broadcast by"
     another creator from a file match: OriginID marked a creator's own film
     as someone else's. The line is kept for the two cases that are certain:
     a Pass-on (the person pressed Pass on) and a piece of writing pasted
     word for word. */
  function originCreditAllowed(origin) {
    return false;
  }

  function creditBasis(b, credit) {
    const basis = String((credit && credit.basis) || '');
    if (b && b.repostOf) return 'repost';
    const kind = String((b && (b.mediaType || b.kind)) || '');
    if (kind === 'writing' || (b && b.body)) return (basis === 'paste' || !basis) ? 'paste' : '';
    return '';
  }

  function lockedCredit(b) {
    const c = b && b.originCredit;
    if (!c || !c.creatorName || !c.creatorUid) return null;
    if (b.creatorUid && c.creatorUid === b.creatorUid) return null;
    if (!creditBasis(b, c)) return null;
    return c;
  }

  function creditForShare(b) {
    const locked = lockedCredit(b);
    if (locked) {
      return {
        broadcastId: String(locked.broadcastId || b.repostOf || b.broadcastId || b.id || ''),
        creatorUid: String(locked.creatorUid),
        creatorName: String(locked.creatorName).slice(0, 80),
        title: String(locked.title || b.title || '').slice(0, 120),
        basis: creditBasis(b, locked) || 'repost',
        locked: true,
      };
    }
    if (!b || !b.creatorUid) return null;
    return {
      broadcastId: String(b.repostOf || b.broadcastId || b.id || ''),
      creatorUid: String(b.creatorUid),
      creatorName: String(b.creatorName || 'Someone').slice(0, 80),
      title: String(b.title || '').slice(0, 120),
      basis: 'repost',
      locked: true,
    };
  }

  function coverUrl(b) {
    if (!b || (b.mediaType !== 'writing' && b.kind !== 'writing')) return '';
    const url = String(b.thumbUrl || b.mediaUrl || '');
    if (!url) return '';
    if (/naluno-signal-upload/i.test(url)) return '';
    if (/\.(mp4|webm|mov|m4v|m3u8)(\?|$)/i.test(url)) return '';
    return url;
  }

  function byline(credit) {
    if (!credit || !credit.creatorName) return '';
    return 'Original Broadcast by ' + credit.creatorName;
  }

  return {
    norm: norm,
    textKey: textKey,
    isWordCopy: isWordCopy,
    looksLikeShell: looksLikeShell,
    findCredit: findCredit,
    lockedCredit: lockedCredit,
    originCreditAllowed: originCreditAllowed,
    creditBasis: creditBasis,
    creditForShare: creditForShare,
    byline: byline,
    coverUrl: coverUrl,
  };
});
