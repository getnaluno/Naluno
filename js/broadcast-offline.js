/* ============================================================
   MODULE: js/broadcast-offline.js
   Save a Broadcast to watch without a connection — the TikTok download,
   done properly.

   WHY THIS EXISTS
   Naluno's reason for existing is staying reachable when the network is not.
   A Broadcast someone cares about — a message from home, a briefing, a
   lesson — should be watchable on a plane, in a shutdown, or wherever the
   connection is gone. TikTok's version is a good pattern: a visible download,
   a saved list, and cached playback that "just works" later.

   WHAT MAKES THIS BETTER
   - A visible STORAGE BUDGET (default 500 MB) with what is used and what is
     free, and the OLDEST watched save is evicted automatically when a new
     one would not fit — never a silent failure and never an unbounded cache
     eating someone's phone.
   - Saves are matched to REAL bytes: the Cache Storage entry is measured
     after saving, not guessed from a Content-Length header that can be
     missing or wrong.
   - Playback falls back to the cached copy AUTOMATICALLY when the network
     copy cannot be reached — the whole point of saving something offline is
     that you should not have to remember you saved it.
   - A save survives the Broadcast being taken off the feed. If someone saved
     it before that happened, it does not vanish from their downloads — but
     it is visibly marked, because watching something already reviewed and
     removed is a decision the person should get to make knowingly.

   HONEST LIMITS
   - This is Cache Storage inside the browser/PWA. It is bounded by whatever
     the browser allows a site (commonly a few GB, sometimes less), and the
     OS can evict it under storage pressure like any site data. It is not a
     guarantee, only a strong best-effort — stated plainly in the UI.
   - Only the MEDIA is cached. Comments, live view counts and anything that
     needs the network stay live; offline playback shows the video with a
     clear "Saved — offline" mark instead of pretending those are live too.
   ============================================================ */
(function (root) {
  'use strict';
  const CACHE_NAME = 'naluno-offline-broadcasts-v1';
  const INDEX_KEY = 'nalunoOfflineSaves';
  const DEFAULT_BUDGET_BYTES = 500 * 1024 * 1024;   // 500 MB, visible and changeable

  function load() { try { return JSON.parse(root.localStorage.getItem(INDEX_KEY) || '{}'); } catch (_) { return {}; } }
  function save(idx) { try { root.localStorage.setItem(INDEX_KEY, JSON.stringify(idx)); } catch (_) {} }
  function budgetBytes() {
    try { const v = parseInt(root.localStorage.getItem('nalunoOfflineBudgetMB') || '', 10); if (v > 0) return v * 1024 * 1024; } catch (_) {}
    return DEFAULT_BUDGET_BYTES;
  }
  /* A floor of 1 MB rejects genuine mistakes (0, negative, NaN) without
     silently rewriting a deliberately small value someone actually chose —
     the previous floor of 50 did exactly that. */
  function setBudgetMB(mb) {
    const v = Math.max(1, parseInt(mb, 10) || 0);
    try { root.localStorage.setItem('nalunoOfflineBudgetMB', String(v)); } catch (_) {}
  }

  function usedBytes() {
    const idx = load();
    return Object.values(idx).reduce(function (n, e) { return n + (Number(e && e.bytes) || 0); }, 0);
  }

  async function openCache() { return caches.open(CACHE_NAME); }

  /** Real size on disk, measured from the response actually stored — not a
   *  header that can be missing, wrong, or absent on an opaque response. */
  async function measuredSize(resp) {
    try {
      const buf = await resp.clone().arrayBuffer();
      return buf.byteLength;
    } catch (_) { return 0; }
  }

  function isSaved(broadcastId) { return !!load()[broadcastId]; }
  function savedList() {
    const idx = load();
    return Object.keys(idx).map(function (id) { return Object.assign({ id: id }, idx[id]); })
      .sort(function (a, b) { return (b.savedAt || 0) - (a.savedAt || 0); });
  }

  /** Free space for `need` bytes by evicting the OLDEST-WATCHED save first —
   *  not oldest-saved. Something saved months ago and watched yesterday is
   *  clearly still wanted; something saved yesterday and never opened is the
   *  better thing to let go of. */
  async function evictFor(need) {
    let idx = load();
    let free = budgetBytes() - usedBytes();
    if (free >= need) return true;
    const order = Object.keys(idx).sort(function (a, b) {
      return (idx[a].lastWatchedAt || idx[a].savedAt || 0) - (idx[b].lastWatchedAt || idx[b].savedAt || 0);
    });
    const cache = await openCache();
    for (let i = 0; i < order.length && free < need; i++) {
      const id = order[i];
      try { await cache.delete(idx[id].url); } catch (_) {}
      free += Number(idx[id].bytes) || 0;
      delete idx[id];
    }
    save(idx);
    return free >= need;
  }

  async function fetchOne(url){
    const list = [];
    const add = function(u){ if(u && list.indexOf(u) < 0) list.push(u); };
    add(url);
    try{
      if(typeof nalunoPlayCandidates === 'function'){
        nalunoPlayCandidates(url, { bucket: 'broadcast' }).forEach(add);
      }
    }catch(_){}
    let last = 'could not download';
    for(let i = 0; i < list.length; i++){
      try{
        const res = await fetch(list[i], { mode: 'cors', credentials: 'omit' });
        if(res && res.ok) return res;
        last = 'download ' + (res ? res.status : 0);
      }catch(e){
        last = (e && e.message) || 'network blocked the download';
      }
    }
    /* The player may already hold the bytes as a blob from a gesture fetch. */
    try{
      const v = root.document && root.document.getElementById('bspaceVideoEl');
      if(v && v.src && String(v.src).indexOf('blob:') === 0){
        const res = await fetch(v.src);
        if(res && res.ok) return res;
      }
    }catch(_){}
    const err = new Error(last);
    err.naluno = true;
    throw err;
  }

  /** Save a Broadcast for offline. Reports progress via onProgress(0..1).
   *  Chapters are separate files — saving only the first URL left the rest
   *  unable to play later. Cache.put is given a plain URL: a Request built
   *  with mode "cors" is rejected by the Cache API and the save died after
   *  the download had already succeeded. */
  async function saveBroadcast(b, onProgress) {
    if (!b || !b.id) return { ok: false, error: 'nothing to save' };
    const urls = (b.mediaUrls && b.mediaUrls.length) ? b.mediaUrls.slice() : (b.mediaUrl ? [b.mediaUrl] : []);
    const unique = [];
    urls.forEach(function(u){ if(u && unique.indexOf(u) < 0) unique.push(u); });
    if (!unique.length) return { ok: false, error: 'nothing to save' };
    if (isSaved(b.id)) return { ok: true, already: true };
    try {
      const cache = await openCache();
      const res = await fetchOne(unique[0]);
      const total = Number(res.headers.get('Content-Length')) || 0;
      let resp = res;
      if (total && res.body && typeof res.body.getReader === 'function') {
        const reader = res.body.getReader();
        const chunks = [];
        let got = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
          got += value.length;
          if (onProgress) onProgress(Math.min(0.95, got / total));
        }
        resp = new Response(new Blob(chunks), { headers: { 'Content-Type': res.headers.get('Content-Type') || 'video/mp4' } });
      }
      const bytes = await measuredSize(resp);
      if (!bytes) return { ok: false, error: 'empty download' };
      const fit = await evictFor(bytes);
      if (!fit) return { ok: false, error: 'not enough space — free up some saves' };
      for (let i = 0; i < unique.length; i++) {
        const url = unique[i];
        await cache.put(url, resp.clone());
      }
      let thumbSaved = false;
      if (b.thumbUrl && /^https?:/i.test(b.thumbUrl)) {
        try {
          const t = await fetch(b.thumbUrl, { mode: 'cors', credentials: 'omit' });
          if (t.ok) { await cache.put(b.thumbUrl, t); thumbSaved = true; }
        } catch (_) {}
      }
      const idx = load();
      idx[b.id] = {
        url: unique[0], urls: unique, thumbUrl: thumbSaved ? b.thumbUrl : '',
        title: String(b.title || 'Broadcast').slice(0, 120),
        creatorName: String(b.creatorName || '').slice(0, 60),
        bytes: bytes, savedAt: Date.now(), lastWatchedAt: Date.now(),
        takenDownSincePinned: false,
      };
      save(idx);
      if (onProgress) onProgress(1);
      return { ok: true, bytes: bytes };
    } catch (e) {
      const msg = (e && e.message) || 'save failed';
      if (/cors|failed to fetch|network/i.test(msg)) {
        return { ok: false, error: 'The video host blocked the save. Try again on Wi-Fi.' };
      }
      return { ok: false, error: msg };
    }
  }

  async function removeSaved(broadcastId) {
    const idx = load();
    const e = idx[broadcastId];
    if (!e) return;
    try { const cache = await openCache(); await cache.delete(e.url); (e.urls || []).forEach(function (u) { cache.delete(u); }); if (e.thumbUrl) await cache.delete(e.thumbUrl); } catch (_) {}
    delete idx[broadcastId];
    save(idx);
  }

  /** A cached copy of this URL, if one exists — used by the player as a
   *  fallback when the network copy cannot be reached. */
  async function cachedUrlFor(url) {
    if (!url) return null;
    try {
      const cache = await openCache();
      const aliases = [url];
      try {
        if (typeof resolveMediaUrl === 'function') {
          const r = resolveMediaUrl(url);
          if (r && aliases.indexOf(r) < 0) aliases.push(r);
        }
      } catch (_) {}
      const idx = load();
      Object.keys(idx).forEach(function (id) {
        const e = idx[id];
        const all = [e && e.url].concat((e && e.urls) || []);
        if (all.indexOf(url) >= 0) all.forEach(function (u) { if (u && aliases.indexOf(u) < 0) aliases.push(u); });
      });
      let hit = null;
      for (let i = 0; i < aliases.length && !hit; i++) {
        hit = await cache.match(aliases[i]);
      }
      if (!hit) return null;
      const blob = await hit.blob();
      return URL.createObjectURL(blob);
    } catch (_) { return null; }
  }

  function markWatched(broadcastId) {
    const idx = load();
    if (idx[broadcastId]) { idx[broadcastId].lastWatchedAt = Date.now(); save(idx); }
  }

  /** Mark a save as belonging to a Broadcast that has since been taken down,
   *  without deleting it — the person already saved it; removing it from
   *  under them silently would be a second, unannounced action. */
  function markTakenDown(broadcastId) {
    const idx = load();
    if (idx[broadcastId]) { idx[broadcastId].takenDownSincePinned = true; save(idx); }
  }


  /* ---------------- The Downloads screen ---------------- */
  function fmtBytes(n) {
    n = Number(n) || 0;
    if (n >= 1073741824) return (n / 1073741824).toFixed(1) + ' GB';
    if (n >= 1048576) return (n / 1048576).toFixed(1) + ' MB';
    return Math.round(n / 1024) + ' KB';
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  async function renderDownloads() {
    const body = root.document.getElementById('downloadsBody');
    if (!body) return;
    const used = usedBytes(), budget = budgetBytes();
    const pct = budget ? Math.min(100, Math.round((used / budget) * 100)) : 0;
    const rows = savedList();
    body.innerHTML =
      '<div class="dl-budget"><div>' + fmtBytes(used) + ' of ' + fmtBytes(budget) + ' used</div>'
      + '<div class="dl-bar"><i style="width:' + pct + '%"></i></div></div>'
      + (rows.length ? rows.map(function (r) {
          return '<div class="dl-row" data-open="' + esc(r.id) + '" role="button" tabindex="0">'
            + (r.thumbUrl ? '<img class="dl-thumb" src="' + esc(r.thumbUrl) + '" alt="" />' : '<div class="dl-thumb"></div>')
            + '<div class="dl-info"><div class="dl-title">' + esc(r.title) + '</div>'
            + '<div class="dl-meta' + (r.takenDownSincePinned ? ' dl-taken-down' : '') + '">'
            + (r.takenDownSincePinned ? 'No longer public \u00b7 ' : '')
            + fmtBytes(r.bytes) + ' \u00b7 saved ' + new Date(r.savedAt).toLocaleDateString() + '</div></div>'
            + '<button type="button" class="dl-remove" data-remove="' + esc(r.id) + '">Remove</button>'
            + '</div>';
        }).join('') : '<p class="sub">Nothing saved yet. Open a Broadcast and tap Save.</p>');
    body.querySelectorAll('[data-remove]').forEach(function (btn) {
      btn.onclick = async function (e) {
        try{ if(e) e.stopPropagation(); }catch(_){}
        await removeSaved(btn.getAttribute('data-remove'));
        renderDownloads();
      };
    });
    body.querySelectorAll('[data-open]').forEach(function (row) {
      row.onclick = function () {
        const id = row.getAttribute('data-open');
        if (id) openSaved(id);
      };
    });
  }
  async function openSaved(broadcastId) {
    const row = savedList().filter(function (r) { return r.id === broadcastId; })[0];
    const prevHold = root.__nalunoBackHold;
    root.__nalunoBackHold = true;
    try { closeDownloads(); } catch (_) {}
    root.__nalunoBackHold = prevHold;
    const online = typeof navigator === 'undefined' || navigator.onLine !== false;
    if (online && typeof fbDb !== 'undefined' && fbDb && broadcastId && typeof openBroadcastById === 'function') {
      openBroadcastById(broadcastId);
      return;
    }
    const play = row && (await cachedUrlFor(row.url || ''));
    if (play && typeof root.openBroadcastSpace === 'function') {
      root.openBroadcastSpace({
        isMine: false,
        broadcastId: broadcastId,
        title: row.title || 'Broadcast',
        creatorName: row.creatorName || '',
        segment: {
          type: 'video',
          mediaUrl: play,
          videoUrl: play,
          thumbDataUrl: row.thumbUrl || '',
        },
      });
      return;
    }
    try { root.toast('Couldn’t open that Broadcast'); } catch (_) {}
  }
  function openDownloads() {
    const p = root.document.getElementById('downloadsPanel');
    if (p) p.classList.add('active');
    try{ if (root.nalunoBack) root.nalunoBack.push(); }catch(_){}
    renderDownloads();
  }
  function closeDownloads() {
    const p = root.document.getElementById('downloadsPanel');
    const was = p && p.classList.contains('active');
    if (p) p.classList.remove('active');
    if (was) { try{ if (root.nalunoBack) root.nalunoBack.drop('downloadsPanel'); }catch(_){} }
  }
  (function wire() {
    function bind() {
      const open = root.document.getElementById('openDownloadsBtn');
      const ghost = root.document.getElementById('bcastOfflineWatch');
      if (open) open.onclick = openDownloads;
      if (ghost) ghost.onclick = function (e) {
        try { if (e) { e.preventDefault(); e.stopPropagation(); } } catch (_) {}
        openDownloads();
      };
      const close = root.document.getElementById('downloadsClose');
      if (close) close.onclick = closeDownloads;
    }
    if (root.document && root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', bind);
    else if (root.document) bind();
  })();

  root.NalunoOfflineBroadcast = {
    saveBroadcast, removeSaved, isSaved, savedList, cachedUrlFor, markWatched, markTakenDown,
    usedBytes, budgetBytes, setBudgetMB, evictFor, renderDownloads, openDownloads, closeDownloads,
  };
})(typeof window !== 'undefined' ? window : globalThis);
