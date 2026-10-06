/* 07 Oct (b): Broadcast at first sight. The tab opens on what people made;
   every Broadcast says what it is (Watch / Read / Live, Luganda), who made
   it, views and age; a written Broadcast can be heard from the feed; one
   "+" for making; a tuner; "⋯" to say why and what you want. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const src = read('js/broadcast-glance.js');
const html = read('app/index.html');
const css = read('css/app.css');
const core = read('js/broadcast-core.js');
const ui = read('js/signal-ui.js');
const strand = read('js/strand.js');

/* 0. The website and the app are each in their own place (07a went up with
   the app page at the top of the site). */
assert.ok(/<title>Naluno — communication, creators and communities<\/title>/.test(read('index.html')), 'getnaluno.com is the website');
assert.ok(/<meta name="naluno-build"/.test(html) && !/<meta name="naluno-build"/.test(read('index.html')), 'the app page is in app/, not at the top');

/* 1. The module, run with a stand-in page. */
function load(opts) {
  opts = opts || {};
  const store = {};
  const listeners = {};
  const box = {
    console, Date, Math, JSON, String, Number, Object, Array, Promise, RegExp, setTimeout, clearTimeout,
    sessionStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } },
    navigator: { connection: opts.connection },
    requestAnimationFrame: (f) => f(),
    document: {
      readyState: 'loading',
      addEventListener: (t, f) => { (listeners[t] = listeners[t] || []).push(f); },
      getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
      body: { classList: { contains: () => false, add() {}, remove() {}, toggle() {} } },
      documentElement: { style: { setProperty() {} } },
    },
    formatNalunoViews: (n) => (n < 1000 ? String(n) : (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k'),
    currentUser: { uid: 'me' },
  };
  box.window = box;
  box.NalunoLgVoice = { looksLuganda: (t) => /\b(abantu|weebale|webale|jjajja|ebigambo|okuwandiika|tusanyuse|ensi)\b/i.test(t) };
  vm.createContext(box);
  vm.runInContext(src, box);
  return box;
}
const G = load().NalunoBcastGlance;
const now = Date.now();
const vid = { id: 'v', mediaType: 'video', title: 'Kampala at dawn', creatorUid: 'u1', views: 1240, createdAt: now - 3 * 3600e3 };
const lgRead = { id: 'r', mediaType: 'writing', title: 'Ebigambo bya Jjajja', body: 'Abantu bangi baagenda. Webale okuwandiika ku Naluno.', creatorUid: 'u2', views: 1, createdAt: { toMillis: () => now - 26 * 3600e3 } };
const enRead = { id: 'e', mediaType: 'writing', title: 'What I learned', body: 'The first café said no. So did the second.', creatorUid: 'u2', views: 0, createdAt: now - 60e3 };
const live = { id: 'l', mediaType: 'video', live: true, title: 'Friday jam', creatorUid: 'u1', views: 86, createdAt: now - 20 * 60e3 };
const hiddenViews = { id: 'h', mediaType: 'photo', title: 'x', creatorUid: 'u3', views: 50, shareViews: false, createdAt: now };

assert.strictEqual(G.kindOf(vid), 'watch');
assert.strictEqual(G.kindOf(lgRead), 'read');
assert.strictEqual(G.kindOf(live), 'live', 'live wins over video');
assert.strictEqual(G.kindOf({ mediaType: 'photo' }), 'watch', 'photos are things to look at');
assert.strictEqual(G.hasLuganda(lgRead), true, 'Luganda found in the writing');
assert.strictEqual(G.hasLuganda(enRead), false);
assert.strictEqual(G.ago(now - 3 * 3600e3), '3 h ago');
assert.strictEqual(G.ago({ toMillis: () => now - 26 * 3600e3 }), '1 day ago', 'Firestore times too');
assert.strictEqual(G.ago(Math.floor((now - 5 * 60e3) / 1000)), '5 min ago', 'seconds too');
assert.strictEqual(G.ago(0), '', 'no time, no label');
assert.strictEqual(G.views(vid), '1.2k views');
assert.strictEqual(G.views(lgRead), '1 view');
assert.strictEqual(G.views(hiddenViews), '', 'a creator who hides views is respected');
assert.strictEqual(G.views(Object.assign({}, hiddenViews, { creatorUid: 'me' })), '50 views', 'except to themselves');

const gv = G.glance(vid, {});
assert.ok(gv.kicker.includes('>Watch<') && !gv.listen, 'video: Watch, no Listen');
assert.ok(gv.stats.includes('1.2k views') && gv.stats.includes('3 h ago'), 'views and age');
assert.ok(gv.more.includes('data-glance-act="more"'), 'every Broadcast has ⋯');
const gr = G.glance(lgRead, { mins: 1 });
assert.ok(gr.kicker.includes('>Read<') && gr.kicker.includes('1 min') && gr.kicker.includes('Luganda'), 'Read · 1 min · Luganda');
assert.ok(gr.listen.includes('data-glance-act="listen"') && gr.listen.includes('Luganda voice'), 'Listen on the card, in the Luganda voice');
assert.ok(!G.glance(enRead, {}).listen.includes('Luganda voice'), 'English writing: plain Listen');
assert.ok(G.glance(live, {}).kicker.includes('Live now') && G.glance(live, {}).stats.includes('on air'));
assert.ok(!/<script|onerror=/i.test(G.glance({ id: 'x', title: '<img src=x onerror=alert(1)>', creatorUid: 'u' }, {}).kicker + G.glance({ id: 'x', creatorName: '"><script>', creatorUid: 'u' }, {}).stats), 'nothing a creator types becomes code');

/* The tuner */
const list = [vid, lgRead, enRead, live];
assert.deepStrictEqual(G.filter(list).map((b) => b.id), ['v', 'r', 'e', 'l'], 'All');
const order = (k) => { G.setKind(k); return G.filter(list).map((b) => b.id); };
assert.deepStrictEqual(order('watch'), ['v']);
assert.deepStrictEqual(order('read'), ['r', 'e']);
assert.deepStrictEqual(order('live'), ['l']);
assert.deepStrictEqual(order('lg'), ['r']);
assert.deepStrictEqual(order('nonsense'), ['v', 'r', 'e', 'l'], 'an unknown choice is All');

/* Data: previews wait when the phone saves data */
assert.strictEqual(load({ connection: { saveData: true, effectiveType: '4g' } }).nalunoPreviewsAllowed(), false, 'Data Saver');
assert.strictEqual(load({ connection: { saveData: false, effectiveType: '3g' } }).nalunoPreviewsAllowed(), false, 'slow 3G');
assert.strictEqual(load({ connection: { saveData: false, effectiveType: 'slow-2g' } }).nalunoPreviewsAllowed(), false, 'slow 2G');
assert.strictEqual(load({ connection: { saveData: false, effectiveType: '4g' } }).nalunoPreviewsAllowed(), true, '4G / Wi-Fi play');
assert.strictEqual(load({}).nalunoPreviewsAllowed(), true, 'unknown (iPhone): as before');
assert.ok(!/\(\?<[=!]/.test(src), 'no look-behind (older iPhones)');

/* 2. Wiring into what exists (nothing replaced) */
assert.ok(core.includes("(typeof nalunoPlateGlance === 'function') ? nalunoPlateGlance(b, { writing: writing, mins: mins, cover: cover }) : null"), 'plates use it when present');
assert.ok(core.includes('data-known-uid="${escapeHtml(b.creatorUid || \'\')}"'), 'the Known mark still paints on the creator');
assert.ok(/strand-preview" muted playsinline/.test(core), 'muted, inline previews unchanged');
assert.ok(ui.includes("list = window.nalunoBcastKindFilter(list);"), 'tuner filters the feed');
assert.ok(ui.includes("document.body.classList.toggle('naluno-bcast-foryou', view !== 'mine' && !togaOn);"), 'For You is marked');
assert.ok(ui.includes("if(typeof window.nalunoPreviewsAllowed === 'function' && !window.nalunoPreviewsAllowed()) return;"), 'tap-anywhere play respects data saving');
assert.ok(strand.includes("if(typeof window.nalunoPreviewsAllowed === 'function' && !window.nalunoPreviewsAllowed()) return;"), 'autoplay respects data saving');
assert.ok(ui.includes('compactHead') && ui.includes('(head.getBoundingClientRect().bottom - origin) < (h * 0.55)'), 'the old full-screen head behaviour is kept for other views');
/* The "+" sheet presses the existing buttons. */
['newBroadcastBtn', 'broadcastWriteBtn', 'broadcastGoLiveBtn', 'newSignalBtn', 'airShareBtn', 'airEditBtn'].forEach((id) => {
  assert.ok(src.includes("'" + id + "'"), 'sheet uses #' + id);
  assert.ok(html.includes('id="' + id + '"'), '#' + id + ' still in the page');
});
assert.ok(src.includes("bspaceSpeakWriting(text, b.lang === 'lg' ? 'lg' : '', label)"), 'Listen on the card is the same Listen as in the room');
assert.ok(src.includes("NalunoDiscover.note(act, id)"), '⋯ tells the existing ranking');
assert.ok(html.includes('id="bcastMakeBtn"') && html.includes('id="bcastTune"'), '+ and the tuner are in the page');
assert.ok(/\/js\/broadcast-glance\.js\?v=2026100[7-9][b-z]/.test(html) && read('sw.js').includes("'/js/broadcast-glance.js'"), 'loaded, and kept for offline');

/* 3. Looks: only for For You, never the floating window or other views */
const blk = css.slice(css.indexOf('07b: Broadcast at first sight'));
assert.ok(blk.includes('body.naluno-bcast-foryou:not(.naluno-strand-open):not(.naluno-bcast-channel) .bcast-tune{ display:flex; }'), 'tuner only on For You');
assert.ok(blk.includes('body.naluno-bcast-foryou #bcastForYouHome > .air-make'), 'making goes behind + on For You only');
assert.ok(blk.includes('calc(var(--bcast-stage-h, 100svh) - var(--bcast-head-h, 0px))'), 'the first Broadcast fits under the Signals row');
assert.ok(blk.includes('@media (max-width: 480px)'), 'narrow phones keep one line of tabs');

/* 4. Stamps */
['broadcast-core.js', 'strand.js', 'signal-ui.js'].forEach((f) => assert.ok(new RegExp('/js/' + f.replace('.', '\\.') + '\\?v=2026100[7-9][b-z]').test(html), f + ' stamp'));
assert.ok(/\/css\/app\.css\?v=2026100[7-9][b-z]/.test(html), 'app.css stamp');
assert.ok(/APP_BUILD = '2026100[7-9][b-z]'/.test(read('sw.js')) && /register\('\/sw\.js\?v=2026100[7-9][b-z]'/.test(read('js/pwa.js')), 'service worker');

/* 5. From the independent review */
assert.ok(src.includes('resetButton(state.btn, state.label);'), 'a card always goes back to Listen when the voice ends or another takes over');
assert.ok(src.includes('wrapped.__glance = true;') && src.includes('stopCardListen(); return prevOpen.apply(this, arguments);'), 'opening a Broadcast stops a card that is reading');
assert.ok(src.includes("root: inFeed ? sc : null"), 'search results are watched against the screen (Listen works there)');
assert.ok(src.includes('function follow()') && src.includes("new MutationObserver(function () { follow(); landscapeWatch(); }).observe(grid, { childList: true })"), 'a feed redraw keeps the reading on the new card');
assert.ok(/\.bcast-sheet\{[\s\S]*?z-index:270;/.test(blk) && 270 < 280, 'sheets sit under composers, calls, toasts and the sign-in gate');
assert.ok(blk.includes(':not(.naluno-bcast-headless) #bcastPlateGrid > .bcast-plate:first-child') && blk.includes('body.naluno-bcast-headless .bcast-feed-head{ display:none !important; }'), 'landscape on the first Broadcast gets the whole screen');
assert.ok(blk.includes(':not(.naluno-bcast-channel) .bcast-tune') && src.includes("(onChannel() ? '' :"), 'no tuner or Describe on someone else\'s channel');
assert.ok(blk.includes('#bcastSearchResults .bcast-read-card{') && blk.includes('#bcastPlateGrid .bcast-plate.has-glance .bcast-plate-meta{'), 'search cards stay compact');
assert.ok(blk.includes('#airMine:not([hidden])'), 'your own editor only where it belongs');
console.log('fixes-1007b tests passed');
