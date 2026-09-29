/* 20260929c: answer-to-media must not wait on the live-broadcast ICE helper,
   and a late TURN refresh must not restart ICE after the SDP is already built. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const calls = fs.readFileSync(path.join(__dirname, 'calls.js'), 'utf8');
const camera = fs.readFileSync(path.join(__dirname, 'camera.js'), 'utf8');

const prepAt = calls.indexOf('async function nalunoPrepareAnswer');
const prepBody = calls.slice(prepAt, calls.indexOf('function nalunoPreparedFor'));
assert.ok(prepAt > 0 && prepBody.length > 50, 'prepare function found');
assert.ok(!prepBody.includes('getIceServersPatient'), 'preparing an answer does not use the 3.7s live-ICE wait');
assert.ok(prepBody.includes('nalunoWaitForTurn(800)'), 'TURN and the camera run together while the phone is still ringing');
assert.ok(calls.includes('if(pc._nalunoIceFrozen || pc.localDescription) return;'), 'TURN that arrives after the SDP is built does not restart ICE');
assert.ok(calls.includes('const hadTurn = nalunoCfgHasTurn(ice);'), 'an array of stun+turn urls still counts as TURN');
const iceStart = calls.indexOf('getIceServers().then(function(fresh)');
const iceUpgrade = calls.slice(iceStart, calls.indexOf('remoteCombinedStream = new MediaStream()', iceStart));
assert.ok(iceUpgrade.length > 40 && !iceUpgrade.includes('pc.restartIce'), 'the TURN-arrival path does not restart ICE');
assert.ok((calls.match(/_nalunoIceFrozen = true/g) || []).length >= 3, 'offer and both answer paths freeze ICE before SDP');
assert.ok(calls.includes('if(!still()){ nalunoDropPrepared(); return; }'), 'a prepare that gives up does not make Answer wait on it');
assert.ok(calls.includes('const deadline = Date.now() + 1000;'), 'Answer waits for an in-flight prepare instead of throwing it away');
assert.ok(calls.includes('await nalunoWaitForTurn(600);'), 'the offer waits briefly for TURN before the other phone rings');
assert.ok(!/setTimeout\(climb,/.test(camera), 'the 4K climb does not run during a call at all (29d)');
assert.ok(!camera.includes('setTimeout(climb, 400);'), 'the old 400ms climb is gone');

const a = calls.indexOf('function nalunoCfgHasTurn');
const b = calls.indexOf('window.nalunoCfgHasTurn = nalunoCfgHasTurn;');
assert.ok(a > 0 && b > a, 'turn wait helper found');

function runWait(iceNow, cap) {
  let now = 0;
  const q = [];
  const ctx = {
    Date: { now: function () { return now; } },
    setTimeout: function (fn) { q.push(fn); return fn; },
    IceCore: { now: iceNow },
    prewarmIceServers: function () {},
    console: console,
  };
  vm.createContext(ctx);
  vm.runInContext(calls.slice(a, b) + '\nthis.wait = nalunoWaitForTurn; this.has = nalunoCfgHasTurn;', ctx);
  let out = 'pending';
  ctx.wait(cap).then(function (v) { out = v; });
  let steps = 0;
  function flush() {
    return new Promise(function (r) { setImmediate(r); });
  }
  return (async function () {
    await flush();
    while (out === 'pending' && steps < 500) {
      steps++;
      if (!q.length) break;
      const fn = q.shift();
      now += 40;
      fn();
      await flush();
    }
    return { out: out, now: now, steps: steps };
  })();
}

(async function () {
  {
    const turn = { iceServers: [{ urls: 'turn:example:3478' }] };
    const r = await runWait(function () { return turn; }, 600);
    assert.strictEqual(r.out, turn, 'warm TURN returns on the first look');
    assert.ok(r.now <= 40, 'warm TURN does not wait out the cap, waited ' + r.now);
  }
  {
    const mixed = { iceServers: [{ urls: ['stun:stun.l.google.com:19302', 'turn:example:3478'] }] };
    const r = await runWait(function () { return mixed; }, 600);
    assert.strictEqual(r.out, mixed, 'stun listed before turn in one urls array still counts as TURN');
    assert.ok(r.now <= 40, 'that array must not look like STUN-only, waited ' + r.now);
  }
  {
    let n = 0;
    const turn = { iceServers: [{ urls: ['turn:example:3478'] }] };
    const r = await runWait(function () {
      n++;
      return n < 4 ? { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] } : turn;
    }, 600);
    assert.strictEqual(r.out, turn, 'TURN that lands during the wait is used');
    assert.ok(r.now < 600, 'it does not sit until the cap once TURN is cached');
    assert.ok(r.now < 3700, 'it never takes the old 3.7s patient path');
  }
  {
    const stun = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
    const r = await runWait(function () { return stun; }, 200);
    assert.strictEqual(r.out, stun, 'no TURN: give up at the cap with what we have');
    assert.ok(r.now >= 200 && r.now < 280, 'the cap is the cap, waited ' + r.now);
  }
  {
    const r = await runWait(function () { return null; }, 0);
    assert.ok(r.now <= 40, 'a zero cap does not spin');
  }
  console.log('call-connect 29c tests passed');
})().catch(function (e) {
  console.error(e);
  process.exit(1);
});
