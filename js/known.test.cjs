const assert = require('assert');
const K = require('./known.js');

const app = K.freshApply('u1', 'Aster', 'I publish under this name in Kampala', 1000);
assert.strictEqual(app.status, 'applied');
assert.strictEqual(K.freshApply('u1', 'Aster', 'too short', 1000), null);
assert.strictEqual(K.recordPayment(app, 2000, 'desk'), null);

const accepted = K.review(app, 'accept', 1500);
assert.strictEqual(accepted.status, 'accepted');
assert.strictEqual(K.isKnown(accepted, 1600), false);

const paid = K.recordPayment(accepted, 2000, 'cs_1');
assert.strictEqual(paid.status, 'known');
assert.strictEqual(paid.paidUntil, 2000 + K.MONTH_MS);
assert.strictEqual(K.isKnown(paid, 2000 + 1000), true);
assert.strictEqual(K.isKnown(paid, paid.paidUntil + 1), false);
assert.strictEqual(K.isKnown({ known: true }, 3000), false);
assert.strictEqual(K.isKnown({ known: true, knownUntil: 9000 }, 3000), true);

const revoked = K.review(paid, 'revoke', 4000);
assert.strictEqual(revoked.status, 'revoked');
assert.strictEqual(K.recordPayment(revoked, 5000, 'x'), null);

console.log('known tests passed');
