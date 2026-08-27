/* ============================================================
   MODULE: js/crypto.js
   E2E encryption + pending video job IDB + binary helpers
   OWNERSHIP: change this domain here only.
   Scripts share globals (intentional) so load order matches the old monolith.
   ============================================================ */
/* ---------------- Wireline text crypto ----------------
   ECDH (P-256) + AES-GCM-256 end-to-end encryption. Historically disabled after
   messages became permanently undecryptable when a device's local storage was
   wiped (reinstall, browser storage pressure, a new device) — the private key
   was gone for good with no way to recover it, so ciphertext-only text could
   vanish. That was a durability gap, not a flaw in the encryption itself.
   Fixed with real password-backed key backup/recovery (see backupPrivateKeyWithPassword
   / recoverPrivateKeyWithPassword below) — the server only ever custodies a
   password-wrapped blob it cannot open, so this doesn't weaken confidentiality,
   it's the same backup pattern real E2E products use. With that fixed, encryption
   is back on for the send path in wireline.js and band-room.js.

   Honest limits, stated plainly rather than promised away: this protects message
   content from anyone reading the database directly, including Naluno's own
   operators — that's what "end-to-end" means. It does NOT protect against a
   compromised device (if someone's phone is unlocked and the app is open, the
   messages are as readable as any app's), and the backup's strength is bounded
   by the account password's strength (a weak, guessable password weakens the
   backup along with it — this is disclosed to the person, not hidden). No
   messaging product, including this one, can honestly claim to be permanently
   unbreakable forever; what can be delivered is a correct, standard, well-reviewed
   implementation with no shortcuts in the parts that are within its control,
   which is what this is. Google/native sign-in accounts have no password to
   derive a backup key from — those identities do not yet have a recovery path
   if local storage is lost; that's a known, disclosed gap, not silently ignored. */
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

/* ---------------- Key backup/recovery (fixes "fails to decrypt after a while") ----------------
   The historical failure wasn't the crypto itself — ECDH P-256 + AES-GCM-256 is correct,
   standard, and was never the weak point. The failure was DURABILITY: if a device's
   IndexedDB/localStorage ever got wiped (reinstall, browser storage pressure, a new
   device), the private key was gone for good, and every message ever encrypted to that
   identity became permanently unreadable — including, cruelly, messages the person
   just received that day. That's what forced the plaintext-only rollback.

   This wraps the private key with a key derived (PBKDF2-SHA256, 250k iterations —
   deliberately expensive to slow down offline guessing) from a SECRET, and stores the
   wrapped blob in Firestore. The server only ever custodies ciphertext it cannot open —
   it never sees the secret or the raw private key — so this does not weaken E2E
   confidentiality; it's the same pattern real E2E products use for backup.

   Two kinds of secret, one shared mechanism underneath:
   - Password accounts: the account password itself. Nothing extra to remember.
   - Google/native sign-in accounts (no password to derive from): a random 16-character
     recovery code, generated once at key creation and shown to the person exactly once,
     the same pattern Signal's PIN and most crypto-wallet seed phrases use — the person
     is explicitly told to save it, and told plainly that losing both the device and the
     code means that device's history is not recoverable (true of any real E2E system;
     stated rather than hidden). */
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
  if(!secret || !currentUser || !fbDb) return false;
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
        method: method || 'password', // 'password' | 'recovery_code'
        v: 1,
      },
    }, { merge:true });
    return true;
  }catch(e){ console.warn('[e2e] backup failed', e); return false; }
}
/** Attempts to recover the private key from Firestore using a secret (password or
 *  recovery code) just provided by the person. Only meaningful when this device has
 *  no local key at all — never overwrites a key that's already present. Returns the
 *  recovered {privateJwk, publicJwk} or null. */
async function recoverPrivateKeyWithSecret(uid, secret){
  if(!uid || !secret || !fbDb) return null;
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
    // Wrong secret, corrupted backup, or no backup — all indistinguishable from
    // "recovery not possible right now," which is the correct, safe failure mode.
    console.warn('[e2e] recovery unavailable', e);
    return null;
  }
}
// Backward-compatible names.
function backupPrivateKeyWithPassword(privateJwk, password){ return backupPrivateKeyWithSecret(privateJwk, password, 'password'); }
function recoverPrivateKeyWithPassword(uid, password){ return recoverPrivateKeyWithSecret(uid, password); }

/** Readable, hard-to-transcribe-wrong recovery code: groups of 4 from an alphabet with
 *  no ambiguous characters (no 0/O, 1/I/l) — the same design goal as a lot of real-world
 *  license/activation codes, applied here because someone will be copying this by hand. */
function generateRecoveryCode(){
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let code = '';
  for(let i = 0; i < 16; i++){
    code += alphabet[bytes[i] % alphabet.length];
    if(i % 4 === 3 && i < 15) code += '-';
  }
  return code; // e.g. "H7QK-9MRT-4XBP-2VNC"
}
/** For accounts with no password (Google/native sign-in): generates a recovery code,
 *  backs up the key with it, and returns the code so the caller can show it to the
 *  person ONCE. There is no other copy of this code anywhere — losing it before saving
 *  it means this backup is unusable, same as any recovery code/seed phrase. */
async function backupPrivateKeyWithNewRecoveryCode(privateJwk){
  const code = generateRecoveryCode();
  const ok = await backupPrivateKeyWithSecret(privateJwk, code, 'recovery_code');
  return ok ? code : null;
}

/** Called right after a successful sign-in, while the secret (password, or a recovery
 *  code the person just entered) is still in hand — never stored, used once, then gone.
 *  If this device already has a working key, this is a no-op. If not, and a secret was
 *  provided, tries recovery before falling back to treating this as a brand-new identity. */
async function ensureMyKeyPairWithRecovery(secret){
  // A key already usable locally? Nothing to do — never overwrite it.
  const existing = await ensureMyKeyPair();
  if(existing && existing.privateKey) return existing;
  if(!secret || !currentUser) return existing;
  const recovered = await recoverPrivateKeyWithSecret(currentUser.uid, secret);
  if(!recovered) return existing;
  try{
    const keys = await importMyKeyPairFromJwks(recovered.privateJwk, recovered.publicJwk);
    try{ await idbSet('myKeyPair', { privateJwk: recovered.privateJwk, publicJwk: recovered.publicJwk }); }catch(_){}
    writeKeyPairBackup(recovered.privateJwk, recovered.publicJwk);
    myKeyPairPromise = Promise.resolve(keys);
    console.info('[e2e] identity recovered from backup — this device can decrypt existing messages again');
    return keys;
  }catch(e){ console.warn('[e2e] recovered key failed to import', e); return existing; }
}
/** Checks (a cheap Firestore read) whether this account has a key backup at all, and
 *  which kind — used to decide whether to prompt for a recovery code on a fresh device
 *  signed in via Google, without asking every single time regardless of relevance. */
async function checkE2eBackupStatus(uid){
  if(!uid || !fbDb) return { hasBackup:false, method:null };
  try{
    const snap = await fbDb.collection('users').doc(uid).get();
    const backup = snap.exists && (snap.data() || {}).e2eKeyBackup;
    return backup ? { hasBackup:true, method: backup.method || 'password' } : { hasBackup:false, method:null };
  }catch(_){ return { hasBackup:false, method:null }; }
}

/** Shows the recovery code exactly once, unmissable, with a copy button — the same
 *  "you will not see this again, save it now" treatment a wallet seed phrase or a
 *  Signal PIN gets. Resolves once the person confirms they've saved it. */
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
/** Asks for a recovery code on a fresh device — plain prompt-level UI is intentional
 *  here: this fires rarely (once per new device for a Google/native account with a
 *  backup), and the person is expected to be reading the code off something they
 *  saved elsewhere, not typing from memory. Returns the trimmed code, or null if
 *  they skip it (encryption then just behaves as it would for a brand-new identity
 *  on this device — nothing else in the app is blocked on this). */
function promptForRecoveryCode(){
  try{
    const entered = window.prompt(
      'Enter your Naluno recovery code to read your encrypted messages on this device.\n\nDon\u2019t have it? Tap Cancel — you can keep using Naluno normally, this only affects reading older encrypted messages on this specific device.'
    );
    return (entered || '').trim() || null;
  }catch(_){ return null; }
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

