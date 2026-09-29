/* 29g: sheets over the Broadcast, ads that kept stopping, Band wipe, the
   Known mark on every name, Toga views counted by the worker, live plates,
   and the pay flow. Browser checks cover the screens; these pin the logic. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const read = (f) => fs.readFileSync(path.join(__dirname, f), 'utf8');
function extractFn(src, name){
  const start = src.indexOf('function ' + name + '(');
  assert.ok(start >= 0, 'found ' + name);
  let i = src.indexOf('{', start), depth = 0;
  for(; i < src.length; i++){
    if(src[i] === '{') depth++;
    else if(src[i] === '}'){ depth--; if(depth === 0) return src.slice(start, i + 1); }
  }
  throw new Error('unbalanced ' + name);
}

/* 1. Sheets opened from a screen are lifted above it. */
{
  const core = read('core.js');
  assert.ok(core.includes("const NALUNO_LAYER_OPEN = '.call-overlay.active, #bspace.active"), 'layer helper present');
  const ctx = { Math, parseInt, String };
  const layers = [];
  const mk = (id, z, active) => {
    const e = { id, _z: z, style: { props: {}, setProperty(k, v){ this.props[k] = v; e._z = Number(v); }, removeProperty(k){ delete this.props[k]; e._z = z; } },
      dataset: {}, classList: { contains: (c) => c === 'active' ? e.active : false }, active };
    layers.push(e); return e;
  };
  const bspace = mk('bspace', 180, true);
  const sheet = mk('supportSheet', 120, true);
  const call = mk('callOverlay', 300, false);
  ctx.document = { querySelectorAll: () => ({ forEach: (fn) => layers.filter((l) => l.active).forEach(fn) }) };
  ctx.getComputedStyle = (e) => ({ zIndex: String(e._z), display: 'block', visibility: 'visible' });
  vm.createContext(ctx);
  vm.runInContext(['const NALUNO_LAYER_SKIP = { callOverlay: 1, authGate: 1, wirelineThread: 1, bandRoom: 1 };',
    "const NALUNO_LAYER_OPEN = 'x';", extractFn(core, 'nalunoLayerTop'), extractFn(core, 'nalunoLiftSheet'), 'this.lift = nalunoLiftSheet;'].join('\n'), ctx);
  ctx.lift(sheet);
  assert.strictEqual(sheet._z, 181, 'Support sheet goes above the Broadcast (was 120 under 180)');
  sheet.active = false; ctx.lift(sheet);
  assert.strictEqual(sheet._z, 120, 'back to its own level when closed');
  call.active = true; ctx.lift(call);
  assert.strictEqual(call._z, 300, 'the call screen is never touched');
  // a stack of 300+ open layers still stays under the call screen
  mk('x', 298, true); sheet.active = true; ctx.lift(sheet);
  assert.ok(sheet._z <= 299, 'stays under an incoming call');
}

/* 2. The full-screen ad is not paused by the keep-alive watchdog. */
{
  const mc = read('media-contain.js');
  const ctx = { getComputedStyle: () => ({ display: 'flex' }) };
  vm.createContext(ctx);
  vm.runInContext([extractFn(mc, 'nalunoAdSurface'), 'function nalunoActiveViewerContains(){ return false; }', extractFn(mc, 'nalunoMediaMayKeepAlive'), 'this.may = nalunoMediaMayKeepAlive;'].join('\n'), ctx);
  const viewer = { classList: { contains: () => false } };
  const ad = { id: 'nalunoAdVideo', isConnected: true, dataset: { nalunoWantPlay: '1', nalunoUserPaused: '0' }, classList: { contains: () => false }, closest: () => viewer };
  assert.strictEqual(ctx.may(ad), true, 'an ad on screen may keep playing (it was paused within 2 s)');
  viewer.classList.contains = (c) => c === 'hidden';
  assert.strictEqual(ctx.may(ad), false, 'a closed ad viewer may not');
  const other = { id: 'v', dataset: { nalunoWantPlay: '1' }, classList: { contains: () => false }, closest: () => null };
  assert.strictEqual(ctx.may(other), false, 'other stray videos are still paused');
  const bs = read('broadcast-space.js');
  assert.ok(bs.includes('showBreatherAdSlot(m, null);'), 'a mid-roll with no ad resumes the Broadcast');
}

/* 3. Band: a conversation past its 2 h is wiped, including the newest message. */
{
  const br = read('band-room.js');
  const stamps = [];
  const ctx = { BAND_SETTLE_MS: 7200000, realBandLiveMembers: [], amTunedIn: false, Date, Math,
    bandMsgTs: (m) => m.ts, bandNewestMessageMs: (b) => b._newest, bandEmptiedMs: (b) => b.lastEmptiedAt || 0,
    bandSettleElapsed: (b) => !!b.lastEmptiedAt && Date.now() - b.lastEmptiedAt >= 7200000, bandIsSettled: () => false,
    stampBandEmpty: (ref, b, at) => stamps.push(at), pruneSettledBandMessages: () => {}, firebase: { firestore: { Timestamp: { fromMillis: (x) => x } } } };
  vm.createContext(ctx);
  vm.runInContext([extractFn(br, 'bandNobodyHere'), extractFn(br, 'bandConversationExpired'), extractFn(br, 'bandWipeIfStale'), 'this.expired = bandConversationExpired; this.wipe = bandWipeIfStale;'].join('\n'), ctx);
  const old = Date.now() - 3 * 3600000;
  const b = { isReal: true, _presenceSeen: true, _newest: old };
  assert.strictEqual(ctx.expired(b, [{ ts: old }]), true, 'a 3 h old chat with nobody here is not shown');
  assert.strictEqual(ctx.expired(Object.assign({}, b, { _presenceSeen: false }), [{ ts: old }]), true, 'not shown while presence loads either');
  ctx.realBandLiveMembers = [{ uid: 'x' }];
  assert.strictEqual(ctx.expired(b, [{ ts: old }]), false, 'people here: the chat stays');
  ctx.realBandLiveMembers = [];
  assert.strictEqual(ctx.expired(b, [{ ts: Date.now() - 60000 }]), false, 'a recent chat stays');
  ctx.wipe({}, b);
  assert.strictEqual(stamps[0], old + 1, 'the leave is stamped just after the newest message, so the wipe deletes it too');
}

/* 4. Known mark: every name spot is tagged, and lookups are cached. */
{
  const want = [
    ['signal-ui.js', 'class="contact-name" data-known-uid='],
    ['signal-ui.js', "$('bviewerName').setAttribute('data-known-uid'"],
    ['signal-social.js', 'sv-name\" data-known-uid='],
    ['wireline.js', "$('threadName').setAttribute('data-known-uid'"],
    ['wireline.js', 'class="contact-name" data-known-uid='],
    ['calls.js', "['incomingName', 'remoteName'].forEach"],
    ['calls.js', "['ringName', 'remoteName'].forEach"],
    ['band-room.js', 'data-known-uid="${escapeHtml(String(knownUid))}"'],
    ['find.js', 'data-known-uid="${escapeHtml(String(theirUid'],
    ['spark-page.js', "$('sparkPageName').setAttribute('data-known-uid'"],
    ['broadcast-space.js', 'function bspaceWhoHtml(uid)'],
    ['circle.js', 'class="circle-member-name" data-known-uid='],
    ['profile.js', "$('viewName').setAttribute('data-known-uid'"],
  ];
  want.forEach(([f, s]) => assert.ok(read(f).includes(s), f + ' tags the name: ' + s));
  const K = require('./known.js');
  let reads = 0;
  global.fbDb = { collection: (c) => ({ doc: (id) => ({ get: () => { reads++;
    if (c === 'knownPublic') return Promise.resolve({ exists: id === 'star', data: () => ({ until: Date.now() + 1e9, name: 'S', note: 'n' }) });
    return Promise.reject(new Error('permission-denied')); } }) }) };
  return Promise.all([K.lookup('star'), K.lookup('plain')]).then(([a, b]) => {
    assert.strictEqual(a, true); assert.strictEqual(b, false);
    const n = reads;
    return Promise.all([K.lookup('star'), K.lookup('plain')]).then(() => {
      assert.strictEqual(reads, n, 'known and not-known answers are cached (no read storm from a list of names)');
      delete global.fbDb;
      rest();
    });
  }).catch((e) => { console.error(e); process.exit(1); });
}
function rest(){
  /* 5. Views: the worker decides; the phone only reports. */
  const c = read('circle.js');
  assert.ok(c.includes("viewCall('open', broadcastId)"), 'opening a Broadcast tells the worker');
  assert.ok(c.includes("serverCountView(broadcastId, creatorUid, 0)"), 'the count is asked of the worker');
  assert.ok(c.includes("if(r.status === 400 || r.status === 401 || r.status === 403){ mode = 'off'; return; }"), 'a refused view is not counted by the phone');
  assert.ok(!/seconds >= 4\)/.test(c), 'no hard-coded 4 s threshold in the app');
  assert.ok(c.includes("togaLiveSnap || await fbDb.collection('toga')"), 'Toga redraws from its live snapshot');
  assert.ok(c.includes('Toga points'), 'the big number is labelled');
  assert.ok(read('admin-console.js').includes("collection('economyConfig').doc('viewRules')"), 'console sets the seconds');
  assert.ok(read('broadcast-space.js').includes('function bspaceShowViewsNow('), 'Broadcast view numbers update live');

  /* 6. Live plates. */
  const core = read('broadcast-core.js');
  assert.ok(core.includes('data-live="1" data-creator-uid='), 'live plates are marked for the preview');
  const lp = read('live-preview.js');
  assert.ok(lp.includes("collection('livePreview').doc('frame')"));
  assert.ok(lp.includes("d.from !== creator"), 'only the creator\'s frames are shown');
  assert.ok(read('broadcast-live.js').includes('nalunoLivePreviewStart(activeBroadcastId, stream)'));

  /* 7. Pay flow. */
  const eu = read('economy-ui.js');
  assert.ok(eu.includes('function nalunoHandlePayReturn('), 'Stripe return is handled');
  assert.ok(eu.includes("openBroadcastById(bid)"), 'and goes back to the Broadcast');
  assert.ok(read('ads.js').includes("document.getElementById('crAdPayMsg')"), 'ad pay messages show on the pay panel');
  const html = read('../app/index.html');
  assert.ok(html.includes('id="crAdPayMsg"'));

  /* 8. Stamps. */
  ['core.js', 'known.js', 'circle.js', 'economy-ui.js', 'ads.js', 'band-room.js', 'media-contain.js', 'live-preview.js', 'broadcast-core.js', 'broadcast-space.js']
    .forEach((f) => {
      const m = html.match(new RegExp('/js/' + f.replace('.', '\\.') + '\\?v=(\\d{8}[a-z])'));
      assert.ok(m && m[1] >= '20260929g', f + ' stamp bumped');
    });
  const sw = read('../sw.js');
  assert.ok(sw.includes("'/js/live-preview.js'"), 'new file is in the offline shell');
  console.log('fixes-29g tests passed');
}
