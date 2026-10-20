/* 20 Oct b: a creator can still replace a photo or video; the new file is
   checked like a new post. Run: node js/fixes-1020b.test.cjs */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
function grab(src, name) {
  let i = src.indexOf('async function ' + name + '(');
  if (i < 0) i = src.indexOf('function ' + name + '(');
  assert.ok(i >= 0, 'missing ' + name);
  let d = 0;
  for (let j = src.indexOf('{', src.indexOf(')', i)); j < src.length; j++) {
    if (src[j] === '{') d++;
    else if (src[j] === '}' && --d === 0) return src.slice(i, j + 1);
  }
  throw new Error('unclosed ' + name);
}

(async () => {
  const core = read('js/broadcast-core.js');
  /* 1. The new file is read first; clear nudity is refused before any upload. */
  {
    let answer = null;
    const ctx = { Promise, Error, runNalunoScreen: async () => answer };
    vm.createContext(ctx);
    vm.runInContext(grab(read('js/broadcast-composer.js'), 'nalunoStrictVerdict').replace('NALUNO_SCREEN_WAIT_MS', '50') + '\n'
      + grab(core, 'nalunoScreenReplacement') + '\nthis.s = nalunoScreenReplacement;', Object.assign(ctx, { setTimeout, clearTimeout, Object }));
    answer = { decision: 'block', engine: 'nudenet', reasonText: 'exposed genitals' };
    await assert.rejects(ctx.s({}, 't', 0), (e) => e.screenBlocked && /exposed genitals/.test(e.message));
    answer = { decision: 'hold', engine: 'nudenet', reason: 'single-frame', packed: { nudenet: 1 } };
    assert.strictEqual((await ctx.s({}, 't', 0)).decision, 'hold');
    answer = { decision: 'hold', engine: 'heuristic', reason: 'heuristic-only' };
    assert.strictEqual((await ctx.s({}, 't', 0)).decision, 'allow', 'the skin check never holds a replacement either');
    answer = null;
    assert.strictEqual((await ctx.s({}, 't', 0)).decision, 'allow', 'unread goes out (the worker marks it for the desk)');
  }
  /* 2. After the post is saved, the worker re-checks it (recheck mode), and a failed call is retried. */
  {
    const sent = [];
    const store = {};
    let reply = () => ({ ok: true, wrote: true, recheck: true, screen: 'hold', listed: false, held: true, hidden: false, heldReason: 'screen' });
    const toasts = [];
    const ctx = {
      Promise, JSON, Date, Object, Array, String, Number, console, setTimeout: () => 0,
      localStorage: { getItem: (k) => store[k] || null, setItem: (k, v) => { store[k] = v; }, removeItem: (k) => { delete store[k]; } },
      currentUser: { uid: 'u1', getIdToken: async () => 'tok' },
      myBroadcasts: [{ id: 'b1', listed: true, held: false }],
      nalunoEconomyUrlBroadcast: () => 'https://w',
      fetch: async (u, init) => { sent.push(JSON.parse(init.body)); return { json: async () => reply() }; },
      toast: (m) => toasts.push(m),
    };
    vm.createContext(ctx);
    vm.runInContext('let nalunoPlaceRetryBusy = false;\n' + ['nalunoPlaceBroadcast', 'nalunoPlaceQueueKey', 'nalunoPlaceQueueRead', 'nalunoPlaceQueueWrite', 'nalunoPlaceQueueAdd', 'nalunoPlaceRetry', 'nalunoPlaceRetrySoon', 'nalunoRecheckAfterReplace'].map((n) => grab(core, n)).join('\n')
      + '\nthis.r = nalunoRecheckAfterReplace; this.q = nalunoPlaceQueueRead; this.retry = nalunoPlaceRetry;', ctx);
    await ctx.r('b1', { decision: 'hold', packed: { w: 0, h: 0, frames: [], nudenet: { v: 1, frames: [] } } });
    assert.strictEqual(sent[0].recheck, true);
    assert.strictEqual(ctx.myBroadcasts[0].held, true);
    assert.ok(toasts.some((t) => /a person at Naluno looks at the new file/i.test(t)));
    reply = () => ({ ok: false, error: 'busy' });
    await ctx.r('b1', null);
    assert.strictEqual(ctx.q()[0].recheck, true, 'kept as a re-check');
    sent.length = 0;
    reply = () => ({ ok: true, wrote: true, screen: 'unread', listed: true });
    await ctx.retry();
    assert.strictEqual(sent[0].recheck, true, 'retried as a re-check, never as a first placement');
    assert.strictEqual(ctx.q().length, 0);
  }
  /* 3. Every way a creator replaces a picture goes through it. */
  {
    const sp = read('js/broadcast-space.js');
    const save = grab(sp, 'bspaceSaveEdit');
    assert.ok(save.indexOf('nalunoScreenReplacement(bspacePendingCover') >= 0 && save.indexOf('nalunoScreenReplacement(') < save.indexOf('uploadPhotoToR2(bspacePendingCover)'), 'Writing photo: read before upload');
    assert.ok(/if\(patch\.mediaUrl && typeof nalunoRecheckAfterReplace === 'function'\)/.test(save), '... re-checked after save');
    const rep = grab(sp, 'replaceBroadcastChapterWithFile');
    assert.ok(rep.indexOf('nalunoScreenReplacement(file') >= 0 && rep.indexOf('nalunoScreenReplacement(file') < rep.indexOf('uploadBroadcastFile(file)'), 'chapter: read before upload');
    assert.ok(/nalunoRecheckAfterReplace\(activeBroadcastId, repScreen\)/.test(rep));
    assert.ok(/nalunoScreenReplacement\(liveBlob, 'Live', liveDur \|\| 0\)/.test(sp) && /nalunoRecheckAfterReplace\(bcastId, liveScreen\)/.test(sp), 'a live saved as a chapter');
    assert.ok(/The live recording was not saved\. /.test(sp));
  }
  /* 4. The desk sees a file changed after its check (an older app, or a re-check that never arrived). */
  {
    const adm = read('js/admin-console.js').replace(/\n  /g, '\n');
    const f = new Function(grab(adm, 'mediaKeyOf') + grab(adm, 'changedAfterCheck') + grab(adm, 'uncheckedRows') + 'return uncheckedRows;')();
    const key = (u) => u;
    const doc = (id, d) => ({ id, data: () => d });
    const rows = f([
      doc('same', { listed: true, screenDecision: 'allow', mediaUrl: 'https://m/a', screenMedia: 'https://m/a' }),
      doc('swapped', { listed: true, screenDecision: 'allow', mediaUrl: 'https://m/new', screenMedia: 'https://m/old', createdAt: 5 }),
      doc('swapped-looked', { listed: true, screenDecision: 'allow', mediaUrl: 'https://m/new', screenMedia: 'https://m/old', screenLookedAt: 1, screenLookedMedia: 'https://m/new' }),
      doc('swapped-again', { listed: true, screenDecision: 'allow', mediaUrl: 'https://m/newer', screenMedia: 'https://m/old', screenLookedAt: 1, screenLookedMedia: 'https://m/new' }),
      doc('legacy', { listed: true, screenDecision: 'allow', mediaUrl: 'https://m/x' }),
      doc('swapped', { listed: true, screenDecision: 'allow', mediaUrl: 'https://m/new', screenMedia: 'https://m/old', createdAt: 5 }),
    ]);
    assert.deepStrictEqual(rows.map((r) => r.id).sort(), ['swapped', 'swapped-again'], 'listed once; a look covers that file only');
    void key;
    assert.ok(/screenLookedMedia: mediaKeyOf\(row\)/.test(adm));
  }
  console.log('fixes-1020b: all checks passed');
})().catch((e) => { console.error(e); process.exit(1); });
