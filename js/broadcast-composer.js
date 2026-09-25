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
let bcompCoverFile = null;
let bcompCoverUrl = '';
let bcompKind = null; // 'video' | 'photo' | 'writing' | null
function bcompClearCover(){
  bcompCoverFile = null;
  if(bcompCoverUrl){ try{ URL.revokeObjectURL(bcompCoverUrl); }catch(_){} }
  bcompCoverUrl = '';
  const img = $('bcompCoverPreview');
  if(img){ img.removeAttribute('src'); img.style.display = 'none'; }
  const clr = $('bcompCoverClear');
  if(clr) clr.style.display = 'none';
  const input = $('bcompCoverInput');
  if(input) input.value = '';
}
let bcompPublishing = false;

function bcompOpen(){
  try{ if(typeof nalunoUploadLog === 'function') nalunoUploadLog('open Broadcast composer'); }catch(_){}
  if(!currentUser){ toast('Sign in to publish a Broadcast'); return; }
  bcompReset();
  const el = $('bcomposer');
  if(el) el.classList.add('active');
  try{ if(window.nalunoBack) window.nalunoBack.push(); }catch(_){}
  if(typeof loadMyStrands === 'function'){
    loadMyStrands().then(function(){
      if(typeof fillStrandSelect === 'function') fillStrandSelect($('bcompStrand'));
    }).catch(function(){});
  }
  try{
    const ping = typeof nalunoFetch === 'function' ? nalunoFetch : fetch;
    ping('https://naluno-broadcast-upload.naluno.workers.dev/', { method: 'GET', mode: 'cors' })
      .then(function(r){ if(typeof nalunoUploadLog === 'function') nalunoUploadLog('bcast-worker', r.status); })
      .catch(function(e){ if(typeof nalunoUploadLog === 'function') nalunoUploadLog('bcast-worker FAIL', e && e.message); });
    ping('https://naluno-signal-upload.naluno.workers.dev/', { method: 'GET', mode: 'cors' })
      .then(function(r){ if(typeof nalunoUploadLog === 'function') nalunoUploadLog('signal-worker', r.status); })
      .catch(function(e){ if(typeof nalunoUploadLog === 'function') nalunoUploadLog('signal-worker FAIL', e && e.message); });
  }catch(_){}
}

function bcompClose(){
  if(bcompPublishing) return;
  bcompReset();
  const el = $('bcomposer');
  if(el) el.classList.remove('active');
  try{ if(window.nalunoBack) window.nalunoBack.drop('bcomposer'); }catch(_){}
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
  const strand = $('bcompStrand');
  if(strand) strand.value = '';
  const strandName = $('bcompStrandName');
  if(strandName) strandName.value = '';
  const originBox = $('bcompOrigin');
  if(originBox){ originBox.style.display = 'none'; originBox.innerHTML = ''; }
  const screenBox = $('bcompScreen');
  if(screenBox){ screenBox.style.display = 'none'; screenBox.innerHTML = ''; }
  const write = $('bcompWrite');
  if(write) write.style.display = 'none';
  const chapters = $('bcompChapters');
  if(chapters) chapters.innerHTML = '';
  bcompClearCover();
  window._bcompOrigin = null;
  window._bcompOriginAck = false;
  window._bcompScreen = null;
  window._bcompScreenP = null;
  /* Show the date box only when "Publish later" is ticked, and default it to
     an hour from now so the field is never empty when it appears. */
  if($('bcompSchedule') && !$('bcompSchedule').__wired){
    $('bcompSchedule').__wired = true;
    $('bcompSchedule').onchange = function(){
      const box = $('bcompPublishAt');
      if(!box) return;
      box.style.display = this.checked ? 'block' : 'none';
      if(this.checked && !box.value){
        const t = new Date(Date.now() + 3600000 - new Date().getTimezoneOffset() * 60000);
        box.value = t.toISOString().slice(0, 16);
      }
    };
  }
  const pub = $('bcompPublishBtn');
  if(pub){
    pub.removeAttribute('disabled');
    pub.setAttribute('aria-disabled', 'true');
    pub.style.opacity = '.5';
    pub.textContent = 'Publish Broadcast';
  }
  const fileIn = $('bcompFileInput');
  if(fileIn) fileIn.value = '';
  const prog = $('bcompProgress');
  if(prog){ prog.style.display = 'none'; prog.textContent = ''; }
}

function bcompProbeDuration(file){
  if(typeof nalunoProbeDuration === 'function') return nalunoProbeDuration(file, 6000);
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
  try{ if(typeof nalunoUploadLog === 'function') nalunoUploadLog('Broadcast file', file && (file.name + ' ' + Math.round((file.size||0)/1024) + 'KB')); }catch(_){}
  if(!file) return;
  const isVideo = (typeof nalunoFileLooksLikeVideo === 'function')
    ? nalunoFileLooksLikeVideo(file)
    : ((file.type || '').indexOf('video/') === 0 || /\.(mp4|mov|webm|m4v|3gp|mkv|avi|mpeg|mpg|ogv|ts|hevc|wmv)$/i.test(file.name || ''));
  const isImage = (typeof nalunoFileLooksLikeImage === 'function')
    ? nalunoFileLooksLikeImage(file)
    : ((file.type || '').indexOf('image/') === 0 || /\.(jpe?g|png|gif|webp|heic)$/i.test(file.name || ''));
  if(!isVideo && !isImage){
    toast('Choose a photo or video');
    return;
  }
  bcompLeaveWriting();

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
    if(pub){ pub.removeAttribute('disabled'); pub.setAttribute('aria-disabled', 'false'); pub.style.opacity = '1'; pub.textContent = 'Publish Broadcast'; }
    bcompKickOriginScan();
    return;
  }

  bcompKind = 'video';
  if(prev){
    prev.innerHTML = `<video src="${bcompPreviewUrl}" controls playsinline style="width:100%;max-height:42vh;border-radius:14px;background:#000;"></video>`;
  }

  // Enable Publish immediately — duration probe must not trap the picker.
  bcompCompressedBlob = file;
  if(pub){ pub.removeAttribute('disabled'); pub.setAttribute('aria-disabled', 'false'); pub.style.opacity = '1'; pub.textContent = 'Publish Broadcast'; }
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
  if(pub){ pub.removeAttribute('disabled'); pub.setAttribute('aria-disabled', 'false'); pub.style.opacity = '1'; pub.textContent = 'Publish Broadcast'; }
  bcompKickOriginScan();
}

async function bcompKickOriginScan(){
  if(!bcompFile || typeof runOriginScan !== 'function') return;
  const box = $('bcompOrigin');
  if(box){
    box.style.display = 'block';
    box.innerHTML = '<div style="font-family:var(--font-futuristic);font-size:13px;">OriginID reading…</div><div style="font-size:12.5px;color:var(--text-dim);margin-top:4px;">Picture, motion, and sound against Naluno, then the open web.</div>';
  }
  const screenBox = $('bcompScreen');
  if(screenBox){
    screenBox.style.display = 'block';
    screenBox.innerHTML = '<div style="font-family:var(--font-futuristic);font-size:13px;">Naluno Screen reading stills…</div><div style="font-size:12.5px;color:var(--text-dim);margin-top:4px;">Clear goes out. Unsure waits. Sexual is stopped.</div>';
  }
  const title = (($('bcompTitle') && $('bcompTitle').value) || '').trim();
  const desc = (($('bcompDesc') && $('bcompDesc').value) || '').trim();
  const work = (async function(){
    const titleNow = title;
    const screenP = (typeof runNalunoScreen === 'function' && bcompFile)
      ? runNalunoScreen(bcompFile, titleNow, bcompDuration || 0).catch(function(){ return null; })
      : Promise.resolve(null);
    try{
      window._bcompOriginAck = false;
      window._bcompOrigin = await runOriginScan(bcompFile, titleNow, desc, bcompDuration || 0);
      bcompPaintOrigin(window._bcompOrigin);
    }catch(e){
      if(box) box.innerHTML = '<div style="font-size:12.5px;color:var(--text-dim);">OriginID could not finish. You can still publish.</div>';
      window._bcompOrigin = { status: 'clear', score: 0, matches: [], hold: false, skipped: true };
    }
    try{
      /* The detector's verdict comes first. OriginID runs its own screen, but
         with the old skin heuristic — and this used to PREFER it, so the
         detector was consulted only when OriginID produced nothing, which was
         almost never. The heuristic is now only a fallback, and it may never
         reject by itself. */
      let screen = await screenP;
      if(!screen || screen.decision === 'unread'){
        const o = (window._bcompOrigin && window._bcompOrigin.screen) || null;
        if(o){
          screen = Object.assign({}, o);
          if(screen.decision === 'block'){ screen.decision = 'hold'; screen.reason = 'heuristic-only'; }
          screen.engine = 'heuristic';
        }
      }
      window._bcompScreen = screen;
      bcompPaintScreen(screen);
      return screen;
    }catch(_){
      return window._bcompScreen || null;
    }
  })();
  window._bcompScreenP = work;
  return work;
}

async function bcompPublish(){
  try{ if(typeof nalunoUploadLog === 'function') nalunoUploadLog('Publish Broadcast tapped', bcompKind || 'none'); }catch(_){}
  if(bcompPublishing){
    toast('Already publishing…');
    return;
  }
  bcompPublishing = true;
  if(!currentUser || !fbDb){ bcompPublishing = false; toast('Sign in first'); return; }
  if(!bcompKind){ bcompPublishing = false; toast('Add a photo, a video, or a piece of writing'); return; }
  if(bcompKind === 'writing' && !bcompCollectChapters().length){
    bcompPublishing = false;
    toast('Write the piece first');
    return;
  }

  const title = (($('bcompTitle') && $('bcompTitle').value) || '').trim();
  const tagsRaw = (($('bcompTags') && $('bcompTags').value) || '');
  const tags = tagsRaw.split(',').map(s=>s.trim()).filter(Boolean).slice(0, 12);
  const desc = (($('bcompDesc') && $('bcompDesc').value) || '').trim();

  if(!title){
    bcompPublishing = false;
    toast('Add a title for your Broadcast');
    return;
  }

  try{
    if(window._bcompScreenP){
      await Promise.race([
        window._bcompScreenP,
        new Promise(function(ok){ setTimeout(ok, 10000); }),
      ]);
    }
  }catch(_){}
  // Detector verdict (set above) first; never fall back to a raw heuristic
  // verdict that could still carry a "block".
  let screen = window._bcompScreen || null;
  if(!screen && bcompFile && typeof runNalunoScreen === 'function'){
    try{
      const titleNow = title;
      screen = await Promise.race([
        runNalunoScreen(bcompFile, titleNow, bcompDuration || 0),
        new Promise(function(ok){ setTimeout(function(){ ok(null); }, 6000); }),
      ]);
      window._bcompScreen = screen;
      bcompPaintScreen(screen);
    }catch(_){}
  }
  if(bcompKind === 'writing'){
    if(bcompCoverFile && typeof runNalunoScreen === 'function'){
      try{
        const imgScreen = await Promise.race([
          runNalunoScreen(bcompCoverFile, title, 0),
          new Promise(function(ok){ setTimeout(function(){ ok(null); }, 6000); }),
        ]);
        if(imgScreen && imgScreen.decision === 'block'){
          bcompPublishing = false;
          bcompPaintScreen(imgScreen);
          toast('This photo cannot go out.');
          return;
        }
      }catch(_){}
    }
    const piece = [title, desc].concat(bcompCollectChapters().map(function(c){ return c.title + '\n' + c.text; })).join('\n');
    let hold = null;
    try{
      if(window.NalunoSafety && typeof window.NalunoSafety.scorePublicText === 'function'){
        hold = window.NalunoSafety.scorePublicText(piece, { surface: 'broadcast' });
      }
    }catch(_){}
    const stopped = !!(hold && typeof nalunoSafetyStopped === 'function' && nalunoSafetyStopped(hold));
    screen = { decision: stopped ? 'block' : 'allow', engine: 'text', reason: hold && hold.decision || '' };
    window._bcompScreen = screen;
  }
  if(screen && screen.decision === 'block'){
    bcompPublishing = false;
    bcompPaintScreen(screen);
    toast('This cannot go out. Naluno Screen stopped it.');
    const pubBtn = $('bcompPublishBtn');
    if(pubBtn) pubBtn.textContent = 'Cannot publish';
    return;
  }

  // OriginID is advisory only — never stall Publish waiting for it.
  if(!window._bcompOrigin){
    window._bcompOrigin = { status: 'clear', score: 0, matches: [], hold: false, skipped: true };
  }
  const needsAck = (typeof originNeedsAck === 'function')
    ? originNeedsAck(window._bcompOrigin)
    : (window._bcompOrigin && (window._bcompOrigin.hold || window._bcompOrigin.status === 'match'));
  const nalunoCopy = !!(window._bcompOrigin && window._bcompOrigin.matchBroadcastId && window._bcompOrigin.matchCreatorUid && currentUser && window._bcompOrigin.matchCreatorUid !== currentUser.uid);
  if(needsAck && !nalunoCopy && !window._bcompOriginAck){
    bcompPublishing = false;
    bcompPaintOrigin(window._bcompOrigin);
    toast('OriginID held this post — another creator already published a close match. Tick the box if it is yours, licensed, or a cover.');
    const pubBtn = $('bcompPublishBtn');
    if(pubBtn) pubBtn.textContent = 'Publish with OriginID mark';
    return;
  }

  let strandId = (($('bcompStrand') && $('bcompStrand').value) || '') || null;
  let strandName = (($('bcompStrandName') && $('bcompStrandName').value) || '').trim();
  if(!strandId && strandName && typeof ensureStrand === 'function'){
    try{
      const s = await ensureStrand(strandName, tags);
      if(s){ strandId = s.id; strandName = s.name; }
    }catch(_){}
  }
  if(strandId && !strandName){
    const found = (typeof getMyStrands === 'function' ? getMyStrands() : []).find(function(s){ return s.id === strandId; });
    if(found) strandName = found.name;
  }

  // Snapshot + close immediately — compress/upload continues in background
  const snapKind = bcompKind;
  const snapFile = bcompFile;
  const snapBlob = bcompCompressedBlob || bcompFile;
  const snapDuration = bcompDuration || 0;
  /* Read the publish options at the moment Publish is pressed, with the rest
   of the snapshot — not later, when the sheet may already be closed. */
const snapPrivate = !!($('bcompPrivate') && $('bcompPrivate').checked);
  const snapVisibility = snapPrivate ? 'private' : 'public';
  let snapPublishAt = 0;
  try{
    if($('bcompSchedule') && $('bcompSchedule').checked && $('bcompPublishAt') && $('bcompPublishAt').value){
      const t = new Date($('bcompPublishAt').value).getTime();
      if(isFinite(t) && t > Date.now()) snapPublishAt = t;
    }
  }catch(_){}
  const snapTitle = title;
  const snapDesc = desc;
  const snapTags = tags.slice();
  const snapChapters = bcompKind === 'writing' ? bcompCollectChapters() : null;
  const snapBody = snapChapters ? snapChapters.map(function(c){ return (c.title ? c.title + '\n' : '') + c.text; }).join('\n\n') : '';
  const snapCover = bcompKind === 'writing' ? bcompCoverFile : null;
  const snapStrandId = strandId;
  const snapStrandName = strandName;
  const snapOrigin = window._bcompOrigin || null;
  const snapScreen = window._bcompScreen || (snapOrigin && snapOrigin.screen) || window._nalunoLastScreen || null;
  bcompPublishing = false;
  bcompClose();

  const job = {
    label: snapPublishAt ? 'Scheduling Broadcast…' : 'Publishing Broadcast…',
    doneMsg: snapPublishAt ? 'Scheduled — it stays off the public feed until then' : (snapVisibility === 'private' ? 'Saved as private' : 'Broadcast published'),
    run: async (progress)=>{
      if(snapKind === 'writing'){
        if(progress) progress('Saving writing…');
        let coverUrl = null;
        if(snapCover){
          if(progress) progress('Uploading photo…');
          coverUrl = (typeof uploadPhotoToR2 === 'function') ? await uploadPhotoToR2(snapCover) : null;
          if(!coverUrl) throw new Error('Could not upload the photo');
        }
        const words = snapBody.split(/\s+/).filter(Boolean).length;
        let credit = null;
        try{
          if(typeof broadcastWritingCredit === 'function') credit = await broadcastWritingCredit(snapBody);
        }catch(_){}
        const b = await createPermanentBroadcast({
          title: snapTitle, description: snapDesc, tags: snapTags,
          publishAt: snapPublishAt, visibility: snapVisibility,
          mediaType: 'writing', mediaUrl: coverUrl, thumbUrl: coverUrl,
          body: snapBody,
          words: words,
          durationSec: Math.max(30, Math.round(words / 3.3)),
          chapters: snapChapters,
          strandId: snapStrandId, strandName: snapStrandName,
          origin: { status: 'clear', score: 0, hold: false, skipped: true },
          originCredit: credit,
          screen: snapScreen || { decision: 'allow', engine: 'text' },
        });
        if(typeof loadFeedBroadcasts === 'function') await loadFeedBroadcasts();
        if(typeof notifyPublishResult === 'function') notifyPublishResult(true, snapTitle);
        else if(typeof toast === 'function') toast('Writing published');
        if(typeof openBroadcastById === 'function') openBroadcastById(b.id);
        return;
      }
      let mediaType = snapKind;
      let mediaUrl = null;
      let thumbUrl = null;
      let chapters = null;
      let breathers = null;
      if(snapKind === 'photo'){
        if(progress) progress('Uploading photo…');
        mediaUrl = (typeof uploadPhotoToR2 === 'function')
          ? await uploadPhotoToR2(snapFile)
          : (typeof uploadBroadcastFile === 'function')
            ? await uploadBroadcastFile(snapFile, null, (snapFile && snapFile.type) || 'image/jpeg')
            : await uploadVideoToR2(snapFile);
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
        let uploadFile = file;
        // Short Samsung HEVC → convert so every browser can play. Long HEVC stays original
        // (chunked); player uses blob fallback for those.
        try{
          const isHevc = (typeof nalunoSniffIsHevc === 'function') ? await nalunoSniffIsHevc(file) : false;
          if(isHevc && (duration || 0) > 0 && duration <= 360 && typeof nalunoTranscodeToWeb === 'function'){
            if(progress) progress('Converting Samsung video for playback…');
            uploadFile = await nalunoTranscodeToWeb(file, function(p){
              if(progress) progress('Converting… ' + Math.round((p||0)*100) + '%');
            }, Math.min(360, duration + 1));
          }
        }catch(convErr){
          console.warn('[bcast] HEVC convert skipped', convErr);
          uploadFile = file;
        }
        mediaUrl = await uploadBroadcastFile(uploadFile, (frac, msg)=>{
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
        publishAt: snapPublishAt, visibility: snapVisibility,
        mediaType, mediaUrl, thumbUrl, filterCss: '',
        chapters, breathers,
        strandId: snapStrandId, strandName: snapStrandName, origin: snapOrigin,
        originCredit: (typeof broadcastCreditFromOrigin === 'function') ? broadcastCreditFromOrigin(snapOrigin) : null,
        screen: snapScreen,
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
  // Native overlay input is the tap target — never nest it in a button and
  // never call input.click() from JS. Samsung Chrome swallows that gesture.
  if($('bcompFileInput')){
    $('bcompFileInput').addEventListener('click', function(){
      try{ if(typeof nalunoUploadLog === 'function') nalunoUploadLog('Broadcast library opening'); }catch(_){}
    });
    $('bcompFileInput').onchange = (e)=>{
      const f = e.target.files && e.target.files[0];
      try{ if(typeof nalunoUploadLog === 'function') nalunoUploadLog('Broadcast change', f ? (f.name + ' ' + f.size) : 'empty'); }catch(_){}
      if(!f){
        if(typeof toast === 'function') toast('No file came through — try the Files app');
        return;
      }
      bcompOnFileChosen(f);
    };
  }
  if($('bcompPublishBtn')) $('bcompPublishBtn').onclick = bcompPublish;
  if($('bcompStrand')){
    $('bcompStrand').onchange = function(){
      const name = $('bcompStrandName');
      if(!name) return;
      name.style.display = $('bcompStrand').value ? 'none' : 'block';
    };
  }
}

// Wire when DOM ready
if(document.readyState === 'loading'){
  document.addEventListener('DOMContentLoaded', bcompWire);
} else {
  bcompWire();
}


if($('bcompWriteBtn')){
  $('bcompWriteBtn').onclick = function(e){
    if(e){ e.preventDefault(); e.stopPropagation(); }
    bcompStartWriting();
  };
}
if($('bcompCoverInput')){
  $('bcompCoverInput').onchange = function(){
    const file = $('bcompCoverInput').files && $('bcompCoverInput').files[0];
    if(!file) return;
    const image = (file.type || '').indexOf('image/') === 0 || /\.(jpe?g|png|webp|gif)$/i.test(file.name || '');
    if(!image){ toast('Choose a photo'); return; }
    bcompClearCover();
    bcompCoverFile = file;
    bcompCoverUrl = URL.createObjectURL(file);
    const img = $('bcompCoverPreview');
    if(img){ img.src = bcompCoverUrl; img.style.display = 'block'; }
    const clr = $('bcompCoverClear');
    if(clr) clr.style.display = 'inline';
  };
}
if($('bcompCoverClear')) $('bcompCoverClear').onclick = function(){ bcompClearCover(); };
if($('bcompAddChapter')){
  $('bcompAddChapter').onclick = function(e){
    if(e){ e.preventDefault(); }
    bcompAddChapter();
  };
}

function bcompLeaveWriting(){
  const box = $('bcompWrite');
  if(box) box.style.display = 'none';
  if(bcompKind === 'writing') bcompKind = null;
}
function bcompChapterCount(){
  const host = $('bcompChapters');
  return host ? host.querySelectorAll('.bcomp-chapter').length : 0;
}
function bcompAddChapter(title, text){
  const host = $('bcompChapters');
  if(!host) return;
  if(bcompChapterCount() >= 24){ toast('24 chapters is the limit'); return; }
  const n = bcompChapterCount() + 1;
  const block = document.createElement('div');
  block.className = 'bcomp-chapter';
  block.style.margin = '0 0 10px';
  block.innerHTML = ''
    + '<input maxlength="80" placeholder="Chapter ' + n + '" value="" style="width:100%;margin-bottom:6px;padding:10px 12px;border-radius:12px;border:1px solid var(--line);background:rgba(23,26,38,.9);color:var(--text);font-size:14px;font-family:inherit;" />'
    + '<textarea maxlength="20000" rows="8" placeholder="Write this chapter" style="width:100%;padding:12px 14px;border-radius:12px;border:1px solid var(--line);background:rgba(23,26,38,.9);color:var(--text);font-size:15px;line-height:1.45;font-family:inherit;resize:vertical;"></textarea>';
  host.appendChild(block);
  const inputs = block.querySelectorAll('input, textarea');
  if(inputs[0] && title) inputs[0].value = title;
  if(inputs[1] && text) inputs[1].value = text;
  if(inputs[1]){ try{ inputs[1].focus(); }catch(_){} }
}
function bcompCollectChapters(){
  const host = $('bcompChapters');
  if(!host) return [];
  const out = [];
  host.querySelectorAll('.bcomp-chapter').forEach(function(block, i){
    const titleEl = block.querySelector('input');
    const bodyEl = block.querySelector('textarea');
    const text = ((bodyEl && bodyEl.value) || '').trim();
    if(!text) return;
    out.push({
      index: out.length,
      title: ((titleEl && titleEl.value) || '').trim().slice(0, 80) || ('Chapter ' + (i + 1)),
      text: text.slice(0, 20000),
    });
  });
  return out;
}
function bcompStartWriting(){
  bcompFile = null;
  bcompCompressedBlob = null;
  bcompDuration = 0;
  if(bcompPreviewUrl){ try{ URL.revokeObjectURL(bcompPreviewUrl); }catch(_){} bcompPreviewUrl = null; }
  const prev = $('bcompPreview');
  if(prev) prev.innerHTML = '';
  const file = $('bcompFileInput');
  if(file) file.value = '';
  bcompKind = 'writing';
  const box = $('bcompWrite');
  if(box) box.style.display = 'block';
  if(!bcompChapterCount()) bcompAddChapter('', '');
  const status = $('bcompStatus');
  if(status) status.textContent = '';
  const pub = $('bcompPublishBtn');
  if(pub){ pub.textContent = 'Publish writing'; pub.removeAttribute('disabled'); }
}

/* Details first. The camera starts only after a title. */
async function bcompStartGoLive(opts){
  opts = opts || {};
  if(!currentUser || !fbDb){ toast('Sign in to go live'); return; }
  const title = String(opts.title || '').trim();
  if(!title){ toast('Add a title'); return; }
  const tags = Array.isArray(opts.tags) ? opts.tags : [];
  const desc = String(opts.description || '').trim();
  try{
    const created = await createPermanentBroadcast({
      title,
      description: desc,
      tags: tags.slice(0, 12),
      mediaType: 'video',
      mediaUrl: null,
      thumbUrl: null,
      chapters: [],
      breathers: [],
    });
    const id = created && created.id;
    if(!id) throw new Error('Broadcast shell missing id');
    if(typeof openBroadcastSpaceById === 'function'){
      await openBroadcastSpaceById(id);
    }
    if(typeof bspaceStartLive === 'function'){
      await bspaceStartLive();
    }
  }catch(e){
    console.warn('[bcomp] go live', e);
    toast(e.message || 'Could not start live');
  }
}

function bliveClose(){
  const sheet = $('bliveSetup');
  if(sheet) sheet.classList.remove('active');
  try{ if(window.nalunoBack) window.nalunoBack.drop('bliveSetup'); }catch(_){}
}
function bliveOpen(){
  if(!currentUser || !fbDb){ toast('Sign in to go live'); return; }
  const sheet = $('bliveSetup');
  if(!sheet){ return; }
  sheet.classList.add('active');
  try{ if(window.nalunoBack) window.nalunoBack.push(); }catch(_){}
  const title = $('bliveTitle');
  if(title){ try{ title.focus(); }catch(_){} }
}
async function bliveStart(){
  const title = (($('bliveTitle') && $('bliveTitle').value) || '').trim();
  if(!title){ toast('Add a title'); return; }
  const desc = (($('bliveAbout') && $('bliveAbout').value) || '').trim();
  const tags = (($('bliveTags') && $('bliveTags').value) || '').split(',').map(function(s){ return s.trim(); }).filter(Boolean).slice(0, 12);
  const t = $('bliveTitle'), a = $('bliveAbout'), g = $('bliveTags');
  if(t) t.value = '';
  if(a) a.value = '';
  if(g) g.value = '';
  bliveClose();
  await bcompStartGoLive({ title: title, description: desc, tags: tags });
}
if($('bliveSetupClose')) $('bliveSetupClose').onclick = bliveClose;
if($('bliveStart')) $('bliveStart').onclick = function(){ bliveStart(); };

function bcompPaintScreen(report){
  const box = $('bcompScreen');
  if(!box) return;
  box.style.display = 'block';
  const d = (report && report.decision) || 'unread';
  let title = 'Naluno Screen';
  let body = 'Could not read stills. This waits for a look if you publish.';
  let color = 'var(--text-dim)';
  if(d === 'allow'){
    title = 'Naluno Screen · clear';
    body = 'Stills from this file can go out.';
    color = 'var(--mint)';
  } else if(d === 'hold'){
    title = 'Naluno Screen · a person will check';
    body = 'This waits for a quick look before it goes out'
      + (report && report.reasonText ? ' (we saw ' + report.reasonText + ')' : '')
      + '. It stays on your list until it is cleared.';
    color = '#ffc266';
  } else if(d === 'block'){
    title = 'Naluno Screen · stopped';
    /* Say WHAT was found and what IS allowed. Someone posting a legitimate
       swimwear or stage shot should be able to see where the line is. */
    body = 'This cannot go out'
      + (report && report.reasonText ? ': it shows ' + report.reasonText : '')
      + '. Naluno allows swimwear, lingerie, shirtless men and sensual content — '
      + 'not exposed genitals, exposed female breasts, or sexual acts.';
    color = '#ff8a9a';
  }
  box.innerHTML = '<div style="font-family:var(--font-futuristic);font-size:13px;margin-bottom:4px;color:' + color + ';">' + title + '</div>'
    + '<div style="font-size:12.5px;color:var(--text-dim);line-height:1.45;">' + body + '</div>';
  const pub = $('bcompPublishBtn');
  if(pub && d === 'block'){
    pub.setAttribute('aria-disabled', 'true');
    pub.style.opacity = '.5';
    pub.textContent = 'Cannot publish';
  }
}

function bcompPaintOrigin(report){
  const box = $('bcompOrigin');
  if(!box || !report) return;
  box.style.display = 'block';
  const needsAck = (typeof originNeedsAck === 'function') ? originNeedsAck(report) : !!(report.hold || report.status === 'match');
  const label = report.status === 'match' ? 'OriginID match' : (report.status === 'review' ? 'OriginID review' : 'OriginID clear');
  // FIX ("mention the original creator, advise checking before publishing"):
  // this used to only ever say a generic "another creator already published a
  // close match" — never who, never what, and never gave any way to actually
  // go look at it. When the hold is against real Naluno content (not just an
  // open-web catalog hit), name the creator and the work by name, and give a
  // real, clickable way to check it before deciding whether to proceed.
  const isNalunoHold = needsAck && report.matchBroadcastId && report.matchTitle;
  const who = report.matchCreatorName ? (' by ' + escapeHtml(report.matchCreatorName)) : '';
  const action = isNalunoHold
    ? 'This looks very close to “' + escapeHtml(report.matchTitle) + '”' + who + '. Please check it out before publishing — if this is your own work, a licensed use, or a clearly marked cover, tick the box below and Naluno will still publish it, with the OriginID mark attached.'
    : needsAck
      ? 'Held. Another creator already published a close picture, clip, or sound. Tick the box only if this is yours, licensed, or a clearly marked cover. OriginID will stay on the Broadcast.'
      : (report.status === 'clear'
        ? 'No close match in Naluno or the open web. OriginID still stores a fingerprint so later copies can be held.'
        : 'Close, but not enough to hold. OriginID will keep watching.');
  const viewOriginalBtn = isNalunoHold
    ? '<button type="button" id="bcompViewOriginalBtn" style="margin-top:8px;padding:8px 14px;border-radius:999px;border:1px solid rgba(124,255,178,.4);background:transparent;color:var(--mint);font-family:var(--font-mono);font-size:11.5px;cursor:pointer;">View the original first</button>'
    : '';
  const ch = report.channels || {};
  const bar = function(name, n){
    const v = Math.max(0, Math.min(100, Number(n) || 0));
    return '<div style="display:flex;align-items:center;gap:8px;margin-top:4px;font-size:11px;"><span style="width:56px;color:var(--text-dim);">'+name+'</span><span style="flex:1;height:6px;border-radius:99px;background:rgba(255,255,255,.08);overflow:hidden;"><span style="display:block;height:100%;width:'+v+'%;background:var(--mint);"></span></span><span style="width:28px;text-align:right;font-family:var(--font-mono);">'+v+'</span></div>';
  };
  const meters = '<div style="margin:8px 0 6px;">'
    + bar('Picture', ch.picture)
    + bar('Motion', ch.motion)
    + bar('Sound', ch.sound)
    + '</div>';
  const hits = (report.matches || []).slice(0, 3).map(function(m){
    return '<div style="font-family:var(--font-mono);font-size:11px;color:var(--mint);margin-top:4px;">' +
      escapeHtml(m.source) + (m.channel ? ' · ' + escapeHtml(m.channel) : '') + ' · ' + escapeHtml(m.title) + (m.detail ? ' — ' + escapeHtml(m.detail) : '') + '</div>';
  }).join('');
  const ack = needsAck
    ? '<label style="display:flex;gap:8px;align-items:flex-start;margin-top:10px;font-size:13px;line-height:1.4;"><input type="checkbox" id="bcompOriginAck" /> This is my work, a licensed use, or a clearly marked cover.</label>'
    : '';
  box.innerHTML = '<div style="font-family:var(--font-futuristic);font-size:13px;margin-bottom:4px;">' + label +
    ' · ' + (report.score || 0) + '</div><div style="font-size:12.5px;color:var(--text-dim);line-height:1.45;">' + action + '</div>' + viewOriginalBtn + meters + hits + ack;
  const cb = $('bcompOriginAck');
  if(cb) cb.onchange = function(){ window._bcompOriginAck = !!cb.checked; };
  const viewBtn = $('bcompViewOriginalBtn');
  if(viewBtn) viewBtn.onclick = function(e){
    if(e){ e.preventDefault(); e.stopPropagation(); }
    if(typeof openBroadcastById === 'function') openBroadcastById(report.matchBroadcastId);
    else toast('Could not open — try Broadcasts search');
  };
}

if($('broadcastGoLiveBtn')) $('broadcastGoLiveBtn').onclick = ()=>{ if(typeof openGoLiveFromSignal==='function') openGoLiveFromSignal(); else if(typeof bcompStartGoLive==='function') bcompStartGoLive(); };
