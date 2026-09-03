/* OWNERSHIP (broadcast-core.js): Broadcast VOD/live community only.
   MUST NOT touch: calls peerConnection, remoteCombinedStream, bandMeshPcs.
   ICE for live: getIceServers() from ice-core. Playback: <video src> only. */
/* ============================================================
   MODULE: js/broadcast-core.js
   Permanent Broadcasts — not Signals.
   A Broadcast is a lasting community around media (YouTube-like permanence).
   A Signal is a short ephemeral clip (separate module: signal-*).
   OWNERSHIP: CRUD, search, share links, delete, list cache.
   ============================================================ */

let myBroadcasts = [];          // permanent docs I created
let feedBroadcasts = [];        // from connections + mine for tab
let broadcastSearchResults = [];
let composerMode = 'signal';    // 'signal' | 'broadcast'
let signalTtlChoice = 24;       // hours: 24 | 72 | 168

const SIGNAL_TTL_OPTIONS = {
  24:  24 * 60 * 60 * 1000,
  72:  72 * 60 * 60 * 1000,
  168: 168 * 60 * 60 * 1000,
};

/* The naluno-signal R2 bucket deletes every object after 25 hours (a bucket
   lifecycle rule — confirmed against signal-worker/index.js, which sets no
   expiry of its own, so the bucket is the only thing controlling this).
   Promising a longer life than storage actually keeps is what caused the
   "Signal stops working before the set days" bug: Firestore honoured 3/7
   days correctly while the video file itself was already gone at ~25h.
   Capping here (not just hiding the chips in index.html) so a stale cached
   page, an old saved preference, or any other path that still carries 72
   or 168 can't reintroduce it. Raise this to 168 the moment that bucket's
   lifecycle rule is extended — that single change plus restoring the two
   chips is the whole fix; SIGNAL_TTL_OPTIONS already supports both. */
const SIGNAL_TTL_MAX_HOURS = 24;

function signalTtlMs(){
  const hours = Math.min(Number(signalTtlChoice) || 24, SIGNAL_TTL_MAX_HOURS);
  return SIGNAL_TTL_OPTIONS[hours] || SIGNAL_TTL_OPTIONS[24];
}

function broadcastShareUrl(id){
  const base = (location.origin && location.origin !== 'null') ? location.origin : 'https://getnaluno.com';
  return base.replace(/\/$/, '') + '/?broadcast=' + encodeURIComponent(id);
}

/** Share a whole Strand (a creator's ordered set of Broadcasts), not just one item in it. */
function strandShareUrl(id){
  const base = (location.origin && location.origin !== 'null') ? location.origin : 'https://getnaluno.com';
  return base.replace(/\/$/, '') + '/?strand=' + encodeURIComponent(id);
}

/** Unique Naluno thumbnail: diagonal “frequency plate” with mint edge + title band */
function broadcastThumbHtml(b){
  const title = escapeHtml((b.title || 'Broadcast').slice(0, 48));
  const creator = escapeHtml((b.creatorName || 'Someone').split(' ')[0]);
  const thumb = b.thumbUrl || '';
  const photo = thumb || ((b.mediaType === 'photo') ? (b.mediaUrl || '') : '');
  const preview = (!b.live && b.mediaType !== 'photo')
    ? (b.mediaUrl || b.videoUrl || '')
    : '';
  let inner;
  if(preview){
    inner = (photo ? `<img src="${escapeHtml(photo)}" alt="" class="strand-poster" />` : '')
      + `<video class="strand-preview" muted playsinline webkit-playsinline loop preload="none" poster="${escapeHtml(photo)}" data-preview-src="${escapeHtml(preview)}" data-naluno-preview="1"></video>`;
  } else if(photo){
    inner = `<img src="${escapeHtml(photo)}" alt="" class="bcast-plate-media" loading="lazy" onerror="this.style.display='none';this.parentNode.classList.add('no-thumb')" />`;
  } else {
    inner = `<div class="bcast-plate-fallback">${escapeHtml((b.creatorName || '?').slice(0,1).toUpperCase())}</div>`;
  }
  const live = b.live ? `<span class="bcast-plate-live">LIVE</span>` : '';
  const viewsBit = (typeof formatNalunoViews === 'function' && (b.shareViews !== false))
    ? `<span class="bcast-plate-views">${escapeHtml(formatNalunoViews(b.views || 0))}</span>`
    : '';
  return `<article class="bcast-plate" data-broadcast-id="${escapeHtml(b.id)}" role="button" tabindex="0">
    <div class="bcast-plate-frame">
      ${inner}
      ${live}
      ${viewsBit}
      <div class="bcast-plate-scan"></div>
    </div>
    <div class="bcast-plate-meta">
      <div class="bcast-plate-title">${title}</div>
      <div class="bcast-plate-sub">${creator}${b.strandName ? ' · ' + escapeHtml(b.strandName) : (b.tags && b.tags[0] ? ' · ' + escapeHtml(b.tags[0]) : '')}</div>
    </div>
  </article>`;
}

async function createPermanentBroadcast({ title, description, tags, mediaType, mediaUrl, thumbUrl, filterCss, chapters, breathers, strandId, strandName, origin }){
  if(!currentUser || !fbDb) throw new Error('Sign in required');
  const now = Date.now();
  const ref = fbDb.collection('broadcasts').doc();
  // chapters: [{ index, mediaUrl, duration, title?, bytes? }]
  // breathers: [{ afterChapterIndex, durationMs, adSlot: { enabled, inventoryId, status } }]
  const chapterList = Array.isArray(chapters) ? chapters : null;
  const primaryUrl = mediaUrl || (chapterList && chapterList[0] && chapterList[0].mediaUrl) || null;
  const doc = {
    creatorUid: currentUser.uid,
    creatorName: (currentProfile && currentProfile.name) || currentUser.displayName || 'Someone',
    title: (title || 'Broadcast').slice(0, 120),
    description: (description || '').slice(0, 2000),
    tags: (tags || []).slice(0, 12).map(t => String(t).toLowerCase().slice(0, 32)),
    mediaType: mediaType || 'photo',
    mediaUrl: primaryUrl,
    mediaId: (typeof nalunoMediaIdFromUrl === 'function' ? nalunoMediaIdFromUrl(primaryUrl) : null) || null,
    thumbUrl: thumbUrl || null,
    filterCss: filterCss || '',
    chapters: chapterList,
    breathers: Array.isArray(breathers) ? breathers : null,
    createdAt: now,
    updatedAt: now,
    views: 0,
    uniqueViews: 0,
    strandId: strandId || null,
    strandName: strandName || null,
    originStatus: (origin && origin.status) || 'clear',
    originScore: (origin && origin.score) || 0,
    originPhotoHash: (origin && origin.photoHash) || '',
    originAudioHash: (origin && origin.audioHash) || '',
    originFrameHashes: (origin && origin.frameHashes) || [],
    originIdentity: (origin && origin.identity) || '',
    originDna: (origin && origin.dna) || '',
    originMatchTitle: (origin && origin.matchTitle) || '',
    originHold: !!(origin && origin.hold),
    memberUids: [currentUser.uid],
    live: false,
    liveAt: null,
    liveBy: null,
    searchText: [
      title || '',
      description || '',
      (currentProfile && currentProfile.name) || '',
      ...(tags || []),
    ].join(' ').toLowerCase(),
  };
  await ref.set(doc);
  await ref.collection('journey').add({
    type: 'created',
    text: 'Broadcast published',
    ts: now,
    by: currentUser.uid,
  });
  try{
    if(typeof saveOriginMark === 'function' && origin) await saveOriginMark(ref.id, origin, title);
  }catch(_){}
  const full = { id: ref.id, ...doc };
  myBroadcasts = [full, ...myBroadcasts.filter(x => x.id !== ref.id)];
  // Optimistic plate update — don't wait for onSnapshot (avoids "must refresh")
  feedBroadcasts = [full, ...feedBroadcasts.filter(x => x.id !== ref.id)].slice(0, 80);
  if(typeof renderBroadcastTab === 'function') renderBroadcastTab();
  return full;
}

async function deletePermanentBroadcast(id){
  if(!currentUser || !fbDb || !id) return;
  const ref = fbDb.collection('broadcasts').doc(id);
  const snap = await ref.get();
  if(!snap.exists) return;
  const data = snap.data() || {};
  if(data.creatorUid !== currentUser.uid) throw new Error('Only the creator can delete');
  // Soft-delete community content is heavy; mark deleted and hide from feeds
  await ref.set({ deleted: true, deletedAt: Date.now(), live: false }, { merge: true });
  // FIX ("This Broadcast views don't add up to All of yours"): confirmed real.
  // "This Broadcast" reads each Broadcast's own views field; "All of yours"
  // reads toga/{creator}.viewsTotal, a cumulative counter incremented once
  // per view and never decremented. Deleting a Broadcast removed its own
  // views from anything summing the surviving Broadcasts, but left those
  // same views permanently baked into viewsTotal — so after any deletion,
  // "All of yours" stayed permanently higher than the individual numbers
  // could account for, with no way to ever reconcile. Subtracting the
  // deleted Broadcast's views keeps the two numbers describing the same
  // set of content. Clamped at zero server-side is not possible with
  // increment(), so a floor is applied on read (see paintBspaceViews) —
  // and this only ever runs for the creator deleting their own Broadcast,
  // which the check above already guarantees.
  try{
    const lostViews = Number(data.views) || 0;
    if(lostViews > 0){
      await fbDb.collection('toga').doc(currentUser.uid).set({
        viewsTotal: firebase.firestore.FieldValue.increment(-lostViews),
        updatedAt: Date.now(),
      }, { merge: true });
    }
  }catch(e){ console.warn('[broadcast] toga total adjust on delete', e); }
  myBroadcasts = myBroadcasts.filter(b => b.id !== id);
  feedBroadcasts = feedBroadcasts.filter(b => b.id !== id);
}

async function loadMyBroadcasts(){
  if(!currentUser || !fbDb) return;
  try{
    const snap = await fbDb.collection('broadcasts')
      .where('creatorUid', '==', currentUser.uid)
      .orderBy('createdAt', 'desc')
      .limit(40)
      .get();
    myBroadcasts = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(b => !b.deleted);
  }catch(e){
    // Fallback without composite index
    try{
      const snap = await fbDb.collection('broadcasts').where('creatorUid', '==', currentUser.uid).limit(40).get();
      myBroadcasts = snap.docs.map(d => ({ id: d.id, ...d.data() }))
        .filter(b => !b.deleted)
        .sort((a,b) => (b.createdAt||0) - (a.createdAt||0));
    }catch(_){
      const cached = nalunoCacheRead('myBroadcasts');
      if(cached && cached.length) myBroadcasts = cached;
    }
  }
  try{ nalunoCacheWrite('myBroadcasts', (myBroadcasts||[]).map(nalunoSlimMedia)); }catch(_){}
}

let feedBroadcastsUnsub = null;
let myBroadcastsUnsub = null;

function broadcastStableMediaId(b){
  if(!b) return '';
  if(b.mediaId) return b.mediaId;
  const raw = b.mediaUrl || b.videoUrl || '';
  if(typeof nalunoMediaIdFromUrl === 'function') return nalunoMediaIdFromUrl(raw);
  try{
    const m = String(raw).match(/u\/[A-Za-z0-9_-]+\/[A-Za-z0-9._-]+/);
    return m ? m[0] : '';
  }catch(_){ return ''; }
}

function applyBroadcastDocsToFeed(docs){
  // Merge by stable Firestore doc id — never replace identity from array order.
  // Strand folders still rebuild from the merged list (plates are thumbs, not players).
  const prevById = {};
  (feedBroadcasts || []).forEach(function(b){ if(b && b.id) prevById[b.id] = b; });
  const list = [];
  docs.forEach(function(d){
    const data = d.data() || {};
    if(data.deleted) return;
    const row = Object.assign({}, prevById[d.id] || {}, data, { id: d.id });
    row.mediaId = broadcastStableMediaId(row) || row.mediaId || null;
    list.push(row);
  });
  list.sort(function(a,b){
    return (b.live ? 1 : 0) - (a.live ? 1 : 0) || (b.updatedAt||b.createdAt||0) - (a.updatedAt||a.createdAt||0);
  });
  feedBroadcasts = list.slice(0, 80);
  try{ nalunoCacheWrite('feedBroadcasts', feedBroadcasts.map(nalunoSlimMedia)); }catch(_){}
  // Always go through renderBroadcastTab so Strand folders stay grouped.
  if(typeof renderBroadcastTab === 'function') renderBroadcastTab();
}
window.broadcastStableMediaId = broadcastStableMediaId;


/** Realtime plate list — no refresh required for new Broadcasts. */
function startFeedBroadcastsListener(){
  if(!fbDb || !currentUser) return;
  if(feedBroadcastsUnsub) return;
  function attach(query){
    return query.onSnapshot(
      snap => { applyBroadcastDocsToFeed(snap.docs); },
      err => {
        console.warn('[bcast] feed listener', err && err.message);
        // Missing index or rules — fall back once
        if(feedBroadcastsUnsub){
          try{ feedBroadcastsUnsub(); }catch(_){}
          feedBroadcastsUnsub = null;
        }
        if(!startFeedBroadcastsListener._fellBack){
          startFeedBroadcastsListener._fellBack = true;
          try{
            feedBroadcastsUnsub = attach(fbDb.collection('broadcasts').limit(80));
          }catch(e2){ console.warn('[bcast] feed fallback failed', e2); }
        }
      }
    );
  }
  try{
    feedBroadcastsUnsub = attach(
      fbDb.collection('broadcasts').orderBy('createdAt', 'desc').limit(80)
    );
  }catch(e){
    console.warn('[bcast] start feed listener', e);
    try{
      startFeedBroadcastsListener._fellBack = true;
      feedBroadcastsUnsub = attach(fbDb.collection('broadcasts').limit(80));
    }catch(_){}
  }
}

function startMyBroadcastsListener(){
  if(!fbDb || !currentUser) return;
  if(myBroadcastsUnsub) return;
  try{
    myBroadcastsUnsub = fbDb.collection('broadcasts')
      .where('creatorUid', '==', currentUser.uid)
      .onSnapshot(snap => {
        myBroadcasts = snap.docs
          .map(d => ({ id: d.id, ...d.data() }))
          .filter(b => !b.deleted)
          .sort((a,b) => (b.createdAt||0) - (a.createdAt||0));
        if(typeof renderBroadcastTab === 'function') renderBroadcastTab();
      }, err => console.warn('[bcast] my listener', err));
  }catch(e){ console.warn('[bcast] my listener start', e); }
}

async function loadFeedBroadcasts(){
  if(!currentUser || !fbDb) return;
  // Prefer live listener; still do one get for instant first paint
  startFeedBroadcastsListener();
  startMyBroadcastsListener();
  const uids = new Set([currentUser.uid]);
  (contacts || []).forEach(c => { if(c.isReal && c.firebaseUid) uids.add(c.firebaseUid); });
  const list = [];
  const arr = Array.from(uids);
  for(let i = 0; i < arr.length; i += 10){
    const chunk = arr.slice(i, i + 10);
    try{
      const snap = await fbDb.collection('broadcasts').where('creatorUid', 'in', chunk).limit(30).get();
      snap.docs.forEach(d => {
        const data = d.data();
        if(!data.deleted) list.push({ id: d.id, ...data });
      });
    }catch(_){}
  }
  list.sort((a,b) => (b.live ? 1 : 0) - (a.live ? 1 : 0) || (b.updatedAt||b.createdAt||0) - (a.updatedAt||a.createdAt||0));
  // Union with anything the realtime listener already delivered
  const byId = {};
  (feedBroadcasts || []).forEach(b => { byId[b.id] = b; });
  list.forEach(b => { byId[b.id] = b; });
  feedBroadcasts = Object.keys(byId).map(k => byId[k])
    .sort((a,b) => (b.live ? 1 : 0) - (a.live ? 1 : 0) || (b.updatedAt||b.createdAt||0) - (a.updatedAt||a.createdAt||0))
    .slice(0, 80);
  if(typeof renderBroadcastTab === 'function') renderBroadcastTab();
}

async function searchBroadcasts(query){
  const q = (query || '').trim().toLowerCase();
  if(!q || !fbDb){ broadcastSearchResults = []; return []; }
  // Client-side search over a recent public slice + feed (no full-text index required)
  let pool = feedBroadcasts.slice();
  try{
    const snap = await fbDb.collection('broadcasts').orderBy('createdAt', 'desc').limit(80).get();
    snap.docs.forEach(d => {
      const data = d.data();
      if(data.deleted) return;
      if(!pool.find(x => x.id === d.id)) pool.push({ id: d.id, ...data });
    });
  }catch(_){}
  const scored = pool.map(b => {
    const hay = (b.searchText || [b.title, b.description, b.creatorName, ...(b.tags||[])].join(' ')).toLowerCase();
    let score = 0;
    if(hay.includes(q)) score += 5;
    q.split(/\s+/).forEach(w => { if(w.length > 1 && hay.includes(w)) score += 2; });
    if((b.title||'').toLowerCase().startsWith(q)) score += 3;
    if(b.live) score += 4;
    return { b, score };
  }).filter(x => x.score > 0).sort((a,c) => c.score - a.score || (c.b.createdAt||0)-(a.b.createdAt||0));
  broadcastSearchResults = scored.map(x => x.b);
  return broadcastSearchResults;
}

/** Push a live alert to one person's device via the call-notify Worker (FCM). */
async function sendPushToContact(contactOrUid, msg){
  try{
    const uid = typeof contactOrUid === 'string'
      ? contactOrUid
      : (contactOrUid && (contactOrUid.firebaseUid || contactOrUid.uid));
    if(!uid || !currentUser) return;
    const workerUrl = (typeof CALL_NOTIFY_WORKER_URL === 'string' && CALL_NOTIFY_WORKER_URL)
      ? CALL_NOTIFY_WORKER_URL
      : 'https://naluno-call-notify.naluno.workers.dev';
    let tokens = { android: null, web: null, primary: null, platform: null };
    try{
      const snap = await fbDb.collection('users').doc(uid).get();
      if(snap.exists){
        const d = snap.data() || {};
        tokens.android = d.fcmTokenAndroid || null;
        tokens.web = d.fcmTokenWeb || null;
        tokens.primary = d.fcmToken || null;
        tokens.platform = d.fcmTokenPlatform || null;
      }
    }catch(_){}
    if(!tokens.android && !tokens.web && !tokens.primary) return;
    const idToken = await currentUser.getIdToken(false);
    const body = {
      calleeUid: uid,
      callerName: (msg && msg.fromName) || (currentProfile && currentProfile.name) || 'Someone',
      title: (msg && msg.title) || 'Live on Naluno',
      body: (msg && msg.body) || 'Someone is live',
      type: 'broadcast_live',
      broadcastId: (msg && msg.broadcastId) || null,
      fcmTokenAndroid: tokens.android,
      fcmTokenWeb: tokens.web,
      fcmToken: tokens.primary,
      fcmTokenPlatform: tokens.platform,
    };
    await fetch(workerUrl, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + idToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    }).catch(function(){});
  }catch(e){ console.warn('[live] push', e); }
}
window.sendPushToContact = sendPushToContact;

/** Drop a real Wireline message (not just a notification/push) into every
 *  community member's thread with the creator when they go live — so people
 *  who follow via Wireline see it as a normal message, not just a badge. */
async function wirelineNotifyLive(uids, fromName, liveTitle, broadcastId){
  if(!fbDb || !currentUser || !uids || !uids.length) return;
  const text = fromName + ' is live now: ' + liveTitle + ' — open Broadcast to join.';
  await Promise.all(uids.map(async function(uid){
    try{
      const tid = [currentUser.uid, uid].sort().join('_');
      const threadRef = fbDb.collection('threads').doc(tid);
      await threadRef.set({
        participants: [currentUser.uid, uid].sort(),
        lastMessageAt: firebase.firestore.FieldValue.serverTimestamp(),
        lastMessageText: text,
        lastMessageFrom: currentUser.uid,
        readBy: [currentUser.uid],
      }, { merge: true });
      await threadRef.collection('messages').add({
        from: currentUser.uid,
        ts: firebase.firestore.FieldValue.serverTimestamp(),
        status: 'sent',
        type: 'text',
        text: text,
        encrypted: false,
        liveBroadcastId: broadcastId || null,
      });
    }catch(_){ /* best-effort — a missed Wireline nudge isn't worth surfacing an error for */ }
  }));
}

async function notifyFrequenciesLive(broadcastId, title){
  if(!currentUser || !fbDb) return;
  const fromName = (currentProfile && currentProfile.name) || 'Someone';
  const liveTitle = title || 'Broadcast';
  // Present tense while live is ongoing
  const pushBody = fromName + ' is live: ' + liveTitle;
  const payload = {
    type: 'broadcast_live',
    fromUid: currentUser.uid,
    fromName: fromName,
    broadcastId,
    title: liveTitle,
    createdAt: Date.now(),
    read: false,
  };
  // Frequencies (real contacts)
  const real = (contacts || []).filter(c => c.isReal && c.firebaseUid);
  const uids = new Set(real.map(c => c.firebaseUid));
  // Community = Circle members of this creator
  try{
    const circleSnap = await fbDb.collection('users').doc(currentUser.uid).collection('circle').limit(80).get();
    circleSnap.docs.forEach(function(d){ if(d.id) uids.add(d.id); });
  }catch(_){}
  // Broadcast members
  try{
    if(broadcastId){
      const bsnap = await fbDb.collection('broadcasts').doc(broadcastId).get();
      if(bsnap.exists){
        const members = (bsnap.data() || {}).memberUids || [];
        members.forEach(function(uid){ if(uid) uids.add(uid); });
      }
    }
  }catch(_){}
  uids.delete(currentUser.uid);
  const list = Array.from(uids).slice(0, 60);
  await Promise.all(list.map(function(uid){
    return fbDb.collection('users').doc(uid).collection('notifications').add(payload).catch(function(){});
  }));
  // Device push even when Naluno is closed
  list.forEach(function(uid){
    sendPushToContact(uid, {
      title: 'Live on Naluno',
      body: pushBody,
      fromName: fromName,
      broadcastId: broadcastId,
    });
  });
  // A real Wireline message too, not just a notification badge/push — this is
  // what "for those in the community" actually see in their conversation.
  try{ await wirelineNotifyLive(list, fromName, liveTitle, broadcastId); }catch(_){}
}
window.notifyFrequenciesLive = notifyFrequenciesLive;

function openBroadcastById(id){
  if(!id) return;
  try{ if(typeof pauseAllStrandPreviews === 'function') pauseAllStrandPreviews(); }catch(_){}
  if(typeof openBroadcastSpaceById === 'function') openBroadcastSpaceById(id);
  else toast('Opening Broadcast…');
}

/** Deep link ?broadcast= */
(function broadcastDeepLink(){
  try{
    const params = new URLSearchParams(location.search || '');
    const id = params.get('broadcast');
    if(!id) return;
    let n = 0;
    const iv = setInterval(()=>{
      n++;
      if(currentUser && fbDb){
        clearInterval(iv);
        openBroadcastById(id);
      }
      if(n > 50) clearInterval(iv);
    }, 200);
  }catch(_){}
})();

/** Deep link ?strand= — open the whole shared Strand (folder), not one item. */
(function strandDeepLink(){
  try{
    const params = new URLSearchParams(location.search || '');
    const id = params.get('strand');
    if(!id) return;
    let n = 0;
    const iv = setInterval(()=>{
      n++;
      if(currentUser && fbDb){
        clearInterval(iv);
        const nav = document.querySelector('.navbtn[data-tab="broadcast"]');
        if(nav) nav.click();
        // The Strand's own items load into feedBroadcasts asynchronously —
        // retry briefly instead of opening to an empty folder on a cold start.
        let tries = 0;
        const open = function(){
          tries++;
          const found = (feedBroadcasts || []).some(function(b){ return b && b.strandId === id; });
          if(found || tries > 15){
            if(typeof openStrandFolder === 'function') openStrandFolder(id);
            return;
          }
          setTimeout(open, 300);
        };
        open();
      }
      if(n > 50) clearInterval(iv);
    }, 200);
  }catch(_){}
})();


/** Plan chapter breaks.
 * Visible chapters ONLY when duration > 4 minutes (product rule).
 * Large-but-short files use silent upload slices (no chapter UI) or a single compress.
 */
function planBroadcastChapters(fileSize, durationSec){
  const maxBytes = (typeof UPLOAD_MAX_BYTES === 'number') ? UPLOAD_MAX_BYTES : (95 * 1024 * 1024);
  const targetBytes = (typeof CHAPTER_TARGET_BYTES === 'number') ? CHAPTER_TARGET_BYTES : (45 * 1024 * 1024);
  const targetSec = (typeof CHAPTER_TARGET_SECONDS === 'number') ? CHAPTER_TARGET_SECONDS : 240;
  const dur = Math.max(0.5, durationSec || 0);
  const size = Math.max(1, fileSize || 0);
  const wantVisibleChapters = dur > targetSec; // strictly longer than 4 minutes
  // Files larger than one Worker request MUST split — even under 4 minutes

  // Build ~4 min chapter time marks (UI + breathers) regardless of upload strategy
  function chapterMarks(){
    const parts = [];
    let i = 0;
    for(let start = 0; start < dur - 0.5; start += targetSec){
      parts.push({ start, end: Math.min(dur, start + targetSec), index: i++ });
      if(i >= 45) break;
    }
    return parts;
  }

  if(!wantVisibleChapters){
    if(size <= maxBytes){
      return { mode: 'single', parts: [{ start: 0, end: dur, index: 0 }], midrolls: [], showChapterUI: false };
    }
    // oversized short video → silent multipart (upload slices)
    // Over worker max but short: silent byte-oriented time slices for upload only
    const bytesPerSec = size / dur;
    const sliceSec = Math.max(20, Math.min(dur, Math.floor(targetBytes / Math.max(1, bytesPerSec))));
    const parts = [];
    let i = 0;
    for(let start = 0; start < dur - 0.25; start += sliceSec){
      parts.push({ start, end: Math.min(dur, start + sliceSec), index: i++ });
      if(i >= 45) break;
    }
    return { mode: 'silent_multipart', parts, midrolls: [], showChapterUI: false };
  }

  // Long video (>4 min)
  // If the whole file fits under the worker max, upload ONCE and use seek-based chapters
  // (no browser re-encode — that is what was failing on phones).
  if(size <= maxBytes){
    const marks = chapterMarks();
    return {
      mode: 'single_with_markers',
      parts: marks,
      midrolls: [],
      showChapterUI: marks.length > 1,
    };
  }

  // File too large for one upload → must split/re-encode slices
  const bytesPerSec = size / dur;
  const maxSecByBytes = Math.max(45, Math.floor(targetBytes / Math.max(1, bytesPerSec)));
  const sliceSec = Math.min(targetSec, maxSecByBytes);
  const parts = [];
  let i = 0;
  for(let start = 0; start < dur - 0.5; start += sliceSec){
    parts.push({ start, end: Math.min(dur, start + sliceSec), index: i++ });
    if(i >= 45) break;
  }
  return { mode: 'multipart', parts, midrolls: [], showChapterUI: parts.length > 1 };
}

function chapterIsActive(ch){
  if(!ch) return false;
  if(ch.silent) return false;
  if(ch.status === 'removed' && !ch.replacementUrl) return false;
  return true;
}

function nextActiveChapterIndex(list, fromIndex){
  const rows = list || [];
  for(let i = (fromIndex || 0) + 1; i < rows.length; i++){
    if(chapterIsActive(rows[i])) return i;
  }
  return -1;
}

function firstActiveChapterIndex(list){
  const rows = list || [];
  for(let i = 0; i < rows.length; i++){
    if(chapterIsActive(rows[i])) return i;
  }
  return 0;
}

/** Default breathers between real chapters — ad architecture lives here. */
function buildBreathersForChapters(chapterCount){
  const list = [];
  for(let i = 0; i < chapterCount - 1; i++){
    list.push({
      afterChapterIndex: i,
      durationMs: 1200,
      label: 'Chapter break',
      // Future ads: fill this slot without changing player structure
      adSlot: {
        enabled: true,
        inventoryId: null,   // e.g. 'naluno-midroll-v1'
        status: 'reserved',  // reserved | ready | playing | completed | skipped
        maxDurationMs: 15000,
      },
    });
  }
  return list;
}
