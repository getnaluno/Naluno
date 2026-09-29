/* 30a: a smarter Compass (a member guide, links judged for relevance,
   nothing about how Naluno is built) and links in Writing and comments.
   Browser checks cover the screens; these pin the logic. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const read = (f) => fs.readFileSync(path.join(__dirname, f), 'utf8');
function extractFn(src, name){
  const start = src.indexOf('function ' + name + '(');
  assert.ok(start >= 0, 'found ' + name);
  let i = src.indexOf('{', start), depth = 0;
  for(; i < src.length; i++){
    if(src[i] === '{') depth++;
    else if(src[i] === '}'){ depth--; if(depth === 0) return src.slice(start, i + 1); }
  }
  throw new Error('unbalanced ' + name);
}
const B = require('./compass-brain.js');
const ids = (list) => list.map((e) => e.id);

/* 1. The guide answers Naluno questions. */
assert.ok(ids(B.kbMatch('how do I delete my account')).includes('close'), 'delete account -> close');
assert.ok(ids(B.kbMatch('how do I add a friend')).length, 'add a friend finds something');
assert.ok(ids(B.kbMatch('how do I go live')).includes('live'), 'go live -> live');
assert.ok(ids(B.kbMatch('how do I get paid for my broadcasts')).some((i) => i === 'payouts' || i === 'support'), 'paid -> payouts');
assert.ok(ids(B.kbMatch('how do I get the Known mark')).includes('known'), 'known mark');
assert.ok(ids(B.kbMatch('how do I install naluno on my phone')).includes('install'), 'install');
assert.ok(B.aboutNaluno('how do I delete my account', B.kbMatch('how do I delete my account')), 'account question is about Naluno');
assert.ok(!B.aboutNaluno('write a poem about rain', B.kbMatch('write a poem about rain')), 'a poem is not a Naluno question');
assert.ok(!B.aboutNaluno('who is the president of Uganda', B.kbMatch('who is the president of Uganda')), 'world question is not about Naluno');
assert.ok(B.aboutNaluno('what is naluno', []), 'naming Naluno is about Naluno');
assert.strictEqual(B.actionFor(B.kbMatch('how do I go live')), 'golive', 'go live gets a Go live button');
const ans = B.kbAnswer(B.kbMatch('how do I delete my account'));
assert.ok(ans && ans.length > 20, 'guide answer when Compass is offline');

/* 2. The guide says nothing about how Naluno is built. */
const guideText = B.KB.map((e) => e.title + ' ' + e.body).join(' ');
['firebase', 'firestore', 'cloudflare', 'worker', 'webrtc', 'turn server', 'javascript', 'api key', 'github', 'nudenet', 'llm', 'openai', 'anthropic', 'service worker', 'indexeddb', 'duckduckgo']
  .forEach((w) => assert.ok(guideText.toLowerCase().indexOf(w) < 0, 'guide does not mention ' + w));
const scrubbed = B.scrubInternals('Naluno runs on Firebase Firestore with Cloudflare Workers and WebRTC.');
assert.ok(!/firebase|firestore|cloudflare|webrtc/i.test(scrubbed), 'internals scrubbed: ' + scrubbed);
const sp = B.systemPrompt({ name: 'Ada', today: 'Wednesday 30 September 2026' });
assert.ok(/Ada/.test(sp) && /never/i.test(sp), 'system prompt carries the name and the rules');
B.KB.forEach((e) => { if (e.url) assert.ok(/^https:\/\/getnaluno\.com\//.test(e.url), e.id + ' links only to getnaluno.com'); });
Object.keys(B.ACTIONS).forEach((k) => assert.ok(B.ACTIONS[k].label, k + ' has a label'));

/* 3. Links are judged for relevance. */
{
  const q = 'where can I buy Things Fall Apart';
  const hits = [
    { title: 'Things Fall Apart by Chinua Achebe | Barnes & Noble', url: 'https://www.barnesandnoble.com/w/things-fall-apart-chinua-achebe', snippet: 'Buy Things Fall Apart' },
    { title: 'Things Fall Apart - Wikipedia', url: 'https://en.wikipedia.org/wiki/Things_Fall_Apart', snippet: 'Things Fall Apart is a 1958 novel' },
    { title: 'Fall Guys - Play free', url: 'https://www.fallguys.com/', snippet: 'Stumble through rounds' },
    { title: 'Apartments for rent', url: 'https://www.apartments.com/', snippet: 'Find apartments' },
    { title: 'Things Fall Apart free xxx', url: 'https://www.pornhub.com/x', snippet: 'Things Fall Apart' },
  ];
  const picked = B.pickLinks(q, hits, 3, 0.5).map((h) => B.hostOf(h.url));
  assert.ok(picked.some((h) => /barnesandnoble/.test(h)), 'bookshop kept');
  assert.ok(!picked.some((h) => /fallguys|apartments|pornhub/.test(h)), 'unrelated and adult pages dropped: ' + picked);
  assert.strictEqual(B.relevance(q, hits[4]), 0, 'adult host scores zero');
  const people = B.pickLinks('who is Bobi Wine', [
    { title: 'Bobi Wine - Wikipedia', url: 'https://en.wikipedia.org/wiki/Bobi_Wine', snippet: 'Robert Kyagulanyi Ssentamu, known as Bobi Wine' },
    { title: 'Best wine bottles 2026', url: 'https://www.wine.com/list', snippet: 'Shop red wine' },
  ], 3, 0.5);
  assert.deepStrictEqual(people.map((h) => B.hostOf(h.url)), ['en.wikipedia.org'], 'only the Bobi Wine page');
  const dup = B.pickLinks('things fall apart novel', [hits[1], { title: 'Things Fall Apart (novel) - Wikipedia', url: 'https://en.wikipedia.org/wiki/TFA', snippet: 'novel' }], 3, 0.3);
  assert.strictEqual(dup.length, 1, 'one link per site');
  assert.ok(B.wantsLinks('send me a link to it') && !B.wantsLinks('how are you'), 'wantsLinks');
  const fq = B.searchQuery('where can I buy it', 'who wrote Things Fall Apart');
  assert.ok(/Things Fall Apart/i.test(fq), 'a follow-up keeps the subject: ' + fq);
}

/* 4. What Compass shows: its links and buttons, never script. */
{
  const src = read('compass.js');
  const ctx = { window: {}, document: undefined };
  ctx.window.NalunoCompassBrain = B;
  vm.createContext(ctx);
  const esc = "function escapeHtml(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\"/g,'&quot;').replace(/'/g,'&#39;');}";
  vm.runInContext(esc + '\n' + extractFn(src, 'formatCompassText') + '\n' + extractFn(src, 'compassStripForeign') + '\nthis.f = formatCompassText; this.s = compassStripForeign;', ctx);
  const html = ctx.f('See [Things Fall Apart](https://en.wikipedia.org/wiki/Things_Fall_Apart)\n\n[[open:golive]]');
  assert.ok(/<a href="https:\/\/en\.wikipedia\.org\/wiki\/Things_Fall_Apart"[^>]*>Things Fall Apart<\/a>/.test(html), 'markdown link: ' + html);
  assert.ok(/data-compass-open="golive"/.test(html), 'action button');
  assert.ok(!/\[\[open/.test(ctx.f('[[open:nothing]]')), 'unknown action dropped');
  assert.ok(!/<button/.test(ctx.f('[[open:constructor]] [[open:toString]]')), 'no action from the object prototype');
  assert.ok(!/<img/.test(ctx.f('https://a.com/x"><img src=x onerror=alert(1)>')) && /href="https:\/\/a\.com\/x"/.test(ctx.f('https://a.com/x"><img src=x>')), 'bare link stops at a quote');
  const evil = ctx.f('[<img src=x onerror=alert(1)>](https://a.com) [x](javascript:alert(1)) <script>alert(1)</script> [y](https://b.com/"onmouseover="alert(1))');
  assert.ok(!/<img|<script|href="javascript|"onmouseover=/i.test(evil), 'no injection: ' + evil);
  const kept = ctx.s('Read [A](https://a.com/x) and [B](https://evil.com/y) or https://evil.com/z and javascript:alert(1)', ['https://a.com/x']);
  assert.ok(/\[A\]\(https:\/\/a\.com\/x\)/.test(kept), 'allowed link kept');
  assert.ok(!/evil\.com|javascript:/.test(kept) && /\bB\b/.test(kept), 'foreign links reduced to text: ' + kept);
}

/* 5. Links in Writing and comments. */
{
  const L = require('./linkify.js');
  assert.strictEqual(L.normalise('www.getnaluno.com'), 'https://www.getnaluno.com/');
  assert.strictEqual(L.normalise('https://example.com/a).'), 'https://example.com/a');
  assert.strictEqual(L.normalise('javascript:alert(1)'), '');
  assert.strictEqual(L.normalise('data:text/html,hi'), '');
  assert.strictEqual(L.normalise('https://pornhub.com/x'), '');
  assert.ok(L.hasBlockedLink('see www.xvideos.com now'), 'adult link blocked');
  assert.ok(L.hasBlockedLink('[click](https://onlyfans.com/me)'), 'labelled adult link blocked');
  assert.ok(!L.hasBlockedLink('read https://en.wikipedia.org/wiki/Kampala'), 'normal link allowed');
  assert.strictEqual(L.honestLabel('https://evil.example/x', 'https://bank.com'), '', 'a label naming another site is not trusted');
  assert.strictEqual(L.honestLabel('https://www.bbc.com/news', 'BBC News'), 'BBC News');
  assert.strictEqual(L.honestLabel('https://news.bbc.co.uk/', 'bbc.co.uk'), 'bbc.co.uk');
  const space = read('broadcast-space.js');
  assert.ok(/hasBlockedLink/.test(space), 'comments refuse blocked links');
  assert.ok(/hasBlockedLink/.test(read('broadcast-composer.js')), 'Writing refuses blocked links');
  const lk = read('linkify.js');
  assert.ok(!/innerHTML\s*=\s*[^'"]*text/.test(lk), 'links are built from text, not HTML');
  assert.ok(/noopener noreferrer nofollow ugc/.test(lk), 'shared links open safely');
}

/* 6. Release stamps. */
{
  const html = read('../app/index.html');
  ['compass-brain.js', 'compass.js', 'linkify.js', 'broadcast-space.js', 'broadcast-composer.js'].forEach((f) => {
    const m = html.match(new RegExp('/js/' + f.replace(/[.-]/g, '\\$&') + '\\?v=(\\d{8}[a-z])'));
    assert.ok(m && m[1] >= '20260930a', f + ' stamp bumped');
  });
  assert.ok(html.indexOf('/js/compass-brain.js') < html.indexOf('/js/compass.js?'), 'the guide loads before Compass');
  const sw = read('../sw.js');
  assert.ok(/'\/js\/compass-brain\.js'/.test(sw) && /'\/js\/linkify\.js'/.test(sw), 'new files cached for offline');
  const build = (sw.match(/APP_BUILD = '(\d{8}[a-z])'/) || [])[1];
  assert.ok(build >= '20260930a');
}
console.log('fixes-30a tests passed');
/* 7. Follow-ups: the last question only counts when this one leans on it. */
{
  const B2 = require('./compass-brain.js');
  assert.deepStrictEqual(B2.kbMatch('where can I buy Things Fall Apart', 'how do I go live'), [], 'a new topic does not inherit the last one');
  assert.ok(B2.kbMatch('can I edit it after posting', 'how do I write a piece').some((e) => e.id === 'write'), 'a follow-up does');
  assert.ok(!B2.aboutNaluno('thanks, that worked', B2.kbMatch('thanks, that worked', 'how do I go live')), 'thanks is not a new Naluno question');
  console.log('fixes-30a follow-up tests passed');
}
