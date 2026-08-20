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

function firebaseReady(){
  return typeof firebase !== 'undefined'
    && typeof firebaseConfig !== 'undefined'
    && firebaseConfig.apiKey && firebaseConfig.apiKey !== 'YOUR_API_KEY';
}
if(firebaseReady()){
  try{
    fbApp = firebase.initializeApp(firebaseConfig);
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
  }catch(e){ console.error('Firebase init failed:', e); }
}

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
  if(!fbAuth){ authStatus('Sign-in is not ready yet.', true); return; }

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
  if(!fbAuth){ authStatus('Sign-in is not ready yet.', true); return; }
  const { email, password, handle, recovery } = emailAuthInputs();
  if(!password || password.length < 6){ authStatus('Enter your password (6+ characters).', true); return; }
  if(!email){
    authStatus('Enter your handle (3+ letters) or turn on "Use email instead".', true);
    return;
  }
  authStatus('Signing in…');
  const trySignIn = (addr)=> fbAuth.signInWithEmailAndPassword(addr, password);
  trySignIn(email).catch(e=>{
    if(recovery && recovery !== email){
      return trySignIn(recovery);
    }
    throw e;
  }).catch(e=>{
    const bad = e.code === 'auth/user-not-found' || e.code === 'auth/wrong-password' || e.code === 'auth/invalid-credential';
    authStatus(bad
      ? 'Handle/password not recognized — check spelling, or Create account.'
      : (e.code + ': ' + e.message), true);
  });
};

async function nalunoHandleSignUp(){
  if(!fbAuth){ authStatus('Sign-in is not ready yet.', true); return; }
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
    let createEmail = email;
    if(!usingEmail && recovery && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recovery)){
      createEmail = recovery;
    }
    const cred = await fbAuth.createUserWithEmailAndPassword(createEmail, password);
    const user = cred.user;
    if(!usingEmail && handle && typeof claimHandle === 'function'){
      try{
        const claimed = await claimHandle(handle, user.uid);
        await fbDb.collection('users').doc(user.uid).set({
          name: handle,
          number: claimed || ('@' + handle),
          tagline: '',
          createdAt: Date.now(),
          authMethod: 'handle',
          recoveryEmail: recovery || null,
        }, { merge: true });
      }catch(he){
        console.warn('[auth] claim handle', he);
        authStatus(he.message || 'Handle could not be claimed — you can set it in profile.', true);
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
  if(!fbAuth){ authStatus('Sign-in is not ready yet.', true); return; }
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

if(fbAuth){
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
          addRealContactToLocalList(row.firebaseUid, row.name, row.color, row.handle, row.photo);
        });
        try{ renderContacts(); }catch(_){}
      }
      const cachedPrev = nalunoCacheRead('threadPreviews');
      if(cachedPrev && typeof realThreadPreviews !== 'undefined'){
        Object.keys(cachedPrev).forEach(function(k){ realThreadPreviews[k] = cachedPrev[k]; });
        try{ renderWirelineList(); }catch(_){}
      }
    }catch(_){}
    document.body.classList.remove('naluno-gated');
    $('authGate').classList.remove('active');
  }
  const authTimeout = setTimeout(()=>{
    if(authResolved) return;
    if(lastUid){
      authStatus('Welcome back…');
      return;
    }
    authStatus('Please sign in.');
    $('authGateLoading').style.display = 'none';
    $('authGateForm').style.display = 'flex';
    document.body.classList.add('naluno-gated');
    $('authGate').classList.add('active');
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
  fbAuth.onAuthStateChanged(user=>{
    clearTimeout(authTimeout);
    authResolved = true;
    currentUser = user;
    if(user){
      try{ localStorage.setItem('nalunoLastUid', user.uid); }catch(_){}
      authStatus('');
      document.body.classList.remove('naluno-gated');
      $('authGate').classList.remove('active');
      loadRealProfile(user);
      try{ if(typeof resumeFindNalunoIfEnabled === 'function') resumeFindNalunoIfEnabled(); }catch(_){}
      try{ if(typeof showInstallPromptSoon === 'function') setTimeout(showInstallPromptSoon, 1600); }catch(_){}
      try{ if(typeof listenFindNalunoDevices === 'function') listenFindNalunoDevices(); }catch(_){}
    } else {
      if(lastUid && !window.__nalunoSigningOut){
        const cached = nalunoReadCachedProfile(lastUid);
        if(cached){
          currentProfile = { photo:null, ...DEFAULT_PROFILE, ...cached };
          try{ applyProfileToUI(currentProfile); }catch(_){}
        }
        document.body.classList.remove('naluno-gated');
        $('authGate').classList.remove('active');
        return;
      }
      try{ localStorage.removeItem('nalunoLastUid'); }catch(_){}
      authStatus('');
      $('authGateLoading').style.display = 'none';
      $('authGateForm').style.display = 'flex';
      document.body.classList.add('naluno-gated');
      $('authGate').classList.add('active');
      if(threadsListUnsubscribe){ threadsListUnsubscribe(); threadsListUnsubscribe = null; }
      if(activeThreadUnsubscribe){ activeThreadUnsubscribe(); activeThreadUnsubscribe = null; }
      if(bandPresenceUnsub){ bandPresenceUnsub(); bandPresenceUnsub = null; }
      if(bandMessagesUnsub){ bandMessagesUnsub(); bandMessagesUnsub = null; }
      if(incomingCallUnsub){ incomingCallUnsub(); incomingCallUnsub = null; }
      if(missedCallUnsub){ missedCallUnsub(); missedCallUnsub = null; }
      if(compassUnsub){ compassUnsub(); compassUnsub = null; }
      compassMessages = []; compassLoaded = false;
      compassUnlockedThisSession = false;
      updateMissedCallBadge(0);
      if(connectionsUnsub){ connectionsUnsub(); connectionsUnsub = null; }
      if(profileUnsub){ profileUnsub(); profileUnsub = null; }
      myKeyPairPromise = null;
      sharedKeyCache = {};
      teardownCallConnection();
      realThreadPreviews = {};
    }
  });
} else if(!firebaseReady()){
  // firebase-config.js is still the placeholder. Do NOT auto-skip the gate —
  // the previous behaviour of removing the gate after a short delay is exactly
  // what made the sign-in page "never come" during testing. Keep the form visible
  // and show a clear status so the first-time experience is never skipped.
  // (When real config is present this branch is never taken.)
  $('authGateLoading').style.display = 'none';
  $('authGateForm').style.display = 'flex';
  $('authGate').classList.add('active');
  authStatus('Sign-in is not ready yet.', true);
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
  try{ localStorage.setItem('nalunoProfile:' + uid, JSON.stringify(profile)); }catch(_){}
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
  let photoOut = draftPhoto;
  if(photoOut && photoOut.dataUrl && typeof nalunoShrinkImageDataUrl === 'function'){
    try{
      const slim = await nalunoShrinkImageDataUrl(photoOut.dataUrl, 480, 0.7);
      photoOut = Object.assign({}, photoOut, { dataUrl: slim });
    }catch(_){}
  }
  const nextProfile = {
    name: finalName,
    tagline: $('taglineInput').value.trim(),
    number: requestedHandle,
    color: selectedSwatch ? selectedSwatch.dataset.c : '#7CFFB2',
    photo: photoOut,
    recoveryEmail: recoverySaved || (currentProfile && currentProfile.recoveryEmail) || null,
  };

  // Instant UI feedback — never leave the user staring at a frozen button.
  if(btn){
    btn.dataset.saving = '1';
    btn.dataset.prevLabel = btn.textContent;
    btn.textContent = 'Saving…';
    btn.style.opacity = '0.7';
  }

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
      // Persist in background — snapshot will confirm; we ignore mid-edit overwrites.
      fbDb.collection('users').doc(currentUser.uid).set(nextProfile, { merge:true }).catch(e=>{
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
