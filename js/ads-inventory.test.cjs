const fs = require('fs');
const path = require('path');
const assert = require('assert');

const adminSrc = fs.readFileSync(path.join(__dirname, 'admin-console.js'), 'utf8');
const dataSrc = fs.readFileSync(path.join(__dirname, 'admin-data.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '..', 'admin/index.html'), 'utf8');

assert.ok(adminSrc.includes("card('Journal'"), 'house journal stays');
assert.ok(adminSrc.includes("card('This ad'"), 'per-ad analytics panel');
assert.ok(adminSrc.includes('admAdEdit'), 'inventory edit');
assert.ok(adminSrc.includes('admAdView'), 'inventory analytics');
assert.ok(adminSrc.includes('Save and publish again'), 'edit republish');
assert.ok(adminSrc.includes('const editId = __tabCache.adsEditId'), 'save uses the same unit');
assert.ok(adminSrc.includes('Counters stay on this unit'), 'edit does not reset counters');
assert.ok(dataSrc.includes('function adUnitStats'), 'each ad has its own book');
assert.ok(html.includes('admin-console.js?v=20260922d'), 'ads pack cache-bust');
assert.ok(html.includes('admin-data.js?v=20260922d'), 'maths cache-bust');

console.log('ads-inventory tests passed');
