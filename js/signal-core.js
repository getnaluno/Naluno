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

/** Attach error + load recovery on a media element. */
function bindMediaElement(el, rawUrl){
  if(!el) return;
  const url = resolveMediaUrl(rawUrl);
  if(!url) return;
  el.setAttribute('playsinline', '');
  el.setAttribute('preload', 'metadata');
  // Do NOT set crossOrigin — on Android WebView/Chrome it can block playback
  // even when the Worker sends Access-Control-Allow-Origin.
  el.src = url;
  el.onerror = function(){
    console.warn('[media] load failed', url, el.error && el.error.code);
    // one retry with cache-bust
    if(!el.dataset.retried){
      el.dataset.retried = '1';
      el.src = url + (url.indexOf('?') >= 0 ? '&' : '?') + 'r=' + Date.now();
    }
  };
}

/** Must match signal-worker MAX_BYTES (150 MiB). */
const UPLOAD_MAX_BYTES = 150 * 1024 * 1024;
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
function generateVideoThumbnail(videoSrc){
  return new Promise(resolve=>{
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.src = videoSrc;
    let resolved = false;
    const finish = result=>{ if(!resolved){ resolved = true; resolve(result); } };
    video.onloadeddata = ()=>{ video.currentTime = Math.min(0.5, (video.duration||1)/2); };
    video.onseeked = ()=>{
      try{
        const canvas = document.createElement('canvas');
        const maxDim = 240; // thumbnail-sized — no need for full resolution just to show a small ring preview
        const scale = Math.min(1, maxDim / Math.max(video.videoWidth, video.videoHeight));
        canvas.width = Math.round(video.videoWidth*scale) || 120;
        canvas.height = Math.round(video.videoHeight*scale) || 120;
        canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
        finish(canvas.toDataURL('image/jpeg', 0.7));
      }catch(e){ finish(null); } // thumbnail generation failed — ring falls back to color/initials only, not a hard error
    };
    video.onerror = ()=> finish(null);
    setTimeout(()=> finish(null), 5000); // safety timeout in case loadeddata/seeked never fire
  });
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
  const contentType = (blob.type && blob.type !== 'application/octet-stream')
    ? blob.type
    : (blob.name && String(blob.name).match(/\.mp4$/i) ? 'video/mp4' : 'video/webm');

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
    // No orderBy here was the actual bug behind segments scrambling after a reload —
    // Firestore returns documents in its own unspecified internal order when none is
    // given, which happened to match posting order at first (built from a fresh local
    // push) but not on a later fresh read from the server.
    const snap = await fbDb.collection('users').doc(currentUser.uid).collection('signal').orderBy('createdAt','asc').get();
    mySignal = snap.docs.map(d => ({ id:d.id, ...d.data() }));
    pruneExpiredSignal();
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
  if(currentUser && fbDb) return; // real accounts use Firestore instead — see loadMySignal
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
const MAX_VIDEO_SECONDS = 120;

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
