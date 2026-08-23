/* ============================================================
   MODULE: js/signal-core.js
   Signal posts + R2 upload + composer state
   OWNERSHIP: change this domain here only.
   Scripts share globals (intentional) so load order matches the old monolith.
   ============================================================ */
/* ---------------- YOUR SIGNAL (own broadcasts) ----------------
   Each posted item is a "segment". Segments persist for 25h (SIGNAL_TTL_MS)
   unless removed manually, and posting never clears out earlier segments —
   they all live in mySignal and play back in sequence in the viewer.
   Real accounts store this in Firestore now — it used to be window.storage, which
   doesn't exist at all once this is hosted for real, so broadcasts silently never
   survived a sign-in. That was the actual cause of "my broadcast disappeared." */
const SIGNAL_TTL_MS = 24 * 60 * 60 * 1000; // default 24h; composer can choose 24h / 3d / 7d via signalTtlMs()
let mySignal = []; // { id, type:'photo'|'video'|'text', dataUrl, videoUrl, filterCss, crop, caption, text, bg, createdAt, expiresAt, transitionIn, duration }
let mySignalSeen = true;
let connectionsSignals = []; // [{ contactId, contact, latest }] — real connections' most recent segment

/* ---------------- SIGNAL VIDEO UPLOAD (Cloudflare R2) ----------------
   Firestore caps a single document at 1MB — a video blows straight past that, which is
   why videos silently failed to post while photos and text (much smaller) slipped
   under it. Firebase Storage would normally be the fix, but Google now requires the
   paid Blaze plan for Storage at any usage at all, even the smallest file. This
   uploads instead to Cloudflare R2 (genuinely free, 10GB, no card, no egress fees) via
   a small Worker that verifies the person is really signed in to Naluno before
   accepting anything — see signal-worker/index.js. The bucket itself is configured
   with a real object lifecycle rule to delete files automatically after 25 hours,
   matching how long a signal already lives — real, server-side cleanup, not dependent
   on anyone's device being online when the expiry actually hits.
   Fill in your own deployed Worker's URL here once it's live. */
const SIGNAL_UPLOAD_WORKER_URL = 'https://naluno-signal-upload.naluno.workers.dev';
/** Normalize any stored media URL to the Worker proxy (GET /o/<key>).
 *  Broken playback was caused by R2 "public" hosts that never served bytes. */
function resolveMediaUrl(u){
  if(!u || typeof u !== 'string') return u || '';
  const base = SIGNAL_UPLOAD_WORKER_URL.replace(/\/+$/, '');
  if(u.indexOf(base + '/o/') === 0) return u;
  if(u.indexOf(base + '/') === 0 && u.indexOf('/o/') < 0){
    // rare: worker origin without /o/
    const rest = u.slice(base.length).replace(/^\/+/, '');
    if(rest.indexOf('u/') === 0) return base + '/o/' + rest;
  }
  try{
    // key path u/<uid>/<file>
    const m = u.match(/\/?(u\/[A-Za-z0-9_-]+\/[A-Za-z0-9._-]+)/);
    if(m) return base + '/o/' + m[1];
    if(/r2\.dev\//i.test(u) || /cloudflarestorage\.com\//i.test(u)){
      const path = u.split(/r2\.dev\//i)[1] || u.split(/cloudflarestorage\.com\//i)[1];
      if(path){
        const cleaned = path.replace(/^\/+/, '').split('?')[0];
        return base + '/o/' + cleaned;
      }
    }
  }catch(_){}
  return u;
}

/** Attach error + load recovery on a media element. Playback uses preload=auto.
 *  metadata-only was starving Android after a few minutes (false `ended`). */
function nalunoFileLooksLikeVideo(file){
  if(!file) return false;
  const t = String(file.type || '').toLowerCase();
  if(t.indexOf('video/') === 0) return true;
  if(/\.(mp4|m4v|mov|webm|3gp|3g2|mkv|avi|hevc)$/i.test(file.name || '')) return true;
  return false;
}
function nalunoFileLooksLikeImage(file){
  if(!file) return false;
  const t = String(file.type || '').toLowerCase();
  if(t.indexOf('image/') === 0) return true;
  if(/\.(jpe?g|png|gif|webp|heic|heif|bmp)$/i.test(file.name || '')) return true;
  return false;
}
function nalunoFiniteDuration(d){
  return typeof d === 'number' && isFinite(d) && d > 0 && d !== Infinity;
}
function nalunoGuessContentType(blob){
  const t = (blob && blob.type) ? String(blob.type).toLowerCase() : '';
  if(t && t !== 'application/octet-stream' && t !== 'application/download' && t !== 'binary/octet-stream'){
    return blob.type;
  }
  const name = (blob && blob.name) ? String(blob.name) : '';
  if(/\.(jpe?g)$/i.test(name)) return 'image/jpeg';
  if(/\.png$/i.test(name)) return 'image/png';
  if(/\.webp$/i.test(name)) return 'image/webp';
  if(/\.gif$/i.test(name)) return 'image/gif';
  if(/\.webm$/i.test(name)) return 'video/webm';
  if(/\.mov$/i.test(name)) return 'video/quicktime';
  if(/\.m4v$/i.test(name)) return 'video/x-m4v';
  if(/\.3gp$/i.test(name)) return 'video/3gpp';
  if(/\.mkv$/i.test(name)) return 'video/x-matroska';
  if(/\.mp4$/i.test(name)) return 'video/mp4';
  if(nalunoFileLooksLikeImage(blob)) return 'image/jpeg';
  return 'video/mp4';
}
const VIDEO_PICK_ACCEPT = 'video/*';
const IMAGE_PICK_ACCEPT = 'image/*';
const BCAST_PICK_ACCEPT = 'video/*,image/*';

function nalunoProbeDuration(file, timeoutMs){
  return new Promise(function(resolve){
    if(!file){ resolve(null); return; }
    const v = document.createElement('video');
    v.preload = 'metadata';
    v.muted = true;
    v.playsInline = true;
    const url = URL.createObjectURL(file);
    let done = false;
    const finish = function(d){
      if(done) return;
      done = true;
      try{ URL.revokeObjectURL(url); }catch(_){}
      try{ v.removeAttribute('src'); v.load(); }catch(_){}
      resolve(nalunoFiniteDuration(d) ? d : null);
    };
    v.onloadedmetadata = function(){ finish(v.duration); };
    v.onloadeddata = function(){ if(!done) finish(v.duration); };
    v.onerror = function(){ finish(null); };
    v.src = url;
    setTimeout(function(){ finish(v.duration); }, timeoutMs || 2800);
  });
}

function attachPlaybackGuard(el, url){
  if(!el || el.dataset.nalunoGuard === '1') return;
  el.dataset.nalunoGuard = '1';
  let recovering = false;
  const recover = function(){
    if(recovering || !el) return;
    const d = el.duration;
    const t = el.currentTime || 0;
    if(el.ended && nalunoFiniteDuration(d) && t >= d - 0.4) return;
    recovering = true;
    try{ el.preload = 'auto'; }catch(_){}
    try{
      if(el.ended || (el.paused && el.readyState < 3)){
        try{ el.currentTime = Math.max(0, t + 0.001); }catch(_){}
      }
      const p = el.play();
      if(p && p.catch) p.catch(function(){});
    }catch(_){}
    setTimeout(function(){ recovering = false; }, 1400);
  };
  el.addEventListener('waiting', function(){
    setTimeout(function(){
      if(el.ended) return;
      if(!el.paused && el.readyState < 3) recover();
      else if(el.paused){ el.play().catch(function(){}); }
    }, 450);
  });
  el.addEventListener('stalled', recover);
  el.addEventListener('ended', function(){
    const d = el.duration;
    const t = el.currentTime || 0;
    if(!nalunoFiniteDuration(d) || t < d - 0.45) recover();
  });
  if(typeof vaultIngestUrl === 'function' && url && String(url).indexOf('blob:') !== 0){
    vaultIngestUrl(url).catch(function(){});
  }
}

function bindMediaElement(el, rawUrl){
  if(!el) return;
  const url = resolveMediaUrl(rawUrl);
  if(!url) return;
  el.setAttribute('playsinline', '');
  el.setAttribute('webkit-playsinline', '');
  el.setAttribute('preload', 'auto');
  try{ el.preload = 'auto'; }catch(_){}
  if(typeof containMediaElement === 'function') containMediaElement(el);
  const current = (el.currentSrc || el.getAttribute('src') || '').split('?')[0];
  const nextBare = url.split('?')[0];
  if(!(current && nextBare && current.indexOf(nextBare) >= 0)){
    const key = (typeof vaultKeyForUrl === 'function') ? vaultKeyForUrl(url) : '';
    const cached = (key && typeof vaultSyncSrc === 'function') ? vaultSyncSrc(key) : '';
    el.src = cached || url;
  }
  el.onerror = function(){
    console.warn('[media] load failed', url, el.error && el.error.code);
    if(!el.dataset.retried){
      el.dataset.retried = '1';
      const key = (typeof vaultKeyForUrl === 'function') ? vaultKeyForUrl(url) : '';
      if(key && typeof vaultObjectUrl === 'function'){
        vaultObjectUrl(key).then(function(u){
          if(u){ el.src = u; el.play().catch(function(){}); }
          else { el.src = url + (url.indexOf('?') >= 0 ? '&' : '?') + 'r=' + Date.now(); }
        }).catch(function(){
          el.src = url + (url.indexOf('?') >= 0 ? '&' : '?') + 'r=' + Date.now();
        });
      } else {
        el.src = url + (url.indexOf('?') >= 0 ? '&' : '?') + 'r=' + Date.now();
      }
    }
  };
  attachPlaybackGuard(el, url);
  // Samsung HEVC / non-faststart: remote Range requests hang paused. After 1.6s,
  // pull the whole object into a blob: URL and play that.
  setTimeout(function(){
    try{
      if(!el || !el.paused) return;
      if(el.ended) return;
      if(typeof signalEnsurePlayableSrc === 'function'){
        signalEnsurePlayableSrc(el, url);
      }
    }catch(_){}
  }, 1600);
}

function signalEnsurePlayableSrc(videoEl, remoteUrl){
  return new Promise(function(resolve){
    if(!videoEl || !remoteUrl){ resolve(false); return; }
    const raw = String(remoteUrl);
    if(raw.indexOf('blob:') === 0 || raw.indexOf('data:') === 0){ resolve(false); return; }
    if(videoEl.dataset && videoEl.dataset.blobTried === '1'){ resolve(false); return; }
    try{ videoEl.dataset.blobTried = '1'; }catch(_){}
    fetch(remoteUrl, { credentials: 'omit', mode: 'cors' })
      .then(function(r){ if(!r.ok) throw new Error('fetch'); return r.blob(); })
      .then(function(blob){
        if(!blob || !blob.size){ resolve(false); return; }
        const u = URL.createObjectURL(blob);
        try{ videoEl.preload = 'auto'; }catch(_){}
        videoEl.src = u;
        try{ videoEl.load(); }catch(_){}
        const p = videoEl.play();
        if(p && p.catch) p.catch(function(){});
        resolve(true);
      })
      .catch(function(){ resolve(false); });
  });
}

async function nalunoSniffIsHevc(file){
  try{
    const name = String((file && file.name) || '').toLowerCase();
    const type = String((file && file.type) || '').toLowerCase();
    if(/hevc|h265|h\.265/.test(name) || /hevc|h265/.test(type)) return true;
    if(!(file && file.slice)) return false;
    const buf = await file.slice(0, 96).arrayBuffer();
    const bytes = new Uint8Array(buf);
    let s = '';
    for(let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return /hvc1|hev1|dvh1|dvhe/.test(s);
  }catch(_){ return false; }
}

async function nalunoTranscodeToWeb(file, onProgress, maxSeconds){
  if(!file || typeof MediaRecorder === 'undefined') return file;
  const url = URL.createObjectURL(file);
  const v = document.createElement('video');
  v.muted = true;
  v.playsInline = true;
  v.setAttribute('playsinline', '');
  v.preload = 'auto';
  v.src = url;
  try{
    await new Promise(function(res, rej){
      const t = setTimeout(function(){ rej(new Error('hevc meta timeout')); }, 6000);
      v.onloadedmetadata = function(){ clearTimeout(t); res(); };
      v.onerror = function(){ clearTimeout(t); rej(new Error('hevc decode')); };
    });
    const cap = (typeof v.captureStream === 'function') ? v.captureStream() : null;
    if(!cap) return file;
    const mime = ['video/webm;codecs=vp9','video/webm;codecs=vp8','video/webm'].find(function(m){
      return MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(m);
    }) || '';
    if(!mime) return file;
    const rec = new MediaRecorder(cap, { mimeType: mime, videoBitsPerSecond: 2200000 });
    const chunks = [];
    rec.ondataavailable = function(e){ if(e.data && e.data.size) chunks.push(e.data); };
    const stopped = new Promise(function(res){ rec.onstop = function(){ res(); }; });
    rec.start(350);
    await v.play();
    const limit = Math.min((nalunoFiniteDuration(v.duration) ? v.duration : (maxSeconds || 120)), maxSeconds || 360);
    await new Promise(function(res){
      const tick = function(){
        if(onProgress && limit) onProgress(Math.min(1, (v.currentTime || 0) / limit));
        if(v.ended || (v.currentTime || 0) >= limit){ res(); return; }
        requestAnimationFrame(tick);
      };
      tick();
      setTimeout(res, (limit + 1.2) * 1000);
    });
    try{ rec.stop(); }catch(_){}
    try{ v.pause(); }catch(_){}
    await stopped;
    const blob = new Blob(chunks, { type: 'video/webm' });
    if(!blob.size) return file;
    try{ blob.name = 'naluno-play.webm'; }catch(_){}
    return blob;
  }catch(e){
    console.warn('[hevc] transcode skipped', e);
    return file;
  }finally{
    try{ URL.revokeObjectURL(url); }catch(_){}
    try{ v.removeAttribute('src'); v.load(); }catch(_){}
  }
}

/** Soft single-request ceiling. Large files must compress or split (Worker body limits).
 *  Keep in sync with signal-worker MAX_BYTES. */
const UPLOAD_MAX_BYTES = 95 * 1024 * 1024; // ~95 MiB — safer under CF Worker limits
const UPLOAD_FORCE_COMPRESS_BYTES = 40 * 1024 * 1024; // compress when above 40 MiB
/** Soft chapter budget for pass-through slices (~4 min at ~2 Mbps or shorter at higher rates). */
const CHAPTER_TARGET_SECONDS = 4 * 60;
const CHAPTER_TARGET_BYTES = 55 * 1024 * 1024; // keep each chapter safely under older + new workers


/* Generates a small, static thumbnail frame from a video and returns it as a JPEG
   data URL — small enough to embed directly in the Firestore segment doc alongside
   videoUrl. This is what the ring preview should actually show: previously it was a
   live <video> tag pointing straight at the remote R2 URL, meaning the browser had to
   start a real network fetch and decode enough of the video just to show a preview,
   every single time the app loaded — that was the actual cause of the 2-3 second
   delay, not anything about app startup itself. */
function generateVideoThumbnail(videoSrcOrBlob){
  return new Promise(resolve=>{
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.setAttribute('playsinline','');
    video.preload = 'auto';
    let objectUrl = null;
    let src = videoSrcOrBlob;
    try{
      if(videoSrcOrBlob instanceof Blob || videoSrcOrBlob instanceof File){
        objectUrl = URL.createObjectURL(videoSrcOrBlob);
        src = objectUrl;
      } else if(typeof videoSrcOrBlob === 'string'){
        src = (typeof resolveMediaUrl === 'function') ? resolveMediaUrl(videoSrcOrBlob) : videoSrcOrBlob;
        // Remote R2 via worker — try CORS so canvas is not tainted
        if(/^https?:/i.test(src)) video.crossOrigin = 'anonymous';
      }
    }catch(_){}
    video.src = src;
    let resolved = false;
    const finish = result=>{
      if(resolved) return;
      resolved = true;
      try{ if(objectUrl) URL.revokeObjectURL(objectUrl); }catch(_){}
      resolve(result);
    };
    const snap = ()=>{
      try{
        if(!video.videoWidth){ finish(null); return; }
        const canvas = document.createElement('canvas');
        const maxDim = 480;
        const scale = Math.min(1, maxDim / Math.max(video.videoWidth, video.videoHeight));
        canvas.width = Math.round(video.videoWidth * scale) || 160;
        canvas.height = Math.round(video.videoHeight * scale) || 160;
        canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
        finish(canvas.toDataURL('image/jpeg', 0.82));
      }catch(e){ finish(null); }
    };
    video.onloadeddata = ()=>{
      const d = video.duration;
      const t = (isFinite(d) && d > 1) ? Math.min(1.2, d * 0.15) : 0.2;
      try{ video.currentTime = t; }catch(_){ snap(); }
    };
    video.onseeked = snap;
    video.onerror = ()=> finish(null);
    setTimeout(()=> finish(null), 8000);
  });
}

/** Prefer uploading a small JPEG to R2 so list cards stay fast and CORS-safe. */
async function persistThumbnailDataUrl(dataUrl){
  if(!dataUrl || typeof dataUrl !== 'string') return null;
  if(dataUrl.indexOf('data:image') !== 0) return dataUrl; // already a remote url
  try{
    if(typeof uploadVideoToR2 === 'function'){
      const res = await fetch(dataUrl);
      const blob = await res.blob();
      if(blob && blob.size > 0 && blob.size < 2*1024*1024){
        return await uploadVideoToR2(blob);
      }
    }
  }catch(_){}
  // Fallback: store compact data URL in Firestore (ok for ~50–150KB thumbs)
  return dataUrl;
}

/* Accepts a Blob (preferred) or a data URL. Passing a Blob avoids the slow
   dataURL → Blob round-trip that was doubling prepare+upload time for large clips. */
async function uploadVideoToR2(blobOrDataUrl){
  if(!currentUser) throw new Error('Sign in again to upload');
  let blob = blobOrDataUrl;
  if(typeof blobOrDataUrl === 'string'){
    blob = await (await fetch(blobOrDataUrl)).blob();
  }
  if(!(blob instanceof Blob) && !(blob instanceof File)) throw new Error('Invalid media data');
  const contentType = (typeof nalunoGuessContentType === 'function')
    ? nalunoGuessContentType(blob)
    : ((blob.type && blob.type !== 'application/octet-stream')
      ? blob.type
      : (blob.name && String(blob.name).match(/\.mp4$/i) ? 'video/mp4' : 'video/mp4'));

  if((blob.size || 0) > UPLOAD_MAX_BYTES && typeof uploadSignalChunked === 'function'){
    return uploadSignalChunked(blob, contentType);
  }

  async function once(forceRefresh){
    const idToken = await currentUser.getIdToken(!!forceRefresh);
    const res = await fetch(SIGNAL_UPLOAD_WORKER_URL, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + idToken,
        'Content-Type': contentType,
      },
      body: blob,
    });
    const errBody = await res.json().catch(()=>({}));
    if(res.ok){
      if(!errBody.url && errBody.key){
        errBody.url = SIGNAL_UPLOAD_WORKER_URL + '/o/' + String(errBody.key).replace(/^\/+/, '');
      }
      if(!errBody.url) throw new Error('Upload succeeded but no URL returned');
      return (typeof resolveMediaUrl === 'function') ? resolveMediaUrl(errBody.url) : errBody.url;
    }
    const msg = (errBody.error || errBody.message || ('Upload failed (' + res.status + ')')).toString();
    const e = new Error(msg);
    e.status = res.status;
    e.body = errBody;
    throw e;
  }

  try{
    return await once(false);
  }catch(e){
    // Stale Firebase token → refresh once
    if(e && (e.status === 401 || e.status === 403 || /auth|token|permission|sign/i.test(e.message||''))){
      try{ return await once(true); }catch(e2){ e = e2; }
    }
    let msg = (e && e.message) ? e.message : 'Upload failed';
    if(/missing or insufficient permissions/i.test(msg)){
      msg = 'Upload blocked (permissions). Sign out and back in, then try again. If it keeps failing, the storage Worker needs its R2 binding checked.';
    } else if(/too large|payload|413|entity too large/i.test(msg)){
      msg = 'File still too large for the upload server. Try a shorter clip.';
    } else if(/Failed to fetch|NetworkError|network/i.test(msg)){
      msg = 'Network error during upload — check connection and retry.';
    }
    throw new Error(msg);
  }
}

/** Chunked original-file upload via the Signal worker /b/* path.
 *  Stays in this module — Broadcast's uploader is not used. */
async function uploadSignalChunked(blob, contentType){
  if(!currentUser) throw new Error('Sign in again to upload');
  const base = SIGNAL_UPLOAD_WORKER_URL.replace(/\/+$/, '');
  const size = blob.size || 0;
  if(size < 1) throw new Error('Empty video');
  const CHUNK = 8 * 1024 * 1024;
  const authH = async function(force){
    const token = await currentUser.getIdToken(!!force);
    return { 'Authorization': 'Bearer ' + token };
  };
  let headers = await authH(false);
  const initRes = await fetch(base + '/b/init', {
    method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/json' }, headers),
    body: JSON.stringify({ contentType: contentType || 'video/mp4', bytes: size }),
  });
  const initBody = await initRes.json().catch(()=>({}));
  if(initRes.status === 401 || initRes.status === 403){
    headers = await authH(true);
    const retry = await fetch(base + '/b/init', {
      method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json' }, headers),
      body: JSON.stringify({ contentType: contentType || 'video/mp4', bytes: size }),
    });
    const retryBody = await retry.json().catch(()=>({}));
    if(!retry.ok) throw new Error(retryBody.error || 'Upload init failed');
    initBody.key = retryBody.key;
    initBody.uploadId = retryBody.uploadId;
  } else if(!initRes.ok){
    throw new Error(initBody.error || 'Upload init failed');
  }
  const key = initBody.key;
  const uploadId = initBody.uploadId;
  if(!key || !uploadId) throw new Error('Upload session missing');
  const parts = [];
  const totalParts = Math.max(1, Math.ceil(size / CHUNK));
  for(let i = 0; i < totalParts; i++){
    const start = i * CHUNK;
    const end = Math.min(size, start + CHUNK);
    const chunk = blob.slice(start, end);
    const partNum = i + 1;
    const partUrl = base + '/b/part?key=' + encodeURIComponent(key)
      + '&uploadId=' + encodeURIComponent(uploadId)
      + '&part=' + partNum;
    let attempt = 0;
    let partRes = null;
    let partBody = {};
    while(attempt < 6){
      attempt++;
      try{
        partRes = await fetch(partUrl, {
          method: 'PUT',
          headers: Object.assign({ 'Content-Type': 'application/octet-stream' }, headers),
          body: chunk,
        });
        if(partRes.status === 401 || partRes.status === 403){
          headers = await authH(true);
          partRes = await fetch(partUrl, {
            method: 'PUT',
            headers: Object.assign({ 'Content-Type': 'application/octet-stream' }, headers),
            body: chunk,
          });
        }
        partBody = await partRes.json().catch(()=>({}));
        if(partRes.ok) break;
        if(partRes.status >= 400 && partRes.status < 500 && partRes.status !== 408 && partRes.status !== 429){
          throw new Error(partBody.error || ('Part ' + partNum + ' failed'));
        }
      }catch(e){
        if(attempt >= 6) throw e;
        await new Promise(function(r){ setTimeout(r, 700 * attempt); });
      }
    }
    if(!partRes || !partRes.ok) throw new Error(partBody.error || ('Part ' + partNum + ' failed'));
    parts.push({ part: partNum, etag: partBody.etag });
  }
  const doneRes = await fetch(base + '/b/complete', {
    method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/json' }, headers),
    body: JSON.stringify({ key, uploadId, parts, bytes: size }),
  });
  const doneBody = await doneRes.json().catch(()=>({}));
  if(!doneRes.ok) throw new Error(doneBody.error || 'Upload complete failed');
  let url = doneBody.url || (doneBody.key ? (base + '/o/' + String(doneBody.key).replace(/^\/+/, '')) : '');
  if(!url) throw new Error('Upload succeeded but no URL returned');
  return (typeof resolveMediaUrl === 'function') ? resolveMediaUrl(url) : url;
}

function pruneExpiredSignal(){
  mySignal = mySignal.filter(s => Date.now() < s.expiresAt);
}

async function saveSignalSegment(segment){
  if(!currentUser || !fbDb) return null;
  try{
    const ref = await fbDb.collection('users').doc(currentUser.uid).collection('signal').add(segment);
    return ref.id;
  }catch(e){ toast('Couldn\u2019t post — try again'); return null; }
}
async function deleteSignalSegment(segmentId){
  if(!currentUser || !fbDb) return;
  try{ await fbDb.collection('users').doc(currentUser.uid).collection('signal').doc(String(segmentId)).delete(); }
  catch(e){ /* best-effort */ }
}
async function loadMySignal(){
  if(!currentUser || !fbDb) return;
  try{
    const cached = nalunoCacheRead('mySignal');
    if(cached && cached.length && !mySignal.length){
      mySignal = cached;
      pruneExpiredSignal();
      if(typeof renderBroadcasts === 'function') renderBroadcasts();
    }
  }catch(_){}
  try{
    // No orderBy here was the actual bug behind segments scrambling after a reload —
    // Firestore returns documents in its own unspecified internal order when none is
    // given, which happened to match posting order at first (built from a fresh local
    // push) but not on a later fresh read from the server.
    const snap = await fbDb.collection('users').doc(currentUser.uid).collection('signal').orderBy('createdAt','asc').get();
    mySignal = snap.docs.map(d => ({ id:d.id, ...d.data() }));
    pruneExpiredSignal();
    try{ nalunoCacheWrite('mySignal', mySignal.map(nalunoSlimMedia)); }catch(_){}
  }catch(e){ /* nothing posted yet, or offline */ }
  renderBroadcasts();
  if(typeof loadMyBroadcasts==='function') loadMyBroadcasts().then(()=>{ if(typeof loadFeedBroadcasts==='function') loadFeedBroadcasts(); });
}
/* Loads the latest segment from every real connection, so Frequencies and Broadcast
   are actually the same set of real people instead of two disconnected screens. */
/* This used to fire its full N-parallel-Firestore-query burst on every single change
   to the connections collection, not just once at sign-in — the real reason this got
   noticeably slower as more real connections accumulated. Now called from a single
   debounced spot in loadRealConnections instead, so a burst of connection changes
   collapses into one real reload. */
async function loadConnectionsSignalsNow(){
  if(!currentUser || !fbDb) return;
  const realContacts = contacts.filter(c => c.isReal && c.firebaseUid);
  const results = await Promise.all(realContacts.map(async c=>{
    try{
      const snap = await fbDb.collection('users').doc(c.firebaseUid).collection('signal').orderBy('createdAt','desc').limit(1).get();
      if(snap.empty) return null;
      const latest = snap.docs[0].data();
      if(Date.now() >= latest.expiresAt) return null;
      return { contactId: c.id, contact: c, latest };
    }catch(e){ return null; }
  }));
  connectionsSignals = results.filter(Boolean);
  try{
    nalunoCacheWrite('connectionsSignals', connectionsSignals.map(function(row){
      return {
        contactId: row.contactId,
        latest: nalunoSlimMedia(row.latest),
        contact: row.contact && {
          id: row.contact.id,
          firebaseUid: row.contact.firebaseUid,
          name: row.contact.name,
          color: row.contact.color,
          initials: row.contact.initials,
        },
      };
    }));
  }catch(_){}
  renderBroadcasts();
}

/* Legacy local-only fallback (no Firebase configured) — same as before. */
async function saveSignalToStorage(){
  if(!storageAvailable) return;
  try{
    await window.storage.set('broadcast:mySignal', JSON.stringify(mySignal));
  }catch(e){
    // Likely over the 5MB/key limit (large photo/video data URLs) — signal still
    // works for this session, it just won't survive a refresh.
  }
}
async function loadSignalFromStorage(){
  try{
    const cached = nalunoCacheRead('mySignal');
    if(cached && cached.length && !mySignal.length){
      mySignal = cached;
      pruneExpiredSignal();
      if(typeof renderBroadcasts === 'function') renderBroadcasts();
    }
  }catch(_){}
  if(currentUser && fbDb) return;
  if(!storageAvailable) return;
  try{
    const res = await window.storage.get('broadcast:mySignal');
    if(res && res.value){
      mySignal = JSON.parse(res.value);
      pruneExpiredSignal();
    }
  }catch(e){ /* nothing saved yet */ }
  renderBroadcasts();
}

const filterPresets = {
  normal: { name:'Normal', css:'' },
  vivid:  { name:'Vivid',  css:'saturate(1.6) contrast(1.1)' },
  mono:   { name:'Mono',   css:'grayscale(1) contrast(1.05)' },
  warm:   { name:'Warm',   css:'sepia(.35) saturate(1.3) hue-rotate(-8deg)' },
  cool:   { name:'Cool',   css:'saturate(1.2) hue-rotate(15deg) brightness(1.03)' },
};
const textBgGradients = [
  'linear-gradient(160deg,#7C4DFF,#00E5FF)',
  'linear-gradient(160deg,#FFB86B,#FF7676)',
  'linear-gradient(160deg,#7CFFB2,#4FBF87)',
  'linear-gradient(160deg,#FF5470,#7C4DFF)',
  'linear-gradient(160deg,#4FBF87,#00E5FF)',
  '#000000',
];
const transitionOptions = { fade:'Fade', slide:'Slide', zoom:'Zoom', cut:'Cut' };
const MAX_VIDEO_SECONDS = 4 * 60;

function cropTransform(crop){
  if(!crop) return 'translate(-50%,-50%)';
  return `translate(-50%,-50%) translate(${crop.xPct}%, ${crop.yPct}%) scale(${crop.scale})`;
}

/* ---------------- COMPOSER STATE ---------------- */
let composerType = 'photo';
let composerItems = [];       // [{ id, kind:'photo'|'video', dataUrl, filterKey, filterCss, crop:{scale,xPct,yPct}, caption, duration }]
let activeComposerItemIndex = -1;
let composerTextBg = textBgGradients[0];
let composerTransition = 'fade';



/* ---- Background publish queue ----
   User: pick media → filter → Publish, then leave.
   Work continues in-app (SPA). A small chip shows progress. */
let publishQueue = [];
let publishBusy = false;

function ensurePublishChip(){
  let chip = document.getElementById('publishBgChip');
  if(chip) return chip;
  chip = document.createElement('div');
  chip.id = 'publishBgChip';
  chip.setAttribute('aria-live', 'polite');
  chip.style.cssText = 'display:none;position:fixed;left:12px;right:12px;bottom:88px;z-index:9999;padding:12px 14px;border-radius:14px;background:rgba(13,15,23,.94);border:1px solid rgba(124,255,178,.35);color:#fff;font-family:var(--font-mono);font-size:12px;box-shadow:0 8px 32px rgba(0,0,0,.45);';
  document.body.appendChild(chip);
  return chip;
}
function showPublishChip(text){
  const chip = ensurePublishChip();
  chip.style.display = 'block';
  chip.textContent = text;
}
function hidePublishChip(){
  const chip = document.getElementById('publishBgChip');
  if(chip) chip.style.display = 'none';
}

function enqueuePublishJob(job){
  publishQueue.push(job);
  showPublishChip(job.label || 'Publishing in background…');
  if(typeof toast === 'function') toast('Publishing in background — you can leave this screen');
  drainPublishQueue();
}

async function drainPublishQueue(){
  if(publishBusy) return;
  publishBusy = true;
  try{ if(typeof nalunoKeepAliveStart === 'function') await nalunoKeepAliveStart('publish'); }catch(_){}
  while(publishQueue.length){
    const job = publishQueue.shift();
    try{
      showPublishChip(job.label || 'Working…');
      await job.run((msg)=>{ showPublishChip(msg || job.label || 'Working…'); });
      if(typeof toast === 'function') toast(job.doneMsg || 'Published');
    }catch(e){
      console.error('[publish-queue]', e);
      if(typeof notifyPublishResult === 'function') notifyPublishResult(false, (job && job.label) || '');
      else if(typeof toast === 'function') toast((e && e.message) || 'Publish failed');
    }
  }
  publishBusy = false;
  try{ if(typeof nalunoKeepAliveStop === 'function') nalunoKeepAliveStop(); }catch(_){}
  hidePublishChip();
}


function notifyPublishResult(ok, title){
  const msg = ok ? ('Published: ' + (title || 'Broadcast')) : ('Publish failed: ' + (title || 'Broadcast'));
  try{ if(typeof toast === 'function') toast(msg); }catch(_){}
  try{
    if(typeof Notification !== 'undefined' && Notification.permission === 'granted'){
      new Notification(ok ? 'Naluno · Published' : 'Naluno · Publish failed', { body: msg, tag: 'naluno-publish' });
    } else if(typeof Notification !== 'undefined' && Notification.permission === 'default'){
      Notification.requestPermission().then(p=>{
        if(p === 'granted') new Notification(ok ? 'Naluno · Published' : 'Naluno · Publish failed', { body: msg, tag: 'naluno-publish' });
      }).catch(()=>{});
    }
  }catch(_){}
}
