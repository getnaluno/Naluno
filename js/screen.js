/* OWNERSHIP (screen.js): Naluno Screen — first-party stills from Origin sampling.
   Scores frames on-device. Never sends video to a third-party scanner.
   MUST NOT touch calls / WebRTC. CSAM is a separate legal path.
   Keep the numeric core in step with workers/economy/screen.mjs. */
(function (root) {
  const SCREEN_VERSION = 3;
  const SCREEN_SIZE = 96;
  const SCREEN_MAX_FRAMES = 8;
  const SEX_WORDS = /\b(porn|porno|xxx|nsfw|onlyfans|nudes?|naked|hentai|cumshot|sex\s*tape)\b/i;

  function clamp01(x) {
    if (x < 0) return 0;
    if (x > 1) return 1;
    return x;
  }
  function videoScreenSpots(duration) {
    const d = Number(duration) || 0;
    if (d > 8) return [0.08, 0.2, 0.34, 0.48, 0.62, 0.76, 0.88, 0.95];
    if (d > 2) return [0.12, 0.3, 0.5, 0.7, 0.9];
    return [0.22, 0.55, 0.85];
  }
  function isSkinRgb(r, g, b) {
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
    const sizes = {};
    let blobCount = 0;
    let blobMax = 0;
    for (let i = 0; i < n; i++) {
      if (!skin[i]) continue;
      const r = uf.find(i);
      if (!sizes[r]) {
        sizes[r] = 0;
        blobCount++;
      }
      sizes[r]++;
      if (sizes[r] > blobMax) blobMax = sizes[r];
    }
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
      blobCount: blobCount,
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
  function isBeachwear(f) {
    if (!f) return false;
    const scene = (f.sky || 0) + (f.veg || 0);
    const clothN = f.cloth || 0;
    const sheetN = f.sheet || 0;
    const skyN = f.sky || 0;
    if (sheetN > 0.12 && scene < 0.08) return false;
    if (skyN > 0.08 && f.topSkin > 0.2 && sheetN < 0.1) return true;
    if (scene > 0.08 && clothN > 0.04 && f.topSkin > 0.18 && sheetN < 0.12) return true;
    if (clothN > 0.08 && f.topSkin > 0.22 && sheetN < 0.1 && scene > 0.04) return true;
    return false;
  }
  function isCloseup(f) {
    if (!f) return false;
    const scene = (f.sky || 0) + (f.veg || 0);
    const clothN = f.cloth || 0;
    const sheetN = f.sheet || 0;
    const lower = ((f.midSkin || 0) + (f.botSkin || 0)) / 2;
    const noHead = (f.topSkin || 0) < 0.22;
    const smooth = (f.skinRatio || 0) > 0.28 && (f.skinEdge || 0) < 0.085;
    if (clothN > 0.06) return false;
    if (scene > 0.12 && sheetN < 0.1 && (f.topSkin || 0) > 0.18) return false;
    if (noHead && lower > 0.45 && (f.skinRatio || 0) > 0.28 && clothN < 0.035) return true;
    if (smooth && noHead && clothN < 0.03 && scene < 0.1) return true;
    if (sheetN > 0.12 && noHead && (f.skinRatio || 0) > 0.3 && clothN < 0.03) return true;
    return false;
  }
  function isIntimate(f) {
    if (!f) return false;
    if (isBeachwear(f)) return false;
    const scene = (f.sky || 0) + (f.veg || 0);
    const clothN = f.cloth || 0;
    const skin = f.skinRatio || 0;
    const center = f.centerSkin || 0;
    const body = ((f.midSkin || 0) + (f.botSkin || 0)) / 2;
    const top = f.topSkin || 0;
    const smooth = skin > 0.28 && (f.skinEdge || 0) < 0.09;
    if (scene > 0.1) return false;
    if (clothN > 0.08) return false;
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
    return { decision, score: Math.round(max * 100), max, mean, reason };
  }
  function rgbaToRgb(data, w, h) {
    const rgb = new Uint8Array(w * h * 3);
    let j = 0;
    const n = Math.min(data.length, w * h * 4);
    for (let i = 0; i < n; i += 4) {
      rgb[j++] = data[i];
      rgb[j++] = data[i + 1];
      rgb[j++] = data[i + 2];
    }
    return rgb;
  }
  function b64FromBytes(u8) {
    let bin = "";
    const chunk = 0x8000;
    for (let i = 0; i < u8.length; i += chunk) {
      bin += String.fromCharCode.apply(null, u8.subarray(i, i + chunk));
    }
    return btoa(bin);
  }
  function pickStills(stills, n) {
    const list = (stills || []).filter(function (s) {
      return s && s.data && s.w && s.h;
    });
    if (list.length <= n) return list;
    const out = [];
    for (let i = 0; i < n; i++) {
      out.push(list[Math.round((i * (list.length - 1)) / (n - 1))]);
    }
    return out;
  }
  function fromStills(stills, title) {
    const picked = pickStills(stills, SCREEN_MAX_FRAMES);
    if (!picked.length) {
      return {
        v: SCREEN_VERSION,
        decision: "unread",
        score: 0,
        reason: "unread",
        packed: null,
      };
    }
    const hints = [];
    const packedFrames = [];
    let w = picked[0].w;
    let h = picked[0].h;
    for (let i = 0; i < picked.length; i++) {
      const s = picked[i];
      const rgb = rgbaToRgb(s.data, s.w, s.h);
      const feat = featuresFromRgb(rgb, s.w, s.h);
      hints.push(hintFromFeatures(feat));
      packedFrames.push({ rgb: b64FromBytes(rgb) });
      w = s.w;
      h = s.h;
    }
    const d = decideFromHints(hints, { title: title || "" });
    const packed = { v: SCREEN_VERSION, w: w, h: h, frames: packedFrames };
    const report = {
      v: SCREEN_VERSION,
      w: w,
      h: h,
      decision: d.decision,
      score: d.score,
      max: d.max,
      mean: d.mean,
      reason: d.reason,
      packed: packed,
    };
    try {
      root._nalunoLastScreen = report;
    } catch (_) {}
    return report;
  }
  function packPayload(report) {
    if (!report) return null;
    if (report.packed && report.packed.frames && report.packed.frames.length) return report.packed;
    return null;
  }
  function stillFromCanvasEl(canvas) {
    try {
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) return null;
      const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
      return { w: canvas.width, h: canvas.height, data: img.data };
    } catch (_) {
      return null;
    }
  }
  function looksVideo(file) {
    const t = (file && file.type) || "";
    const n = (file && file.name) || "";
    return t.indexOf("video/") === 0 || /\.(mp4|mov|webm|m4v|mkv|3gp)$/i.test(n);
  }
  function looksImage(file) {
    const t = (file && file.type) || "";
    const n = (file && file.name) || "";
    return t.indexOf("image/") === 0 || /\.(jpe?g|png|webp|gif|heic|heif)$/i.test(n);
  }
  function sampleFile(file, durationHint) {
    return new Promise(function (resolve) {
      if (!file) {
        resolve([]);
        return;
      }
      const stills = [];
      if (looksImage(file) && !looksVideo(file)) {
        try {
          const url = URL.createObjectURL(file);
          const img = new Image();
          img.onload = function () {
            try {
              const c = document.createElement("canvas");
              c.width = SCREEN_SIZE;
              c.height = SCREEN_SIZE;
              const ctx = c.getContext("2d", { willReadFrequently: true });
              ctx.drawImage(img, 0, 0, SCREEN_SIZE, SCREEN_SIZE);
              const s = stillFromCanvasEl(c);
              if (s) stills.push(s);
            } catch (_) {}
            try {
              URL.revokeObjectURL(url);
            } catch (_) {}
            resolve(stills);
          };
          img.onerror = function () {
            try {
              URL.revokeObjectURL(url);
            } catch (_) {}
            resolve([]);
          };
          img.src = url;
          setTimeout(function () {
            resolve(stills);
          }, 4000);
        } catch (_) {
          resolve([]);
        }
        return;
      }
      if (!looksVideo(file)) {
        resolve([]);
        return;
      }
      const v = document.createElement("video");
      v.muted = true;
      v.playsInline = true;
      v.preload = "auto";
      const url = URL.createObjectURL(file);
      let settled = false;
      const done = function () {
        if (settled) return;
        settled = true;
        try {
          URL.revokeObjectURL(url);
        } catch (_) {}
        try {
          v.pause();
          v.removeAttribute("src");
          v.load();
        } catch (_) {}
        resolve(stills);
      };
      const canvas = document.createElement("canvas");
      canvas.width = SCREEN_SIZE;
      canvas.height = SCREEN_SIZE;
      const grab = function () {
        try {
          const ctx = canvas.getContext("2d", { willReadFrequently: true });
          if (!ctx) return;
          ctx.drawImage(v, 0, 0, SCREEN_SIZE, SCREEN_SIZE);
          const s = stillFromCanvasEl(canvas);
          if (s) stills.push(s);
        } catch (_) {}
      };
      v.onloadedmetadata = async function () {
        const d = isFinite(v.duration) ? v.duration : durationHint || 0;
        const spots = videoScreenSpots(d);
        for (let i = 0; i < spots.length; i++) {
          try {
            v.currentTime = Math.max(0.05, spots[i] * (d || 1));
            await new Promise(function (ok) {
              const t = setTimeout(ok, 650);
              v.onseeked = function () {
                clearTimeout(t);
                ok();
              };
            });
            grab();
          } catch (_) {}
        }
        done();
      };
      v.onerror = function () {
        done();
      };
      setTimeout(function () {
        done();
      }, 9000);
      v.src = url;
    });
  }
  async function runOnFile(file, title, durationHint) {
    try {
      const stills = await sampleFile(file, durationHint || 0);
      return fromStills(stills, title || "");
    } catch (_) {
      return { v: SCREEN_VERSION, decision: "unread", score: 0, reason: "unread", packed: null };
    }
  }

  const api = {
    VERSION: SCREEN_VERSION,
    SIZE: SCREEN_SIZE,
    isSkinRgb: isSkinRgb,
    featuresFromRgb: featuresFromRgb,
    hintFromFeatures: hintFromFeatures,
    classifyFrame: classifyFrame,
    isBeachwear: isBeachwear,
    isCloseup: isCloseup,
    isIntimate: isIntimate,
    videoScreenSpots: videoScreenSpots,
    decideFromHints: decideFromHints,
    fromStills: fromStills,
    packPayload: packPayload,
    stillFromCanvas: stillFromCanvasEl,
    runOnFile: runOnFile,
    rgbaToRgb: rgbaToRgb,
  };
  root.NalunoScreen = api;
  root.nalunoScreenFromStills = fromStills;
  root.runNalunoScreen = runOnFile;
  root.nalunoScreenPack = packPayload;
  root.nalunoVideoScreenSpots = videoScreenSpots;
})(typeof window !== "undefined" ? window : typeof globalThis !== "undefined" ? globalThis : this);
