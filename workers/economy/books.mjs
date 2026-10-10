/* Vendor meters for Books.
   Cloudflare billable usage is the cost (daily).
   Cloudflare analytics is today's counts, not the bill.
   Firebase Cloud Monitoring is today's Firestore counts.
   None of these are a bank charge. A charge still comes from billing history. */

/* 29h: the running rate, set from economyConfig/fxRates or the live feed.
   Vendor unit prices come from economyConfig/costRates. If neither is
   loaded, amounts stay empty. Nothing here invents a rate. */
let USD_AED = 0;
let RATES = null;
let READ_USD = null;
let WRITE_USD = null;
let DELETE_USD = null;
let STORAGE_USD = null;
export function setBookRates(rates) {
  if (!rates || typeof rates !== "object") return;
  const aed = Number(rates.AED);
  if (isFinite(aed) && aed > 0) USD_AED = aed;
  RATES = rates;
}
export function setVendorPrices(rates) {
  if (!rates || typeof rates !== "object") return;
  function pick(key) {
    const n = Number(rates[key]);
    return isFinite(n) && n >= 0 ? n : null;
  }
  const read = pick("firestore_read_100k_usd");
  const write = pick("firestore_write_100k_usd");
  const del = pick("firestore_delete_100k_usd");
  const storage = pick("firestore_storage_gb_month_usd");
  if (read != null) READ_USD = read / 100000;
  if (write != null) WRITE_USD = write / 100000;
  if (del != null) DELETE_USD = del / 100000;
  if (storage != null) STORAGE_USD = storage;
}
const CACHE_MS = 3 * 60 * 1000;
const cache = { at: 0, value: null };
let inflight = null;

const READ_CAP = 50000;
const WRITE_CAP = 20000;
const DELETE_CAP = 20000;
const STORAGE_CAP_GB = 1;

const CLASS_A = {
  listbuckets: 1, putbucket: 1, listobjects: 1, listobjectsv2: 1, putobject: 1,
  copyobject: 1, completemultipartupload: 1, createmultipartupload: 1,
  lifecyclestoragetiertransition: 1, listmultipartuploads: 1, uploadpart: 1,
  uploadpartcopy: 1, listparts: 1, putbucketencryption: 1, putbucketcors: 1,
  putbucketlifecycleconfiguration: 1, classa: 1,
};
const CLASS_B = {
  headbucket: 1, headobject: 1, getobject: 1, usagesummary: 1,
  getbucketencryption: 1, getbucketlocation: 1, getbucketcors: 1,
  getbucketlifecycleconfiguration: 1, classb: 1,
};

function num(v) {
  const n = Number(v);
  return isFinite(n) ? n : 0;
}
function round2(n) {
  return Math.round(num(n) * 100) / 100;
}
export function usdToAed(usd) {
  if (!(USD_AED > 0)) return null;
  const n = num(usd);
  if (!isFinite(n)) return null;
  return round2(n * USD_AED);
}
function clip(s, n) {
  s = String(s || "").replace(/\s+/g, " ").trim();
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

export function classifyCloudflareService(family, name) {
  const s = (String(family || "") + " " + String(name || "")).toLowerCase();
  if (/r2/.test(s) && /class\s*a|a operation/.test(s)) return "r2_class_a";
  if (/r2/.test(s) && /class\s*b|b operation/.test(s)) return "r2_class_b";
  if (/r2/.test(s) && /storage|gb-month|gigabyte/.test(s)) return "r2_storage";
  if (/^r2$/.test(String(family || "").toLowerCase()) && /storage/.test(s)) return "r2_storage";
  if (/worker/.test(s)) return "workers";
  if (/realtime|calls|turn/.test(s)) return "turn";
  return "";
}

export function mapBillableRows(rows) {
  const grouped = {};
  (Array.isArray(rows) ? rows : []).forEach(function (row) {
    if (!row || typeof row !== "object") return;
    const family = row.ServiceFamilyName || row.serviceFamilyName || "";
    const name = row.ServiceName || row.serviceName || "";
    const key = classifyCloudflareService(family, name);
    if (!key) return;
    const qty = num(row.ConsumedQuantity != null ? row.ConsumedQuantity : row.PricingQuantity);
    const cost = num(row.ContractedCost != null ? row.ContractedCost : row.contractedCost);
    const unit = String(row.ConsumedUnit || row.consumedUnit || "");
    if (!grouped[key]) grouped[key] = { key: key, qty: 0, cost: 0, unit: unit, service: String(name || family || key) };
    grouped[key].qty += qty;
    grouped[key].cost += cost;
    if (unit) grouped[key].unit = unit;
  });
  return Object.keys(grouped).map(function (k) {
    const g = grouped[k];
    return {
      key: g.key,
      service: g.service,
      qty: g.qty,
      unit: g.unit,
      amount_usd: round2(g.cost),
      amount_aed: usdToAed(g.cost),
      source: "billable-usage",
    };
  });
}

export function mapR2Ops(groups) {
  let classA = 0;
  let classB = 0;
  (Array.isArray(groups) ? groups : []).forEach(function (g) {
    if (!g) return;
    const action = String((g.dimensions && g.dimensions.actionType) || "").toLowerCase();
    const requests = num(g.sum && g.sum.requests);
    if (CLASS_A[action]) classA += requests;
    else if (CLASS_B[action]) classB += requests;
  });
  return { classA: classA, classB: classB };
}

export function sumSeries(seriesList) {
  let n = 0;
  (Array.isArray(seriesList) ? seriesList : []).forEach(function (s) {
    ((s && s.points) || []).forEach(function (p) {
      const v = (p && p.value) || {};
      const x = v.int64Value != null ? num(v.int64Value) : num(v.doubleValue);
      n += x;
    });
  });
  return n;
}

export function latestGauge(seriesList) {
  let best = null;
  let bestT = -1;
  (Array.isArray(seriesList) ? seriesList : []).forEach(function (s) {
    ((s && s.points) || []).forEach(function (p) {
      const t = Date.parse((p.interval && p.interval.endTime) || "") || 0;
      if (t < bestT) return;
      const v = p.value || {};
      bestT = t;
      best = v.int64Value != null ? num(v.int64Value) : num(v.doubleValue);
    });
  });
  return best;
}

export function preferOps(seriesList) {
  const list = Array.isArray(seriesList) ? seriesList : [];
  const ops = list.filter(function (s) { return /_ops_count/.test(String((s.metric && s.metric.type) || "")); });
  return ops.length ? ops : list;
}

export function splitSeries(seriesList) {
  const ops = { read: [], write: [], del: [] };
  const gauge = [];
  (Array.isArray(seriesList) ? seriesList : []).forEach(function (s) {
    const t = String((s.metric && s.metric.type) || "");
    if (/storage|byte_size|bytes/.test(t)) gauge.push(s);
    else if (/delete/.test(t)) ops.del.push(s);
    else if (/write/.test(t)) ops.write.push(s);
    else if (/read/.test(t)) ops.read.push(s);
  });
  return { ops: ops, gauge: gauge };
}

function overage(qty, cap, usdEach) {
  if (usdEach == null || !(USD_AED > 0)) return null;
  const extra = Math.max(0, num(qty) - cap);
  return usdToAed(extra * usdEach);
}

export function firebaseLines(counts) {
  counts = counts || {};
  const reads = num(counts.reads);
  const writes = num(counts.writes);
  const deletes = num(counts.deletes);
  const gb = num(counts.storageGb);
  function line(key, service, qty, unit, cap, amount) {
    const over = qty > cap;
    return {
      key: key,
      service: service,
      qty: qty,
      unit: unit,
      cap: cap,
      amount_aed: amount,
      source: "monitoring",
      note: "Firebase counted " + qty + " " + unit + ". Published cap is " + cap
        + (over ? ". The amount is the published price of today's excess, not an invoice." : ". Inside that cap. Not an invoice."),
    };
  }
  const out = [
    line("fs_reads", "Firestore reads", reads, "reads today", READ_CAP, overage(reads, READ_CAP, READ_USD)),
    line("fs_writes", "Firestore writes", writes, "writes today", WRITE_CAP, overage(writes, WRITE_CAP, WRITE_USD)),
    line("fs_deletes", "Firestore deletes", deletes, "deletes today", DELETE_CAP, overage(deletes, DELETE_CAP, DELETE_USD)),
  ];
  if (counts.storageGb != null) {
    out.push(line("fs_storage", "Firestore storage", Math.round(gb * 1000) / 1000, "GB", STORAGE_CAP_GB, overage(gb, STORAGE_CAP_GB, STORAGE_USD)));
  }
  return out;
}

export function pacificMidnightIso(now) {
  const d = new Date(now);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(d);
  const get = function (t) {
    const p = parts.filter(function (x) { return x.type === t; })[0];
    return p ? Number(p.value) : 0;
  };
  const elapsed = ((get("hour") * 60 + get("minute")) * 60 + get("second")) * 1000;
  return new Date(now - elapsed).toISOString();
}

function monthStart(now) {
  const d = new Date(now);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString().slice(0, 10);
}
function dayStamp(now) {
  return new Date(now).toISOString().slice(0, 10);
}

async function readJson(ask, url, opts) {
  const res = await ask(url, opts);
  const data = await res.json().catch(function () { return {}; });
  return { ok: res.ok, status: res.status, data: data };
}

function cfNote(line, fetchedAt) {
  const when = new Date(fetchedAt).toISOString().slice(0, 16).replace("T", " ") + " UTC";
  if (line.source === "analytics") {
    return "Cloudflare counted " + line.qty + " " + (line.unit || "") + ". Not the bill. Fetched " + when + ".";
  }
  return "Cloudflare billable usage: " + line.qty + " " + (line.unit || "") + ", " + line.amount_usd + " USD. Updated daily, not live. Fetched " + when + ".";
}

export async function billingSnapshot(env, extras) {
  extras = extras || {};
  const now = Date.now();
  if (cache.value && now - cache.at < CACHE_MS) return cache.value;
  if (inflight) return inflight;
  inflight = collect(env, extras, now).then(function (value) {
    cache.at = Date.now();
    cache.value = value;
    return value;
  }).finally(function () { inflight = null; });
  return inflight;
}

export function resetBillingCache() {
  cache.at = 0;
  cache.value = null;
  inflight = null;
}

async function collect(env, extras, now) {
  const ask = extras.fetch || fetch;
  const token = env && (env.CF_API_TOKEN || env.CLOUDFLARE_API_TOKEN);
  const account = env && (env.CF_ACCOUNT_ID || env.CLOUDFLARE_ACCOUNT_ID);
  const project = extras.projectId || (env && (env.FIREBASE_PROJECT_ID || env.GCP_PROJECT)) || "";
  const value = {
    connected: !!(token && account),
    invoices: [],
    usage: {
      fetchedAt: now,
      cloudflare: { ok: false, error: "", lines: [] },
      firebase: { ok: false, error: "", lines: [] },
    },
  };
  if (!token || !account) value.usage.cloudflare.error = "Cloudflare billing is not connected.";

  const jobs = [];
  if (token && account) {
    jobs.push(pullHistory(ask, token, account, now).then(function (r) {
      value.invoices = r.invoices;
      if (r.error && !value.usage.cloudflare.error) value.usage.cloudflare.error = r.error;
    }));
    jobs.push(pullBillable(ask, token, account, now).then(function (r) {
      if (r.ok) {
        value.usage.cloudflare.ok = true;
        value.usage.cloudflare.lines = value.usage.cloudflare.lines.concat(r.lines);
      } else if (r.error) value.usage.cloudflare.error = r.error;
    }));
    jobs.push(pullAnalytics(ask, token, account, now).then(function (r) {
      if (r.ok) {
        value.usage.cloudflare.ok = true;
        const have = {};
        value.usage.cloudflare.lines.forEach(function (l) { have[l.key] = 1; });
        r.lines.forEach(function (l) { if (!have[l.key]) value.usage.cloudflare.lines.push(l); });
      } else if (r.error && !value.usage.cloudflare.ok) value.usage.cloudflare.error = r.error;
    }));
  }
  jobs.push(pullFirebase(ask, project, extras.getMonitoringToken, now).then(function (r) {
    value.usage.firebase.ok = !!r.ok;
    value.usage.firebase.error = r.error || "";
    value.usage.firebase.lines = r.lines || [];
  }));
  await Promise.all(jobs);
  if (value.usage.cloudflare.ok) value.usage.cloudflare.error = "";
  return value;
}

async function pullHistory(ask, token, account, now) {
  try {
    const res = await readJson(ask, "https://api.cloudflare.com/client/v4/accounts/" + encodeURIComponent(account) + "/billing/history", {
      headers: { Authorization: "Bearer " + token },
    });
    if (!res.ok) return { invoices: [], error: clip("Cloudflare billing history refused (" + res.status + ").", 140) };
    const invoices = [];
    ((res.data && res.data.result) || []).forEach(function (row) {
      if (!row) return;
      const raw = Number(row.amount != null ? row.amount : row.total);
      if (!isFinite(raw) || raw === 0) return;
      const currency = String(row.currency || "USD").toUpperCase();
      const per = RATES && Number(RATES[currency]) > 0 ? Number(RATES[currency]) : (currency === "USD" ? 1 : 0);
      let aed = null;
      if (currency === "AED") aed = raw;
      else if (per > 0 && USD_AED > 0) aed = (raw / per) * USD_AED;
      const when = Date.parse(row.occurred_at || row.created_on || row.period || "") || now;
      invoices.push({
        key: "cloudflare",
        vendor: "Cloudflare",
        amount_aed: aed == null ? null : round2(aed),
        status: "invoiced",
        source: "cloudflare",
        note: row.type || row.action || row.description || "Cloudflare billing history",
        updatedAt: when,
      });
    });
    return { invoices: invoices, error: "" };
  } catch (e) {
    return { invoices: [], error: clip((e && e.message) || "Cloudflare billing history failed.", 140) };
  }
}

async function pullBillable(ask, token, account, now) {
  try {
    const url = "https://api.cloudflare.com/client/v4/accounts/" + encodeURIComponent(account)
      + "/billable-usage?from=" + monthStart(now) + "&to=" + dayStamp(now);
    const res = await readJson(ask, url, { headers: { Authorization: "Bearer " + token } });
    if (!res.ok) {
      if (res.status === 404) return { ok: false, error: "" };
      return { ok: false, error: clip("Cloudflare billable usage refused (" + res.status + "). The token needs Billing Read.", 160) };
    }
    const rows = (res.data && (res.data.result || res.data.usage)) || [];
    const lines = mapBillableRows(rows).map(function (l) {
      l.note = cfNote(l, now);
      return l;
    });
    return { ok: true, lines: lines, error: "" };
  } catch (e) {
    return { ok: false, error: clip((e && e.message) || "Cloudflare billable usage failed.", 140) };
  }
}

async function pullAnalytics(ask, token, account, now) {
  const start = pacificMidnightIso(now);
  const end = new Date(now).toISOString();
  const query = "query ($account: String!, $start: Time!, $end: Time!) { viewer { accounts(filter: { accountTag: $account }) { workersInvocationsAdaptive(limit: 1000, filter: { datetime_geq: $start, datetime_leq: $end }) { sum { requests } } r2OperationsAdaptiveGroups(limit: 1000, filter: { datetime_geq: $start, datetime_leq: $end }) { sum { requests } dimensions { actionType } } r2StorageAdaptiveGroups(limit: 10, filter: { datetime_geq: $start, datetime_leq: $end }) { max { payloadSize } } } } }";
  try {
    const res = await readJson(ask, "https://api.cloudflare.com/client/v4/graphql", {
      method: "POST",
      headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
      body: JSON.stringify({ query: query, variables: { account: account, start: start, end: end } }),
    });
    if (!res.ok) return { ok: false, error: clip("Cloudflare analytics refused (" + res.status + ").", 140) };
    if (res.data && res.data.errors && res.data.errors.length && !(res.data.data && res.data.data.viewer)) {
      return { ok: false, error: clip(res.data.errors[0].message || "Cloudflare analytics refused.", 140) };
    }
    const acc = (((res.data || {}).data || {}).viewer || {}).accounts;
    const box = (Array.isArray(acc) ? acc[0] : acc) || {};
    const lines = [];
    let requests = 0;
    (box.workersInvocationsAdaptive || []).forEach(function (g) { requests += num(g.sum && g.sum.requests); });
    if (requests > 0) {
      lines.push({
        key: "workers", qty: requests, unit: "requests today", amount_aed: 0, amount_usd: 0,
        source: "analytics", service: "Workers", note: cfNote({ qty: requests, unit: "requests today", source: "analytics" }, now),
      });
    }
    const ops = mapR2Ops(box.r2OperationsAdaptiveGroups || []);
    if (ops.classA > 0) {
      lines.push({
        key: "r2_class_a", qty: ops.classA, unit: "class A today", amount_aed: 0, amount_usd: 0,
        source: "analytics", service: "R2 uploads", note: cfNote({ qty: ops.classA, unit: "class A today", source: "analytics" }, now),
      });
    }
    if (ops.classB > 0) {
      lines.push({
        key: "r2_class_b", qty: ops.classB, unit: "class B today", amount_aed: 0, amount_usd: 0,
        source: "analytics", service: "R2 reads", note: cfNote({ qty: ops.classB, unit: "class B today", source: "analytics" }, now),
      });
    }
    let bytes = 0;
    (box.r2StorageAdaptiveGroups || []).forEach(function (g) { bytes = Math.max(bytes, num(g.max && g.max.payloadSize)); });
    if (bytes > 0) {
      const gb = Math.round((bytes / 1e9) * 1000) / 1000;
      lines.push({
        key: "r2_storage", qty: gb, unit: "GB", amount_aed: 0, amount_usd: 0,
        source: "analytics", service: "R2 storage", note: cfNote({ qty: gb, unit: "GB", source: "analytics" }, now),
      });
    }
    return { ok: true, lines: lines, error: "" };
  } catch (e) {
    return { ok: false, error: clip((e && e.message) || "Cloudflare analytics failed.", 140) };
  }
}

async function pullFirebase(ask, project, getToken, now) {
  if (!project || typeof getToken !== "function") {
    return { ok: false, error: "Firebase is not counted. The worker has no service account.", lines: [] };
  }
  let token = "";
  try { token = await getToken(); } catch (_) { token = ""; }
  if (!token) return { ok: false, error: "Firebase is not counted. The worker has no service account.", lines: [] };
  const start = pacificMidnightIso(now);
  const end = new Date(now).toISOString();
  const filter = [
    'metric.type="firestore.googleapis.com/document/read_ops_count"',
    'metric.type="firestore.googleapis.com/document/write_ops_count"',
    'metric.type="firestore.googleapis.com/document/delete_ops_count"',
    'metric.type="firestore.googleapis.com/document/read_count"',
    'metric.type="firestore.googleapis.com/document/write_count"',
    'metric.type="firestore.googleapis.com/document/delete_count"',
    'metric.type="firestore.googleapis.com/storage/data_and_index_storage_bytes"',
  ].join(" OR ");
  const url = "https://monitoring.googleapis.com/v3/projects/" + encodeURIComponent(project)
    + "/timeSeries?filter=" + encodeURIComponent(filter)
    + "&interval.startTime=" + encodeURIComponent(start)
    + "&interval.endTime=" + encodeURIComponent(end);
  try {
    const res = await readJson(ask, url, { headers: { Authorization: "Bearer " + token } });
    if (res.status === 403) {
      return { ok: false, error: "Cloud Monitoring refused this account. It needs Monitoring Viewer.", lines: [] };
    }
    if (!res.ok) {
      const msg = (res.data && res.data.error && res.data.error.message) || ("Cloud Monitoring refused (" + res.status + ").");
      return { ok: false, error: clip(msg, 160), lines: [] };
    }
    const series = (res.data && res.data.timeSeries) || [];
    if (!series.length) return { ok: false, error: "Cloud Monitoring returned no Firestore series.", lines: [] };
    const split = splitSeries(series);
    const storageBytes = latestGauge(split.gauge);
    const counts = {
      reads: sumSeries(preferOps(split.ops.read)),
      writes: sumSeries(preferOps(split.ops.write)),
      deletes: sumSeries(preferOps(split.ops.del)),
      storageGb: storageBytes == null ? null : storageBytes / 1e9,
    };
    return { ok: true, error: "", lines: firebaseLines(counts) };
  } catch (e) {
    return { ok: false, error: clip((e && e.message) || "Cloud Monitoring failed.", 140), lines: [] };
  }
}
