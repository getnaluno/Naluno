const assert = require('assert');
const Lg = require('./lg-speak.js');

assert.deepStrictEqual(Lg.syllables('ebigambo'), ['e', 'bi', 'ga', 'mbo']);
assert.strictEqual(Lg.speak('ebigambo'), 'ebigambo');
assert.strictEqual(Lg.speak('ebigambo').indexOf('-'), -1);
assert.strictEqual(Lg.speak('ebigambo').indexOf(' '), -1);

assert.strictEqual(Lg.speakWord('kyatandika'), 'chatandika');
assert.deepStrictEqual(Lg.syllables('kyatandika'), ['cha', 'ta', 'ndi', 'ka']);
assert.strictEqual(Lg.speakWord('kyatandika').indexOf('aa'), -1);
assert.strictEqual(Lg.speakWord('Kyatandika').indexOf('aa'), -1);

assert.deepStrictEqual(Lg.syllables('nyumba'), ['nyu', 'mba']);
assert.ok(Lg.speakWord('nyumba').indexOf('niy') === -1);

assert.deepStrictEqual(Lg.syllables('entandikwa'), ['e', 'nta', 'ndi', 'kwa']);
assert.strictEqual(Lg.speakWord('baasulayo').indexOf('aaa'), -1);
assert.ok(Lg.speakWord('baasulayo').indexOf('aa') !== -1);
assert.deepStrictEqual(Lg.syllables('ekkomo'), ['e', 'kko', 'mo']);
assert.strictEqual(Lg.speak("Eno y'entandikwa."), "eno y'entandikwa.");
assert.strictEqual(Lg.speak('Gyebale'), 'jebale');

console.log('lg-speak tests passed');
