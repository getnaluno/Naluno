/* Prove Naluno still carries a message when the wider internet is blocked,
   and that Listen does not depend on Google to read a Broadcast. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const { webcrypto } = require('crypto');

const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

function memStore() {
  const data = {};
  return {
    getItem(k) { return Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null; },
    setItem(k, v) { data[k] = String(v); },
    removeItem(k) { delete data[k]; },
  };
}

function loadPair() {
  const box = {
    console,
    crypto: webcrypto,
    localStorage: memStore(),
    TextEncoder,
    TextDecoder,
    Uint8Array,
    Int8Array,
    Uint16Array,
    DataView,
    ArrayBuffer,
    Promise,
    Date,
    Math,
    JSON,
    Object,
    Array,
    String,
    Number,
    Error,
    RegExp,
    parseInt,
    parseFloat,
    isNaN,
    btoa,
    atob,
    URLSearchParams,
    AbortController,
    setTimeout() { return 0; },
    clearTimeout() {},
    setInterval() { return 0; },
    clearInterval() {},
    navigator: { userAgent: 'Android', clipboard: { writeText() { return Promise.resolve(); } } },
    location: { search: '', origin: 'https://getnaluno.com' },
    hits: [],
    drops: [],
    toasts: [],
    contacts: [],
    currentUser: { uid: 'me' },
    toast(s) { box.toasts.push(s); },
  };
  box.window = box;
  box.globalThis = box;
  box.self = box;
  box.document = {
    readyState: 'complete',
    hidden: true,
    body: { appendChild() {}, },
    addEventListener() {},
    getElementById(id) { return id === 'lifelineBar' ? box.bar : null; },
    createElement() { return { value: '', select() {}, remove() {} }; },
    execCommand() { return true; },
  };
  box.bar = {
    style: {},
    innerHTML: '',
    querySelector(sel) {
      const id = sel.replace('#', '');
      if (box.bar.innerHTML.indexOf('id="' + id + '"') < 0) return null;
      const node = {};
      box.bar[id] = node;
      return node;
    },
  };
  box.addEventListener = function () {};
  box.fetch = async function (url, init) {
    const u = String(url);
    box.hits.push(u);
    if (/googleapis|firestore\.googleapis|firebaseio|gstatic/.test(u)) {
      const err = new Error('blocked');
      err.code = 'blocked';
      throw err;
    }
    if (u.indexOf('/v1/lifeline/drop') >= 0) {
      if (box.blockRelay) throw new Error('relay blocked');
      box.drops.push(JSON.parse(init.body).p);
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    }
    if (u.indexOf('/v1/lifeline/pick') >= 0) {
      if (box.blockRelay) throw new Error('relay blocked');
      return { ok: true, status: 200, json: async () => ({ ok: true, packets: [] }) };
    }
    throw new Error('no route ' + u);
  };
  vm.createContext(box);
  vm.runInContext(read('js/lifeline.js'), box, { filename: 'lifeline.js' });
  vm.runInContext(read('js/lifeline-wire.js'), box, { filename: 'lifeline-wire.js' });
  return box;
}

async function person() {
  const kp = await webcrypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const jwk = await webcrypto.subtle.exportKey('jwk', kp.publicKey);
  return { privateKey: kp.privateKey, publicJwk: { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y } };
}

(async function () {
  const A = loadPair();
  const B = loadPair();
  const me = await person();
  const them = await person();
  A.ensureMyKeyPair = async function () { return me; };
  B.ensureMyKeyPair = async function () { return them; };
  A.NalunoLifeline.keyringPut('bob', them.publicJwk);
  B.NalunoLifeline.keyringPut('ada', me.publicJwk);

  const text = 'I am safe. The road is open.';
  const sealed = await A.NalunoLifeline.seal('bob', text, 'c-safe', 1_700_000_000_000);
  assert.strictEqual(sealed.ok, true, 'sealed without the network');
  const raw = Buffer.from(sealed.bytes).toString('utf8');
  assert.ok(!raw.includes('safe') && !raw.includes('ada') && !raw.includes('bob'), 'packet names nobody and hides the words');

  const idx = await B.NalunoLifeline.myTagIndex(['ada'], 1_700_000_000_000);
  const opened = await B.NalunoLifeline.open(sealed.bytes, idx);
  assert.ok(opened && opened.text === text && opened.clientMsgId === 'c-safe', 'the other phone opens it');
  const flipped = new Uint8Array(sealed.bytes);
  flipped[flipped.length - 1] ^= 1;
  assert.strictEqual(await B.NalunoLifeline.open(flipped, idx), null, 'a flipped bit is refused');

  /* Google is blocked. The relay on Naluno's own worker still takes the drop. */
  A.contacts = [{ id: 'b1', firebaseUid: 'bob', name: 'Bob', publicKey: them.publicJwk }];
  A.ensureMyKeyPair = async function () { return me; };
  await A.nalunoLifelineHandoff({ id: 'b1', firebaseUid: 'bob', name: 'Bob' }, { type: 'text', text: text }, 'c-safe');
  assert.strictEqual(A.drops.length, 1, 'one relay drop');
  assert.ok(A.hits.every((u) => u.indexOf('naluno-economy.naluno.workers.dev') >= 0), 'the drop did not go to Google: ' + A.hits.join(','));
  assert.ok(!A.drops[0].includes('safe'), 'the stored drop is not the words');
  assert.ok(A.toasts.some((t) => /Sent inside Naluno/.test(t)), 'the chat says it went');

  /* Total block: the same message stays, and Try now uses the relay the moment it answers. */
  const C = loadPair();
  const me2 = await person();
  const them2 = await person();
  C.ensureMyKeyPair = async function () { return me2; };
  C.NalunoLifeline.keyringPut('bob', them2.publicJwk);
  C.blockRelay = true;
  C.contacts = [{ id: 'b1', firebaseUid: 'bob', name: 'Bob' }];
  C.activeThreadContactId = 'b1';
  await C.nalunoLifelineHandoff({ id: 'b1', firebaseUid: 'bob', name: 'Bob' }, { type: 'text', text: 'Wait for me' }, 'c-wait');
  assert.strictEqual(C.drops.length, 0, 'nothing is sent while every route is closed');
  assert.ok(C.toasts.some((t) => /Held in Naluno/.test(t)), 'it stays in the chat');
  C.nalunoLifelineRenderBar();
  assert.ok(C.bar.innerHTML.includes('id="llCopyText"'), 'a text can be copied without leaving Naluno');
  assert.ok(C.bar.innerHTML.includes('id="llTryNow"'), 'try again stays in the chat');
  assert.ok(!C.bar.innerHTML.includes('Send by SMS'), 'it does not open the SMS app');
  const body = C.__lifelineWire && null;
  void body;
  const packet = C.NalunoLifeline.unb64u(JSON.parse(C.localStorage.getItem('nalunoLifelineOutbox'))[0].p);
  const link = 'https://getnaluno.com/?ll=' + C.NalunoLifeline.b64u(packet);
  const found = C.__lifelineWire.extractAll('please read ' + link + ' thanks');
  assert.strictEqual(found.length, 1, 'a tapped link is found even with chatter around it');
  C.blockRelay = false;
  await C.nalunoLifelineRetry();
  assert.strictEqual(C.drops.length, 1, 'Try now delivers once the relay can be reached');

  /* Nearby, no internet: phones pass the sealed packet. */
  const meshA = new A.NalunoLifeline.MeshRouter();
  const got = [];
  const meshB = new B.NalunoLifeline.MeshRouter({ onDeliver(bytes) { got.push(bytes); } });
  meshB.setMyTags([B.NalunoLifeline.hex(sealed.tag)]);
  meshA.accept(sealed.bytes, 8);
  const offer = meshA.offerTo(meshB.summary());
  assert.ok(offer.length === 1, 'the carrier hands it to the phone that wants that tag');
  meshB.accept(offer[0].bytes, offer[0].copies);
  assert.strictEqual(got.length, 1, 'mesh delivered with no internet');

  /* A message that cannot be sealed is not sent in the clear. */
  const D = loadPair();
  D.contacts = [{ id: 'z', firebaseUid: 'zoe', name: 'Zoe' }];
  await D.nalunoLifelineHandoff({ id: 'z', firebaseUid: 'zoe', name: 'Zoe' }, { type: 'text', text: 'secret words' }, 'c-no');
  assert.strictEqual(D.drops.length, 0, 'no drop without a key');
  assert.ok(D.hits.length === 0, 'no network call with readable text');
  assert.ok(D.toasts.some((t) => /can’t send this privately|can't send this privately/.test(t)), 'it says why');

  const space = read('js/broadcast-space.js');
  const sw = read('sw.js');
  const html = read('app/index.html');
  const life = read('js/lifeline-wire.js');
  assert.ok(!space.includes('translate.googleapis.com/translate_tts'), 'Listen does not call Google to read');
  const speakFn = space.slice(space.indexOf('async function bspaceSpeakWriting'), space.indexOf('function bspacePickVoice'));
  assert.ok(speakFn.indexOf('NalunoVoices.speak') >= 0 && speakFn.indexOf('NalunoVoices.speak') < speakFn.indexOf('speechSynthesis'), 'Naluno speaks before any system voice');
  assert.ok(html.includes('id="bspaceVoice"') && html.includes('>Female<') && html.includes('>Male<'), 'female and male voices');
  assert.ok(sw.includes("pathname.indexOf('/voices/') === 0") && sw.includes("n !== 'naluno-voices'"), 'voices survive a blocked network and an update');
  assert.ok(life.includes('nalunoLifelineRetry') && life.includes('id="llCopyText"') && !life.includes('Send by SMS'), 'relay retry and copy stay inside Naluno');
  const model = fs.statSync(path.join(root, 'voices/kitten/model.onnx')).size;
  const wasm = fs.statSync(path.join(root, 'voices/ort/ort-wasm-simd-threaded.wasm')).size;
  assert.ok(model > 20_000_000 && wasm > 5_000_000, 'the voice weights are on the phone, not fetched from Google');
  assert.ok(read('js/naluno-voices.js').includes("female: 'Bella'") && read('js/naluno-voices.js').includes("male: 'Jasper'"), 'two distinct voices');
  assert.ok(read('js/naluno-voice-worker.js').includes('/voices/kitten/') && !read('js/naluno-voice-worker.js').includes('huggingface'), 'the worker reads the local weights');

  console.log('restricted-net tests passed');
})().catch(function (e) {
  console.error(e);
  process.exit(1);
});
