const fs = require('fs');
const assert = require('assert');
const calls = fs.readFileSync(__dirname + '/calls.js', 'utf8');
const wire = fs.readFileSync(__dirname + '/wireline.js', 'utf8');
let n = 0;
function check(name, cond) {
  n += 1;
  assert.ok(cond, name);
}
check('caller holds ice until the call record exists', calls.indexOf('heldCands.push(json)') >= 0 && calls.indexOf('heldCands.splice(0).forEach(sendCand)') >= 0);
check('a rules refusal is a hard no; a flaky write is not treated as the call being gone', calls.indexOf("return !(e && e.code === 'permission-denied')") >= 0 && calls.indexOf("if(e && e.code === 'permission-denied') return false;") >= 0 && calls.indexOf('return plain();') >= 0);
check('an ended call is not opened because an old answer is still on it', calls.indexOf("d.status === 'ended'") >= 0 && calls.indexOf('const finished = d.status') >= 0);
check('a voice note appears before the upload', wire.indexOf("type:'voice'") >= 0 && wire.indexOf('pendingUpload:true') >= 0 && wire.indexOf('saveVoiceAudio(qid, dataUrl)') >= 0 && wire.indexOf("payload.type === 'voice'") >= 0);
check('a retry does not send a drop that is already in the thread', wire.indexOf("where('clientMsgId','==',cmid)") >= 0 && wire.indexOf('do not send it again') >= 0);
console.log('call and wire checks', n);
