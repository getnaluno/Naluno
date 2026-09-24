/* 2026.09.24e — ad rows, silent desk, contribution totals, in-app waiting. */
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const admin = read('js/admin-console.js');
const html = read('admin/index.html');
const rules = read('firestore.rules');
const wire = read('js/wireline.js');
const life = read('js/lifeline-wire.js');
const sw = read('sw.js');
const app = read('app/index.html');

assert.ok(admin.includes('id="adSearch"'), 'ads have a search box');
assert.ok(admin.includes('class="desk-row"'), 'inventory is tappable rows');
assert.ok(admin.includes('function playAdPreview'), 'each ad can be played');
assert.ok(admin.includes('admAdPlay'), 'play button is wired');
assert.ok(admin.includes('function table'), 'long lists go through one row builder');
assert.ok(admin.includes('class="desk-row"'), 'rows expand');
assert.ok(!admin.includes('New activity'), 'the desk does not ask you to refresh');
assert.ok(admin.includes('function adminFetch'), 'contribution repair can call the service');
assert.ok(admin.includes('function localRepairTotals'), 'totals are added from the ledger when the service is quiet');
assert.ok(rules.includes('allow write: if isOperator();'), 'the desk may write repaired profiles');
assert.ok(html.includes('ad-player'), 'the player has a stage');
assert.ok(wire.includes('Waiting in Naluno'), 'a queued message shows inside Wireline');
assert.ok(wire.includes('class="wire-wait"'), 'the conversation list shows waiting');
assert.ok(life.includes('id="llTryNow"'), 'try again stays inside the chat');
assert.ok(!life.includes('Send by SMS'), 'sending does not leave Naluno');
assert.ok(/naluno-shell-v20[4-9]/.test(sw), 'shell cache');
assert.ok(/2026\.09\.2[4-9]/.test(app), 'member build stamp');

console.log('play-24e tests passed');
