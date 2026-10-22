/* The Callsign photo (23 Oct): nothing sits on the photo; tapping it opens
   the picker; two fingers pinch to zoom, one finger drags; "Use photo"
   saves exactly what is in the circle, on the Callsign page and while
   editing. Done with real touch input on a phone-sized screen. */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { makeStore } = require('../lib/store.cjs');
const { phone, seedPair, sleep } = require('../lib/phones.cjs');

/* a 600 x 900 picture: red top third, green middle, blue bottom third */
function png(file) {
  const W = 600, H = 900;
  const raw = Buffer.alloc((W * 3 + 1) * H);
  for (let y = 0; y < H; y++) {
    raw[y * (W * 3 + 1)] = 0;
    const c = y < 300 ? [220, 30, 30] : (y < 600 ? [30, 200, 60] : [30, 60, 220]);
    for (let x = 0; x < W; x++) { const o = y * (W * 3 + 1) + 1 + x * 3; raw[o] = c[0]; raw[o + 1] = c[1]; raw[o + 2] = c[2]; }
  }
  const crc = (b) => { let c = ~0; for (const v of b) { c ^= v; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1)); } return ~c >>> 0; };
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ih = Buffer.alloc(13); ih.writeUInt32BE(W, 0); ih.writeUInt32BE(H, 4); ih[8] = 8; ih[9] = 2;
  fs.writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
  return file;
}

async function touch(cdp, type, pts) {
  await cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p.x, y: p.y, id: i, radiusX: 4, radiusY: 4, force: 1 })) });
}

module.exports = {
  name: 'photo',
  async run(G) {
    const out = [];
    const img = png(path.join(G.tmp, 'stripes.png'));
    const store = makeStore({ deny: require('../lib/rules.cjs').deny, opDelayMs: 40 });
    require('../lib/rules.cjs').bindDocs(store.docs);
    seedPair(store);
    const P = await phone(G, store, 'alice', [{ id: 'c-bob', name: 'Bob Test', firebaseUid: 'bob' }], { net: 'wifi', cached: true });
    try {
      const cdp = await P.ctx.newCDPSession(P.p);
      await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
      await P.p.evaluate(() => { try { localStorage.setItem('nalunoLegalSeen', NALUNO_LEGAL_VERSION); } catch (_) {} document.querySelectorAll('#nalunoLegalNotice').forEach((x) => x.remove()); try { nalunoShowTab('callsign'); } catch (_) {} });
      await sleep(1200);
      /* 1. nothing on top of the photo, and the photo itself is what is tapped */
      const look = await P.p.evaluate(() => {
        const a = document.getElementById('viewAvatar');
        const r = a.getBoundingClientRect();
        const pts = [[.5, .5], [.85, .85], [.15, .15], [.85, .15], [.15, .85]].map(([fx, fy]) => document.elementFromPoint(r.left + r.width * fx, r.top + r.height * fy));
        const wrap = a.parentElement;
        const extra = Array.from(wrap.children).filter((x) => x !== a && !x.matches('input[type=file]'));
        const inp = document.getElementById('viewAvatarFileInput');
        return { allInput: pts.every((x) => x === inp), extra: extra.length, opacity: +getComputedStyle(inp).opacity, pencil: !!document.querySelector('.avatar-edit') };
      });
      out.push({ check: 'nothing sits on the Callsign photo, and anywhere on it is the picker', ok: look.allInput && !look.extra && look.opacity < 0.05 && !look.pencil, detail: JSON.stringify(look) });
      /* 2. tapping the photo opens the phone's picture chooser */
      const box = await P.p.evaluate(() => { const r = document.getElementById('viewAvatar').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
      const chooserP = P.p.waitForEvent('filechooser', { timeout: 4000 }).catch(() => null);
      await touch(cdp, 'touchStart', [{ x: box.x + 20, y: box.y + 20 }]); await touch(cdp, 'touchEnd', []);
      const chooser = await chooserP.catch(() => null);
      out.push({ check: 'a tap on the photo opens the picture chooser', ok: !!chooser, detail: '' });
      if (!chooser) return out;
      await chooser.setFiles(img);
      await sleep(1200);
      const st = await P.p.evaluate(() => { const s = document.getElementById('avatarPickerStage'); if (!s) return null; const r = s.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
      out.push({ check: 'the picker opens with a square frame and a circle', ok: !!st && Math.abs(st.w - st.h) < 2 && st.w > 250, detail: JSON.stringify(st) });
      if (!st) return out;
      const cx = st.x + st.w / 2, cy = st.y + st.h / 2;
      /* 3. pinch: two fingers apart, from 80 px to 240 px */
      await touch(cdp, 'touchStart', [{ x: cx - 40, y: cy }, { x: cx + 40, y: cy }]);
      for (let k = 1; k <= 8; k++) { await touch(cdp, 'touchMove', [{ x: cx - 40 - k * 10, y: cy }, { x: cx + 40 + k * 10, y: cy }]); await sleep(16); }
      await touch(cdp, 'touchEnd', []);
      await sleep(200);
      const z = await P.p.evaluate(() => +document.getElementById('avatarPickerZoom').value);
      out.push({ check: 'pinching apart zooms in', ok: z >= 250 && z <= 350, detail: 'zoom ' + z + '%' });
      /* 4. one finger drags the picture up, to frame the blue bottom */
      await touch(cdp, 'touchStart', [{ x: cx, y: cy + 100 }]);
      for (let k = 1; k <= 12; k++) { await touch(cdp, 'touchMove', [{ x: cx, y: cy + 100 - k * 60 }]); await sleep(16); }
      await touch(cdp, 'touchEnd', []);
      await sleep(200);
      await P.p.screenshot({ path: path.join(G.tmp, 'photo-picker.png') }).catch(() => {});
      await P.p.evaluate(() => document.getElementById('avatarPickerUse').click());
      await sleep(2500);
      const saved = await P.p.evaluate(async () => {
        const ph = (currentProfile && currentProfile.photo) || null;
        const src = ph && ph.dataUrl;
        if (!src) return { none: true, picker: !!document.getElementById('avatarPicker') };
        const im = new Image(); im.src = src; await im.decode().catch(() => {});
        const c = document.createElement('canvas'); c.width = im.naturalWidth; c.height = im.naturalHeight;
        const g = c.getContext('2d'); g.drawImage(im, 0, 0);
        const px = (x, y) => Array.from(g.getImageData(x, y, 1, 1).data.slice(0, 3));
        return { w: im.naturalWidth, h: im.naturalHeight, mid: px(im.naturalWidth >> 1, im.naturalHeight >> 1), crop: ph.crop, view: document.getElementById('callsignView').style.display, picker: !!document.getElementById('avatarPicker'), shown: !!document.querySelector('#viewAvatar img') || /url\(/.test(document.getElementById('viewAvatar').style.backgroundImage) };
      });
      const blue = saved.mid && saved.mid[2] > 150 && saved.mid[0] < 90;
      out.push({ check: '"Use photo" saves a square of exactly what was framed (the blue part)', ok: !saved.none && saved.w === 720 && saved.h === 720 && blue && !saved.picker, detail: JSON.stringify(saved) });
      out.push({ check: 'saved straight from the Callsign page, and the photo shows there', ok: saved.view !== 'none' && saved.shown && (P.toasts || []).some((x) => /Callsign saved/.test(x)), detail: (P.toasts || []).join(' / ') });
      /* 5. while editing: the big photo is the picker too, and Cancel keeps the old photo */
      await P.p.evaluate(() => document.getElementById('editCallsignBtn').click());
      await sleep(600);
      const ebox = await P.p.evaluate(() => { const r = document.getElementById('profileAvatarBig').getBoundingClientRect(); const e = document.elementFromPoint(r.left + r.width * 0.85, r.top + r.height * 0.85); return { x: r.left + r.width / 2, y: r.top + r.height / 2, top: e && e.id }; });
      out.push({ check: 'while editing, the photo is the picker too (no pencil)', ok: ebox.top === 'avatarFileInput', detail: String(ebox.top) });
      const ch2P = P.p.waitForEvent('filechooser', { timeout: 4000 }).catch(() => null);
      await touch(cdp, 'touchStart', [{ x: ebox.x, y: ebox.y }]); await touch(cdp, 'touchEnd', []);
      const ch2 = await ch2P.catch(() => null);
      if (ch2) { await ch2.setFiles(img); await sleep(1000); }
      const before = await P.p.evaluate(() => currentProfile.photo && currentProfile.photo.dataUrl);
      await P.p.evaluate(() => { const b = document.getElementById('avatarPickerCancel'); b && b.click(); });
      await sleep(500);
      const kept = await P.p.evaluate((b) => ({ same: (currentProfile.photo && currentProfile.photo.dataUrl) === b, gone: !document.getElementById('avatarPicker') }), before);
      out.push({ check: 'Cancel closes the picker and keeps the photo', ok: !!ch2 && kept.same && kept.gone, detail: JSON.stringify(kept) });
      /* 6. 23 Oct b: in the video-call lobby the photo button takes a tap
         (the clear top bar used to lie over it), and Back still works */
      await P.p.evaluate(() => { try { showCallsignView(); } catch (_) {} startOutgoingCall('c-bob'); });
      await sleep(2500);
      const lob = await P.p.evaluate(() => {
        const at = (id) => { const b = document.getElementById(id); const r = b.getBoundingClientRect(); const t = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return { x: r.left + r.width / 2, y: r.top + r.height / 2, ok: !!t && (t === b || b.contains(t)) }; };
        window.__shots = 0; const c = document.getElementById('camCaptureBtn'); const o = c.onclick; c.onclick = function () { window.__shots++; };
        return { cam: at('camCaptureBtn'), back: at('lobbyBack') };
      });
      await P.p.mouse.click(lob.cam.x, lob.cam.y);
      await sleep(400);
      const shots = await P.p.evaluate(() => window.__shots);
      out.push({ check: 'video-call lobby: the photo button takes a tap', ok: lob.cam.ok && shots === 1, detail: JSON.stringify(lob.cam) + ' taps ' + shots });
      await P.p.mouse.click(lob.back.x, lob.back.y);
      await sleep(1200);
      const closed = await P.p.evaluate(() => !document.getElementById('callOverlay').classList.contains('active'));
      out.push({ check: 'video-call lobby: Back still closes it', ok: lob.back.ok && closed, detail: '' });
      const errs = P.log.filter((l) => /PAGEERROR/.test(l));
      out.push({ check: 'no page errors', ok: !errs.length, detail: errs.slice(0, 2).join(' / ') });
    } finally { await P.b.close().catch(() => {}); }
    return out;
  },
};
