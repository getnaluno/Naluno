/* Launch & Capacity — the worker's routes (13 Oct a). The rules live in
   launch.mjs; this file reads and writes Firestore through the helpers the
   handler hands in (d), so it can be tested against a fake Firestore.

   Documents (all written by the service account only):
   launchPrivate/{env}      the whole configuration (operator read)
   launchConfig/{env}       the public part + guardState (anyone may read)
   launchState/{env}        registered count, refused claims (operator read)
   registrations/{uid}      a registration seat (its owner may read)
   launchHistory/{env}-{v}  each saved version, for rollback (operator read)
   launchAudit/{auto}       every change and refusal (operator read)
   waitlist/{id}            waiting list entries (operator read)
   launchUsage/{env}_{day}  uploads reported by the upload workers */

import {
  defaultConfig, withDefaults, validateConfig, activatePhase, compareLimits,
  registrationState, registrationMessage, claimDecision, cleanEmail,
  evaluateGuard, diffSettings, publicView, LAUNCH_ENVS, FEATURES,
} from "./launch.mjs";

export function launchEnvOf(env, asked) {
  const want = String(asked || "").toLowerCase();
  if (LAUNCH_ENVS.indexOf(want) >= 0) return want;
  return String((env && env.LAUNCH_ENV) || "").toLowerCase() === "staging" ? "staging" : "production";
}

async function sha256hex(s) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(s)));
  return Array.from(new Uint8Array(buf)).map(function (b) { return b.toString(16).padStart(2, "0"); }).join("");
}
function randomKey() {
  const a = new Uint8Array(18);
  crypto.getRandomValues(a);
  return Array.from(a).map(function (b) { return b.toString(16).padStart(2, "0"); }).join("");
}
function dayKey(now) { return new Date(now).toISOString().slice(0, 10); }

export function makeLaunch(d) {
  /* d: { env, token, fsFetch, fsGetDoc, fsPutDoc, fsIncrement, fromFsDoc, toFsFields, root, json, now } */
  const now = function () { return d.now ? d.now() : Date.now(); };
  const enc = encodeURIComponent;

  async function getRaw(path) {
    const r = await d.fsFetch(d.env, d.token, "GET", path);
    if (r.status === 404) return { exists: false, data: null, updateTime: "" };
    if (!r.ok) throw new Error("read " + path + " " + r.status);
    return { exists: true, data: d.fromFsDoc(r.data), updateTime: (r.data && r.data.updateTime) || "" };
  }

  async function load(which) {
    const got = await getRaw("/launchPrivate/" + enc(which));
    const cfg = got.exists ? withDefaults(got.data) : defaultConfig();
    delete cfg.id;
    cfg.env = which;
    return { cfg: cfg, exists: got.exists, updateTime: got.updateTime };
  }

  async function counter(which) {
    const got = await getRaw("/launchState/" + enc(which));
    return { exists: got.exists, registered: got.exists ? Math.max(0, Number(got.data.registered) || 0) : null, data: got.data || {}, updateTime: got.updateTime };
  }

  async function countWhere(collectionId, filters) {
    const where = (filters || []).length
      ? (filters.length === 1 ? { fieldFilter: filters[0] } : { compositeFilter: { op: "AND", filters: filters.map(function (f) { return { fieldFilter: f }; }) } })
      : undefined;
    const q = { from: [{ collectionId: collectionId }] };
    if (where) q.where = where;
    const r = await d.fsFetch(d.env, d.token, "POST", ":runAggregationQuery", {
      structuredAggregationQuery: { structuredQuery: q, aggregations: [{ alias: "n", count: {} }] },
    });
    if (!r.ok) return null;
    const row = Array.isArray(r.data) ? r.data[0] : null;
    const v = row && row.result && row.result.aggregateFields && row.result.aggregateFields.n;
    return v ? Number(v.integerValue) : null;
  }
  const eq = function (field, value) {
    const v = typeof value === "boolean" ? { booleanValue: value } : (typeof value === "number" ? { integerValue: String(value) } : { stringValue: String(value) });
    return { field: { fieldPath: field }, op: "EQUAL", value: v };
  };
  const gte = function (field, n) { return { field: { fieldPath: field }, op: "GREATER_THAN_OR_EQUAL", value: { integerValue: String(Math.floor(n)) } }; };

  async function audit(row) {
    const body = Object.assign({ at: now() }, row);
    if (Array.isArray(body.changes)) body.changes = body.changes.slice(0, 120).map(function (c) {
      return { setting: c.setting, from: JSON.stringify(c.from === undefined ? null : c.from).slice(0, 400), to: JSON.stringify(c.to === undefined ? null : c.to).slice(0, 400) };
    });
    const r = await d.fsFetch(d.env, d.token, "POST", "/launchAudit", d.toFsFields(body));
    return !!r.ok;
  }

  /* Write a new version: private, history, public, in that order, with a
     precondition so two desks saving at once cannot overwrite each other. */
  async function persist(which, prev, next, actor, action, reason) {
    const changes = diffSettings(prev.cfg, next);
    const check = validateConfig(next);
    if (!check.ok) {
      await audit({ env: which, action: action, actorUid: actor.uid, actorEmail: actor.email || "", reason: reason || "", changes: changes, result: "refused: " + check.errors.slice(0, 5).join("; ") });
      return { ok: false, status: 400, errors: check.errors };
    }
    const version = (Number(prev.cfg.version) || 0) + 1;
    const stamp = now();
    const full = JSON.parse(JSON.stringify(next));
    delete full.env;
    delete full.guardState;
    full.version = version;
    full.updatedAt = stamp;
    full.updatedBy = actor.uid;
    const pre = prev.exists && prev.updateTime ? "?currentDocument.updateTime=" + enc(prev.updateTime) : "?currentDocument.exists=false";
    const w = await d.fsPutDoc(d.env, d.token, "/launchPrivate/" + enc(which) + pre, full);
    if (!w || !w.ok) {
      const conflict = w && (w.status === 400 || w.status === 409 || w.status === 412);
      await audit({ env: which, action: action, actorUid: actor.uid, actorEmail: actor.email || "", reason: reason || "", changes: changes, result: conflict ? "refused: changed by someone else, reload" : "failed: write " + (w && w.status) });
      return { ok: false, status: conflict ? 409 : 502, errors: [conflict ? "The settings changed since you opened them. Reload and try again." : "Could not save the settings."] };
    }
    await d.fsPutDoc(d.env, d.token, "/launchHistory/" + enc(which + "-" + version), { env: which, version: version, at: stamp, by: actor.uid, action: action, reason: reason || "", config: JSON.stringify(full) });
    const pub = publicView(Object.assign({}, full, { env: which }));
    pub.updatedAt = stamp;
    await d.fsPutDoc(d.env, d.token, "/launchConfig/" + enc(which), pub);
    await audit({ env: which, action: action, actorUid: actor.uid, actorEmail: actor.email || "", reason: reason || "", changes: changes, result: "ok", version: version });
    return { ok: true, version: version, changes: changes, config: Object.assign(full, { env: which }) };
  }

  /* Count every Callsign profile. It starts the counter when there is none.
     14 Oct: after that, "registered" means places given out, and only a seat
     (claim) or a seat handed back (expireSeats) moves it. Recount used to
     replace it with the number of profiles, so a seat whose Callsign was
     not made yet vanished from the count and the cap could be passed. The
     profile count is kept beside it (profileCount) for the desk. */
  async function recount(which, actor, reason) {
    const n = await countWhere("users");
    if (n == null) return { ok: false, error: "Could not count accounts" };
    const before = await counter(which);
    const fields = before.exists ? { profileCount: n, recountedAt: now() } : { registered: n, profileCount: n, recountedAt: now() };
    await d.fsPutDoc(d.env, d.token, "/launchState/" + enc(which), fields);
    if (actor) await audit({ env: which, action: "recount", actorUid: actor.uid, actorEmail: actor.email || "", reason: reason || "", changes: [{ setting: "profileCount", from: before.data && before.data.profileCount != null ? before.data.profileCount : null, to: n }], result: "ok" });
    return { ok: true, registered: before.exists ? before.registered : n, profiles: n, before: before.registered };
  }

  /* 14 Oct: a seat that is a day old and still has no Callsign is handed
     back, 50 at a time (the cron). The seat and one place on the counter go
     in the same commit. A seat whose Callsign exists is marked, so it is
     not looked at again. */
  async function expireSeats(which, max) {
    const cutoff = now() - 24 * 3600 * 1000;
    const r = await d.fsFetch(d.env, d.token, "POST", ":runQuery", { structuredQuery: {
      from: [{ collectionId: "registrations" }],
      // One equality filter only: it needs no extra index. Seats without a
      // Callsign are few (sign-ups in progress, or given up).
      where: { fieldFilter: { field: { fieldPath: "profiled" }, op: "EQUAL", value: { booleanValue: false } } },
      limit: 200 } });
    const rows = (Array.isArray(r.data) ? r.data : []).filter(function (x) {
      if (!x || !x.document) return false;
      const f = d.fromFsDoc(x.document);
      return String(f.env || "") === which && Number(f.at) > 0 && Number(f.at) < cutoff;
    }).slice(0, Math.max(1, Math.min(50, max || 50)));
    const out = { checked: 0, returned: 0, kept: 0 };
    const name = d.root.replace("https://firestore.googleapis.com/v1/", "");
    for (const x of rows) {
      const seat = d.fromFsDoc(x.document);
      const uid = String(seat.uid || seat.id || "");
      if (!/^[A-Za-z0-9_-]{6,128}$/.test(uid)) continue;
      out.checked++;
      const prof = await getRaw("/users/" + enc(uid));
      if (prof.exists) {
        await d.fsPutDoc(d.env, d.token, "/registrations/" + enc(uid), { profiled: true });
        out.kept++;
        continue;
      }
      const c = await d.fsFetch(d.env, d.token, "POST", ":commit", { writes: [
        { delete: name + "/registrations/" + uid, currentDocument: { updateTime: x.document.updateTime } },
        { transform: { document: name + "/launchState/" + which, fieldTransforms: [{ fieldPath: "registered", increment: { integerValue: "-1" } }] } },
      ] });
      if (c.ok) out.returned++;
    }
    return out;
  }

  async function status(which) {
    const L = await load(which);
    let c = await counter(which);
    if (!c.exists) { const r = await recount(which, null, ""); c = { registered: r.ok ? r.registered : 0 }; }
    const st = registrationState(L.cfg, c.registered);
    return { cfg: L.cfg, state: st, message: registrationMessage(st) };
  }

  /* A seat for this uid, atomically against the cap. */
  async function claim(which, uid) {
    if (!/^[A-Za-z0-9_-]{6,128}$/.test(String(uid || ""))) return { ok: false, status: 400, error: "bad account" };
    const seat = await getRaw("/registrations/" + enc(uid));
    if (seat.exists) return { ok: true, already: "seat" };
    const prof = await getRaw("/users/" + enc(uid));
    if (prof.exists) return { ok: true, already: "profile" };
    const L = await load(which);
    for (let attempt = 0; attempt < 8; attempt++) {
      let c = await counter(which);
      if (!c.exists) { await recount(which, null, ""); c = await counter(which); }
      const decision = claimDecision(L.cfg, c.registered, { hasSeat: false, hasProfile: false });
      if (!decision.ok) {
        try { await d.fsIncrement(d.env, d.token, "/launchState/" + enc(which), { refused: 1 }, {}); } catch (_) {}
        return { ok: false, status: 403, reason: decision.reason, waitlist: decision.waitlist, error: decision.message };
      }
      const name = d.root.replace("https://firestore.googleapis.com/v1/", "");
      const writes = [
        {
          update: { name: name + "/launchState/" + which, fields: d.toFsFields({ registered: c.registered + 1, lastSeatAt: now() }).fields },
          updateMask: { fieldPaths: ["registered", "lastSeatAt"] },
          currentDocument: { updateTime: c.updateTime },
        },
        {
          update: { name: name + "/registrations/" + uid, fields: d.toFsFields({ uid: uid, at: now(), env: which, phase: L.cfg.activePhase, number: c.registered + 1, profiled: false }).fields },
          currentDocument: { exists: false },
        },
      ];
      const r = await d.fsFetch(d.env, d.token, "POST", ":commit", { writes: writes });
      if (r.ok) return { ok: true, taken: true, number: c.registered + 1 };
      // someone else took a place (or this uid's seat) at the same moment: look again
      const again = await getRaw("/registrations/" + enc(uid));
      if (again.exists) return { ok: true, already: "seat" };
      await new Promise(function (res) { setTimeout(res, 20 + Math.floor(Math.random() * 80)); });
    }
    return { ok: false, status: 503, error: "Too many people are signing up at once. Try again in a moment." };
  }

  async function waitJoin(which, email) {
    const st = await status(which);
    if (st.state.accepting) return { ok: false, status: 409, error: "Registration is open. You can create your account now." };
    if (!st.state.waitlist) return { ok: false, status: 403, error: st.message || "Registration is closed." };
    const clean = cleanEmail(email);
    if (!clean) return { ok: false, status: 400, error: "Enter an email address we can write to when places open." };
    const id = (await sha256hex(which + "|" + clean)).slice(0, 32);
    const key = randomKey();
    const w = await d.fsPutDoc(d.env, d.token, "/waitlist/" + id, {
      email: clean, env: which, phase: st.cfg.activePhase, at: now(), keyHash: await sha256hex(key), reason: st.state.reason,
    });
    if (!w || !w.ok) return { ok: false, status: 502, error: "Could not save that. Try again." };
    return { ok: true, id: id, key: key };
  }

  async function waitLeave(id, key) {
    if (!/^[a-f0-9]{32}$/.test(String(id || "")) || !/^[a-f0-9]{36}$/.test(String(key || ""))) return { ok: false, status: 400, error: "That removal code is not right." };
    const got = await getRaw("/waitlist/" + id);
    if (!got.exists) return { ok: true, gone: true };
    if (got.data.keyHash !== await sha256hex(key)) return { ok: false, status: 403, error: "That removal code is not right." };
    await d.fsFetch(d.env, d.token, "DELETE", "/waitlist/" + id);
    return { ok: true, removed: true };
  }

  async function listCol(path, size) {
    const r = await d.fsFetch(d.env, d.token, "GET", path + (path.indexOf("?") >= 0 ? "&" : "?") + "pageSize=" + (size || 100));
    if (!r.ok) return [];
    return (r.data.documents || []).map(function (x) { const o = d.fromFsDoc(x); o._updateTime = x.updateTime; return o; });
  }

  async function usage(which, day) {
    const got = await getRaw("/launchUsage/" + enc(which + "_" + day));
    return got.exists ? got.data : {};
  }

  /* Upload workers report each upload (server to server, shared key). */
  async function reportUpload(which, ev) {
    const day = dayKey(now());
    const fields = {};
    if (ev.ok) { fields.uploadsOk = 1; fields.uploadBytes = Math.max(0, Math.floor(Number(ev.bytes) || 0)); }
    else {
      fields.uploadsRefused = 1;
      const why = String(ev.reason || "other").replace(/[^a-z0-9_]/g, "").slice(0, 24) || "other";
      fields["refused_" + why] = 1;
    }
    if (ev.worker === "broadcast" || ev.worker === "signal") fields[ev.worker + (ev.ok ? "Ok" : "Refused")] = 1;
    return d.fsIncrement(d.env, d.token, "/launchUsage/" + enc(which + "_" + day), fields, { env: which, day: day });
  }

  /* Monitoring for the console. Each figure says where it comes from. */
  async function metrics(which, billing) {
    const t = now();
    const DAY = 86400000;
    const [users, active1, active7, bTotal, bPublic, sTotal, wl, openReports, pendingReview] = await Promise.all([
      countWhere("users"),
      countWhere("users", [gte("lastSeen", t - DAY)]),
      countWhere("users", [gte("lastSeen", t - 7 * DAY)]),
      countWhere("broadcasts"),
      countWhere("broadcasts", [eq("listed", true), eq("held", false), eq("hidden", false), eq("visibility", "public")]),
      countWhere("signals"),
      countWhere("waitlist", [eq("env", which)]),
      countWhere("reports", [eq("status", "OPEN")]),
      countWhere("users", [eq("publisherReview", "pending")]),
    ]);
    const c = await counter(which);
    const today = await usage(which, dayKey(t));
    const yesterday = await usage(which, dayKey(t - DAY));
    const lines = (billing && billing.usage) || {};
    const cf = (lines.cloudflare && lines.cloudflare.lines) || [];
    const fb = (lines.firebase && lines.firebase.lines) || [];
    const find = function (arr, key, src) { return arr.find(function (l) { return l.key === key && (!src || l.source === src); }); };
    const storage = find(cf, "r2_storage", "analytics");
    const classA = find(cf, "r2_class_a", "analytics");
    const reads = find(fb, "fs_reads");
    const billed = cf.filter(function (l) { return l.source === "billable-usage"; });
    const monthUsd = billed.length ? Math.round(billed.reduce(function (s, l) { return s + (Number(l.amount_usd) || 0); }, 0) * 100) / 100 : null;
    return {
      at: t,
      accounts: { registered: c.registered, profiles: users, source: "counted now" },
      active: { day: active1, week: active7, source: "counted now (lastSeen)" },
      broadcasts: { total: bTotal, public: bPublic, source: "counted now" },
      signals: { total: sTotal, source: "counted now" },
      waitlist: { size: wl, source: "counted now" },
      safety: { openReports: openReports, publishersAwaitingReview: pendingReview, refusedSignups: Number(c.data && c.data.refused) || 0, source: "counted now" },
      uploads: {
        today: { ok: Number(today.uploadsOk) || 0, refused: Number(today.uploadsRefused) || 0, bytes: Number(today.uploadBytes) || 0 },
        yesterday: { ok: Number(yesterday.uploadsOk) || 0, refused: Number(yesterday.uploadsRefused) || 0, bytes: Number(yesterday.uploadBytes) || 0 },
        refusedBy: Object.keys(today).filter(function (k) { return k.indexOf("refused_") === 0; }).reduce(function (o, k) { o[k.slice(8)] = Number(today[k]) || 0; return o; }, {}),
        source: "reported by the upload workers (live)",
      },
      storage: { bytes: storage ? Math.round(Number(storage.qty) * 1e9) : null, source: storage ? "Cloudflare analytics (delayed)" : "not connected" },
      delivered: { bytes: null, source: "not measured: R2 delivery is not reported per bucket and Cloudflare does not bill it" },
      processing: { source: "Naluno has no server-side video processing; videos are prepared on the phone" },
      r2ClassAToday: { n: classA ? Number(classA.qty) : null, source: classA ? "Cloudflare analytics (delayed)" : "not connected" },
      firestoreReadsToday: { n: reads ? Number(reads.qty) : null, source: reads ? "Google Cloud Monitoring (delayed)" : "not connected" },
      cost: {
        cloudflareMonthUsd: monthUsd,
        source: monthUsd == null ? "Cloudflare billable usage not connected" : "Cloudflare billable usage, month to date (actual usage charges, not an invoice)",
        firebase: "Firebase/Google charges are not read here: see Google Cloud billing",
        invoices: ((billing && billing.invoices) || []).slice(0, 6),
      },
    };
  }

  function guardMetrics(m) {
    return {
      storageBytes: m.storage.bytes, storageSource: m.storage.source,
      monthCostUsd: m.cost.cloudflareMonthUsd, monthCostSource: m.cost.source,
      todayUploadBytes: m.uploads.today.bytes, uploadSource: m.uploads.source,
      todayFirestoreReads: m.firestoreReadsToday.n, firestoreSource: m.firestoreReadsToday.source,
      todayR2ClassA: m.r2ClassAToday.n, r2Source: m.r2ClassAToday.source,
    };
  }

  /* The cron: measure, judge against the budgets, publish the guard state. */
  async function runGuard(which, billing) {
    const L = await load(which);
    const m = await metrics(which, billing);
    const g = evaluateGuard(L.cfg.guard, guardMetrics(m));
    const pub = await getRaw("/launchConfig/" + enc(which));
    const before = pub.exists && pub.data.guardState ? pub.data.guardState : null;
    const state = { level: g.level, at: now(), items: g.items, restricting: g.restricting };
    await d.fsPutDoc(d.env, d.token, "/launchConfig/" + enc(which), { guardState: state });
    if (!pub.exists) await d.fsPutDoc(d.env, d.token, "/launchConfig/" + enc(which), Object.assign(publicView(L.cfg), { guardState: state }));
    if (!before || before.level !== g.level || JSON.stringify(before.restricting) !== JSON.stringify(g.restricting)) {
      await audit({ env: which, action: "guard", actorUid: "cron", actorEmail: "", reason: "measured", changes: [{ setting: "guard.level", from: before ? before.level : null, to: g.level }, { setting: "guard.restricting", from: before ? before.restricting : null, to: g.restricting }], result: "ok" });
    }
    // The counter only ever moves up here (accounts made before seats
    // existed); seats a day old with no Callsign are handed back.
    if (m.accounts.profiles != null && (m.accounts.registered == null || m.accounts.profiles > m.accounts.registered)) {
      await d.fsPutDoc(d.env, d.token, "/launchState/" + enc(which), { registered: m.accounts.profiles, recountedAt: now() });
    }
    try { await expireSeats(which, 50); } catch (_) {}
    return { guard: g, metrics: m };
  }

  return {
    load, counter, status, claim, recount, expireSeats, persist, audit, waitJoin, waitLeave, listCol, metrics, runGuard, reportUpload, guardMetrics,
    activate: async function (which, phase, actor, reason) {
      const prev = await load(which);
      if (!prev.cfg.phases[phase]) return { ok: false, status: 400, errors: ["unknown phase"] };
      const next = activatePhase(prev.cfg, phase);
      const cmp = compareLimits(prev.cfg.media, next.media);
      const out = await persist(which, prev, next, actor, "activate-phase:" + phase, reason);
      out.lowered = cmp.lowered; out.raised = cmp.raised;
      return out;
    },
    rollback: async function (which, version, actor, reason) {
      const h = await getRaw("/launchHistory/" + enc(which + "-" + Number(version)));
      if (!h.exists) return { ok: false, status: 404, errors: ["that version is not in the history"] };
      let old;
      try { old = JSON.parse(h.data.config); } catch (_) { return { ok: false, status: 400, errors: ["that version cannot be read"] }; }
      const prev = await load(which);
      const next = withDefaults(old);
      next.env = which;
      next.version = prev.cfg.version;
      return persist(which, prev, next, actor, "rollback-to:" + version, reason);
    },
  };
}

export { FEATURES };
