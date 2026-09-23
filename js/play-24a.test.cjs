/* Contracts for the 24a play pack. These fail if a share URL, a view, or a
   save regresses to the bug that shipped. */
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const core = read('js/broadcast-core.js');
const social = read('js/signal-social.js');
const ui = read('js/signal-ui.js');
const space = read('js/broadcast-space.js');
const offline = read('js/broadcast-offline.js');
const html = read('app/index.html');
const rules = read('firestore.rules');
const handler = read('workers/economy/handler.mjs');

assert.ok(!/const NALUNO_LINK_BASE/.test(core), 'share host is not a worker constant');
assert.ok(core.includes("https://getnaluno.com/app/?broadcast="), 'share link is the site');
assert.ok(!/broadcastShareUrl[\s\S]{0,240}workers\.dev/.test(core), 'share function must not emit workers.dev');
assert.ok(space.includes('bspaceShareCard'), 'share attaches a preview card');
assert.ok(space.includes('workers\\.dev'), 'client refuses a worker share url');

assert.ok(social.includes('seenLocal[key] = true'), 'a view can be remembered');
const mark = social.slice(social.indexOf('async function markViewed'), social.indexOf('function reactsRef'));
assert.ok(mark.indexOf('await viewerRef') < mark.indexOf('seenLocal[key] = true'), 'failed view is retried');
assert.ok(social.includes('function openViewers'), 'seen by opens a sheet');
const open = social.slice(social.indexOf('function openViewers'), social.indexOf('function closeViewers'));
assert.ok(open.indexOf("classList.add('active')") < open.indexOf('viewersOf'), 'sheet opens before the query');
assert.ok(open.includes('liftViewers'), 'sheet is lifted above the story');
assert.ok(ui.includes("addEventListener('pointerdown', open)"), 'seen by answers on touch');
assert.ok(rules.includes('function signalConnected'), 'either direction of a connection can react');
assert.ok(rules.includes('signal/{segId}/reacts/'), 'reactions have their own rows');

assert.ok(html.includes('id="bspaceMoreBtn"'), 'live actions sit in one menu');
assert.ok(html.includes('id="bspaceMoreMenu"'), 'menu holds the buttons');
assert.ok(html.includes('id="bcastScheduleDock"'), 'scheduled broadcasts sit above the swipe');
assert.ok(ui.includes('function renderScheduledDock'), 'the dock is filled');
assert.ok(core.includes('async function saveBroadcastEdits'), 'a schedule can be edited');

assert.ok(!offline.includes("mode: 'cors' }), resp"), 'cache put is not a cors Request');
assert.ok(offline.includes('await cache.put(url, resp.clone())'), 'bytes are stored under the url');
assert.ok(space.includes('function bspaceOfflinePayload'), 'save reads the video the player has');
assert.ok(handler.includes('esc(selfUrl)'), 'crawler stays on the preview page');
assert.ok(!handler.includes('og:url" content="\' + esc(appUrl)'), 'og:url is not the generic site');

console.log('play-24a tests passed');
