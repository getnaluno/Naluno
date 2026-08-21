/* ============================================================
   MODULE: js/metrics.js
   Quality instrumentation for scale (Phase 0 of scale order).
   Tracks call / live / upload outcomes. Does not block UI.
   OWNERSHIP: metrics only — other modules call trackMetric().
   ============================================================ */

const NALUNO_METRICS_KEY = 'naluno:metrics:v1';
const NALUNO_METRICS_MAX = 200;

let _metricBuf = null;
let _metricFlush = null;

function metricBuf(){
  if(_metricBuf) return _metricBuf;
  try{ _metricBuf = JSON.parse(localStorage.getItem(NALUNO_METRICS_KEY) || '[]'); }catch(_){ _metricBuf = []; }
  if(!Array.isArray(_metricBuf)) _metricBuf = [];
  return _metricBuf;
}

function trackMetric(name, data){
  try{
    const row = {
      name: String(name || 'unknown'),
      t: Date.now(),
      data: data && typeof data === 'object' ? data : {},
    };
    const buf = metricBuf();
    buf.push(row);
    if(buf.length > NALUNO_METRICS_MAX) buf.splice(0, buf.length - NALUNO_METRICS_MAX);
    if(!_metricFlush){
      _metricFlush = setTimeout(function(){
        _metricFlush = null;
        try{ localStorage.setItem(NALUNO_METRICS_KEY, JSON.stringify(_metricBuf || [])); }catch(_){}
      }, 900);
    }
    if(typeof console !== 'undefined' && console.log){
      console.log('[metric]', row.name, row.data);
    }
    try{
      if(typeof fbDb !== 'undefined' && fbDb && typeof currentUser !== 'undefined' && currentUser){
        const fail = row.name.indexOf('fail') >= 0 || row.name.indexOf('error') >= 0;
        // 1% of ok events, 15% of failures — Spark cannot take 100k writes.
        if((fail && Math.random() < 0.15) || (!fail && Math.random() < 0.01)){
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
    const buf = metricBuf();
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
