/* 12b — ranker_v3 offline evaluation and regression test.
   Run: node js/discover-v3.test.cjs
   The catalogue here is simulated (seeded, so the numbers are repeatable):
   each Broadcast has a hidden true appeal, gets a random number of views, and
   its likes/finishes are drawn from that appeal. A ranker is better when its
   order follows the hidden appeal (NDCG@10). Nothing here is production data. */
const assert = require('assert');
const path = require('path');
const Engine = require(path.join(__dirname, 'discover-engine.js'));

let seed = 12345;
function rnd() { seed = (seed * 1103515245 + 12345) >>> 0; return seed / 4294967296; }
function binom(n, p) { let k = 0; for (let i = 0; i < n; i++) if (rnd() < p) k++; return k; }

const NOW = Date.UTC(2026, 9, 12, 12);
function catalogue(n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const appeal = rnd() * 0.6;
    const imp = rnd() < 0.4 ? 1 + Math.floor(rnd() * 6) : 20 + Math.floor(rnd() * 400);
    const watches = binom(imp, appeal);
    const likes = binom(watches, 0.5);
    const dislikes = binom(imp - watches, 0.08);
    out.push({
      id: 'b' + i, creatorUid: 'c' + (i % 17), visibility: 'public', listed: true, held: false, hidden: false,
      createdAt: NOW - Math.floor(rnd() * 72) * 3600000, topics: ['t' + (i % 5)],
      features: { impressions: imp, meaningfulWatches: watches, likes: likes, dislikes: dislikes, completions: binom(watches, 0.6) },
      __appeal: appeal,
    });
  }
  return out;
}
function ndcg(order, k) {
  const gains = order.map((b) => b.__appeal);
  const ideal = gains.slice().sort((a, b) => b - a);
  const dcg = (g) => g.slice(0, k).reduce((s, x, i) => s + x / Math.log2(i + 2), 0);
  return dcg(gains) / dcg(ideal);
}
function rankedBy(model, list) {
  const v = Engine.blankViewer();
  return Engine.run(list, v, model, NOW).feed.map((r) => r.broadcast);
}
function rawOrder(model, list) { // score order without the diversity assembly
  const m = Engine.withConfig(model, null);
  if (m.smoothing) m.priorRate = Engine.catalogueRate(list);
  const v = Engine.blankViewer();
  return list.map((b) => ({ b, s: Engine.scoreOne(b, v, m, NOW).score })).sort((a, c) => c.s - a.s).map((x) => x.b);
}

// 1. Evaluation over 200 simulated catalogues.
const res = { ranker_v1: [], ranker_v2: [], ranker_v3: [] };
const feedRes = { ranker_v2: [], ranker_v3: [] };
for (let t = 0; t < 200; t++) {
  const list = catalogue(60);
  for (const id of Object.keys(res)) res[id].push(ndcg(rawOrder(Engine.models()[id], list), 10));
  for (const id of Object.keys(feedRes)) feedRes[id].push(ndcg(rankedBy(Engine.models()[id], list), 10));
}
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const summary = {};
for (const id of Object.keys(res)) summary[id] = +mean(res[id]).toFixed(4);
const feedSummary = {};
for (const id of Object.keys(feedRes)) feedSummary[id] = +mean(feedRes[id]).toFixed(4);
console.log('NDCG@10 by score (200 simulated catalogues):', JSON.stringify(summary));
console.log('NDCG@10 of the assembled feed:', JSON.stringify(feedSummary));
assert(summary.ranker_v3 > summary.ranker_v2, 'v3 should follow true appeal better than v2');

// 2. One view and one like no longer beats hundreds of finishes.
const tiny = { id: 'tiny', creatorUid: 'a', createdAt: NOW - 3600000, features: { impressions: 1, meaningfulWatches: 1, likes: 1, completions: 1 } };
const proven = { id: 'proven', creatorUid: 'b', createdAt: NOW - 3600000, features: { impressions: 300, meaningfulWatches: 150, likes: 60, dislikes: 4, completions: 90 } };
const v = Engine.blankViewer();
const pair = [tiny, proven];
const s2 = (b) => Engine.scoreOne(b, v, Engine.withConfig(Engine.modelV2(), null), NOW).score;
const m3 = Engine.withConfig(Engine.modelV3(), null); m3.priorRate = Engine.catalogueRate(pair);
const s3 = (b) => Engine.scoreOne(b, v, m3, NOW).score;
console.log('one-like vs proven  v2:', s2(tiny).toFixed(3), s2(proven).toFixed(3), '  v3:', s3(tiny).toFixed(3), s3(proven).toFixed(3));
assert(s3(proven) > s3(tiny));

// 3. A scheduled Broadcast is fresh when it is published, not when drafted.
const sched = { id: 's', creatorUid: 'a', createdAt: NOW - 5 * 86400000, publishAt: NOW - 60000, features: {} };
const plain = { id: 'p', creatorUid: 'b', createdAt: NOW - 60000, features: {} };
const p3 = Engine.withConfig(Engine.modelV3(), null); p3.priorRate = 0;
assert.strictEqual(Engine.scoreOne(sched, v, p3, NOW).parts.freshness.toFixed(4), Engine.scoreOne(plain, v, p3, NOW).parts.freshness.toFixed(4));

// 4. ranker_v1 and ranker_v2 are unchanged: same scores as before 12b for a fixed catalogue.
seed = 777;
const fixed = catalogue(40);
const sums = {};
for (const id of ['ranker_v1', 'ranker_v2']) {
  const m = Engine.withConfig(Engine.models()[id], null);
  sums[id] = fixed.reduce((s, b) => s + Engine.scoreOne(b, v, m, NOW).score, 0);
}
const pinned = require('./discover-v3.pinned.json');
assert.ok(Math.abs(sums.ranker_v1 - pinned.ranker_v1) < 1e-9, 'ranker_v1 changed');
assert.ok(Math.abs(sums.ranker_v2 - pinned.ranker_v2) < 1e-9, 'ranker_v2 changed');

// 5. Visibility and diversity still hold under v3: private/held/hidden are dropped, no creator twice in a row.
const mixed = catalogue(30).concat([
  { id: 'priv', creatorUid: 'z', visibility: 'private', features: { impressions: 500, meaningfulWatches: 499 } },
  { id: 'held', creatorUid: 'z', held: true, features: { impressions: 500, meaningfulWatches: 499 } },
  { id: 'hid', creatorUid: 'z', hidden: true, features: { impressions: 500, meaningfulWatches: 499 } },
]);
const out = Engine.run(mixed, v, Engine.modelV3(), NOW);
const ids = out.feed.map((r) => r.id);
assert(!ids.includes('priv') && !ids.includes('held') && !ids.includes('hid'), 'ineligible leaked');
for (let i = 1; i < out.feed.length; i++) assert.notStrictEqual(out.feed[i].creatorUid && out.feed[i].creatorUid, out.feed[i - 1].creatorUid, 'same creator twice in a row at ' + i);
assert(out.feed.every((r) => isFinite(r.score)));

// 6. A broken timestamp cannot scramble the order.
const bad = Engine.run([{ id: 'x', creatorUid: 'q', createdAt: 'garbage', features: {} }, proven], v, Engine.modelV3(), NOW);
assert(bad.feed.every((r) => isFinite(r.score)));
console.log('discover-v3: all checks passed');
