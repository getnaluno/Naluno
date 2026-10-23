/* Phones for the release gate: each is its own Chromium with its own
   network, sharing one Firestore-like database (store.cjs).
     net:    wifi   — direct routes work
             mobile — a carrier network: only relay (TURN) routes connect (natsim.js)
     cached: TURN credentials already on the phone
     media:  allow | deny
   The workers (workers.dev) are answered here; every request to them is
   recorded with its time and body, so a flow can check what left the phone. */
const fs = require('fs');
const path = require('path');
const { pw } = require('./pw.cjs');
const { makeStore } = require('./store.cjs');
const LIB = __dirname;
const fakeSignedIn = fs.readFileSync(path.join(LIB, 'fakefb.js'), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const RELAY = (port) => ({ iceServers: [{ urls: ['turn:192.0.2.2:' + port + '?transport=udp'], username: 'u', credential: 'c' }] });

function tone(file, hz) {
  if (fs.existsSync(file)) return file;
  const rate = 16000, secs = 2, n = rate * secs;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8); buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22); buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.sin(2 * Math.PI * hz * i / rate) * 9000), 44 + i * 2);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, buf);
  return file;
}

async function phone(G, store, uid, peers, o) {
  const { chromium } = pw();
  const wav = tone(path.join(G.tmp, uid === 'alice' ? 'toneA.wav' : 'toneB.wav'), uid === 'alice' ? 440 : 660);
  const b = await chromium.launch({ args: (o.media === 'deny' ? [] : ['--use-fake-ui-for-media-stream']).concat(['--use-fake-device-for-media-stream', '--use-file-for-fake-audio-capture=' + wav, '--autoplay-policy=no-user-gesture-required']) });
  const ctx = await b.newContext({ viewport: { width: 412, height: 915 }, serviceWorkers: 'block', permissions: o.media === 'deny' ? [] : ['microphone', 'camera'] });
  await store.attach(ctx, uid);
  const turnPort = o.turnPort || G.turnPort;
  const worker = [];
  await ctx.route(/^https?:\/\/(?!localhost|127\.0\.0\.1)/, async (r) => {
    const u = r.request().url();
    if (/firebase-app-compat/.test(u)) return r.fulfill({ status: 200, contentType: 'application/javascript', body: fakeSignedIn });
    if (/turn-credentials/.test(u)) {
      const mode = o.turn || 'ok';
      if (mode === 'hang') return;
      /* a slow mobile network: the credential request takes this long */
      if (o.turnMs) await new Promise((res) => setTimeout(res, o.turnMs));
      return r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: mode === 'down' ? '{}' : JSON.stringify(RELAY(turnPort)) });
    }
    if (/workers\.dev/.test(u)) {
      let body = null;
      try { body = JSON.parse(r.request().postData() || 'null'); } catch (_) { body = r.request().postData(); }
      worker.push({ at: Date.now(), url: u, method: r.request().method(), body });
      const answer = (o.workerAnswer && o.workerAnswer(u, body)) || { ok: true, sent: 1 };
      return r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(answer) });
    }
    return r.fulfill({ status: 200, contentType: 'application/javascript', body: '' });
  });
  await ctx.addInitScript(() => { try { localStorage.setItem('nalunoWelcomeOk', String(Date.now())); } catch (_) {} });
  if (o.net === 'mobile') await ctx.addInitScript({ path: path.join(LIB, 'natsim.js') });
  /* an older app version on this phone: its calls.js is served instead */
  if (o.callsJs) { const body = fs.readFileSync(o.callsJs, 'utf8'); await ctx.route(/\/js\/calls\.js(\?|$)/, (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body })); }
  /* the microphone/camera fails to start (after a moment) */
  if (o.gumFailMs) await ctx.addInitScript((ms) => {
    try { const md = navigator.mediaDevices; md.getUserMedia = function () { return new Promise((_, rej) => setTimeout(() => rej(new DOMException('Could not start audio source', 'NotReadableError')), ms)); }; } catch (_) {}
  }, o.gumFailMs);
  /* camera/mic permission not granted yet (the question would appear) */
  if (o.permsPrompt) await ctx.addInitScript(() => {
    try { const q = navigator.permissions.query.bind(navigator.permissions); navigator.permissions.query = function (d) { if (d && (d.name === 'camera' || d.name === 'microphone')) return Promise.resolve({ state: 'prompt' }); return q(d); }; } catch (_) {}
  });
  /* a real phone's camera/microphone takes a moment to start */
  if (o.camMs || o.micMs) await ctx.addInitScript(([cam, mic]) => {
    try {
      const md = navigator.mediaDevices; const g = md.getUserMedia.bind(md);
      md.getUserMedia = async function (c) { const wantsVideo = !!(c && c.video); await new Promise((r) => setTimeout(r, wantsVideo ? cam : mic)); return g(c); };
    } catch (_) {}
  }, [o.camMs || 0, o.micMs || 0]);
  if (o.cached) await ctx.addInitScript(([u, cfg]) => { try { localStorage.setItem('nalunoIceCache', JSON.stringify({ uid: u, at: Date.now() - 10 * 60000, cfg: Object.assign({ bundlePolicy: 'max-bundle', rtcpMuxPolicy: 'require' }, cfg) })); } catch (_) {} }, [uid, RELAY(turnPort)]);
  const p = await ctx.newPage();
  const log = [];
  const toasts = [];
  p.on('pageerror', (e) => log.push('PAGEERROR ' + (e.stack || e.message).split('\n').slice(0, 2).join(' | ')));
  await p.exposeFunction('__toastOut', (t) => { toasts.push(String(t)); });
  await p.addInitScript(() => { const iv = setInterval(() => { if (typeof window.toast === 'function' && !window.toast.__w) { const t0 = window.toast; window.toast = function (m) { try { window.__toastOut(String(m)); } catch (_) {} return t0.apply(this, arguments); }; window.toast.__w = 1; try { toast = window.toast; } catch (_) {} } }, 30); });
  await p.goto(G.base + '/app/', { waitUntil: 'load' });
  await sleep(4500);
  await p.evaluate((ps) => { ps.forEach((c) => { if (!contacts.find((x) => x.id === c.id)) contacts.push(Object.assign({ isReal: true, initials: c.name[0], color: '#7CFFB2', lastActivityTs: Date.now() }, c)); }); }, peers);
  await p.mouse.click(200, 400);
  return { b, ctx, p, o, log, toasts, worker, uid };
}

function seedPair(store) {
  const now = Date.now();
  store.seed('users/alice', { name: 'Alice Test', handle: 'alice', createdAt: { __ts: now - 9e7 } });
  store.seed('users/bob', { name: 'Bob Test', handle: 'bob', createdAt: { __ts: now - 9e7 } });
  store.seed('users/alice/connections/bob', { name: 'Bob Test', uid: 'bob', firebaseUid: 'bob', connectedAt: { __ts: now - 86400e3 } });
  store.seed('users/bob/connections/alice', { name: 'Alice Test', uid: 'alice', firebaseUid: 'alice', connectedAt: { __ts: now - 86400e3 } });
}

async function pair(G, o1, o2, extra) {
  const R = require('./rules.cjs');
  const store = makeStore({ deny: (extra && extra.deny) || R.deny, opDelayMs: (extra && extra.fsMs) || 60 });
  R.bindDocs(store.docs);
  seedPair(store);
  const [A, B] = await Promise.all([
    phone(G, store, 'alice', [{ id: 'c-bob', name: 'Bob Test', firebaseUid: 'bob' }], o1 || {}),
    phone(G, store, 'bob', [{ id: 'c-alice', name: 'Alice Test', firebaseUid: 'alice' }], o2 || {}),
  ]);
  return { store, A, B, close: async () => { await Promise.all([A.b.close().catch(() => {}), B.b.close().catch(() => {})]); } };
}

const state = (p) => p.evaluate(() => {
  const pc = (typeof peerConnection !== 'undefined' && peerConnection) || null;
  return {
    ring: !!(document.getElementById('incoming') && document.getElementById('incoming').classList.contains('active')),
    overlay: !!(document.getElementById('callOverlay') && document.getElementById('callOverlay').classList.contains('active')),
    conn: pc ? pc.connectionState : 'none',
    live: typeof nalunoCallLive !== 'undefined' && !!nalunoCallLive,
    callId: typeof activeCallId !== 'undefined' ? activeCallId : null,
  };
}).catch(() => ({}));
const rx = (p) => p.evaluate(async () => {
  const pc = (typeof peerConnection !== 'undefined' && peerConnection);
  if (!pc) return { a: 0, v: 0 };
  const r = await pc.getStats(); let a = 0, v = 0;
  r.forEach((x) => { if (x.type === 'inbound-rtp') { if (x.kind === 'audio') a += x.packetsReceived || 0; else v += x.framesDecoded || 0; } });
  return { a, v };
}).catch(() => ({ a: -1, v: -1 }));
async function twoWay(A, B, video) {
  const a0 = await rx(A.p), b0 = await rx(B.p);
  await sleep(1500);
  const a1 = await rx(A.p), b1 = await rx(B.p);
  return { audio: a1.a > a0.a + 5 && b1.a > b0.a + 5, video: video ? (a1.v > a0.v + 2 && b1.v > b0.v + 2) : null };
}
async function waitFor(fn, ms, step) { const t = Date.now(); while (Date.now() - t < ms) { const v = await fn(); if (v) return Date.now() - t; await sleep(step || 100); } return null; }
async function dial(A, video) {
  if (video) {
    await A.p.evaluate(() => { startOutgoingCall('c-bob'); });
    await sleep(1200);
    await A.p.evaluate(() => { const b = document.getElementById('joinBtn'); b && b.click(); });
  } else await A.p.evaluate(() => { startAudioCall('c-bob'); });
}
async function answer(B) {
  await B.p.evaluate(() => { const b = document.getElementById('acceptIncoming'); b.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'touch', button: 0 })); });
}
async function oneCall(S, opt) {
  opt = opt || {};
  const t0 = Date.now();
  await dial(S.A, opt.video);
  const rang = await waitFor(async () => (await state(S.B.p)).ring, 20000);
  if (rang == null) return { rang: false, ms: Date.now() - t0 };
  await sleep(opt.ringMs || 800);
  await answer(S.B);
  const up = await waitFor(async () => { const a = await state(S.A.p), b = await state(S.B.p); return a.live && b.live; }, opt.connectMs || 45000, 200);
  let media = { audio: false, video: null };
  if (up != null) media = await twoWay(S.A, S.B, opt.video);
  return { rang: true, ringMs: rang, connected: up != null, media };
}
async function hangUp(P) { await P.p.evaluate(() => { try { endActiveCall('hangup'); } catch (_) {} }).catch(() => {}); }

module.exports = { phone, pair, seedPair, state, twoWay, waitFor, dial, answer, oneCall, hangUp, sleep, RELAY };
