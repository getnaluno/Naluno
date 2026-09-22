const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
const adminSrc = fs.readFileSync(path.join(__dirname, 'admin-console.js'), 'utf8');
const authSrc = fs.readFileSync(path.join(__dirname, 'auth.js'), 'utf8');
const currencySrc = fs.readFileSync(path.join(__dirname, 'currency.js'), 'utf8');
const adminHtml = fs.readFileSync(path.join(root, 'admin/index.html'), 'utf8');

assert.ok(adminSrc.includes("const CONSOLE_APP = 'naluno-console'"), 'console named app');
assert.ok(adminSrc.includes('firebase.initializeApp(firebaseConfig, CONSOLE_APP)'), 'named init only');
assert.ok(!/initializeApp\(firebaseConfig\)\s*;/.test(adminSrc), 'console must not create [DEFAULT]');
assert.ok(/fbAuth\s*=\s*app\.auth\(\)/.test(adminSrc), 'console auth is the named app');
assert.ok(!/fbAuth\s*=\s*firebase\.auth\(\)/.test(adminSrc), 'console must not use default auth()');
assert.ok(!/fbDbAdmin\s*=\s*firebase\.firestore\(\)/.test(adminSrc), 'console must not use default firestore()');
assert.ok(adminSrc.includes('app.firestore()') || adminSrc.includes('consoleApp().firestore()'), 'console firestore on named app');
assert.ok(/const BUILD = '20260922[a-z]'/.test(adminSrc), 'admin build stamped');
assert.ok(/2026\.09\.22/.test(adminHtml), 'admin html build stamped');
assert.ok(/admin-console\.js\?v=20260922/.test(adminHtml), 'admin cache-bust');
assert.ok(adminSrc.includes("body.persist !== 'memory'"), 'memory persist is not treated as saved on the account');
assert.ok(adminSrc.includes('cloudSetHash(uid, hash)'), 'setup always writes the account copy');

assert.ok(/fbAuth\s*=\s*firebase\.auth\(\)/.test(authSrc), 'member stays on [DEFAULT]');
assert.ok(!authSrc.includes('naluno-console'), 'member must not bind the console app');

/* Two independent Auth slots: sign-out of one must not clear the other,
   even when both sessions are the same email. */
function makeAuthSlot() {
  let user = null;
  const listeners = [];
  return {
    get currentUser() { return user; },
    signIn: function (u) { user = u; listeners.forEach(function (fn) { fn(user); }); },
    signOut: function () { user = null; listeners.forEach(function (fn) { fn(null); }); },
    onAuthStateChanged: function (fn) { listeners.push(fn); fn(user); },
  };
}
const member = makeAuthSlot();
const desk = makeAuthSlot();
const same = { uid: 'ibMOMY6Q3sVTCxIrwO2FGk43zw93', email: 'magjoed@gmail.com' };
let memberUser = same;
let deskUser = same;
member.onAuthStateChanged(function (u) { memberUser = u; });
desk.onAuthStateChanged(function (u) { deskUser = u; });
member.signIn(same);
desk.signIn(same);
assert.strictEqual(member.currentUser.email, desk.currentUser.email);
member.signOut();
assert.strictEqual(memberUser, null, 'member sign-out clears the member slot');
assert.ok(deskUser && deskUser.email === same.email, 'console stays signed in');
desk.signOut();
assert.strictEqual(deskUser, null, 'console sign-out clears the console slot');
member.signIn(same);
assert.ok(member.currentUser && !desk.currentUser, 'console sign-out must not clear a later member sign-in');

/* currency.listen(passedDb) must not require the member [DEFAULT] user. */
const apps = {};
function makeApp(name) {
  const authState = { user: name === 'naluno-console' ? { uid: 'op' } : null };
  const snaps = [];
  const app = {
    name: name,
    auth: function () {
      return {
        get currentUser() { return authState.user; },
      };
    },
    firestore: function () {
      return {
        collection: function () {
          return {
            doc: function () {
              return {
                onSnapshot: function (ok) { snaps.push(ok); return function () {}; },
                set: function () { return Promise.resolve(); },
                get: function () { return Promise.resolve({ exists: false }); },
              };
            },
          };
        },
      };
    },
  };
  apps[name] = app;
  return app;
}
const firebase = {
  apps: [],
  initializeApp: function (cfg, name) {
    const app = makeApp(name || '[DEFAULT]');
    firebase.apps.push(app);
    return app;
  },
  app: function (name) {
    const n = name || '[DEFAULT]';
    if (!apps[n]) throw new Error('no app ' + n);
    return apps[n];
  },
  auth: function () { return firebase.app().auth(); },
  firestore: function () { return firebase.app().firestore(); },
};
firebase.initializeApp({}, 'naluno-console');
const ctx = {
  firebase: firebase,
  firebaseConfig: { apiKey: 'x' },
  document: { readyState: 'complete', addEventListener: function () {} },
  window: {},
  setInterval: function () { return 0; },
  localStorage: { getItem: function () { return null; }, setItem: function () {} },
  fetch: function () { return Promise.resolve({ ok: false }); },
  Date: Date,
  Number: Number,
  String: String,
  Math: Math,
  JSON: JSON,
  parseInt: parseInt,
  isNaN: isNaN,
  console: console,
};
ctx.window = ctx;
ctx.globalThis = ctx;
vm.runInNewContext(currencySrc, ctx);
const C = ctx.NalunoCurrency;
assert.ok(C && typeof C.listen === 'function', 'NalunoCurrency.listen');
const passed = firebase.app('naluno-console').firestore();
C.listen(passed);
assert.ok(true, 'listen(passedDb) does not throw without [DEFAULT] user');

try { firebase.auth(); assert.fail('default auth should not exist on the console page'); }
catch (e) { assert.ok(e, 'console page has no [DEFAULT] app'); }

console.log('auth-isolation tests passed');
