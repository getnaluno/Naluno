/* ============================================================
   MODULE: js/compass.js
   Compass privacy lock + anonymous board
   OWNERSHIP: change this domain here only.
   Scripts share globals (intentional) so load order matches the old monolith.
   ============================================================ */
/* ---------------- COMPASS PRIVACY LOCK ----------------
   Local/casual protection — the honest kind: this stops someone who picks up your
   already-signed-in device from casually opening Compass, the same as any app-lock
   PIN pattern. It is not, and cannot be, real security against someone with direct
   access to the browser's own dev tools, since everything here still ultimately runs
   client-side. The password itself is never stored — only its SHA-256 hash, synced
   via the same profile document as everything else in Callsign, so it works
   consistently across sessions and devices without needing a separate system. */
let compassUnlockedThisSession = false;
async function sha256Hex(text){
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('');
}
function compassIsLocked(){
  return !!(currentProfile && currentProfile.compassPasswordHash) && !compassUnlockedThisSession;
}
function showCompassLockScreenIfNeeded(){
  if(compassIsLocked()){
    $('compassContent').style.display = 'none';
    $('compassLockScreen').style.display = 'flex';
    $('compassLockInput').value = '';
    $('compassLockError').style.display = 'none';
  } else {
    $('compassContent').style.display = 'flex';
    $('compassLockScreen').style.display = 'none';
    loadCompassMessages();
  }
}
$('compassLockSubmitBtn').onclick = async ()=>{
  const entered = $('compassLockInput').value;
  const hash = await sha256Hex(entered);
  if(hash === currentProfile.compassPasswordHash){
    compassUnlockedThisSession = true;
    showCompassLockScreenIfNeeded();
  } else {
    $('compassLockError').style.display = 'block';
  }
};
$('compassLockInput').addEventListener('keydown', e=>{
  if(e.key === 'Enter') $('compassLockSubmitBtn').click();
});
$('compassLockToggleBtn').onclick = async ()=>{
  if(!currentUser || !fbDb) return;
  const hasPassword = !!(currentProfile && currentProfile.compassPasswordHash);
  if(!hasPassword){
    const newPass = prompt('Set a password to lock Compass — leave blank to cancel:');
    if(!newPass) return;
    const hash = await sha256Hex(newPass);
    await fbDb.collection('users').doc(currentUser.uid).set({ compassPasswordHash: hash }, { merge:true });
    currentProfile.compassPasswordHash = hash;
    toast('Compass is now locked with a password');
  } else {
    const action = prompt('Compass is currently password-protected. Type "remove" to remove the password, or type a new password to change it:');
    if(!action) return;
    const currentPass = prompt('Confirm your current Compass password:');
    if(!currentPass) return;
    const currentHash = await sha256Hex(currentPass);
    if(currentHash !== currentProfile.compassPasswordHash){ toast('Incorrect current password'); return; }
    if(action.trim().toLowerCase() === 'remove'){
      await fbDb.collection('users').doc(currentUser.uid).set({ compassPasswordHash: firebase.firestore.FieldValue.delete() }, { merge:true });
      delete currentProfile.compassPasswordHash;
      toast('Compass password removed');
    } else {
      const newHash = await sha256Hex(action);
      await fbDb.collection('users').doc(currentUser.uid).set({ compassPasswordHash: newHash }, { merge:true });
      currentProfile.compassPasswordHash = newHash;
      toast('Compass password updated');
    }
  }
};

/* ---------------- COMPASS ----------------
   v1: a real, remembered conversation with genuine AI reasoning via Cloudflare
   Workers AI's free tier. Deliberately does NOT yet read anything else in Naluno —
   the "Personalisation Permission" system from the brief is real, privacy-sensitive
   work intentionally deferred as its own future, carefully-scoped build, not rushed
   into this pass. The Worker's own system prompt is told this directly, so it never
   falsely implies access it doesn't have. */
const COMPASS_WORKER_URL = 'https://naluno-compass.naluno.workers.dev';
let compassMessages = [];
let compassUnsub = null;
let compassLoaded = false;

/* Escapes first, then applies a small, safe set of formatting on top — never renders
   raw AI output directly. This is what actually fixes numbered points and bold text
   showing as one flat run-on paragraph with literal asterisks. */
function formatCompassText(text){
  let t = escapeHtml(text);
  t = t.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  // Breaks onto a new line before "2. ", "3. " etc when a numbered point starts
  // mid-paragraph — the model often runs list items together without real newlines.
  t = t.replace(/(\S)\s(\d+)\.\s/g, '$1<br><br>$2. ');
  t = t.replace(/\n/g, '<br>');
  return t.trim();
}
function renderCompassMessages(){
  const container = $('compassMessages');
  if(compassMessages.length === 0){
    container.innerHTML = `<div class="msg-empty"><span style="font-family:var(--font-futuristic); font-size:14px;">Your companion, growing with you</span><span style="font-size:12.5px;">Ask for a plan, think through a decision, or just talk something through. Compass remembers this conversation as you go.</span></div>`;
    return;
  }
  container.innerHTML = compassMessages.map(m=>{
    const isMe = m.from === 'user';
    const body = isMe ? escapeHtml(m.text) : formatCompassText(m.text);
    return `<div class="msg-row ${isMe?'me':'them'}" style="display:flex; ${isMe?'justify-content:flex-end;':''}"><div class="msg-bubble">${body}</div></div>`;
  }).join('');
  container.scrollTop = container.scrollHeight;
}
function loadCompassMessages(){
  if(compassLoaded || !fbDb || !currentUser) return;
  compassLoaded = true;
  if(compassUnsub) compassUnsub();
  compassUnsub = fbDb.collection('users').doc(currentUser.uid).collection('compassMessages')
    .orderBy('ts','asc').limitToLast(50)
    .onSnapshot(snap=>{
      compassMessages = snap.docs.map(d=>({ id:d.id, ...d.data() }));
      renderCompassMessages();
    }, ()=>{ /* Compass history just won't load this session */ });
}
async function sendCompassMessage(){
  const input = $('compassInput');
  const text = input.value.trim();
  if(!text || !currentUser || !fbDb) return;
  input.value = '';
  input.style.height = 'auto';

  const userMsg = { from:'user', text, ts: Date.now() };
  compassMessages.push(userMsg);
  renderCompassMessages();
  fbDb.collection('users').doc(currentUser.uid).collection('compassMessages').add({
    from:'user', text, ts: firebase.firestore.FieldValue.serverTimestamp(),
  }).catch(()=>{});

  // Only recent turns go with the request — bounded on purpose, both for real Neuron
  // cost predictability and because a small mobile screen conversation rarely needs
  // the entire lifetime history for the next reply to make sense.
  const recentHistory = compassMessages.slice(-16).map(m=>({
    role: m.from === 'user' ? 'user' : 'assistant',
    content: m.text,
  }));

  const thinkingMsg = { from:'compass', text: '\u2026', ts: Date.now(), thinking:true };
  compassMessages.push(thinkingMsg);
  renderCompassMessages();

  try{
    const idToken = await currentUser.getIdToken();
    const res = await fetch(COMPASS_WORKER_URL, {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + idToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: recentHistory }),
    });
    const data = await res.json();
    compassMessages = compassMessages.filter(m => m !== thinkingMsg);
    if(!res.ok || !data.reply){
      toast('Compass couldn\u2019t respond \u2014 try again');
      console.error('Compass request failed:', data);
      renderCompassMessages();
      return;
    }
    compassMessages.push({ from:'compass', text: data.reply, ts: Date.now() });
    renderCompassMessages();
    fbDb.collection('users').doc(currentUser.uid).collection('compassMessages').add({
      from:'compass', text: data.reply, ts: firebase.firestore.FieldValue.serverTimestamp(),
    }).catch(()=>{});
  }catch(e){
    compassMessages = compassMessages.filter(m => m !== thinkingMsg);
    renderCompassMessages();
    toast('Compass couldn\u2019t respond \u2014 check your connection');
  }
}
$('compassSendBtn').onclick = sendCompassMessage;
$('compassInput').addEventListener('keydown', e=>{
  if(e.key === 'Enter' && !e.shiftKey){ e.preventDefault(); sendCompassMessage(); }
});
$('compassInput').addEventListener('input', function(){
  this.style.height = 'auto';
  this.style.height = Math.min(120, this.scrollHeight) + 'px';
});

function openComposer(mode){
  composerMode = mode === 'broadcast' ? 'broadcast' : 'signal';
  resetComposer();
  const label = $('composerModeLabel');
  const hint = $('composerModeHint');
  const ttlRow = $('signalTtlRow');
  const fields = $('broadcastFields');
  const linkRow = $('signalLinkBroadcastRow');
  const postBtn = $('postBroadcastBtn');
  if(composerMode === 'broadcast'){
    if(label) label.textContent = 'New Broadcast';
    if(hint) hint.textContent = 'Permanent · community · stays until you delete';
    if(ttlRow) ttlRow.style.display = 'none';
    if(fields) fields.style.display = 'block';
    if(linkRow) linkRow.style.display = 'none';
    if(postBtn){
      postBtn.textContent = 'Publish Broadcast';
      postBtn.style.background = 'var(--mint)';
    }
  } else {
    if(label) label.textContent = 'New Signal';
    if(hint) hint.textContent = 'Ephemeral · choose 24h / 3 days / 7 days';
    if(ttlRow) ttlRow.style.display = 'block';
    if(fields) fields.style.display = 'none';
    if(linkRow) linkRow.style.display = 'block';
    if(postBtn){
      postBtn.textContent = 'Post Signal';
      postBtn.style.background = 'var(--mint)';
    }
    // fill optional attach-to-broadcast
    const sel = $('signalLinkBroadcast');
    if(sel){
      const mine = (typeof myBroadcasts !== 'undefined' ? myBroadcasts : []);
      sel.innerHTML = '<option value="">None — standalone Signal</option>' +
        mine.map(b => `<option value="${b.id}">${escapeHtml(b.title||'Broadcast')}</option>`).join('');
    }
  }
  $('composer').classList.add('active');
}

function closeComposer(){ $('composer').classList.remove('active'); }
$('composerClose').onclick = closeComposer;
if($('newSignalBtn')) $('newSignalBtn').onclick = ()=> openComposer('signal');
// Broadcast uses dedicated bcomposer (js/broadcast-composer.js) — do not open Signal composer
// Signal ring (empty) also opens signal composer via renderBroadcastTab

function resetComposer(){
  composerType = 'photo'; composerItems = []; activeComposerItemIndex = -1; composerTransition = 'fade';
  document.querySelectorAll('.type-chip').forEach(c=>c.classList.toggle('active', c.dataset.type==='photo'));
  $('mediaFileInput').accept = 'image/*';
  $('mediaFileInput').value = '';
  $('uploadDropLabel').textContent = 'Choose photos from your library';
  $('uploadDrop').style.display = 'flex';
  $('uploadPreview').style.display = 'none';
  $('filterChipRow').style.display = 'none';
  $('filmstrip').style.display = 'none';
  $('transitionSection').style.display = 'none';
  $('mediaComposer').style.display = 'block';
  $('textComposer').style.display = 'none';
  $('textBroadcastInput').value = '';
  renderTransitionChips();
  renderTextBgSwatches();
  updatePostButtonState();
}

document.querySelectorAll('.type-chip').forEach(chip=>{
  chip.onclick = ()=>{
    composerType = chip.dataset.type;
    document.querySelectorAll('.type-chip').forEach(c=>c.classList.toggle('active', c===chip));
    composerItems = []; activeComposerItemIndex = -1;
    if(composerType==='text'){
      $('mediaComposer').style.display = 'none';
      $('textComposer').style.display = 'block';
    } else {
      $('mediaComposer').style.display = 'block';
      $('textComposer').style.display = 'none';
      $('mediaFileInput').accept = composerType==='video' ? 'video/*' : 'image/*';
      $('mediaFileInput').value = '';
      $('uploadDropLabel').textContent = composerType==='video' ? 'Choose videos from your library' : 'Choose photos from your library';
      $('uploadDrop').style.display = 'flex';
      $('uploadPreview').style.display = 'none';
      $('filterChipRow').style.display = 'none';
      $('filmstrip').style.display = 'none';
      $('transitionSection').style.display = 'none';
    }
    updatePostButtonState();
  };
});

$('uploadDrop').onclick = ()=> $('mediaFileInput').click();
$('mediaFileInput').onchange = (e)=>{
  handleFiles(e.target.files);
  e.target.value = ''; // allow re-selecting the same file later
};

function probeVideoDuration(file){
  return new Promise(resolve=>{
    const v = document.createElement('video');
    v.preload = 'metadata';
    const url = URL.createObjectURL(file);
    v.onloadedmetadata = ()=>{ resolve(v.duration); URL.revokeObjectURL(url); };
    v.onerror = ()=> resolve(null);
    v.src = url;
  });
}
function readFileAsDataUrl(file){
  return new Promise((resolve, reject)=>{
    const r = new FileReader();
    r.onload = ()=> resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

let trimFileQueue = [];
/* Updates both the label text and the real visual fill together — the green now
   genuinely spreads across the banner as progress increases, not just a number in
   text next to a spinner. frac is 0-1; pass null to leave the fill where it is
   (useful for a label-only update like "Uploading...", before real percentages start). */
function setBgProgress(frac, text){
  $('bgProcessLabel').textContent = text;
  if(frac != null) $('bgProcessFill').style.width = Math.round(Math.min(1,Math.max(0,frac))*100) + '%';
}
let trimCurrentFile = null;
let trimObjectUrl = null;

async function handleFiles(fileList){
  const files = Array.from(fileList);
  // Soft ceiling only — no hard 60MB reject. Long clips still open the trim UI.
  // Size is handled by pass-through + smart compress on post.
  const SOFT_FORCE_TRIM_BYTES = 200 * 1024 * 1024;
  const needsTrim = [];
  for(const file of files){
    if(composerType==='video'){
      const duration = await probeVideoDuration(file);
      if((duration && duration > MAX_VIDEO_SECONDS) || file.size > SOFT_FORCE_TRIM_BYTES){
        needsTrim.push(file);
        continue;
      }
      // Keep original File for pass-through upload (no re-encode inflation)
      const dataUrl = await readFileAsDataUrl(file);
      composerItems.push({ id:Date.now()+Math.random(), kind:'video', dataUrl, sourceFile: file, filterKey:'normal', filterCss:'', crop:{scale:1,xPct:0,yPct:0}, caption:'', duration });
    } else {
      const dataUrl = await readFileAsDataUrl(file);
      composerItems.push({ id:Date.now()+Math.random(), kind:'photo', dataUrl, filterKey:'normal', filterCss:'', crop:{scale:1,xPct:0,yPct:0}, caption:'' });
    }
  }
  if(composerItems.length>0) activeComposerItemIndex = composerItems.length-1;
  renderFilmstrip();
  showActiveItemInPreview();
  updatePostButtonState();
  if(needsTrim.length>0){
    trimFileQueue = needsTrim.slice(1);
    openTrimOverlay(needsTrim[0]);
  }
}

function advanceTrimQueue(){
  if(trimFileQueue.length>0){
    const next = trimFileQueue.shift();
    openTrimOverlay(next);
  }
}
let trimSelectedFilter = 'normal';
function renderTrimFilterRow(){
  $('trimFilterRow').innerHTML = Object.entries(filterPresets).map(([key,f])=>
    `<div class="filter-chip ${trimSelectedFilter===key?'active':''}" data-filter="${key}">${f.name}</div>`
  ).join('');
  $('trimFilterRow').querySelectorAll('.filter-chip').forEach(el=>{
    el.onclick = ()=>{
      trimSelectedFilter = el.dataset.filter;
      $('trimFilterRow').querySelectorAll('.filter-chip').forEach(c=>c.classList.toggle('active', c===el));
      $('trimPreviewVideo').style.filter = filterPresets[trimSelectedFilter].css;
    };
  });
}
function openTrimOverlay(file){
  trimCurrentFile = file;
  trimSelectedFilter = 'normal';
  renderTrimFilterRow();
  const video = $('trimPreviewVideo');
  video.style.filter = '';
  if(trimObjectUrl) URL.revokeObjectURL(trimObjectUrl);
  trimObjectUrl = URL.createObjectURL(file);
  video.src = trimObjectUrl;
  video.muted = true;
  video.pause();
  setTrimPreviewPlayIcon(false);
  video.onloadedmetadata = ()=>{
    $('trimStartSlider').value = 0;
    $('trimEndSlider').value = 1000;
    updateTrimLabel();
    video.currentTime = 0;
  };
  $('trimProgressOverlay').style.display = 'none';
  $('trimAutoSplitNote').textContent = file.size > 100*1024*1024
    ? 'Long or large clip — trim a segment, or split into consecutive parts that play as one post.'
    : 'This clip is longer than 60 seconds — splitting breaks it into consecutive 60-second parts instead of trimming to just one.';
  $('trimOverlay').classList.add('active');
}
/* Lets someone actually hear the source video before committing to the whole
   trim/upload pipeline — a real way to confirm the source genuinely has audio, not
   just trust that it does. Toggles between muted-for-scrubbing (default) and
   unmuted-for-preview. */
function setTrimPreviewPlayIcon(playing){
  $('trimPreviewPlayBtn').innerHTML = playing
    ? `<svg width="20" height="20" viewBox="0 0 24 24" fill="none"><rect x="6" y="5" width="4" height="14" rx="1" fill="var(--mint)"/><rect x="14" y="5" width="4" height="14" rx="1" fill="var(--mint)"/></svg>`
    : `<svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M8 5v14l11-7-11-7z" fill="var(--mint)"/></svg>`;
}
$('trimPreviewPlayBtn').onclick = ()=>{
  const v = $('trimPreviewVideo');
  if(v.paused){
    v.muted = false;
    v.play().catch(()=>{});
    setTrimPreviewPlayIcon(true);
  } else {
    v.pause();
    v.muted = true;
    setTrimPreviewPlayIcon(false);
  }
};
$('trimPreviewVideo').onended = ()=>{
  $('trimPreviewVideo').muted = true;
  setTrimPreviewPlayIcon(false);
};
function trimSliderTimes(){
  const video = $('trimPreviewVideo');
  const duration = video.duration || 0;
  const startFrac = parseInt($('trimStartSlider').value)/1000;
  const endFrac = parseInt($('trimEndSlider').value)/1000;
  return { start: startFrac*duration, end: endFrac*duration, duration };
}
function formatTrimTime(s){
  s = Math.max(0, Math.round(s));
  return Math.floor(s/60)+':'+String(s%60).padStart(2,'0');
}
function updateTrimLabel(){
  const { start, end } = trimSliderTimes();
  const clamped = Math.min(end, start + MAX_VIDEO_SECONDS);
  $('trimRangeLabel').textContent = `${formatTrimTime(start)} \u2013 ${formatTrimTime(clamped)} (max ${MAX_VIDEO_SECONDS}s per clip)`;
}
$('trimStartSlider').oninput = ()=>{
  let s = parseInt($('trimStartSlider').value), e = parseInt($('trimEndSlider').value);
  if(s >= e){ s = Math.max(0, e-10); $('trimStartSlider').value = s; }
  $('trimPreviewVideo').currentTime = trimSliderTimes().start;
  updateTrimLabel();
};
$('trimEndSlider').oninput = ()=>{
  let s = parseInt($('trimStartSlider').value), e = parseInt($('trimEndSlider').value);
  if(e <= s){ e = Math.min(1000, s+10); $('trimEndSlider').value = e; }
  $('trimPreviewVideo').currentTime = trimSliderTimes().end;
  updateTrimLabel();
};
$('trimCancel').onclick = ()=>{
  $('trimOverlay').classList.remove('active');
  advanceTrimQueue();
};

/* Extracts a clip from startTime to endTime out of a video file.
   Uses native video.captureStream() so audio+video stay on the same timeline.
   MUST record at playbackRate 1. Setting 2× speeds up prepare but bakes a
   fast-motion clip into the file (everything plays at 2× later) — that was the bug.
   Prepare is therefore real-time wall-clock; progress UI still reflects true progress. */
async function extractVideoClip(file, startTime, endTime, onProgress){
  /* Slice a time range from a video file via MediaRecorder + HTMLVideoElement.
     Used for Broadcast chapters (>4 min) and silent multipart under worker max. */
  /* Smart encode (YouTube-like within browser limits):
     - Cap resolution at 1080p (phones don't need 4K for Signal)
     - Prefer VP9 when available (better quality per bit than VP8)
     - Bitrate scales with pixel count, not a fixed 2.8 Mbps
     - Never inflate a file that is already efficient: caller should pass-through those
  */
  return new Promise((resolve, reject)=>{
    const video = document.createElement('video');
    video.playsInline = true;
    video.muted = true;
    video.preload = 'auto';
    video.playbackRate = 1;
    const url = URL.createObjectURL(file);
    video.src = url;
    let settled = false;
    let stream = null;
    let recorder = null;
    let raf = 0;
    const cleanupMedia = ()=>{
      if(raf) cancelAnimationFrame(raf);
      try{ video.pause(); }catch(_){}
      try{ video.removeAttribute('src'); video.load(); }catch(_){}
      if(stream){
        stream.getTracks().forEach(t=>{ try{ t.stop(); }catch(_){} });
        stream = null;
      }
      URL.revokeObjectURL(url);
    };
    const fail = (err)=>{
      if(settled) return;
      settled = true;
      cleanupMedia();
      reject(err instanceof Error ? err : new Error(String(err)));
    };
    const succeed = (blob)=>{
      if(settled) return;
      settled = true;
      cleanupMedia();
      resolve(blob);
    };

    video.onerror = ()=> fail(new Error('Could not load video'));

    video.onloadedmetadata = ()=>{
      const duration = video.duration || endTime;
      const safeStart = Math.max(0, Math.min(startTime, Math.max(0, duration - 0.05)));
      const safeEnd = Math.max(safeStart + 0.2, Math.min(endTime - 0.05, duration));
      const clipDur = Math.max(0.2, safeEnd - safeStart);

      const onSeeked = ()=>{
        video.removeEventListener('seeked', onSeeked);

        const beginCapture = ()=>{
          const vw = video.videoWidth || 1280;
          const vh = video.videoHeight || 720;
          // Max 1080 on the long edge — YouTube mobile sweet spot
          const maxEdge = 1080;
          const scale = Math.min(1, maxEdge / Math.max(vw, vh));
          const cw = Math.max(2, Math.round(vw * scale / 2) * 2);
          const ch = Math.max(2, Math.round(vh * scale / 2) * 2);
          const pixels = cw * ch;

          // Bitrate ladder (bits/sec) — quality-first, size-aware
          let vBitrate;
          if(pixels >= 1920 * 1080 * 0.85) vBitrate = 4_500_000;      // ~1080p
          else if(pixels >= 1280 * 720 * 0.85) vBitrate = 2_800_000; // ~720p
          else if(pixels >= 854 * 480 * 0.85) vBitrate = 1_600_000;  // ~480p
          else vBitrate = 1_000_000;
          // Long clips: ease bitrate slightly so size stays reasonable
          if(clipDur > 90) vBitrate = Math.round(vBitrate * 0.85);
          if(clipDur > 180) vBitrate = Math.round(vBitrate * 0.9);

          const canvas = document.createElement('canvas');
          canvas.width = cw;
          canvas.height = ch;
          const ctx = canvas.getContext('2d', { alpha: false });

          let canvasStream;
          try{
            canvasStream = canvas.captureStream(30);
          }catch(e){
            fail(new Error('This browser cannot capture canvas video'));
            return;
          }

          // Mix in source audio when available
          try{
            const raw = video.captureStream ? video.captureStream() : (video.mozCaptureStream && video.mozCaptureStream());
            if(raw){
              raw.getAudioTracks().forEach(tr=>{
                try{ canvasStream.addTrack(tr); }catch(_){}
              });
            }
          }catch(_){}

          stream = canvasStream;

          const draw = ()=>{
            if(settled) return;
            try{ ctx.drawImage(video, 0, 0, cw, ch); }catch(_){}
            if(!video.paused && !video.ended) raf = requestAnimationFrame(draw);
          };

          const mimeCandidates = [
            'video/webm;codecs=vp9,opus',
            'video/webm;codecs=vp8,opus',
            'video/webm;codecs=vp8',
            'video/webm',
            'video/mp4',
          ];
          let mime = 'video/webm';
          for(const m of mimeCandidates){
            if(typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(m)){
              mime = m; break;
            }
          }

          const recorderOptions = { mimeType: mime, videoBitsPerSecond: vBitrate, audioBitsPerSecond: 128000 };
          const chunks = [];
          try{
            recorder = new MediaRecorder(stream, recorderOptions);
          }catch(e){
            try{ recorder = new MediaRecorder(stream); }
            catch(e2){ fail(new Error('MediaRecorder unavailable')); return; }
          }

          recorder.ondataavailable = e=>{ if(e.data && e.data.size) chunks.push(e.data); };
          recorder.onerror = ()=> fail(new Error('Recording failed'));
          recorder.onstop = ()=>{
            const blob = new Blob(chunks, { type: mime });
            succeed(blob);
          };

          try{ recorder.start(250); }catch(e){
            try{ recorder.start(); }catch(e2){ fail(e2); return; }
          }

          draw();
          video.play().catch(()=>{});

          const tick = ()=>{
            if(settled) return;
            const tnow = video.currentTime || 0;
            if(onProgress){
              const frac = Math.min(1, Math.max(0, (tnow - safeStart) / clipDur));
              try{ onProgress(frac); }catch(_){}
            }
            if(tnow >= safeEnd - 0.02 || video.ended){
              try{ video.pause(); }catch(_){}
              if(recorder && recorder.state !== 'inactive'){
                try{ recorder.stop(); }catch(e){ fail(e); }
              }
              return;
            }
            setTimeout(tick, 120);
          };
          setTimeout(tick, 120);
        };

        if(video.readyState >= 2) beginCapture();
        else {
          const onCanPlay0 = ()=>{ video.removeEventListener('canplay', onCanPlay0); beginCapture(); };
          video.addEventListener('canplay', onCanPlay0);
          setTimeout(()=>{ if(!settled) beginCapture(); }, 1500);
        }
      };

      video.addEventListener('seeked', onSeeked);
      try{ video.currentTime = safeStart; }
      catch(e){ fail(e); }
    };
  });
}

$('trimSave').onclick = async ()=>{
  const { start, end } = trimSliderTimes();
  const clampedEnd = Math.min(end, start + MAX_VIDEO_SECONDS);
  if(clampedEnd - start < 1){ toast('Selection is too short'); return; }
  const file = trimCurrentFile;
  const chosenFilterCss = filterPresets[trimSelectedFilter].css;
  $('trimOverlay').classList.remove('active');
  advanceTrimQueue();
  $('bgProcessBanner').style.display = 'flex';
  setBgProgress(0, 'Preparing clip\u2026 0%');
  postInProgress = true;
  savePendingVideoJob({ file, start, end: clampedEnd, action:'trim' });
  try{
    const blob = await extractVideoClip(file, start, clampedEnd, frac=>{
      setBgProgress(frac, `Preparing clip\u2026 ${Math.round(frac*100)}%`);
    });
    clearPendingVideoJob();
    // Pass the Blob straight through — no dataURL conversion. Upload uses the Blob
    // directly, which is the main reason prepare+upload felt so slow before.
    const now = Date.now();
    const groupId = 'post-' + now + '-' + Math.random().toString(36).slice(2);
    await postSegmentsNow([{
      type:'video', videoBlob: blob, filterCss: chosenFilterCss, crop:{scale:1,xPct:0,yPct:0},
      caption:'', duration: clampedEnd-start, createdAt: now, expiresAt: now+SIGNAL_TTL_MS,
      transitionIn:'fade', groupId, order:0,
    }]);
    toast('Posted to your signal');
  }catch(e){
    toast('Couldn\u2019t trim that video \u2014 try a shorter selection');
    postInProgress = false;
    $('bgProcessBanner').style.display = 'none';
    clearPendingVideoJob();
  }
};

$('trimAutoSplitBtn').onclick = async ()=>{
  const video = $('trimPreviewVideo');
  const duration = video.duration || 0;
  const file = trimCurrentFile;
  const chosenFilterCss = filterPresets[trimSelectedFilter].css;
  // Output size is now controlled directly by extractVideoClip's own fixed bitrate,
  // not the source file's original compression — so this only needs to reason about
  // duration, not file size, to guarantee every part stays under the real cap.
  const numParts = Math.max(1, Math.min(10, Math.ceil(duration/MAX_VIDEO_SECONDS)));
  const partDuration = duration / numParts;
  $('trimOverlay').classList.remove('active');
  advanceTrimQueue();
  $('bgProcessBanner').style.display = 'flex';
  setBgProgress(0, `Preparing part 1 of ${numParts}\u2026 0%`);
  postInProgress = true;
  savePendingVideoJob({ file, action:'split' });
  const now = Date.now();
  const groupId = 'post-' + now + '-' + Math.random().toString(36).slice(2);
  const segments = [];
  for(let i=0; i<numParts; i++){
    const s = i*partDuration, e = Math.min(duration, s+partDuration);
    try{
      const blob = await extractVideoClip(file, s, e, frac=>{
        setBgProgress((i+frac)/numParts, `Preparing part ${i+1} of ${numParts}\u2026 ${Math.round(frac*100)}%`);
      });
      segments.push({
        type:'video', videoBlob: blob, filterCss: chosenFilterCss, crop:{scale:1,xPct:0,yPct:0},
        caption: numParts>1 ? `Part ${i+1} of ${numParts}` : '', duration: e-s,
        createdAt: now+i, expiresAt: now+SIGNAL_TTL_MS,
        transitionIn: numParts>1 ? composerTransition : 'fade', groupId, order:i,
      });
    }catch(err){ /* one part failing doesn't stop the rest from still being posted */ }
  }
  clearPendingVideoJob();
  if(segments.length>0){
    // "Split into parts" is now the last decision — everything from here (uploading
    // every part, saving to Firestore, showing up in the ring) happens automatically.
    await postSegmentsNow(segments);
    toast(segments.length>1 ? `Posted ${segments.length} parts to your signal` : 'Posted to your signal');
  } else {
    postInProgress = false;
    $('bgProcessBanner').style.display = 'none';
    toast('Couldn\u2019t split that video');
  }
};

function renderFilmstrip(){
  if(composerItems.length===0){ $('filmstrip').style.display='none'; return; }
  $('uploadDrop').style.display = 'none';
  $('filmstrip').style.display = 'flex';
  $('filmstrip').innerHTML = composerItems.map((item,i)=>`
    <div class="filmstrip-item ${i===activeComposerItemIndex?'active':''}" data-idx="${i}">
      ${item.kind==='video'
        ? `<video src="${item.dataUrl}" muted style="filter:${item.filterCss}; transform:${cropTransform(item.crop)};"></video><div class="fs-badge">&#9654;</div>`
        : `<img src="${item.dataUrl}" style="filter:${item.filterCss}; transform:${cropTransform(item.crop)};" />`}
      <div class="fs-remove" data-remove="${i}"><svg width="9" height="9" viewBox="0 0 24 24" fill="none"><path d="M6 6l12 12M18 6L6 18" stroke="#fff" stroke-width="3" stroke-linecap="round"/></svg></div>
    </div>
  `).join('') + `<div class="filmstrip-add" id="filmstripAdd"><svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></div>`;
  document.querySelectorAll('.filmstrip-item').forEach(el=>{
    el.onclick = ()=>{ activeComposerItemIndex = parseInt(el.dataset.idx); renderFilmstrip(); showActiveItemInPreview(); };
  });
  document.querySelectorAll('[data-remove]').forEach(el=>{
    el.onclick = (e)=>{ e.stopPropagation(); removeComposerItem(parseInt(el.dataset.remove)); };
  });
  $('filmstripAdd').onclick = ()=> $('mediaFileInput').click();
  $('transitionSection').style.display = composerItems.length>1 ? 'block' : 'none';
}

function removeComposerItem(i){
  if(i<0 || i>=composerItems.length) return;
  composerItems.splice(i,1);
  if(activeComposerItemIndex >= composerItems.length) activeComposerItemIndex = composerItems.length-1;
  renderFilmstrip();
  if(composerItems.length===0){
    $('uploadDrop').style.display = 'flex';
    $('uploadPreview').style.display = 'none';
    $('filterChipRow').style.display = 'none';
    $('transitionSection').style.display = 'none';
  } else {
    showActiveItemInPreview();
  }
  updatePostButtonState();
}

function showActiveItemInPreview(){
  const item = composerItems[activeComposerItemIndex];
  if(!item){ $('uploadPreview').style.display = 'none'; return; }
  $('uploadDrop').style.display = 'none';
  $('uploadPreview').style.display = 'block';
  if(item.kind==='video'){
    $('previewVideo').src = item.dataUrl;
    $('previewVideo').style.display = 'block';
    $('previewImg').style.display = 'none';
    $('previewVideo').style.transform = cropTransform(item.crop);
    $('previewVideo').style.filter = item.filterCss;
  } else {
    $('previewImg').src = item.dataUrl;
    $('previewImg').style.display = 'block';
    $('previewVideo').style.display = 'none';
    $('previewImg').style.transform = cropTransform(item.crop);
    $('previewImg').style.filter = item.filterCss;
  }
  $('filterChipRow').style.display = 'flex';
  renderFilterChipsForItem(item);
  $('captionInput').value = item.caption || '';
  $('transitionSection').style.display = composerItems.length>1 ? 'block' : 'none';
}

function renderFilterChipsForItem(item){
  $('filterChipRow').innerHTML = Object.entries(filterPresets).map(([key,f])=>
    `<div class="filter-chip ${item.filterKey===key?'active':''}" data-filter="${key}">${f.name}</div>`
  ).join('');
  document.querySelectorAll('.filter-chip').forEach(el=>{
    el.onclick = ()=>{
      item.filterKey = el.dataset.filter;
      item.filterCss = filterPresets[item.filterKey].css;
      document.querySelectorAll('.filter-chip').forEach(c=>c.classList.toggle('active', c===el));
      $('previewImg').style.filter = item.filterCss;
      $('previewVideo').style.filter = item.filterCss;
      renderFilmstrip();
    };
  });
}

$('clearMediaBtn').onclick = (e)=>{ e.stopPropagation(); removeComposerItem(activeComposerItemIndex); };
$('captionInput').addEventListener('input', e=>{
  const item = composerItems[activeComposerItemIndex];
  if(item) item.caption = e.target.value;
});

function renderTextBgSwatches(){
  $('textBgRow').innerHTML = textBgGradients.map((g,i)=>
    `<div class="swatch ${g===composerTextBg?'selected':''}" style="background:${g}" data-bg="${i}"></div>`
  ).join('');
  document.querySelectorAll('#textBgRow .swatch').forEach(el=>{
    el.onclick = ()=>{
      composerTextBg = textBgGradients[parseInt(el.dataset.bg)];
      document.querySelectorAll('#textBgRow .swatch').forEach(s=>s.classList.remove('selected'));
      el.classList.add('selected');
      $('textComposePreview').style.background = composerTextBg;
    };
  });
  $('textComposePreview').style.background = composerTextBg;
}
$('textBroadcastInput').addEventListener('input', updatePostButtonState);

function renderTransitionChips(){
  $('transitionChipRow').innerHTML = Object.entries(transitionOptions).map(([k,label])=>
    `<div class="transition-chip ${composerTransition===k?'active':''}" data-t="${k}">${label}</div>`
  ).join('');
  document.querySelectorAll('.transition-chip').forEach(el=>{
    el.onclick = ()=>{
      composerTransition = el.dataset.t;
      document.querySelectorAll('.transition-chip').forEach(c=>c.classList.toggle('active', c===el));
    };
  });
}

function updatePostButtonState(){
  const valid = composerType==='text' ? $('textBroadcastInput').value.trim().length>0 : composerItems.length>0;
  $('postBroadcastBtn').disabled = !valid;
  $('postBroadcastBtn').style.opacity = valid ? '1' : '.5';
}

let postInProgress = false;
// A refresh or accidental navigation during a real, in-progress extraction or upload
// wipes it entirely — everything lives in JS memory, gone the instant the page
// reloads. This can't make an interrupted upload resume (that would need real
// persisted state and is a bigger project on its own), but it can stop the data loss
// from happening by accident in the first place.
window.addEventListener('beforeunload', e=>{
  // Only warn on full tab close while a background publish is mid-flight
  if((typeof publishBusy !== 'undefined' && publishBusy) || postInProgress){
    e.preventDefault();
    e.returnValue = '';
  }
});
/* The actual upload+save logic, shared by the normal composer flow and the new
   straight-through trim flow — same proven code path either way, just two different
   places that can trigger it. */
async function postSegmentsNow(newSegments){
  const hasVideo = newSegments.some(s=>s.type==='video');
  if(hasVideo){
    postInProgress = true;
    $('bgProcessBanner').style.display = 'flex';
    setBgProgress(0, 'Uploading to your signal\u2026');
  }
  if(currentUser && fbDb){
    let failed = 0;
    let lastErrorMessage = '';
    let videoIndex = 0;
    const totalVideos = newSegments.filter(s=>s.type==='video').length;
    for(const seg of newSegments){
      let segToSave = seg;
      if(seg.type==='video'){
        videoIndex++;
        if(hasVideo) setBgProgress((videoIndex-1)/totalVideos, totalVideos>1
          ? `Uploading to your signal\u2026 part ${videoIndex} of ${totalVideos}`
          : 'Uploading to your signal\u2026');
        try{
          // Prefer extracted Blob, then original File (pass-through), then dataUrl.
          const source = seg.videoBlob || seg.sourceFile || seg.dataUrl;
          const videoUrl = await uploadVideoToR2(source);
          const thumbSrc = seg.videoBlob
            ? URL.createObjectURL(seg.videoBlob)
            : (seg.sourceFile ? URL.createObjectURL(seg.sourceFile) : seg.dataUrl);
          const thumbDataUrl = await generateVideoThumbnail(thumbSrc);
          if(seg.videoBlob || seg.sourceFile) try{ URL.revokeObjectURL(thumbSrc); }catch(_){}
          // Store a small URL in Firestore, never the whole video.
          const { dataUrl, videoBlob, sourceFile, ...rest } = seg;
          segToSave = { ...rest, videoUrl, thumbDataUrl };
        }catch(e){
          failed++;
          lastErrorMessage = e.message || 'Unknown error';
          console.error('Signal video upload failed:', e);
          continue;
        }
      }
      const id = await saveSignalSegment(segToSave);
      if(id) mySignal.push({ id, ...segToSave });
    }
    if(newSegments.length>failed) bumpTodayActivity();
    if(failed>0) toast(failed===1 ? `Video upload failed: ${lastErrorMessage}` : `${failed} videos failed to upload: ${lastErrorMessage}`);
  } else {
    const now = Date.now();
    newSegments.forEach((seg,i)=> mySignal.push({ id: now+Math.random()+i, ...seg }));
    saveSignalToStorage();
  }
  if(hasVideo){
    postInProgress = false;
    $('bgProcessBanner').style.display = 'none';
  }
  mySignalSeen = false;
  renderBroadcasts();
}

$('postBroadcastBtn').onclick = async ()=>{
  if($('postBroadcastBtn').disabled || postInProgress) return;
  const now = Date.now();

  if(composerMode === 'broadcast'){
    const title = ($('bcastTitleInput') && $('bcastTitleInput').value.trim()) || '';
    const tagsRaw = ($('bcastTagsInput') && $('bcastTagsInput').value) || '';
    const tags = tagsRaw.split(',').map(s=>s.trim()).filter(Boolean).slice(0, 12);
    const caption = ($('captionInput') && $('captionInput').value.trim()) || '';
    if(!title && composerType !== 'text'){
      toast('Add a title for your Broadcast');
      return;
    }
    if(composerType !== 'text' && !composerItems.length){
      toast('Add media or switch to text');
      return;
    }
    // Snapshot what we need, then close — processing is not the user's job
    const snapType = composerType;
    const snapItems = composerItems.slice();
    const textVal = ($('textBroadcastInput') && $('textBroadcastInput').value.trim()) || '';
    const finalTitle = title || (snapType==='text' ? (textVal.slice(0,80) || 'Broadcast') : 'Broadcast');
    const desc = caption || (snapType==='text' ? textVal : '');
    closeComposer();
    const job = {
      label: 'Publishing Broadcast…',
      doneMsg: 'Broadcast published',
      run: async (progress)=>{
        let mediaType = 'text', mediaUrl = null, thumbUrl = null, filterCss = '';
        if(snapType === 'text'){
          mediaType = 'text';
        } else if(snapItems.length){
          const item = snapItems[0];
          mediaType = item.kind;
          filterCss = item.filterCss || '';
          if(progress) progress('Uploading…');
          if(item.kind === 'video'){
            const blob = item.videoBlob || item.sourceFile || (item.dataUrl ? await (await fetch(item.dataUrl)).blob() : null);
            if(!blob) throw new Error('Missing video');
            mediaUrl = await uploadVideoToR2(blob);
            try{ thumbUrl = await generateVideoThumbnail(mediaUrl); }catch(_){}
          } else {
            const blob = await (await fetch(item.dataUrl)).blob();
            mediaUrl = await uploadVideoToR2(blob);
            thumbUrl = mediaUrl;
          }
        }
        if(progress) progress('Saving Broadcast…');
        const b = await createPermanentBroadcast({
          title: finalTitle, description: desc, tags, mediaType, mediaUrl, thumbUrl, filterCss,
        });
        if(typeof loadFeedBroadcasts === 'function') await loadFeedBroadcasts();
        if(typeof openBroadcastById === 'function') openBroadcastById(b.id);
      },
    };
    if(typeof enqueuePublishJob === 'function') enqueuePublishJob(job);
    else job.run(()=>{}).catch(e=> toast(e.message || 'Publish failed'));
    return;
  }

  // ---- Signal path ----
  const expires = now + (typeof signalTtlMs === 'function' ? signalTtlMs() : SIGNAL_TTL_MS);
  const linkedBroadcastId = ($('signalLinkBroadcast') && $('signalLinkBroadcast').value) || '';
  const postGroupId = 'post-' + now + '-' + Math.random().toString(36).slice(2);
  let postedCount = 1;
  const newSegments = [];
  if(composerType==='text'){
    newSegments.push({ type:'text', text: $('textBroadcastInput').value.trim(), bg: composerTextBg, createdAt: now, expiresAt: expires, transitionIn: 'fade', groupId: postGroupId, order: 0, linkedBroadcastId: linkedBroadcastId || null });
  } else {
    postedCount = composerItems.length;
    composerItems.forEach((item, i)=>{
      newSegments.push({
        type: item.kind, dataUrl: item.dataUrl, sourceFile: item.sourceFile || null,
        videoBlob: item.videoBlob || null, filterCss: item.filterCss,
        crop: item.crop, caption: item.caption, createdAt: now + i, expiresAt: expires,
        transitionIn: composerItems.length>1 ? composerTransition : 'fade', duration: item.duration || null,
        groupId: postGroupId, order: i, linkedBroadcastId: linkedBroadcastId || null,
      });
    });
  }
  closeComposer();
  if(typeof enqueuePublishJob === 'function'){
    enqueuePublishJob({
      label: postedCount>1 ? ('Posting ' + postedCount + ' Signals…') : 'Posting Signal…',
      doneMsg: postedCount>1 ? ('Posted ' + postedCount + ' Signals') : 'Posted Signal',
      run: async (progress)=>{
        if(progress) progress(postedCount>1 ? ('Uploading Signals…') : 'Uploading Signal…');
        await postSegmentsNow(newSegments);
      },
    });
  } else {
    await postSegmentsNow(newSegments);
    toast(postedCount>1 ? `Posted ${postedCount} Signals` : 'Posted Signal');
  }
};



document.querySelectorAll('.ttl-chip').forEach(chip=>{
  chip.onclick = ()=>{
    document.querySelectorAll('.ttl-chip').forEach(c=>c.classList.remove('on'));
    chip.classList.add('on');
    signalTtlChoice = parseInt(chip.dataset.ttl, 10) || 24;
  };
});
