/* Adversary pass on the files in the zip: rules, money, location, stamps.
   A hostile client is assumed to ignore the UI. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const rules = read('firestore.rules');

assert.equal((rules.match(/\{/g) || []).length, (rules.match(/\}/g) || []).length, 'rules braces balance');
assert.ok(!/listed == false\s+\|\|\s+isTrustedPublisher/.test(rules), 'a phone cannot list itself by being trusted');
assert.ok(rules.includes('request.resource.data.listed == false'));
assert.ok(rules.includes('request.resource.data.held == true'));
assert.ok(rules.includes("hasOnly(['updatedAt', 'live', 'liveAt', 'liveBy', 'memberUids',\n                      'comments', 'replies', 'shares', 'commentCount', 'replyCount', 'shareCount'])"));
assert.ok(!rules.includes("allow update: if isSignedIn() && (\n        resource.data.createdBy == request.auth.uid"));
assert.ok(rules.includes('request.auth.uid in bandData().memberUids'));
assert.ok(rules.includes('resource.data.linkJoin == true'));
assert.ok(rules.includes('match /{path=**}/beacons/{beaconId}'));
assert.ok(rules.includes("request.resource.data.type != 'text' || (request.resource.data.encrypted == true && !('text' in request.resource.data))"));
assert.ok(rules.includes("request.resource.data.type == 'missed_call' && request.resource.data.text == 'Missed call'"));

const wire = read('js/wireline.js');
assert.ok(wire.includes("toast('Waiting for their key — this stays on your phone')"));
assert.ok(wire.includes('queueMessageForLater(c2.id, c.firebaseUid, payload, previewText, cmid)'));
assert.ok(!wire.includes('encrypted:false'));

assert.ok(!read('js/beacon.js').includes('lastLat: lat'));
assert.ok(read('js/beacon.js').includes('function nalunoStripPublicLocation'));

const curSrc = read('js/currency.js');
assert.ok(!curSrc.includes('FALLBACK_USD'));
assert.ok(!curSrc.includes('UGX: 3650'));
const ctx = { window: {}, localStorage: { getItem: () => null, setItem: () => {} }, document: { readyState: 'complete', addEventListener: () => {} }, fetch: () => Promise.reject(new Error('offline')) };
ctx.globalThis = ctx;
vm.runInNewContext(curSrc, ctx);
const C = ctx.window.NalunoCurrency;
assert.equal(C.convert(10, 'USD', 'UGX'), null);
C.applyRates({ USD: 1, UGX: 3700 }, { source: 'test', fetchedAt: Date.now() });
assert.equal(C.convert(2, 'USD', 'UGX'), 7400);

const sw = (read('sw.js').match(/APP_BUILD = '([^']+)'/) || [])[1];
const reg = (read('js/pwa.js').match(/register\('\/sw\.js\?v=([^']+)'/) || [])[1];
const build = (read('js/admin-console.js').match(/const BUILD = '([^']+)'/) || [])[1];
const html = (read('admin/index.html').match(/admin-console\.js\?v=([^"']+)/) || [])[1];
assert.equal(sw, reg);
assert.equal(sw, build);
assert.equal(sw, html);

const bundle = read('naluno-economy-worker.js');
const ver = (read('workers/economy/handler.mjs').match(/export const VERSION = "([^"]+)"/) || [])[1];
assert.ok(ver && bundle.includes('var VERSION = "' + ver + '";'), 'the paste file is the same worker');
assert.ok(bundle.includes('function claimProof'), 'the paste file refuses a second score of the same action');
assert.ok(bundle.includes('function handleLockPush'), 'the paste file sends the lock-screen alert');

console.log('adversary-1010 client checks passed');
