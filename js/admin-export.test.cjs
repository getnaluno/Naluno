const assert = require('assert');
const Exp = require('./admin-export.js');

const roles = [['overview', 'Overview'], ['ads', 'Ads'], ['export', 'Export'], ['luganda', 'Luganda']];
const list = Exp.sections(roles);
assert.strictEqual(list.length, 3);
assert.ok(list.every(function (p) { return p[0] !== 'export'; }));

const from = Date.parse('2026-10-01T00:00:00Z');
const to = Date.parse('2026-10-02T23:59:59Z');
const lines = Exp.linesFor('ads', {
  ads: { list: [
    { name: 'Keep', createdAt: Date.parse('2026-10-01T12:00:00Z'), status: 'live' },
    { name: 'Drop', createdAt: Date.parse('2026-01-01T12:00:00Z'), status: 'old' },
  ] },
}, from, to);
assert.ok(lines.some(function (l) { return l.indexOf('Keep') >= 0; }));
assert.ok(!lines.some(function (l) { return l.indexOf('Drop') >= 0; }));
assert.ok(lines[0].indexOf('Naluno') >= 0);

const file = Exp.pdf('Ads', lines);
assert.ok(file.indexOf('%PDF-1.4') === 0);
assert.ok(file.indexOf('NALUNO') > 0);
assert.ok(file.indexOf('%%EOF') > 0);

console.log('admin export ok');
