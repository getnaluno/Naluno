/* 2026.09.24d — tidy room, ad overlay, back nav, signal open, superadmin, books. */
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const html = read('app/index.html');
const css = read('css/app.css');
const ads = read('js/ads.js');
const social = read('js/signal-social.js');
const space = read('js/broadcast-space.js');
const profile = read('js/profile.js');
const econ = read('js/economy-ui.js');
const admin = read('js/admin-console.js');
const rules = read('firestore.rules');
const sw = read('sw.js');

assert.ok(html.includes('id="bspaceSupportBody" hidden'), 'support words start hidden');
assert.ok(html.includes('id="supportFlagChip">Off'), 'only Off/On sits on the support row');
assert.ok(econ.includes("chip.textContent = on ? 'On' : 'Off'"), 'the chip is On or Off');
assert.ok(econ.includes('toggleSupportBody'), 'support copy opens on tap');
assert.ok(!econ.includes('The operator has not switched'), 'the room does not talk about an operator');

assert.ok(ads.includes('Your ad awaits a review. Once confirmed it will go live.'), 'save says the ad awaits review');
assert.ok(!ads.includes('paused in the console'), 'the app does not mention the console');
assert.ok(ads.includes("room.appendChild(sheet)"), 'advertise sits on the Broadcast');
assert.ok(ads.includes('over-video'), 'the form is an overlay');
assert.ok(css.includes('#bspace #bcastAdSheet.over-video'), 'overlay is styled on the video');

assert.ok(profile.includes("classList.remove('naluno-bcast-watch'"), 'leaving a tab restores the nav');
assert.ok(space.includes("classList.remove('naluno-bspace-open', 'naluno-bcast-watch'"), 'closing a Broadcast restores the nav');
assert.ok(css.includes('body:not(.naluno-bcast-watch):not(.naluno-bspace-open) .navbar'), 'the bar is forced back');

assert.ok(social.includes("b.addEventListener('pointerdown', go)"), 'Watch opens on the first press');
assert.ok(!social.includes('}, 80);'), 'Watch does not wait');
assert.ok(space.includes('cachedBroadcastRow'), 'a known Broadcast opens without a round trip');

assert.ok(admin.includes('function isSuperAdmin'), 'the current admin is superadmin');
assert.ok(admin.includes('SUPER_UID'), 'superadmin identity is fixed');
assert.ok(admin.includes('function createDeskAdmin'), 'superadmin can create admins');
assert.ok(admin.includes('That account cannot be changed from here'), 'other admins cannot touch the superadmin');
assert.ok(admin.includes("tab === 'books'"), 'books is its own section');
assert.ok(admin.includes('id="booksPdf"'), 'books download as PDF');
assert.ok(admin.includes('id="booksXls"'), 'books download as a spreadsheet');
assert.ok(admin.includes('id="booksCsv"'), 'books download as CSV');
assert.ok(admin.includes('id="booksJson"'), 'books download as JSON');
assert.ok(rules.includes('function isSuper()'), 'rules know the superadmin');
assert.ok(rules.includes('deskOperators'), 'admin roster is stored');
assert.ok(rules.includes("uid != 'ibMOMY6Q3sVTCxIrwO2FGk43zw93'"), 'rules refuse to overwrite the superadmin');
assert.ok(sw.includes('naluno-shell-v203'), 'shell cache');
assert.ok(html.includes('2026.09.24d'), 'build stamp');

console.log('play-24d tests passed');
