/* 14 Oct e: new videos missing from the public Broadcast feed. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

/* The detector's findings reach the server even without pixel stills. */
{
  const ctx = { window: {} };
  vm.createContext(ctx);
  vm.runInContext(read('js/screen.js'), ctx);
  const pack = ctx.window.nalunoScreenPack;
  assert.ok(pack({ packed: { w: 0, h: 0, frames: [], nudenet: { v: 1, frames: [{ d: [], p: 0 }] } } }), 'detector findings alone are sent');
  assert.ok(pack({ packed: { w: 96, h: 96, frames: [{ rgb: 'x' }] } }), 'pixel stills are sent');
  assert.strictEqual(pack({ packed: { w: 0, h: 0, frames: [] } }), null, 'an empty report sends nothing');
  assert.strictEqual(pack(null), null);
}
const nn = read('js/nudenet.js');
assert.ok(/var DETECTOR_MS = (\d+);/.test(nn) && Number(nn.match(/var DETECTOR_MS = (\d+);/)[1]) >= 45000, 'the detector has the time a phone needs');
assert.ok(Number(nn.match(/var DETECTOR_MS = (\d+);/)[1]) < 60000, '... inside the 60 s Publish waits');
assert.ok(/var both = await Promise\.all\(\[baseP, mP\]\);/.test(nn), 'the detector runs alongside the heuristic, not after it');
const comp = read('js/broadcast-composer.js');
const open = comp.slice(comp.indexOf('function bcompOpen(){'), comp.indexOf('function bcompOpen(){') + 800);
assert.ok(/nalunoModPreload\(\)/.test(open), 'the composer warms the detector when it opens');
assert.ok(/finalScreen\.engine !== 'nudenet'/.test(comp) && /screen: finalScreen,/.test(comp), 'a heuristic verdict is read again by the detector before saving');
assert.ok(/!\(finalScreen && finalScreen\.decision === 'block'\)/.test(comp), '... and a block is never re-read into an allow');
const rules = read('firestore.rules');
assert.ok(/!request\.resource\.data\.keys\(\)\.hasAny\(\['screenDecision', 'screenScore', 'screenReason', 'screenVersion', 'screenFrames'\]\)/.test(rules), 'a phone cannot write a Screen verdict when it creates a Broadcast');
assert.ok(/row\.screenDecision === "allow" \|\| row\.screenDecision === "hold"/.test(read('workers/economy/handler.mjs')), 'the worker reuses only its own allow or hold');
console.log('fixes-1014e: all checks passed');
