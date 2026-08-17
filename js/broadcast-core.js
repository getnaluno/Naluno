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

function signalTtlMs(){
  return SIGNAL_TTL_OPTIONS[signalTtlChoice] || SIGNAL_TTL_OPTIONS[24];
}

function broadcastShareUrl(id){
  const base = (location.origin && location.origin !== 'null') ? location.origin : 'https://getnaluno.com';
  return base.replace(/\/$/, '') + '/?broadcast=' + encodeURIComponent(id);
}

/** Unique Naluno thumbnail: diagonal “frequency plate” with mint edge + title band */
function broadcastThumbHtml(b){
  const title = escapeHtml((b.title || 'Broadcast').slice(0, 48));
  const creator = escapeHtml((b.creatorName || 'Someone').split(' ')[0]);
  const thumb = b.thumbUrl || '';
  const media = thumb || ((b.mediaType === 'photo') ? (b.mediaUrl || '') : '');
  const inner = media
    ? `<img src="${escapeHtml(media)}" alt="" class="bcast-plate-media" loading="lazy" onerror="this.style.display='none';this.parentNode.classList.add('no-thumb')" />`
    : `<div class="bcast-plate-fallback">${escapeHtml((b.creatorName || '?').slice(0,1).toUpperCase())}</div>`;
  const live = b.live ? `<span class="bcast-plate-live">LIVE</span>` : '';
  return `<article class="bcast-plate" data-broadcast-id="${escapeHtml(b.id)}" role="button" tabindex="0">
    <div class="bcast-plate-frame">
      ${inner}
      ${live}
      <div class="bcast-plate-scan"></div>
    </div>
    <div class="bcast-plate-meta">
      <div class="bcast-plate-title">${title}</div>
      <div class="bcast-plate-sub">${creator}${b.tags && b.tags[0] ? ' · ' + escapeHtml(b.tags[0]) : ''}</div>
    </div>
  </article>`;
}

async function createPermanentBroadcast({ title, description, tags, mediaType, mediaUrl, thumbUrl, filterCss, chapters, breathers }){
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
    thumbUrl: thumbUrl || null,
    filterCss: filterCss || '',
    chapters: chapterList,
    breathers: Array.isArray(breathers) ? breathers : null,
    createdAt: now,
    updatedAt: now,
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
  if(snap.data().creatorUid !== currentUser.uid) throw new Error('Only the creator can delete');
  // Soft-delete community content is heavy; mark deleted and hide from feeds
  await ref.set({ deleted: true, deletedAt: Date.now(), live: false }, { merge: true });
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
    }catch(_){ myBroadcasts = []; }
  }
}

let feedBroadcastsUnsub = null;
let myBroadcastsUnsub = null;

function applyBroadcastDocsToFeed(docs){
  const list = [];
  docs.forEach(d => {
    const data = d.data() || {};
    if(!data.deleted) list.push({ id: d.id, ...data });
  });
  list.sort((a,b) => (b.live ? 1 : 0) - (a.live ? 1 : 0) || (b.updatedAt||b.createdAt||0) - (a.updatedAt||a.createdAt||0));
  feedBroadcasts = list.slice(0, 80);
  if(typeof renderBroadcastTab === 'function') renderBroadcastTab();
}

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

async function notifyFrequenciesLive(broadcastId, title){
  if(!currentUser || !fbDb) return;
  const real = (contacts || []).filter(c => c.isReal && c.firebaseUid);
  const payload = {
    type: 'broadcast_live',
    fromUid: currentUser.uid,
    fromName: (currentProfile && currentProfile.name) || 'Someone',
    broadcastId,
    title: title || 'Live',
    createdAt: Date.now(),
    read: false,
  };
  await Promise.all(real.slice(0, 40).map(c =>
    fbDb.collection('users').doc(c.firebaseUid).collection('notifications').add(payload).catch(()=>{})
  ));
  // Also try push via existing notify worker if present
  if(typeof sendPushToContact === 'function'){
    real.forEach(c => {
      try{ sendPushToContact(c, { title: 'Live on Naluno', body: (payload.fromName) + ' went live: ' + (title||'') }); }catch(_){}
    });
  }
}

function openBroadcastById(id){
  if(!id) return;
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
      if(i >= 40) break;
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
      if(i >= 40) break;
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
    if(i >= 40) break;
  }
  return { mode: 'multipart', parts, midrolls: [], showChapterUI: parts.length > 1 };
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
