/* 14 Oct: the ecosystem audit (f144409). Static checks that each fix stays
   wired; behaviour is tested in workers/economy/audit-1014, seat-expiry,
   lg-voice-cap, upload-limits, and the browser harnesses for calls. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const rules = read('firestore.rules');
const calls = read('js/calls.js');

/* C1-C3 calls */
assert.ok(/tx\.update\(ref, \{ earlyAnswer: early \}\)/.test(calls), 'C1: the first phone to answer early wins');
assert.ok(/type: 'pranswer'/.test(calls) && /answer-switch/.test(calls), 'C1: a final answer from another phone replaces the provisional one; a failed switch ends plainly');
assert.ok(/raddr 0\.0\.0\.0 rport 0/.test(calls) && /nalunoEarlyCandOut\(json\)/.test(calls), 'C2: no local address in early routes');
assert.ok(/audio: \{ echoCancellation:true, noiseSuppression:true, autoGainControl:true \},\n/.test(calls.slice(calls.indexOf('async function ensureCallMediaReady('))), 'C3: the locked microphone line is back');

/* L1, L2 */
assert.ok(/&& parentBroadcastVisible\(id\)\s*&& \(col != 'liveSessions' \|\| docId == request\.auth\.uid\);/.test(rules), 'L1: writes need visibility; a live session is its writer\'s');
assert.ok(/if\(data\.from && data\.from !== uid\) return;/.test(read('js/broadcast-live.js')), 'L1: the host ignores a session written in another name');
const core = read('js/broadcast-core.js');
assert.ok(!/is live now: ' \+ liveTitle/.test(core) && !/wirelineNotifyLive\(/.test(core), 'L2: no plaintext live line in Wireline');
assert.ok(/hasOnly\(\['lastMessageAt', 'lastKind', 'lastMessageText', 'lastMessageFrom', 'readBy'\]\)/.test(rules) && /participants\.size\(\) == 2/.test(rules), 'L2: a thread is a preview line between two people');
assert.ok(/request\.resource\.data\.get\('encrypted', false\) == true && !\('text' in request\.resource\.data\)/.test(rules), 'L2: a thread text message is sealed');

/* R1-R2 and the connection hole */
assert.ok(/allow get: if isSignedIn\(\) && \(isOwner\(uid\) \|\| memberUid == request\.auth\.uid \|\| isOperator\(\)\);\s*allow list: if isOwner\(uid\) \|\| isOperator\(\);/.test(rules), 'R1: only the owner lists a Circle');
assert.ok(/function notifyRelated\(\)/.test(rules) && /&& notifyRelated\(\);/.test(rules), 'R2: a notice needs a tie');
assert.ok(/\/v1\/live\/alert/.test(core) && /\/v1\/live\/alert/.test(read('workers/economy/handler.mjs')), 'R2: the worker tells the audience');
assert.ok(/function sparkProves\(\)/.test(rules) && /connectionRequests\/\$\(uid\)\)\s*\|\| sparkProves\(\)/.test(rules), 'a connection entry needs the other person\'s consent');
assert.ok(/mirror\.spark = /.test(read('js/find.js')), 'a Spark connection carries its pulse as proof');

/* S1-S2 */
assert.ok(/function videoHasPass\(\)/.test(rules) && /&& videoHasPass\(\);/.test(rules), 'S1: an original video needs a pass');
assert.ok(/reachPassCheck\(env, uid, idToken, body\.reachPass/.test(read('signal-worker-index.js')), 'S1: the media worker measures the file against the pass');
assert.ok(/maxBytes/.test(read('workers/economy/handler.mjs')), 'S1: the pass carries a byte limit');
const lr = read('workers/economy/launch-routes.mjs');
assert.ok(/async function expireSeats\(/.test(lr) && /profileCount: n/.test(lr), 'S2: places given are not replaced by a profile count');

/* G1-G2 */
const lg = read('workers/economy/lg-voice.mjs');
assert.ok(/deps\.usage\.reserve/.test(lg) && /lgAudioHostOk\(url, env\)/.test(lg), 'G1: shared daily allowance; audio only from Sunbird\'s places');
assert.ok(/'lgref:' \+ doc\.id/.test(read('js/lg-ear.js')) && /match \/lgVoiceAudio\/\{id\}/.test(rules), 'G2: the list carries words; the sound is fetched when spoken');

/* D1, A1 */
assert.ok(/function eventDayOk\(d\)/.test(rules) && /\.doc\(id\)\.set\(body\)/.test(read('js/discover.js')), 'D1: one event per person, Broadcast, kind and day');
assert.ok(/if \(type === 'comment_down'\) f\.negativeEvents \+= 1;/.test(read('js/discover-engine.js')), 'D1: a downvote is a negative');
assert.ok(/runDiscoverCompile\(env, Date\.now\(\), 3\)/.test(read('workers/economy/index.mjs')), 'D1: the worker compiles on its cron');
assert.ok(/\/v1\/ads\/event/.test(read('js/ads.js')) && !/FieldValue\.increment\(1\)/.test(read('js/ads.js')), 'A1: the phone no longer writes ad counters');

/* N1 */
assert.ok(/lastFailedKind = kind;/.test(read('UploadKeepAliveService.java')) && /keepAliveFailed\(\)/.test(read('MainActivity.java')), 'N1: a refused call keep-alive is reported');
assert.ok(/if \(encrypted\) e\.putString\("refresh", refreshToken\);/.test(read('BeaconFindService.java')), 'N1: no refresh token in plain preferences');

/* Every preview label the app writes is one the thread rule accepts. */
{
  const allowed = (rules.match(/d\.lastMessageText in \[([^\]]+)\]/) || [])[1].split(',').map((x) => x.trim().replace(/^'|'$/g, ''));
  global.window = global.window || {};
  const store = require(path.join(root, 'js/chat-store.js'));
  const label = (store && store.kindLabel) || (global.window.NalunoChatStore && global.window.NalunoChatStore.kindLabel);
  assert.ok(typeof label === 'function', 'chat-store kindLabel loads');
  ['text', 'voice', 'photo', 'video', 'document', 'mood', 'missed_call', 'system', 'anything-new'].forEach((t) => {
    assert.ok(allowed.includes(label(t)), 'thread preview label allowed: ' + label(t));
  });
}
/* Discover event ids are what the rule expects. */
{
  const uid = 'u123', bid = 'sig_ab-12', type = 'watch_25_percent', at = 1760400000123;
  const day = Math.floor(at / 86400000);
  const id = uid + '_' + bid.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 80) + '_' + type + '_' + day;
  const ruleDay = Math.trunc(at / 86400000);
  assert.strictEqual(id, uid + '_' + bid + '_' + type + '_' + String(ruleDay));
}

/* S3: push addresses in the vault only */
assert.ok(/function pushTokensOnlyRemoved\(\)/.test(rules) && /keepsJoinedAt\(\) && pushTokensOnlyRemoved\(\)/.test(rules), 'S3: a member cannot put push addresses back on the profile');
assert.ok(/async function movePush\(/.test(read('js/vault.js')) && /nalunoPushSave\(userRef, payload\)/.test(read('js/auth.js')) && /nalunoPushSave\(ref, androidPayload\)/.test(read('js/pwa.js')), 'S3: the app writes push addresses to the vault');
assert.ok(/\['fcmToken', 'fcmTokenWeb', 'fcmTokenAndroid', 'fcmTokenPlatform', 'fcmTokenUpdatedAt'\]\.forEach\(function\(k\)\{ delete cloudProfile\[k\]; \}\);/.test(read('js/auth.js')), 'S3: a Callsign save never writes them back');
assert.ok(!/if\(!tokens\.android && !primaryTok\) return;/.test(read('js/broadcast-core.js')), 'S3: an empty public profile no longer stops a live push');
assert.ok(/runPushMove\(env\)/.test(read('workers/economy/index.mjs')), 'S3: old public addresses are moved by the worker');
const cn = read('workers/call-notify/handler.mjs');
assert.ok(/\/vault\/main/.test(cn) && /async function tied\(/.test(cn) && /"arrayValue" in v/.test(cn), 'call-notify reads the vault, checks ties, reads lists');

/* Untouched on purpose */
assert.ok(/function isSuper\(\)/.test(rules), 'the owner\'s console sign-in path is unchanged');
console.log('fixes-1014a: all checks passed');
