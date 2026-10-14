/* 14 Oct d: the website in plain words (home, /invest, /contact).
   Checks that what worked before is still wired. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const home = read('index.html'), invest = read('invest/index.html'), contact = read('contact/index.html');

/* Deep links and installed apps still go straight to the app. */
assert.ok(/isDeepLink = !!\(params\.broadcast \|\| params\.strand \|\| params\.spark \|\| params\.call/.test(home) && /window\.location\.replace\('\/app\/' \+ q \+ hash\)/.test(home), 'a call or Broadcast link opened on the website reaches the app');
assert.ok(/admin\.getnaluno\.com/.test(home), 'the console host still goes to /admin/');

/* Forms post to the same mail worker with the same kinds. */
const MAIL = "https://naluno-economy.naluno.workers.dev/v1/mail";
assert.ok(contact.includes(MAIL) && /id="nalunoContact"/.test(contact) && /kind: wantDelete \? 'delete-account' : 'contact'/.test(contact), 'the contact form (and account deletion) moved to /contact/ unchanged');
assert.ok(invest.includes(MAIL) && /id="nalunoInvest"/.test(invest) && /kind: 'invest'/.test(invest), 'the investor form is unchanged');
assert.ok(/id="contact"/.test(home) && /href="\/contact\/"/.test(home), 'old /#contact links still land somewhere useful');

/* Visit counting and the Android download setting on every page. */
[home, invest, contact].forEach((p) => {
  assert.ok(/site-pulse\.js\?v=20261006b/.test(p), 'visit counting on every page');
  assert.ok(/\/css\/site\.css\?v=/.test(p), 'the shared site stylesheet, versioned');
});
assert.ok(/ANDROID_APK_URL/.test(home) && /firebase-config\.js/.test(home), 'the Android button appears only when its download address is set');
assert.ok(!/href="\/app\/">install the full app/.test(home), 'no "install" link that only reopens the web app');

/* Real screens, demo accounts, said so on the page. */
['chat', 'call', 'broadcast', 'create'].forEach((n) => assert.ok(fs.existsSync(path.join(root, 'img/screens/' + n + '.jpg')), 'screen ' + n));
assert.ok(/shown with demo accounts/.test(home) && /shown with demo accounts/.test(invest), 'the screens are labelled as demo accounts');
assert.ok(/amazon\.com\/author\/ejmagambo/.test(home) && /amazon\.com\/author\/ejmagambo/.test(invest), 'the founder\'s books are linked');
assert.ok(/not an offer of securities/.test(invest), 'the securities note stays');
assert.ok(!/<meta name="naluno-build"/.test(home), 'the website is not the app');
console.log('fixes-1014d: all checks passed');
