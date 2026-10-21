/* Closed Callsigns are erased 30 days after closing (21 Oct e).

   Closing a Callsign already removes its Broadcasts, Signals and files and
   deletes the login straight away. What stayed was the account record and
   everything under it: the profile (name, photo, country), Compass notes,
   Find Naluno history, push addresses, Frequencies lists, the Wireline
   mailbox. Google Play (and data-protection law) expect a deleted account's
   data to go.

   30 days after a person closes their own Callsign, the worker's scheduled
   run deletes every document under users/<uid> and wireDrop/<uid>, then
   replaces users/<uid> with a bare marker { accountState: "erased",
   deleted: true, erasedAt } so the handle cannot be taken by someone pretending to be them.

   Not erased:
   - a Callsign the desk closed (a ban) — the record is kept as the safety
     reason for the closure;
   - an account with a keep mark (legalHolds/<uid>) for an open report,
     investigation or legal request;
   - call and message records (traffic, calls, pushPings, pushReceipts):
     those follow their own 12-month rule (records-sweep.mjs);
   - payments: kept as long as the law requires for accounts.
*/

export const ERASE_AFTER_DAYS = 30;

export function eraseCutoff(now) {
  return (now || Date.now()) - ERASE_AFTER_DAYS * 86400000;
}

/* Pure: is this account record due for erasing? */
export function dueForErase(row, now, held) {
  const r = row || {};
  if (r.accountState !== "closed") return false;
  if (String(r.closedKind || "") !== "self") return false;
  if (r.erasedAt) return false;
  const at = Number(r.closedAt || r.deletedAt || 0);
  if (!(at > 0) || at > eraseCutoff(now)) return false;
  if (held && held.has(String(r.uid || ""))) return false;
  return true;
}

/* io: {
     held(): Set<uid>,
     closedBefore(cutoffMs, limit, afterClosedAt): [{ uid, data }],  // oldest first
     descendants(parentPath, limit): [docName],      // every document below a path
     remove([docNames]): bool,
     tombstone(uid, now): bool,
   } */
export async function eraseClosedAccounts(io, now, opts = {}) {
  const t = now || Date.now();
  const held = await io.held();
  const out = { ok: true, erased: [], skipped: 0 };
  /* Pages, oldest first; a page of accounts that stay (closed by the desk,
     or kept) never stops the run reaching the ones after them. */
  const rows = [];
  let after = null;
  for (let page = 0; page < (opts.pages || 5); page++) {
    const got = await io.closedBefore(eraseCutoff(t), 100, after);
    got.forEach((r) => { if (dueForErase(Object.assign({ uid: r.uid }, r.data || {}), t, held)) rows.push(r); else out.skipped++; });
    if (got.length < 100 || rows.length >= (opts.limit || 20)) break;
    after = Number((got[got.length - 1].data || {}).closedAt || 0) || null;
    if (!after) break;
  }
  for (const row of rows.slice(0, opts.limit || 20)) {
    const data = Object.assign({ uid: row.uid }, row.data || {});
    if (!dueForErase(data, t, held)) { out.skipped++; continue; }
    let clean = true;
    for (const parent of ["/users/" + row.uid, "/wireDrop/" + row.uid]) {
      for (let round = 0; round < (opts.rounds || 10); round++) {
        const names = await io.descendants(parent, 300);
        if (!names.length) break;
        if (!(await io.remove(names))) { clean = false; break; }
        if (names.length < 300) break;
      }
      if (!clean) break;
    }
    if (!clean) { out.ok = false; continue; }
    if (await io.tombstone(row.uid, t)) out.erased.push(row.uid);
    else out.ok = false;
  }
  return out;
}
