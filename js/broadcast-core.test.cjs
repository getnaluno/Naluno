const fs = require('fs');
const assert = require('assert');

const src = fs.readFileSync(__dirname + '/broadcast-core.js', 'utf8');

assert.match(src, /function nalunoBroadcastListingFields\(screen\)/, 'listing reads Screen');
assert.match(src, /if\(decision === 'block'\)/, 'Screen block is not listed even for a trusted publisher');
assert.match(src, /if\(decision === 'allow'\)/, 'Screen-allow lists a new publisher at create');
assert.match(src, /nalunoBroadcastListingFields\(screenReport\)/, 'create uses the Screen report');
assert.match(src, /https:\/\/naluno-economy\.naluno\.workers\.dev/, 'place talks to the economy worker directly');
assert.doesNotMatch(src, /location\.origin \+ '\/__naluno-economy'/, 'place does not use the same-origin path that Firebase Hosting 404s');
assert.match(src, /placed\.screen === 'block'/, 'local plate only tightens on a Screen block');
assert.match(src, /catch\(_\)\{\}\s*try\{[\s\S]*saveOriginMark/, 'journey failure cannot abort a saved Broadcast');

console.log('broadcast-core publish-path tests passed');
