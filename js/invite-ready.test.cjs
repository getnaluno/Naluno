/* Payments stay unpaid on the phone. Came-back uses a real day log. */
const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

const src = fs.readFileSync(__dirname + '/admin-data.js', 'utf8');
const ctx = { window: {}, globalThis: {}, Intl: Intl, Date: Date };
ctx.globalThis = ctx;
vm.runInNewContext(src, ctx);
const D = ctx.window.NalunoAdminData;
assert.ok(D && typeof D.cohortReturn === 'function');

const zone = 'UTC';
const day = 86400000;
const signup = Date.parse('2026-09-01T12:00:00Z');
const now = Date.parse('2026-09-10T12:00:00Z');
const users = [{ id: 'a', createdAt: signup }, { id: 'b', createdAt: signup }];
const days = [
  { uid: 'a', day: '2026-09-02' },
  { uid: 'a', day: '2026-09-08' },
  { uid: 'b', day: '2026-09-03' },
];
const came = D.cohortReturn(users, days, now, zone);
assert.strictEqual(came.d1.hit, 1);
assert.strictEqual(came.d1.of, 2);
assert.strictEqual(came.d7.hit, 1);
assert.strictEqual(came.d7.of, 2);

const snap = D.deriveSnapshot({
  now: now,
  zone: zone,
  users: users,
  presenceDays: days,
  pushPings: [{ status: 'handed' }, { status: 'failed' }],
  pushReceipts: [{ arrivedAt: 1, openedAt: 5 }, { arrivedAt: 2 }],
  payments: [{ status: 'paid' }, { status: 'open' }],
});
assert.strictEqual(snap.users.d1, 1);
assert.strictEqual(snap.proof.handed, 1);
assert.strictEqual(snap.proof.arrived, 2);
assert.strictEqual(snap.proof.opened, 1);
assert.strictEqual(snap.proof.paid, 1);

const ui = fs.readFileSync(__dirname + '/economy-ui.js', 'utf8');
const ads = fs.readFileSync(__dirname + '/ads.js', 'utf8');
assert.ok(!/paymentStatus:\s*'paid'/.test(ui + ads), 'the phone must not mark a payment paid');
assert.ok(ui.indexOf('/v1/pay/checkout') > 0, 'support opens checkout');
assert.ok(ads.indexOf('nalunoCheckout') > 0, 'an ad can open checkout');

const auth = fs.readFileSync(__dirname + '/auth.js', 'utf8');
assert.ok(auth.indexOf('/b/purge') > 0, 'closing a Callsign asks for the files to be removed');
assert.ok(auth.indexOf('currentUser.delete') > 0, 'closing a Callsign deletes the login');
assert.ok(auth.indexOf('cannot be restored') > 0);

console.log('invite-ready ok');
