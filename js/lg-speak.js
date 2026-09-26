/* Luganda speech: orthography, then syllables, then a speakable line.
   The phone must not read Luganda as English spelling. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.NalunoLgSpeak = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  const VOWEL = { a: 1, e: 1, i: 1, o: 1, u: 1 };
  /* Longest onset first. These are real Luganda consonants, not extra vowels. */
  const ONSETS = [
    'nny', 'mp', 'nt', 'nc', 'nk', 'nd', 'mb', 'nj', 'nz', 'ng',
    'ny', 'by', 'py', 'my', 'ly', 'ty', 'kw', 'gw', 'sw', 'tw', 'dw', 'nw', 'bw',
    'bb', 'dd', 'ff', 'gg', 'jj', 'kk', 'pp', 'ss', 'tt', 'vv', 'zz', 'mm', 'nn',
    'ch', 'sh',
  ];
  const DICT = {
    ebigambo: 'ebigambo',
    kyatandika: 'chatandika',
    chatandika: 'chatandika',
    gyebale: 'jebale',
    weebale: 'weebale',
    nnyo: 'nnyo',
    oliotya: 'oliotya',
  };

  function isVowel(ch) {
    return !!VOWEL[ch];
  }

  /* ky/gy before a vowel become ch/j plus that same vowel. Never a second vowel. */
  function palatal(word) {
    return String(word || '')
      .replace(/ky([aeiou])/g, 'ch$1')
      .replace(/gy([aeiou])/g, 'j$1');
  }

  function onsetLen(s) {
    for (let i = 0; i < ONSETS.length; i++) {
      if (s.indexOf(ONSETS[i]) === 0) return ONSETS[i].length;
    }
    if (s && !isVowel(s[0]) && s[0] !== "'") return 1;
    return 0;
  }

  function syllables(word) {
    const w = palatal(String(word || '').toLowerCase());
    const out = [];
    let i = 0;
    while (i < w.length) {
      if (w[i] === "'") { i += 1; continue; }
      const start = i;
      i += onsetLen(w.slice(i));
      if (i < w.length && isVowel(w[i])) {
        i += 1;
        if (i < w.length && w[i] === w[i - 1] && isVowel(w[i])) i += 1;
      }
      if (i === start) i += 1;
      out.push(w.slice(start, i));
    }
    return out;
  }

  function speakWord(word) {
    const lower = String(word || '').toLowerCase();
    if (!lower) return word;
    if (lower.indexOf("'") !== -1) {
      return lower.split("'").map(function (part) {
        return part ? speakWord(part) : '';
      }).join("'");
    }
    if (DICT[lower]) return DICT[lower];
    return syllables(lower).join('');
  }

  function speak(text) {
    return String(text || '').replace(/[A-Za-z']+/g, function (word) {
      return speakWord(word);
    });
  }

  return { palatal: palatal, syllables: syllables, speakWord: speakWord, speak: speak };
});
