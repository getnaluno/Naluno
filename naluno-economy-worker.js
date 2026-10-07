// band-sweep.mjs
var BAND_SETTLE_MS = 2 * 60 * 60 * 1e3;
var PRESENCE_FRESH_MS = 90 * 1e3;
var PRESENCE_STALE_MS = 5 * 60 * 1e3;
var MAX_MESSAGES_PER_BAND = 4e3;
var MAX_BANDS_PER_RUN = 1500;
var MAX_SWEEPS_PER_RUN = 150;
var FUTURE_SLACK_MS = 15 * 60 * 1e3;
var LEGACY_RECHECK_MS = 3 * 60 * 60 * 1e3;
function num(v) {
  const n = Number(v);
  return isFinite(n) && n > 0 ? n : 0;
}
function bandSweepPlan({ band, presence, newestMsgMs, now }) {
  const b = band || {};
  const t = num(now) || Date.now();
  const beats = (presence || []).map((p) => num(p && p.tunedInAt));
  const freshHere = beats.some((ts) => ts && t - ts < PRESENCE_FRESH_MS);
  const aliveAt = num(b.aliveAt);
  const epoch = num(b.messageEpoch);
  const plan = {
    dead: false,
    deleteUpTo: 0,
    // delete messages with ts <= this (ms)
    deleteBefore: epoch,
    // and every message with ts < the epoch line
    stampAliveAt: 0,
    // older Band: set aliveAt to this (ms)
    revive: null,
    // people on an older app are here: { aliveAt, epoch }
    futureAfter: 0,
    // delete messages dated after this (ms)
    dropStalePresence: beats.filter((ts) => !ts || t - ts > PRESENCE_STALE_MS).length > 0
  };
  if (aliveAt) {
    const deadline = aliveAt + BAND_SETTLE_MS;
    if (t > deadline) {
      plan.deleteUpTo = deadline;
      plan.futureAfter = t + FUTURE_SLACK_MS;
      if (freshHere) {
        plan.revive = { aliveAt: t, epoch: Math.max(deadline, epoch) };
        plan.deleteBefore = Math.max(epoch, deadline);
      } else {
        plan.dead = true;
      }
    }
    return plan;
  }
  if (freshHere) return plan;
  const lastSeen = Math.max(num(newestMsgMs), num(b.lastEmptiedAt), ...beats, 0);
  if (lastSeen && t - lastSeen >= BAND_SETTLE_MS) {
    plan.dead = true;
    plan.deleteUpTo = lastSeen + BAND_SETTLE_MS;
    plan.futureAfter = t + FUTURE_SLACK_MS;
    plan.stampAliveAt = lastSeen;
  }
  return plan;
}
function messageGoes(plan, msgTs) {
  const ts = num(msgTs);
  if (plan.deleteBefore && ts < plan.deleteBefore) return true;
  if ((plan.dead || plan.revive) && plan.deleteUpTo && ts <= plan.deleteUpTo) return true;
  if (plan.futureAfter && ts > plan.futureAfter) return true;
  return false;
}
function mediaKeyFor(url, fromUid, mediaBase) {
  if (Array.isArray(mediaBase)) {
    for (const base2 of mediaBase) {
      const k = mediaKeyFor(url, fromUid, base2);
      if (k) return { key: k, base: base2 };
    }
    return "";
  }
  const u = String(url || "");
  const from = String(fromUid || "");
  if (!u || !from || !/^[A-Za-z0-9_-]{6,128}$/.test(from)) return "";
  let parsed;
  try {
    parsed = new URL(u);
  } catch {
    return "";
  }
  let base;
  try {
    base = new URL(mediaBase);
  } catch {
    return "";
  }
  if (parsed.protocol !== "https:" || parsed.host !== base.host) return "";
  const m = parsed.pathname.match(/^\/o\/(u\/([A-Za-z0-9_-]{6,128})\/[A-Za-z0-9._-]{1,120})$/);
  if (!m || m[2] !== from) return "";
  return m[1];
}
async function sweepBand(io, bandId, now, opts = {}) {
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
  if (aliveAt && t <= aliveAt + BAND_SETTLE_MS && !epoch) {
    return { ok: true, dead: false, deleted: 0 };
  }
  const messages = await io.listDocs(base + "/messages", ["ts", "mediaUrl", "from"], MAX_MESSAGES_PER_BAND);
  let newest = 0;
  messages.forEach((m) => {
    const ts = num(m.data && m.data.ts);
    if (ts > newest) newest = ts;
  });
  const plan = bandSweepPlan({ band, presence: presence.map((p) => p.data || {}), newestMsgMs: newest, now: t });
  const writes = [];
  const keys = [];
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
    currentDocument: got.updateTime ? { updateTime: got.updateTime } : { exists: true }
  } : null;
  let ok = true;
  for (let i = 0; i < writes.length; i += 450) {
    const r = await io.commit(writes.slice(i, i + 450));
    if (!r) ok = false;
  }
  if (plan.dead && ok && complete) {
    bandFields.sweptAt = { timestampValue: new Date(t).toISOString() };
    if (bandWrite) {
      bandWrite.update.fields = bandFields;
      bandWrite.updateMask.fieldPaths = Object.keys(bandFields);
    }
  }
  const finalWrite = bandWrite || (bandFields.sweptAt ? {
    update: { name: io.docName(base), fields: bandFields },
    updateMask: { fieldPaths: Object.keys(bandFields) },
    currentDocument: got.updateTime ? { updateTime: got.updateTime } : { exists: true }
  } : null);
  if (finalWrite) {
    try {
      await io.commit([finalWrite]);
    } catch {
    }
  }
  let dropped = 0;
  if (keys.length && io.dropMedia) {
    try {
      dropped = await io.dropMedia(keys);
    } catch {
      dropped = 0;
    }
  }
  return { ok, dead: plan.dead, revived: !!plan.revive, complete, deleted: gone.length, files: dropped };
}
function bandNeedsSweep(band, now) {
  const b = band || {};
  const t = num(now) || Date.now();
  const aliveAt = num(b.aliveAt);
  const swept = num(b.sweptAt);
  if (aliveAt) {
    const deadline = aliveAt + BAND_SETTLE_MS;
    if (t <= deadline) return false;
    return !(swept && swept > deadline);
  }
  const checked = num(b.checkedAt);
  return !(checked && t - checked < LEGACY_RECHECK_MS);
}
async function sweepAllBands(io, now, opts = {}) {
  const t = num(now) || Date.now();
  const bands = await io.listDocs("/bands", ["aliveAt", "sweptAt", "checkedAt"], MAX_BANDS_PER_RUN);
  let looked = 0, deleted = 0, dead = 0, files = 0;
  const due = bands.filter((b) => bandNeedsSweep(b.data, t)).sort((a, b) => (num(a.data.aliveAt) ? 0 : 1) - (num(b.data.aliveAt) ? 0 : 1)).slice(0, MAX_SWEEPS_PER_RUN);
  for (const b of due) {
    looked++;
    try {
      const r = await sweepBand(io, b.id, t, opts);
      deleted += r.deleted || 0;
      files += r.files || 0;
      if (r.dead) dead++;
    } catch {
    }
  }
  return { ok: true, bands: bands.length, looked, dead, deleted, files };
}

// screen.mjs
var SCREEN_MAX_FRAMES = 8;
var SEX_WORDS = /\b(porn|porno|xxx|nsfw|onlyfans|nudes?|naked|hentai|cumshot|sex\s*tape)\b/i;
function clamp01(x) {
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}
function isSkinRgb(r, g, b) {
  const y = 0.299 * r + 0.587 * g + 0.114 * b;
  if (y < 35 || y > 250) return false;
  const mx = r > g ? r > b ? r : b : g > b ? g : b;
  const mn = r < g ? r < b ? r : b : g < b ? g : b;
  if (mx - mn < 12) return false;
  const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
  const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
  const ycbcr = cr >= 120 && cr <= 185 && cb >= 72 && cb <= 138;
  const ratio = r > b && r - g >= 2 && r - b >= 6 && g - b > -25;
  return ycbcr && ratio;
}
function hsvOf(r, g, b) {
  const mx = r > g ? r > b ? r : b : g > b ? g : b;
  const mn = r < g ? r < b ? r : b : g < b ? g : b;
  const v = mx / 255;
  const d = mx - mn;
  const s = mx === 0 ? 0 : d / mx;
  let h = 0;
  if (d !== 0) {
    if (mx === r) h = (g - b) / d * 60;
    else if (mx === g) h = 120 + (b - r) / d * 60;
    else h = 240 + (r - g) / d * 60;
    if (h < 0) h += 360;
  }
  return { h, s, v };
}
function unionFind(n) {
  const p = new Int32Array(n);
  for (let i = 0; i < n; i++) p[i] = i;
  function find(i) {
    let x = i;
    while (p[x] !== x) x = p[x];
    let y = i;
    while (p[y] !== y) {
      const n2 = p[y];
      p[y] = x;
      y = n2;
    }
    return x;
  }
  function uni(a, b) {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) p[rb] = ra;
  }
  return { find, uni, p };
}
function featuresFromRgb(rgb, w, h) {
  const n = w * h;
  if (!rgb || rgb.length < n * 3 || w < 8 || h < 8) return null;
  const skin = new Uint8Array(n);
  let skinN = 0;
  let centerN = 0;
  let centerSkin = 0;
  let edgeSkin = 0;
  let edgeN = 0;
  let topSkin = 0;
  let midSkin = 0;
  let botSkin = 0;
  let topN = 0;
  let midN = 0;
  let botN = 0;
  let greenBlue = 0;
  let cloth = 0;
  let sky = 0;
  let veg = 0;
  let sheet = 0;
  let lumSum = 0;
  let lumSq = 0;
  const hist = new Uint32Array(16);
  const x0 = Math.floor(w * 0.25);
  const x1 = Math.ceil(w * 0.75);
  const y0 = Math.floor(h * 0.25);
  const y1 = Math.ceil(h * 0.75);
  const yTop = Math.floor(h * 0.33);
  const yBot = Math.floor(h * 0.66);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const o = i * 3;
      const r = rgb[o];
      const g = rgb[o + 1];
      const b = rgb[o + 2];
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      lumSum += lum;
      lumSq += lum * lum;
      hist[Math.min(15, lum >> 4)]++;
      const inCenter = x >= x0 && x < x1 && y >= y0 && y < y1;
      const onEdge = x < 3 || y < 3 || x >= w - 3 || y >= h - 3;
      if (inCenter) centerN++;
      if (onEdge) edgeN++;
      if (y < yTop) topN++;
      else if (y < yBot) midN++;
      else botN++;
      const hsv = hsvOf(r, g, b);
      if (g > r + 12 && g > b - 8) greenBlue++;
      else if (b > r + 18 && b > g + 4) greenBlue++;
      const sk = isSkinRgb(r, g, b);
      if (sk) {
        skin[i] = 1;
        skinN++;
        if (inCenter) centerSkin++;
        if (onEdge) edgeSkin++;
        if (y < yTop) topSkin++;
        else if (y < yBot) midSkin++;
        else botSkin++;
      } else {
        const fashionHue = hsv.h < 80 || hsv.h > 300;
        if (hsv.s > 0.42 && hsv.v > 0.28 && fashionHue) cloth++;
      }
      if (hsv.s >= 0.22 && lum >= 125 && hsv.v > 0.45 && b > r + 12 && b > g - 8 && hsv.h >= 170 && hsv.h <= 230) {
        sky++;
      }
      if (!sk && g > r + 8 && g > b - 10 && hsv.s > 0.2 && hsv.h >= 55 && hsv.h <= 170) {
        veg++;
      }
      if (hsv.h >= 185 && hsv.h <= 250 && hsv.s < 0.32 && hsv.v > 0.28 && hsv.v < 0.9 && lum < 170) {
        sheet++;
      }
    }
  }
  let edgeSum = 0;
  let skinEdgeSum = 0;
  let skinEdgeN = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      let L = function(xx, yy) {
        const o = (yy * w + xx) * 3;
        return 0.299 * rgb[o] + 0.587 * rgb[o + 1] + 0.114 * rgb[o + 2];
      };
      const i = y * w + x;
      const gx = -L(x - 1, y - 1) + L(x + 1, y - 1) - 2 * L(x - 1, y) + 2 * L(x + 1, y) - L(x - 1, y + 1) + L(x + 1, y + 1);
      const gy = -L(x - 1, y - 1) - 2 * L(x, y - 1) - L(x + 1, y - 1) + L(x - 1, y + 1) + 2 * L(x, y + 1) + L(x + 1, y + 1);
      const mag = (Math.abs(gx) + Math.abs(gy)) / 2040;
      edgeSum += mag;
      if (skin[i]) {
        skinEdgeSum += mag;
        skinEdgeN++;
      }
    }
  }
  const inner = (w - 2) * (h - 2) || 1;
  const uf = unionFind(n);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!skin[i]) continue;
      if (x + 1 < w && skin[i + 1]) uf.uni(i, i + 1);
      if (y + 1 < h && skin[i + w]) uf.uni(i, i + w);
    }
  }
  const sizes = /* @__PURE__ */ new Map();
  for (let i = 0; i < n; i++) {
    if (!skin[i]) continue;
    const r = uf.find(i);
    sizes.set(r, (sizes.get(r) || 0) + 1);
  }
  let blobMax = 0;
  sizes.forEach(function(v) {
    if (v > blobMax) blobMax = v;
  });
  let entropy = 0;
  for (let i = 0; i < 16; i++) {
    if (!hist[i]) continue;
    const p = hist[i] / n;
    entropy -= p * Math.log2(p);
  }
  const meanLum = lumSum / n;
  const lumVar = Math.max(0, lumSq / n - meanLum * meanLum) / (255 * 255);
  return {
    skinRatio: skinN / n,
    centerSkin: centerN ? centerSkin / centerN : 0,
    edgeSkin: edgeN ? edgeSkin / edgeN : 0,
    blobMax: blobMax / n,
    blobCount: sizes.size,
    edgeDensity: edgeSum / inner,
    skinEdge: skinEdgeN ? skinEdgeSum / skinEdgeN : 0,
    entropy,
    greenBlue: greenBlue / n,
    cloth: cloth / n,
    sky: sky / n,
    veg: veg / n,
    sheet: sheet / n,
    topSkin: topN ? topSkin / topN : 0,
    midSkin: midN ? midSkin / midN : 0,
    botSkin: botN ? botSkin / botN : 0,
    meanLum: meanLum / 255,
    lumVar
  };
}
function isBeachwear(f) {
  if (!f) return false;
  const scene = (f.sky || 0) + (f.veg || 0);
  const cloth = f.cloth || 0;
  const sheet = f.sheet || 0;
  const sky = f.sky || 0;
  if (sheet > 0.12 && scene < 0.08) return false;
  if (sky > 0.08 && f.topSkin > 0.2 && sheet < 0.1) return true;
  if (scene > 0.08 && cloth > 0.04 && f.topSkin > 0.18 && sheet < 0.12) return true;
  if (cloth > 0.08 && f.topSkin > 0.22 && sheet < 0.1 && scene > 0.04) return true;
  return false;
}
function isCloseup(f) {
  if (!f) return false;
  const scene = (f.sky || 0) + (f.veg || 0);
  const cloth = f.cloth || 0;
  const sheet = f.sheet || 0;
  const lower = ((f.midSkin || 0) + (f.botSkin || 0)) / 2;
  const noHead = (f.topSkin || 0) < 0.22;
  const smooth = (f.skinRatio || 0) > 0.28 && (f.skinEdge || 0) < 0.085;
  if (cloth > 0.06) return false;
  if (scene > 0.12 && sheet < 0.1 && (f.topSkin || 0) > 0.18) return false;
  if (noHead && lower > 0.45 && (f.skinRatio || 0) > 0.28 && cloth < 0.035) return true;
  if (smooth && noHead && cloth < 0.03 && scene < 0.1) return true;
  if (sheet > 0.12 && noHead && (f.skinRatio || 0) > 0.3 && cloth < 0.03) return true;
  return false;
}
function isIntimate(f) {
  if (!f) return false;
  if (isBeachwear(f)) return false;
  const scene = (f.sky || 0) + (f.veg || 0);
  const cloth = f.cloth || 0;
  const skin = f.skinRatio || 0;
  const center = f.centerSkin || 0;
  const body = ((f.midSkin || 0) + (f.botSkin || 0)) / 2;
  const top = f.topSkin || 0;
  const smooth = skin > 0.28 && (f.skinEdge || 0) < 0.09;
  if (scene > 0.1) return false;
  if (cloth > 0.08) return false;
  if (skin > 0.34 && center > 0.38 && scene < 0.08 && smooth) {
    if (body > 0.3 && top > 0.12) return true;
    if ((f.blobCount || 0) >= 2 && body > 0.22 && skin > 0.4) return true;
  }
  return false;
}
function rawHint(f) {
  let h = 0;
  h += 0.3 * f.centerSkin;
  h += 0.22 * f.blobMax;
  h += 0.18 * f.skinRatio;
  h += 0.15 * (f.skinRatio > 0.08 ? 1 - clamp01(f.skinEdge / 0.22) : 0);
  h += 0.1 * (1 - clamp01(f.entropy / 4.2));
  h += 0.05 * Math.max(0, f.centerSkin - f.edgeSkin);
  if (f.topSkin > f.midSkin && f.topSkin > f.botSkin * 1.15 && f.botSkin < 0.28 && f.blobMax < 0.55) {
    h *= 0.42;
  }
  const scene = (f.sky || 0) + (f.veg || 0);
  if (scene > 0.14 && (f.sheet || 0) < 0.1) h *= 0.55;
  if (f.edgeDensity > 0.22 && f.skinRatio < 0.45) h *= 0.7;
  if (scene < 0.08 && (f.sheet || 0) < 0.1 && f.skinRatio < 0.06 && f.entropy < 2.4 && f.edgeDensity < 0.1 && f.lumVar < 0.05 && f.meanLum > 0.22 && f.meanLum < 0.85) {
    h = Math.max(h, 0.36);
  }
  return clamp01(h);
}
function classifyFrame(f) {
  if (!f) return { hint: 0, beachwear: false, closeup: false, intimate: false };
  const beachwear = isBeachwear(f);
  const closeup = isCloseup(f);
  const intimate = isIntimate(f);
  let hint = rawHint(f);
  if ((closeup || intimate) && !beachwear) hint = Math.max(hint, 0.86);
  else if (beachwear) hint = Math.min(hint, 0.22);
  return { hint: clamp01(hint), beachwear, closeup, intimate };
}
function hintFromFeatures(f) {
  return classifyFrame(f).hint;
}
function decideFromHints(hints, opts) {
  const title = opts && opts.title || "";
  if (!hints || !hints.length) {
    return { decision: "unread", score: 0, max: 0, mean: 0, reason: "unread" };
  }
  let max = 0;
  let sum = 0;
  for (let i = 0; i < hints.length; i++) {
    const v = hints[i] || 0;
    if (v > max) max = v;
    sum += v;
  }
  const mean = sum / hints.length;
  const lex = SEX_WORDS.test(String(title));
  let decision = "hold";
  let reason = "screen";
  if (max >= 0.84 || max >= 0.78 && mean >= 0.45 || lex && max >= 0.55) {
    decision = "block";
    reason = "screen";
  } else if (max < 0.3 && mean < 0.24 && !lex) {
    decision = "allow";
    reason = "";
  } else if (lex) {
    decision = "hold";
    reason = "screen";
  }
  return {
    decision,
    score: Math.round(max * 100),
    max,
    mean,
    reason
  };
}
function bytesFromB64(s) {
  try {
    const bin = atob(String(s || ""));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}
var MOD_LABELS = [
  "FEMALE_GENITALIA_COVERED",
  "FACE_FEMALE",
  "BUTTOCKS_EXPOSED",
  "FEMALE_BREAST_EXPOSED",
  "FEMALE_GENITALIA_EXPOSED",
  "MALE_BREAST_EXPOSED",
  "ANUS_EXPOSED",
  "FEET_EXPOSED",
  "BELLY_COVERED",
  "FEET_COVERED",
  "ARMPITS_COVERED",
  "ARMPITS_EXPOSED",
  "FACE_MALE",
  "BELLY_EXPOSED",
  "MALE_GENITALIA_EXPOSED",
  "ANUS_COVERED",
  "FEMALE_BREAST_COVERED",
  "BUTTOCKS_COVERED"
];
var MOD_ANATOMY = { FEMALE_GENITALIA_EXPOSED: 1, MALE_GENITALIA_EXPOSED: 1, ANUS_EXPOSED: 1 };
var MOD_INTIMATE = { FEMALE_GENITALIA_EXPOSED: 1, MALE_GENITALIA_EXPOSED: 1, ANUS_EXPOSED: 1, FEMALE_BREAST_EXPOSED: 1 };
var MOD_REVEALING = { MALE_BREAST_EXPOSED: 1, BUTTOCKS_EXPOSED: 1, BELLY_EXPOSED: 1 };
var MOD_T = {
  anatomyReject: 0.5,
  anatomyHold: 0.25,
  weak: 0.25,
  face: 0.4,
  bottom: 0.45,
  breastReject: 0.55,
  breastHold: 0.35,
  pair: 0.4,
  certain: 0.8,
  player: 0.85,
  act: 0.6,
  fabric: 0.2,
  fabricCut: 0.5
};
function modScore(row) {
  var cls = MOD_LABELS[row[0]], sc = Number(row[1]) || 0;
  if (row.length < 3 || row[2] == null) return sc;
  var skin = Number(row[2]);
  if (!(skin >= 0 && skin <= 1) || skin >= MOD_T.fabric || sc >= MOD_T.certain) return sc;
  if (cls === "BUTTOCKS_EXPOSED" || cls === "FEMALE_BREAST_EXPOSED") return sc * MOD_T.fabricCut;
  if (MOD_ANATOMY[cls]) return Math.max(sc * MOD_T.fabricCut, Math.min(sc, MOD_T.anatomyHold));
  return sc;
}
function modAnatomyReason(cls, possible) {
  var base = cls === "ANUS_EXPOSED" ? "anus" : "genitals";
  return possible ? "possible-" + base : base;
}
function modAssessFrame(frame) {
  var best = {}, i, cls, sc;
  var d = frame && frame.d || [];
  for (i = 0; i < d.length; i++) {
    cls = MOD_LABELS[d[i][0]];
    sc = modScore(d[i]);
    if (cls && (!(cls in best) || sc > best[cls])) best[cls] = sc;
  }
  var anatomy = 0, anatomyCls = "", intimate = 0, revealing = 0;
  for (cls in best) {
    if (MOD_ANATOMY[cls] && best[cls] > anatomy) {
      anatomy = best[cls];
      anatomyCls = cls;
    }
    if (MOD_INTIMATE[cls] && best[cls] >= MOD_T.pair) intimate++;
    if (MOD_REVEALING[cls] && best[cls] >= 0.5) revealing++;
  }
  var breast = best.FEMALE_BREAST_EXPOSED || 0;
  var player = Number(frame && frame.p) || 0;
  var faces = 0, weak = 0;
  for (i = 0; i < d.length; i++) {
    cls = MOD_LABELS[d[i][0]];
    sc = Number(d[i][1]) || 0;
    if ((cls === "FACE_FEMALE" || cls === "FACE_MALE") && sc >= MOD_T.face) faces++;
  }
  for (cls in best) {
    if (MOD_INTIMATE[cls] && best[cls] >= MOD_T.weak) weak++;
  }
  var bottom = (best.BUTTOCKS_EXPOSED || 0) >= MOD_T.bottom;
  var top = Math.max(anatomy, breast);
  if (anatomy >= MOD_T.certain) return { level: "certain", reason: modAnatomyReason(anatomyCls), score: anatomy };
  if (breast >= MOD_T.certain) return { level: "certain", reason: "topless", score: breast };
  if (anatomy >= MOD_T.anatomyReject) return { level: "reject", reason: modAnatomyReason(anatomyCls), score: anatomy };
  if (breast >= MOD_T.breastReject) return { level: "reject", reason: "topless", score: breast };
  if (intimate >= 2) return { level: "reject", reason: "nudity", score: top };
  if (anatomy >= MOD_T.anatomyHold) return { level: "hold", reason: modAnatomyReason(anatomyCls, true), score: anatomy };
  if (breast >= MOD_T.breastHold) return { level: "hold", reason: "possible-topless", score: breast };
  if (bottom && weak >= 1) return { level: "hold", reason: "possible-nudity", score: Math.max(top, best.BUTTOCKS_EXPOSED || 0) };
  var actBottom = (best.BUTTOCKS_EXPOSED || 0) >= MOD_T.act;
  if (faces >= 2 && actBottom) return { level: "hold", reason: "possible-sexual-act", score: Math.max(top, best.BUTTOCKS_EXPOSED || 0) };
  if (player >= MOD_T.player) return { level: "hold", reason: "video-player-screenshot", score: player };
  return { level: "allow", reason: revealing ? "revealing-allowed" : "", score: top };
}
function modDecide(frames) {
  if (!frames || !frames.length) return { decision: "unread", reason: "unread", score: 0, frame: -1 };
  var a = [], k, certain = null, rejects = [], holds = [];
  for (k = 0; k < frames.length; k++) {
    var r = modAssessFrame(frames[k]);
    r.frame = k;
    a.push(r);
    if (r.level === "certain" && (!certain || r.score > certain.score)) certain = r;
    if (r.level === "reject") rejects.push(r);
    if (r.level === "hold") holds.push(r);
  }
  var byScore = function(x, y) {
    return y.score - x.score;
  };
  if (certain) return { decision: "block", reason: certain.reason, score: certain.score, frame: certain.frame };
  if (frames.length === 1 && rejects.length) {
    return { decision: "block", reason: rejects[0].reason, score: rejects[0].score, frame: 0 };
  }
  if (rejects.length >= 2) {
    rejects.sort(byScore);
    return { decision: "block", reason: rejects[0].reason, score: rejects[0].score, frame: rejects[0].frame, frames: rejects.length };
  }
  if (rejects.length === 1) {
    return { decision: "hold", reason: "single-frame", score: rejects[0].score, frame: rejects[0].frame, detail: rejects[0].reason };
  }
  if (holds.length) {
    holds.sort(byScore);
    return { decision: "hold", reason: holds[0].reason, score: holds[0].score, frame: holds[0].frame };
  }
  var allowed = a.slice().sort(byScore)[0];
  var revealing = a.some(function(x) {
    return x.reason === "revealing-allowed";
  });
  return { decision: "allow", reason: revealing ? "revealing-allowed" : "", score: allowed.score, frame: -1 };
}
function validNudenetFrames(nn) {
  if (!nn || typeof nn !== "object" || !Array.isArray(nn.frames)) return null;
  const frames = nn.frames.slice(0, 12);
  if (!frames.length) return null;
  const out = [];
  for (const f of frames) {
    if (!f || typeof f !== "object" || !Array.isArray(f.d) || f.d.length > 60) return null;
    const d = [];
    for (const row of f.d) {
      if (!Array.isArray(row) || row.length < 2 || row.length > 3) return null;
      const c = Number(row[0]), sc = Number(row[1]);
      if (!Number.isInteger(c) || c < 0 || c >= MOD_LABELS.length) return null;
      if (!Number.isFinite(sc) || sc < 0 || sc > 1) return null;
      if (row.length === 3 && row[2] != null) {
        const sk = Number(row[2]);
        if (typeof row[2] !== "number" || !Number.isFinite(sk) || sk < 0 || sk > 1) return null;
        d.push([c, sc, sk]);
      } else d.push([c, sc]);
    }
    const pl = f.p == null ? 0 : Number(f.p);
    if (!Number.isFinite(pl) || pl < 0 || pl > 1) return null;
    out.push({ d, p: pl });
  }
  return out;
}
function judgeScreenPayload(payload, opts) {
  const title = opts && opts.title || "";
  if (!payload || typeof payload !== "object") {
    return { decision: "unread", score: 0, hasScreen: false, reason: "unread", frames: 0 };
  }
  const nnFrames = validNudenetFrames(payload.nudenet);
  if (nnFrames) {
    const d2 = modDecide(nnFrames);
    return {
      decision: d2.decision,
      score: Math.round((d2.score || 0) * 100),
      hasScreen: true,
      reason: d2.reason,
      frames: nnFrames.length,
      engine: "nudenet",
      detail: d2.detail || "",
      frameIndex: typeof d2.frame === "number" ? d2.frame : -1
    };
  }
  const w = Number(payload.w) || 0;
  const h = Number(payload.h) || 0;
  const frames = Array.isArray(payload.frames) ? payload.frames.slice(0, SCREEN_MAX_FRAMES) : [];
  if (w < 32 || h < 32 || w > 128 || h > 128 || !frames.length) {
    return { decision: "unread", score: 0, hasScreen: false, reason: "unread", frames: 0 };
  }
  const hints = [];
  for (let i = 0; i < frames.length; i++) {
    const raw = frames[i] && frames[i].rgb;
    if (typeof raw !== "string" || raw.length < 32 || raw.length > 5e4) continue;
    const rgb = bytesFromB64(raw);
    if (!rgb || rgb.length !== w * h * 3) continue;
    const feat = featuresFromRgb(rgb, w, h);
    hints.push(hintFromFeatures(feat));
  }
  if (!hints.length) {
    return { decision: "unread", score: 0, hasScreen: false, reason: "unread", frames: 0 };
  }
  const d = decideFromHints(hints, { title });
  const decision = d.decision === "block" ? "hold" : d.decision;
  return {
    decision,
    score: d.score,
    hasScreen: true,
    reason: d.decision === "block" ? "heuristic-only" : d.reason,
    frames: hints.length,
    max: d.max,
    mean: d.mean,
    engine: "heuristic"
  };
}
function listingFromScreen(opts) {
  const trusted = !!(opts && opts.trusted);
  const hidden = !!(opts && opts.hidden);
  const hasScreen = !!(opts && opts.hasScreen);
  const decision = opts && opts.decision || "unread";
  if (hidden) {
    return { listed: false, held: false, hidden: true };
  }
  if (decision === "block") {
    return {
      listed: false,
      held: false,
      hidden: true,
      hiddenReason: "screen",
      heldReason: ""
    };
  }
  if (hasScreen && decision === "hold") {
    return { listed: false, held: true, hidden: false, heldReason: "screen" };
  }
  if (trusted) {
    return { listed: true, held: false, hidden: false, heldReason: "" };
  }
  if (hasScreen && decision === "allow") {
    return { listed: true, held: false, hidden: false, heldReason: "" };
  }
  return { listed: false, held: true, hidden: false, heldReason: "new-publisher" };
}

// safety.mjs
var SAFETY_VERSION = "1.1.0";
var PRIVATE_SURFACES = ["wireline", "band", "call", "secret", "dm"];
var PUBLIC_SURFACES = ["broadcast", "signal", "profile", "comment", "public"];
var FORBIDDEN_KEYS = ["body", "message", "ciphertext", "plaintext", "wire_text", "transcript", "chat"];
function normaliseSurface(raw) {
  return String(raw || "").trim().toLowerCase();
}
function isPrivateSurface(surface) {
  return PRIVATE_SURFACES.indexOf(normaliseSurface(surface)) >= 0;
}
function normText(raw) {
  return String(raw || "").toLowerCase().replace(/[\u2018\u2019]/g, "'").replace(/[^a-z0-9'+]+/g, " ").replace(/\s+/g, " ").trim();
}
function shieldStrength(text) {
  let s = 0;
  if (/\b(reporting on|reported on|report on|documentary|journalism|journalist|news report|news coverage|historical|academic|according to|victims of|survivors of|prosecuted|prosecution|court ruled|court found|condemned|condemns|counter terror|counterterrorism|against terrorism|awareness campaign|educational)\b/.test(text)) {
    s += 40;
  }
  if (/\b(do not|don't|never|stop|refuse|against|not joining|i oppose)\b/.test(text)) s += 15;
  return Math.min(55, s);
}
var INTENT_RULES = [
  {
    id: "recruit_org",
    category: "extremism",
    weight: 72,
    re: /\b(join|pledge allegiance to|enlist with|become a member of|become a soldier of)\b.{0,48}\b(isis|isil|daesh|al qaeda|al qa'eda|al shabaab|boko haram|the caliphate|our cause)\b/
  },
  {
    id: "support_cause",
    category: "extremism",
    weight: 58,
    re: /\b(support our cause|for the caliphate|wage jihad|strike the kuffar|strike the infidels)\b/
  },
  {
    id: "praise_org",
    category: "extremism",
    weight: 54,
    re: /\b(glory to|praise be to|long live)\b.{0,36}\b(isis|isil|daesh|al qaeda|the martyrs|the fighters)\b/
  },
  {
    id: "violent_instruction",
    category: "instruction",
    weight: 88,
    re: /\b(how to make|how to build|step by step|instructions for|recipe for)\b.{0,48}\b(a bomb|the bomb|an explosive|explosive|an ied|a weapon|the attack)\b/
  },
  {
    id: "direct_threat",
    category: "threat",
    weight: 86,
    re: /\b(i will|i'm going to|im going to|we will|we're going to|going to)\b.{0,36}\b(kill|shoot|bomb|behead|stab|attack)\b/
  },
  {
    id: "target_attack",
    category: "threat",
    weight: 78,
    re: /\b(bomb the|shoot up the|attack the|burn down the)\b/
  },
  {
    id: "child_sexual",
    category: "child",
    weight: 92,
    re: /\b(child|minor|underage|kid)\b.{0,24}\b(sex|nude|nudes|porn|sexual)\b/
  },
  {
    id: "child_trade",
    category: "child",
    weight: 92,
    re: /\b(sell|trade|share)\b.{0,24}\b(child|minor|underage)\b.{0,24}\b(porn|nudes|sex)\b/
  },
  {
    id: "scam_payment",
    category: "scam",
    weight: 42,
    re: /\b(send bitcoin|send btc|send usdt|double your money|gift cards? to|wire the money now)\b/
  },
  {
    id: "adult_trade",
    category: "adult",
    weight: 48,
    re: /\b(selling nudes|buy my nudes|nudes for sale|explicit content for sale|sex for money|pay for sex)\b/
  },
  {
    id: "group_violence",
    category: "threat",
    weight: 80,
    re: /\b(kill all|exterminate|wipe out)\b.{0,32}\b(them|civilians|the infidels|the kuffar|women|children)\b/
  }
];
var ENTITY_RE = /\b(isis|isil|daesh|al qaeda|al qa'eda|al shabaab|boko haram)\b/;
function adjustedWeight(rule, shield) {
  if (rule.category === "instruction" || rule.category === "threat") {
    return Math.max(0, rule.weight - Math.min(10, shield));
  }
  return Math.max(0, rule.weight - shield);
}
function bandFor(score) {
  const n = Math.max(0, Math.min(100, Math.round(Number(score) || 0)));
  if (n <= 30) return "ALLOW";
  if (n <= 60) return "LIMIT";
  if (n <= 80) return "REVIEW";
  return "REMOVE";
}
function urgentFrom(signals) {
  return signals.some(function(s) {
    return s.category === "threat" || s.category === "instruction" || s.category === "child";
  });
}
function scorePublicText(text, opts) {
  const surface = normaliseSurface(opts && opts.surface);
  if (isPrivateSurface(surface)) {
    return {
      ok: false,
      surface,
      decision: "PRIVATE",
      score: 0,
      signals: [],
      urgent: false,
      human_required: false,
      auto_ban: false,
      account_action_applied: false,
      recommended_account_action: "none",
      contents_collected: false,
      error: "private boundary"
    };
  }
  if (surface && PUBLIC_SURFACES.indexOf(surface) < 0 && surface !== "") {
    return {
      ok: false,
      surface,
      decision: "PRIVATE",
      score: 0,
      signals: [],
      urgent: false,
      human_required: false,
      auto_ban: false,
      account_action_applied: false,
      recommended_account_action: "none",
      contents_collected: false,
      error: "unknown surface"
    };
  }
  const clean2 = normText(text).slice(0, 4e3);
  if (!clean2) {
    return finishContent(surface, 0, [], false);
  }
  const shield = shieldStrength(clean2);
  const signals = [];
  let score = 0;
  INTENT_RULES.forEach(function(rule) {
    if (!rule.re.test(clean2)) return;
    const weight = adjustedWeight(rule, shield);
    if (weight <= 0) return;
    score += weight;
    signals.push({ id: rule.id, category: rule.category, weight });
  });
  const intent = signals.some(function(s) {
    return s.category === "extremism" || s.category === "instruction" || s.category === "threat";
  });
  if (ENTITY_RE.test(clean2) && !intent) {
    const mention = shield >= 40 ? 0 : 8;
    if (mention > 0) {
      score += mention;
      signals.push({ id: "entity_mention", category: "context", weight: mention });
    }
  }
  score = Math.max(0, Math.min(100, score));
  const urgent = urgentFrom(signals) && score >= 61;
  return finishContent(surface, score, signals, urgent);
}
function finishContent(surface, score, signals, urgent) {
  let decision = bandFor(score);
  const adult = signals.some(function(s) {
    return s.category === "adult";
  });
  const child = signals.some(function(s) {
    return s.category === "child";
  });
  if (!child && adult && score >= 31 && score <= 80) decision = "AGE_RESTRICT";
  if (urgent && (decision === "REMOVE" || decision === "REVIEW")) decision = "ESCALATE";
  const human = decision === "REVIEW" || decision === "REMOVE" || decision === "ESCALATE" || decision === "AGE_RESTRICT";
  let recommend = "none";
  if (decision === "ESCALATE" || decision === "REMOVE" || decision === "AGE_RESTRICT") recommend = "review";
  return {
    ok: true,
    surface: surface || "public",
    decision,
    score,
    signals,
    urgent,
    monitor: decision === "LIMIT" || decision === "ALLOW" && score >= 8,
    human_required: human,
    auto_ban: false,
    account_action_applied: false,
    recommended_account_action: recommend,
    contents_collected: true,
    version: SAFETY_VERSION
  };
}
function scoreBehaviour(input) {
  const src = input || {};
  const n = function(k) {
    return Math.max(0, Number(src[k]) || 0);
  };
  const signals = [];
  let score = 0;
  function add(id, weight, when) {
    if (!when) return;
    score += weight;
    signals.push({ id, category: "behaviour", weight });
  }
  add("multi_account", 25, n("accountsCreated24h") >= 5);
  add("account_farm", 45, n("accountsCreated24h") >= 20);
  add("mass_follow", 15, n("follows24h") >= 200);
  add("mass_follow_extreme", 50, n("follows24h") >= 1e3);
  add("identical_posts", 25, n("identicalPosts24h") >= 20);
  add("reupload_removed", 20, n("removedUploads7d") >= 3);
  add("connection_spam", 15, n("connectionRequests24h") >= 100);
  add("report_spike", 20, n("abuseReports7d") >= 5);
  add("report_wave", 20, n("abuseReports7d") >= 25);
  add("identity_churn", 10, n("identityChanges7d") >= 4);
  add("ban_evasion", 35, n("banEvasions") >= 1);
  add("known_hash_repeat", 40, n("knownHashHits") >= 1);
  score = Math.max(0, Math.min(100, score));
  const decision = bandFor(score);
  return {
    ok: true,
    surface: "behaviour",
    decision,
    score,
    signals,
    urgent: n("banEvasions") >= 1 && score >= 61,
    human_required: decision === "REVIEW" || decision === "REMOVE",
    auto_ban: false,
    account_action_applied: false,
    recommended_account_action: n("banEvasions") >= 1 && score >= 81 ? "suspend" : score >= 61 ? "restrict" : "none",
    contents_collected: false,
    version: SAFETY_VERSION
  };
}
function matchKnownHash(hex, list) {
  const h = String(hex || "").trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(h)) {
    return { ok: false, matched: false, error: "sha256 required" };
  }
  const rows = Array.isArray(list) ? list : [];
  const hit = rows.find(function(row) {
    return row && String(row.sha256 || "").toLowerCase() === h;
  });
  if (!hit) {
    return { ok: true, matched: false, score: 0, decision: "ALLOW", auto_ban: false, contents_collected: false };
  }
  return {
    ok: true,
    matched: true,
    score: 100,
    decision: "ESCALATE",
    category: String(hit.category || "known"),
    source: String(hit.source || "hash-list"),
    urgent: true,
    human_required: true,
    auto_ban: false,
    account_action_applied: false,
    recommended_account_action: "review",
    contents_collected: false,
    signals: [{ id: "known_hash", category: String(hit.category || "known"), weight: 100 }]
  };
}
function combineRisk(content, behaviour, reportCount, extra) {
  const c = content && content.decision !== "PRIVATE" ? content : null;
  const b = behaviour || null;
  const reports = Math.max(0, Number(reportCount) || 0);
  const cScore = c ? c.score : 0;
  const bScore = b ? b.score : 0;
  const brigade = !!(extra && extra.brigade);
  let boost = Math.min(20, reports * 4);
  if (brigade) boost = Math.min(4, boost);
  if (reports === 1) boost = Math.min(boost, 4);
  const score = Math.max(cScore, Math.min(100, Math.round(cScore * 0.65 + bScore * 0.5 + boost)));
  let decision = bandFor(score);
  const urgent = !!(c && c.urgent) || !!(b && b.urgent) || !brigade && reports >= 3 && score >= 61;
  if (urgent && (decision === "REMOVE" || decision === "REVIEW")) decision = "ESCALATE";
  const recommend = b && b.recommended_account_action === "suspend" && score >= 81 ? "suspend" : decision === "ESCALATE" || decision === "REMOVE" ? "review" : "none";
  const signals = [].concat(c && c.signals ? c.signals : []).concat(b && b.signals ? b.signals : []);
  if (brigade) signals.push({ id: "report_brigade", category: "network", weight: 4 });
  return {
    ok: true,
    score,
    decision,
    urgent,
    human_required: decision !== "ALLOW" && decision !== "LIMIT",
    auto_ban: false,
    account_action_applied: false,
    recommended_account_action: recommend,
    brigade,
    signals
  };
}
function priorityFor(result, reasonCode) {
  const code = String(reasonCode || "");
  const urgentCode = code === "terrorism" || code === "recruitment" || code === "child_exploitation" || code === "violence";
  if (result && result.urgent || urgentCode && (result && result.score >= 61)) return "URGENT";
  if (urgentCode) return "HIGH";
  if (result && (result.decision === "REMOVE" || result.decision === "ESCALATE")) return "URGENT";
  if (result && result.decision === "REVIEW") return "HIGH";
  if (result && result.decision === "REGION_RESTRICT") return "HIGH";
  if (result && (result.decision === "LIMIT" || result.decision === "AGE_RESTRICT")) return "MEDIUM";
  return "LOW";
}
function buildCase(input) {
  const src = input || {};
  const surface = normaliseSurface(src.surface || src.content_type);
  if (isPrivateSurface(surface) && src.include_body) {
    throw new Error("private contents are not collected");
  }
  FORBIDDEN_KEYS.forEach(function(k) {
    if (src[k]) throw new Error("forbidden field " + k);
  });
  const result = src.result || {};
  const id = String(src.case_id || "TS-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 6)).slice(0, 80);
  return {
    case_id: id,
    reporter_id: String(src.reporter_id || "system").slice(0, 128),
    reported_user_id: String(src.reported_user_id || "").slice(0, 128),
    content_id: String(src.content_id || "").slice(0, 128),
    content_type: String(src.content_type || surface || "public").slice(0, 32),
    surface: isPrivateSurface(surface) ? surface : surface || "public",
    reason_code: String(src.reason_code || "").slice(0, 40),
    evidence_reference: String(src.evidence_reference || "").slice(0, 128),
    automated_risk_result: {
      score: Number(result.score) || 0,
      decision: String(result.decision || "ALLOW"),
      signals: (result.signals || []).map(function(s) {
        return s.id || s;
      }).slice(0, 12)
    },
    review_status: "open",
    priority: priorityFor(result, src.reason_code),
    reviewer: "",
    decision: "",
    decision_reason: "",
    appeal_status: "none",
    report_id: String(src.report_id || "").slice(0, 80),
    statement: String(result && result.statement || statementFor(result) || "").slice(0, 400),
    contents_collected: isPrivateSurface(surface) ? false : src.contents_collected !== false,
    auto_ban: false,
    created_at: Date.now()
  };
}
function buildAudit(input) {
  const src = input || {};
  if (!src.case_id || !src.what) throw new Error("audit needs a case and an action");
  return Object.freeze({
    audit_id: String(src.audit_id || "aud_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)).slice(0, 80),
    case_id: String(src.case_id).slice(0, 80),
    who: String(src.who || "system").slice(0, 128),
    what: String(src.what).slice(0, 80),
    when: Number(src.when) || Date.now(),
    why: String(src.why || "").slice(0, 500),
    detected_by: String(src.detected_by || "classifier").slice(0, 40),
    human_reviewed: !!src.human_reviewed,
    action_taken: String(src.action_taken || src.what).slice(0, 80)
  });
}
function assertAuditAppend(existing, next) {
  if (!next || !next.audit_id) throw new Error("audit row required");
  if ((existing || []).some(function(row) {
    return row && row.audit_id === next.audit_id;
  })) {
    throw new Error("audit rows are append-only");
  }
  if (next.deleted) throw new Error("audit cannot be deleted");
  return true;
}
function decideHuman(caseRow, action, reviewer, why) {
  const allowed = ["ALLOW", "LIMIT", "AGE_RESTRICT", "REGION_RESTRICT", "REMOVE", "RESTORE", "RESTRICT", "SUSPEND", "ESCALATE", "DISMISS"];
  const act = String(action || "").toUpperCase();
  if (allowed.indexOf(act) < 0) throw new Error("unknown decision");
  if (!reviewer) throw new Error("a person has to decide");
  const row = Object.assign({}, caseRow || {});
  row.review_status = "decided";
  row.reviewer = String(reviewer).slice(0, 128);
  row.decision = act;
  row.decision_reason = String(why || "").slice(0, 500);
  row.decided_at = Date.now();
  row.auto_ban = false;
  row.permanent_ban = false;
  if (act === "ALLOW" || act === "RESTORE" || act === "DISMISS") row.appeal_status = row.appeal_status === "open" ? row.appeal_status : "none";
  return row;
}
function buildAppeal(input) {
  const src = input || {};
  if (!src.case_id || !src.appellant_uid) throw new Error("appeal needs a case and the person");
  const note = String(src.note || "").trim();
  if (note.length < 10) throw new Error("say what was wrong with the decision");
  return {
    appeal_id: String(src.appeal_id || "apl_" + Date.now().toString(36)).slice(0, 80),
    case_id: String(src.case_id).slice(0, 80),
    appellant_uid: String(src.appellant_uid).slice(0, 128),
    note: note.slice(0, 2e3),
    status: "open",
    created_at: Date.now()
  };
}
function applyAppeal(caseRow, appeal) {
  const row = Object.assign({}, caseRow || {});
  row.appeal_status = "open";
  row.review_status = "review";
  row.appeal_id = appeal && appeal.appeal_id;
  return row;
}
function statementFor(result) {
  const decision = result && result.decision;
  if (!result || decision === "PRIVATE") {
    return "Private conversations are not reviewed by this check.";
  }
  if (decision === "ALLOW" && result.monitor) {
    return "Allowed. It stays on the public feed and is watched. A name on its own is not recruitment.";
  }
  if (decision === "ALLOW") return "Allowed. This did not read as recruitment, a threat, or instructions.";
  if (decision === "LIMIT") return "Allowed on the public feed, and watched. One report is not enough to take it down.";
  if (decision === "AGE_RESTRICT") return "Held for an age check. This is not a ban. Appeal if it is educational or a mistake.";
  if (decision === "REGION_RESTRICT") return "Held for a region check by a person. This is not a ban.";
  if (decision === "REVIEW") return "Held so a person can review it. A machine does not remove it on its own.";
  if (decision === "ESCALATE") return "Held in the urgent queue. A person has to decide. You can appeal. Private messages were not opened.";
  if (decision === "REMOVE") return "Held off the public feed for urgent review. This is not a permanent ban. You can appeal.";
  return "Recorded for the safety desk.";
}
var SAFETY_EVENT_TYPES = [
  "USER_CREATED",
  "ACCOUNT_VERIFIED",
  "CONTENT_UPLOADED",
  "SIGNAL_PUBLISHED",
  "BROADCAST_PUBLISHED",
  "CONTENT_REPORTED",
  "ACCOUNT_REPORTED",
  "CONTENT_REMOVED",
  "USER_BLOCKED",
  "SUSPICIOUS_ACTIVITY",
  "ADMIN_ACTION",
  "FOLLOW",
  "CONNECTION_REQUEST",
  "IDENTITY_CHANGED",
  "LEGAL_REQUEST"
];
var DAY_MS = 864e5;
var WEEK_MS = 7 * DAY_MS;
function emptyLedger(uid) {
  return {
    uid: String(uid || ""),
    follows24h: { start: 0, n: 0 },
    connections24h: { start: 0, n: 0 },
    identical24h: { start: 0, n: 0 },
    removed7d: { start: 0, n: 0 },
    reports7d: { start: 0, n: 0 },
    identity7d: { start: 0, n: 0 },
    blocks7d: { start: 0, n: 0 },
    banEvasions: 0,
    knownHashHits: 0,
    accountsLinked: 0,
    verified: false
  };
}
function bumpBucket(bucket, now, windowMs) {
  const b = bucket || { start: 0, n: 0 };
  if (!b.start || now - b.start > windowMs) return { start: now, n: 1 };
  return { start: b.start, n: Math.min(1e5, (b.n || 0) + 1) };
}
function countBucket(bucket, now, windowMs) {
  if (!bucket || !bucket.start || now - bucket.start > windowMs) return 0;
  return bucket.n || 0;
}
function ledgerCounts(ledger, now) {
  const t = Number(now) || Date.now();
  const src = ledger || emptyLedger();
  return {
    accountsCreated24h: src.accountsLinked || 0,
    follows24h: countBucket(src.follows24h, t, DAY_MS),
    identicalPosts24h: countBucket(src.identical24h, t, DAY_MS),
    removedUploads7d: countBucket(src.removed7d, t, WEEK_MS),
    connectionRequests24h: countBucket(src.connections24h, t, DAY_MS),
    abuseReports7d: countBucket(src.reports7d, t, WEEK_MS),
    identityChanges7d: countBucket(src.identity7d, t, WEEK_MS),
    banEvasions: src.banEvasions || 0,
    knownHashHits: src.knownHashHits || 0
  };
}
function applySafetyEvent(ledger, event, now) {
  const src = event || {};
  FORBIDDEN_KEYS.forEach(function(k) {
    if (src[k]) throw new Error("forbidden field " + k);
  });
  const type = String(src.type || "").toUpperCase();
  if (SAFETY_EVENT_TYPES.indexOf(type) < 0) throw new Error("unknown safety event");
  const surface = normaliseSurface(src.surface);
  if (surface && isPrivateSurface(surface)) throw new Error("private boundary");
  const t = Number(now) || Date.now();
  const base = ledger || emptyLedger(src.uid);
  const next = {
    uid: String(base.uid || src.uid || ""),
    follows24h: base.follows24h || { start: 0, n: 0 },
    connections24h: base.connections24h || { start: 0, n: 0 },
    identical24h: base.identical24h || { start: 0, n: 0 },
    removed7d: base.removed7d || { start: 0, n: 0 },
    reports7d: base.reports7d || { start: 0, n: 0 },
    identity7d: base.identity7d || { start: 0, n: 0 },
    blocks7d: base.blocks7d || { start: 0, n: 0 },
    banEvasions: base.banEvasions || 0,
    knownHashHits: base.knownHashHits || 0,
    accountsLinked: base.accountsLinked || 0,
    verified: !!base.verified
  };
  if (type === "FOLLOW") next.follows24h = bumpBucket(next.follows24h, t, DAY_MS);
  if (type === "CONNECTION_REQUEST") next.connections24h = bumpBucket(next.connections24h, t, DAY_MS);
  if (type === "IDENTITY_CHANGED") next.identity7d = bumpBucket(next.identity7d, t, WEEK_MS);
  if (type === "CONTENT_REMOVED") next.removed7d = bumpBucket(next.removed7d, t, WEEK_MS);
  if (type === "CONTENT_REPORTED" || type === "ACCOUNT_REPORTED") next.reports7d = bumpBucket(next.reports7d, t, WEEK_MS);
  if (type === "USER_BLOCKED") next.blocks7d = bumpBucket(next.blocks7d, t, WEEK_MS);
  if (type === "USER_CREATED") {
    next.accountsLinked = Math.max(next.accountsLinked, Number(src.linked_accounts) || 0);
  }
  if (type === "SUSPICIOUS_ACTIVITY" && src.ban_evasion) next.banEvasions += 1;
  if (type === "SUSPICIOUS_ACTIVITY" && src.known_hash) next.knownHashHits += 1;
  if (src.repeat_public) next.identical24h = bumpBucket(next.identical24h, t, DAY_MS);
  if (type === "ACCOUNT_VERIFIED") next.verified = true;
  let content = null;
  const publish = type === "SIGNAL_PUBLISHED" || type === "BROADCAST_PUBLISHED" || type === "CONTENT_UPLOADED";
  if (publish && src.public_text) {
    const pubSurface = src.surface || (type === "SIGNAL_PUBLISHED" ? "signal" : type === "CONTENT_UPLOADED" ? "comment" : "broadcast");
    content = scorePublicText(String(src.public_text), { surface: pubSurface });
    content.statement = statementFor(content);
  }
  if (type === "LEGAL_REQUEST") {
    content = {
      ok: true,
      surface: "public",
      decision: "REGION_RESTRICT",
      score: 70,
      signals: [{ id: "legal_request", category: "legal", weight: 70 }],
      urgent: false,
      monitor: false,
      human_required: true,
      auto_ban: false,
      account_action_applied: false,
      recommended_account_action: "review",
      contents_collected: false,
      statement: statementFor({ decision: "REGION_RESTRICT" })
    };
  }
  const counts = ledgerCounts(next, t);
  let behaviour = scoreBehaviour(counts);
  if (next.verified && behaviour.score > 0 && behaviour.score < 61) {
    const lowered = Math.max(0, behaviour.score - 8);
    behaviour = Object.assign({}, behaviour, { score: lowered, decision: bandFor(lowered) });
  }
  return {
    ledger: next,
    counts,
    behaviour,
    content,
    type,
    contents_collected: !!(content && content.contents_collected)
  };
}
function fingerprintPublic(text) {
  const clean2 = normText(text);
  if (clean2.length < 24) return "";
  let h = 2166136261;
  for (let i = 0; i < clean2.length; i++) {
    h ^= clean2.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}
function observeCluster(store, obs) {
  const src = obs || {};
  const fp = src.fingerprint || fingerprintPublic(src.text || "");
  const box = store || {};
  if (!fp) {
    return { fingerprint: "", accounts: 0, score: 0, decision: "ALLOW", auto_ban: false, contents_collected: false, signals: [] };
  }
  const now = Number(src.at) || Date.now();
  const bucket = (box[fp] || []).filter(function(r) {
    return r && now - r.at < DAY_MS;
  });
  const uid = String(src.uid || "");
  if (uid && !bucket.some(function(r) {
    return r.uid === uid;
  })) bucket.push({ uid, at: now });
  box[fp] = bucket.slice(-40);
  const accounts = new Set(bucket.map(function(r) {
    return r.uid;
  })).size;
  let score = 0;
  if (accounts >= 4) score = 35;
  if (accounts >= 8) score = 62;
  if (accounts >= 15) score = 84;
  return {
    fingerprint: fp,
    accounts,
    score,
    decision: score >= 61 ? "REVIEW" : bandFor(score),
    urgent: accounts >= 15,
    human_required: score >= 61,
    auto_ban: false,
    account_action_applied: false,
    contents_collected: false,
    signals: score ? [{ id: "coordinated_publish", category: "network", weight: score }] : []
  };
}
function weighReports(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const distinct = new Set(list.map(function(r) {
    return r && r.reporter_uid;
  }).filter(Boolean)).size;
  if (list.length < 5) return { brigade: false, distinct, young: 0, weight: list.length };
  const young = list.filter(function(r) {
    return r && Number(r.reporter_age_hours) >= 0 && Number(r.reporter_age_hours) < 24;
  }).length;
  const brigade = distinct >= 5 && young / list.length >= 0.7;
  return { brigade, distinct, young, weight: brigade ? 1 : list.length };
}
var CONFIRM = { REMOVE: 1, RESTRICT: 1, SUSPEND: 1, ESCALATE: 1, AGE_RESTRICT: 1, REGION_RESTRICT: 1 };
var OVERTURN = { ALLOW: 1, RESTORE: 1, DISMISS: 1 };
function repeatOffenders(cases, now) {
  const t = Number(now) || Date.now();
  const counts = {};
  (cases || []).forEach(function(c) {
    if (!c || !c.reported_user_id) return;
    if (c.decision !== "REMOVE" && c.decision !== "RESTRICT" && c.decision !== "SUSPEND") return;
    if (c.decided_at && t - c.decided_at > 30 * DAY_MS) return;
    counts[c.reported_user_id] = (counts[c.reported_user_id] || 0) + 1;
  });
  return Object.keys(counts).filter(function(uid) {
    return counts[uid] >= 2;
  }).map(function(uid) {
    return { uid, count: counts[uid] };
  }).sort(function(a, b) {
    return b.count - a.count;
  });
}
function safetyOverview(cases, appeals, now) {
  const t = Number(now) || Date.now();
  const list = cases || [];
  const open = list.filter(function(c) {
    return c && c.review_status !== "decided";
  });
  let confirmed = 0;
  let fp = 0;
  list.forEach(function(c) {
    if (!c || c.review_status !== "decided") return;
    const auto = c.automated_risk_result && c.automated_risk_result.decision;
    if (!auto || auto === "ALLOW" || auto === "PRIVATE") return;
    if (CONFIRM[c.decision]) confirmed += 1;
    else if (OVERTURN[c.decision]) fp += 1;
  });
  const judged = confirmed + fp;
  const offenders = repeatOffenders(list, t);
  return {
    reports_today: list.filter(function(c) {
      return c && c.reporter_id && c.reporter_id !== "system" && t - (c.created_at || 0) < DAY_MS;
    }).length,
    open_cases: open.length,
    urgent: open.filter(function(c) {
      return c.priority === "URGENT";
    }).length,
    high: open.filter(function(c) {
      return c.priority === "HIGH";
    }).length,
    medium: open.filter(function(c) {
      return c.priority === "MEDIUM";
    }).length,
    low: open.filter(function(c) {
      return c.priority === "LOW";
    }).length,
    automated_detections: list.filter(function(c) {
      return c && c.reporter_id === "system" && t - (c.created_at || 0) < DAY_MS;
    }).length,
    content_removed: list.filter(function(c) {
      return c && c.decision === "REMOVE";
    }).length,
    accounts_restricted: list.filter(function(c) {
      return c && (c.decision === "RESTRICT" || c.decision === "SUSPEND" || c.decision === "AGE_RESTRICT" || c.decision === "REGION_RESTRICT");
    }).length,
    appeals_open: (appeals || []).filter(function(a) {
      return a && a.status === "open";
    }).length,
    repeat_offenders: offenders.length,
    repeat: offenders.slice(0, 12),
    detection_accuracy: judged ? Math.round(100 * confirmed / judged) : null,
    false_positive_rate: judged ? Math.round(100 * fp / judged) : null,
    judged,
    private_read: false,
    auto_ban: false
  };
}
function scrubCase(row) {
  const out = Object.assign({}, row || {});
  FORBIDDEN_KEYS.concat(["public_text", "text", "caption", "reason", "note", "image", "bytes", "file"]).forEach(function(k) {
    delete out[k];
  });
  out.auto_ban = false;
  out.permanent_ban = false;
  return out;
}

// money.mjs
var ISO_ZERO = ["BIF", "CLP", "DJF", "GNF", "ISK", "JPY", "KMF", "KRW", "PYG", "RWF", "UGX", "VND", "VUV", "XAF", "XOF", "XPF"];
var ISO_THREE = ["BHD", "IQD", "JOD", "KWD", "LYD", "OMR", "TND"];
var STRIPE_ZERO = ["BIF", "CLP", "DJF", "GNF", "JPY", "KMF", "KRW", "MGA", "PYG", "RWF", "VND", "VUV", "XAF", "XOF", "XPF"];
var STRIPE_WHOLE_AS_TWO = ["UGX", "ISK"];
var STRIPE_THREE = ["BHD", "JOD", "KWD", "OMR", "TND"];
function normCode(c) {
  const s = String(c || "").trim().toUpperCase();
  return /^[A-Z]{3}$/.test(s) ? s : "";
}
function isoDigits(code) {
  const c = normCode(code);
  if (ISO_ZERO.indexOf(c) >= 0) return 0;
  if (ISO_THREE.indexOf(c) >= 0) return 3;
  return 2;
}
function majorToIso(major, code) {
  const d = isoDigits(code);
  return Math.round(Number(major) * Math.pow(10, d));
}
function isoToMajor(minor, code) {
  const d = isoDigits(code);
  return Number(minor) / Math.pow(10, d);
}
function majorToStripe(major, code) {
  const c = normCode(code);
  const n = Number(major);
  if (!isFinite(n) || n <= 0) return 0;
  if (STRIPE_ZERO.indexOf(c) >= 0) return Math.round(n);
  if (STRIPE_WHOLE_AS_TWO.indexOf(c) >= 0) return Math.round(n) * 100;
  if (STRIPE_THREE.indexOf(c) >= 0) return Math.round(n * 100) * 10;
  return Math.round(n * 100);
}
function stripeToMajor(amount, code) {
  const c = normCode(code);
  const n = Number(amount) || 0;
  if (STRIPE_ZERO.indexOf(c) >= 0) return n;
  if (STRIPE_THREE.indexOf(c) >= 0) return n / 1e3;
  return n / 100;
}
function convertMajor(major, from, to, rates) {
  const a = normCode(from);
  const b = normCode(to);
  const n = Number(major);
  if (!isFinite(n)) return NaN;
  if (!a || !b) return NaN;
  if (a === b) return n;
  const ra = a === "USD" ? 1 : Number(rates && rates[a]);
  const rb = b === "USD" ? 1 : Number(rates && rates[b]);
  if (!(ra > 0) || !(rb > 0)) return NaN;
  return n * (rb / ra);
}
function roundForCharge(major, code) {
  const c = normCode(code);
  if (STRIPE_ZERO.indexOf(c) >= 0 || STRIPE_WHOLE_AS_TWO.indexOf(c) >= 0) return Math.round(major);
  if (STRIPE_THREE.indexOf(c) >= 0) return Math.round(major * 100) / 100;
  return Math.round(major * 100) / 100;
}
function readPrice(entry) {
  if (!entry || typeof entry !== "object") return null;
  const amount = Number(entry.amount);
  const currency = normCode(entry.currency);
  if (!(amount > 0) || !currency) return null;
  return { amount, currency };
}
function readSupportPresets(entry) {
  if (!entry || typeof entry !== "object") return null;
  const currency = normCode(entry.currency);
  const list = Array.isArray(entry.amounts) ? entry.amounts.map(Number).filter((n) => n > 0) : [];
  if (!currency || !list.length) return null;
  return { currency, amounts: list.slice(0, 6) };
}
function priceIn(price, payCurrency, rates) {
  if (!price) return { error: "not-set" };
  const to = normCode(payCurrency) || price.currency;
  const raw = convertMajor(price.amount, price.currency, to, rates);
  if (!isFinite(raw) || raw <= 0) return { error: "no-rate" };
  const major = roundForCharge(raw, to);
  return { major, currency: to, stripe: majorToStripe(major, to), iso: majorToIso(major, to) };
}
function closeEnough(a, b, pct) {
  const x = Number(a), y = Number(b);
  if (!(x > 0) || !(y > 0)) return false;
  return Math.abs(x - y) / y <= (pct || 0.05);
}

// pay.mjs
function stripeSetupUrl(message) {
  const msg = String(message || "");
  const found = msg.match(/https:\/\/[^\s)'"<>]+/i);
  if (found) {
    const url = found[0].replace(/[.,)]$/, "");
    try {
      const u = new URL(url);
      if (u.protocol !== "https:") return "";
      if (u.hostname !== "dashboard.stripe.com" && u.hostname !== "connect.stripe.com") return "";
      return u.origin + u.pathname + u.search;
    } catch {
      return "";
    }
  }
  if (/activat|onboard|complete your account|signed up for Stripe Connect|live charges/i.test(msg)) {
    return "https://dashboard.stripe.com/account/onboarding";
  }
  return "";
}
function paymentsReady(env) {
  return !!(env && env.STRIPE_SECRET_KEY && env.STRIPE_WEBHOOK_SECRET);
}
function checkoutForm(fields) {
  const p = new URLSearchParams();
  const cur = String(fields.currency || "").toLowerCase();
  p.set("mode", "payment");
  p.set("success_url", fields.successUrl);
  p.set("cancel_url", fields.cancelUrl);
  p.set("client_reference_id", String(fields.ref || "").slice(0, 200));
  p.set("metadata[kind]", fields.kind);
  p.set("metadata[payer_uid]", fields.payerUid || "");
  p.set("metadata[creator_user_id]", fields.creatorUid || "");
  p.set("metadata[ad_id]", fields.adId || "");
  p.set("metadata[mail_id]", fields.mailId || "");
  p.set("metadata[broadcast_id]", fields.broadcastId || "");
  p.set("metadata[support_id]", fields.supportId || "");
  p.set("metadata[expected_amount]", String(fields.amountMinor));
  p.set("metadata[expected_currency]", cur);
  p.set("metadata[book_amount]", fields.bookAmount != null ? String(fields.bookAmount) : "");
  p.set("metadata[book_currency]", fields.bookCurrency ? String(fields.bookCurrency).toUpperCase() : "");
  if (fields.collectPhone) p.set("phone_number_collection[enabled]", "true");
  if (fields.customerEmail) p.set("customer_email", String(fields.customerEmail).slice(0, 200));
  if (fields.destination) {
    p.set("payment_intent_data[transfer_data][destination]", fields.destination);
    if (fields.feeMinor > 0) p.set("payment_intent_data[application_fee_amount]", String(fields.feeMinor));
    p.set("metadata[destination]", fields.destination);
    p.set("metadata[payout_to]", "creator");
    p.set("metadata[fee_minor]", String(fields.feeMinor || 0));
  } else if (fields.kind === "support") {
    p.set("metadata[payout_to]", "naluno");
    p.set("metadata[fee_minor]", "0");
  }
  p.set("line_items[0][quantity]", "1");
  p.set("line_items[0][price_data][currency]", cur);
  p.set("line_items[0][price_data][unit_amount]", String(fields.amountMinor));
  p.set("line_items[0][price_data][product_data][name]", fields.name || "Naluno");
  return p.toString();
}
function validateCheckout(body, payerUid) {
  const kind = String(body && body.kind || "");
  const currency = String(body && body.currency || "").toLowerCase();
  if (kind !== "support" && kind !== "ad" && kind !== "known") return { error: "Unknown payment" };
  if (!/^[a-z]{3}$/.test(currency)) return { error: "Unknown currency" };
  if (kind === "support") {
    const creator = String(body && body.creator_user_id || "");
    if (!creator || creator === payerUid) return { error: "Pick a creator" };
    let major = Number(body && body.amount_major);
    if (!(major > 0) && body && body.amount_minor != null) major = isoToMajor(Number(body.amount_minor), currency);
    if (!(major > 0) || !isFinite(major) || major > 1e8) return { error: "That amount cannot be charged" };
    return { kind, currency, amountMajor: major };
  }
  if (kind === "ad") {
    const adId = String(body && body.ad_id || "");
    const mailId = String(body && body.mail_id || "");
    if (adId.length < 4 && mailId.length < 4) return { error: "This ad is not saved yet" };
  }
  return { kind, currency };
}
function safeEqual(a, b) {
  const x = String(a || "");
  const y = String(b || "");
  if (x.length !== y.length) return false;
  let out = 0;
  for (let i = 0; i < x.length; i++) out |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return out === 0;
}
async function hmacHex(secret, msg) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(msg));
  return Array.from(new Uint8Array(sig)).map(function(b) {
    return (b < 16 ? "0" : "") + b.toString(16);
  }).join("");
}
async function verifyStripeSignature(raw, header, secret, nowMs) {
  if (!raw || !header || !secret) return false;
  const parts = {};
  String(header).split(",").forEach(function(bit) {
    const i = bit.indexOf("=");
    if (i < 1) return;
    const k = bit.slice(0, i).trim();
    const v = bit.slice(i + 1).trim();
    if (!parts[k]) parts[k] = [];
    parts[k].push(v);
  });
  const t = parts.t && parts.t[0];
  const v1 = parts.v1 || [];
  if (!t || !v1.length) return false;
  const ts = Number(t);
  if (!isFinite(ts)) return false;
  const now = Math.floor(Number(nowMs || Date.now()) / 1e3);
  if (Math.abs(now - ts) > 300) return false;
  const expect = await hmacHex(secret, t + "." + raw);
  return v1.some(function(got) {
    return safeEqual(expect, got);
  });
}
function applyCheckoutEvent(event) {
  if (!event || event.type !== "checkout.session.completed") return null;
  const s = event.data && event.data.object || {};
  if (s.payment_status !== "paid" || !s.id) return null;
  const meta = s.metadata || {};
  const kind = String(meta.kind || "");
  if (kind !== "support" && kind !== "ad" && kind !== "known") return null;
  const cur = String(s.currency || "").toUpperCase();
  const major = stripeToMajor(Number(s.amount_total) || 0, cur);
  return {
    id: String(s.id),
    status: "paid",
    kind,
    stripe_amount: Number(s.amount_total) || 0,
    amount_major: major,
    /* ISO minor units, the unit the Control Centre reads. */
    amount_minor: majorToIso(major, cur),
    currency: cur,
    expected_amount: Number(meta.expected_amount) || 0,
    expected_currency: String(meta.expected_currency || "").toUpperCase(),
    book_amount: Number(meta.book_amount) || 0,
    book_currency: String(meta.book_currency || "").toUpperCase(),
    /* Sessions opened by the previous worker carry book_minor instead of
       expected_amount. Stripe charged what that server set, so they are
       honoured once, the old way. */
    legacy_book_minor: Math.round(Number(meta.book_minor) || 0),
    payer_uid: String(meta.payer_uid || ""),
    creator_user_id: String(meta.creator_user_id || ""),
    ad_id: String(meta.ad_id || ""),
    mail_id: String(meta.mail_id || ""),
    broadcast_id: String(meta.broadcast_id || ""),
    support_id: String(meta.support_id || ""),
    payout_to: String(meta.payout_to || (meta.destination ? "creator" : "")),
    fee_minor: Number(meta.fee_minor) || 0
  };
}
function connectAccountForm(o) {
  const p = new URLSearchParams();
  p.set("type", "express");
  if (o && o.email) p.set("email", String(o.email).slice(0, 200));
  p.set("capabilities[transfers][requested]", "true");
  p.set("business_type", "individual");
  p.set("metadata[uid]", String(o && o.uid || ""));
  return p.toString();
}
function accountLinkForm(o) {
  const p = new URLSearchParams();
  p.set("account", o.account);
  p.set("refresh_url", o.refreshUrl);
  p.set("return_url", o.returnUrl);
  p.set("type", "account_onboarding");
  return p.toString();
}
function payoutState(acct) {
  if (!acct || !acct.id) return { connected: false, ready: false };
  const caps = acct.capabilities || {};
  const due = acct.requirements && acct.requirements.currently_due || [];
  const ready = !!(acct.charges_enabled && acct.payouts_enabled && caps.transfers === "active");
  return {
    connected: true,
    ready,
    details_submitted: !!acct.details_submitted,
    needs: Array.isArray(due) ? due.length : 0
  };
}
function supportFeeMinor(amountMinor, pct) {
  const a = Math.round(Number(amountMinor) || 0);
  let p = Number(pct);
  if (!isFinite(p) || p <= 0) return 0;
  if (p > 50) p = 50;
  return Math.max(0, Math.min(a - 1, Math.floor(a * p / 100)));
}
function payReturnUrl(origin, o) {
  const q = new URLSearchParams();
  q.set("pay", o.outcome === "cancel" ? "cancel" : "return");
  q.set("k", String(o.kind || ""));
  if (o.broadcastId && /^[A-Za-z0-9_-]{4,120}$/.test(o.broadcastId)) q.set("b", o.broadcastId);
  if (o.ref && /^[A-Za-z0-9_:.-]{1,150}$/.test(o.ref)) q.set("r", o.ref);
  let url = origin + "/app/?" + q.toString();
  if (o.outcome !== "cancel") url += "&s={CHECKOUT_SESSION_ID}";
  return url;
}
function momoPhone(raw) {
  let d = String(raw || "").replace(/\D/g, "");
  if (d.startsWith("0") && d.length === 10) d = "256" + d.slice(1);
  else if (d.length === 9 && d.charAt(0) === "7") d = "256" + d;
  if (!/^2567\d{8}$/.test(d)) return "";
  return d;
}
function momoNetworkOf(phone) {
  const p = momoPhone(phone);
  if (!p) return "";
  const pre = p.slice(3, 5);
  if (pre === "76" || pre === "77" || pre === "78" || pre === "79") return "mtn";
  if (pre === "70" || pre === "74" || pre === "75") return "airtel";
  return "";
}
function momoPayer(body) {
  const phone = momoPhone(body && body.phone);
  if (!phone) return { error: "Enter a Uganda mobile-money number. Nothing was charged." };
  const picked = String(body && body.network || "").toLowerCase();
  const guessed = momoNetworkOf(phone);
  const network = picked === "mtn" || picked === "airtel" ? picked : guessed;
  if (network !== "mtn" && network !== "airtel") return { error: "Choose MTN or Airtel. Nothing was charged." };
  if (guessed && guessed !== network) return { error: "That number is not on the network you chose. Nothing was charged." };
  return { phone, network, tail: phone.slice(-4) };
}
function momoCollectBody(intent) {
  return {
    amount: String(intent.amount_major),
    currency: String(intent.currency || "UGX"),
    externalId: String(intent.id),
    payer: { partyIdType: "MSISDN", partyId: String(intent.phone) },
    payerMessage: "Naluno",
    payeeNote: String(intent.kind || "naluno")
  };
}
async function momoNoticeValid(raw, signature, secret, intent) {
  if (!raw || !signature || !secret || !intent || !intent.id) return false;
  const expect = await hmacHex(secret, raw);
  if (!safeEqual(String(signature).trim(), expect)) return false;
  let body;
  try {
    body = JSON.parse(raw);
  } catch (_) {
    return false;
  }
  if (!body || String(body.intent_id) !== String(intent.id)) return false;
  const st = String(body.status || "").toLowerCase();
  if (st !== "successful" && st !== "paid") return false;
  if (String(body.currency || "").toUpperCase() !== String(intent.currency || "").toUpperCase()) return false;
  const got = Number(body.amount_major);
  const want = Number(intent.amount_major);
  if (!(want > 0) || got !== want) return false;
  return true;
}
function momoDisburseDecision(input) {
  const phaseOn = !!(input && input.phaseOn);
  const eligible = !!(input && input.eligible);
  const method = input && input.method || null;
  const phone = method ? momoPhone(method.phone) : "";
  const picked = method && (method.network === "mtn" || method.network === "airtel") ? method.network : "";
  const guessed = phone ? momoNetworkOf(phone) : "";
  const network = picked && (!guessed || guessed === picked) ? picked : "";
  const url = !!(input && input.disburseUrl);
  let code = "ready";
  if (!phaseOn) code = "phase_off";
  else if (!eligible) code = "not_eligible";
  else if (!phone || !network) code = "no_method";
  else if (!url) code = "not_connected";
  return {
    ok: code === "ready",
    paid: false,
    status: "unpaid",
    code,
    network,
    phone_tail: phone ? phone.slice(-4) : ""
  };
}

// momo-rail.mjs
function createMomoRail(d) {
  const {
    json: json2,
    fsGetDoc: fsGetDoc2,
    fsPutDoc: fsPutDoc2,
    fetchImpl,
    validateCheckout: validateCheckout2,
    momoPayer: momoPayer2,
    momoCollectBody: momoCollectBody2,
    momoNoticeValid: momoNoticeValid2,
    normCode: normCode2,
    priceIn: priceIn2,
    roundForCharge: roundForCharge2,
    majorToStripe: majorToStripe2,
    closeEnough: closeEnough2,
    loadRates: loadRates2,
    loadPriceBook: loadPriceBook2,
    readFlags: readFlags2,
    markPaid: markPaid2,
    momoDisburseDecision: momoDisburseDecision2
  } = d;
  async function quoteForMomo(env, user, saToken, body, check) {
    const payCur = normCode2(check.currency);
    const rates = await loadRates2(env, saToken);
    let charge = null;
    let bookAmount = null;
    let bookCurrency = "";
    if (check.kind === "support") {
      const flags = await readFlags2(env, saToken, null);
      if (!flags.flags.creator_support_enabled) {
        return { error: "Creator Support is off. Nothing was charged.", http: 403 };
      }
      const major = roundForCharge2(check.amountMajor, payCur);
      const got = payCur === "UGX" ? { major, currency: "UGX", stripe: majorToStripe2(major, "UGX") } : priceIn2({ amount: major, currency: payCur }, "UGX", rates);
      if (got.error) return { error: "Exchange rates are not available right now. Nothing was charged.", http: 503 };
      charge = got;
    }
    if (check.kind === "ad") {
      const adId = String(body.ad_id || "");
      const mailId = String(body.mail_id || "");
      const doc = adId ? await fsGetDoc2(env, saToken, "/deskAds/" + encodeURIComponent(adId)) : await fsGetDoc2(env, saToken, "/deskMail/" + encodeURIComponent(mailId));
      if (!doc) return { error: "This ad is not on file. Nothing was charged.", http: 404 };
      const owner = String(doc.creatorUid || doc.uid || "");
      if (owner && owner !== user.uid) return { error: "This ad is not yours.", http: 403 };
      const booked = Number(doc.paidAed) || 0;
      if (!(booked > 0)) return { error: "There is no amount to pay. Nothing was charged.", http: 400 };
      const got = priceIn2({ amount: booked, currency: "AED" }, "UGX", rates);
      if (got.error) return { error: "Exchange rates are not available right now. Nothing was charged.", http: 503 };
      charge = got;
      bookAmount = booked;
      bookCurrency = "AED";
    }
    if (check.kind === "known") {
      const app = await fsGetDoc2(env, saToken, "/knownApps/" + encodeURIComponent(user.uid));
      if (!app || app.status !== "accepted" && app.status !== "known" && app.status !== "lapsed") {
        return { error: "This has not been accepted yet. Nothing was charged.", http: 403 };
      }
      const book = await loadPriceBook2(env, saToken);
      if (!book.known) return { error: "The Known price is not set yet. Nothing was charged.", http: 503 };
      const shownCur = priceIn2(book.known, payCur, rates);
      if (shownCur.error) return { error: "Exchange rates are not available right now. Nothing was charged.", http: 503 };
      const shown = Number(body.amount_major);
      if (shown > 0 && !closeEnough2(shown, shownCur.major, 0.05)) {
        return {
          error: "The price was updated. Check it and tap again. Nothing was charged.",
          http: 409,
          code: "price_changed",
          amount_major: shownCur.major,
          currency: shownCur.currency
        };
      }
      const got = priceIn2(book.known, "UGX", rates);
      if (got.error) return { error: "Exchange rates are not available right now. Nothing was charged.", http: 503 };
      charge = got;
      bookAmount = book.known.amount;
      bookCurrency = book.known.currency;
    }
    if (!charge || !(charge.major > 0)) return { error: "That amount cannot be charged. Nothing was charged.", http: 400 };
    return { charge, bookAmount, bookCurrency };
  }
  async function payMomo(env, user, saToken, body) {
    if (!saToken) return json2({ ok: false, code: "not_connected", paid: false, error: "Payments are not connected yet. Nothing was charged." }, 503);
    const payer = momoPayer2(body || {});
    if (payer.error) return json2({ ok: false, paid: false, status: "unpaid", error: payer.error }, 400);
    const check = validateCheckout2(body, user.uid);
    if (check.error) return json2({ ok: false, paid: false, error: check.error }, 400);
    const quote = await quoteForMomo(env, user, saToken, body, check);
    if (quote.error) {
      return json2({
        ok: false,
        paid: false,
        error: quote.error,
        code: quote.code || "",
        amount_major: quote.amount_major || 0,
        currency: quote.currency || ""
      }, quote.http || 400);
    }
    const rawKey = String(body && body.idempotency_key || "t" + Date.now().toString(36)).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 48);
    const id = ("mm" + rawKey).slice(0, 72);
    const existing = await fsGetDoc2(env, saToken, "/payments/" + encodeURIComponent(id));
    const supportId = check.kind === "support" ? String(body.idempotency_key || id).slice(0, 120) : "";
    const reference = id.slice(-8).toUpperCase();
    if (!existing) {
      await fsPutDoc2(env, saToken, "/payments/" + encodeURIComponent(id), {
        status: "pending",
        provider: "momo",
        kind: check.kind,
        amount_major: quote.charge.major,
        amount_minor: quote.charge.stripe,
        currency: "UGX",
        expected_amount: quote.charge.stripe,
        expected_currency: "UGX",
        stripe_amount: quote.charge.stripe,
        book_amount: quote.bookAmount || 0,
        book_currency: quote.bookCurrency || "",
        payer_uid: user.uid,
        creator_user_id: String(body.creator_user_id || ""),
        ad_id: String(body.ad_id || ""),
        mail_id: String(body.mail_id || ""),
        broadcast_id: String(body.broadcast_id || ""),
        support_id: supportId,
        network: payer.network,
        phone: payer.phone,
        phone_tail: payer.tail,
        reference,
        createdAt: Date.now()
      });
      await fsPutDoc2(env, saToken, "/users/" + encodeURIComponent(user.uid) + "/payStatus/" + encodeURIComponent(id), {
        status: "pending",
        paid: false,
        kind: check.kind,
        amount_major: quote.charge.major,
        currency: "UGX",
        network: payer.network,
        phone_tail: payer.tail,
        reference,
        at: Date.now()
      });
    }
    let collected = false;
    if (!existing && env.MOMO_COLLECTIONS_URL && env.MOMO_COLLECTIONS_KEY) {
      try {
        const res = await fetchImpl(String(env.MOMO_COLLECTIONS_URL), {
          method: "POST",
          headers: {
            Authorization: "Bearer " + env.MOMO_COLLECTIONS_KEY,
            "Content-Type": "application/json",
            "X-Reference-Id": id,
            "X-Target-Environment": env.MOMO_TARGET_ENV || (payer.network === "airtel" ? "airteluganda" : "mtnuganda")
          },
          body: JSON.stringify(momoCollectBody2({
            id,
            amount_major: quote.charge.major,
            currency: "UGX",
            phone: payer.phone,
            kind: check.kind
          }))
        });
        collected = !!(res && res.ok);
      } catch (_) {
        collected = false;
      }
    }
    const ref = existing && existing.reference || reference;
    const already = existing && existing.status === "paid";
    return json2({
      ok: true,
      paid: false,
      status: "pending",
      rail: "momo",
      intent_id: id,
      reference: ref,
      amount_major: quote.charge.major,
      currency: "UGX",
      network: payer.network,
      phone_tail: payer.tail,
      collected,
      message: already ? "This was already confirmed. Nothing new was taken." : collected ? "Approve the prompt on your phone. Nothing is marked paid until MTN or Airtel confirms. Reference " + ref + "." : "Naluno recorded this request. The mobile-money line is not connected yet, so nothing was taken. It stays unpaid until a confirmed notice arrives. Reference " + ref + "."
    });
  }
  async function payMomoNotice(env, request, saToken) {
    if (!saToken || !env.MOMO_NOTICE_SECRET) return json2({ ok: false, paid: false }, 503);
    const raw = await request.text();
    const sig = request.headers.get("X-Naluno-Momo") || "";
    let peek = null;
    try {
      peek = JSON.parse(raw);
    } catch (_) {
      return json2({ ok: false }, 400);
    }
    const id = String(peek && peek.intent_id || "");
    if (!/^[A-Za-z0-9_-]{8,80}$/.test(id)) return json2({ ok: false }, 400);
    const intent = await fsGetDoc2(env, saToken, "/payments/" + encodeURIComponent(id));
    if (!intent || intent.provider !== "momo") return json2({ ok: false }, 404);
    const ok = await momoNoticeValid2(raw, sig, env.MOMO_NOTICE_SECRET, intent);
    if (!ok) return json2({ ok: false, paid: false }, 400);
    if (intent.status === "paid") return json2({ ok: true, already: true });
    await markPaid2(env, saToken, {
      id,
      provider: "momo",
      kind: intent.kind,
      amount_minor: intent.amount_minor,
      amount_major: intent.amount_major,
      currency: intent.currency,
      stripe_amount: intent.stripe_amount || intent.expected_amount,
      expected_amount: intent.expected_amount,
      expected_currency: intent.expected_currency,
      book_amount: intent.book_amount || 0,
      book_currency: intent.book_currency || "",
      payer_uid: intent.payer_uid,
      creator_user_id: intent.creator_user_id,
      ad_id: intent.ad_id,
      mail_id: intent.mail_id,
      broadcast_id: intent.broadcast_id,
      support_id: intent.support_id
    });
    if (intent.payer_uid) {
      await fsPutDoc2(env, saToken, "/users/" + encodeURIComponent(intent.payer_uid) + "/payStatus/" + encodeURIComponent(id), {
        status: "paid",
        paid: true,
        at: Date.now()
      });
    }
    return json2({ ok: true, status: "paid" });
  }
  function disburseError(code) {
    if (code === "phase_off") return "Monetisation is not on. Nothing was sent.";
    if (code === "not_eligible") return "This account is not on the monetisation list. Nothing was sent.";
    if (code === "no_method") return "Save an MTN or Airtel number first. Nothing was sent.";
    return "Mobile money payouts are not connected yet. Nothing was sent.";
  }
  async function disburseMomo(env, user, saToken) {
    if (!user || !user.uid) {
      return json2({ ok: false, paid: false, status: "unpaid", code: "sign_in", error: "Sign in. Nothing was sent." }, 401);
    }
    if (!saToken) {
      return json2({
        ok: false,
        paid: false,
        status: "unpaid",
        code: "not_connected",
        rail: "momo",
        kind: "monetisation",
        error: "Mobile money payouts are not connected yet. Nothing was sent."
      }, 503);
    }
    const flags = await readFlags2(env, saToken, null);
    const phaseOn = !!(flags && flags.flags && flags.flags.monetisation_phase_enabled);
    const mark = await fsGetDoc2(env, saToken, "/creatorMonetisation/" + encodeURIComponent(user.uid));
    const method = await fsGetDoc2(env, saToken, "/creatorPayoutMethods/" + encodeURIComponent(user.uid));
    const decision = (typeof momoDisburseDecision2 === "function" ? momoDisburseDecision2 : function() {
      return { ok: false, paid: false, status: "unpaid", code: "not_connected" };
    })({
      phaseOn,
      eligible: !!(mark && mark.eligible === true),
      method,
      disburseUrl: env && env.MOMO_DISBURSE_URL
    });
    if (decision.paid) decision.paid = false;
    if (!decision.ok) {
      return json2({
        ok: false,
        paid: false,
        status: "unpaid",
        code: decision.code || "not_connected",
        rail: "momo",
        kind: "monetisation",
        error: disburseError(decision.code)
      }, decision.code === "not_connected" ? 503 : 403);
    }
    let submitted = false;
    try {
      const res = await fetchImpl(String(env.MOMO_DISBURSE_URL), {
        method: "POST",
        headers: {
          Authorization: "Bearer " + String(env.MOMO_DISBURSE_KEY || ""),
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          phone: method.phone,
          network: decision.network,
          currency: "UGX",
          externalId: "mn" + String(user.uid).slice(0, 40),
          kind: "monetisation"
        })
      });
      submitted = !!(res && res.ok);
    } catch (_) {
      submitted = false;
    }
    await fsPutDoc2(env, saToken, "/users/" + encodeURIComponent(user.uid) + "/payStatus/monetise", {
      status: submitted ? "submitted" : "unpaid",
      paid: false,
      kind: "monetisation",
      rail: "momo",
      network: decision.network || "",
      phone_tail: decision.phone_tail || "",
      at: Date.now()
    });
    return json2({
      ok: submitted,
      paid: false,
      status: submitted ? "submitted" : "unpaid",
      code: submitted ? "submitted" : "not_connected",
      rail: "momo",
      kind: "monetisation",
      message: submitted ? "The mobile-money line accepted a request. It is not marked paid until MTN or Airtel confirms." : "The mobile-money line did not accept it. Nothing was marked paid."
    }, submitted ? 200 : 503);
  }
  return { payMomo, payMomoNotice, disburseMomo };
}

// books.mjs
var USD_AED = 3.6725;
var RATES = null;
function setBookRates(rates) {
  if (!rates || typeof rates !== "object") return;
  const aed = Number(rates.AED);
  if (isFinite(aed) && aed > 0) USD_AED = aed;
  RATES = rates;
}
var CACHE_MS = 3 * 60 * 1e3;
var cache = { at: 0, value: null };
var inflight = null;
var READ_CAP = 5e4;
var WRITE_CAP = 2e4;
var DELETE_CAP = 2e4;
var STORAGE_CAP_GB = 1;
var READ_USD = 0.06 / 1e5;
var WRITE_USD = 0.18 / 1e5;
var DELETE_USD = 0.02 / 1e5;
var STORAGE_USD = 0.18;
var CLASS_A = {
  listbuckets: 1,
  putbucket: 1,
  listobjects: 1,
  listobjectsv2: 1,
  putobject: 1,
  copyobject: 1,
  completemultipartupload: 1,
  createmultipartupload: 1,
  lifecyclestoragetiertransition: 1,
  listmultipartuploads: 1,
  uploadpart: 1,
  uploadpartcopy: 1,
  listparts: 1,
  putbucketencryption: 1,
  putbucketcors: 1,
  putbucketlifecycleconfiguration: 1,
  classa: 1
};
var CLASS_B = {
  headbucket: 1,
  headobject: 1,
  getobject: 1,
  usagesummary: 1,
  getbucketencryption: 1,
  getbucketlocation: 1,
  getbucketcors: 1,
  getbucketlifecycleconfiguration: 1,
  classb: 1
};
function num2(v) {
  const n = Number(v);
  return isFinite(n) ? n : 0;
}
function round2(n) {
  return Math.round(num2(n) * 100) / 100;
}
function usdToAed(usd) {
  return round2(num2(usd) * USD_AED);
}
function clip(s, n) {
  s = String(s || "").replace(/\s+/g, " ").trim();
  return s.length > n ? s.slice(0, n - 1) + "\u2026" : s;
}
function classifyCloudflareService(family, name) {
  const s = (String(family || "") + " " + String(name || "")).toLowerCase();
  if (/r2/.test(s) && /class\s*a|a operation/.test(s)) return "r2_class_a";
  if (/r2/.test(s) && /class\s*b|b operation/.test(s)) return "r2_class_b";
  if (/r2/.test(s) && /storage|gb-month|gigabyte/.test(s)) return "r2_storage";
  if (/^r2$/.test(String(family || "").toLowerCase()) && /storage/.test(s)) return "r2_storage";
  if (/worker/.test(s)) return "workers";
  if (/realtime|calls|turn/.test(s)) return "turn";
  return "";
}
function mapBillableRows(rows) {
  const grouped = {};
  (Array.isArray(rows) ? rows : []).forEach(function(row) {
    if (!row || typeof row !== "object") return;
    const family = row.ServiceFamilyName || row.serviceFamilyName || "";
    const name = row.ServiceName || row.serviceName || "";
    const key = classifyCloudflareService(family, name);
    if (!key) return;
    const qty = num2(row.ConsumedQuantity != null ? row.ConsumedQuantity : row.PricingQuantity);
    const cost = num2(row.ContractedCost != null ? row.ContractedCost : row.contractedCost);
    const unit = String(row.ConsumedUnit || row.consumedUnit || "");
    if (!grouped[key]) grouped[key] = { key, qty: 0, cost: 0, unit, service: String(name || family || key) };
    grouped[key].qty += qty;
    grouped[key].cost += cost;
    if (unit) grouped[key].unit = unit;
  });
  return Object.keys(grouped).map(function(k) {
    const g = grouped[k];
    return {
      key: g.key,
      service: g.service,
      qty: g.qty,
      unit: g.unit,
      amount_usd: round2(g.cost),
      amount_aed: usdToAed(g.cost),
      source: "billable-usage"
    };
  });
}
function mapR2Ops(groups) {
  let classA = 0;
  let classB = 0;
  (Array.isArray(groups) ? groups : []).forEach(function(g) {
    if (!g) return;
    const action = String(g.dimensions && g.dimensions.actionType || "").toLowerCase();
    const requests = num2(g.sum && g.sum.requests);
    if (CLASS_A[action]) classA += requests;
    else if (CLASS_B[action]) classB += requests;
  });
  return { classA, classB };
}
function sumSeries(seriesList) {
  let n = 0;
  (Array.isArray(seriesList) ? seriesList : []).forEach(function(s) {
    (s && s.points || []).forEach(function(p) {
      const v = p && p.value || {};
      const x = v.int64Value != null ? num2(v.int64Value) : num2(v.doubleValue);
      n += x;
    });
  });
  return n;
}
function latestGauge(seriesList) {
  let best = null;
  let bestT = -1;
  (Array.isArray(seriesList) ? seriesList : []).forEach(function(s) {
    (s && s.points || []).forEach(function(p) {
      const t = Date.parse(p.interval && p.interval.endTime || "") || 0;
      if (t < bestT) return;
      const v = p.value || {};
      bestT = t;
      best = v.int64Value != null ? num2(v.int64Value) : num2(v.doubleValue);
    });
  });
  return best;
}
function preferOps(seriesList) {
  const list = Array.isArray(seriesList) ? seriesList : [];
  const ops = list.filter(function(s) {
    return /_ops_count/.test(String(s.metric && s.metric.type || ""));
  });
  return ops.length ? ops : list;
}
function splitSeries(seriesList) {
  const ops = { read: [], write: [], del: [] };
  const gauge = [];
  (Array.isArray(seriesList) ? seriesList : []).forEach(function(s) {
    const t = String(s.metric && s.metric.type || "");
    if (/storage|byte_size|bytes/.test(t)) gauge.push(s);
    else if (/delete/.test(t)) ops.del.push(s);
    else if (/write/.test(t)) ops.write.push(s);
    else if (/read/.test(t)) ops.read.push(s);
  });
  return { ops, gauge };
}
function overage(qty, cap, usdEach) {
  const extra = Math.max(0, num2(qty) - cap);
  return usdToAed(extra * usdEach);
}
function firebaseLines(counts) {
  counts = counts || {};
  const reads = num2(counts.reads);
  const writes = num2(counts.writes);
  const deletes = num2(counts.deletes);
  const gb = num2(counts.storageGb);
  function line(key, service, qty, unit, cap, amount) {
    const over = qty > cap;
    return {
      key,
      service,
      qty,
      unit,
      cap,
      amount_aed: amount,
      source: "monitoring",
      note: "Firebase counted " + qty + " " + unit + ". Published cap is " + cap + (over ? ". The amount is the published price of today's excess, not an invoice." : ". Inside that cap. Not an invoice.")
    };
  }
  const out = [
    line("fs_reads", "Firestore reads", reads, "reads today", READ_CAP, overage(reads, READ_CAP, READ_USD)),
    line("fs_writes", "Firestore writes", writes, "writes today", WRITE_CAP, overage(writes, WRITE_CAP, WRITE_USD)),
    line("fs_deletes", "Firestore deletes", deletes, "deletes today", DELETE_CAP, overage(deletes, DELETE_CAP, DELETE_USD))
  ];
  if (counts.storageGb != null) {
    out.push(line("fs_storage", "Firestore storage", Math.round(gb * 1e3) / 1e3, "GB", STORAGE_CAP_GB, overage(gb, STORAGE_CAP_GB, STORAGE_USD)));
  }
  return out;
}
function pacificMidnightIso(now) {
  const d = new Date(now);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).formatToParts(d);
  const get = function(t) {
    const p = parts.filter(function(x) {
      return x.type === t;
    })[0];
    return p ? Number(p.value) : 0;
  };
  const elapsed = ((get("hour") * 60 + get("minute")) * 60 + get("second")) * 1e3;
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
  const data = await res.json().catch(function() {
    return {};
  });
  return { ok: res.ok, status: res.status, data };
}
function cfNote(line, fetchedAt) {
  const when = new Date(fetchedAt).toISOString().slice(0, 16).replace("T", " ") + " UTC";
  if (line.source === "analytics") {
    return "Cloudflare counted " + line.qty + " " + (line.unit || "") + ". Not the bill. Fetched " + when + ".";
  }
  return "Cloudflare billable usage: " + line.qty + " " + (line.unit || "") + ", " + line.amount_usd + " USD. Updated daily, not live. Fetched " + when + ".";
}
async function billingSnapshot(env, extras) {
  extras = extras || {};
  const now = Date.now();
  if (cache.value && now - cache.at < CACHE_MS) return cache.value;
  if (inflight) return inflight;
  inflight = collect(env, extras, now).then(function(value) {
    cache.at = Date.now();
    cache.value = value;
    return value;
  }).finally(function() {
    inflight = null;
  });
  return inflight;
}
async function collect(env, extras, now) {
  const ask = extras.fetch || fetch;
  const token = env && (env.CF_API_TOKEN || env.CLOUDFLARE_API_TOKEN);
  const account = env && (env.CF_ACCOUNT_ID || env.CLOUDFLARE_ACCOUNT_ID);
  const project = extras.projectId || env && (env.FIREBASE_PROJECT_ID || env.GCP_PROJECT) || "";
  const value = {
    connected: !!(token && account),
    invoices: [],
    usage: {
      fetchedAt: now,
      cloudflare: { ok: false, error: "", lines: [] },
      firebase: { ok: false, error: "", lines: [] }
    }
  };
  if (!token || !account) value.usage.cloudflare.error = "Cloudflare billing is not connected.";
  const jobs = [];
  if (token && account) {
    jobs.push(pullHistory(ask, token, account, now).then(function(r) {
      value.invoices = r.invoices;
      if (r.error && !value.usage.cloudflare.error) value.usage.cloudflare.error = r.error;
    }));
    jobs.push(pullBillable(ask, token, account, now).then(function(r) {
      if (r.ok) {
        value.usage.cloudflare.ok = true;
        value.usage.cloudflare.lines = value.usage.cloudflare.lines.concat(r.lines);
      } else if (r.error) value.usage.cloudflare.error = r.error;
    }));
    jobs.push(pullAnalytics(ask, token, account, now).then(function(r) {
      if (r.ok) {
        value.usage.cloudflare.ok = true;
        const have = {};
        value.usage.cloudflare.lines.forEach(function(l) {
          have[l.key] = 1;
        });
        r.lines.forEach(function(l) {
          if (!have[l.key]) value.usage.cloudflare.lines.push(l);
        });
      } else if (r.error && !value.usage.cloudflare.ok) value.usage.cloudflare.error = r.error;
    }));
  }
  jobs.push(pullFirebase(ask, project, extras.getMonitoringToken, now).then(function(r) {
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
      headers: { Authorization: "Bearer " + token }
    });
    if (!res.ok) return { invoices: [], error: clip("Cloudflare billing history refused (" + res.status + ").", 140) };
    const invoices = [];
    (res.data && res.data.result || []).forEach(function(row) {
      if (!row) return;
      const raw = Number(row.amount != null ? row.amount : row.total);
      if (!isFinite(raw) || raw === 0) return;
      const currency = String(row.currency || "USD").toUpperCase();
      const per = RATES && Number(RATES[currency]) > 0 ? Number(RATES[currency]) : currency === "USD" ? 1 : 0;
      const aed = currency === "AED" ? raw : per ? raw / per * USD_AED : raw * USD_AED;
      const when = Date.parse(row.occurred_at || row.created_on || row.period || "") || now;
      invoices.push({
        key: "cloudflare",
        vendor: "Cloudflare",
        amount_aed: round2(aed),
        status: "invoiced",
        source: "cloudflare",
        note: row.type || row.action || row.description || "Cloudflare billing history",
        updatedAt: when
      });
    });
    return { invoices, error: "" };
  } catch (e) {
    return { invoices: [], error: clip(e && e.message || "Cloudflare billing history failed.", 140) };
  }
}
async function pullBillable(ask, token, account, now) {
  try {
    const url = "https://api.cloudflare.com/client/v4/accounts/" + encodeURIComponent(account) + "/billable-usage?from=" + monthStart(now) + "&to=" + dayStamp(now);
    const res = await readJson(ask, url, { headers: { Authorization: "Bearer " + token } });
    if (!res.ok) {
      if (res.status === 404) return { ok: false, error: "" };
      return { ok: false, error: clip("Cloudflare billable usage refused (" + res.status + "). The token needs Billing Read.", 160) };
    }
    const rows = res.data && (res.data.result || res.data.usage) || [];
    const lines = mapBillableRows(rows).map(function(l) {
      l.note = cfNote(l, now);
      return l;
    });
    return { ok: true, lines, error: "" };
  } catch (e) {
    return { ok: false, error: clip(e && e.message || "Cloudflare billable usage failed.", 140) };
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
      body: JSON.stringify({ query, variables: { account, start, end } })
    });
    if (!res.ok) return { ok: false, error: clip("Cloudflare analytics refused (" + res.status + ").", 140) };
    if (res.data && res.data.errors && res.data.errors.length && !(res.data.data && res.data.data.viewer)) {
      return { ok: false, error: clip(res.data.errors[0].message || "Cloudflare analytics refused.", 140) };
    }
    const acc = (((res.data || {}).data || {}).viewer || {}).accounts;
    const box = (Array.isArray(acc) ? acc[0] : acc) || {};
    const lines = [];
    let requests = 0;
    (box.workersInvocationsAdaptive || []).forEach(function(g) {
      requests += num2(g.sum && g.sum.requests);
    });
    if (requests > 0) {
      lines.push({
        key: "workers",
        qty: requests,
        unit: "requests today",
        amount_aed: 0,
        amount_usd: 0,
        source: "analytics",
        service: "Workers",
        note: cfNote({ qty: requests, unit: "requests today", source: "analytics" }, now)
      });
    }
    const ops = mapR2Ops(box.r2OperationsAdaptiveGroups || []);
    if (ops.classA > 0) {
      lines.push({
        key: "r2_class_a",
        qty: ops.classA,
        unit: "class A today",
        amount_aed: 0,
        amount_usd: 0,
        source: "analytics",
        service: "R2 uploads",
        note: cfNote({ qty: ops.classA, unit: "class A today", source: "analytics" }, now)
      });
    }
    if (ops.classB > 0) {
      lines.push({
        key: "r2_class_b",
        qty: ops.classB,
        unit: "class B today",
        amount_aed: 0,
        amount_usd: 0,
        source: "analytics",
        service: "R2 reads",
        note: cfNote({ qty: ops.classB, unit: "class B today", source: "analytics" }, now)
      });
    }
    let bytes = 0;
    (box.r2StorageAdaptiveGroups || []).forEach(function(g) {
      bytes = Math.max(bytes, num2(g.max && g.max.payloadSize));
    });
    if (bytes > 0) {
      const gb = Math.round(bytes / 1e9 * 1e3) / 1e3;
      lines.push({
        key: "r2_storage",
        qty: gb,
        unit: "GB",
        amount_aed: 0,
        amount_usd: 0,
        source: "analytics",
        service: "R2 storage",
        note: cfNote({ qty: gb, unit: "GB", source: "analytics" }, now)
      });
    }
    return { ok: true, lines, error: "" };
  } catch (e) {
    return { ok: false, error: clip(e && e.message || "Cloudflare analytics failed.", 140) };
  }
}
async function pullFirebase(ask, project, getToken, now) {
  if (!project || typeof getToken !== "function") {
    return { ok: false, error: "Firebase is not counted. The worker has no service account.", lines: [] };
  }
  let token = "";
  try {
    token = await getToken();
  } catch (_) {
    token = "";
  }
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
    'metric.type="firestore.googleapis.com/storage/data_and_index_storage_bytes"'
  ].join(" OR ");
  const url = "https://monitoring.googleapis.com/v3/projects/" + encodeURIComponent(project) + "/timeSeries?filter=" + encodeURIComponent(filter) + "&interval.startTime=" + encodeURIComponent(start) + "&interval.endTime=" + encodeURIComponent(end);
  try {
    const res = await readJson(ask, url, { headers: { Authorization: "Bearer " + token } });
    if (res.status === 403) {
      return { ok: false, error: "Cloud Monitoring refused this account. It needs Monitoring Viewer.", lines: [] };
    }
    if (!res.ok) {
      const msg = res.data && res.data.error && res.data.error.message || "Cloud Monitoring refused (" + res.status + ").";
      return { ok: false, error: clip(msg, 160), lines: [] };
    }
    const series = res.data && res.data.timeSeries || [];
    if (!series.length) return { ok: false, error: "Cloud Monitoring returned no Firestore series.", lines: [] };
    const split = splitSeries(series);
    const storageBytes = latestGauge(split.gauge);
    const counts = {
      reads: sumSeries(preferOps(split.ops.read)),
      writes: sumSeries(preferOps(split.ops.write)),
      deletes: sumSeries(preferOps(split.ops.del)),
      storageGb: storageBytes == null ? null : storageBytes / 1e9
    };
    return { ok: true, error: "", lines: firebaseLines(counts) };
  } catch (e) {
    return { ok: false, error: clip(e && e.message || "Cloud Monitoring failed.", 140), lines: [] };
  }
}

// look.mjs
function decode(s) {
  return String(s || "").replace(/&/g, "&").replace(/"/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/</g, "<").replace(/>/g, ">");
}
function clean(s) {
  return decode(s).replace(/<[^>]+>/g, "").replace(/[\u200e\u200f]/g, "").replace(/\s+/g, " ").trim();
}
function parseLookHtml(html) {
  const text = String(html || "");
  const hits3 = [];
  const re = /class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]{0,1200}?class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
  let m;
  while ((m = re.exec(text)) && hits3.length < 5) {
    const href = decode(m[1]);
    const uddg = href.match(/uddg=([^&]+)/);
    let url = "";
    try {
      url = uddg ? decodeURIComponent(uddg[1]) : "";
    } catch (_) {
      url = "";
    }
    if (!/^https:\/\//.test(url) || /duckduckgo\.com/i.test(url)) continue;
    const title = clean(m[2]).slice(0, 140);
    const snippet = clean(m[3]).slice(0, 320);
    if (!title && !snippet) continue;
    hits3.push({ title, snippet, url });
  }
  return hits3;
}
async function lookQuery(q) {
  const query = String(q || "").replace(/\s+/g, " ").trim().slice(0, 80);
  if (query.length < 2) return [];
  const res = await fetch("https://html.duckduckgo.com/html/?q=" + encodeURIComponent(query), {
    headers: { "User-Agent": "Mozilla/5.0 NalunoCompass" }
  });
  if (!res.ok) return [];
  return parseLookHtml(await res.text());
}

// views.mjs
var VIEW_SEC_DEFAULT = 4;
var VIEW_SEC_MIN = 1;
var VIEW_SEC_MAX = 120;
var VIEW_OPEN_TTL_MS = 6 * 60 * 60 * 1e3;
function clampViewSec(n) {
  const v = Math.round(Number(n));
  if (!isFinite(v) || v < VIEW_SEC_MIN) return VIEW_SEC_DEFAULT;
  return Math.min(VIEW_SEC_MAX, v);
}
function viewMonthKey(now) {
  const d = new Date(Number(now) || Date.now());
  return d.getUTCFullYear() + "-" + String(d.getUTCMonth() + 1).padStart(2, "0");
}
function viewOpenId(uid, broadcastId) {
  return String(uid || "").replace(/[^A-Za-z0-9_-]/g, "") + "_" + String(broadcastId || "").replace(/[^A-Za-z0-9_-]/g, "");
}
function cleanBroadcastId(raw) {
  const id = String(raw || "");
  if (id.length < 4 || id.length > 120 || !/^[A-Za-z0-9_-]+$/.test(id)) return "";
  return id;
}
function viewDecision(o) {
  const now = Number(o && o.now) || Date.now();
  const need = clampViewSec(o && o.needSec) * 1e3;
  if (!o || !o.broadcast) return { error: "not_found" };
  if (o.broadcast.deleted) return { error: "not_found" };
  if (o.uid && o.broadcast.creatorUid && o.uid === o.broadcast.creatorUid) return { error: "own" };
  const opened = Number(o.openedAt) || 0;
  if (!opened) return { error: "not_open" };
  if (now - opened > VIEW_OPEN_TTL_MS) return { error: "not_open" };
  const spent = now - opened;
  if (spent < need) return { wait_ms: need - spent };
  return { count: true, dwell_ms: spent };
}
function viewWrites(docRoot, v) {
  const month = viewMonthKey(v.now);
  const viewer = docRoot + "/broadcasts/" + v.broadcastId + "/viewers/" + v.uid;
  const bcast = docRoot + "/broadcasts/" + v.broadcastId;
  const inc = function(path) {
    return { fieldPath: path, increment: { integerValue: "1" } };
  };
  const writes = [
    {
      update: {
        name: viewer,
        fields: {
          ts: { integerValue: String(Math.round(v.now)) },
          dwellMs: { integerValue: String(Math.round(v.dwellMs || 0)) },
          countedBy: { stringValue: "server" }
        }
      },
      currentDocument: { exists: false }
    },
    { transform: { document: bcast, fieldTransforms: [inc("views"), inc("uniqueViews")] } }
  ];
  if (v.creatorUid) {
    const toga = docRoot + "/toga/" + v.creatorUid;
    writes.push({
      update: {
        name: toga,
        fields: {
          monthKey: { stringValue: month },
          featuredBroadcastId: { stringValue: v.broadcastId },
          updatedAt: { integerValue: String(Math.round(v.now)) }
        }
      },
      updateMask: { fieldPaths: ["monthKey", "featuredBroadcastId", "updatedAt"] }
    });
    writes.push({ transform: { document: toga, fieldTransforms: [inc("viewsTotal"), inc("`mv_" + month + "`")] } });
  }
  return writes;
}

// pbkdf2.mjs
var K = new Uint32Array([
  1116352408,
  1899447441,
  3049323471,
  3921009573,
  961987163,
  1508970993,
  2453635748,
  2870763221,
  3624381080,
  310598401,
  607225278,
  1426881987,
  1925078388,
  2162078206,
  2614888103,
  3248222580,
  3835390401,
  4022224774,
  264347078,
  604807628,
  770255983,
  1249150122,
  1555081692,
  1996064986,
  2554220882,
  2821834349,
  2952996808,
  3210313671,
  3336571891,
  3584528711,
  113926993,
  338241895,
  666307205,
  773529912,
  1294757372,
  1396182291,
  1695183700,
  1986661051,
  2177026350,
  2456956037,
  2730485921,
  2820302411,
  3259730800,
  3345764771,
  3516065817,
  3600352804,
  4094571909,
  275423344,
  430227734,
  506948616,
  659060556,
  883997877,
  958139571,
  1322822218,
  1537002063,
  1747873779,
  1955562222,
  2024104815,
  2227730452,
  2361852424,
  2428436474,
  2756734187,
  3204031479,
  3329325298
]);
var IV = [1779033703, 3144134277, 1013904242, 2773480762, 1359893119, 2600822924, 528734635, 1541459225];
function compress(st, w) {
  let a = st[0], b = st[1], c = st[2], d = st[3], e = st[4], f = st[5], g = st[6], h = st[7];
  for (let i = 16; i < 64; i++) {
    const x = w[i - 15], y = w[i - 2];
    const s0 = (x >>> 7 | x << 25) ^ (x >>> 18 | x << 14) ^ x >>> 3;
    const s1 = (y >>> 17 | y << 15) ^ (y >>> 19 | y << 13) ^ y >>> 10;
    w[i] = w[i - 16] + s0 + w[i - 7] + s1 | 0;
  }
  for (let i = 0; i < 64; i++) {
    const S1 = (e >>> 6 | e << 26) ^ (e >>> 11 | e << 21) ^ (e >>> 25 | e << 7);
    const ch = e & f ^ ~e & g;
    const t1 = h + S1 + ch + K[i] + w[i] | 0;
    const S0 = (a >>> 2 | a << 30) ^ (a >>> 13 | a << 19) ^ (a >>> 22 | a << 10);
    const mj = a & b ^ a & c ^ b & c;
    const t2 = S0 + mj | 0;
    h = g;
    g = f;
    f = e;
    e = d + t1 | 0;
    d = c;
    c = b;
    b = a;
    a = t1 + t2 | 0;
  }
  st[0] = st[0] + a | 0;
  st[1] = st[1] + b | 0;
  st[2] = st[2] + c | 0;
  st[3] = st[3] + d | 0;
  st[4] = st[4] + e | 0;
  st[5] = st[5] + f | 0;
  st[6] = st[6] + g | 0;
  st[7] = st[7] + h | 0;
}
function sha256(bytes) {
  const len = bytes.length;
  const blocks = Math.ceil((len + 9) / 64);
  const buf = new Uint8Array(blocks * 64);
  buf.set(bytes);
  buf[len] = 128;
  const bits = len * 8;
  const dv = new DataView(buf.buffer);
  dv.setUint32(buf.length - 4, bits >>> 0);
  dv.setUint32(buf.length - 8, Math.floor(bits / 4294967296));
  const st = new Uint32Array(IV);
  const w = new Uint32Array(64);
  for (let b = 0; b < blocks; b++) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(b * 64 + i * 4);
    compress(st, w);
  }
  const out = new Uint8Array(32);
  const ov = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) ov.setUint32(i * 4, st[i]);
  return out;
}
function padState(key, pad) {
  const w = new Uint32Array(64);
  for (let i = 0; i < 16; i++) {
    w[i] = ((key[i * 4] ^ pad) << 24 | (key[i * 4 + 1] ^ pad) << 16 | (key[i * 4 + 2] ^ pad) << 8 | key[i * 4 + 3] ^ pad) >>> 0;
  }
  const st = new Uint32Array(IV);
  compress(st, w);
  return st;
}
function hmac32(inner, outer, msg, out, w) {
  const st = new Uint32Array(inner);
  for (let i = 0; i < 8; i++) w[i] = msg[i];
  w[8] = 2147483648;
  for (let i = 9; i < 15; i++) w[i] = 0;
  w[15] = (64 + 32) * 8;
  compress(st, w);
  const st2 = new Uint32Array(outer);
  for (let i = 0; i < 8; i++) w[i] = st[i];
  w[8] = 2147483648;
  for (let i = 9; i < 15; i++) w[i] = 0;
  w[15] = (64 + 32) * 8;
  compress(st2, w);
  for (let i = 0; i < 8; i++) out[i] = st2[i];
}
function hmacBytes(inner, outer, msg) {
  const len = msg.length;
  const total = 64 + len;
  const blocks = Math.ceil((len + 9) / 64);
  const buf = new Uint8Array(blocks * 64);
  buf.set(msg);
  buf[len] = 128;
  const bits = total * 8;
  const dv = new DataView(buf.buffer);
  dv.setUint32(buf.length - 4, bits >>> 0);
  dv.setUint32(buf.length - 8, Math.floor(bits / 4294967296));
  const st = new Uint32Array(inner);
  const w = new Uint32Array(64);
  for (let b = 0; b < blocks; b++) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(b * 64 + i * 4);
    compress(st, w);
  }
  const out = new Uint32Array(8);
  hmac32Finish(outer, st, out, w);
  return out;
}
function hmac32Finish(outer, innerDigest, out, w) {
  const st2 = new Uint32Array(outer);
  for (let i = 0; i < 8; i++) w[i] = innerDigest[i];
  w[8] = 2147483648;
  for (let i = 9; i < 15; i++) w[i] = 0;
  w[15] = (64 + 32) * 8;
  compress(st2, w);
  for (let i = 0; i < 8; i++) out[i] = st2[i];
}
function pbkdf2Sha256Js(password, salt, iterations, dkLen) {
  const enc = new TextEncoder();
  let key = typeof password === "string" ? enc.encode(password) : new Uint8Array(password);
  const saltBytes = typeof salt === "string" ? enc.encode(salt) : new Uint8Array(salt);
  const iters = Math.max(1, Number(iterations) || 1);
  const length = dkLen || 32;
  if (key.length > 64) key = sha256(key);
  const k = new Uint8Array(64);
  k.set(key);
  const inner = padState(k, 54);
  const outer = padState(k, 92);
  const out = new Uint8Array(length);
  const nBlocks = Math.ceil(length / 32);
  const w = new Uint32Array(64);
  for (let block = 1; block <= nBlocks; block++) {
    const msg = new Uint8Array(saltBytes.length + 4);
    msg.set(saltBytes);
    msg[saltBytes.length] = block >>> 24 & 255;
    msg[saltBytes.length + 1] = block >>> 16 & 255;
    msg[saltBytes.length + 2] = block >>> 8 & 255;
    msg[saltBytes.length + 3] = block & 255;
    const u = hmacBytes(inner, outer, msg);
    const t = new Uint32Array(u);
    for (let i = 1; i < iters; i++) {
      hmac32(inner, outer, u, u, w);
      for (let j = 0; j < 8; j++) t[j] ^= u[j];
    }
    const off = (block - 1) * 32;
    for (let j = 0; j < 8 && off + j * 4 < length; j++) {
      const v = t[j];
      const bytes = [v >>> 24 & 255, v >>> 16 & 255, v >>> 8 & 255, v & 255];
      for (let q = 0; q < 4 && off + j * 4 + q < length; q++) out[off + j * 4 + q] = bytes[q];
    }
  }
  return out;
}
var WORKER_PBKDF2_MAX = 1e5;

// wire-notify.mjs
var WIRE_FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
var WINDOW_MS = 10 * 60 * 1e3;
var PER_MINUTE = 40;
var PER_PAIR = 15;
var hits = /* @__PURE__ */ new Map();
var fcmToken = { value: "", until: 0 };
function wireKindLabel(type) {
  const t = String(type || "text");
  if (t === "voice" || t === "audio") return "Voice message";
  if (t === "photo" || t === "image") return "Photo";
  if (t === "video") return "Video";
  if (t === "file") return "File";
  if (t === "mood") return "Mood";
  if (t === "missed_call" || t === "call") return "Missed call";
  return "New message";
}
function rateOk(uid, now, limit) {
  const minute = Math.floor(now / 6e4);
  const k = uid + "|" + minute;
  const n = (hits.get(k) || 0) + 1;
  if (hits.size > 5e3) {
    for (const key of hits.keys()) {
      if (!(Number(String(key).split("|").pop()) >= minute - 1)) hits.delete(key);
    }
  }
  hits.set(k, n);
  return n <= limit;
}
var SILENT = { reaction: 1, receipt: 1, system: 1, typing: 1, read: 1 };
async function handleWireNotify(body, sender, deps) {
  const now = deps.now ? deps.now() : Date.now();
  const to = String(body && body.to || "");
  const mid = String(body && body.clientMsgId || "");
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(to)) return { status: 400, body: { ok: false, error: "bad recipient" } };
  if (!/^[A-Za-z0-9_.:-]{1,200}$/.test(mid)) return { status: 400, body: { ok: false, error: "bad message id" } };
  if (!sender || !sender.uid) return { status: 401, body: { ok: false, error: "sign in" } };
  if (to === sender.uid) return { status: 400, body: { ok: false, error: "cannot alert yourself" } };
  if (!rateOk(sender.uid, now, PER_MINUTE) || !rateOk(sender.uid + ">" + to, now, PER_PAIR)) return { status: 429, body: { ok: false, error: "slow down" } };
  const tid = [sender.uid, to].sort().join("_");
  const [mine, theirs, thread, drop] = await Promise.all([
    deps.getDoc("/users/" + sender.uid + "/connections/" + to),
    deps.getDoc("/users/" + to + "/connections/" + sender.uid),
    deps.getDoc("/threads/" + tid),
    deps.getDoc("/wireDrop/" + to + "/inbox/" + encodeURIComponent(mid))
  ]);
  if (!mine || !theirs) return { status: 403, body: { ok: false, error: "not connected" } };
  if (drop && (String(drop.from || "") !== sender.uid || drop.to && String(drop.to) !== to)) {
    return { status: 403, body: { ok: false, error: "not your message" } };
  }
  const parts = thread && Array.isArray(thread.participants) ? thread.participants : [];
  const lastAt = Number(thread && thread.lastMessageAt || 0);
  const fresh = (t) => t && t <= now + 6e4 && now - t <= WINDOW_MS;
  const fromThread = parts.indexOf(sender.uid) >= 0 && parts.indexOf(to) >= 0 && String(thread.lastMessageFrom || "") === sender.uid && fresh(lastAt);
  const fromDrop = !!drop && fresh(Number(drop.ts || 0));
  if (!fromThread && !fromDrop) return { status: 200, body: { ok: true, sent: 0, reason: "old" } };
  const type = String(drop && drop.type || thread && thread.lastKind || "text");
  if (SILENT[type] || drop && drop.system) return { status: 200, body: { ok: true, sent: 0, reason: "silent" } };
  const [profile, them, vault] = await Promise.all([
    deps.getDoc("/users/" + sender.uid),
    deps.getDoc("/users/" + to),
    deps.getDoc("/users/" + to + "/vault/main")
  ]);
  const name = String(profile && profile.name || "").trim().slice(0, 60) || "Naluno";
  const tokens = tokensOf(vault, them);
  if (!tokens.length) return { status: 200, body: { ok: true, sent: 0, reason: "no_token" } };
  const link = "/app/?wire=" + encodeURIComponent(sender.uid);
  const out = await sendAll(tokens, {
    type: "wireline",
    fromUid: sender.uid,
    senderName: name,
    title: name,
    body: wireKindLabel(type),
    clientMsgId: mid,
    url: link
  }, link, deps, now);
  return out;
}
function tokensOf() {
  const tokens = [];
  const kinds = [];
  Array.prototype.slice.call(arguments).forEach(function(d) {
    if (!d) return;
    ["fcmTokenAndroid", "fcmTokenWeb", "fcmToken"].forEach(function(k) {
      const v = d[k];
      if (typeof v === "string" && v.length > 20 && v.length < 4096 && tokens.indexOf(v) < 0) {
        tokens.push(v);
        kinds.push(k === "fcmTokenAndroid" ? "android" : k === "fcmTokenWeb" ? "web" : String(d.fcmTokenPlatform || "") || "web");
      }
    });
  });
  tokens.kinds = kinds;
  return tokens;
}
async function sendAll(tokens, data, link, deps, now) {
  let bearer2 = fcmToken.value && fcmToken.until > now ? fcmToken.value : "";
  if (!bearer2) {
    bearer2 = await deps.accessToken(WIRE_FCM_SCOPE);
    if (!bearer2) return { status: 503, body: { ok: false, sent: 0, error: "push not configured" } };
    fcmToken = { value: bearer2, until: now + 50 * 60 * 1e3 };
  }
  const endpoint = "https://fcm.googleapis.com/v1/projects/" + deps.projectId + "/messages:send";
  let sent = 0;
  const failures = [];
  const results = [];
  await Promise.all(tokens.map(async function(token, n) {
    const kind = tokens.kinds && tokens.kinds[n] || "";
    try {
      const res = await deps.fetch(endpoint, {
        method: "POST",
        headers: { Authorization: "Bearer " + bearer2, "Content-Type": "application/json" },
        body: JSON.stringify({
          message: {
            token,
            data,
            android: { priority: "HIGH", ttl: "86400s" },
            /* No fcm_options.link: FCM refuses a link that is not a full
               https address (400), which made every web alert fail in 05f.
               The service worker opens the chat from data.url. */
            webpush: { headers: { Urgency: "high", TTL: "86400" } },
            apns: { headers: { "apns-priority": "10" } }
          }
        })
      });
      if (res.ok) {
        sent++;
        results.push({ phone: kind, ok: true });
        return;
      }
      const t = await res.text().catch(() => "");
      if (res.status === 401 || res.status === 403) fcmToken = { value: "", until: 0 };
      const why = /UNREGISTERED|NOT_FOUND/.test(t) ? "unregistered" : "http_" + res.status;
      failures.push(why);
      results.push({ phone: kind, ok: false, why });
    } catch (_) {
      failures.push("network");
      results.push({ phone: kind, ok: false, why: "network" });
    }
  }));
  return { status: 200, body: { ok: true, sent, tokens: tokens.length, failures, phones: results } };
}
async function handlePushTest(body, user, deps) {
  const now = deps.now ? deps.now() : Date.now();
  if (!user || !user.uid) return { status: 401, body: { ok: false, error: "sign in" } };
  if (!rateOk("test:" + user.uid, now, 4)) return { status: 429, body: { ok: false, error: "slow down" } };
  const [me, vault] = await Promise.all([
    deps.getDoc("/users/" + user.uid),
    deps.getDoc("/users/" + user.uid + "/vault/main")
  ]);
  const tokens = tokensOf(vault, me);
  if (!tokens.length) return { status: 200, body: { ok: true, sent: 0, reason: "no_token" } };
  const wait = Math.max(0, Math.min(8e3, Number(body && body.delay || 0) || 0));
  if (wait && deps.sleep) await deps.sleep(wait);
  return sendAll(tokens, {
    type: "wireline",
    fromUid: user.uid,
    senderName: "Naluno",
    title: "Naluno",
    body: "Test alert: Wireline notifications reach this phone.",
    clientMsgId: "test-" + now,
    url: "/app/"
  }, "/app/", deps, deps.now ? deps.now() : Date.now());
}

// lg-voice.mjs
var LG_TTS_URL = "https://api.sunbird.ai/tasks/audio/speech";
var PER_MINUTE2 = 40;
var MAX_TEXT = 600;
var MAX_BYTES = 8 * 1024 * 1024;
var SPEAKER = /^[a-z]{2,12}_lug_\d{4}$/;
var hits2 = /* @__PURE__ */ new Map();
var daily = /* @__PURE__ */ new Map();
function rateOk2(uid, now) {
  const minute = Math.floor(now / 6e4);
  const k = uid + "|" + minute;
  const n = (hits2.get(k) || 0) + 1;
  if (hits2.size > 5e3) for (const key of hits2.keys()) {
    if (!(Number(String(key).split("|").pop()) >= minute - 1)) hits2.delete(key);
  }
  hits2.set(k, n);
  return n <= PER_MINUTE2;
}
function charsOk(uid, now, n, limit) {
  const day = Math.floor(now / 864e5);
  const k = uid + "|" + day;
  const used = daily.get(k) || 0;
  if (used + n > limit) return false;
  if (daily.size > 2e4) for (const key of daily.keys()) {
    if (!(Number(String(key).split("|").pop()) >= day)) daily.delete(key);
  }
  daily.set(k, used + n);
  return true;
}
async function sha256Hex(s) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
function isAudio(type) {
  return /^audio\//i.test(type || "") || /octet-stream/i.test(type || "");
}
async function handleLgVoice(body, user, deps) {
  const env = deps.env || {};
  const now = deps.now ? deps.now() : Date.now();
  if (!user || !user.uid) return { status: 401, json: { ok: false, error: "sign in" } };
  const key = String(env.SUNBIRD_API_KEY || "").trim();
  if (!key) return { status: 503, json: { ok: false, error: "luganda voice not configured" } };
  const text = String(body && body.text || "").replace(/\s+/g, " ").trim();
  if (!text || text.length > MAX_TEXT || !/[A-Za-z]/.test(text)) return { status: 400, json: { ok: false, error: "text" } };
  const want = String(body && body.speaker || "");
  if (want && !SPEAKER.test(want)) return { status: 400, json: { ok: false, error: "speaker" } };
  const male = body && body.voice === "male";
  const speaker = want || (male && SPEAKER.test(String(env.LG_VOICE_MALE || "")) ? String(env.LG_VOICE_MALE) : "") || (SPEAKER.test(String(env.LG_VOICE_FEMALE || "")) ? String(env.LG_VOICE_FEMALE) : "salt_lug_0001");
  if (!rateOk2(user.uid, now)) return { status: 429, json: { ok: false, error: "slow down" } };
  const cacheKey = "https://naluno-lg-voice.cache/v1/" + await sha256Hex(speaker + "\n" + text);
  if (deps.cache) {
    try {
      const hit = await deps.cache.match(cacheKey);
      if (hit && hit.ok) {
        const bytes2 = await hit.arrayBuffer();
        if (bytes2.byteLength) return { status: 200, bytes: bytes2, type: hit.headers.get("Content-Type") || "audio/wav", cached: true, speaker };
      }
    } catch (_) {
    }
  }
  const limit = Math.max(1e3, Number(env.LG_DAILY_CHARS) || 3e4);
  if (!charsOk(user.uid, now, text.length, limit)) return { status: 429, json: { ok: false, error: "daily limit" } };
  let res;
  try {
    res = await deps.fetch(String(env.SUNBIRD_TTS_URL || LG_TTS_URL), {
      method: "POST",
      headers: { Authorization: "Bearer " + key, "Content-Type": "application/json", Accept: "audio/wav, audio/mpeg, application/json" },
      body: JSON.stringify({ text, language: "lug", voice: speaker, response_mode: "stream" })
    });
  } catch (_) {
    return { status: 502, json: { ok: false, error: "luganda voice unreachable" } };
  }
  if (res.status === 401 || res.status === 403) return { status: 503, json: { ok: false, error: "luganda voice key refused" } };
  if (!res.ok) return { status: 502, json: { ok: false, error: "luganda voice " + res.status } };
  let type = res.headers.get("Content-Type") || "";
  let bytes;
  if (isAudio(type)) {
    bytes = await res.arrayBuffer();
  } else {
    const j = await res.json().catch(() => null);
    const url = j && (j.audio_url || j.output && j.output.audio_url);
    if (!url || !/^https:\/\//.test(String(url))) return { status: 502, json: { ok: false, error: "luganda voice gave no audio" } };
    let a;
    try {
      a = await deps.fetch(String(url));
    } catch (_) {
      a = null;
    }
    if (!a || !a.ok) return { status: 502, json: { ok: false, error: "luganda audio unreachable" } };
    type = a.headers.get("Content-Type") || "audio/wav";
    bytes = await a.arrayBuffer();
  }
  if (!bytes || !bytes.byteLength || bytes.byteLength > MAX_BYTES) return { status: 502, json: { ok: false, error: "luganda audio size" } };
  if (!/^audio\//i.test(type)) type = "audio/wav";
  if (deps.cache) {
    try {
      await deps.cache.put(cacheKey, new Response(bytes.slice(0), { headers: { "Content-Type": type, "Cache-Control": "public, max-age=2592000" } }));
    } catch (_) {
    }
  }
  return { status: 200, bytes, type, cached: false, speaker };
}

// live.mjs
var rooms = /* @__PURE__ */ new Map();
function callsReady(env) {
  return !!(env && env.CF_CALLS_APP_ID && env.CF_CALLS_APP_SECRET);
}
function rememberRoom(id, row) {
  if (!id || !row) return;
  rooms.set(String(id), row);
}
function takeRoom(id) {
  return rooms.get(String(id)) || null;
}
function forgetRoom(id) {
  rooms.delete(String(id));
}
function midsFromSdp(sdp) {
  const lines = String(sdp || "").split(/\r?\n/);
  const out = [];
  let mid = "";
  let kind = "";
  lines.forEach(function(line) {
    if (line.indexOf("m=") === 0) {
      if (mid) out.push({ mid, kind: kind || "video" });
      kind = line.slice(2).split(" ")[0] || "video";
      mid = "";
    } else if (line.indexOf("a=mid:") === 0) {
      mid = line.slice(6).trim();
    }
  });
  if (mid) out.push({ mid, kind: kind || "video" });
  return out;
}
function publishTracks(sdp) {
  return midsFromSdp(sdp).map(function(row, i) {
    const kind = row.kind === "audio" ? "audio" : "video";
    return { location: "local", mid: row.mid, trackName: kind + (i > 1 ? String(i) : "") };
  });
}
async function cfCalls(env, fetchImpl, path, method, body) {
  const root = "https://rtc.live.cloudflare.com/v1/apps/" + encodeURIComponent(env.CF_CALLS_APP_ID);
  const res = await fetchImpl(root + path, {
    method: method || "POST",
    headers: {
      Authorization: "Bearer " + env.CF_CALLS_APP_SECRET,
      "Content-Type": "application/json"
    },
    body: body == null ? void 0 : JSON.stringify(body)
  });
  const data = await res.json().catch(function() {
    return {};
  });
  return { ok: res.ok, status: res.status, data: data || {} };
}

// handler.mjs
var VERSION = "2.12.0-bands";
var PROJECT_ID = "naluno-28a00";
var OPERATOR_UID = "ibMOMY6Q3sVTCxIrwO2FGk43zw93";
var DEFAULT_FLAGS = {
  broadcast_enabled: true,
  signals_enabled: true,
  toga_enabled: true,
  contribution_enabled: true,
  community_value_enabled: true,
  creator_support_enabled: false,
  community_rewards_enabled: false,
  real_payouts_enabled: false,
  monetisation_phase_enabled: false,
  content_hub_enabled: false,
  sports_enabled: false,
  movies_enabled: false
};
var POINTS = {
  BROADCAST_COMMENT: { points: 3, eligible: 3 },
  COMMENT_REPLY: { points: 2, eligible: 2 },
  CREATOR_FOLLOW: { points: 1, eligible: 1 },
  WATCH_COMPLETION: { points: 2, eligible: 2 },
  BROADCAST_SHARE: { points: 2, eligible: 2 },
  SIGNAL_POST: { points: 1, eligible: 1 }
};
var REPORT_CODES = {
  harassment: 1,
  hate: 1,
  violence: 1,
  sexual: 1,
  scam: 1,
  impersonation: 1,
  stolen: 1,
  spam: 1,
  other: 1,
  terrorism: 1,
  recruitment: 1,
  child_exploitation: 1,
  sexual_exploitation: 1,
  fraud: 1,
  dangerous: 1,
  illegal: 1
};
var memory = {
  events: /* @__PURE__ */ new Map(),
  ledger: /* @__PURE__ */ new Map(),
  profiles: /* @__PURE__ */ new Map(),
  flags: { ...DEFAULT_FLAGS },
  reports: /* @__PURE__ */ new Map(),
  presence: /* @__PURE__ */ new Map(),
  audit: [],
  passwords: /* @__PURE__ */ new Map(),
  pools: /* @__PURE__ */ new Map(),
  mail: /* @__PURE__ */ new Map(),
  mailHits: /* @__PURE__ */ new Map(),
  reserved: /* @__PURE__ */ new Map(),
  handleFlags: /* @__PURE__ */ new Map(),
  handles: /* @__PURE__ */ new Map(),
  safetyCases: /* @__PURE__ */ new Map(),
  safetyAudit: [],
  safetyAppeals: /* @__PURE__ */ new Map(),
  safetyLedgers: /* @__PURE__ */ new Map(),
  safetyClusters: {},
  safetyBirths: /* @__PURE__ */ new Map(),
  safetyPrints: /* @__PURE__ */ new Map(),
  safetyReportHits: []
};
var _fetch = globalThis.fetch.bind(globalThis);
var saCache = { token: "", exp: 0, err: "" };
function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Naluno-Admin",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    "Cache-Control": "no-store"
  };
}
function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(), "Content-Type": "application/json" }
  });
}
function corsPreflight() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}
function b64url(data) {
  let bin;
  if (typeof data === "string") {
    bin = unescape(encodeURIComponent(data));
  } else {
    const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data.buffer || data);
    bin = "";
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  }
  const s = btoa(bin);
  return s.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function parseServiceAccount(raw) {
  if (!raw) return null;
  if (typeof raw === "object") return normalizeSa(raw);
  let s = String(raw).trim();
  if (!s) return null;
  if (s.startsWith("'") && s.endsWith("'") || s.startsWith('"') && s.endsWith('"')) {
    s = s.slice(1, -1);
  }
  s = s.replace(/\r\n/g, "\n");
  for (let i = 0; i < 4; i++) {
    try {
      const obj = JSON.parse(s);
      if (typeof obj === "string") {
        s = obj;
        continue;
      }
      if (obj && typeof obj === "object") return normalizeSa(obj);
    } catch {
    }
    const unescaped = s.replace(/\\n/g, "\n").replace(/\\"/g, '"').replace(/\\t/g, "	");
    if (unescaped !== s) {
      try {
        const obj = JSON.parse(unescaped);
        if (typeof obj === "string") {
          s = obj;
          continue;
        }
        if (obj && typeof obj === "object") return normalizeSa(obj);
      } catch {
      }
    }
    try {
      const pad = s.replace(/-/g, "+").replace(/_/g, "/");
      const padded = pad + "===".slice((pad.length + 3) % 4);
      const dec = atob(padded);
      if (dec && dec !== s && /[{"]/.test(dec)) {
        s = dec;
        continue;
      }
    } catch {
      break;
    }
    break;
  }
  return null;
}
function normalizeSa(obj) {
  if (!obj || typeof obj !== "object") return null;
  const email = obj.client_email || obj.clientEmail || "";
  let pk = String(obj.private_key || obj.privateKey || "");
  pk = pk.replace(/\\n/g, "\n").replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  if (!email || !pk.includes("BEGIN")) return null;
  if (!pk.endsWith("\n")) pk += "\n";
  return {
    client_email: email,
    private_key: pk,
    token_uri: obj.token_uri || "https://oauth2.googleapis.com/token",
    project_id: obj.project_id || obj.projectId || PROJECT_ID
  };
}
function pemToArrayBuffer(pem) {
  const body = String(pem).replace(/-----BEGIN [^-]+-----/g, "").replace(/-----END [^-]+-----/g, "").replace(/\s+/g, "");
  const bin = atob(body);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}
async function signRs256Jwt(sa, { now = Math.floor(Date.now() / 1e3), scope } = {}) {
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64url(JSON.stringify({
    iss: sa.client_email,
    sub: sa.client_email,
    scope: scope || "https://www.googleapis.com/auth/datastore https://www.googleapis.com/auth/firebase.database",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600
  }));
  const unsigned = header + "." + claim;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToArrayBuffer(sa.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(unsigned)
  );
  return unsigned + "." + b64url(sig);
}
async function saAccessToken(env) {
  const now = Math.floor(Date.now() / 1e3);
  if (saCache.token && saCache.exp - 60 > now) return saCache.token;
  const sa = parseServiceAccount(
    env.GOOGLE_SERVICE_ACCOUNT || env.FIREBASE_SERVICE_ACCOUNT || env.SERVICE_ACCOUNT_JSON || env.GOOGLE_SA_JSON || ""
  );
  if (!sa) {
    saCache.err = "no-service-account";
    return "";
  }
  try {
    const jwt = await signRs256Jwt(sa, { now });
    const res = await _fetch(sa.token_uri || "https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "grant_type=" + encodeURIComponent("urn:ietf:params:oauth:grant-type:jwt-bearer") + "&assertion=" + encodeURIComponent(jwt)
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.access_token) {
      saCache.err = String(body.error || body.error_description || "http-" + res.status);
      saCache.token = "";
      return "";
    }
    saCache.token = body.access_token;
    saCache.exp = now + Number(body.expires_in || 3600);
    saCache.err = "";
    return saCache.token;
  } catch (e) {
    saCache.err = e && e.message || "jwt-failed";
    return "";
  }
}
function projectId(env) {
  return env.FIREBASE_PROJECT_ID || env.GCP_PROJECT || PROJECT_ID;
}
function apiKey(env) {
  return env.FIREBASE_WEB_API_KEY || env.FIREBASE_API_KEY || "AIzaSyD0j1W7-gFJqbMd6rz4kMhQd5AiB8B2ox0";
}
function operatorUid(env) {
  return env.OPERATOR_UID || OPERATOR_UID;
}
function fsRoot(env) {
  return "https://firestore.googleapis.com/v1/projects/" + projectId(env) + "/databases/(default)/documents";
}
function toFsValue(v) {
  if (v === null || v === void 0) return { nullValue: null };
  if (typeof v === "boolean") return { booleanValue: v };
  if (typeof v === "number") {
    if (Number.isInteger(v)) return { integerValue: String(v) };
    return { doubleValue: v };
  }
  if (typeof v === "string") return { stringValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toFsValue) } };
  if (typeof v === "object") {
    const fields = {};
    Object.keys(v).forEach((k) => {
      fields[k] = toFsValue(v[k]);
    });
    return { mapValue: { fields } };
  }
  return { stringValue: String(v) };
}
function fromFsValue(v) {
  if (!v || typeof v !== "object") return null;
  if ("stringValue" in v) return v.stringValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return Number(v.doubleValue);
  if ("booleanValue" in v) return !!v.booleanValue;
  if ("nullValue" in v) return null;
  if ("timestampValue" in v) return Date.parse(v.timestampValue) || 0;
  if ("arrayValue" in v) return (v.arrayValue.values || []).map(fromFsValue);
  if ("mapValue" in v) {
    const out = {};
    const f = v.mapValue && v.mapValue.fields || {};
    Object.keys(f).forEach((k) => {
      out[k] = fromFsValue(f[k]);
    });
    return out;
  }
  return null;
}
function fromFsDoc(doc) {
  const fields = doc && doc.fields || {};
  const out = {};
  Object.keys(fields).forEach((k) => {
    out[k] = fromFsValue(fields[k]);
  });
  if (doc && doc.name) {
    const parts = String(doc.name).split("/");
    out.id = parts[parts.length - 1];
  }
  return out;
}
function toFsFields(obj) {
  const fields = {};
  Object.keys(obj || {}).forEach((k) => {
    if (obj[k] === void 0) return;
    fields[k] = toFsValue(obj[k]);
  });
  return { fields };
}
async function fsIncrement(env, token, docPath, fields, setFields) {
  if (!token) return { ok: false };
  const name = fsRoot(env).replace("https://firestore.googleapis.com/v1/", "") + docPath;
  const transforms = Object.keys(fields).map((k) => ({
    fieldPath: k,
    increment: { integerValue: String(Math.round(Number(fields[k]) || 0)) }
  }));
  const writes = [];
  if (setFields && Object.keys(setFields).length) {
    writes.push({
      update: { name, fields: toFsFields(setFields).fields },
      updateMask: { fieldPaths: Object.keys(setFields) }
    });
  }
  writes.push({ transform: { document: name, fieldTransforms: transforms } });
  const res = await _fetch(fsRoot(env) + ":commit", {
    method: "POST",
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify({ writes })
  });
  return { ok: res.ok, status: res.status };
}
async function fsFetch(env, token, method, path, body) {
  if (!token) return { ok: false, status: 0, data: null };
  const url = path.startsWith("http") ? path : fsRoot(env) + path;
  const res = await _fetch(url, {
    method,
    headers: {
      Authorization: "Bearer " + token,
      "Content-Type": "application/json"
    },
    body: body ? JSON.stringify(body) : void 0
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}
async function fsFetchPublic(env, method, path, body) {
  const key = apiKey(env);
  if (!key) return { ok: false, status: 0, data: null };
  const base = path.startsWith("http") ? path : fsRoot(env) + path;
  const url = base + (base.includes("?") ? "&" : "?") + "key=" + encodeURIComponent(key);
  const res = await _fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : void 0
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}
async function verifyIdToken(env, idToken) {
  if (!idToken) return null;
  const res = await _fetch(
    "https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=" + encodeURIComponent(apiKey(env)),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken })
    }
  );
  if (!res.ok) return null;
  const data = await res.json().catch(() => ({}));
  const u = data.users && data.users[0];
  if (!u || !u.localId) return null;
  return {
    uid: u.localId,
    email: u.email || "",
    name: u.displayName || "",
    emailVerified: u.emailVerified === true,
    customAttributes: u.customAttributes || ""
  };
}
function bearer(request) {
  const h = request.headers.get("Authorization") || request.headers.get("authorization") || "";
  const m = /^Bearer\s+(.+)$/i.exec(h.trim());
  return m ? m[1].trim() : "";
}
function stripPrefix(pathname) {
  let p = pathname || "/";
  if (p.startsWith("/__naluno-economy")) p = p.slice("/__naluno-economy".length) || "/";
  if (!p.startsWith("/")) p = "/" + p;
  return p;
}
function scoreEvent(eventType, text) {
  const spec = POINTS[eventType];
  if (!spec) return { points: 0, eligible: 0, status: "IGNORED", reason: "unknown event" };
  const t = typeof text === "string" ? text.trim() : "";
  if ((eventType === "BROADCAST_COMMENT" || eventType === "COMMENT_REPLY") && t.length < 8) {
    return { points: 0, eligible: 0, status: "PENDING_REVIEW", reason: "short text" };
  }
  return { points: spec.points, eligible: spec.eligible, status: "COUNTED", reason: "ok" };
}
function trustLabelFor(events) {
  const n = Number(events) || 0;
  if (n >= 20) return "HIGH";
  if (n >= 5) return "MEDIUM";
  if (n >= 1) return "LOW";
  return "NEW";
}
function addContributionRow(bag, seen, row, uid) {
  if (!row || String(row.user_id || "") !== uid) return;
  const id = String(row.ledger_id || row.event_id || row.id || "");
  if (id && seen.has(id)) return;
  if (id) seen.add(id);
  bag.points += Number(row.points) || 0;
  bag.eligible += Number(row.eligible_points) || 0;
  bag.events += 1;
}
async function readContribution(env, saToken, uid) {
  const bag = { points: 0, eligible: 0, events: 0 };
  const seen = /* @__PURE__ */ new Set();
  for (const row of memory.ledger.values()) {
    addContributionRow(bag, seen, row, uid);
  }
  let profilePoints = 0;
  let profileEligible = 0;
  let profileEvents = 0;
  let profileRead = false;
  if (saToken && uid) {
    try {
      const cur = await fsFetch(env, saToken, "GET", "/contributionProfiles/" + encodeURIComponent(uid));
      if (cur.ok && cur.data) {
        const d = fromFsDoc(cur.data) || {};
        if (!d.user_id || String(d.user_id) === uid) {
          profilePoints = Number(d.total_points) || 0;
          profileEligible = Number(d.eligible_points) || 0;
          profileEvents = Number(d.events) || 0;
          profileRead = true;
        }
      }
    } catch {
    }
    try {
      const r = await fsFetch(env, saToken, "POST", ":runQuery", {
        structuredQuery: {
          from: [{ collectionId: "contributionLedger" }],
          where: {
            fieldFilter: {
              field: { fieldPath: "user_id" },
              op: "EQUAL",
              value: { stringValue: uid }
            }
          },
          limit: 500
        }
      });
      const rows = (Array.isArray(r.data) ? r.data : []).filter((x) => x && x.document);
      rows.forEach((x) => {
        addContributionRow(bag, seen, fromFsDoc(x.document) || {}, uid);
      });
    } catch {
    }
  }
  if (profileRead) {
    if (profilePoints > bag.points) bag.points = profilePoints;
    if (profileEligible > bag.eligible) bag.eligible = profileEligible;
    if (profileEvents > bag.events) bag.events = profileEvents;
  }
  return bag;
}
function profileOf(uid) {
  if (!memory.profiles.has(uid)) {
    memory.profiles.set(uid, {
      user_id: uid,
      total_points: 0,
      eligible_points: 0,
      events: 0,
      updated_at: 0
    });
  }
  return memory.profiles.get(uid);
}
function applyLedger(row) {
  memory.ledger.set(row.ledger_id, row);
  const p = profileOf(row.user_id);
  p.total_points += Number(row.points) || 0;
  p.eligible_points += Number(row.eligible_points) || 0;
  p.events += 1;
  p.updated_at = row.ts;
}
async function persistEvent(env, userToken, saToken, row) {
  const paths = [];
  const eventDoc = {
    event_id: row.event_id,
    event_type: row.event_type,
    actor_user_id: row.user_id,
    user_id: row.user_id,
    target_type: row.target_type || "",
    target_id: row.target_id || "",
    broadcast_id: row.broadcast_id || "",
    parent_event_id: row.parent_event_id || "",
    creator_uid: row.creator_uid || "",
    session_id: row.session_id || "",
    text: String(row.text || "").slice(0, 2e3),
    ts: row.ts,
    client_ts: row.client_ts || row.ts
  };
  const ledgerDoc = {
    ledger_id: row.ledger_id,
    event_id: row.event_id,
    user_id: row.user_id,
    event_type: row.event_type,
    points: row.points,
    eligible_points: row.eligible_points,
    status: row.status,
    reason: row.reason,
    ts: row.ts,
    broadcast_id: row.broadcast_id || ""
  };
  const inboxDoc = {
    event_id: row.event_id,
    event_type: row.event_type,
    actor_user_id: row.user_id,
    target_type: row.target_type || "",
    target_id: row.target_id || "",
    broadcast_id: row.broadcast_id || "",
    parent_event_id: row.parent_event_id || "",
    creator_uid: row.creator_uid || "",
    session_id: row.session_id || "",
    text: String(row.text || "").slice(0, 2e3),
    ts: row.ts,
    client_ts: row.client_ts || row.ts
  };
  const metricDoc = {
    uid: row.user_id,
    name: "economy." + row.event_type,
    event_type: row.event_type,
    event_id: row.event_id,
    target_id: row.target_id || "",
    broadcast_id: row.broadcast_id || "",
    at: row.ts
  };
  memory.events.set(row.event_id, eventDoc);
  applyLedger(ledgerDoc);
  paths.push("memory");
  if (saToken) {
    const a = await fsFetch(env, saToken, "PATCH", "/engagementEvents/" + encodeURIComponent(row.event_id), toFsFields(eventDoc));
    const b = await fsFetch(env, saToken, "PATCH", "/contributionLedger/" + encodeURIComponent(row.ledger_id), toFsFields(ledgerDoc));
    await fsIncrement(env, saToken, "/contributionProfiles/" + encodeURIComponent(row.user_id), {
      total_points: Number(row.points) || 0,
      eligible_points: Number(row.eligible_points) || 0,
      events: 1
    }, { user_id: row.user_id, updated_at: row.ts });
    if (a.ok || b.ok) paths.push("sa");
  }
  if (userToken) {
    const inbox = await fsFetch(
      env,
      userToken,
      "PATCH",
      "/economyInbox/" + encodeURIComponent(row.event_id) + "?currentDocument.exists=false",
      toFsFields(inboxDoc)
    );
    if (!inbox.ok) {
      await fsFetch(env, userToken, "PATCH", "/economyInbox/" + encodeURIComponent(row.event_id), toFsFields(inboxDoc));
    }
    const met = await fsFetch(
      env,
      userToken,
      "PATCH",
      "/metrics/" + encodeURIComponent(row.event_id),
      toFsFields(metricDoc)
    );
    if (inbox.ok || met.ok) paths.push("user-token");
  }
  return paths;
}
async function readFlags(env, saToken, userToken) {
  const tryRead = async (token) => {
    if (!token) return null;
    const r = await fsFetch(env, token, "GET", "/economyConfig/flags");
    if (!r.ok || !r.data || !r.data.fields) return null;
    return fromFsDoc(r.data);
  };
  const fromSa = await tryRead(saToken);
  if (fromSa) return { flags: { ...DEFAULT_FLAGS, ...fromSa }, source: "firestore-sa" };
  const fromUser = await tryRead(userToken);
  if (fromUser) return { flags: { ...DEFAULT_FLAGS, ...fromUser }, source: "firestore-user" };
  return { flags: { ...DEFAULT_FLAGS, ...memory.flags }, source: "defaults" };
}
async function writeFlags(env, saToken, userToken, flags) {
  memory.flags = { ...DEFAULT_FLAGS, ...flags };
  const doc = toFsFields(memory.flags);
  if (saToken) {
    const r = await fsFetch(env, saToken, "PATCH", "/economyConfig/flags", doc);
    if (r.ok) return "sa";
  }
  if (userToken) {
    const r = await fsFetch(env, userToken, "PATCH", "/economyConfig/flags", doc);
    if (r.ok) return "user-token";
  }
  return "memory";
}
function hasSaConfigured(env) {
  const raw = env.GOOGLE_SERVICE_ACCOUNT || env.FIREBASE_SERVICE_ACCOUNT || env.SERVICE_ACCOUNT_JSON || env.GOOGLE_SA_JSON || "";
  return !!raw;
}
function persistMode(saOk, paths) {
  if (saOk || paths && paths.indexOf("sa") >= 0) return "firestore-sa";
  if (paths && paths.indexOf("user-token") >= 0) return "user-token";
  return "memory";
}
async function requireUser(env, request) {
  const token = bearer(request);
  if (!token) return { error: json({ ok: false, error: "Missing auth token" }, 401) };
  const user = await verifyIdToken(env, token);
  if (!user) return { error: json({ ok: false, error: "Invalid auth token" }, 401) };
  return { user, token };
}
function isOperatorUser(env, user) {
  if (!user) return false;
  if (user.uid === operatorUid(env)) return true;
  const extra = String(env.OPERATOR_UIDS || "");
  if (extra && extra.split(/[,\s]+/).indexOf(user.uid) >= 0) return true;
  const raw = user.customAttributes || "";
  if (raw) {
    try {
      const c = typeof raw === "string" ? JSON.parse(raw) : raw;
      if (c && c.operator === true) return true;
    } catch {
    }
  }
  const mail = String(user.email || "").trim().toLowerCase();
  if (mail === "magjoed@gmail.com" && user.emailVerified === true) return true;
  return false;
}
var HANDLE_RESERVED_MSG = "This handle is reserved and cannot be claimed.";
var HANDLE_TAKEN_MSG = "That handle is taken \u2014 try another.";
var HANDLE_FORMAT_MSG = "Choose a handle with at least 3 letters (a\u2013z, 0\u20139, _).";
var SEED_RESERVED = [
  { handle: "naluno", category: "official", reason: "Brand" },
  { handle: "getnaluno", category: "official", reason: "Brand" },
  { handle: "nalunoapp", category: "official", reason: "Brand" },
  { handle: "nalunohq", category: "official", reason: "Brand" },
  { handle: "nalunoofficial", category: "official", reason: "Brand" },
  { handle: "nalunoteam", category: "official", reason: "Brand" },
  { handle: "nalunofounder", category: "official", reason: "Brand" },
  { handle: "nalunocreators", category: "official", reason: "Brand" },
  { handle: "nalunoinvest", category: "official", reason: "Brand" },
  { handle: "nalunosupport", category: "support", reason: "Support" },
  { handle: "nalunohelp", category: "support", reason: "Support" },
  { handle: "nalunonews", category: "support", reason: "Support" },
  { handle: "admin", category: "system", reason: "System" },
  { handle: "administrator", category: "system", reason: "System" },
  { handle: "nalunoadmin", category: "system", reason: "System" },
  { handle: "nalunosystem", category: "system", reason: "System" },
  { handle: "nalunosecurity", category: "system", reason: "System" },
  { handle: "nalunomoderator", category: "system", reason: "System" },
  { handle: "nalunostaff", category: "system", reason: "System" },
  { handle: "official", category: "system", reason: "System" },
  { handle: "support", category: "support", reason: "Support" },
  { handle: "security", category: "system", reason: "System" },
  { handle: "system", category: "system", reason: "System" },
  { handle: "moderator", category: "system", reason: "System" }
];
function normHandle(raw) {
  return String(raw || "").trim().replace(/^@+/, "").toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 24);
}
function handleCore(raw) {
  return normHandle(raw).replace(/_/g, "");
}
function handleFormatOk(h) {
  return /^[a-z0-9_]{3,24}$/.test(h);
}
function foldLookalikes(s) {
  return String(s || "").toLowerCase().replace(/0/g, "o").replace(/1/g, "l").replace(/i/g, "l").replace(/3/g, "e").replace(/5/g, "s").replace(/8/g, "b").replace(/_/g, "");
}
function levenshtein(a, b) {
  a = String(a || "");
  b = String(b || "");
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
function matchReserved(raw, list) {
  const h = normHandle(raw);
  const core = handleCore(h);
  for (let i = 0; i < (list || []).length; i++) {
    const row = list[i] || {};
    const rh = normHandle(row.handle || row.id || "");
    if (!rh) continue;
    if (h === rh || core === handleCore(rh) || core === String(row.core || "")) return row;
  }
  return null;
}
function similarityAgainst(raw, list) {
  if (matchReserved(raw, list)) return null;
  const h = normHandle(raw);
  const core = handleCore(h);
  const folded = foldLookalikes(h);
  if (core.length < 3) return null;
  let best = null;
  for (let i = 0; i < (list || []).length; i++) {
    const row = list[i] || {};
    const rh = normHandle(row.handle || row.id || "");
    if (!rh) continue;
    const rc = handleCore(rh);
    const rf = foldLookalikes(rh);
    if (h === rh || core === rc) continue;
    let reason = "";
    let score = 0;
    if (folded === rf) {
      reason = "lookalike characters";
      score = 90;
    } else if (core.indexOf(rc) === 0 && rc.length >= 5 && /^[0-9]+$/.test(core.slice(rc.length))) {
      reason = "protected name plus numbers";
      score = 80;
    } else if (rc.length >= 5 && core.indexOf(rc) >= 0) {
      reason = "contains a protected name";
      score = 75;
    } else if (rf.length >= 5 && folded.indexOf(rf) >= 0) {
      reason = "contains a protected name";
      score = 72;
    } else if (rc.length >= 5 && levenshtein(core, rc) === 1) {
      reason = "one character from a protected name";
      score = 70;
    } else if (rf.length >= 5 && levenshtein(folded, rf) === 1) {
      reason = "one character from a protected name";
      score = 68;
    }
    if (reason && (!best || score > best.score)) {
      best = { handle: h, reserved: rh, category: row.category || "other", reason, score };
    }
  }
  return best;
}
function reservedList() {
  return Array.from(memory.reserved.values());
}
function canonicalReserved() {
  return reservedList().filter((r) => !r.aliasOf).sort((a, b) => String(a.handle || "").localeCompare(String(b.handle || "")));
}
function rememberReserved(row) {
  if (!row || !row.handle) return;
  memory.reserved.set(row.handle, row);
}
function rememberFlag(row) {
  if (!row) return;
  const id = row.id || "f_" + String(row.handle || "") + "_" + String(row.uid || "").slice(0, 8);
  row.id = id;
  memory.handleFlags.set(id, row);
}
async function fsGetDoc(env, token, path) {
  const r = token ? await fsFetch(env, token, "GET", path) : await fsFetchPublic(env, "GET", path);
  if (!r.ok) return null;
  return fromFsDoc(r.data);
}
async function fsPutDoc(env, token, path, obj) {
  if (!token) return { ok: false };
  const keys = Object.keys(obj || {}).filter((k) => obj[k] !== void 0);
  if (!keys.length) return { ok: false };
  const mask = keys.map((k) => "updateMask.fieldPaths=" + encodeURIComponent(k)).join("&");
  const suffix = path.includes("?") ? "&" : "?";
  return fsFetch(env, token, "PATCH", path + suffix + mask, toFsFields(obj));
}
async function loadReservedFromFs(env, token) {
  const t = token;
  if (!t && !apiKey(env)) return reservedList();
  const r = t ? await fsFetch(env, t, "GET", "/reservedHandles?pageSize=400") : await fsFetchPublic(env, "GET", "/reservedHandles?pageSize=400");
  if (r.ok && r.data) {
    const seen = /* @__PURE__ */ new Set();
    (r.data.documents || []).forEach((doc) => {
      const row = fromFsDoc(doc);
      if (!row || !row.handle) return;
      row._fs = true;
      seen.add(row.handle);
      rememberReserved(row);
    });
    if (!r.data.nextPageToken) {
      Array.from(memory.reserved.keys()).forEach((h) => {
        const row = memory.reserved.get(h);
        if (row && row._fs && !seen.has(h)) memory.reserved.delete(h);
      });
    }
  }
  return reservedList();
}
function reservedPayload(row, actor, now) {
  const handle = normHandle(row.handle);
  const core = handleCore(handle);
  return {
    handle,
    core,
    category: ["official", "system", "support", "other"].indexOf(row.category) >= 0 ? row.category : "other",
    reason: String(row.reason || "").slice(0, 240),
    status: "reserved",
    holderUid: String(row.holderUid || "").slice(0, 80),
    createdAt: Number(row.createdAt) || now,
    createdBy: row.createdBy || actor || "",
    updatedAt: now,
    updatedBy: actor || ""
  };
}
async function writeReservedPair(env, token, row) {
  const handle = row.handle;
  const core = row.core || handleCore(handle);
  rememberReserved(row);
  if (!token) return;
  await fsPutDoc(env, token, "/reservedHandles/" + encodeURIComponent(handle), row);
  if (core) {
    await fsPutDoc(env, token, "/reservedCores/" + encodeURIComponent(core), {
      handle,
      core,
      holderUid: row.holderUid || "",
      category: row.category
    });
  }
  if (core && core !== handle) {
    const alias = Object.assign({}, row, { handle: core, aliasOf: handle });
    await fsPutDoc(env, token, "/reservedHandles/" + encodeURIComponent(core), alias);
    rememberReserved(alias);
  }
}
async function deleteReservedPair(env, token, handle) {
  const h = normHandle(handle);
  const row = memory.reserved.get(h);
  const core = row && row.core || handleCore(h);
  memory.reserved.delete(h);
  if (core && core !== h) memory.reserved.delete(core);
  if (!token) return;
  await fsFetch(env, token, "DELETE", "/reservedHandles/" + encodeURIComponent(h));
  if (core) {
    await fsFetch(env, token, "DELETE", "/reservedCores/" + encodeURIComponent(core));
    if (core !== h) await fsFetch(env, token, "DELETE", "/reservedHandles/" + encodeURIComponent(core));
  }
}
async function writeAdminAudit(env, token, row) {
  const rec = Object.assign({ created_at: Date.now() }, row);
  memory.audit.unshift(rec);
  if (token) {
    await fsFetch(env, token, "POST", "/adminAudit", toFsFields(rec));
  }
}
async function loadHandleFlagsFromFs(env, token) {
  if (!token) return Array.from(memory.handleFlags.values());
  const r = await fsFetch(env, token, "GET", "/handleFlags?pageSize=200");
  if (r.ok && r.data && r.data.documents) {
    r.data.documents.forEach((doc) => rememberFlag(fromFsDoc(doc)));
  }
  return Array.from(memory.handleFlags.values());
}
async function flagHandle(env, token, flag) {
  const id = flag.id || (flag.kind === "reserved-block" ? "b_" : "f_") + String(flag.handle || "") + "_" + String(flag.uid || "").slice(0, 8);
  const row = Object.assign({ id, status: "open", createdAt: Date.now() }, flag);
  rememberFlag(row);
  if (token) await fsPutDoc(env, token, "/handleFlags/" + encodeURIComponent(id), row);
  return row;
}
async function seedReserved(env, token, actor) {
  const now = Date.now();
  await loadReservedFromFs(env, token);
  const owner = await fsGetDoc(env, token, "/handles/naluno");
  const holder = owner && owner.uid || "";
  let wrote = 0;
  for (let i = 0; i < SEED_RESERVED.length; i++) {
    const seed = SEED_RESERVED[i];
    const existing = memory.reserved.get(seed.handle);
    if (existing && existing.handle) {
      if (seed.handle === "naluno" && holder && !existing.holderUid) {
        const next = Object.assign({}, existing, { holderUid: holder, updatedAt: now, updatedBy: actor || "seed" });
        await writeReservedPair(env, token, next);
        wrote += 1;
      }
      continue;
    }
    const row = reservedPayload(Object.assign({}, seed, {
      holderUid: seed.handle === "naluno" ? holder : "",
      createdBy: actor || "seed"
    }), actor || "seed", now);
    await writeReservedPair(env, token, row);
    wrote += 1;
  }
  return { ok: true, wrote, total: memory.reserved.size, nalunoHolder: holder };
}
async function handleCheck(env, url, saToken) {
  const h = normHandle(url.searchParams.get("h") || url.searchParams.get("handle") || "");
  if (!handleFormatOk(h)) {
    return json({ ok: false, handle: h, error: HANDLE_FORMAT_MSG, code: "format" });
  }
  await loadReservedFromFs(env, saToken);
  if (!memory.reserved.size) {
    SEED_RESERVED.forEach((s) => rememberReserved(reservedPayload(s, "seed", Date.now())));
  }
  const list = reservedList();
  const hit = matchReserved(h, list);
  if (hit) {
    return json({
      ok: false,
      handle: h,
      reserved: true,
      error: HANDLE_RESERVED_MSG,
      code: "reserved"
    });
  }
  const claimed = await fsGetDoc(env, saToken, "/handles/" + encodeURIComponent(h));
  const taken = !!(claimed && claimed.uid);
  if (taken) {
    return json({ ok: false, handle: h, taken: true, error: HANDLE_TAKEN_MSG, code: "taken" });
  }
  return json({
    ok: true,
    handle: h,
    available: true
  });
}
async function handleClaim(env, user, userToken, saToken, body) {
  const h = normHandle(body && body.handle);
  if (!handleFormatOk(h)) return json({ ok: false, error: HANDLE_FORMAT_MSG, code: "format" }, 400);
  const token = saToken || userToken;
  await loadReservedFromFs(env, token);
  if (!memory.reserved.size) {
    SEED_RESERVED.forEach((s) => rememberReserved(reservedPayload(s, "seed", Date.now())));
  }
  const list = reservedList();
  const hit = matchReserved(h, list);
  if (hit && String(hit.holderUid || "") !== user.uid) {
    await flagHandle(env, token, {
      kind: "reserved-block",
      handle: h,
      uid: user.uid,
      reserved: hit.handle || h,
      reason: "reserved",
      score: 100,
      status: "open"
    });
    return json({ ok: false, error: HANDLE_RESERVED_MSG, code: "reserved", reserved: true }, 409);
  }
  const existing = memory.handles.get(h) || await fsGetDoc(env, token, "/handles/" + encodeURIComponent(h));
  if (existing && existing.uid && existing.uid !== user.uid) {
    return json({ ok: false, error: HANDLE_TAKEN_MSG, code: "taken", taken: true }, 409);
  }
  const doc = { uid: user.uid, claimedAt: Date.now() };
  memory.handles.set(h, doc);
  if (token) {
    const path = "/handles/" + encodeURIComponent(h);
    if (existing && existing.uid === user.uid) {
      await fsPutDoc(env, token, path, doc);
    } else {
      const wrote = await fsFetch(env, token, "PATCH", path + "?currentDocument.exists=false", toFsFields(doc));
      if (!wrote.ok) {
        const again = await fsGetDoc(env, token, path);
        if (again && again.uid && again.uid !== user.uid) {
          memory.handles.set(h, again);
          return json({ ok: false, error: HANDLE_TAKEN_MSG, code: "taken", taken: true }, 409);
        }
        if (!again || !again.uid) await fsPutDoc(env, token, path, doc);
      }
    }
  }
  const similar = similarityAgainst(h, list);
  if (similar) {
    await flagHandle(env, token, {
      kind: "similar",
      handle: h,
      uid: user.uid,
      reserved: similar.reserved,
      reason: similar.reason,
      score: similar.score,
      status: "open"
    });
  }
  return json({ ok: true, handle: h, official: !!(hit && hit.holderUid === user.uid) });
}
function reportIsOpen(r) {
  if (!r) return false;
  if (r.resolvedAt || r.decided_at || r.resolved_at || r.decidedAt) return false;
  const st = String(r.status || "").trim().toUpperCase().replace(/[_-]+/g, " ");
  if (st === "ACTIONED" || st === "DISMISSED" || st === "CLOSED" || st === "DONE" || st === "RESOLVED" || st === "REJECTED" || st === "TAKEN DOWN") {
    return false;
  }
  if (st && st !== "OPEN" && st !== "NEW" && st !== "UNDER REVIEW" && st !== "PENDING") {
    return false;
  }
  return true;
}
async function hideBroadcastSexual(env, saToken, userToken, broadcastId) {
  const id = String(broadcastId || "").slice(0, 80);
  if (!id) return { ok: false };
  const token = saToken || userToken;
  const patch = {
    hidden: true,
    listed: false,
    held: false,
    hiddenReason: "sexual",
    hiddenAt: Date.now(),
    hiddenBy: "report",
    live: false
  };
  if (saToken) await fsPutDoc(env, saToken, "/broadcasts/" + encodeURIComponent(id), patch);
  const row = await fsGetDoc(env, token, "/broadcasts/" + encodeURIComponent(id));
  const uid = row && row.creatorUid;
  let restricted = false;
  if (uid && saToken) {
    const profile = await fsGetDoc(env, saToken, "/users/" + encodeURIComponent(uid));
    const n = Number(profile && profile.sexualReports || 0) + 1;
    const extra = { sexualReports: n, updatedAt: Date.now() };
    if (n >= 3) {
      extra.restricted = true;
      extra.restrictedReason = "Repeated sexual-content reports";
      extra.restrictedAt = Date.now();
      restricted = true;
    }
    await fsPutDoc(env, saToken, "/users/" + encodeURIComponent(uid), extra);
  }
  return { ok: true, id, restricted };
}
async function hideSignalReported(env, saToken, uid, signalId, mode, code) {
  const id = String(signalId || "").slice(0, 120);
  const who = String(uid || "").slice(0, 128);
  if (!saToken || !id || !who) return false;
  const now = Date.now();
  const patch = mode === "hidden" ? { hidden: true, held: false, reviewedAt: now, reviewedBy: "report" } : { held: true, heldReason: ("reported-" + String(code || "urgent")).slice(0, 80), hidden: false, reviewedAt: now, reviewedBy: "report" };
  const wrote = await fsPutDoc(env, saToken, "/users/" + encodeURIComponent(who) + "/signal/" + encodeURIComponent(id), patch);
  if (!wrote || !wrote.ok) throw new Error("signal not updated");
  await fsPutDoc(env, saToken, "/signals/" + encodeURIComponent(id), patch);
  if (mode === "hidden") {
    const profile = await fsGetDoc(env, saToken, "/users/" + encodeURIComponent(who));
    const n = Number(profile && profile.sexualReports || 0) + 1;
    const extra = { sexualReports: n, updatedAt: now };
    if (n >= 3) {
      extra.restricted = true;
      extra.restrictedReason = "Repeated sexual-content reports";
      extra.restrictedAt = now;
    }
    await fsPutDoc(env, saToken, "/users/" + encodeURIComponent(who), extra);
  }
  return true;
}
function hashList(env) {
  const raw = env && (env.SAFETY_HASHES || env.SAFETY_HASH_LIST) || "";
  if (!raw) return [];
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
async function persistSafetyCase(env, saToken, userToken, row) {
  memory.safetyCases.set(row.case_id, row);
  const token = saToken || userToken;
  if (!token) return "memory";
  const wrote = await fsPutDoc(env, token, "/safetyCases/" + encodeURIComponent(row.case_id), row);
  return wrote && wrote.ok ? saToken ? "firestore-sa" : "user-token" : "memory";
}
async function persistSafetyAudit(env, saToken, userToken, row) {
  assertAuditAppend(memory.safetyAudit, row);
  memory.safetyAudit.unshift(row);
  if (memory.safetyAudit.length > 400) memory.safetyAudit.length = 400;
  const token = saToken || userToken;
  if (!token) return "memory";
  const wrote = await fsPutDoc(env, token, "/safetyAudit/" + encodeURIComponent(row.audit_id), row);
  return wrote && wrote.ok ? saToken ? "firestore-sa" : "user-token" : "memory";
}
function safetyHold(decision) {
  return decision === "REVIEW" || decision === "REMOVE" || decision === "ESCALATE" || decision === "AGE_RESTRICT" || decision === "REGION_RESTRICT";
}
async function openHeldCase(env, saToken, userToken, fields, why, detectedBy) {
  const opened = buildCase(fields);
  await persistSafetyCase(env, saToken, userToken, opened);
  await persistSafetyAudit(env, saToken, userToken, buildAudit({
    case_id: opened.case_id,
    who: fields.reporter_id || "system",
    what: detectedBy === "report" ? "report-opened" : "held-public",
    why: String(why || opened.priority).slice(0, 180),
    detected_by: detectedBy || "classifier",
    human_reviewed: false,
    action_taken: opened.priority === "URGENT" ? "urgent queue" : "case opened"
  }));
  return opened;
}
function safetyQueue() {
  return Array.from(memory.safetyCases.values()).sort(function(a, b) {
    const rank = { URGENT: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
    return (rank[a.priority] ?? 4) - (rank[b.priority] ?? 4) || (b.created_at || 0) - (a.created_at || 0);
  });
}
async function placeBroadcast(env, user, userToken, saToken, body) {
  const id = String(body && body.broadcast_id || "").slice(0, 80);
  if (!id) return json({ ok: false, error: "broadcast_id required" }, 400);
  const token = saToken || userToken;
  const row = await fsGetDoc(env, token, "/broadcasts/" + encodeURIComponent(id));
  if (!row) return json({ ok: false, error: "missing" }, 404);
  if (row.creatorUid && row.creatorUid !== user.uid && !isOperatorUser(env, user)) {
    return json({ ok: false, error: "not yours" }, 403);
  }
  const profile = await fsGetDoc(env, token, "/users/" + encodeURIComponent(row.creatorUid || user.uid));
  const trusted = !!(profile && profile.trustedPublisher) && !(profile && profile.restricted) && !(profile && profile.suspended);
  let judged = judgeScreenPayload(body && body.screen, { title: row.title || "" });
  const hasPicture = !!(row.mediaUrl || row.thumbUrl || Array.isArray(row.chapters) && row.chapters.some((c) => c && c.mediaUrl));
  if (hasPicture && !judged.hasScreen) {
    let inherited = false;
    if (row.repostOf) {
      const orig = await fsGetDoc(env, token, "/broadcasts/" + encodeURIComponent(String(row.repostOf).slice(0, 80)));
      inherited = !!(orig && orig.listed !== false && !orig.held && !orig.hidden && orig.screenDecision !== "block" && orig.screenDecision !== "hold");
    }
    if (!inherited) judged = { decision: "hold", score: 0, hasScreen: true, reason: "unscreened", frames: 0 };
  }
  const safety = scorePublicText(
    [row.title, row.caption, body && body.caption, body && body.title].filter(Boolean).join(" \n "),
    { surface: "broadcast" }
  );
  const listing = listingFromScreen({
    trusted,
    hidden: !!row.hidden,
    hasScreen: judged.hasScreen,
    decision: judged.decision
  });
  const patch = Object.assign({}, listing, {
    screenDecision: judged.decision,
    screenScore: judged.score || 0,
    screenReason: judged.reason || "",
    screenVersion: 1,
    screenFrames: judged.frames || 0,
    safetyScore: safety.score,
    safetyDecision: safety.decision,
    safetyUrgent: !!safety.urgent,
    updatedAt: Date.now()
  });
  let safetyCase = "";
  if (safetyHold(safety.decision)) {
    patch.listed = false;
    patch.held = true;
    patch.heldReason = safety.decision === "AGE_RESTRICT" ? "age-review" : safety.urgent ? "safety-urgent" : "safety-review";
    const opened = await openHeldCase(env, saToken, userToken, {
      reporter_id: "system",
      reported_user_id: row.creatorUid || user.uid,
      content_id: id,
      content_type: "broadcast",
      surface: "broadcast",
      reason_code: safety.urgent ? "terrorism" : safety.decision === "AGE_RESTRICT" ? "sexual" : "dangerous",
      evidence_reference: "broadcast:" + id,
      result: safety,
      contents_collected: true
    }, safety.decision + " " + safety.score, "classifier");
    safetyCase = opened.case_id;
  }
  if (row.hidden) {
    patch.listed = false;
    patch.held = false;
    patch.hidden = true;
  }
  const writeTok = saToken || (patch.hidden || judged.decision === "block" ? userToken : "");
  if (writeTok) await fsPutDoc(env, writeTok, "/broadcasts/" + encodeURIComponent(id), patch);
  return json({
    ok: true,
    listed: !!patch.listed,
    held: !!patch.held,
    hidden: !!patch.hidden,
    heldReason: patch.heldReason || "",
    screen: judged.decision,
    screenScore: judged.score || 0,
    safety: safety.decision,
    safetyScore: safety.score,
    safetyUrgent: !!safety.urgent,
    safety_case: safetyCase,
    statement: statementFor(safety)
  });
}
async function saAccessTokenScoped(env, scope) {
  const sa = parseServiceAccount(
    env.GOOGLE_SERVICE_ACCOUNT || env.FIREBASE_SERVICE_ACCOUNT || env.SERVICE_ACCOUNT_JSON || env.GOOGLE_SA_JSON || ""
  );
  if (!sa) return "";
  try {
    const jwt = await signRs256Jwt(sa, { now: Math.floor(Date.now() / 1e3), scope });
    const res = await _fetch(sa.token_uri || "https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "grant_type=" + encodeURIComponent("urn:ietf:params:oauth:grant-type:jwt-bearer") + "&assertion=" + encodeURIComponent(jwt)
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.access_token) return "";
    return body.access_token;
  } catch {
    return "";
  }
}
async function stampOperatorClaim(env, uid) {
  if (!uid) return false;
  const token = await saAccessTokenScoped(
    env,
    "https://www.googleapis.com/auth/identitytoolkit"
  );
  if (!token) return false;
  try {
    const res = await _fetch(
      "https://identitytoolkit.googleapis.com/v1/projects/" + projectId(env) + "/accounts:update",
      {
        method: "POST",
        headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
        body: JSON.stringify({ localId: uid, customAttributes: JSON.stringify({ operator: true }) })
      }
    );
    return res.ok;
  } catch {
    return false;
  }
}
async function sha256Hex2(s) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return bytesToHex(new Uint8Array(buf));
}
function bytesToHex(bytes) {
  let hex = "";
  for (let i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, "0");
  return hex;
}
function bytesToB64(bytes) {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}
function b64ToBytes(s) {
  const bin = atob(String(s || ""));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
function timingEq(a, b) {
  const x = String(a || "");
  const y = String(b || "");
  if (x.length !== y.length) return false;
  let d = 0;
  for (let i = 0; i < x.length; i++) d |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return d === 0;
}
var PBKDF2_ITERS = WORKER_PBKDF2_MAX;
async function pbkdf2Bytes(password, saltBytes, iters) {
  const n = Number(iters) || PBKDF2_ITERS;
  if (n > WORKER_PBKDF2_MAX) return pbkdf2Sha256Js(String(password), saltBytes, n, 32);
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(String(password)), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: saltBytes, iterations: n },
    key,
    256
  );
  return new Uint8Array(bits);
}
async function hashPasswordV2(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2Bytes(password, salt, PBKDF2_ITERS);
  return {
    v: 2,
    algo: "pbkdf2-sha256",
    iters: PBKDF2_ITERS,
    salt: bytesToB64(salt),
    hash: bytesToHex(hash),
    updated_at: Date.now()
  };
}
async function passwordMatches(stored, uid, password, cheapOnly) {
  if (!stored || !password) return false;
  if (typeof stored === "string") {
    const sha = await sha256Hex2(uid + ":" + password);
    if (timingEq(sha, stored)) return true;
    if (cheapOnly) return false;
    const legacy = await pbkdf2Bytes(password, new TextEncoder().encode("naluno-admin-v1|" + uid), 12e4);
    return timingEq(bytesToB64(legacy), stored);
  }
  if (stored && stored.v === 2 && stored.salt && stored.hash) {
    const iters = Number(stored.iters) || 15e4;
    if (cheapOnly && iters > WORKER_PBKDF2_MAX) return false;
    const got = await pbkdf2Bytes(password, b64ToBytes(stored.salt), iters);
    return timingEq(bytesToHex(got), stored.hash);
  }
  if (stored && stored.hash) return passwordMatches(stored.hash, uid, password, cheapOnly);
  return false;
}
function recordFromDoc(doc) {
  if (!doc) return null;
  const inner = doc._consoleGate && typeof doc._consoleGate === "object" ? doc._consoleGate : doc;
  if (inner.v === 2 && inner.hash && inner.salt) return inner;
  if (inner.hash) return inner.v === 2 ? inner : String(inner.hash);
  return null;
}
function recKey(rec) {
  if (!rec) return "";
  if (typeof rec === "string") return "s:" + rec;
  return "v" + String(rec.v || "") + ":" + String(rec.salt || "") + ":" + String(rec.hash || "");
}
async function collectPasswordRecords(env, uid, saToken, userToken) {
  const out = [];
  const seen = /* @__PURE__ */ new Set();
  function add(rec) {
    if (!rec) return;
    const k = recKey(rec);
    if (!k || seen.has(k)) return;
    seen.add(k);
    out.push(rec);
  }
  if (uid && memory.passwords.has(uid)) add(memory.passwords.get(uid));
  if (!uid) return out;
  const attempts = [];
  if (saToken) {
    attempts.push([saToken, "/adminCredentials/" + encodeURIComponent(uid)]);
    attempts.push([saToken, "/adminConsole/" + encodeURIComponent(uid)]);
  }
  if (userToken) {
    attempts.push([userToken, "/users/" + encodeURIComponent(uid) + "/vault/main"]);
    attempts.push([userToken, "/adminConsole/" + encodeURIComponent(uid)]);
    attempts.push([userToken, "/users/" + encodeURIComponent(uid) + "/consoleGate/main"]);
  }
  for (let i = 0; i < attempts.length; i++) {
    try {
      const r = await fsFetch(env, attempts[i][0], "GET", attempts[i][1]);
      if (!r.ok) continue;
      add(recordFromDoc(fromFsDoc(r.data)));
    } catch {
    }
  }
  return out;
}
var passwordMatchCache = /* @__PURE__ */ new Map();
async function matchPasswordRecord(recs, uid, password) {
  if (!password) return null;
  let pk = "";
  try {
    pk = await sha256Hex2("gate:" + uid + ":" + password);
  } catch {
    pk = "";
  }
  for (let i = 0; i < recs.length; i++) {
    if (pk && passwordMatchCache.get(pk) === recKey(recs[i])) return recs[i];
  }
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < recs.length; i++) {
      try {
        if (await passwordMatches(recs[i], uid, password, pass === 0)) {
          if (pk) {
            if (passwordMatchCache.size > 200) passwordMatchCache.clear();
            passwordMatchCache.set(pk, recKey(recs[i]));
          }
          return recs[i];
        }
      } catch {
      }
    }
  }
  return null;
}
async function persistPasswordRecord(env, uid, rec, saToken, userToken) {
  memory.passwords.set(uid, rec);
  const flat = typeof rec === "string" ? { hash: rec, v: 1, kind: "console-gate", updated_at: Date.now() } : Object.assign({}, rec, { kind: "console-gate", updated_at: rec.updated_at || Date.now() });
  if (saToken) {
    const r = await fsPutDoc(env, saToken, "/adminCredentials/" + encodeURIComponent(uid), flat);
    if (r && r.ok) return "firestore-sa";
  }
  if (userToken) {
    const v = await fsPutDoc(env, userToken, "/users/" + encodeURIComponent(uid) + "/vault/main", {
      _consoleGate: flat
    });
    if (v && v.ok) return "user-token";
    const a = await fsPutDoc(env, userToken, "/adminConsole/" + encodeURIComponent(uid), flat);
    if (a && a.ok) return "user-token";
  }
  return "memory";
}
async function handleAdmin(env, request, path, url, user, userToken, saToken) {
  if (!isOperatorUser(env, user)) return json({ ok: false, error: "not an operator" }, 403);
  const adminPass = request.headers.get("X-Naluno-Admin") || "";
  const recs = await collectPasswordRecords(env, user.uid, saToken, userToken);
  const stored = recs[0] || null;
  const openPath = path === "/v1/admin/status" || path === "/v1/admin/password" || path === "/v1/admin/unlock";
  if (!openPath && stored) {
    if (!adminPass) return json({ ok: false, error: "console password required" }, 401);
    if (!await matchPasswordRecord(recs, user.uid, adminPass)) {
      return json({ ok: false, error: "console password not accepted" }, 401);
    }
  }
  const listCol = async (name, limit) => {
    const token = saToken || userToken;
    const r = await fsFetch(env, token, "GET", "/" + name + "?pageSize=" + (limit || 200));
    if (!r.ok) return [];
    return (r.data.documents || []).map(fromFsDoc);
  };
  if (path === "/v1/admin/status" && request.method === "GET") {
    let stamped = false;
    if (adminPass && await matchPasswordRecord(recs, user.uid, adminPass)) {
      stamped = await stampOperatorClaim(env, user.uid);
    }
    return json({
      ok: true,
      operator: true,
      uid: user.uid,
      hasPassword: recs.length > 0,
      persist: saToken ? "firestore-sa" : "user-token",
      version: VERSION,
      claim: stamped ? "operator" : ""
    });
  }
  if (path === "/v1/admin/billing" && request.method === "GET") {
    if (!stored) return json({ ok: false, error: "console password required" }, 401);
    const billing = await loadBilling(env, saToken);
    return json({ ok: true, billing });
  }
  if (path === "/v1/admin/safety" && request.method === "GET") {
    const q = (url.searchParams.get("q") || "").toLowerCase();
    const status = (url.searchParams.get("status") || "").toLowerCase();
    const priority = (url.searchParams.get("priority") || "").toUpperCase();
    const from = Number(url.searchParams.get("from") || 0);
    const to = Number(url.searchParams.get("to") || 0);
    const all = safetyQueue();
    let rows = all;
    if (q) {
      rows = rows.filter(function(c) {
        return [c.case_id, c.content_id, c.reported_user_id, c.reporter_id, c.reason_code, c.priority, c.report_id, c.decision, c.review_status].join(" ").toLowerCase().includes(q);
      });
    }
    if (status === "open") rows = rows.filter(function(c) {
      return c.review_status !== "decided";
    });
    else if (status === "decided") rows = rows.filter(function(c) {
      return c.review_status === "decided";
    });
    else if (status === "review") rows = rows.filter(function(c) {
      return c.review_status === "review" || c.appeal_status === "open";
    });
    if (priority) rows = rows.filter(function(c) {
      return c.priority === priority;
    });
    if (from) rows = rows.filter(function(c) {
      return (c.created_at || 0) >= from;
    });
    if (to) rows = rows.filter(function(c) {
      return (c.created_at || 0) <= to;
    });
    const overview = safetyOverview(all, Array.from(memory.safetyAppeals.values()));
    return json({
      ok: true,
      version: VERSION,
      open: overview.open_cases,
      urgent: overview.urgent,
      overview,
      repeat_offenders: overview.repeat,
      cases: rows.slice(0, 120).map(scrubCase),
      behaviour: all.filter(function(c) {
        return c && (c.content_type === "account" || c.surface === "behaviour");
      }).slice(0, 40).map(scrubCase),
      audit: memory.safetyAudit.slice(0, 40).map(function(row) {
        const copy = Object.assign({}, row);
        delete copy.body;
        delete copy.message;
        delete copy.public_text;
        return copy;
      }),
      appeals: Array.from(memory.safetyAppeals.values()).slice(0, 40),
      private_read: false,
      auto_ban: false
    });
  }
  if (path === "/v1/admin/safety/decide" && request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    const id = String(body.case_id || "");
    const row = memory.safetyCases.get(id);
    if (!row) return json({ ok: false, error: "case not found" }, 404);
    let next;
    try {
      next = decideHuman(row, body.action, user.uid, body.why || "");
    } catch (e) {
      return json({ ok: false, error: e && e.message || "decision rejected" }, 400);
    }
    await persistSafetyCase(env, saToken, userToken, next);
    const audit = buildAudit({
      case_id: id,
      who: user.uid,
      what: "human-decision",
      why: body.why || next.decision,
      detected_by: "human",
      human_reviewed: true,
      action_taken: next.decision
    });
    await persistSafetyAudit(env, saToken, userToken, audit);
    const token = saToken || userToken;
    const bid = row.content_id;
    const isBroadcast = row.content_type === "broadcast" || row.surface === "broadcast";
    if (token && bid && isBroadcast) {
      if (next.decision === "REMOVE") {
        await fsPutDoc(env, token, "/broadcasts/" + encodeURIComponent(bid), {
          hidden: true,
          listed: false,
          held: false,
          hiddenReason: "safety",
          heldReason: "",
          updatedAt: Date.now()
        });
      } else if (next.decision === "ALLOW" || next.decision === "RESTORE" || next.decision === "DISMISS") {
        await fsPutDoc(env, token, "/broadcasts/" + encodeURIComponent(bid), {
          hidden: false,
          listed: true,
          held: false,
          heldReason: "",
          updatedAt: Date.now()
        });
      } else if (next.decision === "AGE_RESTRICT" || next.decision === "REGION_RESTRICT" || next.decision === "RESTRICT" || next.decision === "ESCALATE") {
        await fsPutDoc(env, token, "/broadcasts/" + encodeURIComponent(bid), {
          hidden: false,
          listed: false,
          held: true,
          heldReason: next.decision === "AGE_RESTRICT" ? "age-review" : "safety-review",
          updatedAt: Date.now()
        });
      }
    }
    const who = row.reported_user_id;
    if (token && who && (next.decision === "SUSPEND" || next.decision === "RESTRICT")) {
      await fsPutDoc(env, token, "/users/" + encodeURIComponent(who), {
        suspended: next.decision === "SUSPEND",
        restricted: true,
        permanentBan: false,
        restrictedReason: String(body.why || "safety review").slice(0, 180),
        restrictedAt: Date.now()
      });
    }
    if (token && who && row.content_type === "account" && (next.decision === "ALLOW" || next.decision === "RESTORE" || next.decision === "DISMISS")) {
      await fsPutDoc(env, token, "/users/" + encodeURIComponent(who), {
        suspended: false,
        restricted: false,
        permanentBan: false,
        restrictedReason: ""
      });
    }
    return json({ ok: true, case: scrubCase(next), audit_id: audit.audit_id, auto_ban: false, permanent_ban: false });
  }
  if (path === "/v1/admin/unlock" && request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    const pass = String(body.password || adminPass || "").trim();
    if (!recs.length) return json({ ok: true, setup: true, hasPassword: false });
    const matched = await matchPasswordRecord(recs, user.uid, pass);
    if (!matched) {
      return json({ ok: false, error: "console password not accepted" }, 401);
    }
    memory.passwords.set(user.uid, matched);
    return json({ ok: true, hasPassword: true });
  }
  if (path === "/v1/admin/password" && request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    const next = String(body.next_password || "").trim();
    if (next.length < 8) return json({ ok: false, error: "Use at least 8 characters" }, 400);
    if (recs.length) {
      const current = String(body.current_password || adminPass || "").trim();
      if (!current || !await matchPasswordRecord(recs, user.uid, current)) {
        return json({ ok: false, error: "current password is wrong" }, 401);
      }
    }
    const hashed = await hashPasswordV2(next);
    const where = await persistPasswordRecord(env, user.uid, hashed, saToken, userToken);
    memory.audit.unshift({ action: "password-set", actor: user.uid, ts: Date.now() });
    return json({ ok: true, persist: where });
  }
  if (path === "/v1/admin/flags" && request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    const next = { ...DEFAULT_FLAGS };
    Object.keys(DEFAULT_FLAGS).forEach((k) => {
      if (k in body) next[k] = !!body[k];
    });
    const where = await writeFlags(env, saToken, userToken, next);
    memory.audit.unshift({ action: "flags", actor: user.uid, ts: Date.now(), extra: next });
    return json({ ok: true, flags: next, persist: where });
  }
  if (path === "/v1/admin/overview" && request.method === "GET") {
    const flags = await readFlags(env, saToken, userToken);
    const ledger = await listCol("contributionLedger", 200);
    const merged = ledger.length ? ledger : Array.from(memory.ledger.values());
    const pending = merged.filter((r) => String(r.status || "").toUpperCase() === "PENDING_REVIEW");
    return json({
      ok: true,
      flags: flags.flags,
      rules_version: VERSION,
      ledger_rows_sampled: merged.length,
      counted: merged.filter((r) => String(r.status || "").toUpperCase() === "COUNTED").length,
      pending_review: pending.length,
      total_points_sampled: merged.reduce((a, r) => a + Number(r.points || 0), 0),
      total_eligible_sampled: merged.reduce((a, r) => a + Number(r.eligible_points || 0), 0),
      recent: merged.slice(0, 20),
      persist: saToken ? "firestore-sa" : "user-token"
    });
  }
  if (path === "/v1/admin/activity" && request.method === "GET") {
    const events = Array.from(memory.events.values());
    const ledger = Array.from(memory.ledger.values());
    return json({
      ok: true,
      broadcasts_today: 0,
      comments: events.filter((e) => e.event_type === "BROADCAST_COMMENT").length,
      replies: events.filter((e) => e.event_type === "COMMENT_REPLY").length,
      shares: events.filter((e) => e.event_type === "BROADCAST_SHARE").length,
      views: events.filter((e) => e.event_type === "WATCH_COMPLETION").length,
      contributors: new Set(ledger.map((r) => r.user_id)).size,
      contribution_points: ledger.reduce((a, r) => a + Number(r.points || 0), 0),
      flagged_activity: 0,
      pending_review: ledger.filter((r) => r.status === "PENDING_REVIEW").length
    });
  }
  if (path === "/v1/admin/users" && request.method === "GET") {
    const q = (url.searchParams.get("q") || "").toLowerCase();
    const users = await listCol("users", 400);
    const matched = q ? users.filter((u) => [u.name, u.handle, u.email, u.id, u.uid].join(" ").toLowerCase().includes(q)) : users;
    return json({
      ok: true,
      total: users.length,
      matched: matched.length,
      users: matched.slice(0, 80).map((u) => {
        const p = profileOf(u.id || u.uid || "");
        return {
          uid: u.id || u.uid,
          name: u.name || "",
          handle: u.handle || "",
          tier: "NEW",
          contribution_points: p.total_points,
          risk_flags: 0,
          suspended: !!u.suspended,
          restricted: !!u.restricted
        };
      })
    });
  }
  if (path === "/v1/admin/user" && request.method === "GET") {
    const uid = url.searchParams.get("uid") || "";
    const p = profileOf(uid);
    const events = Array.from(memory.events.values()).filter((e) => e.actor_user_id === uid);
    const ledger = Array.from(memory.ledger.values()).filter((r) => r.user_id === uid);
    return json({
      ok: true,
      uid,
      profile: { name: "", handle: "", email: "" },
      trust: { risk_flags: 0, removed_content: 0, suspended: false, restricted: false },
      contribution: { total_points: p.total_points, eligible_points: p.eligible_points },
      tier: "NEW",
      broadcasts: [],
      events,
      ledger
    });
  }
  if (path === "/v1/admin/user-action" && request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    const target = String(body.user_id || "");
    const action = String(body.action || "");
    const reason = String(body.reason || "").trim();
    if (!target || !action || !reason) return json({ ok: false, error: "user_id, action and reason are required" }, 400);
    const patch = { updatedAt: Date.now() };
    if (action === "suspend") {
      patch.suspended = true;
      patch.suspendedReason = reason;
    }
    if (action === "unsuspend") {
      patch.suspended = false;
      patch.suspendedReason = "";
    }
    if (action === "restrict") {
      patch.restricted = true;
      patch.restrictedReason = reason;
    }
    if (action === "unrestrict") {
      patch.restricted = false;
      patch.restrictedReason = "";
    }
    const token = saToken || userToken;
    await fsPutDoc(env, token, "/users/" + encodeURIComponent(target), patch);
    memory.audit.unshift({ action, target, reason, actor: user.uid, ts: Date.now() });
    if (userToken) {
      await fsFetch(env, userToken, "POST", "/adminAudit", toFsFields({
        action,
        target,
        reason,
        actor: user.uid,
        actorEmail: user.email,
        created_at: Date.now()
      }));
    }
    return json({ ok: true });
  }
  if (path === "/v1/admin/reports" && request.method === "GET") {
    const rows = await listCol("reports", 80);
    const all = rows.length ? rows : Array.from(memory.reports.values());
    const open = all.filter((r) => reportIsOpen(r));
    return json({ ok: true, open: open.length, actioned: all.length - open.length, reports: all, by_reason: {} });
  }
  if (path === "/v1/admin/report-action" && request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    const id = String(body.report_id || body.id || "");
    const decision = String(body.decision || body.status || "ACTIONED");
    const reason = String(body.reason || "").trim();
    if (!id || !reason) return json({ ok: false, error: "report and reason required" }, 400);
    const token = saToken || userToken;
    const now = Date.now();
    const patch = {
      status: decision,
      resolution: reason,
      resolvedAt: now,
      resolvedBy: user.uid,
      decided_at: now,
      decided_by: user.uid,
      note: reason
    };
    await fsPutDoc(env, token, "/reports/" + encodeURIComponent(id), patch);
    const prev = memory.reports.get(id) || { report_id: id };
    memory.reports.set(id, Object.assign({}, prev, patch));
    memory.audit.unshift({ action: "report-" + decision, target: id, reason, actor: user.uid, ts: now });
    return json({ ok: true });
  }
  if (path === "/v1/admin/contribution" && request.method === "GET") {
    const ledger = Array.from(memory.ledger.values());
    return json({
      ok: true,
      rows: ledger,
      total_points: ledger.reduce((a, r) => a + Number(r.points || 0), 0),
      contributors: new Set(ledger.map((r) => r.user_id)).size
    });
  }
  if (path === "/v1/admin/audit" && request.method === "GET") {
    const rows = await listCol("adminAudit", 80);
    return json({ ok: true, audit: rows.length ? rows : memory.audit });
  }
  if (path === "/v1/admin/handles/seed" && request.method === "POST") {
    const token = saToken || userToken;
    const result = await seedReserved(env, token, user.uid);
    await writeAdminAudit(env, token, {
      action: "handle-seed",
      target: "reservedHandles",
      reason: "seed",
      actor: user.uid,
      actorEmail: user.email || "",
      extra: { wrote: result.wrote, total: result.total }
    });
    return json(result);
  }
  if (path === "/v1/admin/handles" && request.method === "GET") {
    const token = saToken || userToken;
    await loadReservedFromFs(env, token);
    if (!memory.reserved.size) {
      SEED_RESERVED.forEach((s) => rememberReserved(reservedPayload(s, "seed", Date.now())));
    }
    const flags = await loadHandleFlagsFromFs(env, token);
    const naluno = memory.reserved.get("naluno") || {};
    return json({
      ok: true,
      reserved: canonicalReserved(),
      flags: flags.sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0)),
      nalunoHolder: naluno.holderUid || "",
      total: canonicalReserved().length
    });
  }
  if (path === "/v1/admin/handles" && request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    const token = saToken || userToken;
    await loadReservedFromFs(env, token);
    const h = normHandle(body.handle);
    if (!handleFormatOk(h)) return json({ ok: false, error: HANDLE_FORMAT_MSG }, 400);
    const prev = memory.reserved.get(h) || null;
    const now = Date.now();
    const row = reservedPayload({
      handle: h,
      category: body.category || prev && prev.category || "other",
      reason: body.reason != null ? body.reason : prev && prev.reason || "",
      holderUid: body.holderUid != null ? body.holderUid : prev && prev.holderUid || "",
      createdAt: prev && prev.createdAt || now,
      createdBy: prev && prev.createdBy || user.uid
    }, user.uid, now);
    await writeReservedPair(env, token, row);
    await writeAdminAudit(env, token, {
      action: prev ? "handle-update" : "handle-reserve",
      target: h,
      reason: row.reason,
      actor: user.uid,
      actorEmail: user.email || "",
      extra: {
        previous: prev ? { category: prev.category, reason: prev.reason, holderUid: prev.holderUid } : null,
        next: { category: row.category, reason: row.reason, holderUid: row.holderUid }
      }
    });
    return json({ ok: true, handle: h, reserved: row });
  }
  if (path === "/v1/admin/handles/remove" && request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    const token = saToken || userToken;
    await loadReservedFromFs(env, token);
    const h = normHandle(body.handle);
    if (!h) return json({ ok: false, error: "handle required" }, 400);
    const prev = memory.reserved.get(h) || null;
    await deleteReservedPair(env, token, h);
    await writeAdminAudit(env, token, {
      action: "handle-unreserve",
      target: h,
      reason: String(body.reason || ""),
      actor: user.uid,
      actorEmail: user.email || "",
      extra: { previous: prev }
    });
    return json({ ok: true, handle: h });
  }
  if (path === "/v1/admin/handles/flag" && request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    const token = saToken || userToken;
    const id = String(body.id || "");
    if (!id) return json({ ok: false, error: "id required" }, 400);
    await loadHandleFlagsFromFs(env, token);
    const prev = memory.handleFlags.get(id) || { id };
    const next = Object.assign({}, prev, {
      status: String(body.status || "reviewed").slice(0, 24),
      note: String(body.note || "").slice(0, 240),
      reviewedBy: user.uid,
      reviewedAt: Date.now()
    });
    rememberFlag(next);
    if (token) await fsPutDoc(env, token, "/handleFlags/" + encodeURIComponent(id), next);
    await writeAdminAudit(env, token, {
      action: "handle-flag",
      target: id,
      reason: next.status,
      actor: user.uid,
      actorEmail: user.email || "",
      extra: { previous: prev.status || "open", next: next.status, handle: next.handle || "" }
    });
    return json({ ok: true, flag: next });
  }
  if (path === "/v1/admin/broadcast-moderation" && request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    const token = saToken || userToken;
    const id = String(body.broadcast_id || body.id || "").slice(0, 80);
    const action = String(body.action || "");
    const reason = String(body.reason || "").trim();
    if (!id || !action) return json({ ok: false, error: "broadcast and action required" }, 400);
    const now = Date.now();
    let patch = { updatedAt: now };
    if (action === "let-out") {
      patch = { listed: true, held: false, heldReason: "", hidden: false, live: false, updatedAt: now };
    } else if (action === "take-down") {
      patch = {
        listed: false,
        held: false,
        hidden: true,
        hiddenReason: reason || "taken down",
        hiddenAt: now,
        hiddenBy: user.uid,
        live: false,
        updatedAt: now
      };
    } else if (action === "restore") {
      patch = { listed: true, held: false, hidden: false, hiddenReason: "", live: false, updatedAt: now };
    } else if (action === "trust-publisher") {
      const row = await fsGetDoc(env, token, "/broadcasts/" + encodeURIComponent(id));
      const uid = String(body.user_id || row && row.creatorUid || "");
      if (!uid) return json({ ok: false, error: "user_id required" }, 400);
      await fsPutDoc(env, token, "/users/" + encodeURIComponent(uid), {
        trustedPublisher: true,
        updatedAt: now
      });
      await writeAdminAudit(env, token, {
        action: "trust-publisher",
        target: uid,
        reason: reason || "trusted publisher",
        actor: user.uid,
        actorEmail: user.email || ""
      });
      return json({ ok: true, trustedPublisher: uid });
    } else {
      return json({ ok: false, error: "unknown action" }, 400);
    }
    await fsPutDoc(env, token, "/broadcasts/" + encodeURIComponent(id), patch);
    await writeAdminAudit(env, token, {
      action: "broadcast-" + action,
      target: id,
      reason: reason || action,
      actor: user.uid,
      actorEmail: user.email || "",
      extra: patch
    });
    return json({ ok: true, broadcast_id: id, action, patch });
  }
  if (path === "/v1/admin/recompute-profiles" && request.method === "POST") {
    if (!saToken) return json({ ok: false, error: "needs the service account" }, 503);
    const body = await request.json().catch(() => ({}));
    const apply = body.apply === true;
    const force = body.force === true;
    const totals = /* @__PURE__ */ new Map();
    let scanned = 0, pages = 0, cursor = body.cursor || null, done = true;
    while (pages < 60) {
      const q = {
        from: [{ collectionId: "contributionLedger" }],
        orderBy: [{ field: { fieldPath: "__name__" }, direction: "ASCENDING" }],
        limit: 500
      };
      if (cursor) q.startAt = { values: [{ referenceValue: cursor }], before: false };
      const r = await fsFetch(env, saToken, "POST", ":runQuery", { structuredQuery: q });
      const rows = (Array.isArray(r.data) ? r.data : []).filter((x) => x && x.document);
      if (!rows.length) break;
      rows.forEach((x) => {
        const d = fromFsDoc(x.document);
        const uid = String(d.user_id || "");
        if (!uid) return;
        const t = totals.get(uid) || { total_points: 0, eligible_points: 0, events: 0 };
        t.total_points += Number(d.points) || 0;
        t.eligible_points += Number(d.eligible_points) || 0;
        t.events += 1;
        totals.set(uid, t);
        scanned++;
      });
      cursor = rows[rows.length - 1].document.name;
      pages++;
      if (rows.length < 500) {
        done = true;
        break;
      }
      done = false;
    }
    const changes = [];
    for (const [uid, t] of totals) {
      let before = { total_points: 0, eligible_points: 0, events: 0 };
      let unreadable = false;
      try {
        const cur = await fsFetch(env, saToken, "GET", "/contributionProfiles/" + encodeURIComponent(uid));
        if (cur.ok) {
          const d = fromFsDoc(cur.data) || {};
          before = {
            total_points: Number(d.total_points) || 0,
            eligible_points: Number(d.eligible_points) || 0,
            events: Number(d.events) || 0
          };
        } else if (cur.status !== 404) {
          unreadable = true;
        }
      } catch {
        unreadable = true;
      }
      if (unreadable) {
        changes.push({ user_id: uid, before: null, after: t, gained: 0, action: "skipped-unreadable" });
        continue;
      }
      const lower = t.total_points < before.total_points || t.eligible_points < before.eligible_points;
      if (before.total_points === t.total_points && before.eligible_points === t.eligible_points) continue;
      const entry = {
        user_id: uid,
        before,
        after: t,
        gained: t.total_points - before.total_points,
        action: lower && !force ? "skipped-would-lower" : apply ? "written" : "would-write"
      };
      if (apply && !(lower && !force)) {
        await fsPutDoc(env, saToken, "/contributionProfiles/" + encodeURIComponent(uid), {
          user_id: uid,
          total_points: t.total_points,
          eligible_points: t.eligible_points,
          events: t.events,
          updated_at: Date.now(),
          repaired_at: Date.now()
        });
        memory.profiles.set(uid, Object.assign({ user_id: uid, updated_at: Date.now() }, t));
      }
      changes.push(entry);
    }
    if (apply) {
      try {
        await writeAdminAudit(env, saToken, {
          action: "RECOMPUTE_PROFILES",
          actor: user.uid,
          people_changed: changes.length,
          rows_scanned: scanned,
          reason: String(body.reason || "repair totals from the contribution ledger")
        });
      } catch {
      }
    }
    changes.sort((a, b) => b.gained - a.gained);
    return json({
      ok: true,
      dry_run: !apply,
      ledger_rows_scanned: scanned,
      people: totals.size,
      changed: changes.length,
      points_restored: changes.filter((c) => c.action !== "skipped-would-lower").reduce((a, c) => a + Math.max(0, c.gained), 0),
      skipped_would_lower: changes.filter((c) => c.action === "skipped-would-lower").length,
      skipped_unreadable: changes.filter((c) => c.action === "skipped-unreadable").length,
      more: !done,
      cursor: done ? null : cursor,
      changes: changes.slice(0, 200)
    });
  }
  if (path === "/v1/admin/simulate" && request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    const period = String(body.period_id || "");
    const pool = memory.pools.get(period);
    const amount = pool ? Number(pool.amount_minor) : 0;
    let eligible = [];
    if (saToken) {
      try {
        const q = await fsFetch(env, saToken, "POST", ":runQuery", { structuredQuery: {
          from: [{ collectionId: "contributionProfiles" }],
          limit: 2e3
        } });
        const rows = Array.isArray(q.data) ? q.data : [];
        eligible = rows.filter((r) => r && r.document).map((r) => {
          const d = fromFsDoc(r.document);
          return { user_id: d.user_id || "", eligible_points: Number(d.eligible_points) || 0 };
        }).filter((p) => p.eligible_points > 0);
      } catch {
        eligible = [];
      }
    }
    if (!eligible.length) {
      eligible = Array.from(memory.profiles.values()).filter((p) => p.eligible_points > 0);
    }
    const total = eligible.reduce((a, p) => a + p.eligible_points, 0) || 1;
    const projected = eligible.sort((a, b) => b.eligible_points - a.eligible_points).slice(0, Number(body.limit || 20)).map((p) => ({
      user_id: p.user_id,
      eligible: p.eligible_points,
      amount_minor: Math.floor(p.eligible_points / total * amount)
    }));
    const allocated = projected.reduce((a, r) => a + r.amount_minor, 0);
    return json({
      ok: true,
      pool_amount_minor: amount,
      currency: pool && pool.currency || "AED",
      eligible_contributors: eligible.length,
      total_eligible_contribution: total,
      allocated_minor: allocated,
      undistributed_minor: amount - allocated,
      projected
    });
  }
  if (path === "/v1/admin/pools" && request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    const period = String(body.period_id || "");
    if (!period) return json({ ok: false, error: "period_id required" }, 400);
    const row = {
      period_id: period,
      amount_minor: Math.round(Number(body.amount_minor) || 0),
      currency: body.currency || "AED",
      funding_source: body.funding_source || "UNSPECIFIED",
      status: "DRAFT",
      reason: String(body.reason || "")
    };
    memory.pools.set(period, row);
    memory.audit.unshift({ action: "pool-save", target: period, reason: row.reason, actor: user.uid, ts: Date.now() });
    return json({ ok: true });
  }
  if (path === "/v1/admin/broadcasts") {
    const rows = await listCol("broadcasts", 200);
    return json({ ok: true, broadcasts: rows });
  }
  if (path === "/v1/admin/trust") return json({ ok: true, flagged: 0, suspended: 0, restricted: 0 });
  if (path === "/v1/admin/value") return json({ ok: true, is_monetary: false, items: [] });
  if (path === "/v1/admin/support") return json({ ok: true, transactions: 0, succeeded: 0, gross_minor: 0 });
  if (path === "/v1/admin/rewards") return json({ ok: true, allocations: 0 });
  if (path === "/v1/admin/financial") {
    return json({
      ok: true,
      no_money_has_moved: true,
      currency: "AED",
      creator_support: { transactions: 0, succeeded: 0, gross_minor: 0, fees_minor: 0, net_minor: 0 },
      creator_earnings: { entries: 0, total_minor: 0 },
      community_rewards: { allocations: 0, total_minor: 0 },
      reward_pools: { count: memory.pools.size, committed_minor: 0 }
    });
  }
  if (path === "/v1/admin/trace") {
    const uid = url.searchParams.get("uid") || "";
    return json({ ok: true, uid, events: Array.from(memory.events.values()).filter((e) => e.actor_user_id === uid) });
  }
  if (path === "/v1/admin/user-cost") {
    return json({ ok: true, storage_bytes: 0, days: Number(url.searchParams.get("days") || 30) });
  }
  if (path === "/v1/admin/moderation") return json({ ok: true, pending: 0 });
  return json({ ok: false, error: "unknown admin route" }, 404);
}
var MAIL_KINDS = { contact: 1, "delete-account": 1, operator: 1, privacy: 1, invest: 1 };
function clientIp(request) {
  const cf = request.headers.get("CF-Connecting-IP") || request.headers.get("cf-connecting-ip");
  if (cf && cf.trim()) return cf.trim();
  const xff = request.headers.get("X-Forwarded-For") || request.headers.get("x-forwarded-for") || "";
  if (xff) return xff.split(",")[0].trim() || "unknown";
  return "unknown";
}
function looksLikeEmail(s) {
  const v = String(s || "").trim();
  return /^[^\s@]{1,64}@[^\s@]{1,190}\.[A-Za-z]{2,24}$/.test(v);
}
function mailInbox(env) {
  return String(env && (env.INBOX_TO || env.MAIL_TO) || "").trim();
}
function mailRateLimited(ip) {
  const now = Date.now();
  const prune = (key, windowMs, limit) => {
    const arr = (memory.mailHits.get(key) || []).filter((t) => now - t < windowMs);
    if (arr.length >= limit) {
      memory.mailHits.set(key, arr);
      return true;
    }
    arr.push(now);
    memory.mailHits.set(key, arr);
    return false;
  };
  return prune(ip, 60 * 60 * 1e3, 8) || prune(ip + ":burst", 8e3, 2);
}
async function mailRateLimitedDurable(env, saToken, ip) {
  if (!saToken) return false;
  try {
    const hex = await sha256Hex2("mail:" + String(ip || "unknown"));
    const id = "m" + hex.slice(0, 20);
    const got = await fsFetch(env, saToken, "GET", "/deskRate/" + encodeURIComponent(id));
    const now = Date.now();
    let hits3 = [];
    if (got.ok && got.data) {
      const d = fromFsDoc(got.data);
      hits3 = Array.isArray(d.hits) ? d.hits.map(Number).filter((t) => now - t < 60 * 60 * 1e3) : [];
    }
    if (hits3.length >= 12) return true;
    hits3.push(now);
    await fsFetch(env, saToken, "PATCH", "/deskRate/" + encodeURIComponent(id), toFsFields({
      hits: hits3.slice(-24),
      updatedAt: now
    }));
    return false;
  } catch {
    return false;
  }
}
async function deliverInboxEmail(env, row) {
  const to = mailInbox(env);
  if (!to || !looksLikeEmail(to)) return { emailed: false, via: "" };
  const subject = row.kind === "delete-account" ? "Naluno \xB7 delete-account request" : row.kind === "privacy" ? "Naluno \xB7 privacy" : row.kind === "invest" ? "Naluno \xB7 " + (row.interest === "partnership" ? "strategic partnership" : row.interest === "mentorship" ? "mentorship" : row.interest === "other" ? "conversation" : "investment") : row.source === "compass" ? "Naluno \xB7 Compass" : "Naluno \xB7 contact";
  const text = [
    "Source: " + row.source,
    "Kind: " + row.kind,
    "Name: " + (row.name || "\u2014"),
    "Handle: " + (row.handle || "\u2014"),
    "Reply-to: " + (row.email || "\u2014"),
    "Phone: " + (row.phone || "\u2014"),
    "Organisation: " + (row.organisation || "\u2014"),
    "Country: " + (row.country || "\u2014"),
    "Interest: " + (row.interest || "\u2014"),
    "Uid: " + (row.uid || "\u2014"),
    "Id: " + row.id,
    "",
    row.text
  ].join("\n");
  if (env.RESEND_API_KEY) {
    try {
      const payload = {
        from: env.MAIL_FROM || "Naluno <naluno@getnaluno.com>",
        to: [to],
        subject,
        text
      };
      if (looksLikeEmail(row.email)) payload.reply_to = row.email;
      const res = await _fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: "Bearer " + env.RESEND_API_KEY,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });
      if (res.ok) return { emailed: true, via: "resend" };
    } catch (_) {
    }
  }
  try {
    const body = {
      name: row.name || row.handle || "Naluno visitor",
      email: looksLikeEmail(row.email) ? row.email : "noreply@getnaluno.com",
      _subject: subject,
      _template: "box",
      _captcha: "false",
      message: text
    };
    if (looksLikeEmail(row.email)) body._replyto = row.email;
    const headers = {
      "Content-Type": "application/json",
      Accept: "application/json",
      Origin: "https://getnaluno.com",
      Referer: "https://getnaluno.com/"
    };
    const res = await _fetch("https://formsubmit.co/ajax/" + encodeURIComponent(to), {
      method: "POST",
      headers,
      body: JSON.stringify(body)
    });
    if (res.ok) return { emailed: true, via: "formsubmit" };
    const params = new URLSearchParams();
    Object.keys(body).forEach((k) => params.set(k, String(body[k])));
    const res2 = await _fetch("https://formsubmit.co/" + encodeURIComponent(to), {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
        Origin: "https://getnaluno.com",
        Referer: "https://getnaluno.com/"
      },
      body: params.toString()
    });
    if (res2.ok) return { emailed: true, via: "formsubmit" };
  } catch (_) {
  }
  return { emailed: false, via: "" };
}
async function persistMail(env, saToken, userToken, row) {
  memory.mail.set(row.id, row);
  if (saToken) {
    const r = await fsFetch(env, saToken, "PATCH", "/deskMail/" + encodeURIComponent(row.id), toFsFields(row));
    if (r.ok) return "firestore-sa";
  }
  if (userToken && row.uid) {
    const r = await fsFetch(
      env,
      userToken,
      "PATCH",
      "/deskMail/" + encodeURIComponent(row.id) + "?currentDocument.exists=false",
      toFsFields(row)
    );
    if (r.ok) return "user-token";
  }
  return saToken || userToken ? "failed" : "memory";
}
async function handleMail(request, env, saToken) {
  const ip = clientIp(request);
  if (mailRateLimited(ip)) {
    return json({ ok: false, error: "Please wait a moment and try again." }, 429);
  }
  if (await mailRateLimitedDurable(env, saToken, ip)) {
    return json({ ok: false, error: "Please wait a moment and try again." }, 429);
  }
  const body = await request.json().catch(() => ({}));
  if (String(body.company || body.website || body._hp || "").trim()) {
    return json({ ok: true, ignored: true });
  }
  const text = String(body.text || body.message || "").trim();
  if (text.length < 2) return json({ ok: false, error: "Write a message first." }, 400);
  if (text.length > 6e3) return json({ ok: false, error: "That message is too long." }, 400);
  let kind = String(body.kind || "contact").toLowerCase().replace(/\s+/g, "-");
  if (kind === "delete" || kind === "deleteaccount" || kind === "delete_account") kind = "delete-account";
  if (kind === "investment" || kind === "investor" || kind === "partnership" || kind === "mentor" || kind === "mentorship") kind = "invest";
  if (!MAIL_KINDS[kind]) kind = "contact";
  const token = bearer(request);
  const user = token ? await verifyIdToken(env, token) : null;
  if (kind === "delete-account" && !user && !String(body.email || body.handle || "").trim()) {
    return json({ ok: false, error: "Sign in, or leave a handle or email so we know which account." }, 400);
  }
  const INTERESTS = { investment: 1, partnership: 1, mentorship: 1, other: 1 };
  let interest = String(body.interest || "").toLowerCase().trim().replace(/\s+/g, "-").replace(/\//g, "-");
  if (interest === "strategic-partnership" || interest === "strategic_partnership" || interest === "partner") interest = "partnership";
  if (interest === "mentorship-advisory" || interest === "mentorship/advisory" || interest === "advisory" || interest === "mentor") interest = "mentorship";
  if (interest === "invest") interest = "investment";
  if (!INTERESTS[interest]) interest = kind === "invest" ? "investment" : "";
  const sourceRaw = String(body.source || (user ? "compass" : "web")).toLowerCase();
  const source = sourceRaw === "compass" ? "compass" : "web";
  const row = {
    id: "m" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
    source,
    kind,
    name: String(body.name || "").trim().slice(0, 80),
    handle: String(body.handle || "").trim().slice(0, 40),
    email: String(body.email || "").trim().slice(0, 120),
    phone: String(body.phone || body.whatsapp || "").trim().slice(0, 40),
    organisation: String(body.organisation || body.org || "").trim().slice(0, 80),
    country: String(body.country || "").trim().slice(0, 80),
    interest,
    uid: user ? user.uid : "",
    text,
    ts: Date.now(),
    status: "new"
  };
  if (user) {
    if (!row.email && user.email) row.email = String(user.email).slice(0, 120);
    if (!row.name && user.name) row.name = String(user.name).slice(0, 80);
  }
  if (kind === "invest") {
    if (!row.name || !looksLikeEmail(row.email)) {
      return json({ ok: false, error: "Leave a name and a reply-to email." }, 400);
    }
    if (!row.country) {
      return json({ ok: false, error: "Leave a country so we know where to start." }, 400);
    }
  }
  const persist = await persistMail(env, saToken, user ? token : "", row);
  const delivered = await deliverInboxEmail(env, row);
  const kept = persist === "firestore-sa" || persist === "user-token" || persist === "firestore";
  if (!delivered.emailed && !kept) {
    return json({ ok: false, error: "Could not send just now. Try again in a minute." }, 503);
  }
  return json({
    ok: true,
    id: row.id,
    emailed: !!delivered.emailed,
    persist: persist === "failed" ? "none" : persist
  });
}
var _lifelineHits = /* @__PURE__ */ new Map();
function lifelineRate(ip, perMinute) {
  const now = Date.now();
  const minute = Math.floor(now / 6e4);
  const k = ip + "|" + minute;
  const n = (_lifelineHits.get(k) || 0) + 1;
  if (_lifelineHits.size > 4e3) {
    for (const key of _lifelineHits.keys()) {
      const slot = Number(String(key).split("|").pop());
      if (!(slot >= minute - 1)) _lifelineHits.delete(key);
    }
  }
  if (_lifelineHits.size > 8e3) return false;
  _lifelineHits.set(k, n);
  return n <= perMinute;
}
function lifelineB64u(str) {
  try {
    let s = String(str).replace(/-/g, "+").replace(/_/g, "/");
    while (s.length % 4) s += "=";
    const bin = atob(s), out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch (_) {
    return null;
  }
}
function lifelineHex(b) {
  let s = "";
  for (let i = 0; i < b.length; i++) s += (b[i] < 16 ? "0" : "") + b[i].toString(16);
  return s;
}
var PAY_OFF = "Payments aren\u2019t available yet. Nothing was charged.";
var LIVE_OFF = "A larger live room is not connected yet.";
function payOrigin(env) {
  const raw = String(env && env.PAY_ORIGIN || "https://getnaluno.com");
  if (/^https:\/\/(getnaluno\.com|www\.getnaluno\.com)(\/|$)/.test(raw)) return raw.replace(/\/$/, "");
  return "https://getnaluno.com";
}
var _ratesCache = null;
var _pricesCache = null;
var RATES_FRESH_MS = 36 * 60 * 60 * 1e3;
async function loadRates(env, saToken) {
  const now = Date.now();
  if (_ratesCache && now - _ratesCache.at < 60 * 1e3) return _ratesCache.rates;
  let rates = null;
  let fetchedAt = 0;
  if (saToken) {
    const doc = await fsGetDoc(env, saToken, "/economyConfig/fxRates");
    if (doc && doc.rates && typeof doc.rates === "object") {
      rates = doc.rates;
      fetchedAt = Number(doc.fetchedAt) || 0;
    }
  }
  if (!rates || now - fetchedAt > RATES_FRESH_MS) {
    try {
      const r = await _fetch("https://open.er-api.com/v6/latest/USD");
      const b = await r.json().catch(() => null);
      if (r.ok && b && b.result === "success" && b.rates) {
        rates = b.rates;
        fetchedAt = now;
      }
    } catch {
    }
  }
  if (rates) _ratesCache = { at: now, rates: Object.assign({ USD: 1 }, rates), fetchedAt };
  return _ratesCache ? _ratesCache.rates : null;
}
async function loadPriceBook(env, saToken) {
  const now = Date.now();
  if (_pricesCache && now - _pricesCache.at < 15 * 1e3) return _pricesCache.book;
  const doc = saToken ? await fsGetDoc(env, saToken, "/economyConfig/prices") : null;
  const book = {
    known: readPrice(doc && doc.knownMonthly),
    support: readSupportPresets(doc && doc.supportPresets)
  };
  _pricesCache = { at: now, book };
  return book;
}
var _viewRulesCache = null;
async function loadViewSec(env, saToken) {
  if (_viewRulesCache && Date.now() - _viewRulesCache.at < 15e3) return _viewRulesCache.sec;
  const doc = saToken ? await fsGetDoc(env, saToken, "/economyConfig/viewRules") : null;
  const sec = clampViewSec(doc && doc.countAfterSec);
  _viewRulesCache = { at: Date.now(), sec };
  return sec;
}
async function viewOpen(env, user, saToken, body) {
  if (!saToken) return json({ ok: false, code: "not_connected", error: "Views are not being counted right now." }, 503);
  const bid = cleanBroadcastId(body.broadcast_id);
  if (!bid) return json({ ok: false, error: "Unknown Broadcast" }, 400);
  const sec = await loadViewSec(env, saToken);
  await fsPutDoc(env, saToken, "/viewOpens/" + viewOpenId(user.uid, bid), {
    uid: user.uid,
    broadcastId: bid,
    openedAt: Date.now()
  });
  return json({ ok: true, count_after_sec: sec });
}
async function viewCount(env, user, saToken, body) {
  if (!saToken) return json({ ok: false, code: "not_connected", error: "Views are not being counted right now." }, 503);
  const bid = cleanBroadcastId(body.broadcast_id);
  if (!bid) return json({ ok: false, error: "Unknown Broadcast" }, 400);
  const [open, broadcast, sec] = await Promise.all([
    fsGetDoc(env, saToken, "/viewOpens/" + viewOpenId(user.uid, bid)),
    fsGetDoc(env, saToken, "/broadcasts/" + encodeURIComponent(bid)),
    loadViewSec(env, saToken)
  ]);
  const now = Date.now();
  const d = viewDecision({ now, needSec: sec, uid: user.uid, broadcast, openedAt: open && open.uid === user.uid ? open.openedAt : 0 });
  if (d.error) return json({ ok: false, code: d.error, count_after_sec: sec }, d.error === "not_found" ? 404 : 409);
  if (d.wait_ms) return json({ ok: false, code: "wait", wait_ms: d.wait_ms, count_after_sec: sec }, 202);
  const docRoot = fsRoot(env).replace("https://firestore.googleapis.com/v1/", "");
  const writes = viewWrites(docRoot, {
    broadcastId: bid,
    uid: user.uid,
    creatorUid: String(broadcast && broadcast.creatorUid || ""),
    now,
    dwellMs: d.dwell_ms
  });
  const res = await _fetch(fsRoot(env) + ":commit", {
    method: "POST",
    headers: { Authorization: "Bearer " + saToken, "Content-Type": "application/json" },
    body: JSON.stringify({ writes })
  });
  if (!res.ok) {
    if (res.status === 409 || res.status === 400 || res.status === 412) {
      return json({ ok: true, counted: false, already: true, views: Number(broadcast && broadcast.views) || 0 });
    }
    return json({ ok: false, error: "The view could not be saved." }, 502);
  }
  return json({ ok: true, counted: true, views: (Number(broadcast && broadcast.views) || 0) + 1, count_after_sec: sec });
}
async function payCheckout(env, user, saToken, body) {
  if (!paymentsReady(env) || !saToken) return json({ ok: false, code: "not_connected", error: PAY_OFF }, 503);
  const check = validateCheckout(body, user.uid);
  if (check.error) return json({ ok: false, error: check.error }, 400);
  let payoutsOn = false;
  if (check.kind === "support") {
    const flags = await readFlags(env, saToken, null);
    payoutsOn = !!flags.flags.real_payouts_enabled;
    if (!flags.flags.creator_support_enabled) {
      return json({ ok: false, error: "Creator Support is off. Nothing was charged." }, 403);
    }
  }
  const payCur = normCode(check.currency);
  const rates = await loadRates(env, saToken);
  let charge = null;
  let bookAmount = null;
  let bookCurrency = "";
  if (check.kind === "support") {
    const major = roundForCharge(check.amountMajor, payCur);
    charge = { major, currency: payCur, stripe: majorToStripe(major, payCur) };
  }
  if (check.kind === "ad") {
    const adId = String(body.ad_id || "");
    const mailId = String(body.mail_id || "");
    const doc = adId ? await fsGetDoc(env, saToken, "/deskAds/" + encodeURIComponent(adId)) : await fsGetDoc(env, saToken, "/deskMail/" + encodeURIComponent(mailId));
    if (!doc) return json({ ok: false, error: "This ad is not on file. Nothing was charged." }, 404);
    const owner = String(doc.creatorUid || doc.uid || "");
    if (owner && owner !== user.uid) return json({ ok: false, error: "This ad is not yours." }, 403);
    const booked = Number(doc.paidAed) || 0;
    if (!(booked > 0)) return json({ ok: false, error: "There is no amount to pay. Nothing was charged." }, 400);
    const got = priceIn({ amount: booked, currency: "AED" }, payCur, rates);
    if (got.error) return json({ ok: false, error: "Exchange rates are not available right now. Nothing was charged." }, 503);
    charge = got;
    bookAmount = booked;
    bookCurrency = "AED";
  }
  if (check.kind === "known") {
    const app = await fsGetDoc(env, saToken, "/knownApps/" + encodeURIComponent(user.uid));
    if (!app || app.status !== "accepted" && app.status !== "known" && app.status !== "lapsed") {
      return json({ ok: false, error: "This has not been accepted yet. Nothing was charged." }, 403);
    }
    const book = await loadPriceBook(env, saToken);
    if (!book.known) return json({ ok: false, error: "The Known price is not set yet. Nothing was charged." }, 503);
    const got = priceIn(book.known, payCur, rates);
    if (got.error) return json({ ok: false, error: "Exchange rates are not available right now. Nothing was charged." }, 503);
    const shown = Number(body.amount_major);
    if (shown > 0 && !closeEnough(shown, got.major, 0.05)) {
      return json({
        ok: false,
        code: "price_changed",
        amount_major: got.major,
        currency: got.currency,
        error: "The price was updated. Check it and tap again. Nothing was charged."
      }, 409);
    }
    charge = got;
    bookAmount = book.known.amount;
    bookCurrency = book.known.currency;
  }
  if (!charge || !(charge.stripe > 0)) return json({ ok: false, error: "That amount cannot be charged" }, 400);
  const supportId = check.kind === "support" ? String(body.idempotency_key || body.support_id || "sup_" + user.uid + "_" + Date.now()).slice(0, 120) : "";
  const baseRef = String(body.idempotency_key || supportId || "pay_" + user.uid + "_" + Date.now()).slice(0, 150);
  const ref = baseRef + ":" + charge.currency + charge.stripe;
  const origin = payOrigin(env);
  let destination = "";
  let feeMinor = 0;
  if (check.kind === "support" && payoutsOn) {
    const pay = await creatorPayout(env, saToken, String(body.creator_user_id || ""));
    if (pay && pay.ready && pay.account) {
      destination = pay.account;
      const cfg = await fsGetDoc(env, saToken, "/economyConfig/payouts");
      feeMinor = supportFeeMinor(charge.stripe, cfg && cfg.supportFeePct);
    }
  }
  const back = {
    kind: check.kind,
    broadcastId: String(body.broadcast_id || ""),
    ref: check.kind === "support" ? supportId : String(body.ad_id || body.mail_id || "")
  };
  const form = checkoutForm({
    kind: check.kind,
    amountMinor: charge.stripe,
    currency: charge.currency,
    payerUid: user.uid,
    creatorUid: String(body.creator_user_id || ""),
    adId: String(body.ad_id || ""),
    mailId: String(body.mail_id || ""),
    broadcastId: String(body.broadcast_id || ""),
    supportId,
    ref,
    name: check.kind === "ad" ? "Naluno advertisement" : check.kind === "known" ? "Naluno Known, one month" : "Support a creator",
    bookAmount,
    bookCurrency,
    successUrl: payReturnUrl(origin, Object.assign({ outcome: "return" }, back)),
    cancelUrl: payReturnUrl(origin, Object.assign({ outcome: "cancel" }, back)),
    collectPhone: true,
    customerEmail: user.email || "",
    destination,
    feeMinor
  });
  const res = await _fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + env.STRIPE_SECRET_KEY,
      "Content-Type": "application/x-www-form-urlencoded",
      "Idempotency-Key": ref
    },
    body: form
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.url) {
    const why = data && data.error && data.error.message ? " " + String(data.error.message).slice(0, 240) : "";
    const registerUrl = stripeSetupUrl(why);
    return json({
      ok: false,
      error: "The card page did not open." + why + " Nothing was charged.",
      register_url: registerUrl || void 0
    }, 502);
  }
  return json({ ok: true, url: data.url, amount_major: charge.major, currency: charge.currency, direct_to_creator: !!destination });
}
async function stripeCall(env, method, path, form, idem) {
  const headers = { Authorization: "Bearer " + env.STRIPE_SECRET_KEY };
  if (form != null) headers["Content-Type"] = "application/x-www-form-urlencoded";
  if (idem) headers["Idempotency-Key"] = idem;
  const res = await _fetch("https://api.stripe.com/v1" + path, { method, headers, body: form == null ? void 0 : form });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}
async function creatorPayout(env, saToken, uid) {
  if (!uid || !saToken || !paymentsReady(env)) return null;
  const row = await fsGetDoc(env, saToken, "/payoutAccounts/" + encodeURIComponent(uid));
  if (!row || !row.account) return null;
  if (row.checkedAt && Date.now() - Number(row.checkedAt) < 10 * 60 * 1e3) {
    return { account: row.account, ready: !!row.ready };
  }
  const r = await stripeCall(env, "GET", "/accounts/" + encodeURIComponent(row.account));
  if (!r.ok) return { account: row.account, ready: false };
  const st = payoutState(r.data);
  await fsPutDoc(env, saToken, "/payoutAccounts/" + encodeURIComponent(uid), {
    ready: st.ready,
    detailsSubmitted: st.details_submitted,
    needs: st.needs,
    checkedAt: Date.now()
  });
  return { account: row.account, ready: st.ready };
}
async function payConnect(env, user, saToken) {
  if (!paymentsReady(env) || !saToken) return json({ ok: false, code: "not_connected", error: PAY_OFF }, 503);
  const path = "/payoutAccounts/" + encodeURIComponent(user.uid);
  let row = await fsGetDoc(env, saToken, path);
  let account = row && row.account;
  if (!account) {
    const made = await stripeCall(env, "POST", "/accounts", connectAccountForm({ email: user.email, uid: user.uid }), "acct_" + user.uid);
    if (!made.ok || !made.data.id) {
      const why = made.data && made.data.error && made.data.error.message ? " " + String(made.data.error.message).slice(0, 240) : "";
      const registerUrl = stripeSetupUrl(why);
      return json({ ok: false, error: "Payouts could not be set up." + why, register_url: registerUrl || void 0 }, 502);
    }
    account = made.data.id;
    await fsPutDoc(env, saToken, path, { uid: user.uid, account, ready: false, createdAt: Date.now(), checkedAt: 0 });
  }
  const origin = payOrigin(env);
  const link = await stripeCall(env, "POST", "/account_links", accountLinkForm({
    account,
    refreshUrl: origin + "/app/?payout=refresh",
    returnUrl: origin + "/app/?payout=return"
  }));
  if (!link.ok || !link.data.url) return json({ ok: false, error: "The Stripe page did not open. Try again." }, 502);
  return json({ ok: true, url: link.data.url });
}
async function payConnectStatus(env, user, saToken) {
  if (!paymentsReady(env) || !saToken) return json({ ok: false, code: "not_connected", error: PAY_OFF }, 503);
  const path = "/payoutAccounts/" + encodeURIComponent(user.uid);
  const row = await fsGetDoc(env, saToken, path);
  if (!row || !row.account) return json({ ok: true, connected: false, ready: false });
  const r = await stripeCall(env, "GET", "/accounts/" + encodeURIComponent(row.account));
  if (!r.ok) return json({ ok: true, connected: true, ready: false, needs: 0, unknown: true });
  const st = payoutState(r.data);
  await fsPutDoc(env, saToken, path, { ready: st.ready, detailsSubmitted: st.details_submitted, needs: st.needs, checkedAt: Date.now() });
  return json(Object.assign({ ok: true }, st));
}
function paidAsExpected(pay) {
  if (!pay) return false;
  if (!pay.expected_currency && !(pay.expected_amount > 0)) {
    if (pay.kind === "known") return pay.legacy_book_minor > 0 && pay.stripe_amount > 0;
    if (pay.kind === "ad") return String(pay.currency).toUpperCase() === "AED" && pay.stripe_amount > 0;
    if (pay.kind === "support") return pay.stripe_amount > 0;
    return false;
  }
  if (!pay.expected_currency || !(pay.expected_amount > 0)) return false;
  if (String(pay.currency).toUpperCase() !== String(pay.expected_currency).toUpperCase()) return false;
  return Number(pay.stripe_amount) >= Number(pay.expected_amount);
}
async function markPaid(env, saToken, pay) {
  if (!pay || !saToken) return;
  const existing = await fsGetDoc(env, saToken, "/payments/" + encodeURIComponent(pay.id));
  if (existing && existing.status === "paid") return;
  const now = Date.now();
  const matched = paidAsExpected(pay);
  const legacy = !pay.expected_currency && !(pay.expected_amount > 0);
  const coversAd = function(ad) {
    return !legacy || ad && pay.amount_minor >= Math.round((Number(ad.paidAed) || 0) * 100);
  };
  await fsPutDoc(env, saToken, "/payments/" + encodeURIComponent(pay.id), {
    status: "paid",
    kind: pay.kind,
    amount_minor: pay.amount_minor,
    amount_major: pay.amount_major,
    currency: pay.currency,
    book_amount: pay.book_amount || 0,
    book_currency: pay.book_currency || "",
    matched_expected: matched,
    payer_uid: pay.payer_uid,
    creator_user_id: pay.creator_user_id,
    ad_id: pay.ad_id,
    mail_id: pay.mail_id,
    broadcast_id: pay.broadcast_id,
    support_id: pay.support_id,
    provider: pay.provider || "stripe",
    paidAt: now
  });
  if (pay.kind === "ad" && pay.ad_id && matched) {
    const ad = await fsGetDoc(env, saToken, "/deskAds/" + encodeURIComponent(pay.ad_id));
    if (ad && coversAd(ad)) {
      await fsPutDoc(env, saToken, "/deskAds/" + encodeURIComponent(pay.ad_id), Object.assign({
        paymentStatus: "paid",
        paidAt: now
      }, pay.provider === "momo" ? { momoRef: pay.id } : { stripeSession: pay.id }));
    }
  }
  if (pay.kind === "ad" && pay.mail_id && matched) {
    const mail = await fsGetDoc(env, saToken, "/deskMail/" + encodeURIComponent(pay.mail_id));
    await fsPutDoc(env, saToken, "/deskMail/" + encodeURIComponent(pay.mail_id), Object.assign({
      paymentStatus: "paid",
      paidAt: now
    }, pay.provider === "momo" ? { momoRef: pay.id } : { stripeSession: pay.id }));
    const promoted = mail && mail.promotedAdId;
    if (promoted && !pay.ad_id) {
      const ad = await fsGetDoc(env, saToken, "/deskAds/" + encodeURIComponent(promoted));
      if (ad && coversAd(ad)) {
        await fsPutDoc(env, saToken, "/deskAds/" + encodeURIComponent(promoted), Object.assign({
          paymentStatus: "paid",
          paidAt: now
        }, pay.provider === "momo" ? { momoRef: pay.id } : { stripeSession: pay.id }));
      }
    }
  }
  if (pay.kind === "known" && pay.payer_uid && matched) {
    const app = await fsGetDoc(env, saToken, "/knownApps/" + encodeURIComponent(pay.payer_uid));
    if (app && (app.status === "accepted" || app.status === "known" || app.status === "lapsed")) {
      const carry = app.status === "known" && Number(app.paidUntil) > now ? Number(app.paidUntil) : now;
      const until = carry + 30 * 24 * 60 * 60 * 1e3;
      await fsPutDoc(env, saToken, "/knownApps/" + encodeURIComponent(pay.payer_uid), {
        status: "known",
        paidAt: now,
        paidUntil: until,
        amount_minor: pay.amount_minor,
        amount_major: pay.amount_major,
        currency: pay.currency,
        book_amount: pay.book_amount || 0,
        book_currency: pay.book_currency || "",
        payRef: pay.id,
        updatedAt: now
      });
      await fsPutDoc(env, saToken, "/users/" + encodeURIComponent(pay.payer_uid), {
        known: true,
        knownUntil: until
      });
      const pubName = String(app.name || "").trim().slice(0, 80) || "Known";
      await fsPutDoc(env, saToken, "/knownPublic/" + encodeURIComponent(pay.payer_uid), {
        name: pubName,
        note: String(app.note || "").trim().slice(0, 500),
        nameKey: pubName.toLowerCase().replace(/[^a-z0-9]+/g, ""),
        until,
        updatedAt: now
      });
    }
  }
  if (pay.kind === "support" && pay.support_id && pay.creator_user_id && pay.payer_uid !== pay.creator_user_id) {
    await fsPutDoc(env, saToken, "/creatorSupport/" + encodeURIComponent(pay.support_id), {
      status: "succeeded",
      provider: pay.provider || "stripe",
      payout_to: pay.payout_to === "creator" ? "creator" : "naluno",
      held_by: pay.payout_to === "creator" ? "" : "naluno",
      fee_minor: Number(pay.fee_minor) || 0,
      supporter_user_id: pay.payer_uid,
      creator_user_id: pay.creator_user_id,
      broadcast_id: pay.broadcast_id || "",
      amount_minor: pay.amount_minor,
      amount_major: pay.amount_major,
      currency: (pay.currency || "").toUpperCase(),
      stripeSession: pay.provider === "momo" ? "" : pay.id,
      momoRef: pay.provider === "momo" ? pay.id : "",
      paidAt: now
    });
  }
}
function momoRail() {
  return createMomoRail({
    json,
    fsGetDoc,
    fsPutDoc,
    fetchImpl: function(url, init) {
      return _fetch(url, init);
    },
    validateCheckout,
    momoPayer,
    momoCollectBody,
    momoNoticeValid,
    momoDisburseDecision,
    normCode,
    priceIn,
    roundForCharge,
    majorToStripe,
    closeEnough,
    loadRates,
    loadPriceBook,
    readFlags,
    markPaid
  });
}
async function payWebhook(env, request, saToken) {
  if (!paymentsReady(env) || !saToken) return json({ ok: false }, 503);
  const raw = await request.text();
  const header = request.headers.get("Stripe-Signature") || "";
  const ok = await verifyStripeSignature(raw, header, env.STRIPE_WEBHOOK_SECRET, Date.now());
  if (!ok) return json({ ok: false }, 400);
  let event = null;
  try {
    event = JSON.parse(raw);
  } catch (_) {
    return json({ ok: false }, 400);
  }
  const pay = applyCheckoutEvent(event);
  if (!pay) return json({ ok: true, ignored: true });
  await markPaid(env, saToken, pay);
  return json({ ok: true });
}
async function loadLiveRoom(env, saToken, broadcastId) {
  const mem = takeRoom(broadcastId);
  if (mem && !mem.ended) return mem;
  if (!saToken) return null;
  const doc = await fsGetDoc(env, saToken, "/liveRooms/" + encodeURIComponent(broadcastId));
  if (!doc || doc.ended || !doc.sessionId) return null;
  rememberRoom(broadcastId, doc);
  return doc;
}
async function liveHost(env, user, saToken, body) {
  if (!callsReady(env) || !saToken) return json({ ok: false, code: "not_connected", error: LIVE_OFF }, 503);
  const broadcastId = String(body.broadcastId || "").slice(0, 80);
  const sdp = String(body.sdp || "");
  if (broadcastId.length < 4 || sdp.length < 20 || sdp.length > 1e5) {
    return json({ ok: false, error: "The live room could not start." }, 400);
  }
  const tracks = publishTracks(sdp);
  if (!tracks.length) return json({ ok: false, error: "The live room could not start." }, 400);
  const session = await cfCalls(env, _fetch, "/sessions/new", "POST", {});
  const sessionId = session.data && session.data.sessionId;
  if (!session.ok || !sessionId) return json({ ok: false, error: LIVE_OFF }, 502);
  const published = await cfCalls(env, _fetch, "/sessions/" + encodeURIComponent(sessionId) + "/tracks/new", "POST", {
    sessionDescription: { sdp, type: "offer" },
    tracks
  });
  const answer = published.data && published.data.sessionDescription;
  if (!published.ok || !answer || !answer.sdp) return json({ ok: false, error: LIVE_OFF }, 502);
  const names = (published.data.tracks || tracks).map(function(t) {
    return t.trackName;
  }).filter(Boolean);
  const row = {
    hostUid: user.uid,
    sessionId,
    tracks: names,
    ended: false,
    at: Date.now()
  };
  rememberRoom(broadcastId, row);
  await fsPutDoc(env, saToken, "/liveRooms/" + encodeURIComponent(broadcastId), row);
  return json({ ok: true, sdp: answer.sdp, type: answer.type || "answer" });
}
async function liveWatch(env, user, saToken, body) {
  if (!callsReady(env) || !saToken) return json({ ok: false, code: "not_connected", error: LIVE_OFF }, 503);
  const broadcastId = String(body.broadcastId || "").slice(0, 80);
  const room = await loadLiveRoom(env, saToken, broadcastId);
  if (!room || room.hostUid === user.uid) return json({ ok: false, code: "no_room" }, 404);
  const session = await cfCalls(env, _fetch, "/sessions/new", "POST", {});
  const sessionId = session.data && session.data.sessionId;
  if (!session.ok || !sessionId) return json({ ok: false, error: LIVE_OFF }, 502);
  const pulled = await cfCalls(env, _fetch, "/sessions/" + encodeURIComponent(sessionId) + "/tracks/new", "POST", {
    tracks: (room.tracks || []).map(function(name) {
      return { location: "remote", trackName: name, sessionId: room.sessionId };
    })
  });
  const desc = pulled.data && pulled.data.sessionDescription;
  if (!pulled.ok || !desc || !desc.sdp) return json({ ok: false, error: LIVE_OFF }, 502);
  return json({ ok: true, sessionId, sdp: desc.sdp, type: desc.type || "offer" });
}
async function liveAnswer(env, user, body) {
  if (!callsReady(env)) return json({ ok: false, error: LIVE_OFF }, 503);
  const sessionId = String(body.sessionId || "");
  const sdp = String(body.sdp || "");
  if (!sessionId || sdp.length < 20) return json({ ok: false }, 400);
  const done = await cfCalls(env, _fetch, "/sessions/" + encodeURIComponent(sessionId) + "/renegotiate", "PUT", {
    sessionDescription: { sdp, type: body.type || "answer" }
  });
  if (!done.ok) return json({ ok: false, error: LIVE_OFF }, 502);
  return json({ ok: true });
}
async function liveEnd(env, user, saToken, body) {
  const broadcastId = String(body.broadcastId || "").slice(0, 80);
  const room = await loadLiveRoom(env, saToken, broadcastId);
  if (!room || room.hostUid !== user.uid) return json({ ok: false }, 403);
  forgetRoom(broadcastId);
  if (saToken) {
    await fsPutDoc(env, saToken, "/liveRooms/" + encodeURIComponent(broadcastId), {
      ended: true,
      hostUid: user.uid,
      at: Date.now()
    });
  }
  return json({ ok: true });
}
async function loadBilling(env, saToken) {
  const configured = hasSaConfigured(env);
  let billing = { connected: false, invoices: [], usage: null };
  try {
    const monToken = configured ? saAccessTokenScoped(env, "https://www.googleapis.com/auth/monitoring.read") : Promise.resolve("");
    try {
      setBookRates(await loadRates(env, saToken));
    } catch (_) {
    }
    billing = await Promise.race([
      billingSnapshot(env, {
        projectId: projectId(env),
        getMonitoringToken: function() {
          return monToken;
        }
      }),
      new Promise(function(ok) {
        setTimeout(function() {
          ok({ connected: false, invoices: [], usage: null });
        }, 6e3);
      })
    ]);
  } catch (_) {
  }
  return billing;
}
var MEDIA_BASES_DEFAULT = ["https://naluno-broadcast-upload.naluno.workers.dev", "https://naluno-signal-upload.naluno.workers.dev"];
var bandSweepSeen = /* @__PURE__ */ new Map();
function bandSweepIo(env, token) {
  const docRoot = fsRoot(env).replace("https://firestore.googleapis.com/v1/", "");
  const mediaBases = (env.MEDIA_WORKER_URLS ? String(env.MEDIA_WORKER_URLS).split(",") : MEDIA_BASES_DEFAULT).map((x) => String(x).trim().replace(/\/+$/, "")).filter(Boolean);
  return {
    mediaBases,
    docName: (path) => docRoot + path,
    async getDoc(path) {
      const r = await fsFetch(env, token, "GET", path);
      if (!r.ok || !r.data || !r.data.fields) return null;
      return { data: fromFsDoc(r.data), updateTime: r.data.updateTime || "" };
    },
    async listDocs(path, fields, max) {
      const out = [];
      let pageToken = "";
      const cap = Number(max) || 500;
      const mask = (fields && fields.length ? fields : ["queuedAt"]).map((f) => "mask.fieldPaths=" + encodeURIComponent(f)).join("&");
      for (let i = 0; i < 40 && out.length < cap; i++) {
        const q = "?pageSize=300&" + mask + (pageToken ? "&pageToken=" + encodeURIComponent(pageToken) : "");
        const r = await fsFetch(env, token, "GET", path + q);
        if (!r.ok || !r.data) break;
        (r.data.documents || []).forEach((d) => {
          const v = fromFsDoc(d);
          out.push({ id: v.id, data: v });
        });
        pageToken = r.data.nextPageToken || "";
        if (!pageToken) break;
      }
      return out.slice(0, cap);
    },
    async commit(writes) {
      if (!writes || !writes.length) return true;
      const r = await fsFetch(env, token, "POST", ":commit", { writes });
      return !!r.ok;
    },
    async dropMedia(items) {
      const secret = env.SWEEP_KEY || "";
      if (!secret || !items || !items.length) return 0;
      const byBase = {};
      items.forEach((it) => {
        (byBase[it.base] = byBase[it.base] || []).push(it.key);
      });
      let n = 0;
      for (const base of Object.keys(byBase)) {
        const keys = byBase[base];
        for (let i = 0; i < keys.length; i += 100) {
          try {
            const res = await _fetch(base + "/b/drop", {
              method: "POST",
              headers: { "Content-Type": "application/json", "X-Naluno-Sweep": secret },
              body: JSON.stringify({ keys: keys.slice(i, i + 100) })
            });
            const body = await res.json().catch(() => ({}));
            n += Number(body && body.deleted) || 0;
          } catch {
          }
        }
      }
      return n;
    }
  };
}
async function runBandSweep(env, bandId) {
  if (!hasSaConfigured(env)) return { ok: false, error: "no-service-account" };
  const token = await saAccessToken(env);
  if (!token) return { ok: false, error: "no-token" };
  const io = bandSweepIo(env, token);
  const now = Date.now();
  if (bandId) return sweepBand(io, bandId, now, { mediaBases: io.mediaBases });
  return sweepAllBands(io, now, { mediaBases: io.mediaBases });
}
async function handleRequest(request, env = {}, ctx = {}) {
  if (request.method === "OPTIONS") return corsPreflight();
  const url = new URL(request.url);
  const path = stripPrefix(url.pathname);
  try {
    if (path === "/health") {
      const configured = hasSaConfigured(env);
      const saToken2 = configured ? await saAccessToken(env) : "";
      return json({
        ok: true,
        service: "naluno-economy",
        version: VERSION,
        adminAuth: "password",
        hasServiceAccount: configured,
        hasWebApiKey: !!apiKey(env),
        hasInbox: !!(mailInbox(env) && looksLikeEmail(mailInbox(env))),
        persist: saToken2 ? "firestore-sa" : "user-token",
        payments: paymentsReady(env) && !!saToken2,
        liveRooms: callsReady(env) && !!saToken2,
        bandSweep: true,
        mediaSweep: !!env.SWEEP_KEY
      });
    }
    const saToken = hasSaConfigured(env) ? await saAccessToken(env) : "";
    const shareMatch = request.method === "GET" ? path.match(/^\/b\/([A-Za-z0-9_-]{1,80})(?:\/[A-Za-z0-9-]{0,60})?$/) : null;
    if (shareMatch) {
      const bid = shareMatch[1];
      const appUrl = "https://getnaluno.com/app/?broadcast=" + encodeURIComponent(bid);
      const selfUrl = url.origin + url.pathname;
      const esc = (v) => String(v == null ? "" : v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
      let title = "Naluno", desc = "A quieter way to reach people.", image = "";
      try {
        const tok = hasSaConfigured(env) ? await saAccessToken(env) : "";
        if (tok) {
          const b = await fsGetDoc(env, tok, "/broadcasts/" + encodeURIComponent(bid));
          const publicOk = b && !b.deleted && !b.hidden && !b.held && b.listed !== false && !(Number(b.publishAt) > Date.now()) && b.visibility !== "private";
          if (publicOk) {
            if (b.title) title = String(b.title).slice(0, 110);
            const who = b.creatorName ? "by " + String(b.creatorName).slice(0, 40) : "";
            desc = (who ? who + " \xB7 " : "") + "Watch on Naluno";
            const thumb = String(b.thumbUrl || b.thumb || "");
            if (/^https:\/\//.test(thumb)) image = thumb;
            if (!image && /^https:\/\//.test(String(b.mediaUrl || "")) && /\.(jpe?g|png|webp|gif)(\?|$)/i.test(String(b.mediaUrl))) image = String(b.mediaUrl);
          } else if (b) {
            title = "This Broadcast isn\u2019t available";
            desc = "It may have been taken down or made private.";
          }
        }
      } catch {
      }
      const html = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + esc(title) + '</title><meta property="og:type" content="video.other"><meta property="og:site_name" content="Naluno"><meta property="og:title" content="' + esc(title) + '"><meta property="og:description" content="' + esc(desc) + '"><meta property="og:url" content="' + esc(selfUrl) + '">' + (image ? '<meta property="og:image" content="' + esc(image) + '">' : "") + (image ? '<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">' : "") + '<meta name="twitter:card" content="' + (image ? "summary_large_image" : "summary") + '"><meta name="twitter:title" content="' + esc(title) + '"><meta name="twitter:description" content="' + esc(desc) + '">' + (image ? '<meta name="twitter:image" content="' + esc(image) + '">' : "") + '<link rel="canonical" href="' + esc(appUrl) + '"><meta http-equiv="refresh" content="0;url=' + esc(appUrl) + '"></head><body style="background:#0D0F17;color:#E8ECF5;font-family:system-ui;text-align:center;padding:48px 20px;"><p>Opening Naluno\u2026</p><p><a style="color:#7CFFB2" href="' + esc(appUrl) + '">Open this Broadcast</a></p><script>location.replace(' + JSON.stringify(appUrl) + ");</script></body></html>";
      return new Response(html, { status: 200, headers: {
        "Content-Type": "text/html; charset=utf-8",
        // Crawlers re-fetch often; a short cache keeps a taken-down Broadcast
        // from keeping its preview for long.
        "Cache-Control": "public, max-age=300",
        "Access-Control-Allow-Origin": "*"
      } });
    }
    if (path === "/v1/bands/sweep" && request.method === "POST") {
      const sweepToken = bearer(request);
      const sweepUser = sweepToken ? await verifyIdToken(env, sweepToken) : null;
      if (!sweepUser) return json({ ok: false, error: "sign in" }, 401);
      let body = {};
      try {
        body = await request.json();
      } catch {
        body = {};
      }
      const bandId = String(body && body.bandId || "");
      if (!/^[A-Za-z0-9_-]{4,128}$/.test(bandId)) return json({ ok: false, error: "bad_band" }, 400);
      const last = bandSweepSeen.get(bandId) || 0;
      if (Date.now() - last < 6e4) return json({ ok: true, queued: false, recent: true });
      bandSweepSeen.set(bandId, Date.now());
      if (bandSweepSeen.size > 5e3) bandSweepSeen.clear();
      const r = await runBandSweep(env, bandId);
      return json({ ok: !!r.ok, dead: !!r.dead, deleted: r.deleted || 0, error: r.error || void 0 }, r.ok ? 200 : 503);
    }
    if (path === "/v1/lifeline/drop" && request.method === "POST") {
      if (!saToken) return json({ ok: false, error: "relay storage not configured" }, 503);
      const ip = request.headers.get("CF-Connecting-IP") || "?";
      if (!lifelineRate(ip, 20)) return json({ ok: false, error: "slow down" }, 429);
      const body = await request.json().catch(() => ({}));
      const p = String(body.p || "");
      if (!/^[A-Za-z0-9_-]{60,5600}$/.test(p)) return json({ ok: false, error: "bad packet" }, 400);
      const bytes = lifelineB64u(p);
      if (!bytes || bytes[0] !== 1 || bytes.length < 41 || bytes.length > 4096) return json({ ok: false, error: "bad packet" }, 400);
      const tag = lifelineHex(bytes.slice(1, 13));
      const id = lifelineHex(bytes.slice(13, 21));
      const exp = Date.now() + 72 * 3600 * 1e3;
      const r = await fsFetch(
        env,
        saToken,
        "PATCH",
        "/lifelineDrops/" + tag + "_" + id,
        toFsFields({ tag, p, exp, at: Date.now() })
      );
      if (!r.ok) return json({ ok: false, error: "store failed" }, 502);
      return json({ ok: true });
    }
    if (path === "/v1/lifeline/pick" && request.method === "POST") {
      if (!saToken) return json({ ok: false, error: "relay storage not configured" }, 503);
      const ip = request.headers.get("CF-Connecting-IP") || "?";
      if (!lifelineRate(ip, 40)) return json({ ok: false, error: "slow down" }, 429);
      const body = await request.json().catch(() => ({}));
      const tags = (Array.isArray(body.tags) ? body.tags : []).filter((t) => typeof t === "string" && /^[0-9a-f]{24}$/.test(t)).slice(0, 300);
      if (!tags.length) return json({ ok: true, packets: [] });
      const now = Date.now(), out = [];
      for (let i = 0; i < tags.length && out.length < 200; i += 30) {
        const chunk = tags.slice(i, i + 30);
        const q = await fsFetch(env, saToken, "POST", ":runQuery", { structuredQuery: {
          from: [{ collectionId: "lifelineDrops" }],
          where: { fieldFilter: {
            field: { fieldPath: "tag" },
            op: "IN",
            value: { arrayValue: { values: chunk.map((t) => ({ stringValue: t })) } }
          } },
          limit: 100
        } });
        const rows = Array.isArray(q.data) ? q.data : [];
        rows.forEach((row) => {
          if (!row || !row.document) return;
          const d = fromFsDoc(row.document);
          if (Number(d.exp) > now && d.p) out.push(String(d.p));
        });
      }
      return json({ ok: true, packets: out.slice(0, 200) });
    }
    if (path === "/v1/look" && request.method === "GET") {
      const token = bearer(request);
      const user2 = token ? await verifyIdToken(env, token) : null;
      if (!user2) return json({ ok: false, error: "sign in" }, 401);
      const ip = request.headers.get("CF-Connecting-IP") || "?";
      if (!lifelineRate(ip, 20)) return json({ ok: false, error: "slow down" }, 429);
      const hits3 = await lookQuery(url.searchParams.get("q") || "");
      return json({ ok: true, hits: hits3 });
    }
    if (path === "/v1/flags") {
      const token = bearer(request);
      const user2 = token ? await verifyIdToken(env, token) : null;
      const got = await readFlags(env, saToken, token);
      return json({
        ok: true,
        flags: got.flags,
        degraded: false,
        persist: saToken ? "firestore-sa" : "user-token",
        source: got.source,
        operator: !!(user2 && isOperatorUser(env, user2))
      });
    }
    if (path.startsWith("/v1/value/")) {
      const id = decodeURIComponent(path.slice("/v1/value/".length));
      return json({
        ok: true,
        broadcast_id: id,
        community_value: 0,
        is_monetary: false
      });
    }
    if (path === "/v1/mail" && request.method === "POST") {
      return handleMail(request, env, saToken);
    }
    if (path === "/v1/pay/webhook" && request.method === "POST") {
      return payWebhook(env, request, saToken);
    }
    if (path === "/v1/pay/momo/notice" && request.method === "POST") {
      return momoRail().payMomoNotice(env, request, saToken);
    }
    if (path === "/v1/handle/check" && request.method === "GET") {
      return handleCheck(env, url, saToken);
    }
    const auth = await requireUser(env, request);
    if (auth.error) {
      if (path === "/" || path.startsWith("/v1/")) return auth.error;
      return auth.error;
    }
    const { user, token: userToken } = auth;
    if (path === "/v1/events" && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      const eventType = String(body.event_type || "");
      const eventId = String(body.event_id || "").slice(0, 80) || "evt_" + Date.now();
      if (memory.events.has(eventId)) {
        return json({ ok: true, duplicate: true, event_id: eventId, persist: persistMode(!!saToken, ["memory"]) });
      }
      if (saToken) {
        const claim = await fsFetch(
          env,
          saToken,
          "PATCH",
          "/engagementEvents/" + encodeURIComponent(eventId) + "?currentDocument.exists=false",
          toFsFields({ event_id: eventId, user_id: user.uid, event_type: eventType, claimed_at: Date.now() })
        );
        if (!claim.ok && (claim.status === 409 || claim.status === 400)) {
          memory.events.set(eventId, { event_id: eventId });
          return json({ ok: true, duplicate: true, event_id: eventId, persist: persistMode(true, ["firestore"]) });
        }
      }
      const scored = scoreEvent(eventType, body.text);
      const row = {
        event_id: eventId,
        ledger_id: "led_" + eventId.replace(/^evt_/, ""),
        user_id: user.uid,
        event_type: eventType,
        target_type: String(body.target_type || ""),
        target_id: String(body.target_id || ""),
        broadcast_id: String(body.broadcast_id || ""),
        parent_event_id: body.parent_event_id || "",
        creator_uid: String(body.creator_uid || ""),
        session_id: String(body.session_id || ""),
        text: typeof body.text === "string" ? body.text.slice(0, 2e3) : "",
        client_ts: Number(body.client_ts) || Date.now(),
        ts: Date.now(),
        points: scored.points,
        eligible_points: scored.eligible,
        status: scored.status,
        reason: scored.reason
      };
      const paths = await persistEvent(env, userToken, saToken, row);
      return json({
        ok: true,
        event_id: eventId,
        status: scored.status,
        persist: persistMode(!!saToken, paths)
      });
    }
    if (path === "/v1/wire/notify" && request.method === "POST") {
      if (!saToken) return json({ ok: false, sent: 0, error: "push not configured" }, 503);
      const body = await request.json().catch(() => ({}));
      const out = await handleWireNotify(body, user, {
        getDoc: (p) => fsGetDoc(env, saToken, p),
        accessToken: (scope) => saAccessTokenScoped(env, scope),
        fetch: (u, o) => _fetch(u, o),
        projectId: projectId(env)
      });
      return json(out.body, out.status);
    }
    if (path === "/v1/voice/lg" && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      let cache2 = null;
      try {
        if (typeof caches !== "undefined" && caches.default) cache2 = caches.default;
      } catch (_) {
      }
      const out = await handleLgVoice(body, user, { env, fetch: (u, o) => _fetch(u, o), cache: cache2 });
      if (!out.bytes) return json(out.json, out.status);
      return new Response(out.bytes, { status: 200, headers: {
        ...corsHeaders(),
        "Content-Type": out.type,
        "Cache-Control": "private, max-age=86400",
        "X-Naluno-Voice": out.speaker + (out.cached ? "; cached" : ""),
        "Access-Control-Expose-Headers": "X-Naluno-Voice"
      } });
    }
    if (path === "/v1/push/test" && request.method === "POST") {
      if (!saToken) return json({ ok: false, sent: 0, error: "push not configured" }, 503);
      const body = await request.json().catch(() => ({}));
      const out = await handlePushTest(body, user, {
        getDoc: (p) => fsGetDoc(env, saToken, p),
        accessToken: (scope) => saAccessTokenScoped(env, scope),
        fetch: (u, o) => _fetch(u, o),
        projectId: projectId(env),
        sleep: (ms) => new Promise((r) => setTimeout(r, ms))
      });
      return json(out.body, out.status);
    }
    if (path === "/v1/me" && request.method === "GET") {
      const p = await readContribution(env, saToken, user.uid);
      return json({
        ok: true,
        contribution_points: p.points,
        eligible_contribution: p.eligible,
        contribution_trust: trustLabelFor(p.events),
        persist: saToken ? "firestore-sa" : "user-token"
      });
    }
    if (path === "/v1/presence" && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      const now = Date.now();
      memory.presence.set(user.uid, { uid: user.uid, at: now, platform: body.platform || "", reason: body.reason || "" });
      if (userToken) {
        await fsPutDoc(env, userToken, "/users/" + encodeURIComponent(user.uid), {
          lastSeen: now,
          lastPlatform: String(body.platform || "").slice(0, 40),
          lastAppVersion: String(body.app_version || "").slice(0, 40),
          lastPresenceReason: String(body.reason || "beat").slice(0, 20)
        });
      }
      if (saToken) {
        await fsFetch(env, saToken, "PATCH", "/presence/" + encodeURIComponent(user.uid), toFsFields({
          uid: user.uid,
          at: now,
          platform: body.platform || ""
        }));
      }
      return json({ ok: true });
    }
    if (path === "/v1/safety/event" && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      const type = String(body.type || "").toUpperCase();
      if (body.body || body.message || body.ciphertext || body.plaintext || body.wire_text || body.transcript || body.chat) {
        return json({ ok: false, error: "private boundary", contents_collected: false }, 403);
      }
      if ((type === "LEGAL_REQUEST" || type === "ADMIN_ACTION") && !isOperatorUser(env, user)) {
        return json({ ok: false, error: "operator only" }, 403);
      }
      const surface = String(body.surface || "");
      if (isPrivateSurface(surface)) {
        return json({ ok: false, error: "private boundary", decision: "PRIVATE", contents_collected: false }, 403);
      }
      let linked = 0;
      if (type === "USER_CREATED") {
        const device = String(body.device_key || "").slice(0, 80);
        if (device) {
          const now = Date.now();
          const rows = (memory.safetyBirths.get(device) || []).filter(function(r) {
            return now - r.at < 864e5;
          });
          if (!rows.some(function(r) {
            return r.uid === user.uid;
          })) rows.push({ uid: user.uid, at: now });
          memory.safetyBirths.set(device, rows);
          linked = rows.length;
        }
      }
      const publicText = String(body.public_text || "");
      const fp = publicText ? fingerprintPublic(publicText) : "";
      let repeat = false;
      if (fp) {
        const key = user.uid + ":" + fp;
        const prev = memory.safetyPrints.get(key) || 0;
        if (prev && Date.now() - prev < 864e5) repeat = true;
        memory.safetyPrints.set(key, Date.now());
      }
      const ledger = memory.safetyLedgers.get(user.uid) || emptyLedger(user.uid);
      let applied;
      try {
        applied = applySafetyEvent(ledger, {
          type,
          surface,
          public_text: publicText,
          uid: user.uid,
          linked_accounts: linked,
          repeat_public: repeat,
          ban_evasion: !!body.ban_evasion,
          known_hash: !!body.known_hash
        });
      } catch (e) {
        const msg = e && e.message || "rejected";
        const code = msg === "private boundary" ? 403 : 400;
        return json({ ok: false, error: msg, contents_collected: false }, code);
      }
      memory.safetyLedgers.set(user.uid, applied.ledger);
      if (saToken) {
        const counts = applied.counts;
        await fsPutDoc(env, saToken, "/safetyLedgers/" + encodeURIComponent(user.uid), {
          uid: user.uid,
          counts,
          verified: !!applied.ledger.verified,
          updatedAt: Date.now()
        });
      }
      let cluster = null;
      if (fp) cluster = observeCluster(memory.safetyClusters, { fingerprint: fp, uid: user.uid });
      let caseId = "";
      const content = applied.content;
      if (content && safetyHold(content.decision)) {
        const opened = await openHeldCase(env, saToken, userToken, {
          reporter_id: "system",
          reported_user_id: user.uid,
          content_id: String(body.content_id || ""),
          content_type: surface || (type === "SIGNAL_PUBLISHED" ? "signal" : "broadcast"),
          surface: surface || "public",
          reason_code: content.urgent ? "violence" : content.decision === "AGE_RESTRICT" ? "sexual" : "dangerous",
          evidence_reference: (surface || "public") + ":" + String(body.content_id || type),
          result: content,
          contents_collected: content.contents_collected !== false && type !== "LEGAL_REQUEST"
        }, content.decision + " " + content.score, "classifier");
        caseId = opened.case_id;
      } else if (applied.behaviour && (applied.behaviour.decision === "REVIEW" || applied.behaviour.decision === "REMOVE")) {
        const opened = await openHeldCase(env, saToken, userToken, {
          reporter_id: "system",
          reported_user_id: user.uid,
          content_id: user.uid,
          content_type: "account",
          surface: "behaviour",
          reason_code: "suspicious",
          evidence_reference: "behaviour:" + user.uid,
          result: applied.behaviour,
          contents_collected: false
        }, applied.behaviour.signals.map(function(s) {
          return s.id;
        }).join(","), "behaviour");
        caseId = opened.case_id;
      } else if (cluster && cluster.human_required) {
        const opened = await openHeldCase(env, saToken, userToken, {
          reporter_id: "system",
          reported_user_id: user.uid,
          content_id: fp,
          content_type: "account",
          surface: "behaviour",
          reason_code: "suspicious",
          evidence_reference: "cluster:" + fp,
          result: cluster,
          contents_collected: false
        }, "coordinated public posts " + cluster.accounts, "network");
        caseId = opened.case_id;
      }
      return json({
        ok: true,
        type,
        case_id: caseId,
        statement: content ? statementFor(content) : "",
        content: content ? {
          decision: content.decision,
          score: content.score,
          urgent: !!content.urgent,
          auto_ban: false,
          contents_collected: type === "LEGAL_REQUEST" ? false : !!content.contents_collected
        } : null,
        behaviour: {
          decision: applied.behaviour.decision,
          score: applied.behaviour.score,
          auto_ban: false,
          contents_collected: false,
          signals: (applied.behaviour.signals || []).map(function(s) {
            return s.id;
          })
        },
        cluster: cluster ? { accounts: cluster.accounts, decision: cluster.decision, score: cluster.score } : null,
        private_read: false
      });
    }
    if (path === "/v1/safety/score" && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      const surface = String(body.surface || "public");
      if (isPrivateSurface(surface)) {
        return json({ ok: false, error: "private boundary", decision: "PRIVATE", contents_collected: false }, 403);
      }
      const result = scorePublicText(String(body.text || ""), { surface });
      result.statement = statementFor(result);
      if (safetyHold(result.decision)) {
        const opened = await openHeldCase(env, saToken, userToken, {
          reporter_id: "system",
          reported_user_id: user.uid,
          content_id: String(body.content_id || ""),
          content_type: surface,
          surface,
          reason_code: result.urgent ? "violence" : result.decision === "AGE_RESTRICT" ? "sexual" : "dangerous",
          evidence_reference: surface + ":" + String(body.content_id || "text"),
          result
        }, result.decision + " " + result.score, "classifier");
        result.case_id = opened.case_id;
      }
      const safe = {
        ok: result.ok,
        surface: result.surface,
        decision: result.decision,
        score: result.score,
        signals: result.signals,
        urgent: result.urgent,
        monitor: result.monitor,
        human_required: result.human_required,
        auto_ban: false,
        account_action_applied: false,
        recommended_account_action: result.recommended_account_action,
        contents_collected: result.contents_collected,
        statement: result.statement,
        case_id: result.case_id || "",
        version: result.version
      };
      return json({ ok: true, result: safe });
    }
    if (path === "/v1/safety/behaviour" && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      const result = scoreBehaviour(body.counts || body);
      if (result.decision === "REVIEW" || result.decision === "REMOVE") {
        const opened = buildCase({
          reporter_id: "system",
          reported_user_id: user.uid,
          content_id: user.uid,
          content_type: "account",
          surface: "behaviour",
          reason_code: "suspicious",
          evidence_reference: "behaviour:" + user.uid,
          result,
          contents_collected: false
        });
        await persistSafetyCase(env, saToken, userToken, opened);
        await persistSafetyAudit(env, saToken, userToken, buildAudit({
          case_id: opened.case_id,
          who: "system",
          what: "behaviour-risk",
          why: result.signals.map(function(s) {
            return s.id;
          }).join(","),
          detected_by: "behaviour",
          human_reviewed: false,
          action_taken: "case opened"
        }));
        result.case_id = opened.case_id;
      }
      return json({ ok: true, result });
    }
    if (path === "/v1/safety/hash" && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      if (body.bytes || body.file || body.data || body.image || body.blob) {
        return json({ ok: false, error: "send the hash only" }, 400);
      }
      const result = matchKnownHash(body.sha256, hashList(env));
      if (!result.ok) return json(result, 400);
      if (result.matched) {
        const opened = buildCase({
          reporter_id: "system",
          reported_user_id: user.uid,
          content_id: String(body.content_id || ""),
          content_type: String(body.surface || "public"),
          surface: "public",
          reason_code: result.category || "known",
          evidence_reference: "hash:" + String(body.sha256 || "").slice(0, 16),
          result,
          contents_collected: false
        });
        await persistSafetyCase(env, saToken, userToken, opened);
        await persistSafetyAudit(env, saToken, userToken, buildAudit({
          case_id: opened.case_id,
          who: "system",
          what: "known-hash",
          why: result.category || "known",
          detected_by: "hash",
          human_reviewed: false,
          action_taken: "held for review"
        }));
        result.case_id = opened.case_id;
      }
      return json({ ok: true, result });
    }
    if (path === "/v1/safety/appeal" && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      let appeal;
      try {
        appeal = buildAppeal({
          case_id: body.case_id,
          appellant_uid: user.uid,
          note: body.note
        });
      } catch (e) {
        return json({ ok: false, error: e && e.message || "appeal rejected" }, 400);
      }
      const existing = memory.safetyCases.get(appeal.case_id);
      if (existing && existing.reported_user_id && existing.reported_user_id !== user.uid) {
        return json({ ok: false, error: "not your case" }, 403);
      }
      memory.safetyAppeals.set(appeal.appeal_id, appeal);
      if (existing) {
        const next = applyAppeal(existing, appeal);
        await persistSafetyCase(env, saToken, userToken, next);
      }
      if (userToken || saToken) {
        await fsPutDoc(env, saToken || userToken, "/safetyAppeals/" + encodeURIComponent(appeal.appeal_id), appeal);
      }
      await persistSafetyAudit(env, saToken, userToken, buildAudit({
        case_id: appeal.case_id,
        who: user.uid,
        what: "appeal-opened",
        why: "person challenged the decision",
        detected_by: "human",
        human_reviewed: false,
        action_taken: "appeal open"
      }));
      return json({ ok: true, appeal_id: appeal.appeal_id });
    }
    if (path === "/v1/report" && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      const reason = String(body.reason || "").trim();
      const code = String(body.reason_code || "other");
      if (reason.length < 10) return json({ ok: false, error: "Please say a little more \u2014 at least a sentence." }, 400);
      if (!REPORT_CODES[code]) return json({ ok: false, error: "Unknown reason" }, 400);
      const id = String(body.report_id || "rep_" + Date.now()).slice(0, 80);
      const existing = memory.reports.get(id);
      if (existing && !reportIsOpen(existing)) {
        return json({ ok: true, report_id: id, hidden: false, already_decided: true });
      }
      const doc = {
        report_id: id,
        reporter_uid: user.uid,
        target_type: String(body.target_type || ""),
        target_id: String(body.target_id || ""),
        target_user_id: String(body.target_user_id || ""),
        broadcast_id: String(body.broadcast_id || ""),
        reason_code: code,
        reason,
        status: "OPEN",
        ts: Date.now()
      };
      memory.reports.set(id, doc);
      const token = userToken;
      const wrote = await fsFetch(
        env,
        token,
        "PATCH",
        "/reports/" + encodeURIComponent(id) + "?currentDocument.exists=false",
        toFsFields(doc)
      );
      if (!wrote.ok && existing) memory.reports.set(id, existing);
      const hideNow = String(body.broadcast_id || (body.target_type === "broadcast" ? body.target_id : "") || "");
      const URGENT_HOLD = { terrorism: 1, recruitment: 1, child_exploitation: 1, sexual_exploitation: 1, violence: 1 };
      let autoHidden = false, autoHeld = false, autoError = "";
      if (hideNow && (code === "sexual" || URGENT_HOLD[code])) {
        if (!saToken) {
          autoError = "no-service-account";
        } else {
          try {
            if (code === "sexual") {
              await hideBroadcastSexual(env, saToken, userToken, hideNow);
              autoHidden = true;
            } else {
              await fsPutDoc(env, saToken, "/broadcasts/" + encodeURIComponent(hideNow), {
                listed: false,
                held: true,
                live: false,
                heldReason: "reported-" + code,
                safetyDecision: "ESCALATE",
                updatedAt: Date.now()
              });
              autoHeld = true;
            }
          } catch (e) {
            autoError = e && e.message ? String(e.message).slice(0, 120) : "hide failed";
          }
        }
      }
      if (String(body.target_type || "") === "signal" && (code === "sexual" || URGENT_HOLD[code])) {
        const sigId = String(body.target_id || "");
        const sigUid = String(body.target_user_id || "");
        if (!saToken) {
          if (!autoError) autoError = "no-service-account";
        } else if (sigId && sigUid) {
          try {
            await hideSignalReported(env, saToken, sigUid, sigId, code === "sexual" ? "hidden" : "held", code);
            if (code === "sexual") autoHidden = true;
            else autoHeld = true;
          } catch (e) {
            autoError = e && e.message ? String(e.message).slice(0, 120) : "hide failed";
          }
        }
      }
      const targetType = String(body.target_type || "public");
      const privateTarget = isPrivateSurface(targetType);
      const scored = privateTarget ? { decision: "PRIVATE", score: 0, signals: [], urgent: false, contents_collected: false } : scorePublicText(String(body.caption || body.public_text || ""), { surface: targetType === "broadcast" || targetType === "signal" ? targetType : "public" });
      const targetUser = String(body.target_user_id || "");
      const now = Date.now();
      memory.safetyReportHits.push({
        reporter_uid: user.uid,
        target_id: targetUser || String(body.target_id || ""),
        at: now,
        reporter_age_hours: Number(body.reporter_age_hours)
      });
      if (memory.safetyReportHits.length > 500) memory.safetyReportHits = memory.safetyReportHits.slice(-500);
      const recentHits = memory.safetyReportHits.filter(function(r) {
        return r.target_id && r.target_id === (targetUser || String(body.target_id || "")) && now - r.at < 36e5;
      });
      const weighed = weighReports(recentHits.filter(function(r) {
        return Number.isFinite(r.reporter_age_hours);
      }));
      if (targetUser) {
        const led = memory.safetyLedgers.get(targetUser) || emptyLedger(targetUser);
        try {
          const applied = applySafetyEvent(led, { type: "ACCOUNT_REPORTED", uid: targetUser });
          memory.safetyLedgers.set(targetUser, applied.ledger);
        } catch (_) {
        }
      }
      const prior = safetyQueue().filter(function(c) {
        return c.reported_user_id && c.reported_user_id === targetUser;
      }).length;
      const blended = combineRisk(
        scored.decision === "PRIVATE" ? null : scored,
        null,
        weighed.brigade ? weighed.weight : prior + 1,
        weighed
      );
      const urgentCode = code === "terrorism" || code === "recruitment" || code === "child_exploitation" || code === "violence";
      const risk = urgentCode ? Object.assign({}, blended, {
        urgent: true,
        score: Math.max(blended.score, 70),
        decision: blended.decision === "REMOVE" || blended.decision === "ESCALATE" ? "ESCALATE" : "REVIEW",
        human_required: true,
        auto_ban: false
      }) : blended;
      const opened = buildCase({
        case_id: "TS-" + id.slice(0, 48),
        reporter_id: user.uid,
        reported_user_id: String(body.target_user_id || ""),
        content_id: String(body.broadcast_id || body.target_id || ""),
        content_type: targetType,
        surface: privateTarget ? targetType : targetType || "public",
        reason_code: code,
        report_id: id,
        evidence_reference: "report:" + id,
        result: risk,
        contents_collected: !privateTarget && !!(body.caption || body.public_text),
        include_body: false
      });
      if (privateTarget) opened.contents_collected = false;
      await persistSafetyCase(env, saToken, userToken, opened);
      await persistSafetyAudit(env, saToken, userToken, buildAudit({
        case_id: opened.case_id,
        who: user.uid,
        what: "report-opened",
        why: code,
        detected_by: "report",
        human_reviewed: false,
        action_taken: "case opened"
      }));
      try {
        const ownerUid = String(body.target_user_id || "") || (hideNow && saToken ? String((await fsGetDoc(env, saToken, "/broadcasts/" + encodeURIComponent(hideNow)) || {}).creatorUid || "") : "");
        if (ownerUid && (autoHidden || autoHeld) && saToken) {
          await fsPutDoc(env, saToken, "/users/" + encodeURIComponent(ownerUid) + "/notices/" + encodeURIComponent(id), {
            notice_id: id,
            kind: autoHidden ? "broadcast_hidden" : "broadcast_held",
            broadcast_id: hideNow,
            reason_code: code,
            case_id: opened.case_id,
            appealable: true,
            ts: Date.now()
          });
        }
      } catch {
      }
      return json({
        ok: true,
        report_id: id,
        case_id: opened.case_id,
        priority: opened.priority,
        hidden: autoHidden,
        held: autoHeld,
        hide_error: autoError,
        contents_collected: opened.contents_collected
      });
    }
    if (path === "/v1/support/intent" && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      return payCheckout(env, user, saToken, Object.assign({ kind: "support" }, body || {}));
    }
    if (path === "/v1/view/open" && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      return viewOpen(env, user, saToken, body || {});
    }
    if (path === "/v1/view/count" && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      return viewCount(env, user, saToken, body || {});
    }
    if (path === "/v1/pay/connect" && request.method === "POST") {
      return payConnect(env, user, saToken);
    }
    if (path === "/v1/pay/connect/status" && (request.method === "GET" || request.method === "POST")) {
      return payConnectStatus(env, user, saToken);
    }
    if (path === "/v1/pay/checkout" && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      return payCheckout(env, user, saToken, body || {});
    }
    if (path === "/v1/pay/momo" && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      return momoRail().payMomo(env, user, saToken, body || {});
    }
    if (path === "/v1/pay/momo/disburse" && request.method === "POST") {
      return momoRail().disburseMomo(env, user, saToken);
    }
    if (path === "/v1/live/host" && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      return liveHost(env, user, saToken, body || {});
    }
    if (path === "/v1/live/watch" && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      return liveWatch(env, user, saToken, body || {});
    }
    if (path === "/v1/live/answer" && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      return liveAnswer(env, user, body || {});
    }
    if (path === "/v1/live/end" && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      return liveEnd(env, user, saToken, body || {});
    }
    if (path === "/v1/broadcast/place" && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      return placeBroadcast(env, user, userToken, saToken, body);
    }
    if (path === "/v1/handle/claim" && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      return handleClaim(env, user, userToken, saToken, body);
    }
    if (path.startsWith("/v1/admin/")) {
      return handleAdmin(env, request, path, url, user, userToken, saToken);
    }
    return json({ ok: false, error: "Missing auth token" }, 401);
  } catch (e) {
    return json({ ok: false, error: e && e.message || "internal" }, 500);
  }
}

// index.mjs
var index_default = {
  async fetch(request, env, ctx) {
    return handleRequest(request, env, ctx);
  },
  /* THE RULE OF BANDS: every 10 minutes, delete the conversation of every
     Band whose two hours after the last person left have run out. */
  async scheduled(event, env, ctx) {
    const job = runBandSweep(env).catch(() => null);
    if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(job);
    else await job;
  }
};
export {
  index_default as default
};
