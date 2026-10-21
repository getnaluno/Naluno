/* One Firestore-like store shared by several Playwright pages. */
function makeStore(opts = {}) {
  const docs = new Map(); // path -> data (encoded: timestamps as {__ts})
  const listeners = new Map(); // key -> { page, id, spec, last }
  const log = [];
  const deny = opts.deny || (() => null); // (uid, kind, pathOrSpec) -> error string | null
  const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
  const tsMs = (v) => (v && typeof v === 'object' && typeof v.__ts === 'number' ? v.__ts : v);
  const getF = (o, f) => (f === '__name__' ? undefined : String(f).split('.').reduce((a, k) => (a == null ? undefined : a[k]), o));
  function setF(o, f, v) { const ks = String(f).split('.'); let c = o; for (let i = 0; i < ks.length - 1; i++) { if (!c[ks[i]] || typeof c[ks[i]] !== 'object') c[ks[i]] = {}; c = c[ks[i]]; } c[ks[ks.length - 1]] = v; }
  function delF(o, f) { const ks = String(f).split('.'); let c = o; for (let i = 0; i < ks.length - 1; i++) { if (!c[ks[i]]) return; c = c[ks[i]]; } delete c[ks[ks.length - 1]]; }
  const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  function resolve(cur, f, v) {
    if (v && typeof v === 'object' && v.__fv) {
      if (v.__fv === 'st') return { __ts: Date.now() };
      if (v.__fv === 'inc') return (Number(getF(cur, f)) || 0) + v.n;
      if (v.__fv === 'au') { const a = Array.isArray(getF(cur, f)) ? getF(cur, f).slice() : []; v.v.forEach((x) => { if (!a.some((y) => eq(x, y))) a.push(x); }); return a; }
      if (v.__fv === 'ar') { const a = Array.isArray(getF(cur, f)) ? getF(cur, f) : []; return a.filter((y) => !v.v.some((x) => eq(x, y))); }
      if (v.__fv === 'del') return undefined;
    }
    if (v && typeof v === 'object' && v.__undef) return undefined;
    if (v && typeof v === 'object' && !Array.isArray(v) && v.__ts === undefined && v.__ref === undefined) {
      const out = {}; Object.keys(v).forEach((k) => { const r = resolve(getF(cur, f) || {}, k, v[k]); if (r !== undefined) out[k] = r; }); return out;
    }
    return v;
  }
  function applyFields(base, data, dotted) {
    const out = clone(base) || {};
    Object.keys(data || {}).forEach((k) => {
      const v = data[k];
      if (!dotted && v && typeof v === 'object' && !Array.isArray(v) && !v.__fv && v.__ts === undefined && v.__ref === undefined && base && typeof base[k] === 'object' && base[k] && !Array.isArray(base[k]) && base[k].__ts === undefined) {
        out[k] = applyFields(base[k], v, false); return; // merge nested on set-merge
      }
      const r = resolve(base || {}, k, v);
      if (r === undefined) (dotted ? delF(out, k) : delete out[k]); else (dotted ? setF(out, k, r) : (out[k] = r));
    });
    return out;
  }
  function write(uid, w) {
    const err = deny(uid, w.kind, w.path, w.data, docs.get(w.path));
    if (err) return { error: err };
    const cur = docs.get(w.path);
    if (w.kind === 'set') docs.set(w.path, w.merge ? applyFields(cur || {}, w.data, false) : applyFields({}, w.data, false));
    else if (w.kind === 'update') { if (!cur) return { error: 'No document to update: ' + w.path }; docs.set(w.path, applyFields(cur, w.data, true)); }
    else if (w.kind === 'delete') docs.delete(w.path);
    log.push({ t: Date.now(), uid, kind: w.kind, path: w.path, data: w.data });
    return { ok: true };
  }
  const colOf = (p) => p.split('/').slice(0, -1).join('/');
  function cmp(a, b) { a = tsMs(a); b = tsMs(b); if (a === b) return 0; if (a === undefined || a === null) return -1; if (b === undefined || b === null) return 1; return a < b ? -1 : 1; }
  function match(d, w) {
    const [f, o, v0] = w; const v = tsMs(v0); const x = tsMs(getF(d.data, f));
    const fx = f === '__name__' ? d.path.split('/').pop() : x;
    switch (o) {
      case '==': return eq(fx, v);
      case '!=': return fx !== undefined && !eq(fx, v);
      case '<': return fx !== undefined && fx < v;
      case '<=': return fx !== undefined && fx <= v;
      case '>': return fx !== undefined && fx > v;
      case '>=': return fx !== undefined && fx >= v;
      case 'in': return (v || []).some((y) => eq(fx, tsMs(y)));
      case 'not-in': return fx !== undefined && !(v || []).some((y) => eq(fx, tsMs(y)));
      case 'array-contains': return Array.isArray(x) && x.some((y) => eq(y, v));
      case 'array-contains-any': return Array.isArray(x) && x.some((y) => (v || []).some((z) => eq(y, z)));
      default: return false;
    }
  }
  function run(spec) {
    let out = [];
    for (const [p, data] of docs) {
      const col = colOf(p);
      if (spec.group ? col.split('/').pop() !== spec.path : col !== spec.path) continue;
      out.push({ path: p, data });
    }
    out = out.filter((d) => (spec.wheres || []).every((w) => match(d, w)));
    const ob = spec.orderBy || [];
    ob.forEach(([f]) => { if (f !== '__name__') out = out.filter((d) => getF(d.data, f) !== undefined); });
    out.sort((a, b) => { for (const [f, dir] of ob) { const c = f === '__name__' ? cmp(a.path, b.path) : cmp(getF(a.data, f), getF(b.data, f)); if (c) return dir === 'desc' ? -c : c; } return cmp(a.path, b.path); });
    const cursor = spec.startAfter || spec.startAt;
    if (cursor && ob.length) {
      let vals = cursor;
      if (cursor[0] && cursor[0].__docPath) { const dd = docs.get(cursor[0].__docPath) || {}; vals = ob.map(([f]) => (f === '__name__' ? cursor[0].__docPath : getF(dd, f))); }
      out = out.filter((d) => {
        for (let i = 0; i < ob.length && i < vals.length; i++) {
          const [f, dir] = ob[i]; let c = f === '__name__' ? cmp(d.path, vals[i]) : cmp(getF(d.data, f), vals[i]); if (dir === 'desc') c = -c;
          if (c > 0) return true; if (c < 0) return false;
        }
        return !!spec.startAt;
      });
    }
    if (spec.limit) out = out.slice(0, spec.limit);
    if (spec.limitToLast) out = out.slice(-spec.limitToLast);
    return out;
  }
  function snapFor(L) {
    if (L.spec.doc) { const d = docs.get(L.spec.doc); const s = JSON.stringify(d === undefined ? null : d); if (s === L.last) return null; L.last = s; return { data: d === undefined ? null : d }; }
    const res = run(L.spec);
    const prev = L.last ? JSON.parse(L.last) : null;
    const now = res.map((d) => [d.path, JSON.stringify(d.data)]);
    const s = JSON.stringify(now);
    if (prev && s === L.last) return null;
    const changes = [];
    const prevIdx = new Map((prev || []).map((x, i) => [x[0], [i, x[1]]]));
    now.forEach((x, i) => { const p = prevIdx.get(x[0]); if (!p) changes.push({ type: 'added', path: x[0], oldIndex: -1, newIndex: i }); else if (p[1] !== x[1]) changes.push({ type: 'modified', path: x[0], oldIndex: p[0], newIndex: i }); });
    const nowSet = new Set(now.map((x) => x[0]));
    (prev || []).forEach((x, i) => { if (!nowSet.has(x[0])) changes.push({ type: 'removed', path: x[0], data: JSON.parse(x[1]), oldIndex: i, newIndex: -1 }); });
    L.last = s;
    return { docs: res, changes };
  }
  function fire(L) {
    const s = snapFor(L); if (!s) return;
    L.page.evaluate(([id, j]) => { window.__fsfire && window.__fsfire(id, j); }, [L.id, JSON.stringify(s)]).catch(() => {});
  }
  const notifyAll = () => setTimeout(() => { for (const L of listeners.values()) if (!L.paused) fire(L); }, opts.latencyMs || opts.opDelayMs || 15);
  const pageTags = new WeakMap(); let pageN = 0;
  const tagOf = (page) => { if (!pageTags.has(page)) pageTags.set(page, ++pageN); return pageTags.get(page); };
  async function handle(page, uid0, raw) {
    const m = JSON.parse(raw);
    const uid = m.as === undefined ? uid0 : m.as;
    if (m.op === 'signout') {
      /* Firestore ends every listener of this page whose rule now fails. */
      for (const [key, L] of [...listeners.entries()]) {
        if (L.page !== page) continue;
        const e = deny(null, L.spec.doc ? 'get' : 'list', L.spec.doc || L.spec.path, L.spec);
        if (e) { listeners.delete(key); page.evaluate(([id, j]) => window.__fsfire && window.__fsfire(id, j), [L.id, JSON.stringify({ error: e })]).catch(() => {}); }
        else L.uid = null;
      }
      return 'null';
    }
    if (opts.opDelayMs && m.op !== 'unlisten') await new Promise((r) => setTimeout(r, opts.opDelayMs));
    if (opts.jitterMs && m.op === 'get') await new Promise((r) => setTimeout(r, Math.random() * opts.jitterMs));
    if (opts.offline && opts.offline(uid)) { await new Promise(() => {}); }
    switch (m.op) {
      case 'get': { const e = deny(uid, 'get', m.path); if (e) return JSON.stringify({ __err: e }); const d = docs.get(m.path); return JSON.stringify(d === undefined ? null : d); }
      case 'query': { const e = deny(uid, 'list', m.spec.path, m.spec); if (e) return JSON.stringify({ error: e }); return JSON.stringify({ docs: run(m.spec), changes: [] }); }
      case 'set': case 'update': case 'delete': { const r = write(uid, { kind: m.op, path: m.path, data: m.data, merge: m.merge }); notifyAll(); return JSON.stringify(r.error ? r : null); }
      case 'batch': {
        /* All or nothing, and judged by the same rules as single writes. */
        for (const w of m.writes) { const e = deny(uid, w.kind, w.path, w.data, docs.get(w.path)); if (e) return JSON.stringify({ error: e }); }
        for (const w of m.writes) write(uid, w);
        notifyAll(); return 'null';
      }
      case 'listen': {
        const e = deny(uid, m.spec.doc ? 'get' : 'list', m.spec.doc || m.spec.path, m.spec);
        const key = uid + ':' + tagOf(page) + ':' + m.id;
        if (e) { const code = /^failed-precondition:/.test(e) ? 'failed-precondition' : undefined; setTimeout(() => page.evaluate(([id, j]) => window.__fsfire && window.__fsfire(id, j), [m.id, JSON.stringify({ error: e, code })]).catch(() => {}), 5); return 'null'; }
        const L = { page, uid, id: m.id, spec: m.spec, last: null };
        listeners.set(key, L);
        setTimeout(() => fire(L), 5);
        return 'null';
      }
      case 'unlisten': listeners.delete(uid0 + ':' + tagOf(page) + ':' + m.id); listeners.delete('null:' + tagOf(page) + ':' + m.id); return 'null';
    }
    return 'null';
  }
  return {
    docs, log, listeners,
    seed(path, data) { docs.set(path, data); },
    get: (p) => docs.get(p),
    query: run,
    async attach(ctx, uid) {
      await ctx.addInitScript((u) => { window.__AUDIT_UID = u; }, uid);
      await ctx.exposeBinding('__fsop', (src, raw) => handle(src.page, uid, raw));
    },
    pauseListenersFor(uid, on) { for (const L of listeners.values()) if (L.uid === uid) L.paused = !!on; if (!on) notifyAll(); },
    write: (uid, w) => { const r = write(uid, w); notifyAll(); return r; },
  };
}
module.exports = { makeStore };
