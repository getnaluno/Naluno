/* ============================================================
   MODULE: js/avatar-picker.js
   The profile photo picker (23 Oct).
   OWNERSHIP: this file. Used by profile.js for the Callsign photo only;
   the Signal composer keeps its own Adjust screen.

   Like the photo pickers people know: the whole picture is shown, the
   circle that will be the photo is clear and the rest is dimmed. Pinch to
   zoom, drag with one finger to move (a mouse wheel or the slider zooms
   too). The picture always fills the circle. "Use photo" makes a square
   picture of exactly what is in the frame, so the photo looks the same
   everywhere it is shown.

   NalunoAvatarPicker.open(dataUrl) → Promise<null | { dataUrl, file, crop }>
   ============================================================ */
(function (root) {
  const OUT = 720;
  const MAX_ZOOM = 5;

  /* pure geometry, also used by the tests */
  function coverBase(natW, natH, side) {
    const k = side / Math.min(natW, natH);
    return { w: natW * k, h: natH * k };
  }
  function clampView(v, base, side) {
    const s = Math.min(MAX_ZOOM, Math.max(1, v.s));
    const w = base.w * s, h = base.h * s;
    const maxX = Math.max(0, (w - side) / 2), maxY = Math.max(0, (h - side) / 2);
    return { s: s, x: Math.min(maxX, Math.max(-maxX, v.x)), y: Math.min(maxY, Math.max(-maxY, v.y)) };
  }
  /* the part of the original picture inside the square frame */
  function sourceRect(view, base, natW, natH, side) {
    const w = base.w * view.s, h = base.h * view.s;
    const left = side / 2 + view.x - w / 2;
    const top = side / 2 + view.y - h / 2;
    const k = natW / w;
    return { sx: -left * k, sy: -top * (natH / h), sw: side * k, sh: side * (natH / h) };
  }
  function pinch(start, p1, p2, base, side) {
    const d0 = Math.hypot(start.p2.x - start.p1.x, start.p2.y - start.p1.y) || 1;
    const d1 = Math.hypot(p2.x - p1.x, p2.y - p1.y) || 1;
    const s = Math.min(MAX_ZOOM, Math.max(1, start.v.s * d1 / d0));
    /* the point between the fingers stays under the fingers */
    const m0 = { x: (start.p1.x + start.p2.x) / 2 - side / 2, y: (start.p1.y + start.p2.y) / 2 - side / 2 };
    const m1 = { x: (p1.x + p2.x) / 2 - side / 2, y: (p1.y + p2.y) / 2 - side / 2 };
    const r = s / start.v.s;
    return clampView({ s: s, x: m1.x - (m0.x - start.v.x) * r, y: m1.y - (m0.y - start.v.y) * r }, base, side);
  }

  function el(tag, css, attrs) {
    const e = document.createElement(tag);
    if (css) e.style.cssText = css;
    if (attrs) Object.keys(attrs).forEach(function (k) { e.setAttribute(k, attrs[k]); });
    return e;
  }

  function open(dataUrl) {
    return new Promise(function (resolve) {
      const img = new Image();
      img.decoding = 'async';
      img.onerror = function () { try { if (typeof toast === 'function') toast('That picture could not be shown here. Try a JPG or PNG.'); } catch (_) {} resolve(null); };
      img.onload = function () { show(img, resolve); };
      img.src = dataUrl;
    });
  }

  function show(img, resolve) {
    const natW = img.naturalWidth || 1, natH = img.naturalHeight || 1;
    const wrap = el('div', 'position:fixed;inset:0;z-index:2147483000;background:#07080D;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;padding:20px 16px calc(20px + env(safe-area-inset-bottom));touch-action:none;', { id: 'avatarPicker', role: 'dialog', 'aria-label': 'Move and zoom your photo' });
    const title = el('div', 'font:600 15px/1.3 var(--font-body, system-ui);color:#EEF1F7;text-align:center;');
    title.textContent = 'Move and pinch to fit';
    const stage = el('div', 'position:relative;width:min(92vw,420px);aspect-ratio:1/1;overflow:hidden;border-radius:16px;background:#000;touch-action:none;user-select:none;-webkit-user-select:none;', { id: 'avatarPickerStage' });
    const pic = el('img', 'position:absolute;left:50%;top:50%;max-width:none;max-height:none;user-select:none;-webkit-user-drag:none;pointer-events:none;will-change:transform;', { draggable: 'false', alt: '' });
    pic.src = img.src;
    const ring = el('div', 'position:absolute;inset:0;pointer-events:none;background:radial-gradient(circle closest-side at 50% 50%, transparent 99%, rgba(255,255,255,.85) 99%, rgba(255,255,255,.85) 100%, rgba(0,0,0,.6) 100%);');
    stage.appendChild(pic); stage.appendChild(ring);
    const zoom = el('input', 'width:min(92vw,420px);accent-color:var(--mint,#7CFFB2);', { type: 'range', min: '100', max: String(MAX_ZOOM * 100), value: '100', id: 'avatarPickerZoom', 'aria-label': 'Zoom' });
    const row = el('div', 'display:flex;gap:10px;width:min(92vw,420px);');
    const cancel = el('button', 'flex:1;padding:14px;border-radius:14px;border:1px solid rgba(255,255,255,.14);background:transparent;color:#EEF1F7;font-weight:600;font-size:14px;cursor:pointer;', { type: 'button', id: 'avatarPickerCancel' });
    cancel.textContent = 'Cancel';
    const use = el('button', 'flex:1;padding:14px;border-radius:14px;border:0;background:var(--mint,#7CFFB2);color:#0D0F17;font-weight:700;font-size:14px;cursor:pointer;', { type: 'button', id: 'avatarPickerUse' });
    use.textContent = 'Use photo';
    row.appendChild(cancel); row.appendChild(use);
    wrap.appendChild(title); wrap.appendChild(stage); wrap.appendChild(zoom); wrap.appendChild(row);
    document.body.appendChild(wrap);

    let side = stage.getBoundingClientRect().width || 320;
    let base = coverBase(natW, natH, side);
    let view = { s: 1, x: 0, y: 0 };
    function paint() {
      pic.style.width = base.w + 'px';
      pic.style.height = base.h + 'px';
      pic.style.transform = 'translate(-50%,-50%) translate(' + view.x + 'px,' + view.y + 'px) scale(' + view.s + ')';
      zoom.value = String(Math.round(view.s * 100));
    }
    paint();

    const pts = new Map();
    let start = null;
    function local(e) { const r = stage.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
    function begin() {
      const list = Array.from(pts.values());
      start = { v: Object.assign({}, view), p1: list[0], p2: list[1] || null };
    }
    stage.addEventListener('pointerdown', function (e) {
      e.preventDefault();
      try { stage.setPointerCapture(e.pointerId); } catch (_) {}
      pts.set(e.pointerId, local(e));
      begin();
    });
    stage.addEventListener('pointermove', function (e) {
      if (!pts.has(e.pointerId) || !start) return;
      pts.set(e.pointerId, local(e));
      const list = Array.from(pts.values());
      if (list.length >= 2 && start.p2) view = pinch(start, list[0], list[1], base, side);
      else if (list.length === 1) view = clampView({ s: view.s, x: start.v.x + (list[0].x - start.p1.x), y: start.v.y + (list[0].y - start.p1.y) }, base, side);
      paint();
    });
    function end(e) { pts.delete(e.pointerId); if (pts.size) begin(); else start = null; }
    stage.addEventListener('pointerup', end);
    stage.addEventListener('pointercancel', end);
    stage.addEventListener('wheel', function (e) {
      e.preventDefault();
      const f = Math.exp(-e.deltaY * 0.0015);
      view = clampView({ s: view.s * f, x: view.x * f, y: view.y * f }, base, side);
      paint();
    }, { passive: false });
    zoom.addEventListener('input', function () {
      const s = parseInt(zoom.value, 10) / 100;
      const f = s / view.s;
      view = clampView({ s: s, x: view.x * f, y: view.y * f }, base, side);
      paint();
    });
    function onResize() {
      const was = side;
      side = stage.getBoundingClientRect().width || side;
      if (Math.abs(was - side) < 1) return;
      const k = side / was;
      base = coverBase(natW, natH, side);
      view = clampView({ s: view.s, x: view.x * k, y: view.y * k }, base, side);
      paint();
    }
    root.addEventListener('resize', onResize);
    function close(result) {
      root.removeEventListener('resize', onResize);
      try { wrap.remove(); } catch (_) {}
      resolve(result);
    }
    cancel.onclick = function () { close(null); };
    use.onclick = function () {
      use.disabled = true;
      use.textContent = 'One moment…';
      try {
        const c = document.createElement('canvas');
        c.width = OUT; c.height = OUT;
        const g = c.getContext('2d');
        g.imageSmoothingQuality = 'high';
        const r = sourceRect(view, base, natW, natH, side);
        g.drawImage(img, r.sx, r.sy, r.sw, r.sh, 0, 0, OUT, OUT);
        const out = c.toDataURL('image/jpeg', 0.9);
        c.toBlob(function (blob) {
          let file = null;
          try { if (blob) file = new File([blob], 'avatar.jpg', { type: 'image/jpeg' }); } catch (_) { file = blob; }
          close({ dataUrl: out, file: file, crop: { scale: 1, xPct: 0, yPct: 0 } });
        }, 'image/jpeg', 0.9);
      } catch (_) {
        try { if (typeof toast === 'function') toast('That picture could not be used. Try another one.'); } catch (_) {}
        close(null);
      }
    };
  }

  root.NalunoAvatarPicker = { open: open, coverBase: coverBase, clampView: clampView, sourceRect: sourceRect, pinch: pinch, OUT: OUT, MAX_ZOOM: MAX_ZOOM };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.NalunoAvatarPicker;
})(typeof window !== 'undefined' ? window : globalThis);
