/* ============================================================
   MODULE: js/spark.js
   Two phones swap Callsigns in person — Naluno's pulse, not airdrop.
   ============================================================ */
function sparkAlphabetCode(){
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let s = '';
  for(let i = 0; i < 5; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}
function sparkLink(code){
  const base = (location.origin && location.origin !== 'null') ? location.origin : 'https://getnaluno.com';
  return base.replace(/\/$/, '') + '/?spark=' + encodeURIComponent(code);
}
function sparkStatus(msg){
  const el = $('sparkStatus');
  if(el) el.textContent = msg || '';
}

async function openSparkSheet(){
  const sheet = $('sparkSheet');
  if(!sheet) return;
  if(!currentUser || !fbDb){ toast('Sign in first'); return; }
  sheet.style.display = 'flex';
  sparkStatus('Lighting a pulse…');
  const code = sparkAlphabetCode();
  const handle = ((currentProfile && currentProfile.number) || '').replace(/^@/, '') || currentUser.uid.slice(0, 8);
  try{
    await fbDb.collection('sparks').doc(code).set({
      hostUid: currentUser.uid,
      hostName: (currentProfile && currentProfile.name) || 'Someone',
      hostHandle: handle,
      hostColor: (currentProfile && currentProfile.color) || '#7CFFB2',
      createdAt: Date.now(),
      expiresAt: Date.now() + 3 * 60 * 1000,
    });
  }catch(e){
    const msg = String((e && e.message) || '');
    if(/permission|insufficient/i.test(msg)){
      sparkStatus('Spark needs a rules update on the server — publish firestore.rules from this zip');
    } else {
      sparkStatus(msg || 'Could not light a pulse');
    }
    return;
  }
  if($('sparkCode')) $('sparkCode').textContent = code;
  const url = sparkLink(code);
  if($('sparkQr')){
    $('sparkQr').src = 'https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=' + encodeURIComponent(url);
  }
  sparkStatus('Valid for 3 minutes');
  watchSparkGuest(code);
}

let sparkHostUnsub = null;
function watchSparkGuest(code){
  if(sparkHostUnsub){ try{ sparkHostUnsub(); }catch(_){} sparkHostUnsub = null; }
  if(!fbDb || !code) return;
  sparkHostUnsub = fbDb.collection('sparks').doc(code).onSnapshot(function(snap){
    const d = snap.data() || {};
    if(!d.guestUid || d.guestUid === (currentUser && currentUser.uid)) return;
    if(sparkHostUnsub){ try{ sparkHostUnsub(); }catch(_){} sparkHostUnsub = null; }
    closeSparkSheet();
    if(typeof connectWithUser === 'function' && d.guestUid){
      connectWithUser(d.guestUid, { name: d.guestName || 'Them', color: d.guestColor }, d.guestHandle).catch(function(){});
    }
    if(typeof openSparkPage === 'function'){
      openSparkPage(d.guestUid, d.guestName || 'Them');
    }
  });
}

function closeSparkSheet(){
  if(sparkHostUnsub){ try{ sparkHostUnsub(); }catch(_){} sparkHostUnsub = null; }
  const sheet = $('sparkSheet');
  if(sheet) sheet.style.display = 'none';
}

async function joinSparkCode(raw){
  const code = String(raw || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
  if(code.length < 4){ sparkStatus('Enter their pulse'); return; }
  if(!currentUser || !fbDb){ toast('Sign in first'); return; }
  sparkStatus('Reaching…');
  try{
    const ref = fbDb.collection('sparks').doc(code);
    const snap = await ref.get();
    if(!snap.exists){ sparkStatus('That pulse is not live'); return; }
    const d = snap.data() || {};
    if(d.expiresAt && Date.now() > d.expiresAt){ sparkStatus('That pulse faded'); return; }
    if(d.hostUid === currentUser.uid){ sparkStatus('That is your own pulse'); return; }
    const host = await fbDb.collection('users').doc(d.hostUid).get();
    const data = host.exists ? host.data() : { name: d.hostName, number: '@' + d.hostHandle, color: d.hostColor };
    if(typeof connectWithUser === 'function'){
      await connectWithUser(d.hostUid, data, d.hostHandle);
    }
    const guestName = (currentProfile && currentProfile.name) || 'Someone';
    try{
      await ref.update({
        guestUid: currentUser.uid,
        guestName: guestName,
        joinedAt: Date.now(),
        roomId: [d.hostUid, currentUser.uid].sort().join('_'),
      });
    }catch(_){}
    sparkStatus('Opening your Spark page');
    toast('Spark complete');
    closeSparkSheet();
    if(typeof openSparkPage === 'function'){
      openSparkPage(d.hostUid, d.hostName || 'Them');
    }
  }catch(e){
    const msg = String((e && e.message) || '');
    if(/permission|insufficient/i.test(msg)){
      sparkStatus('Spark needs a rules update on the server — try again after the new zip is live');
    } else {
      sparkStatus(msg || 'Could not join');
    }
  }
}

if($('sparkOpenBtn')) $('sparkOpenBtn').onclick = openSparkSheet;
if($('sparkCloseBtn')) $('sparkCloseBtn').onclick = closeSparkSheet;
if($('sparkJoinBtn')) $('sparkJoinBtn').onclick = ()=> joinSparkCode($('sparkJoinInput') && $('sparkJoinInput').value);
if($('sparkJoinInput')){
  $('sparkJoinInput').addEventListener('keydown', function(e){
    if(e.key === 'Enter'){ e.preventDefault(); joinSparkCode(e.target.value); }
  });
}
if($('sparkOpenLastBtn')){
  $('sparkOpenLastBtn').onclick = function(){
    try{
      const last = JSON.parse(localStorage.getItem('nalunoLastSpark') || 'null');
      if(!last || !last.otherUid){ sparkStatus('No Spark page yet'); return; }
      closeSparkSheet();
      if(typeof openSparkPage === 'function') openSparkPage(last.otherUid, last.otherName);
    }catch(_){ sparkStatus('No Spark page yet'); }
  };
}

(function consumeSparkLink(){
  try{
    const params = new URLSearchParams(location.search || '');
    const code = params.get('spark');
    if(!code) return;
    const tryJoin = function(){
      if(currentUser && fbDb){
        if($('sparkSheet')) $('sparkSheet').style.display = 'flex';
        joinSparkCode(code);
        return;
      }
      setTimeout(tryJoin, 400);
    };
    setTimeout(tryJoin, 700);
  }catch(_){}
})();
