/* ============================================================
   MODULE: js/diagnostics.js
   An on-device error log, readable without a phone console.

   Chasing the Signal bug showed the real problem with relying on DevTools:
   on a phone it needs a cable and Developer Options, and by the time you get
   there the failure has scrolled away or the toast has been overwritten. So
   errors are captured here as they happen, kept, and shown in plain text
   that can be copied and sent.

   Deliberately small: a bounded ring buffer in localStorage, no network, no
   dependency on anything else loading first.
   ============================================================ */

const NALUNO_DIAG_KEY = 'nalunoDiagLog';
const NALUNO_DIAG_MAX = 60;

function nalunoDiagRead(){
  try{ return JSON.parse(localStorage.getItem(NALUNO_DIAG_KEY) || '[]'); }
  catch(_){ return []; }
}

function nalunoDiagWrite(rows){
  try{ localStorage.setItem(NALUNO_DIAG_KEY, JSON.stringify(rows.slice(-NALUNO_DIAG_MAX))); }catch(_){}
}

/** Record something worth reading back later. Never throws — a diagnostics
 *  system that can itself break the app would be worse than none. */
function nalunoDiag(kind, message, detail){
  try{
    const rows = nalunoDiagRead();
    rows.push({
      t: Date.now(),
      kind: String(kind || 'info').slice(0, 40),
      msg: String(message == null ? '' : message).slice(0, 400),
      detail: detail == null ? '' : String(
        typeof detail === 'string' ? detail : JSON.stringify(detail)
      ).slice(0, 600),
    });
    nalunoDiagWrite(rows);
  }catch(_){}
}
try{ window.nalunoDiag = nalunoDiag; }catch(_){}

/* Catch what would otherwise only ever reach a console. */
try{
  window.addEventListener('error', function(e){
    nalunoDiag('js-error', (e && e.message) || 'script error',
      (e && e.filename ? e.filename.split('/').pop() : '') + (e && e.lineno ? ':' + e.lineno : ''));
  });
  window.addEventListener('unhandledrejection', function(e){
    const r = e && e.reason;
    const msg = (r && r.message) || String(r || 'unknown');
    if(/interrupted by a new load request/i.test(msg) || (r && r.name === 'AbortError')) return;
    nalunoDiag('promise-rejection', msg, (r && r.code) || '');
  });
}catch(_){}

function nalunoDiagFormat(){
  const rows = nalunoDiagRead();
  const head = [
    'Naluno diagnostics',
    'when: ' + new Date().toISOString(),
    'build: ' + (function(){
      try{ const m = document.querySelector('meta[name="naluno-build"]'); return m ? m.content : '?'; }catch(_){ return '?'; }
    })(),
    'app version: ' + (function(){
      try{ const m = document.querySelector('meta[name="app-version"]'); return m ? m.content : '?'; }catch(_){ return '?'; }
    })(),
    'signed in: ' + (typeof currentUser !== 'undefined' && currentUser ? 'yes (' + String(currentUser.uid).slice(0, 8) + '…)' : 'no'),
    'firestore ready: ' + (typeof fbDb !== 'undefined' && fbDb ? 'yes' : 'NO'),
    'online: ' + (navigator.onLine ? 'yes' : 'no'),
    'signals in memory: ' + (typeof mySignal !== 'undefined' && mySignal ? mySignal.length : 'n/a'),
    'user agent: ' + navigator.userAgent,
    '',
  ];
  // The last Signal save failure specifically — the thing we have been chasing.
  try{
    const last = localStorage.getItem('nalunoLastSignalError');
    if(last){
      const o = JSON.parse(last);
      head.push('LAST SIGNAL SAVE FAILURE');
      head.push('  code: ' + (o.code || '(none)'));
      head.push('  message: ' + (o.msg || ''));
      head.push('  document size: ' + (o.size != null ? o.size + ' bytes' : 'unknown'));
      head.push('  when: ' + (o.at ? new Date(o.at).toISOString() : '?'));
      head.push('');
    } else {
      head.push('LAST SIGNAL SAVE FAILURE: none recorded');
      head.push('');
    }
  }catch(_){}
  const body = rows.length
    ? rows.map(function(r){
        return new Date(r.t).toISOString().slice(11, 19) + '  [' + r.kind + '] ' + r.msg + (r.detail ? '  — ' + r.detail : '');
      })
    : ['(no errors recorded)'];
  return head.concat(body).join('\n');
}

function renderDiagPanel(){
  const el = $('diagBody');
  if(!el) return;
  const text = nalunoDiagFormat();
  el.innerHTML = '<pre id="diagText" style="white-space:pre-wrap;word-break:break-word;'
    + 'font-family:var(--font-mono);font-size:10.5px;line-height:1.5;color:var(--text-dim);'
    + 'background:var(--surface-2);border:1px solid var(--line);border-radius:12px;'
    + 'padding:12px;margin:0;max-height:240px;overflow:auto;">' + escapeHtml(text) + '</pre>';
}

function openDiagPanel(){
  renderDiagPanel();
}
function closeDiagPanel(){}

(function wireDiag(){
  function bind(){
    const copy = $('diagCopyBtn');
    if(copy) copy.onclick = function(){
      const text = nalunoDiagFormat();
      try{
        if(navigator.clipboard && navigator.clipboard.writeText){
          navigator.clipboard.writeText(text);
          toast('Copied — paste it anywhere');
          return;
        }
      }catch(_){}
      try{
        const pre = $('diagText');
        const range = document.createRange();
        range.selectNodeContents(pre);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        toast('Selected — long-press to copy');
      }catch(_){ toast('Could not copy automatically'); }
    };
    const clear = $('diagClearBtn');
    if(clear) clear.onclick = function(){
      try{ localStorage.removeItem(NALUNO_DIAG_KEY); }catch(_){}
      try{ localStorage.removeItem('nalunoLastSignalError'); }catch(_){}
      renderDiagPanel();
      toast('Cleared');
    };
  }
  bind();
  document.addEventListener('DOMContentLoaded', bind);
  window.addEventListener('load', bind);
})();
window.renderDiagPanel = renderDiagPanel;
window.openDiagPanel = openDiagPanel;
