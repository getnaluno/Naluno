/* ============================================================
   MODULE: js/report.js
   Reporting a creator, a Broadcast, or something someone posted.

   A report without a reason is unactionable. A moderator opening a queue of
   bare flags cannot tell harassment from a disagreement, so the reason is
   required — and required on the SERVER too, not just here, because a client
   can be rewritten and the queue is what has to stay usable.

   Deliberately non-punitive in the app: reporting does not hide anything,
   does not notify the person, and does not accuse. It records a signal for a
   human to look at. Private Wireline and Band contents are not collected.
   ============================================================ */

const REPORT_WORKER_URL = 'https://naluno-economy.naluno.workers.dev';

const NALUNO_REPORT_REASONS = [
  { code: 'terrorism',    label: 'Terrorism or violent extremism' },
  { code: 'recruitment',  label: 'Recruitment to violence' },
  { code: 'violence',     label: 'Threat of violence' },
  { code: 'child_exploitation', label: 'Child exploitation' },
  { code: 'sexual_exploitation', label: 'Sexual exploitation' },
  { code: 'hate',         label: 'Hate or incitement' },
  { code: 'harassment',   label: 'Harassment or bullying' },
  { code: 'sexual',       label: 'Sexual content' },
  { code: 'scam',         label: 'Scam or fraud' },
  { code: 'fraud',        label: 'Fraud' },
  { code: 'impersonation',label: 'Pretending to be someone else' },
  { code: 'dangerous',    label: 'Dangerous activity' },
  { code: 'illegal',      label: 'Other illegal content' },
  { code: 'stolen',       label: 'Not their content' },
  { code: 'spam',         label: 'Spam' },
  { code: 'other',        label: 'Something else' },
];

function nalunoReportId(){
  try{ if(crypto && crypto.randomUUID) return 'rep_' + crypto.randomUUID(); }catch(_){}
  return 'rep_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10);
}

/** Opens the report sheet.
 *  detail: { target_type, target_id, target_user_id, broadcast_id, name } */
function openReportSheet(detail){
  const d = detail || {};
  if(typeof currentUser === 'undefined' || !currentUser){ toast('Sign in first'); return; }
  if(d.target_user_id && currentUser && d.target_user_id === currentUser.uid){
    toast('You can’t report yourself');
    return;
  }
  const sheet = document.getElementById('reportSheet');
  if(!sheet) return;
  /* FIX ("the report button is off"). The sheet shares the .call-overlay
     class, which is position:ABSOLUTE and lives inside #app — a
     position:relative, overflow:hidden box. The Broadcast space it opens
     from is position:FIXED at <body> level and covers the whole viewport.
     So the sheet was being laid out and clipped inside #app, underneath a
     full-screen layer it could never escape, and its z-index:360 was
     competing from inside the wrong box. The tap registered; nothing
     visible happened.

     Moving the sheet to <body> on open puts it in the same layer as the
     Broadcast space, and position:fixed makes it cover the viewport rather
     than #app's rectangle. Done at open time rather than by editing the
     markup, so it is correct however the page was served or cached. */
  if(sheet.parentElement !== document.body){
    document.body.appendChild(sheet);
  }
  sheet.style.position = 'fixed';
  sheet.style.inset = '0';
  sheet.style.zIndex = '2147483000';
  sheet.classList.add('active');
  sheet.dataset.targetType = d.target_type || 'broadcast';
  sheet.dataset.targetId = d.target_id || '';
  sheet.dataset.targetUser = d.target_user_id || '';
  sheet.dataset.broadcastId = d.broadcast_id || '';
  sheet.dataset.reportId = nalunoReportId();   // stable per open, so a double tap files one

  const who = document.getElementById('reportWho');
  if(who) who.textContent = d.name ? ('Reporting ' + d.name) : 'Report this';
  const sel = document.getElementById('reportReasonCode');
  if(sel){
    sel.innerHTML = '';
    NALUNO_REPORT_REASONS.forEach(function(r){
      const o = document.createElement('option');
      o.value = r.code; o.textContent = r.label;
      sel.appendChild(o);
    });
  }
  const txt = document.getElementById('reportReason');
  if(txt) txt.value = '';
  const msg = document.getElementById('reportMsg');
  if(msg) msg.textContent = '';
  const btn = document.getElementById('reportSendBtn');
  if(btn) btn.disabled = true;      // stays disabled until a real reason is typed
  try{ if(window.nalunoBack) window.nalunoBack.push(); }catch(_){}
}

function closeReportSheet(){
  const sheet = document.getElementById('reportSheet');
  if(sheet) sheet.classList.remove('active');
  try{ if(window.nalunoBack) window.nalunoBack.drop('reportSheet'); }catch(_){}
}

async function submitReport(){
  const sheet = document.getElementById('reportSheet');
  const txt = document.getElementById('reportReason');
  const sel = document.getElementById('reportReasonCode');
  const msg = document.getElementById('reportMsg');
  if(!sheet || !txt) return;
  const reason = (txt.value || '').trim();
  if(reason.length < 10){
    if(msg) msg.textContent = 'Please say a little more — at least a sentence.';
    return;
  }
  if(msg) msg.textContent = 'Sending…';
  try{
    const idToken = await currentUser.getIdToken(false);
    const res = await fetch(REPORT_WORKER_URL + '/v1/report', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + idToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        report_id: sheet.dataset.reportId,
        target_type: sheet.dataset.targetType,
        target_id: sheet.dataset.targetId,
        target_user_id: sheet.dataset.targetUser,
        broadcast_id: sheet.dataset.broadcastId,
        reason_code: (sel && sel.value) || 'other',
        reason: reason,
        reporter_age_hours: nalunoAccountAgeHours(),
      }),
    });
    const b = await res.json().catch(function(){ return {}; });
    if(!res.ok || !b.ok){
      if(msg) msg.textContent = b.error || 'Could not send that report.';
      return;
    }
    closeReportSheet();
    const code = (sel && sel.value) || '';
    toast(code === 'sexual'
      ? 'Reported. This comes off the public feed while someone looks.'
      : (code === 'terrorism' || code === 'recruitment' || code === 'child_exploitation' || code === 'violence')
        ? 'Reported. This is in the urgent safety queue. Private messages were not opened.'
        : 'Reported. Someone will look at this.');
  }catch(_){
    if(msg) msg.textContent = 'Couldn’t reach the service. Try again in a moment.';
  }
}

function nalunoAccountAgeHours(){
  try{
    const created = currentUser && currentUser.metadata && currentUser.metadata.creationTime;
    if(!created) return -1;
    return (Date.now() - new Date(created).getTime()) / 3600000;
  }catch(_){ return -1; }
}
function nalunoSafetyDeviceKey(){
  try{
    let id = localStorage.getItem('nalunoSafetyDevice');
    if(!id){
      id = 'dev_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      localStorage.setItem('nalunoSafetyDevice', id);
    }
    return id;
  }catch(_){ return ''; }
}
function nalunoSafetyStopped(result){
  if(!result || !result.decision) return false;
  return result.decision === 'REVIEW' || result.decision === 'REMOVE' || result.decision === 'ESCALATE' || result.decision === 'AGE_RESTRICT' || result.decision === 'REGION_RESTRICT';
}
function nalunoSafetyStatement(result){
  if(window.NalunoSafety && typeof window.NalunoSafety.statementFor === 'function'){
    try{ return window.NalunoSafety.statementFor(result); }catch(_){}
  }
  return 'Held for a safety review. This is not a ban.';
}
function nalunoSafetyEvent(type, detail){
  try{
    if(typeof currentUser === 'undefined' || !currentUser || !currentUser.getIdToken) return;
    const d = detail || {};
    const body = {
      type: type,
      surface: d.surface || 'public',
      content_id: d.content_id || '',
      public_text: d.public_text ? String(d.public_text).slice(0, 4000) : '',
      device_key: nalunoSafetyDeviceKey(),
      sha256: d.sha256 || '',
    };
    currentUser.getIdToken(false).then(function(tok){
      fetch(REPORT_WORKER_URL + '/v1/safety/event', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }).catch(function(){});
    }).catch(function(){});
  }catch(_){}
}
async function nalunoSafetySha256(buffer){
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest)).map(function(b){ return b.toString(16).padStart(2, '0'); }).join('');
}
async function nalunoSafetyCheckHash(hex, contentId, surface){
  if(!hex || !currentUser || !currentUser.getIdToken) return null;
  try{
    const tok = await currentUser.getIdToken(false);
    const res = await fetch(REPORT_WORKER_URL + '/v1/safety/hash', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' },
      body: JSON.stringify({ sha256: hex, content_id: contentId || '', surface: surface || 'public' }),
    });
    const body = await res.json().catch(function(){ return {}; });
    return body && body.result ? body.result : null;
  }catch(_){ return null; }
}
function pinSafetySheet(sheet){
  if(!sheet) return;
  if(sheet.parentElement !== document.body) document.body.appendChild(sheet);
  sheet.style.position = 'fixed';
  sheet.style.inset = '0';
  sheet.style.zIndex = '2147483000';
}
function openSafetyAppeal(caseId, statement){
  const sheet = document.getElementById('appealSheet');
  if(!sheet){
    const note = window.prompt(statement || 'If this was journalism, history, or a mistake, say why.');
    if(note) submitSafetyAppeal(caseId, note);
    return;
  }
  pinSafetySheet(sheet);
  sheet.dataset.caseId = caseId || '';
  sheet.classList.add('active');
  try{ if(window.nalunoBack) window.nalunoBack.push(); }catch(_){}
  const note = document.getElementById('appealNote');
  if(note) note.value = '';
  const msg = document.getElementById('appealMsg');
  if(msg) msg.textContent = statement || 'A person looks again. Private chats stay closed.';
}
function closeSafetyAppeal(){
  const sheet = document.getElementById('appealSheet');
  if(sheet) sheet.classList.remove('active');
  try{ if(window.nalunoBack) window.nalunoBack.drop('appealSheet'); }catch(_){}
}
async function submitSafetyAppeal(caseId, note){
  if(!currentUser || !caseId) return { ok: false };
  const text = String(note || '').trim();
  if(text.length < 10){ toast('Say a little more about why this should be looked at again.'); return { ok: false }; }
  try{
    const idToken = await currentUser.getIdToken(false);
    const res = await fetch(REPORT_WORKER_URL + '/v1/safety/appeal', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + idToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({ case_id: caseId, note: text }),
    });
    const b = await res.json().catch(function(){ return {}; });
    if(!res.ok || !b.ok){ toast((b && b.error) || 'Could not file that appeal.'); return b; }
    toast('Appeal filed. A person will look again.');
    closeSafetyAppeal();
    return b;
  }catch(_){
    toast('Couldn’t reach the safety desk.');
    return { ok: false };
  }
}

(function wireReportSheet(){
  function bind(){
    const close = document.getElementById('reportCloseBtn');
    if(close) close.onclick = closeReportSheet;
    const send = document.getElementById('reportSendBtn');
    if(send) send.onclick = submitReport;
    const txt = document.getElementById('reportReason');
    if(txt) txt.addEventListener('input', function(){
      // The send button only enables once there is something to act on.
      const btn = document.getElementById('reportSendBtn');
      if(btn) btn.disabled = (txt.value || '').trim().length < 10;
      const msg = document.getElementById('reportMsg');
      if(msg) msg.textContent = '';
    });
    const sheet = document.getElementById('reportSheet');
    if(sheet) sheet.onclick = function(e){ if(e && e.target === sheet) closeReportSheet(); };
    const appealClose = document.getElementById('appealCloseBtn');
    if(appealClose) appealClose.onclick = closeSafetyAppeal;
    const appealSend = document.getElementById('appealSendBtn');
    if(appealSend) appealSend.onclick = function(){
      const appeal = document.getElementById('appealSheet');
      const note = document.getElementById('appealNote');
      submitSafetyAppeal(appeal && appeal.dataset.caseId, note ? note.value : '');
    };
    const appeal = document.getElementById('appealSheet');
    if(appeal) appeal.onclick = function(e){ if(e && e.target === appeal) closeSafetyAppeal(); };
  }
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind);
  else bind();
})();

try{
  window.openReportSheet = openReportSheet;
  window.closeReportSheet = closeReportSheet;
  window.submitSafetyAppeal = submitSafetyAppeal;
  window.openSafetyAppeal = openSafetyAppeal;
  window.nalunoSafetyEvent = nalunoSafetyEvent;
  window.nalunoSafetyStopped = nalunoSafetyStopped;
  window.nalunoSafetyStatement = nalunoSafetyStatement;
  window.nalunoSafetySha256 = nalunoSafetySha256;
  window.nalunoSafetyCheckHash = nalunoSafetyCheckHash;
}catch(_){}
