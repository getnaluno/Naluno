/* Sign-in history the desk can retrieve.
   One sign-in row per day on this browser, one session row per tab,
   a new-device row the first time this browser stores a key.
   A rejected password before any session is not written: the phone
   is not signed in, and must not write another person's history.
   No message text. No raw user-agent. No network address. */
(function () {
  function coarseDevice() {
    const ua = (typeof navigator !== 'undefined' && navigator.userAgent) || '';
    const os = /Android/i.test(ua) ? 'Android'
      : /iPhone|iPad|iPod/i.test(ua) ? 'iPhone'
      : /Mac/i.test(ua) ? 'Mac'
      : /Windows/i.test(ua) ? 'Windows'
      : 'Other';
    const br = /Edg\//.test(ua) ? 'Edge'
      : /Chrome\//.test(ua) ? 'Chrome'
      : /Safari\//.test(ua) && !/Chrome\//.test(ua) ? 'Safari'
      : /Firefox\//.test(ua) ? 'Firefox'
      : 'Browser';
    return (os + ' · ' + br).slice(0, 78);
  }
  function deviceKey() {
    try {
      let k = localStorage.getItem('nalunoDeviceKey');
      if (k && k.length > 8) return { key: k, fresh: false };
      k = 'dev_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
      localStorage.setItem('nalunoDeviceKey', k);
      return { key: k, fresh: true };
    } catch (_) {
      return { key: 'dev_session', fresh: false };
    }
  }
  function sessionKey() {
    try {
      let k = sessionStorage.getItem('nalunoSecSessionKey');
      if (k) return k;
      k = 'ses_' + Math.random().toString(36).slice(2, 12);
      sessionStorage.setItem('nalunoSecSessionKey', k);
      return k;
    } catch (_) { return 'ses_once'; }
  }
  function dayMark(uid) {
    const day = new Date().toISOString().slice(0, 10);
    return uid + '|' + day;
  }

  async function write(kind, uid, detail) {
    const Trust = window.NalunoTrust;
    const db = (typeof fbDb !== 'undefined') ? fbDb : null;
    if (!Trust || !db || !uid) return;
    const dev = deviceKey();
    let row;
    try {
      row = Trust.securityEventInput({
        uid: uid,
        kind: kind,
        at: Date.now(),
        deviceKey: dev.key,
        deviceLabel: coarseDevice(),
        sessionKey: sessionKey(),
        ok: kind !== 'logout',
        detail: detail || kind,
      }, uid);
    } catch (_) { return; }
    try { await db.collection('securityEvents').add(row); } catch (_) {}
    if (dev.fresh) {
      try {
        const extra = Trust.securityEventInput({
          uid: uid,
          kind: 'new_device',
          at: Date.now(),
          deviceKey: dev.key,
          deviceLabel: coarseDevice(),
          sessionKey: sessionKey(),
          ok: true,
          detail: 'first time on this browser',
        }, uid);
        await db.collection('securityEvents').add(extra);
      } catch (_) {}
    }
  }

  async function arrive(user) {
    if (!user || !user.uid) return;
    const uid = user.uid;
    let seen = '';
    try { seen = sessionStorage.getItem('nalunoSecSession') || ''; } catch (_) {}
    if (seen === uid) return;
    try { sessionStorage.setItem('nalunoSecSession', uid); } catch (_) {}
    await write('session_start', uid, 'session');
    let mark = '';
    try { mark = localStorage.getItem('nalunoSecDay') || ''; } catch (_) {}
    if (mark !== dayMark(uid)) {
      try { localStorage.setItem('nalunoSecDay', dayMark(uid)); } catch (_) {}
      await write('login', uid, 'sign-in');
    }
  }

  async function note(kind) {
    const user = (typeof currentUser !== 'undefined' && currentUser) ? currentUser
      : (typeof fbAuth !== 'undefined' && fbAuth && fbAuth.currentUser) ? fbAuth.currentUser
      : null;
    if (!user || !user.uid) return;
    if (kind === 'logout') {
      try { sessionStorage.removeItem('nalunoSecSession'); } catch (_) {}
    }
    await write(kind, user.uid, kind);
  }

  function boot() {
    if (typeof fbAuth === 'undefined' || !fbAuth || !fbAuth.onAuthStateChanged) {
      setTimeout(boot, 500);
      return;
    }
    fbAuth.onAuthStateChanged(function (user) {
      if (user) arrive(user);
    });
  }
  boot();
  window.NalunoSecurity = { note: note, arrive: arrive };
})();
