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

  /* ---------------- 05 Oct (g): Luganda as it is spoken ----------------
     Built from the published description of Luganda sounds (Wikipedia,
     "Luganda", Phonology), not from English spelling:
     - Five pure vowels a e i o u. Length is real: a doubled vowel is long.
       A vowel is also long before a nasal + consonant (mb, nd, ng, nj, nz,
       nt, nk, nc, ns, mp, mv, nf…) and after a consonant + w/y (kw, bw,
       gw, ky, gy, by, ly…). A vowel before a doubled consonant is short.
     - c is "ch" [tʃ], j is [dʒ]; k before i or y is [tʃ], g before i or y
       is [dʒ] (ekitabo ≈ "echitabo", ky ≈ "ch").
     - ny is one sound [ɲ]; ŋ / ng' is [ŋ]; ng without the apostrophe is
       [ŋg].
     - l and r are one sound: a tap [ɾ] after e or i, [l] elsewhere.
     - Doubled consonants are long, also at the start of a word (bbiri,
       kkumi); a doubled l is [d].
     - No English stress pattern is added; Luganda is a tone language and
       its tones are not written, so none are invented.
     These phones go straight to the voice model; the English phonemizer
     never sees Luganda. */
  const LG_V = { a: 'a', e: 'e', i: 'i', o: 'o', u: 'u' };
  const LG_C = { b: 'b', c: 'tʃ', d: 'd', f: 'f', g: 'ɡ', h: 'h', j: 'dʒ', k: 'k', m: 'm', n: 'n', p: 'p', s: 's', t: 't', v: 'v', w: 'w', y: 'j', z: 'z', x: 'ks', q: 'k' };
  const NASAL_NEXT = /[bpfvdtszjckgy]/;
  function isV(ch) { return !!LG_V[ch]; }
  function liquid(prevVowel) { return (prevVowel === 'e' || prevVowel === 'i') ? 'ɾ' : 'l'; }
  function cons(ch, next) {
    if ((ch === 'k' || ch === 'g') && (next === 'i' || next === 'y')) return ch === 'k' ? 'tʃ' : 'dʒ';
    return LG_C[ch] || '';
  }
  function lgWord(raw) {
    let w = String(raw || '').toLowerCase().replace(/ng'/g, 'ŋ').replace(/['’]/g, '');
    w = w.replace(/[^a-zŋ]/g, '');
    if (!w) return '';
    let out = '';
    let lastV = '';
    let i = 0;
    while (i < w.length) {
      const ch = w[i];
      const nx = w[i + 1] || '';
      if (isV(ch)) {
        let long = false;
        let step = 1;
        if (nx === ch) { long = true; step = 2; }
        const after = w.slice(i + step);
        const before = w.slice(Math.max(0, i - 2), i);
        const geminateNext = after.length >= 2 && !isV(after[0]) && after[0] === after[1];
        const prenasal = /^(nn?y|ŋ|[mn][bpfvdtszjckgy])/.test(after) && !/^nn/.test(after);
        const glideBefore = before.length === 2 && !isV(before[0]) && before !== 'ny' && (before[1] === 'w' || before[1] === 'y');
        if (!geminateNext && (prenasal && !/^nny/.test(after) && !/^ny/.test(after) || glideBefore)) long = true;
        if (geminateNext) long = false;
        /* "At the end of a word, all vowels are pronounced short." */
        if (i + step >= w.length) long = false;
        out += LG_V[ch] + (long ? 'ː' : '');
        lastV = ch;
        i += step;
        continue;
      }
      if (ch === 'c' && nx === 'h') { out += 'tʃ'; i += 2; continue; }
      if (ch === 's' && nx === 'h') { out += 'ʃ'; i += 2; continue; }
      if (ch === 'ŋ') { out += (nx === 'ŋ') ? 'ŋː' : 'ŋ'; i += (nx === 'ŋ') ? 2 : 1; continue; }
      if (ch === 'n' && nx === 'n' && w[i + 2] === 'y') { out += 'ɲː'; i += 3; continue; }
      if (ch === 'n' && nx === 'y') { out += 'ɲ'; i += 2; continue; }
      if (ch === 'n' && nx === 'g') {
        const soft = (w[i + 2] === 'i' || w[i + 2] === 'y');
        out += (soft ? 'ɲ' : 'ŋ') + cons('g', w[i + 2] || '');
        i += (w[i + 2] === 'y') ? 3 : 2;
        continue;
      }
      if (ch === 'n' && nx === 'k') { out += 'ŋ'; i += 1; continue; }
      if (ch === 'l' || ch === 'r') {
        if (nx === 'l' || nx === 'r') { out += 'dː'; i += 2; continue; }
        out += liquid(lastV); i += 1; continue;
      }
      if (nx === ch && LG_C[ch]) {
        out += cons(ch, w[i + 2] || '') + 'ː';
        i += 2;
        continue;
      }
      if ((ch === 'k' || ch === 'g') && nx === 'y') { out += cons(ch, 'y'); i += 2; continue; }
      out += cons(ch, nx);
      i += 1;
    }
    return out;
  }
  /* Text to phones, word by word, punctuation kept as the pause marks. */
  function voice(text) {
    return String(text || '')
      .replace(/[A-Za-zŊŋ'’]+/g, function (word) { return lgWord(word); })
      .replace(/[ \t]+/g, ' ')
      .trim();
  }
  /* Does this text read as Luganda? Luganda words end in a vowel and use
     its own little words; English mostly does not. */
  const LG_COMMON = { ne: 1, mu: 1, ku: 1, era: 1, nti: 1, oba: 1, naye: 1, bwe: 1, kye: 1, nga: 1, ye: 1, nnyo: 1, abantu: 1, ate: 1, kubanga: 1, olw: 1, nnyini: 1, buli: 1, kati: 1, tewali: 1, wano: 1, eri: 1, bino: 1, ebyo: 1, kino: 1, ekyo: 1, oluvannyuma: 1, webale: 1, weebale: 1, gyebale: 1, mwattu: 1, ssebo: 1, nnyabo: 1, katonda: 1 };
  function looksLuganda(text) {
    const words = (String(text || '').toLowerCase().match(/[a-zŋ']+/g) || []).filter(function (x) { return x.length > 1; });
    if (words.length < 4) return false;
    let vowelEnd = 0, marks = 0, lgShape = 0, english = 0;
    words.forEach(function (x) {
      if (/[aeiou]$/.test(x)) vowelEnd++;
      if (LG_COMMON[x]) marks++;
      if (/^(omu|aba|eki|ebi|oku|olu|aka|obu|ama|en|em|ab|eb|ok|ol)/.test(x) || /ny|ng'|ŋ|aa|ee|ii|oo|uu|bb|kk|ss|tt|gg|mm|nn|ll/.test(x)) lgShape++;
      if (/^(the|and|of|to|is|in|that|it|for|was|with|you|this|are|have|be|on|not|they|we|he|she|but|at|from|by|or|what|all|were|when|there|can|an|your|which|their|if|do|will|my|has|our|its)$/.test(x)) english++;
    });
    const n = words.length;
    return vowelEnd / n >= 0.8 && english / n < 0.08 && (marks + lgShape) / n >= 0.25;
  }

  return { palatal: palatal, syllables: syllables, speakWord: speakWord, speak: speak, ipa: ipa, phones: phones, voice: voice, word: lgWord, looksLuganda: looksLuganda };
});