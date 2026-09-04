/* ============================================================
   MODULE: js/broadcast-upload.js
   OWNERSHIP: chunked Broadcast file upload ONLY.
   Never re-encodes. Never used by Signal or calls.
   ============================================================ */
const BROADCAST_UPLOAD_WORKER_URL = 'https://naluno-broadcast-upload.naluno.workers.dev';
const BCAST_CHUNK_BYTES = 8 * 1024 * 1024; // 8 MiB parts (R2 min 5 MiB except last)

/* FIX (20260826 / bug: "Broadcast videos die after ~a day"):
   Broadcast must NEVER fall back to the Signal upload worker. That worker
   writes into the naluno-signal R2 bucket, which has a 25h auto-delete
   lifecycle rule — Broadcast content is meant to be permanent. The old
   fallback here silently rerouted failed Broadcast uploads into that
   ephemeral bucket with no error shown, which is why some (or, once the
   dedicated broadcast worker also turned out to share that same bucket,
   effectively all) Broadcast videos were vanishing about a day after
   posting. There is now exactly one upload target for Broadcast, and a
   failed upload surfaces a real error instead of silently succeeding
   somewhere unsafe. */
function bcastUploadEndpoints(){
  return BROADCAST_UPLOAD_WORKER_URL ? [BROADCAST_UPLOAD_WORKER_URL.replace(/\/+$/, '')] : [];
}

function bcastGuessType(blob){
  if(blob && blob.type && blob.type !== 'application/octet-stream' && blob.type !== 'application/download'){
    if(String(blob.type).indexOf('audio/') === 0) return blob.type;
    if(String(blob.type).indexOf('image/') === 0) return blob.type;
    if(String(blob.type).indexOf('webm') >= 0) return 'video/webm';
    if(String(blob.type).indexOf('video/') === 0) return blob.type;
  }
  const name = (blob && (blob.name || blob._nalunoName)) ? String(blob.name || blob._nalunoName) : '';
  if(/\.(jpe?g)$/i.test(name)) return 'image/jpeg';
  if(/\.png$/i.test(name)) return 'image/png';
  if(/\.webp$/i.test(name)) return 'image/webp';
  if(/\.webm$/i.test(name) && /audio/i.test((blob && blob.type) || '')) return 'audio/webm';
  if(/\.webm$/i.test(name)) return 'video/webm';
  if(/\.mov$/i.test(name) || /\.qt$/i.test(name)) return 'video/quicktime';
  if(/\.m4v$/i.test(name)) return 'video/x-m4v';
  if(/\.3g2$/i.test(name)) return 'video/3gpp2';
  if(/\.3gp$/i.test(name)) return 'video/3gpp';
  if(/\.mkv$/i.test(name)) return 'video/x-matroska';
  if(/\.avi$/i.test(name)) return 'video/x-msvideo';
  if(/\.(mpg|mpeg)$/i.test(name)) return 'video/mpeg';
  if(/\.ogv$/i.test(name)) return 'video/ogg';
  if(/\.(ts|m2ts|mts)$/i.test(name)) return 'video/mp2t';
  if(/\.wmv$/i.test(name)) return 'video/x-ms-wmv';
  if(/\.mp4$/i.test(name) || /\.hevc$/i.test(name) || /\.h265$/i.test(name)) return 'video/mp4';
  return 'video/mp4';
}

async function bcastAuthHeader(force){
  if(!currentUser) throw new Error('Sign in again to upload');
  const token = await currentUser.getIdToken(!!force);
  return { 'Authorization': 'Bearer ' + token };
}

async function uploadBroadcastFile(blob, onProgress, contentTypeOverride){
  try{ if(typeof nalunoUploadLog === 'function') nalunoUploadLog('Broadcast upload start', (blob && blob.size) ? Math.round(blob.size/1024)+'KB' : ''); }catch(_){}
  try{ if(typeof nalunoKeepAliveStart === 'function') await nalunoKeepAliveStart('broadcast'); }catch(_){}
  try{
    const url = await uploadBroadcastFileInner(blob, onProgress, contentTypeOverride);
    try{ if(typeof nalunoUploadLog === 'function') nalunoUploadLog('Broadcast upload ok', url); }catch(_){}
    return url;
  }catch(e){
    try{ if(typeof nalunoUploadLog === 'function') nalunoUploadLog('Broadcast upload FAIL', e && e.message); }catch(_){}
    throw e;
  }finally{
    try{ if(typeof nalunoKeepAliveStop === 'function') nalunoKeepAliveStop(); }catch(_){}
  }
}
async function uploadBroadcastFileInner(blob, onProgress, contentTypeOverride){
  if(!(blob instanceof Blob) && !(blob instanceof File)) throw new Error('Invalid media');
  const size = blob.size || 0;
  if(size < 1) throw new Error('Empty file');
  // contentTypeOverride lets non-video files (Wireline photos and documents)
  // use this same proven upload path without bcastGuessType() forcing them
  // to video/mp4 — it is video-only by design and always falls back to
  // 'video/mp4', which is correct for Broadcast media and wrong for a photo.
  const contentType = contentTypeOverride || bcastGuessType(blob);
  const endpoints = bcastUploadEndpoints();
  if(!endpoints.length) throw new Error('Upload is not configured');
  const base = endpoints[0];
  // Retry the SAME (correct-bucket) endpoint on transient failure — never a
  // different endpoint, and never one that could land in the wrong bucket.
  let lastErr = null;
  for(let attempt = 1; attempt <= 2; attempt++){
    try{
      return await uploadBroadcastFileTo(base, blob, contentType, onProgress);
    }catch(e){
      lastErr = e;
      console.warn('[bcast-upload] attempt ' + attempt + ' failed', e && e.message);
      if(attempt < 2) await new Promise(r => setTimeout(r, 1200));
    }
  }
  throw lastErr || new Error('Upload failed');
}

async function uploadBroadcastFileTo(base, blob, contentType, onProgress){
  const size = blob.size;
  const auth = await bcastAuthHeader(false);
  const initRes = await (typeof nalunoFetch === 'function' ? nalunoFetch : fetch)(base + '/b/init', {
    method: 'POST',
    mode: 'cors',
    credentials: 'omit',
    headers: Object.assign({ 'Content-Type': 'application/json' }, auth),
    body: JSON.stringify({ contentType, bytes: size }),
  });
  const initBody = await initRes.json().catch(()=>({}));
  if(!initRes.ok){
    const err = new Error(initBody.error || ('Init failed (' + initRes.status + ')'));
    err.status = initRes.status;
    throw err;
  }
  const key = initBody.key;
  const uploadId = initBody.uploadId;
  if(!key || !uploadId) throw new Error('Upload session missing');

  const parts = [];
  const totalParts = Math.max(1, Math.ceil(size / BCAST_CHUNK_BYTES));
  let sent = 0;
  for(let i = 0; i < totalParts; i++){
    const start = i * BCAST_CHUNK_BYTES;
    const end = Math.min(size, start + BCAST_CHUNK_BYTES);
    const chunk = blob.slice(start, end);
    if(onProgress){
      onProgress(sent / size, 'Uploading… ' + Math.round((sent / size) * 100) + '% (' + (i+1) + '/' + totalParts + ')');
    }
    const partNum = i + 1;
    const partUrl = base + '/b/part?key=' + encodeURIComponent(key)
      + '&uploadId=' + encodeURIComponent(uploadId)
      + '&part=' + partNum;
    let partRes = null;
    let partBody = {};
    let attempt = 0;
    while(attempt < 6){
      attempt++;
      try{
        partRes = await (typeof nalunoFetch === 'function' ? nalunoFetch : fetch)(partUrl, {
          method: 'PUT',
          mode: 'cors',
          credentials: 'omit',
          headers: Object.assign({ 'Content-Type': 'application/octet-stream' }, auth),
          body: chunk,
        });
        if(partRes.status === 401 || partRes.status === 403){
          const auth2 = await bcastAuthHeader(true);
          partRes = await (typeof nalunoFetch === 'function' ? nalunoFetch : fetch)(partUrl, {
            method: 'PUT',
            mode: 'cors',
            credentials: 'omit',
            headers: Object.assign({ 'Content-Type': 'application/octet-stream' }, auth2),
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
        if(onProgress) onProgress(sent / size, 'Retrying part ' + partNum + '…');
        await new Promise(r => setTimeout(r, 800 * attempt));
        continue;
      }
      if(onProgress) onProgress(sent / size, 'Retrying part ' + partNum + '…');
      await new Promise(r => setTimeout(r, 800 * attempt));
    }
    if(!partRes || !partRes.ok) throw new Error(partBody.error || ('Part ' + partNum + ' failed'));
    parts.push({ part: partNum, etag: partBody.etag });
    sent = end;
  }
  if(onProgress) onProgress(0.97, 'Finishing upload…');
  const doneRes = await (typeof nalunoFetch === 'function' ? nalunoFetch : fetch)(base + '/b/complete', {
    method: 'POST',
    mode: 'cors',
    credentials: 'omit',
    headers: Object.assign({ 'Content-Type': 'application/json' }, await bcastAuthHeader(false)),
    body: JSON.stringify({ key, uploadId, parts, bytes: size }),
  });
  const doneBody = await doneRes.json().catch(()=>({}));
  if(!doneRes.ok) throw new Error(doneBody.error || 'Could not finish upload');
  // The worker always returns a full, correct-bucket playback URL. If it's
  // ever missing, build it against THIS SAME broadcast endpoint (`base`) —
  // never the Signal worker, which would point at the wrong bucket entirely.
  let url = doneBody.url || (doneBody.key ? (base + '/o/' + doneBody.key) : '');
  if(!url) throw new Error('Upload succeeded but no URL returned');
  if(typeof resolveMediaUrl === 'function') url = resolveMediaUrl(url);
  if(onProgress) onProgress(1, 'Uploaded');
  return url;
}

/** Chapter plan for playback only — never split/re-encode the file. */
function planSeekChapters(durationSec){
  const dur = Math.max(0, durationSec || 0);
  const target = 240;
  if(dur <= target){
    return { showChapterUI: false, parts: [{ index: 0, start: 0, end: dur }] };
  }
  const parts = [];
  let i = 0;
  for(let start = 0; start < dur - 0.5; start += target){
    parts.push({ index: i++, start, end: Math.min(dur, start + target) });
    if(i >= 45) break;
  }
  return { showChapterUI: parts.length > 1, parts };
}
