/* Built on the live 20261010d tree. Calls play one voice, the offer carries
   a real network path when one arrives quickly, and a new worker raises
   the update banner. The app and the console stay on that same worker. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const calls = read('js/calls.js');
const core = read('js/core.js');
const sw = read('sw.js');
const build = (sw.match(/^const APP_BUILD = '(\d{8}[a-z])'/m) || [])[1];
const dotted = build.replace(/^(\d{4})(\d{2})(\d{2})([a-z])$/, '$1.$2.$3$4');
assert.strictEqual(build, '20261010f');
assert.ok(sw.includes("CACHE_NAME = 'naluno-shell-v307'"));
assert.strictEqual((read('js/pwa.js').match(/register\('\/sw\.js\?v=([^']+)'/) || [])[1], build);
assert.strictEqual((read('pwa.js').match(/register\('\/sw\.js\?v=([^']+)'/) || [])[1], build);
assert.strictEqual((read('js/admin-console.js').match(/const BUILD = '([^']+)'/) || [])[1], build);
assert.strictEqual((read('admin/index.html').match(/admin-console\.js\?v=([^"']+)/) || [])[1], build);
assert.strictEqual((read('app/index.html').match(/<meta name="app-version" content="([^"]+)">/) || [])[1], dotted);
assert.strictEqual((read('app/index.html').match(/<meta name="naluno-build" content="([^"]+)"/) || [])[1], dotted);
assert.ok(read('app/index.html').includes('/js/calls.js?v=' + build));
assert.ok(read('app/index.html').includes('/js/core.js?v=' + build));
assert.ok(!calls.includes('createMediaStreamSource') && !calls.includes('gain.gain.value'), 'the received voice is not copied');
assert.ok(calls.includes('function nalunoSdpReady'), 'the written offer waits briefly for a real path');
const ice = calls.slice(calls.indexOf('getIceServers().then(function(fresh)'), calls.indexOf('remoteCombinedStream = new MediaStream()'));
assert.ok(!ice.includes('restartIce'), 'TURN before the offer does not restart the connection');
assert.ok(calls.includes('function nalunoTryRelay') && calls.slice(calls.indexOf('function nalunoTryRelay'), calls.indexOf('function nalunoScheduleCallFail')).includes('restartIce'), 'a call that has already failed can still try the relay');
const ctx = { String: String };
vm.createContext(ctx);
vm.runInContext(core.slice(core.indexOf('function nalunoStampKey'), core.indexOf('function nalunoShowUpdateBanner')) + '\nthis.due = nalunoUpdateDue; this.key = nalunoStampKey;', ctx);
assert.strictEqual(ctx.key('2026.10.10f'), '20261010f');
assert.strictEqual(ctx.due({ app: '2026.10.10d', build: '2026.10.10d' }, { app: '2026.10.10f', build: '20261010f' }), true, 'a new worker raises the banner');
assert.strictEqual(ctx.due({ app: dotted, build: dotted }, { app: dotted, build: build }), false, 'this page is already that worker');
assert.strictEqual(ctx.due({ app: dotted, build: dotted }, { app: '', build: '' }), false, 'offline is not an update');
console.log('fixes-1010f tests passed');
