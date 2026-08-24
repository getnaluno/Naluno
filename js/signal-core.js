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

/* ---- Media identity (Broadcast stability) ----
   Broadcast ID → Media ID → persistent asset must survive UI/layout churn.
   Never derive identity from array index or plate position. */
const nalunoMediaReg = {}; // mediaId → { broadcastId, url, state, lastError, ts }
function nalunoMediaIdFromUrl(u){
  if(!u || typeof u !== 'string') return '';
  try{
    const bare = String(u).split('?')[0];
    const m = bare.match(/u\/[A-Za-z0-9_-]+\/[A-Za-z0-9._-]+/);
    if(m) return m[0];
    const parts = bare.split('/');
    return parts[parts.length - 1] || bare.slice(-48);
  }catch(_){ return String(u).slice(-48); }
}
function nalunoMediaSetState(mediaId, state, detail){
  if(!mediaId) return;
  const row = nalunoMediaReg[mediaId] || { mediaId: mediaId };
  row.state = state;
  row.ts = Date.now();
  if(detail) row.lastError = detail;
  nalunoMediaReg[mediaId] = row;
}
/** Classify a media failure for diagnostics (never refetch-everything). */
function nalunoMediaClassifyError(el, err){
  const code = (el && el.error && el.error.code) || (err && err.code) || 0;
  const msg = String((err && (err.message || err.name)) || (el && el.error && el.error.message) || '');
  if(code === 1 || /abort/i.test(msg)) return 'component_remount_or_abort';
  if(code === 2 || /network|fetch|failed to load/i.test(msg)) return 'network_failure';
  if(code === 3 || /decode|format|not supported/i.test(msg)) return 'video_decoding_failure';
  if(code === 4 || /src not supported|empty src/i.test(msg)) return 'invalid_media_reference';
  if(/403|401|permission|unauth/i.test(msg)) return 'permission_authentication_failure';
  if(/404|not found/i.test(msg)) return 'storage_failure';
  if(/expir|token|signed/i.test(msg)) return 'expired_url';
  if(/cache/i.test(msg)) return 'cache_failure';
  if(/firestore|permission-denied|unavailable/i.test(msg)) return 'api_database_failure';
  return 'unknown_media_failure';
}
function nalunoMediaDiag(broadcastId, mediaId, cause, detail){
  const line = {
    t: Date.now(),
    broadcastId: broadcastId || null,
    mediaId: mediaId || null,
    cause: cause || 'unknown',
    detail: detail || null,
  };
  try{ console.warn('[naluno-media]', JSON.stringify(line)); }catch(_){
    console.warn('[naluno-media]', broadcastId, mediaId, cause, detail);
  }
  if(mediaId) nalunoMediaSetState(mediaId, 'error', line);
  return line;
}
window.nalunoMediaIdFromUrl = nalunoMediaIdFromUrl;
window.nalunoMediaDiag = nalunoMediaDiag;
window.nalunoMediaClassifyError = nalunoMediaClassifyError;
window.nalunoMediaReg = nalunoMediaReg;

/** Normalize any stored media URL to the Worker proxy (GET /o/<key>).
 *  Broken playback was caused by R2 "public" hosts that never served bytes.
 *  Never rewrite an already-proxied /o/u/ host (Broadcast vs Signal buckets). */
function resolveMediaUrl(u){
  if(!u || typeof u !== 'string') return u || '';
  if(/^blob:|^data:/i.test(u)) return u;
  const signalBase = SIGNAL_UPLOAD_WORKER_URL.replace(/\/+$/, '');
  const bcastBase = (typeof BROADCAST_UPLOAD_WORKER_URL === 'string' && BROADCAST_UPLOAD_WORKER_URL)
    ? BROADCAST_UPLOAD_WORKER_URL.replace(/\/+$/, '') : '';
  // Keep already-proxied object URLs on their own worker host.
  if(/^https?:/i.test(u) && /\/o\/u\//i.test(u)) return u;
  if(u.indexOf(signalBase + '/o/') === 0) return u;
  if(bcastBase && u.indexOf(bcastBase) === 0) return u;
  try{
    const m = u.match(/\/?(u\/[A-Za-z0-9_-]+\/[A-Za-z0-9._-]+)/);
    if(/^https?:/i.test(u) && (/r2\.dev\//i.test(u) || /cloudflarestorage\.com\//i.test(u))){
      const path = (u.split(/r2\.dev\//i)[1] || u.split(/cloudflarestorage\.com\//i)[1] || '').replace(/^\/+/, '').split('?')[0];
      if(path) return signalBase + '/o/' + path;
    }
    if(m && !/^https?:/i.test(u)){
      return signalBase + '/o/' + m[1];
    }
  }catch(_){}
  return u;
}

/** Candidate play URLs — original first (compat). Never hop Broadcast ↔ Signal
 *  unless the URL is a raw R2 object without a known worker host. */
function nalunoPlayCandidates(raw){
  const original = String(raw || '');
  const urls = [];
  const add = function(u){
    if(!u || typeof u !== 'string') return;
    if(urls.indexOf(u) >= 0) return;
    urls.push(u);
  };
  add(original);
  try{ add(resolveMediaUrl(original)); }catch(_){}
  const signalBase = SIGNAL_UPLOAD_WORKER_URL.replace(/\/+$/, '');
  const bcastBase = (typeof BROADCAST_UPLOAD_WORKER_URL === 'string' && BROADCAST_UPLOAD_WORKER_URL)
    ? BROADCAST_UPLOAD_WORKER_URL.replace(/\/+$/, '') : '';
  const onSignal = /naluno-signal-upload/i.test(original) || original.indexOf(signalBase) === 0;
  const onBcast = !!(bcastBase && (/naluno-broadcast-upload/i.test(original) || original.indexOf(bcastBase) === 0));
  let key = '';
  try{
    const m = original.match(/u\/[A-Za-z0-9_-]+\/[A-Za-z0-9._-]+/);
    if(m) key = m[0];
  }catch(_){}
  if(key){
    if(onBcast){
      add(bcastBase + '/o/' + key);
    } else if(onSignal){
      add(signalBase + '/o/' + key);
    } else {
      add(signalBase + '/o/' + key);
      if(bcastBase) add(bcastBase + '/o/' + key);
    }
  }
  return urls;
}
window.nalunoPlayCandidates = nalunoPlayCandidates;

/** Attach error + load recovery on a media element. Playback uses preload=auto.
 *  metadata-only was starving Android after a few minutes (false `ended`). */
function nalunoFileLooksLikeVideo(file){
  if(!file) return false;
  const t = String(file.type || '').toLowerCase();
  if(t.indexOf('video/') === 0) return true;
  if(t && t.indexOf('image/') === 0) return false;
  const name = String(file.name || '');
  if(/\.(mp4|m4v|mov|webm|3gp|3g2|mkv|avi|hevc)$/i.test(name)) return true;
  // Android/Google Photos after export: empty MIME, name without extension
  if(!t && (file.size || 0) > 50000) return true;
  return false;
}
function nalunoFileLooksLikeImage(file){
  if(!file) return false;
  const t = String(file.type || '').toLowerCase();
  if(t.indexOf('image/') === 0) return true;
  const name = String(file.name || '');
  if(/\.(jpe?g|png|gif|webp|heic|heif|bmp)$/i.test(name)) return true;
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
  if(/\.hevc$/i.test(name)) return 'video/mp4';
  if(nalunoFileLooksLikeImage(blob)) return 'image/jpeg';
  // Samsung often hands empty MIME — still video for Signal/Broadcast
  if(!t && (blob.size || 0) > 10000) return 'video/mp4';
  return 'video/mp4';
}

/** Read a slice of an MP4/MOV and detect HEVC (hvc1/hev1) — Samsung Camera default. */
async function nalunoSniffIsHevc(blob){
  try{
    if(!blob || !blob.size) return false;
    const n = Math.min(blob.size, 2 * 1024 * 1024);
    const buf = await blob.slice(0, n).arrayBuffer();
    const u8 = new Uint8Array(buf);
    // ASCII scan for codec fourccs in sample description
    let s = '';
    for(let i = 0; i < u8.length; i++){
      const c = u8[i];
      s += (c >= 32 && c < 127) ? String.fromCharCode(c) : '.';
    }
    if(/hvc1|hev1|hvcC|dvh1|hvc /.test(s)) return true;
    // Some Samsung exports only tag brand
    if(/hevc|hev1/i.test(s)) return true;
  }catch(_){}
  return false;
}

function nalunoPickWebRecorderMime(){
  if(typeof MediaRecorder === 'undefined') return '';
  const list = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
    'video/mp4',
  ];
  for(let i = 0; i < list.length; i++){
    try{
      if(MediaRecorder.isTypeSupported(list[i])) return list[i];
    }catch(_){}
  }
  return '';
}

/**
 * Transcode to a browser-safe progressive format (WebM VP8/VP9 or MP4).
 * Used for Samsung HEVC so HTML5 <video> actually plays after upload.
 * Caps at Signal length (4 min) and 720p — never used for multi-hour Broadcast.
 */
function nalunoTranscodeToWeb(file, onProgress, maxSeconds){
  const capSec = (typeof maxSeconds === 'number' && maxSeconds > 0) ? maxSeconds : 240;
  return new Promise(function(resolve, reject){
    const mime = nalunoPickWebRecorderMime();
    if(!mime){
      reject(new Error('This phone cannot convert video — try a shorter clip from Files'));
      return;
    }
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.setAttribute('playsinline', '');
    video.preload = 'auto';
    video.src = url;
    let settled = false;
    let recorder = null;
    let stream = null;
    let raf = 0;
    const chunks = [];
    const cleanup = function(){
      if(raf) cancelAnimationFrame(raf);
      try{ video.pause(); }catch(_){}
      try{ video.removeAttribute('src'); video.load(); }catch(_){}
      if(stream){
        stream.getTracks().forEach(function(t){ try{ t.stop(); }catch(_){} });
        stream = null;
      }
      try{ URL.revokeObjectURL(url); }catch(_){}
    };
    const fail = function(err){
      if(settled) return;
      settled = true;
      cleanup();
      reject(err instanceof Error ? err : new Error(String(err || 'Convert failed')));
    };
    const ok = function(blob){
      if(settled) return;
      settled = true;
      cleanup();
      resolve(blob);
    };
    video.onerror = function(){ fail(new Error('Could not open that video')); };
    video.onloadedmetadata = function(){
      try{
        const duration = Math.min(video.duration || capSec, capSec);
        if(!isFinite(duration) || duration < 0.2){
          fail(new Error('Could not read video length'));
          return;
        }
        const vw = video.videoWidth || 1280;
        const vh = video.videoHeight || 720;
        const maxEdge = 1280;
        const scale = Math.min(1, maxEdge / Math.max(vw, vh));
        const cw = Math.max(2, Math.round(vw * scale / 2) * 2);
        const ch = Math.max(2, Math.round(vh * scale / 2) * 2);
        const canvas = document.createElement('canvas');
        canvas.width = cw;
        canvas.height = ch;
        const ctx = canvas.getContext('2d');
        stream = canvas.captureStream(30);
        // Prefer real audio track when available
        try{
          const mediaStream = (video.captureStream && video.captureStream())
            || (video.mozCaptureStream && video.mozCaptureStream());
          if(mediaStream){
            mediaStream.getAudioTracks().forEach(function(t){
              try{ stream.addTrack(t); }catch(_){}
            });
          }
        }catch(_){}
        const bits = Math.min(3500000, Math.max(1200000, Math.round(cw * ch * 2.2)));
        try{
          recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: bits });
        }catch(e){
          try{ recorder = new MediaRecorder(stream); }
          catch(e2){ fail(new Error('Recorder unavailable')); return; }
        }
        recorder.ondataavailable = function(ev){
          if(ev.data && ev.data.size) chunks.push(ev.data);
        };
        recorder.onerror = function(){ fail(new Error('Convert failed')); };
        recorder.onstop = function(){
          const outType = (chunks[0] && chunks[0].type) || mime.split(';')[0] || 'video/webm';
          const blob = new Blob(chunks, { type: outType });
          if(!blob.size){ fail(new Error('Convert produced empty file')); return; }
          try{ blob._nalunoName = 'signal-' + Date.now() + (outType.indexOf('mp4') >= 0 ? '.mp4' : '.webm'); }catch(_){}
          ok(blob);
        };
        const draw = function(){
          if(settled) return;
          try{
            if(video.videoWidth) ctx.drawImage(video, 0, 0, cw, ch);
          }catch(_){}
          if(onProgress && duration){
            try{ onProgress(Math.min(0.99, (video.currentTime || 0) / duration)); }catch(_){}
          }
          if(video.currentTime >= duration - 0.05 || video.ended){
            try{ if(recorder.state === 'recording') recorder.stop(); }catch(_){}
            return;
          }
          raf = requestAnimationFrame(draw);
        };
        video.currentTime = 0;
        const startRec = function(){
          try{ recorder.start(1000); }catch(e){ fail(e); return; }
          video.play().then(function(){
            raf = requestAnimationFrame(draw);
          }).catch(function(){
            // play blocked — still draw from seeks
            raf = requestAnimationFrame(draw);
            const step = function(){
              if(settled) return;
              const next = Math.min(duration, (video.currentTime || 0) + 1/30);
              video.currentTime = next;
            };
            video.addEventListener('seeked', function onSeek(){
              if(settled){ video.removeEventListener('seeked', onSeek); return; }
              try{ if(video.videoWidth) ctx.drawImage(video, 0, 0, cw, ch); }catch(_){}
              if((video.currentTime || 0) >= duration - 0.05){
                video.removeEventListener('seeked', onSeek);
                try{ if(recorder.state === 'recording') recorder.stop(); }catch(_){}
                return;
              }
              step();
            });
            step();
          });
        };
        if(video.readyState >= 2) startRec();
        else video.addEventListener('loadeddata', startRec, { once: true });
        // Hard stop
        setTimeout(function(){
          if(settled) return;
          try{ if(recorder && recorder.state === 'recording') recorder.stop(); }catch(_){}
        }, Math.ceil(duration * 1000) + 15000);
      }catch(e){ fail(e); }
    };
  });
}

/** Decide if Signal should convert before upload (HEVC / non-progressive). */
async function nalunoPrepareSignalVideo(source, onProgress){
  let blob = source;
  if(typeof source === 'string'){
    blob = await (await fetch(source)).blob();
  }
  if(!(blob instanceof Blob) && !(blob instanceof File)) throw new Error('Invalid media data');
  if(!(blob.size > 0)) throw new Error('Empty file — pick again from Files (not Google Photos prepare)');
  // Always set a real streaming Content-Type later; detect HEVC for convert
  const hevc = await nalunoSniffIsHevc(blob);
  if(hevc){
    if(onProgress) onProgress(0.02, 'Converting Samsung video for playback…');
    const out = await nalunoTranscodeToWeb(blob, function(p){
      if(onProgress) onProgress(0.02 + p * 0.75, 'Converting… ' + Math.round(p * 100) + '%');
    }, (typeof MAX_VIDEO_SECONDS === 'number' ? MAX_VIDEO_SECONDS : 240));
    return out;
  }
  // Very large single POST will fail — chunk path handles it in uploadVideoToR2
  return blob;
}

window.nalunoSniffIsHevc = nalunoSniffIsHevc;
window.nalunoTranscodeToWeb = nalunoTranscodeToWeb;
window.nalunoPrepareSignalVideo = nalunoPrepareSignalVideo;

const VIDEO_PICK_ACCEPT = 'video/*';
const IMAGE_PICK_ACCEPT = 'image/*';
const BCAST_PICK_ACCEPT = VIDEO_PICK_ACCEPT + ',' + IMAGE_PICK_ACCEPT;

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

function bindMediaElement(el, rawUrl, opts){
  if(!el) return;
  opts = opts || {};
  const broadcastId = opts.broadcastId || el.dataset.broadcastId || null;
  const urls = (typeof nalunoPlayCandidates === 'function') ? nalunoPlayCandidates(rawUrl) : [resolveMediaUrl(rawUrl)];
  const url = urls[0] || resolveMediaUrl(rawUrl);
  if(!url){
    nalunoMediaDiag(broadcastId, null, 'invalid_media_reference', 'empty url');
    return;
  }
  const mediaId = nalunoMediaIdFromUrl(url) || nalunoMediaIdFromUrl(rawUrl);
  if(broadcastId) el.dataset.broadcastId = broadcastId;
  if(mediaId) el.dataset.mediaId = mediaId;
  el.setAttribute('playsinline', '');
  el.setAttribute('webkit-playsinline', '');
  el.setAttribute('preload', 'auto');
  try{ el.preload = 'auto'; }catch(_){}
  if(typeof containMediaElement === 'function') containMediaElement(el);

  // Do not reset src if this element is already playing the same asset.
  const current = (el.currentSrc || el.getAttribute('src') || '').split('?')[0];
  const nextBare = String(url).split('?')[0];
  const sameAsset = !!(current && nextBare && (current.indexOf(nextBare) >= 0 || nextBare.indexOf(current) >= 0 ||
    (mediaId && current.indexOf(mediaId) >= 0)));
  if(sameAsset && !el.paused && (el.readyState >= 2 || (el.currentTime || 0) > 0.05)){
    nalunoMediaSetState(mediaId, 'playing');
    attachPlaybackGuard(el, url);
    return;
  }
  if(!sameAsset){
    const key = (typeof vaultKeyForUrl === 'function') ? vaultKeyForUrl(url) : '';
    const cached = (key && typeof vaultSyncSrc === 'function') ? vaultSyncSrc(key) : '';
    // Assign src only — never call load() here; load() aborts in-flight play (MEDIA_ERR_ABORTED).
    el.src = cached || url;
    nalunoMediaSetState(mediaId, 'loading');
  }

  let urlIndex = 0;
  el.onerror = function(){
    const code = el.error && el.error.code;
    // MEDIA_ERR_ABORTED (1) = src was reset (remount/load). Do not hop buckets.
    if(code === 1){
      nalunoMediaDiag(broadcastId, mediaId, 'component_remount_or_abort', { code: 1, src: el.src });
      return;
    }
    const cause = nalunoMediaClassifyError(el, el.error);
    nalunoMediaDiag(broadcastId, mediaId, cause, { code: code, src: urls[urlIndex] || url });
    urlIndex++;
    if(urlIndex < urls.length){
      nalunoMediaSetState(mediaId, 'retrying');
      el.src = urls[urlIndex];
      el.play().catch(function(){});
      return;
    }
    if(!el.dataset.retried){
      el.dataset.retried = '1';
      const key = (typeof vaultKeyForUrl === 'function') ? vaultKeyForUrl(url) : '';
      if(key && typeof vaultObjectUrl === 'function'){
        vaultObjectUrl(key).then(function(u){
          if(u){ el.src = u; el.play().catch(function(){}); }
        }).catch(function(){});
      }
    }
  };
  const mark = function(state){ return function(){ nalunoMediaSetState(mediaId, state); }; };
  el.addEventListener('loadeddata', mark('loaded'));
  el.addEventListener('playing', mark('playing'));
  el.addEventListener('pause', mark('paused'));
  el.addEventListener('waiting', mark('buffering'));
  el.addEventListener('stalled', mark('buffering'));
  attachPlaybackGuard(el, url);
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
  if(!(blob.size > 0)) throw new Error('Empty file — pick from Files app (Google Photos prepare can yield 0 bytes)');
  let contentType = (typeof nalunoGuessContentType === 'function')
    ? nalunoGuessContentType(blob)
    : ((blob.type && blob.type !== 'application/octet-stream')
      ? blob.type
      : 'video/mp4');
  // Never upload as octet-stream — browsers refuse to play it
  if(!contentType || /octet-stream|application\/download|binary\//i.test(contentType)){
    contentType = (blob.type && String(blob.type).indexOf('webm') >= 0) ? 'video/webm' : 'video/mp4';
  }
  if((blob.type && String(blob.type).indexOf('webm') >= 0) || (blob._nalunoName && /\.webm$/i.test(blob._nalunoName))){
    contentType = 'video/webm';
  }

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
    // Large or flaky single POST → chunked original upload
    if(e && typeof uploadSignalChunked === 'function' && (blob.size || 0) > 8 * 1024 * 1024){
      try{
        return await uploadSignalChunked(blob, contentType);
      }catch(e3){ e = e3; }
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
