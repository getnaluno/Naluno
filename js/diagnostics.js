/* ============================================================
   MODULE: js/diagnostics.js
   What goes wrong on a phone is told to Naluno, not to the person.

   15 Oct g: this used to be an on-device log meant to be read off the
   phone (its panel was later removed, so nobody could read it). Problems
   the person cannot act on (database refusals, missing indexes, script
   errors, failed calls and why they failed) are now sent to Naluno's
   Control Centre → Diagnostics, and the person sees a plain sentence or
   nothing at all.

   What is sent (privacy-minimised):
   - a short code and message, the build, the kind of app (Android app,
     installed web app, browser), whether Naluno was on screen;
   - for a call: the stages it reached and how long each took, the network
     route type (direct / relay), connection states, and how it ended.
   Never sent: message text, Signal or Broadcast content, SDP, network
   addresses, TURN credentials, tokens, email addresses, phone numbers.

   Written to Firestore `diagReports` (create only, by the signed-in
   person, for themselves; only the desk can read). Batched, de-duplicated
   and capped per day, kept on the phone until it can be sent.
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

const NalunoTech = (function(){
  const Q_KEY = 'nalunoTechQueue';
  const DAY_KEY = 'nalunoTechDay';
  const MAX_QUEUE = 120;          // entries kept on the phone while offline
  const MAX_DOCS_PER_DAY = 40;    // reports written per phone per day
  const MAX_ENTRIES_PER_DOC = 25;
  let flushTimer = null;
  let flushing = false;
  const seenThisSession = {};

  function build(){
    try{ const m = document.querySelector('meta[name="naluno-build"]'); return m ? String(m.content || '') : ''; }catch(_){ return ''; }
  }
  function platform(){
    try{
      const C = window.Capacitor;
      if(C && ((typeof C.isNativePlatform === 'function' && C.isNativePlatform()) || C.platform === 'android')) return 'android-app';
      if(C && C.platform === 'ios') return 'ios-app';
      if(window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) return 'installed-web';
      if(navigator.standalone) return 'installed-web';
    }catch(_){}
    return 'browser';
  }
  function device(){
    try{
      const ua = String(navigator.userAgent || '');
      const os = /Android\s[\d.]+/.exec(ua) || /iPhone OS [\d_]+/.exec(ua) || /Windows NT [\d.]+/.exec(ua) || /Mac OS X [\d_]+/.exec(ua);
      const br = /Chrome\/(\d+)/.exec(ua) || /Version\/(\d+).*Safari/.exec(ua) || /Firefox\/(\d+)/.exec(ua);
      return ((os && os[0]) || 'other') + ' · ' + (br ? br[0].split('/')[0] + ' ' + br[1] : 'browser');
    }catch(_){ return ''; }
  }
  /* Nothing personal leaves the phone: addresses, emails, long numbers,
     tokens and query strings are cut out of every message. */
  function scrub(s, max){
    let t = String(s == null ? '' : s);
    t = t.replace(/Bearer\s+[A-Za-z0-9._\-]+/g, 'Bearer …')
      .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email]')
      .replace(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g, '[ip]')
      .replace(/\b[0-9a-f]{0,4}(?::[0-9a-f]{0,4}){3,7}\b/gi, '[ip]')
      .replace(/\+?\d[\d\s-]{8,}\d/g, '[number]')
      .replace(/(https?:\/\/(?!console\.firebase\.google\.com)[^\s?#]+)[?#][^\s]*/g, '$1')
      .replace(/(credential|password|token|secret|ufrag|pwd)["'=:\s]+[^\s,"'}]+/gi, '$1=…');
    return t.slice(0, max || 300);
  }
  function readQ(){
    try{ const q = JSON.parse(localStorage.getItem(Q_KEY) || '[]'); return Array.isArray(q) ? q : []; }catch(_){ return []; }
  }
  function writeQ(q){
    try{ localStorage.setItem(Q_KEY, JSON.stringify(q.slice(-MAX_QUEUE))); }catch(_){}
  }
  function dayCount(){
    try{
      const d = JSON.parse(localStorage.getItem(DAY_KEY) || '{}');
      const today = new Date().toISOString().slice(0, 10);
      return d.day === today ? (Number(d.n) || 0) : 0;
    }catch(_){ return 0; }
  }
  function bumpDay(n){
    try{
      const today = new Date().toISOString().slice(0, 10);
      localStorage.setItem(DAY_KEY, JSON.stringify({ day: today, n: dayCount() + n }));
    }catch(_){}
  }
  function onScreen(){
    try{ return !(document.hidden); }catch(_){ return true; }
  }
  /** One problem the person did not need to see. Same kind and message
   *  within a session are counted, not repeated. */
  function add(kind, message, detail){
    try{
      const k = String(kind || 'app').slice(0, 40);
      const msg = scrub(message, 300);
      const key = k + '|' + msg;
      if(seenThisSession[key]){
        seenThisSession[key].n++;
        const q = readQ();
        const hit = q.filter(function(e){ return e && e.type === 'app' && e.key === key; })[0];
        if(hit){ hit.n = (hit.n || 1) + 1; hit.last = Date.now(); writeQ(q); }
        return;
      }
      seenThisSession[key] = { n: 1 };
      const q = readQ();
      q.push({ type: 'app', key: key, kind: k, msg: msg,
        detail: detail == null ? '' : scrub(typeof detail === 'string' ? detail : JSON.stringify(detail), 600),
        at: Date.now(), last: Date.now(), n: 1, fg: onScreen(), build: build() });
      writeQ(q);
      schedule(15000);
    }catch(_){}
  }
  /** A finished call attempt (connected or not), already privacy-minimised
   *  by calls.js. */
  function call(rec){
    try{
      if(!rec || typeof rec !== 'object') return;
      const q = readQ();
      q.push({ type: 'call', at: Date.now(), build: build(), rec: JSON.parse(JSON.stringify(rec)) });
      writeQ(q);
      schedule(4000);
    }catch(_){}
  }
  function schedule(ms){
    try{
      if(flushTimer) return;
      flushTimer = setTimeout(function(){ flushTimer = null; flush(); }, ms);
    }catch(_){}
  }
  function db(){ try{ return (typeof fbDb !== 'undefined' && fbDb) ? fbDb : null; }catch(_){ return null; } }
  function me(){ try{ return (typeof currentUser !== 'undefined' && currentUser) ? currentUser : null; }catch(_){ return null; } }
  async function flush(){
    if(flushing) return;
    const d = db(), u = me();
    if(!d || !u || typeof firebase === 'undefined') return;
    let q = readQ();
    if(!q.length) return;
    flushing = true;
    try{
      const base = { uid: u.uid, platform: platform(), device: device(),
        at: firebase.firestore.FieldValue.serverTimestamp(), clientAt: Date.now() };
      /* Calls one by one (each is its own report), app problems in batches. */
      while(q.length && dayCount() < MAX_DOCS_PER_DAY){
        const head = q[0];
        let doc, take;
        if(head.type === 'call'){
          doc = Object.assign({}, base, { type: 'call', build: head.build || build(), call: head.rec });
          take = 1;
        } else {
          const batch = [];
          for(let i = 0; i < q.length && batch.length < MAX_ENTRIES_PER_DOC; i++){
            if(q[i].type !== 'app') break;
            batch.push(q[i]);
          }
          take = batch.length || 1;
          doc = Object.assign({}, base, { type: 'app', build: build(), entries: batch.map(function(e){
            return { kind: e.kind, msg: e.msg, detail: e.detail || '', n: e.n || 1, at: e.at, last: e.last || e.at, fg: e.fg !== false, build: e.build || '' };
          }) });
        }
        await d.collection('diagReports').add(doc);
        bumpDay(1);
        q = readQ().slice(take);
        writeQ(q);
      }
    }catch(e){
      /* Kept on the phone; tried again later. Never shown, never retried in a loop. */
    }finally{
      flushing = false;
    }
  }
  try{
    document.addEventListener('visibilitychange', function(){ if(document.hidden) flush(); });
    window.addEventListener('online', function(){ schedule(3000); });
    setInterval(function(){ if(readQ().length) flush(); }, 60000);
  }catch(_){}
  return { add: add, call: call, flush: flush, scrub: scrub, platform: platform, _queue: readQ };
})();
try{ window.NalunoTech = NalunoTech; }catch(_){}

/** Record something worth knowing. Kept on the phone (last 60) and sent to
 *  Naluno's Diagnostics. Never throws. */
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
  try{ NalunoTech.add(kind, message, detail); }catch(_){}
}
try{ window.nalunoDiag = nalunoDiag; }catch(_){}

/* Catch what would otherwise only ever reach a console. */
try{
  window.addEventListener('error', function(e){
    nalunoDiag('js-error', (e && e.message) || 'script error',
      (e && e.filename ? e.filename.split('/').pop().split('?')[0] : '') + (e && e.lineno ? ':' + e.lineno : ''));
  });
  window.addEventListener('unhandledrejection', function(e){
    const r = e && e.reason;
    const msg = (r && r.message) || String(r || 'unknown');
    if(/interrupted by a new load request/i.test(msg) || (r && r.name === 'AbortError')) return;
    nalunoDiag('promise-rejection', msg, (r && r.code) || '');
  });
}catch(_){}
