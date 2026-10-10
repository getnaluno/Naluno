/* ============================================================
   MODULE: js/band-list.js
   Band list, create frequency, public bands publish
   OWNERSHIP: change this domain here only.
   Scripts share globals (intentional) so load order matches the old monolith.
   ============================================================ */
/* ---------------- BAND (live shared frequency) ----------------
   Not a call — no ringing, no start button. Not a group chat — no permanent membership
   list either. A Band is a room with a fixed set of possible people and a roster that's
   never static, because it's the same computeSignal() used everywhere else: only a
   contact whose signal is currently strong is someone the room can honestly say is here.
   Starts empty — create one via the + button, or loadRealBands() fills in ones you're
   already a real member of at sign-in. */
const bands = [];
// Real bands (Firestore-backed, shared between real accounts) start numbering here —
// kept distinct from any future locally-created ids for the same collision-avoidance
// reason as real contacts, even though there's no fixed demo range to avoid anymore.
let nextRealBandLocalId = 2000000;
const bandVibePreviewGradient = {
  aurora: 'linear-gradient(160deg,#7C4DFF,#00E5FF)',
  studio: 'linear-gradient(160deg,#FFB86B,#FF7676)',
  rain:   'linear-gradient(160deg,#0A0D16,#171A26)',
  stars:  'linear-gradient(160deg,#05060C,#171A26)',
  /* These three are real Band vibes too (every canvas scene in camera.js is
     one). Without a card colour they showed as Aurora on every member's list. */
  desert:    'linear-gradient(160deg,#1B1440,#4A2545 55%,#7A3420)',
  waterfall: 'linear-gradient(160deg,#04141A,#0E2A2E 55%,#2E6F78)',
  forest:    'linear-gradient(160deg,#0B1F13,#173620 55%,#3E6B2E)',
};
/* A card colour for any vibe, including one added later that this list
   does not know yet. */
function bandVibeGradient(vibe){
  if(bandVibePreviewGradient[vibe]) return bandVibePreviewGradient[vibe];
  return bandVibePreviewGradient.aurora;
}
function liveBandMembers(band){
  return band.memberIds
    .map(id => contacts.find(c=>c.id===id))
    .filter(c => c && computeSignal(c).tier === 'strong');
}
function bandCardFaces(b){
  const faces = [];
  const seen = new Set();
  function add(uid, fallback){
    const key = uid || (fallback && (fallback.uid || fallback.firebaseUid || fallback.id));
    if(!key || seen.has(String(key))) return;
    seen.add(String(key));
    const face = (typeof nalunoLiveFace === 'function')
      ? nalunoLiveFace(uid, fallback)
      : (fallback || { uid: uid, name:'Someone', color:'#8B90A8', initials:'?' });
    faces.push(face);
    if(uid && typeof nalunoHydrateFace === 'function'
      && typeof contactPhotoSrc === 'function'
      && !contactPhotoSrc(face, { skipData: true })){
      nalunoHydrateFace(uid);
    }
  }
  const infos = b.memberInfo || [];
  const uids = (b.memberUids && b.memberUids.length)
    ? b.memberUids.slice()
    : infos.map(function(m){ return m.uid; });
  uids.forEach(function(uid){
    add(uid, infos.find(function(m){ return m.uid === uid; }));
  });
  infos.forEach(function(m){ add(m.uid, m); });
  if(typeof currentUser !== 'undefined' && currentUser && currentUser.uid){
    add(currentUser.uid, (typeof currentProfile !== 'undefined' ? currentProfile : null));
  }
  if(b.memberIds && typeof contacts !== 'undefined'){
    b.memberIds.forEach(function(id){
      const c = contacts.find(function(x){ return x.id === id; });
      if(c) add(c.firebaseUid || ('local-'+c.id), c);
    });
  }
  return faces;
}
function renderBandList(){
  /* Rows restored from the phone's cache keep their old ids; if two Bands
     ever share one, give the later one a free id before drawing the cards. */
  try{
    const seen = new Set();
    bands.forEach(function(b){
      if(seen.has(b.id)){
        if(b.id === activeBandId) return; // never move the room that is open
        let n = nextRealBandLocalId;
        while(seen.has(n) || bands.some(function(x){ return x.id === n; })) n++;
        nextRealBandLocalId = n + 1;
        b.id = n;
      }
      seen.add(b.id);
    });
  }catch(_){}
  const label = $('bandSectionLabel');
  if(!bands.length){
    if(label) label.hidden = true;
    $('bandList').innerHTML = (typeof emptyStateHtml === 'function')
      ? emptyStateHtml('No squares yet', 'Start a Band with your connections. No one owns it. Two hours after the last person leaves, the conversation is deleted for good.', 'rooms')
      : '<div class="empty-state"><p class="empty-state-copy">No squares yet.</p></div>';
    return;
  }
  if(label) label.hidden = false;
  $('bandList').innerHTML = bands.map(b=>{
    const grad = bandVibeGradient(b.vibe);
    if(b.isReal){
      const avatars = bandCardFaces(b).slice(0,4).map(m=> (typeof contactAvatarHtml==='function' ? contactAvatarHtml(m, 28) : `<div class="avatar" style="width:28px;height:28px;font-size:10px;background:${m.color||'#7CFFB2'};">${m.initials||''}</div>`)).join('');
      return `<div class="band-card" data-band="${b.id}">
        <div class="band-card-bg" style="background:${grad};"></div>
        <div class="band-card-inner">
          <div class="band-name">${escapeHtml(b.name)}</div>
          <div class="band-live-row">
            <div class="band-avatar-stack">${avatars}</div>
            <span class="band-live-text">Tap to enter</span>
          </div>
        </div>
      </div>`;
    }
    const live = liveBandMembers(b);
    const avatars = live.slice(0,4).map(c=> (typeof contactAvatarHtml==='function' ? contactAvatarHtml(c, 28) : `<div class="avatar" style="width:28px;height:28px;font-size:10px;background:${c.color};">${c.initials}</div>`)).join('');
    const text = live.length ? live.length + (live.length===1 ? ' person tuned in' : ' people tuned in') : 'Quiet right now';
    return `<div class="band-card" data-band="${b.id}">
      <div class="band-card-bg" style="background:${grad};"></div>
      <div class="band-card-inner">
        <div class="band-name">${escapeHtml(b.name)}</div>
        <div class="band-live-row">
          <div class="band-avatar-stack">${avatars}</div>
          <span class="band-live-text">${text}</span>
        </div>
      </div>
    </div>`;
  }).join('');
  document.querySelectorAll('[data-band]').forEach(el=>{
    el.onclick = ()=> openBandRoom(parseInt(el.dataset.band));
  });
}
renderBandList();

/* ---------------- REAL BAND (Firestore-backed rooms) ----------------
   A Band becomes real the moment everyone picked for it is a real connection — it's
   created as an actual bands/{id} document with real memberUids, not a local array
   entry. Presence is a real subcollection (who's actually tuned in right now, not a
   signal-strength guess), and messages are real too — no simulated banter here, ever. */
const BAND_SETTLE_MS = 2 * 60 * 60 * 1000; // chatter clears 2h after the square empties

/* Every Band row needs its own id: the card, the room and Back all find a
   Band by it. Bands restored from the phone's cache keep the ids they had
   last time, while this counter started again from 2000000 on every open,
   so a new Band could get the same id as a cached one. Tapping it then
   opened the other Band, with that Band's vibe, and which one you got
   depended on each phone's cache: the same Band showed different vibes on
   different phones. */
function nalunoFreeBandId(){
  const used = new Set(bands.map(function(b){ return b.id; }));
  while(used.has(nextRealBandLocalId)) nextRealBandLocalId++;
  return nextRealBandLocalId++;
}
function addRealBandToLocalList(firestoreId, name, vibe, memberInfo, createdBy, extra){
  const existing = bands.find(b=>b.firestoreId===firestoreId);
  if(existing){
    existing.name = name;
    if(vibe) existing.vibe = vibe;
    existing.memberInfo = memberInfo;
    if(extra) Object.assign(existing, extra);
    return existing;
  }
  const row = { id: nalunoFreeBandId(), firestoreId, name, vibe, createdBy, isReal:true, memberInfo, ...(extra||{}) };
  bands.push(row);
  return row;
}
async function publishMyPublicBands(){
  if(!fbDb || !currentUser) return;
  try{
    const mine = bands.filter(b => b.isReal && b.firestoreId).map(b => ({
      id: b.firestoreId,
      name: b.name,
      vibe: b.vibe || 'aurora',
    }));
    await fbDb.collection('users').doc(currentUser.uid).set({ publicBands: mine }, { merge:true });
  }catch(e){ /* visibility is best-effort */ }
}
function bandInviteSeen(uid){
  try{ return JSON.parse(localStorage.getItem('naluno:bandSeen:' + uid) || '{}') || {}; }catch(_){ return {}; }
}
function bandInviteRemember(uid, id){
  if(!uid || !id) return;
  const m = bandInviteSeen(uid);
  if(m[id]) return;
  m[id] = Date.now();
  try{ localStorage.setItem('naluno:bandSeen:' + uid, JSON.stringify(m)); }catch(_){}
}
function bandInviteForget(uid, id){
  if(!uid || !id) return;
  const m = bandInviteSeen(uid);
  if(!m[id]) return;
  delete m[id];
  try{ localStorage.setItem('naluno:bandSeen:' + uid, JSON.stringify(m)); }catch(_){}
}
function bandInviteHasBook(uid){
  try{ return localStorage.getItem('naluno:bandSeen:' + uid) != null; }catch(_){ return false; }
}
function bandInviteClaim(uid, id){
  const book = bandInviteClaim.once || (bandInviteClaim.once = {});
  const k = String(uid || '') + ':' + String(id || '');
  if(book[k]) return false;
  book[k] = 1;
  return true;
}
function bandInviteShouldToast(info){
  if(!info || info.first || info.mine || info.seen) return false;
  return true;
}
let bandsMembershipUnsub = null;
async function loadRealBands(uid){
  if(!fbDb) return;
  if(bandsMembershipUnsub){ bandsMembershipUnsub(); bandsMembershipUnsub = null; }
  // Live membership: invites that arrayUnion you show up without restarting the app.
  let primed = false;
  bandsMembershipUnsub = fbDb.collection('bands').where('memberUids','array-contains',uid).onSnapshot(snap=>{
    try{ nalunoListenOk('bandList'); }catch(_){}
    const first = !primed;
    primed = true;
    snap.docChanges().forEach(change=>{
      const doc = change.doc;
      const d = doc.data();
      const memberInfo = (d.memberUids||[]).map(u=>{
        if(typeof nalunoLiveFace === 'function'){
          const face = nalunoLiveFace(u);
          if(typeof nalunoHydrateFace === 'function' && typeof contactPhotoSrc === 'function' && !contactPhotoSrc(face, { skipData: true })){
            nalunoHydrateFace(u);
          }
          return face;
        }
        const c = contacts.find(cc=>cc.firebaseUid===u);
        return c ? { uid:u, name:c.name, color:c.color, initials:c.initials, photo:c.photo, photoUrl:c.photoUrl || null } : { uid:u, name:'Someone', color:'#8B90A8', initials:'?', photo:null, photoUrl:null };
      });
      const lastEmptiedAt = d.lastEmptiedAt && d.lastEmptiedAt.toMillis ? d.lastEmptiedAt.toMillis() : (d.lastEmptiedAt || null);
      const messageEpoch = d.messageEpoch || 0;
      const aliveAt = d.aliveAt && d.aliveAt.toMillis ? d.aliveAt.toMillis() : (d.aliveAt || null);
      if(change.type === 'removed'){
        const idx = bands.findIndex(b=>b.firestoreId===doc.id);
        if(idx>=0) bands.splice(idx,1);
        bandInviteForget(uid, doc.id);
      } else {
        const row = addRealBandToLocalList(doc.id, d.name, d.vibe, memberInfo, d.createdBy, { lastEmptiedAt, memberUids: d.memberUids || [], messageEpoch, aliveAt });
        const seen = !!bandInviteSeen(uid)[doc.id];
        const learned = bandInviteHasBook(uid);
        if(change.type === 'added' && bandInviteShouldToast({ first: first && !learned, mine: d.createdBy === uid, seen: seen }) && bandInviteClaim(uid, doc.id)){
          toast('You were invited to · ' + (d.name || 'a Band'));
        }
        if(d.createdBy !== uid) bandInviteRemember(uid, doc.id);
        // App open is enough — do not wait for someone to sit in the empty square.
        if(row && lastEmptiedAt && (Date.now() - lastEmptiedAt) >= BAND_SETTLE_MS && typeof pruneSettledBandMessages === 'function'){
          pruneSettledBandMessages(fbDb.collection('bands').doc(doc.id), row);
        }
        /* THE RULE OF BANDS: a Band whose two hours ran out is deleted by the
           server now, not when someone happens to open it. Older Bands with
           no clock yet are checked by the server the same way. */
        if(row && typeof nalunoBandAskServerSweep === 'function'){
          const settle = (typeof BAND_SETTLE_MS === 'number') ? BAND_SETTLE_MS : 7200000;
          const deadNow = aliveAt ? (Date.now() - aliveAt) > settle : !!(lastEmptiedAt && (Date.now() - lastEmptiedAt) >= settle);
          const checkedAt = d.checkedAt && d.checkedAt.toMillis ? d.checkedAt.toMillis() : 0;
          const recentlyChecked = checkedAt && (Date.now() - checkedAt) < 3 * 60 * 60 * 1000;
          if(deadNow || (!aliveAt && !recentlyChecked)) nalunoBandAskServerSweep(row);
        }
      }
    });
    renderBandList();
    publishMyPublicBands();
    // Instant paint on next open — same pattern as contacts/broadcasts/signal,
    // so Band doesn't sit blank while this listener's first snapshot lands.
    try{
      if(typeof nalunoCacheWrite === 'function'){
        nalunoCacheWrite('realBands', bands.filter(function(b){ return b.isReal && b.firestoreId; }));
      }
    }catch(_){}
  }, function(err){
    // Used to freeze the Band list until the app was restarted.
    console.warn('[band] list listener error, subscribing again', err && err.message);
    bandsMembershipUnsub = null;
    try{ nalunoRelisten('bandList', function(){ if(currentUser && currentUser.uid === uid) loadRealBands(uid); }); }catch(_){}
  });
}

async function saveBands(){
  if(!storageAvailable) return;
  try{ await window.storage.set('bands:list', JSON.stringify(bands.filter(function(b){ return !b.isReal; }))); }catch(e){ /* best-effort */ }
}
async function loadBands(){
  if(storageAvailable){
    try{
      const res = await window.storage.get('bands:list');
      if(res && res.value){
        const saved = JSON.parse(res.value);
        /* Only this phone's own (non-real) Bands come from here. Real Bands
           saved in this list kept an old copy of the vibe and could replace
           the live rows; they are loaded from the database instead. */
        if(Array.isArray(saved) && saved.length){
          const local = saved.filter(b=>b && !b.isReal);
          for(let i = bands.length - 1; i >= 0; i--){ if(!bands[i].isReal) bands.splice(i, 1); }
          local.forEach(b=>{ if(bands.some(x=>x.id === b.id)) b.id = nalunoFreeBandId(); bands.push(b); });
        }
      }
    }catch(e){ /* nothing saved yet — seed bands stand */ }
  }
  renderBandList();
}

/* ---------------- CREATE A FREQUENCY ---------------- */
let bandComposerVibe = 'aurora';
let bandComposerMembers = new Set();
// Computed lazily (not at load time) since backgroundPresets is defined later in the script —
// this also means any new live background added there automatically becomes a Band vibe too.
function bandVibeOptions(){
  return Object.entries(backgroundPresets).filter(([,p])=>p.type==='canvas').map(([key])=>key);
}

function openBandComposer(){
  bandComposerVibe = 'aurora';
  bandComposerMembers = new Set();
  $('bandNameInput').value = '';
  renderBandVibeChips();
  renderBandMemberPicker();
  updateCreateBandButton();
  $('bandComposer').classList.add('active');
}
function closeBandComposer(){ $('bandComposer').classList.remove('active'); }
$('newBandBtn').onclick = openBandComposer;
$('bandComposerClose').onclick = closeBandComposer;

function renderBandVibeChips(){
  $('bandVibeChipRow').innerHTML = bandVibeOptions().map(key=>{
    const name = (backgroundPresets[key] && backgroundPresets[key].name) || key;
    return `<div class="filter-chip ${bandComposerVibe===key?'active':''}" data-vibe="${key}">${name}</div>`;
  }).join('');
  /* Only this row's chips. The page-wide [data-vibe] also caught the
     Wireline mood tiles and overwrote their taps. */
  $('bandVibeChipRow').querySelectorAll('[data-vibe]').forEach(el=>{
    el.onclick = ()=>{ bandComposerVibe = el.dataset.vibe; renderBandVibeChips(); };
  });
}
function isMeBandContact(c){
  if(!c) return true;
  try{
    if(typeof currentUser !== 'undefined' && currentUser){
      if(c.firebaseUid && c.firebaseUid === currentUser.uid) return true;
      if(String(c.id) === String(currentUser.uid)) return true;
    }
    if(typeof currentProfile !== 'undefined' && currentProfile){
      const mine = String(currentProfile.number || '').replace(/^@/,'').toLowerCase();
      const theirs = String(c.handle || '').replace(/^@/,'').toLowerCase();
      if(mine && theirs && mine === theirs) return true;
    }
  }catch(_){}
  return false;
}
function bandPickKey(c){
  if(!c) return '';
  if(c.firebaseUid) return 'u:' + String(c.firebaseUid);
  if(c.id != null && c.id !== '') return 'i:' + String(c.id);
  return '';
}
function bandPickerContacts(){
  const seen = new Set();
  const out = [];
  (contacts||[]).forEach(function(c){
    if(!c || isMeBandContact(c)) return;
    const key = bandPickKey(c);
    if(!key || seen.has(key)) return;
    seen.add(key);
    out.push(c);
  });
  return out;
}
function bandPickLabel(c){
  const name = String((c && c.name) || '').trim();
  if(name && name !== 'You') return name;
  const handle = String((c && c.handle) || '').trim();
  if(handle) return handle.charAt(0) === '@' ? handle : '@' + handle;
  return 'Someone';
}
function renderBandMemberPicker(){
  const list = bandPickerContacts();
  $('bandMemberPicker').innerHTML = list.map(function(c){
    const key = bandPickKey(c);
    const on = bandComposerMembers.has(key);
    return '<div class="contact-row" data-pick="'+escapeHtml(key)+'" role="button" aria-pressed="'+(on?'true':'false')+'">'
      + (typeof contactAvatarHtml==='function' ? contactAvatarHtml(c, 40, signalBarsHtml(c)) : '')
      + '<div class="contact-meta"><div class="contact-name">'+escapeHtml(bandPickLabel(c))+'</div><div class="contact-sub">'+escapeHtml(signalSubText(c))+'</div></div>'
      + '<div class="switch'+(on?' on':'')+'" data-picksw="'+escapeHtml(key)+'"></div>'
      + '</div>';
  }).join('') || '<div class="empty-state"><p class="empty-state-copy">Connect someone on Frequencies first — then they can tune in.</p></div>';
  function togglePick(key){
    if(!key) return;
    if(bandComposerMembers.has(key)) bandComposerMembers.delete(key);
    else bandComposerMembers.add(key);
    const on = bandComposerMembers.has(key);
    const row = $('bandMemberPicker').querySelector('[data-pick="'+key.replace(/"/g,'')+'"]');
    if(row){
      row.setAttribute('aria-pressed', on ? 'true' : 'false');
      const sw = row.querySelector('.switch');
      if(sw) sw.classList.toggle('on', on);
    }
    updateCreateBandButton();
  }
  document.querySelectorAll('#bandMemberPicker [data-pick]').forEach(function(el){
    let armed = 0;
    const fire = function(e){
      if(e){ try{ e.preventDefault(); e.stopPropagation(); }catch(_){} }
      const now = Date.now();
      if(now - armed < 400) return;
      armed = now;
      togglePick(el.getAttribute('data-pick'));
    };
    el.onclick = fire;
    el.addEventListener('touchend', fire, { passive: false });
  });
}
function updateCreateBandButton(){
  const valid = $('bandNameInput').value.trim().length>0 && bandComposerMembers.size>0;
  $('createBandBtn').disabled = !valid;
  $('createBandBtn').style.opacity = valid ? '1' : '.5';
}
$('bandNameInput').addEventListener('input', updateCreateBandButton);
$('createBandBtn').onclick = ()=>{
  if($('createBandBtn').disabled) return;
  const name = $('bandNameInput').value.trim();
  const selected = Array.from(bandComposerMembers).map(function(key){
    return (contacts||[]).find(function(c){ return bandPickKey(c) === key; });
  }).filter(Boolean);
  const allReal = currentUser && fbDb && selected.length>0 && selected.every(c=>c.isReal && c.firebaseUid);
  if(allReal){
    createRealBand(name, bandComposerVibe, selected);
    return;
  }
  const id = Date.now();
  bands.push({ id, name, vibe: bandComposerVibe, memberIds: selected.map(function(c){ return c.id; }) });
  saveBands();
  renderBandList();
  closeBandComposer();
  toast('Started ' + name);
};
async function createRealBand(name, vibe, memberContacts){
  try{
    const memberUids = memberContacts.map(c=>c.firebaseUid);
    const allUids = [...memberUids, currentUser.uid];
    const docRef = await fbDb.collection('bands').add({
      name, vibe,
      memberUids: allUids,
      createdBy: currentUser.uid,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      lastEmptiedAt: null,
      linkJoin: true,
      // Market square: no owner privileges — createdBy is history only.
    });
    const memberInfo = (typeof nalunoLiveFace === 'function')
      ? allUids.map(function(u){
          const c = memberContacts.find(function(x){ return x.firebaseUid === u; });
          return nalunoLiveFace(u, c || (typeof currentProfile !== 'undefined' ? currentProfile : null));
        })
      : memberContacts.map(c=>({ uid:c.firebaseUid, name:c.name, color:c.color, initials:c.initials, photo:c.photo, photoUrl:c.photoUrl || null }));
    addRealBandToLocalList(docRef.id, name, vibe, memberInfo, currentUser.uid, { memberUids: allUids, lastEmptiedAt: null });
    renderBandList();
    closeBandComposer();
    await publishMyPublicBands();
    toast('Started · ' + name);
  }catch(e){
    toast(e.message || 'Couldn\u2019t start this Band');
  }
}

function escapeHtml(str){
  return String(str).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}
function timeAgo(ts){
  const diffMs = Date.now() - ts;
  if(diffMs < 60000) return 'Just now';
  const diffMin = Math.round(diffMs/60000);
  if(diffMin < 60) return diffMin+'m ago';
  const diffH = Math.round(diffMin/60);
  if(diffH < 24) return diffH+'h ago';
  return Math.round(diffH/24)+'d ago';
}
function clamp(v,min,max){ return Math.max(min, Math.min(max, v)); }

