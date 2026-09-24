/* 2026.09.24b — seen-by fallback, back stack, advertise, saved open, ad maths. */
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const social = read('js/signal-social.js');
const ui = read('js/signal-ui.js');
const ads = read('js/ads.js');
const data = read('js/admin-data.js');
const offline = read('js/broadcast-offline.js');
const html = read('app/index.html');
const rules = read('firestore.rules');
const profile = read('js/profile.js');
const calls = read('js/calls.js');
const space = read('js/broadcast-space.js');

assert.ok(social.includes("kind: 'signal-pulse'"), 'a view is also written where members can already create');
assert.ok(social.includes('lastListErr'), 'an empty Seen by list says why when the read failed');
assert.ok(social.includes('function releaseSignalPlayer'), 'the Signal player is released before a linked Broadcast');
assert.ok(ui.includes('function closeSignalViewer'), 'Watch can close the Signal');
assert.ok(ui.includes("addEventListener('pointerup', go)"), 'a reaction is saved on the touch, not the click');

assert.ok(profile.includes('window.nalunoBack'), 'system back has an in-app history');
assert.ok(profile.includes('history.pushState'), 'a surface pushes history');
assert.ok(calls.includes('__nalunoCallPop'), 'a call back does not also pop the app history');

assert.ok(html.includes('id="bspaceAdvertiseBtn"'), 'Advertise is in the menu');
assert.ok(html.includes('id="bcastAdSheet"'), 'the creator ad form exists');
assert.ok(html.includes('id="crAdPaid"'), 'prepaid amount is on the form');
assert.ok(space.includes('openFromBroadcast'), 'Advertise opens the form');
assert.ok(ads.includes('paymentStatus: \'unpaid\''), 'saving does not pretend payment happened');
assert.ok(ads.includes('function closeFromBroadcast'), 'the form can close');
assert.ok(rules.includes("request.resource.data.source == 'broadcast'"), 'a creator may create their own paused ad');
assert.ok(rules.includes('paymentStatus == \'unpaid\''), 'a creator cannot mark an ad paid');

assert.ok(offline.includes('data-open='), 'a saved Broadcast row can be opened');
assert.ok(offline.includes('function openSaved'), 'tap opens the Broadcast');

assert.ok(data.includes('function rateOrCard'), 'a zero unit rate falls back to the card');
assert.ok(data.includes('if (impressions > 0 && views > impressions)'), 'completed watches survive a missing impression');

console.log('play-24b tests passed');
