/* ============================================================
   MODULE: js/media-vault.js
   Local media store (IndexedDB). Slips play from this phone
   even with no network. OWNERSHIP: blob cache only.
   ============================================================ */
const NALUNO_VAULT_DB = 'naluno-vault';
const NALUNO_VAULT_STORE = 'blobs';
const NALUNO_VAULT_MAX_BYTES = 280 * 1024 * 1024;

const vaultUrlCache = {};
let vaultDbPromise = null;

function vaultOpen(){
  if(vaultDbPromise) return vaultDbPromise;
  vaultDbPromise = new Promise(function(resolve, reject){
    try{
      const req = indexedDB.open(NALUNO_VAULT_DB, 1);
      req.onupgradeneeded = function(){
        if(!req.result.objectStoreNames.contains(NALUNO_VAULT_STORE)){
          req.result.createObjectStore(NALUNO_VAULT_STORE);
        }
      };
      req.onsuccess = function(){ resolve(req.result); };
      req.onerror = function(){ vaultDbPromise = null; reject(req.error); };
    }catch(e){
      vaultDbPromise = null;
      reject(e);
    }
  });
  return vaultDbPromise;
}

function vaultIdbReq(req){
  return new Promise(function(resolve, reject){
    req.onsuccess = function(){ resolve(req.result); };
    req.onerror = function(){ reject(req.error); };
  });
}

async function vaultPut(key, blob, meta){
  if(!key || !blob) return;
  const db = await vaultOpen();
  const rec = { blob: blob, meta: meta || {}, ts: Date.now(), bytes: blob.size || 0 };
  const tx = db.transaction(NALUNO_VAULT_STORE, 'readwrite');
  tx.objectStore(NALUNO_VAULT_STORE).put(rec, key);
  await new Promise(function(resolve, reject){
    tx.oncomplete = resolve;
    tx.onerror = function(){ reject(tx.error); };
  });
  try{ await vaultMaybeEvict(); }catch(_){}
}

async function vaultGet(key){
  if(!key) return null;
  const db = await vaultOpen();
  const rec = await vaultIdbReq(db.transaction(NALUNO_VAULT_STORE, 'readonly').objectStore(NALUNO_VAULT_STORE).get(key));
  return rec || null;
}

async function vaultObjectUrl(key){
  if(!key) return '';
  if(vaultUrlCache[key]) return vaultUrlCache[key];
  const rec = await vaultGet(key);
  if(!rec || !rec.blob) return '';
  vaultUrlCache[key] = URL.createObjectURL(rec.blob);
  return vaultUrlCache[key];
}

function vaultKeyForUrl(url){
  if(!url) return '';
  return 'url:' + String(url).split('?')[0];
}

async function vaultIngestFile(file, key){
  await vaultPut(key, file, { name: file.name || '', type: file.type || '', size: file.size || 0 });
  return vaultObjectUrl(key);
}

async function vaultIngestUrl(url, key){
  if(!url || String(url).indexOf('blob:') === 0) return url || '';
  const k = key || vaultKeyForUrl(url);
  const existing = await vaultGet(k);
  if(existing && existing.blob) return vaultObjectUrl(k);
  const res = await fetch(url, { mode:'cors', credentials:'omit' });
  if(!res.ok) throw new Error('vault fetch failed');
  const blob = await res.blob();
  await vaultPut(k, blob, { url: url, type: blob.type || '', size: blob.size || 0 });
  return vaultObjectUrl(k);
}

function vaultSyncSrc(key){
  return vaultUrlCache[key] || '';
}

async function vaultMaybeEvict(){
  const db = await vaultOpen();
  const all = await vaultIdbReq(db.transaction(NALUNO_VAULT_STORE, 'readonly').objectStore(NALUNO_VAULT_STORE).getAll());
  const keys = await vaultIdbReq(db.transaction(NALUNO_VAULT_STORE, 'readonly').objectStore(NALUNO_VAULT_STORE).getAllKeys());
  if(!all || !keys || all.length !== keys.length) return;
  let total = 0;
  const rows = all.map(function(rec, i){
    total += rec.bytes || (rec.blob && rec.blob.size) || 0;
    return { key: keys[i], ts: rec.ts || 0, bytes: rec.bytes || 0 };
  });
  if(total <= NALUNO_VAULT_MAX_BYTES) return;
  rows.sort(function(a,b){ return a.ts - b.ts; });
  const tx = db.transaction(NALUNO_VAULT_STORE, 'readwrite');
  const store = tx.objectStore(NALUNO_VAULT_STORE);
  for(let i = 0; i < rows.length && total > NALUNO_VAULT_MAX_BYTES * 0.75; i++){
    store.delete(rows[i].key);
    total -= rows[i].bytes;
    if(vaultUrlCache[rows[i].key]){
      try{ URL.revokeObjectURL(vaultUrlCache[rows[i].key]); }catch(_){}
      delete vaultUrlCache[rows[i].key];
    }
  }
}

async function vaultHydrateThread(){
  const root = document.getElementById('threadMessages');
  if(!root) return;
  const nodes = root.querySelectorAll('[data-vault-key], [data-vault-url]');
  for(let i = 0; i < nodes.length; i++){
    const el = nodes[i];
    const key = el.getAttribute('data-vault-key');
    const remote = el.getAttribute('data-vault-url');
    try{
      let url = '';
      if(key) url = await vaultObjectUrl(key);
      if(!url && remote) url = await vaultIngestUrl(remote, key || vaultKeyForUrl(remote));
      if(!url) continue;
      const media = el.querySelector('video, img');
      if(media && media.getAttribute('src') !== url) media.setAttribute('src', url);
    }catch(_){}
  }
}
