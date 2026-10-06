/* 06 Oct (c): the call screens laid out like WhatsApp's: the picture fills
   the phone for the caller and the callee, name and status at the top,
   round buttons on the right, controls in one pill at the bottom. Layout
   only: every button id and handler is kept. */
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const html = read('app/index.html');
const css = read('css/app.css');
const cam = read('js/camera.js');
const calls = read('js/calls.js');

/* Every control that worked before is still there. */
['lobbyBack', 'camStage', 'camStageCanvas', 'camRawVideo', 'greenroomPill', 'camCaptureBtn', 'lobbyBgChipRow', 'toggleCam', 'toggleMic', 'lobbySwitchCam', 'joinBtn',
 'ringAvatar', 'ringName', 'cancelCall', 'sceneReadyNote', 'ringFallbackHint',
 'incomingSelf', 'incomingSelfVideo', 'incomingName', 'declineIncoming', 'acceptIncoming',
 'remoteVideo', 'remotePlaceholder', 'remoteName', 'callTimer', 'callFloatBtn', 'viewToggleBtn', 'bgPickerBtn', 'switchCam',
 'incallBgChipRow', 'waveform', 'localPip', 'pipStageCanvas', 'micBtn', 'earBtn', 'camBtn', 'endBtn', 'chatBtn', 'incallWire'].forEach((id) => {
  assert.ok(html.includes('id="' + id + '"'), id + ' is still on the call screens');
});

/* Caller: the camera fills the ringing screen; a flip button like WhatsApp's. */
assert.ok(html.includes('<canvas id="ringStageCanvas" class="call-self-bg"'), 'the ringing screen has a full-screen camera layer');
assert.ok(/id="ringSwitchCam" data-action="flip-camera"/.test(html), 'flip on the ringing screen uses the existing flip');
assert.ok(cam.includes("drawStage('ringStageCanvas', 'camRawVideo', camAnimStart)"), 'it is drawn with the same look as the lobby');
assert.ok(cam.includes("closest('#lobbySwitchCam, #switchCam, [data-action=\"flip-camera\"]')"), 'the flip delegate handles it');

/* The full-screen layout applies only while the camera is live and on, and
   never to voice calls or the floating window. */
assert.ok(cam.includes('function nalunoMarkCamLive()') && cam.includes("ov.setAttribute('data-cam', want)"), 'the overlay knows when the camera is live');
const block = css.slice(css.indexOf('06c: call screens laid out like WhatsApp'));
assert.ok(block.length > 1000, 'the layout block exists');
block.split('\n').filter((l) => /^[a-z#.]/i.test(l) && l.includes('{')).forEach((l) => {
  assert.ok(l.startsWith('body:not(.naluno-os-pip)'), 'scoped away from the floating window: ' + l.slice(0, 80));
});
['#lobby .cam-stage', '#ringing .ring-wrap', '#incoming .incoming-self{'].forEach((sel) => {
  const line = block.split('\n').find((l) => l.includes(sel));
  assert.ok(line && line.includes('[data-cam="1"]:not(.voice-call)'), sel + ' goes full screen only for a live video camera');
});
assert.ok(/#lobby \.cam-stage\{\s*position:absolute; inset:0; width:100%; height:100%/.test(block), 'lobby camera fills the screen');
assert.ok(/#incoming \.incoming-self\{\s*left:0; top:0; right:0; bottom:0; width:100%; height:100%/.test(block), 'incoming self view fills the screen');
assert.ok(block.includes('#incall .controls-bar{ position:absolute; left:0; right:0; bottom:var(--wa-bottom); width:max-content; }'), 'controls in one pill at the bottom');
assert.ok(block.includes('#incall.wire-open .controls-bar'), 'the in-call chat sheet still gets the bottom');

/* In call: the other person's name at the top; chips open from the palette. */
assert.ok(html.includes('<span class="call-head-name" id="incallHeadName"></span>'), 'name slot at the top');
assert.ok(calls.includes('function nalunoSetIncallHeadName()') && /if\(id === 'incall'\)[\s\S]{0,80}nalunoSetIncallHeadName\(\)/.test(calls), 'filled from the existing name');
assert.ok(/const row = \$\('incallBgChipRow'\);\s*if\(row\) row\.style\.display = 'none';/.test(calls), 'chips start closed');
assert.ok(cam.includes("row.style.display = row.style.display === 'none' ? 'flex' : 'none';"), 'the palette button still opens them');

/* The picture is not pulled closer (06b rule kept). */
assert.ok(/const NALUNO_REMOTE_MIN_SHOWN = 0\.5;/.test(calls) && calls.includes('function nalunoRemoteFit('), 'the other person fills the screen without extra zoom');
assert.ok(!/9\/16/.test(cam.slice(cam.indexOf('function nalunoCameraBox'), cam.indexOf('function nalunoHdVideo'))), 'the camera is not asked for a 9:16 crop');

/* Stamps */
['calls.js', 'camera.js', 'pwa.js'].forEach((f) => assert.ok(new RegExp('/js/' + f.replace('.', '\\.') + '\\?v=20261006[c-z]').test(html), f + ' stamp'));
assert.ok(/\/css\/app\.css\?v=20261006[c-z]/.test(html), 'app.css stamp');
console.log('fixes-1006c tests passed');
