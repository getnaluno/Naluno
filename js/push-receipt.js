/* Handed = we gave the alert to the push service.
   Arrived = this phone showed it. Opened = the person tapped it.
   The phone writes only its own arrival. */
function nalunoPushId() {
  return 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function nalunoNotePush(info) {
  if (typeof fbDb === 'undefined' || !fbDb) return;
  if (typeof currentUser === 'undefined' || !currentUser) return;
  if (!info || !info.pingId) return;
  const http = Number(info.httpStatus) || 0;
  const status = http >= 200 && http < 300 ? 'handed' : 'failed';
  fbDb.collection('pushPings').doc(String(info.pingId)).set({
    fromUid: currentUser.uid,
    toUid: String(info.toUid || ''),
    type: String(info.type || '').slice(0, 40),
    pingId: String(info.pingId),
    status: status,
    httpStatus: http,
    sentAt: Date.now(),
  }).catch(function () {});
}

function nalunoSaveReceipt(row) {
  if (!row || typeof fbDb === 'undefined' || !fbDb) return;
  if (typeof currentUser === 'undefined' || !currentUser) return;
  const key = String(row.pingId || row.id || row.arrivedAt || '');
  if (!key) return;
  const id = currentUser.uid + '_' + key.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80);
  const patch = {
    uid: currentUser.uid,
    pingId: String(row.pingId || ''),
    type: String(row.type || '').slice(0, 40),
    arrivedAt: Number(row.arrivedAt) || Date.now(),
  };
  if (Number(row.openedAt) > 0) patch.openedAt = Number(row.openedAt);
  fbDb.collection('pushReceipts').doc(id).set(patch, { merge: true }).catch(function () {});
}

async function nalunoFlushPushCache() {
  if (typeof caches === 'undefined') return;
  try {
    const cache = await caches.open('naluno-push-receipts');
    const keys = await cache.keys();
    for (let i = 0; i < keys.length; i++) {
      const res = await cache.match(keys[i]);
      const row = res ? await res.json().catch(function () { return null; }) : null;
      if (row) nalunoSaveReceipt(row);
      await cache.delete(keys[i]);
    }
  } catch (_) {}
}

function nalunoOnPushMessage(event) {
  const data = event && event.data;
  if (!data || (data.type !== 'naluno-push-arrived' && data.type !== 'naluno-push-opened')) return;
  const row = data.row || {};
  if (data.type === 'naluno-push-opened') row.openedAt = Date.now();
  nalunoSaveReceipt(row);
}

if (typeof navigator !== 'undefined' && navigator.serviceWorker) {
  navigator.serviceWorker.addEventListener('message', nalunoOnPushMessage);
}
window.addEventListener('message', nalunoOnPushMessage);
setTimeout(function () { nalunoFlushPushCache(); }, 2500);
