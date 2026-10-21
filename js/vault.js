/* Private fields that used to live on the public users/{uid} doc
   (readable by every signed-in member). 14 Oct: push addresses too, now
   that both push workers read the vault (movePush). */
(function (root) {
  const KEYS = ['recoveryEmail', 'compassPasswordHash', 'e2eKeyBackup', '_consoleGate'];
  const PUSH_KEYS = ['fcmToken', 'fcmTokenWeb', 'fcmTokenAndroid', 'fcmTokenPlatform', 'fcmTokenUpdatedAt'];
  let cache = {};
  let loaded = false;
  let loadedFor = '';

  /* 15 Oct d: the app keeps fbDb, currentUser and currentProfile as script
     globals (let), which are NOT properties of window. Reading root.fbDb
     was always empty in the app, so nothing was ever written to the vault:
     since 14 Oct (push addresses vault-only) no phone could save its push
     address, and "enable notifications" failed. Read the globals first. */
  function dbNow() {
    try { if (typeof fbDb !== 'undefined' && fbDb) return fbDb; } catch (_) {}
    return root.fbDb || null;
  }
  function userNow() {
    try { if (typeof currentUser !== 'undefined' && currentUser) return currentUser; } catch (_) {}
    return root.currentUser || null;
  }
  function profileNow() {
    try { if (typeof currentProfile !== 'undefined' && currentProfile) return currentProfile; } catch (_) {}
    return root.currentProfile || null;
  }
  function uidOf(uid) {
    const u = userNow();
    return uid || (u && u.uid) || '';
  }
  function ref(uid) {
    const u = uidOf(uid);
    const db = dbNow();
    if (!db || !u) return null;
    return db.collection('users').doc(u).collection('vault').doc('main');
  }
  function isDeleteSentinel(v) {
    return !!(v && typeof v === 'object' && typeof v.isEqual === 'function');
  }
  function stripPublic() {
    const del = firebase.firestore.FieldValue.delete();
    const o = {};
    KEYS.forEach(function (k) { o[k] = del; });
    return o;
  }
  function pick(data) {
    const o = {};
    KEYS.forEach(function (k) {
      if (data && data[k] != null) o[k] = data[k];
    });
    return o;
  }
  function rememberLocal(fields) {
    Object.keys(fields || {}).forEach(function (k) {
      if (KEYS.indexOf(k) < 0 && PUSH_KEYS.indexOf(k) < 0) return;
      if (isDeleteSentinel(fields[k]) || fields[k] == null) delete cache[k];
      else cache[k] = fields[k];
    });
    if (profileNow()) mergeInto(profileNow(), cache);
  }
  function mergeInto(profile, vault) {
    if (!profile || !vault) return profile;
    KEYS.concat(PUSH_KEYS).forEach(function (k) {
      if (vault[k] != null) profile[k] = vault[k];
    });
    return profile;
  }
  /* Public profile snapshots must not wipe vault fields. Vault cache wins,
     then whatever was already in memory (just-set Compass lock). */
  function stitch(profile, previous) {
    if (!profile) return profile;
    KEYS.forEach(function (k) {
      if (cache[k] != null) profile[k] = cache[k];
      else if (profile[k] == null && previous && previous[k] != null) profile[k] = previous[k];
    });
    return profile;
  }
  function get(key) {
    if (cache[key] != null) return cache[key];
    const prof = profileNow();
    if (prof && prof[key] != null) return prof[key];
    return null;
  }
  function acceptSnapshot(data) {
    cache = data && typeof data === 'object' ? Object.assign({}, data) : {};
    loaded = true;
    loadedFor = uidOf();
    if (profileNow()) mergeInto(profileNow(), cache);
    return cache;
  }
  function pushDeviceKey() {
    try {
      let k = localStorage.getItem('nalunoPushDevice');
      if (!k || !/^[a-z0-9]{6,24}$/.test(k)) {
        k = 'w' + Math.random().toString(36).slice(2, 12) + Date.now().toString(36).slice(-4);
        localStorage.setItem('nalunoPushDevice', k);
      }
      return k;
    } catch (_) { return ''; }
  }
  async function writePush(fields, uid) {
    const r = ref(uid);
    if (!r) return false;
    const patch = {};
    PUSH_KEYS.forEach(function (k) {
      if (fields && fields[k] != null) patch[k] = fields[k];
    });
    if (!Object.keys(patch).length) return true;
    rememberLocal(patch);
    /* 21 Oct e: this browser's own slot as well, so each device keeps its
       alerts (the single fcmTokenWeb went to whichever opened last). */
    const write = Object.assign({}, patch);
    if (typeof patch.fcmTokenWeb === 'string' && patch.fcmTokenWeb) {
      const dev = pushDeviceKey();
      if (dev) {
        write.webPush = {};
        write.webPush[dev] = { t: patch.fcmTokenWeb, at: Date.now() };
      }
    }
    try {
      await r.set(write, { merge: true });
      return true;
    } catch (_) { return false; }
  }
  /* 14 Oct: push addresses are kept only in the vault (owner + desk), which
     both push workers read. They used to sit on the public profile, which
     every signed-in member can read. Written to the vault first; only once
     that is saved are the public copies removed, so a phone never loses its
     wake-up. */
  async function movePush(fields, uid) {
    const ok = await writePush(fields, uid);
    if (!ok) return false;
    const u = uidOf(uid);
    if (u && dbNow() && typeof firebase !== 'undefined') {
      const del = firebase.firestore.FieldValue.delete();
      try { await dbNow().collection('users').doc(u).set({ fcmToken: del, fcmTokenWeb: del, fcmTokenAndroid: del }, { merge: true }); } catch (_) {}
    }
    return true;
  }
  async function write(fields, uid) {
    const r = ref(uid);
    if (!r) return false;
    const patch = pick(fields);
    if (!Object.keys(patch).length) return true;
    rememberLocal(patch);
    await r.set(patch, { merge: true });
    return true;
  }
  async function load(uid) {
    const r = ref(uid);
    if (!r) return {};
    try {
      const s = await r.get();
      const data = s.exists ? (s.data() || {}) : {};
      acceptSnapshot(data);
      return data;
    } catch (_) { return cache; }
  }
  /* 15 Oct d: this never ran in the app (see dbNow). Now that it can, it
     only COPIES private fields from the public profile into the vault, if
     the vault does not already have them. It does not delete anything from
     the public profile: removing data is a decision for you, not something
     a phone does silently on first open. */
  async function migrateFromPublic(data, uid) {
    /* Only once the vault itself has been read (so nothing in it is ever
       overwritten by an older public copy), and never the console's gate. */
    if (!loaded || !loadedFor || loadedFor !== uidOf(uid)) return false;
    const move = pick(data);
    delete move._consoleGate;
    Object.keys(move).forEach(function (k) { if (cache[k] != null) delete move[k]; });
    if (!Object.keys(move).length) return false;
    try {
      return !!(await write(move, uid));
    } catch (_) { return false; }
  }

  root.nalunoVault = {
    KEYS: KEYS,
    PUSH_KEYS: PUSH_KEYS,
    ref: ref,
    write: write,
    writePush: writePush,
    movePush: movePush,
    load: load,
    migrateFromPublic: migrateFromPublic,
    mergeInto: mergeInto,
    stitch: stitch,
    get: get,
    acceptSnapshot: acceptSnapshot,
    stripPublic: stripPublic,
    get _cache() { return cache; },
  };
})(typeof window !== 'undefined' ? window : globalThis);
