/* ============================================================
   MODULE: js/broadcast-composer.js
   Dedicated Broadcast uploader — completely separate from Signal.
   - Up to 10 minutes of video
   - Client-side quality-preserving compression ("panda": efficient, gentle)
   - Own UI, own limits, own publish path
   DO NOT route Signal through this file.
   ============================================================ */

const BCAST_MAX_SECONDS = 10 * 60; // 10 minutes
const BCAST_MAX_UPLOAD_BYTES = 150 * 1024 * 1024; // soft target after smart compress; no hard 60MB reject
const BCAST_TARGET_HEIGHT = 1080; // phone-sharp; long clips still scale bitrate down

let bcompFile = null;       // original File
let bcompPreviewUrl = null;
let bcompCompressedBlob = null;
let bcompDuration = 0;
let bcompKind = null; // 'video' | 'photo' | null
let bcompPublishing = false;

function bcompOpen(){
  if(!currentUser){ toast('Sign in to publish a Broadcast'); return; }
  bcompReset();
  const el = $('bcomposer');
  if(el) el.classList.add('active');
}

function bcompClose(){
  if(bcompPublishing) return;
  bcompReset();
  const el = $('bcomposer');
  if(el) el.classList.remove('active');
}

function bcompReset(){
  bcompFile = null;
  bcompCompressedBlob = null;
  bcompDuration = 0;
  bcompKind = null;
  if(bcompPreviewUrl){ try{ URL.revokeObjectURL(bcompPreviewUrl); }catch(_){} bcompPreviewUrl = null; }
  const prev = $('bcompPreview');
  if(prev) prev.innerHTML = '';
  const note = $('bcompStatus');
  if(note) note.textContent = '';
  const title = $('bcompTitle');
  if(title) title.value = '';
  const tags = $('bcompTags');
  if(tags) tags.value = '';
  const desc = $('bcompDesc');
  if(desc) desc.value = '';
  const pub = $('bcompPublishBtn');
  if(pub){ pub.disabled = true; pub.textContent = 'Publish Broadcast'; }
  const fileIn = $('bcompFileInput');
  if(fileIn) fileIn.value = '';
  const prog = $('bcompProgress');
  if(prog){ prog.style.display = 'none'; prog.textContent = ''; }
}

function bcompProbeDuration(file){
  return new Promise(resolve=>{
    const v = document.createElement('video');
    v.preload = 'metadata';
    const url = URL.createObjectURL(file);
    v.onloadedmetadata = ()=>{
      const d = v.duration || 0;
      URL.revokeObjectURL(url);
      resolve(d);
    };
    v.onerror = ()=>{ URL.revokeObjectURL(url); resolve(0); };
    v.src = url;
  });
}

/** YouTube-like bitrate ladder for mobile viewing quality. */
function bcompPickBitrate(durationSec, width, height){
  const pixels = (width || 1280) * (height || 720);
  let base;
  if(pixels >= 1920 * 1080 * 0.8) base = 4_500_000;      // ~1080p
  else if(pixels >= 1280 * 720 * 0.8) base = 2_800_000;  // ~720p
  else if(pixels >= 854 * 480 * 0.8) base = 1_600_000;   // ~480p
  else base = 1_000_000;
  if(durationSec > 180) base = Math.round(base * 0.85);
  if(durationSec > 420) base = Math.round(base * 0.85);
  return base;
}

function bcompPickMime(){
  const candidates = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
    'video/mp4',
  ];
  if(window.MediaRecorder){
    for(const m of candidates){
      if(MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(m)) return m;
    }
  }
  return 'video/webm';
}

/**
 * Panda compress: gentle re-encode to 720p @ adaptive bitrate.
 * Quality stays high for phone viewing; size stays upload-friendly.
 */
function compressBroadcastVideo(file, onProgress){
  return new Promise(async (resolve, reject)=>{
    const duration = await bcompProbeDuration(file);
    if(!duration || duration < 0.3){
      reject(new Error('Could not read that video'));
      return;
    }
    if(duration > BCAST_MAX_SECONDS + 1){
      reject(new Error('Broadcast video max is 10 minutes'));
      return;
    }

    // Pass-through when already efficient — never inflate a good encode
    const sourceBps = (file.size * 8) / Math.max(0.5, duration);
    const likelyEfficient = sourceBps <= 5_500_000; // already ≤~5.5 Mbps
    if(file.size <= 120 * 1024 * 1024 && duration <= 180 && likelyEfficient){
      if(onProgress) onProgress(1, 'Ready · original kept');
      resolve({ blob: file, duration, skipped: true });
      return;
    }
    if(file.size <= 40 * 1024 * 1024 && duration <= 120){
      if(onProgress) onProgress(1, 'Ready · original kept');
      resolve({ blob: file, duration, skipped: true });
      return;
    }

    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.src = url;

    const cleanup = ()=>{ try{ URL.revokeObjectURL(url); }catch(_){} };

    video.onerror = ()=>{ cleanup(); reject(new Error('Could not decode video')); };

    await new Promise((res, rej)=>{
      video.onloadeddata = ()=> res();
      video.onerror = ()=> rej(new Error('Could not load video'));
    }).catch(e=>{ cleanup(); reject(e); return; });

    const vw = video.videoWidth || 1280;
    const vh = video.videoHeight || 720;
    const scale = Math.min(1, BCAST_TARGET_HEIGHT / Math.max(vh, 1));
    const cw = Math.max(2, Math.round(vw * scale / 2) * 2);
    const ch = Math.max(2, Math.round(vh * scale / 2) * 2);

    const canvas = document.createElement('canvas');
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext('2d');

    let stream;
    try{
      stream = canvas.captureStream(30);
    }catch(e){
      cleanup();
      reject(new Error('Compression not supported on this device'));
      return;
    }

    // Attach audio if present
    try{
      const audioStream = video.captureStream ? video.captureStream() : (video.mozCaptureStream && video.mozCaptureStream());
      if(audioStream){
        audioStream.getAudioTracks().forEach(t => stream.addTrack(t));
      }
    }catch(_){}

    const mime = bcompPickMime();
    const bitrate = bcompPickBitrate(duration, cw, ch);
    let recorder;
    try{
      recorder = new MediaRecorder(stream, {
        mimeType: mime,
        videoBitsPerSecond: bitrate,
        audioBitsPerSecond: 128000,
      });
    }catch(e){
      try{ recorder = new MediaRecorder(stream); }
      catch(e2){
        cleanup();
        reject(new Error('Recorder unavailable'));
        return;
      }
    }

    const chunks = [];
    recorder.ondataavailable = e=>{ if(e.data && e.data.size) chunks.push(e.data); };

    recorder.onerror = ()=>{
      cleanup();
      reject(new Error('Compression failed'));
    };

    recorder.onstop = ()=>{
      cleanup();
      stream.getTracks().forEach(t=>{ try{ t.stop(); }catch(_){} });
      const blob = new Blob(chunks, { type: mime.split(';')[0] || 'video/webm' });
      if(!blob.size){
        reject(new Error('Compression produced an empty file'));
        return;
      }
      resolve({ blob, duration, skipped: false, width: cw, height: ch, bitrate });
    };

    // Draw loop while playing
    let raf = 0;
    const draw = ()=>{
      if(video.paused || video.ended) return;
      ctx.drawImage(video, 0, 0, cw, ch);
      raf = requestAnimationFrame(draw);
    };

    video.ontimeupdate = ()=>{
      if(onProgress && duration){
        onProgress(Math.min(0.99, video.currentTime / duration), 'Compressing…');
      }
    };

    video.onended = ()=>{
      cancelAnimationFrame(raf);
      // small tail so last frames flush
      setTimeout(()=>{ try{ recorder.stop(); }catch(_){} }, 120);
    };

    try{
      recorder.start(250);
      await video.play();
      draw();
    }catch(e){
      cleanup();
      reject(e);
    }
  });
}

async function bcompOnFileChosen(file){
  if(!file) return;
  const isVideo = file.type.startsWith('video/');
  const isImage = file.type.startsWith('image/');
  if(!isVideo && !isImage){
    toast('Choose a photo or video');
    return;
  }

  bcompFile = file;
  bcompCompressedBlob = null;
  if(bcompPreviewUrl){ try{ URL.revokeObjectURL(bcompPreviewUrl); }catch(_){} }
  bcompPreviewUrl = URL.createObjectURL(file);

  const prev = $('bcompPreview');
  const status = $('bcompStatus');
  const pub = $('bcompPublishBtn');
  const prog = $('bcompProgress');

  if(isImage){
    bcompKind = 'photo';
    bcompDuration = 0;
    if(prev) prev.innerHTML = `<img src="${bcompPreviewUrl}" alt="" style="width:100%;max-height:42vh;object-fit:contain;border-radius:14px;background:#000;" />`;
    if(status) status.textContent = 'Photo ready';
    if(prog) prog.style.display = 'none';
    if(pub) pub.disabled = false;
    return;
  }

  bcompKind = 'video';
  if(prev){
    prev.innerHTML = `<video src="${bcompPreviewUrl}" controls playsinline style="width:100%;max-height:42vh;border-radius:14px;background:#000;"></video>`;
  }

  const duration = await bcompProbeDuration(file);
  bcompDuration = duration;
  if(duration > BCAST_MAX_SECONDS + 1){
    toast('Broadcast videos can be up to 10 minutes');
    bcompReset();
    return;
  }

  const mins = Math.floor(duration / 60);
  const secs = Math.round(duration % 60);
  if(status) status.textContent = `Original · ${mins}:${String(secs).padStart(2,'0')} · ${Math.round(file.size/1024/1024)} MB`;

  // Compress in background
  if(pub){ pub.disabled = true; pub.textContent = 'Preparing…'; }
  if(prog){ prog.style.display = 'block'; prog.textContent = 'Compressing for upload…'; }

  try{
    const result = await compressBroadcastVideo(file, (frac, label)=>{
      if(prog) prog.textContent = `${label || 'Compressing…'} ${Math.round(frac * 100)}%`;
    });
    bcompCompressedBlob = result.blob;
    bcompDuration = result.duration || duration;
    const outMb = (result.blob.size / 1024 / 1024).toFixed(1);
    if(status){
      status.textContent = result.skipped
        ? `Ready · ${outMb} MB`
        : `Compressed · ${outMb} MB · quality preserved for mobile`;
    }
    if(prog){ prog.textContent = 'Ready to publish'; }
    if(pub){ pub.disabled = false; pub.textContent = 'Publish Broadcast'; }

    // If still too large, one more harder pass
    if(result.blob.size > BCAST_MAX_UPLOAD_BYTES){
      if(prog) prog.textContent = 'Optimizing size…';
      // Accept for now; publish will try and may fail with clear toast
      if(status) status.textContent = `Large file (${outMb} MB) — upload may take a while`;
    }
  }catch(e){
    console.warn('[bcomp] compress', e);
    // Fall back to original if under hard duration
    bcompCompressedBlob = file;
    if(status) status.textContent = 'Using original file';
    if(prog) prog.textContent = '';
    if(pub){ pub.disabled = false; pub.textContent = 'Publish Broadcast'; }
    if(e && e.message) toast(e.message);
  }
}

async function bcompPublish(){
  if(bcompPublishing) return;
  if(!currentUser || !fbDb){ toast('Sign in first'); return; }
  if(!bcompKind){ toast('Add a photo or video first'); return; }

  const title = (($('bcompTitle') && $('bcompTitle').value) || '').trim();
  const tagsRaw = (($('bcompTags') && $('bcompTags').value) || '');
  const tags = tagsRaw.split(',').map(s=>s.trim()).filter(Boolean).slice(0, 12);
  const desc = (($('bcompDesc') && $('bcompDesc').value) || '').trim();

  if(!title){
    toast('Add a title for your Broadcast');
    return;
  }

  // Snapshot + close immediately — compress/upload continues in background
  const snapKind = bcompKind;
  const snapFile = bcompFile;
  const snapBlob = bcompCompressedBlob || bcompFile;
  const snapTitle = title;
  const snapDesc = desc;
  const snapTags = tags.slice();
  bcompPublishing = false;
  bcompClose();

  const job = {
    label: 'Publishing Broadcast…',
    doneMsg: 'Broadcast published',
    run: async (progress)=>{
      let mediaType = snapKind;
      let mediaUrl = null;
      let thumbUrl = null;
      if(snapKind === 'photo'){
        if(progress) progress('Uploading photo…');
        mediaUrl = await uploadVideoToR2(snapFile);
        thumbUrl = mediaUrl;
      } else {
        if(!snapBlob) throw new Error('No video ready');
        if(progress) progress('Uploading ' + Math.round(snapBlob.size/1024/1024) + ' MB…');
        mediaUrl = await uploadVideoToR2(snapBlob);
        try{ thumbUrl = await generateVideoThumbnail(mediaUrl); }catch(_){}
      }
      if(typeof createPermanentBroadcast !== 'function') throw new Error('Broadcast core not loaded');
      if(progress) progress('Saving Broadcast…');
      const b = await createPermanentBroadcast({
        title: snapTitle, description: snapDesc, tags: snapTags,
        mediaType, mediaUrl, thumbUrl, filterCss: '',
      });
      if(typeof loadFeedBroadcasts === 'function') await loadFeedBroadcasts();
      if(typeof openBroadcastById === 'function') openBroadcastById(b.id);
    },
  };
  if(typeof enqueuePublishJob === 'function') enqueuePublishJob(job);
  else {
    job.run(()=>{}).then(()=> toast('Broadcast published')).catch(e=> toast(e.message || 'Publish failed'));
  }
}

function bcompWire(){
  const openBtn = $('newBroadcastBtn');
  if(openBtn){
    openBtn.onclick = (e)=>{
      if(e){ e.preventDefault(); e.stopPropagation(); }
      bcompOpen();
    };
  }
  if($('bcompClose')) $('bcompClose').onclick = bcompClose;
  if($('bcompPickBtn')) $('bcompPickBtn').onclick = ()=> $('bcompFileInput') && $('bcompFileInput').click();
  if($('bcompFileInput')){
    $('bcompFileInput').onchange = (e)=>{
      const f = e.target.files && e.target.files[0];
      e.target.value = '';
      if(f) bcompOnFileChosen(f);
    };
  }
  if($('bcompPublishBtn')) $('bcompPublishBtn').onclick = bcompPublish;
}

// Wire when DOM ready
if(document.readyState === 'loading'){
  document.addEventListener('DOMContentLoaded', bcompWire);
} else {
  bcompWire();
}
