/* ============================================================
   MODULE: js/metrics.js
   Quality instrumentation for scale (Phase 0 of scale order).
   Tracks call / live / upload outcomes. Does not block UI.
   OWNERSHIP: metrics only — other modules call trackMetric().
   ============================================================ */

const NALUNO_METRICS_KEY = 'naluno:metrics:v1';
const NALUNO_METRICS_MAX = 200;

function trackMetric(name, data){
  try{
    const row = {
      name: String(name || 'unknown'),
      t: Date.now(),
      data: data && typeof data === 'object' ? data : {},
    };
    let buf = [];
    try{ buf = JSON.parse(localStorage.getItem(NALUNO_METRICS_KEY) || '[]'); }catch(_){ buf = []; }
    if(!Array.isArray(buf)) buf = [];
    buf.push(row);
    if(buf.length > NALUNO_METRICS_MAX) buf = buf.slice(-NALUNO_METRICS_MAX);
    localStorage.setItem(NALUNO_METRICS_KEY, JSON.stringify(buf));
    if(typeof console !== 'undefined' && console.log){
      console.log('[metric]', row.name, row.data);
    }
    // Optional remote (never blocks). Only if signed in + Firestore up.
    try{
      if(typeof fbDb !== 'undefined' && fbDb && typeof currentUser !== 'undefined' && currentUser){
        // Sample: keep write volume low for mass scale
        if(Math.random() < 0.35 || row.name.indexOf('fail') >= 0 || row.name.indexOf('error') >= 0){
          fbDb.collection('metrics').add({
            name: row.name,
            data: row.data,
            uid: currentUser.uid,
            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
          }).catch(function(){});
        }
      }
    }catch(_){}
  }catch(_){}
}

function metricSummary(){
  try{
    const buf = JSON.parse(localStorage.getItem(NALUNO_METRICS_KEY) || '[]');
    if(!Array.isArray(buf)) return {};
    const out = {};
    buf.forEach(function(r){
      if(!r || !r.name) return;
      out[r.name] = (out[r.name] || 0) + 1;
    });
    return out;
  }catch(_){ return {}; }
}

/** Mark start of a timed funnel (returns token for metricEnd). */
function metricStart(name){
  const token = { name: name, t0: (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now() };
  return token;
}

function metricEnd(token, ok, extra){
  if(!token) return;
  const t1 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  const ms = Math.round(t1 - token.t0);
  trackMetric(token.name + (ok ? '_ok' : '_fail'), Object.assign({ ms: ms }, extra || {}));
  return ms;
}
