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
      locked: true,
    };
  }

  function findCredit(text, rows, selfUid) {
    let best = null;
    (rows || []).forEach(function (row) {
      if (!row || !row.creatorUid || row.creatorUid === selfUid) return;
      const body = row.body || '';
      if (!isWordCopy(text, body)) return;
      if (!best || (Number(row.createdAt) || 0) < (Number(best.createdAt) || 0)) best = row;
    });
    return packCredit(best);
  }

  function lockedCredit(b) {
    const c = b && b.originCredit;
    if (!c || !c.creatorName || !c.creatorUid) return null;
    if (b.creatorUid && c.creatorUid === b.creatorUid) return null;
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
        locked: true,
      };
    }
    if (!b || !b.creatorUid) return null;
    return {
      broadcastId: String(b.repostOf || b.broadcastId || b.id || ''),
      creatorUid: String(b.creatorUid),
      creatorName: String(b.creatorName || 'Someone').slice(0, 80),
      title: String(b.title || '').slice(0, 120),
      locked: true,
    };
  }

  function byline(credit) {
    if (!credit || !credit.creatorName) return '';
    return 'Original Broadcast by ' + credit.creatorName;
  }

  return {
    norm: norm,
    textKey: textKey,
    isWordCopy: isWordCopy,
    findCredit: findCredit,
    lockedCredit: lockedCredit,
    creditForShare: creditForShare,
    byline: byline,
  };
});
