const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'app/index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'css/app.css'), 'utf8');
const calls = fs.readFileSync(path.join(__dirname, 'calls.js'), 'utf8');
const wire = fs.readFileSync(path.join(__dirname, 'wireline.js'), 'utf8');

assert.ok(html.includes('id="chatBtn"'), 'chat button on the call');
assert.ok(html.includes('id="incallWire"'), 'mini wire lives on the call');
assert.ok(html.includes('id="incallWireInput"'), 'type on the call');
assert.ok(html.includes('id="incallWireMsgs"'), 'thread on the call');
const incallChunk = html.slice(html.indexOf('id="incall"'), html.indexOf('id="bviewer"'));
assert.ok(incallChunk.includes('id="incallWire"'), 'sheet is inside the live call, not a new screen');
assert.ok(incallChunk.includes('id="remoteVideo"'), 'them still on screen');
assert.ok(incallChunk.includes('id="localPip"'), 'you still on screen');
assert.ok(incallChunk.includes('id="endBtn"'), 'hangup stays');

assert.ok(css.includes('#incall.wire-open .incall-wire'), 'open sheet on the call');
assert.ok(css.includes('#incall.wire-open .local-pip'), 'self view moves, does not leave');
assert.ok(!/incall-wire[\s\S]{0,200}position:\s*fixed/.test(css), 'sheet is not a new full screen');

assert.ok(calls.includes('function openIncallWire'), 'opens on the call');
assert.ok(calls.includes('function closeIncallWire'), 'hides without hanging up');
assert.ok(calls.includes('function sendIncallWire'), 'send from the call');
assert.ok(calls.includes("chatBtn').onclick"), 'bubble is wired');
assert.ok(calls.includes('toggleIncallWire'), 'tap toggles the sheet');
assert.ok(!/chatBtn[\s\S]{0,400}openThread\(/.test(calls), 'must not leave the call for Wireline');
assert.ok(calls.includes("wirelineThread').classList.remove('active')"), 'full thread stays closed');
assert.ok(calls.includes('sendThreadMessage'), 'same Wireline send path');
assert.ok(calls.includes('notifyIncallWire'), 'incoming while still on the call');
assert.ok(calls.includes('visualViewport'), 'keyboard does not throw you off the call');

assert.ok(wire.includes('function wirelineIsViewing'), 'on-call sheet counts as viewing');
assert.ok(wire.includes("classList.contains('wire-open')"), 'viewing includes the call sheet');
assert.ok(wire.includes('renderIncallWire'), 'thread refresh paints the call sheet');

/* Stamps bumped to 23a: the sheet's markup and CSS were rebuilt after an
   older index.html was uploaded over them, so phones must refetch. */
/* These were pinned to one day's stamp (23a) and failed the moment anything
   was rebuilt — the app is on 23c now. What actually matters is that the page
   IS stamped and that the three cache-busted files carry a stamp too, so a
   phone refetches them. */
assert.ok(/naluno-build" content="\d{4}\.\d{2}\.\d{2}[a-z]?"/.test(html), 'app is stamped');
assert.ok(/calls\.js\?v=\d{8}[a-z]?/.test(html), 'calls cache-bust');
assert.ok(/wireline\.js\?v=\d{8}[a-z]?/.test(html), 'wireline cache-bust');
assert.ok(/app\.css\?v=\d{8}[a-z]?/.test(html), 'css cache-bust');

/* The bubble must never navigate away from the call. */
assert.ok(!/chatBtn[\s\S]{0,400}showTab\(/.test(calls), 'bubble does not switch tabs');
assert.ok(html.includes('id="incallWireForm"'), 'send form on the call');
assert.ok(html.includes('id="incallWireClose"'), 'close without hanging up');
assert.ok(wire.includes('function wirelineIsViewing'), 'read receipts work from the call sheet');

console.log('incall-wire tests passed');
