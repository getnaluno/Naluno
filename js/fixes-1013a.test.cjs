/* 13 Oct a: Launch & Capacity. Static checks that the pieces stay wired
   (the behaviour is tested in workers/economy/launch-rest, upload-limits,
   live-sweep tests and the browser harnesses). */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

const rules = read('firestore.rules');
/* 1. A new Callsign profile needs a registration seat; nothing else about
      users changes, and existing profiles are only ever updated. */
assert.ok(/allow create: if isOwner\(uid\)\s*&& hasSeat\(uid\)/.test(rules), 'profile create needs a seat');
assert.ok(/function hasSeat\(uid\) \{\s*return exists\(\/databases\/\$\(database\)\/documents\/registrations\/\$\(uid\)\);/.test(rules));
assert.ok(/'publisherReview', 'publisherReviewAt'/.test(rules), 'review fields still protected');
/* 2. High-cost creates need a registered account and the feature on. */
assert.ok(/isRegistered\(\) && featureOn\('broadcasts'\)/.test(rules));
assert.ok(/isRegistered\(\) && featureOn\('signals'\)/.test(rules));
assert.ok(/isRegistered\(\) && featureOn\('bands'\)/.test(rules));
assert.ok(/\(isRegistered\(\) \|\| hasSeat\(request\.auth\.uid\)\)/.test(rules), 'a handle needs a profile or a seat');
assert.ok(/allow update: if liveStartAllowed\(\) && \(isOperator\(\)/.test(rules), 'going live is gated');
assert.ok(/featureOn\('live'\) && !guardStops\('newLives'\)/.test(rules));
assert.ok(/request\.resource\.data\.get\('type', ''\) == 'system' \|\| featureOn\('comments'\)/.test(rules), 'system lines are not comments');
/* 3. A missing config means everything stays on (no lock-out on deploy). */
assert.ok(/return !exists\(launchCfgPath\(\)\)\s*\|\| get\(launchCfgPath\(\)\)\.data\.get\('features', \{\}\)\.get\(name, true\) != false;/.test(rules));
/* 4. Launch data: only the service account writes; the audit is untouchable. */
['launchConfig', 'launchPrivate', 'launchState', 'launchHistory', 'launchAudit', 'launchUsage', 'registrations', 'waitlist'].forEach((c) => {
  const m = new RegExp('match /' + c + '/\\{[a-zA-Z]+\\} \\{[\\s\\S]*?allow write: if false;').exec(rules);
  assert.ok(m, c + ' is not writable by any client');
});
assert.ok(/match \/launchConfig\/\{env\} \{\s*allow read: if true;/.test(rules), 'the public part is readable before sign-in');

/* 5. The app: the door is checked before an account is made, a seat is taken
      before the profile is written, a new Google account claims too. */
const auth = read('js/auth.js');
const signUp = auth.slice(auth.indexOf('async function nalunoHandleSignUp'), auth.indexOf('async function nalunoForgotPassword'));
assert.ok(signUp.indexOf('NalunoLaunch.status()') < signUp.indexOf('createUserWithEmailAndPassword'), 'status before the account');
assert.ok(signUp.indexOf('NalunoLaunch.claim(user)') < signUp.indexOf("fbDb.collection('users').doc(user.uid).set("), 'seat before the profile');
assert.ok(/NalunoLaunch\.claim\(user\)\.then\(function\(seat\)\{\s*if\(seat && seat\.ok\)\{ nalunoEnsureJoined\(user, null\); return; \}/.test(auth), 'missing profile: claim first');
assert.ok(/seat\.reason !== 'network'/.test(auth), 'a network blip never removes an account');
assert.ok(/function oneAtATime\(fn\)/.test(auth), 'one sign-up at a time');
const html = read('app/index.html');
assert.ok(html.indexOf('/js/launch.js') > 0 && html.indexOf('/js/launch.js') < html.indexOf('/js/auth.js'), 'launch.js loads before auth.js');
assert.ok(read('sw.js').includes("'/js/launch.js'"), 'launch.js works offline');
const launch = read('js/launch.js');
assert.ok(/nothing else is asked or kept/i.test(launch), 'the waiting list says what it keeps');
assert.ok(!/country|phone number|passport|date of birth/i.test(launch.replace(/\/\*[\s\S]*?\*\//g, '')), 'no country, phone or ID asked');

/* 6. Upload worker: every limit is measured on the stored bytes. */
const up = read('signal-worker-index.js');
['checkBefore(env, cfg, uid', 'checkFile(env, cfg, ctStored, size', 'mp4Seconds', 'webmSeconds', 'imageSize', 'openUploads(env, uid', "url.pathname === '/b/abort'", 'isRegistered(env, uid, idToken)'].forEach((k) => assert.ok(up.includes(k), 'upload worker: ' + k));
assert.ok(/if \(!verdict\.ok\) \{\s*try \{ await env\.SIGNAL_BUCKET\.delete\(key\); \} catch \(_\) \{\}/.test(up), 'an over-limit file is deleted');

/* 7. Console: the tab exists, its script loads, nothing is written directly. */
const adminHtml = read('admin/index.html');
assert.ok(adminHtml.includes('data-tab="launch"'));
assert.ok(adminHtml.indexOf('/js/admin-launch.js') < adminHtml.indexOf('/js/admin-console.js'));
const desk = read('js/admin-launch.js');
assert.ok(!/\.collection\(/.test(desk), 'the desk page writes only through the worker');
assert.ok(/These limits go DOWN/.test(desk), 'a phase change lists what goes down');

/* 8. No money is filled in anywhere. */
const L = read('workers/economy/launch.mjs');
assert.ok(/monthlyUsd: 0,\s*\/\/ empty until the desk enters it/.test(L));
assert.ok(!/\$\s*\d|usd[^a-z]*[:=]\s*[1-9]/i.test(L.replace(/monthlyUsd: 0/, '')), 'no amounts in launch.mjs');

/* 9. The economy worker runs the guard on its cron. */
assert.ok(/runLaunchGuard\(env\)/.test(read('workers/economy/index.mjs')));

assert.ok(/fresh = isFinite\(made\) && Date\.now\(\) - made < 10 \* 60 \* 1000;/.test(launch) && /if \(fresh\) \{ try \{ if \(user && user\.delete\)/.test(launch), 'only a minutes-old sign-in account is ever removed');

console.log('fixes-1013a: all checks passed');
