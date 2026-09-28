/* Prices come from the operator's book only, in the running currency. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const store = {};
global.localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } };
global.window = global;
require('./currency.js');
const C = global.NalunoCurrency;
C.applyRates({ USD: 1, AED: 3.6725, UGX: 3700, EUR: 0.9 }, { source: 'test', fetchedAt: Date.now() });

C.applyPrices(null);
assert.strictEqual(C.knownPrice(), null, 'no book, no price');
assert.strictEqual(C.knownIn('UGX'), null);
assert.deepStrictEqual(C.supportPresets(), [], 'no book, no buttons');

C.applyPrices({ knownMonthly: { amount: 49, currency: 'AED' }, supportPresets: { amounts: [5, 10, 25], currency: 'AED' } });
C.setCode('UGX');
const q = C.knownIn('UGX');
assert.strictEqual(q.currency, 'UGX');
assert.strictEqual(q.major, Math.round(49 / 3.6725 * 3700), 'same rounding as the worker');
assert.strictEqual(C.supportPresets().length, 3);
assert.strictEqual(C.supportPresets()[0].currency, 'UGX');
C.setCode('AED');
assert.strictEqual(C.knownIn('AED').major, 49);

const K = require('./known.js');
const accepted = K.review(K.freshApply('u1', 'Aster', 'I publish under this name in Kampala', 1), 'accept', 2);
const paid = K.recordPayment(accepted, 3, 'desk', { amount: 180000, currency: 'UGX' });
assert.strictEqual(paid.currency, 'UGX');
assert.strictEqual(paid.amount_major, 180000);
assert.strictEqual(paid.amount_minor, 180000, 'UGX has no minor digits');
const g = K.grantKnown(accepted, 3, 6, { amount: 49, currency: 'AED' });
assert.strictEqual(g.list_amount, 49);
assert.strictEqual(g.list_currency, 'AED');

/* No price written into the member app or known.js. */
const known = fs.readFileSync(path.join(__dirname, 'known.js'), 'utf8');
const eco = fs.readFileSync(path.join(__dirname, 'economy-ui.js'), 'utf8');
const cur = fs.readFileSync(path.join(__dirname, 'currency.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '../app/index.html'), 'utf8');
assert.ok(!/4900|MONTH_MINOR/.test(known));
assert.ok(!/minor:\s*\d{3,}/.test(eco), 'no preset amounts in the support sheet');
assert.ok(!/SUPPORT_AED_MAJOR/.test(cur));
assert.ok(!/data-minor="\d+"/.test(html), 'no amounts baked into the page');
const ads = fs.readFileSync(path.join(__dirname, 'ads.js'), 'utf8');
assert.ok(!/currency:\s*'AED'/.test(ads), 'ads pay in the running currency');
console.log('prices tests passed');
process.exit(0);
