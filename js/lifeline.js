/* ============================================================
   MODULE: js/lifeline.js   —   Wireline when the internet is taken away

   Naluno began because Uganda cut social media and then the whole internet,
   and people could not reach the ones they love. In the 2021 and 2026
   shutdowns the internet went dark and VPN servers were blocked, but VOICE
   CALLS AND BASIC SMS KEPT WORKING. Lifeline is built on that fact.

   THREE SITUATIONS, THREE ROUTES — tried in this order:

   1. BLOCKED  (internet up, Naluno/Google blocked)  -> RELAY
      Sealed packets go to Naluno relay endpoints on several domains, which
      store them in an encrypted dead-drop. The recipient picks them up.
   2. SHUTDOWN, NEARBY  (no internet at all)         -> MESH
      Phones pass sealed packets to each other over Bluetooth / Wi-Fi
      (Android app only), carrying them until they meet the recipient.
   3. SHUTDOWN, ABROAD                               -> SMS
      The packet is written into an ordinary text message. SMS survived both
      shutdowns and reaches other countries. The recipient's Naluno opens it.

   PRIVACY RULES (non-negotiable)
   - NOTHING UNSEALED EVER LEAVES THROUGH LIFELINE. Mesh relays are strangers
     and SMS is readable by carriers and governments. If a message cannot be
     sealed (no stored key for that person), Lifeline refuses and says why.
   - Packets carry NO sender and NO recipient. They carry a pairwise TAG that
     only the two people can compute, and it changes every day. A relay, a
     carrier or an observer sees random bytes, not who is talking to whom.
   - Separate keys from ordinary Wireline (HKDF domain separation), derived
     from the same ECDH key pair, so nothing new has to be exchanged.

   HONEST LIMITS
   - Mesh reaches as far as a chain of Naluno phones reaches: tens of metres
     per hop. It works across a neighbourhood or a dense city; it cannot
     leave the country. SMS is the route abroad.
   - SMS costs what your carrier charges (international rates apply), and
     long messages become several SMS. Text only — photos do not fit.
   - The browser (PWA) cannot do phone-to-phone mesh. Mesh needs the Android
     app. Relay and SMS work everywhere.
   ============================================================ */
(function (root) {
  'use strict';
  var subtle = (root.crypto && root.crypto.subtle) || null;
  var VERSION = 1;
  var TAG_BYTES = 12, IV_BYTES = 12;
  var TTL_MS = 72 * 3600 * 1000;           // packets live three days
  var SMS_PREFIX = 'Naluno:';

  /* ---------------- small helpers ---------------- */
  function enc(s) { return new TextEncoder().encode(s); }
  function dec(b) { return new TextDecoder().decode(b); }
  function concat() {
    var n = 0, i, off = 0; for (i = 0; i < arguments.length; i++) n += arguments[i].length;
    var out = new Uint8Array(n);
    for (i = 0; i < arguments.length; i++) { out.set(arguments[i], off); off += arguments[i].length; }
    return out;
  }
  function b64u(bytes) {
    var s = ''; for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function unb64u(str) {
    var s = String(str).replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '=';
    var bin = atob(s), out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function hex(b) { var s = ''; for (var i = 0; i < b.length; i++) s += (b[i] < 16 ? '0' : '') + b[i].toString(16); return s; }
  function dayIndex(ts) { return Math.floor((ts == null ? Date.now() : ts) / 86400000); }

  /* ---------------- durable keyring ----------------
     A contact's public key must survive a restart during a shutdown, or the
     message cannot be sealed. It is saved every time Naluno learns one. */
  var KEYRING = 'nalunoLifelineKeyring';
  function keyringRead() { try { return JSON.parse(root.localStorage.getItem(KEYRING) || '{}'); } catch (_) { return {}; } }
  function keyringPut(uid, jwk) {
    if (!uid || !jwk || !jwk.x || !jwk.y) return;
    try {
      var k = keyringRead();
      k[uid] = { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y };
      root.localStorage.setItem(KEYRING, JSON.stringify(k));
    } catch (_) {}
  }
  function keyringGet(uid) { var k = keyringRead(); return k[uid] || null; }

  /* ---------------- pairwise secrets ---------------- */
  var pairCache = {};
  async function myKeys() {
    if (typeof root.ensureMyKeyPair !== 'function') return null;
    var k = await root.ensureMyKeyPair();
    return (k && k.privateKey && k.publicJwk) ? k : null;
  }
  async function pairSecret(peerUid) {
    var jwk = keyringGet(peerUid);
    if (!jwk) return null;
    var cacheKey = peerUid + '|' + jwk.x;
    if (pairCache[cacheKey]) return pairCache[cacheKey];
    var mine = await myKeys(); if (!mine) return null;
    var pub = await subtle.importKey('jwk', jwk, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
    var bits = await subtle.deriveBits({ name: 'ECDH', public: pub }, mine.privateKey, 256);
    var base = await subtle.importKey('raw', bits, 'HKDF', false, ['deriveKey', 'deriveBits']);
    var aes = await subtle.deriveKey(
      { name: 'HKDF', hash: 'SHA-256', salt: enc('naluno-lifeline'), info: enc('lifeline-v1-message') },
      base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    pairCache[cacheKey] = { base: base, aes: aes };
    return pairCache[cacheKey];
  }
  /* The tag for a pair on a given day. Both people compute the same bytes;
     nobody else can, and tomorrow's tag is unrelated to today's. */
  async function pairTag(peerUid, day) {
    var s = await pairSecret(peerUid); if (!s) return null;
    var bits = await subtle.deriveBits(
      { name: 'HKDF', hash: 'SHA-256', salt: enc('naluno-lifeline'), info: enc('lifeline-v1-tag|' + day) },
      s.base, TAG_BYTES * 8);
    return new Uint8Array(bits);
  }

  /* ---------------- sealed packets ----------------
     [version 1][tag 12][iv 12][AES-GCM ciphertext]
     Inside the ciphertext: {t: text, c: clientMsgId, s: sent-at}. */
  async function seal(peerUid, text, clientMsgId, ts) {
    var when = ts || Date.now();
    var s = await pairSecret(peerUid);
    if (!s) return { ok: false, reason: 'no-key' };
    var tag = await pairTag(peerUid, dayIndex(when));
    var iv = root.crypto.getRandomValues(new Uint8Array(IV_BYTES));
    var body = enc(JSON.stringify({ t: String(text || ''), c: clientMsgId, s: Math.floor(when / 1000) }));
    var ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv: iv, additionalData: tag }, s.aes, body));
    return { ok: true, bytes: concat(new Uint8Array([VERSION]), tag, iv, ct), tag: tag };
  }
  function parse(bytes) {
    if (!bytes || bytes.length < 1 + TAG_BYTES + IV_BYTES + 16 || bytes[0] !== VERSION) return null;
    return { tag: bytes.slice(1, 1 + TAG_BYTES), iv: bytes.slice(1 + TAG_BYTES, 1 + TAG_BYTES + IV_BYTES),
             ct: bytes.slice(1 + TAG_BYTES + IV_BYTES) };
  }
  /* The tags this device listens for: every contact, for today and the two
     previous days (a packet may have been carried for a while). */
  async function myTagIndex(contactUids, now) {
    var d = dayIndex(now), idx = {};
    for (var i = 0; i < contactUids.length; i++) {
      for (var k = 0; k < 3; k++) {
        var t = await pairTag(contactUids[i], d - k);
        if (t) idx[hex(t)] = contactUids[i];
      }
    }
    return idx;
  }
  /* Open a packet addressed to me. Returns null for anything that is not
     mine or does not authenticate — a forged or corrupted packet fails the
     AES-GCM check and is dropped silently. */
  async function open(bytes, tagIndex) {
    var p = parse(bytes); if (!p) return null;
    var from = tagIndex[hex(p.tag)]; if (!from) return null;
    var s = await pairSecret(from); if (!s) return null;
    try {
      var plain = await subtle.decrypt({ name: 'AES-GCM', iv: p.iv, additionalData: p.tag }, s.aes, p.ct);
      var o = JSON.parse(dec(new Uint8Array(plain)));
      return { from: from, text: String(o.t || ''), clientMsgId: String(o.c || ''), sentAt: (Number(o.s) || 0) * 1000 };
    } catch (_) { return null; }
  }

  /* ---------------- SMS codec ----------------
     Base64url uses only letters, digits, '-' and '_', all in the GSM-7
     alphabet, so a message stays at 160 characters per SMS instead of the
     70 it would drop to if any character forced Unicode. The phone splits
     and rejoins long bodies itself (concatenated SMS). */
  function toSms(bytes) { return SMS_PREFIX + b64u(bytes); }
  function fromSms(text) {
    var s = String(text || '');
    var i = s.indexOf(SMS_PREFIX); if (i < 0) return null;
    var m = s.slice(i + SMS_PREFIX.length).match(/^[A-Za-z0-9_-]+/);
    if (!m) return null;
    try { return unb64u(m[0]); } catch (_) { return null; }
  }
  function smsSegments(body) {
    var n = String(body).length;
    return n <= 160 ? 1 : Math.ceil(n / 153);
  }

  /* ---------------- Mesh: store-and-forward router ----------------
     Transport-agnostic. The Android bridge supplies "a peer is in range",
     "send bytes", "bytes arrived"; this decides what to hand over.

     Binary spray-and-wait: a new packet starts with COPIES tokens. Meeting a
     phone that lacks it, a carrier with more than one token hands over half.
     With one token left it only hands the packet to the actual recipient.
     This bounds how many phones ever hold a message (unlike flooding, which
     drains batteries and storage across a whole city) while still spreading
     fast. Delivery ACKs spread the same way and make carriers delete the
     packet. Recipients are found without revealing identities: each phone
     advertises only its current tags. */
  var COPIES = 8, MAX_STORE = 800, MAX_PACKET = 4096, MAX_ACKS = 4000;

  function MeshRouter(opts) {
    opts = opts || {};
    this.now = opts.now || function () { return Date.now(); };
    this.store = {};           // id -> { bytes, tag, copies, expires }
    this.acks = {};            // id -> expires
    this.myTags = {};          // tagHex -> true (packets for me)
    this.onDeliver = opts.onDeliver || function () {};
    this.copies = opts.copies || COPIES;
  }
  MeshRouter.packetId = function (bytes) {
    // First 8 bytes of the IV+ciphertext region: random, unique per packet,
    // and derivable by anyone holding the packet without extra headers.
    return hex(bytes.slice(1 + TAG_BYTES, 1 + TAG_BYTES + 8));
  };
  MeshRouter.prototype.setMyTags = function (tagHexList) {
    var t = {}; (tagHexList || []).forEach(function (h) { t[h] = true; }); this.myTags = t;
  };
  MeshRouter.prototype.prune = function () {
    var now = this.now(), id;
    for (id in this.store) if (this.store[id].expires < now || this.acks[id]) delete this.store[id];
    for (id in this.acks) if (this.acks[id] < now) delete this.acks[id];
    var ids = Object.keys(this.store);
    if (ids.length > MAX_STORE) {
      var self = this;
      ids.sort(function (a, b) { return self.store[a].expires - self.store[b].expires; });
      ids.slice(0, ids.length - MAX_STORE).forEach(function (x) { delete self.store[x]; });
    }
    var ak = Object.keys(this.acks);
    if (ak.length > MAX_ACKS) { var s2 = this; ak.slice(0, ak.length - MAX_ACKS).forEach(function (x) { delete s2.acks[x]; }); }
  };
  /* Add a packet I created, or one handed to me. */
  MeshRouter.prototype.accept = function (bytes, copies) {
    if (!bytes || bytes.length > MAX_PACKET) return false;
    var p = parse(bytes); if (!p) return false;
    var id = MeshRouter.packetId(bytes);
    if (this.store[id] || this.acks[id]) return false;
    var tagHex = hex(p.tag);
    if (this.myTags[tagHex]) {           // it is for me: deliver, then ACK so carriers drop it
      this.acks[id] = this.now() + TTL_MS;
      this.onDeliver(bytes, id);
      return true;
    }
    this.store[id] = { bytes: bytes, tag: tagHex, copies: copies || 1, expires: this.now() + TTL_MS };
    this.prune();
    return true;
  };
  /* What I tell a phone I meet: what I already hold, which deliveries I
     know about, and which tags I am listening for. */
  MeshRouter.prototype.summary = function () {
    this.prune();
    return { have: Object.keys(this.store), acks: Object.keys(this.acks), want: Object.keys(this.myTags) };
  };
  /* Given the other phone's summary, what should I hand over? */
  MeshRouter.prototype.offerTo = function (theirSummary) {
    this.prune();
    var have = {}, want = {}, out = [], id, e;
    (theirSummary.have || []).forEach(function (x) { have[x] = 1; });
    (theirSummary.want || []).forEach(function (x) { want[x] = 1; });
    var self = this;
    (theirSummary.acks || []).forEach(function (x) {       // learn deliveries from them
      if (!self.acks[x]) self.acks[x] = self.now() + TTL_MS;
      delete self.store[x];
    });
    for (id in this.store) {
      e = this.store[id];
      if (have[id]) continue;
      if (want[e.tag]) { out.push({ bytes: e.bytes, copies: 1 }); continue; }   // straight to the recipient
      if (e.copies > 1) {                                                      // spray: give half
        var give = Math.floor(e.copies / 2);
        e.copies -= give;
        out.push({ bytes: e.bytes, copies: give });
      }
    }
    return out;
  };

  /* ---------------- Relay (dead drop) client ----------------
     Tried in order; the first that answers wins. Several domains so a block
     on one is not a block on Lifeline. Short timeouts: on a censored network
     a blocked endpoint often hangs rather than failing fast. */
  var RELAYS = (root.NALUNO_LIFELINE_RELAYS || [
    'https://naluno-economy.naluno.workers.dev',
  ]).slice();
  async function tryRelays(pathAndQuery, init, timeoutMs) {
    var lastErr = null;
    for (var i = 0; i < RELAYS.length; i++) {
      var ctl = new AbortController(), t = setTimeout(function () { ctl.abort(); }, timeoutMs || 6000);
      try {
        var r = await fetch(RELAYS[i] + pathAndQuery, Object.assign({ signal: ctl.signal }, init || {}));
        clearTimeout(t);
        if (r.ok) {
          if (i > 0) { var good = RELAYS.splice(i, 1)[0]; RELAYS.unshift(good); }  // remember what works
          return r;
        }
        lastErr = new Error('relay ' + r.status);
      } catch (e) { clearTimeout(t); lastErr = e; }
    }
    throw lastErr || new Error('no relay reachable');
  }
  async function relayDrop(bytes) {
    await tryRelays('/v1/lifeline/drop', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ p: b64u(bytes) }),
    });
    return true;
  }
  async function relayPick(tagHexList) {
    if (!tagHexList.length) return [];
    var r = await tryRelays('/v1/lifeline/pick', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tags: tagHexList.slice(0, 300) }),
    });
    var j = await r.json();
    return (j.packets || []).map(function (x) { try { return unb64u(x); } catch (_) { return null; } }).filter(Boolean);
  }

  root.NalunoLifeline = {
    VERSION: VERSION, SMS_PREFIX: SMS_PREFIX,
    keyringPut: keyringPut, keyringGet: keyringGet,
    seal: seal, open: open, parse: parse, myTagIndex: myTagIndex, pairTag: pairTag, dayIndex: dayIndex,
    toSms: toSms, fromSms: fromSms, smsSegments: smsSegments,
    MeshRouter: MeshRouter, relayDrop: relayDrop, relayPick: relayPick,
    b64u: b64u, unb64u: unb64u, hex: hex, relays: RELAYS,
  };
})(typeof window !== 'undefined' ? window : globalThis);
