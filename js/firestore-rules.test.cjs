const fs = require('fs');
const assert = require('assert');

const rules = fs.readFileSync(__dirname + '/../firestore.rules', 'utf8');

function must(re, msg) {
  assert.ok(re.test(rules), msg);
}
function mustNot(re, msg) {
  assert.ok(!re.test(rules), msg);
}

must(/bumpedAtMost\('impressions', 1\)/, 'deskAds member writes may bump impressions by at most 1');
must(/bumpedAtMost\('clicks', 1\)/, 'deskAds member writes may bump clicks by at most 1');
must(/ownerKeepsModeration/, 'owners cannot lift a suspension from their own profile');
must(/stampedAsSelf/, 'notifications and broadcast subdocs must stamp the signed-in uid');
must(/sparkRooms\/\{roomId\}[\s\S]*participants/, 'Spark room messages are participant-only');
must(/callerUid == resource\.data\.callerUid/, 'call parties cannot swap caller/callee');
must(/hasOnly\(\['read', 'readAt', 'delivered', 'taken', 'status'\]\)/, 'Wireline participants cannot rewrite someone else\'s message body');
must(/request\.resource\.data\.creatorUid == request\.auth\.uid/, 'origin marks must belong to the signer');
must(/reason\.size\(\) > 9/, 'reports require a real reason in rules, not only in the worker');
must(/lastEmptiedAt != null \|\| bandData\(\)\.messageEpoch != null/, 'Band prune deletes require membership, not any signed-in user');
must(/request\.auth\.token\.operator == true/, 'operator custom claim is accepted in rules');
must(/allow get: if isSignedIn\(\);\s*allow list: if isOperator\(\);/, 'members can get a known user but cannot list the whole collection');
must(/match \/vault\/\{id\}/, 'private vault exists under the user');
must(/allow get: if true; \/\/ handle lookup/, 'handle lookup stays public get, not list');
must(/match \/sparks\/\{code\}[\s\S]*allow get: if isSignedIn\(\);\s*allow list: if isOperator\(\);/, 'Spark codes are not listable to members');
must(/hasOnly\(\['vid', 'kind', 'path', 'land'/, 'siteSessions accept landing, trail and source fields');
must(/bumpedAtMost\('visits', 1\)/, 'siteDays visit counters cannot jump');
must(/match \/adminConsole\/\{uid\} \{\s*allow read, write: if false;/, 'adminConsole hashes are not client-writable');
must(/match \/adminCredentials\/\{uid\} \{\s*allow read, write: if false;/, 'adminCredentials hashes are not client-writable');
must(/match \/reservedHandles\/\{handle\}/, 'reserved handles live in Firestore');
must(/reservedHandles\/\$\(handle\)/, 'handle create is denied when the name is reserved');
must(/holderUid == request\.auth\.uid/, 'the bound official account may keep a reserved handle');
must(/reservedCores\/\$\(handle\)/, 'handle create also checks reservedCores');
must(/match \/reservedCores\/\{core\}/, 'reserved cores catch underscore variants');
must(/match \/handleFlags\/\{id\}/, 'similarity flags are desk-readable');
must(/keepsBroadcastListing/, 'creators cannot list or unhide a Broadcast the desk held');
must(/screenDecision/, 'creators cannot stamp a Screen decision on a Broadcast');
must(/isTrustedPublisher/, 'trusted publisher helper stays in rules');
must(/trustedPublisher/, 'members cannot stamp themselves as a trusted publisher');
must(/creatorMayTightenListing/, 'creator may hide a Broadcast, never unhide it');
must(/request\.resource\.data\.listed is bool/, 'create always stamps listed');
mustNot(
  /listed == false\s+\|\|\s+isTrustedPublisher/,
  'Screen-allow new publishers may create listed — live worker cannot lift a hold without a service account',
);

mustNot(/match \/bands\/\{bandId\}[\s\S]*match \/invites\/\{inviteId\} \{\s*allow read, write: if isSignedIn\(\);/, 'Band invites are no longer any-signed-in');
mustNot(/match \/sparkRooms\/\{roomId\}[\s\S]*match \/messages\/\{messageId\} \{\s*allow read, write: if isSignedIn\(\);/, 'Spark room messages are no longer world-readable to members');
mustNot(/allow create: if isSignedIn\(\);\s*allow update, delete: if isOwner\(uid\);/, 'notifications create is no longer any-signed-in with no stamp');

console.log('firestore-rules contract tests passed');

const storage = fs.readFileSync(__dirname + '/../storage.rules', 'utf8');
assert.ok(/allow read, write: if false/.test(storage), 'Firebase Storage is locked — media is on R2');
console.log('storage-rules contract tests passed');
