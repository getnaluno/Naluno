/* 23 Oct c: security hardening — avatar crop can't inject, and the console
   sends/honours the 6-digit recovery code. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const R = path.resolve(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(R, f), 'utf8');
let n = 0;
const t = (name, fn) => { fn(); n++; console.log('ok ' + n + ' - ' + name); };

/* pull nalunoSafeImgSrc + applyAvatarVisual out of profile.js into a sandbox */
function fnSrc(src, name) {
  const i = src.indexOf('function ' + name);
  let depth = 0, started = false;
  for (let k = src.indexOf('{', i); k < src.length; k++) {
    if (src[k] === '{') { depth++; started = true; }
    else if (src[k] === '}') { depth--; if (started && depth === 0) return src.slice(i, k + 1); }
  }
  throw new Error('not found: ' + name);
}
function loadAvatar() {
  const src = read('js/profile.js');
  const code = fnSrc(src, 'nalunoSafeImgSrc') + '\n' + fnSrc(src, 'applyAvatarVisual');
  const helpers = `
    function initialsFor(){ return 'YO'; }
    function contactPhotoSrc(p){ return (p && p.photoUrl) || (p && p.photo && p.photo.dataUrl) || ''; }
    function contactAvatarColor(p){ return (p && p.color) || '#7CFFB2'; }
  `;
  const make = new Function('profile', helpers + code + `
    var el = { style:{}, _html:'', _text:'',
      set innerHTML(v){ this._html = v; }, get innerHTML(){ return this._html; },
      set textContent(v){ this._text = v; }, get textContent(){ return this._text; } };
    applyAvatarVisual(el, profile);
    return el;`);
  return { fn: function (_ignored, profile) { return make(profile); } };
}

t('a crafted crop.xPct string cannot break out of the style attribute', () => {
  const { fn } = loadAvatar();
  const evil = { name: 'x', photoUrl: 'https://e/x.jpg', photo: { dataUrl: 'https://e/x.jpg', crop: { scale: 1, xPct: '0%) scale(1);" onerror="alert(1)', yPct: 0 } } };
  const el = fn(undefined, evil);
  assert.ok(!/onerror="alert/.test(el.innerHTML), 'no injected onerror');
  assert.ok(!/alert\(1\)/.test(el.innerHTML), 'the payload is gone entirely');
  assert.ok(!/["<>]/.test(el.innerHTML.replace(/[^>]*style="[^"]*"/,'').match(/style="[^"]*"/) || ''), 'style carries no quotes/brackets');
});

t('a javascript: or non-image photo url is rejected (falls back to initials)', () => {
  const { fn } = loadAvatar();
  const el = fn(undefined, { name: 'x', photoUrl: 'javascript:alert(1)', photo: { dataUrl: 'javascript:alert(1)' } });
  assert.ok(!/javascript:/.test(el.innerHTML), 'no javascript: url');
  assert.strictEqual(el._text, 'YO', 'shows initials instead');
});

t('a normal numeric crop still renders a transform', () => {
  const { fn } = loadAvatar();
  const el = fn(undefined, { name: 'x', photoUrl: 'https://e/x.jpg', photo: { dataUrl: 'https://e/x.jpg', crop: { scale: 1.5, xPct: 10, yPct: -8 } } });
  assert.ok(/transform:translate\(10%,-8%\) scale\(1.5\)/.test(el.innerHTML), el.innerHTML.slice(0, 120));
});

t('the rules validate photo.crop as numbers — but only when the photo changes, and nulls are fine', () => {
  const r = read('firestore.rules');
  assert.ok(/function photoShapeOk\(p\)/.test(r));
  assert.ok(/p\.crop\.xPct == null \|\| p\.crop\.xPct is number/.test(r) && /p\.crop\.yPct == null \|\| p\.crop\.yPct is number/.test(r) && /p\.crop\.scale == null \|\| p\.crop\.scale is number/.test(r), 'numbers or empty');
  assert.ok(/p\.crop == null/.test(r), 'the app saves photo: { crop: null } for big photos — allowed');
  assert.ok(/!\('photo' in request\.resource\.data\.diff\(resource\.data\)\.affectedKeys\(\)\)/.test(r), 'only checked when the photo itself changes');
  assert.ok(/&& photoCropOkOnCreate\(\)/.test(r) && /pushTokensOnlyRemoved\(\) && photoCropOk\(\)/.test(r), 'wired into create and update');
  /* the live writers that produce crop: null are still accepted */
  assert.ok(/copy\.photo = \{ crop: copy\.photo\.crop \|\| null \}/.test(read('js/auth.js')));
});

t('the console sends the 6-digit code and refuses to fall back when the worker demands it', () => {
  const c = read('js/admin-console.js');
  assert.ok(/recovery_code: codeTyped|payload\.recovery_code = codeTyped/.test(c), 'sends recovery_code');
  assert.ok(/body\.code_required/.test(c) && /adminCodeRow'\)\)\s*\$\('adminCodeRow'\)\.style\.display = 'block'|adminCodeRow'\)\.style\.display = 'block'/.test(c), 'reveals the code box');
  /* the code_required / cooldown branches must return before the local/cloud fallback */
  const unlockSeg = c.slice(c.indexOf('async function adminUnlock'), c.indexOf('async function changeAdminPassword'));
  assert.ok(/code_required[\s\S]*?return;/.test(unlockSeg), 'code_required returns (no fallback)');
  assert.ok(/429[\s\S]*?cooldown_s[\s\S]*?return;/.test(unlockSeg), 'cooldown returns (no fallback)');
  assert.ok(/setRecoveryCode/.test(c), 'has a secret-code window');
});

t('the economy worker enforces 3 tries, the code, and never a permanent lock', () => {
  const w = read('workers/economy/handler.mjs');
  assert.ok(/CONSOLE_LOCK_AT = 3/.test(w));
  assert.ok(/recovery-code/.test(w) && /recoveryCodeMatches/.test(w));
  assert.ok(/CONSOLE_COOLDOWN_MS/.test(w) && /cooldown_s/.test(w), 'cooldown fallback when no code set');
  assert.ok(/adminCredentials/.test(w) && /saveGateState/.test(w), 'counter stored where no browser can write it');
});


/* ---- #3: App Check ships inert; worker caps registrations per IP ---- */
t('App Check is wired but OFF by default (empty site key = no change for users)', () => {
  assert.strictEqual(/const RECAPTCHA_SITE_KEY = "";/.test(read('firebase-config.js')), true, 'site key empty by default');
  const auth = read('js/auth.js');
  assert.ok(/function nalunoActivateAppCheck/.test(auth));
  assert.ok(/if\(!key\) return false;/.test(auth), 'no key → does nothing');
  assert.ok(/ReCaptchaV3Provider/.test(auth) && /appCheck\(\)\.activate/.test(auth));
  assert.ok(/firebase-app-check-compat\.js/.test(read('app/index.html')), 'SDK loaded');
});
t('the worker caps new accounts per IP (account-farming defence)', () => {
  const w = read('workers/economy/handler.mjs');
  assert.ok(/function claimIpRate/.test(w));
  assert.ok(/claimIpRate\(request\.headers\.get\("CF-Connecting-IP"\)/.test(w), 'wired into register/claim');
});
console.log('1..' + n);
