/* ============================================================
   MODULE: js/broadcast-composer.js
   Dedicated Broadcast uploader — completely separate from Signal.
   - Up to 10 minutes of video
   - Client-side quality-preserving compression ("panda": efficient, gentle)
   - Own UI, own limits, own publish path
   DO NOT route Signal through this file.
   ============================================================ */

const BCAST_MAX_SECONDS = 10 * 60; // 10 minutes
const BCAST_MAX_UPLOAD_BYTES = 55 * 1024 * 1024; // stay under typical worker caps after compress
const BCAST_TARGET_HEIGHT = 720; // sharp on phones; keeps bitrate sane for long clips

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

/** Pick a bitrate that keeps quality high on mobile without oversized uploads. */
function bcompPickBitrate(durationSec){
  if(durationSec <= 120) return 4_000_000;      // ≤2 min — crisp
  if(durationSec <= 300) return 2_500_000;      // ≤5 min
  return 1_800_000;                             // ≤10 min — still clean 720p
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

    // Small/short files can skip heavy re-encode if already under target size
    if(file.size <= BCAST_MAX_UPLOAD_BYTES && duration <= 90){
      if(onProgress) onProgress(1, 'Ready');
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
    const bitrate = bcompPickBitrate(duration);
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

  bcompPublishing = true;
  const pub = $('bcompPublishBtn');
  const prog = $('bcompProgress');
  if(pub){ pub.disabled = true; pub.textContent = 'Publishing…'; }
  if(prog){ prog.style.display = 'block'; prog.textContent = 'Uploading…'; }

  try{
    let mediaType = bcompKind;
    let mediaUrl = null;
    let thumbUrl = null;

    if(bcompKind === 'photo'){
      const blob = bcompFile;
      mediaUrl = await uploadVideoToR2(blob);
      thumbUrl = mediaUrl;
    } else {
      const blob = bcompCompressedBlob || bcompFile;
      if(!blob) throw new Error('No video ready');
      if(prog) prog.textContent = `Uploading ${Math.round(blob.size/1024/1024)} MB…`;
      mediaUrl = await uploadVideoToR2(blob);
      try{ thumbUrl = await generateVideoThumbnail(mediaUrl); }catch(_){}
    }

    if(typeof createPermanentBroadcast !== 'function'){
      throw new Error('Broadcast core not loaded');
    }

    const b = await createPermanentBroadcast({
      title,
      description: desc,
      tags,
      mediaType,
      mediaUrl,
      thumbUrl,
      filterCss: '',
    });

    if(typeof loadFeedBroadcasts === 'function') await loadFeedBroadcasts();
    bcompPublishing = false;
    bcompClose();
    toast('Broadcast published');
    if(typeof openBroadcastById === 'function') openBroadcastById(b.id);
  }catch(e){
    console.error('[bcomp] publish', e);
    bcompPublishing = false;
    if(pub){ pub.disabled = false; pub.textContent = 'Publish Broadcast'; }
    if(prog) prog.textContent = '';
    toast(e.message || 'Could not publish Broadcast');
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
