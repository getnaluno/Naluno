/* ============================================================
   MODULE: js/crypto.js
   E2E encryption + pending video job IDB + binary helpers
   OWNERSHIP: change this domain here only.
   Scripts share globals (intentional) so load order matches the old monolith.
   ============================================================ */
/* ---------------- Wireline text crypto (honest status) ----------------
   ECDH (P-256) + AES-GCM helpers remain for backward-compat decryption of older
   messages that still carry envelopes. CURRENT SEND PATH (wireline.js): plaintext
   is the source of truth. After key rotation / IDB eviction, ciphertext-only
   messages vanished; the product decision is that text must never disappear, so
   sendRealMessage writes { type:'text', text, encrypted:false } and never calls
   encryptMessageText. Band text follows the same policy (band-room.js).

   The helpers below are still used on the read path when an old encrypted doc is
   encountered. Do not re-enable encrypt-on-send without a multi-device key-sync
   plan and a migration that keeps plaintext readable. */
const E2E_DB_NAME = 'naluno-keys', E2E_STORE = 'keys';
function openKeyDb(){
  return new Promise((resolve, reject)=>{
    if(!window.indexedDB){ reject(new Error('no indexeddb')); return; }
    const req = indexedDB.open(E2E_DB_NAME, 1);
    req.onupgradeneeded = ()=>{ req.result.createObjectStore(E2E_STORE); };
    req.onsuccess = ()=> resolve(req.result);
    req.onerror = ()=> reject(req.error);
  });
}

/* ---------------- PENDING VIDEO JOB PERSISTENCE ----------------
   A refresh or accidental navigation used to wipe an in-progress trim/split entirely —
   everything lived only in JS memory. The beforeunload warning stops that from
   happening by accident, but doesn't help if the tab genuinely does close (a crash, a
   real navigation away, low-memory tab eviction on mobile). This is the real fix:
   the original file plus the exact trim selection gets saved to IndexedDB the moment
   extraction starts, checked for on every app load, and offered back as a one-tap
   resume — not literally continuing from 50% (that's not meaningful for a real-time
   capture process), but never losing the file pick and trim choices, which is the
   actually painful part of "starting over." Cleared the moment a job finishes, either
   by succeeding or by a normal in-session failure the person already saw a toast for. */
const PENDING_JOB_DB_NAME = 'naluno-pending-video', PENDING_JOB_STORE = 'job';
function openPendingJobDb(){
  return new Promise((resolve, reject)=>{
    if(!window.indexedDB){ reject(new Error('no indexeddb')); return; }
    const req = indexedDB.open(PENDING_JOB_DB_NAME, 1);
    req.onupgradeneeded = ()=>{ req.result.createObjectStore(PENDING_JOB_STORE); };
    req.onsuccess = ()=> resolve(req.result);
    req.onerror = ()=> reject(req.error);
  });
}
function savePendingVideoJob(job){
  return openPendingJobDb().then(db => new Promise((resolve,reject)=>{
    const tx = db.transaction(PENDING_JOB_STORE,'readwrite');
    tx.objectStore(PENDING_JOB_STORE).put(job, 'current');
    tx.oncomplete = ()=> resolve();
    tx.onerror = ()=> reject(tx.error);
  })).catch(()=>{}); // if IndexedDB is unavailable, the job just isn't recoverable after a reload — no worse than before this existed
}
function getPendingVideoJob(){
  return openPendingJobDb().then(db => new Promise((resolve)=>{
    const req = db.transaction(PENDING_JOB_STORE,'readonly').objectStore(PENDING_JOB_STORE).get('current');
    req.onsuccess = ()=> resolve(req.result || null);
    req.onerror = ()=> resolve(null);
  })).catch(()=> null);
}
function clearPendingVideoJob(){
  return openPendingJobDb().then(db => new Promise((resolve)=>{
    const tx = db.transaction(PENDING_JOB_STORE,'readwrite');
    tx.objectStore(PENDING_JOB_STORE).delete('current');
    tx.oncomplete = ()=> resolve();
    tx.onerror = ()=> resolve();
  })).catch(()=>{});
}
/* Checked once at startup — if a job survived an unexpected reload, offer it back
   rather than silently discarding it or silently auto-restarting a real, possibly
   lengthy re-encoding job without asking first. */
async function checkForPendingVideoJob(){
  const job = await getPendingVideoJob();
  if(!job) return;
  const proceed = confirm('You have an unfinished video from before this page reloaded. Resume preparing it now?');
  if(proceed){
    openTrimOverlay(job.file);
    if(job.start != null && job.end != null){
      // Restore the exact selection once the video metadata loads, rather than
      // resetting to the full range.
      const v = $('trimPreviewVideo');
      const applySelection = ()=>{
        const duration = v.duration || 1;
        $('trimStartSlider').value = Math.round((job.start/duration)*1000);
        $('trimEndSlider').value = Math.round((job.end/duration)*1000);
        updateTrimLabel();
        v.currentTime = job.start;
      };
      if(v.duration) applySelection(); else v.addEventListener('loadedmetadata', applySelection, { once:true });
    }
  } else {
    clearPendingVideoJob();
  }
}
function idbGet(key){
  return openKeyDb().then(db => new Promise((resolve,reject)=>{
    const req = db.transaction(E2E_STORE,'readonly').objectStore(E2E_STORE).get(key);
    req.onsuccess = ()=> resolve(req.result);
    req.onerror = ()=> reject(req.error);
  }));
}
function idbSet(key, value){
  return openKeyDb().then(db => new Promise((resolve,reject)=>{
    const tx = db.transaction(E2E_STORE,'readwrite');
    tx.objectStore(E2E_STORE).put(value, key);
    tx.oncomplete = ()=> resolve();
    tx.onerror = ()=> reject(tx.error);
  }));
}
function arrayBufferToBase64(buf){
  let binary = '';
  const bytes = new Uint8Array(buf);
  for(let i=0;i<bytes.byteLength;i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}
function base64ToArrayBuffer(b64){
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for(let i=0;i<binary.length;i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

let myKeyPairPromise = null;
/* Loads the existing key pair from this device if one exists, otherwise generates a
   real one and publishes only the public half. Cached as a promise so concurrent
   callers share one generation/load rather than racing to create two key pairs.

   IMPORTANT: we store JWKs in IndexedDB, never the live CryptoKey objects.
   Storing CryptoKey directly is unreliable across reloads in many browsers — the
   private key often comes back unusable, which is exactly why messages were
   failing to decrypt after a refresh or on the other device. */
async function importMyKeyPairFromJwks(privateJwk, publicJwk){
  const privateKey = await crypto.subtle.importKey(
    'jwk', privateJwk, { name:'ECDH', namedCurve:'P-256' }, true, ['deriveKey','deriveBits']
  );
  const publicKey = await crypto.subtle.importKey(
    'jwk', publicJwk, { name:'ECDH', namedCurve:'P-256' }, true, []
  );
  return { privateKey, publicKey, privateJwk, publicJwk };
}
function readKeyPairBackup(){
  try{
    const raw = localStorage.getItem('nalunoE2eKeyPair');
    if(!raw) return null;
    const o = JSON.parse(raw);
    if(o && o.privateJwk && o.publicJwk) return o;
  }catch(_){}
  return null;
}
function writeKeyPairBackup(privateJwk, publicJwk){
  try{ localStorage.setItem('nalunoE2eKeyPair', JSON.stringify({ privateJwk, publicJwk })); }catch(_){}
}
function ensureMyKeyPair(){
  if(myKeyPairPromise) return myKeyPairPromise;
  myKeyPairPromise = (async ()=>{
    if(!window.crypto || !window.crypto.subtle) return null;
    // 1. Try to load previously stored JWKs and re-import them into live CryptoKeys.
    try{
      const stored = (window.indexedDB ? await idbGet('myKeyPair') : null) || readKeyPairBackup();
      if(stored && stored.privateJwk && stored.publicJwk){
        const keys = await importMyKeyPairFromJwks(stored.privateJwk, stored.publicJwk);
        writeKeyPairBackup(stored.privateJwk, stored.publicJwk);
        return keys;
      }
      // Legacy path: older builds stored the CryptoKey objects themselves. If we still
      // have usable ones, migrate them to JWKs so future loads are reliable.
      if(stored && stored.privateKey && stored.publicKey){
        try{
          const privateJwk = await crypto.subtle.exportKey('jwk', stored.privateKey);
          const publicJwk = await crypto.subtle.exportKey('jwk', stored.publicKey);
          await idbSet('myKeyPair', { privateJwk, publicJwk });
          writeKeyPairBackup(privateJwk, publicJwk);
          if(currentUser && fbDb){
            fbDb.collection('users').doc(currentUser.uid).set({ publicKey: publicJwk }, { merge:true }).catch(()=>{});
          }
          return { privateKey: stored.privateKey, publicKey: stored.publicKey, privateJwk, publicJwk };
        }catch(e){ /* fall through to generate a fresh pair */ }
      }
    }catch(e){ /* nothing stored yet on this device */ }
    // 2. Never mint a new pair if this account already published a publicKey —
    //    that is what made old messages unreadble after a few days.
    try{
      if(currentUser && fbDb){
        const snap = await fbDb.collection('users').doc(currentUser.uid).get();
        if(snap.exists && snap.data().publicKey){
          return null;
        }
      }
    }catch(_){}
    try{
      const keyPair = await crypto.subtle.generateKey(
        { name:'ECDH', namedCurve:'P-256' }, true, ['deriveKey','deriveBits']
      );
      const privateJwk = await crypto.subtle.exportKey('jwk', keyPair.privateKey);
      const publicJwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
      try{ await idbSet('myKeyPair', { privateJwk, publicJwk }); }catch(_){}
      writeKeyPairBackup(privateJwk, publicJwk);
      if(currentUser && fbDb){
        fbDb.collection('users').doc(currentUser.uid).set({ publicKey: publicJwk }, { merge:true }).catch(()=>{});
      }
      return { privateKey: keyPair.privateKey, publicKey: keyPair.publicKey, privateJwk, publicJwk };
    }catch(e){ return null; }
  })();
  return myKeyPairPromise;
}

let sharedKeyCache = {}; // { [theirUid]: Promise<CryptoKey|null> }
function clearSharedKeyCache(theirUid){
  if(theirUid) delete sharedKeyCache[theirUid];
  else sharedKeyCache = {};
}
function getSharedAesKey(theirUid, theirPublicKeyJwk){
  if(sharedKeyCache[theirUid]) return sharedKeyCache[theirUid];
  sharedKeyCache[theirUid] = (async ()=>{
    if(!theirPublicKeyJwk){
      delete sharedKeyCache[theirUid]; // allow retry when key arrives
      return null;
    }
    const myKeys = await ensureMyKeyPair();
    if(!myKeys || !myKeys.privateKey){
      delete sharedKeyCache[theirUid];
      return null;
    }
    try{
      const theirPublicKey = await crypto.subtle.importKey(
        'jwk', theirPublicKeyJwk, { name:'ECDH', namedCurve:'P-256' }, false, []
      );
      return await crypto.subtle.deriveKey(
        { name:'ECDH', public: theirPublicKey },
        myKeys.privateKey,
        { name:'AES-GCM', length:256 },
        false,
        ['encrypt','decrypt']
      );
    }catch(e){
      console.warn('[e2e] deriveKey failed for', theirUid, e);
      delete sharedKeyCache[theirUid];
      return null;
    }
  })();
  return sharedKeyCache[theirUid];
}
async function encryptMessageText(theirUid, theirPublicKeyJwk, plaintext){
  const aesKey = await getSharedAesKey(theirUid, theirPublicKeyJwk);
  if(!aesKey) return null; // no key available — caller falls back to plaintext
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);
  const ciphertext = await crypto.subtle.encrypt({ name:'AES-GCM', iv }, aesKey, encoded);
  // Pass the Uint8Array itself (not .buffer) so we never accidentally include
  // extra bytes from a larger underlying ArrayBuffer.
  return { ciphertext: arrayBufferToBase64(ciphertext), iv: arrayBufferToBase64(iv) };
}
async function decryptMessageText(theirUid, theirPublicKeyJwk, ciphertextB64, ivB64){
  async function attempt(jwk){
    const aesKey = await getSharedAesKey(theirUid, jwk);
    if(!aesKey) return null;
    const plainBuf = await crypto.subtle.decrypt(
      { name:'AES-GCM', iv: new Uint8Array(base64ToArrayBuffer(ivB64)) },
      aesKey,
      base64ToArrayBuffer(ciphertextB64)
    );
    return new TextDecoder().decode(plainBuf);
  }
  try{
    const once = await attempt(theirPublicKeyJwk);
    if(once != null) return once;
  }catch(e){
    console.warn('[e2e] decrypt failed', e);
  }
  // Clear stuck key and retry once (stale publicKey / race on first open)
  try{
    clearSharedKeyCache(theirUid);
    let jwk = theirPublicKeyJwk;
    if(typeof fbDb !== 'undefined' && fbDb && theirUid){
      try{
        const doc = await fbDb.collection('users').doc(theirUid).get();
        if(doc.exists && doc.data().publicKey) jwk = doc.data().publicKey;
      }catch(_){}
    }
    return await attempt(jwk);
  }catch(e){
    console.warn('[e2e] decrypt retry failed', e);
    return null;
  }
}

function signalSubText(c){
  const { tier } = computeSignal(c);
  const label = signalMeta[tier].label;
  if(c.lastActivityTs == null) return label + ' · never connected';
  const elapsedMin = (Date.now() - c.lastActivityTs) / 60000;
  if(tier === 'off') return label + ' · quiet since ' + timeAgo(c.lastActivityTs);
  if(elapsedMin < 1) return label + ' · just now';
  return label + ' · last exchange ' + timeAgo(c.lastActivityTs);
}

