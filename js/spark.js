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
    sparkStatus(e.message || 'Could not light a pulse');
    return;
  }
  if($('sparkCode')) $('sparkCode').textContent = code;
  const url = sparkLink(code);
  if($('sparkQr')){
    $('sparkQr').src = 'https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=' + encodeURIComponent(url);
  }
  sparkStatus('Valid for 3 minutes');
}

function closeSparkSheet(){
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
    try{ await ref.update({ guestUid: currentUser.uid, joinedAt: Date.now() }); }catch(_){}
    sparkStatus('You are now on each other\'s Frequencies');
    toast('Spark complete');
    setTimeout(closeSparkSheet, 900);
  }catch(e){
    sparkStatus(e.message || 'Could not join');
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
