/* 13 Oct b: console refresh in place, calls that connect while ringing,
   field call timings, Listen read-ahead. Static checks plus small
   behaviour tests of the pieces that can run outside a browser (the
   two-phone behaviour is tested with real browsers: early.cjs, cold2.cjs). */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
function fn(src, name) {
  const m = new RegExp('(^|\\n)(async )?function ' + name + '\\(').exec(src);
  assert.ok(m, name + ' exists');
  const i = m.index + m[1].length;
  let depth = 0;
  for (let k = src.indexOf('{', i); k < src.length; k++) {
    if (src[k] === '{') depth++;
    else if (src[k] === '}') { depth--; if (depth === 0) return src.slice(i, k + 1); }
  }
  throw new Error('could not read ' + name);
}
const calls = read('js/calls.js');

/* 1. Held senders: nothing is sent while ringing, whatever asks. */
(async () => {
  const sb = { stream: null, nalunoFrameDue: false, replayed: 0, console };
  sb.nalunoReplayPcState = () => { sb.replayed++; };
  sb.nalunoAnyHeld = () => false;
  sb.nalunoRemoteFrameArrived = () => {};
  sb.getCallOutboundVideoTrackSync = () => null;
  vm.createContext(sb);
  vm.runInContext([fn(calls, 'nalunoHeld'), fn(calls, 'nalunoHoldSenders'), fn(calls, 'nalunoReleaseSenders')].join('\n'), sb);
  function Sender(track) { this._t = track; this.sent = []; }
  Object.defineProperty(Sender.prototype, 'track', { get() { return this._t; }, configurable: true });
  Sender.prototype.replaceTrack = function (t) { this._t = t; this.sent.push(t ? t.id : null); return Promise.resolve(); };
  const mic = { id: 'mic', kind: 'audio', readyState: 'live' };
  const cam = { id: 'cam', kind: 'video', readyState: 'live' };
  const cam2 = { id: 'cam2', kind: 'video', readyState: 'live' };
  const a = new Sender(mic), v = new Sender(cam);
  const pc = { getSenders: () => [a, v] };
  await sb.nalunoHoldSenders(pc);
  assert.deepStrictEqual([a._t, v._t], [null, null], 'held: the real senders send nothing');
  assert.strictEqual(v.track, cam, 'held: code that looks at the sender still sees its track');
  await v.replaceTrack(cam2);                       // a lens flip while ringing
  assert.strictEqual(v._t, null, 'a flip while held sends nothing');
  assert.strictEqual(v.track, cam2, 'and is what will be sent after Answer');
  assert.ok(sb.nalunoHeld(pc));
  await sb.nalunoReleaseSenders(pc);
  assert.deepStrictEqual([a._t && a._t.id, v._t && v._t.id], ['mic', 'cam2'], 'Answer: the latest tracks go out');
  assert.ok(!sb.nalunoHeld(pc) && sb.replayed === 1, 'what happened while held is replayed once');
  assert.ok(!Object.prototype.hasOwnProperty.call(v, 'replaceTrack') && !Object.prototype.hasOwnProperty.call(v, 'track'), 'the browser\'s own sender is back');
  await sb.nalunoReleaseSenders(pc);
  assert.strictEqual(sb.replayed, 1, 'releasing twice does nothing');
  /* A track that ended while held is replaced by the live one. */
  const dead = { id: 'old', kind: 'audio', readyState: 'ended' };
  const fresh = { id: 'fresh', kind: 'audio', readyState: 'live' };
  sb.stream = { getAudioTracks: () => [fresh], getVideoTracks: () => [] };
  const a2 = new Sender(dead);
  const pc2 = { getSenders: () => [a2] };
  await sb.nalunoHoldSenders(pc2);
  await sb.nalunoReleaseSenders(pc2);
  assert.strictEqual(a2._t.id, 'fresh');

  /* 2. The early answer carries no local-network address. */
  const sb2 = {}; vm.createContext(sb2);
  vm.runInContext([fn(calls, 'nalunoBlankRelated'), fn(calls, 'nalunoEarlySdp'), fn(calls, 'nalunoEarlyCand')].join('\n'), sb2);
  const sdp = ['v=0', 'm=audio 9 UDP/TLS/RTP/SAVPF 111', 'c=IN IP4 192.168.1.20',
    'a=candidate:1 1 udp 2122260223 192.168.1.20 53000 typ host generation 0',
    'a=candidate:2 1 udp 1686052607 41.210.1.2 53000 typ srflx raddr 192.168.1.20 rport 53000',
    'a=candidate:3 1 udp 41885439 104.30.1.1 3478 typ relay raddr 41.210.1.2 rport 53000',
    'a=rtcp:9 IN IP4 192.168.1.20', 'a=ice-ufrag:abcd'].join('\r\n');
  const out = sb2.nalunoEarlySdp({ type: 'answer', sdp }).sdp;
  assert.ok(!/typ host/.test(out) && !/c=IN IP4 192\.168/.test(out) && !/IN IP4 192\.168/.test(out), 'no host address in the early answer');
  assert.ok(/typ srflx/.test(out) && /typ relay/.test(out) && /a=ice-ufrag:abcd/.test(out));
  assert.ok(!sb2.nalunoEarlyCand({ candidate: 'candidate:1 1 udp 1 192.168.1.20 5 typ host' }));
  assert.ok(sb2.nalunoEarlyCand({ candidate: 'candidate:3 1 udp 1 104.30.1.1 3478 typ relay raddr x rport 1' }));

  /* 3. Wiring: the caller says it can connect early; nothing counts as a
        call (timer, Connected, connected time) while held; Answer goes out
        with the answer when it is ready; no fixed 9 s cap; the caller
        applies the early answer as provisional and the final one replaces
        it (another phone of the same person can answer). */
  assert.ok(/earlyOk: true,/.test(calls));
  assert.ok(/function nalunoMarkCallLive\(\)\{\s*if\(nalunoCallLive\) return;\s*if\(nalunoAnyHeld\(\)\) return;/.test(calls), 'no Connected while held');
  assert.ok(/if\(nalunoHeld\(pc\)\) return;   \/\/ still ringing/.test(calls), 'a ring never fails the call');
  assert.ok(/type: 'pranswer', sdp: early\.sdp/.test(calls) && /type: 'answer', sdp: finalAnswer\.sdp/.test(calls));
  assert.ok(!/Date\.now\(\) \+ 9000/.test(calls), 'no 9 s cap on the prepared answer');
  assert.ok(/if\(answerWithAccept\) acceptExtra\.answer = prep\.answer;/.test(calls));
  assert.ok(/answerDev: freshAfterEarly \? NALUNO_DEV \+ '-new' : NALUNO_DEV/.test(calls) && /d\.answerDev === epcNow\._nalunoEarlyDev/.test(calls), 'the caller knows which answer is in use');
  assert.ok(/st === 'failed' \|\| ice === 'failed'/.test(fn(calls, 'nalunoPreparedFor')), 'a route lost while ringing is rebuilt on Answer');
  assert.ok(/await nalunoHoldSenders\(pc\);[\s\S]{0,1400}tx\.update\(ref, \{ earlyAnswer: early \}\)/.test(calls), 'held before the early answer is written (first phone wins)');
  assert.ok(/nalunoHoldSenders\(epc\)\.then\(function\(\)\{[\s\S]{0,200}setRemoteDescription/.test(calls), 'caller held before it connects');
  assert.ok(/function nalunoWatchEarlyMedia\(pc, callId\)/.test(calls) && /nalunoCallMark\(callId, 'mediaAccept'\)/.test(calls));
  /* Old phones: the callee only connects early when the caller asked for it. */
  assert.ok(/nalunoPrepareAnswer\(callId, data\.offer, camReady, data\.earlyOk === true, data\.callerRelay === true\)/.test(calls));

  /* 4. Field timings: kept on the call, times only, two writes at most. */
  const save = fn(calls, 'nalunoCallTimingSave');
  assert.ok(/upd\['timing\.' \+ role\] = out;/.test(save) && !/sdp|candidate|name/i.test(save.replace(/\/\*[\s\S]*?\*\//g, '')), 'only stage times are written');
  const desk = read('js/admin-console.js');
  const speed = fn(desk.replace(/^ {6}/gm, ''), 'paintCallSpeed');
  const sb3 = { el: { innerHTML: '' } };
  sb3.$ = () => sb3.el;
  sb3.kpis = (pairs) => pairs.map((p) => p[0] + '=' + p[1]).join('|');
  sb3.escapeHtml = (s) => String(s);
  vm.createContext(sb3);
  vm.runInContext(speed, sb3);
  sb3.paintCallSpeed([
    { kind: 'audio', timing: { caller: { dial: 100, alert: 700 }, callee: { opened: 0, ring: 4000, earlyAnswer: 6000, answerTap: 9000, connected: 9300, heard: 9800 } } },
    { kind: 'video', timing: { callee: { ring: 100, answerTap: 900, connected: 3900, heard: 4400 } } },
    { kind: 'audio' },
  ]);
  assert.ok(/Calls timed=2/.test(sb3.el.innerHTML) && /Answer to connected=1\.6 s/.test(sb3.el.innerHTML) && /Connected before Answer=50%/.test(sb3.el.innerHTML), sb3.el.innerHTML.slice(0, 300));

  /* 5. Console: background refresh redraws in place (no blank page). */
  assert.ok(/function renderTabInPlace\(tab, snap\)/.test(desk) && /renderTabInPlace\(__activeTab, snap\);/.test(desk));
  const launch = read('js/admin-launch.js');
  assert.ok(/function repaintQuietly\(\)/.test(launch) && /function startQuietRefresh\(\)/.test(launch));

  /* 6. Listen: read ahead while open, used as is; Luganda left alone. */
  const voices = read('js/naluno-voices.js');
  assert.ok(/function prepare\(text, opts\)/.test(voices) && /if \(hit\) return hit\.then/.test(voices));
  assert.ok(/if \(!pl \|\| typeof pl\.native === 'function'\) return '';/.test(voices), 'a fetched (Luganda) voice is never cached');
  const space = read('js/broadcast-space.js');
  const ahead = fn(space, 'bspaceReadAhead');
  assert.ok(/looksLuganda/.test(ahead) && /activeBroadcastMeta\.lang === 'lg'/.test(ahead) && /hear && hear\.value/.test(ahead), 'no read-ahead for Luganda or another language');
  assert.ok(/NalunoVoices\.warm\(false\)/.test(ahead), 'only when the voice is already on the phone');
  const V = require(path.join(root, 'js/naluno-voices.js'));
  assert.strictEqual(typeof V.prepare, 'function');
  assert.strictEqual(V.PACE.Bella, 1.42); assert.strictEqual(V.PACE.Hugo, 0.89);
  assert.deepStrictEqual(V.AF_PACE, { female: 0.65, male: 0.73 }, 'Luganda pace unchanged');

  console.log('fixes-1013b: all checks passed');
})().catch((e) => { console.error(e); process.exit(1); });
