const assert = require('assert');
const Pass = require('./pass-on.js');

const piece = 'The kettle was already singing when the street went quiet and the last cup was poured for the neighbour who had walked across the rain.';
const magambo = {
  id: 'b-magambo',
  creatorUid: 'uid-magambo',
  creatorName: 'Magambo',
  title: 'The kettle',
  body: piece,
  createdAt: 10,
};
const later = Object.assign({}, magambo, { id: 'b-later', createdAt: 50, creatorName: 'Magambo' });

assert.strictEqual(Pass.isWordCopy(piece, piece), true);
assert.strictEqual(Pass.isWordCopy('too short', piece), false);
assert.strictEqual(
  Pass.findCredit(piece, [later, magambo, { id: 'mine', creatorUid: 'aster', creatorName: 'Aster', body: piece, createdAt: 1 }], 'aster').creatorName,
  'Magambo'
);
assert.strictEqual(Pass.findCredit(piece, [magambo], 'uid-magambo'), null);

const words = [];
for (let i = 0; i < 300; i++) words.push('word' + i);
const long = words.join(' ');
const almostWords = words.slice();
almostWords[40] = 'changed';
assert.strictEqual(Pass.isWordCopy(long, almostWords.join(' ')), true);
assert.strictEqual(Pass.isWordCopy(piece, piece.replace('neighbour', 'friend')), false);

const credit = Pass.findCredit(piece, [magambo], 'aster');
assert.strictEqual(Pass.byline(credit), 'Original Broadcast by Magambo');
assert.strictEqual(Pass.lockedCredit({ creatorUid: 'aster', originCredit: credit }).creatorName, 'Magambo');
assert.strictEqual(Pass.lockedCredit({ creatorUid: 'uid-magambo', originCredit: credit }), null);

const passed = Pass.creditForShare({
  id: 'aster-copy',
  creatorUid: 'aster',
  creatorName: 'Aster',
  title: 'The kettle',
  originCredit: credit,
});
assert.strictEqual(passed.creatorName, 'Magambo');
assert.strictEqual(passed.broadcastId, 'b-magambo');
assert.strictEqual(passed.locked, true);

const fresh = Pass.creditForShare({ id: 'vid', creatorUid: 'uid-magambo', creatorName: 'Magambo', title: 'Pour' });
assert.strictEqual(fresh.creatorName, 'Magambo');
assert.strictEqual(Pass.textKey(piece), Pass.textKey(piece));
assert.notStrictEqual(Pass.textKey(piece), Pass.textKey(piece + ' extra sentence about the rain and the street and the cup'));

assert.strictEqual(Pass.coverUrl({ mediaType: 'writing', thumbUrl: 'https://upload.example/o/b/photo-1' }), 'https://upload.example/o/b/photo-1');
assert.strictEqual(Pass.coverUrl({ mediaType: 'writing', mediaUrl: 'https://upload.example/o/b/clip.mp4' }), '');
assert.strictEqual(Pass.coverUrl({ mediaType: 'video', thumbUrl: 'https://upload.example/o/b/photo-1' }), '');

console.log('pass-on tests passed');
