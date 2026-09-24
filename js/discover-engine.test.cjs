/* Discovery: value, not crowd size, and not time-on-screen. */
const assert = require('assert');
const Engine = require('./discover-engine.js');
const now = Date.now();
const old = now - 10 * 24 * 3600 * 1000;

function row(partial) {
  return Object.assign({
    id: 'b',
    title: 'Broadcast',
    creatorUid: 'c',
    createdAt: old,
    tags: [],
  }, partial);
}

const quiet = Engine.blankViewer();

/* Follower count and raw view count are not features. */
{
  const big = row({ id: 'big', creatorUid: 'a', followers: 500000, views: 900000 });
  const small = row({ id: 'small', creatorUid: 'b', followers: 500, views: 12 });
  const out = Engine.run([big, small], quiet, Engine.modelV1(), now);
  assert.strictEqual(out.feed.length, 2);
  assert.ok(Math.abs(out.feed[0].score - out.feed[1].score) < 1e-9, 'crowd size does not change the score');
}

/* A small audience that stays beats a large audience that leaves. */
{
  const a = row({
    id: 'fit',
    creatorUid: 'a',
    followers: 40,
    views: 1000,
    features: {
      impressions: 1000, meaningfulWatches: 620, completions: 180, shares: 50, saves: 30, follows: 15,
      avgWatchSec: 400, durationSec: 600, completionRate: 0.18, returnRate: 0.04,
    },
  });
  const b = row({
    id: 'crowd',
    creatorUid: 'b',
    followers: 500000,
    views: 100000,
    features: {
      impressions: 100000, meaningfulWatches: 2000, completions: 100, shares: 10, saves: 2, follows: 1,
      avgWatchSec: 5, durationSec: 40, completionRate: 0.01, returnRate: 0,
    },
  });
  const out = Engine.run([b, a], quiet, Engine.modelV1(), now);
  assert.strictEqual(out.feed[0].id, 'fit');
}

/* Twelve minutes of a long Broadcast is not twelve seconds of a short one. */
{
  const longForm = row({
    id: 'long',
    features: { impressions: 50, avgWatchSec: 720, durationSec: 1200, completionRate: 0.6, meaningfulWatches: 20 },
  });
  const clip = row({
    id: 'clip',
    creatorUid: 'other',
    features: { impressions: 50, avgWatchSec: 12, durationSec: 20, completionRate: 0.6, meaningfulWatches: 20 },
  });
  const scored = Engine.run([clip, longForm], quiet, Engine.modelV1(), now);
  const byId = {};
  scored.feed.forEach(function (item) { byId[item.id] = item; });
  assert.ok(byId.long.parts.quality > byId.clip.parts.quality);
}

/* Contribution points are evidence, not the rank. */
{
  const points = row({
    id: 'points',
    features: { impressions: 100, contributionPoints: 5000, avgWatchSec: 2, durationSec: 600, completionRate: 0.01 },
  });
  const stayed = row({
    id: 'stayed',
    creatorUid: 'other',
    features: { impressions: 200, meaningfulWatches: 150, completions: 80, avgWatchSec: 600, durationSec: 900, completionRate: 0.4, contributionPoints: 0 },
  });
  const out = Engine.run([points, stayed], quiet, Engine.modelV1(), now);
  assert.strictEqual(out.feed[0].id, 'stayed');
}

/* Thin comments do not outrank a real conversation. */
{
  const spam = row({
    id: 'spam',
    commentCount: 40,
    features: { impressions: 80, comments: 40, meaningfulComments: 1, avgWatchSec: 20, durationSec: 100, completionRate: 0.1 },
  });
  const talk = row({
    id: 'talk',
    creatorUid: 'other',
    features: { impressions: 80, comments: 10, meaningfulComments: 8, questions: 3, avgWatchSec: 20, durationSec: 100, completionRate: 0.1 },
  });
  const out = Engine.run([spam, talk], quiet, Engine.modelV1(), now);
  assert.strictEqual(out.feed[0].id, 'talk');
}

/* Eligibility is upstream of rank. */
{
  const bad = [
    row({ id: 'hidden', hidden: true }),
    row({ id: 'held', held: true }),
    row({ id: 'private', visibility: 'private' }),
    row({ id: 'later', publishAt: now + 86400000 }),
    row({ id: 'unsafe', features: { safetyStatus: 'blocked' } }),
    row({ id: 'nope', creatorUid: 'blocked-person' }),
  ];
  const viewer = Engine.blankViewer();
  viewer.blocked['blocked-person'] = 1;
  viewer.notInterested.skipme = 1;
  bad.push(row({ id: 'skipme' }));
  const ok = row({ id: 'ok', creatorUid: 'fine' });
  const out = Engine.run(bad.concat([ok]), viewer, Engine.modelV1(), now);
  assert.deepStrictEqual(out.feed.map(function (x) { return x.id; }), ['ok']);
}

/* Not interested removes that Broadcast and cools the topic. */
{
  let viewer = Engine.blankViewer();
  viewer = Engine.applyTaste(viewer, { type: 'not_interested', broadcastId: 'x', creatorUid: 'c', topics: ['topic:coffee'] });
  assert.strictEqual(viewer.notInterested.x, 1);
  assert.ok(viewer.topics['topic:coffee'] < 0);
  const out = Engine.run([row({ id: 'x', tags: ['coffee'] })], viewer, Engine.modelV1(), now);
  assert.strictEqual(out.feed.length, 0);
}

/* Discovery budget keeps an unfamiliar Broadcast in the feed. */
{
  const viewer = Engine.applyTaste(Engine.blankViewer(), {
    type: 'watch_completed', creatorUid: 'known', topics: ['topic:coffee'],
  });
  const list = [];
  for (let i = 0; i < 8; i++) {
    list.push(row({ id: 'c' + i, creatorUid: 'creator-' + i, tags: ['coffee'], createdAt: old }));
  }
  for (let i = 0; i < 4; i++) {
    list.push(row({ id: 'd' + i, creatorUid: 'stranger-' + i, tags: ['weaving'], createdAt: old }));
  }
  const model = Engine.modelV1();
  model.assembly.discoveryShare = 0.25;
  const out = Engine.run(list, viewer, model, now);
  const early = out.feed.slice(0, 8).some(function (item) { return String(item.id).charAt(0) === 'd'; });
  assert.ok(early, 'an unfamiliar Broadcast is in the early feed');
  assert.ok(out.feed.every(function (item) { return item.why && item.why.length > 8; }));
}

/* The same creator does not sit in a row when someone else is eligible. */
{
  const list = [];
  for (let i = 0; i < 4; i++) list.push(row({ id: 'a' + i, creatorUid: 'same', tags: ['coffee'] }));
  list.push(row({ id: 'b0', creatorUid: 'other', tags: ['coffee'] }));
  list.push(row({ id: 'b1', creatorUid: 'third', tags: ['coffee'] }));
  const viewer = Engine.applyTaste(Engine.blankViewer(), { type: 'watch_completed', topics: ['topic:coffee'], creatorUid: 'same' });
  const out = Engine.run(list, viewer, Engine.modelV1(), now);
  for (let i = 1; i < Math.min(4, out.feed.length); i++) {
    assert.notStrictEqual(out.feed[i].creatorUid, out.feed[i - 1].creatorUid);
  }
}

/* Two models exist, and the second is not a copy of the first. */
{
  const a = Engine.modelV1();
  const b = Engine.modelV2();
  assert.notStrictEqual(a.id, b.id);
  assert.notStrictEqual(a.weights.satisfaction, b.weights.satisfaction);
  const sample = [row({
    id: 's',
    features: { impressions: 40, avgWatchSec: 100, durationSec: 200, completionRate: 0.4, meaningfulWatches: 10 },
  })];
  const left = Engine.run(sample, quiet, a, now);
  const right = Engine.run(sample, quiet, b, now);
  assert.notStrictEqual(left.model, right.model);
  assert.ok(left.feed[0].score !== right.feed[0].score);
}

/* Events become features. Follower count is never one of them. */
{
  const rolled = Engine.rollup([
    { broadcastId: 'b1', type: 'broadcast_impression', topic: 'topic:coffee' },
    { broadcastId: 'b1', type: 'broadcast_impression' },
    { broadcastId: 'b1', type: 'watch_completed', watchSec: 400, durationSec: 600 },
    { broadcastId: 'b1', type: 'share' },
    { broadcastId: 'b1', type: 'not_interested' },
    { broadcastId: 'b1', type: 'question' },
  ]);
  const f = rolled.features.b1;
  assert.strictEqual(f.impressions, 2);
  assert.strictEqual(f.completions, 1);
  assert.strictEqual(f.shares, 1);
  assert.strictEqual(f.questions, 1);
  assert.strictEqual(f.negativeEvents, 1);
  assert.strictEqual(f.avgWatchSec, 400);
  assert.ok(f.pockets['topic:coffee'] > 0);
  assert.ok(!('followers' in f));
}

/* A desk config can move the discovery share without a new app. */
{
  const m = Engine.withConfig(Engine.modelV1(), { discoveryShare: 0.4, maxTopicStreak: 3 });
  assert.strictEqual(m.assembly.discoveryShare, 0.4);
  assert.strictEqual(m.assembly.maxTopicStreak, 3);
  assert.strictEqual(m.id, 'ranker_v1');
}

const fs = require('fs');
const path = require('path');
const app = fs.readFileSync(path.join(__dirname, '../app/index.html'), 'utf8');
const admin = fs.readFileSync(path.join(__dirname, '../admin/index.html'), 'utf8');
const rules = fs.readFileSync(path.join(__dirname, '../firestore.rules'), 'utf8');
const ui = fs.readFileSync(path.join(__dirname, 'signal-ui.js'), 'utf8');
assert.ok(app.includes('id="bspaceWhyBtn"'), 'why this lives in the Broadcast menu');
assert.ok(app.includes('/js/discover.js'), 'the phone loads discovery');
assert.ok(admin.includes('data-tab="discovery"'), 'the desk has a Discovery section');
assert.ok(rules.includes('match /recommendationEvents/'), 'events can be stored');
assert.ok(rules.includes('match /broadcastFeatures/'), 'compiled features can be stored');
assert.ok(ui.includes('NalunoDiscover.order'), 'For You uses the ranked order');
assert.ok(!fs.readFileSync(path.join(__dirname, 'discover-engine.js'), 'utf8').includes('followers'), 'the ranker does not read follower count');

console.log('discover-engine tests passed');
