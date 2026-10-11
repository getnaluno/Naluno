/* 20261011c — catalogue reads are bounded, TURN waits for the fetch, native Answer marks the call handled. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

const calls = read('js/calls.js');
const sw = read('sw.js');
const signal = read('js/signal-ui.js');
const core = read('js/broadcast-core.js');
const java = read('CallMessagingService.java');
const incoming = read('IncomingCallActivity.java');
const main = read('MainActivity.java');
const ice = read('js/ice-core.js');

const acceptAt = calls.indexOf('nalunoAnsweredId = acceptingId;');
const dismissAt = calls.indexOf('nalunoDismissCallNotifications(acceptingId)', acceptAt);
const moveAt = calls.indexOf("nalunoCallMove(acceptingId, 'accepted'", acceptAt);
assert.ok(acceptAt > 0 && dismissAt > acceptAt && moveAt > dismissAt, 'Answer dismisses the incoming alert before the status write');
assert.ok(calls.indexOf('function startInCall(){') > 0 && calls.indexOf('nalunoDismissCallNotifications(activeCallId)') > 0, 'an open call clears the alert too');
assert.ok(calls.includes('function nalunoTellNativeCallDone'), 'the Android shade is cancelled from the answer');
assert.ok(calls.includes("nalunoWaitForTurn(7000)"), 'the offer waits for the TURN attempt, not a short clock');
assert.ok(calls.includes('IceCore.awaitServers'), 'the wait follows the credential fetch instead of guessing');
assert.ok(calls.includes('id = \'remoteAudio\''), 'remote voice has its own audio element');
assert.ok(calls.includes('videoEl.muted = true'), 'the picture element does not play a second copy of the voice');

assert.ok(sw.includes('naluno-call-handled'), 'handled calls are remembered in the service worker');
assert.ok(sw.includes('function handledBefore'), 'a late push checks the remembered call before it rings');
assert.ok(sw.includes('function startRingLoop') && sw.indexOf('handledBefore(callId', sw.indexOf('function startRingLoop')) > 0, 'every ring path checks the durable handled set first');
assert.ok(sw.includes("tag.indexOf('naluno-call')"), 'closing an alert does not depend on data.type alone');

assert.ok(!signal.includes("' sched-row\""), 'the private row markup is not split mid-attribute');
assert.ok(signal.includes('class="bcast-private-row dl-row sched-row"'), 'private rows keep the class the list is drawn with');

assert.ok(core.includes('function walkPublicCatalogue'), 'public Broadcasts are read past the first page');
assert.ok(core.includes('PUBLIC_MAX_PAGES'), 'the walk has a page budget');
assert.ok(!core.includes('feedBroadcasts = list.slice(0, 80)'), 'the live listener no longer throws away everything after 80');
assert.ok(!core.includes('armFeedListenerRefresh'), 'the listener is not torn down and re-read on a timer');
assert.ok(!core.includes('45000'), 'the catalogue is not rebuilt every 45 seconds');
assert.ok(core.includes("where('publishAt', '>', bound)"), 'new Broadcasts are a gap read, not a second copy of the catalogue');
assert.ok(core.includes('n < PUBLIC_PAGE'), 'a short first page is the whole catalogue');
assert.ok(core.includes('function confirmStillOnCatalogue'), 'leaving the first page is one document read, not a guess');
const applyFn = core.slice(core.indexOf('function applyBroadcastDocsToFeed'), core.indexOf('window.broadcastStableMediaId'));
assert.ok(!applyFn.includes('walkPublicCatalogue'), 'a live snapshot does not walk the catalogue');
assert.ok(!core.includes('feedBroadcasts = [full, ...feedBroadcasts.filter'), 'publishing does not cut the feed back to 80');
assert.ok(core.includes('function nalunoRepairOwnPublicFields'), 'a creator can fill missing public fields on their own Broadcasts');

assert.ok(java.includes('dismissIncoming'), 'Android cancels the notification id for that call');
assert.ok(java.includes('isCallHandled'), 'a late Android push does not recreate an answered call');
assert.ok(main.includes('dismissIncomingCall'), 'the page can cancel the native incoming-call notification');
assert.ok(incoming.includes('markCallHandled'), 'native Answer records the call before the next push');
assert.ok(incoming.includes('dismissIncoming'), 'native Decline records the call before the next push');
assert.ok(ice.includes('function awaitIceServers'), 'TURN wait is the fetch, with a hang cap');
assert.ok(ice.includes('token-timeout'), 'a stuck sign-in token cannot hold the call open');

function grab(src, name){
  const at = src.indexOf('function ' + name);
  if(at < 0) throw new Error('missing ' + name);
  const open = src.indexOf('{', at);
  let depth = 0;
  for(let p = open; p < src.length; p++){
    if(src[p] === '{') depth++;
    else if(src[p] === '}'){
      depth--;
      if(depth === 0) return src.slice(at, p + 1);
    }
  }
  throw new Error('unclosed ' + name);
}
const ctx = {};
vm.createContext(ctx);
vm.runInContext(grab(core, 'nalunoMergeOwnerBroadcasts') + '\nthis.merge = nalunoMergeOwnerBroadcasts;', ctx);
const pin = [{ id: 'p1', visibility: 'private', creatorUid: 'me', createdAt: 5, title: 'Only me' }];
const kept = ctx.merge([], pin, 1000, [], 'me');
assert.strictEqual(kept.list.length, 1, 'a private Broadcast missing from a snapshot stays');
assert.strictEqual(kept.pins.length, 1, 'its pin stays');
const dropped = ctx.merge([{ id: 'p1', visibility: 'public', creatorUid: 'me', publishAt: 10, createdAt: 5 }], pin, 1000, [], 'me');
assert.strictEqual(dropped.pins.length, 0, 'a pin leaves when the server copy is no longer private');
assert.strictEqual(dropped.list[0].visibility, 'public');
const gone = ctx.merge([{ id: 'p1', deleted: true, visibility: 'private', creatorUid: 'me' }], pin, 1000, ['p1'], 'me');
assert.strictEqual(gone.list.length, 0, 'a deleted private Broadcast does not come back from the pin');
