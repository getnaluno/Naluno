/* 21 Oct f: Compass gets one clear brief and stops refusing what it can do;
   the child safety contact and the email. Run: node js/fixes-1021f.test.cjs */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const B = require('./compass-brain.js');

/* 1. One instruction message; the app's notes with the question; no old refusals. */
{
  const msgs = B.buildRequest({
    name: 'EJ', today: 'Wed Oct 21 2026', guide: 'Wireline: private messages.', onNaluno: false,
    facts: 'The Nile is about 6,650 km long.', weather: '', find: '', luganda: '',
    history: [
      { from: 'user', text: 'hi' }, { from: 'compass', text: 'Hello EJ!' },
      { from: 'user', text: 'search the news' }, { from: 'compass', text: "I'm sorry, I don't have access to the internet." },
      { from: 'compass', text: '…', thinking: true },
      { from: 'user', text: 'How long is the Nile?' },
    ],
    question: 'How long is the Nile?',
  });
  assert.strictEqual(msgs.filter((m) => m.role === 'system').length, 1);
  assert.strictEqual(msgs[0].role, 'system');
  assert.ok(/Never say you cannot search, browse/.test(msgs[0].content) && /Naluno guide:/.test(msgs[0].content) && /Wed Oct 21 2026/.test(msgs[0].content));
  const last = msgs[msgs.length - 1];
  assert.strictEqual(last.role, 'user');
  assert.ok(/^From the app, for this question:/.test(last.content) && /6,650 km/.test(last.content) && /Question: How long is the Nile\?$/.test(last.content));
  assert.ok(!msgs.some((m) => /don't have access/.test(m.content)), 'the old refusal is not taught back');
  assert.ok(!msgs.some((m) => m.content === '…'));
  for (let i = 1; i < msgs.length; i++) assert.notStrictEqual(msgs[i].role, msgs[i - 1].role, 'turns alternate');
  assert.strictEqual(msgs[1].role, 'user');
  const plain = B.buildRequest({ history: [{ from: 'user', text: 'Write a poem' }], question: 'Write a poem' });
  assert.strictEqual(plain[plain.length - 1].content, 'Write a poem', 'no notes block when nothing was looked up');
}
/* 2. Refusals told apart from good answers; tasks skip the web lookup. */
{
  assert.ok(B.isRefusal("I'm sorry, but I don't have access to real-time information."));
  assert.ok(B.isRefusal('As an AI, I cannot browse the internet.'));
  assert.ok(!B.isRefusal('If you are not able to sign in, tap Forgot password.'));
  assert.ok(!B.isRefusal('Kampala is the capital of Uganda.'));
  assert.ok(/You can do this/.test(B.retryMessages([{ role: 'user', content: 'q' }], 'no').pop().content));
  assert.strictEqual(B.needsLookup('Write a poem about rain'), false);
  assert.strictEqual(B.needsLookup('What is 15% of 240000?'), false);
  assert.strictEqual(B.needsLookup('Who is the president of Kenya?'), true);
}
/* 3. compass.js uses them: one request shape, one retry, place and weather only when asked. */
{
  const c = read('js/compass.js');
  assert.ok(/Brain\.buildRequest\(\{/.test(c) && /Brain\.isRefusal\(first\.data\.reply\)/.test(c) && /Brain\.retryMessages\(messages, first\.data\.reply\)/.test(c));
  assert.ok(!/messages\.unshift\(/.test(c), 'no separate instruction messages any more');
  assert.ok(/if\(\/\\b\(phone\|phones\|where/.test(c) && /if\(\/\\b\(weather\|rain/.test(c), 'place and weather only when the question is about them');
  assert.ok(/const weak = \(Bw && typeof Bw\.isRefusal === 'function'\) \? Bw\.isRefusal\(out\)/.test(c), 'good answers are no longer thrown away over a phrase');
  assert.ok(/Brain\.needsLookup\(text\)/.test(c));
}
/* 4. The new Compass worker is free and in-house; the desk can check Compass. */
{
  const w = read('workers/compass/index.js');
  assert.ok(/@cf\/meta\/llama-3\.3-70b-instruct-fp8-fast/.test(w) && /env\.AI\.run/.test(w) && !/api\.openai|anthropic|generativelanguage/.test(w), 'Cloudflare Workers AI only');
  assert.ok(/\[ai\]\s*binding = "AI"/.test(read('workers/compass/wrangler.toml')));
  assert.ok(/id="compassCheckBtn"/.test(read('js/admin-compass-check.js')));
  assert.ok(/naluno-compass\.naluno\.workers\.dev\/health/.test(read('js/admin-deploy.js')));
  assert.ok(/<script src="\/js\/admin-compass-check\.js\?v=/.test(read('admin/index.html')));
}
/* 5. EJ Magambo is the child safety contact; the email is published where people look for it. */
{
  ['child-safety/index.html', 'child-safety.html'].forEach((f) => {
    const s = read(f);
    assert.ok(/<strong>EJ Magambo<\/strong>: <a href="mailto:naluno@getnaluno\.com">naluno@getnaluno\.com<\/a>/.test(s), f);
  });
  ['js/legal-privacy.js', 'privacy.html', 'privacy/index.html'].forEach((f) => {
    const s = read(f);
    assert.ok(/You can also email <a href="mailto:naluno@getnaluno\.com">naluno@getnaluno\.com<\/a>/.test(s) && !/mailbox itself is not published/.test(s), f);
  });
  ['terms.html', 'terms/index.html', 'js/onboard.js'].forEach((f) => assert.ok(/naluno@getnaluno\.com/.test(read(f)), f));
}
console.log('fixes-1021f: all checks passed');
