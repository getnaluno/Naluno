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

const cha = Lg.ipa('kyatandika');
assert.strictEqual(cha, Lg.ipa('chatandika'));
assert.ok(cha.indexOf('t\u0283') !== -1, 'ky is tʃ plus the same vowel');
assert.strictEqual(cha.indexOf('\u02d0'), -1, 'short ta is not lengthened');
assert.strictEqual(cha.indexOf('aa'), -1);
assert.strictEqual(cha.indexOf('-'), -1);
assert.strictEqual(cha.indexOf(' '), -1);
assert.ok(cha.indexOf('\u0251\u02c8ndi') !== -1, 'stress sits on ndi, not inside ta');

assert.strictEqual(Lg.ipa('omuntu'), '\u0254\u02c8muntu');
assert.strictEqual(Lg.ipa('omuntu').indexOf('\u028a'), -1);
assert.strictEqual(Lg.ipa('omuntu').indexOf('\u0259'), -1);

assert.strictEqual(Lg.ipa('Katonda'), 'k\u0251\u02c8t\u0254nd\u0251');
assert.strictEqual(Lg.ipa('Katonda').indexOf('e'), -1);
assert.strictEqual(Lg.ipa('Katonda').indexOf('\u026a'), -1);

assert.ok(Lg.ipa('baasulayo').indexOf('\u0251\u02d0') !== -1);
assert.strictEqual(Lg.ipa('baasulayo').indexOf('\u0251\u02d0\u02d0'), -1);
assert.strictEqual(Lg.ipa('baasulayo').indexOf('\u0251\u0251'), -1);
assert.strictEqual(Lg.speak('baasulayo').indexOf('-'), -1);

assert.strictEqual(Lg.ipa('nyumba').indexOf('niy'), -1);
assert.ok(Lg.ipa('nyumba').indexOf('\u0272') !== -1);
assert.ok(Lg.ipa('ekkomo').indexOf('k\u02d0') !== -1);
assert.ok(Lg.ipa("ng'ombe").indexOf('\u014b') !== -1);
assert.strictEqual(Lg.ipa("ng'ombe").indexOf('-'), -1);
assert.ok(Lg.ipa('Mityana').indexOf('tj') !== -1);
assert.strictEqual(Lg.ipa('Mityana').indexOf('\u026a'), -1);
assert.strictEqual(Lg.ipa("Eno y'entandikwa.").indexOf('-'), -1);

const paced = Lg.phones('kyatandika');
assert.strictEqual(paced.replace(/ /g, ''), Lg.ipa('kyatandika'));
assert.ok(paced.indexOf(' ') !== -1);
assert.strictEqual(paced.indexOf('-'), -1);
assert.strictEqual(paced.indexOf('\u0251\u02d0'), -1);
assert.strictEqual(Lg.phones('omuntu').replace(/ /g, ''), Lg.ipa('omuntu'));
assert.strictEqual(Lg.phones('Katonda').indexOf('e'), -1);
assert.ok(Lg.phones('Mityana').indexOf('tj') !== -1);

console.log('lg-speak tests passed');
