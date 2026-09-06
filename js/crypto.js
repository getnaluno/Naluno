/* ============================================================
   MODULE: js/crypto.js
   E2E encryption + pending video job IDB + binary helpers
   OWNERSHIP: change this domain here only.
   Scripts share globals (intentional) so load order matches the old monolith.
   ============================================================ */
/* ---------------- Wireline text crypto ----------------
   ECDH (P-256) + AES-GCM-256 end-to-end encryption, following the same
   client-side rules WhatsApp / Signal publish (not a port of libsignal):

   1. Encrypt on this phone. The server only ever stores ciphertext.
   2. Client fan-out: one envelope for the other person, one for this phone,
      each sealed to that identity's current public key.
   3. Stamp senderPub on the packet so decrypt uses the key that sealed it,
      not whoever's publicKey happens to be published later.
   4. If the other person has no published key yet, send readable text —
      never a blob they cannot open.
   5. A phone that lost its private key mints a new identity and publishes it.
      Old envelopes stay locked (honest fail). New messages work.

   HKDF-SHA256 wraps the ECDH secret on new envelopes (kdf:'hkdf'). Older
   envelopes used the raw bits; decrypt tries both.

   Honest limits: this protects content from anyone reading the database,
   including Naluno. It does not protect a compromised unlocked phone.
   Google/native accounts use a one-time recovery code for backup. */
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

/* ---------------- PENDING VIDEO JOB PERSISTENCE ---------------- */
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
  })).catch(()=>{});
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
async function checkForPendingVideoJob(){
  const job = await getPendingVideoJob();
  if(!job) return;
  const proceed = confirm('You have an unfinished video from before this page reloaded. Resume preparing it now?');
  if(proceed){
    openTrimOverlay(job.file);
    if(job.start != null && job.end != null){
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
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
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
async function persistMyKeyPair(privateJwk, publicJwk){
  try{ await idbSet('myKeyPair', { privateJwk, publicJwk }); }catch(_){}
  writeKeyPairBackup(privateJwk, publicJwk);
}
/** Read whatever this phone already has. Never mints. Recovery must run before mint. */
async function loadLocalKeyPair(){
  if(!window.crypto || !window.crypto.subtle) return null;
  try{
    const stored = (window.indexedDB ? await idbGet('myKeyPair') : null) || readKeyPairBackup();
    if(stored && stored.privateJwk && stored.publicJwk){
      const keys = await importMyKeyPairFromJwks(stored.privateJwk, stored.publicJwk);
      writeKeyPairBackup(stored.privateJwk, stored.publicJwk);
      return keys;
    }
    if(stored && stored.privateKey && stored.publicKey){
      try{
        const privateJwk = await crypto.subtle.exportKey('jwk', stored.privateKey);
        const publicJwk = await crypto.subtle.exportKey('jwk', stored.publicKey);
        await persistMyKeyPair(privateJwk, publicJwk);
        return { privateKey: stored.privateKey, publicKey: stored.publicKey, privateJwk, publicJwk };
      }catch(_){}
    }
  }catch(_){}
  return null;
}
async function mintAndPublishKeyPair(){
  const keyPair = await crypto.subtle.generateKey(
    { name:'ECDH', namedCurve:'P-256' }, true, ['deriveKey','deriveBits']
  );
  const privateJwk = await crypto.subtle.exportKey('jwk', keyPair.privateKey);
  const publicJwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
  await persistMyKeyPair(privateJwk, publicJwk);
  if(typeof currentUser !== 'undefined' && currentUser && typeof fbDb !== 'undefined' && fbDb){
    fbDb.collection('users').doc(currentUser.uid).set({
      publicKey: publicJwkCompact(publicJwk),
      publicKeyUpdatedAt: Date.now(),
      e2eRotatedAt: Date.now(),
    }, { merge:true }).catch(function(){});
  }
  return { privateKey: keyPair.privateKey, publicKey: keyPair.publicKey, privateJwk, publicJwk };
}
function ensureMyKeyPair(){
  if(myKeyPairPromise) return myKeyPairPromise;
  myKeyPairPromise = (async ()=>{
    if(!window.crypto || !window.crypto.subtle) return null;
    const local = await loadLocalKeyPair();
    if(local && local.privateKey){
      try{ publishMyPublicKey(); }catch(_){}
      return local;
    }
    try{
      return await mintAndPublishKeyPair();
    }catch(e){ return null; }
  })();
  return myKeyPairPromise;
}

let sharedKeyCache = {};
function sharedCacheKey(theirUid, theirPublicKeyJwk, kdf){
  const x = theirPublicKeyJwk && theirPublicKeyJwk.x ? String(theirPublicKeyJwk.x).slice(0, 24) : 'none';
  return String(theirUid || '') + ':' + x + ':' + String(kdf || 'raw');
}
function clearSharedKeyCache(theirUid){
  if(!theirUid){ sharedKeyCache = {}; return; }
  const prefix = String(theirUid) + ':';
  Object.keys(sharedKeyCache).forEach(function(k){
    if(k === theirUid || k.indexOf(prefix) === 0) delete sharedKeyCache[k];
  });
}

function publicJwkCompact(jwk){
  if(!jwk || !jwk.x || !jwk.y) return null;
  return { kty: 'EC', crv: jwk.crv || 'P-256', x: jwk.x, y: jwk.y };
}

const _publicKeyMem = {};
async function fetchUserPublicKey(uid, force){
  if(!uid) return null;
  if(typeof currentUser !== 'undefined' && currentUser && uid === currentUser.uid){
    const mine = await ensureMyKeyPair();
    return mine && mine.publicJwk ? publicJwkCompact(mine.publicJwk) : null;
  }
  const hit = _publicKeyMem[uid];
  if(!force && hit && hit.jwk && (Date.now() - hit.at) < 20000) return hit.jwk;
  let jwk = null;
  if(typeof fbDb !== 'undefined' && fbDb){
    try{
      const doc = await fbDb.collection('users').doc(uid).get();
      if(doc.exists && doc.data() && doc.data().publicKey) jwk = publicJwkCompact(doc.data().publicKey);
    }catch(_){}
  }
  if(!jwk && typeof contacts !== 'undefined' && contacts){
    const c = contacts.find(function(x){ return x && x.firebaseUid === uid; });
    if(c && c.publicKey) jwk = publicJwkCompact(c.publicKey);
  }
  if(jwk){
    _publicKeyMem[uid] = { jwk: jwk, at: Date.now() };
    try{
      if(typeof contacts !== 'undefined' && contacts){
        const c = contacts.find(function(x){ return x && x.firebaseUid === uid; });
        if(c) c.publicKey = jwk;
      }
    }catch(_){}
  }
  return jwk;
}
async function publishMyPublicKey(){
  try{
    const keys = await loadLocalKeyPair();
    if(!keys || !keys.publicJwk || typeof currentUser === 'undefined' || !currentUser || typeof fbDb === 'undefined' || !fbDb) return false;
    await fbDb.collection('users').doc(currentUser.uid).set({
      publicKey: publicJwkCompact(keys.publicJwk),
      publicKeyUpdatedAt: Date.now(),
    }, { merge: true });
    return true;
  }catch(_){ return false; }
}

const NALUNO_KDF_HKDF = 'hkdf';
const NALUNO_KDF_RAW = 'raw';
const NALUNO_HKDF_INFO = 'naluno-wireline-v1';

async function hkdfAesKey(ikmBits){
  const hkdfKey = await crypto.subtle.importKey('raw', ikmBits, 'HKDF', false, ['deriveBits']);
  const out = await crypto.subtle.deriveBits(
    { name:'HKDF', hash:'SHA-256', salt: new Uint8Array(32), info: new TextEncoder().encode(NALUNO_HKDF_INFO) },
    hkdfKey,
    256
  );
  return crypto.subtle.importKey('raw', out, { name:'AES-GCM', length:256 }, false, ['encrypt','decrypt']);
}
async function deriveAesFromEcdh(theirPublicKeyJwk, kdf){
  const myKeys = await ensureMyKeyPair();
  if(!myKeys || !myKeys.privateKey || !theirPublicKeyJwk || !theirPublicKeyJwk.x) return null;
  const theirPublicKey = await crypto.subtle.importKey(
    'jwk', publicJwkCompact(theirPublicKeyJwk), { name:'ECDH', namedCurve:'P-256' }, false, []
  );
  let bits;
  try{
    bits = await crypto.subtle.deriveBits(
      { name:'ECDH', public: theirPublicKey },
      myKeys.privateKey,
      256
    );
  }catch(_){
    if(kdf === NALUNO_KDF_HKDF) return null;
    return crypto.subtle.deriveKey(
      { name:'ECDH', public: theirPublicKey },
      myKeys.privateKey,
      { name:'AES-GCM', length:256 },
      false,
      ['encrypt','decrypt']
    );
  }
  if(kdf === NALUNO_KDF_HKDF){
    try{ return await hkdfAesKey(bits); }catch(_){ return null; }
  }
  return crypto.subtle.importKey('raw', bits, { name:'AES-GCM', length:256 }, false, ['encrypt','decrypt']);
}

function getSharedAesKey(theirUid, theirPublicKeyJwk, kdf){
  const ck = sharedCacheKey(theirUid, theirPublicKeyJwk, kdf);
  if(sharedKeyCache[ck]) return sharedKeyCache[ck];
  sharedKeyCache[ck] = (async function(){
    if(!theirPublicKeyJwk){
      delete sharedKeyCache[ck];
      return null;
    }
    try{
      const key = await deriveAesFromEcdh(theirPublicKeyJwk, kdf || NALUNO_KDF_RAW);
      if(!key){ delete sharedKeyCache[ck]; return null; }
      return key;
    }catch(e){
      console.warn('[e2e] deriveKey failed for', theirUid, e);
      delete sharedKeyCache[ck];
      return null;
    }
  })();
  return sharedKeyCache[ck];
}

/* ---------------- Key backup/recovery ---------------- */
const E2E_BACKUP_ITERATIONS = 250000;
async function deriveWrappingKey(secret, saltBytes){
  const baseKey = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), { name:'PBKDF2' }, false, ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name:'PBKDF2', salt: saltBytes, iterations: E2E_BACKUP_ITERATIONS, hash:'SHA-256' },
    baseKey,
    { name:'AES-GCM', length:256 },
    false,
    ['encrypt','decrypt']
  );
}
async function backupPrivateKeyWithSecret(privateJwk, secret, method){
  if(!secret || typeof currentUser === 'undefined' || !currentUser || typeof fbDb === 'undefined' || !fbDb) return false;
  try{
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const wrapKey = await deriveWrappingKey(secret, salt);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const plaintext = new TextEncoder().encode(JSON.stringify(privateJwk));
    const wrapped = await crypto.subtle.encrypt({ name:'AES-GCM', iv }, wrapKey, plaintext);
    await fbDb.collection('users').doc(currentUser.uid).set({
      e2eKeyBackup: {
        wrapped: arrayBufferToBase64(wrapped),
        iv: arrayBufferToBase64(iv),
        salt: arrayBufferToBase64(salt),
        iterations: E2E_BACKUP_ITERATIONS,
        method: method || 'password',
        v: 1,
      },
    }, { merge:true });
    return true;
  }catch(e){ console.warn('[e2e] backup failed', e); return false; }
}
async function recoverPrivateKeyWithSecret(uid, secret){
  if(!uid || !secret || typeof fbDb === 'undefined' || !fbDb) return null;
  try{
    const snap = await fbDb.collection('users').doc(uid).get();
    if(!snap.exists) return null;
    const d = snap.data() || {};
    const backup = d.e2eKeyBackup;
    const publicJwk = d.publicKey;
    if(!backup || !backup.wrapped || !publicJwk) return null;
    const salt = new Uint8Array(base64ToArrayBuffer(backup.salt));
    const wrapKey = await crypto.subtle.deriveKey(
      { name:'PBKDF2', salt, iterations: backup.iterations || E2E_BACKUP_ITERATIONS, hash:'SHA-256' },
      await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name:'PBKDF2' }, false, ['deriveKey']),
      { name:'AES-GCM', length:256 },
      false,
      ['decrypt']
    );
    const plainBuf = await crypto.subtle.decrypt(
      { name:'AES-GCM', iv: new Uint8Array(base64ToArrayBuffer(backup.iv)) },
      wrapKey,
      base64ToArrayBuffer(backup.wrapped)
    );
    const privateJwk = JSON.parse(new TextDecoder().decode(plainBuf));
    return { privateJwk, publicJwk };
  }catch(e){
    console.warn('[e2e] recovery unavailable', e);
    return null;
  }
}
function backupPrivateKeyWithPassword(privateJwk, password){ return backupPrivateKeyWithSecret(privateJwk, password, 'password'); }
function recoverPrivateKeyWithPassword(uid, password){ return recoverPrivateKeyWithSecret(uid, password); }

function generateRecoveryCode(){
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let code = '';
  for(let i = 0; i < 16; i++){
    code += alphabet[bytes[i] % alphabet.length];
    if(i % 4 === 3 && i < 15) code += '-';
  }
  return code;
}
async function backupPrivateKeyWithNewRecoveryCode(privateJwk){
  const code = generateRecoveryCode();
  const ok = await backupPrivateKeyWithSecret(privateJwk, code, 'recovery_code');
  return ok ? code : null;
}

async function ensureMyKeyPairWithRecovery(secret){
  const existing = await loadLocalKeyPair();
  if(existing && existing.privateKey){
    myKeyPairPromise = Promise.resolve(existing);
    return existing;
  }
  if(!secret || typeof currentUser === 'undefined' || !currentUser){
    myKeyPairPromise = null;
    return ensureMyKeyPair();
  }
  const recovered = await recoverPrivateKeyWithSecret(currentUser.uid, secret);
  if(!recovered){
    myKeyPairPromise = null;
    return ensureMyKeyPair();
  }
  try{
    const keys = await importMyKeyPairFromJwks(recovered.privateJwk, recovered.publicJwk);
    await persistMyKeyPair(recovered.privateJwk, recovered.publicJwk);
    myKeyPairPromise = Promise.resolve(keys);
    try{ publishMyPublicKey(); }catch(_){}
    console.info('[e2e] identity recovered from backup — this device can decrypt existing messages again');
    return keys;
  }catch(e){
    console.warn('[e2e] recovered key failed to import', e);
    myKeyPairPromise = null;
    return ensureMyKeyPair();
  }
}
async function checkE2eBackupStatus(uid){
  if(!uid || typeof fbDb === 'undefined' || !fbDb) return { hasBackup:false, method:null };
  try{
    const snap = await fbDb.collection('users').doc(uid).get();
    const backup = snap.exists && (snap.data() || {}).e2eKeyBackup;
    return backup ? { hasBackup:true, method: backup.method || 'password' } : { hasBackup:false, method:null };
  }catch(_){ return { hasBackup:false, method:null }; }
}

function showRecoveryCodeModal(code){
  return new Promise(function(resolve){
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;z-index:900;background:rgba(5,6,10,.92);display:flex;align-items:center;justify-content:center;padding:24px;';
    overlay.innerHTML = `
      <div style="background:#12141F;border:1px solid rgba(124,255,178,.35);border-radius:20px;padding:26px 22px;max-width:380px;width:100%;text-align:center;">
        <div style="font-family:var(--font-futuristic,sans-serif);font-size:17px;color:#fff;margin-bottom:8px;">Save your recovery code</div>
        <div style="font-family:var(--font-mono,monospace);font-size:12.5px;color:rgba(255,255,255,.65);line-height:1.5;margin-bottom:18px;">
          This is the only way to read your encrypted messages again if you sign in on a new device or reinstall.
          Naluno cannot recover it for you — there is no other copy anywhere.
        </div>
        <div id="nalunoRecoveryCodeText" style="font-family:var(--font-mono,monospace);font-size:18px;letter-spacing:.06em;color:#7CFFB2;background:rgba(124,255,178,.08);border:1px solid rgba(124,255,178,.25);border-radius:12px;padding:14px 10px;margin-bottom:16px;word-break:break-all;">${code}</div>
        <button type="button" id="nalunoRecoveryCopyBtn" style="width:100%;padding:12px;border-radius:999px;border:1px solid rgba(124,255,178,.4);background:transparent;color:#7CFFB2;font-family:var(--font-mono,monospace);font-size:13px;margin-bottom:10px;cursor:pointer;">Copy code</button>
        <button type="button" id="nalunoRecoveryDoneBtn" style="width:100%;padding:12px;border-radius:999px;border:none;background:#7CFFB2;color:#0D0F17;font-family:var(--font-mono,monospace);font-size:13px;font-weight:600;cursor:pointer;">I've saved it</button>
      </div>`;
    document.body.appendChild(overlay);
    const copyBtn = overlay.querySelector('#nalunoRecoveryCopyBtn');
    const doneBtn = overlay.querySelector('#nalunoRecoveryDoneBtn');
    if(copyBtn) copyBtn.onclick = function(){
      try{
        if(navigator.clipboard && navigator.clipboard.writeText){
          navigator.clipboard.writeText(code);
          copyBtn.textContent = 'Copied';
          setTimeout(function(){ copyBtn.textContent = 'Copy code'; }, 1500);
        }
      }catch(_){}
    };
    if(doneBtn) doneBtn.onclick = function(){
      overlay.remove();
      resolve();
    };
  });
}
function promptForRecoveryCode(){
  try{
    const entered = window.prompt(
      'Enter your Naluno recovery code to read your encrypted messages on this device.\n\nDon\u2019t have it? Tap Cancel — you can keep using Naluno normally, this only affects reading older encrypted messages on this specific device.'
    );
    return (entered || '').trim() || null;
  }catch(_){ return null; }
}

async function encryptMessageText(theirUid, theirPublicKeyJwk, plaintext, kdfName){
  const kdf = kdfName || NALUNO_KDF_HKDF;
  const aesKey = await getSharedAesKey(theirUid, theirPublicKeyJwk, kdf);
  if(!aesKey) return null;
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);
  const ciphertext = await crypto.subtle.encrypt({ name:'AES-GCM', iv }, aesKey, encoded);
  return { ciphertext: arrayBufferToBase64(ciphertext), iv: arrayBufferToBase64(iv), kdf: kdf };
}
async function decryptMessageText(theirUid, theirPublicKeyJwk, ciphertextB64, ivB64, kdfName){
  const order = [];
  const first = kdfName || NALUNO_KDF_RAW;
  order.push(first);
  if(first !== NALUNO_KDF_HKDF) order.push(NALUNO_KDF_HKDF);
  if(first !== NALUNO_KDF_RAW) order.push(NALUNO_KDF_RAW);
  async function attempt(jwk, kdf){
    const aesKey = await getSharedAesKey(theirUid, jwk, kdf);
    if(!aesKey) return null;
    const plainBuf = await crypto.subtle.decrypt(
      { name:'AES-GCM', iv: new Uint8Array(base64ToArrayBuffer(ivB64)) },
      aesKey,
      base64ToArrayBuffer(ciphertextB64)
    );
    return new TextDecoder().decode(plainBuf);
  }
  for(let i = 0; i < order.length; i++){
    try{
      const once = await attempt(theirPublicKeyJwk, order[i]);
      if(once != null) return once;
    }catch(_){}
  }
  try{
    clearSharedKeyCache(theirUid);
    let jwk = theirPublicKeyJwk;
    if(typeof fbDb !== 'undefined' && fbDb && theirUid){
      try{
        const doc = await fbDb.collection('users').doc(theirUid).get();
        if(doc.exists && doc.data().publicKey) jwk = doc.data().publicKey;
      }catch(_){}
    }
    for(let i = 0; i < order.length; i++){
      try{
        const again = await attempt(jwk, order[i]);
        if(again != null) return again;
      }catch(_){}
    }
  }catch(e){
    console.warn('[e2e] decrypt retry failed', e);
  }
  return null;
}

/** WhatsApp / Signal rule: encrypt on this phone, for each recipient's current
 *  public key (client fanout). We also seal a copy to ourselves so this thread
 *  still opens here. If the other person has no published key yet, send
 *  readable text — never a blob they cannot open. */
async function nalunoSealText(plaintext, peerUid){
  if(plaintext == null) plaintext = '';
  const mine = await ensureMyKeyPair();
  if(!mine || !mine.publicJwk || typeof currentUser === 'undefined' || !currentUser){
    return { encrypted: false, text: plaintext };
  }
  const peerJwk = peerUid ? await fetchUserPublicKey(peerUid, true) : null;
  const senderPub = publicJwkCompact(mine.publicJwk);
  const envelopes = {};
  if(peerJwk){
    const forPeer = await encryptMessageText(peerUid, peerJwk, plaintext, NALUNO_KDF_HKDF);
    if(forPeer){
      forPeer.senderPub = senderPub;
      envelopes[peerUid] = forPeer;
    }
  }
  const forMe = await encryptMessageText(currentUser.uid, mine.publicJwk, plaintext, NALUNO_KDF_HKDF);
  if(forMe){
    forMe.senderPub = senderPub;
    envelopes[currentUser.uid] = forMe;
  }
  if(!peerUid || !envelopes[peerUid]){
    return { encrypted: false, text: plaintext };
  }
  return {
    encrypted: true,
    text: null,
    envelopes: envelopes,
    ciphertext: envelopes[peerUid].ciphertext,
    iv: envelopes[peerUid].iv,
    kdf: NALUNO_KDF_HKDF,
    senderPub: senderPub,
  };
}

const NALUNO_SEAL_FAIL = 'Couldn\u2019t read this on this phone. Ask them to send it again.';

async function nalunoOpenSealed(m, peerContact){
  if(!m) return '';
  if(!m.encrypted) return m.text != null ? m.text : '';
  const myUid = typeof currentUser !== 'undefined' && currentUser ? currentUser.uid : null;
  const env = (m.envelopes && myUid && m.envelopes[myUid]) || null;
  const ct = env ? env.ciphertext : m.ciphertext;
  const iv = env ? env.iv : m.iv;
  if(!ct || !iv) return m.text != null ? m.text : null;
  const kdf = (env && env.kdf) || m.kdf || NALUNO_KDF_RAW;
  const sender = m.from || m.fromUid || (peerContact && peerContact.firebaseUid);
  const tries = [];
  function addTry(uid, jwk){
    if(!jwk || !jwk.x) return;
    tries.push({ uid: uid, jwk: publicJwkCompact(jwk) });
  }
  addTry(sender, env && env.senderPub);
  addTry(sender, m.senderPub);
  if(sender === myUid){
    try{
      const mine = await ensureMyKeyPair();
      if(mine) addTry(myUid, mine.publicJwk);
    }catch(_){}
  }
  const peerUid = peerContact && peerContact.firebaseUid;
  if(peerUid){
    addTry(peerUid, peerContact.publicKey);
    try{ addTry(peerUid, await fetchUserPublicKey(peerUid)); }catch(_){}
  }
  if(sender && sender !== myUid){
    try{ addTry(sender, await fetchUserPublicKey(sender)); }catch(_){}
  }
  const seen = {};
  for(let i = 0; i < tries.length; i++){
    const t = tries[i];
    const k = sharedCacheKey(t.uid, t.jwk, kdf);
    if(seen[k]) continue;
    seen[k] = true;
    try{
      const p = await decryptMessageText(t.uid, t.jwk, ct, iv, kdf);
      if(p != null) return p;
    }catch(_){}
  }
  return m.text != null ? m.text : null;
}

window.fetchUserPublicKey = fetchUserPublicKey;
window.publishMyPublicKey = publishMyPublicKey;
window.nalunoSealText = nalunoSealText;
window.nalunoOpenSealed = nalunoOpenSealed;
window.NALUNO_SEAL_FAIL = NALUNO_SEAL_FAIL;
window.publicJwkCompact = publicJwkCompact;
window.NALUNO_KDF_HKDF = NALUNO_KDF_HKDF;

function signalSubText(c){
  const { tier } = computeSignal(c);
  const label = signalMeta[tier].label;
  if(c.lastActivityTs == null) return label + ' · never connected';
  const elapsedMin = (Date.now() - c.lastActivityTs) / 60000;
  if(tier === 'off') return label + ' · quiet since ' + timeAgo(c.lastActivityTs);
  if(elapsedMin < 1) return label + ' · just now';
  return label + ' · last exchange ' + timeAgo(c.lastActivityTs);
}
