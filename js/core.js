/* ============================================================
   MODULE: js/core.js
   $, toast, version check
   OWNERSHIP: change this domain here only.
   Scripts share globals (intentional) so load order matches the old monolith.
   ============================================================ */
const $ = id => document.getElementById(id);
/** Map Firebase/SDK jargon to a line a person can act on.
 *  "Missing or insufficient permissions" is Firestore's default denial —
 *  it was leaking onto the toast from Callsign save, Band start, Wireline,
 *  and handle search whenever a rule blocked a write (or the auth token
 *  had not attached yet). */
function nalunoFriendlyError(msg){
  const s = String(msg == null ? '' : msg);
  if(!s) return s;
  // Firestore's default denial. Never show it — it is not something a
  // person can act on, and it was popping on Callsign from a background
  // write (token not attached yet, or a collection the phone cannot see).
  if(/missing or insufficient permissions|permission-denied|FirebaseError: Missing/i.test(s)){
    return '';
  }
  if(/failed to fetch|networkerror|network request failed|unavailable/i.test(s)){
    return 'No connection right now — try again in a moment.';
  }
  return s;
}
try{ window.nalunoFriendlyError = nalunoFriendlyError; }catch(_){}
/** onTap is optional and backward-compatible — every existing call site
 *  passes only msg and is completely unaffected. Added specifically so a
 *  "someone went live" toast can actually be tapped through to the
 *  Broadcast (see handleBroadcastLiveNotification in notifications.js,
 *  found during a repo audit checking a broadcastId + openBroadcastById
 *  existence check that was being made and then never used for anything —
 *  the toast had no way to be tapped at all, so navigating was never
 *  actually possible despite the code clearly intending it to be). */
function toast(msg, onTap){
  const text = nalunoFriendlyError(msg);
  if(!text) return;
  if(/\[naluno|naluno-upload|app error:|queue busy| → \d{3}\b/i.test(text)) return;
  const t = $('toast'); if(!t) return; t.textContent = text; t.classList.add('show');
  clearTimeout(toast._t); toast._t = setTimeout(()=>t.classList.remove('show'), typeof onTap === 'function' ? 6500 : 1900);
  if(typeof onTap === 'function'){
    t.style.cursor = 'pointer';
    t.onclick = function(){
      try{ onTap(); }catch(_){}
      t.classList.remove('show');
      clearTimeout(toast._t);
    };
  } else {
    t.style.cursor = '';
    t.onclick = null;
  }
}

function emptyStateHtml(title, copy, hint){
  const h = hint ? ('<div class="empty-state-hint">'+hint+'</div>') : '';
  const t = title ? ('<div class="empty-state-title">'+title+'</div>') : '';
  return '<div class="empty-state">'+t+h+'<p class="empty-state-copy">'+copy+'</p></div>';
}

/** Console only. Never paint a diagnostic chip on the phone. */
function nalunoUploadLog(msg, detail){
  try{ console.warn('[naluno-upload]', msg, detail || ''); }catch(_){}
}
try{ window.nalunoUploadLog = nalunoUploadLog; }catch(_){}

function nalunoOnWireline(){
  try{
    const th = document.getElementById('wirelineThread');
    if(th && th.classList.contains('active')) return true;
    const tab = document.getElementById('tab-wireline');
    if(tab && tab.classList.contains('active')) return true;
  }catch(_){}
  return false;
}
function nalunoProgressAllowed(){
  if(nalunoOnWireline()) return false;
  try{
    const c = document.getElementById('composer');
    if(c && c.classList.contains('active')) return true;
    const b = document.getElementById('bcomposer');
    if(b && b.classList.contains('active')) return true;
  }catch(_){}
  return false;
}
function nalunoHideProgressChrome(){
  try{
    const chip = document.getElementById('publishBgChip');
    /* A Broadcast upload's % bar stays up (except on Wireline). */
    if(chip && !(chip.getAttribute('data-bar') === '1' && !nalunoOnWireline())) chip.style.display = 'none';
    const ban = document.getElementById('bgProcessBanner');
    if(ban && !nalunoProgressAllowed()) ban.style.display = 'none';
    const tr = document.getElementById('nalunoUploadTrace');
    if(tr){ tr.style.display = 'none'; tr.textContent = ''; }
  }catch(_){}
}
try{
  window.nalunoOnWireline = nalunoOnWireline;
  window.nalunoProgressAllowed = nalunoProgressAllowed;
  window.nalunoHideProgressChrome = nalunoHideProgressChrome;
}catch(_){}

/** fetch wrapper: Chrome silently rejects keepalive bodies over 64KB.
 *  That was added in 09.03a on 8MB chunk PUTs and would abort uploads
 *  with no useful console line on some Samsung Chrome builds. */
function nalunoFetch(url, opts){
  opts = opts || {};
  const body = opts.body;
  let size = 0;
  try{
    if(body && typeof body.size === 'number') size = body.size;
    else if(body && typeof body.byteLength === 'number') size = body.byteLength;
    else if(typeof body === 'string') size = body.length;
  }catch(_){}
  if(opts.keepalive && size > 32000){
    const next = {};
    for(const k in opts){ if(Object.prototype.hasOwnProperty.call(opts, k) && k !== 'keepalive') next[k] = opts[k]; }
    opts = next;
  }
  const timeoutMs = (typeof opts.timeoutMs === 'number')
    ? opts.timeoutMs
    : (size > 2 * 1024 * 1024 ? 180000 : 25000);
  const fetchOpts = {};
  for(const k in opts){
    if(Object.prototype.hasOwnProperty.call(opts, k) && k !== 'timeoutMs') fetchOpts[k] = opts[k];
  }
  const ctl = new AbortController();
  const outer = fetchOpts.signal;
  const timer = setTimeout(function(){ try{ ctl.abort(); }catch(_){} }, timeoutMs);
  if(outer){
    if(outer.aborted) ctl.abort();
    else outer.addEventListener('abort', function(){ try{ ctl.abort(); }catch(_){} }, { once: true });
  }
  fetchOpts.signal = ctl.signal;
  const label = (opts.method || 'GET') + ' ' + String(url).replace(/^https?:\/\/[^/]+/, '').slice(0, 48);
  try{
    if(typeof nalunoUploadLog === 'function'){
      nalunoUploadLog(label, size ? (Math.round(size/1024) + 'KB') : '');
    }
  }catch(_){}
  return fetch(url, fetchOpts).then(function(res){
    clearTimeout(timer);
    try{ if(typeof nalunoUploadLog === 'function') nalunoUploadLog(label + ' → ' + res.status); }catch(_){}
    return res;
  }).catch(function(e){
    clearTimeout(timer);
    const msg = (e && e.name === 'AbortError') ? ('timeout ' + timeoutMs + 'ms') : ((e && e.message) || 'fetch failed');
    try{ if(typeof nalunoUploadLog === 'function') nalunoUploadLog(label + ' FAIL', msg); }catch(_){}
    throw e;
  });
}
try{ window.nalunoFetch = nalunoFetch; }catch(_){}


/* FIX ("app is static and vertical — make it sensitive to orientation"):
   manifest.json used to hard-lock orientation:"portrait", so the app never
   actually rotated at all no matter how the phone was held — that's the
   direct cause, fixed there. This is the other half: the app shell and any
   component that needs to know actively track and react to orientation
   changes, not just be allowed to render whatever the CSS cascade happens
   to produce. Sets body.naluno-landscape / naluno-portrait (kept in sync
   with the existing nalunoIsPortraitDevice() detection used by the camera
   fixes, so there's one shared source of truth for "which way is the phone
   held" across the whole app, not several different checks that could
   disagree) and fires a real DOM event other modules can listen for. */
function nalunoApplyOrientationClass(){
  try{
    const portrait = (typeof nalunoIsPortraitDevice === 'function')
      ? nalunoIsPortraitDevice()
      : (window.innerHeight >= window.innerWidth);
    document.body.classList.toggle('naluno-landscape', !portrait);
    document.body.classList.toggle('naluno-portrait', portrait);
  }catch(_){}
}
(function nalunoWatchOrientation(){
  nalunoApplyOrientationClass();
  let t = null;
  const onChange = function(){
    clearTimeout(t);
    // A short debounce: on real devices, innerWidth/innerHeight can report a
    // stale value for a frame or two right as the rotation animation starts.
    t = setTimeout(function(){
      nalunoApplyOrientationClass();
      try{ window.dispatchEvent(new CustomEvent('naluno:orientationchange')); }catch(_){}
    }, 120);
  };
  window.addEventListener('resize', onChange);
  window.addEventListener('orientationchange', onChange);
  try{
    if(screen.orientation && screen.orientation.addEventListener){
      screen.orientation.addEventListener('change', onChange);
    }
  }catch(_){}
})();

/* LOCK (bug 3.1): window.storage is not a browser API — it only existed in the
   original Claude Artifacts sandbox. In production every call no-oped and demo
   Bands / Wireline threads / voice notes / callsign fallback vanished on refresh.
   Shim once, early, so all later modules see a real async get/set backed by localStorage. */
(function(){
  if(typeof window.storage !== 'undefined' && window.storage !== null) return;
  // FIX (20260826): every call site in the app (auth.js, band-list.js, wireline.js,
  // atmosphere.js, signal-core.js) does `const res = await window.storage.get(key);
  // if(res && res.value){ ... }` — i.e. expects {key, value}, not a bare string.
  // An earlier version of this shim returned the raw string, so res.value was always
  // undefined and every read silently came back empty even with storageAvailable
  // now true. Shape matched to the real Artifacts window.storage API on purpose.
  window.storage = {
    get: function(key){
      return Promise.resolve().then(function(){
        try{
          const raw = localStorage.getItem('nalunoStorage:' + String(key));
          return raw == null ? null : { key: String(key), value: raw };
        }catch(e){ return null; }
      });
    },
    set: function(key, value){
      return Promise.resolve().then(function(){
        try{
          const v = value == null ? '' : String(value);
          localStorage.setItem('nalunoStorage:' + String(key), v);
          return { key: String(key), value: v };
        }catch(e){ return null; }
      });
    },
    delete: function(key){
      return Promise.resolve().then(function(){
        try{
          localStorage.removeItem('nalunoStorage:' + String(key));
          return { key: String(key), deleted: true };
        }catch(e){ return null; }
      });
    },
    list: function(prefix){
      return Promise.resolve().then(function(){
        try{
          const p = 'nalunoStorage:' + (prefix || '');
          const keys = [];
          for(let i = 0; i < localStorage.length; i++){
            const k = localStorage.key(i);
            if(k && k.indexOf(p) === 0) keys.push(k.slice('nalunoStorage:'.length));
          }
          return { keys: keys };
        }catch(e){ return { keys: [] }; }
      });
    }
  };
})();

/* ---------------- VERSION CHECK ----------------
   A running tab can't be force-reloaded silently without real risk — doing that mid-call
   or mid-message would be actively bad. Instead: bump APP_VERSION in the meta tag on
   every real deploy, and this quietly re-fetches the live index.html (bypassing cache)
   every few minutes and whenever the tab regains focus. A mismatch means a newer version
   has shipped, and it surfaces an unmissable banner rather than trying to be invisible
   about it — the person taps it whenever's actually convenient for them. */
const APP_VERSION = (document.querySelector('meta[name="app-version"]') || {}).content || '';
async function checkForUpdate(){
  try{
    const res = await fetch('./index.html?_=' + Date.now(), { cache:'no-store' });
    const html = await res.text();
    const match = html.match(/<meta name="app-version" content="([^"]+)">/);
    if(match && APP_VERSION && match[1] !== APP_VERSION){
      $('updateBanner').style.display = 'flex';
    }
  }catch(e){ /* offline or blocked — just try again on the next interval */ }
}
/* 29h — one reload per update. The banner reloaded straight away, before
   the new version had taken over; when it did take over a moment later,
   pwa.js reloaded a second time. And a reload that came before the new
   version was ready could bring the old page back, with the banner. Now
   there is one reload, shared by both paths:
   - the banner asks for the update and waits (up to 8 s) for the new
     version to take over; that takeover is the one reload;
   - the page on the phone is refreshed first, so even if the takeover never
     comes the reload shows the new version;
   - nalunoReloadOnce() refuses a second reload within 30 s. */
function nalunoReloadOnce(force){
  try{
    const last = Number(sessionStorage.getItem('nalunoReloadAt') || 0);
    if(!force && last && Date.now() - last < 30000) return false;
    sessionStorage.setItem('nalunoReloadAt', String(Date.now()));
  }catch(_){}
  location.reload();
  return true;
}
async function nalunoFreshShell(){
  try{
    if(typeof caches === 'undefined') return;
    const names = (await caches.keys()).filter(function(n){ return n.indexOf('naluno-shell-') === 0; });
    if(!names.length) return;
    const res = await fetch('/app/index.html', { cache: 'reload' });
    if(!res || !res.ok) return;
    for(const n of names){
      const c = await caches.open(n);
      await c.put(new Request(location.origin + '/app/index.html'), res.clone());
      await c.put(new Request(location.origin + '/app/'), res.clone());
    }
  }catch(_){}
}
async function nalunoUpdateNow(){
  const btn = $('updateBannerBtn');
  if(btn){ btn.disabled = true; btn.textContent = 'Updating…'; }
  let tookOver = false;
  try{
    if('serviceWorker' in navigator){
      const regs = await navigator.serviceWorker.getRegistrations();
      await new Promise(function(done){
        let finished = false;
        const end = function(){ if(!finished){ finished = true; done(); } };
        navigator.serviceWorker.addEventListener('controllerchange', function(){ tookOver = true; end(); }, { once: true });
        Promise.all(regs.map(function(r){ return r.update().catch(function(){}); })).then(function(){
          const pending = regs.some(function(r){ return r.installing || r.waiting; });
          if(!pending) end();
        });
        setTimeout(end, 8000);
      });
    }
  }catch(_){}
  await nalunoFreshShell();
  nalunoReloadOnce(true);
}
window.nalunoReloadOnce = nalunoReloadOnce;
$('updateBannerBtn').onclick = function(){ nalunoUpdateNow(); };
setInterval(checkForUpdate, 3*60*1000);
document.addEventListener('visibilitychange', ()=>{ if(!document.hidden) checkForUpdate(); });
setTimeout(checkForUpdate, 4000); // small delay so this isn't competing with the initial page load



/* Surface fatal errors in the console only — never as in-app diagnostics. */
window.addEventListener('error', function(ev){
  try{ console.error('[naluno]', ev.message, ev.filename, ev.lineno); }catch(_){}
});
window.addEventListener('unhandledrejection', function(ev){
  try{ console.error('[naluno:promise]', ev.reason); }catch(_){}
});
console.log('[naluno] build 2026.09.18b');


function nalunoFitImageDataUrl(dataUrl, maxEdge, quality){
  return new Promise(function(resolve){
    if(!dataUrl || String(dataUrl).indexOf('data:image') !== 0){ resolve(dataUrl); return; }
    const img = new Image();
    img.onload = function(){
      try{
        const edge = maxEdge || 2400;
        const q = quality || 0.9;
        const w = img.width || 1, h = img.height || 1;
        const s = Math.min(1, edge / Math.max(w, h));
        if(s >= 1){ resolve(dataUrl); return; }
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(w * s));
        c.height = Math.max(1, Math.round(h * s));
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        resolve(c.toDataURL('image/jpeg', q));
      }catch(_){ resolve(dataUrl); }
    };
    img.onerror = function(){ resolve(dataUrl); };
    img.src = dataUrl;
  });
}
function nalunoShrinkImageDataUrl(dataUrl, maxEdge, quality){
  return new Promise(function(resolve){
    if(!dataUrl || String(dataUrl).indexOf('data:image') !== 0){ resolve(dataUrl); return; }
    const img = new Image();
    img.onload = function(){
      try{
        const edge = maxEdge || 512;
        const q = quality || 0.72;
        const s = Math.min(1, edge / Math.max(img.width || 1, img.height || 1));
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round((img.width || 1) * s));
        c.height = Math.max(1, Math.round((img.height || 1) * s));
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        resolve(c.toDataURL('image/jpeg', q));
      }catch(_){ resolve(dataUrl); }
    };
    img.onerror = function(){ resolve(dataUrl); };
    img.src = dataUrl;
  });
}
function nalunoDataUrlToFile(dataUrl, name){
  return fetch(dataUrl).then(function(r){ return r.blob(); }).then(function(blob){
    const ct = blob.type || 'image/jpeg';
    const n = name || 'avatar.jpg';
    try{ return new File([blob], n, { type: ct }); }
    catch(_){ try{ blob.name = n; }catch(__){} return blob; }
  });
}
/** Bake pan/zoom into a square JPEG so every avatar (lists, calls, Band)
 *  shows the same crop without CSS transforms. Samsung Chrome paints
 *  transformed <img> outside overflow:hidden; a pre-cropped file does not. */
function nalunoBakeCroppedImage(dataUrl, crop, edge){
  return new Promise(function(resolve){
    if(!dataUrl){ resolve(dataUrl); return; }
    const img = new Image();
    img.onload = function(){
      try{
        const size = edge || 480;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#1a1d2a';
        ctx.fillRect(0, 0, size, size);
        const scale = (crop && typeof crop.scale === 'number' && crop.scale > 0) ? crop.scale : 1;
        const xPct = (crop && typeof crop.xPct === 'number') ? crop.xPct : 0;
        const yPct = (crop && typeof crop.yPct === 'number') ? crop.yPct : 0;
        const iw = img.width || 1, ih = img.height || 1;
        const cover = Math.max(size / iw, size / ih);
        const dw = iw * cover * scale;
        const dh = ih * cover * scale;
        const dx = (size - dw) / 2 + (xPct / 100) * size;
        const dy = (size - dh) / 2 + (yPct / 100) * size;
        ctx.drawImage(img, dx, dy, dw, dh);
        resolve(canvas.toDataURL('image/jpeg', 0.84));
      }catch(_){ resolve(dataUrl); }
    };
    img.onerror = function(){ resolve(dataUrl); };
    img.crossOrigin = 'anonymous';
    img.src = dataUrl;
  });
}

function nalunoCacheKey(kind){
  try{
    const uid = (typeof currentUser !== 'undefined' && currentUser && currentUser.uid)
      || localStorage.getItem('nalunoLastUid') || '';
    return uid ? ('nalunoCache:' + kind + ':' + uid) : '';
  }catch(_){ return ''; }
}
/* Live listeners that hit one error (a network blip, a token refresh, the
   app coming back from the background) used to stop for the rest of the
   session: the list froze until the app was restarted. nalunoRelisten()
   subscribes again after 1s, 2s, 4s … up to 30s; nalunoListenOk() resets
   the wait once a snapshot arrives. `max` stops after that many failures in
   a row, so a hard failure (rules, sign-out) cannot pile up listeners. */
const nalunoRelistenState = {};
function nalunoRelisten(key, start, max){
  const st = nalunoRelistenState[key] || (nalunoRelistenState[key] = { tries: 0, timer: null });
  if(st.timer) return false;
  if(max && st.tries >= max){ try{ console.warn('[listen] ' + key + ': giving up after ' + st.tries + ' tries'); }catch(_){} return false; }
  const wait = Math.min(30000, 1000 * Math.pow(2, st.tries));
  st.tries++;
  st.timer = setTimeout(function(){
    st.timer = null;
    try{ if(typeof currentUser !== 'undefined' && !currentUser) return; }catch(_){}
    try{ start(); }catch(e){ try{ console.warn('[listen] ' + key, e && e.message); }catch(_){} }
  }, wait);
  return true;
}
function nalunoListenOk(key){
  const st = nalunoRelistenState[key];
  if(st) st.tries = 0;
}
function nalunoRelistenStop(key){
  const st = nalunoRelistenState[key];
  if(st && st.timer){ clearTimeout(st.timer); st.timer = null; }
  if(st) st.tries = 0;
}
window.nalunoRelisten = nalunoRelisten;
window.nalunoListenOk = nalunoListenOk;
window.nalunoRelistenStop = nalunoRelistenStop;
function nalunoCacheWrite(kind, value){
  const k = nalunoCacheKey(kind);
  if(!k) return;
  try{ localStorage.setItem(k, JSON.stringify(value)); }catch(_){}
}
function nalunoCacheRead(kind){
  const k = nalunoCacheKey(kind);
  if(!k) return null;
  try{
    const raw = localStorage.getItem(k);
    return raw ? JSON.parse(raw) : null;
  }catch(_){ return null; }
}
function nalunoSlimMedia(row){
  if(!row || typeof row !== 'object') return row;
  const copy = Object.assign({}, row);
  Object.keys(copy).forEach(function(k){
    const v = copy[k];
    if(typeof v === 'string' && v.length > 100000 && (v.indexOf('data:') === 0)) delete copy[k];
  });
  if(copy.photo && copy.photo.dataUrl && String(copy.photo.dataUrl).length > 100000){
    copy.photo = { color: copy.photo.color || null };
  }
  return copy;
}

/* 29g — a sheet opens over the screen it was opened from.
   Every sheet shares `.call-overlay.active{ z-index:120 !important }`, which is
   lower than the Broadcast screen (180), Spark (230) and the composers (280).
   "Support this creator" (and the other sheets opened from inside those
   screens) became active BEHIND them, so nothing seemed to happen, and the
   sheet only showed once you left the broadcast. When a sheet opens it is now
   lifted one step above whatever is open, and goes back to its own level when
   it closes. The call screen and the sign-in gate keep their own levels. */
const NALUNO_LAYER_SKIP = { callOverlay: 1, authGate: 1, wirelineThread: 1, bandRoom: 1 };
const NALUNO_LAYER_OPEN = '.call-overlay.active, #bspace.active, #sparkPage.active, #findNalunoOverlay.active, #nalunoAdViewer';
function nalunoLayerTop(except){
  let top = 0;
  try{
    document.querySelectorAll(NALUNO_LAYER_OPEN).forEach(function(el){
      if(el === except || el.id === 'callOverlay' || el.id === 'authGate') return;
      const cs = getComputedStyle(el);
      if(cs.display === 'none' || cs.visibility === 'hidden') return;
      const z = parseInt(cs.zIndex, 10);
      if(z > top) top = z;
    });
  }catch(_){}
  return top;
}
function nalunoLiftSheet(el){
  if(!el || NALUNO_LAYER_SKIP[el.id]) return;
  const on = el.classList.contains('active');
  if(!on){
    if(el.dataset.nalunoLifted){ el.style.removeProperty('z-index'); delete el.dataset.nalunoLifted; }
    return;
  }
  if(el.dataset.nalunoLifted) return;
  const own = parseInt(getComputedStyle(el).zIndex, 10) || 0;
  const top = nalunoLayerTop(el);
  if(top >= own){
    // stays under the call screen (300) so an incoming call still covers it
    el.style.setProperty('z-index', String(Math.min(top + 1, 299)), 'important');
    el.dataset.nalunoLifted = '1';
  }
}
function nalunoWatchSheets(){
  if(typeof MutationObserver === 'undefined') return;
  const seen = new WeakSet();
  const mo = new MutationObserver(function(list){
    list.forEach(function(m){ try{ nalunoLiftSheet(m.target); }catch(_){} });
  });
  function scan(){
    document.querySelectorAll('.call-overlay').forEach(function(el){
      if(seen.has(el) || NALUNO_LAYER_SKIP[el.id]) return;
      seen.add(el);
      mo.observe(el, { attributes: true, attributeFilter: ['class'] });
      if(el.classList.contains('active')) nalunoLiftSheet(el);
    });
  }
  scan();
  // sheets drawn later by script (none today, but cheap to cover)
  try{ new MutationObserver(scan).observe(document.body, { childList: true }); }catch(_){}
}
if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', nalunoWatchSheets);
else nalunoWatchSheets();
window.nalunoLiftSheet = nalunoLiftSheet;
