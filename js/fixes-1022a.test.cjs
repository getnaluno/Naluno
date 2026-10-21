/* 22 Oct a: Compass went round in circles, invented film titles, showed
   "From the app:", and was slow; the console's Compass check said
   "Sign in to use Compass". */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const R = path.resolve(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(R, f), 'utf8');
const B = require('./compass-brain.js');
let n = 0;
const t = (name, fn) => { fn(); n++; console.log('ok ' + n + ' - ' + name); };
const LOOP = 'From the app: As of 2026, I found that "Avatar: The Way of Water" was followed by a new release. ' + Array(8).fill('The newest movie is "Avatar 3" no. I have the correct title: The newest movie is "Avatar: The Last Shadow" no.').join(' ');

t('the looping reply the founder saw is recognised as broken', () => {
  const c = B.cutLoops(LOOP);
  assert.ok(c.broken && c.repeats >= 3);
});
t('normal answers, lists and short repeated words are left whole', () => {
  const list = '1. Make a budget.\n2. Save first.\n3. Cook at home.\n4. Walk when you can.\n5. Review it monthly.';
  assert.strictEqual(B.cutLoops(list).text, list);
  const yes = 'Yes. Yes. Yes. Paris is the capital of France.';
  assert.strictEqual(B.cutLoops(yes).repeats, 0);
});
t('"From the app:" never starts an answer', () => {
  assert.strictEqual(B.scrubMeta('From the app: the Nile is about 6,650 km long.'), 'The Nile is about 6,650 km long.');
  assert.ok(!/From the app/.test(B.systemPrompt({})));
});
t('Compass is told its memory is old and not to invent titles or repeat itself', () => {
  const s = B.systemPrompt({ today: 'Thu Oct 22 2026' });
  assert.ok(/memory stops around the end of 2023/.test(s) && /Never make up a title/.test(s) && /never repeat a sentence/.test(s) && /Today is Thu Oct 22 2026/.test(s));
});
t('a follow-up like "that is older, there is a newer release" searches the earlier subject, this year', () => {
  const q = B.searchQuery('Way of water is older. There is a newer release', 'What is the latest Avatar movie?');
  assert.ok(/Avatar/i.test(q) && /water/i.test(q) && new RegExp(String(new Date().getFullYear())).test(q), q);
  assert.ok(!/\bolder\b/.test(q));
});
t('a found page about the newer film is not thrown away for missing "newer" or "release"', () => {
  assert.ok(B.covers('Way of water is older. There is a newer release', 'Avatar: Fire and Ash (2025), the sequel to Avatar: The Way of Water'));
  assert.ok(!B.covers('capital city of Uganda', 'Capital punishment in Uganda'), 'the 20g guard still holds');
});
t('with nothing current found, a question about something new is answered honestly', () => {
  const m = B.buildRequest({ question: 'What is the newest Avatar film?', today: 'x' });
  assert.ok(/Do not guess/.test(m[m.length - 1].content));
  const m2 = B.buildRequest({ question: 'What is the newest Avatar film?', facts: 'Avatar: Fire and Ash (2025)' });
  assert.ok(!/Do not guess/.test(m2[m2.length - 1].content));
  const m3 = B.buildRequest({ question: 'Explain photosynthesis' });
  assert.ok(!/Do not guess/.test(m3[m3.length - 1].content));
});
t('the app: web search capped at 3.5 s, sign-in and hints fetched alongside, loops not shown', () => {
  const s = read('js/compass.js');
  assert.ok(/Promise\.race\(\[Promise\.all\(jobs\), new Promise\(function\(r\)\{ setTimeout\(r, 3500\)/.test(s));
  assert.ok(/const tokenP = currentUser\.getIdToken\(\)/.test(s) && /const idToken = await tokenP;/.test(s));
  assert.ok(/Brain\.cutLoops\(raw\)/.test(s) && /looped\.broken/.test(s));
  assert.ok(/Brain\.retryMessages\(messages, first\.data\.reply\)/.test(s), 'a refusal that got through is still asked again once');
});
t('the console check: signs in from the console app, flags loops, asks a newer-things question', () => {
  const s = read('js/admin-compass-check.js');
  assert.ok(/firebase\.app\('naluno-console'\)/.test(s));
  assert.ok(/WENT IN CIRCLES/.test(s) && /newest film in the Avatar series/.test(s));
  assert.ok(/the console is not signed in to an account/.test(s));
});
t('the Compass worker: a repeat penalty, loops asked again calmer, sign-in remembered', () => {
  const s = read('workers/compass/index.js');
  assert.ok(/frequency_penalty: 0\.4/.test(s) && /const CALM/.test(s) && /seenTokens/.test(s));
  assert.ok(/VERSION = "2\.1\.0-20261022a"/.test(s));
});
console.log('1..' + n);
