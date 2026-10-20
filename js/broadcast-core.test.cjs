const fs = require('fs');
const assert = require('assert');

const src = fs.readFileSync(__dirname + '/broadcast-core.js', 'utf8');

assert.match(src, /function nalunoBroadcastListingFields\(screen(, opts)?\)/, "listing reads Screen");
assert.match(src, /if\(decision === 'block'\)/, 'Screen block is not listed even for a trusted publisher');
/* 19 Oct e: only a block (or an account the desk stopped) keeps a post off; a missing or
   uncertain reading is not a hold. The phone still creates it waiting; the worker lists it. */
const fields = src.slice(src.indexOf('function nalunoBroadcastListingFields'), src.indexOf('/** On the public feed.'));
assert.doesNotMatch(fields, /unread|'hold'/, 'no reading, or an unsure one, is not a hold');
/* A post the worker could not place is asked about again, with the detector's findings. */
assert.match(src, /if\(!placed \|\| placed\.ok === false \|\| !placed\.wrote\)\{[\s\S]{0,260}nalunoPlaceQueueAdd\(ref\.id, screenReport\)/, 'an unplaced post is queued');
assert.match(src, /nalunoPlaceBroadcast\(item\.id, null, item\.nudenet \?/, 'the retry sends the findings again');
assert.match(src, /addEventListener\('online'/, 'and retries when the phone is back online');
assert.match(src, /nalunoBroadcastListingFields\(screenReport(, \{[^)]*\})?\)/, 'create uses the Screen report');
assert.match(src, /https:\/\/naluno-economy\.naluno\.workers\.dev/, 'place talks to the economy worker directly');
assert.doesNotMatch(src, /location\.origin \+ '\/__naluno-economy'/, 'place does not use the same-origin path that Firebase Hosting 404s');
assert.match(src, /placed\.screen === 'block'/, 'local plate only tightens on a Screen block');
assert.match(src, /catch\(_\)\{\}\s*try\{[\s\S]*saveOriginMark/, 'journey failure cannot abort a saved Broadcast');

console.log('broadcast-core publish-path tests passed');
