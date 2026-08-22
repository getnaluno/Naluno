/* ============================================================
   MODULE: js/broadcast-upload.js
   OWNERSHIP: chunked Broadcast file upload ONLY.
   Never re-encodes. Never used by Signal or calls.
   ============================================================ */
const BROADCAST_UPLOAD_WORKER_URL = 'https://naluno-broadcast-upload.naluno.workers.dev';
const BCAST_CHUNK_BYTES = 8 * 1024 * 1024; // 8 MiB parts (R2 min 5 MiB except last)

function bcastUploadEndpoints(){
  const list = [];
  if(BROADCAST_UPLOAD_WORKER_URL) list.push(BROADCAST_UPLOAD_WORKER_URL.replace(/\/+$/, ''));
  if(typeof SIGNAL_UPLOAD_WORKER_URL === 'string' && SIGNAL_UPLOAD_WORKER_URL){
    const s = SIGNAL_UPLOAD_WORKER_URL.replace(/\/+$/, '');
    if(list.indexOf(s) < 0) list.push(s);
  }
  return list;
}

function bcastGuessType(blob){
  if(blob && blob.type && blob.type !== 'application/octet-stream') return blob.type;
  const name = (blob && blob.name) ? String(blob.name) : '';
  if(/\.mp4$/i.test(name)) return 'video/mp4';
  if(/\.webm$/i.test(name)) return 'video/webm';
  if(/\.mov$/i.test(name)) return 'video/quicktime';
  return 'video/mp4';
}

async function bcastAuthHeader(force){
  if(!currentUser) throw new Error('Sign in again to upload');
  const token = await currentUser.getIdToken(!!force);
  return { 'Authorization': 'Bearer ' + token };
}

async function uploadBroadcastFile(blob, onProgress){
  try{ if(typeof nalunoKeepAliveStart === 'function') await nalunoKeepAliveStart('broadcast'); }catch(_){}
  try{
    return await uploadBroadcastFileInner(blob, onProgress);
  }finally{
    try{ if(typeof nalunoKeepAliveStop === 'function') nalunoKeepAliveStop(); }catch(_){}
  }
}
async function uploadBroadcastFileInner(blob, onProgress){
  if(!(blob instanceof Blob) && !(blob instanceof File)) throw new Error('Invalid media');
  const size = blob.size || 0;
  if(size < 1) throw new Error('Empty video');
  const contentType = bcastGuessType(blob);
  const endpoints = bcastUploadEndpoints();
  let lastErr = null;
  for(const base of endpoints){
    try{
      return await uploadBroadcastFileTo(base, blob, contentType, onProgress);
    }catch(e){
      lastErr = e;
      console.warn('[bcast-upload] endpoint failed', base, e && e.message);
    }
  }
  throw lastErr || new Error('Upload failed');
}

async function uploadBroadcastFileTo(base, blob, contentType, onProgress){
  const size = blob.size;
  const auth = await bcastAuthHeader(false);
  const initRes = await fetch(base + '/b/init', {
    method: 'POST',
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
        partRes = await fetch(partUrl, {
          method: 'PUT',
          headers: Object.assign({ 'Content-Type': 'application/octet-stream' }, auth),
          body: chunk,
        });
        if(partRes.status === 401 || partRes.status === 403){
          const auth2 = await bcastAuthHeader(true);
          partRes = await fetch(partUrl, {
            method: 'PUT',
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
  const doneRes = await fetch(base + '/b/complete', {
    method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/json' }, await bcastAuthHeader(false)),
    body: JSON.stringify({ key, uploadId, parts, bytes: size }),
  });
  const doneBody = await doneRes.json().catch(()=>({}));
  if(!doneRes.ok) throw new Error(doneBody.error || 'Could not finish upload');
  let url = doneBody.url;
  if(!url && doneBody.key && typeof resolveMediaUrl === 'function'){
    url = resolveMediaUrl('/o/' + doneBody.key);
  }
  if(!url && doneBody.key && typeof SIGNAL_UPLOAD_WORKER_URL === 'string'){
    url = SIGNAL_UPLOAD_WORKER_URL.replace(/\/+$/, '') + '/o/' + doneBody.key;
  }
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
