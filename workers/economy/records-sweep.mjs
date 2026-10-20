/* Call and message records are kept 12 months (20 Oct d).
 *
 * Naluno keeps a record that a call or message happened (who, when, how
 * long, whether it connected; never the content): traffic, calls and
 * pushPings and pushReceipts. After 12 months each record is deleted by the worker's
 * scheduled run, unless the desk has put a "keep" mark on one of the two
 * accounts (legalHolds/{uid}) for an open report, investigation or legal
 * request, or on the record itself (legalHold: true). The mark is lifted by
 * the desk when the matter is closed; the record then goes at the next run.
 */

export const RECORDS_KEEP_DAYS = 365;

/* Each kind of record: its collection, its time field (and type), and the
   fields that name the two accounts. */
export const RECORD_KINDS = [
  { col: "traffic", time: "at", type: "integer", who: ["actorUid", "peerUid"] },
  { col: "calls", time: "createdAt", type: "timestamp", who: ["callerUid", "calleeUid"] },
  { col: "pushPings", time: "sentAt", type: "integer", who: ["fromUid", "toUid"] },
  { col: "pushReceipts", time: "arrivedAt", type: "integer", who: ["uid"] },
];

/* Pure: may this record go? */
export function recordMayGo(row, held) {
  const r = row || {};
  if (r.legalHold === true) return false;
  for (const kind of RECORD_KINDS) {
    for (const f of kind.who) {
      const uid = r[f];
      if (uid && held && held.has(String(uid))) return false;
    }
  }
  return true;
}

export function recordsCutoff(now) {
  return (now || Date.now()) - RECORDS_KEEP_DAYS * 86400000;
}

/* io: { held(): Set<uid>, older(kind, cutoffMs, limit, after): [{ name, data, at }], remove([names]) }
   Records come oldest first; "after" is the time of the last one seen, so a
   page of kept records never stops the run from reaching the ones after it. */
export async function sweepRecords(io, now, opts = {}) {
  const cutoff = recordsCutoff(now);
  const held = await io.held();
  const out = { ok: true, deleted: 0, kept: 0, byKind: {} };
  const rounds = opts.rounds || 6;
  for (const kind of RECORD_KINDS) {
    let deleted = 0, kept = 0, after = null;
    for (let round = 0; round < rounds; round++) {
      const rows = await io.older(kind, cutoff, 300, after);
      if (!rows.length) break;
      const go = [];
      rows.forEach((r) => { if (recordMayGo(r.data, held)) go.push(r.name); else kept++; });
      if (go.length) {
        const ok = await io.remove(go);
        if (!ok) { out.ok = false; break; }
        deleted += go.length;
      }
      if (rows.length < 300) break;
      after = rows[rows.length - 1].at;
    }
    out.byKind[kind.col] = { deleted, kept };
    out.deleted += deleted; out.kept += kept;
  }
  return out;
}
