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
    let rawSrc = (chapters && chapters[0] && chapters[0].mediaUrl) || seg.videoUrl || seg.dataUrl || '';
    if(typeof resolveMediaUrl === 'function') rawSrc = resolveMediaUrl(rawSrc) || rawSrc;
    // Visible chapter chips only when real chapters (not silent upload parts)
    const showChapters = chapters && chapters.length > 1 && !chapters.every(c => c.silent);
    host.innerHTML = `
      <div class="bspace-media-frame" style="position:relative;width:100%;background:#000;border-radius:14px;overflow:hidden;min-height:180px;">
        <video id="bspaceVideoEl" controls playsinline preload="metadata" src="${bspaceEscape(rawSrc)}" poster="${seg.thumbDataUrl ? bspaceEscape(seg.thumbDataUrl) : ''}" style="width:100%;max-height:52vh;display:block;background:#000;filter:${seg.filterCss || ''}"></video>
        <div id="bspaceBreather" style="display:none;position:absolute;inset:0;background:rgba(13,15,23,.92);align-items:center;justify-content:center;flex-direction:column;gap:10px;z-index:3;">
          <div style="font-family:var(--font-futuristic);font-size:15px;color:var(--mint);" id="bspaceBreatherLabel">Chapter break</div>
          <div style="font-family:var(--font-mono);font-size:11px;color:var(--text-dim);" id="bspaceBreatherAd">Next chapter in a moment</div>
        </div>
      </div>
      `;
    const vel = $('bspaceVideoEl');
    if(vel && typeof bindMediaElement === 'function') bindMediaElement(vel, rawSrc);
    else if(vel){ vel.src = rawSrc; }
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
  if(!docs.length){
    el.innerHTML = `<div class="bspace-card"><div class="body" style="color:var(--text-dim);">No messages yet. Say hello, leave a voice note, or share a photo.</div></div>`;
    return;
  }
  el.innerHTML = docs.map(d=>{
    const m = d.data();
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

function renderBspaceRelated(){
  const el = $('bspaceRelated');
  if(!el) return;
  const others = (connectionsSignals || []).slice(0, 6).filter(x => {
    if(!activeBroadcastMeta) return true;
    return x.contact && x.contact.id !== activeBroadcastMeta.contactId;
  });
  if(!others.length){
    el.innerHTML = `<div class="bspace-card"><div class="body" style="color:var(--text-dim);">Related Broadcasts from your frequencies will appear here.</div></div>`;
    return;
  }
  el.innerHTML = others.map(({ contact:c, latest })=>{
    return `<div class="bspace-card" role="button" data-rel-b="${c.id}" style="cursor:pointer;">
      <div class="who">${bspaceEscape(c.name)} · ${signalMeta[computeSignal(c).tier].label}</div>
      <div class="body" style="color:var(--text-dim);">Open their Broadcast space</div>
    </div>`;
  }).join('');
  el.querySelectorAll('[data-rel-b]').forEach(node=>{
    node.onclick = ()=>{
      closeBroadcastSpace();
      openBroadcast(parseInt(node.dataset.relB, 10));
    };
  });
}

function listenBspaceCollection(colName, renderFn, orderField){
  if(!fbDb || !activeBroadcastId) return;
  const q = fbDb.collection('broadcasts').doc(activeBroadcastId).collection(colName).orderBy(orderField || 'ts', 'asc').limit(80);
  const unsub = q.onSnapshot(snap => renderFn(snap.docs), ()=> renderFn([]));
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
  $('bspaceCreatorMeta').textContent = meta.isMine ? 'Your Broadcast' : 'Broadcast space';
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

  // Membership button
  try{
    const doc = await fbDb.collection('broadcasts').doc(activeBroadcastId).get();
    const members = (doc.exists && doc.data().memberUids) || [];
    const joined = members.includes(currentUser.uid);
    $('bspaceJoinBtn').textContent = joined ? 'You’re in this community' : 'Join community';
    $('bspaceJoinBtn').classList.toggle('joined', joined);
  }catch(e){
    $('bspaceJoinBtn').textContent = 'Join community';
  }

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
  if(vid){ try{ vid.pause(); }catch(e){} }
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
  if(btn){ btn.disabled = true; btn.textContent = 'Joining…'; }
  try{
    const ref = fbDb.collection('broadcasts').doc(activeBroadcastId);
    await ref.set({
      memberUids: firebase.firestore.FieldValue.arrayUnion(currentUser.uid),
      updatedAt: Date.now(),
    }, { merge:true });
    try{
      await ref.collection('journey').add({
        type: 'join',
        text: ((currentProfile && currentProfile.name) || 'Someone') + ' joined the community',
        ts: Date.now(),
        by: currentUser.uid,
      });
    }catch(_){}
    if(btn){
      btn.textContent = 'You’re in this community';
      btn.classList.add('joined');
      btn.disabled = false;
    }
    toast('Welcome in');
  }catch(e){
    console.warn('[bspace] join', e);
    if(btn){ btn.disabled = false; btn.textContent = 'Join community'; }
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
  if(liveBlob && liveBlob.size > 1000 && bcastId && currentUser && typeof uploadVideoToR2 === 'function'){
    toast('Saving live recording…');
    const job = {
      label: 'Saving live recording…',
      doneMsg: 'Live saved as chapter',
      run: async (progress)=>{
        if(progress) progress('Uploading live recording…');
        const url = await uploadVideoToR2(liveBlob);
        const ref = fbDb.collection('broadcasts').doc(bcastId);
        const snap = await ref.get();
        if(!snap.exists) return;
        const d = snap.data() || {};
        const chapters = Array.isArray(d.chapters) ? d.chapters.slice() : [];
        const idx = chapters.length;
        chapters.push({
          index: idx,
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
  if(bspaceLiveStream){ await bspaceStopLive(); toast('Live ended'); return; }
  try{
    bspaceLiveStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
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
      bspaceLiveRecorder.ondataavailable = e=>{ if(e.data && e.data.size) bspaceLiveChunks.push(e.data); };
      bspaceLiveRecorder.start(1000);
    }catch(e){ console.warn('[live] record start', e); bspaceLiveRecorder = null; }
  }
  await bspacePost('conversation', { type:'system', text: ((currentProfile && currentProfile.name) || 'Creator') + ' went live — this is a new chapter of the same Broadcast.' });
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
      if(d.live && !bspaceLiveStream){
        badge.style.display = 'block';
        badge.textContent = 'LIVE NOW';
      } else if(!bspaceLiveStream){
        badge.style.display = 'none';
      }
    }
    if(typeof bLiveOnSpaceOpened === 'function'){
      bLiveOnSpaceOpened(!!d.live, isCreator);
    }
    // Auto-prompt join once when going live
    if(d.live && !isCreator && !bspaceLiveStream && typeof bLiveJoinAsViewer === 'function'){
      const bar = $('bspaceReactionBar');
      if(bar) bar.style.display = 'flex';
    }
  }, ()=>{});
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
    const segment = {
      type: d.mediaType || 'photo',
      dataUrl: d.mediaType === 'photo' ? (d.mediaUrl || null) : null,
      mediaUrl: d.mediaUrl || null,
      videoUrl: d.mediaType === 'video' ? (d.mediaUrl || null) : null,
      thumbDataUrl: d.thumbUrl || null,
      text: d.mediaType === 'text' ? (d.description || d.title) : null,
      bg: 'linear-gradient(160deg,#1a1f2e,#0d1018)',
      filterCss: d.filterCss || '',
      caption: d.description || '',
      chapters: d.chapters || null,
    };
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

function wireBroadcastChapterPlayer(chapters, breathers, opts){
  opts = opts || {};
  bspaceChapterList = Array.isArray(chapters) ? chapters.slice().sort((a,b)=>(a.index||0)-(b.index||0)) : [];
  bspaceBreatherList = Array.isArray(breathers) ? breathers : [];
  bspaceChapterIndex = 0;
  const v = $('bspaceVideoEl');
  if(!v) return;
  // Resolve src for first chapter
  if(bspaceChapterList[0] && bspaceChapterList[0].mediaUrl && typeof resolveMediaUrl === 'function'){
    v.src = resolveMediaUrl(bspaceChapterList[0].mediaUrl);
  }

  const bar = $('bspaceChapterBar');
  if(bar && opts.showChips && bspaceChapterList.length > 1){
    bar.innerHTML = bspaceChapterList.map((ch,i)=>
      `<button type="button" data-ch="${i}" style="font-family:var(--font-mono);font-size:10px;padding:4px 8px;border-radius:999px;border:1px solid var(--line);background:${i===0?'rgba(124,255,178,.15)':'transparent'};color:${i===0?'var(--mint)':'var(--text-dim)'};cursor:pointer;">${bspaceEscape(ch.title || ('Ch '+(i+1)))}</button>`
    ).join('');
    bar.querySelectorAll('[data-ch]').forEach(btn=>{
      btn.onclick = ()=> playBroadcastChapter(parseInt(btn.getAttribute('data-ch'),10), true);
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
    if(bspaceChapterList.length <= 1) return;
    const br = bspaceBreatherList.find(b => b.afterChapterIndex === bspaceChapterIndex);
    const next = bspaceChapterIndex + 1;
    if(next >= bspaceChapterList.length) return;
    if(br){
      showBreatherAdSlot(br, ()=> playBroadcastChapter(next, false));
    } else {
      playBroadcastChapter(next, false);
    }
  };
}

function playBroadcastChapter(index, userInitiated){
  const ch = bspaceChapterList[index];
  if(!ch || !ch.mediaUrl) return;
  bspaceChapterIndex = index;
  const v = $('bspaceVideoEl');
  if(!v) return;
  v.src = (typeof resolveMediaUrl === 'function') ? resolveMediaUrl(ch.mediaUrl) : ch.mediaUrl;
  v.play().catch(()=>{});
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


(function wireBspaceExpand(){
  function bind(){
    const btn = document.getElementById('bspaceExpandBtn');
    if(!btn || btn.dataset.wired) return;
    btn.dataset.wired = '1';
    btn.onclick = function(e){
      e.preventDefault();
      e.stopPropagation();
      const hero = document.getElementById('bspaceHero');
      if(!hero) return;
      hero.classList.toggle('expanded');
      btn.style.transform = hero.classList.contains('expanded') ? 'rotate(180deg)' : '';
    };
  }
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind);
  else bind();
})();
