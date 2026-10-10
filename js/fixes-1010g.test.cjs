/* 20261010g — private broadcasts stay on My Broadcasts, a live viewer is
   answered without waiting on a room that is not connected, comments are not
   painted over by a slower read, and a live plate can play silently. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

const live = read('js/broadcast-live.js');
const ui = read('js/signal-ui.js');
const space = read('js/broadcast-space.js');
const preview = read('js/live-preview.js');
const sw = read('sw.js');

assert.strictEqual((sw.match(/^const APP_BUILD = '(\d{8}[a-z])'/m) || [])[1], '20261010g');
assert.ok(sw.includes("CACHE_NAME = 'naluno-shell-v308'"));
assert.ok(!live.includes('getPatient'), 'live join does not wait out the long TURN budget');
assert.ok(!live.includes('sfuPublishLive') && !live.includes('sfuJoinLive'), 'a missing larger room does not sit in front of the mesh');
assert.ok(!live.includes('await bLiveHostAcceptViewer'), 'viewers are answered together, not one after another');
assert.ok(live.includes('function bLiveFlashJoinName') && live.includes('!data.preview'), 'a real join is flashed, a silent feed preview is not');
assert.ok(live.includes('function bLiveSyncFeed') && live.includes('preview: true'), 'the feed can play the live without opening the room');
assert.ok(live.includes('bLiveWatchReactions(activeBroadcastId)'), 'reactions listen as soon as the live is open');
assert.ok(preview.includes('bLiveSyncFeed'), 'the feed scan starts the silent picture');
assert.ok(ui.includes("if(bcastActiveView === 'mine') return true;"), 'private broadcasts stay on My Broadcasts');
assert.ok(space.includes('if(!bspaceDocCache.conversation)'), 'a late read cannot wipe a live comment');
assert.ok(!space.includes('bspaceDocCache.conversation = conv.docs;') || space.includes('if(!bspaceDocCache.conversation)'), 'conversation cache is not replaced blindly');
const blind = space.slice(space.indexOf('function renderBspaceImpact'), space.indexOf('function renderBspaceUpdates'));
assert.ok(!/bspaceDocCache\.conversation = conv\.docs;/.test(blind.replace(/if\(!bspaceDocCache\.conversation\)\{\s*bspaceDocCache\.conversation = conv\.docs;/, '')), 'the overwrite is gone');

console.log('fixes-1010g tests passed');
