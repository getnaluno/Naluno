/* Luganda speech.
   Linguistic correctness, then intelligibility, then Luganda rhythm, then speed.
   Five vowels stay single sounds: a ɑ, e ɛ, i i, o ɔ, u u. No English diphthongs.
   Every written syllable stays audible. Nothing is swallowed, merged, or given
   an extra vowel. A doubled vowel stays long. A single vowel stays short.
   ky/gy are tʃ/dʒ plus the same vowel that is written. ny is ɲ. ng' is ŋ.
   Stress is penultimate. Lexical tone is not invented — the books do not
   mark it. phones() is what the voice receives: the same phones, one
   syllable at a time, with a space and no hyphen. speak() is still the
   spelling. This bundle has no Luganda acoustic model. Kitten must not
   phonemize the spelling as English. */
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
  /* Same onsets, as phones. ky/gy become the affricate plus the vowel that follows. */
  const ONSET_IPA = [
    ['nny', 'ɲː'],
    ['mp', 'mp'],
    ['nt', 'nt'],
    ['nc', 'ntʃ'],
    ['nk', 'ŋk'],
    ['nd', 'nd'],
    ['mb', 'mb'],
    ['nj', 'ndʒ'],
    ['nz', 'nz'],
    ['ng', 'ŋg'],
    ['ny', 'ɲ'],
    ['ky', 'tʃ'],
    ['gy', 'dʒ'],
    ['by', 'bj'],
    ['py', 'pj'],
    ['my', 'mj'],
    ['ly', 'lj'],
    ['ty', 'tj'],
    ['kw', 'kw'],
    ['gw', 'gw'],
    ['sw', 'sw'],
    ['tw', 'tw'],
    ['dw', 'dw'],
    ['nw', 'nw'],
    ['bw', 'bw'],
    ['bb', 'bː'],
    ['dd', 'dː'],
    ['ff', 'fː'],
    ['gg', 'gː'],
    ['jj', 'dʒ'],
    ['kk', 'kː'],
    ['pp', 'pː'],
    ['ss', 'sː'],
    ['tt', 'tː'],
    ['vv', 'vː'],
    ['zz', 'zː'],
    ['mm', 'mː'],
    ['nn', 'nː'],
    ['ch', 'tʃ'],
    ['sh', 'ʃ'],
  ];
  const VOWEL_IPA = { a: 'ɑ', e: 'ɛ', i: 'i', o: 'ɔ', u: 'u' };
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

  function consIpa(ch) {
    if (ch === 'c' || ch === 'q') return 'k';
    if (ch === 'r') return 'ɾ';
    if (ch === 'y') return 'j';
    if (ch === 'x') return 'ks';
    return ch;
  }

  function takeOnset(w, i) {
    if (w[i] === 'ŋ') return { raw: 'ŋ', ipa: 'ŋ' };
    const rest = w.slice(i);
    for (let k = 0; k < ONSET_IPA.length; k++) {
      if (rest.indexOf(ONSET_IPA[k][0]) === 0) {
        return { raw: ONSET_IPA[k][0], ipa: ONSET_IPA[k][1] };
      }
    }
    const ch = w[i];
    if (ch && !isVowel(ch) && ch !== "'") return { raw: ch, ipa: consIpa(ch) };
    return { raw: '', ipa: '' };
  }

  function vowelPhone(v, long) {
    if (!v) return '';
    const p = VOWEL_IPA[v] || '';
    return long ? p + 'ː' : p;
  }

  function hasVowelPhone(syl) {
    return /[ɑɛiɔu]/.test(syl);
  }

  /* ng' is ŋ. Any other apostrophe is elision: the consonants meet, no extra vowel. */
  function ipaChunk(chunk) {
    const syls = [];
    let i = 0;
    while (i < chunk.length) {
      const onset = takeOnset(chunk, i);
      let i2 = i + onset.raw.length;
      let vowel = '';
      let long = false;
      if (i2 < chunk.length && isVowel(chunk[i2])) {
        vowel = chunk[i2];
        i2 += 1;
        if (i2 < chunk.length && chunk[i2] === vowel) {
          long = true;
          i2 += 1;
        }
      }
      if (i2 === i) { i += 1; continue; }
      syls.push(onset.ipa + vowelPhone(vowel, long));
      i = i2;
    }
    if (!syls.length) return [];
    let at = syls.length >= 2 ? syls.length - 2 : 0;
    if (!hasVowelPhone(syls[at])) {
      at = -1;
      for (let n = syls.length - 1; n >= 0; n--) {
        if (hasVowelPhone(syls[n])) { at = n; break; }
      }
    }
    return syls.map(function (syl, idx) {
      return (idx === at ? 'ˈ' : '') + syl;
    });
  }

  function ipaWord(word) {
    const lower = String(word || '').toLowerCase();
    if (!lower) return '';
    const marked = lower.replace(/ng'/g, 'ŋ');
    return marked.split("'").map(function (chunk) {
      return ipaChunk(chunk).join('');
    }).join('');
  }

  /* Same phones as ipa(), with a space between syllables so a neighbour
     is not swallowed. The apostrophe of elision still joins, with no
     vowel invented in the gap. */
  function phonesWord(word) {
    const lower = String(word || '').toLowerCase();
    if (!lower) return '';
    const marked = lower.replace(/ng'/g, 'ŋ');
    return marked.split("'").map(function (chunk) {
      return ipaChunk(chunk).join(' ');
    }).filter(Boolean).join('');
  }

  function ipa(text) {
    return String(text || '').replace(/[A-Za-z']+/g, function (word) {
      return ipaWord(word);
    });
  }

  function phones(text) {
    return String(text || '').replace(/[A-Za-z']+/g, function (word) {
      return phonesWord(word);
    });
  }

  return { palatal: palatal, syllables: syllables, speakWord: speakWord, speak: speak, ipa: ipa, phones: phones };
});