/* ============================================================
   MODULE: js/broadcast-composer.js
   Dedicated Broadcast uploader — completely separate from Signal.
   - Up to 10 minutes of video
   - Client-side quality-preserving compression ("panda": efficient, gentle)
   - Own UI, own limits, own publish path
   DO NOT route Signal through this file.
   ============================================================ */

const BCAST_MAX_SECONDS = 3 * 60 * 60; // 3 hours — one file, chapters are seek marks only
const BCAST_MAX_UPLOAD_BYTES = (typeof UPLOAD_MAX_BYTES === "number" ? UPLOAD_MAX_BYTES : 150 * 1024 * 1024);
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
  if(typeof nalunoProbeDuration === 'function') return nalunoProbeDuration(file, 2800);
  return new Promise(resolve=>{
    const v = document.createElement('video');
    v.preload = 'metadata';
    const url = URL.createObjectURL(file);
    let done = false;
    const finish = function(d){
      if(done) return;
      done = true;
      try{ URL.revokeObjectURL(url); }catch(_){}
      resolve((isFinite(d) && d > 0) ? d : 0);
    };
    v.onloadedmetadata = ()=>{ finish(v.duration); };
    v.onerror = ()=>{ finish(0); };
    v.src = url;
    setTimeout(()=> finish(0), 2800);
  });
}

/** YouTube-like bitrate ladder for mobile viewing quality. */
function bcompPickBitrate(durationSec, width, height, fileSize){
  // Aim under ~UPLOAD_MAX for 10 min phone playback in low-bandwidth regions
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
      reject(new Error('That video is longer than 3 hours'));
      return;
    }

    const maxUp = (typeof UPLOAD_MAX_BYTES === 'number') ? UPLOAD_MAX_BYTES : (95*1024*1024);
    const forceAt = (typeof UPLOAD_FORCE_COMPRESS_BYTES === 'number') ? UPLOAD_FORCE_COMPRESS_BYTES : (40*1024*1024);
    // Small enough for one Worker request — keep original (chapters handle long duration)
    if(file.size <= maxUp && file.size <= forceAt){
      if(onProgress) onProgress(1, 'Ready · original');
      resolve({ blob: file, duration, skipped: true });
      return;
    }
    // 40–95 MB: still prefer original if under max; above max must re-encode or split
    if(file.size <= maxUp){
      if(onProgress) onProgress(1, 'Ready · original (will chapter if long)');
      resolve({ blob: file, duration, skipped: true });
      return;
    }
    if(onProgress) onProgress(0.02, 'Large video (' + Math.round(file.size/1024/1024) + ' MB) — compressing for upload…');

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
  if(!(file.size > 0)){
    toast('That file was empty — try the Files app or a clip saved on this phone');
    return;
  }
  let isVideo = (typeof nalunoFileLooksLikeVideo === 'function')
    ? nalunoFileLooksLikeVideo(file)
    : ((file.type || '').indexOf('video/') === 0 || /\.(mp4|mov|webm|m4v|3gp|mkv)$/i.test(file.name || ''));
  let isImage = (typeof nalunoFileLooksLikeImage === 'function')
    ? nalunoFileLooksLikeImage(file)
    : ((file.type || '').indexOf('image/') === 0 || /\.(jpe?g|png|gif|webp|heic)$/i.test(file.name || ''));
  if(!isVideo && !isImage && (file.size || 0) > 50000) isVideo = true;
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
  if(prog){ prog.style.display = 'none'; prog.textContent = ''; }

  if(isImage){
    bcompKind = 'photo';
    bcompDuration = 0;
    if(prev) prev.innerHTML = `<img src="${bcompPreviewUrl}" alt="" style="width:100%;max-height:42vh;object-fit:contain;border-radius:14px;background:#000;" />`;
    if(status) status.textContent = 'Photo ready — add a title and publish';
    if(pub){ pub.disabled = false; pub.textContent = 'Publish Broadcast'; }
    return;
  }

  bcompKind = 'video';
  if(prev){
    prev.innerHTML = `<video src="${bcompPreviewUrl}" playsinline webkit-playsinline style="width:100%;max-height:42vh;border-radius:14px;background:#000;"></video>`;
  }

  // Enable Publish immediately — duration probe must not trap the picker.
  bcompCompressedBlob = file;
  if(pub){ pub.disabled = false; pub.textContent = 'Publish Broadcast'; }
  if(status) status.textContent = 'Opening the original…';

  const duration = await bcompProbeDuration(file);
  bcompDuration = duration || 0;
  if(duration > BCAST_MAX_SECONDS + 1){
    toast('That video is longer than 3 hours');
    bcompReset();
    return;
  }

  const mins = Math.floor((duration || 0) / 60);
  const secs = Math.round((duration || 0) % 60);
  const mb = Math.round(file.size/1024/1024);
  if(file.size > 95 * 1024 * 1024){
    toast('Large video (' + Math.round(file.size/1024/1024) + ' MB) — will upload in pieces (no compress)');
  }
  bcompCompressedBlob = file;
  if(status){
    if(!duration){
      status.textContent = `Ready · ${mb} MB · original kept (length read on play)`;
    } else if(duration > 4 * 60){
      status.textContent = `Ready · ${mins}:${String(secs).padStart(2,'0')} · ${mb} MB · will publish as chapters (~4 min)`;
    } else {
      status.textContent = `Ready · ${mins}:${String(secs).padStart(2,'0')} · ${mb} MB · original kept`;
    }
  }
  if(pub){ pub.disabled = false; pub.textContent = 'Publish Broadcast'; }
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
  const snapDuration = bcompDuration || 0;
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
      let chapters = null;
      let breathers = null;
      if(snapKind === 'photo'){
        if(progress) progress('Uploading photo…');
        mediaUrl = await uploadVideoToR2(snapFile);
        thumbUrl = mediaUrl;
      } else {
        const file = snapFile || snapBlob;
        if(!file) throw new Error('No video ready');
        const duration = snapDuration || (typeof bcompProbeDuration === 'function' ? await bcompProbeDuration(file) : 0);
        // NEVER re-encode on the phone. Chunked upload of the original file.
        try{
          if(progress) progress('Capturing thumbnail…');
          thumbUrl = await generateVideoThumbnail(file);
          if(thumbUrl) thumbUrl = await persistThumbnailDataUrl(thumbUrl);
        }catch(_){}
        if(typeof uploadBroadcastFile !== 'function') throw new Error('Broadcast uploader not loaded');
        mediaUrl = await uploadBroadcastFile(file, (frac, msg)=>{
          if(progress) progress(msg || ('Uploading… ' + Math.round((frac||0)*100) + '%'));
        });
        const seek = (typeof planSeekChapters === 'function')
          ? planSeekChapters(duration)
          : { showChapterUI: duration > 240, parts: [{ index:0, start:0, end: duration }] };
        if(seek.showChapterUI && seek.parts && seek.parts.length > 1){
          chapters = seek.parts.map(p => ({
            index: p.index,
            mediaUrl,
            start: p.start,
            end: p.end,
            duration: Math.max(0.1, p.end - p.start),
            title: 'Chapter ' + (p.index + 1),
            sharedSource: true,
            status: 'live',
          }));
          breathers = (typeof buildBreathersForChapters === 'function')
            ? buildBreathersForChapters(chapters.length)
            : [];
        } else {
          chapters = [{ index: 0, mediaUrl, duration: duration || null, title: 'Video', start: 0, end: duration || null, sharedSource: true }];
        }
      }
      if(typeof createPermanentBroadcast !== 'function') throw new Error('Broadcast core not loaded');
      if(progress) progress('Saving Broadcast…');
      // Never save a video job as photo (still-snapshot symptom)
      if(snapKind === 'video') mediaType = 'video';
      if(snapKind === 'video' && !mediaUrl && chapters && chapters[0] && chapters[0].mediaUrl){
        mediaUrl = chapters[0].mediaUrl;
      }
      if(snapKind === 'video' && (!chapters || !chapters.length) && mediaUrl){
        chapters = [{ index: 0, mediaUrl, duration: snapDuration || null, title: 'Video', sharedSource: true, start: 0, end: snapDuration || null }];
      }
      const b = await createPermanentBroadcast({
        title: snapTitle, description: snapDesc, tags: snapTags,
        mediaType, mediaUrl, thumbUrl, filterCss: '',
        chapters, breathers,
      });
      if(typeof loadFeedBroadcasts === 'function') await loadFeedBroadcasts();
      if(typeof notifyPublishResult === 'function') notifyPublishResult(true, snapTitle);
      else if(typeof toast === 'function') toast('Broadcast published');
      try{ if(typeof trackMetric === 'function') trackMetric('upload_publish_ok', { kind: 'broadcast' }); }catch(_){}
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
  if($('bcompPickBtn')) $('bcompPickBtn').onclick = function(){
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = 'video/*,image/*';
    inp.style.cssText = 'position:fixed;left:-9999px;opacity:0;';
    document.body.appendChild(inp);
    inp.onchange = function(){
      const f = inp.files && inp.files[0];
      try{ document.body.removeChild(inp); }catch(_){}
      if(f) bcompOnFileChosen(f);
      else if(typeof toast === 'function') toast('No file came through — try Files app');
    };
    inp.click();
  };
  if($('bcompFileInput')){
    $('bcompFileInput').accept = 'video/*,image/*';
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


/* ---- Go live from Broadcast gateway (same community space) ---- */
async function bcompStartGoLive(){
  if(!currentUser || !fbDb){ toast('Sign in to go live'); return; }
  const title = (($('bcompTitle') && $('bcompTitle').value) || '').trim() || ('Live · ' + new Date().toLocaleString());
  const tagsRaw = (($('bcompTags') && $('bcompTags').value) || '');
  const tags = tagsRaw.split(',').map(s=>s.trim()).filter(Boolean).slice(0, 12);
  const desc = (($('bcompDesc') && $('bcompDesc').value) || '').trim() || 'Live Broadcast';
  try{
    toast('Opening live Broadcast…');
    // Create empty permanent broadcast shell (community features identical)
    const created = await createPermanentBroadcast({
      title,
      description: desc,
      tags: tags.length ? tags : ['live'],
      mediaType: 'video',
      mediaUrl: null,
      thumbUrl: null,
      chapters: [],
      breathers: [],
    });
    const id = created && created.id;
    if(!id) throw new Error('Broadcast shell missing id');
    bcompClose();
    if(typeof openBroadcastSpaceById === 'function'){
      await openBroadcastSpaceById(id);
    }
    // Start live camera into this space
    if(typeof bspaceStartLive === 'function'){
      await bspaceStartLive();
    } else {
      toast('Open Go live from the Broadcast space');
    }
  }catch(e){
    console.warn('[bcomp] go live', e);
    toast(e.message || 'Could not start live');
  }
}
if($('bcompGoLiveBtn')){
  $('bcompGoLiveBtn').onclick = function(e){
    if(e){ e.preventDefault(); e.stopPropagation(); }
    bcompStartGoLive();
  };
}

if($('broadcastGoLiveBtn')) $('broadcastGoLiveBtn').onclick = ()=>{ if(typeof openGoLiveFromSignal==='function') openGoLiveFromSignal(); else if(typeof bcompStartGoLive==='function') bcompStartGoLive(); };
