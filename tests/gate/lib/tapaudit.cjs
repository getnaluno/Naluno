/* Tap audit: taps one control like a finger does (at its centre, on top of
   whatever is there) and reports what happened. A control that is covered
   by something else, or that does nothing anyone could see, is reported. */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* Before the page loads: remember every element that is given a tap
   handler (addEventListener click/pointerup/touchend, or .onclick), so rows
   and icons that are plain divs are tapped too. */
function markTapHandlers() {
  const ael = EventTarget.prototype.addEventListener;
  EventTarget.prototype.addEventListener = function (type, fn, o) {
    try { if (this && this.nodeType === 1 && /^(click|pointerup|pointerdown|touchend|touchstart|mouseup)$/.test(type)) this.__tapH = 1; } catch (_) {}
    return ael.call(this, type, fn, o);
  };
  const d = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'onclick');
  if (d && d.set) Object.defineProperty(HTMLElement.prototype, 'onclick', { configurable: true, enumerable: d.enumerable, get: d.get, set(v) { try { if (v) this.__tapH = 1; } catch (_) {} return d.set.call(this, v); } });
}
async function install(p) {
  await p.evaluate(() => {
    if (window.__tap) return;
    const T = window.__tap = { muts: 0, dialogs: 0, opens: 0, files: 0, nav: 0 };
    T.sig = 0;
    new MutationObserver((l) => { l.forEach((m) => {
      const t = m.target && (m.target.nodeType === 1 ? m.target : m.target.parentElement);
      if (t && t.closest && t.closest('#liveClock, .clock, [data-tick], .sig-pulse, .cdial-rotor')) return;
      T.muts++;
      /* a change anyone would see: something shown, hidden, opened, chosen */
      if (m.type === 'attributes' && /^(hidden|open|aria-expanded|aria-pressed|aria-selected|aria-checked|checked|disabled)$/.test(m.attributeName)) { T.sig++; T.strong = (T.strong || 0) + 1; }
      else if (m.type === 'attributes' && m.attributeName === 'class') { const was = String(m.oldValue || '').split(/\s+/), now = String(t.className || '').split(/\s+/); const diff = was.filter((x) => !now.includes(x)).concat(now.filter((x) => !was.includes(x))); if (diff.some((x) => /active|open|on$|^on|show|selected|expanded|visible|hidden|playing|muted|off/.test(x))) T.sig++; }
      else if (m.type === 'attributes' && m.attributeName === 'style' && t && /display|visibility|transform|opacity/.test(t.getAttribute('style') || '')) T.sig += 0;
      else if (m.type === 'childList' && Array.from(m.addedNodes).some((n) => n.nodeType === 1 && !(n.closest && n.closest('#liveClock')))) T.sig++;
      else if (m.type === 'characterData' || (m.type === 'childList' && Array.from(m.addedNodes).some((n) => n.nodeType === 3))) T.sig++;
    }); })
      .observe(document.body, { subtree: true, childList: true, attributes: true, attributeOldValue: true, characterData: true });
    const o = window.open; window.open = function () { T.opens++; return null; };
    const fc = HTMLInputElement.prototype.click; HTMLInputElement.prototype.click = function () { if (this.type === 'file') { T.files++; return; } return fc.apply(this, arguments); };
    document.addEventListener('click', (e) => { const i = e.target && e.target.closest && e.target.closest('input[type=file]'); if (i) { T.files++; e.preventDefault(); } const a = e.target && e.target.closest && e.target.closest('a[href]'); if (a && !/^javascript:|^#/.test(a.getAttribute('href') || '')) { T.nav++; e.preventDefault(); } }, true);
    const al = window.alert, cf = window.confirm, pr = window.prompt;
    window.alert = function () { T.dialogs++; }; window.confirm = function () { T.dialogs++; return false; }; window.prompt = function () { T.dialogs++; return null; };
  });
}

function snapshot(p) {
  return p.evaluate(() => {
    const vis = (e) => { if (!e) return false; const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && +s.opacity > 0.05; };
    const cand = new Set(Array.from(document.querySelectorAll('body > *, .call-overlay, .sheet, .modal, [role=dialog], [id$=Overlay], [id$=Sheet], [id$=sheet], [id*=Legal], .nl-sheet-wrap, .nl-menu, .cdial-plate')));
    const layers = Array.from(cand).filter((e) => { if (!vis(e)) return false; const s = getComputedStyle(e); if (e.classList.contains('cdial-plate')) return !e.hidden; if (s.position !== 'fixed' && s.position !== 'absolute') return false; const r = e.getBoundingClientRect(); return r.width * r.height > innerWidth * innerHeight * 0.2 && !e.matches('nav, .navbar, #tabbar, .tabbar, header, main, .app, #app, .tabscreen'); }).map((e) => e.id || String(e.className).slice(0, 30)).sort().join('|');
    const tab = (document.querySelector('.tabscreen.active') || {}).id || '';
    return { strong: window.__tap.strong || 0, sig: window.__tap.sig, muts: window.__tap.muts, dialogs: window.__tap.dialogs, opens: window.__tap.opens, files: window.__tap.files, nav: window.__tap.nav, layers, tab, focus: (document.activeElement && (document.activeElement.id || document.activeElement.tagName)) || '', href: location.href, scrollY: (document.querySelector('.tabscreen.active .tab-scroll') || document.scrollingElement).scrollTop };
  });
}

/* list the visible controls inside root (a selector), with a stable path */
function controls(p, rootSel, skip) {
  return p.evaluate(([rootSel, skip]) => {
    const root = document.querySelector(rootSel);
    if (!root) return [];
    const vis = (e) => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 2 && r.height > 2 && s.visibility !== 'hidden' && s.display !== 'none' && s.pointerEvents !== 'none' && +s.opacity > 0.05; };
    const base = Array.from(root.querySelectorAll('button, [role=button], a[href], .chip, input[type=file], input[type=checkbox], input[type=radio], select, summary, label[for], [onclick], [data-action], [tabindex="0"]'));
    /* plus anything that looks tappable (a hand cursor) and is not inside one already listed */
    const big = (e) => { const r = e.getBoundingClientRect(); return r.width * r.height > innerWidth * innerHeight * 0.5; };
    const pointer = Array.from(root.querySelectorAll('div, li, span, img, svg, section, article, p, h3, h4')).filter((e) => { try { if (big(e)) return false; if (e.__tapH) return true; return getComputedStyle(e).cursor === 'pointer' && !(e.parentElement && getComputedStyle(e.parentElement).cursor === 'pointer'); } catch (_) { return false; } });
    const all = base.concat(pointer.filter((e) => !base.some((b) => b === e || b.contains(e) || e.contains(b))));
    const seen = new Set();
    window.__tapEls = [];
    const out = [];
    all.forEach((e) => {
      if (e.disabled) return;
      if (e.matches('input[type=file]')) { const r = e.getBoundingClientRect(); if (!(r.width > 2 && r.height > 2) || getComputedStyle(e).display === 'none') return; }
      else if (!vis(e)) return;
      let host = e;
      if (e.matches('input[type=file]')) host = e.parentElement || e;
      if (seen.has(host)) return;
      seen.add(host);
      let anc = e.parentElement, hidden = false;
      while (anc && anc !== document.body) { if (getComputedStyle(anc).display === 'none') { hidden = true; break; } anc = anc.parentElement; }
      if (hidden) return;
      const label = ((e.getAttribute('aria-label') || '') + ' ' + (e.innerText || e.value || e.title || '')).replace(/\s+/g, ' ').trim().slice(0, 60);
      const id = e.id || (e.closest('[id]') || {}).id || '';
      const risky = new RegExp(skip, 'i').test(label + ' ' + e.id + ' ' + e.className);
      window.__tapEls.push(e);
      out.push({ i: window.__tapEls.length - 1, label, id, tag: e.tagName.toLowerCase(), cls: String(e.className || '').slice(0, 40), risky });
    });
    return out;
  }, [rootSel, skip]);
}

async function tap(p, i, extra) {
  const ex0 = extra ? extra() : null;
  const at = await p.evaluate((i) => {
    const e = window.__tapEls[i];
    if (!e || !e.isConnected) return { gone: true };
    e.scrollIntoView({ block: 'center', inline: 'center' });
    const r = e.getBoundingClientRect();
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    const top = document.elementFromPoint(x, y);
    const fileHost = e.matches('input[type=file]') ? e : e.querySelector && e.querySelector('input[type=file]');
    const ok = !!top && (top === e || e.contains(top) || top.contains(e) || (fileHost && (top === fileHost)) || (e.tagName === 'LABEL' && top.closest('label') === e) || (e.id && top.closest('label[for="' + e.id + '"]')));
    return { x, y, ok, top: top ? (top.id || top.tagName + '.' + String(top.className || '').slice(0, 30)) : 'nothing', inView: y > 0 && y < innerHeight && x > 0 && x < innerWidth };
  }, i);
  if (at.gone) return { gone: true };
  await sleep(120);
  const before = await snapshot(p);
  const idle = before.muts;
  await sleep(250);
  const mid = await snapshot(p);
  const noise = mid.muts - idle;
  const noiseSig = mid.sig - before.sig;
  const noiseStrong = mid.strong - before.strong;
  const b2 = await snapshot(p);
  let chooser = false;
  const fcP = p.waitForEvent('filechooser', { timeout: 700 }).then(() => { chooser = true; }).catch(() => {});
  await p.mouse.click(at.x, at.y);
  await Promise.race([fcP, sleep(750)]);
  let after = await snapshot(p);
  /* something that works over the network or asks the phone (location,
     camera) can take a moment: wait up to 3 s more before calling it dead */
  const quiet = (a) => !(chooser || a.files > b2.files || a.layers !== b2.layers || a.tab !== b2.tab || a.dialogs > b2.dialogs || a.opens > b2.opens || a.nav > b2.nav || (a.sig - b2.sig) > Math.max(0, noiseSig) * 2 || (a.muts - b2.muts) > noise * 3 + 2 || (a.strong - b2.strong) > noiseStrong * 2 || (extra && JSON.stringify(extra()) !== JSON.stringify(ex0)));
  for (let k = 0; k < 6 && quiet(after); k++) { await sleep(500); after = await snapshot(p); }
  const fx = [];
  if (extra) { const e1 = extra(); Object.keys(e1).forEach((k) => { if (e1[k] > ex0[k]) fx.push(k + '+' + (e1[k] - ex0[k])); }); }
  if (chooser || after.files > b2.files) fx.push('picker');
  if (after.layers !== b2.layers) fx.push('layer:' + after.layers.slice(0, 60));
  if (after.tab !== b2.tab) fx.push('tab:' + after.tab);
  if (after.dialogs > b2.dialogs) fx.push('dialog');
  if (after.opens > b2.opens || after.nav > b2.nav || after.href !== b2.href) fx.push('navigates');
  if (after.focus !== b2.focus && /INPUT|TEXTAREA|SELECT/.test(after.focus + '') ) fx.push('focus');
  if (Math.abs(after.scrollY - b2.scrollY) > 40) fx.push('scroll');
  const dm = after.muts - b2.muts;
  const ds = after.sig - b2.sig;
  const dst = after.strong - b2.strong;
  if (dm > noise * 3 + 2 || ds > Math.max(0, noiseSig) * 2 || dst > Math.max(0, noiseStrong) * 2) fx.push('changed:' + dm + '/' + ds + '/' + dst);
  return { ok: at.ok, covered: at.ok ? '' : at.top, inView: at.inView, fx };
}

async function reset(p, tab, base) {
  await p.keyboard.press('Escape').catch(() => {});
  await p.evaluate(() => {
    try { closeNalunoLegal(); } catch (_) {}
    document.querySelectorAll('.cdial-plate').forEach((x) => { x.hidden = true; });
    document.querySelectorAll('.call-overlay.active, .sheet.active, .modal.active, .overlay.active').forEach((x) => { if (x.id !== 'callOverlay') x.classList.remove('active'); });
    document.querySelectorAll('.nl-sheet-wrap, .nl-menu, #avatarPicker').forEach((x) => x.remove());
  }).catch(() => {});
  if (tab) await p.evaluate((t) => { try { nalunoShowTab(t); } catch (_) { const b = document.querySelector('.navbtn[data-tab="' + t + '"]'); b && b.click(); } }, tab).catch(() => {});
  await sleep(200);
}

async function layersNow(p) { return (await snapshot(p)).layers; }
module.exports = { markTapHandlers, layersNow, install, controls, tap, reset, snapshot, sleep };
