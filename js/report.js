/* ============================================================
   MODULE: js/report.js
   Reporting a creator, a Broadcast, or something someone posted.

   A report without a reason is unactionable. A moderator opening a queue of
   bare flags cannot tell harassment from a disagreement, so the reason is
   required — and required on the SERVER too, not just here, because a client
   can be rewritten and the queue is what has to stay usable.

   Deliberately non-punitive in the app: reporting does not hide anything,
   does not notify the person, and does not accuse. It records a signal for a
   human to look at.
   ============================================================ */

const REPORT_WORKER_URL = 'https://naluno-economy.naluno.workers.dev';

const NALUNO_REPORT_REASONS = [
  { code: 'harassment',   label: 'Harassment or bullying' },
  { code: 'hate',         label: 'Hate or discrimination' },
  { code: 'violence',     label: 'Violence or threats' },
  { code: 'sexual',       label: 'Sexual content' },
  { code: 'scam',         label: 'Scam or fraud' },
  { code: 'impersonation',label: 'Pretending to be someone else' },
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
  sheet.classList.add('active');
  sheet.dataset.targetType = d.target_type || 'broadcast';
  sheet.dataset.targetId = d.target_id || '';
  sheet.dataset.targetUser = d.target_user_id || '';
  sheet.dataset.broadcastId = d.broadcast_id || '';
  sheet.dataset.reportId = nalunoReportId();   // stable per open, so a double tap files one

  const who = document.getElementById('reportWho');
  if(who) who.textContent = d.name ? ('Reporting ' + d.name) : 'Report this';
  const sel = document.getElementById('reportReasonCode');
  if(sel && !sel.options.length){
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
}

function closeReportSheet(){
  const sheet = document.getElementById('reportSheet');
  if(sheet) sheet.classList.remove('active');
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
      }),
    });
    const b = await res.json().catch(function(){ return {}; });
    if(!res.ok || !b.ok){
      if(msg) msg.textContent = b.error || 'Could not send that report.';
      return;
    }
    closeReportSheet();
    // Honest about what happens next: a person will look, and that is all.
    toast('Reported. Someone will look at this.');
  }catch(_){
    if(msg) msg.textContent = 'Couldn’t reach the service. Try again in a moment.';
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
  }
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind);
  else bind();
})();

try{
  window.openReportSheet = openReportSheet;
  window.closeReportSheet = closeReportSheet;
}catch(_){}
