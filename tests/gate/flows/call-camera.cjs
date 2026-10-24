/* The call keeps its camera and mic (24 Oct a).
   Two phones on a video call. The callee flips the lens, then the phone
   takes the camera away by itself (what Android does after some flips), a
   flip's reopen is refused outright, the mic dies, the camera dies while
   switched off, while Naluno is in the background, and right before
   hang-up. The other person must keep (or get back) picture and sound;
   a camera switched off stays off; a voice call never opens the camera;
   nothing is left on after the call. The phones behave like Android:
   touch, upright 3:4 front lens, tall rear lens. */
const { pair, state, sleep, waitFor, dial, answer, hangUp } = require('../lib/phones.cjs');

const PHONE_CAMERAS = () => {
  const o = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  window.__refuse = 0;
  Object.defineProperty(navigator, 'userAgent', { get: () => 'Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36' });
  navigator.mediaDevices.getUserMedia = (c) => {
    if (c && c.video && window.__refuse > 0) { window.__refuse--; return Promise.reject(new DOMException('Could not start video source', 'NotReadableError')); }
    if (c && c.video) {
      window.__vOpens = (window.__vOpens || 0) + 1;
      if (c.audio) window.__aOpens = (window.__aOpens || 0) + 1;
      const v = typeof c.video === 'object' ? c.video : {};
      const fm = v.facingMode && (v.facingMode.exact || v.facingMode.ideal || v.facingMode);
      const rear = fm ? fm === 'environment' : !!window.__wantRear;
      const nv = Object.assign({}, v, rear ? { width: { exact: 720 }, height: { exact: 1280 } } : { width: { exact: 480 }, height: { exact: 640 } });
      delete nv.aspectRatio; delete nv.resizeMode;
      c = Object.assign({}, c, { video: nv });
    }
    return o(c);
  };
  MediaStreamTrack.prototype.applyConstraints = function () { return Promise.resolve(); };
};
/* what the viewer receives: frames decoded, sound packets, picture brightness */
const RX = async () => {
  const pc = peerConnection; let fd = 0, ap = 0;
  if (pc) (await pc.getStats()).forEach((x) => { if (x.type === 'inbound-rtp' && x.kind === 'video') fd = x.framesDecoded || 0; if (x.type === 'inbound-rtp' && x.kind === 'audio') ap = x.packetsReceived || 0; });
  let lum = -1;
  try { const v = document.getElementById('remoteVideo'); const c = document.createElement('canvas'); c.width = 16; c.height = 16; const g = c.getContext('2d'); g.drawImage(v, 0, 0, 16, 16); const d = g.getImageData(0, 0, 16, 16).data; let s = 0; for (let i = 0; i < d.length; i += 4) s += d[i] + d[i + 1] + d[i + 2]; lum = Math.round(s / (d.length / 4) / 3); } catch (_) {}
  return { fd, ap, lum };
};
const TX = () => {
  const pc = peerConnection;
  const vs = pc && pc.getSenders().find((x) => x.track && x.track.kind === 'video');
  const as = pc && pc.getSenders().find((x) => x.track && x.track.kind === 'audio');
  return {
    cams: stream ? stream.getVideoTracks().filter((t) => t.readyState === 'live').length : 0,
    camEnabled: stream ? stream.getVideoTracks().some((t) => t.readyState === 'live' && t.enabled) : false,
    vs: vs ? vs.track.readyState : 'none', as: as ? as.track.readyState : 'none', facing: cameraFacingMode, camOn,
  };
};
module.exports = {
  name: 'call-camera',
  async run(G) {
    const out = [];
    const add = (check, ok, detail) => out.push({ check, ok: !!ok, detail: detail || '' });
    /* flowing: picture and sound both keep arriving over `ms` */
    const flowing = async (V, ms) => {
      const a = await V.p.evaluate(RX); await sleep(ms || 2500); const b = await V.p.evaluate(RX);
      return { pic: b.fd > a.fd + 2 && b.lum > 8, snd: b.ap > a.ap + 20, d: (b.fd - a.fd) + 'f ' + (b.ap - a.ap) + 'p lum' + b.lum };
    };
    const call = async (video) => {
      const o = process.env.NALUNO_CALLS_JS ? { callsJs: process.env.NALUNO_CALLS_JS } : {};
      const S = await pair(G, Object.assign({ net: 'wifi', cached: true }, o), Object.assign({ net: 'wifi', cached: true }, o));
      for (const X of [S.A, S.B]) await X.p.evaluate(PHONE_CAMERAS);
      await sleep(1200);
      await dial(S.A, video);
      await waitFor(async () => (await state(S.B.p)).ring, 20000);
      await sleep(1000);
      await answer(S.B);
      const up = await waitFor(async () => { const a = await state(S.A.p), b = await state(S.B.p); return a.live && b.live; }, 30000, 200);
      await sleep(2500);
      return { S, up: up != null };
    };
    const flip = (P) => P.p.evaluate(() => { window.__wantRear = cameraFacingMode === 'user'; document.getElementById('switchCam').click(); });
    const killCam = (P) => P.p.evaluate(() => { stream && stream.getVideoTracks().forEach((t) => t.stop()); });

    /* 1. flips, then the phone takes the camera away */
    let { S, up } = await call(true);
    try {
      add('video call connects', up);
      for (let i = 0; i < 3; i++) { await flip(S.B); await sleep(2500); }
      const f = await flowing(S.A, 2500);
      add('after three flips the caller still sees and hears the callee', f.pic && f.snd, f.d);
      /* 24 Oct b: a flip keeps the mic that is already open */
      const m0 = await S.B.p.evaluate(() => ({ id: (stream.getAudioTracks()[0] || {}).id, a: window.__aOpens || 0 }));
      await flip(S.B); await sleep(3000);
      const m1 = await S.B.p.evaluate(() => ({ id: (stream.getAudioTracks()[0] || {}).id, live: stream.getAudioTracks().some((t) => t.readyState === 'live'), a: window.__aOpens || 0 }));
      const mf = await flowing(S.A, 2000);
      add('a flip keeps the open mic (not closed and reopened)', m0.id && m0.id === m1.id && m1.live && m1.a === m0.a && mf.snd, JSON.stringify(m0) + ' → ' + JSON.stringify(m1) + ' ' + mf.d);
      /* two quick taps: the second one, made while the lens is still opening, is not dropped */
      const q0 = await S.B.p.evaluate(() => ({ f: cameraFacingMode, v: window.__vOpens || 0 }));
      await S.B.p.evaluate(() => { const b = document.getElementById('switchCam'); window.__wantRear = cameraFacingMode === 'user'; b.click(); setTimeout(() => b.click(), 60); });
      await sleep(6000);
      const q1 = await S.B.p.evaluate(() => ({ f: cameraFacingMode, v: window.__vOpens || 0, busy: !!window.__flipBusy }));
      const qf = await flowing(S.A, 2000);
      add('two quick flip taps: both happen (back on the first lens), picture still on', q1.f === q0.f && q1.v >= q0.v + 2 && !q1.busy && qf.pic, JSON.stringify(q0) + ' → ' + JSON.stringify(q1) + ' ' + qf.d);
      await killCam(S.B);
      await sleep(3500);
      const k = await flowing(S.A, 2500);
      const kt = await S.B.p.evaluate(TX);
      add('the phone ends the camera after a flip: the picture comes back by itself', k.pic && kt.cams === 1 && kt.vs === 'live', k.d + ' ' + JSON.stringify(kt));
      add('… and the sound never stopped', k.snd, k.d);
      /* 2. a flip whose reopen is refused every time (the fallback path) */
      await S.B.p.evaluate(() => { window.__refuse = 12; });
      await flip(S.B); await sleep(4000);
      await S.B.p.evaluate(() => { window.__refuse = 0; });
      await sleep(4500);
      const r = await flowing(S.A, 2500);
      const rt = await S.B.p.evaluate(TX);
      add('a flip that cannot open any lens: the caller keeps (or gets back) sound and picture', r.pic && r.snd && rt.vs === 'live' && rt.as === 'live', r.d + ' ' + JSON.stringify(rt));
      /* 3. the mic dies */
      await S.B.p.evaluate(() => { stream && stream.getAudioTracks().forEach((t) => t.stop()); });
      await sleep(3500);
      const m = await flowing(S.A, 2500);
      add('the mic dies: the callee is heard again by itself', m.snd && (await S.B.p.evaluate(TX)).as === 'live', m.d);
      /* 4. camera switched off with the button, then lost: it stays off */
      await S.B.p.evaluate(() => setCam(false));
      await sleep(800);
      await killCam(S.B);
      await sleep(4500);
      const offT = await S.B.p.evaluate(TX);
      const offRx = await flowing(S.A, 2000);
      add('a camera switched off stays off when it is brought back', offT.camOn === false && !offT.camEnabled && !offRx.pic, JSON.stringify(offT) + ' ' + offRx.d);
      await S.B.p.evaluate(() => setCam(true));
      await sleep(2500);
      const onRx = await flowing(S.A, 2500);
      add('… and comes on again with the button', onRx.pic, onRx.d);
      /* 5. lost while Naluno is in the background: not reopened there, reopened when back */
      await S.B.p.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
      await sleep(600);
      const opensBefore = await S.B.p.evaluate(() => (window.__nalunoCallTimes && Object.keys(window.__nalunoCallTimes).length) || 0);
      await killCam(S.B);
      await sleep(4000);
      const bg = await S.B.p.evaluate(TX);
      await S.B.p.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); document.dispatchEvent(new Event('visibilitychange')); });
      await sleep(4000);
      const fg = await S.B.p.evaluate(TX);
      const fgRx = await flowing(S.A, 2500);
      add('in the background the camera is not reopened; back on screen it is', bg.cams === 0 && fg.cams === 1 && fgRx.pic, 'bg ' + bg.cams + ' fg ' + fg.cams + ' ' + fgRx.d + ' ' + opensBefore);
      /* 6. lost right before hang-up: nothing is left on after */
      await killCam(S.B);
      await sleep(200);
      await hangUp(S.B);
      await sleep(6000);
      const after = await S.B.p.evaluate(() => ({ live: stream ? stream.getTracks().filter((t) => t.readyState === 'live').length : 0, call: activeCallId }));
      add('the camera is not reopened after the call ends', after.live === 0 && !after.call, JSON.stringify(after));
      const errs = S.B.log.filter((l) => /PAGEERROR/.test(l)).concat(S.A.log.filter((l) => /PAGEERROR/.test(l)));
      add('no page errors on either phone', errs.length === 0, errs.slice(0, 2).join(' | '));
    } finally { await S.close(); }

    /* 7. a voice call never opens a camera, even when the mic is lost */
    ({ S, up } = await call(false));
    try {
      add('voice call connects', up);
      await S.B.p.evaluate(() => { stream && stream.getAudioTracks().forEach((t) => t.stop()); });
      await sleep(5000);
      const v = await S.B.p.evaluate(() => ({ cams: stream ? stream.getVideoTracks().length : 0, mic: stream ? stream.getAudioTracks().some((t) => t.readyState === 'live') : false }));
      const vRx = await flowing(S.A, 2500);
      add('voice call: the mic comes back and no camera is opened', v.cams === 0 && v.mic && vRx.snd, JSON.stringify(v) + ' ' + vRx.d);
    } finally { await S.close(); }
    return out;
  },
};
