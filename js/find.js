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
  if(existing){ existing.name = name; existing.color = color || existing.color; existing.handle = handle || existing.handle; existing.photo = photo || null; existing.initials = initialsFor(name); return; }
  contacts.push({
    id: nextRealContactId++,
    firebaseUid,
    name,
    initials: initialsFor(name),
    color: color || '#7CFFB2',
    handle: handle || '',
    photo: photo || null,
    lastActivityTs: Date.now(), // freshly connected — reachable right now, decays normally after
    isReal: true,
  });
}
/* Renders an actual uploaded photo when a contact has one, falling back to color +
   initials otherwise — used everywhere a real contact's avatar shows up, not just
   their own Callsign, which is the only place this used to work. */
function contactAvatarStyleAttr(c){
  if(c && c.photo && c.photo.dataUrl){
    const u = String(c.photo.dataUrl).replace(/['"\\]/g, '');
    if(!/^(data:image\/|https?:|blob:)/i.test(u)) return 'background:#7CFFB2;';
    return 'background-image:url("'+u+'");background-size:cover;background-position:center;';
  }
  const color = String((c && c.color) || '#7CFFB2');
  const safe = /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$/.test(color) ? color : '#7CFFB2';
  return 'background:' + safe + ';';
}
function applyContactAvatarToEl(el, c){
  if(!el || !c) return;
  if(c.photo && c.photo.dataUrl){
    const u = String(c.photo.dataUrl).replace(/['"\\]/g, '');
    if(/^(data:image\/|https?:|blob:)/i.test(u)){
      el.style.backgroundImage = 'url("'+u+'")';
      el.style.backgroundSize = 'cover';
      el.style.backgroundPosition = 'center';
      el.textContent = '';
      return;
    }
  }
  el.style.backgroundImage = '';
  const color = String(c.color || '#7CFFB2');
  el.style.background = /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$/.test(color) ? color : '#7CFFB2';
  el.textContent = c.initials || '';
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
      addRealContactToLocalList(doc.id, d.name || 'Unknown', d.color, d.handle, d.photo);
    });
    renderContacts();
    renderBandList();
    applyAtmosphere();
    try{
      nalunoCacheWrite('contacts', contacts.filter(function(c){ return c.isReal; }).map(function(c){
        const photo = (c.photo && c.photo.dataUrl && c.photo.dataUrl.length < 120000) ? c.photo : null;
        return { firebaseUid:c.firebaseUid, name:c.name, color:c.color, handle:c.handle, photo:photo };
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
    if(d.photo && JSON.stringify(d.photo) !== JSON.stringify(c.photo)){ c.photo = d.photo; changed = true; }
    if(!d.photo && c.photo){ c.photo = null; changed = true; }
    if(d.publicKey && JSON.stringify(d.publicKey) !== JSON.stringify(c.publicKey)){ c.publicKey = d.publicKey; delete sharedKeyCache[firebaseUid]; changed = true; }
    if(d.name && d.name !== c.name){ c.name = d.name; c.initials = initialsFor(d.name); changed = true; }
    if(d.color && d.color !== c.color){ c.color = d.color; changed = true; }
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
    $('findPeopleResult').innerHTML = `
      <div class="contact-row" style="cursor:default;">
        <div class="avatar" style="width:46px;height:46px;font-size:15px;background:${data.color||'#7CFFB2'};">${initialsFor(data.name||'?')}</div>
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
    batch.set(myConnRef, { name: theirData.name||'Unknown', handle: theirData.number || ('@'+handle), color: theirData.color||'#7CFFB2', photo: theirData.photo || null, connectedAt: firebase.firestore.FieldValue.serverTimestamp() });
    batch.set(theirConnRef, { name: currentProfile.name, handle: currentProfile.number, color: currentProfile.color, photo: currentProfile.photo || null, connectedAt: firebase.firestore.FieldValue.serverTimestamp() });
    await batch.commit();
    addRealContactToLocalList(theirUid, theirData.name||'Unknown', theirData.color, theirData.number||('@'+handle), theirData.photo);
    toast('Connected with ' + (theirData.name||'them'));
    closeFindPeople();
    renderContacts();
  }catch(e){
    toast(e.message || 'Couldn\u2019t connect right now');
  }
}
