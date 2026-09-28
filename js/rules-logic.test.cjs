/* The new Firestore rule functions, mirrored in JS and run against every
   normal write the app makes, plus the abuse each one blocks. Keep in step
   with firestore.rules (the rules text is checked for the functions below). */
const assert = require('assert');
const fs = require('fs');
const rules = fs.readFileSync(__dirname + '/../firestore.rules', 'utf8');
['upByAtMostOne', 'ownerTogaHonest', 'ownerTogaCreateHonest', 'memberChangeIsSelf', 'engagementBumpsHonest',
 'parentBroadcastVisible', 'connectionEntryClean', 'togaKeyNow', 'togaKeyPrev', 'togaKeyNext']
  .forEach((f) => assert.ok(rules.includes('function ' + f + '('), 'rules define ' + f));
assert.ok(rules.includes('&& engagementBumpsHonest());'));
assert.ok(rules.includes('allow read: if isSignedIn() && parentBroadcastVisible(id);'));
assert.ok(rules.includes('(request.auth.uid == uid && ownerTogaHonest())'));
assert.ok(rules.includes("match /{path=**}/signal/{segId}"));

function numOf(d, f) { return typeof d[f] === 'number' ? d[f] : 0; }
function bumpedAtMost(oldD, newD, f, m) { const o = numOf(oldD, f), n = numOf(newD, f); return n >= o && n - o <= m; }
function upByAtMostOne(oldD, newD, f) { return numOf(newD, f) <= numOf(oldD, f) + 1; }
function mk(y, m) { return y + '-' + (m < 10 ? '0' + m : '' + m); }
function keys(now) {
  const y = now.getUTCFullYear(), m = now.getUTCMonth() + 1;
  return [mk(y, m), m === 1 ? mk(y - 1, 12) : mk(y, m - 1), m === 12 ? mk(y + 1, 1) : mk(y, m + 1)];
}
function ownerTogaHonest(oldD, newD, now) {
  const f = ['viewsTotal', 'viewsMonth', 'circleMonth', 'engageMonth', 'scoreMonth'];
  keys(now).forEach((k) => f.push('mv_' + k, 'mc_' + k, 'me_' + k));
  return f.every((x) => upByAtMostOne(oldD, newD, x));
}
function memberChangeIsSelf(oldD, newD, uid) {
  const b = new Set(oldD.memberUids || []), a = new Set(newD.memberUids || []);
  const added = [...a].filter((x) => !b.has(x)), removed = [...b].filter((x) => !a.has(x));
  return added.every((x) => x === uid) && removed.every((x) => x === uid);
}
function engagementBumpsHonest(oldD, newD, uid) {
  return ['views', 'uniqueViews', 'comments', 'replies', 'shares', 'commentCount', 'replyCount', 'shareCount']
    .every((f) => bumpedAtMost(oldD, newD, f, 1)) && memberChangeIsSelf(oldD, newD, uid);
}
function connectionEntryClean(d) {
  const ok = ['name', 'handle', 'color', 'photo', 'photoUrl', 'connectedAt'];
  return Object.keys(d).every((k) => ok.includes(k))
    && (d.name == null || (typeof d.name === 'string' && d.name.length <= 80))
    && (d.handle == null || (typeof d.handle === 'string' && d.handle.length <= 40))
    && (d.color == null || /^#[0-9A-Fa-f]{3,8}$/.test(d.color))
    && (d.photoUrl == null || /^https?:\/\/[^"<>]*$/.test(d.photoUrl));
}
function parentVisible(b, uid, op, nowMs) {
  if (!b) return true;
  return b.creatorUid === uid || op || ((b.visibility || '') !== 'private' && (b.publishAt || 0) <= nowMs);
}
const now = new Date(Date.UTC(2026, 8, 28));
const K = keys(now)[0];

/* Toga: normal owner writes pass. */
const toga = { viewsTotal: 40, ['mv_' + K]: 12, shareViews: true };
assert.ok(ownerTogaHonest(toga, Object.assign({}, toga, { shareViews: false, togaIn: false, name: 'A', monthKey: K }), now), 'settings');
assert.ok(ownerTogaHonest(toga, Object.assign({}, toga, { viewsTotal: 40 - 12 }), now), 'delete adjust down');
assert.ok(!ownerTogaHonest(toga, Object.assign({}, toga, { ['mv_' + K]: 999999 }), now), 'self-crowning blocked');
assert.ok(!ownerTogaHonest(toga, Object.assign({}, toga, { ['mv_' + keys(now)[2]]: 5000 }), now), 'next-month key blocked');
assert.deepStrictEqual(keys(new Date(Date.UTC(2026, 0, 3))), ['2026-01', '2025-12', '2026-02']);
assert.deepStrictEqual(keys(new Date(Date.UTC(2026, 11, 3))), ['2026-12', '2026-11', '2027-01']);
/* The app's own month key is the same shape. */
const circle = fs.readFileSync(__dirname + '/circle.js', 'utf8');
assert.ok(circle.includes("d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0')"));

/* Broadcast engagement: view, comment, circle join/leave pass. */
const b = { views: 3, uniqueViews: 3, comments: 2, memberUids: ['x'] };
assert.ok(engagementBumpsHonest(b, Object.assign({}, b, { views: 4, uniqueViews: 4 }), 'v'), 'a view');
assert.ok(engagementBumpsHonest({}, { views: 1, uniqueViews: 1 }, 'v'), 'first view');
assert.ok(engagementBumpsHonest(b, Object.assign({}, b, { comments: 3 }), 'v'), 'a comment');
assert.ok(engagementBumpsHonest(b, Object.assign({}, b, { memberUids: ['x', 'v'] }), 'v'), 'join');
assert.ok(engagementBumpsHonest(b, Object.assign({}, b, { memberUids: [] }), 'x'), 'leave');
assert.ok(!engagementBumpsHonest(b, Object.assign({}, b, { views: 99999 }), 'v'), 'inflate');
assert.ok(!engagementBumpsHonest(b, Object.assign({}, b, { views: 0 }), 'v'), 'zero out');
assert.ok(!engagementBumpsHonest(b, Object.assign({}, b, { memberUids: [] }), 'v'), 'remove someone else');

/* Connections: the app's own mirror entry passes; injection does not. */
assert.ok(connectionEntryClean({ name: 'Magambo', handle: '@magambo', color: '#7CFFB2', photo: { dataUrl: 'https://x/y.jpg' }, photoUrl: 'https://x/y.jpg', connectedAt: {} }));
assert.ok(connectionEntryClean({ name: 'A', handle: '@a', color: '#FFB86B', photo: null, photoUrl: null, connectedAt: {} }));
assert.ok(!connectionEntryClean({ name: 'A', color: 'red;"><img src=x onerror=alert(1)>' }));
assert.ok(!connectionEntryClean({ name: 'A', photoUrl: 'x" onerror="alert(1)' }));
assert.ok(!connectionEntryClean({ name: 'A', admin: true }));

/* Private Broadcast subcollections. */
assert.ok(parentVisible({ creatorUid: 'c' }, 'v', false, 1));
assert.ok(!parentVisible({ creatorUid: 'c', visibility: 'private' }, 'v', false, 1));
assert.ok(parentVisible({ creatorUid: 'c', visibility: 'private' }, 'c', false, 1));
assert.ok(!parentVisible({ creatorUid: 'c', publishAt: 10 }, 'v', false, 5));
assert.ok(parentVisible(null, 'v', false, 5), 'missing parent unchanged');

console.log('rules-logic tests passed');
