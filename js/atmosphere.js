/* ============================================================
   MODULE: js/atmosphere.js
   Today's Frequency atmosphere
   OWNERSHIP: change this domain here only.
   Scripts share globals (intentional) so load order matches the old monolith.
   ============================================================ */
/* ---------------- TODAY'S FREQUENCY (daily atmosphere) ----------------
   The app's own mood for the day — never random, never on a timer, never something you
   set. It's computed from two real things: how alive your actual network is right now
   (the same signal tiers Frequencies already shows), and what you genuinely did today
   (real messages sent, a real Band tuned into, a real broadcast posted, a real call
   connected). Only ever touches color/shimmer/tint — never layout, never where
   anything sits, since that would fight muscle memory instead of adding warmth.
   The daily counter lives in localStorage (device-local, like the custom ringtone) —
   this is a mood, not data worth syncing across devices. */
const ATMOSPHERE_TIERS = [
  { id:'quiet',   label:'Quiet Frequency',   max:25,
    gradient:'linear-gradient(90deg, #5A6178, #7C8195, #4A5068, #5A6178)', shimmer:'9s',
    tint:'radial-gradient(120% 60% at 50% 0%, rgba(122,129,149,.09), transparent 70%)' },
  { id:'steady',  label:'Steady Frequency',  max:50,
    gradient:'linear-gradient(90deg, #7CFFB2, #00E5FF, #7C4DFF, #7CFFB2)', shimmer:'5s',
    tint:'radial-gradient(120% 60% at 50% 0%, rgba(124,255,178,.08), transparent 70%)' },
  { id:'lively',  label:'Lively Frequency',  max:75,
    gradient:'linear-gradient(90deg, #FFB86B, #7CFFB2, #00E5FF, #FFB86B)', shimmer:'3.4s',
    tint:'radial-gradient(120% 60% at 50% 0%, rgba(255,184,107,.10), transparent 70%)' },
  { id:'buzzing', label:'Buzzing Frequency', max:100,
    gradient:'linear-gradient(90deg, #FF5470, #FFB86B, #7C4DFF, #00E5FF, #FF5470)', shimmer:'2.2s',
    tint:'radial-gradient(120% 60% at 50% 0%, rgba(255,84,112,.12), transparent 70%)' },
];
function todayKey(){
  const d = new Date();
  return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
}
function getTodayActivityCount(){
  try{ return parseInt(localStorage.getItem('naluno:activity:'+todayKey()) || '0', 10); }catch(e){ return 0; }
}
/* Called on real actions only: a real Wireline message sent, a real Band tuned into,
   a real broadcast posted, a real call connected. Never on passive things like opening
   a tab or scrolling. */
function bumpTodayActivity(){
  try{
    const key = 'naluno:activity:'+todayKey();
    localStorage.setItem(key, String(getTodayActivityCount()+1));
  }catch(e){ /* atmosphere just won't grow more vivid today — not worth surfacing an error for */ }
  applyAtmosphere();
}
function computeAtmosphereScore(){
  const real = contacts.filter(c=>c.isReal);
  let networkDensity = 0;
  if(real.length>0){
    const strong = real.filter(c=>computeSignal(c).tier==='strong').length;
    const fading = real.filter(c=>computeSignal(c).tier==='fading').length;
    networkDensity = (strong + fading*0.5) / real.length;
  }
  const todayCount = getTodayActivityCount();
  return { score: Math.min(100, Math.round(networkDensity*60 + Math.min(todayCount,10)*4)), real: real.length, strongCount: real.filter(c=>computeSignal(c).tier==='strong').length, todayCount };
}
let currentAtmosphereTier = null;
function applyAtmosphere(){
  const { score, real, strongCount, todayCount } = computeAtmosphereScore();
  const tier = ATMOSPHERE_TIERS.find(t=>score<=t.max) || ATMOSPHERE_TIERS[ATMOSPHERE_TIERS.length-1];
  currentAtmosphereTier = tier;
  document.documentElement.style.setProperty('--brand-gradient', tier.gradient);
  document.documentElement.style.setProperty('--brand-shimmer-duration', tier.shimmer);
  document.documentElement.style.setProperty('--atmosphere-tint', tier.tint);
  try{ document.documentElement.setAttribute('data-atmosphere', tier.id); }catch(_){}
  const el = $('atmosphereLabel');
  if(el){
    el.textContent = tier.label;
    el.title = real>0
      ? `${strongCount} of ${real} frequencies strong right now, plus ${todayCount} real thing${todayCount===1?'':'s'} you did today`
      : `Based on ${todayCount} real thing${todayCount===1?'':'s'} you did today — connect with people to see this grow with your network too`;
  }
}
$('atmosphereLabel') && ($('atmosphereLabel').onclick = ()=>{
  if(currentAtmosphereTier) toast(currentAtmosphereTier.label + ' — ' + $('atmosphereLabel').title);
});
applyAtmosphere();

/* Call this on the one kind of event that should ever move a contact's signal: real evidence
   they're reachable (a Wireline reply, or a connected call) — never our own outgoing activity. */
function bumpContactActivity(contactId){
  const c = contacts.find(x=>x.id===contactId); if(!c) return;
  c.lastActivityTs = Date.now();
  saveContactActivity();
  renderContacts();
  renderWirelineList();
}
async function saveContactActivity(){
  if(!storageAvailable) return;
  try{
    const data = {}; contacts.forEach(c=>{ if(c.lastActivityTs != null) data[c.id] = c.lastActivityTs; });
    await window.storage.set('contacts:activity', JSON.stringify(data));
  }catch(e){ /* best-effort */ }
}
async function loadContactActivity(){
  if(storageAvailable){
    try{
      const res = await window.storage.get('contacts:activity');
      if(res && res.value){
        const data = JSON.parse(res.value);
        contacts.forEach(c=>{ if(data[c.id] != null) c.lastActivityTs = data[c.id]; });
      }
    }catch(e){ /* nothing saved yet — seed values stand */ }
  }
  renderContacts();
  renderWirelineList();
}
/* Signal decays continuously, not just on interaction — re-render periodically so the
   Frequencies list and any open thread reflect that even if nothing else happens. */
setInterval(()=>{
  renderContacts(); renderWirelineList(); if(activeThreadContactId) updateThreadStatusLabel();
  renderMySignalStatus();
  renderBandList(); if(activeBandId) refreshBandRoom();
  applyAtmosphere();
}, 30000);

/* Broadcasts reference the same contacts array by id — no duplicated name/color/initials.
   postedAt is a real timestamp so it ages the same way everything else in the app does.
   Starts empty now that the demo contacts it used to reference are gone — real Broadcast
   (posts from real connections) isn't built yet, so this list is honestly just "yours"
   until that's a real feature, not a room full of names who'll never actually post. */
function signalBarsHtml(c){
  const { tier, bars } = computeSignal(c);
  const meta = signalMeta[tier];
  const inner = [1,2,3,4].map(i => `<span class="${i<=bars?'on':''}" style="--bar-color:${meta.color}"></span>`).join('');
  return `<div class="signal-bars" title="${meta.label}">${inner}</div>`;
}

