
/* Band offline outbox — send when back online */
const BAND_OUTBOX_KEY = 'naluno:bandOutbox:v1';
function loadBandOutbox(){
  try{ return JSON.parse(localStorage.getItem(BAND_OUTBOX_KEY) || '[]'); }catch(_){ return []; }
}
function saveBandOutbox(rows){
  try{ localStorage.setItem(BAND_OUTBOX_KEY, JSON.stringify(rows || [])); }catch(_){}
}
function queueBandMessage(bandId, payload, preview){
  const rows = loadBandOutbox();
  rows.push({ id: 'b'+Date.now()+Math.random().toString(36).slice(2,6), bandId, payload, preview, ts: Date.now() });
  saveBandOutbox(rows);
}
async function flushBandOutbox(){
  if(!navigator.onLine || !fbDb || !currentUser) return;
  const rows = loadBandOutbox();
  if(!rows.length) return;
  const left = [];
  for(const row of rows){
    try{
      const ref = fbDb.collection('bands').doc(row.bandId).collection('messages');
      await ref.add(Object.assign({}, row.payload, {
        from: currentUser.uid,
        ts: firebase.firestore.FieldValue.serverTimestamp(),
      }));
    }catch(e){ left.push(row); }
  }
  saveBandOutbox(left);
}
window.addEventListener('online', function(){ try{ flushBandOutbox(); }catch(_){} });


/* Pagination: load older band messages (Phase 3 scale). */
let bandOldestMsgDoc = null;
async function loadOlderBandMessages(){
  if(!fbDb || !currentBandId) return;
  const bandRef = fbDb.collection('bands').doc(currentBandId);
  let q = bandRef.collection('messages').orderBy('ts','desc').limit(40);
  if(bandOldestMsgDoc) q = q.startAfter(bandOldestMsgDoc);
  try{
    const snap = await q.get();
    if(snap.empty){ if(typeof toast==='function') toast('No older messages'); return; }
    bandOldestMsgDoc = snap.docs[snap.docs.length - 1];
    if(typeof trackMetric === 'function') trackMetric('band_load_older', { n: snap.size });
    // Prepend handled by full snapshot on new writes; for older, merge into DOM if renderBandMessages exists
    if(typeof renderBandMessagesFromDocs === 'function'){
      renderBandMessagesFromDocs(snap.docs.slice().reverse(), true);
    }
  }catch(e){ console.warn('[band] load older', e); }
}

/* ============================================================
   MODULE: js/band-room.js
   Band room UI, presence, settle clock, record audio/video, invites, band E2E
   OWNERSHIP: change this domain here only.
   Scripts share globals (intentional) so load order matches the old monolith.
   ============================================================ */
/* ---------------- BAND ROOM ---------------- */
let activeBandId = null;
let amTunedIn = false;
let bandMessages = {}; // { [bandId]: [{ fromMe, contactId?, fromUid?, text, ts }] } — ephemeral, in-memory only.
                        // A Band is a moment, not a record — unlike Wireline, nothing here persists,
                        // real or demo alike, on purpose.
let bandAmbientTimer = null;
let bandAnimFrame = null;
let bandAnimStart = performance.now();
let bandPresenceUnsub = null;
let bandMessagesUnsub = null;
let realBandLiveMembers = []; // resolved {uid,name,color,initials} for who's actually tuned in, real bands only

function activeBand(){ return bands.find(b=>b.id===activeBandId); }

function bandMessageIsEmpty(m){
  if(!m) return true;
  if(m.type === 'audio' || m.type === 'video') return !m.mediaUrl || String(m.mediaUrl).length < 8;
  if(m.type === 'invite' || m.type === 'system') return false;
  return !(m.text && String(m.text).trim());
}
function bandMessageHtml(m){
  if(bandMessageIsEmpty(m)) return '';

  if(m.type === 'system'){
    return `<div style="text-align:center; font-family:var(--font-mono); font-size:11px; color:rgba(255,255,255,.45); padding:4px 8px;">${escapeHtml(m.text)}</div>`;
  }
  if(m.type === 'invite'){
    return `<div class="msg-row them"><div style="font-size:10.5px; color:var(--mint); margin-bottom:3px; padding:0 3px;">Invite</div><div class="msg-bubble" style="border:1px solid rgba(124,255,178,.35);">${escapeHtml(m.text)}</div><div class="msg-time">${formatClockTime(m.ts)}</div></div>`;
  }
  let name = 'You';
  if(!m.fromMe){
    name = 'Someone';
    if(m.fromUid){
      const b = activeBand();
      const info = b && (b.memberInfo||[]).find(mm=>mm.uid===m.fromUid);
      name = info ? info.name.split(' ')[0] : 'Someone';
    } else {
      const c = contacts.find(x=>x.id===m.contactId);
      name = c ? c.name.split(' ')[0] : 'Someone';
    }
  }
  const rowClass = m.fromMe ? 'msg-row me' : 'msg-row them';
  const nameHtml = m.fromMe ? '' : `<div style="font-size:10.5px; color:var(--text-dim); margin-bottom:3px; padding:0 3px;">${escapeHtml(name)}</div>`;
  const dur = m.duration ? Math.round(m.duration) + 's' : '';
  if(m.type === 'audio' && m.mediaUrl){
    const labelColor = m.fromMe ? 'rgba(13,15,23,.7)' : 'var(--mint)';
    const src = (typeof resolveMediaUrl === 'function') ? resolveMediaUrl(m.mediaUrl) : m.mediaUrl;
    return `<div class="${rowClass}">${nameHtml}<div class="msg-bubble band-voice-bubble">
      <div class="band-voice-label" style="color:${labelColor}">Voice · ${dur || 'clip'}</div>
      <video class="band-audio-player" controls playsinline preload="metadata" src="${escapeHtml(src)}"></video>
    </div><div class="msg-time">${formatClockTime(m.ts)}</div></div>`;
  }
  if(m.type === 'video' && m.mediaUrl){
    const src = (typeof resolveMediaUrl === 'function') ? resolveMediaUrl(m.mediaUrl) : m.mediaUrl;
    return `<div class="${rowClass}">${nameHtml}<div class="msg-bubble" style="padding:8px; background:rgba(0,0,0,.35);">
      <div style="font-family:var(--font-mono); font-size:10px; color:var(--mint); margin:0 0 6px 4px;">Video · ${dur || 'clip'}</div>
      <video controls playsinline preload="metadata" src="${escapeHtml(src)}" poster="${m.thumb ? escapeHtml(m.thumb) : ''}" style="width:100%; max-width:260px; border-radius:12px; background:#000; display:block;"></video>
    </div><div class="msg-time">${formatClockTime(m.ts)}</div></div>`;
  }
  return `<div class="${rowClass}">${nameHtml}<div class="msg-bubble">${escapeHtml(m.text || '')}</div><div class="msg-time">${formatClockTime(m.ts)}</div></div>`;
}
function bandIsSettled(b){
  if(!b || !b.lastEmptiedAt) return false;
  const liveCount = (b.isReal ? realBandLiveMembers.length : 0) + (amTunedIn ? 1 : 0);
  if(liveCount > 0) return false;
  return (Date.now() - b.lastEmptiedAt) >= BAND_SETTLE_MS;
}
function updateBandSettleNote(){
  const el = $('bandSettleNote'); if(!el) return;
  const b = activeBand();
  if(!b){ el.textContent = 'Band'; return; }
  const liveCount = (b.isReal ? realBandLiveMembers.length : 0) + (amTunedIn ? 1 : 0);
  if(liveCount > 0){
    el.textContent = 'People here · messages stay until everyone leaves';
    return;
  }
  if(b.lastEmptiedAt){
    const left = BAND_SETTLE_MS - (Date.now() - b.lastEmptiedAt);
    if(left <= 0){
      el.textContent = 'Cleared · next messages start fresh';
      return;
    }
    const mins = Math.ceil(left / 60000);
    if(mins >= 60){
      const h = Math.floor(mins/60), m = mins % 60;
      el.textContent = 'Clears in ' + h + 'h' + (m ? (' ' + m + 'm') : '');
    } else {
      el.textContent = 'Clears in ' + mins + 'm';
    }
    return;
  }
  el.textContent = 'Band · messages clear 2h after the last person leaves';
}
function renderBandMessages(){
  const b = activeBand();
  let msgs = bandMessages[activeBandId] || [];
  // After the settle window, the square is a blank page again.
  if(b && bandIsSettled(b)) msgs = [];
  else if(b){
    // messageEpoch: only show messages from the current "session" after a full wipe
    const epoch = b.messageEpoch || 0;
    if(epoch){
      msgs = msgs.filter(m => (m.ts || 0) >= epoch);
    }
  }
  // Drop empty text bubbles (failed decrypt / pruned payload shells)
  msgs = msgs.filter(m => !bandMessageIsEmpty(m));
  if(msgs.length===0){
    $('bandMessages').innerHTML = `<div class="msg-empty"><span style="font-family:var(--font-futuristic); font-size:14px; color:#fff;">Quiet on this Band</span><span style="font-size:12.5px; color:rgba(255,255,255,.6);">Tune in and say something — it clears 2h after the last person leaves.</span></div>`;
    updateBandSettleNote();
    return;
  }
  $('bandMessages').innerHTML = msgs.map(bandMessageHtml).join('');
  $('bandMessages').scrollTop = $('bandMessages').scrollHeight;
  updateBandSettleNote();
}
function renderBandRoster(){
  const b = activeBand(); if(!b) return;
  const live = b.isReal ? realBandLiveMembers : liveBandMembers(b);
  let html = live.map(c=>{
    return `<div style="display:flex; flex-direction:column; align-items:center; gap:5px; flex-shrink:0;">
      <div class="avatar" style="width:44px;height:44px;font-size:14px;${contactAvatarStyleAttr(c)}position:relative;">${c.photo&&c.photo.dataUrl?'':c.initials}${b.isReal ? '' : signalBarsHtml(c)}</div>
      <span style="font-size:10.5px; color:rgba(255,255,255,.75); font-family:var(--font-mono);">${escapeHtml((c.name||'').split(' ')[0])}</span>
    </div>`;
  }).join('');
  if(amTunedIn){
    const myStyle = contactAvatarStyleAttr(currentProfile.photo && currentProfile.photo.dataUrl ? currentProfile : { color:'var(--mint)' });
    const myText = (currentProfile.photo && currentProfile.photo.dataUrl) ? '' : 'You';
    html += `<div style="display:flex; flex-direction:column; align-items:center; gap:5px; flex-shrink:0;">
      <div class="avatar" style="width:44px;height:44px;font-size:13px;${myStyle}color:#0D0F17;">${myText}</div>
      <span style="font-size:10.5px; color:var(--mint); font-family:var(--font-mono);">You</span>
    </div>`;
  }
  $('bandRoster').innerHTML = html || `<span style="color:rgba(255,255,255,.6); font-size:12.5px; padding:6px 2px;">No one's tuned in right now.</span>`;
  const liveCount = live.length + (amTunedIn ? 1 : 0);
  $('bandRoomLiveCount').textContent = liveCount===0 ? 'Quiet right now' : liveCount + (liveCount===1 ? ' tuned in' : ' tuned in');
}
function refreshBandRoom(){
  if(!activeBandId) return;
  const b = activeBand();
  if(b && b.isReal) return; // real presence updates itself via the live Firestore listener
  renderBandRoster();
  if(amTunedIn) armBandAmbientReply(); // roster may have changed who's actually here to talk
}

function startBandAmbientAnim(vibeKey){
  bandAnimStart = performance.now();
  const preset = backgroundPresets[vibeKey];
  const painter = (preset && preset.type==='canvas') ? preset.painter : paintAurora;
  function tick(now){
    if(!$('bandRoom').classList.contains('active')){ bandAnimFrame = null; return; }
    const c = $('bandBgCanvas');
    ensureCanvasSize(c);
    painter(c.getContext('2d'), c.width, c.height, (now-bandAnimStart)/1000);
    bandAnimFrame = requestAnimationFrame(tick);
  }
  if(bandAnimFrame) cancelAnimationFrame(bandAnimFrame);
  bandAnimFrame = requestAnimationFrame(tick);
}
function stopBandAmbientAnim(){ if(bandAnimFrame){ cancelAnimationFrame(bandAnimFrame); bandAnimFrame = null; } }

function clearBandAmbientTimer(){ clearTimeout(bandAmbientTimer); bandAmbientTimer = null; }
/* While you're tuned in, whoever's actually here might say something — never scripted to
   you specifically, since a Band isn't a conversation aimed at you the way Wireline is.
   Demo bands only — a real band never gets simulated banter, since real people might
   actually be there and faking a voice among them would be exactly the kind of lie
   this app has avoided everywhere else. */
function armBandAmbientReply(){
  clearBandAmbientTimer();
  const b = activeBand();
  if(!b || b.isReal || !amTunedIn) return;
  const live = liveBandMembers(b);
  if(live.length===0) return; // nothing to simulate in an empty room
  bandAmbientTimer = setTimeout(()=>{
    if(!amTunedIn || activeBandId !== b.id) return;
    const stillLive = liveBandMembers(b);
    if(stillLive.length===0){ renderBandRoster(); return; }
    const speaker = stillLive[Math.floor(Math.random()*stillLive.length)];
    const lines = ['anyone else up rn','this is nice, just vibing here','😂😂','brb','lol true','what song is this','good to have people around','quiet tonight'];
    const text = lines[Math.floor(Math.random()*lines.length)];
    if(!bandMessages[b.id]) bandMessages[b.id] = [];
    bandMessages[b.id].push({ fromMe:false, contactId: speaker.id, text, ts: Date.now() });
    if(activeBandId===b.id) renderBandMessages();
    armBandAmbientReply();
  }, 6000 + Math.random()*9000);
}

let bandMetaUnsub = null;
let bandSettleTimer = null;
let bandInviteUnsub = null;

async function pruneSettledBandMessages(bandRef, b){
  if(!bandRef || !b || !bandIsSettled(b)) return;
  if(b._pruning) return;
  b._pruning = true;
  try{
    // Paginate deletes so the square is actually empty, not 80-of-N leftovers
    for(let i = 0; i < 10; i++){
      const snap = await bandRef.collection('messages').limit(80).get();
      if(snap.empty) break;
      const batch = fbDb.batch();
      snap.docs.forEach(d => batch.delete(d.ref));
      await batch.commit();
      if(snap.size < 80) break;
    }
    // New session boundary — client ignores older shells even if a delete lags
    const epoch = Date.now();
    b.messageEpoch = epoch;
    await bandRef.set({
      messageEpoch: epoch,
      lastEmptiedAt: firebase.firestore.FieldValue.serverTimestamp(),
    }, { merge:true });
    if(activeBandId && bandMessages[activeBandId]) bandMessages[activeBandId] = [];
  }catch(e){ console.warn('[band] prune', e); }
  finally{ b._pruning = false; }
}

function openBandRoom(id){
  const b = bands.find(x=>x.id===id); if(!b) return;
  activeBandId = id;
  amTunedIn = false;
  $('bandRoomName').textContent = b.name;
  $('bandTuneBtn').textContent = 'Tune in';
  $('bandTuneBtn').style.background = 'var(--mint)'; $('bandTuneBtn').style.color = '#0D0F17';
  if(typeof stopBandRecording === 'function') stopBandRecording(true);

  if(bandPresenceUnsub){ bandPresenceUnsub(); bandPresenceUnsub = null; }
  if(bandMessagesUnsub){ bandMessagesUnsub(); bandMessagesUnsub = null; }
  if(bandMetaUnsub){ bandMetaUnsub(); bandMetaUnsub = null; }
  if(bandSettleTimer){ clearInterval(bandSettleTimer); bandSettleTimer = null; }

  if(b.isReal && b.firestoreId && fbDb && currentUser){
    realBandLiveMembers = [];
    renderBandRoster();
    renderBandMessages();
    const bandRef = fbDb.collection('bands').doc(b.firestoreId);

    bandMetaUnsub = bandRef.onSnapshot(doc=>{
      if(!doc.exists) return;
      const d = doc.data();
      b.name = d.name || b.name;
      b.vibe = d.vibe || b.vibe;
      b.memberUids = d.memberUids || [];
      b.lastEmptiedAt = d.lastEmptiedAt && d.lastEmptiedAt.toMillis ? d.lastEmptiedAt.toMillis() : (d.lastEmptiedAt || null);
      b.messageEpoch = d.messageEpoch || b.messageEpoch || 0;
      $('bandRoomName').textContent = b.name;
      // Square Bell — someone rang while you're looking at the room
      if(d.bellAt && d.bellBy && d.bellBy !== currentUser.uid){
        const bellMs = d.bellAt.toMillis ? d.bellAt.toMillis() : d.bellAt;
        if(bellMs && Date.now() - bellMs < 60000 && b._lastBellSeen !== bellMs){
          b._lastBellSeen = bellMs;
          const who = (b.memberInfo||[]).find(m=>m.uid===d.bellBy);
          playBandBellSound();
          toast((who ? who.name.split(' ')[0] : 'Someone') + ' rang the Band');
        }
      }
      updateBandSettleNote();
      if(bandIsSettled(b)) pruneSettledBandMessages(bandRef, b);
      renderBandMessages();
    }, ()=>{});

    bandPresenceUnsub = bandRef.collection('presence').onSnapshot(snap=>{
      // Stale presence: if someone force-quit without deleting their doc, drop them after 90s.
      const PRESENCE_FRESH_MS = 90 * 1000;
      const now = Date.now();
      const others = snap.docs.filter(d=>{
        if(d.id === currentUser.uid) return false;
        const data = d.data() || {};
        const ts = data.tunedInAt && data.tunedInAt.toMillis ? data.tunedInAt.toMillis()
          : (typeof data.tunedInAt === 'number' ? data.tunedInAt : 0);
        if(!ts) return false; // no heartbeat stamp → not considered present
        return (now - ts) < PRESENCE_FRESH_MS;
      });
      // Best-effort cleanup of our own view: delete clearly stale docs (optional, member-writable)
      snap.docs.forEach(d=>{
        if(d.id === currentUser.uid) return;
        const data = d.data() || {};
        const ts = data.tunedInAt && data.tunedInAt.toMillis ? data.tunedInAt.toMillis() : 0;
        if(ts && (now - ts) > 5 * 60 * 1000){
          d.ref.delete().catch(()=>{});
        }
      });
      realBandLiveMembers = others.map(d=>{
        const info = (b.memberInfo||[]).find(m=>m.uid===d.id);
        const data = d.data() || {};
        return Object.assign(info || { uid:d.id, name:'Someone', color:'#8B90A8', initials:'?' }, {
          live: !!data.live,
          liveMode: data.mode || null,
        });
      });
      const totalPresent = others.length + (amTunedIn ? 1 : 0);
      // Debounce empty/occupied writes — stops flicker when presence docs churn
      if(totalPresent === 0){
        if(!b._emptySince) b._emptySince = Date.now();
        if(!b.lastEmptiedAt && (Date.now() - b._emptySince) > 2500){
          b.lastEmptiedAt = Date.now();
          bandRef.set({ lastEmptiedAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge:true }).catch(()=>{});
        }
      } else {
        b._emptySince = null;
        if(b.lastEmptiedAt){
          b.lastEmptiedAt = null;
          bandRef.set({ lastEmptiedAt: null }, { merge:true }).catch(()=>{});
        }
      }
      renderBandRoster();
      updateBandSettleNote();
      // Only redraw live grid when membership of live set actually changes
      const liveKey = others.filter(d=>(d.data()||{}).live).map(d=>d.id).sort().join(',') + (bandLiveLocalStream?'|self':'');
      if(b._liveKey !== liveKey){
        b._liveKey = liveKey;
        renderBandLiveGrid();
      }
    }, ()=>{ /* presence just won't update this session */ });

    bandMessagesUnsub = bandRef.collection('messages').orderBy('ts','desc').limit(60).onSnapshot(async snap=>{
      const rows = snap.docs.slice().reverse().map(d=>{
        const m = d.data();
        return {
          fromMe: m.from === currentUser.uid,
          fromUid: m.from,
          text: m.text || '',
          type: m.type || 'text',
          mediaUrl: m.mediaUrl || null,
          thumb: m.thumb || null,
          duration: m.duration || null,
          encrypted: !!m.encrypted,
          envelopes: m.envelopes || null,
          ts: m.ts && m.ts.toMillis ? m.ts.toMillis() : Date.now(),
        };
      });
      await Promise.all(rows.map(async row=>{
        if(row.type === 'system' || row.type === 'invite' || row.type === 'audio' || row.type === 'video') return;
        if(row.encrypted && row.envelopes){
          row.text = await decryptBandMessage(row);
        }
      }));
      bandMessages[id] = rows;
      renderBandMessages();
    }, ()=>{ /* messages just won't sync this session */ });

    bandSettleTimer = setInterval(updateBandSettleNote, 30000);
  } else {
    renderBandRoster();
    renderBandMessages();
  }
  $('bandRoom').classList.add('active');
  startBandAmbientAnim(b.vibe);
  updateBandSettleNote();
}
function closeBandRoom(){
  stopBandAmbientAnim();
  clearBandAmbientTimer();
  if(typeof stopBandRecording === 'function') stopBandRecording(true);
  if(amTunedIn) clearMyBandPresence();
  if(bandPresenceUnsub){ bandPresenceUnsub(); bandPresenceUnsub = null; }
  if(bandMessagesUnsub){ bandMessagesUnsub(); bandMessagesUnsub = null; }
  if(bandMetaUnsub){ bandMetaUnsub(); bandMetaUnsub = null; }
  if(bandSettleTimer){ clearInterval(bandSettleTimer); bandSettleTimer = null; }
  $('bandRoom').classList.remove('active');
  amTunedIn = false;
  activeBandId = null;
}
$('bandRoomBack').onclick = closeBandRoom;
/* Leave for good = only you exit membership. The square itself cannot be deleted —
   not even by whoever opened it. Nobody can delete a Band. */
$('leaveBandForGoodLink').onclick = async ()=>{
  const b = activeBand(); if(!b) return;
  const name = b.name;
  if(b.isReal && b.firestoreId && fbDb && currentUser){
    try{
      await fbDb.collection('bands').doc(b.firestoreId).update({
        memberUids: firebase.firestore.FieldValue.arrayRemove(currentUser.uid)
      });
    }catch(e){}
  }
  const idx = bands.findIndex(x=>x.id===b.id);
  if(idx>=0) bands.splice(idx,1);
  delete bandMessages[b.id];
  if(!b.isReal) saveBands();
  closeBandRoom();
  renderBandList();
  publishMyPublicBands();
  toast('Left ' + name + ' · Band remains for the others');
};
let bandPresenceHeartbeat = null;
function stopBandPresenceHeartbeat(){
  if(bandPresenceHeartbeat){ clearInterval(bandPresenceHeartbeat); bandPresenceHeartbeat = null; }
}
function startBandPresenceHeartbeat(){
  stopBandPresenceHeartbeat();
  const beat = ()=>{
    const b = activeBand();
    if(!amTunedIn || !b || !b.isReal || !b.firestoreId || !fbDb || !currentUser) return;
    fbDb.collection('bands').doc(b.firestoreId).collection('presence').doc(currentUser.uid).set({
      tunedInAt: firebase.firestore.FieldValue.serverTimestamp(),
    }, { merge:true }).catch(()=>{});
  };
  beat();
  bandPresenceHeartbeat = setInterval(beat, 25000);
}
function clearMyBandPresence(){
  stopBandPresenceHeartbeat();
  const b = activeBand();
  if(b && b.isReal && b.firestoreId && fbDb && currentUser){
    fbDb.collection('bands').doc(b.firestoreId).collection('presence').doc(currentUser.uid).delete().catch(()=>{});
  }
}
// If the app is backgrounded or closed while tuned in, drop presence so others don't see a ghost.
document.addEventListener('visibilitychange', ()=>{
  if(document.hidden && amTunedIn){
    try{ if(typeof stopBandLiveCamera === 'function' && bandLiveLocalStream) stopBandLiveCamera(); }catch(_){}
    clearMyBandPresence();
  } else if(!document.hidden && amTunedIn) startBandPresenceHeartbeat();
});
window.addEventListener('pagehide', ()=>{
  if(amTunedIn){
    try{ if(typeof stopBandLiveCamera === 'function' && bandLiveLocalStream) stopBandLiveCamera(); }catch(_){}
    clearMyBandPresence();
  }
});

$('bandTuneBtn').onclick = ()=>{
  amTunedIn = !amTunedIn;
  markMyActivity();
  if(typeof unlockBandAudio === 'function') unlockBandAudio();
  $('bandTuneBtn').textContent = amTunedIn ? 'Step out' : 'Tune in';
  $('bandTuneBtn').style.background = amTunedIn ? 'var(--surface-2)' : 'var(--mint)';
  $('bandTuneBtn').style.color = amTunedIn ? 'var(--text)' : '#0D0F17';
  const b = activeBand();
  if(b && b.isReal && b.firestoreId && fbDb && currentUser){
    const presenceRef = fbDb.collection('bands').doc(b.firestoreId).collection('presence').doc(currentUser.uid);
    if(amTunedIn){
      startBandPresenceHeartbeat();
      bumpTodayActivity();
      if(b.lastEmptiedAt){
        b.lastEmptiedAt = null;
        fbDb.collection('bands').doc(b.firestoreId).set({ lastEmptiedAt: null }, { merge:true }).catch(()=>{});
      }
    } else {
      // Step out: stop THIS user's live only (not the whole band)
      try{ if(typeof stopBandLiveCamera === 'function') stopBandLiveCamera(); }catch(_){}
      clearMyBandPresence();
      if(typeof stopBandRecording === 'function') stopBandRecording(true);
    }
  } else if(amTunedIn){
    armBandAmbientReply();
    bumpTodayActivity();
  } else {
    try{ if(typeof stopBandLiveCamera === 'function') stopBandLiveCamera(); }catch(_){}
    clearBandAmbientTimer();
    if(typeof stopBandRecording === 'function') stopBandRecording(true);
  }
  renderBandRoster();
  renderBandList();
  updateBandSettleNote();
};

/* -------- Band bell: real sound + nudge for others in the room -------- */
function playBandBellSound(){
  try{
    unlockBandAudio();
    const ctx = bandAudioCtx || new (window.AudioContext || window.webkitAudioContext)();
    bandAudioCtx = ctx;
    const now = ctx.currentTime;
    [0, 0.18].forEach((delay, i)=>{
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = i === 0 ? 880 : 1174;
      gain.gain.setValueAtTime(0.0001, now + delay);
      gain.gain.exponentialRampToValueAtTime(0.35, now + delay + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + delay + 0.55);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + delay);
      osc.stop(now + delay + 0.6);
    });
  }catch(e){ console.warn('[band] bell sound failed', e); }
}
$('bandBellBtn').onclick = ()=>{
  const b = activeBand();
  if(!b || !b.isReal || !b.firestoreId || !fbDb || !currentUser){
    toast('Ring works on live Bands');
    return;
  }
  if(!amTunedIn){ toast('Tune in first'); return; }
  unlockBandAudio();
  playBandBellSound();
  fbDb.collection('bands').doc(b.firestoreId).set({
    bellAt: firebase.firestore.FieldValue.serverTimestamp(),
    bellBy: currentUser.uid,
  }, { merge:true }).then(()=> toast('Rang the Band')).catch(e=>{
    console.warn('[band] bell write failed', e);
    toast('Couldn\u2019t ring');
  });
};

/* -------- Invite to square (text via Wireline, or video call) -------- */
function openBandInviteSheet(){
  const b = activeBand();
  if(!b || !b.isReal){ toast('Invites work on live Bands'); return; }
  $('bandInviteBandName').textContent = b.name;
  const already = new Set(b.memberUids || (b.memberInfo||[]).map(m=>m.uid) || []);
  already.add(currentUser ? currentUser.uid : '');
  const candidates = contacts.filter(c => c.isReal && c.firebaseUid && !already.has(c.firebaseUid));
  if(!candidates.length){
    $('bandInvitePicker').innerHTML = `<div style="color:var(--text-dim); font-size:13px; padding:12px 0;">Everyone in your frequencies is already on this Band — or you need a real connection first.</div>`;
  } else {
    $('bandInvitePicker').innerHTML = candidates.map(c=>`
      <div class="contact-row" style="cursor:default;">
        <div class="avatar" style="width:40px;height:40px;font-size:13px;${contactAvatarStyleAttr(c)}">${c.photo&&c.photo.dataUrl?'':c.initials}</div>
        <div class="contact-meta"><div class="contact-name">${escapeHtml(c.name)}</div><div class="contact-sub">${escapeHtml(c.handle||'')}</div></div>
        <button data-inv-text="${c.id}" style="padding:8px 10px; border-radius:999px; border:1px solid var(--line); background:var(--surface-2); color:var(--text); font-size:11px; font-family:var(--font-mono); cursor:pointer;">Text</button>
        <button data-inv-video="${c.id}" style="padding:8px 10px; border-radius:999px; border:none; background:var(--mint); color:#0D0F17; font-size:11px; font-family:var(--font-mono); font-weight:700; cursor:pointer;">Video</button>
      </div>`).join('');
    $('bandInvitePicker').querySelectorAll('[data-inv-text]').forEach(el=>{
      el.onclick = ()=> inviteToBand(parseInt(el.dataset.invText), 'text');
    });
    $('bandInvitePicker').querySelectorAll('[data-inv-video]').forEach(el=>{
      el.onclick = ()=> inviteToBand(parseInt(el.dataset.invVideo), 'video');
    });
  }
  $('bandInviteSheet').classList.add('active');
}
$('bandInviteBtn').onclick = openBandInviteSheet;
$('bandInviteClose').onclick = ()=> $('bandInviteSheet').classList.remove('active');

async function inviteToBand(contactId, mode){
  const b = activeBand();
  const c = contacts.find(x=>x.id===contactId);
  if(!b || !c || !c.firebaseUid || !fbDb || !currentUser) return;
  try{
    // Membership: add them to the square so they can open it.
    await fbDb.collection('bands').doc(b.firestoreId).update({
      memberUids: firebase.firestore.FieldValue.arrayUnion(c.firebaseUid)
    });
    b.memberUids = Array.from(new Set([...(b.memberUids||[]), c.firebaseUid]));
    if(!(b.memberInfo||[]).some(m=>m.uid===c.firebaseUid)){
      b.memberInfo = b.memberInfo || [];
      b.memberInfo.push({ uid:c.firebaseUid, name:c.name, color:c.color, initials:c.initials, photo:c.photo });
    }
    // Invite record on the band
    await fbDb.collection('bands').doc(b.firestoreId).collection('invites').add({
      fromUid: currentUser.uid,
      toUid: c.firebaseUid,
      mode: mode || 'text',
      status: 'sent',
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
    // Inbox notification — surfaces even if they're not in Band right now
    await fbDb.collection('users').doc(c.firebaseUid).collection('notifications').add({
      type: 'band_invite',
      bandId: b.firestoreId,
      bandName: b.name,
      fromUid: currentUser.uid,
      fromName: (currentProfile && currentProfile.name) || 'Someone',
      mode: mode || 'text',
      read: false,
      ts: firebase.firestore.FieldValue.serverTimestamp(),
    });
    // System note in the square
    await fbDb.collection('bands').doc(b.firestoreId).collection('messages').add({
      from: currentUser.uid,
      type: 'system',
      text: (currentProfile.name || 'Someone') + ' invited ' + c.name.split(' ')[0],
      ts: firebase.firestore.FieldValue.serverTimestamp(),
    });
    // Wireline text invite
    const inviteText = 'Join me on the Band “' + b.name + '” in Band — open Band and tune in. Chatter is in the moment and clears 2h after the last person leaves.';
    await sendRealMessage(c, { type:'text', text: inviteText }, 'Band invite · ' + b.name);
    // Push wake (reuses call-notify worker title/body path)
    try{
      const idToken = await currentUser.getIdToken();
      fetch(CALL_NOTIFY_WORKER_URL, {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + idToken, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          calleeUid: c.firebaseUid,
          callerName: (currentProfile && currentProfile.name) || 'Someone',
          type: 'band_invite',
          title: ((currentProfile && currentProfile.name) || 'Someone') + ' invited you to a Band',
          body: b.name + ' · open Band to tune in',
          bandId: b.firestoreId,
        }),
      }).catch(()=>{});
    }catch(e){}
    $('bandInviteSheet').classList.remove('active');
    toast(mode === 'video' ? ('Invited ' + c.name.split(' ')[0] + ' · opening video') : ('Invited ' + c.name.split(' ')[0] + ' · notified'));
    if(mode === 'video'){
      setTimeout(()=> startOutgoingCall(c.id), 400);
    }
  }catch(e){
    toast(e.message || 'Couldn\u2019t invite');
  }
}

/* Listen for square invites in the personal inbox */
let bandNotifUnsub = null;
function startBandInviteListener(){
  if(!fbDb || !currentUser) return;
  if(bandNotifUnsub){ bandNotifUnsub(); bandNotifUnsub = null; }
  bandNotifUnsub = fbDb.collection('users').doc(currentUser.uid).collection('notifications')
    .where('type','==','band_invite')
    .orderBy('ts','desc')
    .limit(10)
    .onSnapshot(snap=>{
      snap.docChanges().forEach(ch=>{
        if(ch.type !== 'added') return;
        const n = ch.doc.data();
        if(n.read) return;
        const ts = n.ts && n.ts.toMillis ? n.ts.toMillis() : 0;
        if(ts && Date.now() - ts > 3600000) return; // ignore older than 1h on first paint
        toast((n.fromName || 'Someone') + ' invited you to · ' + (n.bandName || 'a Band'));
        ch.doc.ref.update({ read: true }).catch(()=>{});
        // Ensure the band appears in the local list
        if(n.bandId && !bands.some(b=>b.firestoreId===n.bandId)){
          addRealBandToLocalList(n.bandId, n.bandName || 'Band', 'aurora', [], n.fromUid, { memberUids: [currentUser.uid] });
          renderBandList();
        }
      });
    }, ()=>{ /* notifications optional */ });
}

/* ---------------- BAND RECORD — audio & video clips for everyone ----------------
   Live WebRTC mesh was unreliable across devices. Instead: record a short clip,
   upload to R2 (same path as Signal videos), post into Band messages so every
   member can play it. Clears with the 2h settle window like text. */
let bandRecStream = null;
let bandRecorder = null;
let bandRecChunks = [];
let bandRecMode = null; // 'audio' | 'video'
let bandRecStart = 0;
let bandRecTimer = null;
let bandAudioCtx = null;
const BAND_REC_MAX_AUDIO_MS = 60 * 1000;
const BAND_REC_MAX_VIDEO_MS = 30 * 1000;

function unlockBandAudio(){
  try{
    if(!bandAudioCtx) bandAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if(bandAudioCtx.state === 'suspended') bandAudioCtx.resume().catch(()=>{});
  }catch(e){}
}

function bandRecMime(preferVideo){
  const list = preferVideo
    ? ['video/webm;codecs=vp9,opus','video/webm;codecs=vp8,opus','video/webm','video/mp4']
    : ['audio/webm;codecs=opus','audio/webm','audio/mp4','audio/ogg'];
  for(const m of list){
    try{
      if(typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(m)) return m;
    }catch(e){}
  }
  return preferVideo ? 'video/webm' : 'audio/webm';
}

function formatBandRecTime(ms){
  const s = Math.floor(ms / 1000);
  return Math.floor(s/60) + ':' + String(s%60).padStart(2,'0');
}

function setBandRecordButtonsIdle(){
  const ab = $('bandAudioBtn'), vb = $('bandLiveBtn');
  if(ab){
    ab.disabled = false;
    ab.style.background = 'rgba(13,15,23,.55)';
    ab.style.color = '#fff';
    ab.style.borderColor = 'rgba(255,255,255,.2)';
    ab.textContent = 'Record audio';
    const voice = $('bandVoiceBtn');
    if(voice){ voice.textContent = 'Voice'; voice.style.background = 'rgba(13,15,23,.55)'; }
  }
  if(vb){
    vb.disabled = false;
    vb.style.background = 'rgba(13,15,23,.55)';
    vb.style.color = '#fff';
    vb.style.borderColor = 'rgba(255,255,255,.2)';
    vb.textContent = 'Record video';
  }
}

function showBandRecordBar(mode){
  const bar = $('bandRecordBar');
  const prev = $('bandRecordPreview');
  if(!bar) return;
  bar.style.display = 'block';
  $('bandRecordLabel').textContent = mode === 'video' ? '● Recording video… tap Stop' : '● Recording audio… tap Stop';
  bar.classList.add('recording-active');

  $('bandRecordTimer').textContent = '0:00';
  if(prev){
    if(mode === 'video' && bandRecStream){
      prev.style.display = 'block';
      prev.style.objectFit = 'cover';
      prev.style.objectPosition = 'center center';
      prev.style.width = '100%';
      prev.style.aspectRatio = '9 / 16';
      prev.style.maxHeight = '40vh';
      prev.style.borderRadius = '14px';
      prev.style.transform = 'scaleX(-1)'; // mirror like selfie preview
      prev.srcObject = bandRecStream;
      prev.muted = true;
      prev.play().catch(()=>{});
    } else {
      prev.style.display = 'none';
      prev.srcObject = null;
    }
  }
}
function hideBandRecordBar(){
  const _bar = $('bandRecordBar');
  if(_bar) _bar.classList.remove('recording-active');

  const bar = $('bandRecordBar');
  const prev = $('bandRecordPreview');
  if(bar) bar.style.display = 'none';
  if(prev){ prev.srcObject = null; prev.style.display = 'none'; }
}

function stopBandRecording(discard){
  if(bandRecTimer){ clearInterval(bandRecTimer); bandRecTimer = null; }
  if(bandRecorder && bandRecorder.state !== 'inactive'){
    try{
      if(discard) bandRecorder.onstop = ()=>{};
      bandRecorder.stop();
    }catch(e){}
  }
  bandRecorder = null;
  if(bandRecStream){
    bandRecStream.getTracks().forEach(t=>{ try{ t.stop(); }catch(_){} });
    bandRecStream = null;
  }
  bandRecChunks = [];
  bandRecMode = null;
  hideBandRecordBar();
  setBandRecordButtonsIdle();
}

async function postBandMediaMessage(type, mediaUrl, duration, thumb){
  const b = activeBand();
  if(!b || !b.isReal || !b.firestoreId || !fbDb || !currentUser){
    toast('Open a live Band to share recordings');
    return;
  }
  const payload = {
    from: currentUser.uid,
    type,
    mediaUrl,
    duration: duration || null,
    thumb: thumb || null,
    text: '',
    encrypted: false,
    ts: firebase.firestore.FieldValue.serverTimestamp(),
  };
  try{
    await fbDb.collection('bands').doc(b.firestoreId).collection('messages').add(payload);
    markMyActivity();
    toast(type === 'video' ? 'Video shared with the Band' : 'Audio shared with the Band');
  }catch(e){
    console.warn('[band] media post failed', e);
    toast(e.message || 'Couldn\u2019t post recording');
  }
}

async function finishBandRecordingAndSend(){
  if(!bandRecorder || bandRecorder.state === 'inactive') return;
  const mode = bandRecMode;
  const started = bandRecStart;
  const durationSecs = Math.max(0.5, (Date.now() - started) / 1000);

  return new Promise(resolve=>{
    bandRecorder.onstop = async ()=>{
      const chunks = bandRecChunks.slice();
      const mime = (chunks[0] && chunks[0].type) || (mode === 'video' ? 'video/webm' : 'audio/webm');
      if(bandRecStream){
        bandRecStream.getTracks().forEach(t=>{ try{ t.stop(); }catch(_){} });
        bandRecStream = null;
      }
      bandRecorder = null;
      bandRecChunks = [];
      bandRecMode = null;
      if(bandRecTimer){ clearInterval(bandRecTimer); bandRecTimer = null; }
      hideBandRecordBar();
      setBandRecordButtonsIdle();

      if(durationSecs < 0.6){
        toast('Too short — hold a bit longer');
        resolve();
        return;
      }
      const blob = new Blob(chunks, { type: mime });
      if(!blob.size){
        toast('Nothing recorded');
        resolve();
        return;
      }
      toast('Uploading…');
      try{
        const url = await uploadVideoToR2(blob);
        let thumb = null;
        if(mode === 'video'){
          try{ thumb = await generateVideoThumbnail(url); }catch(e){}
        }
        await postBandMediaMessage(mode === 'video' ? 'video' : 'audio', url, durationSecs, thumb);
      }catch(e){
        console.warn('[band] upload failed', e);
        toast(e.message || 'Upload failed');
      }
      resolve();
    };
    try{ bandRecorder.stop(); }catch(e){ resolve(); }
  });
}

async function startBandRecording(mode){
  if(bandRecorder && bandRecorder.state === 'recording'){
    toast('Already recording — tap Stop first');
    return;
  }

  if(!window.MediaRecorder || !navigator.mediaDevices){
    toast('Recording isn\u2019t supported on this device');
    return;
  }
  if(!amTunedIn){
    // Auto tune-in so the clip is shared into the active room
    const btn = $('bandTuneBtn');
    if(btn) btn.click();
    await new Promise(r=>setTimeout(r, 50));
  }
  if(!amTunedIn){ toast('Tune in first'); return; }
  if(bandRecorder && bandRecorder.state !== 'inactive'){
    // Second tap = stop & send
    await finishBandRecordingAndSend();
    return;
  }

  unlockBandAudio();
  const wantVideo = mode === 'video';
  try{
    bandRecStream = await navigator.mediaDevices.getUserMedia(
      wantVideo
        ? { video: { facingMode: 'user', width: { ideal: 720 }, height: { ideal: 1280 }, aspectRatio: { ideal: 9/16 } }, audio: { echoCancellation:true, noiseSuppression:true } }
        : { audio: { echoCancellation:true, noiseSuppression:true, autoGainControl:true }, video: false }
    );
  }catch(e){
    toast(wantVideo ? 'Camera/mic permission needed' : 'Microphone permission needed');
    return;
  }

  const mime = bandRecMime(wantVideo);
  bandRecChunks = [];
  try{
    bandRecorder = new MediaRecorder(bandRecStream, { mimeType: mime, videoBitsPerSecond: wantVideo ? 1800000 : undefined, audioBitsPerSecond: wantVideo ? 96000 : 40000 });
  }catch(e){
    try{ bandRecorder = new MediaRecorder(bandRecStream); }
    catch(e2){
      toast('Couldn\u2019t start recorder');
      bandRecStream.getTracks().forEach(t=>t.stop());
      bandRecStream = null;
      return;
    }
  }
  bandRecMode = mode;
  bandRecStart = Date.now();
  bandRecorder.ondataavailable = e=>{ if(e.data && e.data.size) bandRecChunks.push(e.data); };
  try{ bandRecorder.start(250); }catch(e){
    try{ bandRecorder.start(); }catch(e2){
      toast('Couldn\u2019t start recorder');
      stopBandRecording(true);
      return;
    }
  }

  showBandRecordBar(mode);
  const ab = $('bandAudioBtn'), vb = $('bandLiveBtn');
  if(mode === 'audio' && ab){
    ab.style.background = 'var(--red)';
    ab.style.borderColor = 'var(--red)';
    ab.textContent = 'Stop';
    ab.style.color = '#fff';
    if(vb) vb.disabled = true;
    const voice = $('bandVoiceBtn');
    if(voice){ voice.textContent = 'Stop'; voice.style.background = 'var(--red)'; }
  }
  if(mode === 'video' && vb){
    vb.style.background = 'var(--red)';
    vb.style.borderColor = 'var(--red)';
    vb.textContent = 'Stop';
    vb.style.color = '#fff';
    if(ab) ab.disabled = true;
  }

  const maxMs = wantVideo ? BAND_REC_MAX_VIDEO_MS : BAND_REC_MAX_AUDIO_MS;
  bandRecTimer = setInterval(()=>{
    const elapsed = Date.now() - bandRecStart;
    const el = $('bandRecordTimer');
    if(el) el.textContent = formatBandRecTime(elapsed);
    if(elapsed >= maxMs){
      finishBandRecordingAndSend();
    }
  }, 200);
}

function toggleBandRecording(mode){
  if(bandRecorder && bandRecorder.state === 'recording'){
    // Second tap = stop & send (same as Stop button)
    finishBandRecordingAndSend();
    return;
  }
  startBandRecording(mode);
}
if($('bandLiveBtn')) $('bandLiveBtn').onclick = ()=> toggleBandRecording('video');
if($('bandAudioBtn')) $('bandAudioBtn').onclick = ()=> toggleBandRecording('audio');
if($('bandRecordStopBtn')) $('bandRecordStopBtn').onclick = ()=> finishBandRecordingAndSend();
// Voice note short path — also toggle if mid-record
if($('bandVoiceBtn')){
  $('bandVoiceBtn').onclick = ()=>{
    if(bandRecorder && bandRecorder.state === 'recording'){
      finishBandRecordingAndSend();
      return;
    }
    startBandRecording('audio');
  };
}

/* ---- Band message E2E (envelope per member) ---- */
async function resolvePublicKeyForUid(uid){
  if(!uid) return null;
  if(uid === currentUser.uid){
    const myKeys = await ensureMyKeyPair();
    return myKeys && myKeys.publicJwk;
  }
  const c = contacts.find(cc => cc.firebaseUid === uid);
  if(c && c.publicKey) return c.publicKey;
  if(!fbDb) return null;
  try{
    const doc = await fbDb.collection('users').doc(uid).get();
    if(doc.exists && doc.data().publicKey){
      if(c) c.publicKey = doc.data().publicKey;
      return doc.data().publicKey;
    }
  }catch(e){}
  return null;
}
async function encryptBandMessageForMembers(memberUids, plaintext){
  const envelopes = {};
  let any = false;
  for(const uid of memberUids){
    try{
      const jwk = await resolvePublicKeyForUid(uid);
      if(!jwk) continue;
      const enc = await encryptMessageText(uid, jwk, plaintext);
      if(enc){ envelopes[uid] = enc; any = true; }
    }catch(e){}
  }
  return any ? envelopes : null;
}
async function decryptBandMessage(m){
  if(!m.encrypted || !m.envelopes) return m.text || '';
  const mine = m.envelopes[currentUser.uid];
  if(!mine){
    // Not sealed for us — show plaintext fallback if sender included it
    return m.text || '';
  }
  // Shared secret is ECDH(myPrivate, senderPublic) — always use sender's key
  const senderUid = m.fromUid || m.from;
  const theirJwk = await resolvePublicKeyForUid(senderUid);
  if(!theirJwk) return m.text || '';
  try{
    const plain = await decryptMessageText(senderUid, theirJwk, mine.ciphertext, mine.iv);
    if(plain != null) return plain;
  }catch(e){}
  // Own message: key was derived with self uid
  if(senderUid === currentUser.uid){
    try{
      const plain2 = await decryptMessageText(currentUser.uid, theirJwk, mine.ciphertext, mine.iv);
      if(plain2 != null) return plain2;
    }catch(e){}
  }
  return m.text || '';
}

async function sendBandMessage(){
  const text = $('bandInput').value.trim();
  if(!text || !activeBandId) return;
  if(!amTunedIn){ toast('Tune in first to say something'); return; }
  const b = activeBand();
  if(b && b.isReal && b.firestoreId && fbDb && currentUser){
    if(navigator.onLine === false){
      queueBandMessage(b.firestoreId, { type:'text', text, encrypted:false }, text);
      $('bandInput').value = '';
      toast('Offline — Band message queued');
      return;
    }
    const members = b.memberUids || (b.memberInfo||[]).map(m=>m.uid).concat([currentUser.uid]);
    const unique = Array.from(new Set(members));
    const envelopes = await encryptBandMessageForMembers(unique, text);
    const payload = {
      from: currentUser.uid,
      ts: firebase.firestore.FieldValue.serverTimestamp(),
      type: 'text',
    };
    if(envelopes){
      payload.encrypted = true;
      payload.envelopes = envelopes;
      // Keep plaintext only when we could not seal for every member (decrypt fallback)
      const sealedForAll = unique.every(u => !!envelopes[u]);
      payload.text = sealedForAll ? '' : text;
    } else {
      payload.encrypted = false;
      payload.text = text;
    }
    fbDb.collection('bands').doc(b.firestoreId).collection('messages').add(payload)
      .catch(e=> toast(e.message || 'Couldn\u2019t send'));
    $('bandInput').value = '';
    markMyActivity();
    return;
  }
  if(!bandMessages[activeBandId]) bandMessages[activeBandId] = [];
  bandMessages[activeBandId].push({ fromMe:true, text, ts: Date.now() });
  $('bandInput').value = '';
  renderBandMessages();
  markMyActivity();
}
$('bandSendBtn').onclick = sendBandMessage;
$('bandInput').addEventListener('keydown', e=>{ if(e.key==='Enter'){ e.preventDefault(); sendBandMessage(); } });



/* ---- Band live local camera (draggable) + voice note + invite link ----
   Live here means YOUR camera in the hall — movable. Multi-person mesh is separate.
   Messages are permanent until the 2h settle wipe after the room empties. */

let bandLiveLocalStream = null;



/* ---- Multi-person live presence grid ---- */
function renderBandLiveGrid(){
  const stage = $('bandLiveStage');
  if(!stage) return;
  const liveOthers = (realBandLiveMembers || []).filter(m => m.live);
  const selfLive = !!bandLiveLocalStream;
  if(!liveOthers.length && !selfLive){
    stage.style.display = 'none';
    stage.innerHTML = '';
    return;
  }
  // TikTok-style multi-live grid: 1 → full, 2 → side-by-side, 3+ → dense rows
  const count = liveOthers.length + (selfLive ? 1 : 0);
  const cols = count === 1 ? 1 : (count === 2 ? 2 : (count <= 4 ? 2 : 3));
  stage.style.display = 'grid';
  stage.style.gridTemplateColumns = 'repeat(' + cols + ', minmax(0, 1fr))';
  stage.style.gap = '6px';
  stage.style.padding = '6px 10px';
  stage.style.maxHeight = count > 4 ? '48vh' : '42vh';
  stage.style.overflowY = 'auto';
  let html = '';
  if(selfLive){
    const expanded = stage.classList.contains('expanded');
    html += `<div data-live-tile="self" class="band-live-tile self" style="position:relative;aspect-ratio:${expanded ? '9/16' : '16/10'};max-height:${expanded ? '72vh' : '26vh'};border-radius:14px;overflow:hidden;background:#0a0c14;border:1px solid rgba(124,255,178,.45);">
      <video autoplay playsinline muted style="width:100%;height:100%;object-fit:cover;"></video>
      <div style="position:absolute;left:6px;bottom:6px;font-family:var(--font-mono);font-size:9px;background:rgba(13,15,23,.85);color:var(--mint);padding:2px 6px;border-radius:999px;">You · live</div>
    </div>`;
  }
  html += liveOthers.map(m => {
    const name = (m.name||'Someone').split(' ')[0];
    return `<div data-live-tile="${m.uid}" class="band-live-tile" style="position:relative;aspect-ratio:9/16;border-radius:14px;overflow:hidden;background:#0a0c14;border:1px solid rgba(124,255,178,.25);display:flex;align-items:center;justify-content:center;">
      <video data-remote-live="${m.uid}" autoplay playsinline style="display:none;width:100%;height:100%;object-fit:cover;"></video>
      <div class="avatar live-avatar" style="width:56px;height:56px;font-size:18px;${typeof contactAvatarStyleAttr==='function'?contactAvatarStyleAttr(m):''}">${m.photo&&m.photo.dataUrl?'':(m.initials||'?')}</div>
      <div style="position:absolute;left:6px;bottom:6px;font-family:var(--font-mono);font-size:9px;background:rgba(13,15,23,.85);color:var(--mint);padding:2px 6px;border-radius:999px;">${escapeHtml(name)} · live</div>
    </div>`;
  }).join('');
  stage.innerHTML = html;
  if(selfLive){
    const v = stage.querySelector('[data-live-tile="self"] video');
    if(v && bandLiveLocalStream){ v.srcObject = bandLiveLocalStream; v.play().catch(()=>{}); }
    // One self view only — hide floating PiP while grid shows you
    const float = $('bandLiveFloat');
    if(float) float.style.display = 'none';
  }
  if(typeof bandLiveMeshSync === 'function') bandLiveMeshSync(liveOthers);
  // Re-apply remote streams after DOM rebuild (ontrack often fires before tiles exist)
  try{
    Object.keys(bandMeshRemoteStreams || {}).forEach(function(uid){
      if(typeof bandMeshAttachTile === 'function') bandMeshAttachTile(uid);
    });
  }catch(_){}
  // Expand arrow ON the camera tile (not in the corner of the whole room)
  const selfTile = stage.querySelector('[data-live-tile="self"]');
  if(false && selfTile && !selfTile.querySelector('.band-live-expand')){
    const exp = document.createElement('button');
    exp.type = 'button';
    exp.className = 'band-live-expand';
    exp.setAttribute('aria-label','Expand live');
    exp.style.cssText = 'position:absolute;right:8px;top:8px;z-index:6;width:32px;height:32px;border-radius:50%;background:rgba(13,15,23,.78);border:1px solid rgba(255,255,255,.25);color:#fff;display:flex;align-items:center;justify-content:center;cursor:pointer;';
    exp.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    selfTile.appendChild(exp);
    exp.onclick = function(e){
      e.preventDefault();
      e.stopPropagation();
      stage.classList.toggle('expanded');
      const on = stage.classList.contains('expanded');
      exp.style.transform = on ? 'rotate(180deg)' : '';
      // Promotional (compact) until expanded
      stage.style.maxHeight = on ? '78vh' : '28vh';
      const tile = stage.querySelector('[data-live-tile="self"]');
      if(tile){
        tile.style.aspectRatio = on ? '9/16' : '16/10';
        tile.style.maxHeight = on ? '72vh' : '26vh';
      }
    };
  }
  // Default: compact promotional size when not expanded
  if(stage && !stage.classList.contains('expanded')){
    stage.style.maxHeight = stage.style.maxHeight || '28vh';
  }
}

function enableBandLiveCamera(){
  if(bandLiveLocalStream){ stopBandLiveCamera(); return; }
  if(!amTunedIn){ toast('Tune in first'); return; }
  const liveConstraints = {
    video: { facingMode: 'user', width: { ideal: 720 }, height: { ideal: 1280 }, aspectRatio: { ideal: 9/16 } },
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  };
  navigator.mediaDevices.getUserMedia(liveConstraints).catch(function(){
    // Mic denied/unavailable — still go live with video so others see you
    return navigator.mediaDevices.getUserMedia({
      video: liveConstraints.video,
      audio: false,
    });
  }).then(stream=>{
    bandLiveLocalStream = stream;
    // Single view: grid tile only (no second floating camera)
    const float = $('bandLiveFloat');
    if(float) float.style.display = 'none';
    const vid = $('bandLiveFloatVideo');
    if(vid) vid.srcObject = null;
    const btn = $('bandGoLiveBtn') || $('bandLiveBtn');
    if(btn && btn.id === 'bandGoLiveBtn'){ btn.textContent = 'Stop live'; btn.style.background = 'var(--mint)'; btn.style.color = '#0D0F17'; }
    // Tell the hall you're live
    const b = activeBand();
    if(b && b.isReal && b.firestoreId && fbDb && currentUser){
      fbDb.collection('bands').doc(b.firestoreId).collection('presence').doc(currentUser.uid).set({
        tunedInAt: firebase.firestore.FieldValue.serverTimestamp(),
        live: true,
        mode: 'video',
        liveAt: firebase.firestore.FieldValue.serverTimestamp(),
      }, { merge:true }).catch(()=>{});
    }
    // Rebuild mesh with outbound tracks so peers receive OUR video (not recvonly leftovers)
    try{ bandMeshCleanup(); }catch(_){}
    renderBandLiveGrid();
    toast('Live camera on');
  }).catch(()=> toast('Camera unavailable'));
}
function stopBandLiveCamera(){
  if(bandLiveLocalStream){
    bandLiveLocalStream.getTracks().forEach(t=>{ try{ t.stop(); }catch(_){} });
    bandLiveLocalStream = null;
  }
  const float = $('bandLiveFloat');
  const vid = $('bandLiveFloatVideo');
  if(vid) vid.srcObject = null;
  if(float) float.style.display = 'none';
  const btn = $('bandGoLiveBtn');
  if(btn){
    btn.textContent = 'Go live';
    btn.style.background = 'rgba(13,15,23,.55)';
    btn.style.color = '#fff';
  }
  const b = activeBand();
  if(b && b.isReal && b.firestoreId && fbDb && currentUser){
    fbDb.collection('bands').doc(b.firestoreId).collection('presence').doc(currentUser.uid).set({
      live: false,
      mode: null,
      tunedInAt: firebase.firestore.FieldValue.serverTimestamp(),
    }, { merge:true }).catch(()=>{});
  }
  renderBandLiveGrid();
}

(function setupBandLiveDrag(){
  const el = $('bandLiveFloat');
  if(!el) return;
  let dragging = false, ox = 0, oy = 0;
  const onDown = (x, y)=>{
    dragging = true;
    const r = el.getBoundingClientRect();
    ox = x - r.left; oy = y - r.top;
    el.style.right = 'auto'; el.style.bottom = 'auto';
    el.style.left = r.left + 'px'; el.style.top = r.top + 'px';
  };
  const onMove = (x, y)=>{
    if(!dragging) return;
    const maxX = window.innerWidth - el.offsetWidth - 8;
    const maxY = window.innerHeight - el.offsetHeight - 8;
    el.style.left = Math.max(8, Math.min(maxX, x - ox)) + 'px';
    el.style.top = Math.max(8, Math.min(maxY, y - oy)) + 'px';
  };
  const onUp = ()=>{ dragging = false; };
  el.addEventListener('pointerdown', e=>{ e.preventDefault(); el.setPointerCapture(e.pointerId); onDown(e.clientX, e.clientY); });
  el.addEventListener('pointermove', e=>{ onMove(e.clientX, e.clientY); });
  el.addEventListener('pointerup', onUp);
  el.addEventListener('pointercancel', onUp);
})();

// Record video stays on bandLiveBtn; Go live is a separate control
if($('bandLiveBtn')){
  $('bandLiveBtn').textContent = 'Record video';
  $('bandLiveBtn').title = 'Record a short video for the Band';
  $('bandLiveBtn').onclick = ()=> startBandRecording('video');
}
if($('bandGoLiveBtn')){
  $('bandGoLiveBtn').onclick = ()=> enableBandLiveCamera();
}

// Voice note — short clip into the band as audio message
if($('bandVoiceBtn')){
  $('bandVoiceBtn').onclick = async ()=>{
    if(!amTunedIn){ toast('Tune in first'); return; }
    if(typeof startBandRecording === 'function'){
      // Reuse recorder path in audio mode with shorter UX toast
      toast('Hold the room — recording voice…');
      startBandRecording('audio');
    } else {
      toast('Voice recording unavailable');
    }
  };
}

// Invite link
function bandInviteLink(){
  const b = activeBand();
  if(!b || !b.firestoreId) return null;
  const base = (location.origin && location.origin !== 'null') ? location.origin : 'https://getnaluno.com';
  return base.replace(/\/$/, '') + '/?band=' + encodeURIComponent(b.firestoreId);
}
if($('bandCopyLinkBtn')){
  $('bandCopyLinkBtn').onclick = async ()=>{
    const link = bandInviteLink();
    if(!link){ toast('Open a live Band first'); return; }
    try{
      if(navigator.clipboard && navigator.clipboard.writeText){
        await navigator.clipboard.writeText(link);
      } else {
        const ta = document.createElement('textarea');
        ta.value = link; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
      }
      toast('Invite link copied');
    }catch(e){
      toast(link);
    }
  };
}

// Deep link: ?band=ID
(function bandDeepLink(){
  try{
    const params = new URLSearchParams(location.search || '');
    const bandId = params.get('band');
    if(!bandId) return;
    const tryOpen = ()=>{
      if(!fbDb || !currentUser) return false;
      const existing = (bands || []).find(b => b.firestoreId === bandId);
      if(existing){ openBandRoom(existing.id); return true; }
      // Fetch and join membership lightly
      fbDb.collection('bands').doc(bandId).get().then(doc=>{
        if(!doc.exists){ toast('Band not found'); return; }
        const d = doc.data();
        fbDb.collection('bands').doc(bandId).update({
          memberUids: firebase.firestore.FieldValue.arrayUnion(currentUser.uid)
        }).catch(()=>{});
        if(typeof addRealBandToLocalList === 'function'){
          addRealBandToLocalList(bandId, d.name || 'Band', d.vibe || 'aurora', [], d.createdBy, d);
        } else {
          // minimal local entry
          const id = Date.now();
          bands.push({
            id, firestoreId: bandId, name: d.name || 'Band', vibe: d.vibe || 'aurora',
            isReal: true, memberUids: d.memberUids || [], memberInfo: d.memberInfo || [],
            lastEmptiedAt: d.lastEmptiedAt && d.lastEmptiedAt.toMillis ? d.lastEmptiedAt.toMillis() : null,
          });
          if(typeof renderBandList === 'function') renderBandList();
          openBandRoom(id);
        }
        const b = bands.find(x => x.firestoreId === bandId);
        if(b) openBandRoom(b.id);
        toast('Joined Band');
      }).catch(()=> toast('Couldn’t open Band link'));
      return true;
    };
    // Wait for auth a bit
    let n = 0;
    const iv = setInterval(()=>{
      n++;
      if(tryOpen() || n > 40) clearInterval(iv);
    }, 250);
  }catch(e){}
})();

// Close live cam when leaving room
const _closeBandRoom = closeBandRoom;
closeBandRoom = function(){
  stopBandLiveCamera();
  return _closeBandRoom.apply(this, arguments);
};


/* ---- Band live mesh (TikTok-style multi-person): pair WebRTC for live members ---- */
let bandMeshPcs = {}; // peerUid -> RTCPeerConnection
let bandMeshRemoteStreams = {}; // peerUid -> MediaStream (survive grid re-renders)
let bandMeshUnsubs = [];

function bandMeshCleanup(){
  Object.keys(bandMeshPcs).forEach(uid=>{
    try{ bandMeshPcs[uid].close(); }catch(_){}
  });
  bandMeshPcs = {};
  bandMeshRemoteStreams = {};
  bandMeshUnsubs.forEach(u=>{ try{u();}catch(_){} });
  bandMeshUnsubs = [];
}

function bandMeshAttachTile(peerUid){
  const stream = bandMeshRemoteStreams[peerUid];
  if(!stream) return;
  const tile = document.querySelector('[data-live-tile="'+peerUid+'"]');
  if(!tile) return;
  const v = tile.querySelector('video[data-remote-live]');
  const av = tile.querySelector('.live-avatar');
  if(v){
    try{
      if(v.srcObject !== stream) v.srcObject = stream;
      v.style.display = 'block';
      v.muted = false;
      v.volume = 1;
      v.playsInline = true;
      const p = v.play();
      if(p && p.catch) p.catch(function(){
        try{ v.muted = true; v.play().then(function(){ setTimeout(function(){ v.muted = false; }, 200); }).catch(function(){}); }catch(_){}
      });
    }catch(_){}
  }
  if(av) av.style.display = 'none';
}

function bandMeshPairId(a, b){
  return [a, b].sort().join('_');
}

async function bandLiveMeshSync(liveOthers){
  if(!fbDb || !currentUser || !activeBand() || !activeBand().firestoreId) return;
  const bandId = activeBand().firestoreId;
  const myUid = currentUser.uid;
  const others = (liveOthers || []).filter(m => m.uid && m.uid !== myUid);

  // Drop PCs for people who left live
  Object.keys(bandMeshPcs).forEach(uid=>{
    if(!others.find(m=>m.uid===uid)){
      try{ bandMeshPcs[uid].close(); }catch(_){}
      delete bandMeshPcs[uid];
      try{ delete bandMeshRemoteStreams[uid]; }catch(_){}
    }
  });

  for(const m of others){
    try{
      // If we just went live, existing recvonly PC must be rebuilt with send tracks
      const existing = bandMeshPcs[m.uid];
      if(existing && bandLiveLocalStream){
        const senders = existing.getSenders ? existing.getSenders() : [];
        const hasVideoOut = senders.some(s => s.track && s.track.kind === 'video' && s.track.readyState === 'live');
        if(!hasVideoOut){
          try{ existing.close(); }catch(_){}
          delete bandMeshPcs[m.uid];
        }
      }
      if(bandMeshPcs[m.uid]) {
        bandMeshAttachTile(m.uid);
        continue;
      }
      await bandMeshConnectPeer(bandId, m.uid, myUid < m.uid);
    }catch(e){ console.warn('[band-mesh]', e); }
  }
}

async function bandMeshConnectPeer(bandId, peerUid, iAmOfferer){
  if(bandMeshPcs[peerUid]) return;
  const ice = (typeof getIceServers === 'function')
    ? await getIceServers()
    : { iceServers:[{ urls:'stun:stun.l.google.com:19302' }] };
  const pc = new RTCPeerConnection(ice);
  bandMeshPcs[peerUid] = pc;

  // Always send local A/V when we are live
  if(bandLiveLocalStream){
    bandLiveLocalStream.getTracks().forEach(tr=>{
      try{ pc.addTrack(tr, bandLiveLocalStream); }catch(_){}
    });
  } else {
    try{
      pc.addTransceiver('video', { direction:'recvonly' });
      pc.addTransceiver('audio', { direction:'recvonly' });
    }catch(_){}
  }

  const remote = bandMeshRemoteStreams[peerUid] || new MediaStream();
  bandMeshRemoteStreams[peerUid] = remote;
  pc.ontrack = e=>{
    try{ e.track.enabled = true; }catch(_){}
    if(remote.getTracks().indexOf(e.track) === -1) remote.addTrack(e.track);
    bandMeshAttachTile(peerUid);
    setTimeout(function(){ bandMeshAttachTile(peerUid); }, 80);
    setTimeout(function(){ bandMeshAttachTile(peerUid); }, 400);
    setTimeout(function(){ bandMeshAttachTile(peerUid); }, 1200);
  };

  const pairId = bandMeshPairId(currentUser.uid, peerUid);
  const ref = fbDb.collection('bands').doc(bandId).collection('mesh').doc(pairId);
  const session = Date.now();

  pc.onicecandidate = e=>{
    if(!e.candidate) return;
    const col = iAmOfferer ? 'offerIce' : 'answerIce';
    ref.collection(col).add(Object.assign({ session }, e.candidate.toJSON())).catch(function(){});
  };

  if(iAmOfferer){
    // Wipe stale answer/offer so answerer does not skip a new session
    try{
      await ref.set({
        offer: null,
        answer: null,
        session,
        from: currentUser.uid,
        to: peerUid,
        ts: session,
      });
    }catch(_){}
    const offer = await pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: true });
    await pc.setLocalDescription(offer);
    await ref.set({
      offer: { type: offer.type, sdp: offer.sdp },
      answer: null,
      session,
      from: currentUser.uid,
      to: peerUid,
      ts: session,
    });
    const unsub = ref.onSnapshot(async snap=>{
      if(!snap.exists) return;
      const d = snap.data() || {};
      if(d.session && d.session < session - 1000) return; // ignore older sessions
      if(d.answer && (pc.signalingState === 'have-local-offer' || pc.signalingState === 'have-local-pranswer')){
        try{ await pc.setRemoteDescription(new RTCSessionDescription(d.answer)); }catch(err){
          console.warn('[band-mesh] setRemote answer', err);
        }
      }
    });
    bandMeshUnsubs.push(unsub);
    const iceUnsub = ref.collection('answerIce').onSnapshot(snap=>{
      snap.docChanges().forEach(ch=>{
        if(ch.type !== 'added') return;
        const c = ch.doc.data() || {};
        if(c.session && c.session < session - 1000) return;
        pc.addIceCandidate(new RTCIceCandidate(c)).catch(function(){});
      });
    });
    bandMeshUnsubs.push(iceUnsub);
  } else {
    let answered = false;
    let mySession = session;
    const unsub = ref.onSnapshot(async snap=>{
      if(!snap.exists) return;
      const d = snap.data() || {};
      if(!d.offer) return;
      // New offer from peer (session bumped) → answer even if we answered an older one
      if(d.session && d.session < mySession - 5000 && answered) return;
      if(answered && d.answer && d.session === mySession) return;
      try{
        if(pc.signalingState !== 'stable' && pc.signalingState !== 'have-remote-offer'){
          // restart if stuck
        }
        answered = true;
        mySession = d.session || Date.now();
        if(pc.signalingState === 'have-local-offer'){
          // glare — rare; ignore our half
        }
        await pc.setRemoteDescription(new RTCSessionDescription(d.offer));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        await ref.set({
          answer: { type: answer.type, sdp: answer.sdp },
          session: mySession,
          answeredBy: currentUser.uid,
          ts: Date.now(),
        }, { merge:true });
      }catch(e){
        answered = false;
        console.warn('[band-mesh] answer', e);
      }
    });
    bandMeshUnsubs.push(unsub);
    const iceUnsub = ref.collection('offerIce').onSnapshot(snap=>{
      snap.docChanges().forEach(ch=>{
        if(ch.type !== 'added') return;
        const c = ch.doc.data() || {};
        pc.addIceCandidate(new RTCIceCandidate(c)).catch(function(){});
      });
    });
    bandMeshUnsubs.push(iceUnsub);
  }
}

// Cleanup mesh when leaving band / stopping live
const _stopBandLiveCamera = stopBandLiveCamera;
stopBandLiveCamera = function(){
  bandMeshCleanup();
  return _stopBandLiveCamera.apply(this, arguments);
};
