/* Private fields that used to live on the public users/{uid} doc
   (readable by every signed-in member). Call wake tokens stay public
   so existing call-notify keeps ringing. */
(function (root) {
  const KEYS = ['recoveryEmail', 'compassPasswordHash', 'e2eKeyBackup', '_consoleGate'];
  const PUSH_KEYS = ['fcmToken', 'fcmTokenWeb', 'fcmTokenAndroid', 'fcmTokenPlatform', 'fcmTokenUpdatedAt'];
  let cache = {};

  function uidOf(uid) {
    return uid || (root.currentUser && root.currentUser.uid) || '';
  }
  function ref(uid) {
    const u = uidOf(uid);
    if (!root.fbDb || !u) return null;
    return root.fbDb.collection('users').doc(u).collection('vault').doc('main');
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
    if (root.currentProfile) mergeInto(root.currentProfile, cache);
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
    if (root.currentProfile && root.currentProfile[key] != null) return root.currentProfile[key];
    return null;
  }
  function acceptSnapshot(data) {
    cache = data && typeof data === 'object' ? Object.assign({}, data) : {};
    if (root.currentProfile) mergeInto(root.currentProfile, cache);
    return cache;
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
    try {
      await r.set(patch, { merge: true });
      return true;
    } catch (_) { return false; }
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
  async function migrateFromPublic(data, uid) {
    const move = pick(data);
    if (!Object.keys(move).length) return false;
    try {
      await write(move, uid);
      const u = uidOf(uid);
      if (u && root.fbDb) await root.fbDb.collection('users').doc(u).set(stripPublic(), { merge: true });
      return true;
    } catch (_) { return false; }
  }

  root.nalunoVault = {
    KEYS: KEYS,
    PUSH_KEYS: PUSH_KEYS,
    ref: ref,
    write: write,
    writePush: writePush,
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
