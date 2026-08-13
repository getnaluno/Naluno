/* ============================================================
   MODULE: js/crypto.js
   E2E encryption + pending video job IDB + binary helpers
   OWNERSHIP: change this domain here only.
   Scripts share globals (intentional) so load order matches the old monolith.
   ============================================================ */
/* ---------------- REAL END-TO-END ENCRYPTION (Wireline text) ----------------
   Real ECDH (P-256) key pairs — your private key is generated on-device and never
   transmitted anywhere, not even to our own servers. Two people's own private key
   combined with the OTHER person's public key mathematically derives the exact same
   shared secret on both ends (that's the actual ECDH property, not an assumption) —
   that shared secret becomes an AES-GCM key, and that's what actually encrypts each
   message. Firestore only ever stores ciphertext for real contacts' text messages;
   even a database admin reading the raw documents sees unreadable bytes.

   Honest limitations, stated plainly:
   - The private key lives in this browser's IndexedDB, this device only — it doesn't
     sync anywhere. Signing in on a new device starts a fresh key pair, and messages
     encrypted under the old one become unreadable there. Real E2E platforms solve
     multi-device key sharing with a much bigger protocol than this pass attempts.
   - Only Wireline TEXT messages are encrypted in this pass. Voice notes, moods, and
     reactions still send as before — a deliberate scoping choice, not an oversight,
     given how large this feature already is on its own.
   - If a contact hasn't generated a key yet (hasn't opened the app since this
     shipped), messages to them fall back to the old plaintext behavior automatically
     — this feature must not silently break existing conversations mid-rollout. */
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
function ensureMyKeyPair(){
  if(myKeyPairPromise) return myKeyPairPromise;
  myKeyPairPromise = (async ()=>{
    if(!window.crypto || !window.crypto.subtle || !window.indexedDB) return null;
    // 1. Try to load previously stored JWKs and re-import them into live CryptoKeys.
    try{
      const stored = await idbGet('myKeyPair');
      if(stored && stored.privateJwk && stored.publicJwk){
        const keys = await importMyKeyPairFromJwks(stored.privateJwk, stored.publicJwk);
        // Make sure our public key is still published (in case a previous write failed).
        if(currentUser && fbDb){
          fbDb.collection('users').doc(currentUser.uid).set({ publicKey: stored.publicJwk }, { merge:true }).catch(()=>{});
        }
        return keys;
      }
      // Legacy path: older builds stored the CryptoKey objects themselves. If we still
      // have usable ones, migrate them to JWKs so future loads are reliable.
      if(stored && stored.privateKey && stored.publicKey){
        try{
          const privateJwk = await crypto.subtle.exportKey('jwk', stored.privateKey);
          const publicJwk = await crypto.subtle.exportKey('jwk', stored.publicKey);
          await idbSet('myKeyPair', { privateJwk, publicJwk });
          if(currentUser && fbDb){
            fbDb.collection('users').doc(currentUser.uid).set({ publicKey: publicJwk }, { merge:true }).catch(()=>{});
          }
          return { privateKey: stored.privateKey, publicKey: stored.publicKey, privateJwk, publicJwk };
        }catch(e){ /* fall through to generate a fresh pair */ }
      }
    }catch(e){ /* nothing stored yet on this device */ }
    // 2. Generate a brand-new extractable key pair, export both halves as JWK, store them.
    try{
      const keyPair = await crypto.subtle.generateKey(
        { name:'ECDH', namedCurve:'P-256' }, true, ['deriveKey','deriveBits']
      );
      const privateJwk = await crypto.subtle.exportKey('jwk', keyPair.privateKey);
      const publicJwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
      await idbSet('myKeyPair', { privateJwk, publicJwk });
      if(currentUser && fbDb){
        fbDb.collection('users').doc(currentUser.uid).set({ publicKey: publicJwk }, { merge:true }).catch(()=>{});
      }
      return { privateKey: keyPair.privateKey, publicKey: keyPair.publicKey, privateJwk, publicJwk };
    }catch(e){ return null; } // crypto generation failed — messages fall back to plaintext
  })();
  return myKeyPairPromise;
}

let sharedKeyCache = {}; // { [theirUid]: Promise<CryptoKey|null> } — derived once per contact, reused
function getSharedAesKey(theirUid, theirPublicKeyJwk){
  if(sharedKeyCache[theirUid]) return sharedKeyCache[theirUid];
  sharedKeyCache[theirUid] = (async ()=>{
    if(!theirPublicKeyJwk) return null;
    const myKeys = await ensureMyKeyPair();
    if(!myKeys || !myKeys.privateKey) return null;
    try{
      const theirPublicKey = await crypto.subtle.importKey(
        'jwk', theirPublicKeyJwk, { name:'ECDH', namedCurve:'P-256' }, false, []
      );
      // ECDH's actual mathematical property: (my private + their public) and
      // (their private + my public) derive the identical shared secret — this is
      // what makes both directions of a conversation decryptable with one key.
      return await crypto.subtle.deriveKey(
        { name:'ECDH', public: theirPublicKey },
        myKeys.privateKey,
        { name:'AES-GCM', length:256 },
        false,
        ['encrypt','decrypt']
      );
    }catch(e){
      console.warn('[e2e] deriveKey failed for', theirUid, e);
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
  const aesKey = await getSharedAesKey(theirUid, theirPublicKeyJwk);
  if(!aesKey) return null;
  try{
    const plainBuf = await crypto.subtle.decrypt(
      { name:'AES-GCM', iv: new Uint8Array(base64ToArrayBuffer(ivB64)) },
      aesKey,
      base64ToArrayBuffer(ciphertextB64)
    );
    return new TextDecoder().decode(plainBuf);
  }catch(e){
    console.warn('[e2e] decrypt failed', e);
    return null; // wrong/missing key, or corrupted ciphertext
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

