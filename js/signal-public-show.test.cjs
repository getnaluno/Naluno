/* 15 Oct h: a Signal sent to Everyone has to show for another signed-in
   person. The old list could not be proved by the rules (and a fast phone
   then locked the copy as private). This runs that list. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const HOUR = 3600000;
const DAY = 24 * HOUR;

function boot(opts) {
  const docs = (opts.docs || []).map((d) => Object.assign({}, d));
  const serverSkew = () => (typeof opts.serverSkew === 'function' ? opts.serverSkew() : (opts.serverSkew || 0));
  const writes = [];
  function passes(data, filters) {
    return filters.every((f) => {
      const v = data[f.field];
      if (f.op === '>') return typeof v === 'number' && v > f.bound;
      if (f.op === '==') return v === f.bound;
      return false;
    });
  }
  function query(filters) {
    const q = {
      where(field, op, bound) { return query(filters.concat([{ field, op, bound }])); },
      orderBy() { return q; },
      limit() { return q; },
      startAfter() { return q; },
      get() {
        const serverNow = Date.now() + serverSkew();
        const isFeed = filters.some((f) => f.field === 'feedUntil' && f.op === '>');
        const isLegacy = filters.some((f) => f.field === 'public' && f.op === '==');
        if (opts.rules === 'old') {
          if (isFeed) {
            const err = new Error('The query requires an index.');
            err.code = 'failed-precondition';
            return Promise.reject(err);
          }
        } else if (isLegacy) {
          const err = new Error('false for list');
          err.code = 'permission-denied';
          return Promise.reject(err);
        } else if (isFeed) {
          const bound = filters.find((f) => f.field === 'feedUntil').bound;
          if (!(bound > serverNow)) {
            const err = new Error('false for list: feedUntil is not after request.time');
            err.code = 'permission-denied';
            return Promise.reject(err);
          }
        }
        const hit = docs.filter((d) => passes(d, filters));
        hit.sort((a, b) => (b.feedUntil || b.expiresAt || 0) - (a.feedUntil || a.expiresAt || 0));
        return Promise.resolve({
          forEach(fn) {
            hit.forEach((data) => fn({ id: data.id, data() { return Object.assign({}, data); } }));
          },
        });
      },
    };
    return q;
  }
  const box = {
    console, Promise, Date, Math, JSON, Object, Array, Number, String, isFinite, setTimeout,
    setInterval() { return 0; },
    document: { getElementById() { return null; }, hidden: true, addEventListener() {} },
    currentUser: { uid: opts.uid || 'viewer' },
    contacts: opts.contacts || [],
    nalunoServerSkew: opts.measured == null ? null : opts.measured,
  };
  box.window = box;
  box.window.nalunoStoredSkew = opts.stored == null ? null : opts.stored;
  box.fbDb = { collection() { return { where: (f, o, b) => query([{ field: f, op: o, bound: b }]) }; } };
  vm.createContext(box);
  vm.runInContext(read('js/signal-public.js'), box);
  return { box, docs, writes };
}

{
  const { box } = boot({ measured: null, stored: -2 * DAY });
  const P = box.NalunoPublicSignals;
  assert.strictEqual(P.freshSkew(null, -2 * DAY), null, 'a stored clock two days off is not a clock');
  assert.deepStrictEqual(P.freshSkew(null, 2 * 60000).skew, 2 * 60000, 'a small stored difference is kept');
  assert.strictEqual(P.freshSkew(-2 * HOUR, -2 * DAY).fresh, true, 'a difference measured this session is trusted');
  const now = Date.now();
  const noClock = P.publicExpiry(now + DAY, now, null, null);
  assert.ok(noClock <= now + 20 * HOUR, 'with no clock, 24 hours on the phone is cut to 20');
  const server = now - 2 * HOUR;
  const capped = P.publicExpiry(now + DAY, now, -2 * HOUR, null);
  assert.ok(capped <= server + 25 * HOUR && capped > server, 'a phone two hours fast still lands inside the server\'s 25 hours');
  const blind = P.publicExpiry(now + DAY, now, null, null);
  assert.ok(blind <= server + 25 * HOUR && blind > server, 'even before the clock is read, two hours fast is still legal');
  const bound = P._lowerBound();
  assert.ok(Math.abs(bound - (now + 300000)) < 5000, 'a stored skew of two days does not pull the list into the past');
  assert.ok(bound > now - DAY, 'the bound is not yesterday');
}

function shape(data, serverNow) {
  if (data.public !== true) return (data.feedUntil || 0) === 0;
  return data.held !== true && data.hidden !== true
    && typeof data.expiresAt === 'number'
    && data.expiresAt <= serverNow + 90000000
    && data.feedUntil === data.expiresAt;
}
{
  const serverNow = Date.now() - 2 * HOUR;
  const phoneNow = Date.now();
  assert.strictEqual(shape({ public: false, feedUntil: phoneNow + DAY }, serverNow), false, 'a private copy cannot invent a place on the list');
  assert.strictEqual(shape({ public: false, feedUntil: 0 }, serverNow), true);
  const fast = boot({}).box.NalunoPublicSignals.publicExpiry(phoneNow + DAY, phoneNow, -2 * HOUR, null);
  assert.strictEqual(shape({ public: true, held: false, hidden: false, expiresAt: phoneNow + DAY, feedUntil: phoneNow + DAY }, serverNow), false, 'the old uncapped 24 hours is refused');
  assert.strictEqual(shape({ public: true, held: false, hidden: false, expiresAt: fast, feedUntil: fast }, serverNow), true, 'the capped copy is a legal public Signal');
}

function liveDoc(over) {
  const exp = Date.now() + 20 * HOUR;
  return Object.assign({
    id: 's1', uid: 'amina', name: 'Amina', public: true, hidden: false, held: false,
    audience: 'public', expiresAt: exp, feedUntil: exp, type: 'text', text: 'Good evening', createdAt: Date.now() - 5000,
  }, over);
}

(async () => {
  const docs = [
    liveDoc({}),
    liveDoc({ id: 'held', uid: 'held-user', name: 'Held', held: true, feedUntil: 0 }),
    liveDoc({ id: 'conn', uid: 'pal', name: 'Pal', public: false, audience: 'connections', feedUntil: 0, text: 'just us' }),
    liveDoc({ id: 'mine', uid: 'viewer', name: 'Me', feedUntil: Date.now() + 18 * HOUR, expiresAt: Date.now() + 18 * HOUR }),
    liveDoc({ id: 'friend', uid: 'friend', name: 'Friend', feedUntil: Date.now() + 19 * HOUR, expiresAt: Date.now() + 19 * HOUR }),
  ];
  const seen = boot({
    rules: 'new', uid: 'viewer', contacts: [{ firebaseUid: 'friend' }],
    measured: null, stored: -2 * DAY, docs,
  });
  const rows = await seen.box.NalunoPublicSignals.load(true);
  assert.deepStrictEqual(rows.map((r) => r.uid), ['amina'], 'a stranger\'s Everyone Signal is on the row; mine, a connection, a held one and a private one are not');
  assert.ok(seen.box.NalunoPublicSignals.tilesHtml().includes('Everyone') && seen.box.NalunoPublicSignals.tilesHtml().includes('Amina'), 'the tile says Everyone');
  assert.ok(!seen.box.NalunoPublicSignals.tilesHtml().includes('Pal') && !seen.box.NalunoPublicSignals.tilesHtml().includes('Held'), 'held and connections stay off the row');

  const stranger = boot({
    rules: 'new', uid: 'someone-else', contacts: [], measured: -2 * HOUR, serverSkew: -2 * HOUR, stored: -2 * DAY, docs,
  });
  const wide = await stranger.box.NalunoPublicSignals.load(true);
  const ids = wide.map((r) => r.uid).sort();
  assert.deepStrictEqual(ids, ['amina', 'friend', 'viewer'], 'another person sees the maker, including one posted from a phone two hours fast');

  const oldWorld = boot({
    rules: 'old', uid: 'viewer', contacts: [], measured: null, stored: null,
    docs: [liveDoc({ feedUntil: undefined, id: 'old1' })],
  });
  const oldRows = await oldWorld.box.NalunoPublicSignals.load(true);
  assert.deepStrictEqual(oldRows.map((r) => r.uid), ['amina'], 'before the new rules, the older query still shows the Signal');

  const repair = {
    console, Promise, Date, Math, JSON, Object, Array, Number, String, isFinite, setTimeout,
    setInterval() { return 0; },
    document: { getElementById() { return null; }, hidden: true, addEventListener() {} },
    navigator: { onLine: true },
    localStorage: { getItem() { return null; }, setItem() {} },
    renderBroadcasts() {},
    currentUser: { uid: 'owner' },
    nalunoServerSkew: -2 * HOUR,
  };
  repair.window = repair;
  repair.window.nalunoStoredSkew = -2 * DAY;
  const mirror = {};
  const userSegs = [
    { id: 'bad', audience: 'public', held: false, hidden: false, expiresAt: Date.now() + 20 * HOUR, createdAt: 1 },
    { id: 'down', audience: 'public', held: false, hidden: false, expiresAt: Date.now() + 20 * HOUR, createdAt: 2 },
    { id: 'good', audience: 'public', held: false, hidden: false, expiresAt: Date.now() + 10 * HOUR, createdAt: 3 },
    { id: 'gone', audience: 'public', held: false, hidden: false, expiresAt: Date.now() + 20 * HOUR, createdAt: 4 },
    { id: 'noaud', audience: 'public', held: false, hidden: false, expiresAt: Date.now() + 20 * HOUR, createdAt: 5 },
    { id: 'justus', audience: 'connections', held: false, hidden: false, expiresAt: Date.now() + 20 * HOUR, createdAt: 6 },
  ];
  mirror.bad = { uid: 'owner', public: false, feedUntil: 0, audience: 'public', hidden: false, held: false, expiresAt: Date.now() + DAY };
  mirror.down = { uid: 'owner', public: false, feedUntil: 0, audience: 'public', hidden: true, held: false, expiresAt: Date.now() + 20 * HOUR };
  mirror.good = { uid: 'owner', public: true, audience: 'public', hidden: false, held: false, expiresAt: Date.now() + 10 * HOUR, feedUntil: Date.now() + 10 * HOUR };
  mirror.noaud = { uid: 'owner', public: false, feedUntil: 0, hidden: false, held: false, expiresAt: Date.now() + 20 * HOUR };
  const repairWrites = [];
  function signalDoc(id) {
    return {
      get() {
        const d = mirror[id];
        if (!d) return Promise.resolve({ exists: false, data() { return {}; } });
        return Promise.resolve({ exists: true, data() { return Object.assign({}, d); } });
      },
      set(data, opts) {
        repairWrites.push({ id: id, data: Object.assign({}, data), merge: !!(opts && opts.merge) });
        mirror[id] = Object.assign({}, (opts && opts.merge && mirror[id]) || {}, data);
        return Promise.resolve();
      },
    };
  }
  repair.fbDb = {
    collection(name) {
      if (name === 'users') {
        return {
          doc() {
            return {
              collection() {
                return {
                  orderBy() {
                    return {
                      get() {
                        return Promise.resolve({
                          docs: userSegs.map((s) => ({ id: s.id, data() { return Object.assign({}, s); } })),
                        });
                      },
                    };
                  },
                };
              },
            };
          },
        };
      }
      return { doc: signalDoc };
    },
  };
  vm.createContext(repair);
  vm.runInContext(read('js/signal-public.js') + '\n' + read('js/signal-core.js'), repair);
  await repair.loadMySignal();
  await new Promise((r) => setTimeout(r, 30));
  const wroteIds = repairWrites.map((w) => w.id).sort();
  assert.deepStrictEqual(wroteIds, ['bad', 'gone'], 'only a locked Everyone copy, and a missing one, are written back');
  const back = repairWrites.find((w) => w.id === 'bad');
  const serverNow = Date.now() - 2 * HOUR;
  assert.strictEqual(back.merge, true);
  assert.strictEqual(back.data.public, true);
  assert.strictEqual(back.data.feedUntil, back.data.expiresAt);
  assert.ok(back.data.expiresAt <= serverNow + 25 * HOUR && back.data.expiresAt > serverNow, 'the repaired expiry is legal on a phone two hours fast');
  assert.ok(!('uid' in back.data), 'an existing copy is not rewritten wholesale');
  const created = repairWrites.find((w) => w.id === 'gone');
  assert.strictEqual(created.data.uid, 'owner');
  assert.strictEqual(created.data.feedUntil, created.data.expiresAt);
  assert.ok(!repairWrites.some((w) => w.id === 'down'), 'a desk takedown stays down');
  const shown = await boot({
    rules: 'new', uid: 'someone-else', contacts: [], measured: -2 * HOUR, serverSkew: -2 * HOUR,
    docs: [Object.assign({ id: 'bad', name: 'Amina', type: 'text', text: 'back', createdAt: Date.now() }, mirror.bad)],
  }).box.NalunoPublicSignals.load(true);
  assert.deepStrictEqual(shown.map((r) => r.uid), ['owner'], 'after the repair, someone else sees it');

  const rules = read('firestore.rules');
  const block = rules.slice(rules.indexOf('match /signals/{id} {'), rules.indexOf('match /users/{uid}/wirelineClears'));
  assert.ok(block.includes('resource.data.feedUntil > request.time.toMillis()'), 'list rule');
  assert.ok(block.includes("resource.data.audience == 'public'") && block.includes('resource.data.hidden != true') && block.includes("affectedKeys().hasOnly(['public', 'expiresAt', 'feedUntil'])"), 'republish, but not after a takedown');
  const sw = read('sw.js');
  const probe = sw.indexOf("pathname === '/manifest.json'");
  assert.ok(probe > 0 && probe < sw.indexOf('caches.match(new Request(bare))'), 'the clock probe is answered before the shell cache');
  assert.ok(sw.includes("search.indexOf('skew=')") && sw.includes("cache: 'no-store'") && sw.includes('status: 504'), 'the probe is the network, or nothing');
  const core = read('js/signal-core.js');
  assert.ok(core.includes('mirror.feedUntil = (mirror.public && typeof mirror.expiresAt === \'number\') ? mirror.expiresAt : 0;'), 'the copy carries feedUntil only when it is public');
  assert.ok(core.includes('{ public: false, feedUntil: 0 }'), 'a refused public copy does not stay on the list');
  assert.ok(core.includes('nalunoRepairPublicMirrors') && core.includes('uid: currentUser.uid'), 'the owner can put a refused Everyone copy back, and only then writes uid');
  assert.ok(read('css/site.css').includes('@keyframes naluno-live') && read('css/site.css').includes('prefers-reduced-motion'), 'the website moves, and holds still when asked');
  assert.ok(/\/css\/site\.css\?v=20261015h/.test(read('index.html')), 'the site asks for this stylesheet');
  console.log('signal-public-show: a stranger sees the Everyone Signal');
})().catch((e) => {
  console.error(e && e.stack || e);
  process.exit(1);
});
