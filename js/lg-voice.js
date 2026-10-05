/* Luganda voice (05 Oct h).

   Luganda is never read with English rules. The order, every time:

     1. Language   Each sentence is told apart: Luganda, English, or English
                   with Luganda names in it.
     2. Model      A Luganda sentence goes to a voice trained on Luganda
                   speakers (Sunbird's Luganda voice, through Naluno's
                   economy worker). It knows Luganda's sounds, length and
                   tones, which no rule written here can give.
     3. Rules      If that voice is not set up or cannot be reached, the
                   on-device voice is given Luganda SOUNDS, never Luganda
                   spelling: the lexicon below first, then the rules in
                   lg-speak.js (five pure vowels, length, ky/gy, ny, ŋ,
                   l/r, doubled consonants, short word-final vowels).
                   The English phonemizer never sees a Luganda word.
     4. Speech     A moderate pace (a little slower than English); every
                   syllable spoken; no English stress.

   Priorities: linguistic correctness, then intelligibility, then natural
   Luganda rhythm, then speed.

   The permanent test suite is js/lg-suite.json (+ js/lg-suite.test.cjs).
   Every change to the voice system must pass it. Lexicon entries marked
   "check" in the suite are waiting for a native speaker's review
   (voices/lg-review.html plays each one). */
(function (root, factory) {
  var Lg = root.NalunoLgSpeak || (typeof require === 'function' ? require('./lg-speak.js') : null);
  var api = factory(root, Lg);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.NalunoLgVoice = api;
})(typeof window !== 'undefined' ? window : globalThis, function (root, Lg) {
  /* ---------------- Lexicon ----------------
     Exact sounds for words and names Naluno uses often, where the plain
     rules are not enough or a name must never be anglicised. Phones use
     the same symbols as lg-speak.js: a e i o u, ː for length, tʃ dʒ ɲ ŋ ɾ. */
  var LEX = {
    /* Words from the brief */
    chatandika: 'tʃataːndika', katonda: 'katoːnda', ebigambo: 'ebiɡaːmbo',
    /* Greetings and everyday words */
    weebale: 'weːbale', webale: 'webale', nnyo: 'ɲːo', ssebo: 'sːebo', nnyabo: 'ɲːabo',
    gyebale: 'dʒeːbale', oli: 'oli', otya: 'otja', mwattu: 'mwatːu', bulungi: 'buluːɲdʒi',
    yee: 'je', nedda: 'nedːa', kale: 'kale', osiibye: 'osiːbje', wasuze: 'wasuze',
    tusanyuse: 'tusaɲuse', mukwano: 'mukwaːno', banange: 'banaːŋɡe', ssanyu: 'sːaɲu',
    emirembe: 'emiɾeːmbe', amaanyi: 'amaːɲi', obulamu: 'obulamu', omukwano: 'omukwaːno',
    naluno: 'naluno', oluganda: 'oluɡaːnda', luganda: 'luɡaːnda',
    /* Names, places: Luganda names are said the Luganda way, in any text */
    kampala: 'kaːmpala', buganda: 'buɡaːnda', uganda: 'uɡaːnda', kabaka: 'kabaka',
    mengo: 'meːŋɡo', mukono: 'mukono', entebbe: 'eːntebːe', jinja: 'dʒiːndʒa',
    masaka: 'masaka', mityana: 'mitjaːna', mpigi: 'mpiɡi', wakiso: 'watʃiso',
    luweero: 'luweːɾo', mubende: 'mubeːnde', mbarara: 'mbaɾaɾa', lubaga: 'lubaɡa',
    namirembe: 'namiɾeːmbe', kasubi: 'kasubi', makerere: 'makeɾeɾe', kibuli: 'tʃibuli',
    nakawa: 'nakawa', ntinda: 'ntiːnda', kawempe: 'kaweːmpe', nansana: 'nansana',
    nakato: 'nakato', babirye: 'babiɾje', kato: 'kato', wasswa: 'wasːwa', mukasa: 'mukasa',
    kiwanuka: 'tʃiwanuka', ssekandi: 'sːekaːndi', muwanga: 'muwaːŋɡa', nnalubaale: 'nːalubaːle',
    nalubega: 'nalubeɡa', namukasa: 'namukasa', nansubuga: 'nansubuɡa', ssemakula: 'sːemakula',
    kizza: 'tʃizːa', kintu: 'tʃiːntu', nambi: 'naːmbi', walumbe: 'waluːmbe', mutesa: 'mutesa',
    muteesa: 'muteːsa', mwanga: 'mwaːŋɡa', nalongo: 'naloːŋɡo', ssalongo: 'sːaloːŋɡo',
    ssese: 'sːese', kalangala: 'kalaːŋɡala', nakasongola: 'nakasoːŋɡola', nankya: 'naːɲtʃa',
    ssebunya: 'sːebuɲa', nakimuli: 'natʃimuli', jjajja: 'dʒːadʒːa',
    /* Days and months */
    bbalaza: 'bːalaza', lwakubiri: 'lwaːkubiɾi', lwakusatu: 'lwaːkusatu', lwakuna: 'lwaːkuna',
    lwakutaano: 'lwaːkutaːno', lwamukaaga: 'lwaːmukaːɡa', ssabbiiti: 'sːabːiːti',
    janwaliyo: 'dʒanwaːlijo', febwaliyo: 'febwaːlijo', maaki: 'maːki', apuli: 'apuli',
    maayi: 'maːji', juuni: 'dʒuːni', julaayi: 'dʒulaːji', agusito: 'aɡusito',
    sebuttemba: 'sebutːeːmba', okitobba: 'otʃitobːa', novemba: 'noveːmba', desemba: 'deseːmba',
  };
  /* Proper names (said the Luganda way inside English too). */
  var NAMES = {};
  ['kampala', 'buganda', 'uganda', 'kabaka', 'mengo', 'mukono', 'entebbe', 'jinja', 'masaka', 'mityana',
   'mpigi', 'wakiso', 'luweero', 'mubende', 'mbarara', 'lubaga', 'namirembe', 'kasubi', 'makerere',
   'kibuli', 'nakawa', 'ntinda', 'kawempe', 'nansana', 'nakato', 'babirye', 'kato', 'wasswa', 'mukasa',
   'kiwanuka', 'ssekandi', 'muwanga', 'nnalubaale', 'nalubega', 'namukasa', 'nansubuga', 'ssemakula',
   'kizza', 'kintu', 'nambi', 'walumbe', 'mutesa', 'muteesa', 'mwanga', 'nalongo', 'ssalongo', 'ssese',
   'kalangala', 'nakasongola', 'nankya', 'ssebunya', 'nakimuli', 'katonda', 'luganda', 'oluganda',
   'jjajja', 'naluno'].forEach(function (k) { NAMES[k] = 1; });

  /* ---------------- Numbers ----------------
     Counting forms (Wikipedia, Luganda – Numerals): 12 = kkumi na bbiri,
     22 = amakumi abiri mu bbiri. Numbers 1–5 agree with the noun in real
     speech (abantu babiri); a written figure is read in its counting form. */
  var UNIT = ['', 'emu', 'bbiri', 'ssatu', 'nnya', 'ttaano', 'mukaaga', 'musanvu', 'munaana', 'mwenda'];
  var TENS = ['', 'kkumi', 'amakumi abiri', 'amakumi asatu', 'amakumi ana', 'amakumi ataano', 'nkaaga', 'nsanvu', 'kinaana', 'kyenda'];
  var HUND = ['', 'kikumi', 'bibiri', 'bisatu', 'bina', 'bitaano', 'lukaaga', 'lusanvu', 'lunaana', 'lwenda'];
  var THOU = ['', 'lukumi', 'enkumi bbiri', 'enkumi ssatu', 'enkumi nnya', 'enkumi ttaano', 'kakaaga', 'kasanvu', 'kanaana', 'kenda'];
  var TENTHOU = ['', 'omutwalo', 'emitwalo ebiri', 'emitwalo esatu', 'emitwalo ena', 'emitwalo etaano', 'emitwalo mukaaga', 'emitwalo musanvu', 'emitwalo munaana', 'emitwalo mwenda'];
  function under100(n) {
    if (n < 10) return UNIT[n];
    var t = Math.floor(n / 10), u = n % 10;
    if (!u) return TENS[t];
    if (t === 1) return u === 1 ? "kkumi n'emu" : 'kkumi na ' + UNIT[u];
    return TENS[t] + ' mu ' + UNIT[u];
  }
  function number(n) {
    n = Math.floor(Number(n));
    if (!(n >= 0) || n > 99999) return null;
    if (n === 0) return 'zeero';
    var parts = [];
    var tt = Math.floor(n / 10000), th = Math.floor(n / 1000) % 10, h = Math.floor(n / 100) % 10, rest = n % 100;
    if (tt) { if (th || h || rest) return null; return TENTHOU[tt]; }
    if (th) parts.push(THOU[th]);
    if (h) parts.push(HUND[h]);
    if (rest) parts.push(under100(rest));
    return parts.join(' mu ');
  }
  function digits(s) {
    return String(s).split('').map(function (d) { return d === '0' ? 'zeero' : UNIT[Number(d)]; }).join(' ');
  }
  /* Figures in a Luganda sentence become Luganda words. */
  function expand(text) {
    return String(text || '').replace(/\d[\d,]*(?:\.\d+)?/g, function (m) {
      var clean = m.replace(/,(?=\d{3}\b)/g, '');
      if (/\./.test(clean)) return clean.split('.').map(function (x) { return expandInt(x); }).join(' ');
      return expandInt(clean);
    });
  }
  function expandInt(s) {
    s = String(s).replace(/,/g, '');
    if (!s) return '';
    if (s.length > 1 && s[0] === '0') return digits(s);
    var w = number(Number(s));
    return w || digits(s);
  }

  /* ---------------- Sounds ---------------- */
  function wordPhones(w) {
    var low = String(w || '').toLowerCase().replace(/’/g, "'");
    if (LEX[low]) return LEX[low];
    return Lg ? Lg.word(low) : '';
  }
  /* A Luganda sentence to the voice's phones. Elision (y'entandikwa,
     n'emu) joins without an invented vowel; ng' is ŋ. */
  function phones(text) {
    var t = expand(text);
    return t.replace(/[A-Za-zŊŋ]+(?:['’][A-Za-zŊŋ]+)*/g, function (word) {
      var low = word.toLowerCase().replace(/’/g, "'");
      if (LEX[low]) return LEX[low];
      if (/^ng'/.test(low)) return wordPhones(low);
      if (low.indexOf("'") > 0) {
        return low.split("'").map(function (part) { return wordPhones(part); }).join('');
      }
      return wordPhones(low);
    }).replace(/[ \t]+/g, ' ').trim();
  }

  /* ---------------- Which language is this sentence? ---------------- */
  var LG_LITTLE = { ne: 1, na: 1, mu: 1, ku: 1, ki: 1, era: 1, nti: 1, oba: 1, naye: 1, bwe: 1, kye: 1, nga: 1, ye: 1, ate: 1, kubanga: 1, buli: 1, kati: 1, tewali: 1, wano: 1, eri: 1, bino: 1, ebyo: 1, kino: 1, ekyo: 1, oluvannyuma: 1, nnyini: 1, gwe: 1, nze: 1, ffe: 1, mmwe: 1, bo: 1, yo: 1, kyo: 1, ggwe: 1, tuli: 1, ndi: 1, oli: 1, ali: 1, bali: 1, mbu: 1, ekyo: 1, wabula: 1, olwokuba: 1, ssaako: 1, awamu: 1, yonna: 1, bonna: 1, byonna: 1 };
  var EN_LITTLE = /^(the|and|of|to|is|in|that|it|for|was|with|you|this|are|have|be|on|not|they|we|he|she|but|at|from|by|or|what|all|were|when|there|can|an|your|which|their|if|do|will|my|has|our|its|i|me|so|just|about|how|who|why|been|would|could|should|into|than|them|then|these|those|very|more|some|no|yes|thank|thanks|hello|hi|today|tomorrow|please|good|morning|night|people|time|day|new|one|two|three|love)$/;
  function wordsOf(s) { return (String(s || '').toLowerCase().match(/[a-zŋ]+(?:['’][a-zŋ]+)*/g) || []); }
  function lgLike(x) {
    /* Names belong to both languages: they say nothing about which one. */
    if (NAMES[x]) return 0;
    if (LEX[x] || LG_LITTLE[x]) return 2;
    if (!/[aeiou]$/.test(x)) return 0;
    if (/(th|wh|ph|ck|sh|ght|tion|ou|ea|ie|oa|[qx]|[bcdfghjklmnpqrstvwxz]{3})/.test(x)) return 0;
    if (/^(omu|aba|eki|ebi|oku|olu|aka|obu|ama|emi|eri|ama|ek|eb|en|em|ab|ob|ok|ol|ag|tu|ba|mu|ka|ki|bu|lu|n[nmy]|ss|kk|tt|bb|gg|jj|mm|ff|zz)/.test(x)) return 1.5;
    if (/(ny|ng'|ŋ|aa|ee|ii|oo|uu|bb|kk|ss|tt|gg|mm|nn|ll|zz|kw|gw|bw|ky|gy|mb|nd|nj|nz)/.test(x)) return 1.2;
    return 0.6;
  }
  function enLike(x) {
    if (EN_LITTLE.test(x)) return 2;
    if (LEX[x]) return 0;
    if (!/[aeiouy]$/.test(x)) return 1;
    if (/(th|wh|ph|ck|ght|tion|ou|ea|oa)/.test(x)) return 1;
    return 0;
  }
  /* 'lg' or 'en' for one sentence. hint: 'lg' when the whole piece is
     Luganda (chosen language or detected), so short or unclear sentences
     follow it. */
  function sentenceLang(s, hint) {
    var ws = wordsOf(s);
    if (!ws.length) return hint === 'lg' ? 'lg' : 'en';
    var lg = 0, en = 0;
    ws.forEach(function (x) { lg += lgLike(x); en += enLike(x); });
    if (hint === 'lg') return (en >= 3 && en > lg * 1.5) ? 'en' : 'lg';
    if (ws.length >= 2 && lg >= 2 && lg > en * 2.5) return 'lg';
    return 'en';
  }
  function looksLuganda(text) {
    if (Lg && typeof Lg.looksLuganda === 'function' && Lg.looksLuganda(text)) return true;
    var ws = wordsOf(text);
    if (ws.length < 3) return false;
    var lg = 0, en = 0;
    ws.forEach(function (x) { lg += lgLike(x); en += enLike(x); });
    return lg >= ws.length && en < ws.length * 0.3;
  }

  /* English sentence with Luganda names: the names keep their Luganda
     sounds. Returns '' (plain English) or segments for the engine. */
  function strongName(word) {
    var x = word.toLowerCase();
    if (NAMES[x]) return true;
    /* Not in the lexicon: only a capitalised word that starts the way no
       English word does (Ssali, Nnabakooza, Nnyanzi, Kkonde, Mmengo). */
    return /^[A-Z]/.test(word) && /[aeiou]$/.test(x) && x.length >= 4
      && /^(ss|nn|kk|tt|bb|jj|mm|gg|zz|ny[aeiou]|ng')/.test(x)
      && !/[cqx]|th|wh|ph|ck|sh|ou|ea/.test(x);
  }
  function englishWithNames(text) {
    var segs = [];
    var last = 0;
    var any = false;
    String(text).replace(/[A-Za-z]+(?:['’][A-Za-z]+)*/g, function (word, at) {
      if (!strongName(word)) return word;
      any = true;
      if (at > last) segs.push({ en: text.slice(last, at) });
      segs.push({ lg: wordPhones(word.toLowerCase()) });
      last = at + word.length;
      return word;
    });
    if (!any) return '';
    if (last < text.length) segs.push({ en: text.slice(last) });
    return segs;
  }

  /* ---------------- The native Luganda voice (through the worker) ---------------- */
  var WORKER = 'https://naluno-economy.naluno.workers.dev';
  var native = { state: 'unknown', until: 0, cache: Object.create(null), order: [], probe: null };
  function tokenNow() {
    try {
      var u = (root.firebase && root.firebase.auth && root.firebase.auth().currentUser) || null;
      return u && u.getIdToken ? u.getIdToken() : Promise.resolve('');
    } catch (_) { return Promise.resolve(''); }
  }
  function nativeOff(ms) { native.state = 'off'; native.until = Date.now() + ms; }
  function nativeReady() {
    if (native.state === 'off' && Date.now() < native.until) return false;
    return typeof fetch === 'function';
  }
  /* Luganda text to audio bytes from the Luganda-trained voice, or null.
     The caller decodes and plays it. */
  function nativeBytes(text, voice, speaker) {
    var t = String(text || '').trim();
    if (!t || t.length > 600 || !nativeReady()) return Promise.resolve(null);
    var key = (speaker || voice || '') + '|' + t;
    if (native.cache[key]) return native.cache[key];
    /* Until the first answer says whether the voice is set up, the other
       sentences wait for it (no burst of refused calls). */
    var first = native.state === 'unknown' && native.probe ? native.probe : null;
    if (first) {
      return first.then(function () { return nativeReady() ? nativeBytes(text, voice, speaker) : null; });
    }
    var p = tokenNow().then(function (tok) {
      if (!tok) return null;
      var body = { text: t, voice: voice === 'male' ? 'male' : 'female' };
      if (speaker) body.speaker = speaker;
      var ctl = typeof AbortController === 'function' ? new AbortController() : null;
      var timer = ctl ? setTimeout(function () { try { ctl.abort(); } catch (_) {} }, 20000) : 0;
      return fetch(WORKER + '/v1/voice/lg', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: ctl ? ctl.signal : undefined,
      }).then(function (res) {
        if (timer) clearTimeout(timer);
        if (res.status === 503 || res.status === 404) { nativeOff(10 * 60 * 1000); return null; }
        if (res.status === 429) { nativeOff(60 * 1000); return null; }
        if (!res.ok) return null;
        native.state = 'on';
        return res.arrayBuffer();
      }, function () { if (timer) clearTimeout(timer); nativeOff(30 * 1000); return null; });
    }).catch(function () { return null; });
    if (native.state === 'unknown') {
      native.probe = p.then(function () {}, function () {});
      native.probe.then(function () { native.probe = null; });
    }
    native.cache[key] = p;
    native.order.push(key);
    if (native.order.length > 60) delete native.cache[native.order.shift()];
    p.then(function (b) { if (!b) { delete native.cache[key]; } });
    return p;
  }

  /* ---------------- What NalunoVoices needs for each piece ---------------- */
  var LG_PACE = 0.95;
  /* Doubled consonants are said strongly in Luganda (bbiri, ssebo, ekkomo).
     The phone voice was trained on English sounds, where a written length
     mark after a consonant means nothing, so a doubled consonant is given to
     it the way it knows a held, strong consonant: at the start of a word,
     the syllable is marked strong (ˈbːiɾi, ˈsːebo); inside a word, the
     consonant closes one syllable and opens the next (ekˈkomo), as across
     "book case". Only for that voice; Luganda's own sounds stay as they are. */
  var GEM = '(tʃ|dʒ|[bdfɡkmnɲŋpstvzlɾ])ː';
  function forVoice(ph) {
    return String(ph || '').replace(/[^\s,.!?;:]+/g, function (w) {
      return w
        .replace(new RegExp('^' + GEM), 'ˈ$1ː')
        .replace(new RegExp('([aeiou]ː?)' + GEM, 'g'), '$1$2ˈ$2');
    });
  }
  /* Naluno's African voice (an East African Kiswahili speaker, a Bantu
     voice like Luganda's) was trained on espeak's Kiswahili sounds. Luganda's
     sounds are given to it in the symbols it knows: long vowels as doubled
     vowels (aa), j as ɟ, the tap as r. A doubled consonant is doubled and
     the syllable it starts is marked strong (bbˈiri, ekkˈomo): said
     strongly, as Luganda does. No other stress is added: Luganda has tones,
     not Kiswahili's stress on the second-last syllable. */
  function forAfrican(ph) {
    var s = String(ph || '').replace(/dʒ/g, 'ɟ').replace(/ɾ/g, 'r').replace(/([aeiou])ː/g, '$1$1');
    var C = '(tʃ|ɟ|[bdfɡkmnɲŋpstvzlr])';
    return s.replace(/[^\s,.!?;:]+/g, function (w) {
      return w
        .replace(new RegExp(C + 'ː([aeiou])', 'g'), '$1$1ˈ$2')
        .replace(new RegExp(C + 'ː', 'g'), '$1$1');
    });
  }
  /* plan(text, opts) -> function(piece) -> { lang, phonemes, speed, af, native }
     opts.lang 'lg': the piece is Luganda; '' : decide (As written).
     af: the sounds for Naluno's African voice (on the phone, free).
     native: the optional Sunbird voice (only when its key is set up). */
  function planner(text, opts) {
    opts = opts || {};
    var hint = opts.lang === 'lg' || (!opts.lang && looksLuganda(text)) ? 'lg' : '';
    var decode = typeof opts.decode === 'function' ? opts.decode : null;
    var useNative = opts.native !== false && !!decode;
    var useOwn = opts.own !== false;
    var female = opts.voice !== 'male';
    return function (piece) {
      var lang = sentenceLang(piece, hint);
      if (lang === 'lg') {
        var ph = phones(piece);
        var out = { lang: 'lg', phonemes: forVoice(ph), speed: LG_PACE };
        if (useOwn && /[A-Za-z]/.test(piece)) out.af = { phones: forAfrican(ph), female: female };
        if (useNative && /[A-Za-z]/.test(piece)) {
          out.native = function () {
            return nativeBytes(expand(piece), opts.voice, opts.speaker).then(function (buf) {
              return buf ? decode(buf) : null;
            });
          };
        }
        return out;
      }
      var segs = englishWithNames(piece);
      if (segs) segs.forEach(function (sg) { if (sg.lg) sg.lg = forVoice(sg.lg); });
      return { lang: 'en', phonemes: segs || '', speed: 1 };
    };
  }

  return {
    lexicon: LEX,
    names: NAMES,
    number: number,
    expand: expand,
    phones: phones,
    word: wordPhones,
    sentenceLang: sentenceLang,
    looksLuganda: looksLuganda,
    englishWithNames: englishWithNames,
    planner: planner,
    forVoice: forVoice,
    forAfrican: forAfrican,
    nativeBytes: nativeBytes,
    _native: native,
    _setWorker: function (u) { WORKER = u; },
    PACE: LG_PACE,
  };
});
