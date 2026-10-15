/* 12 Oct b: second-pass audit. Each block names the failure it guards against. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

function fnSource(src, name) {
  const re = new RegExp('(^|\\n)\\s*(async )?function ' + name + '\\(');
  const m = re.exec(src);
  assert.ok(m, 'function ' + name + ' exists');
  let i = src.indexOf('{', m.index + m[0].length - 1);
  let depth = 0;
  for (let k = i; k < src.length; k++) {
    if (src[k] === '{') depth++;
    else if (src[k] === '}') { depth--; if (depth === 0) return src.slice(m.index, k + 1); }
  }
  throw new Error('unbalanced ' + name);
}

(async () => {
  const calls = read('js/calls.js');
  const html = read('app/index.html');

  /* 1. Answering from a closed app: the call is marked accepted the moment
        the person taps (it no longer waits for the prepared answer first), and
        a cover says "Opening the call…" while the app starts. */
  const tapAt = calls.indexOf("nalunoCallMove(acceptingId, 'accepted'");
  const waitAt = calls.indexOf('!nalunoPrepared.ready', tapAt - 2000);
  assert.ok(tapAt > 0 && waitAt > tapAt, 'accepted is written before waiting for the prepared answer');
  assert.ok(/function nalunoCallMark\(callId, stage(, at)?\)/.test(calls), 'call stages are timed');
  ['ring', 'answerTap', 'accepted', 'connected'].forEach((st) => assert.ok(calls.includes("'" + st + "'"), 'stage ' + st + ' is marked'));
  const boot = html.indexOf("d.id = 'nalunoCallBoot'");
  assert.ok(boot > 0 && boot < html.indexOf('id="authGate"'), 'the call cover is drawn before anything else on the page');
  assert.ok(/setTimeout\(window\.nalunoCallBootDone, 25000\)|25000/.test(html.slice(boot, boot + 2500)), 'the cover always lifts');

  /* 2. TURN credentials last long enough to answer without a fresh fetch, and
        a failed fetch does not make the next call wait again. */
  const ice = read('js/ice-core.js');
  assert.ok(/const ICE_CACHE_TTL_MS = 90 \* 60 \* 1000;/.test(ice));
  assert.ok(/const ICE_REFRESH_AFTER_MS = 75 \* 60 \* 1000;/.test(ice));
  assert.ok(/lastIceFailAt/.test(fnSource(ice, 'awaitIceServers')), 'a recent failure answers from what is known');

  /* 3. Public Broadcast: the owner sees "waiting"/"unlisted" when a post is
        not in the public catalogue, judged with the same five fields the
        database rule uses. */
  const bcore = read('js/broadcast-core.js');
  const listable = new Function(fnSource(bcore, 'nalunoPublicListable') + '; return nalunoPublicListable;')();
  const now = 1_800_000_000_000;
  const ok = { listed: true, hidden: false, held: false, visibility: 'public', publishAt: now - 1 };
  assert.strictEqual(listable(ok, now), true);
  for (const [k, v] of [['listed', undefined], ['hidden', undefined], ['held', true], ['visibility', 'private'], ['publishAt', now + 60000], ['publishAt', undefined], ['deleted', true]]) {
    assert.strictEqual(listable(Object.assign({}, ok, { [k]: v }), now), false, k + '=' + v + ' is not public');
  }
  /* 15 Oct c: same margins, written per branch (measured 15 s; otherwise 2 min, with the last measured clock when kept). */
  assert.ok(/if\(skew !== null\) return Date\.now\(\) \+ skew - 15 \* 1000/.test(bcore) && /- 2 \* 60 \* 1000 - nalunoClockBackoff;/.test(bcore), 'the feed hides others\' new posts for seconds, not minutes');

  /* 4. Toga: an older redraw that finishes late can no longer paint over a
        newer one (values going backwards, rows vanishing). */
  const circle = read('js/circle.js');
  const toga = fnSource(circle, 'renderTogaBoard');
  assert.ok(/const gen = \+\+togaRenderGen/.test(toga));
  assert.ok((toga.match(/gen !== togaRenderGen/g) || []).length >= 2, 'checked after every wait');

  /* 5. Economy worker: Toga counters whose names are not plain identifiers
        were rejected by Firestore, so Circle joins and talk never counted. */
  const { fsFieldPath } = await import(path.join(root, 'workers/economy/handler.mjs'));
  assert.strictEqual(fsFieldPath('mv_2026_10'), 'mv_2026_10');
  assert.strictEqual(fsFieldPath('2026'), '`2026`');
  assert.strictEqual(fsFieldPath('a-b'), '`a-b`');
  assert.strictEqual(fsFieldPath('a`b'), '`a\\`b`');

  /* 6. Callsign: Call notifications sits below the dial, right before Sign out,
        and the dial keeps five evenly spaced stations. */
  const dock = html.indexOf('id="callsignDialDock"');
  const notif = html.indexOf('id="callNotifSection"');
  const signOut = html.indexOf('id="signOutBtn"');
  assert.ok(dock > 0 && notif > dock && signOut > notif, 'order: dial, call notifications, sign out');
  const between = html.slice(notif, signOut);
  assert.ok(!/<section|id="callsignDialDock"/.test(between.replace(/<div class="greenroom-setting" id="callNotifSection"[^>]*>/, '')), 'nothing else sits between them');
  const profile = read('js/profile.js');
  const st = profile.slice(profile.indexOf('const stations = ['), profile.indexOf('];', profile.indexOf('const stations = [')));
  const angles = [...st.matchAll(/angle:(\d+)/g)].map((m) => +m[1]);
  assert.deepStrictEqual(angles, [0, 72, 144, 216, 288]);
  assert.ok(!/id:'calls'/.test(st));

  /* 7. Listen: a second voice maker only starts once the first sentence is
        heard, so the first sentence never shares the CPU. */
  const voices = read('js/naluno-voices.js');
  assert.ok(voices.includes("if (state[k] !== 'idle' || (k > 0 && !heard)) continue;"));
  assert.ok(voices.includes('Math.min(1.5, Math.max(0.02, deficit))'));

  /* 8. Live: a live whose host vanished. The viewer is told; the feed plate
        says so; only the creator's own app ends its own dead live. */
  const lp = read('js/live-preview.js');
  const timers = [];
  let clock = 1_800_000_000_000;
  let snapCb = null;
  const frameDoc = { onSnapshot(cb) { snapCb = cb; return () => { snapCb = null; }; }, get: async () => ({ exists: false }), set: async () => {}, delete: async () => {} };
  const ctx = {
    console, Promise, Math, Number, Object, isFinite,
    Date: { now: () => clock },
    setInterval: (fn) => { timers.push(fn); return timers.length; }, clearInterval: () => {}, setTimeout: () => 0,
    document: { addEventListener() {}, querySelectorAll: () => [], getElementById: () => null },
    window: {}, fbDb: { collection: () => ({ doc: () => ({ collection: () => ({ doc: () => frameDoc }) }) }) },
  };
  vm.createContext(ctx);
  vm.runInContext(lp, ctx);
  const beat = ctx.window.nalunoLiveHeartbeat;
  assert.strictEqual(typeof beat, 'function');
  const seen = [];
  beat('b1', 'host', (s) => seen.push(s));
  const tick = () => timers.forEach((f) => f());
  snapCb({ exists: true, data: () => ({ from: 'host', at: clock - 1000 }) });
  assert.deepStrictEqual(seen, ['fresh']);
  clock += 10000; tick(); assert.deepStrictEqual(seen, ['fresh'], 'quiet only after 20 s with no new still');
  clock += 11000; tick(); assert.deepStrictEqual(seen, ['fresh', 'quiet']);
  snapCb({ exists: true, data: () => ({ from: 'host', at: clock - 500 }) });
  assert.deepStrictEqual(seen, ['fresh', 'quiet', 'fresh'], 'host back: connecting again');
  const seen2 = [];
  beat('b2', 'host', (s) => seen2.push(s));
  snapCb({ exists: true, data: () => ({ from: 'someone', at: clock }) });
  clock += 21000; tick();
  assert.ok(seen2.includes('quiet') && !seen2.includes('fresh'), 'a still from anyone but the creator is no heartbeat');
  const seen3 = [];
  beat('b3', 'host', (st) => seen3.push(st));
  snapCb({ exists: true, data: () => ({ from: 'host', at: clock - 40000 }) });
  tick();
  assert.deepStrictEqual(seen3, ['quiet'], 'an old still seen first is not a host that is back');
  const sweep = fnSource(lp, 'sweepOwnDeadLives');
  assert.ok(/where\('creatorUid', '==', uid\)/.test(sweep), 'the sweep only reads the signed-in creator\'s own Broadcasts');
  assert.ok(/!== frameAt\(f1\)\) continue; \/\/ it is alive/.test(sweep) && /hostingHere\(doc\.id\)/.test(sweep), 'a live still sending, or hosted here, is never offered or ended');
  /* 12c: the limelight. A dropped live is offered to its creator (Resume /
     End) until LIMELIGHT_MS after its last still, then stopped. */
  assert.ok(/showLime\(doc\.id, b, lastAt, endsAt\)/.test(sweep) && /if \(Date\.now\(\) >= endsAt\)/.test(sweep), 'limelight first, stop after it');
  assert.ok(/const LIMELIGHT_MS = 15 \* 60 \* 1000;/.test(lp) && /const LIVE_QUIET_MS = 2 \* 60 \* 1000;/.test(lp), 'same numbers as the server sweep');
  const ws = read('workers/economy/live-sweep.mjs');
  assert.ok(/LIVE_LIMELIGHT_MS = 15 \* 60 \* 1000/.test(ws) && /LIVE_QUIET_MS = 2 \* 60 \* 1000/.test(ws));
  const space = read('js/broadcast-space.js');
  assert.ok(/liveAt: resuming \? \(Number\(resuming\.liveAt\) \|\| Date\.now\(\)\) : Date\.now\(\)/.test(space), 'a resumed live keeps its start');
  assert.ok(/if\(resuming\)\{[\s\S]{0,300}return;\s*\}\s*await bspacePost\('conversation', \{ type:'system', kind:'went_live'/.test(space), 'a resume does not notify everyone again');
  assert.ok(/state === 'fresh' && !bLiveHost[^/]*deadPc/.test(fnSource(read('js/broadcast-live.js'), 'bLiveWatchHostBeat')), 'viewers rejoin when the host is back');
  const bl = read('js/broadcast-live.js');
  assert.ok(/nalunoLiveHeartbeat\(bidHere, creatorHere/.test(fnSource(bl, 'bLiveWatchHostBeat')), 'the viewer watches the heartbeat');
  assert.ok(/bLiveWatchHostBeat\(\)/.test(fnSource(bl, 'bLiveOnSpaceOpened')) && /bLiveStopHostBeat\(\)/.test(fnSource(bl, 'bLiveOnSpaceClosed')), 'from opening a live to closing it, whichever way it joined');
  assert.ok(/publishAt: Date\.now\(\) - 2 \* 60 \* 1000/.test(read('js/broadcast-composer.js')), 'a new live is in other people\'s feeds at once');

  /* 9. Opening a live from the feed: the feed's connection is only taken over
        once its own start-up has finished; before, the start-up closed the
        connection it had just handed over and the picture never came. */
  const adopt = fnSource(bl, 'bLiveAdoptFeed');
  assert.ok(/if\(!bLiveFeedReady\) return false;/.test(adopt));
  assert.ok(/if\(gen === bLiveFeedGen\) bLiveFeedReady = true;/.test(fnSource(bl, 'bLiveStartFeed')));
  assert.ok(/bLiveFeedReady = false;/.test(fnSource(bl, 'bLiveStopFeed')));
  assert.ok(/bLiveAdoptFeed\(\)\) return;/.test(fnSource(bl, 'bLiveJoinAsViewer')), 'a refused take-over falls through to a fresh join');

  console.log('fixes-1012b: all checks passed');
})().catch((e) => { console.error(e); process.exit(1); });
