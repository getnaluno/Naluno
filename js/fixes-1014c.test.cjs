/* 14 Oct c: calls that never connected after 14b's speed-up.
   14b cut every relay (TURN) wait to 0-0.9 s. A connection cannot gain a
   relay once its offer or answer is written (no renegotiation is sent), so
   when the caller AND the answering phone both missed their relay, the call
   could never connect on a mobile network. Browser runs under a simulated
   carrier network (only relay routes reach the other phone) failed 6 of 10
   closed-app answers on 14b and 0 of 10 here; see UPLOAD-20261014c.md. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.join(__dirname, '..');
const calls = fs.readFileSync(path.join(root, 'js/calls.js'), 'utf8');
const pwa = fs.readFileSync(path.join(root, 'js/pwa.js'), 'utf8');

/* Who waits for the relay */
assert.ok(/const NALUNO_CALLER_TURN_MS = 2500;/.test(calls), 'the caller waits for its relay fetch, up to 2.5 s');
assert.ok(calls.includes('const turnReady = nalunoWaitForTurn(NALUNO_CALLER_TURN_MS);'), 'the offer uses that wait');
{
  const a = calls.indexOf('const NALUNO_CALLER_TURN_MS');
  const b = calls.indexOf('window.nalunoAnswerTurnCap');
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(calls.slice(a, b) + '\nthis.cap = nalunoAnswerTurnCap;', ctx);
  assert.strictEqual(ctx.cap(true), 0, 'the caller has a relay: Answer does not wait for this phone\'s own (14b\'s speed kept)');
  assert.strictEqual(ctx.cap(false), 7000, 'the caller has none: Answer waits for this phone\'s own fetch (7 s only cuts off a hang)');
}
const prepAt = calls.indexOf('async function nalunoPrepareAnswer(');
const prep = calls.slice(prepAt, calls.indexOf('function nalunoPreparedFor', prepAt));
assert.ok(/nalunoWaitForTurn\(NALUNO_ANSWER_TURN_MS\),\s*callerRelay \? new Promise\(function\(r\)\{ prep\.wake = r; \}\) : new Promise\(function\(\)\{\}\)/.test(prep), 'while ringing, this phone fetches its own relay; only a caller relay lets Answer cut it short');
const tap = calls.slice(calls.indexOf("$('acceptIncoming').onclick"), calls.indexOf('(function nalunoWireAnswer'));
assert.ok(/nalunoPrepared\.wake\(\)/.test(tap), 'Answer cuts the ring-time relay wait short');
assert.ok(tap.indexOf('nalunoPrepared.wake()') < tap.indexOf('const deadline'), '... before it waits for the build');
assert.ok(/nalunoWaitForTurn\(nalunoAnswerTurnCap\(/.test(tap), 'a fresh answer follows the same rule');
assert.ok(!/nalunoWaitForTurn\(\(?[^)]*\? 0 : 900\)/.test(calls) && !calls.includes('nalunoWaitForTurn(900)'), 'no 0.9 s relay clock anywhere');

/* Answer does not throw away a nearly finished build */
assert.ok(calls.includes('const deadline = Date.now() + NALUNO_ANSWER_TURN_MS + 1500;') && !calls.includes('const deadline = Date.now() + 400;'), 'Answer waits for the build that is under way');

/* The closed-app answer is never dropped by an early read */
assert.ok(/if\(!snap \|\| !snap\.exists\)\{\s*try\{ snap = await fbDb\.collection\('calls'\)\.doc\(callId\)\.get\(\); \}catch\(_\)\{ snap = null; \}\s*\}/.test(pwa), 'a refused or empty early read is read again after sign-in');

/* 14b's real speed-ups stay */
assert.ok(calls.includes('nalunoSdpReady(pc, 180)') && calls.includes('nalunoSdpReady(answerPc, 180)'), '14b: shorter SDP wait kept');
assert.ok(/setTimeout\(tick, 16\);/.test(pwa) && /fbAuth\.onAuthStateChanged\(function\(u\)\{ if\(u\) askNative\(\); \}\)/.test(pwa), '14b: faster sign-in pickup kept');
console.log('fixes-1014c: all checks passed');
