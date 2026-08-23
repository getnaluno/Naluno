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
  host.innerHTML = '';
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
    if(typeof resolveMediaUrl === 'function') rawSrc = resolveMediaUrl(rawSrc) || rawSrc;
    // Visible chapter chips only when real chapters (not silent upload parts)
    const showChapters = chapters && chapters.length > 1 && !chapters.every(c => c.silent);
    host.innerHTML = `
      <div class="bspace-media-frame" style="position:relative;width:100%;height:100%;background:#000;overflow:hidden;min-height:180px;">
        <video id="bspaceVideoEl" playsinline webkit-playsinline preload="auto" poster="${seg.thumbDataUrl ? bspaceEscape(seg.thumbDataUrl) : ''}" style="width:100%;height:100%;object-fit:contain;display:block;background:#000;filter:${seg.filterCss || ''}"></video>
        <div id="bspaceBreather" style="display:none;position:absolute;inset:0;background:rgba(13,15,23,.92);align-items:center;justify-content:center;flex-direction:column;gap:10px;z-index:3;">
          <div style="font-family:var(--font-futuristic);font-size:15px;color:var(--mint);" id="bspaceBreatherLabel">Chapter break</div>
          <div style="font-family:var(--font-mono);font-size:11px;color:var(--text-dim);" id="bspaceBreatherAd">Next chapter in a moment</div>
          <button type="button" id="bspaceReplaceChBtn" style="display:none;margin-top:8px;padding:8px 14px;border-radius:999px;border:1px solid var(--line);background:rgba(124,255,178,.12);color:var(--mint);font-family:var(--font-mono);font-size:12px;">Replace chapter</button>
        </div>
      </div>
      `;
    const vel = $('bspaceVideoEl');
    if(vel && typeof bindMediaElement === 'function') bindMediaElement(vel, rawSrc);
    else if(vel){ vel.preload = 'auto'; vel.src = rawSrc; }
    // Dock seek bar BELOW the 9:16 hero (sibling), not inside cover frame
    try{
      const hero = $('bspaceHero');
      let dock = $('bspaceSeekDock');
      if(dock) dock.remove();
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
    }catch(e){ console.warn('[bspace] seek dock', e); }
    try{ wireBspaceSeekAndAutoplay(vel); }catch(e){ console.warn('[bspace] seek wire', e); }
    if(vel){
      vel.addEventListener('error', function(){
        console.warn('[bspace] video error', vel.error && vel.error.code, vel.src);
        // Retry once with resolved URL + cache bust
        if(!vel.dataset.retried && rawSrc){
          vel.dataset.retried = '1';
          const u = rawSrc + (rawSrc.indexOf('?') >= 0 ? '&' : '?') + 'r=' + Date.now();
          vel.src = u;
          vel.load();
          vel.play().catch(function(){});
        }
      });
      // Force play attempt (poster alone looks like a still snapshot)
      setTimeout(function(){
        if(vel.paused){
          vel.play().catch(function(){
            vel.muted = true;
            vel.play().catch(function(){});
          });
        }
      }, 200);
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
    if(m.type === 'system' || m.type === 'live') return true;
    const t = (m.text || '').toLowerCase();
    return t.indexOf('went live') >= 0 || t.indexOf('is live now') >= 0 || t.indexOf('join live') >= 0;
  };

  const pinned = [];
  const rest = [];
  (docs || []).forEach(d=>{
    const m = d.data ? d.data() : d;
    if(isLiveSystem(m)) pinned.push({ d, m });
    else rest.push({ d, m });
  });

  // Newest live notice only (top of conversation, not buried)
  if(pinned.length){
    pinned.sort((a,b)=> (b.m.ts||0) - (a.m.ts||0));
    const latest = pinned[0].m;
    pin.style.display = 'block';
    pin.innerHTML = `<div class="bspace-card" style="border:1px solid rgba(124,255,178,.45);background:rgba(124,255,178,.08);">
      <div class="who" style="color:var(--mint);">● LIVE · ${timeAgo(latest.ts || Date.now())}</div>
      <div class="body" style="font-weight:600;">${bspaceEscape(latest.text || 'Creator went live')}</div>
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
  const isOwner = !!(typeof currentUser !== 'undefined' && currentUser && creatorUid && currentUser.uid === creatorUid);
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
    if(isOwner && fbDb && creatorUid){
      try{
        const t = await fbDb.collection('toga').doc(creatorUid).get();
        if(t.exists && typeof (t.data() || {}).viewsTotal === 'number'){
          total = (t.data() || {}).viewsTotal || 0;
        } else {
          const mine = ((typeof feedBroadcasts !== 'undefined' && feedBroadcasts) || []).filter(function(x){ return x.creatorUid === creatorUid; });
          total = mine.reduce(function(n, x){ return n + (Number(x.views) || 0); }, 0);
          if(!total) total = views;
        }
      }catch(_){ total = views; }
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
      +   '<div class="bspace-stat-h">' + (strand ? ('Private · every Broadcast') : 'Private · every Broadcast you published') + '</div>'
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
      el.innerHTML = `<div class="bspace-card"><div class="body" style="color:var(--text-dim);">${bspaceEscape(rel && rel.label ? rel.label : 'Related Broadcasts will appear from this Strand.')}</div></div>`;
      return;
    }
    const head = `<div class="hint" style="margin-bottom:8px;">${bspaceEscape(rel.label || 'Related')}</div>`;
    el.innerHTML = head + rel.items.map(function(item){
      return `<div class="bspace-card" role="button" data-rel-id="${bspaceEscape(item.id)}" style="cursor:pointer;">
        <div class="who">${bspaceEscape(item.creatorName || 'Someone')}${item.strandName ? ' · ' + bspaceEscape(item.strandName) : ''}</div>
        <div class="body">${bspaceEscape(item.title || 'Broadcast')}</div>
      </div>`;
    }).join('');
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

  $('bspace').classList.add('active');
  $('bspaceScroll').scrollTop = 0;

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

  // Membership button — join the creator, not a single Broadcast
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
        const name = (meta.creatorName || 'this creator').split(' ')[0];
        btn.textContent = joined ? ('With ' + name) : ('Join ' + name);
        btn.classList.toggle('joined', joined);
      }
    }
  }catch(e){
    $('bspaceJoinBtn').textContent = 'Join this creator';
  }

  try{
    if(typeof recordBroadcastView === 'function'){
      recordBroadcastView(activeBroadcastId, meta.creatorUid);
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
    if(navigator.mediaSession){
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
      btn.textContent = 'With ' + name;
      btn.classList.add('joined');
      btn.disabled = false;
    }
    toast('You’re with ' + name + ' — every Broadcast of theirs');
  }catch(e){
    console.warn('[bspace] join', e);
    if(btn){ btn.disabled = false; btn.textContent = 'Join this creator'; }
    toast(e.message || 'Couldn’t join — check connection / rules');
  }
};

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
    const cells = [
      ['Community', members.length],
      ['Conversations', conv.size],
      ['Questions', qs.size],
      ['Answered', answered],
      ['Results', res.size],
      ['Resources', resources.size],
    ];
    grid.innerHTML = cells.map(([label, n]) =>
      `<div class="bspace-card" style="margin:0;text-align:center;padding:14px 8px;">
        <div style="font-family:var(--font-futuristic);font-size:22px;color:var(--mint);">${n}</div>
        <div style="font-family:var(--font-mono);font-size:10px;color:var(--text-dim);margin-top:4px;">${label}</div>
      </div>`
    ).join('');
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
    fbDb.collection('broadcasts').doc(bcastId).set({
      live: false,
      liveAt: null,
      liveBy: null,
    }, { merge:true }).catch(()=>{});
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
    if(v){ v.srcObject = bspaceLiveStream; v.play().catch(()=>{}); }
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
  await bspacePost('conversation', { type:'system', text: ((currentProfile && currentProfile.name) || 'Creator') + ' is live now — tap Join live to watch.' });
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

// Watch live flag when viewing someone else's broadcast
function bspaceWatchLiveState(){
  if(!fbDb || !activeBroadcastId) return;
  const unsub = fbDb.collection('broadcasts').doc(activeBroadcastId).onSnapshot(doc=>{
    if(!doc.exists) return;
    const d = doc.data() || {};
    const badge = $('bspaceLiveBadge');
    const isCreator = !!(activeBroadcastMeta && (activeBroadcastMeta.isMine || (currentUser && activeBroadcastMeta.creatorUid === currentUser.uid)));
    if(badge){
      if(d.live){
        badge.style.display = 'block';
        badge.textContent = isCreator ? 'LIVE' : 'LIVE NOW — JOIN';
      } else if(!bspaceLiveStream){
        badge.style.display = 'none';
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
        await navigator.share({ title: (activeBroadcastMeta && activeBroadcastMeta.title) || 'Naluno Broadcast', url: link });
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
    if(durEl) durEl.textContent = (isFinite(d) && d > 0) ? formatBspaceTime(d) : '0:00';
    if(curEl) curEl.textContent = formatBspaceTime(v.currentTime);
    if(range && isFinite(d) && d > 0 && !scrubbing){
      range.value = String(Math.round((v.currentTime / d) * 1000));
    }
  }

  if(range){
    const seekTo = ()=>{
      const d = v.duration;
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
        const p = v.play();
        if(p && p.catch) p.catch(()=>{});
      } else {
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
    const d = v.duration;
    const t = v.currentTime || 0;
    const falseEnd = (typeof nalunoFiniteDuration === 'function')
      ? (!nalunoFiniteDuration(d) || t < d - 0.45)
      : (!isFinite(d) || t < (d || 0) - 0.45);
    if(falseEnd){
      try{ v.preload = 'auto'; v.currentTime = Math.max(0, t + 0.001); }catch(_){}
      v.play().catch(function(){});
    }
  });
  syncPlayBtn();
  syncTimes();
}

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
    if(shared) return; // one file already finished
    if(bspaceChapterList.length <= 1) return;
    const next = bspaceChapterIndex + 1;
    if(next >= bspaceChapterList.length) return;
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
    v.load();
    const kick = function(){
      const p = v.play();
      if(p && p.catch) p.catch(function(){ try{ v.muted = true; v.play().catch(function(){}); }catch(_){} });
    };
    if(v.readyState >= 2) kick();
    else v.addEventListener('loadeddata', kick, { once: true });
    v.onended = function(){
      const nxt = (typeof nextActiveChapterIndex === 'function') ? nextActiveChapterIndex(bspaceChapterList, index) : index + 1;
      if(nxt >= 0) playBroadcastChapter(nxt, false);
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
      v.load();
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
    v.load();
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
   Fit = full picture (contain). Fill = crop to stage (cover). */

let bspaceFitMode = 'fit'; // 'fit' | 'fill'

function adaptBspaceHeroToVideo(){
  const hero = $('bspaceHero');
  const v = $('bspaceVideoEl');
  if(!hero || !v) return;
  hero.style.width = '100%';
  hero.style.background = '#000';
  hero.style.maxHeight = 'min(82vh, 780px)';

  const apply = function(){
    const w = v.videoWidth || 0;
    const h = v.videoHeight || 0;
    const landscape = w > 0 && h > 0 && w >= h;
    const portrait = w > 0 && h > 0 && h > w;
    let orientLandscape = false;
    try{
      if(screen.orientation && screen.orientation.type){
        orientLandscape = String(screen.orientation.type).indexOf('landscape') >= 0;
      } else if(typeof window.orientation === 'number'){
        orientLandscape = Math.abs(window.orientation) === 90;
      } else {
        orientLandscape = window.innerWidth > window.innerHeight;
      }
    }catch(_){}

    if(w > 0 && h > 0){
      hero.style.aspectRatio = w + ' / ' + h;
    } else {
      hero.style.aspectRatio = '9 / 16';
    }

    if(orientLandscape && landscape){
      hero.style.maxHeight = '100dvh';
      hero.style.height = '100dvh';
      hero.style.width = '100%';
      hero.style.borderRadius = '0';
      try{
        document.body.classList.add('naluno-landscape-media');
        const app = document.querySelector('.app');
        if(app) app.classList.add('naluno-landscape-media');
      }catch(_){}
    } else {
      hero.style.maxHeight = 'min(82vh, 780px)';
      hero.style.height = '';
      hero.style.borderRadius = '';
      try{
        document.body.classList.remove('naluno-landscape-media');
        const app = document.querySelector('.app');
        if(app) app.classList.remove('naluno-landscape-media');
      }catch(_){}
    }

    v.style.width = '100%';
    v.style.height = '100%';
    v.style.objectFit = bspaceFitMode === 'fill' ? 'cover' : 'contain';
  };

  v.addEventListener('loadedmetadata', apply);
  v.addEventListener('loadeddata', apply);
  if(v.readyState >= 1) apply();
  apply();

  let chip = $('bspaceFitToggle');
  if(!chip && hero){
    chip = document.createElement('button');
    chip.type = 'button';
    chip.id = 'bspaceFitToggle';
    chip.addEventListener('click', function(e){
      if(e){ e.preventDefault(); e.stopPropagation(); }
      bspaceFitMode = bspaceFitMode === 'fill' ? 'fit' : 'fill';
      chip.textContent = bspaceFitMode === 'fill' ? 'Fit' : 'Fill';
      apply();
    });
    hero.appendChild(chip);
  }
  if(chip){
    chip.textContent = bspaceFitMode === 'fill' ? 'Fit' : 'Fill';
    chip.title = 'Fit shows the whole picture. Fill crops to the stage.';
  }

  try{
    if(!window.__nalunoBspaceOrientHook){
      window.__nalunoBspaceOrientHook = true;
      const re = function(){ try{ adaptBspaceHeroToVideo(); }catch(_){} };
      window.addEventListener('orientationchange', re);
      window.addEventListener('resize', re);
      if(screen.orientation && screen.orientation.addEventListener){
        screen.orientation.addEventListener('change', re);
      }
    }
  }catch(_){}
}


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
