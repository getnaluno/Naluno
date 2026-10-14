/* 15 Oct b: "Original Broadcast by" another creator only on writing pasted
   word for word and on a Pass-on. OriginID's file match marked a creator's
   own video as someone else's. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const core = read('js/broadcast-core.js');
assert.ok(/if\(repostOf\) basis = 'repost';\s*else if\(mediaType === 'writing' && String\(originCredit\.basis \|\| 'paste'\) === 'paste'\) basis = 'paste';/.test(core), 'a new Broadcast carries the line only as a Pass-on or pasted writing');
assert.ok(!/basis !== 'file'/.test(core), 'no file-match basis');
assert.ok(/originCredit: null,   \/\/ 15 Oct/.test(read('js/broadcast-composer.js')), 'the photo and video composer never attaches it');
const pass = read('js/pass-on.js');
assert.ok(/function originCreditAllowed\(origin\) \{\s*return false;\s*\}/.test(pass), 'OriginID never stamps a file as someone else\'s');
assert.ok(/if \(b && b\.repostOf\) return 'repost';/.test(pass) && !/return 'file'/.test(pass), 'shown only for a Pass-on or writing');
console.log('fixes-1015b: all checks passed');
