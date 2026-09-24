/* 2026.09.24c — lexical Firestore, back hash, ad hold, band clock, street, mine tools. */
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const social = read('js/signal-social.js');
const profile = read('js/profile.js');
const ads = read('js/ads.js');
const admin = read('js/admin-console.js');
const band = read('js/band-room.js');
const beacon = read('js/beacon.js');
const html = read('app/index.html');
const sw = read('sw.js');

assert.ok(social.includes("typeof fbDb !== 'undefined' && fbDb"), 'Seen by uses the real Firestore binding');
assert.ok(!social.includes('root.fbDb'), 'Seen by does not read window.fbDb');
assert.ok(!social.includes('root.currentUser'), 'reactions do not read window.currentUser');
assert.ok(social.includes("kind: 'signal-pulse'"), 'a view still lands in the notification inbox');

assert.ok(profile.includes('#n/'), 'Back changes the address so Android records it');
assert.ok(profile.includes('naluno:tabStack:v2'), 'tab history survives the WebView');
assert.ok(profile.includes('backButton'), 'the Capacitor back button is handled');
assert.ok(profile.includes('__nalunoCallHist'), 'a call back is left alone');

assert.ok(ads.includes("kind: 'broadcast-ad'"), 'a refused deskAds write is sent as mail');
assert.ok(ads.includes("collection('deskMail')"), 'Advertise uses a write members can already make');
assert.ok(ads.includes("status: 'paused'"), 'the ad is not created live');
assert.ok(admin.includes('function promoteHeldAd'), 'the console turns the letter into inventory');
assert.ok(admin.includes("'hold_' + mailId"), 'the held ad has a stable id');
assert.ok(admin.includes("prev.status === 'live'"), 'Go live is not undone by a later letter');
assert.ok(admin.includes('Held for review'), 'the inventory says it is waiting for a person');

assert.ok(band.includes('have <= when + 1500'), 'an empty room does not move the wipe clock forward');
assert.ok(band.includes('bandNewestMessageMs'), 'a quiet room wipes from the last real message');
assert.ok(!band.includes('Always restamp the latest empty time'), 'the clock reset is gone');

assert.ok(beacon.includes('photon.komoot.io/reverse'), 'Find Naluno asks for a street');
assert.ok(beacon.includes('nalunoPlace:v2:'), 'a cached city does not block the street');
assert.ok(beacon.includes('if(place) block += place'), 'the place leads the reply');

assert.ok(html.includes('id="bcastOfflineWatch"'), 'Offline watch is inside My Broadcasts');
assert.ok(html.includes('id="bcastPrivateWatch"'), 'Private broadcasts is inside My Broadcasts');
assert.ok(!html.includes('id="openDownloadsBtn"'), 'saved broadcasts are not under Callsign');
assert.ok(html.includes('2026.09.24d'), 'member build stamp');
assert.ok(sw.includes('naluno-shell-v203'), 'the shell cache moves');
assert.ok(sw.includes("APP_BUILD = '20260924d'"), 'service worker build');

console.log('play-24c tests passed');
