/* ============================================================
   MODULE: js/auth.js
   Firebase Auth, profile load, connections, threads listeners
   OWNERSHIP: change this domain here only.
   Scripts share globals (intentional) so load order matches the old monolith.
   ============================================================ */
/* ---------------- REAL BACKEND: Firebase Auth + Firestore ----------------
   Identity has to be real before anything built on it (messaging, presence between
   real people, calls) can be. This is Phase 1: sign-in and a real Callsign profile.
   Contacts, Wireline, and Band still run on local/simulated data — see README. */
let fbApp = null, fbAuth = null, fbDb = null, currentUser = null;
let lastRemoteHeartbeat = 0;
let authListenersBound = false;
// FIX ("Callsign should be the landing page after signing in"): distinguishes
// a fresh, explicit sign-in from Firebase silently restoring an existing
// session on a normal app reopen — only the former should override wherever
// the person was and land on Callsign; the latter should keep behaving like
// the nav-state restore feature already does (resume where you left off).
let nalunoJustSignedIn = false;

/* 28n: the PNG splash is replaced by the drawing logo. Auth still
   resolves in the background; the gate only yields after ~3 seconds. */
const NALUNO_ENTRY_MS = 3000;
function nalunoHideNativeSplash(){
  try{
    const C = window.Capacitor;
    const p = C && ((C.Plugins && C.Plugins.SplashScreen) || C.SplashScreen);
    if(p && p.hide) p.hide({ fadeOutDuration: 0 });
  }catch(_){}
}
function nalunoRunAfterEntry(fn){
  if(typeof fn !== 'function') return;
  const t0 = window.__nalunoEntryT0 || Date.now();
  const wait = Math.max(0, NALUNO_ENTRY_MS - (Date.now() - t0));
  setTimeout(function(){ try{ fn(); }catch(e){} }, wait);
}
function nalunoEnterApp(){
  nalunoHideNativeSplash();
  nalunoRunAfterEntry(function(){
    document.body.classList.remove('naluno-gated');
    const app = document.getElementById('app');
    if(app) app.style.visibility = '';
    const gate = $('authGate');
    if(!gate) return;
    gate.classList.add('naluno-entry-out');
    setTimeout(function(){
      gate.classList.remove('active');
      gate.classList.remove('naluno-entry-out');
    }, 450);
  });
}
function nalunoShowSignIn(){
  nalunoHideNativeSplash();
  nalunoRunAfterEntry(function(){
    try{
      const loading = $('authGateLoading');
      const form = $('authGateForm');
      if(loading) loading.style.display = 'none';
      if(form) form.style.display = 'flex';
      document.body.classList.add('naluno-gated');
      const gate = $('authGate');
      if(gate) gate.classList.add('active');
    }catch(_){}
  });
}
window.nalunoEnterApp = nalunoEnterApp;
window.nalunoShowSignIn = nalunoShowSignIn;

function firebaseReady(){
  return typeof firebase !== 'undefined'
    && typeof firebaseConfig !== 'undefined'
    && firebaseConfig.apiKey && firebaseConfig.apiKey !== 'YOUR_API_KEY';
}
function initFirebaseApp(){
  if(fbAuth) return true;
  if(!firebaseReady()) return false;
  try{
    if(firebase.apps && firebase.apps.length){
      fbApp = firebase.app();
    } else {
      fbApp = firebase.initializeApp(firebaseConfig);
    }
    fbAuth = firebase.auth();
    // Explicitly request durable local persistence so a successful sign-in survives
    // page reloads, browser restarts, and the service-worker shell. Without this some
    // environments (storage partitioning, certain mobile browsers, or when IndexedDB
    // is flaky) silently fall back to session-only, which makes every open look like
    // a fresh start and skips the remembered-user path.
    fbAuth.setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch(e=>{
      console.warn('[Naluno auth] could not set LOCAL persistence:', e);
    });
    fbDb = firebase.firestore();
    // This was never turned on before, and it's very likely the root cause behind two
    // separate complaints at once: Frequencies taking 2-3 seconds to appear on every
    // refresh (no local cache to paint from — every load had to wait on the network,
    // full stop), and Callsign inconsistently falling back to default values (a
    // one-shot read racing against network timing has no safety margin without a
    // cache to fall back on). With this enabled, a repeat visit paints instantly from
    // IndexedDB, then quietly reconciles with the server in the background.
    fbDb.enablePersistence({ synchronizeTabs: true }).catch(()=>{
      // Fails in a few known cases (multiple tabs without multi-tab support in an
      // older browser, private/incognito browsing, no IndexedDB) — the app still
      // works perfectly fine without it, just without the instant-repaint benefit.
    });
    return true;
  }catch(e){
    console.error('Firebase init failed:', e);
    fbAuth = null;
    return false;
  }
}

function injectFirebaseScripts(){
  if(typeof firebase !== 'undefined') return;
  if(window.__nalunoFbInject) return;
  window.__nalunoFbInject = true;
  const files = [
    'firebase-app-compat.js',
    'firebase-auth-compat.js',
    'firebase-firestore-compat.js',
    'firebase-messaging-compat.js',
  ];
  const bases = [
    'https://www.gstatic.com/firebasejs/10.7.1/',
    'https://www.gstatic.com/firebasejs/10.12.5/',
  ];
  function loadFrom(baseIndex){
    if(typeof firebase !== 'undefined') return;
    if(baseIndex >= bases.length) return;
    const base = bases[baseIndex];
    let left = files.length;
    let failed = false;
    files.forEach(function(name){
      const s = document.createElement('script');
      s.src = base + name;
      s.async = false;
      s.onload = function(){
        left--;
        if(left <= 0 && !failed) initFirebaseApp();
      };
      s.onerror = function(){
        failed = true;
        loadFrom(baseIndex + 1);
      };
      document.head.appendChild(s);
    });
  }
  loadFrom(0);
}

initFirebaseApp();
if(!fbAuth) injectFirebaseScripts();

function authStatus(msg, isError){
  const el = $('authGateStatus');
  if(el){
    el.textContent = msg;
    el.style.color = isError ? 'var(--red)' : 'var(--text-dim)';
  }
  console.log('[Naluno auth]', msg);
}

/* Handle + password (no email required).
   Firebase still needs an email-shaped identifier — we map handle → stable address.
   Domain must be a valid public TLD (.local is rejected by Firebase Auth). */
const NALUNO_HANDLE_EMAIL_DOMAIN = 'users.getnaluno.com';
function normalizeAuthHandle(raw){
  return String(raw || '')
    .trim()
    .replace(/^@+/, '')
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '')
    .slice(0, 24);
}
function handleToAuthEmail(handle){
  const h = normalizeAuthHandle(handle);
  if(!h || h.length < 3) return null;
  return h + '@' + NALUNO_HANDLE_EMAIL_DOMAIN;
}

function isNativeShell(){
  try{
    return !!(window.Capacitor && (
      (typeof window.Capacitor.isNativePlatform === 'function' && window.Capacitor.isNativePlatform()) ||
      window.Capacitor.platform === 'android' ||
      window.Capacitor.platform === 'ios'
    ));
  }catch(e){ return false; }
}

function getNativeGoogleAuth(){
  try{
    if(window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.GoogleAuth){
      return window.Capacitor.Plugins.GoogleAuth;
    }
  }catch(e){}
  return null;
}

async function nativeGoogleSignIn(){
  const GoogleAuth = getNativeGoogleAuth();
  if(!GoogleAuth){
    throw new Error('GoogleAuth plugin not installed in the Android shell');
  }
  // serverClientId must be the Web client ID (not Android client ID).
  const webClientId = (typeof GOOGLE_WEB_CLIENT_ID !== 'undefined' && GOOGLE_WEB_CLIENT_ID && !String(GOOGLE_WEB_CLIENT_ID).includes('YOUR_'))
    ? GOOGLE_WEB_CLIENT_ID
    : null;
  try{
    if(typeof GoogleAuth.initialize === 'function'){
      await GoogleAuth.initialize({
        clientId: webClientId || undefined,
        scopes: ['profile', 'email'],
        grantOfflineAccess: true,
      });
    }
  }catch(e){ /* already initialized is fine */ }

  const googleUser = await GoogleAuth.signIn();
  const idToken = googleUser && googleUser.authentication && googleUser.authentication.idToken;
  if(!idToken){
    throw new Error('Native Google sign-in returned no idToken');
  }
  const credential = firebase.auth.GoogleAuthProvider.credential(idToken);
  const result = await fbAuth.signInWithCredential(credential);
  return result;
}

$('googleSignInBtn').onclick = async ()=>{
  if(!fbAuth){ try{ injectFirebaseScripts(); }catch(_){} initFirebaseApp(); }
  if(!fbAuth){ authStatus('Connecting to sign-in… tap again in a moment.', true); return; }
  nalunoJustSignedIn = true;

  // Capacitor: use native Google Sign-In → Firebase credential (no Chrome redirect).
  if(isNativeShell()){
    authStatus('Opening Google sign-in…');
    try{
      const result = await nativeGoogleSignIn();
      authStatus('Signed in as ' + (result.user.displayName || result.user.email));
    }catch(e){
      const msg = (e && (e.message || e.errorMessage || e.code)) || String(e);
      if(/cancel|12501|popup_closed/i.test(msg)){
        authStatus('Google sign-in was cancelled — try again, or use email + password.', true);
      } else if(/plugin not installed|GoogleAuth/i.test(msg)){
        authStatus('Native Google plugin not ready — rebuild the Android shell (see GOOGLE-AUTH-SETUP.md), or use email + password.', true);
      } else if(/10\b|DEVELOPER_ERROR|ApiException: 10/i.test(msg)){
        authStatus('Google config error (code 10) — add your SHA-1 in Firebase and set the Web client ID. See GOOGLE-AUTH-SETUP.md', true);
      } else {
        authStatus('Google sign-in failed: ' + msg, true);
      }
    }
    return;
  }

  const provider = new firebase.auth.GoogleAuthProvider();
  authStatus('Trying popup sign-in…');
  // Browser/PWA: popup is the reliable path (no cross-domain redirect handoff).
  fbAuth.signInWithPopup(provider).then(result=>{
    authStatus('Popup sign-in completed — signed in as ' + (result.user.displayName || result.user.email));
  }).catch(e=>{
    const popupCantOpen = e.code === 'auth/popup-blocked' || e.code === 'auth/operation-not-supported-in-this-environment';
    if(popupCantOpen){
      authStatus('Popup blocked — falling back to redirect…');
      fbAuth.signInWithRedirect(provider).catch(e2=>{ authStatus(e2.code + ': ' + e2.message, true); });
    } else if(e.code === 'auth/popup-closed-by-user' || e.code === 'auth/cancelled-popup-request'){
      authStatus('Sign-in window was closed before finishing — tap the button to try again.', true);
    } else {
      authStatus(e.code + ': ' + e.message, true);
    }
  });
};

/* Email/password sidesteps the entire OAuth popup/redirect problem — no cross-window
   handoff, no cross-domain storage, nothing for a browser's privacy features or a fast
   auto-selecting account picker to race against. It's the reliable fallback when
   Google sign-in keeps closing before it can finish. */
function emailAuthInputs(){
  const password = ($('authPasswordInput') && $('authPasswordInput').value) || '';
  const emailField = $('authEmailInput');
  const emailVisible = emailField && emailField.style.display !== 'none' && emailField.value.trim();
  const handleRaw = ($('authHandleInput') && $('authHandleInput').value) || '';
  let email = '';
  let handle = '';
  if(emailVisible){
    email = emailField.value.trim();
  } else {
    handle = normalizeAuthHandle(handleRaw);
    email = handleToAuthEmail(handle) || '';
  }
  const recovery = (($('authRecoveryInput') && $('authRecoveryInput').value) || '').trim();
  return { email, password, handle, recovery };
}

/* Toggle optional real-email field */
if($('authUseEmailBtn')){
  $('authUseEmailBtn').onclick = ()=>{
    const em = $('authEmailInput');
    const hi = $('authHandleInput');
    if(!em) return;
    const show = em.style.display === 'none' || !em.style.display;
    if(show){
      em.style.display = 'block';
      if(hi) hi.placeholder = 'Handle (optional if using email)';
      $('authUseEmailBtn').textContent = 'Use handle instead';
    } else {
      em.style.display = 'none';
      em.value = '';
      if(hi) hi.placeholder = 'Handle (e.g. namuli)';
      $('authUseEmailBtn').textContent = 'Use email instead';
    }
  };
}

function nalunoHandleSignIn(){
  if(!fbAuth){ try{ injectFirebaseScripts(); }catch(_){} initFirebaseApp(); }
  if(!fbAuth){ authStatus('Connecting to sign-in… tap again in a moment.', true); return; }
  const { email, password, handle, recovery } = emailAuthInputs();
  if(!password || password.length < 6){ authStatus('Enter your password (6+ characters).', true); return; }
  if(!email){
    authStatus('Enter your handle (3+ letters) or turn on "Use email instead".', true);
    return;
  }
  authStatus('Signing in…');
  nalunoJustSignedIn = true;
  const trySignIn = (addr)=> fbAuth.signInWithEmailAndPassword(addr, password);
  trySignIn(email).catch(e=>{
    if(recovery && recovery !== email){
      return trySignIn(recovery);
    }
    throw e;
  }).then(result=>{
    if(result && result.user && typeof ensureMyKeyPairWithRecovery === 'function'){
      // If this device lost its local key (reinstall, storage cleared, new
      // device) but the account has a password-wrapped backup, this recovers
      // it right now, using the password that's about to fall out of scope —
      // it's never stored anywhere, used once, here, then gone.
      currentUser = result.user;
      ensureMyKeyPairWithRecovery(password).catch(()=>{});
    }
  }).catch(e=>{
    const bad = e.code === 'auth/user-not-found' || e.code === 'auth/wrong-password' || e.code === 'auth/invalid-credential';
    authStatus(bad
      ? 'Handle/password not recognized — check spelling, or Create account.'
      : (e.code + ': ' + e.message), true);
  });
};

async function nalunoHandleSignUp(){
  if(!fbAuth){ try{ injectFirebaseScripts(); }catch(_){} initFirebaseApp(); }
  if(!fbAuth){ authStatus('Connecting to sign-in… tap again in a moment.', true); return; }
  const { email, password, handle } = emailAuthInputs();
  if(!password || password.length < 6){ authStatus('Password needs to be at least 6 characters.', true); return; }
  const em = $('authEmailInput');
  const usingEmail = em && em.style.display !== 'none' && em.value.trim();
  if(!usingEmail){
    if(!handle || handle.length < 3){
      authStatus('Choose a handle with at least 3 letters (a–z, 0–9, _).', true);
      return;
    }
  } else if(!email){
    authStatus('Enter an email address.', true);
    return;
  }
  authStatus('Creating your account…');
  nalunoJustSignedIn = true;
  try{
    // Pre-check handle availability when signing up with handle
    if(!usingEmail && handle && fbDb){
      const href = fbDb.collection('handles').doc(handle);
      const snap = await href.get();
      if(snap.exists){
        authStatus('That handle is taken — try another.', true);
        return;
      }
    }
    const { recovery } = emailAuthInputs();
    const createEmail = email;
    const cred = await fbAuth.createUserWithEmailAndPassword(createEmail, password);
    const user = cred.user;
    if(!usingEmail && handle && typeof claimHandle === 'function'){
      // FIX: write a safe fallback profile IMMEDIATELY, before attempting the
      // handle claim. This used to only write the profile doc *after* a
      // successful claim — if the claim then failed (someone else grabbed the
      // same handle in the moment between the availability pre-check and the
      // actual transaction), the account existed with no Callsign profile at
      // all: no name, nothing to show, nothing to log back into meaningfully.
      // Now the account always has an identity from the instant it's created;
      // the claim, if it succeeds, just upgrades it to the real handle.
      try{
        await fbDb.collection('users').doc(user.uid).set({
          name: handle,
          number: '@' + user.uid.slice(0, 8),
          tagline: '',
          createdAt: Date.now(),
          authMethod: 'handle',
          recoveryEmail: recovery || null,
        }, { merge: true });
      }catch(_){}
      try{
        const claimed = await claimHandle(handle, user.uid);
        await fbDb.collection('users').doc(user.uid).set({
          name: handle,
          number: claimed,
        }, { merge: true });
        authStatus('Account created — welcome.');
      }catch(he){
        console.warn('[auth] claim handle', he);
        // The account is real and usable (fallback profile above already
        // covers it) — the person just needs a different handle. Take them
        // straight to Callsign, already open to editing, instead of leaving
        // them to guess where to fix it.
        authStatus('"' + handle + '" was taken right as you signed up — pick another Callsign below.', true);
        try{
          currentUser = user;
          if(typeof loadRealProfile === 'function') loadRealProfile(user);
          const nav = document.querySelector('.navbtn[data-tab="callsign"]');
          if(nav) nav.click();
          if(typeof showCallsignEdit === 'function') setTimeout(showCallsignEdit, 300);
        }catch(_){}
        return;
      }
    } else if(usingEmail){
      try{
        await fbDb.collection('users').doc(user.uid).set({
          name: (user.email || 'You').split('@')[0],
          number: '@' + user.uid.slice(0, 8),
          createdAt: Date.now(),
          authMethod: 'email',
        }, { merge: true });
      }catch(_){}
    }
    authStatus('Account created — welcome.');
    // Generate this identity's E2E key pair now, while the password is still
    // in hand, and back it up (password-wrapped) so it can be recovered if
    // this device's storage is ever lost — see crypto.js for why that backup
    // is what makes turning encryption back on safe this time.
    try{
      currentUser = user;
      if(typeof ensureMyKeyPair === 'function'){
        const keys = await ensureMyKeyPair();
        if(keys && keys.privateJwk && typeof backupPrivateKeyWithPassword === 'function'){
          await backupPrivateKeyWithPassword(keys.privateJwk, password);
        }
      }
    }catch(_){}
  }catch(e){
    authStatus(
      e.code === 'auth/email-already-in-use' ? 'That handle or email already has an account — try Sign in.' :
      e.code === 'auth/weak-password' ? 'Password needs to be at least 6 characters.' :
      (e.code + ': ' + e.message),
      true
    );
  }
};
async function nalunoForgotPassword(){
  if(!fbAuth){ try{ injectFirebaseScripts(); }catch(_){} initFirebaseApp(); }
  if(!fbAuth){ authStatus('Connecting to sign-in… tap again in a moment.', true); return; }
  const { email, handle, recovery } = emailAuthInputs();
  const visibleEmail = ($('authEmailInput') && $('authEmailInput').style.display !== 'none' && $('authEmailInput').value.trim()) || '';
  const target = (recovery || visibleEmail || '').trim();
  if(!target){
    authStatus('Enter the recovery email you saved (or your sign-in email). Handle-only accounts need a recovery email.', true);
    return;
  }
  authStatus('Sending reset email…');
  try{
    await fbAuth.sendPasswordResetEmail(target);
    authStatus('If that email is on the account, a reset link is on its way. Check inbox and spam.');
  }catch(e){
    if(e.code === 'auth/user-not-found'){
      authStatus('If that email is on the account, a reset link is on its way. Check inbox and spam.');
    } else if(e.code === 'auth/invalid-email'){
      authStatus('That email does not look valid.', true);
    } else {
      authStatus(e.message || 'Could not send reset email', true);
    }
  }
}

(function wireHandleAuthButtons(){
  const si = $('emailSignInBtn');
  const su = $('emailSignUpBtn');
  if(si){
    si.addEventListener('click', function(e){ if(e) e.preventDefault(); nalunoHandleSignIn(); });
    si.onclick = function(e){ if(e) e.preventDefault(); nalunoHandleSignIn(); };
  }
  if(su){
    su.addEventListener('click', function(e){ if(e) e.preventDefault(); nalunoHandleSignUp(); });
    su.onclick = function(e){ if(e) e.preventDefault(); nalunoHandleSignUp(); };
  }
  const fg = $('authForgotBtn');
  if(fg){
    fg.addEventListener('click', function(e){ if(e) e.preventDefault(); nalunoForgotPassword(); });
  }
})();

function bindAuthListeners(){
  if(authListenersBound || !fbAuth) return;
  authListenersBound = true;
  authStatus('One moment…');
  let authResolved = false;
  let lastUid = '';
  try{ lastUid = localStorage.getItem('nalunoLastUid') || ''; }catch(_){}
  // If we have a remembered account, never flash the sign-in form on a slow restore.
  if(lastUid){
    const cached = nalunoReadCachedProfile(lastUid);
    if(cached){
      currentProfile = { photo:null, ...DEFAULT_PROFILE, ...cached };
      try{ applyProfileToUI(currentProfile); }catch(_){}
    }
    try{
      const cachedContacts = nalunoCacheRead('contacts');
      if(cachedContacts && cachedContacts.length && typeof addRealContactToLocalList === 'function'){
        cachedContacts.forEach(function(row){
          const added = addRealContactToLocalList(row.firebaseUid, row.name, row.color, row.handle, row.photo);
          if(added){
            if(row.photoUrl){ added.photoUrl = row.photoUrl; if(typeof mergeContactPhoto==='function') mergeContactPhoto(added, row.photoUrl); }
            if(row.lastActivityTs) added.lastActivityTs = row.lastActivityTs;
          }
        });
        try{ renderContacts(); }catch(_){}
      }
      const cachedPrev = nalunoCacheRead('threadPreviews');
      if(cachedPrev && typeof realThreadPreviews !== 'undefined'){
        Object.keys(cachedPrev).forEach(function(k){ realThreadPreviews[k] = cachedPrev[k]; });
        try{ renderWirelineList(); }catch(_){}
      }
      /* FIX (confirmed from a console log full of 404s): the instant-paint
         cache was restored WITHOUT applying the expiry filter that
         pruneExpiredSignal() applies everywhere else. Signals from five and
         six days ago were coming back out of localStorage at boot and being
         rendered, and since the R2 bucket deletes objects after 25 hours
         every one of their images 404'd — dozens of failed requests on every
         single load, and briefly-visible dead tiles until Firestore replaced
         them. Filtering on restore uses the same rule as everywhere else. */
      const nowTs = Date.now();
      const liveOnly = function(arr){
        return (arr || []).filter(function(s){
          if(!s) return false;
          if(s.expiresAt && nowTs >= s.expiresAt) return false;      // own signals
          if(s.latest && s.latest.expiresAt && nowTs >= s.latest.expiresAt) return false; // connection rows
          return true;
        });
      };
      const cachedSig = liveOnly(nalunoCacheRead('mySignal'));
      if(cachedSig.length && typeof mySignal !== 'undefined' && !mySignal.length){
        mySignal = cachedSig;
      }
      const cachedConnSig = liveOnly(nalunoCacheRead('connectionsSignals'));
      if(cachedConnSig.length && typeof connectionsSignals !== 'undefined' && !connectionsSignals.length){
        connectionsSignals = cachedConnSig;
      }
      const cachedBcast = nalunoCacheRead('feedBroadcasts');
      if(cachedBcast && cachedBcast.length && typeof feedBroadcasts !== 'undefined' && !feedBroadcasts.length){
        feedBroadcasts = cachedBcast;
      }
      const cachedMineB = nalunoCacheRead('myBroadcasts');
      if(cachedMineB && cachedMineB.length && typeof myBroadcasts !== 'undefined' && !myBroadcasts.length){
        myBroadcasts = cachedMineB;
      }
      // Real Bands — same instant-paint treatment as contacts/broadcasts/signal,
      // so Band doesn't sit blank waiting on the membership listener's first snapshot.
      const cachedBands = nalunoCacheRead('realBands');
      if(cachedBands && cachedBands.length && typeof bands !== 'undefined'){
        cachedBands.forEach(function(row){
          if(!bands.some(function(b){ return b.firestoreId === row.firestoreId; })) bands.push(row);
        });
      }
      // Compass — last few messages, so reopening the tab doesn't start blank.
      const cachedCompass = nalunoCacheRead('compassMessages');
      if(cachedCompass && cachedCompass.length && typeof compassMessages !== 'undefined' && !compassMessages.length){
        compassMessages = cachedCompass;
        try{ if(typeof renderCompassMessages === 'function') renderCompassMessages(); }catch(_){}
      }
      try{ if(typeof renderBroadcasts === 'function') renderBroadcasts(); }catch(_){}
      try{ if(typeof renderBroadcastTab === 'function') renderBroadcastTab(); }catch(_){}
      try{ if(typeof loadMyTogaSettings === 'function') loadMyTogaSettings(); }catch(_){}
      try{ if(typeof renderTogaBoard === 'function') renderTogaBoard(); }catch(_){}
      try{ if(typeof loadMyStrands === 'function') loadMyStrands(); }catch(_){}
      try{ if(typeof renderBandList === 'function') renderBandList(); }catch(_){}
    }catch(_){}
    /* Keep the drawing logo on screen. Cached UI paints behind the gate. */
  }
  const authTimeout = setTimeout(()=>{
    if(authResolved) return;
    if(lastUid){
      authStatus('Welcome back…');
      nalunoEnterApp();
      return;
    }
    authStatus('Please sign in.');
    nalunoShowSignIn();
  }, 2500);

  // Catches errors specific to the redirect round-trip (e.g. "this domain isn't
  // authorized") that onAuthStateChanged alone would never surface — it would just
  // never fire, leaving someone stuck looking at the sign-in screen with no explanation.
  // Also explicitly reports "no redirect pending" — previously this case was silent,
  // which made it impossible to tell "nothing happened yet" apart from "it's stuck."
  fbAuth.getRedirectResult().then(result=>{
    if(result && result.user){
      authStatus('Signed in.');
    } else {
      authStatus('');
    }
  }).catch(e=>{
    authStatus('Could not finish sign-in. Try again.', true);
  });
  // Wire once. Firebase often emits null BEFORE restoring the local session —
  // wiping lastUid / forcing the gate on that first null is why sign-in felt like
  // "tap twice". Only treat null as signed-out after a short settle, or on explicit sign-out.
  let nullAuthTimer = null;
  function showSignedOutGate(){
    authStatus('');
    nalunoShowSignIn();
  }
  function clearSessionListeners(){
    if(threadsListUnsubscribe){ threadsListUnsubscribe(); threadsListUnsubscribe = null; }
    if(activeThreadUnsubscribe){ activeThreadUnsubscribe(); activeThreadUnsubscribe = null; }
    if(bandPresenceUnsub){ bandPresenceUnsub(); bandPresenceUnsub = null; }
    if(bandMessagesUnsub){ bandMessagesUnsub(); bandMessagesUnsub = null; }
    if(incomingCallUnsub){ incomingCallUnsub(); incomingCallUnsub = null; }
    if(missedCallUnsub){ missedCallUnsub(); missedCallUnsub = null; }
    if(compassUnsub){ compassUnsub(); compassUnsub = null; }
    compassMessages = []; compassLoaded = false;
    compassUnlockedThisSession = false;
    try{ updateMissedCallBadge(0); }catch(_){}
    if(connectionsUnsub){ connectionsUnsub(); connectionsUnsub = null; }
    if(profileUnsub){ profileUnsub(); profileUnsub = null; }
    myKeyPairPromise = null;
    sharedKeyCache = {};
    try{ teardownCallConnection(); }catch(_){}
    realThreadPreviews = {};
  }
  fbAuth.onAuthStateChanged(user=>{
    clearTimeout(authTimeout);
    if(nullAuthTimer){ clearTimeout(nullAuthTimer); nullAuthTimer = null; }
    authResolved = true;
    currentUser = user;
    if(user){
      try{ localStorage.setItem('nalunoLastUid', user.uid); }catch(_){}
      authStatus('');
      nalunoEnterApp();
      loadRealProfile(user);
      // FIX: land on Callsign right after a fresh, explicit sign-in — but
      // never on a normal app reopen where Firebase just silently restored
      // an already-signed-in session (that keeps using the existing
      // nav-state-restore behavior, resuming wherever the person was).
      // Fires after nav-state restore's own timers (200ms/1200ms) so it
      // reliably wins the race instead of being immediately overwritten.
      if(nalunoJustSignedIn){
        nalunoJustSignedIn = false;
        setTimeout(function(){
          try{
            const nav = document.querySelector('.navbtn[data-tab="callsign"]');
            if(nav) nav.click();
          }catch(_){}
        }, 1500);
      }
      // FIX (Google/native sign-in had no E2E key backup or recovery path at
      // all): email/handle accounts get this via the password, right in the
      // sign-in/sign-up flows. Google/native accounts have no password to
      // derive from, so this uses a one-time recovery code instead — same
      // underlying mechanism (see crypto.js), different secret. Only runs
      // for non-password providers; only prompts when there's actually
      // something to do (new key, or an existing backup this device hasn't
      // recovered yet) — never on every single normal app reopen.
      try{
        const isPasswordAccount = (user.providerData || []).some(function(p){ return p && p.providerId === 'password'; });
        if(!isPasswordAccount && typeof ensureMyKeyPair === 'function'){
          (async function(){
            const existing = await ensureMyKeyPair();
            if(existing && existing.privateKey) return; // this device already has a working key
            const status = (typeof checkE2eBackupStatus === 'function') ? await checkE2eBackupStatus(user.uid) : { hasBackup:false };
            if(!status.hasBackup){
              // Brand-new identity on this account — generate the key and a
              // recovery code, and show it once, right now, while it matters.
              const keys = await ensureMyKeyPair();
              if(keys && keys.privateJwk && typeof backupPrivateKeyWithNewRecoveryCode === 'function'){
                const code = await backupPrivateKeyWithNewRecoveryCode(keys.privateJwk);
                if(code && typeof showRecoveryCodeModal === 'function') await showRecoveryCodeModal(code);
              }
            } else if(status.method === 'recovery_code' && typeof promptForRecoveryCode === 'function'){
              const entered = promptForRecoveryCode();
              if(entered) await ensureMyKeyPairWithRecovery(entered);
            }
          })().catch(function(e){ console.warn('[e2e] google account key setup', e); });
        }
      }catch(_){}
      try{ if(typeof showInstallPromptSoon === 'function') setTimeout(showInstallPromptSoon, 1600); }catch(_){}
      const bootFind = function(){
        try{ if(typeof resumeFindNalunoIfEnabled === 'function') resumeFindNalunoIfEnabled(); }catch(_){}
        try{ if(typeof listenFindNalunoDevices === 'function') listenFindNalunoDevices(); }catch(_){}
        try{
          if(typeof findNalunoOpenAfterAuth !== 'undefined' && findNalunoOpenAfterAuth && typeof openFindNaluno === 'function'){
            findNalunoOpenAfterAuth = false;
            openFindNaluno();
          }
        }catch(_){}
      };
      // Wait for a real ID token so the first beacons listener is not denied.
      if(user.getIdToken){
        user.getIdToken().then(bootFind).catch(bootFind);
      } else {
        bootFind();
      }
    } else {
      // Explicit sign-out → gate immediately and clear remembered uid.
      if(window.__nalunoSigningOut){
        try{ localStorage.removeItem('nalunoLastUid'); }catch(_){}
        window.__nalunoSigningOut = false;
        clearSessionListeners();
        showSignedOutGate();
        return;
      }
      // First null is often "session still restoring". Keep any cached UI; only
      // open the gate if still null after settle.
      nullAuthTimer = setTimeout(function(){
        if(currentUser) return;
        // Confirmed signed out
        try{ localStorage.removeItem('nalunoLastUid'); }catch(_){}
        clearSessionListeners();
        if(lastUid){
          const cached = nalunoReadCachedProfile(lastUid);
          if(cached){
            currentProfile = { photo:null, ...DEFAULT_PROFILE, ...cached };
            try{ applyProfileToUI(currentProfile); }catch(_){}
          }
        }
        showSignedOutGate();
      }, 1400);
    }
  });
}
/* LAST-RESORT GATE WATCHDOG.

   The entry gate is lifted by nalunoEnterApp() / nalunoShowSignIn(), and each
   normal path does call one of them. But every one of those paths depends on
   something else succeeding first — the Firebase SDK loading, auth resolving,
   or a retry loop reaching its limit. If ANY of that stalls in a way we have
   not anticipated, the gate simply stays up and the person is left looking at
   a black screen after the logo with no way forward and nothing to report.

   A black screen with no recovery is the worst failure mode this app has: it
   is indistinguishable from the app being broken, and it gives the person
   nothing to act on. This guarantees the gate always lifts, whatever else
   went wrong, and says plainly what happened instead of failing silently.
   It is deliberately a long timeout so it never pre-empts a slow-but-working
   start on a poor connection. */
(function nalunoGateWatchdog(){
  setTimeout(function(){
    try{
      const gate = document.getElementById('authGate');
      if(!gate || !gate.classList.contains('active')) return;   // already lifted
      const app = document.getElementById('app');
      if(app) app.style.visibility = '';
      document.body.classList.remove('naluno-gated');
      try{ if(typeof nalunoHideNativeSplash === 'function') nalunoHideNativeSplash(); }catch(_){}
      const loading = document.getElementById('authGateLoading');
      if(loading) loading.style.display = 'none';
      const form = document.getElementById('authGateForm');
      if(form) form.style.display = '';
      if(typeof authStatus === 'function'){
        authStatus('Sign-in did not start. Check your connection, or reload.', true);
      }
      console.warn('[naluno] gate watchdog fired — auth never resolved');
    }catch(_){}
  }, 12000);
})();

/* LAST-RESORT GATE WATCHDOG.

   The entry gate is lifted by nalunoEnterApp() / nalunoShowSignIn(), and each
   normal path does call one of them. But every one of those paths depends on
   something else succeeding first — the Firebase SDK loading, auth resolving,
   or a retry loop reaching its limit. If ANY of that stalls in a way we have
   not anticipated, the gate simply stays up and the person is left looking at
   a black screen after the logo with no way forward and nothing to report.

   A black screen with no recovery is the worst failure mode this app has: it
   is indistinguishable from the app being broken, and it gives the person
   nothing to act on. This guarantees the gate always lifts, whatever else
   went wrong, and says plainly what happened instead of failing silently.
   It is deliberately a long timeout so it never pre-empts a slow-but-working
   start on a poor connection. */
(function nalunoGateWatchdog(){
  setTimeout(function(){
    try{
      const gate = document.getElementById('authGate');
      if(!gate || !gate.classList.contains('active')) return;   // already lifted
      const app = document.getElementById('app');
      if(app) app.style.visibility = '';
      document.body.classList.remove('naluno-gated');
      try{ if(typeof nalunoHideNativeSplash === 'function') nalunoHideNativeSplash(); }catch(_){}
      const loading = document.getElementById('authGateLoading');
      if(loading) loading.style.display = 'none';
      const form = document.getElementById('authGateForm');
      if(form) form.style.display = '';
      if(typeof authStatus === 'function'){
        authStatus('Sign-in did not start. Check your connection, or reload.', true);
      }
      console.warn('[naluno] gate watchdog fired — auth never resolved');
    }catch(_){}
  }, 12000);
})();

if(fbAuth){
  bindAuthListeners();
} else {
  // Firebase SDK missing or init failed (often SW timed out gstatic on mobile).
  // Keep the form visible and retry — do NOT full-page reload (that felt like
  // "sign in twice" when the first attempt raced the SDK).
  try{
    nalunoShowSignIn();
  }catch(_){}
  authStatus('Loading sign-in…', false);
  let authTries = 0;
  const authRetry = setInterval(function(){
    authTries++;
    try{ injectFirebaseScripts(); }catch(_){}
    if(initFirebaseApp() && fbAuth){
      clearInterval(authRetry);
      authStatus('Sign-in ready — try again.', false);
      try{ bindAuthListeners(); }catch(_){}
      return;
    }
    if(authTries >= 40){
      clearInterval(authRetry);
      authStatus('Sign-in could not start — check the connection, then tap again.', true);
    }
  }, 400);
}

/* Claims handles/{handle} -> uid via a transaction, so two people racing for the
   same handle can't both win — Firestore rejects the loser's write. */
async function claimHandle(handle, uid){
  const clean = handle.replace(/^@/, '').toLowerCase();
  const ref = fbDb.collection('handles').doc(clean);
  await fbDb.runTransaction(async tx=>{
    const doc = await tx.get(ref);
    if(doc.exists && doc.data().uid !== uid){
      throw new Error('That handle is already taken');
    }
    tx.set(ref, { uid });
  });
  return '@' + clean;
}

let profileUnsub = null;
function isCallsignEditing(){
  const ed = $('callsignEdit');
  return !!(ed && ed.style.display !== 'none');
}

function nalunoReadCachedProfile(uid){
  if(!uid) return null;
  try{
    const raw = localStorage.getItem('nalunoProfile:' + uid);
    if(!raw) return null;
    const p = JSON.parse(raw);
    if(!p || typeof p !== 'object') return null;
    return p;
  }catch(_){ return null; }
}
function nalunoWriteCachedProfile(uid, profile){
  if(!uid || !profile) return;
  try{
    const copy = Object.assign({}, profile);
    if(copy.photo && copy.photo.dataUrl && String(copy.photo.dataUrl).length > 80000){
      copy.photo = { crop: copy.photo.crop || null };
    }
    localStorage.setItem('nalunoProfile:' + uid, JSON.stringify(copy));
  }catch(_){}
}

function nalunoEnsureProfilePhotoUrl(profile){
  if(!profile || !currentUser || !fbDb) return;
  if(profile.photoUrl && /^https?:/i.test(profile.photoUrl)) return;
  const data = profile.photo && profile.photo.dataUrl;
  if(!data) return;
  if(/^https?:/i.test(data)){
    profile.photoUrl = data;
    fbDb.collection('users').doc(currentUser.uid).set({
      photoUrl: data,
      photo: { dataUrl: data, crop: (profile.photo && profile.photo.crop) || null }
    }, { merge:true }).catch(function(){});
    return;
  }
  if(String(data).indexOf('data:image') !== 0) return;
  if(typeof uploadPhotoToR2 !== 'function') return;
  if(nalunoEnsureProfilePhotoUrl._busy) return;
  nalunoEnsureProfilePhotoUrl._busy = true;
  (async function(){
    try{
      const file = (typeof nalunoDataUrlToFile === 'function')
        ? await nalunoDataUrlToFile(data, 'avatar.jpg')
        : await (await fetch(data)).blob();
      const url = await uploadPhotoToR2(file);
      if(!url) return;
      if(currentProfile){
        currentProfile.photoUrl = url;
        if(currentProfile.photo) currentProfile.photo.dataUrl = url;
      }
      await fbDb.collection('users').doc(currentUser.uid).set({
        photoUrl: url,
        photo: { dataUrl: url, crop: (currentProfile && currentProfile.photo && currentProfile.photo.crop) || null }
      }, { merge:true });
    }catch(e){ console.warn('[profile] photoUrl backfill', e && e.message); }
    finally{ nalunoEnsureProfilePhotoUrl._busy = false; }
  })();
}

function loadRealProfile(user){
  if(profileUnsub) profileUnsub();
  // Live listener for profile. CRITICAL: while the edit form is open, never call
  // applyProfileToUI / showCallsignView — presence heartbeats and other merges would
  // overwrite mid-typing and kick the user out of the form ("text jumps away").
  let gotFirstSnapshot = false;
  profileUnsub = fbDb.collection('users').doc(user.uid).onSnapshot(doc=>{
    if(doc.exists){
      const incoming = { photo:null, ...DEFAULT_PROFILE, ...doc.data() };
      currentProfile = incoming;
      try{ nalunoEnsureProfilePhotoUrl(currentProfile); }catch(_){}
      if(isCallsignEditing()){
        // Keep view-mode labels in sync for when they exit, but leave the form alone.
        try{
          $('viewName').textContent = incoming.name;
          $('viewTagline').textContent = incoming.tagline;
          $('viewNumber').textContent = incoming.number;
          applyAvatarVisual($('viewAvatar'), incoming);
        }catch(e){}
      } else {
        applyProfileToUI(currentProfile);
        nalunoWriteCachedProfile(user.uid, currentProfile);
        try{ nalunoCacheWrite('profile', currentProfile); }catch(_){}
        if(!gotFirstSnapshot) showCallsignView();
      }
    } else if(!gotFirstSnapshot){
      const cached = nalunoReadCachedProfile(user.uid);
      if(cached && (cached.name || cached.number)){
        currentProfile = { photo:null, ...DEFAULT_PROFILE, ...cached };
        applyProfileToUI(currentProfile);
        if(!isCallsignEditing()) showCallsignView();
      } else if(typeof nalunoIsOnline === 'function' ? nalunoIsOnline() : navigator.onLine){
        currentProfile = { ...DEFAULT_PROFILE, name: user.displayName || 'You', number: '@' + user.uid.slice(0,8) };
        applyProfileToUI(currentProfile);
        showCallsignEdit();
      }
    }
    if(currentProfile) nalunoWriteCachedProfile(user.uid, currentProfile);
        try{ nalunoCacheWrite('profile', currentProfile); }catch(_){}
    gotFirstSnapshot = true;
  }, ()=>{
    toast('Couldn\u2019t load your callsign — check your connection');
  });
  loadRealConnections(user.uid);
  startThreadsListListener();
  loadRealBands(user.uid);
  startIncomingCallListener();
  try{ if(typeof prewarmIceServers === 'function') prewarmIceServers(); }catch(_){}
  startMissedCallListener();
  startBandInviteListener();
  loadMySignal(); if(typeof loadFeedBroadcasts==='function') loadFeedBroadcasts(); try{ if(typeof startFeedBroadcastsListener==='function') startFeedBroadcastsListener(); }catch(_){};
  maybeRefreshCallNotifToken();
  try{ if(typeof ensureCallPushReady === 'function') ensureCallPushReady(); }catch(_){}
  flushMessageQueue();
  ensureMyKeyPair();
  checkForPendingVideoJob();
}
/* If the person already granted notification permission in a previous session, re-fetch
   and re-save their token silently — this is what was actually breaking: the token
   registration never survived a sign-out/sign-in, so it looked like the setting itself
   didn't stick, when really it just needed a way to renew itself automatically. */
async function maybeRefreshCallNotifToken(){
  // Android shell: prefer native FCM token (wakes device). Web VAPID is secondary.
  if(isNativeShell()){
    await setupCapacitorPush();
    return;
  }
  if(!('Notification' in window) || Notification.permission !== 'granted') return;
  if(typeof VAPID_KEY === 'undefined' || !VAPID_KEY || VAPID_KEY === 'YOUR_VAPID_KEY') return;
  try{
    const registration = await navigator.serviceWorker.ready;
    const messaging = firebase.messaging();
    const token = await messaging.getToken({ vapidKey: VAPID_KEY, serviceWorkerRegistration: registration });
    if(token && currentUser && fbDb){
      // Store web token separately. Only overwrite primary fcmToken if no Android token exists
      // (so opening the PWA does not silently break phone wake for the same account).
      const userRef = fbDb.collection('users').doc(currentUser.uid);
      const snap = await userRef.get();
      const existing = snap.exists ? snap.data() : {};
      const payload = { fcmTokenWeb: token, fcmTokenPlatform: 'web' };
      if(!existing.fcmTokenAndroid){
        payload.fcmToken = token;
      }
      await userRef.set(payload, { merge:true });
      $('callNotifStatus').textContent = 'Call notifications are on — you\u2019ll be notified even with the app closed.';
    }
  }catch(e){ /* best-effort — worst case they tap the button again this once */ }
}

async function loadProfile(){
  // Local-only fallback path (no Firebase configured) — same behavior as before.
  let hasSavedProfile = false;
  if(storageAvailable){
    try{
      const res = await window.storage.get('callsign:profile');
      if(res && res.value){ currentProfile = { photo:null, ...JSON.parse(res.value) }; hasSavedProfile = true; }
    }catch(e){ /* no saved profile yet — keep defaults */ }
  }
  applyProfileToUI(currentProfile);
  if(hasSavedProfile) showCallsignView(); else showCallsignEdit();
}
loadSignalFromStorage();
loadWireline();
loadContactActivity();
loadBands();

$('editCallsignBtn').onclick = showCallsignEdit;
$('cancelCallsignBtn').onclick = ()=>{
  applyProfileToUI(currentProfile); // discard any unsaved edits, including a picked-but-unsaved photo
  showCallsignView();
};

$('saveProfileBtn').onclick = async ()=>{
  const btn = $('saveProfileBtn');
  if(btn && btn.dataset.saving === '1') return;
  const selectedSwatch = document.querySelector('#swatchRow .swatch.selected');
  const finalName = $('nameInput').value.trim() || 'You';
  const requestedHandle = normalizeHandle($('numberInput').value, finalName);
  const recoverySaved = (($('recoveryEmailInput') && $('recoveryEmailInput').value) || '').trim();
  if(btn){
    btn.dataset.saving = '1';
    btn.dataset.prevLabel = btn.textContent;
    btn.textContent = 'Saving…';
    btn.style.opacity = '0.7';
  }
  let photoOut = draftPhoto;
  if(photoOut && photoOut.dataUrl && typeof nalunoShrinkImageDataUrl === 'function'){
    try{
      const slim = await nalunoShrinkImageDataUrl(photoOut.dataUrl, 480, 0.7);
      photoOut = Object.assign({}, photoOut, { dataUrl: slim });
    }catch(_){}
  }
  let photoUrlOut = null;
  try{
    if(photoOut && photoOut.dataUrl && /^https?:/i.test(photoOut.dataUrl)){
      photoUrlOut = photoOut.dataUrl;
    } else if(photoOut && photoOut.dataUrl && String(photoOut.dataUrl).indexOf('data:image') === 0 && typeof uploadPhotoToR2 === 'function'){
      const file = (typeof nalunoDataUrlToFile === 'function')
        ? await nalunoDataUrlToFile(photoOut.dataUrl, 'avatar.jpg')
        : await (await fetch(photoOut.dataUrl)).blob();
      photoUrlOut = await uploadPhotoToR2(file);
      if(photoUrlOut){
        photoOut = Object.assign({}, photoOut, { dataUrl: photoUrlOut });
      }
    } else if(photoOut && currentProfile && currentProfile.photoUrl && /^https?:/i.test(currentProfile.photoUrl)){
      photoUrlOut = currentProfile.photoUrl;
    }
  }catch(upErr){
    console.warn('[profile] avatar upload', upErr && upErr.message);
  }
  const nextProfile = {
    name: finalName,
    tagline: $('taglineInput').value.trim(),
    number: requestedHandle,
    color: selectedSwatch ? selectedSwatch.dataset.c : '#7CFFB2',
    photo: photoOut,
    photoUrl: photoUrlOut || null,
    recoveryEmail: recoverySaved || (currentProfile && currentProfile.recoveryEmail) || null,
  };

  if(currentUser && fbDb){
    try{
      const handleChanged = requestedHandle !== (currentProfile.number || '');
      if(handleChanged){
        nextProfile.number = await claimHandle(requestedHandle, currentUser.uid);
      } else {
        nextProfile.number = currentProfile.number || requestedHandle;
      }
      // Optimistic local apply so the form closes immediately.
      currentProfile = nextProfile;
      applyProfileToUI(currentProfile);
      showCallsignView();
      toast('Callsign saved');
      const cloudProfile = Object.assign({}, nextProfile);
      if(cloudProfile.photo && cloudProfile.photo.dataUrl && String(cloudProfile.photo.dataUrl).length > 80000){
        cloudProfile.photo = { crop: cloudProfile.photo.crop || null };
      }
      // Persist in background — snapshot will confirm; we ignore mid-edit overwrites.
      fbDb.collection('users').doc(currentUser.uid).set(cloudProfile, { merge:true }).catch(e=>{
        toast(e.message || 'Saved on device, but cloud sync failed');
      });
    }catch(e){
      toast(e.message || 'Couldn\u2019t save — try a different handle');
    }finally{
      if(btn){
        btn.dataset.saving = '0';
        btn.textContent = btn.dataset.prevLabel || 'Save callsign';
        btn.style.opacity = '';
      }
    }
    return;
  }

  // Local-only fallback (no Firebase configured)
  currentProfile = nextProfile;
  applyProfileToUI(currentProfile);
  showCallsignView();
  if(btn){
    btn.dataset.saving = '0';
    btn.textContent = btn.dataset.prevLabel || 'Save callsign';
    btn.style.opacity = '';
  }
  if(storageAvailable){
    try{
      await window.storage.set('callsign:profile', JSON.stringify(currentProfile));
      toast('Callsign saved');
    }catch(e){
      toast('Callsign updated (won\u2019t persist after refresh here)');
    }
  } else {
    toast('Callsign updated (won\u2019t persist after refresh here)');
  }
};
$('greenroomToggle').onclick = function(){ this.classList.toggle('on'); greenroomEnabled = this.classList.contains('on'); toast(greenroomEnabled?'Greenroom enabled':'Greenroom disabled'); };



/* Ensure push token is always refreshed after sign-in (native + web) */
(function nalunoAutoPush(){
  const tryReg = async ()=>{
    if(!currentUser || !fbDb) return;
    try{
      if(typeof isNativeShell === 'function' && isNativeShell() && typeof setupCapacitorPush === 'function'){
        await setupCapacitorPush();
      } else if(typeof registerWebPushToken === 'function'){
        await registerWebPushToken();
      }
    }catch(e){ console.warn('[push] auto register', e); }
  };
  // Hook firebase auth if available
  const boot = ()=>{
    if(typeof fbAuth !== 'undefined' && fbAuth){
      fbAuth.onAuthStateChanged(u=>{ if(u) setTimeout(tryReg, 1500); });
    }
  };
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
