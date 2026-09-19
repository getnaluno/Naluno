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

mustNot(/match \/bands\/\{bandId\}[\s\S]*match \/invites\/\{inviteId\} \{\s*allow read, write: if isSignedIn\(\);/, 'Band invites are no longer any-signed-in');
mustNot(/match \/sparkRooms\/\{roomId\}[\s\S]*match \/messages\/\{messageId\} \{\s*allow read: if isSignedIn\(\);/, 'Spark room messages are no longer world-readable to members');
mustNot(/allow create: if isSignedIn\(\);\s*allow update, delete: if isOwner\(uid\);/, 'notifications create is no longer any-signed-in with no stamp');

console.log('firestore-rules contract tests passed');
