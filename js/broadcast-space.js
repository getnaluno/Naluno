/* OWNERSHIP (broadcast-space.js): Broadcast VOD/live community only.
   MUST NOT touch: calls peerConnection, remoteCombinedStream, bandMeshPcs.
   ICE for live: getIceServers() from ice-core. Playback: <video src> only. */
/* ============================================================
   MODULE: js/broadcast-space.js
   Broadcast = living community, not a video player.
   Video is the first message; conversation, questions, results,
   resources, and journey make it valuable.
   OWNERSHIP: Broadcast Space UI + Firestore community data.
   ============================================================ */

let activeBroadcastId = null;
let activeBroadcastMeta = null; // { contactId?, isMine, creatorUid, title, ... }
let bspaceUnsubs = [];

function bspaceClearListeners(){
  bspaceUnsubs.forEach(u=>{ try{ u(); }catch(e){} });
  bspaceUnsubs = [];
}

function bspaceEscape(s){
  return escapeHtml(String(s == null ? '' : s));
}

function bspaceWhoLabel(uid){
  if(!uid) return 'Someone';
  if(currentUser && uid === currentUser.uid) return 'You';
  const c = contacts.find(x => x.firebaseUid === uid);
  if(c) return (c.name || 'Someone').split(' ')[0];
  if(activeBroadcastMeta && activeBroadcastMeta.creatorUid === uid){
    return (activeBroadcastMeta.creatorName || 'Creator').split(' ')[0];
  }
  return 'Member';
}

function ensureBroadcastDocId(meta){
  if(meta.broadcastId) return meta.broadcastId;
  // Legacy fallback for old signal-linked spaces
  if(meta.isMine && meta.segment && meta.segment.id) return 'sig_' + meta.segment.id;
  if(meta.contactId != null && meta.segment && meta.segment.createdAt){
    return 'c' + meta.contactId + '_' + meta.segment.createdAt;
  }
  return 'local_' + Date.now();
}

async function ensureBroadcastFirestore(meta){
  if(!fbDb || !currentUser) return null;
  const id = ensureBroadcastDocId(meta);
  const ref = fbDb.collection('broadcasts').doc(id);
  const snap = await ref.get();
  if(meta.broadcastId && snap.exists) return id;
  if(!snap.exists){
    const seg = meta.segment || {};
    await ref.set({
      creatorUid: meta.creatorUid || currentUser.uid,
      creatorName: meta.creatorName || (currentProfile && currentProfile.name) || 'Someone',
      title: meta.title || (seg.text ? String(seg.text).slice(0, 80) : 'Broadcast'),
      description: meta.description || (seg.caption || seg.text || ''),
      tags: meta.tags || [],
      mediaType: seg.type || 'photo',
      mediaUrl: seg.videoUrl || seg.dataUrl || null,
      thumb: seg.thumbDataUrl || null,
      filterCss: seg.filterCss || '',
      bg: seg.bg || null,
      createdAt: seg.createdAt || Date.now(),
      updatedAt: Date.now(),
      memberUids: [meta.creatorUid || currentUser.uid],
      source: meta.isMine ? 'signal_self' : 'signal_contact',
    }, { merge:true });
    // Journey seed
    await ref.collection('journey').add({
      type: 'created',
      text: 'Broadcast opened',
      ts: Date.now(),
      by: meta.creatorUid || currentUser.uid,
    });
  }
  return id;
}

function renderBspaceMedia(seg){
  const host = $('bspaceMedia');
  if(!host) return;
  if(!seg){
    host.innerHTML = `<div class="bspace-hero-text" style="color:var(--text-dim);">No media</div>`;
    return;
  }
  if(seg.type === 'text'){
    host.innerHTML = `<div class="bspace-hero-text" style="background:${seg.bg || 'var(--surface)'};">${bspaceEscape(seg.text || '')}</div>`;
    return;
  }
  if(seg.type === 'video'){
    const chapters = (activeBroadcastMeta && activeBroadcastMeta.chapters) || seg.chapters || null;
    const breathers = (activeBroadcastMeta && activeBroadcastMeta.breathers) || [];
    let rawSrc = '';
    if(typeof legacyBroadcastPlayUrl === 'function'){
      rawSrc = legacyBroadcastPlayUrl(Object.assign({}, seg, { chapters: chapters, mediaUrl: seg.mediaUrl || seg.videoUrl }));
    }
    if(!rawSrc) rawSrc = seg.videoUrl || seg.mediaUrl || seg.dataUrl || (chapters && chapters[0] && chapters[0].mediaUrl) || '';
    const playUrls = (typeof nalunoPlayCandidates === 'function') ? nalunoPlayCandidates(rawSrc, { bucket: 'broadcast' }) : [rawSrc];
    rawSrc = playUrls[0] || rawSrc;
    const mediaId = (typeof nalunoMediaIdFromUrl === 'function') ? nalunoMediaIdFromUrl(rawSrc) : '';
    const bcastId = activeBroadcastId || (activeBroadcastMeta && (activeBroadcastMeta.broadcastId || activeBroadcastMeta.id)) || null;
    let vel = $('bspaceVideoEl');
    const existingId = vel && vel.dataset && vel.dataset.mediaId;
    const canReuse = !!(vel && mediaId && existingId && existingId === mediaId &&
      host.contains(vel) && (vel.readyState >= 1 || !vel.paused));
    // Visible chapter chips only when real chapters (not silent upload parts)
    const showChapters = chapters && chapters.length > 1 && !chapters.every(c => c.silent);
    if(!canReuse){
    host.innerHTML = `
      <div class="bspace-media-frame" style="position:relative;width:100%;height:100%;background:#000;overflow:hidden;min-height:180px;">
        <video id="bspaceVideoEl" playsinline webkit-playsinline preload="auto" poster="${seg.thumbDataUrl ? bspaceEscape(seg.thumbDataUrl) : ''}" style="width:100%;height:100%;object-fit:cover;display:block;background:#000;filter:${seg.filterCss || ''}"></video>
        <button type="button" id="bspacePlayKick" aria-label="Play" style="position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);z-index:6;width:64px;height:64px;border-radius:50%;border:none;background:rgba(124,255,178,.92);color:#0D0F17;font-size:22px;box-shadow:0 8px 28px rgba(0,0,0,.45);cursor:pointer;">▶</button>
        <div id="bspaceBreather" style="display:none;position:absolute;inset:0;background:rgba(13,15,23,.92);align-items:center;justify-content:center;flex-direction:column;gap:10px;z-index:3;">
          <div style="font-family:var(--font-futuristic);font-size:15px;color:var(--mint);" id="bspaceBreatherLabel">Chapter break</div>
          <div style="font-family:var(--font-mono);font-size:11px;color:var(--text-dim);" id="bspaceBreatherAd">Next chapter in a moment</div>
          <button type="button" id="bspaceReplaceChBtn" style="display:none;margin-top:8px;padding:8px 14px;border-radius:999px;border:1px solid var(--line);background:rgba(124,255,178,.12);color:var(--mint);font-family:var(--font-mono);font-size:12px;">Replace chapter</button>
        </div>
      </div>
      `;
    vel = $('bspaceVideoEl');
    if(vel && typeof bindMediaElement === 'function') bindMediaElement(vel, rawSrc, { broadcastId: bcastId, kind: 'broadcast' });
    else if(vel){ vel.preload = 'auto'; vel.src = rawSrc; }
    if(vel && mediaId) vel.dataset.mediaId = mediaId;
    if(vel && bcastId) vel.dataset.broadcastId = bcastId;
    } else {
      if(vel && typeof bindMediaElement === 'function'){
        bindMediaElement(vel, rawSrc, { broadcastId: bcastId, kind: 'broadcast' });
      }
    }
    // Dock seek bar BELOW the 9:16 hero (sibling), not inside cover frame
    try{
      const hero = $('bspaceHero');
      let dock = $('bspaceSeekDock');
      if(!canReuse && dock) dock.remove();
      if(canReuse && dock){
        /* keep playing dock */
      } else {
      dock = document.createElement('div');
      dock.id = 'bspaceSeekDock';
      dock.className = 'bspace-seek-dock';
      dock.innerHTML = `
        <button type="button" id="bspacePlayBtn" aria-label="Play/Pause" style="flex-shrink:0;width:36px;height:36px;border-radius:50%;border:1px solid var(--line);background:rgba(124,255,178,.12);color:var(--mint);font-size:14px;cursor:pointer;">▶</button>
        <span id="bspaceTimeCur" style="font-family:var(--font-mono);font-size:11px;color:var(--text-dim);min-width:40px;">0:00</span>
        <input type="range" id="bspaceSeekRange" min="0" max="1000" value="0" step="1" style="flex:1;height:28px;accent-color:var(--mint);cursor:pointer;" />
        <span id="bspaceTimeDur" style="font-family:var(--font-mono);font-size:11px;color:var(--text-dim);min-width:40px;text-align:right;">0:00</span>`;
      if(hero && hero.parentNode){
        if(hero.nextSibling) hero.parentNode.insertBefore(dock, hero.nextSibling);
        else hero.parentNode.appendChild(dock);
      }
      }
    }catch(e){ console.warn('[bspace] seek dock', e); }
    if(!canReuse){
      try{ wireBspaceSeekAndAutoplay(vel); }catch(e){ console.warn('[bspace] seek wire', e); }
    }
    if(seg.thumbDataUrl && typeof nalunoProbePosterAR === 'function') nalunoProbePosterAR(seg.thumbDataUrl);
    if(vel && !canReuse){
      const kick = $('bspacePlayKick');
      const hideKick = function(){ if(kick) kick.style.display = 'none'; };
      const showKick = function(){ if(kick) kick.style.display = 'block'; };
      const tryPlay = function(){
        try{ if(typeof nalunoExclusiveMedia === 'function') nalunoExclusiveMedia(vel); }catch(_){}
        try{
          vel.dataset.nalunoWantPlay = '1';
          vel.dataset.nalunoKeepAlive = '1';
          vel.dataset.nalunoUserPaused = '0';
        }catch(_){}
        try{ vel.muted = true; }catch(_){}
        const p = vel.play();
        if(p && p.then){
          p.then(function(){
            hideKick();
            requestAnimationFrame(function(){ try{ vel.muted = false; }catch(_){} });
          }).catch(function(){
            try{ vel.muted = true; }catch(_){}
            vel.play().then(hideKick).catch(function(){ showKick(); });
          });
        }
      };
      if(kick) kick.onclick = function(e){ e.preventDefault(); e.stopPropagation(); tryPlay(); };
      vel.addEventListener('click', function(e){
        e.preventDefault();
        e.stopPropagation();
        if(vel.paused) tryPlay();
        else {
          try{ vel.dataset.nalunoUserPaused = '1'; vel.dataset.nalunoWantPlay = '0'; }catch(_){}
          vel.pause();
        }
      });
      vel.addEventListener('playing', function(){
        hideKick();
        try{
          vel.dataset.nalunoWantPlay = '1';
          vel.dataset.nalunoKeepAlive = '1';
          vel.dataset.nalunoUserPaused = '0';
        }catch(_){}
        try{ if(vel.poster) vel.removeAttribute('poster'); }catch(_){}
        try{ adaptBspaceHeroToVideo(); }catch(_){}
      });
      vel.addEventListener('pause', function(){
        if(vel.ended) return;
        showKick();
      });
      vel.addEventListener('error', function(){
        const code = vel.error && vel.error.code;
        if(code === 1) return;
        console.warn('[bspace] video error', code, vel.src);
        // Broadcast stays on Worker URL (no vault, no full-file blob pull for long media).
        if(!vel.dataset.retried && rawSrc){
          vel.dataset.retried = '1';
          try{
            const fixed = (typeof resolveMediaUrl === 'function') ? resolveMediaUrl(rawSrc) : rawSrc;
            const base = fixed || rawSrc;
            vel.src = base + (base.indexOf('?') >= 0 ? '&' : '?') + 'r=' + Date.now();
            tryPlay();
            return;
          }catch(_){}
          try{
            vel.src = rawSrc + (rawSrc.indexOf('?') >= 0 ? '&' : '?') + 'r=' + Date.now();
            vel.play().catch(function(){});
          }catch(_){}
        } else {
          showKick();
        }
      });
      // Want-play from the first gesture so foreground resume + watchdog can re-kick.
      try{
        vel.dataset.nalunoWantPlay = '1';
        vel.dataset.nalunoKeepAlive = '1';
      }catch(_){}
      setTimeout(function(){ if(vel.paused && vel.dataset.nalunoUserPaused !== '1') tryPlay(); }, 120);
      // Soft network nudge only — do not full-fetch Broadcast into a blob.
      setTimeout(function(){
        if(vel.paused && vel.dataset.nalunoUserPaused !== '1' && rawSrc && !/^blob:/i.test(String(vel.src||''))){
          try{
            const fixed = (typeof resolveMediaUrl === 'function') ? resolveMediaUrl(rawSrc) : rawSrc;
            if(fixed && String(vel.src||'').split('?')[0] !== String(fixed).split('?')[0]){
              vel.src = fixed;
            }
            tryPlay();
          }catch(_){}
        }
      }, 900);
      setTimeout(function(){ if(vel.paused) showKick(); }, 1600);
    }
    try{
      if(vel){
        vel.disableRemotePlayback = true;
        vel.removeAttribute('controls');
        if(navigator.mediaSession){
          try{ navigator.mediaSession.metadata = null; }catch(_){}
        }
      }
    }catch(_){}
    let barHost = document.getElementById('bspaceChapterHost');
    if(!barHost){
      const title = $('bspaceTitle');
      if(title && title.parentNode){
        barHost = document.createElement('div');
        barHost.id = 'bspaceChapterHost';
        title.parentNode.insertBefore(barHost, title);
      }
    }
    if(barHost){
      barHost.innerHTML = showChapters ? '<div id="bspaceChapterBar" class="bspace-chapter-bar"></div>' : '';
    }
    wireBroadcastChapterPlayer(showChapters ? chapters : (chapters && chapters.length ? chapters : null), breathers, { showChips: !!showChapters });
    try{ adaptBspaceHeroToVideo(); }catch(_){}
    return;
  }
  // photo
  host.innerHTML = `<img src="${bspaceEscape(seg.dataUrl || '')}" alt="" style="filter:${seg.filterCss || ''}" />`;
}

function setBspaceTab(name){
  document.querySelectorAll('#bspaceTabs .bspace-tab').forEach(t=>{
    t.classList.toggle('on', t.dataset.bspan === name);
  });
  ['conversation','questions','results','resources','journey','updates'].forEach(n=>{
    const p = $('bspan-' + n);
    if(p) p.style.display = n === name ? 'block' : 'none';
  });
}

function renderBspaceConversation(docs){
  const el = $('bspaceConversation');
  if(!el) return;

  // Ensure pin host sits above the feed (once)
  let pin = $('bspaceLivePin');
  if(!pin){
    pin = document.createElement('div');
    pin.id = 'bspaceLivePin';
    pin.style.cssText = 'display:none;margin:0 0 12px;';
    el.parentNode.insertBefore(pin, el);
  }

  const isLiveSystem = (m)=>{
    if(!m) return false;
    if(m.kind === 'went_live' || m.kind === 'was_live') return true;
    if(m.type === 'live') return true;
    const t = (m.text || '').toLowerCase();
    return /\b(is live now|was live|went live|join live)\b/.test(t);
  };
  const reallyLived = !!(activeBroadcastMeta && (
    activeBroadcastMeta.live ||
    (activeBroadcastMeta.lastLiveStartedAt && activeBroadcastMeta.lastLiveDurationMs)
  ));

  const pinned = [];
  const rest = [];
  (docs || []).forEach(d=>{
    const m = d.data ? d.data() : d;
    if(isLiveSystem(m)) pinned.push({ d, m });
    else rest.push({ d, m });
  });

  // Newest live notice only (top of conversation, not buried).
  // Regular uploaded videos must not inherit a "Was live" pin.
  if(pinned.length && reallyLived){
    pinned.sort((a,b)=> (b.m.ts||0) - (a.m.ts||0));
    const latest = pinned[0].m;
    const stillLive = !!(activeBroadcastMeta && activeBroadcastMeta.live) ||
      /is live now|join live/i.test(String(latest.text || ''));
    const past = /was live|ended|recording saved/i.test(String(latest.text || ''));
    const label = (stillLive && !past) ? '● LIVE' : '● WAS LIVE';
    const fallbackText = (stillLive && !past)
      ? 'Creator is live now — join to watch'
      : 'Creator was live';
    // FIX: "MAGAMBO is live now" / "MAGAMBO was live" read in third person
    // even when MAGAMBO is the one looking at their own broadcast — the
    // stored text is fixed at write time and can't know who'll read it
    // later. When this device belongs to whoever the message is from,
    // reconstruct it addressed to "You" instead of falling back to the
    // stored, name-baked text. Only applies to messages tagged with the new
    // kind field — older messages (before this fix) still show their
    // original stored text, unchanged.
    const isMine = !!(currentUser && latest.from === currentUser.uid);
    let displayText = latest.text || fallbackText;
    if(isMine && latest.kind === 'went_live'){
      displayText = 'You\u2019re live now — you can watch reactions come in below.';
    } else if(isMine && latest.kind === 'was_live'){
      const dur = (typeof formatLiveDuration === 'function') ? formatLiveDuration(latest.durationMs) : '';
      displayText = 'You were live' + (dur ? ' for ' + dur : '') + '.';
    }
    pin.style.display = 'block';
    pin.innerHTML = `<div class="bspace-card" style="border:1px solid rgba(124,255,178,.45);background:rgba(124,255,178,.08);">
      <div class="who" style="color:var(--mint);">${label} · ${timeAgo(latest.ts || Date.now())}</div>
      <div class="body" style="font-weight:600;">${bspaceEscape(displayText)}</div>
    </div>`;
  } else {
    pin.style.display = 'none';
    pin.innerHTML = '';
  }

  if(!rest.length && !pinned.length){
    el.innerHTML = `<div class="bspace-card"><div class="body" style="color:var(--text-dim);">No messages yet. Say hello, leave a voice note, or share a photo.</div></div>`;
    return;
  }
  if(!rest.length){
    el.innerHTML = '';
    return;
  }
  el.innerHTML = rest.map(({m})=>{
    const media = (typeof resolveMediaUrl === 'function') ? resolveMediaUrl(m.mediaUrl) : (m.mediaUrl || '');
    const isVoice = media && (m.type === 'voice' || m.type === 'audio');
    const isPhoto = media && (m.type === 'photo' || m.type === 'image');
    let body = '';
    if(isVoice){
      body = `<div style="font-family:var(--font-mono);font-size:10px;color:var(--mint);margin-bottom:6px;">Voice note</div>
        <video class="band-audio-player" controls playsinline preload="metadata" src="${bspaceEscape(media)}" style="width:100%;max-width:280px;height:44px;border-radius:8px;background:#0a0c14;"></video>`;
    } else if(isPhoto){
      body = `<img src="${bspaceEscape(media)}" alt="Photo" loading="lazy" style="max-width:100%;max-height:320px;border-radius:12px;display:block;background:#0a0c14;" onerror="this.style.display='none';this.nextElementSibling&&(this.nextElementSibling.style.display='block');" />
        <div style="display:none;color:var(--text-dim);font-size:12px;">Photo couldn’t load</div>`;
    } else if(m.text){
      body = bspaceEscape(m.text);
    } else {
      body = `<span style="color:var(--text-dim);font-size:12px;">Attachment unavailable</span>`;
    }
    return `<div class="bspace-card">
      <div class="who">${bspaceEscape(bspaceWhoLabel(m.from))} · ${timeAgo(m.ts || Date.now())}</div>
      <div class="body">${body}</div>
    </div>`;
  }).join('');
}

function renderBspaceQuestions(docs){
  const el = $('bspaceQuestions');
  if(!el) return;
  if(!docs.length){
    el.innerHTML = `<div class="bspace-card"><div class="body" style="color:var(--text-dim);">No questions yet — ask anything.</div></div>`;
    return;
  }
  el.innerHTML = docs.map(d=>{
    const m = d.data();
    const best = m.bestAnswer ? `<div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--line);"><span style="font-family:var(--font-mono);font-size:10px;color:var(--mint);">Best answer</span><div class="body">${bspaceEscape(m.bestAnswer)}</div></div>` : '';
    const mark = (activeBroadcastMeta && activeBroadcastMeta.isMine && !m.bestAnswer)
      ? `<button type="button" class="bspace-mini" data-mark-best="${d.id}" style="margin-top:8px;">Mark best from replies…</button>` : '';
    return `<div class="bspace-card" data-qid="${d.id}">
      <div class="who">${bspaceEscape(bspaceWhoLabel(m.from))} asks · ${timeAgo(m.ts || Date.now())}</div>
      <div class="body">${bspaceEscape(m.text || '')}</div>
      ${best}
      ${m.answers && m.answers.length ? m.answers.map((a,i)=>`<div style="margin-top:6px;font-size:13px;color:var(--text-dim);">↳ ${bspaceEscape(a.text)} <span style="font-family:var(--font-mono);font-size:10px;">— ${bspaceEscape(bspaceWhoLabel(a.from))}</span>${(activeBroadcastMeta && activeBroadcastMeta.isMine && !m.bestAnswer) ? ` <button type="button" class="bspace-mini bspace-mark-best" data-qid="${d.id}" data-atext="${bspaceEscape(a.text).replace(/"/g,'&quot;')}" style="margin-left:6px;">Best</button>` : ''}</div>`).join('') : ''}
      <div class="bspace-composer" style="margin-top:8px;">
        <input class="bspace-answer-input" data-qid="${d.id}" placeholder="Answer this…" maxlength="400" />
        <button type="button" class="bspace-mini primary bspace-answer-btn" data-qid="${d.id}">Answer</button>
      </div>
    </div>`;
  }).join('');
  el.querySelectorAll('.bspace-answer-btn').forEach(btn=>{
    btn.onclick = ()=> bspaceAnswerQuestion(btn.dataset.qid);
  });
  el.querySelectorAll('.bspace-mark-best').forEach(btn=>{
    btn.onclick = ()=> bspaceMarkBest(btn.dataset.qid, btn.dataset.atext || btn.getAttribute('data-atext'));
  });
}

function renderBspaceResults(docs){
  const el = $('bspaceResults');
  if(!el) return;
  if(!docs.length){
    el.innerHTML = `<div class="bspace-card"><div class="body" style="color:var(--text-dim);">When this Broadcast changes something in someone’s life, it shows up here.</div></div>`;
    return;
  }
  el.innerHTML = docs.map(d=>{
    const m = d.data();
    return `<div class="bspace-card">
      <div class="who">${bspaceEscape(bspaceWhoLabel(m.from))} · ${timeAgo(m.ts || Date.now())}</div>
      <div class="body">${bspaceEscape(m.text || '')}</div>
    </div>`;
  }).join('');
}

function renderBspaceResources(docs){
  const el = $('bspaceResources');
  if(!el) return;
  if(!docs.length){
    el.innerHTML = `<div class="bspace-card"><div class="body" style="color:var(--text-dim);">No resources attached yet.</div></div>`;
    return;
  }
  el.innerHTML = docs.map(d=>{
    const m = d.data();
    const link = m.url ? `<a href="${bspaceEscape(m.url)}" target="_blank" rel="noopener" style="color:var(--mint);word-break:break-all;">${bspaceEscape(m.title || m.url)}</a>` : bspaceEscape(m.title || 'Resource');
    return `<div class="bspace-card"><div class="who">${bspaceEscape(bspaceWhoLabel(m.from))}</div><div class="body">${link}</div></div>`;
  }).join('');
}

function renderBspaceJourney(docs){
  const el = $('bspaceJourney');
  if(!el) return;
  if(!docs.length){
    el.innerHTML = `<div class="evt">This story is just beginning.</div>`;
    return;
  }
  el.innerHTML = docs.map(d=>{
    const m = d.data();
    return `<div class="evt"><strong>${bspaceEscape(m.text || m.type || 'Update')}</strong><br><span style="font-family:var(--font-mono);font-size:10.5px;">${timeAgo(m.ts || Date.now())}</span></div>`;
  }).join('');
}

async function paintBspaceViews(meta){
  const row = $('bspaceViewRow');
  if(!row) return;
  let views = (meta && typeof meta.views === 'number') ? meta.views : 0;
  let total = 0;
  const creatorUid = meta && meta.creatorUid;
  const isOwner = !!(currentUser && creatorUid && currentUser.uid === creatorUid);
  try{
    if(fbDb && activeBroadcastId){
      const doc = await fbDb.collection('broadcasts').doc(activeBroadcastId).get();
      if(doc.exists){
        const d = doc.data() || {};
        views = (typeof d.views === 'number') ? d.views : views;
        if(activeBroadcastMeta){
          activeBroadcastMeta.strandId = d.strandId || activeBroadcastMeta.strandId;
          activeBroadcastMeta.strandName = d.strandName || activeBroadcastMeta.strandName;
          activeBroadcastMeta.views = views;
        }
      }
    }
    // Total across every Broadcast of this creator — creator-only.
    if(isOwner && fbDb && creatorUid){
      try{
        const t = await fbDb.collection('toga').doc(creatorUid).get();
        if(t.exists && typeof (t.data() || {}).viewsTotal === 'number'){
          // Floored at zero: increment(-n) has no server-side clamp, so a
          // total that went negative from historical deletions (before the
          // delete-time adjustment existed) must never render as a negative
          // view count.
          total = Math.max(0, (t.data() || {}).viewsTotal || 0);
        } else {
          const mine = ((typeof feedBroadcasts !== 'undefined' && feedBroadcasts) || []).filter(function(x){ return x.creatorUid === creatorUid; });
          total = mine.reduce(function(n, x){ return n + (Number(x.views) || 0); }, 0);
          if(!total) total = views;
        }
      }catch(_){
        total = views;
      }
    }
  }catch(_){}
  const fmt = (typeof formatNalunoViews === 'function') ? formatNalunoViews : String;
  const strand = (activeBroadcastMeta && activeBroadcastMeta.strandName) || '';
  row.style.display = 'grid';
  let html = ''
    + '<div class="bspace-stat-card">'
    +   '<div class="bspace-stat-k">This Broadcast</div>'
    +   '<div class="bspace-stat-v">' + fmt(views) + '</div>'
    +   '<div class="bspace-stat-h">views on this room</div>'
    + '</div>';
  if(isOwner){
    html += ''
      + '<div class="bspace-stat-card bspace-stat-card--mine">'
      +   '<div class="bspace-stat-k">All of yours</div>'
      +   '<div class="bspace-stat-v">' + fmt(total) + '</div>'
      +   '<div class="bspace-stat-h">' + (strand ? ('Every Broadcast · ' + bspaceEscape(strand) + ' + rest') : 'Every Broadcast you have published') + '</div>'
      + '</div>';
  }
  row.innerHTML = html;
}

function renderBspaceRelated(){
  const el = $('bspaceRelated');
  if(!el) return;
  const b = Object.assign({}, activeBroadcastMeta || {}, {
    id: activeBroadcastId,
    strandId: (activeBroadcastMeta && activeBroadcastMeta.strandId) || null,
    strandName: (activeBroadcastMeta && activeBroadcastMeta.strandName) || null,
    creatorUid: activeBroadcastMeta && activeBroadcastMeta.creatorUid,
    tags: (activeBroadcastMeta && activeBroadcastMeta.tags) || [],
  });
  function paint(rel){
    if(!rel || !rel.items || !rel.items.length){
      el.innerHTML = `<div class="bspace-card"><div class="body" style="color:var(--text-dim);">${bspaceEscape(rel && rel.label ? rel.label : 'Nearby Broadcasts will fill this Strand.')}</div></div>`;
      return;
    }
    const head = `<div class="hint" style="margin-bottom:8px;">${bspaceEscape(rel.label || 'Nearby')}</div>`;
    el.innerHTML = head + '<div class="nearby-strip">' + rel.items.map(function(item){
      const thumb = item.thumbUrl || item.thumb || '';
      const media = thumb
        ? '<img src="'+bspaceEscape(thumb)+'" alt="" />'
        : '<div class="nearby-fallback">'+bspaceEscape(String(item.creatorName||'?').slice(0,1).toUpperCase())+'</div>';
      return `<button type="button" class="nearby-tile" data-rel-id="${bspaceEscape(item.id)}">
        <div class="nearby-frame">${media}<span class="nearby-title">${bspaceEscape((item.title||'Broadcast').slice(0,42))}</span></div>
      </button>`;
    }).join('') + '</div>';
    el.querySelectorAll('[data-rel-id]').forEach(function(node){
      node.onclick = function(){
        const id = node.getAttribute('data-rel-id');
        if(typeof openBroadcastById === 'function') openBroadcastById(id);
      };
    });
  }
  if(typeof relatedBroadcasts === 'function'){
    relatedBroadcasts(b).then(paint).catch(function(){ paint({ items: [], label: 'Related Broadcasts' }); });
  } else {
    paint({ items: [], label: 'Related Broadcasts' });
  }
}

function listenBspaceCollection(colName, renderFn, orderField){
  if(!fbDb || !activeBroadcastId) return;
  const q = fbDb.collection('broadcasts').doc(activeBroadcastId).collection(colName).orderBy(orderField || 'ts', 'desc').limit(40);
  const unsub = q.onSnapshot(snap => renderFn(snap.docs.slice().reverse()), ()=> renderFn([]));
  bspaceUnsubs.push(unsub);
}

async function openBroadcastSpace(meta){
  // Carry chapter architecture for player + future ads
  if(meta.chapters) meta.chapters = meta.chapters;
  if(meta.breathers) meta.breathers = meta.breathers;

  // meta: { isMine, contactId?, segment, creatorUid, creatorName, title?, description?, tags? }
  activeBroadcastMeta = meta;
  if(meta.broadcastId) activeBroadcastId = meta.broadcastId;
  if(!activeBroadcastMeta.chapters && meta.segment && meta.segment.chapters){
    activeBroadcastMeta.chapters = meta.segment.chapters;
  }
  bspaceClearListeners();

  const seg = meta.segment || {};
  const title = meta.title || (seg.type === 'text' ? (seg.text || 'Broadcast').slice(0, 60) : (seg.caption || 'Broadcast'));
  const desc = meta.description || seg.caption || (seg.type === 'text' ? '' : 'Watch, join the conversation, and explore questions and resources.');

  $('bspaceCreatorName').textContent = meta.creatorName || 'Someone';
  $('bspaceCreatorMeta').textContent = meta.isMine ? 'Your Broadcast' : 'Creator Circle';
  $('bspaceTitle').textContent = title;
  $('bspaceDesc').textContent = desc;
  const tags = meta.tags && meta.tags.length ? meta.tags : (seg.type ? [seg.type] : ['idea']);
  $('bspaceTags').innerHTML = tags.map(t => `<span class="bspace-tag">${bspaceEscape(t)}</span>`).join('');
  renderBspaceMedia(seg);
  setBspaceTab('conversation');
  renderBspaceRelated();

  const isCreator = !!(meta.isMine || (currentUser && meta.creatorUid === currentUser.uid));
  $('bspaceResourceComposer').style.display = isCreator ? 'flex' : 'none';
  $('bspaceGoLive').style.display = isCreator ? 'inline-block' : 'none';
  if($('bspaceDeleteBtn')) $('bspaceDeleteBtn').style.display = isCreator ? 'inline-block' : 'none';
  const strandRow = $('bspaceStrandRow');
  if(strandRow){
    strandRow.style.display = isCreator ? 'block' : 'none';
    if(isCreator && typeof loadMyStrands === 'function'){
      loadMyStrands().then(function(){
        if(typeof fillStrandSelect === 'function') fillStrandSelect($('bspaceStrandPick'));
        const pick = $('bspaceStrandPick');
        if(pick && meta.strandId) pick.value = meta.strandId;
      }).catch(function(){});
    }
  }

  try{
    const badge = $('bspaceLiveBadge');
    if(badge){ badge.style.display = 'none'; badge.textContent = ''; }
    const pin = $('bspaceLivePin');
    if(pin){ pin.style.display = 'none'; pin.innerHTML = ''; }
  }catch(_){}
  $('bspace').classList.add('active');
  $('bspaceScroll').scrollTop = 0;
  try{ if(typeof pauseAllStrandPreviews === 'function') pauseAllStrandPreviews(); }catch(_){}
  try{
    const other = document.getElementById('bspaceVideoEl');
    if(typeof nalunoExclusiveMedia === 'function') nalunoExclusiveMedia(other || null);
  }catch(_){}

  if(!fbDb || !currentUser){
    $('bspaceJoinBtn').textContent = 'Sign in to join';
    $('bspaceJoinBtn').classList.remove('joined');
    $('bspaceConversation').innerHTML = `<div class="bspace-card"><div class="body" style="color:var(--text-dim);">Sign in to chat, ask questions, and share with this community.</div></div>`;
    return;
  }

  try{
    activeBroadcastId = await ensureBroadcastFirestore(meta);
  }catch(e){
    console.warn('[bspace] ensure failed', e);
    toast('Couldn’t open community data');
    activeBroadcastId = ensureBroadcastDocId(meta);
  }

  // Membership button — join the creator's Circle, not the live stream.
  // FIX: this rendered as "Join [Name]" — visually indistinguishable from a
  // live-stream join control, and it sits right next to the real one in this
  // same header cluster. "Join MAGAMBO" next to "Leave live" next to live
  // view stats reads as three contradictory controls for the same thing,
  // when two completely unrelated features (following a creator vs.
  // watching their live stream) just happen to share the word "Join."
  // Renamed so Circle membership can never be mistaken for a live control,
  // regardless of layout.
  try{
    const creatorUid = meta.creatorUid;
    const isMine = !!(meta.isMine || (currentUser && creatorUid === currentUser.uid));
    const btn = $('bspaceJoinBtn');
    if(isMine){
      if(btn){
        btn.textContent = 'Your Circle';
        btn.classList.add('joined');
        btn.disabled = true;
      }
    } else {
      const joined = await (typeof creatorCircleJoined === 'function'
        ? creatorCircleJoined(creatorUid)
        : false);
      if(btn){
        btn.disabled = false;
        btn.textContent = joined ? 'In Circle' : '+ Circle';
        btn.classList.toggle('joined', joined);
      }
    }
  }catch(e){
    $('bspaceJoinBtn').textContent = '+ Circle';
  }

  try{
    if(typeof armBroadcastViewWatch === 'function'){
      armBroadcastViewWatch(activeBroadcastId, meta.creatorUid, isCreator);
    }
  }catch(_){}

  try{
    await paintBspaceViews(meta);
  }catch(_){}

  listenBspaceCollection('conversation', renderBspaceConversation, 'ts');
  listenBspaceCollection('questions', renderBspaceQuestions, 'ts');
  listenBspaceCollection('results', renderBspaceResults, 'ts');
  listenBspaceCollection('resources', renderBspaceResources, 'ts');
  listenBspaceCollection('journey', renderBspaceJourney, 'ts');
  listenBspaceCollection('updates', renderBspaceUpdates, 'ts');
  bspaceWatchLiveState();

  const dash = $('bspaceDashboard');
  const upTab = $('bspaceUpdatesTab');
  if(isCreator){
    if(dash) dash.style.display = 'block';
    if(upTab) upTab.style.display = 'inline-block';
    renderBspaceImpact();
  } else {
    if(dash) dash.style.display = 'none';
    if(upTab) upTab.style.display = 'inline-block'; // members can read updates
  }
}

function closeBroadcastSpace(){
  bspaceForceLandscape = false;
  try{
    document.body.classList.remove('naluno-landscape-media', 'naluno-bspace-land-css', 'naluno-bspace-idle');
    const app = document.querySelector('.app');
    if(app) app.classList.remove('naluno-landscape-media');
    if(typeof nalunoNativeUnlockOrientation === 'function') nalunoNativeUnlockOrientation();
  }catch(_){}
  try{ if(window.__bspaceNextTimer){ clearTimeout(window.__bspaceNextTimer); window.__bspaceNextTimer = null; } }catch(_){}
  if(typeof bLiveOnSpaceClosed === 'function') bLiveOnSpaceClosed();
  bspaceStopLive();
  bspaceClearListeners();
  activeBroadcastId = null;
  activeBroadcastMeta = null;
  const vid = $('bspaceVideoEl');
  if(vid){
    try{ vid.pause(); }catch(e){}
    try{ vid.removeAttribute('src'); vid.load(); }catch(e){}
  }
  try{
    const dock = $('bspaceSeekDock');
    if(dock) dock.remove();
  }catch(_){}
  try{
    if(typeof stopAllAppMediaAndLockSession === 'function') stopAllAppMediaAndLockSession();
    else if(navigator.mediaSession){
      navigator.mediaSession.metadata = null;
      if(navigator.mediaSession.playbackState !== undefined){
        navigator.mediaSession.playbackState = 'none';
      }
    }
  }catch(_){}
  $('bspace').classList.remove('active');
}

async function bspaceRequireMember(){
  if(!currentUser || !fbDb || !activeBroadcastId){ toast('Sign in to take part'); return false; }
  return true;
}

async function bspacePost(col, payload){
  if(!(await bspaceRequireMember())) return;
  try{
    await fbDb.collection('broadcasts').doc(activeBroadcastId).collection(col).add(Object.assign({
      from: currentUser.uid,
      ts: Date.now(),
    }, payload));
    await fbDb.collection('broadcasts').doc(activeBroadcastId).set({ updatedAt: Date.now() }, { merge:true });
    try{
      const creator = activeBroadcastMeta && activeBroadcastMeta.creatorUid;
      const talk = col === 'conversation' && payload && payload.type !== 'system';
      if(talk && creator && currentUser && creator !== currentUser.uid && typeof bumpTogaMonth === 'function'){
        bumpTogaMonth(creator, { engageMonthDelta: 1, featuredBroadcastId: activeBroadcastId });
      }
    }catch(_){}
  }catch(e){
    console.warn('[bspace] post failed', e);
    toast(e.message || 'Couldn’t post');
  }
}

$('bspaceBack').onclick = closeBroadcastSpace;

document.querySelectorAll('#bspaceTabs .bspace-tab').forEach(tab=>{
  tab.onclick = ()=> setBspaceTab(tab.dataset.bspan);
});

$('bspaceJoinBtn').onclick = async ()=>{
  if(!currentUser || !fbDb || !activeBroadcastId){ toast('Sign in to join'); return; }
  const btn = $('bspaceJoinBtn');
  if(btn && btn.classList.contains('joined')) return;
  const creatorUid = activeBroadcastMeta && activeBroadcastMeta.creatorUid;
  if(!creatorUid){ toast('Creator missing'); return; }
  if(currentUser.uid === creatorUid) return;
  if(btn){ btn.disabled = true; btn.textContent = 'Joining…'; }
  try{
    if(typeof joinCreatorCircle === 'function'){
      await joinCreatorCircle(creatorUid, activeBroadcastId);
    } else {
      const ref = fbDb.collection('broadcasts').doc(activeBroadcastId);
      await ref.set({
        memberUids: firebase.firestore.FieldValue.arrayUnion(currentUser.uid),
        updatedAt: Date.now(),
      }, { merge:true });
    }
    const name = ((activeBroadcastMeta && activeBroadcastMeta.creatorName) || 'this creator').split(' ')[0];
    if(btn){
      // FIX: consistent with the rename elsewhere — "With [Name]" reads just
      // as ambiguously close to a live-join confirmation as "Join [Name]"
      // did. "In Circle" can't be mistaken for anything live-related.
      btn.textContent = 'In Circle';
      btn.classList.add('joined');
      btn.disabled = false;
    }
    toast('You’re with ' + name + ' — every Broadcast of theirs');
  }catch(e){
    console.warn('[bspace] join', e);
    if(btn){ btn.disabled = false; btn.textContent = '+ Circle'; }
    toast(e.message || 'Couldn’t join — check connection / rules');
  }
};

if($('bspaceStrandSave')){
  $('bspaceStrandSave').onclick = async function(){
    if(!activeBroadcastId || !currentUser) return;
    const pick = $('bspaceStrandPick');
    const nameEl = $('bspaceStrandNew');
    const strandId = (pick && pick.value) || '';
    const strandName = (nameEl && nameEl.value.trim()) || '';
    if(!strandId && !strandName){ toast('Pick a Strand or type a new name'); return; }
    try{
      const s = await attachBroadcastToStrand(activeBroadcastId, strandId, strandName);
      if(s){
        if(activeBroadcastMeta){
          activeBroadcastMeta.strandId = s.id;
          activeBroadcastMeta.strandName = s.name;
        }
        toast('On Strand · ' + s.name);
        renderBspaceRelated();
        if(nameEl) nameEl.value = '';
        if(typeof fillStrandSelect === 'function') fillStrandSelect(pick);
        if(pick) pick.value = s.id;
      }
    }catch(e){
      toast((e && e.message) || 'Could not save Strand');
    }
  };
}

$('bspaceConvSend').onclick = async ()=>{
  const text = ($('bspaceConvInput').value || '').trim();
  if(!text) return;
  $('bspaceConvInput').value = '';
  await bspacePost('conversation', { type:'text', text });
};
$('bspaceConvInput').addEventListener('keydown', e=>{
  if(e.key === 'Enter'){ e.preventDefault(); $('bspaceConvSend').onclick(); }
});

let bspaceVoiceRec = null;
let bspaceVoiceStream = null;
let bspaceVoiceChunks = [];
let bspaceVoiceStart = 0;
let bspaceVoiceTimer = null;

function bspaceVoiceResetBtn(){
  const btn = $('bspaceConvVoice');
  if(!btn) return;
  btn.textContent = 'Voice';
  btn.style.background = '';
  btn.style.color = '';
}
async function bspaceVoiceStopAndSend(){
  const btn = $('bspaceConvVoice');
  if(bspaceVoiceTimer){ clearInterval(bspaceVoiceTimer); bspaceVoiceTimer = null; }
  const rec = bspaceVoiceRec;
  const stream = bspaceVoiceStream;
  bspaceVoiceRec = null;
  bspaceVoiceStream = null;
  if(!rec){ bspaceVoiceResetBtn(); return; }
  const blob = await new Promise(resolve=>{
    rec.onstop = ()=>{
      const b = new Blob(bspaceVoiceChunks, { type: (bspaceVoiceChunks[0] && bspaceVoiceChunks[0].type) || 'audio/webm' });
      resolve(b.size ? b : null);
    };
    try{ rec.stop(); }catch(_){ resolve(null); }
  });
  bspaceVoiceChunks = [];
  if(stream) stream.getTracks().forEach(t=>{ try{ t.stop(); }catch(_){} });
  bspaceVoiceResetBtn();
  if(!blob){ toast('Nothing recorded'); return; }
  try{
    if(btn) btn.textContent = 'Uploading…';
    const url = await uploadVideoToR2(blob);
    await bspacePost('conversation', { type:'voice', mediaUrl:url, text:'', duration: Math.round((Date.now()-bspaceVoiceStart)/1000) });
    toast('Voice added');
  }catch(e){
    toast(e.message || 'Voice failed');
  }finally{
    bspaceVoiceResetBtn();
  }
}

$('bspaceConvVoice').onclick = async ()=>{
  if(!(await bspaceRequireMember())) return;
  if(bspaceVoiceRec && bspaceVoiceRec.state === 'recording'){
    await bspaceVoiceStopAndSend();
    return;
  }
  if(!navigator.mediaDevices || !window.MediaRecorder){ toast('Voice not supported here'); return; }
  try{
    bspaceVoiceChunks = [];
    bspaceVoiceStream = await navigator.mediaDevices.getUserMedia({ audio:true });
    const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : (MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : '');
    bspaceVoiceRec = new MediaRecorder(bspaceVoiceStream, mime ? { mimeType: mime, audioBitsPerSecond: 40000 } : { audioBitsPerSecond: 40000 });
    bspaceVoiceRec.ondataavailable = e=>{ if(e.data && e.data.size) bspaceVoiceChunks.push(e.data); };
    bspaceVoiceStart = Date.now();
    bspaceVoiceRec.start(250);
    const btn = $('bspaceConvVoice');
    if(btn){ btn.textContent = 'Stop'; btn.style.background = 'var(--red)'; btn.style.color = '#fff'; }
    bspaceVoiceTimer = setInterval(()=>{
      if(Date.now() - bspaceVoiceStart >= 60000) bspaceVoiceStopAndSend();
    }, 500);
  }catch(e){
    toast(e.message || 'Mic unavailable');
    bspaceVoiceResetBtn();
  }
};

$('bspaceQSend').onclick = async ()=>{
  const text = ($('bspaceQInput').value || '').trim();
  if(!text) return;
  $('bspaceQInput').value = '';
  await bspacePost('questions', { type:'question', text, answers:[], bestAnswer:null });
  await bspacePost('journey', { type:'question', text: 'New question: ' + text.slice(0, 80) });
};

async function bspaceAnswerQuestion(qid){
  if(!(await bspaceRequireMember())) return;
  const input = document.querySelector(`.bspace-answer-input[data-qid="${qid}"]`);
  const text = input && input.value.trim();
  if(!text) return;
  try{
    const ref = fbDb.collection('broadcasts').doc(activeBroadcastId).collection('questions').doc(qid);
    const snap = await ref.get();
    if(!snap.exists) return;
    const answers = snap.data().answers || [];
    answers.push({ from: currentUser.uid, text, ts: Date.now() });
    await ref.update({ answers });
    if(input) input.value = '';
  }catch(e){ toast(e.message || 'Couldn’t answer'); }
}

$('bspaceResultSend').onclick = async ()=>{
  const text = ($('bspaceResultInput').value || '').trim();
  if(!text) return;
  $('bspaceResultInput').value = '';
  await bspacePost('results', { type:'result', text });
  await bspacePost('journey', { type:'result', text: 'Result shared: ' + text.slice(0, 80) });
};

$('bspaceResSend').onclick = async ()=>{
  const title = ($('bspaceResTitle').value || '').trim();
  const url = ($('bspaceResUrl').value || '').trim();
  if(!title && !url) return;
  $('bspaceResTitle').value = '';
  $('bspaceResUrl').value = '';
  await bspacePost('resources', { type:'link', title: title || url, url });
  await bspacePost('journey', { type:'resource', text: 'Resource attached: ' + (title || url).slice(0, 80) });
};

/* ---- Creator impact dashboard ---- */
function renderBspaceImpact(){
  const grid = $('bspaceImpactGrid');
  if(!grid || !activeBroadcastId || !fbDb) return;
  Promise.all([
    fbDb.collection('broadcasts').doc(activeBroadcastId).collection('conversation').get(),
    fbDb.collection('broadcasts').doc(activeBroadcastId).collection('questions').get(),
    fbDb.collection('broadcasts').doc(activeBroadcastId).collection('results').get(),
    fbDb.collection('broadcasts').doc(activeBroadcastId).collection('resources').get(),
    fbDb.collection('broadcasts').doc(activeBroadcastId).get(),
  ]).then(([conv, qs, res, resources, doc])=>{
    const members = (doc.exists && doc.data().memberUids) || [];
    const answered = qs.docs.filter(d => (d.data().answers && d.data().answers.length) || d.data().bestAnswer).length;
    // FIX ("dashboard shows Conversations when there are none"): conv.size
    // counted every document in the collection, including the "is live
    // now"/"was live" SYSTEM messages posted automatically when a creator
    // goes live — not something anyone actually said. A broadcast that's
    // only ever been live once, with zero real chat, was showing a non-zero
    // Conversations count purely from those automatic notices. Counts only
    // genuine person-authored entries now.
    const realConvCount = conv.docs.filter(d => {
      const t = d.data().type;
      return t !== 'system' && t !== 'live';
    }).length;
    const cells = [
      ['Community', members.length],
      ['Conversations', realConvCount],
      ['Questions', qs.size],
      ['Answered', answered],
      ['Results', res.size],
      ['Resources', resources.size],
    ];
    grid.innerHTML = cells.map(([label, n]) =>
      `<div class="bspace-card${label === 'Community' ? ' bspace-stat-tappable' : ''}" ${label === 'Community' ? 'id="bspaceCommunityCell" role="button" tabindex="0"' : ''} style="margin:0;text-align:center;padding:14px 8px;">
        <div style="font-family:var(--font-futuristic);font-size:22px;color:var(--mint);">${n}</div>
        <div style="font-family:var(--font-mono);font-size:10px;color:var(--text-dim);margin-top:4px;">${label}${label === 'Community' ? ' \u00b7 tap' : ''}</div>
      </div>`
    ).join('');
    // Community is the only tappable cell: it opens the list of people who
    // actually joined this creator's Circle. Deliberately lazy — the member
    // list is NOT fetched as part of this dashboard render (which runs on
    // every Broadcast open); it's only loaded when someone actually taps,
    // so the common case costs nothing extra.
    const cell = $('bspaceCommunityCell');
    if(cell){
      const open = function(){
        const creatorUid = (activeBroadcastMeta && activeBroadcastMeta.creatorUid) || '';
        if(typeof openCircleMembers === 'function') openCircleMembers(creatorUid, members);
      };
      cell.onclick = open;
      cell.onkeydown = function(e){
        if(e && (e.key === 'Enter' || e.key === ' ')){ e.preventDefault(); open(); }
      };
    }
  }).catch(()=>{ grid.innerHTML = ''; });
}

function renderBspaceUpdates(docs){
  const el = $('bspaceUpdates');
  if(!el) return;
  if(!docs.length){
    el.innerHTML = `<div class="bspace-card"><div class="body" style="color:var(--text-dim);">No updates yet. The creator can correct, pin, or add follow-ups here.</div></div>`;
    return;
  }
  el.innerHTML = docs.map(d=>{
    const m = d.data();
    return `<div class="bspace-card">
      <div class="who">${m.pinned ? '📌 ' : ''}Update · ${timeAgo(m.ts || Date.now())}</div>
      <div class="body">${bspaceEscape(m.text || '')}</div>
    </div>`;
  }).join('');
}

/* ---- Go Live: same Broadcast, new chapter ---- */
let bspaceLiveStream = null;
let bspaceLiveUnsub = null;
let bspaceLiveRecorder = null;
let bspaceLiveChunks = [];
let bspaceLiveRecStartedAt = 0;

async function bspaceStopLive(){
  // FIX (major): this function used to run unconditionally every time a
  // Broadcast view closed — which happens for EVERY broadcast, live or not,
  // any time someone taps back. With no guard, it always wrote
  // lastLiveEndedAt = now to whatever broadcast was open, permanently
  // stamping plain uploads that were never live with a "Was live · just now"
  // badge the instant anyone simply viewed and closed them. Only a genuine
  // live session (an active camera stream or an in-progress recording) can
  // trigger any of this now.
  if(!bspaceLiveStream && (!bspaceLiveRecorder || bspaceLiveRecorder.state === 'inactive')){
    return;
  }
  const bcastId = activeBroadcastId;
  // Stop recorder first and keep chunks for permanent "Live recording" chapter
  let liveBlob = null;
  let liveDur = 0;
  try{
    if(bspaceLiveRecorder && bspaceLiveRecorder.state !== 'inactive'){
      liveDur = Math.max(1, (Date.now() - (bspaceLiveRecStartedAt || Date.now())) / 1000);
      liveBlob = await new Promise(resolve=>{
        bspaceLiveRecorder.onstop = ()=>{
          const blob = new Blob(bspaceLiveChunks, { type: (bspaceLiveChunks[0] && bspaceLiveChunks[0].type) || 'video/webm' });
          resolve(blob.size ? blob : null);
        };
        try{ bspaceLiveRecorder.stop(); }catch(_){ resolve(null); }
      });
    }
  }catch(e){ console.warn('[live] record stop', e); }
  bspaceLiveRecorder = null;
  bspaceLiveChunks = [];

  if(typeof bLiveOnHostStopped === 'function'){
    try{ await bLiveOnHostStopped(); }catch(_){}
  }
  if(bspaceLiveStream){
    bspaceLiveStream.getTracks().forEach(t=>{ try{ t.stop(); }catch(_){} });
    bspaceLiveStream = null;
  }
  if(bspaceLiveUnsub){ try{ bspaceLiveUnsub(); }catch(_){} bspaceLiveUnsub = null; }
  const badge = $('bspaceLiveBadge');
  if(badge) badge.style.display = 'none';
  const btn = $('bspaceGoLive');
  if(btn){ btn.textContent = 'Go live'; btn.style.background = ''; btn.style.color = ''; }
  if(fbDb && bcastId && currentUser){
    // Duration for the past-tense message/badge — read the start time BEFORE
    // clearing it, and keep it (as lastLiveStartedAt/lastLiveEndedAt) instead
    // of discarding it, so "was live" can say when and for how long.
    let startedAt = null;
    try{
      const snap = await fbDb.collection('broadcasts').doc(bcastId).get();
      startedAt = (snap.exists && snap.data() && snap.data().liveAt) || bspaceLiveRecStartedAt || null;
    }catch(_){ startedAt = bspaceLiveRecStartedAt || null; }
    const endedAt = Date.now();
    const durationMs = startedAt ? Math.max(0, endedAt - startedAt) : null;
    fbDb.collection('broadcasts').doc(bcastId).set({
      live: false,
      liveAt: null,
      liveBy: null,
      lastLiveStartedAt: startedAt,
      lastLiveEndedAt: endedAt,
      lastLiveDurationMs: durationMs,
    }, { merge:true }).catch(()=>{});
    // Past tense after live ends (pin + journey) — present tense while live
    // ("is live now"), past tense once it stops ("was live"), with how long.
    try{
      const who = (currentProfile && currentProfile.name) || 'Creator';
      const durText = (typeof formatLiveDuration === 'function') ? formatLiveDuration(durationMs) : '';
      // FIX: this used to always say "recording saved when available" —
      // stale and confusing by the time anyone actually reads it, since the
      // recording is very often already there and playable. Whether it's
      // saved is announced for real, once it's actually true, by the
      // separate "Live session saved as chapter" journey entry posted below
      // once the upload finishes — this message just states what happened.
      fbDb.collection('broadcasts').doc(bcastId).collection('conversation').add({
        type: 'system',
        kind: 'was_live',
        durationMs: durationMs || null,
        text: who + ' was live' + (durText ? ' for ' + durText : '') + '.',
        from: currentUser.uid,
        ts: Date.now(),
      }).catch(function(){});
      fbDb.collection('broadcasts').doc(bcastId).collection('journey').add({
        type: 'live',
        text: 'Live session ended' + (durText ? ' (' + durText + ')' : ''),
        ts: Date.now(),
        by: currentUser.uid,
      }).catch(function(){});
    }catch(_){}
  }

  // Append recorded live as a chapter on this Broadcast (background)
  if(liveBlob && liveBlob.size > 1000 && bcastId && currentUser && (typeof uploadBroadcastFile === 'function' || typeof uploadVideoToR2 === 'function')){
    toast('Saving live recording…');
    const job = {
      label: 'Saving live recording…',
      doneMsg: 'Live saved as chapter',
      run: async (progress)=>{
        
      let liveThumb = null;
      try{
        if(liveBlob && typeof generateVideoThumbnail === 'function'){
          liveThumb = await generateVideoThumbnail(liveBlob);
          if(liveThumb && typeof persistThumbnailDataUrl === 'function'){
            liveThumb = await persistThumbnailDataUrl(liveThumb);
          }
        }
      }catch(_){}
if(progress) progress('Uploading live recording…');
        const url = (typeof uploadBroadcastFile === 'function')
          ? await uploadBroadcastFile(liveBlob, progress)
          : await uploadVideoToR2(liveBlob);
        const ref = fbDb.collection('broadcasts').doc(bcastId);
        const snap = await ref.get();
        if(!snap.exists) return;
        const d = snap.data() || {};
        const chapters = Array.isArray(d.chapters) ? d.chapters.slice() : [];
        const idx = chapters.length;
        chapters.push({
          index: idx,
          thumbUrl: liveThumb || null,
          mediaUrl: url,
          duration: liveDur,
          title: 'Live · ' + new Date().toLocaleString(),
          fromLive: true,
          bytes: liveBlob.size,
        });
        const breathers = (typeof buildBreathersForChapters === 'function')
          ? buildBreathersForChapters(chapters.length)
          : (d.breathers || null);
        await ref.set({
          chapters,
          breathers,
          mediaUrl: d.mediaUrl || url,
          mediaType: d.mediaType || 'video',
          thumbUrl: d.thumbUrl || liveThumb || null,
          updatedAt: Date.now(),
        }, { merge:true });
        try{
          await ref.collection('journey').add({
            type: 'live_recording',
            text: 'Live session saved as chapter',
            ts: Date.now(),
            by: currentUser.uid,
          });
        }catch(_){}
        if(activeBroadcastId === bcastId && activeBroadcastMeta){
          activeBroadcastMeta.chapters = chapters;
          activeBroadcastMeta.breathers = breathers;
          if(typeof renderBspaceMedia === 'function' && activeBroadcastMeta.segment){
            activeBroadcastMeta.segment.chapters = chapters;
            activeBroadcastMeta.segment.videoUrl = activeBroadcastMeta.segment.videoUrl || url;
            renderBspaceMedia(activeBroadcastMeta.segment);
          }
        }
      },
    };
    if(typeof enqueuePublishJob === 'function') enqueuePublishJob(job);
    else job.run(()=>{}).catch(e=> toast(e.message || 'Could not save live'));
  }
}

async function bspaceStartLive(){
  if(!(await bspaceRequireMember())) return;
  const isCreator = !!(activeBroadcastMeta && (activeBroadcastMeta.isMine || (currentUser && activeBroadcastMeta.creatorUid === currentUser.uid)));
  if(!isCreator){ toast('Only the creator can go live'); return; }
  if(bspaceLiveStream){ await bspaceStopLive(); toast('Live ended'); return; }
  try{
    bspaceLiveStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 720 }, height: { ideal: 1280 }, frameRate: { ideal: 24, max: 30 } },
      audio: true,
    });
  }catch(e){
    toast('Camera/mic needed to go live');
    return;
  }
  const host = $('bspaceMedia');
  if(host){
    host.innerHTML = `<video id="bspaceLiveVideo" autoplay playsinline muted style="width:100%;height:100%;object-fit:cover;"></video>`;
    const v = $('bspaceLiveVideo');
    if(v){
      v.srcObject = bspaceLiveStream;
      v.play().catch(()=>{});
      try{ if(typeof nalunoCorrectVideoOrientation === 'function') nalunoCorrectVideoOrientation(v, bspaceLiveStream, true); }catch(_){}
    }
  }
  const badge = $('bspaceLiveBadge');
  if(badge) badge.style.display = 'block';
  const btn = $('bspaceGoLive');
  if(btn){ btn.textContent = 'End live'; btn.style.background = 'var(--red)'; btn.style.color = '#fff'; }

  await fbDb.collection('broadcasts').doc(activeBroadcastId).set({
    live: true,
    liveAt: Date.now(),
    liveBy: currentUser.uid,
    updatedAt: Date.now(),
  }, { merge:true });
  if(typeof bLiveOnHostStarted === 'function'){
    try{ await bLiveOnHostStarted(bspaceLiveStream); }catch(e){ console.warn('[live]', e); }
    // Record live for permanent chapter when live ends
    try{
      bspaceLiveChunks = [];
      bspaceLiveRecStartedAt = Date.now();
      const mime = MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus')
        ? 'video/webm;codecs=vp9,opus'
        : (MediaRecorder.isTypeSupported('video/webm') ? 'video/webm' : '');
      bspaceLiveRecorder = new MediaRecorder(bspaceLiveStream, mime ? { mimeType: mime, videoBitsPerSecond: 1800000 } : { videoBitsPerSecond: 1800000 });
      bspaceLiveRecorder.ondataavailable = e=>{
        if(e.data && e.data.size){
          bspaceLiveChunks.push(e.data);
          if(bspaceLiveChunks.length >= 240){
            try{ bspaceLiveRecorder.stop(); }catch(_){}
          }
        }
      };
      bspaceLiveRecorder.start(1000);
    }catch(e){ console.warn('[live] record start', e); bspaceLiveRecorder = null; }
  }
  // FIX ("was live" / "is live now" always read in third person, even when
  // the creator is the one looking at their own broadcast — "MAGAMBO is
  // live now" makes no sense addressed to MAGAMBO). Adds kind:'went_live' so
  // the renderer can say "You're live now" to the creator specifically,
  // while text keeps the old, name-baked wording as a fallback for anything
  // that just reads text directly (older clients, notifications, search).
  await bspacePost('conversation', { type:'system', kind:'went_live', text: ((currentProfile && currentProfile.name) || 'Creator') + ' is live now — tap Join live to watch.' });
  await bspacePost('journey', { type:'live', text: 'Live session started' });
  if(typeof notifyFrequenciesLive === 'function'){
    await notifyFrequenciesLive(activeBroadcastId, (activeBroadcastMeta && activeBroadcastMeta.title) || 'Broadcast');
  }
  toast('You’re live — your frequencies were notified');
}

$('bspaceGoLive').onclick = ()=> bspaceStartLive();

if($('bspaceUpdateSend')){
  $('bspaceUpdateSend').onclick = async ()=>{
    const text = ($('bspaceUpdateInput').value || '').trim();
    if(!text) return;
    if(!(activeBroadcastMeta && (activeBroadcastMeta.isMine || (currentUser && activeBroadcastMeta.creatorUid === currentUser.uid)))){
      toast('Only the creator can post updates');
      return;
    }
    $('bspaceUpdateInput').value = '';
    await bspacePost('updates', { type:'update', text, pinned: false });
    await bspacePost('journey', { type:'update', text: 'Update: ' + text.slice(0, 80) });
    toast('Broadcast updated');
    renderBspaceImpact();
  };
}

if($('bspaceConvPhoto')){
  $('bspaceConvPhoto').onclick = ()=> $('bspaceConvPhotoInput') && $('bspaceConvPhotoInput').click();
}
if($('bspaceConvPhotoInput')){
  $('bspaceConvPhotoInput').onchange = async ()=>{
    const file = $('bspaceConvPhotoInput').files && $('bspaceConvPhotoInput').files[0];
    $('bspaceConvPhotoInput').value = '';
    if(!file) return;
    if(!(await bspaceRequireMember())) return;
    try{
      toast('Uploading photo…');
      const url = await uploadVideoToR2(file);
      await bspacePost('conversation', { type:'photo', mediaUrl: url, text: '' });
      toast('Photo shared');
    }catch(e){ toast(e.message || 'Upload failed'); }
  };
}

/** "12m", "1h 05m" — used for the "was live" wording, never technical (no ms/raw numbers). */
function formatLiveDuration(ms){
  if(!ms || ms < 1000) return '';
  const totalMin = Math.round(ms / 60000);
  if(totalMin < 1) return 'under a minute';
  if(totalMin < 60) return totalMin + 'm';
  const h = Math.floor(totalMin / 60), m = totalMin % 60;
  return h + 'h' + (m ? ' ' + m + 'm' : '');
}
window.formatLiveDuration = formatLiveDuration;

// Watch live flag when viewing someone else's broadcast
function bspaceWatchLiveState(){
  if(!fbDb || !activeBroadcastId) return;
  const unsub = fbDb.collection('broadcasts').doc(activeBroadcastId).onSnapshot(doc=>{
    if(!doc.exists) return;
    const d = doc.data() || {};
    try{
      if(activeBroadcastMeta){
        activeBroadcastMeta.live = !!d.live;
        activeBroadcastMeta.lastLiveStartedAt = d.lastLiveStartedAt || null;
        activeBroadcastMeta.lastLiveEndedAt = d.lastLiveEndedAt || null;
        activeBroadcastMeta.lastLiveDurationMs = d.lastLiveDurationMs || null;
      }
    }catch(_){}
    const badge = $('bspaceLiveBadge');
    const isCreator = !!(activeBroadcastMeta && (activeBroadcastMeta.isMine || (currentUser && activeBroadcastMeta.creatorUid === currentUser.uid)));
    if(badge){
      if(d.live){
        // Present tense while actually live.
        badge.style.display = 'block';
        badge.textContent = isCreator ? 'Live now' : 'Live now — join';
      } else if(!bspaceLiveStream){
        // Past tense for a while after ending, then fade away — never a bare
        // "LIVE" left showing once it's over, and never silently blank either.
        // FIX: also require lastLiveStartedAt + lastLiveDurationMs to be
        // present. A genuine live session always has both; the bug that used
        // to stamp lastLiveEndedAt on every closed broadcast (fixed above,
        // in bspaceStopLive) always left those two null for a broadcast that
        // was never actually live, since there was no real start time to
        // compute a duration from. This means any already-corrupted data
        // from before that fix self-heals here without needing a migration.
        const endedAt = d.lastLiveEndedAt || 0;
        const hadRealSession = !!(d.lastLiveStartedAt && d.lastLiveDurationMs);
        const recentEnough = endedAt && hadRealSession && (Date.now() - endedAt) < 24 * 60 * 60 * 1000;
        if(recentEnough){
          const dur = formatLiveDuration(d.lastLiveDurationMs);
          badge.style.display = 'block';
          badge.textContent = 'Was live' + (dur ? ' for ' + dur : '') + ' · ' + timeAgo(endedAt);
        } else {
          badge.style.display = 'none';
        }
      }
    }
    if(typeof bLiveOnSpaceOpened === 'function'){
      bLiveOnSpaceOpened(!!d.live, isCreator);
    }
    // Non-creator: always expose Join live while host is live
    if(d.live && !isCreator){
      if(typeof bLiveShowJoinUi === 'function') bLiveShowJoinUi(true);
      if(typeof bLiveEnsureJoinBanner === 'function'){
        const ban = bLiveEnsureJoinBanner();
        if(ban) ban.style.display = 'flex';
      }
    }
    // Host ended: clear viewer chrome
    if(!d.live && !isCreator){
      if(typeof bLiveLeaveViewer === 'function' && typeof bLiveViewerPc !== 'undefined' && bLiveViewerPc){
        try{ bLiveLeaveViewer(); }catch(_){}
      }
      if(typeof bLiveShowJoinUi === 'function') bLiveShowJoinUi(false);
    }
  }, err => console.warn('[bspace] live watch', err));
  bspaceUnsubs.push(unsub);
}


/* ---- Open permanent Broadcast by Firestore id ---- */
async function openBroadcastSpaceById(id){
  if(!id){ toast('Missing Broadcast'); return; }
  if(!fbDb){ toast('Offline'); return; }
  try{
    const snap = await fbDb.collection('broadcasts').doc(id).get();
    if(!snap.exists || snap.data().deleted){ toast('Broadcast not found'); return; }
    const d = snap.data();
    const chapters = Array.isArray(d.chapters) ? d.chapters : null;
    const primary = (typeof legacyBroadcastPlayUrl === 'function')
      ? legacyBroadcastPlayUrl(d)
      : (d.mediaUrl || d.videoUrl || (chapters && chapters[0] && chapters[0].mediaUrl) || null);
    // Infer video when chapters or mediaType say so (never treat uploaded video as photo)
    let mediaType = d.mediaType || 'photo';
    if(d.mediaType === 'video' || d.videoUrl) mediaType = 'video';
    if(mediaType === 'photo' && primary && (typeof looksLikeVideoUrl === 'function' ? looksLikeVideoUrl(primary) : /\.(mp4|webm|mov|m4v)(\?|$)/i.test(primary))){
      mediaType = 'video';
    }
    if(chapters && chapters.length && chapters.some(c => c && c.mediaUrl && !c.silent && (c.start != null || c.duration))) {
      if(primary) mediaType = 'video';
    }
    const segment = {
      type: mediaType,
      dataUrl: mediaType === 'photo' ? primary : null,
      mediaUrl: primary,
      videoUrl: mediaType === 'video' ? primary : null,
      thumbDataUrl: d.thumbUrl || d.thumb || null,
      text: mediaType === 'text' ? (d.description || d.title) : null,
      bg: 'linear-gradient(160deg,#1a1f2e,#0d1018)',
      filterCss: d.filterCss || '',
      caption: d.description || '',
      chapters: chapters,
    };
    if(segment.type === 'video' && !segment.videoUrl && segment.mediaUrl){
      segment.videoUrl = segment.mediaUrl;
    }
    await openBroadcastSpace({
      isMine: !!(currentUser && d.creatorUid === currentUser.uid),
      broadcastId: id,
      segment,
      creatorUid: d.creatorUid,
      creatorName: d.creatorName,
      title: d.title,
      description: d.description,
      tags: d.tags || [],
      chapters: d.chapters || null,
      breathers: d.breathers || null,
      live: !!d.live,
      lastLiveStartedAt: d.lastLiveStartedAt || null,
      lastLiveEndedAt: d.lastLiveEndedAt || null,
      lastLiveDurationMs: d.lastLiveDurationMs || null,
      strandId: d.strandId || null,
    });
  }catch(e){
    console.warn(e);
    toast('Couldn’t open Broadcast');
  }
}




async function bspaceMarkBest(qid, answerText){
  if(!fbDb || !activeBroadcastId || !currentUser) return;
  if(!(activeBroadcastMeta && (activeBroadcastMeta.isMine || activeBroadcastMeta.creatorUid === currentUser.uid))){
    toast('Only the creator can mark the best answer');
    return;
  }
  try{
    await fbDb.collection('broadcasts').doc(activeBroadcastId).collection('questions').doc(qid).update({
      bestAnswer: answerText,
    });
    await bspacePost('journey', { type:'best', text: 'Best answer marked' });
    toast('Best answer saved to this Broadcast');
    renderBspaceImpact();
  }catch(e){ toast(e.message || 'Couldn’t mark'); }
}


if($('bspaceShareBtn')){
  $('bspaceShareBtn').onclick = async ()=>{
    if(!activeBroadcastId) return;
    const link = typeof broadcastShareUrl === 'function' ? broadcastShareUrl(activeBroadcastId) : (location.origin + '/?broadcast=' + activeBroadcastId);
    try{
      if(navigator.share){
        await navigator.share({
          title: (activeBroadcastMeta && activeBroadcastMeta.title) || 'Naluno Broadcast',
          text: 'Watch on Naluno',
          url: link
        });
      } else if(navigator.clipboard && navigator.clipboard.writeText){
        await navigator.clipboard.writeText(link);
        toast('Link copied');
      } else {
        toast(link);
      }
    }catch(e){
      if(e && e.name !== 'AbortError') toast(link);
    }
  };
}
if($('bspaceDeleteBtn')){
  $('bspaceDeleteBtn').onclick = async ()=>{
    if(!activeBroadcastId || !(activeBroadcastMeta && activeBroadcastMeta.isMine)) return;
    if(!confirm('Delete this Broadcast? The community space will be closed.')) return;
    try{
      await deletePermanentBroadcast(activeBroadcastId);
      closeBroadcastSpace();
      if(typeof loadFeedBroadcasts === 'function') await loadFeedBroadcasts();
      toast('Broadcast deleted');
    }catch(e){ toast(e.message || 'Couldn’t delete'); }
  };
}


/* ---- Chapter player + breather / ad-slot architecture ---- */
let bspaceChapterIndex = 0;
let bspaceChapterList = [];
let bspaceBreatherList = [];
let bspaceBreatherTimer = null;


function formatBspaceTime(sec){
  sec = Math.max(0, Math.floor(sec || 0));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m + ':' + String(s).padStart(2, '0');
}

/** Autoplay + always-visible seek scrubber (native controls often clipped by cover frame). */
function wireBspaceSeekAndAutoplay(v){
  if(!v) return;
  const range = $('bspaceSeekRange');
  const curEl = $('bspaceTimeCur');
  const durEl = $('bspaceTimeDur');
  const playBtn = $('bspacePlayBtn');
  let scrubbing = false;

  function syncPlayBtn(){
    if(playBtn) playBtn.textContent = v.paused ? '▶' : '❚❚';
  }
  function syncTimes(){
    const d = v.duration;
    if(durEl){
      const trueD = (typeof nalunoTrueDuration === 'function') ? nalunoTrueDuration(v) : d;
      durEl.textContent = (isFinite(trueD) && trueD > 0) ? formatBspaceTime(trueD) : '0:00';
    }
    if(curEl) curEl.textContent = formatBspaceTime(v.currentTime);
    if(range){
      const trueD = (typeof nalunoTrueDuration === 'function') ? nalunoTrueDuration(v) : d;
      if(isFinite(trueD) && trueD > 0 && !scrubbing){
        range.value = String(Math.round((v.currentTime / trueD) * 1000));
      }
    }
  }

  if(range){
    const seekTo = ()=>{
      const d = (typeof nalunoTrueDuration === 'function') ? nalunoTrueDuration(v) : v.duration;
      if(!isFinite(d) || d <= 0) return;
      const t = (parseInt(range.value, 10) / 1000) * d;
      try{ v.currentTime = t; }catch(_){}
      syncTimes();
    };
    range.addEventListener('input', ()=>{ scrubbing = true; seekTo(); });
    range.addEventListener('change', ()=>{ scrubbing = false; seekTo(); });
    range.addEventListener('touchstart', ()=>{ scrubbing = true; }, { passive: true });
    range.addEventListener('touchend', ()=>{ scrubbing = false; seekTo(); }, { passive: true });
  }
  if(playBtn){
    playBtn.onclick = ()=>{
      if(v.paused){
        try{ v.dataset.nalunoWantPlay = '1'; v.dataset.nalunoKeepAlive = '1'; v.dataset.nalunoUserPaused = '0'; }catch(_){}
        const p = v.play();
        if(p && p.catch) p.catch(()=>{});
      } else {
        try{ v.dataset.nalunoUserPaused = '1'; v.dataset.nalunoWantPlay = '0'; }catch(_){}
        v.pause();
      }
      syncPlayBtn();
    };
  }

  v.addEventListener('timeupdate', syncTimes);
  v.addEventListener('loadedmetadata', syncTimes);
  v.addEventListener('durationchange', syncTimes);
  v.addEventListener('play', syncPlayBtn);
  v.addEventListener('pause', syncPlayBtn);
  v.addEventListener('ended', syncPlayBtn);

  // Autoplay: try unmuted first; if blocked, muted autoplay then unmute on first tap
  v.playsInline = true;
  v.setAttribute('playsinline', '');
  v.setAttribute('webkit-playsinline', '');
  const tryPlay = ()=>{
    const p = v.play();
    if(p && p.catch){
      p.catch(()=>{
        try{
          v.muted = true;
          v.play().then(()=>{
            // Keep muted until user taps play — still starts content
            syncPlayBtn();
          }).catch(()=>{});
        }catch(_){}
      });
    }
  };
  if(v.readyState >= 2) tryPlay();
  else v.addEventListener('loadeddata', tryPlay, { once: true });
  // Second chance after src bind settles
  setTimeout(tryPlay, 400);
  v.addEventListener('ended', function(){
    if(typeof nalunoResumeIfTruncated === 'function'){
      const recovered = nalunoResumeIfTruncated(v, function(){ syncPlayBtn(); });
      if(recovered) return;
    }
    const d = (typeof nalunoTrueDuration === 'function') ? nalunoTrueDuration(v) : v.duration;
    const t = v.currentTime || 0;
    if(isFinite(d) && t < (d || 0) - 0.45){
      try{ v.preload = 'auto'; v.currentTime = Math.max(0, t + 0.001); }catch(_){}
      v.play().catch(function(){});
      return;
    }
    // True end of content → strand next / nearby / restart
    if(typeof bspaceOnPlaybackEnded === 'function') bspaceOnPlaybackEnded();
  });
  syncPlayBtn();
  syncTimes();
}

/** After a Broadcast finishes: next episode in the same Strand (upload order),
 *  else a nearby Broadcast from someone else, else back to the titles list —
 *  never loop/restart the same clip, and never leave a "LIVE"-style badge or
 *  a frozen last frame with nothing for the person to do. */
function bspaceOnPlaybackEnded(){
  try{ if(window.__bspaceNextTimer){ clearTimeout(window.__bspaceNextTimer); window.__bspaceNextTimer = null; } }catch(_){}
  const meta = activeBroadcastMeta || {};
  const curId = activeBroadcastId;
  function backToTitles(){
    // FIX: idle end-of-content used to restart/loop the same clip. The person
    // asked for this instead: return to the screen where every title lives.
    try{ toast('That\u2019s everything here — back to Broadcasts'); }catch(_){}
    if(typeof closeBroadcastSpace === 'function') closeBroadcastSpace();
  }
  function scheduleOpen(id, label, delayMs){
    if(!id || id === curId) return false;
    try{
      toast((label || 'Next') + ' in a moment…');
    }catch(_){}
    window.__bspaceNextTimer = setTimeout(function(){
      window.__bspaceNextTimer = null;
      if(activeBroadcastId !== curId) return; // user navigated away
      if(typeof openBroadcastById === 'function') openBroadcastById(id);
    }, delayMs || 4500);
    return true;
  }
  // 1) Next episode in this Strand, in upload order.
  // 1) Next episode in this Strand, in upload order.
  // FIX: relatedBroadcasts() deliberately EXCLUDES the current item from its
  // results (correct for its original job — an "other items in this Strand"
  // display list) — which means searching that list for curId's index could
  // never find it, so this could never actually advance to the next episode
  // at all. Sequencing needs curId present in the list to find its position,
  // so this builds that list directly instead of reusing relatedBroadcasts().
  const tryStrand = function(){
    if(!meta.strandId) return false;
    const pool = (typeof feedBroadcasts !== 'undefined' && feedBroadcasts) ? feedBroadcasts : [];
    const siblings = pool.filter(function(x){ return x && !x.deleted && x.strandId === meta.strandId; })
      .sort(function(a,b){ return (Number(a.createdAt)||0) - (Number(b.createdAt)||0); });
    let idx = -1;
    for(let i = 0; i < siblings.length; i++){
      if(siblings[i].id === curId){ idx = i; break; }
    }
    // Only ever move FORWARD in upload order. If this was already the last
    // episode (or curId isn't found), there is no "next" — fall to nearby.
    if(idx < 0 || idx + 1 >= siblings.length) return false;
    const next = siblings[idx + 1];
    return scheduleOpen(next.id, 'Next in ' + (meta.strandName || 'Strand') + ' · ' + (next.title || 'Broadcast'), 4500);
  };
  // 2) Strand finished (or no Strand) → a nearby Broadcast from someone else.
  const tryNearby = function(){
    const pool = (typeof feedBroadcasts !== 'undefined' && feedBroadcasts) ? feedBroadcasts : [];
    const candidates = pool.filter(function(x){
      return x && !x.deleted && x.id !== curId && (!meta.strandId || x.strandId !== meta.strandId);
    });
    if(!candidates.length) return false;
    // Prefer something live right now, then most recent.
    candidates.sort(function(a,b){
      if(!!b.live !== !!a.live) return (b.live?1:0) - (a.live?1:0);
      return (Number(b.createdAt)||0) - (Number(a.createdAt)||0);
    });
    const next = candidates[0];
    return scheduleOpen(next.id, 'Up next · ' + (next.title || 'Broadcast'), 4500);
  };
  const did = tryStrand();
  if(!did){
    if(!tryNearby()){
      // 3) Nothing left to suggest → the titles list, not a restart/loop.
      backToTitles();
    }
  }
}
window.bspaceOnPlaybackEnded = bspaceOnPlaybackEnded;

function wireBroadcastChapterPlayer(chapters, breathers, opts){
  opts = opts || {};
  bspaceChapterList = Array.isArray(chapters) ? chapters.slice().sort((a,b)=>(a.index||0)-(b.index||0)) : [];
  bspaceBreatherList = Array.isArray(breathers) ? breathers : [];
  bspaceChapterIndex = 0;
  const v = $('bspaceVideoEl');
  if(!v) return;
  // Resolve src for first chapter only if the element is not already on that file
  if(bspaceChapterList[0] && bspaceChapterList[0].mediaUrl){
    const u = (typeof resolveMediaUrl === 'function') ? resolveMediaUrl(bspaceChapterList[0].mediaUrl) : bspaceChapterList[0].mediaUrl;
    const have = (v.currentSrc || v.getAttribute('src') || '').split('?')[0];
    if(!have || (u && have.indexOf(u.split('?')[0]) < 0)){
      v.src = u;
    }
  }

  const bar = $('bspaceChapterBar');
  if(bar && opts.showChips && bspaceChapterList.length > 1){
    const canCut = !!(activeBroadcastMeta && activeBroadcastMeta.isMine);
    const shared = bspaceChapterList.length > 1 && bspaceChapterList.every(c => c.mediaUrl === bspaceChapterList[0].mediaUrl);
    bar.innerHTML = bspaceChapterList.map(function(ch,i){
      const gone = ch.status === 'removed' && !ch.replacementUrl;
      const replaced = !!(ch.replacementUrl || ch.status === 'replaced');
      const label = gone ? (canCut ? 'Ad · Replace' : 'Ad')
        : ((ch.title || ('Ch '+(i+1))) + (replaced ? ' · new' : ''));
      return `<span style="display:inline-flex;align-items:center;gap:4px;">
        <button type="button" data-ch="${i}" style="font-family:var(--font-mono);font-size:10px;padding:4px 8px;border-radius:999px;border:1px solid ${gone?'rgba(255,84,112,.5)':'var(--line)'};background:${gone?'rgba(255,84,112,.16)':(i===0?'rgba(124,255,178,.15)':'transparent')};color:${gone?'#ff8a9a':(i===0?'var(--mint)':'var(--text-dim)')};cursor:pointer;">${bspaceEscape(label)}</button>
        ${canCut && gone ? '<button type="button" data-repch="'+i+'" style="font-family:var(--font-mono);font-size:10px;padding:3px 7px;border-radius:999px;border:1px solid var(--line);background:transparent;color:var(--mint);cursor:pointer;">Replace</button>' : ''}
        ${canCut && !gone ? '<button type="button" data-delch="'+i+'" aria-label="Remove chapter" style="border:none;background:transparent;color:var(--text-dim);font-size:14px;cursor:pointer;line-height:1;">×</button>' : ''}
      </span>`;
    }).join('');
    bar.querySelectorAll('[data-ch]').forEach(btn=>{
      btn.onclick = ()=> playBroadcastChapter(parseInt(btn.getAttribute('data-ch'),10), true);
    });
    bar.querySelectorAll('[data-delch]').forEach(btn=>{
      btn.onclick = function(e){
        e.preventDefault(); e.stopPropagation();
        deleteBroadcastChapter(parseInt(btn.getAttribute('data-delch'),10));
      };
    });
    bar.querySelectorAll('[data-repch]').forEach(btn=>{
      btn.onclick = function(e){
        e.preventDefault(); e.stopPropagation();
        replaceBroadcastChapter(parseInt(btn.getAttribute('data-repch'),10));
      };
    });
  }

  // Single-file mid-rolls (atSec on breathers)
  v.ontimeupdate = ()=>{
    if(bspaceChapterList.length > 1) return;
    const marks = bspaceBreatherList.filter(b => typeof b.atSec === 'number');
    if(!marks.length) return;
    const t = v.currentTime || 0;
    marks.forEach(m=>{
      if(m._fired) return;
      if(t >= m.atSec && t < m.atSec + 1.5){
        m._fired = true;
        showBreatherAdSlot(m, ()=>{});
      }
    });
  };

  v.onended = ()=>{
    const d = v.duration;
    const t = v.currentTime || 0;
    const falseEnd = (typeof nalunoFiniteDuration === 'function')
      ? (!nalunoFiniteDuration(d) || t < d - 0.45)
      : (!isFinite(d) || d === Infinity || t < (d || 0) - 0.45);
    if(falseEnd){
      try{ v.preload = 'auto'; v.currentTime = Math.max(0, t + 0.001); }catch(_){}
      v.play().catch(function(){});
      return;
    }
    const shared = bspaceChapterList.length > 1 && bspaceChapterList.every(c => c.mediaUrl === bspaceChapterList[0].mediaUrl);
    if(shared){
      // Single shared file finished → strand next / restart
      if(typeof bspaceOnPlaybackEnded === 'function') bspaceOnPlaybackEnded();
      return;
    }
    if(bspaceChapterList.length <= 1){
      if(typeof bspaceOnPlaybackEnded === 'function') bspaceOnPlaybackEnded();
      return;
    }
    const next = bspaceChapterIndex + 1;
    if(next >= bspaceChapterList.length){
      if(typeof bspaceOnPlaybackEnded === 'function') bspaceOnPlaybackEnded();
      return;
    }
    playBroadcastChapter(next, false);
  };
}

function playBroadcastChapter(index, userInitiated){
  const ch = bspaceChapterList[index];
  if(!ch) return;
  if(typeof chapterIsActive === 'function' && !chapterIsActive(ch)){
    const nxt = (typeof nextActiveChapterIndex === 'function') ? nextActiveChapterIndex(bspaceChapterList, index - 1) : -1;
    if(nxt >= 0){
      showChapterAdBucket(index, function(){ playBroadcastChapter(nxt, false); });
    } else {
      showChapterAdBucket(index, function(){});
    }
    return;
  }
  if(ch.replacementUrl){
    bspaceChapterIndex = index;
    const v = $('bspaceVideoEl');
    if(!v) return;
    const url = (typeof resolveMediaUrl === 'function') ? resolveMediaUrl(ch.replacementUrl) : ch.replacementUrl;
    try{ v.pause(); }catch(_){}
    v.src = url;
    const kick = function(){
      const p = v.play();
      if(p && p.catch) p.catch(function(){ try{ v.muted = true; v.play().catch(function(){}); }catch(_){} });
    };
    if(v.readyState >= 2) kick();
    else v.addEventListener('loadeddata', kick, { once: true });
    v.onended = function(){
      const nxt = (typeof nextActiveChapterIndex === 'function') ? nextActiveChapterIndex(bspaceChapterList, index) : index + 1;
      if(nxt >= 0) playBroadcastChapter(nxt, false);
      else if(typeof bspaceOnPlaybackEnded === 'function') bspaceOnPlaybackEnded();
    };
    return;
  }
  if(!ch.mediaUrl) return;
  bspaceChapterIndex = index;
  const v = $('bspaceVideoEl');
  if(!v) return;
  const url = (typeof resolveMediaUrl === 'function') ? resolveMediaUrl(ch.mediaUrl) : ch.mediaUrl;
  const shared = !!ch.sharedSource || (bspaceChapterList.length > 1 && bspaceChapterList.every(c => c.mediaUrl === ch.mediaUrl));

  if(shared){
    // One file: play continuously. Seek ONLY when the person taps a chapter chip.
    // Auto-seeking at each 4-min mark is what made later chapters drag/stutter.
    const startAt = typeof ch.start === 'number' ? ch.start : 0;
    const fileKey = (url.split('?')[0].split('/').pop() || '');
    const alreadyOnFile = !!(fileKey && String(v.currentSrc || v.src).indexOf(fileKey) >= 0);
    const kickPlay = function(doSeek){
      if(doSeek && startAt >= 0){
        const onSeeked = function(){
          v.removeEventListener('seeked', onSeeked);
          const p = v.play();
          if(p && p.catch) p.catch(function(){ try{ v.muted = true; v.play().catch(function(){}); }catch(_){} });
        };
        v.addEventListener('seeked', onSeeked);
        try{ v.currentTime = startAt; }catch(_){ onSeeked(); }
      } else {
        const p = v.play();
        if(p && p.catch) p.catch(function(){ try{ v.muted = true; v.play().catch(function(){}); }catch(_){} });
      }
    };
    if(!alreadyOnFile){
      v.src = url;
      if(typeof nalunoMediaIdFromUrl === 'function'){
        const mid = nalunoMediaIdFromUrl(url);
        if(mid) v.dataset.mediaId = mid;
      }
      v.onloadedmetadata = function(){ kickPlay(!!userInitiated && startAt > 0.4); };
    } else {
      kickPlay(!!userInitiated);
    }
    v.ontimeupdate = function(){
      const t = v.currentTime || 0;
      let idx = 0;
      for(let i = 0; i < bspaceChapterList.length; i++){
        const c = bspaceChapterList[i];
        if(typeof c.start === 'number' && t >= c.start - 0.05) idx = i;
      }
      const here = bspaceChapterList[idx];
      if(here && here.status === 'removed' && !here.replacementUrl && typeof here.end === 'number'){
        if(t >= here.start && t < here.end - 0.05){
          if(v._nalunoSkipHole) return;
          v._nalunoSkipHole = true;
          const nxt = (typeof nextActiveChapterIndex === 'function') ? nextActiveChapterIndex(bspaceChapterList, idx) : -1;
          showChapterAdBucket(idx, function(){
            v._nalunoSkipHole = false;
            if(nxt >= 0 && typeof bspaceChapterList[nxt].start === 'number'){
              try{ v.currentTime = bspaceChapterList[nxt].start; }catch(_){}
              v.play().catch(function(){});
            } else {
              try{ v.pause(); }catch(_){}
            }
          });
          return;
        }
      }
      if(here && here.replacementUrl && t >= (here.start||0) && t < (here.end || t + 1) && !v._nalunoReplace){
        v._nalunoReplace = true;
        playBroadcastChapter(idx, false);
        return;
      }
      if(idx !== bspaceChapterIndex){
        bspaceChapterIndex = idx;
        const bar = $('bspaceChapterBar');
        if(bar){
          bar.querySelectorAll('[data-ch]').forEach(btn=>{
            const on = parseInt(btn.getAttribute('data-ch'),10) === idx;
            btn.style.background = on ? 'rgba(124,255,178,.15)' : 'transparent';
            btn.style.color = on ? 'var(--mint)' : 'var(--text-dim)';
          });
        }
      }
    };
  } else {
    try{ v.pause(); }catch(_){}
    v.src = url;
    const kick = function(){
      const p = v.play();
      if(p && p.catch) p.catch(function(){
        try{ v.muted = true; v.play().then(function(){ /* content visible */ }).catch(function(){}); }catch(_){}
      });
    };
    if(v.readyState >= 2) kick();
    else v.addEventListener('loadeddata', kick, { once: true });
    setTimeout(kick, 300);
  }
  const bar = $('bspaceChapterBar');
  if(bar){
    bar.querySelectorAll('[data-ch]').forEach(btn=>{
      const on = parseInt(btn.getAttribute('data-ch'),10) === index;
      btn.style.background = on ? 'rgba(124,255,178,.15)' : 'transparent';
      btn.style.color = on ? 'var(--mint)' : 'var(--text-dim)';
    });
  }
  hideBreatherAdSlot();
}

function showBreatherAdSlot(breather, onDone){
  const el = $('bspaceBreather');
  if(!el){ if(onDone) onDone(); return; }
  const ad = breather && breather.adSlot;
  el.style.display = 'flex';
  const label = $('bspaceBreatherLabel');
  const adLine = $('bspaceBreatherAd');
  if(label) label.textContent = (breather && breather.label) || 'Chapter break';
  if(adLine){
    // Architecture for ads: when inventory is ready, render creative here.
    // Today: reserved slot only (no network ad call).
    if(ad && ad.status === 'ready' && ad.creativeHtml){
      adLine.innerHTML = ad.creativeHtml;
    } else if(ad && ad.enabled){
      adLine.textContent = 'Ad slot · reserved for future inventory';
    } else {
      adLine.textContent = 'Next chapter…';
    }
  }
  if(bspaceBreatherTimer) clearTimeout(bspaceBreatherTimer);
  const wait = (breather && breather.durationMs) || 1200;
  // If ad is ready and longer, use ad max duration
  const adWait = (ad && ad.status === 'ready' && ad.maxDurationMs) ? ad.maxDurationMs : wait;
  bspaceBreatherTimer = setTimeout(()=>{
    hideBreatherAdSlot();
    if(onDone) onDone();
  }, Math.min(adWait, 15000));
}

function hideBreatherAdSlot(){
  const el = $('bspaceBreather');
  if(el) el.style.display = 'none';
  if(bspaceBreatherTimer){ clearTimeout(bspaceBreatherTimer); bspaceBreatherTimer = null; }
}


/* Broadcast video stage: respect uploaded aspect (portrait OR landscape).
   Live mesh stays 9:16 cover; recorded/uploaded video adapts to its real frame.
   User can toggle Fit (letterbox, full picture) vs Fill (crop to stage). */

/* Broadcast video stage.
   Naluno stage is 9:16 (phone). Fill uses the uploaded picture's aspect.
   Fit shows the whole picture inside the 9:16 stage (letterbox if needed).
   Rotated 9:16 camera files that report 1920×1080 stay portrait via poster. */

let bspaceFitMode = 'fill'; // default Fill so 9:16 clips fill the phone
let bspaceForceLandscape = false;

function nalunoDeviceWantsLandscape(){
  try{
    if(screen.orientation && screen.orientation.type && String(screen.orientation.type).indexOf('landscape') >= 0) return true;
    if(typeof window.orientation === 'number' && Math.abs(window.orientation) === 90) return true;
    if(window.innerWidth > window.innerHeight) return true;
  }catch(_){}
  return false;
}

function adaptBspaceHeroToVideo(){
  const hero = $('bspaceHero');
  const v = $('bspaceVideoEl');
  if(!hero || !v) return;
  hero.style.width = '100%';
  hero.style.background = '#000';

  const apply = function(){
    const poster = v.poster || v.getAttribute('poster') || '';
    const portrait = (typeof nalunoVideoLooksPortrait === 'function')
      ? nalunoVideoLooksPortrait(v, poster)
      : !(v.videoWidth > 0 && v.videoHeight > 0 && v.videoWidth > v.videoHeight);
    const w = v.videoWidth || 0;
    const h = v.videoHeight || 0;

    let orientLandscape = !!(bspaceForceLandscape || (typeof nalunoDeviceWantsLandscape === 'function' && nalunoDeviceWantsLandscape()));
    if(!orientLandscape){
      try{
        if(screen.orientation && screen.orientation.type){
          orientLandscape = String(screen.orientation.type).indexOf('landscape') >= 0;
        } else if(typeof window.orientation === 'number'){
          orientLandscape = Math.abs(window.orientation) === 90;
        } else {
          orientLandscape = window.innerWidth > window.innerHeight;
        }
      }catch(_){}
    }

    v.style.objectFit = bspaceFitMode === 'fill' ? 'cover' : 'contain';
    try{
      document.body.classList.toggle('naluno-fit-cover', bspaceFitMode === 'fill');
      document.body.classList.toggle('naluno-fit-contain', bspaceFitMode !== 'fill');
    }catch(_){}

    if(bspaceForceLandscape || orientLandscape){
      hero.style.aspectRatio = 'auto';
      hero.style.width = '100%';
      hero.style.height = '100dvh';
      hero.style.maxHeight = '100dvh';
      hero.style.borderRadius = '0';
      try{
        document.body.classList.add('naluno-landscape-media');
        const app = document.querySelector('.app');
        if(app) app.classList.add('naluno-landscape-media');
        try{ if(typeof nalunoBspaceShowChrome === 'function') nalunoBspaceShowChrome(); }catch(_){}
      }catch(_){}
    } else if(!portrait && w > 0 && h > 0){
      hero.style.aspectRatio = w + ' / ' + h;
      hero.style.maxHeight = 'min(56vh, 420px)';
      hero.style.height = '';
      hero.style.borderRadius = '';
    } else {
      hero.style.aspectRatio = '9 / 16';
      hero.style.maxHeight = 'min(82vh, 780px)';
      hero.style.height = '';
      hero.style.borderRadius = '';
    }

    if(!bspaceForceLandscape && !orientLandscape){
      try{
        document.body.classList.remove('naluno-landscape-media', 'naluno-bspace-land-css');
        const app = document.querySelector('.app');
        if(app) app.classList.remove('naluno-landscape-media');
      }catch(_){}
    }

    v.style.width = '100%';
    v.style.height = '100%';
    v.style.maxHeight = 'none';
    v.style.background = '#000';
  };

  apply();
  v.addEventListener('loadedmetadata', apply);
  v.addEventListener('loadeddata', apply);
  v.addEventListener('playing', apply);

  try{
    let chip = $('bspaceFitToggle');
    if(!chip && hero){
      chip = document.createElement('button');
      chip.type = 'button';
      chip.id = 'bspaceFitToggle';
      chip.className = 'bspace-mini';
      chip.style.cssText = 'position:absolute;right:12px;bottom:12px;z-index:6;font-size:11px;';
      chip.onclick = function(e){
        e.preventDefault();
        e.stopPropagation();
        bspaceFitMode = bspaceFitMode === 'fill' ? 'fit' : 'fill';
        chip.textContent = bspaceFitMode === 'fill' ? 'Fit' : 'Fill';
        apply();
      };
      hero.appendChild(chip);
    }
    if(chip){
      chip.textContent = bspaceFitMode === 'fill' ? 'Fit' : 'Fill';
      chip.title = 'Fill covers the stage. Fit shows the whole picture.';
    }
    let orient = $('bspaceOrientToggle');
    if(!orient && hero){
      orient = document.createElement('button');
      orient.type = 'button';
      orient.id = 'bspaceOrientToggle';
      orient.className = 'bspace-mini';
      orient.style.cssText = 'position:absolute;right:12px;bottom:52px;z-index:8;font-size:11px;';
      orient.textContent = 'Fill screen';
      orient.onclick = function(e){
        e.preventDefault();
        e.stopPropagation();
        bspaceForceLandscape = !bspaceForceLandscape;
        if(!bspaceForceLandscape){
          try{ if(typeof nalunoNativeUnlockOrientation === 'function') nalunoNativeUnlockOrientation(); }catch(_){}
          document.body.classList.remove('naluno-landscape-media', 'naluno-bspace-land-css');
          const app = document.querySelector('.app');
          if(app) app.classList.remove('naluno-landscape-media');
          orient.classList.remove('primary');
        } else {
          document.body.classList.add('naluno-landscape-media');
          const app = document.querySelector('.app');
          if(app) app.classList.add('naluno-landscape-media');
          orient.classList.add('primary');
          if(typeof nalunoNativeLockLandscape === 'function'){
            nalunoNativeLockLandscape().then(function(){ try{ adaptBspaceHeroToVideo(); }catch(_){} });
          }
        }
        try{ adaptBspaceHeroToVideo(); }catch(_){}
      };
      hero.appendChild(orient);
    }
    if(orient){
      orient.textContent = 'Fill screen';
      orient.title = 'Use the whole phone screen';
      orient.classList.toggle('primary', !!bspaceForceLandscape);
    }
  }catch(_){}

  try{
    if(!window.__bspaceOrientBound){
      window.__bspaceOrientBound = true;
      const re = function(){
        try{
          if($('bspace') && $('bspace').classList.contains('active') && nalunoDeviceWantsLandscape()){
            bspaceForceLandscape = true;
          }
        }catch(_){}
        try{ adaptBspaceHeroToVideo(); }catch(_){}
      };
      window.addEventListener('orientationchange', re);
      window.addEventListener('resize', re);
      if(screen.orientation && screen.orientation.addEventListener){
        screen.orientation.addEventListener('change', re);
      }
    }
  }catch(_){}
}

function nalunoStrandSiblingsFor(id){
  const lists = [];
  try{ if(typeof feedBroadcasts !== 'undefined' && feedBroadcasts) lists.push(feedBroadcasts); }catch(_){}
  try{ if(typeof myBroadcasts !== 'undefined' && myBroadcasts) lists.push(myBroadcasts); }catch(_){}
  const pool = [];
  const seen = {};
  lists.forEach(function(arr){
    (arr || []).forEach(function(b){
      if(!b || !b.id || b.deleted || seen[b.id]) return;
      seen[b.id] = true;
      pool.push(b);
    });
  });
  const cur = pool.find(function(b){ return b.id === id; });
  let sid = cur && cur.strandId;
  if(!sid && typeof getOpenStrandFolderId === 'function') sid = getOpenStrandFolderId();
  if(!sid) return { items: cur ? [cur] : [], index: 0 };
  const items = pool.filter(function(b){ return b.strandId === sid; })
    .sort(function(a,b){ return (Number(a.createdAt)||0) - (Number(b.createdAt)||0); });
  const index = items.findIndex(function(b){ return b.id === id; });
  return { items: items, index: index };
}

function nalunoBspaceStep(dir){
  const id = activeBroadcastId;
  if(!id){
    try{ closeBroadcastSpace(); }catch(_){}
    return;
  }
  const pack = nalunoStrandSiblingsFor(id);
  if(dir < 0){
    if(pack.index > 0 && pack.items[pack.index - 1] && typeof openBroadcastById === 'function'){
      openBroadcastById(pack.items[pack.index - 1].id);
    } else {
      closeBroadcastSpace();
    }
    return;
  }
  if(pack.index >= 0 && pack.index < pack.items.length - 1 && typeof openBroadcastById === 'function'){
    openBroadcastById(pack.items[pack.index + 1].id);
  }
}
window.nalunoBspaceStep = nalunoBspaceStep;

(function bindBspaceChromeIdle(){
  const root = document.getElementById('bspace');
  if(!root || root.__nalunoChromeBound) return;
  root.__nalunoChromeBound = true;
  let hideTimer = null;
  function showChrome(){
    try{ document.body.classList.remove('naluno-bspace-idle'); }catch(_){}
    if(hideTimer) clearTimeout(hideTimer);
    hideTimer = setTimeout(function(){
      hideTimer = null;
      try{
        if(!document.body.classList.contains('naluno-landscape-media')) return;
        const v = document.getElementById('bspaceVideoEl');
        if(v && v.paused) return;
        document.body.classList.add('naluno-bspace-idle');
      }catch(_){}
    }, 2800);
  }
  root.addEventListener('pointerdown', showChrome);
  root.addEventListener('touchstart', showChrome, { passive: true });
  window.nalunoBspaceShowChrome = showChrome;
})();

(function bindBspaceSwipe(){
  const root = document.getElementById('bspaceHero') || document.getElementById('bspace');
  if(!root || root.__nalunoSwipeBound) return;
  root.__nalunoSwipeBound = true;
  let sx = 0, sy = 0, axis = '', on = false;
  function down(e){
    if(e.target && e.target.closest && e.target.closest('#bspaceSeekDock, #bspaceTabs, .bspace-tabs, .bspace-body, .bspace-panel, input, textarea, select, .nearby-strip, .bspace-mini, .back-btn')){
      on = false; return;
    }
    const t = (e.touches && e.touches[0]) || e;
    sx = t.clientX; sy = t.clientY; axis = ''; on = true;
  }
  function move(e){
    if(!on) return;
    const t = (e.touches && e.touches[0]) || e;
    const dx = t.clientX - sx, dy = t.clientY - sy;
    if(!axis){
      if(Math.abs(dx) < 14 && Math.abs(dy) < 14) return;
      axis = Math.abs(dx) > Math.abs(dy) * 1.2 ? 'x' : 'y';
    }
    if(axis === 'x' && e.cancelable){ try{ e.preventDefault(); }catch(_){} }
  }
  function up(e){
    if(!on) return;
    on = false;
    const t = (e.changedTouches && e.changedTouches[0]) || e;
    const dx = t.clientX - sx, dy = t.clientY - sy;
    const wasX = axis === 'x' || (axis === '' && Math.abs(dx) > Math.abs(dy) * 1.2);
    axis = '';
    if(!wasX || Math.abs(dx) < 56) return;
    if(dx < 0) nalunoBspaceStep(1);
    else nalunoBspaceStep(-1);
  }
  root.addEventListener('touchstart', down, { passive: true });
  root.addEventListener('touchmove', move, { passive: false });
  root.addEventListener('touchend', up, { passive: true });
})();

function showChapterAdBucket(index, onDone){
  const mine = !!(activeBroadcastMeta && activeBroadcastMeta.isMine);
  const breather = {
    durationMs: mine ? 2200 : 1400,
    label: mine ? 'Ad bucket' : 'Next',
    adSlot: { enabled: true, status: 'reserved' },
  };
  const el = $('bspaceBreather');
  const btn = $('bspaceReplaceChBtn');
  if(btn){
    btn.style.display = mine ? 'inline-flex' : 'none';
    btn.onclick = function(){ replaceBroadcastChapter(index); };
  }
  showBreatherAdSlot(breather, function(){
    if(btn) btn.style.display = 'none';
    if(onDone) onDone();
  });
}

async function persistBroadcastChapters(){
  if(!fbDb || !activeBroadcastId) return;
  await fbDb.collection('broadcasts').doc(activeBroadcastId).set({
    chapters: bspaceChapterList,
    updatedAt: Date.now(),
  }, { merge: true });
  if(activeBroadcastMeta) activeBroadcastMeta.chapters = bspaceChapterList;
}

async function deleteBroadcastChapter(index){
  if(!activeBroadcastMeta || !activeBroadcastMeta.isMine) return;
  if(!bspaceChapterList || index < 0 || index >= bspaceChapterList.length) return;
  const liveCount = bspaceChapterList.filter(function(ch){ return typeof chapterIsActive !== 'function' || chapterIsActive(ch); }).length;
  if(liveCount <= 1 && chapterIsActive(bspaceChapterList[index])){
    toast('Keep at least one chapter');
    return;
  }
  const ch = bspaceChapterList[index];
  ch.status = 'removed';
  ch.removedAt = Date.now();
  ch.replacementUrl = null;
  ch.adSlot = { enabled: true, status: 'reserved', kind: 'bucket' };
  try{
    await persistBroadcastChapters();
  }catch(e){
    toast('Could not update chapters');
    return;
  }
  toast('Chapter is now an ad bucket');
  const nxt = (typeof nextActiveChapterIndex === 'function') ? nextActiveChapterIndex(bspaceChapterList, index - 1) : -1;
  if(nxt >= 0) playBroadcastChapter(nxt, false);
  if(typeof wireBroadcastChapterPlayer === 'function'){
    wireBroadcastChapterPlayer(bspaceChapterList, bspaceBreatherList, { showChips: true });
  }
}

function replaceBroadcastChapter(index){
  if(!activeBroadcastMeta || !activeBroadcastMeta.isMine) return;
  if(!bspaceChapterList || !bspaceChapterList[index]) return;
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.accept = 'video/*';
  inp.style.display = 'none';
  document.body.appendChild(inp);
  inp.onchange = async function(){
    const file = inp.files && inp.files[0];
    try{ inp.remove(); }catch(_){}
    if(!file) return;
    toast('Uploading replacement…');
    try{
      let url = '';
      if(typeof uploadBroadcastFile === 'function') url = await uploadBroadcastFile(file);
      else if(typeof uploadVideoToR2 === 'function') url = await uploadVideoToR2(file);
      if(!url) throw new Error('Upload failed');
      const ch = bspaceChapterList[index];
      ch.status = 'replaced';
      ch.replacementUrl = url;
      ch.replacedAt = Date.now();
      await persistBroadcastChapters();
      toast('Chapter replaced');
      playBroadcastChapter(index, true);
      wireBroadcastChapterPlayer(bspaceChapterList, bspaceBreatherList, { showChips: true });
    }catch(e){
      toast((e && e.message) || 'Replace failed');
    }
  };
  inp.click();
}
