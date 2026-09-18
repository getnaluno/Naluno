/* ============================================================
   MODULE: js/wire-mailbox.js
   Encrypted Wireline drops. OWNERSHIP: server is a mailbox.

   A drop sits in wireDrop/{recipientUid}/inbox/{clientMsgId} until that
   phone copies it into chat-store.js, then the drop is deleted.
   Receipts travel the other way. Nothing here is the chat archive.
   ============================================================ */
(function (root) {
  let inboxUnsub = null;
  let receiptUnsub = null;
  const taking = {};

  function store() {
    return (typeof NalunoChatStore !== 'undefined') ? NalunoChatStore : null;
  }
  function ttlMs() {
    const S = store();
    return (S && S.DROP_TTL_MS) || (7 * 24 * 60 * 60 * 1000);
  }
  function kindLabel(type) {
    const S = store();
    if (S && S.kindLabel) return S.kindLabel(type);
    return 'Message';
  }
  function contactIdForUid(uid) {
    try {
      if (typeof contacts === 'undefined' || !contacts) return null;
      const c = contacts.find(function (x) { return x.firebaseUid === uid; });
      return c ? c.id : null;
    } catch (_) { return null; }
  }
  function persistRow(contactId, msg, otherUid) {
    try {
      if (typeof persistWireRow === 'function') persistWireRow(contactId, msg, otherUid);
    } catch (_) {}
  }

  function dropBody(otherUid, tid, cmid, wire, kind) {
    const encrypted = !!wire.encrypted;
    const body = {
      from: currentUser.uid,
      to: otherUid,
      threadId: tid,
      clientMsgId: String(cmid),
      ts: Date.now(),
      expiresAt: Date.now() + ttlMs(),
      type: kind || wire.type || 'text',
      encrypted: encrypted,
    };
    if (encrypted) {
      if (wire.envelopes) body.envelopes = wire.envelopes;
      if (wire.ciphertext) body.ciphertext = wire.ciphertext;
      if (wire.iv) body.iv = wire.iv;
      if (wire.senderPub) body.senderPub = wire.senderPub;
      if (wire.kdf) body.kdf = wire.kdf;
    } else if (wire.text) {
      body.text = wire.text;
    }
    ['mediaUrl', 'mime', 'fileName', 'duration', 'waveform', 'mood', 'callId', 'callerUid', 'calleeUid', 'targetClientMsgId', 'reaction'].forEach(function (k) {
      if (wire[k] != null) body[k] = wire[k];
    });
    if (wire.system) body.system = true;
    return body;
  }

  async function sendDrop(otherUid, tid, cmid, wire, kind) {
    if (!fbDb || !currentUser || !otherUid || !cmid) throw new Error('Mailbox is not ready');
    const body = dropBody(otherUid, tid, cmid, wire, kind);
    if (body.type === 'reaction') {
      await fbDb.collection('wireDrop').doc(otherUid).collection('inbox').doc(String(cmid)).set(body);
      return;
    }
    const threadPatch = {
      participants: [currentUser.uid, otherUid].sort(),
      lastMessageAt: firebase.firestore.FieldValue.serverTimestamp(),
      lastKind: kind || wire.type || 'text',
      lastMessageText: kindLabel(kind || wire.type || 'text'),
      lastMessageFrom: body.system ? 'system' : currentUser.uid,
      readBy: [currentUser.uid],
    };
    await fbDb.collection('threads').doc(tid).set(threadPatch, { merge: true });
    await fbDb.collection('wireDrop').doc(otherUid).collection('inbox').doc(String(cmid)).set(body);
  }

  function writeReceipt(senderUid, cmid, status) {
    if (!fbDb || !currentUser || !senderUid || !cmid) return;
    fbDb.collection('wireDrop').doc(senderUid).collection('receipts').doc(String(cmid)).set({
      from: currentUser.uid,
      clientMsgId: String(cmid),
      status: status,
      ts: Date.now(),
    }).catch(function () {});
  }

  async function takeDrop(doc) {
    if (!doc || !currentUser) return;
    const id = doc.id;
    if (taking[id]) return;
    taking[id] = 1;
    try {
      const m = doc.data() || {};
      const ts = Number(m.ts) || Date.now();
      if ((m.expiresAt && Date.now() > Number(m.expiresAt)) || (Date.now() - ts > ttlMs())) {
        doc.ref.delete().catch(function () {});
        return;
      }
      if (m.type === 'reaction' && m.targetClientMsgId) {
        if (typeof applyLocalReaction === 'function') {
          applyLocalReaction(m.from, m.targetClientMsgId, m.reaction);
        }
        doc.ref.delete().catch(function () {});
        return;
      }
      const fromUid = m.from;
      let text = m.text;
      if (m.encrypted) {
        try {
          const opener = (typeof nalunoOpenSealed === 'function') ? nalunoOpenSealed : decryptWirelineMessage;
          const c = (typeof contacts !== 'undefined' && contacts)
            ? (contacts.find(function (x) { return x.firebaseUid === fromUid; }) || { firebaseUid: fromUid })
            : { firebaseUid: fromUid };
          const decrypted = await opener(m, c);
          if (decrypted != null) text = decrypted;
          else if (!text) {
            text = (typeof NALUNO_SEAL_FAIL === 'string')
              ? NALUNO_SEAL_FAIL
              : 'Couldn\u2019t read this on this phone. Ask them to send it again.';
          }
        } catch (_) {}
      }
      const cmid = m.clientMsgId || doc.id;
      const contactId = contactIdForUid(fromUid) != null ? contactIdForUid(fromUid) : fromUid;
      const isSys = m.type === 'missed_call' || m.type === 'system' || m.system === true;
      const open = contactId != null && typeof activeThreadContactId !== 'undefined' && activeThreadContactId === contactId;
      if (m.type === 'missed_call' && m.callId && contactId != null && typeof wirelineThreads !== 'undefined') {
        const already = (wirelineThreads[contactId] || []).some(function (row) {
          return row && row.type === 'missed_call' && String(row.callId) === String(m.callId);
        });
        if (already) {
          doc.ref.delete().catch(function () {});
          if (fromUid) writeReceipt(fromUid, cmid, open ? 'read' : 'delivered');
          return;
        }
      }
      const row = {
        id: doc.id,
        from: isSys ? 'system' : 'them',
        type: m.type || 'text',
        text: text,
        mood: m.mood,
        waveform: m.waveform,
        duration: m.duration,
        mediaUrl: m.mediaUrl || null,
        mime: m.mime || null,
        fileName: m.fileName || null,
        vaultKey: m.mediaUrl && typeof vaultKeyForUrl === 'function' ? vaultKeyForUrl(m.mediaUrl) : null,
        callId: m.callId || null,
        callerUid: m.callerUid || null,
        calleeUid: m.calleeUid || null,
        clientMsgId: cmid,
        ts: ts,
        status: open ? 'read' : 'delivered',
        read: !!open,
        reaction: m.reaction,
      };
      if (contactId != null) persistRow(contactId, row, fromUid);
      if (fromUid && typeof realThreadPreviews !== 'undefined') {
        realThreadPreviews[fromUid] = {
          text: row.text ? String(row.text).slice(0, 80) : kindLabel(row.type),
          ts: row.ts,
          fromMe: false,
          unread: !open,
        };
      }
      try { if (typeof renderThreadMessages === 'function' && open) renderThreadMessages(); } catch (_) {}
      try { if (typeof renderWirelineList === 'function') renderWirelineList(); } catch (_) {}
      if (row.mediaUrl && typeof vaultIngestUrl === 'function') {
        const remote = (typeof resolveMediaUrl === 'function') ? resolveMediaUrl(row.mediaUrl) : row.mediaUrl;
        vaultIngestUrl(remote, row.vaultKey).catch(function () {});
      }
      doc.ref.delete().catch(function () {});
      if (fromUid) writeReceipt(fromUid, cmid, open ? 'read' : 'delivered');
    } finally {
      delete taking[id];
    }
  }

  async function takeReceipt(doc) {
    if (!doc) return;
    const m = doc.data() || {};
    const cmid = String(m.clientMsgId || doc.id);
    const status = m.status || 'delivered';
    try {
      if (typeof wirelineThreads !== 'undefined') {
        Object.keys(wirelineThreads).forEach(function (cid) {
          (wirelineThreads[cid] || []).forEach(function (row) {
            if (!row) return;
            if (String(row.clientMsgId) === cmid || String(row.id) === cmid) row.status = status;
          });
        });
      }
    } catch (_) {}
    try {
      const S = store();
      if (S) {
        const all = await S.listAllMessages();
        for (let i = 0; i < all.length; i++) {
          if (String(all[i].clientMsgId) === cmid || String(all[i].id) === cmid) {
            all[i].status = status;
            await S.putMessage(all[i]);
          }
        }
      }
    } catch (_) {}
    try { if (typeof renderThreadMessages === 'function') renderThreadMessages(); } catch (_) {}
    doc.ref.delete().catch(function () {});
  }

  function startMailbox() {
    if (!fbDb || !currentUser) return;
    try { if (typeof hydrateWirelineFromStore === 'function') hydrateWirelineFromStore(); } catch (_) {}
    if (inboxUnsub) { try { inboxUnsub(); } catch (_) {} inboxUnsub = null; }
    if (receiptUnsub) { try { receiptUnsub(); } catch (_) {} receiptUnsub = null; }
    const box = fbDb.collection('wireDrop').doc(currentUser.uid);
    inboxUnsub = box.collection('inbox').onSnapshot(function (snap) {
      snap.docChanges().forEach(function (ch) {
        if (ch.type === 'removed') return;
        takeDrop(ch.doc).catch(function () {});
      });
    }, function () {});
    receiptUnsub = box.collection('receipts').onSnapshot(function (snap) {
      snap.docChanges().forEach(function (ch) {
        if (ch.type === 'removed') return;
        takeReceipt(ch.doc).catch(function () {});
      });
    }, function () {});
  }

  async function importLegacyOnce(contactId, otherUid) {
    if (!fbDb || !otherUid || !currentUser) return;
    const S = store();
    if (!S) return;
    const tid = (typeof realThreadId === 'function') ? realThreadId(otherUid) : null;
    if (!tid) return;
    const flag = 'legacy:' + tid;
    try { if (await S.getMeta(flag)) return; } catch (_) {}
    try {
      const snap = await fbDb.collection('threads').doc(tid).collection('messages').orderBy('ts', 'asc').limit(200).get();
      const uid = currentUser.uid;
      for (let i = 0; i < snap.docs.length; i++) {
        const d = snap.docs[i];
        const m = d.data() || {};
        let text = m.text;
        if (m.encrypted) {
          try {
            const opener = (typeof nalunoOpenSealed === 'function') ? nalunoOpenSealed : decryptWirelineMessage;
            const c = (typeof contacts !== 'undefined' && contacts)
              ? contacts.find(function (x) { return x.id === contactId; })
              : null;
            const decrypted = await opener(m, c);
            if (decrypted != null) text = decrypted;
          } catch (_) {}
        }
        const isSys = m.type === 'missed_call' || m.type === 'system' || m.system === true;
        persistRow(contactId, {
          id: d.id,
          from: isSys ? 'system' : (m.from === uid ? 'me' : 'them'),
          type: m.type || 'text',
          text: text,
          mood: m.mood,
          waveform: m.waveform,
          duration: m.duration,
          mediaUrl: m.mediaUrl || null,
          mime: m.mime || null,
          fileName: m.fileName || null,
          callId: m.callId || null,
          callerUid: m.callerUid || null,
          calleeUid: m.calleeUid || null,
          clientMsgId: m.clientMsgId || d.id,
          ts: m.ts && m.ts.toMillis ? m.ts.toMillis() : (Number(m.ts) || Date.now()),
          status: m.status || 'sent',
          reaction: m.reaction,
        }, otherUid);
      }
      await S.setMeta(flag, Date.now());
    } catch (_) {}
  }

  async function saveCopy() {
    const S = store();
    if (!S) throw new Error('Chat store is not ready');
    const pack = await S.exportBackup();
    const blob = new Blob([JSON.stringify(pack)], { type: 'application/json' });
    try { await S.setMeta('lastBackupAt', Date.now()); } catch (_) {}
    try { await S.setMeta('lastBackupBytes', blob.size); } catch (_) {}
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'naluno-wire-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      try { a.remove(); } catch (_) {}
      try { URL.revokeObjectURL(url); } catch (_) {}
    }, 500);
    return pack;
  }

  async function loadCopy(file) {
    const S = store();
    if (!S) throw new Error('Chat store is not ready');
    const text = await file.text();
    const pack = JSON.parse(text);
    const out = await S.importBackup(pack);
    try { if (typeof hydrateWirelineFromStore === 'function') await hydrateWirelineFromStore(); } catch (_) {}
    return out;
  }

  root.NalunoWireMailbox = {
    kindLabel: kindLabel,
    sendDrop: sendDrop,
    writeReceipt: writeReceipt,
    startMailbox: startMailbox,
    importLegacyOnce: importLegacyOnce,
    saveCopy: saveCopy,
    loadCopy: loadCopy,
    ttlMs: ttlMs,
  };
})(typeof window !== 'undefined' ? window : globalThis);
