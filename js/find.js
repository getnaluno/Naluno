/* ============================================================
   MODULE: js/find.js
   Find People search + connect requests
   OWNERSHIP: change this domain here only.
   Scripts share globals (intentional) so load order matches the old monolith.
   ============================================================ */
/* ---------------- FIND PEOPLE (real search + connect) ----------------
   Real connections merge into the same `contacts` array everything else already reads —
   Wireline, Band, calls, signal strength all keep working unmodified. Demo contacts use
   ids 1-6; real ones start far above that, so there's no collision risk. Each real entry
   also carries firebaseUid, which is what future real-Wireline/real-calls work will use. */
let nextRealContactId = 1000000;
function addRealContactToLocalList(firebaseUid, name, color, handle, photo){
  const existing = contacts.find(c=>c.firebaseUid===firebaseUid);
  if(existing){
    existing.name = name;
    existing.color = color || existing.color;
    existing.handle = handle || existing.handle;
    existing.initials = initialsFor(name);
    // Never wipe a photo we already have just because the connection snapshot
    // arrived without one — that is why Wireline/Frequencies lost avatars
    // while Toga (which reads users/{uid}.photoUrl) still showed them.
    mergeContactPhoto(existing, photo);
    return existing;
  }
  const row = {
    id: nextRealContactId++,
    firebaseUid,
    name,
    initials: initialsFor(name),
    color: color || '#7CFFB2',
    handle: handle || '',
    photo: photo || null,
    lastActivityTs: Date.now(), // freshly connected — reachable right now, decays normally after
    isReal: true,
  };
  mergeContactPhoto(row, photo);
  contacts.push(row);
  return row;
}
/* Resolve a displayable avatar URL from every shape this app has stored.
   Prefer https (R2 / photoUrl). Samsung Chrome often fails CSS background-image
   with large data: URLs, which is why Toga (an <img>) showed faces and
   Wireline/Frequencies (background-image + blanked initials) showed empty circles. */
function contactPhotoSrc(c, opts){
  if(!c) return '';
  try{
    const photo = c.photo;
    const httpsFirst = [];
    const dataLater = [];
    const rawList = [
      c.photoUrl,
      photo && photo.url,
      photo && photo.downloadUrl,
      photo && photo.dataUrl,
      (typeof photo === 'string') ? photo : ''
    ];
    for(let i = 0; i < rawList.length; i++){
      const raw = String(rawList[i] || '').trim();
      if(!raw) continue;
      const u = raw.replace(/['"\\]/g, '');
      if(/^https?:/i.test(u) || /^blob:/i.test(u)) httpsFirst.push(u);
      else if(/^data:image\//i.test(u)) dataLater.push(u);
    }
    if(httpsFirst.length) return httpsFirst[0];
    // List rows (compact) never use data: URLs — Samsung Chrome paints those
    // as a black disc over the initials. Photos in lists need an https URL.
    if(opts && (opts.skipData || opts.compact)) return '';
    if(dataLater.length){
      const u = dataLater[0];
      if(opts && opts.compact && u.length > 140000) return '';
      return u;
    }
  }catch(_){}
  return '';
}
function contactAvatarColor(c){
  const color = String((c && c.color) || '#7CFFB2');
  return /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$/.test(color) ? color : '#7CFFB2';
}
function mergeContactPhoto(target, incoming){
  if(!target) return;
  const existingHttps = contactPhotoSrc(target, { skipData: true });
  if(incoming && typeof incoming === 'object'){
    const src = contactPhotoSrc({ photo: incoming, photoUrl: incoming.photoUrl || incoming.url || incoming.dataUrl });
    if(!src) return;
    if(/^https?:/i.test(src)){
      target.photoUrl = src;
      target.photo = incoming;
      if(!target.photo.dataUrl) target.photo.dataUrl = src;
    } else if(!existingHttps){
      target.photo = incoming;
    }
  } else if(typeof incoming === 'string' && /^(data:image\/|https?:|blob:)/i.test(incoming)){
    if(/^https?:/i.test(incoming)){
      target.photoUrl = incoming;
      target.photo = { dataUrl: incoming };
    } else if(!existingHttps){
      target.photo = { dataUrl: incoming };
    }
  }
}
/* Color + initials ALWAYS. Photo is an <img> on top so a failed load never
   leaves a blank disc — onerror just removes the image. */
function contactAvatarHtml(c, sizePx, extraInner){
  const size = sizePx || 46;
  const font = Math.max(10, Math.round(size * 0.33));
  const color = contactAvatarColor(c);
  const rawInit = String((c && c.initials) || '').trim();
  const fallback = (typeof initialsFor === 'function')
    ? initialsFor((c && c.name) || 'Y')
    : String(((c && c.name) || '?').replace(/^\s+/, '').slice(0, 1)).toUpperCase();
  const initialsText = rawInit || fallback || '?';
  const initials = (typeof escapeHtml === 'function') ? escapeHtml(initialsText) : initialsText;
  const src = contactPhotoSrc(c, { compact: true });
  const img = src
    ? '<img class="avatar-pic" alt="" referrerpolicy="no-referrer" src="'+src+'" onerror="this.onerror=null;this.remove();">'
    : '';
  return '<div class="avatar" style="width:'+size+'px;height:'+size+'px;font-size:'+font+'px;background:'+color+';position:relative;overflow:hidden;color:#0D0F17;">'
    + initials + img + (extraInner || '') + '</div>';
}
function contactAvatarStyleAttr(c){
  // Never emit background-image here. Callers that still concatenate this
  // into a style attr get a solid color; the <img> overlay is contactAvatarHtml.
  return 'background:' + contactAvatarColor(c) + ';';
}
function applyContactAvatarToEl(el, c){
  if(!el || !c) return;
  try{
    el.style.backgroundImage = '';
    el.style.background = contactAvatarColor(c);
    el.style.position = el.style.position || 'relative';
    el.style.overflow = 'hidden';
    el.style.color = '#0D0F17';
    const rawInit = String(c.initials || '').trim();
    const fallback = (typeof initialsFor === 'function')
      ? initialsFor(c.name || 'Y')
      : String((c.name || '?').replace(/^\s+/, '').slice(0, 1)).toUpperCase();
    el.textContent = rawInit || fallback || '?';
    const src = contactPhotoSrc(c, { skipData: true }) || contactPhotoSrc(c);
    if(!src) return;
    const img = document.createElement('img');
    img.className = 'avatar-pic';
    img.alt = '';
    img.referrerPolicy = 'no-referrer';
    img.onerror = function(){ try{ this.remove(); }catch(_){} };
    img.src = src;
    el.appendChild(img);
  }catch(_){}
}
window.contactPhotoSrc = contactPhotoSrc;
window.contactAvatarHtml = contactAvatarHtml;
window.contactAvatarColor = contactAvatarColor;
window.applyContactAvatarToEl = applyContactAvatarToEl;
window.mergeContactPhoto = mergeContactPhoto;
/* One face object for every surface (Band stack, roster, Wireline, calls).
   Always prefers the live Callsign over a Band memberInfo snapshot taken
   before photos hydrated — that is why "What if?" showed initials. */
const nalunoFaceCache = {};
const nalunoFaceHydrating = {};
let nalunoFaceHydrateTimer = null;
function nalunoLiveFace(uid, fallback){
  const base = (fallback && typeof fallback === 'object') ? fallback : {};
  const face = {
    uid: uid || base.uid || base.firebaseUid || null,
    name: base.name || 'Someone',
    color: base.color || '#8B90A8',
    initials: base.initials || '',
    photo: base.photo || null,
    photoUrl: base.photoUrl || null,
  };
  if(uid && typeof currentUser !== 'undefined' && currentUser && uid === currentUser.uid
    && typeof currentProfile !== 'undefined' && currentProfile){
    face.name = currentProfile.name || face.name;
    face.color = currentProfile.color || face.color;
    face.photo = currentProfile.photo || face.photo;
    face.photoUrl = currentProfile.photoUrl || face.photoUrl;
  }
  const c = (uid && typeof contacts !== 'undefined' && contacts)
    ? contacts.find(function(cc){ return cc.firebaseUid === uid; })
    : null;
  if(c){
    face.name = c.name || face.name;
    face.color = c.color || face.color;
    face.initials = c.initials || face.initials;
    face.photo = c.photo || face.photo;
    face.photoUrl = c.photoUrl || face.photoUrl;
  }
  const cached = uid ? nalunoFaceCache[uid] : null;
  if(cached){
    if(cached.photoUrl) face.photoUrl = cached.photoUrl;
    if(cached.photo && !face.photo) face.photo = cached.photo;
    if(cached.name && (!face.name || face.name === 'Someone')) face.name = cached.name;
    if(cached.color && (!face.color || face.color === '#8B90A8')) face.color = cached.color;
  }
  if(typeof togaPhotoCache !== 'undefined' && uid && togaPhotoCache[uid]){
    const t = togaPhotoCache[uid];
    if(t.photoUrl) face.photoUrl = face.photoUrl || t.photoUrl;
    if(t.photo && !face.photo) face.photo = t.photo;
    if(t.name && (!face.name || face.name === 'Someone')) face.name = t.name;
    if(t.color) face.color = face.color || t.color;
  }
  if(!face.initials){
    face.initials = (typeof initialsFor === 'function')
      ? initialsFor(face.name || '?')
      : String((face.name || '?').trim().charAt(0) || '?').toUpperCase();
  }
  return face;
}
function nalunoFaceHydratePaint(){
  if(nalunoFaceHydrateTimer) return;
  nalunoFaceHydrateTimer = setTimeout(function(){
    nalunoFaceHydrateTimer = null;
    try{ if(typeof renderBandList === 'function') renderBandList(); }catch(_){}
    try{ if(typeof renderContacts === 'function') renderContacts(); }catch(_){}
    try{ if(typeof renderWirelineList === 'function') renderWirelineList(); }catch(_){}
    try{
      if(typeof renderBandRoster === 'function' && typeof activeBandId !== 'undefined' && activeBandId){
        renderBandRoster();
      }
    }catch(_){}
  }, 60);
}
function nalunoHydrateFace(uid){
  if(!uid || typeof fbDb === 'undefined' || !fbDb) return;
  if(nalunoFaceHydrating[uid]) return;
  if(nalunoFaceCache[uid] && nalunoFaceCache[uid].photoUrl) return;
  const already = nalunoLiveFace(uid);
  if(typeof contactPhotoSrc === 'function' && contactPhotoSrc(already, { skipData: true })){
    nalunoFaceCache[uid] = {
      photoUrl: already.photoUrl || contactPhotoSrc(already, { skipData: true }),
      photo: already.photo || null,
      name: already.name,
      color: already.color,
    };
    return;
  }
  nalunoFaceHydrating[uid] = 1;
  fbDb.collection('users').doc(uid).get().then(function(snap){
    if(!snap.exists) return;
    const d = snap.data() || {};
    const url = d.photoUrl || null;
    nalunoFaceCache[uid] = {
      photo: d.photo || null,
      photoUrl: url,
      color: d.color || null,
      name: d.name || null,
    };
    if(typeof togaPhotoCache !== 'undefined'){
      togaPhotoCache[uid] = nalunoFaceCache[uid];
    }
    const row = (typeof contacts !== 'undefined' && contacts)
      ? contacts.find(function(cc){ return cc.firebaseUid === uid; })
      : null;
    if(row){
      if(url) mergeContactPhoto(row, url);
      if(d.photo) mergeContactPhoto(row, d.photo);
      if(d.name && d.name !== row.name){
        row.name = d.name;
        row.initials = (typeof initialsFor === 'function') ? initialsFor(d.name) : row.initials;
      }
      if(d.color) row.color = d.color;
    }
    if(typeof currentUser !== 'undefined' && currentUser && uid === currentUser.uid
      && typeof currentProfile !== 'undefined' && currentProfile){
      if(url){
        currentProfile.photoUrl = url;
        mergeContactPhoto(currentProfile, url);
      }
      if(d.photo) mergeContactPhoto(currentProfile, d.photo);
    }
    nalunoFaceHydratePaint();
  }).catch(function(){}).then(function(){
    nalunoFaceHydrating[uid] = 1;
  });
}
window.nalunoLiveFace = nalunoLiveFace;
window.nalunoHydrateFace = nalunoHydrateFace;
window.nalunoFaceCache = nalunoFaceCache;
function slimCloudPhoto(photo, photoUrl){
  const url = photoUrl
    || (photo && photo.url)
    || (photo && photo.dataUrl && /^https?:/i.test(photo.dataUrl) ? photo.dataUrl : '');
  if(url && /^https?:/i.test(url)) return { photo: { dataUrl: url }, photoUrl: url };
  if(photo && photo.dataUrl && String(photo.dataUrl).length < 80000) return { photo: photo, photoUrl: null };
  return { photo: photo ? { crop: photo.crop || null } : null, photoUrl: url || null };
}

let connectionsUnsub = null;
let connectionsRefreshDebounce = null;
function loadRealConnections(uid){
  if(!fbDb) return;
  if(connectionsUnsub) connectionsUnsub();
  // onSnapshot (not a one-time get()) paints instantly from Firestore's local cache the
  // moment the app opens, then quietly updates from the server — this is what actually
  // fixes contacts taking a few seconds to appear, and it also means a newly-added real
  // connection shows up live without needing to reopen the app.
  connectionsUnsub = fbDb.collection('users').doc(uid).collection('connections').onSnapshot(snap=>{
    snap.forEach(doc=>{
      const d = doc.data();
      const row = addRealContactToLocalList(doc.id, d.name || 'Unknown', d.color, d.handle, d.photo);
      if(row && d.photoUrl){
        row.photoUrl = d.photoUrl;
        mergeContactPhoto(row, d.photoUrl);
      }
    });
    renderContacts();
    renderBandList();
    applyAtmosphere();
    try{
      nalunoCacheWrite('contacts', contacts.filter(function(c){ return c.isReal; }).map(function(c){
        const src = (typeof contactPhotoSrc === 'function') ? contactPhotoSrc(c) : '';
        let photo = null;
        if(src && /^https?:/i.test(src)){
          photo = { dataUrl: src };
        } else if(c.photo && c.photo.dataUrl && String(c.photo.dataUrl).length < 120000){
          photo = c.photo;
        }
        return {
          firebaseUid:c.firebaseUid,
          name:c.name,
          color:c.color,
          handle:c.handle,
          photo:photo,
          photoUrl: c.photoUrl || (/^https?:/i.test(src) ? src : null),
          lastActivityTs: c.lastActivityTs || null
        };
      }));
    }catch(_){}
    // Both of these fire N parallel Firestore reads (one per real connection) — used
    // to run immediately on every single connections change, which is the real reason
    // things got noticeably slower as more real connections accumulated: not just the
    // per-connection query count, but that count re-firing on every update instead of
    // just once. Debounced together so a burst of changes collapses into one real
    // refresh instead of compounding.
    clearTimeout(connectionsRefreshDebounce);
    connectionsRefreshDebounce = setTimeout(()=>{
      contacts.filter(c=>c.isReal && c.firebaseUid).forEach(c=> refreshContactLiveProfile(c.firebaseUid));
      loadConnectionsSignalsNow();
    }, 800);
  }, ()=>{ /* connections just won't be live this session */ });
}
/* The connection doc is a snapshot taken at connect time — someone who added a photo
   afterward, or connected before photo support existed at all, never gets that reflected
   there. This fetches their actual current Callsign and updates the local copy in place. */
async function refreshContactLiveProfile(firebaseUid){
  if(!fbDb) return;
  try{
    const doc = await fbDb.collection('users').doc(firebaseUid).get();
    if(!doc.exists) return;
    const d = doc.data();
    const c = contacts.find(cc=>cc.firebaseUid===firebaseUid);
    if(!c) return;
    let changed = false;
    const livePhoto = d.photo || null;
    const liveUrl = d.photoUrl || null;
    const beforeSrc = contactPhotoSrc(c);
    if(liveUrl){
      c.photoUrl = liveUrl;
      mergeContactPhoto(c, liveUrl);
    }
    if(livePhoto) mergeContactPhoto(c, livePhoto);
    if(contactPhotoSrc(c) !== beforeSrc) changed = true;
    // Do not null out a connection-snapshot photo just because the users
    // doc omitted `photo` (large dataUrls often fail to persist there).
    if(d.publicKey && JSON.stringify(d.publicKey) !== JSON.stringify(c.publicKey)){ c.publicKey = d.publicKey; delete sharedKeyCache[firebaseUid]; changed = true; }
    if(d.name && d.name !== c.name){ c.name = d.name; c.initials = initialsFor(d.name); changed = true; }
    if(d.color && d.color !== c.color){ c.color = d.color; changed = true; }
    // Reachability from their own heartbeat, not only local last-exchange.
    try{
      const remoteTs = d.lastActivityTs && d.lastActivityTs.toMillis
        ? d.lastActivityTs.toMillis()
        : (typeof d.lastActivityTs === 'number' ? d.lastActivityTs : 0);
      if(remoteTs && (!c.lastActivityTs || remoteTs > c.lastActivityTs)){
        c.lastActivityTs = remoteTs;
        changed = true;
      }
    }catch(_){}
    // Public Band memberships — every connection can see which squares you belong to.
    const pb = Array.isArray(d.publicBands) ? d.publicBands : [];
    if(JSON.stringify(pb) !== JSON.stringify(c.publicBands || [])){
      c.publicBands = pb;
      changed = true;
    }
    if(changed){ renderContacts(); renderWirelineList(); renderBandList(); }
  }catch(e){ /* best-effort refresh — the connection doc's snapshot still works as a fallback */ }
}

function openFindPeople(){
  if(!currentUser){ toast('Sign in first to find people'); return; }
  $('findHandleInput').value = '';
  $('findPeopleResult').innerHTML = '';
  $('findPeopleOverlay').classList.add('active');
}
function closeFindPeople(){ $('findPeopleOverlay').classList.remove('active'); }
$('findPeopleBtn').onclick = openFindPeople;
$('findPeopleClose').onclick = closeFindPeople;

async function searchHandle(){
  const handle = $('findHandleInput').value.trim().replace(/^@/,'').toLowerCase();
  if(!handle) return;
  $('findPeopleResult').innerHTML = '<div style="color:var(--text-dim); font-size:13px;">Searching…</div>';
  try{
    const handleDoc = await fbDb.collection('handles').doc(handle).get();
    if(!handleDoc.exists){
      $('findPeopleResult').innerHTML = `<div style="color:var(--text-dim); font-size:13px;">No one found at @${escapeHtml(handle)}.</div>`;
      return;
    }
    const theirUid = handleDoc.data().uid;
    if(theirUid === currentUser.uid){
      $('findPeopleResult').innerHTML = `<div style="color:var(--text-dim); font-size:13px;">That\u2019s you.</div>`;
      return;
    }
    const userDoc = await fbDb.collection('users').doc(theirUid).get();
    if(!userDoc.exists){
      $('findPeopleResult').innerHTML = `<div style="color:var(--text-dim); font-size:13px;">That handle exists but hasn\u2019t set up a Callsign yet.</div>`;
      return;
    }
    const data = userDoc.data();
    const already = contacts.some(c => c.firebaseUid === theirUid);
    const face = {
      name: data.name || 'Unknown',
      initials: initialsFor(data.name || '?'),
      color: data.color || '#7CFFB2',
      photo: data.photo || null,
      photoUrl: data.photoUrl || null,
    };
    $('findPeopleResult').innerHTML = `
      <div class="contact-row" style="cursor:default;">
        ${typeof contactAvatarHtml === 'function' ? contactAvatarHtml(face, 46) : ('<div class="avatar" style="width:46px;height:46px;font-size:15px;background:'+(face.color)+';">'+escapeHtml(face.initials)+'</div>')}
        <div class="contact-meta"><div class="contact-name">${escapeHtml(data.name||'Unknown')}</div><div class="contact-sub">${escapeHtml(data.number||('@'+handle))}</div></div>
      </div>
      <button class="join-btn" id="connectResultBtn" style="margin-top:14px;" ${already?'disabled':''}>${already?'Already connected':'Connect'}</button>`;
    if(!already){
      $('connectResultBtn').onclick = ()=> connectWithUser(theirUid, data, handle);
    }
  }catch(e){
    $('findPeopleResult').innerHTML = `<div style="color:var(--red); font-size:13px;">${escapeHtml(e.message||'Search failed')}</div>`;
  }
}
$('findHandleBtn').onclick = searchHandle;
$('findHandleInput').addEventListener('keydown', e=>{ if(e.key==='Enter'){ e.preventDefault(); searchHandle(); } });

async function connectWithUser(theirUid, theirData, handle){
  try{
    const myConnRef = fbDb.collection('users').doc(currentUser.uid).collection('connections').doc(theirUid);
    const theirConnRef = fbDb.collection('users').doc(theirUid).collection('connections').doc(currentUser.uid);
    const batch = fbDb.batch();
    const myPhoto = (typeof slimCloudPhoto === 'function')
      ? slimCloudPhoto(currentProfile.photo, currentProfile.photoUrl)
      : { photo: currentProfile.photo || null, photoUrl: currentProfile.photoUrl || null };
    const theirPhoto = (typeof slimCloudPhoto === 'function')
      ? slimCloudPhoto(theirData.photo, theirData.photoUrl)
      : { photo: theirData.photo || null, photoUrl: theirData.photoUrl || null };
    batch.set(myConnRef, { name: theirData.name||'Unknown', handle: theirData.number || ('@'+handle), color: theirData.color||'#7CFFB2', photo: theirPhoto.photo, photoUrl: theirPhoto.photoUrl, connectedAt: firebase.firestore.FieldValue.serverTimestamp() });
    batch.set(theirConnRef, { name: currentProfile.name, handle: currentProfile.number, color: currentProfile.color, photo: myPhoto.photo, photoUrl: myPhoto.photoUrl, connectedAt: firebase.firestore.FieldValue.serverTimestamp() });
    await batch.commit();
    addRealContactToLocalList(theirUid, theirData.name||'Unknown', theirData.color, theirData.number||('@'+handle), theirData.photo);
    const row = contacts.find(x=>x.firebaseUid===theirUid);
    if(row && theirData.photoUrl) mergeContactPhoto(row, theirData.photoUrl);
    toast('Connected with ' + (theirData.name||'them'));
    closeFindPeople();
    renderContacts();
  }catch(e){
    toast(e.message || 'Couldn\u2019t connect right now');
  }
}
