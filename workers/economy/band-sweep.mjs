/**
 * THE RULE OF BANDS, carried out by the server (07 Oct d).
 *
 * A Band conversation is deleted two hours after the last person leaves:
 * not archived, not hidden for later. The database rules already stop
 * anyone reading it from that moment. This sweep removes it for good:
 * every message, the clip files those messages point at, the wipe queue
 * and stale "tuned in" marks.
 *
 * Phones used to be the only thing that deleted a Band's conversation, so
 * when everybody left at 3 a.m. and nobody opened the Band again, it stayed
 * stored until a phone came back. The sweep runs on a schedule (Cloudflare
 * cron) and whenever a phone opens Naluno and sees a Band whose time ran
 * out, so no phone has to be present at the moment of deletion.
 *
 * It only ever deletes what the rules already make unreadable:
 *   - in a Band whose two hours ran out (now > aliveAt + 2 h): every message
 *     sent up to that moment;
 *   - in any Band: messages from before its messageEpoch line;
 *   - in an older Band that has no aliveAt yet: everything, once nobody is
 *     tuned in and nothing has happened for two hours. The sweep then stamps
 *     aliveAt at that last moment so the rules hold the line from then on.
 */

export const BAND_SETTLE_MS = 2 * 60 * 60 * 1000;
export const PRESENCE_FRESH_MS = 90 * 1000;
export const PRESENCE_STALE_MS = 5 * 60 * 1000;
const MAX_MESSAGES_PER_BAND = 4000;
const MAX_BANDS_PER_RUN = 1500;
const MAX_SWEEPS_PER_RUN = 150;
/* A message dated this far past "now" was not written by an honest clock. */
const FUTURE_SLACK_MS = 15 * 60 * 1000;
/* An older Band found alive is looked at again after this long. */
export const LEGACY_RECHECK_MS = 3 * 60 * 60 * 1000;

function num(v) {
  const n = Number(v);
  return isFinite(n) && n > 0 ? n : 0;
}

/** What should happen to one Band, decided from what was read. Pure. */
export function bandSweepPlan({ band, presence, newestMsgMs, now }) {
  const b = band || {};
  const t = num(now) || Date.now();
  const beats = (presence || []).map((p) => num(p && p.tunedInAt));
  const freshHere = beats.some((ts) => ts && t - ts < PRESENCE_FRESH_MS);
  const aliveAt = num(b.aliveAt);
  const epoch = num(b.messageEpoch);
  const plan = {
    dead: false,
    deleteUpTo: 0,          // delete messages with ts <= this (ms)
    deleteBefore: epoch,    // and every message with ts < the epoch line
    stampAliveAt: 0,        // older Band: set aliveAt to this (ms)
    revive: null,           // people on an older app are here: { aliveAt, epoch }
    futureAfter: 0,         // delete messages dated after this (ms)
    dropStalePresence: beats.filter((ts) => !ts || t - ts > PRESENCE_STALE_MS).length > 0,
  };
  if (aliveAt) {
    const deadline = aliveAt + BAND_SETTLE_MS;
    if (t > deadline) {
      plan.deleteUpTo = deadline;
      plan.futureAfter = t + FUTURE_SLACK_MS;
      if (freshHere) {
        /* Someone is tuned in from an older app that does not keep the
           clock. Their gathering is a new one: the line goes where the old
           conversation died, so it stays gone, and the clock is set to now
           so they can talk. */
        plan.revive = { aliveAt: t, epoch: Math.max(deadline, epoch) };
        plan.deleteBefore = Math.max(epoch, deadline);
      } else {
        plan.dead = true;
      }
    }
    return plan;
  }
  /* An older Band: no clock yet. Nobody here and nothing for two hours. */
  if (freshHere) return plan;
  const lastSeen = Math.max(num(newestMsgMs), num(b.lastEmptiedAt), ...beats, 0);
  /* Nothing was ever said or done here: nothing to delete, and no clock
     is stamped (people may be about to start). */
  if (lastSeen && t - lastSeen >= BAND_SETTLE_MS) {
    plan.dead = true;
    plan.deleteUpTo = lastSeen + BAND_SETTLE_MS;
    plan.futureAfter = t + FUTURE_SLACK_MS;
    plan.stampAliveAt = lastSeen;
  }
  return plan;
}

/** Should this message go, under the plan? Pure. */
export function messageGoes(plan, msgTs) {
  const ts = num(msgTs);
  if (plan.deleteBefore && ts < plan.deleteBefore) return true;
  if ((plan.dead || plan.revive) && plan.deleteUpTo && ts <= plan.deleteUpTo) return true;
  if (plan.futureAfter && ts > plan.futureAfter) return true;
  return false;
}

/**
 * A clip file may only be removed when it is the sender's own upload
 * (u/<sender uid>/...) on Naluno's media worker. Someone cannot point a
 * Band message at another person's Broadcast video and have the sweep
 * delete it.
 */
export function mediaKeyFor(url, fromUid, mediaBase) {
  if (Array.isArray(mediaBase)) {
    for (const base of mediaBase) { const k = mediaKeyFor(url, fromUid, base); if (k) return { key: k, base }; }
    return "";
  }
  const u = String(url || "");
  const from = String(fromUid || "");
  if (!u || !from || !/^[A-Za-z0-9_-]{6,128}$/.test(from)) return "";
  let parsed;
  try { parsed = new URL(u); } catch { return ""; }
  let base;
  try { base = new URL(mediaBase); } catch { return ""; }
  if (parsed.protocol !== "https:" || parsed.host !== base.host) return "";
  const m = parsed.pathname.match(/^\/o\/(u\/([A-Za-z0-9_-]{6,128})\/[A-Za-z0-9._-]{1,120})$/);
  if (!m || m[2] !== from) return "";
  return m[1];
}

/**
 * Sweep one Band. io = { getDoc(path) -> {data, updateTime} | null,
 *   listDocs(path, fields) -> [{id, data}], commit(writes) -> ok,
 *   docName(path) -> full resource name, dropMedia(keys) -> n }.
 */
export async function sweepBand(io, bandId, now, opts = {}) {
  const id = String(bandId || "");
  if (!/^[A-Za-z0-9_-]{4,128}$/.test(id)) return { ok: false, error: "bad_band" };
  const t = num(now) || Date.now();
  const base = "/bands/" + id;
  const got = await io.getDoc(base);
  if (!got || !got.data) return { ok: false, error: "not_found" };
  const band = got.data;
  const presence = await io.listDocs(base + "/presence", ["tunedInAt"]);
  const aliveAt = num(band.aliveAt);
  const epoch = num(band.messageEpoch);
  /* A Band that is alive and has no line drawn has nothing to delete. */
  if (aliveAt && t <= aliveAt + BAND_SETTLE_MS && !epoch) {
    return { ok: true, dead: false, deleted: 0 };
  }
  const messages = await io.listDocs(base + "/messages", ["ts", "mediaUrl", "from"], MAX_MESSAGES_PER_BAND);
  let newest = 0;
  messages.forEach((m) => { const ts = num(m.data && m.data.ts); if (ts > newest) newest = ts; });
  const plan = bandSweepPlan({ band, presence: presence.map((p) => p.data || {}), newestMsgMs: newest, now: t });

  const writes = [];
  const keys = [];      // [{ key, base }]
  const gone = [];
  messages.forEach((m) => {
    const d = m.data || {};
    if (!messageGoes(plan, d.ts)) return;
    gone.push(m.id);
    writes.push({ delete: io.docName(base + "/messages/" + m.id) });
    const bases = opts.mediaBases || (opts.mediaBase ? [opts.mediaBase] : []);
    const k = bases.length ? mediaKeyFor(d.mediaUrl, d.from, bases) : "";
    if (k) keys.push(k);
  });
  if (plan.dead) {
    const wipe = await io.listDocs(base + "/wipe", []);
    wipe.forEach((w) => writes.push({ delete: io.docName(base + "/wipe/" + w.id) }));
  }
  if (plan.dropStalePresence) {
    presence.forEach((p) => {
      const ts = num(p.data && p.data.tunedInAt);
      if (!ts || t - ts > PRESENCE_STALE_MS) writes.push({ delete: io.docName(base + "/presence/" + p.id) });
    });
  }
  const complete = messages.length < MAX_MESSAGES_PER_BAND;
  const bandFields = {};
  if (plan.stampAliveAt) bandFields.aliveAt = { timestampValue: new Date(plan.stampAliveAt).toISOString() };
  if (plan.revive) {
    bandFields.aliveAt = { timestampValue: new Date(plan.revive.aliveAt).toISOString() };
    bandFields.messageEpoch = { timestampValue: new Date(plan.revive.epoch).toISOString() };
  }
  if (!aliveAt && !plan.dead) bandFields.checkedAt = { timestampValue: new Date(t).toISOString() };
  const bandWrite = Object.keys(bandFields).length ? {
    update: { name: io.docName(base), fields: bandFields },
    updateMask: { fieldPaths: Object.keys(bandFields) },
    /* If someone woke the Band while this ran, leave the Band record as
       they wrote it. */
    currentDocument: got.updateTime ? { updateTime: got.updateTime } : { exists: true },
  } : null;

  let ok = true;
  for (let i = 0; i < writes.length; i += 450) {
    const r = await io.commit(writes.slice(i, i + 450));
    if (!r) ok = false;
  }
  /* Only a finished deletion is recorded; otherwise the next round tries again. */
  if (plan.dead && ok && complete) {
    bandFields.sweptAt = { timestampValue: new Date(t).toISOString() };
    if (bandWrite) { bandWrite.update.fields = bandFields; bandWrite.updateMask.fieldPaths = Object.keys(bandFields); }
  }
  const finalWrite = bandWrite || (bandFields.sweptAt ? {
    update: { name: io.docName(base), fields: bandFields },
    updateMask: { fieldPaths: Object.keys(bandFields) },
    currentDocument: got.updateTime ? { updateTime: got.updateTime } : { exists: true },
  } : null);
  if (finalWrite) { try { await io.commit([finalWrite]); } catch { /* woken meanwhile */ } }
  let dropped = 0;
  if (keys.length && io.dropMedia) {
    try { dropped = await io.dropMedia(keys); } catch { dropped = 0; }
  }
  return { ok, dead: plan.dead, revived: !!plan.revive, complete, deleted: gone.length, files: dropped };
}

/** Bands worth looking at on a scheduled run. Pure. */
export function bandNeedsSweep(band, now) {
  const b = band || {};
  const t = num(now) || Date.now();
  const aliveAt = num(b.aliveAt);
  const swept = num(b.sweptAt);
  if (aliveAt) {
    const deadline = aliveAt + BAND_SETTLE_MS;
    if (t <= deadline) return false;
    return !(swept && swept > deadline);
  }
  /* Older Band without a clock: check it, but not every round. */
  const checked = num(b.checkedAt);
  return !(checked && t - checked < LEGACY_RECHECK_MS);
}

export async function sweepAllBands(io, now, opts = {}) {
  const t = num(now) || Date.now();
  const bands = await io.listDocs("/bands", ["aliveAt", "sweptAt", "checkedAt"], MAX_BANDS_PER_RUN);
  let looked = 0, deleted = 0, dead = 0, files = 0;
  /* Bands whose time ran out first, then older Bands; a capped number per
     round so one round always finishes inside the platform's limits. */
  const due = bands.filter((b) => bandNeedsSweep(b.data, t))
    .sort((a, b) => (num(a.data.aliveAt) ? 0 : 1) - (num(b.data.aliveAt) ? 0 : 1))
    .slice(0, MAX_SWEEPS_PER_RUN);
  for (const b of due) {
    looked++;
    try {
      const r = await sweepBand(io, b.id, t, opts);
      deleted += r.deleted || 0;
      files += r.files || 0;
      if (r.dead) dead++;
    } catch { /* one Band's trouble never stops the rest */ }
  }
  return { ok: true, bands: bands.length, looked, dead, deleted, files };
}
