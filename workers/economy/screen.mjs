/**
 * Naluno Screen — first-party still scorer.
 * Worker copy. Keep in step with js/screen.js.
 * Never calls a third-party scanner. CSAM is a separate legal path.
 */

export const SCREEN_VERSION = 1;
export const SCREEN_SIZE = 96;
export const SCREEN_MAX_FRAMES = 6;

const SEX_WORDS = /\b(porn|porno|xxx|nsfw|onlyfans|nudes?|naked|hentai|cumshot|sex\s*tape)\b/i;

function clamp01(x) {
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
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
      if (g > r + 12 && g > b - 8) greenBlue++;
      else if (b > r + 18 && b > g + 4) greenBlue++;
      if (isSkinRgb(r, g, b)) {
        skin[i] = 1;
        skinN++;
        if (inCenter) centerSkin++;
        if (onEdge) edgeSkin++;
        if (y < yTop) topSkin++;
        else if (y < yBot) midSkin++;
        else botSkin++;
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
    topSkin: topN ? topSkin / topN : 0,
    midSkin: midN ? midSkin / midN : 0,
    botSkin: botN ? botSkin / botN : 0,
    meanLum: meanLum / 255,
    lumVar: lumVar,
  };
}

export function hintFromFeatures(f) {
  if (!f) return 0;
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
  if (f.greenBlue > 0.16 || f.entropy > 3.6) h *= 0.62;
  if (f.edgeDensity > 0.22 && f.skinRatio < 0.45) h *= 0.7;
  if (f.greenBlue < 0.12 && f.skinRatio < 0.06 && f.entropy < 2.4 && f.edgeDensity < 0.1 && f.lumVar < 0.05 && f.meanLum > 0.22 && f.meanLum < 0.85) {
    h = Math.max(h, 0.36);
  }
  return clamp01(h);
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
  if ((max >= 0.78 && mean >= 0.5) || max >= 0.84 || (lex && max >= 0.55)) {
    decision = "block";
    reason = "screen";
  } else if (max < 0.3 && mean < 0.22 && !lex) {
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

export function judgeScreenPayload(payload, opts) {
  const title = (opts && opts.title) || "";
  if (!payload || typeof payload !== "object") {
    return { decision: "unread", score: 0, hasScreen: false, reason: "unread", frames: 0 };
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
