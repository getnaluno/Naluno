/* 28d: each fix from the audit, pinned so it cannot silently come back. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const read = (f) => fs.readFileSync(path.join(__dirname, f), 'utf8');

/* Discover: compiles add on, they do not replace. */
const E = require('./discover-engine.js');
const a = E.rollup([{ broadcastId: 'b', type: 'broadcast_impression' }, { broadcastId: 'b', type: 'watch_completed', watchSec: 30 }]).features.b;
const b2 = E.rollup([{ broadcastId: 'b', type: 'broadcast_impression' }, { broadcastId: 'b', type: 'broadcast_impression', watchSec: 10 }]).features.b;
const m = E.mergeFeatures(a, b2);
assert.strictEqual(m.impressions, 3);
assert.strictEqual(m.completions, 1);
assert.strictEqual(m.watchSamples, 2);
assert.strictEqual(m.avgWatchSec, 20);
assert.ok(Math.abs(m.completionRate - 1 / 3) < 1e-9);
const adm = read('admin-console.js');
assert.ok(adm.includes("markRef = db.collection('discoveryConfig').doc('compile')"));

/* Signals. */
const core = read('signal-core.js');
assert.ok(core.includes('function refreshConnectionsSignals('), 'strip refreshes');
assert.ok(core.includes("document.addEventListener('visibilitychange'"), 'on return to the app');
assert.ok(core.indexOf('clean.held = true;') < core.indexOf('await ref.set(clean);'), 'held is decided before the save');
assert.ok(!/thumbDataUrl\)\.slice\(0, 350000\)/.test(core), 'no cut-off thumbnails');
assert.ok(core.includes('A failed read is not "no Signal"'));
const ui = read('signal-ui.js');
['signalSafeSrc', 'signalSafeFilter', 'signalSafeColor', 'signalSafeStyle'].forEach((f) => assert.ok(ui.includes('function ' + f + '(')));
assert.ok(!ui.includes("style=\"filter:'+(latest.filterCss||'')+'\""), 'no raw filter in the strip');
assert.ok(!ui.includes('filter:${seg.filterCss || \'\'}'), 'no raw filter in the viewer');
assert.ok(!ui.includes('background:${seg.color};'), 'no raw colour in the viewer');
assert.ok(ui.includes("Only you can see this. It is being checked."));
const social = read('signal-social.js');
assert.ok(social.includes("where('segId', '==', String(segId))"), 'pulses narrowed to one Signal');
assert.ok(social.includes('connectionName(who) === null'), 'strangers do not appear in Seen by');
const comp = read('compass.js');
assert.ok(comp.includes('function nalunoNoteHeldSignals('));
assert.ok(adm.includes("data-a=\"release\""), 'desk can release a held Signal');

/* Service worker and updates. */
const sw = fs.readFileSync(path.join(__dirname, '../sw.js'), 'utf8');
assert.ok(!sw.includes("status: 'COUNTED'"), 'events are not reported counted before the worker answers');
assert.ok(!/path === '\/v1\/presence'[^\n]*\n\s*return econJson\(\{ ok: true \}\);/.test(sw), 'presence is forwarded');
assert.ok(!sw.includes("contribution_points: 0, eligible_contribution: 0"), 'no invented zero offline');
assert.ok(sw.includes("if(/[?&]v=/.test(url.search)){"), 'versioned code opens from the phone');
const pwa = read('pwa.js');
assert.ok(pwa.includes('if(!hadController) return;') && pwa.includes('busyNow()'), 'no reload on first visit or mid-call');

/* Other fixes. */
const mail = read('wire-mailbox.js');
assert.ok(mail.includes('function sealRetryWanted(') && mail.includes('if (sealRetryWanted(doc.id, ts)) return;'));
const live = read('live-sync.js');
assert.ok(!live.includes('obs.observe(document.documentElement'));
const calls = read('calls.js');
assert.ok(/if\(history\.state && history\.state\.nalunoCall\)\{\s*window\.__nalunoCallPop = (?:true|Date\.now\(\));\s*history\.back\(\);/.test(calls));
const auth = read('auth.js');
assert.ok(auth.includes("kind: 'erase-media'"), 'files the app cannot delete go to the desk');
const bc = read('broadcast-core.js');
assert.ok(bc.includes('function armScheduledFeedTimer('), 'scheduled Broadcasts appear on time');
const circle = read('circle.js');
assert.ok(circle.includes('.filter(function(r){ return (r._score || 0) > 0; })'), 'no zero rows on Toga');
const bs = read('broadcast-space.js');
assert.ok(bs.includes("$('bspaceSendClose').onclick = bspaceCloseSend"));

/* Every script the member page loads exists. */
const html = fs.readFileSync(path.join(__dirname, '../app/index.html'), 'utf8');
(html.match(/src="\/(js\/[^"?]+)/g) || []).forEach((s) => {
  const f = s.replace('src="/', '');
  assert.ok(fs.existsSync(path.join(__dirname, '..', f)), 'missing ' + f);
});
console.log('fixes-28d tests passed');
/* UI pass (second round). */
const css = fs.readFileSync(path.join(__dirname, '../css/app.css'), 'utf8');
assert.ok(css.includes('.app.install-on .tabscreen{ top: var(--install-h, 52px); }'), 'install banner no longer covers headers');
assert.ok(pwa.includes('function nalunoInstallSpace') || pwa.includes('nalunoInstallSpace'), 'banner space kept in sync');
assert.ok(css.includes('.signal-tile .signal-window > .signal-window-in{ flex-direction:column;'), 'Signal caption at the bottom');
assert.ok(css.includes('#supportSheetSend, #reportSendBtn, #appealSendBtn{ margin-left:0; margin-right:0;'), 'sheet buttons fit');
assert.ok(css.includes('body:has(.call-overlay.active) #wirelineThread.active'), 'chat fills the screen');
assert.ok(css.includes('body.naluno-bcast-mine .bcast-plate .feed-orient-btn'), 'My Broadcasts buttons not covered');
const prof = read('profile.js');
assert.ok(prof.includes('threadUid:') && prof.includes('bandFirestoreId:'), 'reopen restores the right chat and room');
assert.ok(prof.includes('bspaceMoreMenu: { open:') && prof.includes('sparkSheet: { open:'), 'Back knows every sheet');
assert.ok(auth.includes("if(document.readyState === 'loading'){\n    document.addEventListener('DOMContentLoaded', function(){ startSignedInListeners(user); }"), 'sign-in waits for the page');
assert.ok(auth.includes("step('band invites'"), 'one failing start step cannot stop the others');
const spark = read('spark.js');
assert.ok(spark.includes("qrcode(0, 'M')"), 'Spark QR drawn on the phone');
assert.ok(fs.existsSync(path.join(__dirname, 'qrcode.js')) && html.includes('/js/qrcode.js?v='), 'QR library shipped and loaded');
assert.ok(html.indexOf('/js/qrcode.js') < html.indexOf('/js/spark.js'), 'QR library loads before Spark');
assert.ok(!html.includes('24h to 7 days') && !comp.includes('3 days / 7 days'), 'Signal lifetime says what is offered');
assert.ok(!html.includes('<span class="eyebrow">New broadcast</span>'), 'no stray label over the composer title');
const known = read('known.js');
assert.ok(known.includes("button = 'Known · accepted';"), 'no double Pay');
const ui2 = read('signal-ui.js');
assert.ok(ui2.includes("dateStyle: 'medium', timeStyle: 'short'"), 'schedule time without seconds');
console.log('fixes-28d UI tests passed');

/* Swipe gestures (third round). */
const gest = read('gestures.js');
const sw2 = fs.readFileSync(path.join(__dirname, '../sw.js'), 'utf8');
assert.ok(html.includes('/js/gestures.js?v=') && sw2.includes("'/js/gestures.js'"), 'gestures loaded and cached');
assert.ok(html.indexOf('/js/gestures.js') > html.indexOf('/js/wireline.js') && html.indexOf('/js/gestures.js') > html.indexOf('/js/profile.js'), 'gestures load after what they call');
['nalunoStoryPerson', 'nalunoReplyTake', 'nalunoReplyClear', 'nalunoBuzz'].forEach((n) => assert.ok(gest.includes('window.' + n + ' ='), n));
assert.ok(gest.includes('const EDGE = 24;'), 'Android edge-back stays free');
assert.ok(prof.includes('closeById: closeById'), 'pull-down close uses the Back registry');
assert.ok(ui2.includes('nalunoStoryPerson(1)'), 'stories move on to the next person');
const wire2 = read('wireline.js');
assert.ok(wire2.includes("const full = quote ? quote + '\\n' + text : text;") && wire2.includes("{ type:'text', text: full }"), 'reply quote is sent');
assert.ok(wire2.includes('bubbleInner = wireQuoteHtml(') && wire2.includes("'<div class=\"msg-quote\">' + escapeHtml("), 'quote rendered escaped');
['.naluno-gesture-hint', '#nalunoPull', '#wireReplyBar', '.msg-quote', '.wire-swipe-tray', '#bviewer.story-held'].forEach((c) => assert.ok(css.includes(c), 'css ' + c));
console.log('fixes-28d gesture tests passed');
assert.ok(pwa.includes('if(window.__nalunoGestureTouch){') && gest.includes('window.__nalunoGestureTouch = true;'), 'a pulled sheet or list does not also reload the app');
assert.ok(/\/js\/wireline\.js\?v=20260928[d-z]/.test(html), 'changed wireline.js gets a new stamp');
console.log('fixes-28d gesture tests 2 passed');
