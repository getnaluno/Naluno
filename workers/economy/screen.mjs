/**
 * Naluno Screen — first-party still scorer.
 * Worker copy. Keep in step with js/screen.js.
 * Never calls a third-party scanner. CSAM is a separate legal path.
 */

export const SCREEN_VERSION = 3;
export const SCREEN_SIZE = 96;
export const SCREEN_MAX_FRAMES = 8;

const SEX_WORDS = /\b(porn|porno|xxx|nsfw|onlyfans|nudes?|naked|hentai|cumshot|sex\s*tape)\b/i;

function clamp01(x) {
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

export function videoScreenSpots(duration) {
  const d = Number(duration) || 0;
  if (d > 8) return [0.08, 0.2, 0.34, 0.48, 0.62, 0.76, 0.88, 0.95];
  if (d > 2) return [0.12, 0.3, 0.5, 0.7, 0.9];
  return [0.22, 0.55, 0.85];
}

export function isSkinRgb(r, g, b) {
  const y = 0.299 * r + 0.587 * g + 0.114 * b;
  if (y < 35 || y > 250) return false;
  const mx = r > g ? (r > b ? r : b) : (g > b ? g : b);
  const mn = r < g ? (r < b ? r : b) : (g < b ? g : b);
  if (mx - mn < 12) return false;
  const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
  const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
  const ycbcr = cr >= 120 && cr <= 185 && cb >= 72 && cb <= 138;
  const ratio = r > b && (r - g) >= 2 && (r - b) >= 6 && (g - b) > -25;
  return ycbcr && ratio;
}

function hsvOf(r, g, b) {
  const mx = r > g ? (r > b ? r : b) : (g > b ? g : b);
  const mn = r < g ? (r < b ? r : b) : (g < b ? g : b);
  const v = mx / 255;
  const d = mx - mn;
  const s = mx === 0 ? 0 : d / mx;
  let h = 0;
  if (d !== 0) {
    if (mx === r) h = ((g - b) / d) * 60;
    else if (mx === g) h = 120 + ((b - r) / d) * 60;
    else h = 240 + ((r - g) / d) * 60;
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

export function featuresFromRgb(rgb, w, h) {
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
        // Swimwear / clothes: saturated yellow-red-magenta, not foliage or sky.
        const fashionHue = hsv.h < 80 || hsv.h > 300;
        if (hsv.s > 0.42 && hsv.v > 0.28 && fashionHue) cloth++;
      }
      // Real sky/ocean: saturated enough that muted bedsheets fail.
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
      const i = y * w + x;
      function L(xx, yy) {
        const o = (yy * w + xx) * 3;
        return 0.299 * rgb[o] + 0.587 * rgb[o + 1] + 0.114 * rgb[o + 2];
      }
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
  const sizes = new Map();
  for (let i = 0; i < n; i++) {
    if (!skin[i]) continue;
    const r = uf.find(i);
    sizes.set(r, (sizes.get(r) || 0) + 1);
  }
  let blobMax = 0;
  sizes.forEach(function (v) {
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
    entropy: entropy,
    greenBlue: greenBlue / n,
    cloth: cloth / n,
    sky: sky / n,
    veg: veg / n,
    sheet: sheet / n,
    topSkin: topN ? topSkin / topN : 0,
    midSkin: midN ? midSkin / midN : 0,
    botSkin: botN ? botSkin / botN : 0,
    meanLum: meanLum / 255,
    lumVar: lumVar,
  };
}

export function isBeachwear(f) {
  if (!f) return false;
  const scene = (f.sky || 0) + (f.veg || 0);
  const cloth = f.cloth || 0;
  const sheet = f.sheet || 0;
  const sky = f.sky || 0;
  if (sheet > 0.12 && scene < 0.08) return false;
  // Beach / pool: real sky plus a head in frame. Swimwear often hashes as skin, so do not require a clothing count.
  if (sky > 0.08 && f.topSkin > 0.2 && sheet < 0.1) return true;
  if (scene > 0.08 && cloth > 0.04 && f.topSkin > 0.18 && sheet < 0.12) return true;
  if (cloth > 0.08 && f.topSkin > 0.22 && sheet < 0.1 && scene > 0.04) return true;
  return false;
}

export function isCloseup(f) {
  if (!f) return false;
  const scene = (f.sky || 0) + (f.veg || 0);
  const cloth = f.cloth || 0;
  const sheet = f.sheet || 0;
  const lower = ((f.midSkin || 0) + (f.botSkin || 0)) / 2;
  const noHead = (f.topSkin || 0) < 0.22;
  const smooth = (f.skinRatio || 0) > 0.28 && (f.skinEdge || 0) < 0.085;
  if (cloth > 0.06) return false;
  // Sky in the corner of a close-up is not a beach portrait.
  if (scene > 0.12 && sheet < 0.1 && (f.topSkin || 0) > 0.18) return false;
  if (noHead && lower > 0.45 && (f.skinRatio || 0) > 0.28 && cloth < 0.035) return true;
  if (smooth && noHead && cloth < 0.03 && scene < 0.1) return true;
  if (sheet > 0.12 && noHead && (f.skinRatio || 0) > 0.3 && cloth < 0.03) return true;
  return false;
}

/** Indoor skin-heavy scene with people in frame. Heads being visible must not
 *  make a sex scene look like a portrait — that was the miss. Beachwear is
 *  excluded first. */
export function isIntimate(f) {
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
  h += 0.15 * (f.skinRatio > 0.08 ? (1 - clamp01(f.skinEdge / 0.22)) : 0);
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

export function classifyFrame(f) {
  if (!f) return { hint: 0, beachwear: false, closeup: false, intimate: false };
  const beachwear = isBeachwear(f);
  const closeup = isCloseup(f);
  const intimate = isIntimate(f);
  let hint = rawHint(f);
  if ((closeup || intimate) && !beachwear) hint = Math.max(hint, 0.86);
  else if (beachwear) hint = Math.min(hint, 0.22);
  return { hint: clamp01(hint), beachwear, closeup, intimate };
}

export function hintFromFeatures(f) {
  return classifyFrame(f).hint;
}

export function decideFromHints(hints, opts) {
  const title = (opts && opts.title) || "";
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
  // One strong late frame is enough to stop. Mean must not wash it out.
  if (max >= 0.84 || (max >= 0.78 && mean >= 0.45) || (lex && max >= 0.55)) {
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
    reason,
  };
}

export function bytesFromB64(s) {
  try {
    const bin = atob(String(s || ""));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

/* ---- Model verdict (nsfwjs) ----
   Same policy as js/nsfw-model.js, and it MUST stay in step with it.
   explicit = Porn + Hentai. Sexy is deliberately excluded — that is where
   bikinis and swimwear land, and they are to be accepted. */
const MODEL_REJECT_AT = 0.70;
const MODEL_REVIEW_AT = 0.30;
const MODEL_CLASSES = ["Drawing", "Hentai", "Neutral", "Porn", "Sexy"];

/** Validate model scores before trusting them.
 *  This rejects malformed or garbage payloads — five probabilities that are
 *  numbers in [0,1] and sum to ~1, per frame. It does NOT stop a careful
 *  forger: the scores are computed on the device, so a modified client could
 *  send a plausible "clean" set. That is the known limit of on-device
 *  screening, stated here rather than hidden. */
function validModelFrames(model) {
  if (!model || typeof model !== "object") return null;
  const frames = Array.isArray(model.frames) ? model.frames.slice(0, 12) : [];
  if (!frames.length) return null;
  const out = [];
  for (const f of frames) {
    if (!f || typeof f !== "object") return null;
    let sum = 0;
    for (const k of MODEL_CLASSES) {
      const v = Number(f[k]);
      if (!Number.isFinite(v) || v < 0 || v > 1) return null;
      sum += v;
    }
    if (Math.abs(sum - 1) > 0.05) return null;
    out.push(f);
  }
  return out;
}

export function decideFromModel(frames) {
  let worst = 0, maxSexy = 0;
  for (const f of frames) {
    const e = (Number(f.Porn) || 0) + (Number(f.Hentai) || 0);
    if (e > worst) worst = e;
    maxSexy = Math.max(maxSexy, Number(f.Sexy) || 0);
  }
  let decision = "allow", reason = maxSexy >= 0.5 ? "revealing-allowed" : "";
  if (worst >= MODEL_REJECT_AT) { decision = "block"; reason = "explicit"; }
  else if (worst >= MODEL_REVIEW_AT) { decision = "hold"; reason = "review"; }
  return { decision, score: Math.round(worst * 100), reason, explicit: worst, sexy: maxSexy };
}

export function judgeScreenPayload(payload, opts) {
  const title = (opts && opts.title) || "";
  if (!payload || typeof payload !== "object") {
    return { decision: "unread", score: 0, hasScreen: false, reason: "unread", frames: 0 };
  }
  /* Prefer the model when valid scores are present. Before this, the server
     re-ran the skin heuristic on every upload — so even a correct on-device
     verdict ("that is a bikini, accept it") was silently overruled by the
     check that could not tell a bikini from nudity. */
  const modelFrames = validModelFrames(payload.model);
  if (modelFrames) {
    const d = decideFromModel(modelFrames);
    return {
      decision: d.decision, score: d.score, hasScreen: true,
      reason: d.reason, frames: modelFrames.length,
      engine: "model", explicit: d.explicit, sexy: d.sexy,
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
    if (typeof raw !== "string" || raw.length < 32 || raw.length > 50000) continue;
    const rgb = bytesFromB64(raw);
    if (!rgb || rgb.length !== w * h * 3) continue;
    const feat = featuresFromRgb(rgb, w, h);
    hints.push(hintFromFeatures(feat));
  }
  if (!hints.length) {
    return { decision: "unread", score: 0, hasScreen: false, reason: "unread", frames: 0 };
  }
  const d = decideFromHints(hints, { title });
  return {
    decision: d.decision,
    score: d.score,
    hasScreen: true,
    reason: d.reason,
    frames: hints.length,
    max: d.max,
    mean: d.mean,
  };
}

export function listingFromScreen(opts) {
  const trusted = !!(opts && opts.trusted);
  const hidden = !!(opts && opts.hidden);
  const hasScreen = !!(opts && opts.hasScreen);
  const decision = (opts && opts.decision) || "unread";
  if (hidden) {
    return { listed: false, held: false, hidden: true };
  }
  if (decision === "block") {
    return {
      listed: false,
      held: false,
      hidden: true,
      hiddenReason: "screen",
      heldReason: "",
    };
  }
  if (trusted) {
    return { listed: true, held: false, hidden: false, heldReason: "" };
  }
  if (hasScreen && decision === "allow") {
    return { listed: true, held: false, hidden: false, heldReason: "" };
  }
  if (hasScreen && decision === "hold") {
    return { listed: false, held: true, hidden: false, heldReason: "screen" };
  }
  return { listed: false, held: true, hidden: false, heldReason: "new-publisher" };
}

export function fillRgb(w, h, fn) {
  const rgb = new Uint8Array(w * h * 3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = fn(x, y, w, h) || [0, 0, 0];
      const o = (y * w + x) * 3;
      rgb[o] = c[0];
      rgb[o + 1] = c[1];
      rgb[o + 2] = c[2];
    }
  }
  return rgb;
}

export function rgbToB64(rgb) {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < rgb.length; i += chunk) {
    bin += String.fromCharCode.apply(null, rgb.subarray(i, i + chunk));
  }
  return btoa(bin);
}
