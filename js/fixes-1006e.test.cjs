/* 06 Oct (e): Google sign-in on phones came back to the sign-in gate.
   Since 02 Oct phones used signInWithRedirect. The site is getnaluno.com and
   the auth domain is naluno-28a00.firebaseapp.com; Chrome 115+, Safari 16.1+
   and Firefox 109+ block the cross-site hand-back, so the person returned
   signed out every time. Phones now use the popup like computers do. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const auth = read('js/auth.js');
const html = read('app/index.html');

/* 1. Which devices use the redirect: only in-app browsers that cannot open a window. */
{
  const fn = auth.slice(auth.indexOf('function nalunoPreferRedirectSignIn'), auth.indexOf('function nalunoMarkRedirect'));
  const pick = (ua) => { const box = { navigator: { userAgent: ua } }; vm.createContext(box); vm.runInContext(fn + '\nthis.r = nalunoPreferRedirectSignIn();', box); return box.r; };
  assert.strictEqual(pick('Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36'), false, 'Android Chrome: popup');
  assert.strictEqual(pick('Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'), false, 'iPhone Safari: popup');
  assert.strictEqual(pick('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'), false, 'computer: popup');
  assert.strictEqual(pick('Mozilla/5.0 (Linux; Android 14; SM-S918B; wv) AppleWebKit/537.36 Version/4.0 Chrome/128 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/470.0.0.0;]'), true, 'Facebook in-app browser: redirect');
  assert.strictEqual(pick('Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Instagram 300.0'), true, 'Instagram in-app browser: redirect');
  assert.ok(!/iPhone\|iPad\|iPod\|Android/.test(fn), 'phones are not sent to the redirect any more');
}

/* 2. A popup closed early is not turned into a redirect (it would come back signed out). */
{
  const btn = auth.slice(auth.indexOf("$('googleSignInBtn').onclick"), auth.indexOf('function emailAuthInputs'));
  assert.ok(/if\(popupCantOpen\)\{\s*authStatus\('Continuing sign-in…'\);\s*nalunoMarkRedirect\(true\);\s*fbAuth\.signInWithRedirect/.test(btn), 'a blocked window still falls back to the redirect');
  assert.ok(/\} else if\(closedEarly\)\{\s*\/\*[^*]*\*\/\s*nalunoSetAuthBusy\(false\);\s*authStatus\('The Google window closed/.test(btn), 'a closed window says so and waits');
  assert.strictEqual((btn.match(/signInWithRedirect/g) || []).length, 2, 'redirect only for in-app browsers and a blocked window');
  assert.ok(btn.indexOf('fbAuth.signInWithPopup(provider)') > 0, 'popup is the main way');
  /* Nothing awaits before the popup opens (a phone would block it). */
  const web = btn.slice(btn.indexOf('const provider = new firebase.auth.GoogleAuthProvider();'), btn.indexOf('fbAuth.signInWithPopup(provider)'));
  assert.ok(!/await /.test(web), 'the popup opens straight from the tap');
}

/* 3. Coming back from a lost redirect explains itself instead of a silent gate. */
{
  assert.ok(auth.includes('const cameBack = nalunoCameBackFromRedirect();'), 'the return from Google is recognised');
  assert.ok(auth.includes("if(redirectLostNote) authStatus(redirectLostNote, true);"), 'the message stays when the gate shows');
  assert.ok(auth.includes('Open getnaluno.com in Chrome or Safari'), 'in-app browsers are told where to go');
}

/* 4. Sign-in methods and the console are untouched. */
{
  assert.ok(auth.includes('fbAuth.setPersistence(firebase.auth.Auth.Persistence.LOCAL)'), 'staying signed in is unchanged');
  assert.ok(auth.includes('if(isNativeShell()){') && auth.includes('nativeGoogleSignIn()'), 'the Android app keeps its native Google sign-in');
  assert.ok(!read('admin/index.html').includes('js/auth.js'), 'the console does not load the app sign-in');
  assert.ok(/\/js\/auth\.js\?v=(?:20261006[e-z]|2026100[7-9][a-z]|202610[1-3][0-9][a-z])/.test(html), 'auth.js stamp');
  assert.ok(/APP_BUILD = '(?:20261006[e-z]|2026100[7-9][a-z]|202610[1-3][0-9][a-z])'/.test(read('sw.js')) && /register\('\/sw\.js\?v=(?:20261006[e-z]|2026100[7-9][a-z]|202610[1-3][0-9][a-z])'/.test(read('js/pwa.js')), 'service worker');
}
console.log('fixes-1006e tests passed');
