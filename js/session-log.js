/* One row per person per day. The desk reads it to see who came back. */
(function () {
  function dayKey() {
    try {
      return new Intl.DateTimeFormat('en-CA', {
        year: 'numeric', month: '2-digit', day: '2-digit',
      }).format(new Date());
    } catch (_) {
      return new Date().toISOString().slice(0, 10);
    }
  }
  let last = 0;
  async function beat() {
    if (typeof fbDb === 'undefined' || !fbDb) return;
    if (typeof currentUser === 'undefined' || !currentUser) return;
    const now = Date.now();
    if (now - last < 60000) return;
    last = now;
    const day = dayKey();
    const id = currentUser.uid + '_' + day;
    try {
      const ref = fbDb.collection('presenceDays').doc(id);
      const snap = await ref.get();
      const patch = { uid: currentUser.uid, day: day, lastAt: now };
      if (!snap.exists) patch.firstAt = now;
      await ref.set(patch, { merge: true });
    } catch (_) {
      last = 0;
    }
  }
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') beat();
  });
  setTimeout(beat, 2000);
  setInterval(beat, 60000);
})();
