/* Call signalling under pressure (28h). Runs the real nalunoCallMove from
   calls.js against a database that serialises transactions like Firestore,
   with every competing status change fired at once, many times over. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const src = fs.readFileSync(path.join(__dirname, 'calls.js'), 'utf8');
const rules = fs.readFileSync(path.join(__dirname, '../firestore.rules'), 'utf8');
const cam = fs.readFileSync(path.join(__dirname, 'camera.js'), 'utf8');
const idx = JSON.parse(fs.readFileSync(path.join(__dirname, '../firestore.indexes.json'), 'utf8'));

/* 1. The real helper, against a transactional store with random delays. */
const a = src.indexOf('const NALUNO_CALL_NEXT');
const b = src.indexOf('window.nalunoCallMove = nalunoCallMove;');
assert.ok(a > 0 && b > a, 'helper found');
let seed = 7;
const rnd = () => { seed = (seed * 1103515245 + 12345) >>> 0; return seed / 4294967296; };
function makeDb() {
  const docs = new Map();
  let lock = Promise.resolve();
  const tick = () => new Promise((r) => setImmediate(r));
  const db = {
    docs,
    failTx: false,
    collection: () => ({ doc: (id) => ({
      id,
      get: async () => { await tick(); const d = docs.get(id); return { exists: !!d, data: () => Object.assign({}, d) }; },
      update: async (patch) => {
        await tick();
        // firestore.rules: a status only moves forward (or stays).
        const before = (docs.get(id) || {}).status;
        const NEXT = { ringing: ['accepted', 'declined', 'missed', 'busy', 'ended'], accepted: ['ended'] };
        if (patch.status && patch.status !== before && !(NEXT[before] || []).includes(patch.status)) { const e = new Error('denied'); e.code = 'permission-denied'; throw e; }
        docs.set(id, Object.assign({}, docs.get(id), patch));
        if (patch.status && db.log) db.log.push([id, before, patch.status]);
      },
    }) }),
    runTransaction(fn) {
      if (db.failTx) return Promise.reject(Object.assign(new Error('unavailable'), { code: 'unavailable' }));
      // Firestore runs competing transactions one after another (retrying the loser).
      const run = lock.then(async () => {
        for (let k = 0; k < Math.floor(rnd() * 3); k++) await tick();
        const writes = [];
        const tx = { get: async (ref) => { const d = docs.get(ref.id); return { exists: !!d, data: () => Object.assign({}, d) }; }, update: (ref, patch) => { writes.push([ref.id, patch]); } };
        const out = await fn(tx);
        writes.forEach(([id, patch]) => { const before = (docs.get(id) || {}).status; docs.set(id, Object.assign({}, docs.get(id), patch)); if (patch.status && db.log) db.log.push([id, before, patch.status]); });
        return out;
      });
      lock = run.catch(() => {});
      return run;
    },
  };
  return db;
}
const ctx = { window: {}, Promise, Object, setImmediate };
vm.createContext(ctx);
vm.runInContext(src.slice(a, b) + '\nthis.move = nalunoCallMove; this.NEXT = NALUNO_CALL_NEXT;', ctx);
const ORDER = { ringing: 0, accepted: 1, declined: 2, missed: 2, busy: 2, ended: 2 };
(async () => {
  let races = 0, revived = 0, doubleAnswer = 0, fbRaces = 0, fbRevived = 0;
  for (let round = 0; round < 2400; round++) {
    const fallback = round >= 2000; // the last 400 rounds: every transaction fails, the plain write takes over
    const db = makeDb(); ctx.fbDb = db; db.log = []; db.failTx = fallback;
    const ids = [];
    for (let i = 0; i < 100; i++) { const id = 'c' + i; ids.push(id); db.docs.set(id, { status: 'ringing' }); }
    const history = new Map(ids.map((id) => [id, ['ringing']]));
    const ops = [];
    for (const id of ids) {
      // everything that can happen to one call, at once, in random order
      const acts = ['accepted', 'accepted', 'declined', 'missed', 'busy', 'ended', 'ended'].sort(() => rnd() - 0.5).slice(0, 2 + Math.floor(rnd() * 5));
      for (const to of acts) ops.push(ctx.move(id, to).then((ok) => [id, to, ok]));
    }
    const results = await Promise.all(ops);
    if (fallback) fbRaces += results.length; else races += results.length;
    for (const [id, from, to] of db.log) history.get(id).push(to);
    for (const [, from, to] of db.log) {
      const back = (ORDER[from] === 2 && from !== to) || ORDER[to] < ORDER[from];
      if (fallback) { if (back) fbRevived++; } else if (back || from === to) revived++;
    }
    for (const id of ids) {
      const h = history.get(id);
      if (!fallback && h.filter((x) => x === 'accepted').length > 1) doubleAnswer++;
      const final = db.docs.get(id).status;
      assert.ok(['accepted', 'declined', 'missed', 'busy', 'ended'].includes(final), 'every call left ringing got a final state: ' + final);
    }
  }
  assert.strictEqual(revived, 0, 'a finished call was never revived');
  assert.strictEqual(doubleAnswer, 0, 'a call was never answered twice');
  assert.strictEqual(fbRevived, 0, 'with transactions failing, the checked write still never moves a call backwards');
  console.log('calls-stress: ' + races + ' competing status changes on 200,000 calls: none went backwards, none answered twice');
  console.log('calls-stress: ' + fbRaces + ' more on 40,000 calls with every transaction failing: none went backwards');

  /* 2. The same table in firestore.rules. */
  assert.ok(rules.includes("request.resource.data.get('status', '') == resource.data.get('status', '')"), 'rules: other fields may change');
  assert.ok(rules.includes("request.resource.data.status in ['missed', 'ended'])"), 'rules: either side may end or miss a ringing call');
  assert.ok(rules.includes("request.resource.data.status in ['accepted', 'declined', 'busy']\n              && request.auth.uid == resource.data.calleeUid)"), 'rules: only the callee answers, declines or says busy');
  assert.ok(rules.includes("(resource.data.get('status', '') == 'accepted'\n              && request.resource.data.status == 'ended')"), 'rules: an answered call can only end');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(ctx.NEXT)), { ringing: ['accepted', 'declined', 'missed', 'busy', 'ended'], accepted: ['ended'] }, 'client and rules agree');
  /* A mirror of the rule, checked against the whole table. */
  const rule = (from, to, who) => (to === from) || (from === 'ringing' && ['missed', 'ended'].includes(to)) || (from === 'ringing' && ['accepted', 'declined', 'busy'].includes(to) && who === 'callee') || (from === 'accepted' && to === 'ended');
  const S = ['ringing', 'accepted', 'declined', 'missed', 'busy', 'ended'];
  for (const f of S) for (const t of S) for (const w of ['caller', 'callee']) {
    const expect = t === f || (ctx.NEXT[f] || []).includes(t) && (!['accepted', 'declined', 'busy'].includes(t) || w === 'callee');
    assert.strictEqual(rule(f, t, w), expect, f + ' -> ' + t + ' by ' + w);
  }
  /* Every place the app writes a call's status fits the rule. */
  assert.ok(!/update\(\{ status:\s*'accepted'/.test(src) && !/update\(\{ status:'declined' \}\)/.test(src) && !/update\(\{ status:'missed' \}\)/.test(src), 'answer / decline / missed go through the checked move');
  assert.ok(src.includes("nalunoCallMove(acceptingId, 'accepted'") && src.includes("nalunoCallMove(id, 'declined')") && src.includes("nalunoCallMove(activeCallId, 'missed')"), 'checked moves used');

  /* 3. The behaviours the simulation asked for. */
  assert.ok(src.includes("nalunoCallMove(callId, 'busy');"), 'busy is answered');
  assert.ok(src.includes("if(currentUser.uid > data.callerUid) return;") && src.includes("endReason: 'crossed'"), 'crossed calls resolve');
  assert.ok(src.includes('if(nalunoRingIsStale(data)){ nalunoCallMove(callId, \'missed\'); return; }'), 'old rings are not shown');
  assert.ok(src.includes('}, 80000);') && src.includes('}, 40000);'), 'ring backstop and connect watchdog');
  assert.ok(src.includes('closeCallOverlay({ keepHistory: true })') && src.includes('if(keepHistory) return;'), 'an incoming call replacing the lobby is not ended by Back');
  assert.ok(src.includes('if(!replacingCallScreen) snapshotUiBeforeCall();'), 'the return point survives a replaced call screen');
  assert.ok(src.includes("d.status === 'busy' || d.status === 'declined'") && src.includes("otherDeviceAnswered"), 'caller hears busy; other device answering stops the ring');
  assert.ok(cam.includes('nalunoCamGen++;') && (cam.match(/nalunoCamLate\(camGen,/g) || []).length >= 2, 'a camera that starts after the call ended is switched off');
  assert.ok(src.includes('let nalunoDialing = null;') && src.includes("try{ nalunoCancelDial(); }catch(_){}") && (src.match(/if\(gone\(\)\)/g) || []).length >= 6, 'a dial cancelled or replaced while the camera opens stops before its record rings');
  assert.ok(src.includes('} else if(activeCallId || dialingOut){') && src.includes("nalunoCancelDial('crossed')"), 'a call arriving while dialing is busy, or the crossed call is answered');
  assert.ok(cam.includes('if(got && stream && stream !== got && mediaStreamIsLive(stream)){'), 'overlapping camera requests do not leave a camera on');
  assert.ok(src.includes('nalunoIncomingFrom.uid === data.callerUid') && src.includes("nalunoCallMove(callId, 'missed');   // an older ring of theirs"), 'a newer ring from the same person replaces the one on screen; an older one is dropped');
  assert.ok(src.includes("nalunoWatchBackup(callId, 'incoming', onRingDoc);") && src.includes("nalunoWatchBackup(myCallId, 'ringing', onMyCallDoc);"), 'both phones double-check the call while it rings');
  assert.ok(src.includes("try{ nalunoEndMyOldRings(callRef.id); }catch(_){}") && src.includes("where('callerUid', '==', currentUser.uid).where('status', '==', 'ringing')"), 'a new call finishes the caller\'s own leftover rings');
  assert.ok(src.includes("endReason: 'nooffer'"), 'answering a leftover ring finishes it');
  const bl = fs.readFileSync(path.join(__dirname, 'band-list.js'), 'utf8');
  assert.ok(bl.includes('id: nalunoFreeBandId()') && bl.includes("JSON.stringify(bands.filter(function(b){ return !b.isReal; }))") && bl.includes('const local = saved.filter(b=>b && !b.isReal);'), 'Band rows get unique ids; saved lists never replace real Bands');
  /* 29b */
  assert.ok(src.includes('if(recordIn) sendCand(json); else heldCands.push(json);') && src.includes('heldCands.splice(0).forEach(sendCand);'), 'the caller holds its first ICE candidates until the call record exists');
  assert.ok(src.includes("const finished = d.status === 'ended' || d.status === 'missed' || d.status === 'declined' || d.status === 'busy';") && src.includes('if(!finished && (d.status === \'accepted\' || d.answer))') && src.includes('if(!finished && d.answer && !remoteDescriptionSet'), 'an answer on a finished call is not a live answer');
  assert.ok(src.includes('function nalunoWatchCandidates(') && (src.match(/nalunoWatchCandidates\(/g) || []).length >= 4, 'candidate listeners subscribe again');
  assert.ok(src.includes("nalunoRelisten('missedCalls', startMissedCallListener)"), 'missed-call badge subscribes again');
  assert.ok(src.includes('nalunoPrepareAnswer(callId, data.offer, camReady)') && src.includes("answer: prep.answer"), 'the answer is prepared while ringing and sent with "accepted"');
  assert.ok(src.includes('if(!prep.used){ prep.remoteHeld.push(cand); return; }'), 'no connectivity checks while still ringing');
  assert.ok(src.includes('if(peerConnection !== pc) return;') || (src.includes('peerConnection === pc && pc.signalingState !== \'closed\'') && (src.match(/if\(!nalunoCallStillThis\(pc\)/g) || []).length >= 2), 'watchdogs only act on the live connection');
  // 29d: the picture is decided before connecting and never switched automatically
  assert.ok(src.includes("const got = getCallOutboundVideoTrackSync();") && src.includes("window.__nalunoFxDraw = true; }"), 'the call starts on the picture it keeps');
  const cf = fs.readFileSync(path.join(__dirname, 'call-filters.js'), 'utf8');
  assert.ok(cf.includes('if(onRaw || !wantsFx) return;') && cf.includes('function nalunoSendCanvasAffordable()'), 'no automatic mid-call switch; slow phones send the raw camera');
  assert.ok(cam.includes("applyCallFilterNow(manual ? { manual: true } : undefined)"), 'a filter picked by hand during the call still switches');
  assert.ok(cam.includes('if(!force && nowMs - sendCanvasLastDraw < 30) return;'), 'the send canvas is drawn at 30 fps');
  // 29d: no flashing
  assert.ok(src.includes('function nalunoWatchFirstFrame(') && src.includes('if(remoteFirstFrame && nalunoRemoteVideoAlive()){'), 'avatar until the first painted frame, then no flip back on a hiccup');
  assert.ok(src.includes('if(remoteFirstFrame || rebinds >= 2 || ticks - lastRebind <= 10) return false;'), 'the stream is not torn off the video every 3.5 s while connecting');
  assert.ok(!src.includes("}, 700);\n}\n\nfunction ingestRemoteTrack"), 'no timed show of an empty video');
  assert.ok(src.includes('function nalunoMarkCallLive(') && src.includes("eb.textContent = nalunoCallLive ? 'Connected' : 'Connecting…';"), '"Connected" and the timer wait for the call to be up');
  // 29e: clearing old rings never ends the call being placed
  { const i = src.indexOf('function nalunoEndMyOldRings('); const body = src.slice(i, src.indexOf('\n}\n', i));
    assert.ok(body.includes('doc.id === activeCallId') && body.includes('if(!ms || ms > cutoff) return;'), 'old-ring cleanup leaves the new call and anything recent alone'); }
  // 29f: voice calls
  assert.ok(src.includes('function startAudioCall(') && src.includes("kind: voice ? 'audio' : 'video',"), 'a voice call is its own kind on the record');
  assert.ok(src.includes("nalunoSetCallKind(data.kind === 'audio' ? 'audio' : 'video');"), 'the receiving phone follows the kind (no kind = video, as before)');
  assert.ok(src.includes("const camFn = nalunoIsVoiceCall() ? nalunoOpenMic :") && src.includes("if(nalunoIsVoiceCall()){\n      try{ await nalunoOpenMic(); }catch(_){}"), 'a voice call opens only the microphone, ringing and answering');
  assert.ok(src.includes("arguments[0] !== 'incall' && nalunoCallKind !== 'audio') prewarmCameraForCall();"), 'no camera warm-up on a voice call screen');
  assert.ok(cam.includes('&& stream.getVideoTracks().some(t => t.readyState === \'live\')){'), 'a video call after a voice call opens the camera again');
  const su = fs.readFileSync(path.join(__dirname, 'signal-ui.js'), 'utf8');
  assert.ok(su.includes('data-video-call="${c.id}"') && su.includes("(typeof startAudioCall === 'function' ? startAudioCall : startOutgoingCall)(parseInt(el.dataset.call))"), 'contact rows: phone = voice, camera = video');
  const wl = fs.readFileSync(path.join(__dirname, 'wireline.js'), 'utf8');
  assert.ok(wl.includes("wirelineStartCallFromThread('audio')") && wl.includes("wirelineStartCallFromThread('video')"), 'chat header: voice and video buttons');
  const calls = idx.fieldOverrides.filter((o) => o.collectionGroup === 'calls');
  ['createdAt', 'acceptedAt', 'endedAt'].forEach((f) => assert.ok(calls.some((o) => o.fieldPath === f && Array.isArray(o.indexes) && o.indexes.length === 0), 'calls.' + f + ' exempt from the single-field index'));
  console.log('calls-stress tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
