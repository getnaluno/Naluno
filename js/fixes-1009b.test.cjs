/* 09 Oct b: English Listen starts sooner (speed unchanged); the Luganda
   masters have a place to be wired into Listen. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

/* 1. Speed is not changed. */
const NV = require('./naluno-voices.js');
assert.deepStrictEqual(NV.PACE, { Bella: 1.42, Hugo: 0.89 }, 'English pace unchanged');
assert.deepStrictEqual(NV.AF_PACE, { female: 0.65, male: 0.73 }, 'Luganda pace unchanged');

/* 2. The opening piece is short, so the first sound comes sooner. */
const long = 'The first time I sold matcha to a café in Kampala the owner laughed at me and said nobody here drinks green tea. I went back the next week.';
const p = NV._pieces(long);
assert.ok(p[0].text.split(' ').length <= 8, 'first piece about eight words (' + p[0].text + ')');
assert.strictEqual(p.map((x) => x.text).join(' ').replace(/\s+/g, ' '), long.replace(/\s+/g, ' '), 'no words lost or added');
const comma = NV._pieces('After many years of trying, the riders finally found a way to share the road with the buses.');
assert.strictEqual(comma[0].text, 'After many years of trying,', 'cut at the first comma when there is one');
const short = NV._pieces('The first café said no. So did the second.');
assert.strictEqual(short[0].text, 'The first café said no.', 'a short first sentence is left whole');

/* 3. Until the first sound, only the loaded voice works; waits are short. */
const src = read('js/naluno-voices.js');
assert.ok(src.includes('var m = heard ? team[sent % team.length] : first;'), 'the other makers start after the first sound');
assert.ok(src.includes('if (secs >= 1.6) return a0;') && src.includes('setTimeout(function () { r(a0); }, 2500);'), 'only a very short title waits, at most 2.5 s');
assert.ok(src.includes('Math.min(gated ? 0.02 : 1.5, Math.max(0.02, deficit))'), 'a slow phone waits at most 1.5 s at the start');
assert.strictEqual(typeof NV.warm, 'function', 'the voice can be readied ahead');
const room = read('js/broadcast-space.js');
assert.ok(room.includes("btn.addEventListener('pointerdown', function(){ try{ if(window.NalunoVoices && NalunoVoices.warm) NalunoVoices.warm(true); }catch(_){} }"), 'a finger on Listen loads the voice');
assert.ok(room.includes('if(window.NalunoVoices && NalunoVoices.warm) NalunoVoices.warm(false);'), 'an open written Broadcast readies a voice already on the phone');
assert.ok(read('js/broadcast-glance.js').includes('[data-glance-act="listen"]'), 'a card\'s Listen too');

/* 4. Masters: wired when their words are written; console recordings first. */
const masters = JSON.parse(read('voices/lg/masters.json'));
assert.deepStrictEqual(masters.masters.map((m) => m.file).sort(), ['female.wav', 'male.mp3']);
assert.ok(fs.existsSync(path.join(root, 'voices/lg/male.mp3')) && fs.existsSync(path.join(root, 'voices/lg/female.wav')));
(async () => {
  const fetched = [];
  const box = {
    window: {}, setTimeout, Promise, Object, String, Array,
    fetch: (u) => { fetched.push(u); return Promise.resolve({ ok: true, json: () => Promise.resolve({ masters: [{ file: 'male.mp3', text: 'Webale nnyo ssebo' }, { file: '../x.mp3', text: 'bad' }, { file: 'female.wav', text: '' }] }) }); },
  };
  box.window = box; box.fbDb = null;
  vm.createContext(box);
  vm.runInContext(read('js/lg-ear.js'), box);
  await new Promise((r) => setTimeout(r, 30));
  const Ear = box.NalunoLgEar;
  assert.ok(fetched.includes('/voices/lg/masters.json'), 'masters.json is read');
  let plan = Ear.plan('Webale nnyo, ssebo!');
  assert.ok(plan && plan.kind === 'line' && plan.clips[0] === '/voices/lg/male.mp3', 'a master with its words is played for them');
  assert.strictEqual(Ear.plan('bad'), null, 'a file outside voices/lg is never used');
  Ear.ingest([{ text: 'Webale nnyo ssebo', audio: 'data:audio/webm;base64,AAAA' }]);
  plan = Ear.plan('Webale nnyo ssebo');
  assert.strictEqual(plan.clips[0], 'data:audio/webm;base64,AAAA', 'a console recording of the same words comes first');
  assert.strictEqual(Ear.plan('Oli otya'), null, 'words nobody recorded are left to the Luganda voice');

  /* 5. Stamps */
  const html = read('app/index.html');
  ['lg-ear.js', 'naluno-voices.js', 'camera.js'].forEach((f) => assert.ok(html.includes('/js/' + f + '?v=20261010a'), f + ' stamp'));
  assert.ok(html.includes('/js/broadcast-space.js?v=20261010g'), 'broadcast-space stamp');
  assert.ok(html.includes('/js/broadcast-glance.js?v=20261010d'), 'glance stamp');
  assert.ok(html.includes('/js/pwa.js?v=20261010g'), 'pwa.js stamp');
  assert.ok(read('sw.js').includes("APP_BUILD = '20261010g'") && read('js/pwa.js').includes('/sw.js?v=20261010g'));
  console.log('fixes-1009b tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
