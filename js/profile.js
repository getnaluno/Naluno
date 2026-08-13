/* ============================================================
   MODULE: js/profile.js
   Tab navigation + Callsign profile
   OWNERSHIP: change this domain here only.
   Scripts share globals (intentional) so load order matches the old monolith.
   ============================================================ */
/* ---------------- TAB NAV ---------------- */
document.querySelectorAll('.navbtn').forEach(btn=>{
  btn.onclick = ()=>{
    document.querySelectorAll('.navbtn').forEach(b=>b.classList.remove('active'));
    document.querySelectorAll('.tabscreen').forEach(s=>s.classList.remove('active'));
    btn.classList.add('active');
    $('tab-'+btn.dataset.tab).classList.add('active');
    if(btn.dataset.tab === 'frequencies') clearMissedCallBadge();
    if(btn.dataset.tab === 'compass') showCompassLockScreenIfNeeded();
  };
});

/* ---------------- CALLSIGN (profile) — persisted via window.storage ---------------- */
const swatches = ['#7CFFB2','#FFB86B','#7C4DFF','#FF7676','#4FBF87','#8B90A8'];
$('swatchRow').innerHTML = swatches.map((c,i)=>`<div class="swatch ${i===0?'selected':''}" style="background:${c}" data-c="${c}"></div>`).join('');

function initialsFor(name){
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0]||'') + (parts[1]?.[0]||'')).toUpperCase() || 'Y';
}
/* Identity here is a handle, not a phone number — no SIM card or country code attached to
   it, so changing either changes nothing about who you are in the app. */
function normalizeHandle(raw, fallbackName){
  let h = (raw || '').trim().replace(/\s+/g,'');
  h = h.replace(/^@+/, '');
  if(!h) h = (fallbackName || 'you').replace(/[^a-zA-Z0-9]/g,'');
  if(!h) h = 'you';
  return '@' + h;
}

/* Renders either the uploaded+cropped photo or the color+initials fallback into an avatar element */
function applyAvatarVisual(el, profile){
  if(profile.photo && profile.photo.dataUrl){
    el.style.background = 'var(--surface-2)';
    el.innerHTML = `<img src="${profile.photo.dataUrl}" style="position:absolute; top:50%; left:50%; width:100%; height:100%; object-fit:cover; transform:${cropTransform(profile.photo.crop)};" draggable="false" />`;
  } else {
    el.style.background = profile.color;
    el.innerHTML = '';
    el.textContent = initialsFor(profile.name);
  }
}

/* Reflects the given profile everywhere it's shown: view card, edit form, and story viewer header */
let draftPhoto = null; // the avatar photo currently being edited (not yet saved to currentProfile)
function applyProfileToUI(profile){
  $('nameInput').value = profile.name;
  $('taglineInput').value = profile.tagline;
  $('numberInput').value = profile.number;
  applyAvatarVisual($('profileAvatarBig'), profile);
  document.querySelectorAll('#swatchRow .swatch').forEach(s=>{
    s.classList.toggle('selected', s.dataset.c === profile.color);
  });

  $('viewName').textContent = profile.name;
  $('viewTagline').textContent = profile.tagline;
  $('viewNumber').textContent = profile.number;
  applyAvatarVisual($('viewAvatar'), profile);
  renderMySignalStatus();
}

/* Your own presence in Callsign runs through the identical model as everyone else's in
   Frequencies — computeSignal() applied to a timestamp — except the timestamp here tracks
   real interaction with this device (clicks, keys, touches) rather than a contact's activity.
   Going idle or backgrounding the tab lets it decay exactly like anyone else's would. */
let myLastActivityTs = Date.now();
function markMyActivity(){
  myLastActivityTs = Date.now(); // instant local feedback — your own badge updates immediately
  // Throttled remote write — no real reader depends on this yet (Phase 1), but this is
  // the same lastActivityTs field computeSignal() already expects, written for real.
  if(currentUser && fbDb && Date.now() - lastRemoteHeartbeat > 20000){
    lastRemoteHeartbeat = Date.now();
    fbDb.collection('users').doc(currentUser.uid)
      .set({ lastActivityTs: firebase.firestore.FieldValue.serverTimestamp() }, { merge:true })
      .catch(()=>{ /* best-effort — a missed heartbeat just means slightly stale presence */ });
  }
}
['click','keydown','touchstart'].forEach(evt => document.addEventListener(evt, markMyActivity, { passive:true }));
document.addEventListener('visibilitychange', ()=>{ if(document.visibilityState==='visible') markMyActivity(); });
function renderMySignalStatus(){
  const el = $('viewMySignal'); if(!el) return;
  const { tier } = computeSignal({ lastActivityTs: myLastActivityTs });
  el.textContent = signalMeta[tier].label + ' · this device';
  el.style.color = signalMeta[tier].color;
  updateSignatureGlow();
}

function hexToRgba(hex, alpha){
  const h = (hex || '#7CFFB2').replace('#','');
  const r = parseInt(h.substring(0,2),16), g = parseInt(h.substring(2,4),16), b = parseInt(h.substring(4,6),16);
  return `rgba(${r},${g},${b},${alpha})`;
}
/* Applied to every masked video frame in the app (lobby, in-call pip, Band Live) from one
   place, so your Callsign color and your live signal tier are always in sync everywhere
   your camera shows up — same source of truth as everything else, no separate state. */
function updateSignatureGlow(){
  const color = (typeof currentProfile !== 'undefined' && currentProfile && currentProfile.color) ? currentProfile.color : '#7CFFB2';
  const { tier } = computeSignal({ lastActivityTs: myLastActivityTs });
  // Real, guaranteed-visible color at the edge — not dependent on blend-mode math
  // against whatever happens to be behind it, which is what made this vanish before.
  const glow = `inset 0 0 26px 4px ${hexToRgba(color,0.55)}, inset 0 0 6px 1px ${hexToRgba(color,0.85)}`;
  ['camSignatureGlow','pipSignatureGlow','bandSignatureGlow'].forEach(id=>{
    const el = $(id); if(!el) return;
    el.style.boxShadow = glow;
    el.classList.remove('tier-strong','tier-fading','tier-off');
    el.classList.add('tier-'+tier);
  });
}

function showCallsignView(){
  $('callsignView').style.display = 'block';
  $('callsignEdit').style.display = 'none';
}
function showCallsignEdit(){
  draftPhoto = currentProfile.photo ? { ...currentProfile.photo } : null;
  applyProfileToUI(currentProfile); // repopulate the form from the last saved state
  $('avatarRemoveLink').style.display = draftPhoto ? 'block' : 'none';
  $('callsignView').style.display = 'none';
  $('callsignEdit').style.display = 'block';
}

document.querySelectorAll('#swatchRow .swatch').forEach(s=>{
  s.onclick = ()=>{
    document.querySelectorAll('#swatchRow .swatch').forEach(x=>x.classList.remove('selected'));
    s.classList.add('selected');
    if(!draftPhoto) applyAvatarVisual($('profileAvatarBig'), { name:$('nameInput').value, color:s.dataset.c, photo:null });
  };
});
$('nameInput').addEventListener('input', e=>{
  if(!draftPhoto) $('profileAvatarBig').textContent = initialsFor(e.target.value);
});

/* --- avatar photo upload + crop/pan/zoom (reuses the Adjust overlay) --- */
$('avatarEditBtn').onclick = ()=> $('avatarFileInput').click();
$('avatarFileInput').onchange = async (e)=>{
  const file = e.target.files[0];
  e.target.value = '';
  if(!file) return;
  const dataUrl = await readFileAsDataUrl(file);
  const startingCrop = draftPhoto ? draftPhoto.crop : { scale:1, xPct:0, yPct:0 };
  openAvatarAdjust(dataUrl, startingCrop, (result)=>{
    draftPhoto = result;
    const selectedSwatch = document.querySelector('#swatchRow .swatch.selected');
    applyAvatarVisual($('profileAvatarBig'), { name:$('nameInput').value, color: selectedSwatch ? selectedSwatch.dataset.c : swatches[0], photo: draftPhoto });
    $('avatarRemoveLink').style.display = 'block';
  });
};
$('avatarRemoveLink').onclick = ()=>{
  draftPhoto = null;
  const selectedSwatch = document.querySelector('#swatchRow .swatch.selected');
  applyAvatarVisual($('profileAvatarBig'), { name:$('nameInput').value, color: selectedSwatch ? selectedSwatch.dataset.c : swatches[0], photo:null });
  $('avatarRemoveLink').style.display = 'none';
};

const DEFAULT_PROFILE = { name:'You', tagline:'On air, mostly reachable.', number:'@you', color:'#7CFFB2', photo:null };
let currentProfile = { ...DEFAULT_PROFILE };
const storageAvailable = typeof window.storage !== 'undefined' && window.storage !== null;

