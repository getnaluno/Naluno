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
let freqReqUnsub = null;
let freqIncoming = [];

function freqOutKey(){
  const uid = (typeof currentUser !== 'undefined' && currentUser && currentUser.uid) || '';
  return 'nalunoFreqOut:' + uid;
}
function readOutgoing(){
  try{
    const list = JSON.parse(localStorage.getItem(freqOutKey()) || '[]');
    return Array.isArray(list) ? list : [];
  }catch(_){ return []; }
}
function writeOutgoing(list){
  try{ localStorage.setItem(freqOutKey(), JSON.stringify((list || []).slice(0, 40))); }catch(_){}
}
function rememberOutgoing(uid, face){
  const list = readOutgoing().filter(function(x){ return x && x.uid !== uid; });
  list.unshift({ uid: uid, name: face.name, handle: face.handle || '', color: face.color || '#7CFFB2', at: face.at || Date.now() });
  writeOutgoing(list);
}
function forgetOutgoing(uid){
  writeOutgoing(readOutgoing().filter(function(x){ return x && x.uid !== uid; }));
}
function freqFace(data, handle){
  const src = data || {};
  const photo = (typeof slimCloudPhoto === 'function')
    ? slimCloudPhoto(src.photo, src.photoUrl)
    : { photo: src.photo || null, photoUrl: src.photoUrl || null };
  const color = (src.color && /^#[0-9A-Fa-f]{3,8}$/.test(src.color)) ? src.color : '#7CFFB2';
  let handleStr = src.number || src.handle || (handle ? ('@' + String(handle).replace(/^@/, '')) : '');
  handleStr = String(handleStr || '').slice(0, 40);
  return {
    name: String(src.name || 'Someone').slice(0, 80),
    handle: handleStr,
    color: color,
    photo: photo.photo || null,
    photoUrl: photo.photoUrl || null,
    at: Date.now(),
  };
}
function freqRequestBody(profile){
  const face = freqFace(profile || {}, '');
  const body = {
    name: face.name,
    handle: String(face.handle || '').slice(0, 40),
    color: face.color,
    at: Math.round(Number(face.at) || Date.now()),
  };
  if(face.photoUrl && /^https?:\/\//i.test(String(face.photoUrl))) body.photoUrl = String(face.photoUrl).slice(0, 500);
  return body;
}
function freqFailText(e){
  const m = (e && (e.message || e.code)) || '';
  if(/permission|insufficient/i.test(String(m))) return 'The request was not saved. Publish the latest rules, then try Connect again.';
  return m || 'Could not send the request.';
}
function listenFrequencyRequests(uid){
  if(!fbDb || !uid) return;
  if(freqReqUnsub){ try{ freqReqUnsub(); }catch(_){} freqReqUnsub = null; }
  freqReqUnsub = fbDb.collection('users').doc(uid).collection('connectionRequests').onSnapshot(function(snap){
    freqIncoming = [];
    snap.forEach(function(doc){
      const d = doc.data() || {};
      freqIncoming.push({
        uid: doc.id,
        name: d.name || 'Someone',
        handle: d.handle || '',
        color: d.color || '#7CFFB2',
        photo: d.photo || null,
        photoUrl: d.photoUrl || null,
        at: d.at || 0,
      });
    });
    paintFreqRequests();
  }, function(err){
    console.warn('[contacts] requests', err && err.message);
  });
}
function paintFreqRequests(){
  const label = $('freqRequestLabel');
  const list = $('freqRequestList');
  const wlabel = $('freqWaitingLabel');
  const wlist = $('freqWaitingList');
  const badge = $('freqRequestBadge');
  if(badge){
    if(freqIncoming.length){
      badge.style.display = '';
      badge.textContent = String(freqIncoming.length);
    }else badge.style.display = 'none';
  }
  if(label && list){
    label.style.display = freqIncoming.length ? 'block' : 'none';
    list.innerHTML = freqIncoming.map(function(r){
      const face = { name: r.name, initials: initialsFor(r.name), color: r.color, photo: r.photo, photoUrl: r.photoUrl };
      return '<div style="display:flex;align-items:center;gap:10px;padding:10px;">'
        + (typeof contactAvatarHtml === 'function' ? contactAvatarHtml(face, 46) : '')
        + '<div class="contact-meta"><div class="contact-name">' + escapeHtml(r.name) + '</div><div class="contact-sub">' + escapeHtml(r.handle || 'Wants to connect') + '</div></div>'
        + '<button type="button" data-freq-act="accept" data-uid="' + escapeHtml(r.uid) + '" style="background:#7CFFB2;color:#0D0F17;border:none;border-radius:999px;padding:8px 12px;font-size:12.5px;font-weight:650;">Accept</button>'
        + '<button type="button" data-freq-act="decline" data-uid="' + escapeHtml(r.uid) + '" style="background:transparent;color:var(--text);border:1px solid var(--line);border-radius:999px;padding:8px 12px;font-size:12.5px;">Not now</button>'
        + '</div>';
    }).join('');
  }
  const waiting = readOutgoing().filter(function(r){
    return r && r.uid && !contacts.some(function(c){ return c.firebaseUid === r.uid; });
  });
  if(wlabel && wlist){
    wlabel.style.display = waiting.length ? 'block' : 'none';
    wlist.innerHTML = waiting.map(function(r){
      return '<div style="display:flex;align-items:center;gap:10px;padding:10px;">'
        + '<div class="contact-meta"><div class="contact-name">' + escapeHtml(r.name || 'Someone') + '</div><div class="contact-sub">Request sent. Waiting for them to accept.</div></div>'
        + '<button type="button" data-freq-act="cancel" data-uid="' + escapeHtml(r.uid) + '" style="background:transparent;color:var(--text);border:1px solid var(--line);border-radius:999px;padding:8px 12px;font-size:12.5px;">Cancel</button>'
        + '</div>';
    }).join('');
  }
}
window.paintFreqRequests = paintFreqRequests;

let __freqSending = false;
let __freqPick = null;
async function requestFrequency(theirUid, theirData, handle){
  if(__freqSending) return;
  if(!currentUser || !fbDb || !theirUid){ toast('Sign in first'); return; }
  const btn = $('connectResultBtn');
  const noteId = 'freqSentNote';
  __freqSending = true;
  if(btn){ btn.disabled = true; btn.textContent = 'Sending…'; }
  try{
    const body = freqRequestBody(currentProfile || {});
    await fbDb.collection('users').doc(theirUid).collection('connectionRequests').doc(currentUser.uid).set(body);
    const them = freqFace(theirData || {}, handle);
    rememberOutgoing(theirUid, { name: them.name, handle: them.handle, color: them.color, at: body.at });
    if(btn){ btn.disabled = true; btn.textContent = 'Request sent'; }
    let note = document.getElementById(noteId);
    if(!note && $('findPeopleResult')){
      note = document.createElement('p');
      note.id = noteId;
      note.style.cssText = 'margin:12px 0 0;font-size:13px;line-height:1.45;color:var(--mint);';
      $('findPeopleResult').appendChild(note);
    }
    if(note) note.textContent = 'Request sent. They can Accept it, or choose Not now, on Frequencies.';
    toast('Request sent');
    paintFreqRequests();
  }catch(e){
    if(btn){ btn.disabled = false; btn.textContent = 'Connect'; }
    const text = freqFailText(e);
    let note = document.getElementById(noteId);
    if(!note && $('findPeopleResult')){
      note = document.createElement('p');
      note.id = noteId;
      note.style.cssText = 'margin:12px 0 0;font-size:13px;line-height:1.45;color:var(--red);';
      $('findPeopleResult').appendChild(note);
    }
    if(note){ note.style.color = 'var(--red)'; note.textContent = text; }
    toast(text);
  }
  __freqSending = false;
}
async function acceptFrequency(theirUid){
  if(!currentUser || !fbDb || !theirUid) return;
  const row = freqIncoming.find(function(r){ return r.uid === theirUid; }) || { uid: theirUid, name: 'Someone' };
  const mine = freqFace(currentProfile || {}, '');
  const theirs = freqFace(row, '');
  const myRef = fbDb.collection('users').doc(currentUser.uid).collection('connections').doc(theirUid);
  const theirRef = fbDb.collection('users').doc(theirUid).collection('connections').doc(currentUser.uid);
  try{
    await myRef.set({
      name: theirs.name, handle: theirs.handle, color: theirs.color,
      photo: theirs.photo, photoUrl: theirs.photoUrl,
      connectedAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
    await theirRef.set({
      name: mine.name, handle: mine.handle, color: mine.color,
      photo: mine.photo, photoUrl: mine.photoUrl,
      connectedAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
    await fbDb.collection('users').doc(currentUser.uid).collection('connectionRequests').doc(theirUid).delete().catch(function(){});
  }catch(e){
    try{ await myRef.delete(); }catch(_){}
    toast((e && e.message) || 'Could not accept just now');
    return;
  }
  forgetOutgoing(theirUid);
  addRealContactToLocalList(theirUid, theirs.name, theirs.color, theirs.handle, theirs.photo);
  const added = contacts.find(function(x){ return x.firebaseUid === theirUid; });
  if(added && theirs.photoUrl) mergeContactPhoto(added, theirs.photoUrl);
  freqIncoming = freqIncoming.filter(function(r){ return r.uid !== theirUid; });
  toast('Connected with ' + theirs.name);
  try{ renderContacts(); }catch(_){}
  paintFreqRequests();
}
async function declineFrequency(theirUid){
  if(!currentUser || !fbDb || !theirUid) return;
  try{
    await fbDb.collection('users').doc(currentUser.uid).collection('connectionRequests').doc(theirUid).delete();
  }catch(e){
    toast('Could not decline just now');
    return;
  }
  freqIncoming = freqIncoming.filter(function(r){ return r.uid !== theirUid; });
  paintFreqRequests();
  toast('Not now');
}
async function cancelFrequency(theirUid){
  if(!theirUid) return;
  forgetOutgoing(theirUid);
  paintFreqRequests();
  if(!currentUser || !fbDb) return;
  try{
    await fbDb.collection('users').doc(theirUid).collection('connectionRequests').doc(currentUser.uid).delete();
  }catch(_){}
}
async function dropFrequency(localId){
  const c = contacts.find(function(x){ return x && x.id === localId; });
  if(!c || !c.firebaseUid || !currentUser || !fbDb) return;
  const name = c.name || 'them';
  if(!window.confirm('Drop ' + name + ' from your frequencies?')) return;
  try{
    await fbDb.collection('users').doc(currentUser.uid).collection('connections').doc(c.firebaseUid).delete();
    try{ await fbDb.collection('users').doc(c.firebaseUid).collection('connections').doc(currentUser.uid).delete(); }catch(_){}
  }catch(e){
    toast('Could not drop them just now');
    return;
  }
  for(let i = contacts.length - 1; i >= 0; i--){
    if(contacts[i] && contacts[i].firebaseUid === c.firebaseUid) contacts.splice(i, 1);
  }
  toast('Dropped ' + name);
  try{ renderContacts(); }catch(_){}
  try{ if(typeof renderWirelineList === 'function') renderWirelineList(); }catch(_){}
}
window.dropFrequency = dropFrequency;
window.acceptFrequency = acceptFrequency;

function loadRealConnections(uid){
  if(!fbDb) return;
  if(connectionsUnsub) connectionsUnsub();
  // onSnapshot (not a one-time get()) paints instantly from Firestore's local cache the
  // moment the app opens, then quietly updates from the server — this is what actually
  // fixes contacts taking a few seconds to appear, and it also means a newly-added real
  // connection shows up live without needing to reopen the app.
  connectionsUnsub = fbDb.collection('users').doc(uid).collection('connections').onSnapshot(snap=>{
    try{ nalunoListenOk('contacts'); }catch(_){}
    const seen = {};
    snap.forEach(doc=>{
      seen[doc.id] = 1;
      const d = doc.data();
      const row = addRealContactToLocalList(doc.id, d.name || 'Unknown', d.color, d.handle, d.photo);
      if(row && d.photoUrl){
        row.photoUrl = d.photoUrl;
        mergeContactPhoto(row, d.photoUrl);
      }
    });
    for(let i = contacts.length - 1; i >= 0; i--){
      const c = contacts[i];
      if(c && c.isReal && c.firebaseUid && !seen[c.firebaseUid]) contacts.splice(i, 1);
    }
    const stillOut = readOutgoing().filter(function(r){ return r && !seen[r.uid]; });
    if(stillOut.length !== readOutgoing().length) writeOutgoing(stillOut);
    renderContacts();
    renderBandList();
    applyAtmosphere();
    try{ paintFreqRequests(); }catch(_){}
    try{ if(window.NalunoWireMailbox && window.NalunoWireMailbox.retryPendingDrops) window.NalunoWireMailbox.retryPendingDrops(); }catch(_){}
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
  }, function(err){
    // Used to stop contacts updating until the app was restarted.
    console.warn('[contacts] listener error, subscribing again', err && err.message);
    connectionsUnsub = null;
    try{ nalunoRelisten('contacts', function(){ if(currentUser && currentUser.uid === uid) loadRealConnections(uid); }); }catch(_){}
  });
  listenFrequencyRequests(uid);
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
  __freqPick = null;
  $('findPeopleOverlay').classList.add('active');
}
function closeFindPeople(){ $('findPeopleOverlay').classList.remove('active'); }
function wireFindClicks(){
  if(wireFindClicks.done) return;
  wireFindClicks.done = true;
  document.addEventListener('click', function(e){
    const el = e.target && e.target.closest ? e.target.closest('#findPeopleBtn, [data-freq-act]') : null;
    if(!el) return;
    const act = el.id === 'findPeopleBtn' ? 'open' : (el.getAttribute('data-freq-act') || '');
    if(!act) return;
    e.preventDefault();
    e.stopPropagation();
    if(act === 'open'){ openFindPeople(); return; }
    const uid = el.getAttribute('data-uid') || '';
    if(act === 'accept'){ acceptFrequency(uid); return; }
    if(act === 'decline'){ declineFrequency(uid); return; }
    if(act === 'cancel'){
      cancelFrequency(uid);
      if(el.id === 'connectResultBtn'){
        el.disabled = false;
        el.textContent = 'Connect';
        el.setAttribute('data-freq-act', 'request');
        const note = document.getElementById('freqSentNote');
        if(note && note.parentNode) note.parentNode.removeChild(note);
      }
      return;
    }
    if(act === 'request'){ requestFrequency(uid, (__freqPick && __freqPick.uid === uid && __freqPick.data) || {}, el.getAttribute('data-handle') || ''); return; }
    if(act === 'accept-found'){ acceptFrequency(uid); return; }
  }, true);
}
wireFindClicks();
if($('findPeopleClose')) $('findPeopleClose').onclick = closeFindPeople;

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
    if(handleDoc.data() && handleDoc.data().closed){
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
    if(data && (data.accountState === 'closed' || data.deleted === true)){
      $('findPeopleResult').innerHTML = `<div style="color:var(--text-dim); font-size:13px;">No one found at @${escapeHtml(handle)}.</div>`;
      return;
    }
    const already = contacts.some(c => c.firebaseUid === theirUid);
    const incoming = freqIncoming.some(function(r){ return r.uid === theirUid; });
    const waiting = readOutgoing().some(function(r){ return r.uid === theirUid; });
    const face = {
      name: data.name || 'Unknown',
      initials: initialsFor(data.name || '?'),
      color: data.color || '#7CFFB2',
      photo: data.photo || null,
      photoUrl: data.photoUrl || null,
    };
    let action = 'Connect';
    let act = 'request';
    if(already){ action = 'Already connected'; act = ''; }
    else if(incoming){ action = 'Accept'; act = 'accept-found'; }
    else if(waiting){ action = 'Cancel request'; act = 'cancel'; }
    __freqPick = { uid: theirUid, data: data, handle: handle };
    $('findPeopleResult').innerHTML = `
      <div class="contact-row" style="cursor:default;">
        ${typeof contactAvatarHtml === 'function' ? contactAvatarHtml(face, 46) : ('<div class="avatar" style="width:46px;height:46px;font-size:15px;background:'+(face.color)+';">'+escapeHtml(face.initials)+'</div>')}
        <div class="contact-meta"><div class="contact-name" data-known-uid="${escapeHtml(String(theirUid||''))}">${escapeHtml(data.name||'Unknown')}</div><div class="contact-sub">${escapeHtml(data.number||('@'+handle))}</div></div>
      </div>
      <button type="button" class="join-btn" id="connectResultBtn" data-freq-act="${act}" data-uid="${escapeHtml(String(theirUid||''))}" data-handle="${escapeHtml(String(handle||''))}" style="margin-top:14px;" ${already?'disabled':''}>${action}</button>`;
    if(waiting){
      const note = document.createElement('p');
      note.id = 'freqSentNote';
      note.style.cssText = 'margin:12px 0 0;font-size:13px;line-height:1.45;color:var(--mint);';
      note.textContent = 'Request sent. They can Accept it, or choose Not now, on Frequencies.';
      $('findPeopleResult').appendChild(note);
    }
  }catch(e){
    $('findPeopleResult').innerHTML = `<div style="color:var(--red); font-size:13px;">${escapeHtml((typeof nalunoFriendlyError === 'function' ? nalunoFriendlyError(e.message) : e.message)||'Search failed')}</div>`;
  }
}
$('findHandleBtn').onclick = searchHandle;
$('findHandleInput').addEventListener('keydown', e=>{ if(e.key==='Enter'){ e.preventDefault(); searchHandle(); } });

async function connectWithUser(theirUid, theirData, handle){
  /* Spark, in person. Both people already chose to stand together, so this
     still connects at once. A search on Frequencies sends a request instead. */
  try{
    const myConnRef = fbDb.collection('users').doc(currentUser.uid).collection('connections').doc(theirUid);
    const theirConnRef = fbDb.collection('users').doc(theirUid).collection('connections').doc(currentUser.uid);
    const myPhoto = (typeof slimCloudPhoto === 'function')
      ? slimCloudPhoto(currentProfile.photo, currentProfile.photoUrl)
      : { photo: currentProfile.photo || null, photoUrl: currentProfile.photoUrl || null };
    const theirPhoto = (typeof slimCloudPhoto === 'function')
      ? slimCloudPhoto(theirData.photo, theirData.photoUrl)
      : { photo: theirData.photo || null, photoUrl: theirData.photoUrl || null };
    /* Yours first. Their mirror is allowed only once yours exists, so the
       two writes are not one batch. */
    await myConnRef.set({ name: theirData.name||'Unknown', handle: theirData.number || ('@'+handle), color: theirData.color||'#7CFFB2', photo: theirPhoto.photo, photoUrl: theirPhoto.photoUrl, connectedAt: firebase.firestore.FieldValue.serverTimestamp() });
    await theirConnRef.set({ name: currentProfile.name, handle: currentProfile.number, color: currentProfile.color, photo: myPhoto.photo, photoUrl: myPhoto.photoUrl, connectedAt: firebase.firestore.FieldValue.serverTimestamp() });
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
