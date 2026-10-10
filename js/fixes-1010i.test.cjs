/* 20261010i — one upload, many viewers, same shape as TikTok and YouTube.
   The direct mesh is only the fallback, and it is not delayed by the room. */
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
    if(src[p] === '{') depth++;
    else if(src[p] === '}'){
      depth--;
      if(depth === 0) return src.slice(start, p + 1);
    }
  }
  throw new Error('unclosed ' + name);
}

const live = read('js/broadcast-live.js');
const sfu = read('js/sfu-live.js');
const ctx = { String: String, Date: Date };
vm.createContext(ctx);
vm.runInContext(
  grab(live, 'bLiveWatchPath') + '\n' +
  grab(live, 'bLiveHostShouldMesh') + '\n' +
  grab(live, 'bLiveRoomPresence') + '\n' +
  'this.path = bLiveWatchPath; this.mesh = bLiveHostShouldMesh; this.presence = bLiveRoomPresence;',
  ctx
);

assert.strictEqual(ctx.path(false, false), 'mesh', 'a room the server said is down is not waited on');
assert.strictEqual(ctx.path(undefined, true), 'mesh', 'a worker with no room is not asked again');
assert.strictEqual(ctx.path(true, false), 'room', 'a connected room is what viewers join');
assert.strictEqual(ctx.path(undefined, false), 'try', 'unknown still gets one short try');

assert.strictEqual(ctx.mesh({ offer: { type: 'offer', sdp: 'x' } }), true);
assert.strictEqual(ctx.mesh({ offer: { type: 'offer' }, answer: { type: 'answer' } }), false);
assert.strictEqual(ctx.mesh({ room: true, from: 'u' }), false, 'a room viewer is not a second upload');

const row = ctx.presence('uid-1', 'Ada', true);
assert.strictEqual(row.room, true);
assert.strictEqual(row.preview, true);
assert.strictEqual(row.from, 'uid-1');
assert.ok(!('offer' in row));

const host = live.slice(live.indexOf('async function bLiveStartHost'), live.indexOf('function bLiveFlashJoinName'));
assert.ok(host.indexOf('bLiveHostUnsubs.push') !== -1 && host.indexOf('bLiveHostUnsubs.push') < host.indexOf('bLiveOpenRoom(stream'), 'the phone listens before it publishes');
assert.ok(!/await sfuPublishLive|await bLiveOpenRoom/.test(host), 'publishing once does not block the first viewer');
assert.ok(sfu.includes('function sfuAsk') && sfu.includes('AbortError'), 'a room that does not answer is abandoned');
assert.ok(sfu.includes('return 12'), 'the phone does not open a connection per viewer');
assert.ok(read('app/index.html').includes('/js/sfu-live.js?v=20261010i'));
assert.ok(!read('js/broadcast-live.js').includes('getPatient'));

console.log('fixes-1010i tests passed');
