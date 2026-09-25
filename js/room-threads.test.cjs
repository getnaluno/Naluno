const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Threads = require('./room-threads.js');
const Engine = require('./discover-engine.js');

function doc(id, data) {
  return { id: id, data: function () { return data; } };
}

const grouped = Threads.group([
  doc('a', { text: 'top', ts: 1 }),
  doc('b', { text: 'reply', ts: 2, parent_id: 'a' }),
  doc('c', { text: 'reply to reply', ts: 3, parent_id: 'b' }),
  doc('d', { text: 'orphan', ts: 4, parent_id: 'missing' }),
]);
assert.deepStrictEqual(grouped.tops.map(function (r) { return r.id; }), ['a', 'd']);
assert.deepStrictEqual(grouped.replies.a.map(function (r) { return r.id; }), ['b', 'c']);
assert.ok(!grouped.replies.d);

const now = Date.now();
const quiet = Engine.blankViewer();
function row(partial) {
  return Object.assign({ id: 'b', title: 'Broadcast', creatorUid: 'c', createdAt: now - 86400000, tags: ['tea'] }, partial);
}
const liked = row({
  id: 'liked',
  features: { impressions: 80, likes: 30, dislikes: 1, meaningfulWatches: 20, avgWatchSec: 40, durationSec: 80, completionRate: 0.2 },
});
const disliked = row({
  id: 'disliked',
  creatorUid: 'other',
  features: { impressions: 80, likes: 1, dislikes: 30, meaningfulWatches: 20, avgWatchSec: 40, durationSec: 80, completionRate: 0.2 },
});
const ranked = Engine.run([disliked, liked], quiet, Engine.modelV1(), now);
assert.strictEqual(ranked.feed[0].id, 'liked');

const taste = Engine.applyTaste(quiet, { type: 'like', topics: ['tea'], creatorUid: 'c' });
assert.ok(taste.topics.tea > 0);
const down = Engine.applyTaste(taste, { type: 'dislike', topics: ['tea'], creatorUid: 'c' });
assert.ok(down.topics.tea < taste.topics.tea);
const kept = Engine.applyTaste(quiet, { type: 'kept_line', topics: ['tea'], creatorUid: 'c' });
assert.ok(kept.topics.tea > taste.topics.tea);

const rolled = Engine.rollup([
  { broadcastId: 'b', type: 'like' },
  { broadcastId: 'b', type: 'dislike' },
  { broadcastId: 'b', type: 'unlike' },
  { broadcastId: 'b', type: 'kept_line' },
]);
assert.strictEqual(rolled.features.b.likes, 0);
assert.strictEqual(rolled.features.b.dislikes, 1);
assert.strictEqual(rolled.features.b.keptLines, 1);
assert.ok(rolled.features.b.negativeEvents >= 1);

const root = path.join(__dirname);
const discover = fs.readFileSync(path.join(root, 'discover.js'), 'utf8');
const space = fs.readFileSync(path.join(root, 'broadcast-space.js'), 'utf8');
const html = fs.readFileSync(path.join(root, '../app/index.html'), 'utf8');
assert.ok(discover.indexOf('host.appendChild(sheet)') > 0, 'why sheet sits on the playing video');
assert.ok(discover.indexOf('over-video') > 0);
assert.ok(discover.indexOf('.pause()') < 0, 'why sheet must not pause');
assert.ok(space.indexOf('parent_id') > 0);
assert.ok(space.indexOf('bspaceSetReact') > 0);
assert.ok(space.indexOf('kept_line') > 0);
assert.ok(html.indexOf('id="bspaceUp"') > 0);
assert.ok(html.indexOf('id="bspaceKeepLine"') > 0);
assert.ok(html.indexOf('not part of this upload') < 0);

console.log('room-threads tests passed');
