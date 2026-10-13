/* 14 Oct: seats that stay unused for a day go back, the counter with them,
   in one commit; a seat whose Callsign exists is kept and marked. Recount
   never lowers the count of places given. */
import assert from "node:assert/strict";
import { makeLaunch } from "./launch-routes.mjs";

const ROOT = "https://firestore.googleapis.com/v1/projects/p/databases/(default)/documents";
const NAME = "projects/p/databases/(default)/documents/";
const store = new Map();   // path -> { f: {...plain}, t: updateTime }
let tick = 0;
const put = (p, f) => store.set(p, { f: Object.assign({}, (store.get(p) || {}).f || {}, f), t: "t" + (++tick) });
const toFs = (o) => ({ fields: Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === "boolean" ? { booleanValue: v } : typeof v === "number" ? { integerValue: String(v) } : { stringValue: String(v) }])) });
const fromFs = (doc) => {
  const out = { id: String(doc.name || "").split("/").pop() };
  Object.entries(doc.fields || {}).forEach(([k, v]) => { out[k] = v.booleanValue != null ? v.booleanValue : v.integerValue != null ? Number(v.integerValue) : v.stringValue; });
  return out;
};
const docOf = (p) => { const d = store.get(p); return d ? Object.assign({ name: NAME + p, updateTime: d.t }, toFs(d.f)) : null; };
const fsFetch = async (env, tok, method, path, body) => {
  if (path === ":runQuery") {
    const q = body.structuredQuery;
    const col = q.from[0].collectionId;
    const ff = q.where.fieldFilter;
    const rows = [...store.keys()].filter((k) => k.startsWith(col + "/") && k.split("/").length === 2)
      .filter((k) => store.get(k).f[ff.field.fieldPath] === ff.value.booleanValue)
      .slice(0, q.limit).map((k) => ({ document: docOf(k) }));
    return { ok: true, status: 200, data: rows };
  }
  if (path === ":runAggregationQuery") {
    const col = body.structuredAggregationQuery.structuredQuery.from[0].collectionId;
    const n = [...store.keys()].filter((k) => k.startsWith(col + "/") && k.split("/").length === 2).length;
    return { ok: true, status: 200, data: [{ result: { aggregateFields: { n: { integerValue: String(n) } } } }] };
  }
  if (path === ":commit") {
    for (const w of body.writes) {
      if (w.delete) {
        const p = w.delete.replace(NAME, "");
        if (w.currentDocument && w.currentDocument.updateTime && (!store.get(p) || store.get(p).t !== w.currentDocument.updateTime)) return { ok: false, status: 400 };
      }
    }
    for (const w of body.writes) {
      if (w.delete) store.delete(w.delete.replace(NAME, ""));
      if (w.transform) {
        const p = w.transform.document.replace(NAME, "");
        const cur = (store.get(p) || {}).f || {};
        w.transform.fieldTransforms.forEach((t) => { put(p, { [t.fieldPath]: (Number(cur[t.fieldPath]) || 0) + Number(t.increment.integerValue) }); });
      }
    }
    return { ok: true, status: 200, data: {} };
  }
  const p = decodeURIComponent(path.replace(/^\//, "").split("?")[0]);
  if (method === "GET") { const d = docOf(p); return d ? { ok: true, status: 200, data: d } : { ok: false, status: 404, data: null }; }
  return { ok: true, status: 200, data: {} };
};
const fsPutDoc = async (env, tok, path, obj) => { put(decodeURIComponent(path.replace(/^\//, "").split("?")[0]), obj); return { ok: true }; };
const NOW = Date.UTC(2026, 9, 14, 12);
const L = makeLaunch({ env: {}, token: "sa", fsFetch, fsPutDoc, fromFsDoc: fromFs, toFsFields: toFs, root: ROOT, now: () => NOW });

put("launchState/production", { registered: 35 });
for (let i = 0; i < 29; i++) put("users/old" + i + "xxxx", { name: "Old " + i });
// three seats: one a day old with a Callsign, one a day old without, one fresh without
put("users/kept01xx", { name: "Kept" });
put("registrations/kept01xx", { uid: "kept01xx", env: "production", at: NOW - 30 * 3600e3, profiled: false });
put("registrations/gone01xx", { uid: "gone01xx", env: "production", at: NOW - 30 * 3600e3, profiled: false });
put("registrations/new001xx", { uid: "new001xx", env: "production", at: NOW - 2 * 3600e3, profiled: false });
put("registrations/stage1xx", { uid: "stage1xx", env: "staging", at: NOW - 30 * 3600e3, profiled: false });

const out = await L.expireSeats("production", 50);
assert.deepEqual(out, { checked: 2, returned: 1, kept: 1 });
assert.equal(store.has("registrations/gone01xx"), false, "an unused day-old seat goes back");
assert.equal(store.get("launchState/production").f.registered, 34, "and its place with it");
assert.equal(store.get("registrations/kept01xx").f.profiled, true, "a used seat is marked, not looked at again");
assert.ok(store.has("registrations/new001xx"), "a seat less than a day old stays");
assert.ok(store.has("registrations/stage1xx"), "another environment's seats are not touched");
const again = await L.expireSeats("production", 50);
assert.deepEqual(again, { checked: 0, returned: 0, kept: 0 }, "nothing is counted twice");

const rc = await L.recount("production", null, "");
assert.equal(rc.registered, 34, "recount does not replace the places given");
assert.equal(store.get("launchState/production").f.registered, 34);
assert.equal(store.get("launchState/production").f.profileCount, 30);
console.log("seat-expiry: all checks passed");
