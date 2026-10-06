/* 07 Oct (c): the freeze (invisible call buttons catching taps), the
   sign-in workflow, the Broadcast tab (+, private box, Signal tile, tap to
   play, swipe on), Luganda in Write, Wireline links, public Signals. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const css = read('css/app.css');
const html = read('app/index.html');

/* 1. The freeze: with no call on screen, nothing in the call screen may
   take taps. Every rule that switches taps on inside #callOverlay must be
   tied to an active call. */
{
  const lines = css.split('\n');
  const bad = [];
  let sel = '';
  lines.forEach((l) => {
    if (l.includes('{')) sel = l.slice(0, l.indexOf('{'));
    const on = /pointer-events:\s*auto/.test(l);
    if (on && /#callOverlay|\.callscreen|#incall|#lobby|#ringing|#incoming/.test(sel) && !/\.active/.test(sel)) bad.push(sel.trim());
  });
  assert.deepStrictEqual(bad, [], 'call-screen rules that take taps without an active call: ' + bad.join(' | '));
  assert.ok(css.includes('body:not(.naluno-os-pip) #callOverlay.active #incall.active .incall-top > *{ pointer-events:auto; }'), 'the in-call buttons work during a call');
}

/* 2. The workflow: init.json is optional (404 for this project). */
{
  const wf = read('.github/workflows/firebase-auth-helper.yml');
  assert.ok(wf.includes('optional __/firebase/init.json') && !/curl -fsSL --retry 3 "\$base\/__\/firebase\/init\.json"/.test(wf), 'init.json no longer fails the run');
  assert.ok(wf.includes('actions/checkout@v5'), 'Node 24 checkout');
  const auth = read('js/auth.js');
  assert.ok(auth.includes(": true; }, function(){ return true; });"), 'the app does not wait for init.json');
}

/* 3. Broadcast tab */
{
  const blk = css.slice(css.indexOf('/* ===================== 07c ====================='));
  assert.ok(blk.includes('.bcast-make-btn{\n  position:sticky; right:0;'), '+ stays on screen');
  assert.ok(blk.includes('.bcast-view-tabs{ overflow-x:auto;'), 'tabs may scroll under it');
  assert.ok(!css.includes('.bcast-plate.is-moving .bcast-tap-play{ opacity:0'), 'tap to play stays');
  assert.ok(blk.includes('body:not(.naluno-bcast-mine) #bcastScheduleDock'), 'the private box is not on For You');
  assert.ok(html.indexOf('id="bcastScheduleDock"') > html.indexOf('id="bcastPrivateDrawer"') && html.indexOf('id="bcastScheduleDock"') < html.indexOf('id="bcastSearchRow"'), 'it sits under Private broadcasts');
  assert.ok(blk.includes('#myBcastStrip .signal-tile .signal-window{ width:78px; height:104px;'), 'smaller Signal tile');
  const ui = read('js/signal-ui.js');
  assert.ok(ui.includes("box.innerHTML = '<p class=\"lobby-sub\"") && ui.includes('titleEl.onclick'), 'Private broadcasts shows Edit; a title opens it');
}

/* 4. Past Nearby Broadcasts: the next one */
{
  const sp = read('js/broadcast-space.js');
  const fn = sp.slice(sp.indexOf('function nalunoFeedNextId'), sp.indexOf('window.nalunoFeedNextId'));
  const grid = { children: [
    { getAttribute: (k) => (k === 'data-broadcast-id' ? 'a' : null) },
    { getAttribute: (k) => (k === 'data-strand-id' ? 's1' : null) },
    { getAttribute: (k) => (k === 'data-broadcast-id' ? 'c' : null) },
  ] };
  const box = {
    document: { getElementById: (id) => (id === 'bcastPlateGrid' ? grid : null) },
    feedBroadcasts: [{ id: 'a', createdAt: 1 }, { id: 's1a', strandId: 's1', createdAt: 2 }, { id: 's1b', strandId: 's1', createdAt: 3 }, { id: 'c', createdAt: 4 }, { id: 'z', createdAt: 9 }],
    myBroadcasts: [],
    nalunoStrandSiblingsFor: (id) => (id === 's1a' ? { index: 0, items: [{ id: 's1a' }, { id: 's1b' }] } : (id === 's1b' ? { index: 1, items: [{ id: 's1a' }, { id: 's1b' }] } : { index: -1, items: [] })),
    Array, Number,
  };
  vm.createContext(box);
  vm.runInContext(fn + '\nthis.next = nalunoFeedNextId;', box);
  assert.strictEqual(box.next('a'), 's1a', 'the feed order: a Strand opens at its first part');
  assert.strictEqual(box.next('s1a'), 's1b', 'inside a Strand: the next part');
  assert.strictEqual(box.next('s1b'), 'c', 'after the Strand: the next card');
  assert.strictEqual(box.next('c'), 'z', 'past the end of the feed: the newest other one');
  assert.strictEqual(box.next('zz'), 'a', 'opened from a link: the feed from the top');
  assert.ok(html.includes('id="bspaceNextCue"') && sp.includes("if(dy < -70 && Math.abs(dy) > Math.abs(dx) * 1.4"), 'swipe up at the bottom, or tap the cue');
}

/* 5. Write → Luganda */
{
  assert.ok(html.includes('id="bwriteLuganda"') && /bwrite-opt-pair[\s\S]{0,400}bwriteChaptered[\s\S]{0,400}bwriteLuganda/.test(html), 'Luganda box next to chapters');
  const comp = read('js/broadcast-composer.js');
  assert.ok(comp.includes("window.__bcompLuganda = !!($('bwriteLuganda') && $('bwriteLuganda').checked);") && comp.includes("lang: snapLuganda ? 'lg' : null,"), 'saved as lang lg');
  const core = read('js/broadcast-core.js');
  assert.ok(core.includes("lang: lang === 'lg' ? 'lg' : null,"), 'stored on the Broadcast');
  assert.ok(read('js/broadcast-glance.js').includes("if (b.lang === 'lg') return true;"), 'it is under the Luganda tuner');
  assert.ok(read('js/broadcast-space.js').includes("const marked = (activeBroadcastMeta && activeBroadcastMeta.lang === 'lg') ? 'lg' : '';"), 'Listen reads it as Luganda');
}

/* 6. Wireline links */
{
  const w = read('js/wireline.js');
  const fn = w.slice(w.indexOf('function wireLinkify('), w.indexOf('/* Open a link from a message'));
  const box = { escapeHtml: (s) => String(s).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m])) };
  vm.createContext(box);
  vm.runInContext(fn + '\nthis.L = wireLinkify;', box);
  const L = box.L;
  assert.ok(L('open getnaluno.com/app/?broadcast=abc now').includes('href="https://getnaluno.com/app/?broadcast=abc" data-naluno-link="1"'), 'a plain Naluno address is a link');
  assert.ok(L('youtube.com/watch?v=x').includes('href="https://youtube.com/watch?v=x"'), 'a plain address is a link');
  assert.ok(L('https://a.com/?x=1&y=2').includes('href="https://a.com/?x=1&amp;y=2"'), '& kept, escaped');
  assert.ok(!L('mail joe@site.com').includes('<a'), 'e-mail addresses stay text');
  assert.ok(!L('notes.txt v1.2').includes('<a'), 'file names stay text');
  assert.ok(!L('foo.community my.application').includes('<a') && !L('jane.co@gmail.com').includes('<a'), 'no half-links');
  assert.ok(L("en.wikipedia.org/wiki/O'Brien").includes('href="https://en.wikipedia.org/wiki/O&#39;Brien"'), 'escaped once: the link is right');
  assert.ok(L('"https://b.com/x"').includes('href="https://b.com/x"'), 'quotes around a link are not part of it');
  assert.ok(w.includes("w = window.open(u.href, '_blank');") && w.includes('w.opener = null'), 'opens once');
  assert.ok(!L('pornhub.com').includes('<a'), 'adult sites stay text');
  const nasty = L('<img src=x onerror=alert(1)> javascript:alert(1) "><script>');
  assert.ok(!nasty.includes('<img') && !nasty.includes('<script') && !nasty.includes('href="javascript'), 'nothing becomes code');
  assert.ok(w.includes("Capacitor.Plugins.Browser") && w.includes("window.open(u.href, '_system')"), 'opens from the Android app');
  assert.ok(w.includes("const b = u.searchParams.get('broadcast') || u.searchParams.get('b');") && w.includes('openBroadcastById(b);'), 'Naluno links open inside Naluno');
  assert.ok(read('js/gestures.js').includes('a.wire-link, a.naluno-link'), 'swipe-to-reply leaves links alone');
}

/* 7. Public Signals */
{
  const src = read('js/signal-public.js');
  const box = { window: {}, setInterval() {}, document: {}, Date, Math, JSON, String, Number, Object, Array, isFinite, currentUser: { uid: 'me' }, contacts: [{ firebaseUid: 'friend' }] };
  box.window = box;
  vm.createContext(box);
  vm.runInContext(src, box);
  const P = box.NalunoPublicSignals;
  const now = Date.now();
  const doc = (o) => Object.assign({ public: true, hidden: false, held: false, createdAt: now - 1000, expiresAt: now + 3600e3, type: 'photo', photoUrl: 'https://x/p.jpg' }, o);
  const g = P._group([doc({ id: '1', uid: 'u1', name: 'A' }), doc({ id: '2', uid: 'me' }), doc({ id: '3', uid: 'friend' }), doc({ id: '4', uid: 'u2', expiresAt: now - 1 }), doc({ id: '5', uid: 'u3', hidden: true }), doc({ id: '6', uid: 'u4', held: true }), doc({ id: '7', uid: 'u5', public: false }), doc({ id: '8', uid: 'u1', createdAt: now - 500 })]);
  assert.deepStrictEqual(g.map((r) => r.uid), ['u1'], 'only strangers\' live, public, unheld, not-removed Signals');
  assert.strictEqual(g[0].segs.length, 2, 'all of a person\'s public Signals, in order');
  assert.strictEqual(P._safeColour('url(https://evil/x)'), false);
  assert.strictEqual(P._safeColour('linear-gradient(165deg,#141a16,#0d1018)'), true);
  assert.ok(!('bg' in P._segFrom({ id: 'x', type: 'text', text: 'hi', bg: 'red;background:url(x)' })), 'a stranger\'s card colour cannot load anything');
  assert.ok(src.includes(".where('public', '==', true)") && src.includes(".where('hidden', '==', false)") && src.includes(".where('held', '==', false)") && src.includes(".where('expiresAt', '>', Date.now() + 300000)") && src.includes(".orderBy('expiresAt', 'desc')"), 'the query matches the rule, newest first');
  const idx = JSON.parse(read('firestore.indexes.json')).indexes.find((i) => i.collectionGroup === 'signals');
  assert.ok(idx && idx.fields.map((f) => f.fieldPath).join(',') === 'public,hidden,held,expiresAt', 'its index');
  const rules = read('firestore.rules');
  const m = rules.slice(rules.indexOf('match /signals/{id} {'), rules.indexOf('match /users/{uid}/wirelineClears'));
  assert.ok(m.includes('resource.data.public == true') && m.includes('resource.data.hidden == false && resource.data.held == false') && m.includes('resource.data.expiresAt > request.time.toMillis()'), 'rule: public, not removed, not held, not expired');
  assert.ok(m.includes("request.resource.data.get('held', false) == false") && m.includes('request.resource.data.expiresAt <= request.time.toMillis() + 90000000'), 'rule: a public copy is unheld and lives at most 25 hours');
  assert.ok(m.includes("affectedKeys().hasOnly(['public'])") && m.includes('request.resource.data.public == false'), 'rule: a creator can only take theirs out of the public list, never undo the desk');
  const core = read('js/signal-core.js');
  assert.ok(core.includes('mirror.public = !!(clean.public && !clean.held);') && core.includes('mirror.hidden = false;'), 'the copy says so');
  const comp = read('js/compass.js');
  assert.ok(comp.includes("public: !!(wantPublic && !segToSave.held && (segToSave.type === 'text' || canScreen))"), 'public only when chosen and Screen passed it (and Screen is there)');
  assert.ok(comp.includes("return v === 'public' ? 'public' : 'connections';") && comp.includes("if(composerMode === 'signal'){ try{ nalunoPaintSignalAudience(true); }catch(_){} }"), 'public only once the choice has been seen');
  assert.ok(core.includes("currentProfile.name) ? String(currentProfile.name).slice(0, 80)"), 'the Naluno name, not the Google name');
  assert.ok(html.includes('data-aud="public"') && html.includes('data-aud="connections"'), 'the choice in the Signal maker');
  assert.ok(read('js/signal-ui.js').includes('NalunoPublicSignals.tilesHtml()'), 'shown after your connections');
}

/* 8. Stamps */
['signal-ui.js', 'broadcast-space.js', 'broadcast-core.js', 'broadcast-composer.js', 'wireline.js', 'gestures.js', 'compass.js', 'signal-core.js', 'auth.js', 'pwa.js', 'broadcast-glance.js', 'signal-public.js'].forEach((f) => {
  assert.ok(new RegExp('/js/' + f.replace(/[.-]/g, '\\$&') + '\\?v=20261007c').test(html), f + ' stamp');
});
assert.ok(/\/css\/app\.css\?v=20261007c/.test(html) && /APP_BUILD = '20261007c'/.test(read('sw.js')), 'css and service worker');
console.log('fixes-1007c tests passed');
