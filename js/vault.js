/* Private fields that used to live on the public users/{uid} doc
   (readable by every signed-in member). Call wake tokens stay public
   so existing call-notify keeps ringing. */
(function (root) {
  const KEYS = ['recoveryEmail', 'compassPasswordHash', 'e2eKeyBackup', '_consoleGate'];

  function uidOf(uid) {
    return uid || (root.currentUser && root.currentUser.uid) || '';
  }
  function ref(uid) {
    const u = uidOf(uid);
    if (!root.fbDb || !u) return null;
    return root.fbDb.collection('users').doc(u).collection('vault').doc('main');
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
  async function write(fields, uid) {
    const r = ref(uid);
    if (!r) return false;
    const patch = pick(fields);
    if (!Object.keys(patch).length) return true;
    await r.set(patch, { merge: true });
    return true;
  }
  async function load(uid) {
    const r = ref(uid);
    if (!r) return {};
    try {
      const s = await r.get();
      return s.exists ? (s.data() || {}) : {};
    } catch (_) { return {}; }
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
  function mergeInto(profile, vault) {
    if (!profile || !vault) return profile;
    KEYS.forEach(function (k) {
      if (vault[k] != null) profile[k] = vault[k];
    });
    return profile;
  }

  root.nalunoVault = {
    KEYS: KEYS,
    ref: ref,
    write: write,
    load: load,
    migrateFromPublic: migrateFromPublic,
    mergeInto: mergeInto,
    stripPublic: stripPublic,
  };
})(typeof window !== 'undefined' ? window : globalThis);
