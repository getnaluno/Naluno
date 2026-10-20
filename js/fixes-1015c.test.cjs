/* 15 Oct c: the public Broadcast / Signal report. Run: node js/fixes-1015c.test.cjs */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
/* Pull one top-level function's source out of a file (brace matched). */
function grab(src, name) {
  const i = src.indexOf('function ' + name + '(');
  assert.ok(i >= 0, 'missing ' + name);
  let d = 0;
  const k = src.indexOf('{', i);
  for (let j = k; j < src.length; j++) {
    if (src[j] === '{') d++;
    else if (src[j] === '}' && --d === 0) return src.slice(i, j + 1);
  }
  throw new Error('unclosed ' + name);
}
const checks = [];
function check(name, fn) { checks.push([name, fn]); }

/* ---------- the phone's fallback when the detector does not finish ---------- */
check('phone fallback (19 Oct e): the skin check never holds or stops anything; unread kept', async () => {
  const src = read('js/nudenet.js');
  async function run(base, title) {
    const g = { console: { warn() {}, log() {} }, setTimeout, clearTimeout, Promise, Math, Date, JSON, Object, Array, Uint8Array, Float32Array, Number, String, RegExp, Error };
    g.runNalunoScreen = async () => base;
    vm.createContext(g);
    vm.runInContext(src, g);
    return g.runNalunoScreen({}, title, 3);
  }
  assert.strictEqual((await run({ decision: 'hold', reason: 'screen', score: 55, packed: {} }, 'Night walk')).decision, 'allow');
  const b = await run({ decision: 'block', reason: 'screen', score: 92, packed: {} }, 'Night walk');
  assert.strictEqual(b.decision, 'allow'); assert.strictEqual(b.engine, 'heuristic'); assert.strictEqual(b.unchecked, true);
  assert.strictEqual((await run({ decision: 'hold', reason: 'screen', score: 20, packed: {} }, 'xxx tape')).decision, 'allow', 'words are the safety check\'s job, not skin');
  assert.strictEqual((await run({ decision: 'unread', reason: 'unread', score: 0, packed: null }, '')).decision, 'unread');
  assert.strictEqual((await run(null, '')).decision, 'unread');
  assert.strictEqual((await run({ decision: 'allow', reason: '', score: 5, packed: {} }, '')).decision, 'allow');
});

/* ---------- the desk ---------- */
const adm = read('js/admin-console.js').replace(/\n  /g, '\n');
check('Let out / Restore fill visibility and publishAt only when missing', () => {
  const publicFeedFill = new Function(grab(adm, 'nalunoMs') + grab(adm, 'publicFeedFill') + 'return publicFeedFill;')();
  const now = 1.8e12;
  assert.deepStrictEqual(publicFeedFill({ createdAt: now - 50 }, now).patch, { visibility: 'public', publishAt: now - 50 });
  assert.deepStrictEqual(publicFeedFill({ createdAt: { toMillis: () => now - 70 } }, now).patch, { visibility: 'public', publishAt: now - 70 });
  assert.deepStrictEqual(publicFeedFill({ createdAt: { seconds: 1700000000 } }, now).patch.publishAt, 1700000000000);
  const priv = publicFeedFill({ visibility: 'private', publishAt: now - 5 }, now);
  assert.deepStrictEqual(priv.patch, {}); assert.ok(/private/.test(priv.note));
  const sched = publicFeedFill({ visibility: 'public', publishAt: now + 3600e3 }, now);
  assert.deepStrictEqual(sched.patch, {}); assert.ok(/scheduled/.test(sched.note));
  assert.strictEqual(publicFeedFill({}, now).patch.publishAt, now - 1000);
  assert.strictEqual(publicFeedFill({ createdAt: now + 9e5 }, now).patch.publishAt, now - 1000);
  /* the write merges the fill into let-out and restore, and a failed read throws before any write */
  assert.ok(/if \(snap && snap\.exists\) fill = publicFeedFill\(snap\.data\(\) \|\| \{\}, now\);/.test(adm));
  assert.ok(/listed: true, held: false, heldReason: '', hidden: false, updatedAt: now,\n\s*\}, fill\.patch\)/.test(adm));
  assert.ok(/listed: true, held: false, hidden: false, hiddenReason: '', updatedAt: now,\n\s*\}, fill\.patch\)/.test(adm));
});
check('holds without a clear nudity finding are released by the desk; detector findings are not', () => {
  const f = new Function('const SKIN_SEX_WORDS = /\\b(porn|porno|xxx|nsfw|onlyfans|nudes?|naked|hentai|cumshot|sex\\s*tape)\\b/i; const NO_FINDING_HELD = { screen: 1, review: 1, unscreened: 1 };' + grab(adm, 'legacyCatMs') + grab(adm, 'skinBandPatch') + 'return skinBandPatch;')();
  const now = 1.8e12;
  const base = { held: true, heldReason: 'screen', screenDecision: 'hold', screenReason: 'screen', visibility: 'public', publishAt: now - 9, title: 'Street at night' };
  const p = f(base, now);
  assert.strictEqual(p.listed, true); assert.strictEqual(p.held, false); assert.ok(!('visibility' in p));
  assert.strictEqual(f(Object.assign({}, base, { visibility: undefined, publishAt: undefined, createdAt: now - 77 }), now).publishAt, now - 77);
  /* 19 Oct e: weak signs, the skin check, and posts never placed are released too. */
  for (const okRow of [{ screenReason: 'possible-topless' }, { screenReason: 'heuristic-only' }, { screenReason: 'video-player-screenshot' },
    { heldReason: 'unscreened', screenDecision: 'hold', screenReason: 'unread' },
    { heldReason: 'review', screenDecision: undefined, screenReason: undefined, createdAt: now - 3600e3 }]) {
    const q = f(Object.assign({}, base, okRow), now);
    assert.ok(q && q.listed === true, JSON.stringify(okRow));
  }
  assert.strictEqual(f(Object.assign({}, base, { heldReason: 'review', screenDecision: undefined, screenReason: undefined, createdAt: now - 3600e3 }), now).screenDecision, 'unread', 'never read: marked for the after-the-fact look');
  for (const bad of [
    { screenReason: 'single-frame' }, { screenReason: 'found-on-fabric' }, { heldReason: 'review', screenDecision: undefined, createdAt: now - 60e3 }, { screenDecision: 'block' },
    { heldReason: 'safety-review' }, { heldReason: 'new-publisher' }, { safetyDecision: 'REVIEW' }, { visibility: 'private' },
    { hidden: true }, { deleted: true }, { held: false }, { title: 'xxx night' }, { caption: 'my nudes' },
  ]) assert.strictEqual(f(Object.assign({}, base, bad), now), null, JSON.stringify(bad));
  assert.ok(/writeAudit\('broadcast-skin-band-release'/.test(adm) && /if \(!ok\) throw new Error\('The audit record could not be saved/.test(adm), 'audited before any write');
  assert.ok(/wireSkinBandRelease\(el\);/.test(adm) && /id="skinBandCheck"/.test(adm));
});
check('releasing a held Signal puts it back for everyone only when that was the choice', () => {
  const f = new Function(grab(adm, 'signalReleasePatch') + 'return signalReleasePatch;')();
  const now = 1.8e12;
  let r = f({ audience: 'public', expiresAt: now + 3600e3 }, { audience: 'public', expiresAt: now + 3600e3, hidden: false }, now, 'op');
  /* 15 Oct f: the person's own copy only takes held/hidden from the desk (rules); public lives on the Everyone copy. */ assert.strictEqual(r.pub.public, true); assert.ok(!('public' in r.user)); assert.strictEqual(r.pub.held, false); assert.strictEqual(r.goesPublic, true);
  r = f({ audience: 'connections', expiresAt: now + 3600e3 }, { expiresAt: now + 3600e3 }, now, 'op');
  assert.strictEqual(r.pub.public, false); assert.ok(!('public' in r.user));
  r = f({ audience: 'public', expiresAt: now - 1 }, { expiresAt: now - 1 }, now, 'op');
  assert.strictEqual(r.pub.public, false, 'its 24 hours are over');
  r = f({ expiresAt: now + 3600e3 }, { expiresAt: now + 3600e3 }, now, 'op');
  assert.strictEqual(r.pub.public, false, 'an older Signal with no stored audience stays with connections');
  assert.ok(!('public' in r.user));
  r = f({ audience: 'public', expiresAt: now + 3600e3 }, { hidden: true, expiresAt: now + 3600e3 }, now, 'op');
  assert.strictEqual(r.pub.public, false, 'a taken-down one never goes public');
  assert.ok(/if \(pubRow\) \{/.test(adm), 'never creates someone else\'s public copy');
});

/* ---------- the feed clock ---------- */
const core = read('js/broadcast-core.js');
check('feed bound: measured clock, else the stored one, else 2 minutes; refusal ladder', async () => {
  const mk = new Function('env', 'window', 'let nalunoServerSkew = env.skew; let nalunoClockBackoff = 0; let nalunoFeedRefusals = 0; let nalunoBackoffWithSkew = false;'
    + 'const NALUNO_REFUSAL_LADDER = [10 * 60000, 60 * 60000, 24 * 3600000, 7 * 24 * 3600000];'
    + grab(core, 'nalunoMeasuredSkew') + grab(core, 'nalunoCatalogueNow') + 'async ' + grab(core, 'nalunoAfterFeedRefusal')
    + 'return { now: nalunoCatalogueNow, refuse: nalunoAfterFeedRefusal, set: (v) => { nalunoServerSkew = v; } };');
  const near = (a, b, tol) => Math.abs(a - b) <= (tol || 50);
  let w = { nalunoStoredSkew: null };
  let c = mk({ skew: -600000 }, w);
  assert.ok(near(c.now(), Date.now() - 600000 - 15000), 'measured: 15 s behind the server');
  c = mk({ skew: null }, { nalunoStoredSkew: -600000 });
  assert.ok(near(c.now(), Date.now() - 600000 - 120000), 'stored: the last measured difference');
  c = mk({ skew: null }, { nalunoStoredSkew: null });
  assert.ok(near(c.now(), Date.now() - 120000), 'none: 2 minutes');
  /* refused, the clock still cannot be read: 10 min, 1 h, 1 day, 1 week, then stop */
  const wNo = { nalunoStoredSkew: null, nalunoMeasureSkew: () => Promise.resolve() };
  c = mk({ skew: null }, wNo);
  const seen = [];
  for (let i = 0; i < 6; i++) { const again = await c.refuse(); seen.push(again ? Math.round((Date.now() - 120000 - c.now()) / 60000) : 'stop'); }
  assert.deepStrictEqual(seen, [10, 60, 1440, 10080, 10080, 'stop']);
  /* refused, then the clock is read: ask by it, no step back */
  const wYes = { nalunoStoredSkew: null };
  c = mk({ skew: null }, wYes);
  wYes.nalunoMeasureSkew = () => { c.set(-3600000); return Promise.resolve(); };
  assert.strictEqual(await c.refuse(), true);
  assert.ok(near(c.now(), Date.now() - 3600000 - 15000));
  /* 15 Oct d: the retry moved into nalunoFeedRetry (fixes-1015d.test.cjs). */
  assert.ok(/if\(err && err\.code === 'permission-denied'\)\{[\s\S]{0,200}nalunoAfterFeedRefusal\(\)\.then/.test(core), 'the feed listener retries a refusal');
});
check('"scheduled" is judged by the server clock (a slow phone hid its last hour)', () => {
  const f = new Function('window', 'let nalunoServerSkew = 3600000;' + grab(core, 'broadcastIsScheduled') + grab(core, 'nalunoServerNow') + 'return broadcastIsScheduled;')({});
  assert.strictEqual(f({ publishAt: Date.now() + 30 * 60000 }), false, 'due by the server even though "future" by this phone');
  assert.strictEqual(f({ publishAt: Date.now() + 2 * 3600000 }), true);
  assert.ok(/window\.nalunoServerNow\(\)/.test(read('js/discover-engine.js')) && /window\.nalunoServerNow\(\)/.test(read('js/discover.js')));
});
check('the measured server clock is kept on the phone', () => {
  const calls = read('js/calls.js');
  assert.ok(/localStorage\.setItem\('nalunoServerSkew', JSON\.stringify\(\{ skew: nalunoServerSkew, at: t \}\)\)/.test(calls));
  assert.ok(/window\.nalunoStoredSkew = \(function\(\)\{/.test(calls));
  assert.ok(/window\.nalunoMeasureSkew = nalunoMeasureSkew;/.test(calls));
});

/* ---------- Signals ---------- */
check('Signals: Everyone is the default; audience stored, held or not', () => {
  const comp = read('js/compass.js');
  const f = new Function('localStorage', grab(comp, 'nalunoSignalAudience') + 'return nalunoSignalAudience;');
  const ls = (v) => ({ getItem: () => v });
  assert.strictEqual(f(ls(null))(), 'public');
  assert.strictEqual(f(ls('public'))(), 'public');
  assert.strictEqual(f(ls('connections'))(), 'connections');
  assert.strictEqual(f({ getItem: () => { throw new Error('blocked'); } })(), 'public');
  assert.ok(/audience: wantPublic \? 'public' : 'connections',/.test(comp));
  assert.ok(/window\.nalunoModPreload\(\)/.test(comp.slice(comp.indexOf('function openComposer('), comp.indexOf('function openComposer(') + 1500)), 'the Signal maker warms up the detector');
  const sc = read('js/signal-core.js');
  assert.ok(/mirror\.audience = clean\.audience;/.test(sc));
  assert.ok(/if\(clean\.public == null\) clean\.public = clean\.audience === 'public';/.test(sc));
  assert.ok(/await nalunoWriteSignalMirror\(ref\.id, mirror\);/.test(sc) && !/set\(mirror, \{ merge: true \}\)\.catch\(function\(\)\{\}\)/.test(sc), 'the public write is awaited, not swallowed');
});
check('Send to Signal: shows the choice; public only when the Broadcast is public', () => {
  const bs = read('js/broadcast-space.js');
  assert.ok(/id="bspaceSignalAud"/.test(bs));
  assert.ok(/audience: aud,\s*public: aud === 'public' && bcastPublic,/.test(bs));
});
check('public Signals: no 30-person cap; pages of 120 up to 480; server-clock bound', async () => {
  const src = read('js/signal-public.js');
  const w = { document: { getElementById: () => null, hidden: true } };
  const g = { window: w, document: w.document, setInterval: () => 0, console, Promise, Date, Math, JSON, Object, Array, Number, String, isFinite, setTimeout };
  vm.createContext(g); vm.runInContext(src, g);
  const P = w.NalunoPublicSignals;
  const list = [];
  for (let i = 0; i < 80; i++) list.push({ uid: 'u' + i, name: 'P', createdAt: Date.now() - i * 1000, expiresAt: Date.now() + 3600e3, public: true, held: false, hidden: false, type: 'text', text: 'x' });
  list.push({ uid: 'h', expiresAt: Date.now() + 3600e3, public: true, held: true, hidden: false });
  list.push({ uid: 'x', expiresAt: Date.now() + 3600e3, public: true, held: false, hidden: true });
  list.push({ uid: 'n', expiresAt: Date.now() + 3600e3, public: false, held: false, hidden: false });
  const rows = P._group(list);
  assert.strictEqual(rows.length, 80);
  assert.ok(!rows.some((r) => ['h', 'x', 'n'].includes(r.uid)), 'held, taken-down and connections-only stay out');
  /* 15 Oct f reworked the paging (first pages, then follow-ups); still pages of 120. */
  assert.ok(/var PAGE = 120, FIRST_PAGES = 4,/.test(src));
  assert.ok(/if \(k && k\.measured\) return Date\.now\(\) \+ k\.skew \+ 60000 \+ aheadExtra;/.test(src));
});

(async () => {
  for (const [name, fn] of checks) {
    try { await fn(); } catch (e) { console.error('FAIL:', name, '\n', e && e.stack); process.exit(1); }
  }
  console.log('fixes-1015c: all ' + checks.length + ' checks passed');
})();
