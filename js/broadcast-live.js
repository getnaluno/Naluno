/* OWNERSHIP (broadcast-live.js): Broadcast VOD/live community only.
   MUST NOT touch: calls peerConnection, remoteCombinedStream, bandMeshPcs.
   ICE for live: getIceServers() from ice-core. Playback: <video src> only. */
/* ============================================================
   MODULE: js/broadcast-live.js
   Wow layer: multi-viewer WebRTC live on a Broadcast.
   Host fans out their camera/mic to each viewer (viewer-offer model).
   Uses same TURN path as 1:1 calls (getIceServers).
   OWNERSHIP: live host + viewer peer graphs only.
   ============================================================ */

const BCAST_LIVE_MAX_VIEWERS = 12;
/** Effective cap: SFU path lifts this when configured; mesh stays at 12. */
function bLiveEffectiveMaxViewers(){
  try{
    if(typeof sfuOrMeshViewerCap === 'function') return sfuOrMeshViewerCap();
  }catch(_){}
  return BCAST_LIVE_MAX_VIEWERS;
}

let bLiveHost = false;
let bLiveHostPcs = {};       // viewerUid -> RTCPeerConnection
let bLiveHostUnsubs = [];
let bLiveViewerPc = null;
let bLiveViewerUnsubs = [];
let bLiveViewerCountUnsub = null;
let bLiveReactionUnsub = null;
let bLivePendingHostIce = [];
let bLiveViewerRemoteSet = false;

function bLiveSessionRef(bcastId, viewerUid){
  return fbDb.collection('broadcasts').doc(bcastId).collection('liveSessions').doc(viewerUid);
}

function bLiveCleanupHost(){
  Object.keys(bLiveHostPcs).forEach(uid => {
    try{ bLiveHostPcs[uid].close(); }catch(_){}
  });
  bLiveHostPcs = {};
  bLiveHostUnsubs.forEach(u=>{ try{ u(); }catch(_){} });
  bLiveHostUnsubs = [];
  bLiveHost = false;
  bLiveUpdateViewerChrome(0);
}

function bLiveCleanupViewer(){
  bLiveViewerUnsubs.forEach(u=>{ try{ u(); }catch(_){} });
  bLiveViewerUnsubs = [];
  if(bLiveViewerPc){ try{ bLiveViewerPc.close(); }catch(_){} bLiveViewerPc = null; }
  const v = $('bspaceViewerLiveVideo');
  if(v){ try{ v.autoplay = true; v.playsInline = true; v.muted = false; }catch(_){} }
  if(v){ v.srcObject = null; }
}

function bLiveUpdateViewerChrome(n){
  let el = $('bspaceLiveViewers');
  if(!el){
    const badge = $('bspaceLiveBadge');
    if(badge && badge.parentNode){
      el = document.createElement('div');
      el.id = 'bspaceLiveViewers';
      el.style.cssText = 'position:absolute;right:12px;bottom:12px;z-index:3;font-family:var(--font-mono);font-size:10px;background:rgba(13,15,23,.85);color:#fff;padding:4px 10px;border-radius:999px;border:1px solid rgba(255,255,255,.15);';
      badge.parentNode.appendChild(el);
    }
  }
  if(el){
    el.style.display = (n > 0 || bLiveHost) ? 'block' : 'none';
    el.textContent = n === 1 ? '1 watching' : (n + ' watching');
  }
  const joinBtn = $('bspaceJoinLiveBtn');
  if(joinBtn && !bLiveHost){
    // visibility controlled elsewhere
  }
}

async function bLiveEnsureIce(){
  try{
    if(typeof IceCore !== 'undefined' && IceCore.now) return IceCore.now();
  }catch(_){}
  if(typeof getIceServers === 'function') return getIceServers();
  return { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
}

/* ---------------- HOST: accept viewer offers ---------------- */
async function bLiveStartHost(stream){
  if(!fbDb || !currentUser || !activeBroadcastId || !stream) return;
  bLiveCleanupHost();
  bLiveHost = true;
  if(typeof prewarmIceServers === 'function') prewarmIceServers();

  const col = fbDb.collection('broadcasts').doc(activeBroadcastId).collection('liveSessions');
  // Do not block going live on deleting stale sessions.
  (async function cleanupStale(){
    try{
      const old = await col.get();
      const batch = fbDb.batch();
      let n = 0;
      old.docs.forEach(d => { batch.delete(d.ref); n++; });
      if(n) await batch.commit().catch(function(){});
    }catch(_){}
  })();
  const unsub = col.onSnapshot(async snap => {
    for(const change of snap.docChanges()){
      if(change.type === 'removed'){
        const uid = change.doc.id;
        if(bLiveHostPcs[uid]){
          try{ bLiveHostPcs[uid].close(); }catch(_){}
          delete bLiveHostPcs[uid];
        }
        bLiveUpdateViewerChrome(Object.keys(bLiveHostPcs).length);
        continue;
      }
      if(change.type !== 'added' && change.type !== 'modified') continue;
      const uid = change.doc.id;
      if(uid === currentUser.uid) continue;
      const data = change.doc.data() || {};
      if(!data.offer || data.answer) continue; // wait for offer; skip if already answered
      if(data.ts && (Date.now() - data.ts) > 180000) continue;
      if(bLiveHostPcs[uid]) continue;
      if(Object.keys(bLiveHostPcs).length >= bLiveEffectiveMaxViewers()){
        change.doc.ref.set({ rejected: true, reason: 'full' }, { merge: true }).catch(()=>{});
        continue;
      }
      try{
        await bLiveHostAcceptViewer(uid, data, stream);
      }catch(e){
        console.warn('[bcast-live] host accept failed', e);
        try{
          if(bLiveHostPcs[uid]){ bLiveHostPcs[uid].close(); delete bLiveHostPcs[uid]; }
        }catch(_){}
      }
    }
    bLiveUpdateViewerChrome(Object.keys(bLiveHostPcs).length);
  }, err => console.warn('[bcast-live] host listen', err));
  bLiveHostUnsubs.push(unsub);

  // Live reactions feed
  bLiveWatchReactions(activeBroadcastId);
  bLiveUpdateViewerChrome(0);
}

function bLiveFlashJoinName(name){
  try{
    const label = String(name || 'Someone').slice(0, 40);
    let el = document.getElementById('bspaceJoinFlash');
    if(!el){
      el = document.createElement('div');
      el.id = 'bspaceJoinFlash';
      el.style.cssText = 'position:absolute;left:50%;top:18%;transform:translateX(-50%);z-index:12;padding:10px 18px;border-radius:999px;background:rgba(13,15,23,.88);border:1px solid rgba(124,255,178,.5);color:#7CFFB2;font-family:var(--font-mono);font-size:13px;letter-spacing:.03em;pointer-events:none;opacity:0;transition:opacity .25s ease;';
      const host = document.getElementById('bspaceMedia') || document.getElementById('bspace');
      if(host){
        try{ if(getComputedStyle(host).position === 'static') host.style.position = 'relative'; }catch(_){}
        host.appendChild(el);
      } else {
        document.body.appendChild(el);
      }
    }
    el.textContent = label + ' joined';
    el.style.opacity = '1';
    clearTimeout(el._hideT);
    el._hideT = setTimeout(function(){ el.style.opacity = '0'; }, 3200);
  }catch(_){}
}

async function bLiveHostAcceptViewer(viewerUid, data, stream){
  const pc = new RTCPeerConnection(await bLiveEnsureIce());
  bLiveHostPcs[viewerUid] = pc;

  // Ensure live tracks are enabled before attaching
  try{
    stream.getTracks().forEach(function(track){
      try{ track.enabled = true; }catch(_){}
      try{ pc.addTrack(track, stream); }catch(e){ console.warn(e); }
    });
  }catch(e){ console.warn('[bcast-live] addTrack', e); }

  const ref = bLiveSessionRef(activeBroadcastId, viewerUid);

  pc.onicecandidate = e => {
    if(!e.candidate) return;
    ref.collection('hostIce').add(e.candidate.toJSON()).catch(()=>{});
  };
  let iceUnsub = null;
  pc.onconnectionstatechange = () => {
    if(pc.connectionState === 'failed' || pc.connectionState === 'closed'){
      try{ pc.close(); }catch(_){}
      delete bLiveHostPcs[viewerUid];
      // LOCK (bug 3.3): drop this viewer's ICE listener on disconnect so multi-hour
      // hosts do not accumulate one permanent onSnapshot per departed viewer.
      if(iceUnsub){
        try{ iceUnsub(); }catch(_){}
        iceUnsub = null;
      }
      bLiveUpdateViewerChrome(Object.keys(bLiveHostPcs).length);
    }
  };

  await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  await ref.set({
    answer: { type: answer.type, sdp: answer.sdp },
    hostUid: currentUser.uid,
    answeredAt: Date.now(),
  }, { merge: true });

  // Name flash for a few seconds when someone joins
  try{
    const who = (data && data.name) || 'Someone';
    bLiveFlashJoinName(who);
    toast(who + ' joined live');
  }catch(_){}

  // Pull viewer ICE
  iceUnsub = ref.collection('viewerIce').onSnapshot(snap => {
    snap.docChanges().forEach(ch => {
      if(ch.type !== 'added') return;
      pc.addIceCandidate(new RTCIceCandidate(ch.doc.data())).catch(()=>{});
    });
  });
  bLiveHostUnsubs.push(function(){ if(iceUnsub){ try{ iceUnsub(); }catch(_){} iceUnsub = null; } });
}

async function bLiveStopHost(){
  if(fbDb && activeBroadcastId){
    try{
      const snap = await fbDb.collection('broadcasts').doc(activeBroadcastId).collection('liveSessions').get();
      const batch = fbDb.batch();
      snap.docs.forEach(d => batch.delete(d.ref));
      if(snap.size) await batch.commit().catch(()=>{});
    }catch(_){}
  }
  bLiveCleanupHost();
  if(bLiveReactionUnsub){ try{ bLiveReactionUnsub(); }catch(_){} bLiveReactionUnsub = null; }
}

/* ---------------- VIEWER: offer and receive tracks ---------------- */
async function bLiveJoinAsViewer(){
  if(!fbDb || !currentUser || !activeBroadcastId){ toast('Open a live Broadcast first'); return; }
  if(bLiveHost){ toast('You’re already the host'); return; }
  if(bLiveViewerPc){ toast('Already joined'); return; }

  if(typeof prewarmIceServers === 'function') prewarmIceServers();
  toast('Joining live…');

  bLivePendingHostIce = [];
  bLiveViewerRemoteSet = false;
  const pc = new RTCPeerConnection(await bLiveEnsureIce());
  bLiveViewerPc = pc;
  const remote = new MediaStream();
  const attachRemote = function(){
    const host = $('bspaceMedia');
    if(!host) return;
    let v = $('bspaceViewerLiveVideo');
    if(!v){
      host.innerHTML = `<video id="bspaceViewerLiveVideo" autoplay playsinline muted style="width:100%;height:100%;object-fit:cover;background:#000;"></video>`;
      v = $('bspaceViewerLiveVideo');
    }
    if(!v) return;
    try{ if(typeof containMediaElement === 'function') containMediaElement(v); }catch(_){}
    v.muted = true;
    v.playsInline = true;
    try{ v.setAttribute('playsinline',''); v.setAttribute('webkit-playsinline',''); }catch(_){}
    if(v.srcObject !== remote) v.srcObject = remote;
    const play = function(){
      v.play().then(function(){
        setTimeout(function(){ try{ v.muted = false; }catch(_){} }, 300);
      }).catch(function(){
        try{ v.muted = true; v.play().catch(function(){}); }catch(_){}
      });
    };
    play();
    v.onclick = play;
    setTimeout(play, 400);
    setTimeout(play, 1200);
    const badge = $('bspaceLiveBadge');
    if(badge){ badge.style.display = 'block'; badge.textContent = 'LIVE'; }
  };
  pc.ontrack = e => {
    try{
      if(e.streams && e.streams[0]){
        e.streams[0].getTracks().forEach(function(t){
          if(!remote.getTracks().some(function(x){ return x.id === t.id; })) remote.addTrack(t);
        });
      } else if(e.track){
        if(!remote.getTracks().some(function(x){ return x.id === e.track.id; })) remote.addTrack(e.track);
      }
    }catch(_){
      try{ if(e.track) remote.addTrack(e.track); }catch(_2){}
    }
    attachRemote();
  };
  pc.onconnectionstatechange = function(){
    if(pc.connectionState === 'connected' || pc.connectionState === 'completed'){
      attachRemote();
    }
  };

  try{
    pc.addTransceiver('video', { direction: 'recvonly' });
    pc.addTransceiver('audio', { direction: 'recvonly' });
  }catch(_){}

  const ref = bLiveSessionRef(activeBroadcastId, currentUser.uid);
  pc.onicecandidate = e => {
    if(!e.candidate) return;
    ref.collection('viewerIce').add(e.candidate.toJSON()).catch(()=>{});
  };

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  await ref.set({
    offer: { type: offer.type, sdp: offer.sdp },
    from: currentUser.uid,
    name: (currentProfile && currentProfile.name) || 'Viewer',
    ts: Date.now(),
  });

  const unsub = ref.onSnapshot(async snap => {
    if(!snap.exists) return;
    const d = snap.data() || {};
    if(d.rejected){
      toast('Live room is full — try again soon');
      bLiveLeaveViewer();
      return;
    }
    if(d.answer && !bLiveViewerRemoteSet){
      try{
        await pc.setRemoteDescription(new RTCSessionDescription(d.answer));
        bLiveViewerRemoteSet = true;
        bLivePendingHostIce.forEach(function(cand){
          pc.addIceCandidate(new RTCIceCandidate(cand)).catch(function(){});
        });
        bLivePendingHostIce = [];
      }catch(e){ console.warn(e); }
    }
  });
  bLiveViewerUnsubs.push(unsub);

  const hostIceUnsub = ref.collection('hostIce').onSnapshot(snap => {
    snap.docChanges().forEach(ch => {
      if(ch.type !== 'added') return;
      const cand = ch.doc.data();
      if(bLiveViewerRemoteSet) pc.addIceCandidate(new RTCIceCandidate(cand)).catch(function(){});
      else bLivePendingHostIce.push(cand);
    });
  });
  bLiveViewerUnsubs.push(hostIceUnsub);

  bLiveWatchReactions(activeBroadcastId);
  bLiveWatchViewerCount(activeBroadcastId);

  const leaveBtn = $('bspaceJoinLiveBtn');
  if(leaveBtn){
    leaveBtn.textContent = 'Leave live';
    leaveBtn.onclick = ()=> bLiveLeaveViewer();
  }
  const hint = $('bspaceReactionJoinHint');
  if(hint){ hint.textContent = 'Leave live'; hint.onclick = ()=> bLiveLeaveViewer(); }
  const ban = $('bspaceJoinLiveBanner');
  if(ban) ban.style.display = 'flex';
  toast('You’re in the live room');
}

async function bLiveLeaveViewer(){
  if(fbDb && activeBroadcastId && currentUser){
    try{
      await bLiveSessionRef(activeBroadcastId, currentUser.uid).delete();
    }catch(_){}
  }
  bLiveCleanupViewer();
  const leaveBtn = $('bspaceJoinLiveBtn');
  if(leaveBtn){
    leaveBtn.textContent = 'Join live';
    leaveBtn.onclick = ()=> bLiveJoinAsViewer();
  }
  // Hide banner only if host is no longer live
  try{
    if(fbDb && activeBroadcastId){
      fbDb.collection('broadcasts').doc(activeBroadcastId).get().then(snap=>{
        const live = snap.exists && !!(snap.data() || {}).live;
        const ban = $('bspaceJoinLiveBanner');
        if(ban) ban.style.display = live ? 'flex' : 'none';
        if(!live && typeof renderBspaceMedia === 'function' && activeBroadcastMeta && activeBroadcastMeta.segment){
          const vel = document.getElementById('bspaceVideoEl');
          const healthy = vel && (vel.readyState >= 1 || !vel.paused || (vel.currentSrc || vel.src));
          if(!healthy) renderBspaceMedia(activeBroadcastMeta.segment);
        }
      }).catch(()=>{});
    }
  }catch(_){}
}

function bLiveWatchViewerCount(bcastId){
  if(bLiveViewerCountUnsub){ try{ bLiveViewerCountUnsub(); }catch(_){} }
  bLiveViewerCountUnsub = fbDb.collection('broadcasts').doc(bcastId).collection('liveSessions')
    .onSnapshot(snap => {
      bLiveUpdateViewerChrome(snap.size);
    }, ()=>{});
}

/* ---------------- Reactions (wow) ---------------- */
function bLiveWatchReactions(bcastId){
  if(bLiveReactionUnsub){ try{ bLiveReactionUnsub(); }catch(_){} }
  const layer = $('bspaceReactionLayer') || (function(){
    const hero = $('bspaceHero');
    if(!hero) return null;
    const d = document.createElement('div');
    d.id = 'bspaceReactionLayer';
    d.style.cssText = 'pointer-events:none;position:absolute;inset:0;z-index:4;overflow:hidden;';
    hero.appendChild(d);
    return d;
  })();

  bLiveReactionUnsub = fbDb.collection('broadcasts').doc(bcastId).collection('liveReactions')
    .orderBy('ts', 'desc').limit(15)
    .onSnapshot(snap => {
      snap.docChanges().forEach(ch => {
        if(ch.type !== 'added') return;
        const emoji = (ch.doc.data() || {}).emoji || '✨';
        bLiveSpawnReaction(emoji);
      });
    }, ()=>{});
}

function bLiveSpawnReaction(emoji){
  const layer = $('bspaceReactionLayer');
  if(!layer) return;
  const span = document.createElement('span');
  span.textContent = emoji;
  span.style.cssText = `position:absolute;bottom:10%;left:${20+Math.random()*60}%;font-size:${22+Math.random()*16}px;animation:bLiveFloat 2.4s ease-out forwards;opacity:0.95;`;
  layer.appendChild(span);
  setTimeout(()=> span.remove(), 2500);
}

async function bLiveSendReaction(emoji){
  if(!fbDb || !currentUser || !activeBroadcastId) return;
  try{
    await fbDb.collection('broadcasts').doc(activeBroadcastId).collection('liveReactions').add({
      emoji: emoji || '✨',
      from: currentUser.uid,
      ts: Date.now(),
    });
  }catch(_){}
}

function bLiveEnsureReactionBar(){
  if($('bspaceReactionBar')) return;
  const body = document.querySelector('.bspace-body');
  if(!body) return;
  const bar = document.createElement('div');
  bar.id = 'bspaceReactionBar';
  bar.style.cssText = 'display:none;gap:8px;flex-wrap:wrap;margin:0 0 14px;';
  ;['🔥','❤️','👏','✨','🤯','🙌'].forEach(em => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = em;
    b.className = 'bspace-mini';
    b.style.fontSize = '16px';
    b.onclick = ()=> bLiveSendReaction(em);
    bar.appendChild(b);
  });
  const join = document.createElement('button');
  join.type = 'button';
  join.id = 'bspaceReactionJoinHint';
  join.className = 'bspace-mini primary';
  join.textContent = 'Join live';
  join.onclick = ()=> bLiveJoinAsViewer();
  bar.appendChild(join);
  body.insertBefore(bar, body.firstChild.nextSibling);
}

function bLiveEnsureJoinBanner(){
  let ban = $('bspaceJoinLiveBanner');
  if(ban) return ban;
  ban = document.createElement('div');
  ban.id = 'bspaceJoinLiveBanner';
  ban.style.cssText = 'display:none;margin:0 0 12px;padding:12px 14px;border-radius:14px;border:1px solid rgba(255,84,112,.55);background:linear-gradient(135deg,rgba(255,84,112,.18),rgba(124,255,178,.08));align-items:center;gap:12px;flex-wrap:wrap;';
  ban.innerHTML = `<div style="flex:1;min-width:140px;">
      <div style="font-family:var(--font-mono);font-size:10px;color:var(--red);letter-spacing:.08em;margin-bottom:4px;">● LIVE NOW</div>
      <div style="font-size:13.5px;font-weight:600;">The creator is live — watch and react in real time.</div>
    </div>
    <button type="button" id="bspaceJoinLiveBtn" class="bspace-mini primary" style="padding:10px 16px;font-size:12px;">Join live</button>`;
  // Prefer pin host, else top of body
  const pin = $('bspaceLivePin');
  const body = document.querySelector('.bspace-body');
  if(pin && pin.parentNode){
    pin.parentNode.insertBefore(ban, pin.nextSibling);
  } else if(body){
    body.insertBefore(ban, body.firstChild);
  }
  const btn = ban.querySelector('#bspaceJoinLiveBtn');
  if(btn) btn.onclick = ()=> bLiveJoinAsViewer();
  return ban;
}

function bLiveShowJoinUi(show){
  bLiveEnsureReactionBar();
  const bar = $('bspaceReactionBar');
  const ban = bLiveEnsureJoinBanner();
  if(show){
    if(ban){
      ban.style.display = 'flex';
      const btn = $('bspaceJoinLiveBtn');
      // Don't reset if already in room
      if(btn && !bLiveViewerPc){
        btn.textContent = 'Join live';
        btn.onclick = ()=> bLiveJoinAsViewer();
        btn.style.display = '';
      }
    }
    if(bar) bar.style.display = 'flex';
  } else {
    if(ban && !bLiveViewerPc) ban.style.display = 'none';
    if(bar && !bLiveViewerPc) bar.style.display = 'none';
  }
}

/* Hooks used by broadcast-space.js */
async function bLiveOnHostStarted(stream){
  await bLiveStartHost(stream);
  bLiveShowJoinUi(false); // host doesn't join as viewer
  bLiveEnsureReactionBar();
  const bar = $('bspaceReactionBar');
  if(bar){
    bar.style.display = 'flex';
    const j = $('bspaceJoinLiveBtn');
    if(j) j.style.display = 'none';
  }
}

async function bLiveOnHostStopped(){
  await bLiveStopHost();
  bLiveShowJoinUi(false);
}

function bLiveOnSpaceOpened(isLive, isCreator){
  bLiveEnsureReactionBar();
  bLiveEnsureJoinBanner();
  if(isLive && !isCreator){
    bLiveShowJoinUi(true);
    if(activeBroadcastId) bLiveWatchViewerCount(activeBroadcastId);
    // Make join impossible to miss
    const badge = $('bspaceLiveBadge');
    if(badge){ badge.style.display = 'block'; badge.textContent = 'LIVE NOW — JOIN'; }
  } else if(isLive && isCreator){
    bLiveShowJoinUi(false);
    const ban = $('bspaceJoinLiveBanner');
    if(ban) ban.style.display = 'none';
  } else {
    if(!bLiveViewerPc) bLiveShowJoinUi(false);
    const ban = $('bspaceJoinLiveBanner');
    if(ban && !bLiveViewerPc) ban.style.display = 'none';
  }
}

function bLiveOnSpaceClosed(){
  if(bLiveHost) bLiveStopHost();
  bLiveLeaveViewer();
  if(bLiveViewerCountUnsub){ try{ bLiveViewerCountUnsub(); }catch(_){} bLiveViewerCountUnsub = null; }
  if(bLiveReactionUnsub){ try{ bLiveReactionUnsub(); }catch(_){} bLiveReactionUnsub = null; }
  const bar = $('bspaceReactionBar');
  if(bar) bar.style.display = 'none';
}

// CSS animation once
(function injectBLiveCss(){
  if(document.getElementById('bLiveStyle')) return;
  const s = document.createElement('style');
  s.id = 'bLiveStyle';
  s.textContent = `@keyframes bLiveFloat{0%{transform:translateY(0) scale(1);opacity:0}15%{opacity:1}100%{transform:translateY(-120px) scale(1.3);opacity:0}}`;
  document.head.appendChild(s);
})();
