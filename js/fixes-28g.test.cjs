/* 2026-09-28g: Band vibe, hidden notes in vibes, private previews, Why this. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const nalunoAtLeast = (v, min) => (v || '') >= min;
const swBuild = (s) => (s.match(/APP_BUILD = '(\d{8}[a-z])'/) || [])[1];
const swCache = (s) => Number((s.match(/'naluno-shell-v(\d+)'/) || [])[1] || 0);
const appVer = (h) => (h.match(/<meta name="app-version" content="(\d{4}\.\d{2}\.\d{2}[a-z])">/) || [])[1];
const read = (f) => fs.readFileSync(path.join(__dirname, f), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '../app/index.html'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '../css/app.css'), 'utf8');
const sw = fs.readFileSync(path.join(__dirname, '../sw.js'), 'utf8');
const wire = read('wireline.js');
const mail = read('wire-mailbox.js');
const bandList = read('band-list.js');
const bandRoom = read('band-room.js');
const camera = read('camera.js');

/* Band: every vibe a creator can pick has a card colour, so members see it. */
const vibes = [];
camera.replace(/(\w+):\s*\{ name:'[^']+',\s*type:'canvas'/g, (m, k) => { vibes.push(k); return m; });
assert.ok(vibes.length >= 7, 'found the Band vibes: ' + vibes.join(','));
vibes.forEach((v) => assert.ok(new RegExp('\\n\\s*' + v + ':\\s*\'linear-gradient').test(bandList), 'card colour for vibe ' + v));
assert.ok(bandList.includes("$('bandVibeChipRow').querySelectorAll('[data-vibe]')"), 'vibe chips no longer catch Wireline moods');
assert.ok(bandRoom.includes('if(b.vibe && b.vibe !== vibeBefore)') && bandRoom.includes('startBandAmbientAnim(b.vibe);'), 'room repaints when the vibe arrives');

/* Hidden notes: 7 feelings x 365, unique, carried by number only. */
const data = JSON.parse(read('mood-notes.json'));
const moods = [];
wire.replace(/\{ key:'(\w+)',\s+label:'[^']+',\s*vibe:'\w+' \}/g, (m, k) => { moods.push(k); return m; });
assert.strictEqual(moods.length, 7, 'seven feelings');
const all = new Set();
moods.forEach((k) => {
  const list = data.notes[k];
  assert.ok(Array.isArray(list) && list.length === 365, k + ' has 365 notes');
  assert.strictEqual(new Set(list).size, 365, k + ' notes are all different');
  list.forEach((t) => { assert.ok(typeof t === 'string' && t.length >= 30 && t.length <= 150, k + ' length'); assert.ok(!all.has(t), 'shared note: ' + t); all.add(t); });
});
assert.ok(wire.includes("sendRealMessage(c, { type:'mood', mood: moodKey, moodNote: moodNotePick(moodKey) }"), 'a vibe carries its note number');
assert.ok(mail.includes("'mood', 'moodNote',") && (mail.match(/moodNote: \(m\.moodNote != null \? m\.moodNote : null\)/g) || []).length === 2, 'mailbox keeps the note number');
assert.ok((wire.match(/moodNote: \(payload\.moodNote != null \? payload\.moodNote : null\)/g) || []).length === 2, 'local rows keep the note number');
assert.ok(wire.includes("escapeHtml(text)") && wire.includes('data-mood-reveal='), 'note hidden until tapped, and escaped');
assert.ok(sw.includes("'/js/mood-notes.json'") && wire.includes("fetch('/js/mood-notes.json?v="), 'notes load on demand and work offline');
assert.ok(!html.includes('mood-notes.json'), 'notes are not loaded at start-up');

/* Run the real picker: no repeats inside a cycle, starts from today, restarts after 365. */
const start = wire.indexOf('const MOOD_NOTE_DAYS');
const end = wire.indexOf('function moodNoteRevealKey');
const store = {};
const ctx = { localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } }, currentUser: { uid: 'u1' }, fetch: () => Promise.reject(new Error('no')), Date, Math, Number, JSON, Array, Set };
vm.createContext(ctx);
vm.runInContext(wire.slice(start, end) + '\nthis.pick = moodNotePick; this.day = moodDayIndex; this.idxOf = moodNoteIndexOf;', ctx);
const t0 = new Date(2026, 8, 28, 10).getTime();
assert.strictEqual(ctx.day(t0), 270, 'day index of 28 Sep');
const first = ctx.pick('calm', t0);
assert.strictEqual(first, 270, "starts from today's note");
const seen = new Set([first]);
for (let i = 1; i < 365; i++) { const n = ctx.pick('calm', t0 + i * 3600e3); assert.ok(!seen.has(n), 'no repeat within a cycle (' + i + ')'); seen.add(n); }
assert.strictEqual(seen.size, 365, 'all 365 used once');
const again = ctx.pick('calm', t0);
assert.strictEqual(again, 270, 'a new cycle starts after all 365');
assert.strictEqual(ctx.pick('wonder', t0), 270, 'each feeling has its own cycle');
assert.strictEqual(ctx.idxOf({ moodNote: 12 }), 12);
assert.strictEqual(ctx.idxOf({ moodNote: null, ts: t0 }), 270, 'older vibes show the note of their day');
assert.strictEqual(ctx.idxOf({ moodNote: 999, ts: t0 }), 270, 'bad number falls back safely');
assert.strictEqual(ctx.day(new Date(2028, 11, 31).getTime()), 364, 'leap-year 31 Dec stays in range');
store['naluno:moodNotes:u1'] = 'not json';
assert.ok(Number.isInteger(ctx.pick('calm', t0)), 'survives a damaged book');

/* Private broadcasts: preview rows, owner only. */
const ui = read('signal-ui.js');
assert.ok(ui.includes('class="bcast-private-row dl-row"') && ui.includes('bcast-private-tile'), 'private rows have a preview');
assert.ok(/const mine = \(typeof myBroadcasts !== 'undefined' && myBroadcasts\) \? myBroadcasts : \[\];\s*const rows = mine\.filter/.test(ui), 'built only from your own Broadcasts');

/* Why this + menu fit. */
const disc = read('discover.js');
assert.ok(disc.includes("'<':'&lt;'") && !disc.includes("{'&':'&','<':'<'"), 'Why this is escaped');
assert.ok(css.includes('@media (orientation: landscape) and (max-height: 520px){\n  .bspace-more-menu{ align-items:center;'), 'menu fits a phone turned sideways');
assert.ok(read('compass.js').includes("$('filmstrip').querySelectorAll('[data-remove]')"), 'filmstrip does not take over Saved Remove buttons');
const admin = read('admin-console.js');
assert.ok(admin.includes(".replace(/&lt;/g, '<')") && !admin.includes(".replace(/&/g, '&')"), 'console cell text decodes entities');

['css/app.css', 'js/band-list.js', 'js/band-room.js', 'js/wireline.js', 'js/wire-mailbox.js', 'js/gestures.js', 'js/signal-ui.js', 'js/discover.js', 'js/compass.js'].forEach((f) => assert.ok(((html.match(new RegExp('/' + f.replace(/\./g, '\\.') + '\\?v=(\\d{8}[a-z])')) || [])[1] || '') >= '20260928g', 'stamp ' + f));
assert.ok(swCache(sw) >= 235 && nalunoAtLeast(swBuild(sw), '20260928g') && nalunoAtLeast(appVer(html), '2026.09.28g'), 'cache and update banner bumped');
console.log('fixes-28g tests passed');
/* Message ids from the database are escaped in the chat, and the rules only
   accept the id shapes the app writes. */
const w2 = read('wireline.js');
assert.ok(!/data-msgid="\$\{m\.id\}"|data-delmsg="\$\{m\.id\}"|data-voice="\$\{m\.id\}"/.test(w2), 'no raw message id in chat HTML');
const rules = fs.readFileSync(path.join(__dirname, '../firestore.rules'), 'utf8');
assert.strictEqual((rules.match(/id\.matches\('\^\[A-Za-z0-9_\.:-\]\{1,200\}\$'\)/g) || []).length, 2, 'inbox and receipt ids are checked');
console.log('fixes-28g id tests passed');
/* Ads fit the screen in both orientations. */
const adsSrc = read('ads.js');
assert.ok(adsSrc.includes("'#nalunoAdViewer .ad-stage{flex:1 1 auto;min-height:0;") && adsSrc.includes('object-fit:contain !important'), 'full-screen ad fits sideways');
assert.ok(css.includes('body .naluno-break-wrap video.naluno-break-ad,') && css.includes('#bspaceHero.naluno-ad-on #bspaceFitToggle'), 'ad break is never cropped by Fill');
const space = read('broadcast-space.js');
assert.ok(space.includes("hero.classList.add('naluno-ad-on')") && space.includes("hero.classList.remove('naluno-ad-on')"), 'Fill/Fit step aside during an ad');
/* Feed: the ranking actually runs, then a per-visit shuffle. */
const ui3 = read('signal-ui.js');
assert.ok(ui3.includes("    let list = (bcastActiveView === 'mine' ? mineList : feedList)"), 'list is reassignable, so ordering applies');
assert.ok(ui3.includes('list = nalunoFeedShuffle(list);') && ui3.includes("Object.assign({}, b, { _nalunoPlace: i })"), 'shuffle sets the order the grid uses');
assert.ok(read('discover.js').includes('Nothing that shows today disappears.'), 'ranking never drops what the feed shows');
assert.ok(read('gestures.js').includes('nalunoReshuffleFeed(); if (typeof renderBroadcastTab'), 'pull to refresh reshuffles');
/* Run the real shuffle: stable within a visit, different across visits, nothing lost. */
{
  const s0 = ui3.indexOf('let nalunoFeedSeed');
  const s1 = ui3.indexOf('(function nalunoFeedReshuffleTriggers');
  const st = {};
  const c2 = { window: {}, localStorage: { getItem: (k) => (k in st ? st[k] : null), setItem: (k, v) => { st[k] = String(v); } }, Date, Math, Object, String, Number };
  vm.createContext(c2);
  vm.runInContext(ui3.slice(s0, s1) + '\nthis.shuf = nalunoFeedShuffle; this.re = nalunoReshuffleFeed;', c2);
  const feed = Array.from({ length: 15 }, (_, i) => ({ id: 'b' + i }));
  feed[4].live = true;
  const a = c2.shuf(feed).map((b) => b.id);
  assert.deepStrictEqual(c2.shuf(feed).map((b) => b.id), a, 'same visit, same order');
  assert.strictEqual(a[0], 'b4', 'live stays first');
  assert.deepStrictEqual(a.slice().sort(), feed.map((b) => b.id).sort(), 'nothing lost');
  const seen = new Set([a.join()]);
  for (let i = 0; i < 8; i++) { c2.re(); const o = c2.shuf(feed).map((b) => b.id); assert.deepStrictEqual(o.slice().sort(), feed.map((b) => b.id).sort()); seen.add(o.join()); }
  assert.ok(seen.size >= 8, 'new visits give new orders (' + seen.size + ')');
  assert.ok(feed.every((b) => b._nalunoPlace === undefined), 'the feed objects themselves are not changed');
}
console.log('fixes-28g ads + shuffle tests passed');
