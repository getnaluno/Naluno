/* ============================================================
   MODULE: js/handle-guard.js
   Callsign format, reserved identities, lightweight similarity.
   The database and Firestore rules are the gate. This file is the
   shared shape used by sign-up, Callsign save, the desk, and tests.
   ============================================================ */
(function (root) {
  const HANDLE_MIN = 3;
  const HANDLE_MAX = 24;
  const HANDLE_RE = /^[a-z0-9_]{3,24}$/;
  const RESERVED_MSG = 'This handle is reserved and cannot be claimed.';
  const TAKEN_MSG = 'That handle is taken — try another.';
  const FORMAT_MSG = 'Choose a handle with at least 3 letters (a–z, 0–9, _).';

  const SEED_RESERVED = [
    { handle: 'naluno', category: 'official', reason: 'Brand' },
    { handle: 'getnaluno', category: 'official', reason: 'Brand' },
    { handle: 'nalunoapp', category: 'official', reason: 'Brand' },
    { handle: 'nalunohq', category: 'official', reason: 'Brand' },
    { handle: 'nalunoofficial', category: 'official', reason: 'Brand' },
    { handle: 'nalunoteam', category: 'official', reason: 'Brand' },
    { handle: 'nalunofounder', category: 'official', reason: 'Brand' },
    { handle: 'nalunocreators', category: 'official', reason: 'Brand' },
    { handle: 'nalunoinvest', category: 'official', reason: 'Brand' },
    { handle: 'nalunosupport', category: 'support', reason: 'Support' },
    { handle: 'nalunohelp', category: 'support', reason: 'Support' },
    { handle: 'nalunonews', category: 'support', reason: 'Support' },
    { handle: 'admin', category: 'system', reason: 'System' },
    { handle: 'administrator', category: 'system', reason: 'System' },
    { handle: 'nalunoadmin', category: 'system', reason: 'System' },
    { handle: 'nalunosystem', category: 'system', reason: 'System' },
    { handle: 'nalunosecurity', category: 'system', reason: 'System' },
    { handle: 'nalunomoderator', category: 'system', reason: 'System' },
    { handle: 'nalunostaff', category: 'system', reason: 'System' },
    { handle: 'official', category: 'system', reason: 'System' },
    { handle: 'support', category: 'support', reason: 'Support' },
    { handle: 'security', category: 'system', reason: 'System' },
    { handle: 'system', category: 'system', reason: 'System' },
    { handle: 'moderator', category: 'system', reason: 'System' },
  ];

  function normHandle(raw) {
    return String(raw || '')
      .trim()
      .replace(/^@+/, '')
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, '')
      .slice(0, HANDLE_MAX);
  }
  function handleCore(raw) {
    return normHandle(raw).replace(/_/g, '');
  }
  function handleFormatOk(raw) {
    const h = normHandle(raw);
    return HANDLE_RE.test(h);
  }
  function foldLookalikes(s) {
    return String(s || '')
      .toLowerCase()
      .replace(/0/g, 'o')
      .replace(/1/g, 'l')
      .replace(/i/g, 'l')
      .replace(/3/g, 'e')
      .replace(/5/g, 's')
      .replace(/8/g, 'b')
      .replace(/_/g, '');
  }
  function levenshtein(a, b) {
    a = String(a || '');
    b = String(b || '');
    if (a === b) return 0;
    if (!a.length) return b.length;
    if (!b.length) return a.length;
    const row = [];
    for (let j = 0; j <= b.length; j++) row[j] = j;
    for (let i = 1; i <= a.length; i++) {
      let prev = i - 1;
      row[0] = i;
      for (let j = 1; j <= b.length; j++) {
        const cur = row[j];
        const cost = a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1;
        row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + cost);
        prev = cur;
      }
    }
    return row[b.length];
  }

  function matchReserved(raw, reservedList) {
    const h = normHandle(raw);
    const core = handleCore(h);
    const list = reservedList || [];
    for (let i = 0; i < list.length; i++) {
      const row = list[i] || {};
      const rh = normHandle(row.handle || row.id || '');
      if (!rh) continue;
      if (h === rh || core === handleCore(rh) || core === String(row.core || '')) {
        return {
          reserved: true,
          handle: rh,
          category: row.category || 'other',
          holderUid: row.holderUid || row.holder || '',
        };
      }
    }
    return null;
  }

  function similarityAgainst(raw, reservedList) {
    if (matchReserved(raw, reservedList)) return null;
    const h = normHandle(raw);
    const core = handleCore(h);
    const folded = foldLookalikes(h);
    if (!core || core.length < HANDLE_MIN) return null;
    const list = reservedList || [];
    let best = null;
    for (let i = 0; i < list.length; i++) {
      const row = list[i] || {};
      const rh = normHandle(row.handle || row.id || '');
      if (!rh) continue;
      const rc = handleCore(rh);
      const rf = foldLookalikes(rh);
      if (h === rh || core === rc) continue;
      let reason = '';
      let score = 0;
      if (folded === rf) {
        reason = 'lookalike characters';
        score = 90;
      } else if (core.indexOf(rc) === 0 && rc.length >= 5 && /^[0-9]+$/.test(core.slice(rc.length))) {
        reason = 'protected name plus numbers';
        score = 80;
      } else if (rc.length >= 5 && core.indexOf(rc) >= 0) {
        reason = 'contains a protected name';
        score = 75;
      } else if (rf.length >= 5 && folded.indexOf(rf) >= 0) {
        reason = 'contains a protected name';
        score = 72;
      } else if (rc.length >= 5 && levenshtein(core, rc) === 1) {
        reason = 'one character from a protected name';
        score = 70;
      } else if (rf.length >= 5 && levenshtein(folded, rf) === 1) {
        reason = 'one character from a protected name';
        score = 68;
      }
      if (reason && (!best || score > best.score)) {
        best = {
          handle: h,
          reserved: rh,
          category: row.category || 'other',
          reason: reason,
          score: score,
        };
      }
    }
    return best;
  }

  function decideHandle(raw, opts) {
    opts = opts || {};
    const h = normHandle(raw);
    if (!handleFormatOk(h)) {
      return { ok: false, handle: h, error: FORMAT_MSG, code: 'format' };
    }
    const hit = matchReserved(h, opts.reserved || []);
    if (hit && hit.holderUid && opts.uid && hit.holderUid === opts.uid) {
      return { ok: true, handle: h, official: true };
    }
    if (hit) {
      return { ok: false, handle: h, error: RESERVED_MSG, code: 'reserved', reserved: true };
    }
    if (opts.taken) {
      return { ok: false, handle: h, error: TAKEN_MSG, code: 'taken', taken: true };
    }
    const similar = similarityAgainst(h, opts.reserved || []);
    return {
      ok: true,
      handle: h,
      similar: similar || null,
    };
  }

  root.NalunoHandleGuard = {
    HANDLE_MIN: HANDLE_MIN,
    HANDLE_MAX: HANDLE_MAX,
    HANDLE_RE: HANDLE_RE,
    RESERVED_MSG: RESERVED_MSG,
    TAKEN_MSG: TAKEN_MSG,
    FORMAT_MSG: FORMAT_MSG,
    SEED_RESERVED: SEED_RESERVED,
    normHandle: normHandle,
    handleCore: handleCore,
    handleFormatOk: handleFormatOk,
    foldLookalikes: foldLookalikes,
    levenshtein: levenshtein,
    matchReserved: matchReserved,
    similarityAgainst: similarityAgainst,
    decideHandle: decideHandle,
  };
})(typeof window !== 'undefined' ? window : globalThis);
