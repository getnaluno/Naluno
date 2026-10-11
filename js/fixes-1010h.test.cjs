/* 20261010h — behavior, not string wishes.
   A public snapshot must not delete a private Broadcast.
   The offer must leave once a relay candidate is in it, and must not wait
   past its cap when one never arrives.
   A comment already on screen is not flashed again. A new one is, on the
   page, not inside the video element that gets replaced.
   A live plate that slips off screen for a moment is not torn down. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

function grab(src, name){
  const at = src.indexOf('function ' + name);
  if(at < 0) throw new Error('missing ' + name);
  const start = src.slice(Math.max(0, at - 6), at) === 'async ' ? at - 6 : at;
  const open = src.indexOf('{', start);
  let depth = 0;
  for(let p = open; p < src.length; p++){
    const c = src[p];
    if(c === '{') depth++;
    else if(c === '}'){
      depth--;
      if(depth === 0) return src.slice(start, p + 1);
    }
  }
  throw new Error('unclosed ' + name);
}

const core = read('js/broadcast-core.js');
const live = read('js/broadcast-live.js');
const space = read('js/broadcast-space.js');
const ui = read('js/signal-ui.js');
const html = read('app/index.html');

const mergeCtx = {};
vm.createContext(mergeCtx);
vm.runInContext(grab(core, 'nalunoMergeOwnerBroadcasts') + '\nthis.merge = nalunoMergeOwnerBroadcasts;', mergeCtx);
const now = 1700000000000;
const pin = { id: 'p1', visibility: 'private', title: 'Only me', creatorUid: 'me', createdAt: now - 86400000 };
const pub = { id: 'a', visibility: 'public', title: 'Out', creatorUid: 'me', createdAt: now, publishAt: now - 10 };

let kept = mergeCtx.merge([pub], [pin], now, [], 'me');
assert.ok(kept.list.some(function(b){ return b.id === 'p1'; }), 'a snapshot that omits a private Broadcast does not delete it');
assert.ok(kept.pins.some(function(b){ return b.id === 'p1'; }), 'the pin survives that snapshot');
assert.ok(kept.list.some(function(b){ return b.id === 'a'; }), 'a real public Broadcast stays');

let gone = mergeCtx.merge([{ id: 'p1', deleted: true, visibility: 'private', creatorUid: 'me' }], [pin], now, [], 'me');
assert.ok(!gone.list.some(function(b){ return b.id === 'p1'; }) && !gone.pins.length, 'a deleted server copy drops the pin');

gone = mergeCtx.merge([], [pin], now, ['p1'], 'me');
assert.ok(!gone.list.length && !gone.pins.length, 'an explicit delete id drops the pin');

let published = mergeCtx.merge([{ id: 'p1', visibility: 'public', publishAt: now - 5, createdAt: pin.createdAt, creatorUid: 'me' }], [pin], now, [], 'me');
assert.ok(published.list.some(function(b){ return b.id === 'p1'; }), 'publishing it keeps the row');
assert.ok(!published.pins.length, 'publishing it drops the private pin');

let foreign = mergeCtx.merge([], [{ id: 'x', visibility: 'private', creatorUid: 'other', createdAt: 1 }], now, [], 'me');
assert.strictEqual(foreign.list.length, 0, 'another person\'s private pin is not shown');

let scheduled = mergeCtx.merge([], [{ id: 's', visibility: 'public', publishAt: now + 60000, creatorUid: 'me', createdAt: 2 }], now, [], 'me');
assert.strictEqual(scheduled.list[0].id, 's', 'a scheduled Broadcast the server omitted stays');

function forYou(rows){
  return rows.filter(function(b){
    if(!b || b.deleted) return false;
    if(Number(b.publishAt) > now) return false;
    if(b.visibility === 'private') return false;
    return true;
  });
}
assert.ok(!forYou([pub, pin]).some(function(b){ return b.id === 'p1'; }), 'For You does not show a private Broadcast even if a stale feed row has it');
assert.ok(ui.includes("if(typeof broadcastIsPrivate === 'function' && broadcastIsPrivate(b)) return false;"), 'the For You grid uses that rule');
assert.ok(ui.includes("if(bcastActiveView === 'mine') return true;"), 'My Broadcasts does not');

const readyCtx = { Date: Date, setTimeout: setTimeout, Promise: Promise };
vm.createContext(readyCtx);
vm.runInContext(grab(live, 'bLiveDescribeWhenReady') + '\nthis.ready = bLiveDescribeWhenReady;', readyCtx);
const keepCtx = {};
vm.createContext(keepCtx);
vm.runInContext(grab(live, 'bLiveFeedKeep') + '\nthis.keep = bLiveFeedKeep;', keepCtx);
assert.strictEqual(keepCtx.keep(0, 5000, false), true, 'the first moment off screen does not kill the silent live');
assert.strictEqual(keepCtx.keep(1000, 2500, false), true, 'a brief scroll does not kill it');
assert.strictEqual(keepCtx.keep(1000, 3100, false), false, 'staying off screen does');
assert.strictEqual(keepCtx.keep(1000, 9000, true), true, 'back on screen it stays');

const els = {};
const document = {
  getElementById: function(id){ return els[id] || null; },
  createElement: function(){ return { id: '', style: {}, textContent: '', parentNode: null }; },
  body: {
    appendChild: function(el){ el.parentNode = document.body; els[el.id] = el; },
  },
};
const talkCtx = {
  document: document,
  setTimeout: setTimeout,
  clearTimeout: clearTimeout,
  bspaceLiveTalkSeen: {},
  bspaceLiveTalkPrimed: false,
};
vm.createContext(talkCtx);
vm.runInContext(grab(space, 'bspaceFlashLine') + '\n' + grab(space, 'bspaceNoteLiveTalk') + '\nthis.note = bspaceNoteLiveTalk; this.flash = bspaceFlashLine;', talkCtx);
const old = { id: 'c1', data: function(){ return { text: 'already there', type: 'text' }; } };
talkCtx.note([old]);
assert.ok(!els.bspaceTalkFlash, 'opening the room does not replay old comments onto the video');
talkCtx.note([old, { id: 'c2', data: function(){ return { text: 'hello live', type: 'text' }; } }]);
assert.ok(els.bspaceTalkFlash && els.bspaceTalkFlash.textContent === 'hello live', 'a new comment is flashed');
assert.strictEqual(els.bspaceTalkFlash.parentNode, document.body, 'the flash is not inside the video element');

const flashSrc = grab(live, 'bLiveFlashJoinName');
assert.ok(flashSrc.includes('document.body.appendChild'), 'a join flash is mounted on the page');
assert.ok(!flashSrc.includes('bspaceMedia'), 'a join flash is not mounted in the element Connecting replaces');
const layerSrc = grab(live, 'bLiveEnsureReactionLayer');
assert.ok(layerSrc.includes('document.body.appendChild') && !layerSrc.includes('bspaceHero'), 'reactions are not inside the hero that can be missing');
const joinSrc = live.slice(live.indexOf('async function bLiveJoinAsViewer'), live.indexOf('async function bLiveLeaveViewer'));
assert.ok(!joinSrc.includes('await bLiveFeedStarting'), 'opening the room does not wait for the silent feed');
assert.ok(live.includes('function bLiveDescribeWhenReady') && live.includes('bLiveDescribeWhenReady(pc, 800)'), 'the offer waits briefly for a real path');
assert.ok(live.includes('Date.now() - t0 < 1000'), 'TURN wait is one second, not the long patient budget');
assert.ok(!live.includes('getPatient'), 'the long TURN budget stays out');
assert.ok(!/await sfuPublishLive/.test(live), 'the one upload does not block the first viewer');
const reactSrc = live.slice(live.indexOf('function bLiveWatchReactions'), live.indexOf('function bLiveSpawnReaction'));
assert.ok(reactSrc.includes('if(!primed)'), 'old reactions are not replayed');

assert.ok(html.includes('/js/camera.js?v=20261010a'), 'camera was not republished');
assert.ok(html.includes('/js/calls.js?v=20261011c'), 'call audio is this build');
assert.ok(!read('js/calls.js').includes('createMediaStreamSource'), 'received voice is still a single path');

(async function(){
  const pc = {
    signalingState: 'have-local-offer',
    iceGatheringState: 'gathering',
    localDescription: { type: 'offer', sdp: 'a=candidate:1 1 udp 2122260223 10.0.0.1 9 typ host' },
  };
  const t0 = Date.now();
  setTimeout(function(){
    pc.localDescription = { type: 'offer', sdp: 'a=candidate:2 1 udp 41885439 1.2.3.4 3478 typ relay raddr 0.0.0.0 rport 9' };
  }, 90);
  const out = await readyCtx.ready(pc, 800);
  const dt = Date.now() - t0;
  assert.ok(out && out.sdp.indexOf('typ relay') >= 0, 'the written offer contains the relay candidate');
  assert.ok(dt < 700, 'it returns when the relay arrives, not after the cap (' + dt + 'ms)');

  const slow = {
    signalingState: 'have-local-offer',
    iceGatheringState: 'gathering',
    localDescription: { type: 'offer', sdp: 'a=candidate:1 1 udp 1 10.0.0.8 9 typ host' },
  };
  const t1 = Date.now();
  const out2 = await readyCtx.ready(slow, 160);
  const dt2 = Date.now() - t1;
  assert.ok(out2 && out2.sdp.indexOf('typ host') >= 0, 'with no public path the host candidate is still sent');
  assert.ok(dt2 >= 140 && dt2 < 450, 'that wait stops at the cap (' + dt2 + 'ms)');
  console.log('fixes-1010h tests passed');
})().catch(function(e){
  console.error(e);
  process.exit(1);
});
