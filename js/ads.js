/* ============================================================
   MODULE: js/ads.js
   First-party native ads. Inventory is uploaded from the Control
   Centre into Firestore `deskAds` + Cloudflare R2. The member app
   only reads live rows. No third-party network, no tracker, no
   auction. Every unit is labelled Ad.

   Placements:
     watch-break      — skippable overlay after every N minutes of watching
     broadcast-break  — skippable chapter-break inside a Broadcast

   OWNERSHIP: inventory, pick, render, skip, impression/click/view.
   Playback pause lives in media-contain.js (nalunoPauseLeavingMedia).
   ============================================================ */
(function (root) {
  const COL = 'deskAds';
  const DEFAULT_EVERY_MIN = 1;
  const DEFAULT_SKIP = 5;
  const MAX_SKIP = 15;
  const SESSION_CAP = 3;
  const DEFAULT_VIEW_SEC = 15;
  let __everyMin = DEFAULT_EVERY_MIN;
  let __viewCompleteSec = DEFAULT_VIEW_SEC;

  let __live = [];
  let __loadedAt = 0;
  let __unsub = null;
  let __rr = { 'in-feed': 0, 'broadcast-break': 0, 'watch-break': 0 };
  const __sessionHits = {};
  let __watchAccum = 0;
  let __watchLast = 0;
  let __adOpen = false;
  let __pausedForAd = null;
  let __watchTimer = null;
  let __viewTimer = null;
  let __viewThisOpen = false;
  let __endTimer = null;
  let __adFinish = null;

  function escapeHtml(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&' + 'amp;')
      .replace(/</g, '&' + 'lt;')
      .replace(/>/g, '&' + 'gt;')
      .replace(/"/g, '&' + 'quot;')
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

  function clampMin(n) {
    n = Number(n);
    if (!isFinite(n) || n < 1) return 1;
    return Math.min(30, Math.round(n));
  }
  function everyMin() {
    try {
      if (typeof nalunoEconomyFlags !== 'undefined' && nalunoEconomyFlags && nalunoEconomyFlags.adEveryMin != null) {
        return clampMin(nalunoEconomyFlags.adEveryMin);
      }
    } catch (_) {}
    return clampMin(__everyMin);
  }
  function setEveryMin(n) {
    __everyMin = clampMin(n);
    return __everyMin;
  }
  function intervalMs() {
    return everyMin() * 60 * 1000;
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
    // Time-based breaks replaced the every-four-cards weave.
    return cards || [];
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
      + '#nalunoAdViewer{position:fixed;inset:0;z-index:260 !important;background:#07080D;display:flex;flex-direction:column;}'
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
      + '#nalunoAdViewer .ad-skip[disabled]{opacity:.55;cursor:default;}'
      + '#nalunoAdViewer .naluno-ad-sound{position:absolute;right:14px;top:14px;z-index:3;padding:8px 12px;border-radius:999px;'
      + 'background:rgba(13,15,23,.78);border:1px solid rgba(124,255,178,.45);color:#7CFFB2;'
      + 'font-family:var(--font-mono, ui-monospace, monospace);font-size:11px;letter-spacing:.08em;text-transform:uppercase;cursor:pointer;}'
      + '#nalunoAdViewer .naluno-ad-sound.muted{color:#E8ECF5;border-color:rgba(232,236,245,.35);}';
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
    bindPlates(grid);
  }

  function fieldForKind(kind) {
    if (kind === 'click') return 'clicks';
    if (kind === 'skip') return 'skips';
    if (kind === 'view') return 'viewCompletes';
    return 'impressions';
  }
  function clampViewSec(n) {
    n = Math.round(Number(n) || DEFAULT_VIEW_SEC);
    if (!isFinite(n) || n < 1) return DEFAULT_VIEW_SEC;
    return Math.min(60, n);
  }
  function viewCompleteSec() {
    try {
      if (typeof nalunoAdRates !== 'undefined' && nalunoAdRates && nalunoAdRates.viewCompleteSec != null) {
        return clampViewSec(nalunoAdRates.viewCompleteSec);
      }
    } catch (_) {}
    return clampViewSec(__viewCompleteSec);
  }
  function setViewCompleteSec(n) {
    __viewCompleteSec = clampViewSec(n);
    return __viewCompleteSec;
  }
  function loadAdRates() {
    const db = (typeof fbDb !== 'undefined' && fbDb) ? fbDb : null;
    if (!db) return;
    try {
      db.collection('economyConfig').doc('adRates').get().then(function (s) {
        if (!s || !s.exists) return;
        const d = s.data() || {};
        __viewCompleteSec = clampViewSec(d.viewCompleteSec);
        try { window.nalunoAdRates = d; } catch (_) {}
      }).catch(function () {});
    } catch (_) {}
  }
  function disarmViewComplete() {
    if (__viewTimer) {
      try { clearInterval(__viewTimer); } catch (_) {}
      __viewTimer = null;
    }
  }
  function armViewComplete(ad, videoEl) {
    disarmViewComplete();
    __viewThisOpen = false;
    if (!ad || !ad.id) return;
    const need = viewCompleteSec() * 1000;
    let accum = 0;
    let last = Date.now();
    __viewTimer = setInterval(function () {
      const now = Date.now();
      const dt = Math.min(2000, now - last);
      last = now;
      let playing = true;
      if (videoEl) {
        try { playing = !videoEl.paused && !videoEl.ended; } catch (_) {}
      }
      if (playing) accum += dt;
      if (accum >= need && !__viewThisOpen) {
        __viewThisOpen = true;
        disarmViewComplete();
        track(ad, 'view');
      }
    }, 400);
  }
  function track(ad, kind) {
    if (!ad || !ad.id) return;
    const field = fieldForKind(kind);
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

  function isWatchVideo(el) {
    if (!el || el.paused || el.ended) return false;
    try {
      if (el.dataset && el.dataset.nalunoPreview === '1') return false;
      if (el.classList && el.classList.contains('strand-preview')) return false;
      if (el.classList && el.classList.contains('naluno-break-ad')) return false;
      if (el.id === 'nalunoAdVideo') return false;
      if (el.closest && el.closest('#nalunoAdViewer, #bspaceBreather, #callOverlay, #composer, #bcomposer, #camStage')) return false;
      if (el.srcObject) return false;
    } catch (_) {}
    return true;
  }
  function snapshotEl(el) {
    if (!el) return null;
    let muted = true, vol = 1, time = 0;
    try { muted = !!el.muted; } catch (_) {}
    try {
      vol = (typeof el.volume === 'number' && isFinite(el.volume) && el.volume > 0) ? el.volume : 1;
    } catch (_) {}
    try { time = el.currentTime || 0; } catch (_) {}
    return { el: el, muted: muted, volume: vol, time: time };
  }
  function clearEndTimer() {
    if (__endTimer) {
      try { clearTimeout(__endTimer); } catch (_) {}
      __endTimer = null;
    }
    __adFinish = null;
  }
  function playAdWithSound(v, soundBtn) {
    if (!v) return;
    try {
      v.defaultMuted = false;
      v.muted = false;
      v.volume = 1;
      v.loop = false;
      v.dataset.nalunoWantPlay = '1';
      v.dataset.nalunoUserPaused = '0';
      v.removeAttribute('muted');
    } catch (_) {}
    function markSound(on) {
      if (!soundBtn) return;
      soundBtn.classList.toggle('muted', !on);
      soundBtn.textContent = on ? 'Sound on' : 'Tap for sound';
    }
    markSound(true);
    const go = function () {
      const p = v.play();
      if (p && p.catch) {
        p.catch(function () {
          try {
            v.muted = false;
            v.volume = 1;
            const p2 = v.play();
            if (p2 && p2.catch) {
              p2.catch(function () {
                try {
                  v.muted = true;
                  v.play().then(function () {
                    try { v.muted = false; v.volume = 1; } catch (_) {}
                    markSound(!v.muted);
                  }).catch(function () { markSound(false); });
                } catch (_) { markSound(false); }
              });
            }
          } catch (_) { markSound(false); }
        });
      }
    };
    go();
    if (soundBtn) {
      soundBtn.onclick = function (e) {
        if (e) { e.preventDefault(); e.stopPropagation(); }
        try {
          v.muted = false;
          v.volume = 1;
          v.play().catch(function () {});
          markSound(true);
        } catch (_) {}
      };
    }
  }
  function resumeAfterAd() {
    const snap = __pausedForAd;
    __pausedForAd = null;
    if (!snap || !snap.el) return;
    const el = snap.el;
    try {
      el.dataset.nalunoUserPaused = '0';
      el.dataset.nalunoWantPlay = '1';
      el.dataset.nalunoKeepAlive = '1';
      el.muted = false;
      el.volume = (snap.volume > 0 ? snap.volume : 1);
      const p = el.play();
      if (p && p.catch) {
        p.catch(function () {
          try {
            el.muted = false;
            el.volume = snap.volume > 0 ? snap.volume : 1;
            el.play().catch(function () {});
          } catch (_) {}
        });
      }
    } catch (_) {}
  }
  function closeViewer() {
    disarmViewComplete();
    clearEndTimer();
    __adOpen = false;
    if (typeof document === 'undefined') {
      resumeAfterAd();
      return;
    }
    const el = document.getElementById('nalunoAdViewer');
    if (el) {
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
    resumeAfterAd();
  }
  function maybeWatchBreak() {
    if (__adOpen) return;
    if (typeof document === 'undefined') return;
    if (__watchAccum < intervalMs()) return;
    const playing = Array.prototype.slice.call(document.querySelectorAll('video')).filter(isWatchVideo)[0];
    if (!playing) return;
    const ad = pick('in-feed') || pick('broadcast-break');
    if (!ad) { __watchAccum = 0; return; }
    __pausedForAd = snapshotEl(playing);
    try {
      playing.dataset.nalunoUserPaused = '1';
      playing.dataset.nalunoWantPlay = '0';
      playing.pause();
    } catch (_) {}
    __watchAccum = 0;
    openViewer(ad, 'watch-break');
  }
  function tickWatch() {
    if (typeof document === 'undefined') return;
    const now = Date.now();
    if (!__watchLast) __watchLast = now;
    const dt = Math.min(2500, now - __watchLast);
    __watchLast = now;
    if (__adOpen) return;
    let watching = false;
    try {
      watching = Array.prototype.slice.call(document.querySelectorAll('video')).some(isWatchVideo);
    } catch (_) {}
    if (watching) {
      __watchAccum += dt;
      maybeWatchBreak();
    }
  }
  function startWatchClock() {
    if (__watchTimer || typeof document === 'undefined') return;
    __watchLast = Date.now();
    __watchTimer = setInterval(tickWatch, 1000);
  }

  function openViewer(ad, place) {
    if (!ad || typeof document === 'undefined') return;
    __adOpen = true;
    injectStyle();
    try {
      if (typeof nalunoExclusiveMedia === 'function') nalunoExclusiveMedia(null);
    } catch (_) {}
    let host = document.getElementById('nalunoAdViewer');
    if (!host) {
      host = document.createElement('div');
      host.id = 'nalunoAdViewer';
      host.setAttribute('role', 'dialog');
      host.setAttribute('aria-label', 'Advertisement');
    }
    try { document.body.appendChild(host); } catch (_) {}
    host.style.zIndex = '260';
    host.style.position = 'fixed';
    host.style.inset = '0';
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
      + '</div>'
      + (isVideo ? '<button type="button" class="naluno-ad-sound" id="nalunoAdSound">Sound on</button>' : '')
      + '<div class="ad-cta">'
      + (ctaUrl ? '<button type="button" class="go" id="nalunoAdCta">' + escapeHtml(ctaLabel) + '</button>' : '')
      + '<button type="button" class="skip" id="nalunoAdSkip" disabled>Skip in ' + skipAt + 's</button>'
      + '</div>'
      + '</div>';
    track(ad, 'impression');
    markShown(ad, place || 'in-feed');

    const finish = function () {
      closeViewer();
    };
    __adFinish = finish;

    const v = document.getElementById('nalunoAdVideo');
    const soundBtn = document.getElementById('nalunoAdSound');
    if (v && src) {
      playAdWithSound(v, soundBtn);
      v.src = src;
      try { v.load(); } catch (_) {}
      playAdWithSound(v, soundBtn);
      v.onended = function () { finish(); };
      v.onerror = function () {
        if (!skipAt) finish();
      };
      try {
        if (typeof nalunoExclusiveMedia === 'function') nalunoExclusiveMedia(v);
      } catch (_) {}
      armViewComplete(ad, v);
      v.addEventListener('loadedmetadata', function () {
        try {
          if (isFinite(v.duration) && v.duration > 0 && v.duration < 120) {
            /* natural ended handles resume; keep a safety net a beat after duration */
            clearEndTimer();
            __endTimer = setTimeout(function () {
              if (__adOpen) finish();
            }, Math.round(v.duration * 1000) + 800);
          }
        } catch (_) {}
      });
    } else {
      armViewComplete(ad, null);
      const hold = Math.max(skipAt, viewCompleteSec(), 8) * 1000;
      clearEndTimer();
      __endTimer = setTimeout(function () {
        if (__adOpen) finish();
      }, hold);
    }
    host.onclick = function () {
      const av = document.getElementById('nalunoAdVideo');
      if (av) {
        try { av.muted = false; av.volume = 1; av.play().catch(function () {}); } catch (_) {}
        if (soundBtn) {
          soundBtn.classList.remove('muted');
          soundBtn.textContent = 'Sound on';
        }
      }
    };

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

    if (skipBtn) {
      skipBtn.onclick = function (e) {
        if (e) { e.preventDefault(); e.stopPropagation(); }
        if (skipBtn.disabled) return;
        disarmViewComplete();
        track(ad, 'skip');
        closeViewer();
      };
    }
    const cta = document.getElementById('nalunoAdCta');
    if (cta && ctaUrl) {
      cta.onclick = function (e) {
        if (e) { e.preventDefault(); e.stopPropagation(); }
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
      ? '<video class="naluno-break-ad" playsinline webkit-playsinline autoplay src="' + escapeHtml(src) + '" style="position:absolute;inset:0;width:100%;height:100%;object-fit:contain;background:#000;"></video>'
      : '<img src="' + escapeHtml(src) + '" alt="" style="position:absolute;inset:0;width:100%;height:100%;object-fit:contain;background:#000;" />';
    const html = '<div class="naluno-break-wrap" data-ad-id="' + escapeHtml(ad.id) + '" style="position:absolute;inset:0;">'
      + media
      + '<span class="naluno-ad-kicker" style="position:absolute;left:10px;top:10px;">Ad</span>'
      + '<button type="button" class="naluno-ad-sound" style="position:absolute;right:10px;top:10px;">Sound on</button>'
      + '<div style="position:absolute;left:16px;right:16px;bottom:86px;color:#E8ECF5;font-size:14px;text-align:center;">' + escapeHtml((ad.headline || '').slice(0, 72)) + '</div>'
      + '<div style="position:absolute;left:16px;right:16px;bottom:66px;color:#7C8497;font-size:12px;text-align:center;">' + escapeHtml((ad.advertiser || '').slice(0, 40)) + '</div>'
      + (ctaUrl ? '<button type="button" class="naluno-break-cta" data-cta="' + escapeHtml(ctaUrl) + '" style="position:absolute;left:16px;right:16px;bottom:16px;padding:12px 16px;border-radius:10px;border:none;background:#7CFFB2;color:#07080D;font-size:13px;cursor:pointer;">' + escapeHtml((ad.ctaLabel || 'Open').slice(0, 24)) + '</button>' : '')
      + '</div>';
    return {
      enabled: true,
      status: 'ready',
      adId: ad.id,
      skipAfterSec: skip,
      maxDurationMs: isVideo ? 0 : Math.max(skip, viewCompleteSec(), 8) * 1000,
      creativeHtml: html,
      ad: ad,
    };
  }

  function wireBreather(host, slot, onEnded) {
    if (!host || !slot || slot.status !== 'ready') return;
    const ad = slot.ad;
    if (ad) track(ad, 'impression');
    try {
      const v = host.querySelector('video.naluno-break-ad');
      const soundBtn = host.querySelector('.naluno-ad-sound');
      if (v) {
        playAdWithSound(v, soundBtn);
        v.onended = function () { if (typeof onEnded === 'function') onEnded(); };
        v.onerror = function () { if (typeof onEnded === 'function') onEnded(); };
        armViewComplete(ad, v);
        v.addEventListener('loadedmetadata', function () {
          try {
            if (isFinite(v.duration) && v.duration > 0) {
              slot.maxDurationMs = Math.round(v.duration * 1000) + 800;
            }
          } catch (_) {}
        });
      } else {
        if (soundBtn) soundBtn.style.display = 'none';
        armViewComplete(ad, null);
        if (typeof onEnded === 'function') {
          const hold = slot.maxDurationMs || Math.max(skipAfterOf(ad), viewCompleteSec(), 8) * 1000;
          setTimeout(onEnded, hold);
        }
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
      viewCompletes: Number(row.viewCompletes) || 0,
      billModel: (function () { const m = String(row.billModel || 'cpm').toLowerCase(); return (m === 'cpc' || m === 'cpv') ? m : 'cpm'; })(),
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
    startWatchClock();
    function go() {
      loadAdRates();
      load(false).then(function () { listen(); });
    }
    if (typeof fbDb !== 'undefined' && fbDb) go();
    else if (typeof firebase !== 'undefined' && firebase.auth) {
      try {
        firebase.auth().onAuthStateChanged(function () { go(); });
      } catch (_) { go(); }
    } else {
      setTimeout(go, 1200);
    }
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
  }

  root.NalunoAds = {
    DEFAULT_EVERY_MIN: DEFAULT_EVERY_MIN,
    DEFAULT_SKIP: DEFAULT_SKIP,
    everyMin: everyMin,
    setEveryMin: setEveryMin,
    intervalMs: intervalMs,
    clampMin: clampMin,
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
    fieldForKind: fieldForKind,
    viewCompleteSec: viewCompleteSec,
    setViewCompleteSec: setViewCompleteSec,
    armViewComplete: armViewComplete,
    disarmViewComplete: disarmViewComplete,
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
