/* ============================================================
   MODULE: js/chat-store.js
   On-phone Wireline database. OWNERSHIP: local history only.

   WhatsApp keeps chat history in SQLite on the handset. A PWA cannot
   open SQLite, so this is IndexedDB doing that job. Native Android can
   wrap the same rows in SQLite later without changing the shape.

   The server is a mailbox, not an archive: encrypted drops live in
   Firestore only until this phone copies them here, then they are
   deleted. Media blobs for Wireline live here too.

   Honest limits: a new phone starts empty unless a copy is imported.
   Private-mode browsers may fall back to memory and lose history on close.
   ============================================================ */
(function (root) {
  const DB_NAME = 'naluno-wire';
  const DB_VER = 1;
  const STORE_MSG = 'messages';
  const STORE_THREAD = 'threads';
  const STORE_MEDIA = 'media';
  const STORE_META = 'meta';
  const DROP_TTL_MS = 7 * 24 * 60 * 60 * 1000;

  const mem = { messages: {}, threads: {}, media: {}, meta: {} };
  let dbPromise = null;

  function hasIdb() {
    try { return typeof indexedDB !== 'undefined' && !!indexedDB; } catch (_) { return false; }
  }

  function openDb() {
    if (!hasIdb()) return Promise.resolve(null);
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve) {
      try {
        const req = indexedDB.open(DB_NAME, DB_VER);
        req.onupgradeneeded = function () {
          const db = req.result;
          if (!db.objectStoreNames.contains(STORE_MSG)) {
            const s = db.createObjectStore(STORE_MSG, { keyPath: 'id' });
            s.createIndex('threadId', 'threadId', { unique: false });
            s.createIndex('clientMsgId', 'clientMsgId', { unique: false });
            s.createIndex('otherUid', 'otherUid', { unique: false });
          }
          if (!db.objectStoreNames.contains(STORE_THREAD)) {
            db.createObjectStore(STORE_THREAD, { keyPath: 'threadId' });
          }
          if (!db.objectStoreNames.contains(STORE_MEDIA)) {
            db.createObjectStore(STORE_MEDIA, { keyPath: 'id' });
          }
          if (!db.objectStoreNames.contains(STORE_META)) {
            db.createObjectStore(STORE_META, { keyPath: 'key' });
          }
        };
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = function () { dbPromise = null; resolve(null); };
      } catch (_) {
        dbPromise = null;
        resolve(null);
      }
    });
    return dbPromise;
  }

  function idbReq(req) {
    return new Promise(function (resolve, reject) {
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }

  function clone(v) {
    if (v == null) return v;
    if (typeof v !== 'object') return v;
    try { return JSON.parse(JSON.stringify(v)); } catch (_) { return v; }
  }

  function msgKey(row) {
    if (row && row.id) return String(row.id);
    if (row && row.clientMsgId) return 'cmid:' + String(row.clientMsgId);
    return 'm' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
  }

  async function putMessage(row) {
    if (!row) return null;
    const rec = Object.assign({}, row);
    rec.id = msgKey(rec);
    rec.ts = Number(rec.ts) || Date.now();
    rec.savedAt = Date.now();
    if (rec.clientMsgId) rec.clientMsgId = String(rec.clientMsgId);
    const db = await openDb();
    if (!db) {
      mem.messages[rec.id] = clone(rec);
      return rec;
    }
    try {
      const tx = db.transaction(STORE_MSG, 'readwrite');
      await idbReq(tx.objectStore(STORE_MSG).put(rec));
    } catch (_) {
      mem.messages[rec.id] = clone(rec);
    }
    return rec;
  }

  async function getMessage(id) {
    if (!id) return null;
    const db = await openDb();
    if (!db) return clone(mem.messages[String(id)] || null);
    try {
      const tx = db.transaction(STORE_MSG, 'readonly');
      return (await idbReq(tx.objectStore(STORE_MSG).get(String(id)))) || null;
    } catch (_) {
      return clone(mem.messages[String(id)] || null);
    }
  }

  async function listMessages(threadId) {
    const db = await openDb();
    let rows = [];
    if (!db) {
      rows = Object.keys(mem.messages).map(function (k) { return mem.messages[k]; });
    } else {
      try {
        const tx = db.transaction(STORE_MSG, 'readonly');
        const store = tx.objectStore(STORE_MSG);
        if (threadId && store.indexNames.contains('threadId')) {
          rows = await idbReq(store.index('threadId').getAll(threadId));
        } else {
          rows = await idbReq(store.getAll());
        }
      } catch (_) {
        rows = Object.keys(mem.messages).map(function (k) { return mem.messages[k]; });
      }
    }
    if (threadId) rows = rows.filter(function (m) { return m && m.threadId === threadId; });
    rows.sort(function (a, b) { return (a.ts || 0) - (b.ts || 0); });
    return rows;
  }

  async function listAllMessages() {
    return listMessages(null);
  }

  async function deleteMessage(id) {
    if (!id) return;
    delete mem.messages[String(id)];
    const db = await openDb();
    if (!db) return;
    try {
      const tx = db.transaction(STORE_MSG, 'readwrite');
      await idbReq(tx.objectStore(STORE_MSG).delete(String(id)));
    } catch (_) {}
  }

  async function clearThread(threadId) {
    const rows = await listMessages(threadId);
    for (let i = 0; i < rows.length; i++) await deleteMessage(rows[i].id);
    if (threadId) {
      delete mem.threads[threadId];
      const db = await openDb();
      if (db) {
        try {
          const tx = db.transaction(STORE_THREAD, 'readwrite');
          await idbReq(tx.objectStore(STORE_THREAD).delete(threadId));
        } catch (_) {}
      }
    }
  }

  async function putThread(row) {
    if (!row || !row.threadId) return null;
    const rec = Object.assign({}, row);
    rec.updatedAt = Date.now();
    mem.threads[rec.threadId] = clone(rec);
    const db = await openDb();
    if (!db) return rec;
    try {
      const tx = db.transaction(STORE_THREAD, 'readwrite');
      await idbReq(tx.objectStore(STORE_THREAD).put(rec));
    } catch (_) {}
    return rec;
  }

  async function listThreads() {
    const db = await openDb();
    if (!db) {
      return Object.keys(mem.threads).map(function (k) { return clone(mem.threads[k]); });
    }
    try {
      const tx = db.transaction(STORE_THREAD, 'readonly');
      return await idbReq(tx.objectStore(STORE_THREAD).getAll());
    } catch (_) {
      return Object.keys(mem.threads).map(function (k) { return clone(mem.threads[k]); });
    }
  }

  async function putMedia(id, blob, meta) {
    if (!id || !blob) return;
    const rec = { id: String(id), blob: blob, meta: meta || {}, ts: Date.now(), bytes: blob.size || 0 };
    mem.media[rec.id] = rec;
    const db = await openDb();
    if (!db) return;
    try {
      const tx = db.transaction(STORE_MEDIA, 'readwrite');
      await idbReq(tx.objectStore(STORE_MEDIA).put(rec));
    } catch (_) {}
  }

  async function getMedia(id) {
    if (!id) return null;
    if (mem.media[String(id)]) return mem.media[String(id)];
    const db = await openDb();
    if (!db) return null;
    try {
      const tx = db.transaction(STORE_MEDIA, 'readonly');
      return (await idbReq(tx.objectStore(STORE_MEDIA).get(String(id)))) || null;
    } catch (_) { return null; }
  }

  async function setMeta(key, value) {
    const rec = { key: String(key), value: value, ts: Date.now() };
    mem.meta[rec.key] = rec;
    const db = await openDb();
    if (!db) return;
    try {
      const tx = db.transaction(STORE_META, 'readwrite');
      await idbReq(tx.objectStore(STORE_META).put(rec));
    } catch (_) {}
  }

  async function getMeta(key) {
    if (mem.meta[String(key)]) return mem.meta[String(key)].value;
    const db = await openDb();
    if (!db) return null;
    try {
      const tx = db.transaction(STORE_META, 'readonly');
      const rec = await idbReq(tx.objectStore(STORE_META).get(String(key)));
      return rec ? rec.value : null;
    } catch (_) { return null; }
  }

  function kindLabel(type) {
    const t = String(type || 'text');
    if (t === 'voice') return 'Voice note';
    if (t === 'photo') return 'Photo';
    if (t === 'video') return 'Video';
    if (t === 'document') return 'Document';
    if (t === 'mood') return 'A feeling';
    if (t === 'missed_call') return 'Missed call';
    if (t === 'system') return 'Notice';
    return 'Message';
  }

  async function exportBackup() {
    const messages = await listAllMessages();
    const threads = await listThreads();
    const slim = messages.map(function (m) {
      const copy = Object.assign({}, m);
      delete copy.dataUrl;
      delete copy.blob;
      return copy;
    });
    return {
      v: 1,
      kind: 'naluno-wire-backup',
      exportedAt: Date.now(),
      note: 'Chat history from this phone. Import on another Naluno install. Naluno does not keep a copy.',
      threads: threads,
      messages: slim,
    };
  }

  async function importBackup(pack) {
    if (!pack || pack.kind !== 'naluno-wire-backup' || !Array.isArray(pack.messages)) {
      throw new Error('Not a Naluno chat copy');
    }
    const msgs = pack.messages;
    for (let i = 0; i < msgs.length; i++) await putMessage(msgs[i]);
    const th = pack.threads || [];
    for (let j = 0; j < th.length; j++) await putThread(th[j]);
    return { messages: msgs.length, threads: th.length };
  }

  /* Memory-only reset for tests. */
  function _resetMem() {
    mem.messages = {};
    mem.threads = {};
    mem.media = {};
    mem.meta = {};
  }

  root.NalunoChatStore = {
    DROP_TTL_MS: DROP_TTL_MS,
    DB_NAME: DB_NAME,
    kindLabel: kindLabel,
    putMessage: putMessage,
    getMessage: getMessage,
    listMessages: listMessages,
    listAllMessages: listAllMessages,
    deleteMessage: deleteMessage,
    clearThread: clearThread,
    putThread: putThread,
    listThreads: listThreads,
    putMedia: putMedia,
    getMedia: getMedia,
    setMeta: setMeta,
    getMeta: getMeta,
    exportBackup: exportBackup,
    importBackup: importBackup,
    _resetMem: _resetMem,
    _mem: mem,
  };
})(typeof window !== 'undefined' ? window : globalThis);
