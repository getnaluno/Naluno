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

/* Discovery: prefer useful activity over pure popularity */
function rankBroadcastEntries(entries){
  // entries: [{ contact, latest }]
  return entries.slice().sort((a, b)=>{
    const ca = a.contact, cb = b.contact;
    const sa = computeSignal(ca), sb = computeSignal(cb);
    // Stronger relationship first
    const tierScore = { strong:3, fading:1, off:0 };
    const rel = (tierScore[sb.tier]||0) - (tierScore[sa.tier]||0);
    if(rel) return rel;
    // More recent meaningful signal
    return (b.latest.createdAt||0) - (a.latest.createdAt||0);
  });
}


function renderBroadcastTab(){
  try{ if(typeof pruneExpiredSignal === 'function') pruneExpiredSignal(); }catch(_){}
  const stripEl = document.getElementById('myBcastStrip');
  const grid = document.getElementById('bcastPlateGrid');
  const empty = document.getElementById('bcastPlateEmpty');

  // ---- Signal rings ----
  if(stripEl){
    const latest = (typeof mySignal !== 'undefined' && mySignal.length) ? mySignal[mySignal.length-1] : null;
    let myInner;
    if(latest){
      let thumb = '';
      try{
        if(latest.type==='text'){
          thumb = '<div class="avatar" style="width:100%;height:100%;background:'+(latest.bg||'#333')+';font-size:9px;padding:4px;text-align:center;line-height:1.15;">'+escapeHtml(String(latest.text||'').slice(0,26))+'</div>';
        } else if(latest.type==='video'){
          const src = latest.thumbDataUrl || '';
          thumb = src
            ? '<img src="'+src+'" class="mysignal-thumb" style="filter:'+(latest.filterCss||'')+'" />'
            : '<div class="avatar" style="width:100%;height:100%;background:#1F2333;font-size:11px;color:#7CFFB2;">▶</div>';
        } else {
          thumb = '<img src="'+(latest.dataUrl||'')+'" class="mysignal-thumb" style="filter:'+(latest.filterCss||'')+'" />';
        }
      }catch(_){ thumb = ''; }
      const seen = (typeof mySignalSeen !== 'undefined' && mySignalSeen) ? 'seen' : '';
      myInner = '<div class="signal-window '+seen+'"><div class="signal-window-in">'+thumb+'<span class="signal-play">▶</span></div></div><span>Your signal'+(mySignal.length>1?(' · '+mySignal.length):'')+'</span>';
    } else {
      myInner = '<div class="signal-window seen"><div class="signal-window-in" style="color:var(--mint);font-size:22px;">+</div></div><span>Post signal</span>';
    }
    const conn = (typeof connectionsSignals !== 'undefined' && connectionsSignals) ? connectionsSignals : [];
    let others = '';
    conn.forEach(function(entry){
      const c = entry.contact;
      if(!c) return;
      const name = (c.name||'?').split(' ')[0];
      others += '<div class="bcast-item" data-signal="'+c.id+'"><div class="signal-window"><div class="signal-window-in" style="background:'+(c.color||'#7CFFB2')+';color:#0D0F17;font-weight:700;">'+(c.initials||'?')+'</div></div><span>'+escapeHtml(name)+'</span></div>';
    });
    stripEl.innerHTML = '<div class="bcast-item" id="mySignalItem">'+myInner+'</div>'+others;
    const mine = document.getElementById('mySignalItem');
    if(mine){
      mine.onclick = function(){
        if(typeof mySignal !== 'undefined' && mySignal.length){
          if(typeof openMySignalStory === 'function') openMySignalStory();
          else if(typeof openMyBroadcast === 'function') openMyBroadcast();
        } else if(typeof openComposer === 'function'){
          openComposer('signal');
        }
      };
    }
    stripEl.querySelectorAll('[data-signal]').forEach(function(el){
      el.onclick = function(){
        const id = parseInt(el.getAttribute('data-signal'), 10);
        if(typeof openContactSignalStory === 'function') openContactSignalStory(id);
      };
    });
  }

  // ---- Permanent Broadcast plates ----
  // Keys are always stable Broadcast IDs (data-broadcast-id), never array indexes.
  if(grid){
    const list = (typeof feedBroadcasts !== 'undefined' && feedBroadcasts) ? feedBroadcasts.slice() : [];
    if(!list.length){
      grid.innerHTML = '';
      if(empty) empty.style.display = 'block';
    } else {
      if(empty) empty.style.display = 'none';
      paintBroadcastPlateGrid(grid, list);
    }
  }
}

/** Incremental plate grid: reuse existing nodes keyed by Broadcast ID.
 *  Layout/order changes must not invent new identities or refetch media. */
function paintBroadcastPlateGrid(grid, list){
  if(!grid) return;
  const existing = {};
  Array.prototype.forEach.call(grid.querySelectorAll('[data-broadcast-id]'), function(el){
    existing[el.getAttribute('data-broadcast-id')] = el;
  });
  const frag = document.createDocumentFragment();
  const keep = {};
  (list || []).forEach(function(b){
    if(!b || !b.id) return;
    keep[b.id] = true;
    let el = existing[b.id];
    if(!el){
      const html = (typeof broadcastThumbHtml === 'function')
        ? broadcastThumbHtml(b)
        : ('<article class="bcast-plate" data-broadcast-id="'+escapeHtml(b.id)+'" role="button" tabindex="0"><div class="bcast-plate-meta"><div class="bcast-plate-title">'+escapeHtml(b.title||'Broadcast')+'</div></div></article>');
      const wrap = document.createElement('div');
      wrap.innerHTML = html;
      el = wrap.firstElementChild;
    } else {
      // Soft metadata refresh only (title/live/views) — do not recreate media nodes.
      try{
        const titleEl = el.querySelector('.bcast-plate-title');
        if(titleEl && b.title) titleEl.textContent = String(b.title).slice(0, 48);
        let liveEl = el.querySelector('.bcast-plate-live');
        if(b.live && !liveEl){
          const frame = el.querySelector('.bcast-plate-frame');
          if(frame){
            liveEl = document.createElement('span');
            liveEl.className = 'bcast-plate-live';
            liveEl.textContent = 'LIVE';
            frame.appendChild(liveEl);
          }
        } else if(!b.live && liveEl){
          liveEl.remove();
        }
      }catch(_){}
    }
    if(el){
      el.onclick = function(){
        if(typeof openBroadcastById === 'function') openBroadcastById(b.id);
      };
      frag.appendChild(el);
    }
  });
  Object.keys(existing).forEach(function(id){
    if(!keep[id]) try{ existing[id].remove(); }catch(_){}
  });
  grid.innerHTML = '';
  grid.appendChild(frag);
}
function softUpdateBroadcastPlates(list){
  const grid = document.getElementById('bcastPlateGrid');
  if(!grid) return;
  paintBroadcastPlateGrid(grid, list || []);
}
window.softUpdateBroadcastPlates = softUpdateBroadcastPlates;
window.paintBroadcastPlateGrid = paintBroadcastPlateGrid;

function renderBroadcasts(){
  try{ renderBroadcastTab(); }catch(e){ console.warn('[signal] render', e); }
}


try{ renderBroadcasts(); }catch(e){ console.warn(e); }

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

function signalPlaySrc(seg){
  if(!seg) return '';
  const raw = seg.videoUrl || seg.mediaUrl || seg.dataUrl || '';
  if(!raw) return '';
  if(String(raw).indexOf('blob:') === 0 || String(raw).indexOf('data:') === 0) return raw;
  const remote = (typeof resolveMediaUrl === 'function') ? resolveMediaUrl(raw) : raw;
  const key = (typeof vaultKeyForUrl === 'function') ? vaultKeyForUrl(remote) : '';
  if(key && typeof vaultSyncSrc === 'function'){
    const local = vaultSyncSrc(key);
    if(local) return local;
  }
  if(typeof vaultIngestUrl === 'function'){
    vaultIngestUrl(remote, key).catch(function(){});
  }
  return remote;
}

function signalRememberView(contactUid, segments){
  try{
    nalunoCacheWrite('signalView:' + (contactUid || 'me'), (segments || []).map(nalunoSlimMedia));
  }catch(_){}
}


/** If remote <video> stays paused, fetch bytes into a blob: URL (same-origin worker
 *  already allows CORS). Fixes Samsung cases where progressive Range play hangs on poster. */
function signalEnsurePlayableSrc(videoEl, remoteUrl){
  return new Promise(function(resolve){
    if(!videoEl || !remoteUrl){ resolve(false); return; }
    if(String(remoteUrl).indexOf('blob:') === 0 || String(remoteUrl).indexOf('data:') === 0){
      resolve(true); return;
    }
    if(videoEl.dataset && videoEl.dataset.blobTried === '1'){ resolve(false); return; }
    try{ videoEl.dataset.blobTried = '1'; }catch(_){}
    const ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    const t = setTimeout(function(){ try{ if(ctrl) ctrl.abort(); }catch(_){} }, 12000);
    fetch(remoteUrl, ctrl ? { signal: ctrl.signal, mode: 'cors', credentials: 'omit' } : { mode: 'cors', credentials: 'omit' })
      .then(function(r){
        if(!r.ok) throw new Error('fetch ' + r.status);
        return r.blob();
      })
      .then(function(blob){
        clearTimeout(t);
        if(!blob || !blob.size){ resolve(false); return; }
        const u = URL.createObjectURL(blob);
        try{ videoEl.src = u; }catch(_){}
        try{ videoEl.load(); }catch(_){}
        resolve(true);
      })
      .catch(function(){
        clearTimeout(t);
        resolve(false);
      });
  });
}

function playSegment(idx, direction=1){
  if(viewingMine && $('bviewerRemove')){
    $('bviewerRemove').style.display = 'inline-flex';
  }

  const body = $('bviewerBody');
  const isVideoSeg = currentSegments[idx] && (
    currentSegments[idx].type === 'video'
    || !!(currentSegments[idx].videoUrl || currentSegments[idx].mediaUrl)
  );
  if(body){
    if(isVideoSeg){
      body.classList.remove('square-preview');
      body.classList.add('native-preview');
      body.style.minHeight = '42vh';
    } else {
      body.classList.add('square-preview');
      body.classList.remove('native-preview');
      body.style.minHeight = '';
      body.style.aspectRatio = '';
    }
  }

  clearSegTimer();
  currentSegmentIndex = idx;
  const seg = currentSegments[idx];
  // Normalize type at play time — old docs sometimes stored video as photo
  if(seg && (seg.videoUrl || seg.mediaUrl) && seg.type !== 'video' && seg.type !== 'text' && seg.type !== 'avatar'){
    seg.type = 'video';
  }
  const animClass = idx===0 ? '' : transitionClassFor(seg.transitionIn, direction);
  $('bviewerTime').textContent = seg.type==='avatar' ? seg.time : timeAgo(seg.createdAt);

  const captionHtml = seg.caption
    ? `<div style="position:absolute; bottom:56px; left:20px; right:20px; color:#fff; font-size:14px; text-align:center; z-index:2;">${escapeHtml(seg.caption)}</div>`
    : '';
  const cropT = cropTransform(seg.crop);
  let bodyHtml, durationMs;
  if(seg.type==='avatar'){
    bodyHtml = `<div class="avatar ${animClass}" style="width:140px;height:140px;font-size:44px;background:${seg.color};">${seg.initials}</div>`;
    durationMs = 4000;
  } else if(seg.type==='text'){
    bodyHtml = `<div class="bviewer-text-card ${animClass}" style="background:${seg.bg}; border-radius:20px; width:100%; height:100%;">${escapeHtml(seg.text)}</div>`;
    durationMs = 4000;
  } else if(seg.type==='video' || isVideoSeg){
    const videoSrc = signalPlaySrc(seg);
    const safeSrc = String(videoSrc || '').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;');
    const posterAttr = seg.thumbDataUrl
      ? ` poster="${String(seg.thumbDataUrl).replace(/"/g,'&quot;')}"`
      : '';
    // relative (not absolute) so flex parent keeps real height; contain so landscape is full frame
    bodyHtml = `<video id="bviewerActiveVideo" class="${animClass}" src="${safeSrc}" preload="auto" playsinline webkit-playsinline muted${posterAttr} style="filter:${seg.filterCss || ''}; display:block; width:100%; height:100%; max-height:78vh; object-fit:contain; background:#000; border-radius:12px;"></video>${captionHtml}<div class="cam-expand-btn" id="bviewerMuteToggle" style="right:auto; left:14px; top:14px; z-index:3;" role="button" aria-label="Toggle sound"></div><button type="button" id="bviewerPlayKick" style="display:none;position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);z-index:5;width:64px;height:64px;border-radius:50%;border:none;background:rgba(124,255,178,.92);color:#0D0F17;font-size:22px;box-shadow:0 8px 28px rgba(0,0,0,.45);cursor:pointer;" aria-label="Play">▶</button>`;
    durationMs = Math.round((isFinite(seg.duration) && seg.duration > 0 ? seg.duration : 15) * 1000);
  } else {
    const imgSrc = signalPlaySrc(seg);
    const safeImg = String(imgSrc || '').replace(/&/g,'&amp;').replace(/"/g,'&quot;');
    bodyHtml = `<img class="${animClass}" src="${safeImg}" style="filter:${seg.filterCss || ''}; position:absolute; top:50%; left:50%; width:100%; height:100%; object-fit:cover; transform:${cropT || 'translate(-50%,-50%)'}; border-radius:16px;" />${captionHtml}`;
    durationMs = 4000;
  }
  $('bviewerBody').innerHTML = bodyHtml;
  updateBars(idx, durationMs);

  if(seg.type==='video' || isVideoSeg){
    const v = $('bviewerActiveVideo');
    const videoSrc = signalPlaySrc(seg);
    const trimStart = (isFinite(seg.trimStart) && seg.trimStart > 0) ? seg.trimStart : 0;
    const trimEnd = (isFinite(seg.trimEnd) && seg.trimEnd > trimStart) ? seg.trimEnd : 0;
    let playedOnce = false;
    let advanceArmed = false;
    const kickBtn = $('bviewerPlayKick');

    const armAdvance = function(ms){
      if(advanceArmed) return;
      advanceArmed = true;
      const wait = Math.max(1200, ms || durationMs || 15000);
      segTimer = setTimeout(function(){ goToSegment(idx + 1); }, wait);
    };

    const showKick = function(on){
      if(kickBtn) kickBtn.style.display = on ? 'block' : 'none';
    };

    v.onended = function(){
      const d = v.duration;
      const t = v.currentTime || 0;
      const falseEnd = (typeof nalunoFiniteDuration === 'function')
        ? (!nalunoFiniteDuration(d) || t < d - 0.45)
        : (!isFinite(d) || t < (d || 0) - 0.45);
      if(falseEnd){
        try{ v.preload = 'auto'; v.currentTime = Math.max(0, t + 0.001); }catch(_){}
        v.play().catch(function(){});
        return;
      }
      clearSegTimer();
      goToSegment(idx + 1);
    };
    currentVideoEl = v;
    v.ontimeupdate = function(){
      if(!playedOnce && (v.currentTime || 0) > 0.05){
        playedOnce = true;
        showKick(false);
        try{ if(v.poster) v.removeAttribute('poster'); }catch(_){}
      }
      if(trimEnd && (v.currentTime || 0) >= trimEnd - 0.05){
        v.ontimeupdate = null;
        clearSegTimer();
        goToSegment(idx + 1);
      }
    };

    const kickPlay = function(){
      if(!v) return;
      try{ v.muted = true; }catch(_){}
      const p = v.play();
      if(p && p.then){
        p.then(function(){
          playedOnce = true;
          showKick(false);
          requestAnimationFrame(function(){
            try{ v.muted = false; }catch(_){}
            renderMuteIcon(false);
          });
        }).catch(function(){
          showKick(true);
        });
      }
    };
    v.addEventListener('waiting', function(){ setTimeout(kickPlay, 300); });
    v.addEventListener('stalled', kickPlay);
    v.addEventListener('suspend', function(){
      if(!playedOnce) setTimeout(kickPlay, 400);
    });

    // Prefer bindMediaElement for recovery + vault; always keep preload=auto
    if(typeof bindMediaElement === 'function' && videoSrc) bindMediaElement(v, videoSrc);
    else if(typeof attachPlaybackGuard === 'function') attachPlaybackGuard(v, videoSrc);
    try{ v.preload = 'auto'; }catch(_){}
    try{ if(typeof containMediaElement === 'function') containMediaElement(v); }catch(_){}
    try{ if(typeof lockOutChromeMediaSession === 'function') lockOutChromeMediaSession(); }catch(_){}

    const muteBtn = $('bviewerMuteToggle');
    const renderMuteIcon = function(muted){
      if(!muteBtn) return;
      muteBtn.innerHTML = muted
        ? `<svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M3 10v4h4l5 5V5L7 10H3z" fill="currentColor"/><path d="M16 9l6 6M22 9l-6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`
        : `<svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M3 10v4h4l5 5V5L7 10H3z" fill="currentColor"/><path d="M16 8a5 5 0 010 8M19 5a9 9 0 010 14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;
    };

    const startPlayback = function(){
      renderMuteIcon(true);
      v.muted = true;
      const onPlaying = function(){
        v.removeEventListener('playing', onPlaying);
        playedOnce = true;
        showKick(false);
        try{ if(v.poster) v.removeAttribute('poster'); }catch(_){}
        requestAnimationFrame(function(){
          try{ v.muted = false; }catch(_){}
          renderMuteIcon(false);
        });
        const d = trimEnd ? (trimEnd - trimStart) : v.duration;
        if(isFinite(d) && d > 0){
          durationMs = Math.round(d * 1000);
          updateBars(idx, durationMs);
          clearSegTimer();
          advanceArmed = false;
          armAdvance(durationMs + 800);
        }
        try{ if(typeof lockOutChromeMediaSession === 'function') lockOutChromeMediaSession(); }catch(_){}
      };
      v.addEventListener('playing', onPlaying);
      try{ v.load(); }catch(_){}
      v.play().catch(function(){
        v.removeEventListener('playing', onPlaying);
        v.muted = true;
        renderMuteIcon(true);
        v.play().catch(function(){
          // Last resort: download to blob URL then play (Samsung Range/HEVC hang)
          signalEnsurePlayableSrc(v, videoSrc).then(function(ok){
            if(ok){
              v.muted = true;
              v.play().then(function(){
                playedOnce = true;
                showKick(false);
                requestAnimationFrame(function(){ try{ v.muted = false; }catch(_){} renderMuteIcon(false); });
              }).catch(function(){ showKick(true); });
            } else {
              showKick(true);
            }
          });
        });
      });
    };

    const applyRealLength = function(){
      if(trimStart && Math.abs((v.currentTime || 0) - trimStart) > 0.2){
        try{ v.currentTime = trimStart; }catch(_){}
      }
      const d = trimEnd ? (trimEnd - trimStart) : v.duration;
      if(isFinite(d) && d > 0){
        durationMs = Math.round(d * 1000);
        updateBars(idx, durationMs);
        try{ seg.duration = d; }catch(_){}
      }
      if(body && v.videoWidth > 0 && v.videoHeight > 0){
        body.style.aspectRatio = v.videoWidth + ' / ' + v.videoHeight;
        // Landscape + phone landscape → claim almost the full screen
        let orientL = false;
        try{
          if(screen.orientation && screen.orientation.type)
            orientL = String(screen.orientation.type).indexOf('landscape') >= 0;
          else orientL = window.innerWidth > window.innerHeight;
        }catch(_){}
        const isLand = v.videoWidth >= v.videoHeight;
        if(orientL && isLand){
          body.style.maxHeight = 'min(96vh, 100dvh)';
          body.style.width = '100%';
          try{
            const app = document.querySelector('.app');
            if(app) app.classList.add('naluno-landscape-media');
            document.body.classList.add('naluno-landscape-media');
          }catch(_){}
        } else {
          body.style.maxHeight = 'min(78vh, 720px)';
          body.style.width = '100%';
          try{
            document.body.classList.remove('naluno-landscape-media');
            const app = document.querySelector('.app');
            if(app) app.classList.remove('naluno-landscape-media');
          }catch(_){}
        }
      }
    };
    v.addEventListener('loadedmetadata', applyRealLength);
    if(v.readyState >= 1) applyRealLength();

    // Start NOW — opening the story is a user gesture; delayed play loses it on Samsung
    startPlayback();
    setTimeout(function(){ if(v.paused) startPlayback(); }, 500);
    // Progressive HEVC/non-faststart often never advances — pull full blob once
    setTimeout(function(){
      if(playedOnce || !v.paused) return;
      signalEnsurePlayableSrc(v, videoSrc).then(function(ok){
        if(ok) startPlayback();
        else showKick(true);
      });
    }, 900);
    setTimeout(function(){ if(v.paused && !playedOnce){ startPlayback(); showKick(true); } }, 2000);
    setTimeout(function(){ if(v.paused) showKick(true); }, 3200);

    armAdvance(durationMs > 0 ? durationMs + 2500 : 18000);

    if(kickBtn){
      kickBtn.onclick = function(e){
        e.preventDefault();
        e.stopPropagation();
        startPlayback();
        setTimeout(function(){ if(!v.paused) showKick(false); }, 200);
      };
    }
    if(muteBtn){
      muteBtn.onclick = function(){
        v.muted = !v.muted;
        renderMuteIcon(v.muted);
        if(!v.muted) v.play().catch(function(){});
      };
    }
  } else {
    segTimer = setTimeout(function(){ goToSegment(idx + 1); }, durationMs);
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
    // Normalize: anything with a real videoUrl must play as video (not a still photo).
    if(seg && !seg.type && (seg.videoUrl || seg.mediaUrl)){
      seg.type = 'video';
    }
    if(seg && seg.type === 'photo' && seg.videoUrl){
      seg.type = 'video';
    }
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
function closeBroadcast(){
  clearSegTimer();
  try{ currentVideoEl && currentVideoEl.pause(); }catch(_){}
  currentVideoEl = null;
  $('bviewer').classList.remove('active');
  try{
    document.body.classList.remove('naluno-landscape-media');
    const app = document.querySelector('.app');
    if(app) app.classList.remove('naluno-landscape-media');
  }catch(_){}
  try{ if(typeof lockOutChromeMediaSession === 'function') lockOutChromeMediaSession(); }catch(_){}
}
$('bviewerClose').onclick = closeBroadcast;
function deleteCurrentSignalClip(){
  if(!viewingMine){
    toast('You can only delete your own Signal');
    return;
  }
  const seg = currentSegments[currentSegmentIndex];
  if(!seg){ toast('Nothing to delete'); return; }
  if(!confirm('Delete this Signal now? It will disappear immediately.')) return;
  const segId = seg.id;
  mySignal = (mySignal || []).filter(s => s.id !== segId);
  currentSegments = currentSegments.filter(s => s.id !== segId);
  try{
    if(currentUser && fbDb && typeof deleteSignalSegment === 'function'){
      deleteSignalSegment(segId);
    } else if(typeof saveSignalToStorage === 'function'){
      saveSignalToStorage();
    }
  }catch(e){ console.warn('[signal] delete', e); }
  if(typeof renderBroadcasts === 'function') renderBroadcasts();
  if(typeof renderBroadcastTab === 'function') renderBroadcastTab();
  if(currentSegments.length === 0){
    if(typeof closeBroadcast === 'function') closeBroadcast();
    toast('Signal deleted');
    return;
  }
  currentSegmentIndex = Math.min(currentSegmentIndex, currentSegments.length - 1);
  if(typeof renderBars === 'function') renderBars(currentSegments.length);
  if(typeof playSegment === 'function') playSegment(currentSegmentIndex);
  toast('Signal deleted');
}
if($('bviewerRemove')){
  $('bviewerRemove').onclick = function(e){
    if(e){ e.preventDefault(); e.stopPropagation(); }
    deleteCurrentSignalClip();
  };
}


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



/* ---- Signal story viewer (ephemeral) — separate from permanent Broadcast space ---- */
function openMySignalStory(){
  if(typeof pruneExpiredSignal === 'function') pruneExpiredSignal();
  if(!mySignal || !mySignal.length){
    toast('No active Signal — post one with + New Signal');
    if(typeof openComposer === 'function') openComposer('signal');
    return;
  }
  viewingMine = true;
  currentSegments = typeof sortSignalSegments === 'function' ? sortSignalSegments(mySignal.slice()) : mySignal.slice();
  currentSegmentIndex = 0;
  if($('bviewerName')) $('bviewerName').textContent = (currentProfile && currentProfile.name) || 'You';
  if($('bviewerRemove')){
    $('bviewerRemove').style.display = 'inline-flex';
    $('bviewerRemove').textContent = 'Delete';
  }
  if($('bviewerMessage')) $('bviewerMessage').style.display = 'none';
  if($('bviewerStatus')) $('bviewerStatus').style.display = 'none';
  $('bviewer').classList.add('active');
  if(typeof renderBars === 'function') renderBars(currentSegments.length);
  currentSegments.forEach(function(seg){ signalPlaySrc(seg); });
  signalRememberView('me', currentSegments);
  if(typeof playSegment === 'function') playSegment(0);
  mySignalSeen = true;
  if(typeof renderBroadcastTab === 'function') renderBroadcastTab();
}

async function openContactSignalStory(contactId){
  viewingMine = false;
  const entry = (connectionsSignals||[]).find(x => x.contact && x.contact.id === contactId);
  if(!entry){ toast('No Signal'); return; }
  // Load full signal list for contact
  let segments = [entry.latest];
  if(fbDb && entry.contact.firebaseUid){
    try{
      const snap = await fbDb.collection('users').doc(entry.contact.firebaseUid).collection('signal').orderBy('createdAt','asc').get();
      segments = sortSignalSegments(snap.docs.map(d=>({ id:d.id, ...d.data() })).filter(s => Date.now() < s.expiresAt));
    }catch(_){}
  }
  if(!segments.length){
    const cached = nalunoCacheRead('signalView:' + (entry.contact.firebaseUid || contactId));
    if(cached && cached.length) segments = cached;
  }
  if(!segments.length){ toast('Signal expired'); return; }
  currentSegments = segments;
  currentSegments.forEach(function(seg){ signalPlaySrc(seg); });
  signalRememberView(entry.contact.firebaseUid || contactId, currentSegments);
  currentSegmentIndex = 0;
  $('bviewerName').textContent = entry.contact.name || 'Signal';
  $('bviewerAvatar').textContent = entry.contact.initials || '?';
  $('bviewerAvatar').style.background = entry.contact.color || '#7CFFB2';
  $('bviewer').classList.add('active');
  playSegment(0);
}

// Keep legacy names pointing at Signal story for any old callers
function openMyBroadcast(){ openMySignalStory(); }


/* Search Broadcasts */
(function wireBcastSearch(){
  const input = $('bcastSearchInput');
  const host = $('bcastSearchResults');
  if(!input || !host) return;
  let timer = null;
  input.addEventListener('input', ()=>{
    clearTimeout(timer);
    timer = setTimeout(async ()=>{
      const q = input.value.trim();
      if(!q){ host.style.display = 'none'; host.innerHTML = ''; return; }
      host.style.display = 'block';
      host.innerHTML = `<div style="padding:8px;color:var(--text-dim);font-size:12px;">Searching…</div>`;
      const results = await searchBroadcasts(q);
      if(!results.length){
        host.innerHTML = `<div style="padding:12px;color:var(--text-dim);font-size:13px;">No Broadcasts match “${escapeHtml(q)}”</div>`;
        return;
      }
      host.innerHTML = `<div class="bcast-plate-grid">${results.slice(0,12).map(b => broadcastThumbHtml(b)).join('')}</div>`;
      host.querySelectorAll('[data-broadcast-id]').forEach(el=>{
        el.onclick = ()=> openBroadcastById(el.dataset.broadcastId);
      });
    }, 280);
  });
})();


function toggleSignalAspect(){
  const body = $('bviewerBody');
  if(!body) return;
  const native = body.classList.toggle('native-preview');
  body.classList.toggle('square-preview', !native);
  toast(native ? 'Full frame' : '1:1 preview');
}
if($('bviewerBody')){
  $('bviewerBody').addEventListener('dblclick', toggleSignalAspect);
}


// Legacy name: signal rings open the ephemeral story, not permanent Broadcast space
if(typeof openContactSignalStory === 'function'){
  window.openBroadcast = function(contactId){ return openContactSignalStory(contactId); };
}


/* Signal tab shortcut → same Broadcast gateway, live-first */
function openGoLiveFromSignal(){
  if(typeof bcompOpen === 'function'){
    bcompOpen();
    // Prefill title if empty
    try{
      if($('bcompTitle') && !$('bcompTitle').value){
        $('bcompTitle').value = 'Live · ' + new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});
      }
      if($('bcompGoLiveBtn')){
        $('bcompGoLiveBtn').scrollIntoView({ block: 'nearest' });
      }
    }catch(_){}
    toast('Add a title, then tap Go live');
  } else if(typeof bcompStartGoLive === 'function'){
    bcompStartGoLive();
  } else {
    toast('Broadcast tools still loading');
  }
}
