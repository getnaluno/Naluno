const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function extractFn(src, name){
  const start = src.indexOf('function ' + name + '(');
  if(start < 0) throw new Error('missing ' + name);
  let i = src.indexOf('{', start);
  let depth = 0;
  let quote = null;
  for(; i < src.length; i++){
    const c = src[i];
    const prev = src[i - 1];
    if(quote){
      if(c === quote && prev !== '\\') quote = null;
      continue;
    }
    if(c === '"' || c === "'" || c === '`'){ quote = c; continue; }
    if(c === '{') depth++;
    else if(c === '}'){
      depth--;
      if(depth === 0) return src.slice(start, i + 1);
    }
  }
  throw new Error('unclosed ' + name);
}

function load(file, names, extra){
  const src = fs.readFileSync(path.join(__dirname, file), 'utf8');
  const code = names.map(function(n){ return extractFn(src, n); }).join('\n');
  const box = Object.assign({
    console: console,
    escapeHtml: function(s){
      const map = { '&': '&' + 'amp;', '<': '&' + 'lt;', '>': '&' + 'gt;', '"': '&' + 'quot;' };
      return String(s == null ? '' : s).replace(/[&<>"]/g, function(ch){ return map[ch]; });
    },
  }, extra || {});
  vm.createContext(box);
  vm.runInContext(code, box, { filename: file });
  return box;
}

const Threads = require('./room-threads.js');
const space = load('broadcast-space.js', [
  'bspaceEscape', 'bspaceWhoLabel', 'bspaceDeleteBtnHtml', 'bspaceTalkBody',
  'bspaceReactRowsFor', 'bspaceMyReact', 'bspaceReactSummary', 'bspaceThreadCard',
  'bspaceWireDeleteButtons', 'bspaceWireTalk', 'bspaceRenderTalk', 'renderBspaceConversation',
], {
  currentUser: { uid: 'me' },
  contacts: [],
  activeBroadcastMeta: { creatorUid: 'creator', isMine: false },
  bspaceTalkOpen: {},
  bspaceReactOpen: {},
  roomReactRows: [],
  timeAgo: function(){ return 'now'; },
  window: { NalunoRoomThreads: Threads },
  resolveMediaUrl: function(u){ if(u && typeof u !== 'string') throw new Error('bad media'); return u || ''; },
});
space.window = space;

function el(){
  return {
    innerHTML: '',
    parentNode: { insertBefore: function(){} },
    querySelectorAll: function(){ return []; },
    onclick: null,
  };
}
const host = el();
const docs = [];
for(let i = 0; i < 6; i++){
  docs.push({
    id: 'c' + i,
    data: function(){ return { from: i === 0 ? 'me' : 'other', type: 'text', text: 'hello ' + i, ts: 1000 + i }; },
  });
}
docs.push({
  id: 'bad',
  data: function(){ return { from: 'other', type: 'photo', mediaUrl: { nope: true }, ts: 2000 }; },
});
space.$ = function(id){ return id === 'bspaceConversation' ? host : null; };
space.document = { createElement: function(){ return { id:'', style:{}, innerHTML:'' }; } };
space.bspaceDocCache = {};
space.renderBspaceConversation(docs);
const plates = host.innerHTML.split('bspace-talk-plate').length - 1;
assert.strictEqual(plates, 7, 'every conversation, including a bad attachment, sits on a plate');
assert.ok(host.innerHTML.indexOf('hello 5') >= 0, 'typed text is in the plate');
assert.strictEqual((host.innerHTML.match(/data-del-id="c0"/g) || []).length, 1, 'author can delete their own');
assert.strictEqual((host.innerHTML.match(/data-del-id="c1"/g) || []).length, 0, 'a stranger cannot delete someone else');

space.currentUser = { uid: 'creator' };
space.activeBroadcastMeta = { creatorUid: 'creator', isMine: true };
space.renderBspaceConversation(docs);
assert.ok(host.innerHTML.indexOf('data-del-id="c1"') >= 0, 'the creator can moderate');

const empty = el();
const pin = { id: 'bspaceLivePin', style: {}, innerHTML: '' };
space.$ = function(id){
  if(id === 'bspaceConversation') return empty;
  if(id === 'bspaceLivePin') return pin;
  return null;
};
space.renderBspaceConversation([]);
assert.ok(empty.innerHTML.indexOf('bspace-talk-plate') >= 0, 'an empty conversation still has a plate');

const wire = load('wireline.js', ['wireSeenMap', 'wireSeenAt', 'wireMarkSeen', 'wireSeenKey', 'wireRowUnread', 'wireLinkify'], {
  localStorage: {
    mem: {},
    getItem: function(k){ return this.mem[k] || null; },
    setItem: function(k, v){ this.mem[k] = v; },
  },
});
assert.strictEqual(wire.wireRowUnread(true, 100, 'u'), true);
wire.wireMarkSeen('u', 100);
assert.strictEqual(wire.wireRowUnread(true, 100, 'u'), false, 'opened once, the same message does not highlight again');
assert.strictEqual(wire.wireRowUnread(true, 50, 'u'), false);
assert.strictEqual(wire.wireRowUnread(true, 200, 'u'), true, 'a newer message highlights once');
assert.strictEqual(wire.wireRowUnread(false, 300, 'u'), false);
const linked = wire.wireLinkify('see https://getnaluno.com/a, and www.example.com/x');
assert.ok(linked.indexOf('href="https://getnaluno.com/a"') >= 0);
assert.ok(linked.indexOf('href="https://www.example.com/x"') >= 0);
assert.ok(linked.indexOf('>,') >= 0 || linked.indexOf('</a>,') >= 0);
const nasty = wire.wireLinkify('x <script>alert(1)</script> javascript:alert(1)');
assert.ok(nasty.indexOf('<script>') < 0);
assert.ok(nasty.indexOf('href="javascript:') < 0);
assert.ok(nasty.indexOf('href="javascript:') < 0);

const band = load('band-list.js', [
  'bandInviteSeen', 'bandInviteRemember', 'bandInviteForget', 'bandInviteHasBook',
  'bandInviteClaim', 'bandInviteShouldToast',
], {
  localStorage: {
    mem: {},
    getItem: function(k){ return Object.prototype.hasOwnProperty.call(this.mem, k) ? this.mem[k] : null; },
    setItem: function(k, v){ this.mem[k] = String(v); },
  },
});
assert.strictEqual(band.bandInviteShouldToast({ first: true, mine: false, seen: false }), false, 'first paint of bands you already belong to stays quiet');
assert.strictEqual(band.bandInviteShouldToast({ first: false, mine: true, seen: false }), false);
assert.strictEqual(band.bandInviteShouldToast({ first: false, mine: false, seen: true }), false, 'already in the band does not announce again');
assert.strictEqual(band.bandInviteShouldToast({ first: false, mine: false, seen: false }), true);
assert.strictEqual(band.bandInviteClaim('u', 'b1'), true);
assert.strictEqual(band.bandInviteClaim('u', 'b1'), false, 'two listeners cannot toast the same invite');
band.bandInviteRemember('u', 'b1');
assert.strictEqual(band.bandInviteHasBook('u'), true);
assert.strictEqual(!!band.bandInviteSeen('u').b1, true);
band.bandInviteForget('u', 'b1');
assert.strictEqual(!!band.bandInviteSeen('u').b1, false, 'leaving lets a real new invite speak again');

const K = require('./known.js');
const paid = K.recordPayment(K.review(K.freshApply('u1', 'Aster', 'I publish under this name in Kampala', 1), 'accept', 2), 3, 'cs');
const view = {
  html: 'Aster',
  querySelector: function(sel){ return this.html.indexOf('naluno-known') >= 0 && sel === '.naluno-known' ? { remove: function(){ view.html = 'Aster'; } } : null; },
  insertAdjacentHTML: function(_where, bit){ this.html += bit; },
};
global.document = { getElementById: function(id){ return id === 'viewName' ? view : null; } };
const knownBox = load('known.js', ['stampView'], {});
assert.ok(K.isKnown(paid, 4));
view.html = 'Aster';
assert.ok(view.html.indexOf('naluno-known') < 0);
assert.ok(K.markHtml().indexOf('naluno-known') >= 0);
view.insertAdjacentHTML('beforeend', K.markHtml());
assert.ok(view.html.indexOf('Known') >= 0, 'the mark sits on the Callsign name');
view.html = 'Aster';
assert.ok(view.html.indexOf('Known') < 0, 'rewriting the name clears the mark');
view.insertAdjacentHTML('beforeend', K.markHtml());
assert.ok(view.html.indexOf('Known') >= 0, 'stamping after the rewrite puts it back');
assert.strictEqual(typeof knownBox.stampView, 'function');

const css = fs.readFileSync(path.join(__dirname, '../css/app.css'), 'utf8');
assert.ok(css.indexOf('height:30%') < 0, 'the writing photo is not a thin strip');
assert.ok(/is-writing\.has-photo img\.bcast-plate-media\{[^}]*height:100%/.test(css), 'the writing photo fills the preview');
const html = fs.readFileSync(path.join(__dirname, '../app/index.html'), 'utf8');
assert.ok(html.indexOf('data-dial="mine"') >= 0 && html.indexOf('data-dial="close"') >= 0);
const dock = html.split('id="callsignDialDock"')[1].split('id="signOutBtn"')[0];
assert.ok(dock.indexOf('myContributionBtn') >= 0 && dock.indexOf('closeCallsignBtn') >= 0);
assert.ok(html.indexOf('id="signOutBtn"') >= 0 && html.indexOf('callsignPrivacyBtn') >= 0);

console.log('play-26k tests passed');
