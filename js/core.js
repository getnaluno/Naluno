/* ============================================================
   MODULE: js/core.js
   $, toast, version check
   OWNERSHIP: change this domain here only.
   Scripts share globals (intentional) so load order matches the old monolith.
   ============================================================ */
const $ = id => document.getElementById(id);
/** onTap is optional and backward-compatible — every existing call site
 *  passes only msg and is completely unaffected. Added specifically so a
 *  "someone went live" toast can actually be tapped through to the
 *  Broadcast (see handleBroadcastLiveNotification in notifications.js,
 *  found during a repo audit checking a broadcastId + openBroadcastById
 *  existence check that was being made and then never used for anything —
 *  the toast had no way to be tapped at all, so navigating was never
 *  actually possible despite the code clearly intending it to be). */
function toast(msg, onTap){
  const t = $('toast'); t.textContent = msg; t.classList.add('show');
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

/** Visible + console + diagnostics trail for Signal/Broadcast upload.
 *  Chrome's Errors-only filter hides console.log — use warn, and paint
 *  an on-screen chip so a phone without DevTools still shows the path. */
function nalunoUploadLog(msg, detail){
  try{ console.warn('[naluno-upload]', msg, detail || ''); }catch(_){}
  const line = String(msg || '') + (detail ? (' ' + detail) : '');
  if(!/fail|error|timeout|401|ok|pipe|start/i.test(line)) return;
  try{
    let el = document.getElementById('nalunoUploadTrace');
    if(!el){
      el = document.createElement('div');
      el.id = 'nalunoUploadTrace';
      el.style.cssText = 'display:none;position:fixed;left:10px;right:10px;top:calc(env(safe-area-inset-top,0px) + 6px);z-index:10050;padding:8px 12px;border-radius:12px;background:rgba(13,15,23,.94);border:1px solid rgba(124,255,178,.45);color:#7CFFB2;font-family:ui-monospace,Menlo,monospace;font-size:11px;line-height:1.35;pointer-events:none;';
      (document.body || document.documentElement).appendChild(el);
    }
    const prev = el.getAttribute('data-lines') || '';
    const lines = (prev ? prev.split('\n') : []).concat([String(msg || '')]);
    const keep = lines.slice(-3);
    el.setAttribute('data-lines', keep.join('\n'));
    el.textContent = keep.join(' · ');
    if(/fail|error|timeout|401/i.test(line)){
      el.style.display = 'block';
      clearTimeout(nalunoUploadLog._hide);
      nalunoUploadLog._hide = setTimeout(function(){ el.style.display = 'none'; }, 12000);
    }
  }catch(_){}
}
try{ window.nalunoUploadLog = nalunoUploadLog; }catch(_){}

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
$('updateBannerBtn').onclick = ()=>{
  if('serviceWorker' in navigator){
    navigator.serviceWorker.getRegistrations().then(regs => regs.forEach(r=>r.update())).catch(()=>{});
  }
  location.reload();
};
setInterval(checkForUpdate, 3*60*1000);
document.addEventListener('visibilitychange', ()=>{ if(!document.hidden) checkForUpdate(); });
setTimeout(checkForUpdate, 4000); // small delay so this isn't competing with the initial page load



/* Surface fatal errors so deploys that break the app are visible */
window.addEventListener('error', function(ev){
  try{
    console.error('[naluno]', ev.message, ev.filename, ev.lineno);
    if(typeof toast === 'function' && ev.message && /\$|null|undefined|is not a function/i.test(ev.message)){
      toast('App error: ' + String(ev.message).slice(0, 80));
    }
  }catch(_){}
});
window.addEventListener('unhandledrejection', function(ev){
  try{ console.error('[naluno:promise]', ev.reason); }catch(_){}
});
console.log('[naluno] build 2026.09.05a');


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
