/* 2026.09.24f — mailbox, band queue, call back, names, answers, sheet back. */
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const mail = read('js/wire-mailbox.js');
const band = read('js/band-room.js');
const calls = read('js/calls.js');
const social = read('js/signal-social.js');
const rules = read('firestore.rules');
const profile = read('js/profile.js');
const app = read('app/index.html');
const sw = read('sw.js');

assert.ok(mail.includes('retryPendingDrops'), 'a drop waits until the contact exists');
assert.ok(!mail.includes('contactIdForUid(fromUid) != null ? contactIdForUid(fromUid) : fromUid'), 'a drop is not filed under the Firebase uid');
assert.ok(band.includes('nalunoIsOnline'), 'band uses the same online check as the rest of the app');
assert.ok(band.includes('if(!bandsReady){ left.push(row); continue; }'), 'a queued band line is not sent before the room is loaded');
assert.ok(calls.includes("#call/"), 'phone back during a call changes the address');
assert.ok(social.includes("'&' + 'amp;'"), 'who-watched escapes names');
assert.ok(rules.includes('function answerGrewByOne()'), 'someone else can answer a question');
assert.ok(rules.includes('function isOperator()'), 'operator check is still there');
assert.ok(profile.includes('contributionPanel'), 'phone back sees the contribution sheet');
assert.ok(profile.includes('closeTop'), 'changing tab closes the sheet on top');
/* Was a regex that stopped matching at v210. The cache must only move forward. */
assert.ok(Number((sw.match(/naluno-shell-v(\d+)/) || [])[1]) >= 205, 'shell cache');
assert.ok(/naluno-build" content="\d{4}\.\d{2}\.\d{2}[a-z]?"/.test(app), 'member build stamp');

console.log('play-24f tests passed');
