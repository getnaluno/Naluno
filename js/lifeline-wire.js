/* ============================================================
   MODULE: js/lifeline-wire.js   —   connects Lifeline to Wireline

   Sending: when a text message cannot go out normally (offline, or the
   write times out because Naluno/Google is blocked), wireline.js still
   queues it for later AND hands it here. Lifeline then:
     - drops it at the relay, if any internet is left;
     - gives it to the mesh, if the Android app's mesh is running;
     - keeps it ready to send by SMS, one tap away in the thread.
   The SAME clientMsgId is used by every route and by the normal queue, so
   when the internet returns and the ordinary copy arrives too, the thread
   shows the message once.

   Receiving: relay pick-ups (polled), mesh deliveries, and SMS imports
   (shared into Naluno, or pasted) all land in the thread the same way.
   ============================================================ */
(function (root) {
  'use strict';
  var L = root.NalunoLifeline;
  if (!L) return;
  var OUTBOX = 'nalunoLifelineOutbox', SEEN = 'nalunoLifelineSeen';
  var TTL = 72 * 3600 * 1000;

  function store(k, v) { try { root.localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} }
  function load(k, d) { try { var x = JSON.parse(root.localStorage.getItem(k) || 'null'); return x == null ? d : x; } catch (_) { return d; } }
  function T(s) { try { if (typeof root.toast === 'function') root.toast(s); } catch (_) {} }

  /* ---------------- 1. keep every contact's key ----------------
     Wrap fetchUserPublicKey so each key Naluno learns while online is kept
     for the day it goes offline. Without this, a restart during a shutdown
     would leave nothing to seal with. */
  function seedKeyring() {
    try {
      (root.contacts || []).forEach(function (c) {
        if (c && c.firebaseUid && c.publicKey) L.keyringPut(c.firebaseUid, c.publicKey);
      });
    } catch (_) {}
  }
  if (typeof root.fetchUserPublicKey === 'function' && !root.fetchUserPublicKey.__lifeline) {
    var orig = root.fetchUserPublicKey;
    var wrapped = async function (uid, force) {
      var jwk = await orig(uid, force);
      if (jwk) L.keyringPut(uid, jwk);
      return jwk;
    };
    wrapped.__lifeline = true;
    root.fetchUserPublicKey = wrapped;
  }

  /* ---------------- 2. outbox ---------------- */
  function outbox() {
    var now = Date.now();
    return load(OUTBOX, []).filter(function (x) { return x && now - x.at < TTL; });
  }
  function saveOutbox(list) { store(OUTBOX, list); try { renderBar(); } catch (_) {} }
  function contactFor(uid) {
    return (root.contacts || []).find(function (c) { return c && c.firebaseUid === uid; }) || null;
  }

  /* Called by wireline.js whenever a TEXT message falls back to the queue. */
  async function handoff(contact, payload, clientMsgId) {
    if (!contact || !contact.firebaseUid || !payload || payload.type !== 'text' || !payload.text) return;
    if (outbox().some(function (x) { return x.cmid === clientMsgId; })) return;
    var s = await L.seal(contact.firebaseUid, payload.text, clientMsgId, Date.now());
    if (!s.ok) {
      /* Refuse rather than send readable text through strangers or SMS. */
      T('Queued. Lifeline can\u2019t send this privately yet \u2014 open ' + (contact.name || 'this chat')
        + ' once while online so Naluno can store their key.');
      return;
    }
    var entry = { cmid: clientMsgId, uid: contact.firebaseUid, p: L.b64u(s.bytes), at: Date.now(), routes: {} };
    try {
      await L.relayDrop(s.bytes);
      entry.routes.relay = Date.now();
    } catch (_) { /* no internet at all: mesh and SMS still work */ }
    if (mesh.router) { mesh.router.accept(s.bytes, 8); entry.routes.mesh = Date.now(); meshKick(); }
    var list = outbox(); list.push(entry); saveOutbox(list);
    T(entry.routes.relay ? 'Sent inside Naluno' : 'Held in Naluno — it sends when you are back online');
  }

  /* ---------------- 3. SMS ---------------- */
  /* The SMS carries a TAPPABLE LINK, not a blob of characters.

     It used to send the sealed packet as raw text, so the person receiving it
     had to notice it was a Naluno message, open Naluno, find "Open a Naluno
     SMS" and paste it in. That is a poor way to receive word from someone you
     are worried about, and it pushed the moment of receiving outside Naluno.

     The recipient is the FINAL destination — the packet is sealed for them
     alone, and nobody carrying it can open it — so there is no reason for
     them to unseal it by hand. Tapping the link opens Naluno and the message
     lands in the right conversation.

     Cost: the link adds about 30 characters, so a short message becomes two
     SMS instead of one. A tap instead of copy-and-paste is worth a segment.
     Pasting still works, for a phone that strips links. */
  var LINK_BASE = 'https://getnaluno.com/?ll=';
  function smsLineFor(packetB64) { return LINK_BASE + packetB64; }
  function smsBodyFor(uid) {
    var rows = outbox().filter(function (x) { return x.uid === uid; });
    if (!rows.length) return '';
    return 'Naluno message \u2014 tap to open:\n'
      + rows.map(function (x) { return smsLineFor(x.p); }).join('\n');
  }
  function smsHref(body) {
    // iOS wants "&body=", Android "?body=".
    var ios = /iPad|iPhone|iPod/.test(navigator.userAgent || '');
    return 'sms:' + (ios ? '&' : '?') + 'body=' + encodeURIComponent(body);
  }
  function extractAll(text) {
    // Accepts both: a tapped or pasted link, and the older raw "Naluno:…".
    var out = [], s = String(text || '').replace(/https?:\/\/[^\s]*[?&]ll=/g, 'Naluno:');
    var re = /Naluno:([A-Za-z0-9_-]{40,})/g, m;
    while ((m = re.exec(s))) { try { out.push(L.unb64u(m[1])); } catch (_) {} }
    return out;
  }

  /* ---------------- 4. receiving ---------------- */
  var tagCache = { day: -1, idx: null, n: 0 };
  async function myIndex() {
    var uids = (root.contacts || []).filter(function (c) { return c && c.firebaseUid && L.keyringGet(c.firebaseUid); })
      .map(function (c) { return c.firebaseUid; });
    var day = L.dayIndex();
    if (tagCache.idx && tagCache.day === day && tagCache.n === uids.length) return tagCache.idx;
    tagCache = { day: day, idx: await L.myTagIndex(uids), n: uids.length };
    if (mesh.router) mesh.router.setMyTags(Object.keys(tagCache.idx));
    return tagCache.idx;
  }
  async function receive(bytes, via) {
    var id = L.hex(bytes.slice(13, 21));
    var seen = load(SEEN, {});
    if (seen[id]) return false;
    var o = await L.open(bytes, await myIndex());
    if (!o || !o.text) return false;
    seen[id] = Date.now();
    var ks = Object.keys(seen); if (ks.length > 3000) ks.slice(0, ks.length - 3000).forEach(function (k) { delete seen[k]; });
    store(SEEN, seen);
    var c = contactFor(o.from); if (!c) return false;
    var row = { id: 'll-' + o.clientMsgId, from: 'them', type: 'text', text: o.text, ts: o.sentAt || Date.now(),
                status: 'delivered', clientMsgId: o.clientMsgId, via: 'lifeline-' + via };
    try {
      // Pre-fill the decrypt cache so, if the ordinary copy also arrives when
      // the internet returns, it shows instantly and merges into this row.
      if (root.wirelineDecryptCache) { root.wirelineDecryptCache['cmid:' + o.clientMsgId] = o.text;
        if (typeof root.persistWirelineDecryptCache === 'function') root.persistWirelineDecryptCache(); }
    } catch (_) {}
    if (typeof root.persistWireRow === 'function') root.persistWireRow(c.id, row, o.from);
    try {
      if (root.realThreadPreviews) root.realThreadPreviews[o.from] = { text: o.text, ts: row.ts, fromMe: false, unread: true };
      if (typeof root.renderWirelineList === 'function') root.renderWirelineList();
      if (root.activeThreadContactId === c.id && typeof root.renderThreadMessages === 'function') root.renderThreadMessages();
    } catch (_) {}
    T('Message from ' + (c.name || 'a frequency') + ' arrived by ' + (via === 'sms' ? 'SMS' : via));
    return true;
  }
  async function pollRelay() {
    try {
      if (typeof root.currentUser === 'undefined' || !root.currentUser) return;
      var idx = await myIndex(); var tags = Object.keys(idx); if (!tags.length) return;
      var pk = await L.relayPick(tags);
      for (var i = 0; i < pk.length; i++) await receive(pk[i], 'relay');
    } catch (_) { /* relay unreachable too: mesh and SMS remain */ }
  }
  async function importSmsText(text) {
    var pk = extractAll(text), n = 0;
    for (var i = 0; i < pk.length; i++) if (await receive(pk[i], 'sms')) n++;
    if (!pk.length) T('No Naluno message found in that text');
    else if (!n) T('Already received, or not addressed to you');
    return n;
  }

  /* ---------------- 5. mesh (Android app) ----------------
     The native NalunoMesh plugin finds nearby phones and moves bytes; the
     decisions are made here by the router. Nothing happens in a browser. */
  var mesh = { router: null, plugin: null };
  function meshPlugin() {
    try { return root.Capacitor && root.Capacitor.Plugins && root.Capacitor.Plugins.NalunoMesh; } catch (_) { return null; }
  }
  function meshKick() {
    try { if (mesh.plugin) mesh.plugin.broadcastSummary({ s: JSON.stringify(mesh.router.summary()) }); } catch (_) {}
  }
  async function startMesh() {
    var p = meshPlugin(); if (!p || mesh.router) return false;
    mesh.plugin = p;
    mesh.router = new L.MeshRouter({ onDeliver: function (bytes) { receive(bytes, 'mesh'); } });
    await myIndex();
    outbox().forEach(function (x) { try { mesh.router.accept(L.unb64u(x.p), 8); } catch (_) {} });
    p.addListener('peerSummary', function (ev) {
      try {
        var theirs = JSON.parse(ev.s);
        mesh.router.offerTo(theirs).forEach(function (o) {
          p.sendPacket({ peer: ev.peer, p: L.b64u(o.bytes), copies: o.copies });
        });
      } catch (_) {}
    });
    p.addListener('packet', function (ev) {
      try { mesh.router.accept(L.unb64u(ev.p), Number(ev.copies) || 1); } catch (_) {}
    });
    p.addListener('peerConnected', function (ev) {
      try { p.sendSummary({ peer: ev.peer, s: JSON.stringify(mesh.router.summary()) }); } catch (_) {}
    });
    await p.start();
    return true;
  }

  /* ---------------- 6. the thread bar ----------------
     Only appears when this chat has messages waiting for the internet. */
  function renderBar() {
    var bar = root.document && root.document.getElementById('lifelineBar');
    if (!bar) return;
    var cid = root.activeThreadContactId;
    var c = (root.contacts || []).find(function (x) { return x && x.id === cid; });
    var n = 0;
    try {
      var q = (typeof root.getMessageQueue === 'function') ? root.getMessageQueue() : [];
      n = q.filter(function (x) { return c && String(x.contactId) === String(c.id); }).length;
    } catch (_) {}
    if (!n && c) n = outbox().filter(function (x) { return x.uid === c.firebaseUid; }).length;
    if (!n) { bar.style.display = 'none'; return; }
    bar.style.display = 'flex';
    bar.innerHTML = '<span class="ll-text">' + n + (n === 1 ? ' message is' : ' messages are')
      + ' waiting in Naluno. It stays in this chat and sends when this phone is back online.</span>'
      + '<button type="button" class="ll-btn" id="llTryNow">Try now</button>';
    var go = bar.querySelector('#llTryNow');
    if (go) go.onclick = function () {
      try { if (typeof root.flushMessageQueue === 'function') root.flushMessageQueue(); } catch (_) {}
    };
  }

  /* ---------------- wiring ---------------- */
  function boot() {
    seedKeyring();
    renderBar();
    // Share target: "Share -> Naluno" on a received SMS opens /app/?lifeline_text=...
    try {
      var q = new URLSearchParams(root.location.search);
      var linked = q.get('ll');
      var shared = q.get('lifeline_text') || q.get('text');
      if (linked) shared = L.SMS_PREFIX + linked;   // tapped straight from an SMS
      if (shared && shared.indexOf(L.SMS_PREFIX) >= 0) {
        var wait = setInterval(function () {
          if (root.currentUser && (root.contacts || []).length) { clearInterval(wait); importSmsText(shared); }
        }, 800);
        setTimeout(function () { clearInterval(wait); }, 60000);
      }
    } catch (_) {}
    setInterval(function () { seedKeyring(); if (!root.document.hidden) pollRelay(); }, 90000);
    root.addEventListener('online', function () { setTimeout(pollRelay, 1500); });
    root.document.addEventListener('visibilitychange', function () { if (!root.document.hidden) pollRelay(); });
    setTimeout(pollRelay, 8000);
    setTimeout(startMesh, 4000);
  }
  if (root.document) {
    if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', boot);
    else boot();
  }

  root.nalunoLifelineHandoff = handoff;
  root.nalunoLifelineImportSms = importSmsText;
  root.nalunoLifelineRenderBar = renderBar;
  root.nalunoLifelinePoll = pollRelay;
  root.nalunoLifelineStartMesh = startMesh;
  root.__lifelineWire = { receive: receive, extractAll: extractAll, smsHref: smsHref, outbox: outbox, myIndex: myIndex, mesh: mesh };
})(typeof window !== 'undefined' ? window : globalThis);
