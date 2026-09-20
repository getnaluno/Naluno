const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

const src = fs.readFileSync(__dirname + '/handle-guard.js', 'utf8');
const ctx = { window: {}, globalThis: {} };
ctx.globalThis = ctx;
vm.runInNewContext(src, ctx);
const G = ctx.window.NalunoHandleGuard || ctx.NalunoHandleGuard;
assert.ok(G, 'NalunoHandleGuard missing');

assert.strictEqual(G.normHandle('Naluno'), 'naluno');
assert.strictEqual(G.normHandle('@NALUNO'), 'naluno');
assert.strictEqual(G.normHandle(' na.luno '), 'naluno');
assert.strictEqual(G.handleCore('naluno_support'), 'nalunosupport');
assert.ok(G.handleFormatOk('naluno'));
assert.ok(!G.handleFormatOk('ab'));
assert.ok(!G.handleFormatOk('has space after strip?'.slice(0, 0)));

const reserved = G.SEED_RESERVED;
assert.ok(G.matchReserved('NALUNO', reserved));
assert.ok(G.matchReserved('n_aluno', reserved), 'underscore is the same identity');
assert.ok(G.matchReserved('naluno_support', reserved));
assert.ok(!G.matchReserved('nalun0', reserved), 'homoglyph is not an automatic block');
assert.ok(!G.matchReserved('nalunoofficial1', reserved));

const d1 = G.decideHandle('Naluno', { reserved: reserved });
assert.strictEqual(d1.ok, false);
assert.strictEqual(d1.code, 'reserved');
assert.ok(/reserved and cannot be claimed/i.test(d1.error));
assert.ok(!/official/i.test(d1.error) || /cannot be claimed/.test(d1.error));

const keep = G.decideHandle('naluno', { reserved: reserved, uid: 'owner1' });
assert.strictEqual(keep.ok, false);
const keep2 = G.decideHandle('naluno', {
  reserved: [{ handle: 'naluno', category: 'official', holderUid: 'owner1' }],
  uid: 'owner1',
});
assert.strictEqual(keep2.ok, true);
assert.strictEqual(keep2.official, true);

const sim0 = G.similarityAgainst('nalun0', reserved);
assert.ok(sim0);
assert.strictEqual(sim0.reserved, 'naluno');
assert.ok(/lookalike|character|contains/i.test(sim0.reason));

const sim1 = G.similarityAgainst('nalunoofficial1', reserved);
assert.ok(sim1);
assert.ok(sim1.reserved === 'nalunoofficial' || sim1.reserved === 'naluno');

const sim2 = G.similarityAgainst('getnalun0', reserved);
assert.ok(sim2);

const sim3 = G.similarityAgainst('naluno_support', reserved);
assert.ok(!sim3, 'exact reserved after core collapse is a block, not a similarity flag');

const ok = G.decideHandle('amina', { reserved: reserved });
assert.strictEqual(ok.ok, true);
assert.ok(!ok.similar);

console.log('handle-guard tests passed');
