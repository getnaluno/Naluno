const fs = require('fs');
const assert = require('assert');
const path = require('path');
const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'app/index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'css/app.css'), 'utf8');

assert.ok(html.includes('id="nalunoEntryLogo"'), 'one shared opening logo');
assert.strictEqual((html.split('<body')[1] || '').split('naluno-entry-logo').length - 1, 1, 'body has a single opening logo');
assert.ok(!html.includes('<animate '), 'SMIL must not fight the CSS draw');
assert.ok(!html.includes('entryMarkIn'), 'no scale-pop on first paint');
assert.ok(html.includes('naluno-entry-stack'), 'logo stays while the form arrives');

const intro = css.slice(0, css.indexOf('bottom nav'));
assert.ok(!/animation:\s*entryMarkIn/.test(intro), 'app.css must not restart the intro');
assert.ok(!intro.includes('stroke-dashoffset:38'), 'app.css must not empty the drawn stroke');
assert.ok(intro.includes('naluno-entry-ready'), 'form arrives without swapping the mark');

console.log('entry-boot tests passed');
