/* Wireline attachment policy. Run: node js/wireline-media.test.cjs
   Broadcast routes are not called. Sent is only after the message write. */
const assert = require('assert');
const Media = require('./wireline-media.js');

function bytes(n, head) {
  const u = new Uint8Array(n);
  (head || []).forEach(function (b, i) { u[i] = b; });
  return u;
}
function file(name, type, size, head) {
  const u = bytes(size, head);
  return {
    name: name,
    type: type,
    size: u.length,
    slice: function (a, b) { return u.slice(a, b); },
  };
}

const photo = Media.classify(file('a.jpg', 'image/jpeg', 1200), '');
assert.equal(photo.ok, true);
assert.equal(photo.kind, 'photo');

const clip = Media.classify(file('clip.mp4', '', 8 * 1024 * 1024), '');
assert.equal(clip.ok, true);
assert.equal(clip.kind, 'video');
assert.equal(clip.contentType, 'video/mp4');

const docx = Media.classify(file('report.docx', '', 4000), 'document');
assert.equal(docx.ok, true);
assert.equal(docx.kind, 'document');
assert.equal(docx.name, 'report.docx');
assert.equal(docx.contentType, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');

const song = Media.classify(file('song.mp3', 'audio/mpeg', 2000), 'audio');
assert.equal(song.ok, true);
assert.equal(song.kind, 'audio');

const voice = Media.classify(file('voice.webm', 'audio/webm', 9000), 'voice');
assert.equal(voice.ok, true);
assert.equal(voice.kind, 'voice');

const html = Media.classify(file('page.html', 'text/html', 40), '');
assert.equal(html.ok, false);
const svg = Media.classify(file('icon.svg', 'image/svg+xml', 40), '');
assert.equal(svg.ok, false);
const empty = Media.classify(file('a.jpg', 'image/jpeg', 0), '');
assert.equal(empty.ok, false);
assert.match(empty.error, /empty/);

const huge = Media.classify(file('long.mp4', 'video/mp4', Media.LIMITS.video + 1), '');
assert.equal(huge.ok, false);
assert.match(huge.error, /Wireline limit/);
const loud = Media.classify(file('voice.webm', 'audio/webm', Media.LIMITS.voice + 1), 'voice');
assert.equal(loud.ok, false);
assert.match(loud.error, /voice/);

const many = [];
for (let i = 0; i < 21; i++) many.push(file('p' + i + '.jpg', 'image/jpeg', 10));
const batch = Media.planBatch(many, '');
assert.equal(batch.accepted.length, 20);
assert.equal(batch.rejected.length, 1);
assert.match(batch.rejected[0].error, /20/);

assert.deepEqual(Media.delivery(false, false), { status: 'failed', sent: false, retry: true, keepUrl: false });
assert.equal(Media.delivery(true, false).sent, false);
assert.equal(Media.delivery(true, false).keepUrl, true);
assert.equal(Media.delivery(true, true).sent, true);

const item = {
  id: 'd1',
  status: 'selected',
  file: file('a.jpg', 'image/jpeg', 10),
  plan: photo,
  mediaUrl: '',
  clientMsgId: '',
  vaultKey: 'wire-1',
};
const up = Media.stepItem(item, 'upload-ok');
assert.equal(up.status, 'uploaded');
assert.equal(up.file.name, 'a.jpg');
assert.equal(up.plan.kind, 'photo');
assert.equal(up.vaultKey, 'wire-1');
const stored = Object.assign({}, up, { mediaUrl: 'https://up.example/o/w/alice/a.jpg' });
assert.equal(Media.shouldUpload(stored), false);
const waiting = Media.settleSend(stored, { ok: false, url: stored.mediaUrl, timedOut: true });
assert.equal(waiting.status, 'queued');
assert.equal(waiting.mediaUrl, stored.mediaUrl);
assert.equal(Media.shouldUpload(waiting), false, 'a stored file is not uploaded again');
const again = Media.stepItem(waiting, 'retry');
assert.notEqual(again.status, 'delivered');
assert.equal(again.mediaUrl, stored.mediaUrl);
const sent = Media.settleSend(again, { ok: true, url: stored.mediaUrl });
assert.equal(sent.status, 'delivered');
assert.equal(Media.stepItem(sent, 'retry').status, 'delivered', 'a delivered file is not sent twice');
const broken = Media.settleSend(stored, { ok: false, url: stored.mediaUrl, error: 'Mailbox is not ready' });
assert.equal(broken.status, 'uploaded');
assert.equal(broken.mediaUrl, stored.mediaUrl);
assert.equal(Media.shouldUpload(broken), false);
const lost = Media.stepItem(item, 'upload-fail');
assert.equal(lost.status, 'failed');
assert.equal(lost.mediaUrl, '');
assert.equal(Media.shouldUpload(lost), true);

async function runUpload() {
  const calls = [];
  const fake = async function (url, opts) {
    calls.push({ url: String(url), method: opts.method, body: opts.body });
    const u = String(url);
    if (u.indexOf('/b/') >= 0) return { ok: false, status: 500, json: async function () { return { error: 'broadcast' }; } };
    if (u.endsWith('/w/init')) return { ok: true, status: 200, json: async function () { return { key: 'w/alice/1.jpg', uploadId: 'u1' }; } };
    if (u.indexOf('/w/part') >= 0) return { ok: true, status: 200, json: async function () { return { etag: 'e', part: 1 }; } };
    if (u.endsWith('/w/complete')) return { ok: true, status: 200, json: async function () { return { url: 'https://up.example/o/w/alice/1.jpg', purpose: 'wireline' }; } };
    if (u.endsWith('/w/abort')) return { ok: true, status: 200, json: async function () { return { ok: true }; } };
    return { ok: false, status: 404, json: async function () { return {}; } };
  };
  const big = file('movie.mp4', 'video/mp4', 8 * 1024 * 1024 + 32);
  const plan = Media.classify(big, '');
  const deps = { fetch: fake, base: 'https://up.example', auth: { Authorization: 'Bearer t' } };
  const url = await Media.uploadOne(big, plan, null, deps);
  assert.equal(url, 'https://up.example/o/w/alice/1.jpg');
  assert.equal(calls.some(function (c) { return c.url.indexOf('/b/') >= 0; }), false);
  assert.ok(calls[0].url.endsWith('/w/init'));
  const initBody = JSON.parse(calls[0].body);
  assert.equal(initBody.kind, 'video');
  assert.equal(initBody.reachPass, undefined);
  assert.equal(calls.filter(function (c) { return c.url.indexOf('/w/part') >= 0; }).length, 2, 'a file over 8 MB is two parts, not one POST');
  calls.length = 0;
  fake.failPart = true;
  const fakeFail = async function (url, opts) {
    calls.push({ url: String(url), method: opts.method });
    const u = String(url);
    if (u.endsWith('/w/init')) return { ok: true, status: 200, json: async function () { return { key: 'w/alice/2.jpg', uploadId: 'u2' }; } };
    if (u.indexOf('/w/part') >= 0) return { ok: false, status: 500, json: async function () { return { error: 'Part 1 failed' }; } };
    if (u.endsWith('/w/abort')) return { ok: true, status: 200, json: async function () { return { ok: true }; } };
    return { ok: false, status: 404, json: async function () { return {}; } };
  };
  await assert.rejects(function () { return Media.uploadOne(file('a.jpg', 'image/jpeg', 20), photo, null, { fetch: fakeFail, base: 'https://up.example', auth: { Authorization: 'Bearer t' } }); });
  assert.ok(calls.some(function (c) { return c.url.endsWith('/w/abort'); }), 'a failed part aborts the session');
}
runUpload().then(function () {
  console.log('wireline-media: all checks passed');
}).catch(function (e) {
  console.error(e);
  process.exit(1);
});
