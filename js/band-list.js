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
};
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
  if(!bands.length){
    $('bandList').innerHTML = `<div style="padding:28px 12px; text-align:center; color:var(--text-dim);">
      <div style="font-family:var(--font-futuristic); font-size:15px; color:var(--text); margin-bottom:8px;">No squares yet</div>
      <div style="font-size:13px; line-height:1.45;">Start a Band with your connections. No one owns it — messages clear 2 hours after the last person leaves.</div>
    </div>`;
    return;
  }
  $('bandList').innerHTML = bands.map(b=>{
    const grad = bandVibePreviewGradient[b.vibe] || bandVibePreviewGradient.aurora;
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

function addRealBandToLocalList(firestoreId, name, vibe, memberInfo, createdBy, extra){
  const existing = bands.find(b=>b.firestoreId===firestoreId);
  if(existing){
    existing.name = name;
    existing.vibe = vibe;
    existing.memberInfo = memberInfo;
    if(extra) Object.assign(existing, extra);
    return existing;
  }
  const row = { id: nextRealBandLocalId++, firestoreId, name, vibe, createdBy, isReal:true, memberInfo, ...(extra||{}) };
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
let bandsMembershipUnsub = null;
async function loadRealBands(uid){
  if(!fbDb) return;
  if(bandsMembershipUnsub){ bandsMembershipUnsub(); bandsMembershipUnsub = null; }
  // Live membership: invites that arrayUnion you show up without restarting the app.
  bandsMembershipUnsub = fbDb.collection('bands').where('memberUids','array-contains',uid).onSnapshot(snap=>{
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
      if(change.type === 'removed'){
        const idx = bands.findIndex(b=>b.firestoreId===doc.id);
        if(idx>=0) bands.splice(idx,1);
      } else {
        const row = addRealBandToLocalList(doc.id, d.name, d.vibe, memberInfo, d.createdBy, { lastEmptiedAt, memberUids: d.memberUids || [], messageEpoch });
        if(change.type === 'added' && d.createdBy !== uid){
          // Invited into a square that already existed
          toast('You were invited to · ' + (d.name || 'a Band'));
        }
        // App open is enough — do not wait for someone to sit in the empty square.
        if(row && lastEmptiedAt && (Date.now() - lastEmptiedAt) >= BAND_SETTLE_MS && typeof pruneSettledBandMessages === 'function'){
          pruneSettledBandMessages(fbDb.collection('bands').doc(doc.id), row);
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
  }, ()=>{ /* real bands just won't live-update this session */ });
}

async function saveBands(){
  if(!storageAvailable) return;
  try{ await window.storage.set('bands:list', JSON.stringify(bands)); }catch(e){ /* best-effort */ }
}
async function loadBands(){
  if(storageAvailable){
    try{
      const res = await window.storage.get('bands:list');
      if(res && res.value){
        const saved = JSON.parse(res.value);
        if(Array.isArray(saved) && saved.length){ bands.length = 0; saved.forEach(b=>bands.push(b)); }
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
  document.querySelectorAll('[data-vibe]').forEach(el=>{
    el.onclick = ()=>{ bandComposerVibe = el.dataset.vibe; renderBandVibeChips(); };
  });
}
function renderBandMemberPicker(){
  $('bandMemberPicker').innerHTML = contacts.map(c=>`
    <div class="contact-row" data-pick="${c.id}" style="cursor:pointer;">
      ${typeof contactAvatarHtml==='function' ? contactAvatarHtml(c, 40, signalBarsHtml(c)) : ''}
      <div class="contact-meta"><div class="contact-name">${escapeHtml(c.name)}</div><div class="contact-sub">${signalSubText(c)}</div></div>
      <div class="switch ${bandComposerMembers.has(c.id)?'on':''}" data-picksw="${c.id}"></div>
    </div>`).join('');
  document.querySelectorAll('[data-pick]').forEach(el=>{
    el.onclick = ()=>{
      const id = parseInt(el.dataset.pick);
      if(bandComposerMembers.has(id)) bandComposerMembers.delete(id); else bandComposerMembers.add(id);
      renderBandMemberPicker();
      updateCreateBandButton();
    };
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
  const selected = Array.from(bandComposerMembers).map(id=>contacts.find(c=>c.id===id)).filter(Boolean);
  const allReal = currentUser && fbDb && selected.length>0 && selected.every(c=>c.isReal && c.firebaseUid);
  if(allReal){
    createRealBand(name, bandComposerVibe, selected);
    return;
  }
  const id = Date.now();
  bands.push({ id, name, vibe: bandComposerVibe, memberIds: Array.from(bandComposerMembers) });
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

