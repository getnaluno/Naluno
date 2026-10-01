const assert = require('assert');
const Exp = require('./admin-export.js');

const roles = [['overview', 'Overview'], ['ads', 'Ads'], ['export', 'Export']];
assert.strictEqual(Exp.sections(roles).length, 2);

const from = Date.parse('2026-10-01T00:00:00Z');
const to = Date.parse('2026-10-02T23:59:59Z');
const tables = Exp.tablesFor('ads', {
  ads: { list: [
    { name: 'Keep', status: 'live', impressions: 3, clicks: 1, createdAt: Date.parse('2026-10-01T12:00:00Z'), fcmToken: 'secret', crv: 'P-256' },
    { name: 'Drop', status: 'old', createdAt: Date.parse('2026-01-01T12:00:00Z') },
  ] },
}, from, to);
assert.strictEqual(tables[0].headers.join('|'), 'Name|Status|Impressions|Clicks');
assert.strictEqual(tables[0].rows.length, 1);
assert.strictEqual(tables[0].rows[0][0], 'Keep');
const file = Exp.pdf('Ads', tables, '2026-10-01 to 2026-10-02');
assert.ok(file.indexOf('%PDF-1.4') === 0);
assert.ok(file.indexOf('NALUNO') > 0);
assert.ok(file.indexOf('Keep') > 0);
assert.ok(file.indexOf('Drop') < 0);
assert.ok(file.indexOf('secret') < 0);
assert.ok(file.indexOf('P-256') < 0);
console.log('admin export ok');
