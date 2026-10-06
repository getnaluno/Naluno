/* 06 Oct (f): Google sign-in is handed back on getnaluno.com itself
   (Firebase "self-host the sign-in helper code"), so no browser can block
   it as a cross-site hand-back. The app switches only after it has seen
   Google's files served on the site, and back if they go missing. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const auth = read('js/auth.js');
const sw = read('sw.js');
const wf = read('.github/workflows/firebase-auth-helper.yml');

/* 1. Which sign-in domain the app uses. */
{
  const code = auth.slice(auth.indexOf("const NALUNO_OWN_AUTH_HOST"), auth.indexOf('function nalunoProbeOwnAuth'));
  const cfg = (host, flag) => {
    const store = flag ? { nalunoOwnAuth: '1' } : {};
    const box = { location: { hostname: host }, localStorage: { getItem: (k) => (k in store ? store[k] : null) },
      firebaseConfig: { apiKey: 'k', authDomain: 'naluno-28a00.firebaseapp.com', projectId: 'naluno-28a00' } };
    vm.createContext(box);
    vm.runInContext(code + '\nthis.c = nalunoAuthConfig();', box);
    return box.c;
  };
  assert.strictEqual(cfg('getnaluno.com', true).authDomain, 'getnaluno.com', 'files seen live: own domain');
  assert.strictEqual(cfg('getnaluno.com', false).authDomain, 'naluno-28a00.firebaseapp.com', 'not seen yet: the old way');
  assert.strictEqual(cfg('localhost', true).authDomain, 'naluno-28a00.firebaseapp.com', 'the Android app shell (localhost) is untouched');
  assert.strictEqual(cfg('www.getnaluno.com', true).authDomain, 'naluno-28a00.firebaseapp.com', 'only the address added in Google Cloud');
  assert.strictEqual(cfg('getnaluno.com', true).projectId, 'naluno-28a00', 'the rest of the config is unchanged');
  assert.ok(auth.includes('fbApp = firebase.initializeApp(nalunoAuthConfig());'), 'the app uses it');
  assert.ok(/authDomain: "naluno-28a00\.firebaseapp\.com"/.test(read('firebase-config.js')), 'firebase-config.js unchanged (console and website)');
}

/* 2. The probe switches on only when every file is really served. */
{
  const probe = auth.slice(auth.indexOf('function nalunoProbeOwnAuth'), auth.indexOf('window.nalunoOwnAuthOn'));
  assert.ok(probe.includes("page('/__/auth/handler'), page('/__/auth/iframe'), file('/__/auth/handler.js'), file('/__/auth/iframe.js'), config"), 'all five checked');
  assert.ok(/text\\\/html/.test(probe), 'the pages must come back as HTML, not a download');
  assert.ok(probe.includes('j.projectId === firebaseConfig.projectId'), 'init.json must be this project');
  assert.ok(probe.includes("if(ok) localStorage.setItem('nalunoOwnAuth', '1');") && probe.includes("else localStorage.removeItem('nalunoOwnAuth');"), 'and switches back if they go missing');
  assert.ok(auth.includes('setTimeout(nalunoProbeOwnAuth, 4000)'), 'checked after start-up, never blocking it');
}

/* 3. The service worker never answers /__/ with the app. */
assert.ok(/if\(!isSameOrigin\) return;\s*\/\*[\s\S]*?\*\/\s*if\(url\.pathname\.indexOf\('\/__\/'\) === 0\) return;/.test(sw), 'sign-in pages bypass the service worker');

/* 4. The workflow fetches every file Firebase lists, as HTML pages where needed. */
['handler" ', 'handler.js', 'experiments.js', 'iframe" ', 'iframe.js', 'links" ', 'links.js', 'init.json'].forEach((f) => assert.ok(wf.includes('/__/' + (f === 'init.json' ? 'firebase/' : 'auth/') + f.trim()), f));
['__/auth/handler.html', '__/auth/iframe.html', '__/auth/links.html', 'touch .nojekyll', '"projectId": *"naluno-28a00"', "cron: '17 3 * * 1'", 'workflow_dispatch'].forEach((s) => assert.ok(wf.includes(s), 'workflow: ' + s));
assert.ok(!/secrets\./.test(wf), 'needs no secrets');

/* 5. Stamps */
const html = read('app/index.html');
assert.ok(/\/js\/auth\.js\?v=(?:20261006[f-z]|2026100[7-9][a-z]|202610[1-3][0-9][a-z])/.test(html), 'auth.js stamp');
assert.ok(/APP_BUILD = '(?:20261006[f-z]|2026100[7-9][a-z]|202610[1-3][0-9][a-z])'/.test(sw) && /register\('\/sw\.js\?v=(?:20261006[f-z]|2026100[7-9][a-z]|202610[1-3][0-9][a-z])'/.test(read('js/pwa.js')), 'service worker stamp');
console.log('fixes-1006f tests passed');
