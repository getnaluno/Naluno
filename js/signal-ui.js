/* ============================================================
   MODULE: js/signal-ui.js
   Crop/adjust, signal ring, story viewer
   OWNERSHIP: change this domain here only.
   Scripts share globals (intentional) so load order matches the old monolith.
   ============================================================ */
/* ---------------- ADJUST (crop / pan / zoom) ---------------- */
let adjustWorkingCrop = null;
let adjustDragStart = null;
let adjustContext = 'composer'; // 'composer' | 'avatar'
let pendingAvatarDataUrl = null;
let avatarAdjustCallback = null;

$('adjustBtn').onclick = ()=>{
  const item = composerItems[activeComposerItemIndex]; if(!item) return;
  adjustContext = 'composer';
  $('adjustTitle').textContent = 'Adjust';
  adjustWorkingCrop = { ...item.crop };
  const isVideo = item.kind==='video';
  $('adjustImg').style.display = isVideo ? 'none' : 'block';
  $('adjustVideo').style.display = isVideo ? 'block' : 'none';
  if(isVideo){ $('adjustVideo').src = item.dataUrl; $('adjustVideo').pause(); }
  else { $('adjustImg').src = item.dataUrl; }
  $('adjustZoom').value = Math.round(adjustWorkingCrop.scale*100);
  applyAdjustTransform();
  $('adjustOverlay').classList.add('active');
};

/* Opens the same crop/pan/zoom overlay for an avatar photo. onSave receives {dataUrl, crop}. */
function openAvatarAdjust(dataUrl, crop, onSave){
  adjustContext = 'avatar';
  pendingAvatarDataUrl = dataUrl;
  avatarAdjustCallback = onSave;
  adjustWorkingCrop = { ...crop };
  $('adjustTitle').textContent = 'Adjust photo';
  $('adjustImg').style.display = 'block';
  $('adjustVideo').style.display = 'none';
  $('adjustImg').src = dataUrl;
  $('adjustZoom').value = Math.round(adjustWorkingCrop.scale*100);
  applyAdjustTransform();
  $('adjustOverlay').classList.add('active');
}
function applyAdjustTransform(){
  const t = cropTransform(adjustWorkingCrop);
  $('adjustImg').style.transform = t;
  $('adjustVideo').style.transform = t;
}
$('adjustZoom').oninput = (e)=>{ adjustWorkingCrop.scale = parseInt(e.target.value)/100; applyAdjustTransform(); };

const adjustStage = $('adjustStage');
adjustStage.addEventListener('pointerdown', e=>{
  if(!adjustWorkingCrop) return;
  adjustDragStart = { x:e.clientX, y:e.clientY, xPct:adjustWorkingCrop.xPct, yPct:adjustWorkingCrop.yPct };
  adjustStage.setPointerCapture(e.pointerId);
});
adjustStage.addEventListener('pointermove', e=>{
  if(!adjustDragStart || !adjustWorkingCrop) return;
  const rect = adjustStage.getBoundingClientRect();
  const dx = e.clientX - adjustDragStart.x, dy = e.clientY - adjustDragStart.y;
  adjustWorkingCrop.xPct = clamp(adjustDragStart.xPct + (dx/rect.width*100), -50, 50);
  adjustWorkingCrop.yPct = clamp(adjustDragStart.yPct + (dy/rect.height*100), -50, 50);
  applyAdjustTransform();
});
adjustStage.addEventListener('pointerup', ()=>{ adjustDragStart = null; });
adjustStage.addEventListener('pointercancel', ()=>{ adjustDragStart = null; });

$('adjustCancel').onclick = ()=>{
  $('adjustOverlay').classList.remove('active');
  if(adjustContext==='avatar'){ pendingAvatarDataUrl = null; avatarAdjustCallback = null; }
};
$('adjustSave').onclick = ()=>{
  if(adjustContext==='avatar'){
    if(avatarAdjustCallback) avatarAdjustCallback({ dataUrl: pendingAvatarDataUrl, crop: { ...adjustWorkingCrop } });
    pendingAvatarDataUrl = null; avatarAdjustCallback = null;
  } else {
    const item = composerItems[activeComposerItemIndex];
    if(item) item.crop = { ...adjustWorkingCrop };
    renderFilmstrip();
    showActiveItemInPreview();
  }
  $('adjustOverlay').classList.remove('active');
  toast('Adjustment saved');
};

/* ---------------- YOUR SIGNAL RING + LIST ---------------- */
function renderBroadcasts(){
  pruneExpiredSignal();
  const latest = mySignal[mySignal.length-1];
  let mySignalInner;
  if(latest){
    let thumb;
    if(latest.type==='text'){
      thumb = `<div class="avatar" style="width:100%;height:100%;background:${latest.bg};font-size:9px;padding:4px;text-align:center;line-height:1.15;">${escapeHtml(latest.text).slice(0,26)}</div>`;
    } else if(latest.type==='video'){
      thumb = latest.thumbDataUrl
        ? `<img src="${latest.thumbDataUrl}" class="mysignal-thumb" style="filter:${latest.filterCss}" />`
        : `<video src="${latest.videoUrl || latest.dataUrl}" class="mysignal-thumb" style="filter:${latest.filterCss}" muted></video>`;
    } else {
      thumb = `<img src="${latest.dataUrl}" class="mysignal-thumb" style="filter:${latest.filterCss}" />`;
    }
    mySignalInner = `<div class="ring ${mySignalSeen?'seen':''}"><div class="avatar" style="width:100%;height:100%;overflow:hidden;background:#1F2333;">${thumb}</div></div><span>Your signal${mySignal.length>1?' · '+mySignal.length:''}</span>`;
  } else {
    mySignalInner = `<div class="ring seen"><div class="avatar" style="width:100%;height:100%;background:#1F2333;color:var(--text-dim);font-size:20px;">+</div></div><span>Your signal</span>`;
  }
  $('myBcastStrip').innerHTML = `<div class="bcast-item" id="mySignalItem">${mySignalInner}</div>` +
    connectionsSignals.map(({ contact:c, latest })=>{
      return `<div class="bcast-item" data-b="${c.id}"><div class="ring"><div class="avatar" style="width:100%;height:100%;background:${c.color};position:relative;">${c.initials}</div></div><span>${c.name.split(' ')[0]}</span></div>`;
    }).join('');
  $('bcastList').innerHTML = connectionsSignals.length ? connectionsSignals.map(({ contact:c, latest })=>{
    return `<div class="bcast-list-row" data-b="${c.id}">
    <div class="avatar" style="width:44px;height:44px;font-size:14px;background:${c.color};position:relative;">${c.initials}${signalBarsHtml(c)}</div>
    <div class="contact-meta"><div class="contact-name">${c.name}</div><div class="contact-sub">${signalMeta[computeSignal(c).tier].label} · tap to view</div></div>
    <div class="bcast-time">${timeAgo(latest.createdAt)}</div>
  </div>`;
  }).join('') : `<div style="padding:20px 10px; color:var(--text-dim); font-size:13px; text-align:center;">No recent signals from your frequencies yet.</div>`;
  document.querySelectorAll('[data-b]').forEach(el=>{
    el.onclick = ()=> openBroadcast(parseInt(el.dataset.b));
  });
  $('mySignalItem').onclick = ()=>{ mySignal.length ? openMyBroadcast() : openComposer(); };
}
renderBroadcasts();

/* ---------------- STORY VIEWER (multi-segment playback) ---------------- */
let currentSegments = [];
let currentSegmentIndex = 0;
let viewingMine = false;
let segTimer = null;
let currentVideoEl = null;

function renderBars(count){
  $('bviewerBars').innerHTML = Array.from({length: count}).map(()=>'<div class="bar"><i></i></div>').join('');
}
function updateBars(idx, durationMs){
  const bars = document.querySelectorAll('#bviewerBars .bar i');
  bars.forEach((el,bi)=>{
    el.style.transition = 'none';
    el.style.width = bi<idx ? '100%' : '0%';
  });
  void $('bviewerBars').offsetWidth;
  const cur = bars[idx];
  if(cur){
    requestAnimationFrame(()=>{
      cur.style.transition = `width ${durationMs}ms linear`;
      cur.style.width = '100%';
    });
  }
}
function transitionClassFor(t, direction){
  if(t==='fade') return 'seg-fade';
  if(t==='slide') return direction < 0 ? 'seg-slide-back' : 'seg-slide-fwd';
  if(t==='zoom') return direction < 0 ? 'seg-zoom-back' : 'seg-zoom-fwd';
  return ''; // 'cut' — deliberately no animation
}
function clearSegTimer(){
  if(segTimer){ clearTimeout(segTimer); segTimer = null; }
  if(currentVideoEl){
    currentVideoEl.onended = null;
    try{ currentVideoEl.pause(); }catch(_){}
    try{ currentVideoEl.muted = true; }catch(_){}
    try{ currentVideoEl.removeAttribute('src'); currentVideoEl.load(); }catch(_){}
    currentVideoEl = null;
  }
}

function playSegment(idx, direction=1){
  clearSegTimer();
  currentSegmentIndex = idx;
  const seg = currentSegments[idx];
  const animClass = idx===0 ? '' : transitionClassFor(seg.transitionIn, direction);
  $('bviewerTime').textContent = seg.type==='avatar' ? seg.time : timeAgo(seg.createdAt);

  const captionHtml = seg.caption ? `<div style="position:absolute; bottom:56px; left:20px; right:20px; color:#fff; font-size:14px; text-align:center;">${escapeHtml(seg.caption)}</div>` : '';
  const cropT = cropTransform(seg.crop);
  let bodyHtml, durationMs;
  if(seg.type==='avatar'){
    bodyHtml = `<div class="avatar ${animClass}" style="width:140px;height:140px;font-size:44px;background:${seg.color};">${seg.initials}</div>`;
    durationMs = 4000;
  } else if(seg.type==='text'){
    bodyHtml = `<div class="bviewer-text-card ${animClass}" style="background:${seg.bg}; border-radius:20px; width:100%; height:100%;">${escapeHtml(seg.text)}</div>`;
    durationMs = 4000;
  } else if(seg.type==='video'){
    const videoSrc = seg.videoUrl || seg.dataUrl;
    // Use the pre-generated thumbnail as poster so the viewer never flashes a black
    // or static first-frame while the real video buffers. This is the actual cause of
    // the reported "brief static thumbnail then audio starts ahead of video".
    const posterAttr = seg.thumbDataUrl ? ` poster="${seg.thumbDataUrl}"` : '';
    bodyHtml = `<video id="bviewerActiveVideo" class="${animClass}" src="${videoSrc}" preload="auto" playsinline${posterAttr} style="filter:${seg.filterCss}; position:absolute; top:50%; left:50%; width:100%; height:100%; object-fit:cover; --ct:${cropT}; transform:${cropT}; border-radius:16px;"></video>${captionHtml}<div class="cam-expand-btn" id="bviewerMuteToggle" style="right:auto; left:14px; top:14px;" role="button" aria-label="Toggle sound"></div>`;
    durationMs = Math.round((seg.duration || 6) * 1000);
  } else {
    bodyHtml = `<img class="${animClass}" src="${seg.dataUrl}" style="filter:${seg.filterCss}; position:absolute; top:50%; left:50%; width:100%; height:100%; object-fit:cover; --ct:${cropT}; transform:${cropT}; border-radius:16px;" />${captionHtml}`;
    durationMs = 4000;
  }
  $('bviewerBody').innerHTML = bodyHtml;
  updateBars(idx, durationMs);

  if(seg.type==='video'){
    const v = $('bviewerActiveVideo');
    v.onended = ()=> goToSegment(idx+1);
    currentVideoEl = v;
    const muteBtn = $('bviewerMuteToggle');
    const renderMuteIcon = muted=>{
      muteBtn.innerHTML = muted
        ? `<svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M3 10v4h4l5 5V5L7 10H3z" fill="currentColor"/><path d="M16 9l6 6M22 9l-6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`
        : `<svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M3 10v4h4l5 5V5L7 10H3z" fill="currentColor"/><path d="M16 8a5 5 0 010 8M19 5a9 9 0 010 14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;
    };
    // Wait for canplay so the first decoded frame exists, then play(). Poster covers
    // the visual gap. Unmute only after the playing event so audio does not start
    // ahead of the first painted frame (the classic out-of-sync glitch).
    const startPlayback = ()=>{
      renderMuteIcon(true);
      v.muted = true; // start muted to satisfy autoplay policies, then unmute on playing
      const onPlaying = ()=>{
        v.removeEventListener('playing', onPlaying);
        // Small delay lets the first video frame actually paint before audio starts.
        requestAnimationFrame(()=>{
          v.muted = false;
          renderMuteIcon(false);
        });
      };
      v.addEventListener('playing', onPlaying);
      v.play().catch(()=>{
        v.removeEventListener('playing', onPlaying);
        v.muted = true;
        renderMuteIcon(true);
        v.play().catch(()=>{});
      });
    };
    if(v.readyState >= 3){ // HAVE_FUTURE_DATA or better
      startPlayback();
    } else {
      const onReady = ()=>{ v.removeEventListener('canplay', onReady); startPlayback(); };
      v.addEventListener('canplay', onReady);
      setTimeout(()=>{ if(v.paused){ v.removeEventListener('canplay', onReady); startPlayback(); } }, 2000);
    }
    muteBtn.onclick = ()=>{
      v.muted = !v.muted;
      renderMuteIcon(v.muted);
      if(!v.muted) v.play().catch(()=>{});
    };
  } else {
    segTimer = setTimeout(()=> goToSegment(idx+1), durationMs);
  }
}
function goToSegment(idx){
  clearSegTimer();
  if(idx < 0){ playSegment(0, 1); return; }
  if(idx >= currentSegments.length){
    if(viewingMine) mySignalSeen = true;
    closeBroadcast();
    renderBroadcasts();
    return;
  }
  const direction = idx > currentSegmentIndex ? 1 : -1;
  playSegment(idx, direction);
}
$('bviewerNextZone').onclick = ()=>{ if(viewingMine || currentSegments.length) goToSegment(currentSegmentIndex+1); };
$('bviewerPrevZone').onclick = ()=>{ if(viewingMine || currentSegments.length) goToSegment(currentSegmentIndex-1); };

async function openBroadcast(contactId){
  const c = contacts.find(x=>x.id===contactId); if(!c || !c.isReal || !c.firebaseUid || !fbDb) return;
  try{
    const snap = await fbDb.collection('users').doc(c.firebaseUid).collection('signal').orderBy('createdAt','asc').get();
    const segments = sortSignalSegments(snap.docs.map(d=>({ id:d.id, ...d.data() })).filter(s => Date.now() < s.expiresAt));
    if(segments.length===0){ toast(c.name.split(' ')[0] + '\u2019s signal has faded'); return; }
    viewingMine = false;
    currentSegments = segments;
    $('bviewerAvatar').style.background = c.color; $('bviewerAvatar').textContent = c.initials;
    $('bviewerName').textContent = c.name;
    $('bviewerStatus').textContent = signalMeta[computeSignal(c).tier].label;
    $('bviewerStatus').style.display = 'block';
    $('bviewerMessage').style.display = 'flex';
    $('bviewerMessage').onclick = ()=>{ closeBroadcast(); openWirelineFromFrequencies(c.id); };
    $('bviewerRemove').style.display = 'none';
    renderBars(segments.length);
    $('bviewer').classList.add('active');
    playSegment(0);
  }catch(e){
    toast('Couldn\u2019t load that signal right now');
  }
}
function sortSignalSegments(segments){
  // Groups segments from the same post together (by groupId) and keeps them in the
  // correct internal order (by the explicit order field) — this is what actually
  // guarantees a multi-part video plays as one coherent clip instead of being
  // interleaved with segments from other posts by raw timestamp alone, which is what
  // caused parts to appear in a scrambled order once a post took real minutes to
  // finish uploading. Segments without a groupId (posted before this existed) each
  // become their own group of one, so nothing about older posts breaks.
  const groups = {};
  segments.forEach(seg=>{
    const gid = seg.groupId || ('legacy-' + seg.id);
    if(!groups[gid]) groups[gid] = [];
    groups[gid].push(seg);
  });
  const groupList = Object.values(groups).map(group=>{
    group.sort((a,b)=> (a.order||0) - (b.order||0));
    const times = group.map(s=> typeof s.createdAt==='number' ? s.createdAt : (s.createdAt && s.createdAt.toMillis ? s.createdAt.toMillis() : 0));
    return { earliestCreatedAt: Math.min(...times), group };
  });
  groupList.sort((a,b)=> a.earliestCreatedAt - b.earliestCreatedAt);
  return groupList.flatMap(g=>g.group);
}
function openMyBroadcast(){
  pruneExpiredSignal();
  if(mySignal.length===0) return;
  viewingMine = true;
  const profile = (typeof currentProfile !== 'undefined') ? currentProfile : { name:'You', color:'#7CFFB2', photo:null };
  currentSegments = sortSignalSegments(mySignal.slice());
  applyAvatarVisual($('bviewerAvatar'), profile);
  $('bviewerName').textContent = profile.name;
  $('bviewerStatus').style.display = 'none';
  $('bviewerMessage').style.display = 'none';
  $('bviewerRemove').style.display = 'inline-flex';
  renderBars(currentSegments.length);
  $('bviewer').classList.add('active');
  playSegment(0);
}
function closeBroadcast(){ clearSegTimer(); $('bviewer').classList.remove('active'); }
$('bviewerClose').onclick = closeBroadcast;
$('bviewerRemove').onclick = ()=>{
  if(!viewingMine) return;
  const seg = currentSegments[currentSegmentIndex];
  mySignal = mySignal.filter(s=>s.id!==seg.id);
  currentSegments.splice(currentSegmentIndex,1);
  renderBroadcasts();
  if(currentUser && fbDb) deleteSignalSegment(seg.id);
  else saveSignalToStorage();
  if(currentSegments.length===0){ closeBroadcast(); toast('Removed from your signal'); return; }
  const nextIdx = Math.min(currentSegmentIndex, currentSegments.length-1);
  renderBars(currentSegments.length);
  playSegment(nextIdx);
  toast('Removed from your signal');
};


function renderContacts(){
  const query = ($('frequencySearchInput').value || '').trim().toLowerCase();
  const visible = query
    ? contacts.filter(c => c.name.toLowerCase().includes(query) || (c.handle||'').toLowerCase().includes(query))
    : contacts;
  const groups = { strong: [], fading: [], off: [] };
  visible.forEach(c => groups[computeSignal(c).tier].push(c));

  Object.entries(groups).forEach(([tier, list])=>{
    const label = $(tier+'Label');
    label.style.display = list.length ? 'block' : 'none';
    $(tier+'List').innerHTML = list.length
      ? list.map(rowHtml).join('')
      : '';
  });
  if(query && visible.length===0){
    $('strongLabel').style.display = 'block';
    $('strongList').innerHTML = `<div style="padding:20px 10px; color:var(--text-dim); font-size:13px; text-align:center;">No one matches "${escapeHtml(query)}" in your frequencies yet.</div>`;
  }

  function rowHtml(c){
    const bandBits = (c.publicBands && c.publicBands.length)
      ? `<div style="font-family:var(--font-mono); font-size:10.5px; color:var(--mint); margin-top:2px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(c.publicBands.slice(0,3).map(b=>b.name).join(' · '))}${c.publicBands.length>3?'…':''}</div>`
      : '';
    return `<div class="contact-row" data-id="${c.id}">
      <div class="avatar" style="width:46px;height:46px;font-size:15px;${contactAvatarStyleAttr(c)}position:relative;">${c.photo&&c.photo.dataUrl?'':c.initials}${signalBarsHtml(c)}</div>
      <div class="contact-meta"><div class="contact-name">${escapeHtml(c.name)}</div><div class="contact-sub">${signalSubText(c)}</div>${bandBits}</div>
      <div class="call-icon-btn" data-call="${c.id}"><svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M22 16.9v3a2 2 0 01-2.2 2 19.8 19.8 0 01-8.6-3.1 19.5 19.5 0 01-6-6A19.8 19.8 0 012.1 4.2 2 2 0 014.1 2h3a2 2 0 012 1.7c.1.9.3 1.8.6 2.7a2 2 0 01-.4 2.1L8 9.9a16 16 0 006 6l1.4-1.3a2 2 0 012.1-.4c.9.3 1.8.5 2.7.6a2 2 0 011.8 2.1z" stroke="currentColor" stroke-width="1.8"/></svg></div>
    </div>`;
  }
  document.querySelectorAll('[data-call]').forEach(el=>{
    el.onclick = (e)=>{ e.stopPropagation(); startOutgoingCall(parseInt(el.dataset.call)); };
  });
  document.querySelectorAll('.contact-row').forEach(el=>{
    el.onclick = ()=> openWirelineFromFrequencies(parseInt(el.dataset.id));
  });
}
renderContacts();
$('frequencySearchInput').addEventListener('input', renderContacts);

