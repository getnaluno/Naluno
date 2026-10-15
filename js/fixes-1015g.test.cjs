/* 15 Oct g: call reliability (relay decision before the offer, coordinated
   restarts, failed-call reports) and diagnostics told to Naluno, not users.
   Run: node js/fixes-1015g.test.cjs */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
function grab(src, name, prefix) {
  const i = src.indexOf((prefix || '') + 'function ' + name + '(');
  assert.ok(i >= 0, 'missing ' + name);
  let d = 0; const k = src.indexOf('{', i);
  for (let j = k; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}' && --d === 0) return src.slice(i, j + 1); }
}
const checks = [];
const check = (n, f) => checks.push([n, f]);
const calls = read('js/calls.js');

/* ---------- the relay decision ---------- */
check('relay decision: cached, fetched, failed and hung are told apart', async () => {
  const mk = (ice) => {
    const ctx = { setTimeout, clearTimeout, Promise, Date, IceCore: ice, console };
    vm.createContext(ctx);
    vm.runInContext(grab(calls, 'nalunoCfgHasTurn') + grab(calls, 'nalunoWaitForTurn') + grab(calls, 'nalunoIceDecide', 'async ') + ';this.d = nalunoIceDecide;', ctx);
    return ctx.d;
  };
  const TURN = { iceServers: [{ urls: ['stun:x', 'turn:192.0.2.2:3479'] }] };
  let r = await mk({ cached: () => TURN, awaitServers: () => Promise.resolve(null) })(7000);
  assert.strictEqual(r.decision, 'turn-ready');
  r = await mk({ cached: () => null, awaitServers: () => new Promise((ok) => setTimeout(() => ok(TURN), 120)) })(7000);
  assert.strictEqual(r.decision, 'turn-fetched'); assert.ok(r.ms >= 100 && r.cfg === TURN);
  r = await mk({ cached: () => null, awaitServers: () => Promise.resolve({ iceServers: [{ urls: 'stun:x' }] }) })(7000);
  assert.strictEqual(r.decision, 'no-turn-failed');
  r = await mk({ cached: () => null, awaitServers: () => new Promise(() => {}) })(150);
  assert.strictEqual(r.decision, 'no-turn-timeout');
  r = await mk({ cached: () => null, awaitServers: () => new Promise(() => {}) })(0);
  assert.strictEqual(r.decision, 'not-waited');
  assert.ok(/const NALUNO_CALLER_TURN_MS = 7000;/.test(calls), 'the caller waits for the fetch (7 s only cuts a hang)');
  assert.ok(/const turnReady = nalunoIceDecide\(NALUNO_CALLER_TURN_MS\);/.test(calls) && /createPeerConnection\(iceChoice && iceChoice\.cfg\)/.test(calls), 'the decided relay is what the offer is built with');
  assert.ok(/4500\) : null;/.test(read('js/ice-core.js')), 'the credential request has 4.5 s, not 2.5 s');
});

/* ---------- coordinated restart ---------- */
function fakePc(o) {
  const pc = Object.assign({ signalingState: 'stable', connectionState: 'failed', iceConnectionState: 'failed', remoteDescription: { sdp: 'a=ice-ufrag:OLD\r\n' }, added: [], conf: null,
    setConfiguration(c) { this.conf = c; }, getConfiguration() { return this.conf || {}; },
    async createOffer(opt) { this.offerOpt = opt; return { type: 'offer', sdp: 'v=0 restart' }; },
    async setLocalDescription(d) { this.localDescription = d; this.signalingState = d.type === 'offer' ? 'have-local-offer' : 'stable'; },
    async setRemoteDescription(d) { this.remoteDescription = { type: d.type, sdp: d.sdp }; this.signalingState = d.type === 'offer' ? 'have-remote-offer' : 'stable'; },
    async createAnswer() { return { type: 'answer', sdp: 'v=0 answer' }; },
    addIceCandidate(c) { this.added.push(c); return Promise.resolve(); } }, o || {});
  return pc;
}
function restartCtx(extra) {
  const writes = [];
  const ctx = Object.assign({ setTimeout, clearTimeout, Promise, Date, console, JSON, RTCSessionDescription: function (d) { return d; }, RTCIceCandidate: function (c) { return c; },
    activeCallId: 'call1', peerConnection: null, iAmCaller: true, writes,
    IceCore: { fresh: () => Promise.resolve({ iceServers: [{ urls: 'turn:192.0.2.2:3479' }] }), cached: () => null },
    nalunoCD: () => null, nalunoDiag: () => {}, nalunoHeld: () => false, nalunoCallMediaUp: (pc) => pc.connectionState === 'connected' }, extra || {});
  ctx.window = ctx;
  vm.createContext(ctx);
  const src = ['nalunoCfgHasTurn', 'nalunoRs', 'nalunoRemoteUfrags', 'nalunoAddRemoteCand', 'nalunoFlushCandWait', 'nalunoCalleeAskRestart', 'nalunoCallerOnRestartDoc'].map((n) => grab(calls, n)).join('\n')
    + grab(calls, 'nalunoFreshIce', 'async ') + grab(calls, 'nalunoSdpReady', 'async ') + grab(calls, 'nalunoCallerRestart', 'async ') + grab(calls, 'nalunoCalleeOnRestartDoc', 'async ')
    + 'function nalunoCallStillThis(pc){ return pc && pc.signalingState !== "closed"; }'
    + 'const NALUNO_MAX_ICE_RESTARTS = 2;'
    + 'this.api = { nalunoRs, nalunoAddRemoteCand, nalunoFlushCandWait, nalunoCallerRestart, nalunoCallerOnRestartDoc, nalunoCalleeOnRestartDoc, nalunoCalleeAskRestart };';
  vm.runInContext(src, ctx);
  return ctx;
}
check('restart: the caller makes a new offer with fresh relay credentials and sends it on the call', async () => {
  const ctx = restartCtx();
  const pc = fakePc();
  const ref = { update: async (o) => { ctx.writes.push(o); } };
  assert.strictEqual(await ctx.api.nalunoCallerRestart(pc, ref, 'failed'), true);
  assert.strictEqual(JSON.stringify(pc.offerOpt), JSON.stringify({ iceRestart: true }));
  assert.ok(/turn:/.test(JSON.stringify(pc.conf)), 'fresh relay applied before the offer');
  assert.strictEqual(ctx.writes[0].iceRestart.n, 1);
  assert.strictEqual(ctx.writes[0].iceRestart.offer.sdp, 'v=0 restart');
  assert.strictEqual(ctx.writes[0].iceRestart.relay, true);
  // its answer arrives: applied, waiting candidates added
  pc._nalunoCandWait = [{ candidate: 'x', usernameFragment: 'NEW' }];
  ctx.api.nalunoCallerOnRestartDoc(pc, ref, { iceRestartAnswer: { n: 1, answer: { type: 'answer', sdp: 'a=ice-ufrag:NEW\r\n' } } });
  await new Promise((r) => setTimeout(r, 20));
  assert.strictEqual(pc.signalingState, 'stable');
  assert.strictEqual(pc.added.length, 1, 'the new round\'s candidate was kept and added once its description was set');
  // at most two
  await ctx.api.nalunoCallerRestart(pc, ref, 'again');
  assert.strictEqual(await ctx.api.nalunoCallerRestart(fakePc({ _nalunoRs: { n: 2, waiting: 0, busy: false, handledAsk: 0, applied: 0, asked: 0 } }), ref, 'third'), false, 'never more than NALUNO_MAX_ICE_RESTARTS');
  // not while an offer is still out (no glare)
  assert.strictEqual(await ctx.api.nalunoCallerRestart(fakePc({ signalingState: 'have-local-offer' }), ref, 'x'), false);
});
check('restart: the answering phone answers it, and asks for one instead of making its own', async () => {
  const ctx = restartCtx({ iAmCaller: false });
  const pc = fakePc();
  const ref = { update: async (o) => { ctx.writes.push(o); } };
  await ctx.api.nalunoCalleeOnRestartDoc(pc, ref, { iceRestart: { n: 1, offer: { type: 'offer', sdp: 'a=ice-ufrag:NEW\r\n' }, why: 'failed' } });
  assert.strictEqual(ctx.writes[0].iceRestartAnswer.n, 1);
  assert.strictEqual(ctx.writes[0].iceRestartAnswer.answer.sdp, 'v=0 answer');
  await ctx.api.nalunoCalleeOnRestartDoc(pc, ref, { iceRestart: { n: 1, offer: { type: 'offer', sdp: 'x' } } });
  assert.strictEqual(ctx.writes.length, 1, 'the same restart is answered once');
  assert.strictEqual(ctx.api.nalunoCalleeAskRestart(pc, ref, 'failed'), true);
  assert.strictEqual(JSON.stringify(ctx.writes[1]), JSON.stringify({ iceRestartAsk: { n: 1, why: 'failed' } }));
  ctx.api.nalunoCalleeAskRestart(pc, ref, 'failed');
  assert.strictEqual(ctx.api.nalunoCalleeAskRestart(pc, ref, 'failed'), false, 'asks at most twice');
});
check('candidates: one for a round whose description is not set yet waits; old behaviour otherwise', () => {
  const ctx = restartCtx();
  const pc = fakePc({ remoteDescription: { sdp: 'a=ice-ufrag:AAA\r\n' } });
  ctx.api.nalunoAddRemoteCand(pc, { candidate: 'c1', usernameFragment: 'AAA' });
  ctx.api.nalunoAddRemoteCand(pc, { candidate: 'c2', usernameFragment: 'BBB' });
  ctx.api.nalunoAddRemoteCand(pc, { candidate: 'c3' });
  assert.deepStrictEqual(pc.added.map((c) => c.candidate), ['c1', 'c3']);
  pc.remoteDescription = { sdp: 'a=ice-ufrag:BBB\r\n' };
  ctx.api.nalunoFlushCandWait(pc);
  assert.deepStrictEqual(pc.added.map((c) => c.candidate), ['c1', 'c3', 'c2']);
  const fresh = fakePc({ remoteDescription: null });
  ctx.api.nalunoAddRemoteCand(fresh, { candidate: 'c4', usernameFragment: 'ZZZ' });
  assert.strictEqual(fresh.added.length, 1, 'no description yet: added as before');
});
check('a failing call: restarts, then ends on both phones with a plain reason', () => {
  const fail = grab(calls, 'nalunoScheduleCallFail');
  assert.ok(/pc\._nalunoRecoveries \|\| 0\) < NALUNO_MAX_ICE_RESTARTS/.test(fail) && /nalunoRecoverCall\(pc, why \|\| 'failed'\)/.test(fail) && /endActiveCall\('network'\)/.test(fail));
  assert.ok(/if\(s === 'disconnected'\)\{[\s\S]{0,400}nalunoScheduleCallFail\(pc, 'disconnected'\)/.test(calls), 'a route lost for 6 s is restarted');
  assert.ok(/toast\(reason === 'network' \? NALUNO_NET_FAIL_MSG : 'Call ended'\)/.test(calls), 'this phone says why');
  assert.ok((calls.match(/d\.endReason === 'network' \? NALUNO_NET_FAIL_MSG/g) || []).length >= 2, 'and the other phone too');
  assert.ok(!/Couldn.t connect\.[^']*(ICE|TURN|relay|SDP)/.test(calls.match(/const NALUNO_NET_FAIL_MSG = [^\n]*/)[0]), 'in plain words');
  assert.ok(/nalunoCallerOnRestartDoc\(peerConnection, callRef, d\)/.test(calls) && /nalunoCalleeOnRestartDoc\(peerConnection, callRef, d\)/.test(calls), 'both phones listen for restarts on the call');
  const rules = read('firestore.rules');
  assert.ok(/request\.resource\.data\.get\('status', ''\) == resource\.data\.get\('status', ''\)/.test(rules), 'restart fields need no rules change (status unchanged)');
});

/* ---------- failed-call reports ---------- */
check('a call report: stages, decision, route types, outcome; nothing private', () => {
  const sent = [];
  const ctx = { Date, JSON, Math, window: { NalunoTech: { call: (r) => sent.push(r) }, __nalunoCallTimes: { c1: { dial: 1000, record: 1700, alert: 1720, accepted: 5000 } } }, activeCallId: 'c1', document: { hidden: false } };
  ctx.NalunoTech = ctx.window.NalunoTech;
  vm.createContext(ctx);
  vm.runInContext('const nalunoCallDiag = {};' + calls.match(/const NALUNO_STAGE_ORDER = [^\n]*/)[0] + ['nalunoCDStart', 'nalunoCDBind', 'nalunoCD', 'nalunoCDSet', 'nalunoCDState', 'nalunoCDFinish'].map((n) => grab(calls, n)).join('\n') + ';this.api={nalunoCDStart,nalunoCDBind,nalunoCDSet,nalunoCDState,nalunoCDFinish,nalunoCD};', ctx);
  const A = ctx.api;
  const rec = A.nalunoCDBind(A.nalunoCDStart('caller', 'audio'), 'c1');
  rec.ice = { decision: 'no-turn-timeout', waitMs: 7000 };
  A.nalunoCDSet('c1', { recordCreated: true, offer: true, endReason: 'network' });
  A.nalunoCDState('i', 'checking'); A.nalunoCDState('i', 'failed');
  rec.path = { local: 'relay', remote: 'srflx', proto: 'udp', relayProto: 'udp' };
  const out = A.nalunoCDFinish('c1');
  assert.strictEqual(out.outcome, 'network'); assert.strictEqual(out.stageReached, 'accepted');
  assert.strictEqual(JSON.stringify(out.stages), JSON.stringify({ dial: 0, record: 700, alert: 720, accepted: 4000 }));
  assert.strictEqual(out.ice.decision, 'no-turn-timeout');
  assert.ok(out.states.length === 2 && /i:failed@/.test(out.states[1]));
  assert.strictEqual(sent.length, 1, 'handed to the reporter once');
  assert.strictEqual(A.nalunoCDFinish('c1'), null, 'and only once');
  assert.ok(!/a=candidate|ice-ufrag|\d+\.\d+\.\d+\.\d+|credential/.test(JSON.stringify(out)));
  assert.ok(/nalunoCDFinish\(activeCallId\);/.test(grab(calls, 'teardownCallConnection')), 'every way a call ends sends it');
  assert.ok(/rec\.endReason = \/denied\|NotAllowed\/i/.test(calls), 'a call that never started (mic denied) is reported too');
});

/* ---------- app problems told to Naluno, not the person ---------- */
check('the reporter: scrubbed, de-duplicated, batched, capped; documents fit the rule', async () => {
  const store = {};
  const added = [];
  const ls = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } };
  const ctx = { localStorage: ls, setTimeout: () => 0, clearTimeout: () => {}, setInterval: () => 0, Date, JSON, Math, String, Number, Array, Object, console,
    document: { hidden: false, querySelector: () => ({ content: '2026.10.15g' }), addEventListener() {} }, navigator: { userAgent: 'Mozilla/5.0 (Linux; Android 14) Chrome/130.0 Mobile' },
    firebase: { firestore: { FieldValue: { serverTimestamp: () => ({ st: 1 }) } } } };
  ctx.window = Object.assign(ctx, { addEventListener() {}, matchMedia: () => ({ matches: false }) });
  vm.createContext(ctx);
  vm.runInContext('let fbDb = null; let currentUser = null;' + read('js/diagnostics.js') + ';this.T = NalunoTech; this.setDb = function(d,u){ fbDb = d; currentUser = u; };', ctx);
  const T = ctx.T;
  const s = T.scrub('refused for amy@x.com at 10.0.0.12 call +256 772 123456 Bearer abc.def token=xyz https://naluno.workers.dev/v1/a?uid=9');
  assert.ok(!/amy@x|10\.0\.0\.12|772 123|abc\.def|xyz|uid=9/.test(s), s);
  assert.ok(/console\.firebase\.google\.com\/v1\/r\/project\/x\/firestore\/indexes\?create_composite=abc/.test(T.scrub('You can create it here: https://console.firebase.google.com/v1/r/project/x/firestore/indexes?create_composite=abc')), 'the index link is kept for the desk');
  for (let i = 0; i < 5; i++) T.add('feed-listener', 'failed-precondition The query requires an index');
  for (let i = 0; i < 30; i++) T.add('js-error', 'error number ' + i);
  T.call({ role: 'caller', outcome: 'network', stages: { dial: 0 } });
  let q = T._queue();
  assert.strictEqual(q.filter((e) => e.kind === 'feed-listener').length, 1); assert.strictEqual(q.filter((e) => e.kind === 'feed-listener')[0].n, 5, 'counted, not repeated');
  ctx.setDb({ collection: () => ({ add: async (d) => { added.push(d); } }) }, { uid: 'u1' });
  await T.flush();
  const KEYS = ['uid', 'type', 'build', 'platform', 'device', 'at', 'clientAt', 'entries', 'call'];
  assert.ok(added.length >= 3, 'app problems in batches of 25 plus the call: ' + added.length);
  added.forEach((d) => {
    assert.strictEqual(d.uid, 'u1');
    assert.ok(['app', 'call'].includes(d.type));
    assert.ok(Object.keys(d).every((k) => KEYS.includes(k)), 'only the fields the rule allows');
    if (d.type === 'app') assert.ok(d.entries.length <= 25);
  });
  assert.strictEqual(T._queue().length, 0, 'sent and cleared');
  // the per-day cap holds
  for (let i = 0; i < 2000; i++) T.add('k' + i, 'm' + i);
  await T.flush();
  assert.ok(added.length <= 40, 'at most 40 reports a day from one phone: ' + added.length);
});
check('words for the team never reach a person; ordinary messages do', () => {
  const core = read('js/core.js');
  const reported = [];
  const f = new Function('nalunoDiag', core.match(/const NALUNO_TECH_WORDS = .*;/)[0] + core.match(/const NALUNO_TECH_WORDS_CS = .*;/)[0] + grab(core, 'nalunoTellTeam') + grab(core, 'nalunoFriendlyError') + 'return nalunoFriendlyError;')((k, m) => reported.push(k + ':' + m));
  assert.strictEqual(f('FirebaseError: [code=failed-precondition]: The query requires an index.'), 'Something went wrong. Please try again.');
  assert.strictEqual(f("TypeError: Cannot read properties of undefined (reading 'uid')"), 'Something went wrong. Please try again.');
  assert.strictEqual(f('ICE failed, TURN unavailable'), 'Something went wrong. Please try again.');
  assert.strictEqual(f('Missing or insufficient permissions.'), '');
  assert.strictEqual(reported.length, 4, 'each one is told to Naluno');
  for (const ok of ['Turn on GPS and try again', 'Call ended', 'Allow location to turn Find Naluno on', 'That Signal is too large to post. Try a shorter clip or a smaller photo.', 'No connection right now — try again in a moment.']) {
    assert.ok(f(ok) === ok || /No connection/.test(f(ok)), ok);
  }
  /* every literal message the app shows passes untouched */
  const re1 = new Function('return ' + core.match(/const NALUNO_TECH_WORDS = (\/.*\/i);/)[1])();
  const re2 = new Function('return ' + core.match(/const NALUNO_TECH_WORDS_CS = (\/.*\/);/)[1])();
  const hits = [];
  for (const file of fs.readdirSync(path.join(root, 'js'))) {
    if (!file.endsWith('.js') || /test|admin/.test(file)) continue;
    const s = read('js/' + file); const rx = /toast\(\s*(['"`])((?:\\.|(?!\1).)*)\1/g; let m;
    while ((m = rx.exec(s))) if (re1.test(m[2]) || re2.test(m[2])) hits.push(file + ': ' + m[2]);
  }
  assert.deepStrictEqual(hits, [], 'no technical message is written into the app any more');
  assert.ok(!/Open the database page/.test(read('js/signal-ui.js')), 'no Firebase link on a phone');
  assert.ok(!/index it needs|database index/.test(read('js/broadcast-core.js').match(/function nalunoFeedProblemText[\s\S]*?\n\}/)[0]), 'the empty feed speaks plainly');
  assert.ok(!/renderDiagPanel|nalunoDiagFormat/.test(read('js/diagnostics.js')), 'no diagnostics panel in the app');
});
check('the rule: create-only, about yourself, known kinds; only the desk reads', () => {
  const rules = read('firestore.rules');
  const m = rules.match(/match \/diagReports\/\{id\} \{[\s\S]*?\n    \}/);
  assert.ok(m, 'diagReports rule present');
  const r = m[0];
  assert.ok(/allow create: if isSignedIn\(\)\s*&& request\.resource\.data\.uid == request\.auth\.uid/.test(r));
  assert.ok(/type in \['app', 'call'\]/.test(r) && /keys\(\)\.hasOnly\(\['uid', 'type', 'build', 'platform', 'device', 'at', 'clientAt', 'entries', 'call'\]\)/.test(r));
  assert.ok(/allow read, delete: if isOperator\(\);/.test(r) && /allow update: if false;/.test(r));
});

/* ---------- the console tab ---------- */
check('Diagnostics tab: rates, failed calls, grouped problems with the index link', () => {
  const D = require(path.join(root, 'js/admin-diagnostics.js'));
  const now = Date.now();
  const call = (role, outcome, extra) => ({ type: 'call', uid: 'u' + Math.random(), build: '2026.10.15g', platform: 'android-app', at: now - 1000, call: Object.assign({ role, outcome, answer: true, stages: { dial: 0, record: 600, alert: 650, ring: 0, answerTap: 2000, connected: 3200, heard: 3500 }, ice: { decision: 'turn-fetched', waitMs: 900 }, path: outcome === 'connected' ? { local: 'relay', remote: 'srflx' } : null, restarts: 0, states: [] }, extra || {}) });
  const reports = [
    call('caller', 'connected'), call('callee', 'connected'),
    call('caller', 'network', { restarts: 2, endReason: 'network', ice: { decision: 'no-turn-failed', waitMs: 40 } }), call('callee', 'remote-network', { endReason: 'remote-network' }),
    call('caller', 'connected', { restarts: 1, recovered: true }),
    call('caller', 'connected', { endReason: 'local-network' }),
    { type: 'app', uid: 'a', build: '2026.10.15g', platform: 'installed-web', at: now - 500, entries: [{ kind: 'feed-listener', msg: 'failed-precondition The query requires an index. You can create it here: https://console.firebase.google.com/v1/r/project/naluno/firestore/indexes?create_composite=Q', n: 3, at: now - 600 }] },
    { type: 'app', uid: 'b', build: '2026.10.15g', platform: 'android-app', at: now - 400, entries: [{ kind: 'feed-listener', msg: 'failed-precondition The query requires an index. You can create it here: https://console.firebase.google.com/v1/r/project/naluno/firestore/indexes?create_composite=Q', n: 1, at: now - 400 }] },
    { type: 'app', uid: 'a', build: '2026.10.15f', platform: 'browser', at: now - 40 * 86400000, entries: [{ kind: 'old', msg: 'too old', n: 1 }] },
  ];
  const s = D.summarize(reports, { since: now - 7 * 86400000 });
  assert.strictEqual(s.calls.attempts, 4);
  assert.strictEqual(s.calls.connected, 3);
  assert.strictEqual(s.calls.connectRate, 75);
  assert.strictEqual(s.calls.restarted, 2); assert.strictEqual(s.calls.recovered, 1);
  assert.strictEqual(s.calls.relayShare, 100);
  assert.strictEqual(s.calls.stageMs.answerToConnected, 1200);
  assert.ok(s.failedCalls.length === 3 && s.failedCalls.some((f) => f.endReason === 'local-network'), 'a connected call later lost to the network is listed');
  assert.strictEqual(s.problems.length, 1, 'older than the range is left out');
  assert.strictEqual(s.problems[0].people, 2); assert.strictEqual(s.problems[0].count, 4);
  assert.ok(/create_composite=Q/.test(s.problems[0].link));
  const adm = read('js/admin-console.js');
  assert.ok(/\['diagnostics', 'Diagnostics'\]/.test(adm) && /if \(tab === 'diagnostics'\) \{/.test(adm) && /data-tab="diagnostics"/.test(read('admin/index.html')));
  assert.ok(/admin-diagnostics\.js\?v=/.test(read('admin/index.html')));
});

(async () => {
  for (const [n, f] of checks) {
    try { await f(); } catch (e) { console.error('FAIL:', n, '\n', e && e.stack); process.exit(1); }
  }
  console.log('fixes-1015g: all ' + checks.length + ' checks passed');
})();
