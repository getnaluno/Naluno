/* ============================================================
   MODULE: js/core.js
   $, toast, version check
   OWNERSHIP: change this domain here only.
   Scripts share globals (intentional) so load order matches the old monolith.
   ============================================================ */
const $ = id => document.getElementById(id);
function toast(msg){
  const t = $('toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast._t); toast._t = setTimeout(()=>t.classList.remove('show'), 1900);
}

/* ---------------- VERSION CHECK ----------------
   A running tab can't be force-reloaded silently without real risk — doing that mid-call
   or mid-message would be actively bad. Instead: bump APP_VERSION in the meta tag on
   every real deploy, and this quietly re-fetches the live index.html (bypassing cache)
   every few minutes and whenever the tab regains focus. A mismatch means a newer version
   has shipped, and it surfaces an unmissable banner rather than trying to be invisible
   about it — the person taps it whenever's actually convenient for them. */
const APP_VERSION = (document.querySelector('meta[name="app-version"]') || {}).content || '';
async function checkForUpdate(){
  try{
    const res = await fetch('./index.html?_=' + Date.now(), { cache:'no-store' });
    const html = await res.text();
    const match = html.match(/<meta name="app-version" content="([^"]+)">/);
    if(match && APP_VERSION && match[1] !== APP_VERSION){
      $('updateBanner').style.display = 'flex';
    }
  }catch(e){ /* offline or blocked — just try again on the next interval */ }
}
$('updateBannerBtn').onclick = ()=>{
  if('serviceWorker' in navigator){
    navigator.serviceWorker.getRegistrations().then(regs => regs.forEach(r=>r.update())).catch(()=>{});
  }
  location.reload();
};
setInterval(checkForUpdate, 3*60*1000);
document.addEventListener('visibilitychange', ()=>{ if(!document.hidden) checkForUpdate(); });
setTimeout(checkForUpdate, 4000); // small delay so this isn't competing with the initial page load



/* Surface fatal errors so deploys that break the app are visible */
window.addEventListener('error', function(ev){
  try{
    console.error('[naluno]', ev.message, ev.filename, ev.lineno);
    if(typeof toast === 'function' && ev.message && /\$|null|undefined|is not a function/i.test(ev.message)){
      toast('App error: ' + String(ev.message).slice(0, 80));
    }
  }catch(_){}
});
window.addEventListener('unhandledrejection', function(ev){
  try{ console.error('[naluno:promise]', ev.reason); }catch(_){}
});
console.log('[naluno] build 2026.08.21c');


function nalunoShrinkImageDataUrl(dataUrl, maxEdge, quality){
  return new Promise(function(resolve){
    if(!dataUrl || String(dataUrl).indexOf('data:image') !== 0){ resolve(dataUrl); return; }
    const img = new Image();
    img.onload = function(){
      try{
        const edge = maxEdge || 512;
        const q = quality || 0.72;
        const s = Math.min(1, edge / Math.max(img.width || 1, img.height || 1));
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round((img.width || 1) * s));
        c.height = Math.max(1, Math.round((img.height || 1) * s));
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        resolve(c.toDataURL('image/jpeg', q));
      }catch(_){ resolve(dataUrl); }
    };
    img.onerror = function(){ resolve(dataUrl); };
    img.src = dataUrl;
  });
}

function nalunoCacheKey(kind){
  try{
    const uid = (typeof currentUser !== 'undefined' && currentUser && currentUser.uid)
      || localStorage.getItem('nalunoLastUid') || '';
    return uid ? ('nalunoCache:' + kind + ':' + uid) : '';
  }catch(_){ return ''; }
}
function nalunoCacheWrite(kind, value){
  const k = nalunoCacheKey(kind);
  if(!k) return;
  try{ localStorage.setItem(k, JSON.stringify(value)); }catch(_){}
}
function nalunoCacheRead(kind){
  const k = nalunoCacheKey(kind);
  if(!k) return null;
  try{
    const raw = localStorage.getItem(k);
    return raw ? JSON.parse(raw) : null;
  }catch(_){ return null; }
}
