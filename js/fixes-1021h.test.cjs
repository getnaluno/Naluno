/* 21 Oct h: the legal pages speak for Naluno anywhere, not for one country. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const R = path.resolve(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(R, f), 'utf8');
let n = 0;
const t = (name, fn) => { fn(); n++; console.log('ok ' + n + ' - ' + name); };
const LEGAL = ['terms.html', 'terms/index.html', 'privacy.html', 'privacy/index.html', 'js/legal-privacy.js', 'child-safety.html', 'child-safety/index.html'];
t('no legal page names Uganda or a Ugandan service', () => {
  for (const f of LEGAL) assert.ok(!/\bUgand(a|an|ans)\b|\bKampala\b|\bSauti\b|\bUGX\b/i.test(read(f)), f);
});
t('the in-app Terms do not name Uganda', () => {
  const s = read('js/onboard.js');
  const m = s.match(/function nalunoTermsHtml[\s\S]*?\n}\n/);
  assert.ok(m, 'nalunoTermsHtml found');
  assert.ok(!/\bUgand(a|an)\b/.test(m[0]));
});
t('child safety still sends people to the police and a child helpline', () => {
  for (const f of ['child-safety.html', 'child-safety/index.html']) {
    const s = read(f);
    assert.ok(/contact the local police first/.test(s) && /child helpline/.test(s) && /childhelplineinternational\.org/.test(s), f);
    assert.ok(/child-protection laws of the countries where it is used/.test(s), f);
    assert.ok(/EJ Magambo/.test(s) && /naluno@getnaluno\.com/.test(s), f);
  }
  assert.strictEqual(read('child-safety.html'), read('child-safety/index.html'));
});
t('privacy still lists mobile-money collection, word for word in all copies', () => {
  const body = (s) => (s.match(/<p>Google Firebase[\s\S]*?<\/p>/) || [''])[0];
  const a = body(read('privacy.html')), b = body(read('privacy/index.html')), c = body(read('js/legal-privacy.js'));
  assert.ok(/mobile-money collection beside Stripe/.test(a));
  assert.strictEqual(a, b); assert.strictEqual(a, c);
});
t('mobile money in the app itself is unchanged (it only works with Uganda numbers)', () => {
  assert.ok(/\^2567\\d\{8\}\$/.test(read('js/economy-ui.js')));
});
console.log('1..' + n);
