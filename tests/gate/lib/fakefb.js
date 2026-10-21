/* Firebase compat stand-in whose Firestore lives in the test process, so
   two independent browser clients read and write ONE database. Writes,
   queries and listeners go through window.__fsop (a Playwright binding);
   the test process pushes snapshot changes back through window.__fsfire. */
(function () {
  if (window.firebase && window.firebase.__fake) return;
  const uid = window.__AUDIT_UID || 'audit_user';
  const op = (o) => window.__fsop(JSON.stringify(o)).then((r) => (r ? JSON.parse(r) : r));

  function Ts(ms) { this._ms = ms; this.seconds = Math.floor(ms / 1000); this.nanoseconds = (ms % 1000) * 1e6; }
  Ts.prototype.toMillis = function () { return this._ms; };
  Ts.prototype.toDate = function () { return new Date(this._ms); };
  Ts.prototype.valueOf = function () { return this._ms; };
  Ts.prototype.isEqual = function (o) { return o && o.toMillis && o.toMillis() === this._ms; };
  Ts.now = () => new Ts(Date.now());
  Ts.fromMillis = (m) => new Ts(m);
  Ts.fromDate = (d) => new Ts(+d);

  function enc(v) {
    if (v === undefined) return { __undef: 1 };
    if (v === null || typeof v !== 'object') return v;
    if (v.__fv) return v;
    if (v instanceof Date) return { __ts: +v };
    if (typeof v.toMillis === 'function') return { __ts: v.toMillis() };
    if (v.__isRef) return { __ref: v.path };
    if (Array.isArray(v)) return v.map(enc);
    const o = {};
    Object.keys(v).forEach((k) => { if (v[k] !== undefined) o[k] = enc(v[k]); });
    return o;
  }
  function dec(v) {
    if (v === null || typeof v !== 'object') return v;
    if (Array.isArray(v)) return v.map(dec);
    if (typeof v.__ts === 'number') return new Ts(v.__ts);
    if (v.__ref) return db.doc(v.__ref);
    const o = {};
    Object.keys(v).forEach((k) => { o[k] = dec(v[k]); });
    return o;
  }
  function getPath(obj, f) { return String(f).split('.').reduce((a, k) => (a == null ? undefined : a[k]), obj); }
  function docSnap(path, raw) {
    const id = path.split('/').pop();
    return { id, exists: !!raw, ref: docRef(path), metadata: { hasPendingWrites: false, fromCache: false },
      data: () => (raw ? dec(raw) : undefined),
      get: (f) => (raw ? getPath(dec(raw), f) : undefined) };
  }
  function qSnap(res) {
    const docs = res.docs.map((d) => docSnap(d.path, d.data));
    const byPath = {}; docs.forEach((d, i) => { byPath[res.docs[i].path] = d; });
    const changes = (res.changes || []).map((c) => ({ type: c.type, oldIndex: c.oldIndex, newIndex: c.newIndex, doc: byPath[c.path] || docSnap(c.path, c.data) }));
    return { docs, size: docs.length, empty: !docs.length, forEach: (f) => docs.forEach(f), docChanges: () => changes, metadata: { hasPendingWrites: false, fromCache: false } };
  }

  const handlers = {};
  let lid = 0;
  window.__fsfire = function (id, json) {
    const h = handlers[id]; if (!h) return;
    const res = JSON.parse(json);
    try { h(res); } catch (e) { console.error('[shared-fs] listener threw', e && (e.stack || e.message)); }
  };
  function listen(spec, a, b, c) {
    let next, error;
    if (typeof a === 'function') { next = a; error = b; }
    else if (a && (a.next || a.error)) { next = a.next; error = a.error; }
    else if (typeof b === 'function') { next = b; error = c; }
    else if (b && (b.next || b.error)) { next = b.next; error = b.error; }
    const id = 'l' + (++lid);
    handlers[id] = (res) => {
      if (res.error) { if (error) error(Object.assign(new Error(res.error), { code: res.code || 'permission-denied' })); return; }
      if (!next) return;
      if (spec.doc) next(docSnap(spec.doc, res.data)); else next(qSnap(res));
    };
    op({ op: 'listen', id, spec });
    return function () { delete handlers[id]; op({ op: 'unlisten', id }); };
  }

  function docRef(path) {
    const id = path.split('/').pop();
    return {
      __isRef: true, id, path,
      get parent() { return colRef(path.split('/').slice(0, -1).join('/')); },
      get: () => op({ op: 'get', path }).then((r) => { if (r && r.__err) throw Object.assign(new Error(r.__err), { code: 'permission-denied' }); return docSnap(path, r); }),
      set: (v, o) => op({ op: "set", path, data: enc(v), merge: !!(o && (o.merge || o.mergeFields)) }).then((r) => { if (r && r.error) throw Object.assign(new Error(r.error), { code: "permission-denied" }); }),
      update: (a, b) => {
        let v = a;
        if (typeof a === 'string') { v = {}; v[a] = b; }
        return op({ op: 'update', path, data: enc(v) }).then((r) => { if (r && r.error) throw Object.assign(new Error(r.error), { code: 'not-found' }); });
      },
      delete: () => op({ op: 'delete', path }).then(() => undefined),
      onSnapshot: (a, b, c) => listen({ doc: path }, a, b, c),
      collection: (n) => colRef(path + '/' + n),
      isEqual: (o) => o && o.path === path,
    };
  }
  function query(spec) {
    const q = {
      path: spec.path,
      where: (f, o, v) => query(Object.assign({}, spec, { wheres: (spec.wheres || []).concat([[String(f), o, enc(v)]]) })),
      orderBy: (f, d) => query(Object.assign({}, spec, { orderBy: (spec.orderBy || []).concat([[String(f), d || 'asc']]) })),
      limit: (n) => query(Object.assign({}, spec, { limit: n })),
      limitToLast: (n) => query(Object.assign({}, spec, { limitToLast: n })),
      startAfter: (...v) => query(Object.assign({}, spec, { startAfter: v.map((x) => (x && x.ref && x.data ? { __docPath: x.ref.path } : enc(x))) })),
      startAt: (...v) => query(Object.assign({}, spec, { startAt: v.map((x) => (x && x.ref && x.data ? { __docPath: x.ref.path } : enc(x))) })),
      endAt: () => q, endBefore: () => q,
      get: () => op({ op: 'query', spec }).then((r) => { if (r && r.error) throw Object.assign(new Error(r.error), { code: 'permission-denied' }); return qSnap(r); }),
      onSnapshot: (a, b, c) => listen(spec, a, b, c),
    };
    return q;
  }
  function colRef(path) {
    const q = query({ path });
    q.id = path.split('/').pop();
    q.doc = (id) => docRef(path + '/' + (id || ('auto' + Math.random().toString(36).slice(2, 12) + Date.now().toString(36))));
    q.add = (v) => { const r = q.doc(); return r.set(v).then(() => r); };
    return q;
  }
  function batch() {
    const w = [];
    const b = {
      set: (r, v, o) => { w.push({ kind: 'set', path: r.path, data: enc(v), merge: !!(o && o.merge) }); return b; },
      update: (r, v, x) => { if (typeof v === 'string') { const o = {}; o[v] = x; v = o; } w.push({ kind: 'update', path: r.path, data: enc(v) }); return b; },
      delete: (r) => { w.push({ kind: 'delete', path: r.path }); return b; },
      commit: () => op({ op: 'batch', writes: w }).then((r) => { if (r && r.error) throw Object.assign(new Error(r.error), { code: 'permission-denied' }); }),
    };
    return b;
  }
  const db = {
    collection: (n) => colRef(n),
    doc: (p) => docRef(p),
    collectionGroup: (n) => query({ path: n, group: true }),
    batch,
    runTransaction: async (fn) => {
      const t = batch();
      const tx = { get: (r) => r.get(), set: (r, v, o) => { t.set(r, v, o); return tx; }, update: (r, v, x) => { t.update(r, v, x); return tx; }, delete: (r) => { t.delete(r); return tx; } };
      const out = await fn(tx);
      await t.commit();
      return out;
    },
    enablePersistence: () => Promise.resolve(), settings() {}, enableNetwork: () => Promise.resolve(), disableNetwork: () => Promise.resolve(),
    clearPersistence: () => Promise.resolve(), waitForPendingWrites: () => Promise.resolve(),
  };

  const user = { uid, email: window.__AUDIT_EMAIL || (uid + '@example.com'), displayName: uid, emailVerified: true, isAnonymous: false, providerData: [{ providerId: 'password' }],
    metadata: { creationTime: new Date(Date.now() - 86400e3).toUTCString() },
    getIdToken: () => new Promise((r) => setTimeout(() => r('tok-' + uid), window.__TOKEN_DELAY || 0)), getIdTokenResult: () => Promise.resolve({ claims: {}, token: 'tok-' + uid }), reload: () => Promise.resolve() };
  const auth = {
    currentUser: user,
    onAuthStateChanged: (f) => { setTimeout(() => { try { f(user); } catch (e) { console.error('[shared-fs] auth handler', e && e.message); } }, window.__AUTH_DELAY || 20); return () => {}; },
    onIdTokenChanged: (f) => { setTimeout(() => f(user), (window.__AUTH_DELAY || 20) + 5); return () => {}; },
    setPersistence: () => Promise.resolve(), signOut: () => Promise.resolve(), useDeviceLanguage: () => {},
    signInWithPopup: () => Promise.reject(new Error('audit')), signInWithRedirect: () => Promise.resolve(), getRedirectResult: () => Promise.resolve({ user: null }),
    signInWithEmailLink: () => Promise.reject(new Error('audit')), isSignInWithEmailLink: () => false, sendSignInLinkToEmail: () => Promise.resolve(),
  };
  const fieldValue = {
    serverTimestamp: () => ({ __fv: 'st' }), increment: (n) => ({ __fv: 'inc', n }),
    arrayUnion: (...a) => ({ __fv: 'au', v: a.map(enc) }), arrayRemove: (...a) => ({ __fv: 'ar', v: a.map(enc) }), delete: () => ({ __fv: 'del' }),
  };
  const messaging = { getToken: () => Promise.resolve('fake-token-' + uid), onMessage() {}, deleteToken: () => Promise.resolve(), usePublicVapidKey() {}, requestPermission: () => Promise.resolve() };
  const storageRef = () => ({ child: storageRef, put: () => ({ on() {}, then: (f) => f({ ref: { getDownloadURL: () => Promise.resolve('https://x/y') } }) }), getDownloadURL: () => Promise.resolve('https://x/y'), delete: () => Promise.resolve() });
  const app = { name: '[DEFAULT]', options: {}, auth: () => auth, firestore: () => db, messaging: () => messaging, storage: () => ({ ref: storageRef }), delete: () => Promise.resolve() };
  const authFn = () => auth;
  authFn.GoogleAuthProvider = function () { this.addScope = () => {}; this.setCustomParameters = () => {}; };
  authFn.GoogleAuthProvider.credential = () => ({});
  authFn.Auth = { Persistence: { LOCAL: 'local', SESSION: 'session', NONE: 'none' } };
  const fsFn = () => db;
  fsFn.FieldValue = fieldValue;
  fsFn.Timestamp = Ts;
  fsFn.FieldPath = { documentId: () => '__name__' };
  fsFn.CACHE_SIZE_UNLIMITED = -1;
  window.firebase = {
    __fake: true, apps: [], SDK_VERSION: 'fake-shared',
    initializeApp: function () { window.firebase.apps.push(app); return app; },
    app: () => app, auth: authFn, firestore: fsFn, messaging: Object.assign(() => messaging, { isSupported: () => Promise.resolve(false) }), storage: () => ({ ref: storageRef }),
    analytics: () => ({ logEvent() {} }), appCheck: () => ({ activate() {} }),
  };
})();
