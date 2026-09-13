/* ============================================================
   MODULE: js/ads.js
   First-party native ads. Inventory is uploaded from the Control
   Centre into Firestore `deskAds` + Cloudflare R2. The member app
   only reads live rows. No third-party network, no tracker, no
   auction. Every unit is labelled Ad.

   Placements:
     in-feed          — native 9:16 plate in For You, every N cards
     broadcast-break  — skippable chapter-break inside a Broadcast

   OWNERSHIP: inventory, pick, render, skip, impression/click.
   Playback pause lives in media-contain.js (nalunoPauseLeavingMedia).
   ============================================================ */
(function (root) {
  const COL = 'deskAds';
  const FREQUENCY = 4;
  const DEFAULT_SKIP = 5;
  const MAX_SKIP = 15;
  const SESSION_CAP = 3;

  let __live = [];
  let __loadedAt = 0;
  let __unsub = null;
  let __rr = { 'in-feed': 0, 'broadcast-break': 0 };
  const __sessionHits = {};

  function escapeHtml(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&')
      .replace(/</g, '<')
      .replace(/>/g, '>')
      .replace(/"/g, '"')
      .replace(/'/g, '&#39;');
  }

  function httpsUrl(raw) {
    const s = String(raw || '').trim();
    if (!s) return '';
    if (!/^https:\/\//i.test(s)) return '';
    if (/[\s<>"'`]/.test(s)) return '';
    if (/javascript:/i.test(s) || /data:/i.test(s)) return '';
    return s;
  }

  function placementsOf(ad) {
    const p = ad && ad.placements;
    if (Array.isArray(p) && p.length) return p.map(String);
    const one = ad && ad.placement ? String(ad.placement) : '';
    if (one === 'both') return ['in-feed', 'broadcast-break'];
    if (one) return [one];
    return ['in-feed'];
  }

  function isLive(ad) {
    if (!ad) return false;
    return String(ad.status || '') === 'live' && !!(ad.mediaUrl || ad.creativeUrl);
  }

  function mediaUrlOf(ad) {
    if (!ad) return '';
    const raw = ad.mediaUrl || ad.creativeUrl || '';
    if (!raw) return '';
    if (typeof resolveMediaUrl === 'function') return resolveMediaUrl(raw);
    return raw;
  }

  function skipAfterOf(ad) {
    const n = Number(ad && (ad.skipAfterSec != null ? ad.skipAfterSec : ad.skipAfter));
    if (!isFinite(n) || n < 0) return DEFAULT_SKIP;
    return Math.min(MAX_SKIP, Math.max(0, Math.round(n)));
  }

  function sessionKey(ad, place) {
    return String((ad && ad.id) || '') + ':' + String(place || '');
  }

  function underCap(ad, place) {
    const k = sessionKey(ad, place);
    return (__sessionHits[k] || 0) < SESSION_CAP;
  }

  function markShown(ad, place) {
    const k = sessionKey(ad, place);
    __sessionHits[k] = (__sessionHits[k] || 0) + 1;
  }

  function liveFor(place) {
    const want = String(place || '');
    return __live.filter(function (ad) {
      if (!isLive(ad)) return false;
      if (want && placementsOf(ad).indexOf(want) < 0) return false;
      return underCap(ad, want);
    });
  }

  function pick(place) {
    const list = liveFor(place);
    if (!list.length) return null;
    const key = String(place || 'in-feed');
    const i = (__rr[key] || 0) % list.length;
    __rr[key] = i + 1;
    return list[i];
  }

  function weaveHtml(cards, place) {
    const list = liveFor(place || 'in-feed');
    if (!list.length || !cards || !cards.length) return cards || [];
    const out = [];
    let n = 0;
    for (let i = 0; i < cards.length; i++) {
      out.push(cards[i]);
      if ((i + 1) % FREQUENCY === 0) {
        const ad = list[n % list.length];
        if (ad) {
          out.push(plateHtml(ad));
          n++;
        }
      }
    }
    return out;
  }

  function plateHtml(ad) {
    if (!ad) return '';
    const src = mediaUrlOf(ad);
    const poster = ad.thumbUrl || '';
    const isVideo = String(ad.mediaType || '').indexOf('image') !== 0;
    const media = isVideo
      ? '<video class="strand-preview naluno-ad-preview" muted playsinline webkit-playsinline loop preload="none" poster="'
        + escapeHtml(poster) + '" data-preview-src="' + escapeHtml(src) + '" data-naluno-preview="1"></video>'
      : '<img src="' + escapeHtml(src || poster) + '" alt="" class="bcast-plate-media" />';
    const posterBit = (isVideo && poster)
      ? '<img src="' + escapeHtml(poster) + '" alt="" class="strand-poster" />'
      : '';
    return '<article class="bcast-plate naluno-ad-plate" data-ad-id="' + escapeHtml(ad.id) + '" role="button" tabindex="0">'
      + '<div class="bcast-plate-frame">'
      + posterBit + media
      + '<span class="naluno-ad-kicker">Ad</span>'
      + '<span class="strand-playhint" aria-hidden="true">▶</span>'
      + '<div class="bcast-plate-scan"></div>'
      + '</div>'
      + '<div class="bcast-plate-meta">'
      + '<div class="bcast-plate-title">' + escapeHtml((ad.headline || ad.advertiser || 'Sponsored').slice(0, 72)) + '</div>'
      + '<div class="bcast-plate-sub">' + escapeHtml((ad.advertiser || 'Sponsored').slice(0, 40)) + ' · Ad</div>'
      + '</div>'
      + '</article>';
  }

  function injectStyle() {
    if (typeof document === 'undefined') return;
    if (document.getElementById('nalunoAdCss')) return;
    const css = document.createElement('style');
    css.id = 'nalunoAdCss';
    css.textContent =
      '.naluno-ad-kicker{position:absolute;left:10px;top:10px;z-index:4;padding:3px 8px;border-radius:999px;'
      + 'background:rgba(13,15,23,.78);border:1px solid rgba(124,255,178,.45);color:#7CFFB2;'
      + 'font-family:var(--font-mono, ui-monospace, monospace);font-size:10px;letter-spacing:.12em;text-transform:uppercase;}'
      + '.naluno-ad-plate .bcast-plate-sub{color:#7CFFB2;}'
      + '#nalunoAdViewer{position:fixed;inset:0;z-index:80;background:#07080D;display:flex;flex-direction:column;}'
      + '#nalunoAdViewer.hidden{display:none !important;}'
      + '#nalunoAdViewer .ad-stage{flex:1;position:relative;background:#000;display:flex;align-items:center;justify-content:center;}'
      + '#nalunoAdViewer video,#nalunoAdViewer img{width:100%;height:100%;object-fit:contain;background:#000;}'
      + '#nalunoAdViewer .ad-chrome{position:absolute;left:0;right:0;top:0;padding:14px 16px;display:flex;align-items:center;gap:10px;'
      + 'background:linear-gradient(180deg,rgba(0,0,0,.55),transparent);z-index:2;}'
      + '#nalunoAdViewer .ad-cta{position:absolute;left:16px;right:16px;bottom:28px;z-index:2;display:flex;gap:10px;}'
      + '#nalunoAdViewer .ad-cta button,#nalunoAdViewer .ad-skip{'
      + 'flex:1;padding:14px 16px;border-radius:12px;border:1px solid rgba(124,255,178,.4);'
      + 'font-family:var(--font-mono, ui-monospace, monospace);font-size:13px;letter-spacing:.04em;cursor:pointer;}'
      + '#nalunoAdViewer .ad-cta .go{background:#7CFFB2;color:#07080D;border:none;}'
      + '#nalunoAdViewer .ad-cta .skip,#nalunoAdViewer .ad-skip{background:rgba(13,15,23,.7);color:#E8ECF5;}'
      + '#nalunoAdViewer .ad-skip[disabled]{opacity:.55;cursor:default;}';
    document.head.appendChild(css);
  }

  function bindPlates(grid) {
    if (!grid || typeof document === 'undefined') return;
    grid.querySelectorAll('[data-ad-id]').forEach(function (el) {
      if (el.__nalunoAdBound) return;
      el.__nalunoAdBound = true;
      el.onclick = function (e) {
        if (e) { e.preventDefault(); e.stopPropagation(); }
        const id = el.getAttribute('data-ad-id');
        const ad = __live.filter(function (a) { return a.id === id; })[0];
        if (ad) openViewer(ad, 'in-feed');
      };
    });
  }

  function injectFeed(grid) {
    if (!grid || typeof document === 'undefined') return;
    injectStyle();
    const ads = liveFor('in-feed');
    if (!ads.length) return;
    const kids = Array.prototype.slice.call(grid.children || []);
    if (kids.length < 2) return;
    let inserted = 0;
    const every = FREQUENCY;
    for (let i = every - 1; i < kids.length; i += every) {
      const ad = ads[inserted % ads.length];
      if (!ad) break;
      const wrap = document.createElement('div');
      wrap.innerHTML = plateHtml(ad);
      const node = wrap.firstElementChild;
      if (!node) continue;
      const ref = kids[i];
      if (ref && ref.parentNode === grid) grid.insertBefore(node, ref);
      else grid.appendChild(node);
      markShown(ad, 'in-feed');
      inserted++;
    }
    bindPlates(grid);
  }

  function track(ad, kind) {
    if (!ad || !ad.id) return;
    const field = kind === 'click' ? 'clicks' : (kind === 'skip' ? 'skips' : 'impressions');
    try {
      const db = (typeof fbDb !== 'undefined' && fbDb) ? fbDb : null;
      if (!db) return;
      const ref = db.collection(COL).doc(ad.id);
      const inc = (typeof firebase !== 'undefined' && firebase.firestore && firebase.firestore.FieldValue)
        ? firebase.firestore.FieldValue.increment(1)
        : null;
      const patch = { updatedAt: Date.now() };
      if (inc) patch[field] = inc;
      else patch[field] = (Number(ad[field]) || 0) + 1;
      ref.set(patch, { merge: true }).catch(function () {});
    } catch (_) {}
  }

  function closeViewer() {
    if (typeof document === 'undefined') return;
    const el = document.getElementById('nalunoAdViewer');
    if (!el) return;
    try {
      el.querySelectorAll('video, audio').forEach(function (v) {
        try {
          v.dataset.nalunoUserPaused = '1';
          v.dataset.nalunoWantPlay = '0';
          v.pause();
          v.muted = true;
          v.removeAttribute('src');
          v.load();
        } catch (_) {}
      });
    } catch (_) {}
    el.classList.add('hidden');
    el.innerHTML = '';
  }

  function openViewer(ad, place) {
    if (!ad || typeof document === 'undefined') return;
    injectStyle();
    try {
      if (typeof nalunoPauseLeavingMedia === 'function') nalunoPauseLeavingMedia();
      else if (typeof nalunoExclusiveMedia === 'function') nalunoExclusiveMedia(null);
    } catch (_) {}
    let host = document.getElementById('nalunoAdViewer');
    if (!host) {
      host = document.createElement('div');
      host.id = 'nalunoAdViewer';
      host.setAttribute('role', 'dialog');
      host.setAttribute('aria-label', 'Advertisement');
      document.body.appendChild(host);
    }
    const src = mediaUrlOf(ad);
    const isVideo = String(ad.mediaType || '').indexOf('image') !== 0;
    const skipAt = skipAfterOf(ad);
    const ctaUrl = httpsUrl(ad.ctaUrl);
    const ctaLabel = (ad.ctaLabel || 'Open').slice(0, 24);
    const media = isVideo
      ? '<video id="nalunoAdVideo" playsinline webkit-playsinline autoplay></video>'
      : '<img src="' + escapeHtml(src) + '" alt="" />';
    host.classList.remove('hidden');
    host.innerHTML =
      '<div class="ad-stage">'
      + media
      + '<div class="ad-chrome">'
      + '<span class="naluno-ad-kicker">Ad</span>'
      + '<span style="color:#E8ECF5;font-size:14px;">' + escapeHtml((ad.advertiser || ad.headline || 'Sponsored').slice(0, 48)) + '</span>'
      + '<button type="button" class="ad-skip" id="nalunoAdClose" style="margin-left:auto;flex:0 0 auto;padding:8px 12px;">Close</button>'
      + '</div>'
      + '<div class="ad-cta">'
      + (ctaUrl ? '<button type="button" class="go" id="nalunoAdCta">' + escapeHtml(ctaLabel) + '</button>' : '')
      + '<button type="button" class="skip" id="nalunoAdSkip" disabled>Skip in ' + skipAt + 's</button>'
      + '</div>'
      + '</div>';
    track(ad, 'impression');
    markShown(ad, place || 'in-feed');

    const v = document.getElementById('nalunoAdVideo');
    if (v && src) {
      try {
        v.dataset.nalunoWantPlay = '1';
        v.dataset.nalunoUserPaused = '0';
        v.muted = false;
      } catch (_) {}
      v.src = src;
      const p = v.play();
      if (p && p.catch) {
        p.catch(function () {
          try { v.muted = true; v.play().catch(function () {}); } catch (_) {}
        });
      }
      v.onended = function () { closeViewer(); };
    }

    let left = skipAt;
    const skipBtn = document.getElementById('nalunoAdSkip');
    const tick = setInterval(function () {
      left -= 1;
      if (!document.getElementById('nalunoAdViewer') || document.getElementById('nalunoAdViewer').classList.contains('hidden')) {
        clearInterval(tick);
        return;
      }
      if (left <= 0) {
        clearInterval(tick);
        if (skipBtn) {
          skipBtn.disabled = false;
          skipBtn.textContent = 'Skip';
        }
      } else if (skipBtn) {
        skipBtn.textContent = 'Skip in ' + left + 's';
      }
    }, 1000);
    if (skipAt <= 0 && skipBtn) {
      skipBtn.disabled = false;
      skipBtn.textContent = 'Skip';
    }

    const closeBtn = document.getElementById('nalunoAdClose');
    if (closeBtn) closeBtn.onclick = function () { closeViewer(); };
    if (skipBtn) {
      skipBtn.onclick = function () {
        if (skipBtn.disabled) return;
        track(ad, 'skip');
        closeViewer();
      };
    }
    const cta = document.getElementById('nalunoAdCta');
    if (cta && ctaUrl) {
      cta.onclick = function () {
        track(ad, 'click');
        try { window.open(ctaUrl, '_blank', 'noopener'); } catch (_) { location.href = ctaUrl; }
      };
    }
  }

  function breatherSlot(place) {
    const ad = pick(place || 'broadcast-break');
    if (!ad) {
      return { enabled: true, status: 'reserved' };
    }
    markShown(ad, 'broadcast-break');
    const skip = skipAfterOf(ad);
    const src = mediaUrlOf(ad);
    const isVideo = String(ad.mediaType || '').indexOf('image') !== 0;
    const ctaUrl = httpsUrl(ad.ctaUrl);
    const media = isVideo
      ? '<video class="naluno-break-ad" playsinline webkit-playsinline autoplay muted src="' + escapeHtml(src) + '" style="width:min(72vw,240px);height:min(40vh,420px);object-fit:cover;border-radius:12px;background:#000;"></video>'
      : '<img src="' + escapeHtml(src) + '" alt="" style="width:min(72vw,240px);height:min(40vh,420px);object-fit:cover;border-radius:12px;" />';
    const html = '<div class="naluno-break-wrap" data-ad-id="' + escapeHtml(ad.id) + '" style="display:flex;flex-direction:column;align-items:center;gap:10px;">'
      + '<span class="naluno-ad-kicker" style="position:static;">Ad</span>'
      + media
      + '<div style="color:#E8ECF5;font-size:14px;text-align:center;">' + escapeHtml((ad.headline || '').slice(0, 72)) + '</div>'
      + '<div style="color:#7C8497;font-size:12px;">' + escapeHtml((ad.advertiser || '').slice(0, 40)) + '</div>'
      + (ctaUrl ? '<button type="button" class="naluno-break-cta" data-cta="' + escapeHtml(ctaUrl) + '" style="padding:10px 16px;border-radius:10px;border:none;background:#7CFFB2;color:#07080D;font-size:13px;cursor:pointer;">' + escapeHtml((ad.ctaLabel || 'Open').slice(0, 24)) + '</button>' : '')
      + '</div>';
    return {
      enabled: true,
      status: 'ready',
      adId: ad.id,
      skipAfterSec: skip,
      maxDurationMs: Math.max(1200, (skip + 8) * 1000),
      creativeHtml: html,
      ad: ad,
    };
  }

  function wireBreather(host, slot) {
    if (!host || !slot || slot.status !== 'ready') return;
    const ad = slot.ad;
    if (ad) track(ad, 'impression');
    try {
      const v = host.querySelector('video.naluno-break-ad');
      if (v) {
        const p = v.play();
        if (p && p.catch) p.catch(function () {});
      }
    } catch (_) {}
    const cta = host.querySelector('.naluno-break-cta');
    if (cta && ad) {
      cta.onclick = function (e) {
        if (e) { e.preventDefault(); e.stopPropagation(); }
        const url = httpsUrl(cta.getAttribute('data-cta') || ad.ctaUrl);
        if (!url) return;
        track(ad, 'click');
        try { window.open(url, '_blank', 'noopener'); } catch (_) { location.href = url; }
      };
    }
  }

  function normalize(row) {
    if (!row) return null;
    const id = row.id || row.adId || '';
    if (!id) return null;
    return {
      id: id,
      status: String(row.status || 'paused'),
      placements: placementsOf(row),
      headline: String(row.headline || '').slice(0, 80),
      advertiser: String(row.advertiser || row.advertiserName || '').slice(0, 60),
      ctaLabel: String(row.ctaLabel || 'Open').slice(0, 24),
      ctaUrl: String(row.ctaUrl || ''),
      mediaUrl: row.mediaUrl || row.creativeUrl || '',
      mediaType: row.mediaType || 'video',
      thumbUrl: row.thumbUrl || '',
      skipAfterSec: skipAfterOf(row),
      impressions: Number(row.impressions) || 0,
      clicks: Number(row.clicks) || 0,
      skips: Number(row.skips) || 0,
      createdAt: Number(row.createdAt) || 0,
      updatedAt: Number(row.updatedAt) || 0,
      bytes: Number(row.bytes) || 0,
    };
  }

  function applyDocs(docs) {
    __live = (docs || []).map(normalize).filter(function (a) { return a && isLive(a); });
    __loadedAt = Date.now();
    return __live;
  }

  function load(force) {
    if (!force && __live.length && (Date.now() - __loadedAt < 20000)) {
      return Promise.resolve(__live);
    }
    const db = (typeof fbDb !== 'undefined' && fbDb) ? fbDb : null;
    if (!db) return Promise.resolve(__live);
    return db.collection(COL).where('status', '==', 'live').limit(40).get()
      .then(function (snap) {
        const rows = [];
        snap.forEach(function (d) { rows.push(Object.assign({ id: d.id }, d.data() || {})); });
        return applyDocs(rows);
      })
      .catch(function () { return __live; });
  }

  function listen() {
    if (__unsub) return;
    const db = (typeof fbDb !== 'undefined' && fbDb) ? fbDb : null;
    if (!db) return;
    try {
      __unsub = db.collection(COL).where('status', '==', 'live').limit(40)
        .onSnapshot(function (snap) {
          const rows = [];
          snap.forEach(function (d) { rows.push(Object.assign({ id: d.id }, d.data() || {})); });
          applyDocs(rows);
        }, function () {});
    } catch (_) {}
  }

  function boot() {
    injectStyle();
    function go() {
      load(false).then(function () { listen(); });
    }
    if (typeof fbDb !== 'undefined' && fbDb) go();
    else {
      let n = 0;
      const iv = setInterval(function () {
        n++;
        if ((typeof fbDb !== 'undefined' && fbDb) || n > 40) {
          clearInterval(iv);
          if (typeof fbDb !== 'undefined' && fbDb) go();
        }
      }, 250);
    }
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
  }

  root.NalunoAds = {
    FREQUENCY: FREQUENCY,
    DEFAULT_SKIP: DEFAULT_SKIP,
    pick: pick,
    liveFor: liveFor,
    weaveHtml: weaveHtml,
    plateHtml: plateHtml,
    injectFeed: injectFeed,
    bindPlates: bindPlates,
    breatherSlot: breatherSlot,
    wireBreather: wireBreather,
    openViewer: openViewer,
    closeViewer: closeViewer,
    track: track,
    load: load,
    listen: listen,
    applyDocs: applyDocs,
    normalize: normalize,
    httpsUrl: httpsUrl,
    skipAfterOf: skipAfterOf,
    placementsOf: placementsOf,
    mediaUrlOf: mediaUrlOf,
  };
})(typeof window !== 'undefined' ? window : globalThis);
