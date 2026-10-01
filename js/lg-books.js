/* Luganda from two books the product owner supplied as free to use.
   Pilkington, A Hand-book of Luganda (1891, public domain): sounds and everyday words.
   Kiingi, A Luganda-English Glossary of Lexemic Affixes (2020): affix = English rendition.
   Spark, Broadcast writing, and Compass read this. They do not replace a phrase the book already has. */
(function (root) {
  var AFFIX = [
    { a: "ata", concept: "RECURRENT", en: "" },
    { a: "ba", concept: "EXCUSABLY ERRONEOUS", en: "mis-" },
    { a: "baaka", concept: "HAVING ON", en: "-ferous , -gerous" },
    { a: "baama", concept: "HAVING IN", en: "-ferous,  -gerous" },
    { a: "bata", concept: "FEW", en: "oligo-" },
    { a: "bbala", concept: "ASIDE", en: "side (-)" },
    { a: "byata", concept: "BROAD AND FLAT", en: "platy-" },
    { a: "bega", concept: "BEHIND", en: "after- , après-, meta-, post-" },
    { a: "bela", concept: "FRONT", en: "ante-, front, pre-, pro-" },
    { a: "beela", concept: "OCCUPYING A PLACE", en: "inhabit" },
    { a: "beelo", concept: "A PLACE OCCUPIED BY", en: "habitat" },
    { a: "biiba", concept: "DOUBLING", en: "di- , diplo- , duo- , duplo- , bi- , double-" },
    { a: "bijja", concept: "BADNESS", en: "caco-" },
    { a: "bila", concept: "SPEED", en: "tach (o)-" },
    { a: "bilya", concept: "TWO- BRANCHED", en: "dicho-" },
    { a: "buba", concept: "INEXCUSABLY ERRONEOUS", en: "mal-" },
    { a: "buga", concept: "ENCLOSING", en: "circum- , peri-" },
    { a: "bumpa", concept: "SHORT", en: "brachy-" },
    { a: "buna", concept: "ALLNESS", en: "all- , omni- , pan-" },
    { a: "bunda", concept: "DISCHARGE/FLOW", en: "-rrhoea" },
    { a: "bunga", concept: "LARGE QUANTITY", en: "many- , multi- , poly-" },
    { a: "buuma", concept: "NOT HAVING IN", en: "-free" },
    { a: "bwa", concept: "OUTSIDE", en: "ecto- , exo- , extra- , out- , ex-" },
    { a: "ca", concept: "PART OF", en: "-some" },
    { a: "cama", concept: "SYSTEM", en: "work, system" },
    { a: "cuuza", concept: "DEALER/TRADER", en: "-monger" },
    { a: "cupa", concept: "FAKE", en: "counter-" },
    { a: "dda", concept: "BEGINNING, SOURCE", en: "" },
    { a: "ddama", concept: "REACTIVE", en: "ana-, re-" },
    { a: "ddawa", concept: "PROACTIVE", en: "ante-, fore-, pre-, pro-" },
    { a: "ddaya", concept: "RETROACTIVE", en: "back-, palin-, retro-" },
    { a: "ddidda", concept: "LESS THAN USUAL/EXPECTED", en: "under-" },
    { a: "ddiza", concept: "RECIPROCATING", en: "re-" },
    { a: "dikya", concept: "GOBBLEDEGOOK", en: "-speak" },
    { a: "dyeka", concept: "TRICKING", en: "pseudo-, quasi- -e [ELECTRONIC] = e-" },
    { a: "ee", concept: "REFLEXIVE", en: "auto-, eigen-, idio-, own (-), proper, self-, sui-" },
    { a: "faana", concept: "RESEMBLING", en: "-oid ~ -ode" },
    { a: "feeba", concept: "OBJECTIVELY LESS THAN", en: "under-" },
    { a: "fo", concept: "IN PLACE OF", en: "pro- , vice-" },
    { a: "funda", concept: "SMALL, NARROW", en: "steno-, lepto-" },
    { a: "gagga", concept: "RICH IN", en: "-rich" },
    { a: "gana", concept: "COMMONNESS", en: "co- , coeno-, syn-, common (-)" },
    { a: "gasa", concept: "WORTH", en: "worth (…ing), -worthy" },
    { a: "gaza", concept: "WIDE VARIETY/RANGE", en: "eury-" },
    { a: "gatta", concept: "ADDING", en: "compound" },
    { a: "genya", concept: "GUEST", en: "guest" },
    { a: "geza", concept: "ACTION/PRACTICE", en: "-praxia" },
    { a: "ggya", concept: "ANEW", en: "neo-, newly-, re-" },
    { a: "gina", concept: "SIMPLE, SINGLE", en: "haplo-" },
    { a: "goga", concept: "PAIR", en: "diplo-" },
    { a: "goda", concept: "THICK", en: "pachy-, pycn (o)-" },
    { a: "guma", concept: "ENDURING", en: "-proof" },
    { a: "gga", concept: "HIGH LOCATION", en: "ana-, over-, super-  ~ supra- ~ sur-, up-" },
    { a: "geenya", concept: "APING", en: "-aster" },
    { a: "gga", concept: "FIRST-DEGREE SUPERIORITY", en: "ana-, over-, super- ~ supra- ~ sur-, up-" },
    { a: "ggaga", concept: "SECOND-DEGREE SUPERIORITY", en: "hyper-" },
    { a: "ggagga", concept: "THIRD-DEGREE SUPERIORITY", en: "ultra-, ultramacro-, uber-, macromacro-" },
    { a: "jula", concept: "REFERENCE", en: "-related" },
    { a: "jjuuza", concept: "RECENTLY", en: "newly" },
    { a: "jjuva", concept: "FULLNESS", en: "-ful, -lent" },
    { a: "jjula", concept: "OVERDOSING", en: "-ose" },
    { a: "jjola", concept: "GENETICALLY MODIFIED", en: "franken-" },
    { a: "ka", concept: "DIRECTED FROM", en: "ab-" },
    { a: "kaala1", concept: "COMPLEXITY", en: "complex, -plex" },
    { a: "kaala2", concept: "BEAUTY", en: "calli-" },
    { a: "kaddagga", concept: "ANCIENT", en: "palaeo-" },
    { a: "kakadde", concept: "AUGMENTATIVE MILLION", en: "-illion" },
    { a: "kata", concept: "CENTRAL, MIDDLE", en: "medi-, meso-, mid-" },
    { a: "kiika", concept: "PLACING ACROSS", en: "cross-, dia-, per-, trans-" },
    { a: "kila", concept: "OBJECTIVELY MORE THAN", en: "over-" },
    { a: "keewa", concept: "DIMINISHING", en: "mio-" },
    { a: "kima", concept: "SAME", en: "same-, tauto-" },
    { a: "kisa", concept: "HIDING", en: "crypto-, stego-" },
    { a: "kiza", concept: "DISCRIMINATING", en: "-ism" },
    { a: "kkasa", concept: "CONFIRMING", en: "" },
    { a: "kona", concept: "LEFT-HAND", en: "sinistro-" },
    { a: "kooka", concept: "WORKING", en: "-urgy" },
    { a: "kola", concept: "PRODUCING CHANGE", en: "-facient" },
    { a: "kuga", concept: "SPECIALIZING", en: "" },
    { a: "kula", concept: "FORM", en: "-form, -morphic, -shaped" },
    { a: "kumba", concept: "PRECEDING", en: "ante-, fore-, pre-, -agogue" },
    { a: "kumpa", concept: "ALMOST", en: "near (-), pen (e)-, ad-" },
    { a: "kunga", concept: "ON THE SURFACE OF", en: "epi-" },
    { a: "komya", concept: "STOPPING", en: "-stasis" },
    { a: "konta", concept: "COUNTERING", en: "anti-, contra-, counter-, enantio-" },
    { a: "kwa", concept: "OUTER LOCATION", en: "" },
    { a: "kwamwa", concept: "OUTER-INNER", en: "intra-, ento-, endo-" },
    { a: "kweba", concept: "LENGTHWISE", en: "longi-" },
    { a: "kuta", concept: "BREAKING, BURSTING", en: "-rrhagia" },
    { a: "kwansa", concept: "OUTER-LOWER LOCATION", en: "infra-, under-" },
    { a: "kyana", concept: "INVARIABLE", en: "homeo-" },
    { a: "kyawa", concept: "HATING", en: "-phobia" },
    { a: "kyenka", concept: "VIRTUALITY", en: "virtual" },
    { a: "kyuka", concept: "TURNING", en: "-tropic" },
    { a: "kyuna", concept: "VARIABLE", en: "poikilo-" },
    { a: "la", concept: "DIRECTED TOWARDS", en: "ad-, pro-, -wards, -ways, -wise" },
    { a: "laana", concept: "NEIGHBOURING", en: "juxta-, para-" },
    { a: "laba", concept: "WAY OF THINKING", en: "-ism" },
    { a: "laga", concept: "DISPLAY/SPECTACLE", en: "-orama" },
    { a: "lala", concept: "MADNESS", en: "-mania" },
    { a: "lamwa", concept: "CORE", en: "" },
    { a: "leka", concept: "NEUTRALITY", en: "non-" },
    { a: "leebya", concept: "OUT – X –ING", en: "out-" },
    { a: "leela", concept: "EMPTY", en: "(-)empty" },
    { a: "lemba", concept: "SLOWNESS", en: "brady-" },
    { a: "looza", concept: "IDEAL", en: "ideo-" },
    { a: "linga", concept: "DUPING", en: "pseudo-, quasi-" },
    { a: "lojja", concept: "BRANCH OF KNOWLEDGE", en: "-graphics ~ -graphy" },
    { a: "lula", concept: "ON THE OTHER SIDE OF", en: "para-, trans-, ultra-" },
    { a: "luma", concept: "PAIN", en: "-algia" },
    { a: "luba", concept: "VISUAL DISORDER", en: "-opia" },
    { a: "luna", concept: "ON THIS SIDE OF", en: "cis-" },
    { a: "lunga", concept: "GOODNESS", en: "bene-" },
    { a: "lwala", concept: "DISEASE", en: "-asis ~ -osis" },
    { a: "lya", concept: "RIGHT – HAND", en: "dextro-" },
    { a: "lima", concept: "LANGUAGE", en: "-ese" },
    { a: "ma", concept: "COLLECTIVE", en: "-ad, -age, -ate, -ati, -dom, -ery, -hood, -some, -ship, -ure" },
    { a: "maala", concept: "TOTAL OUTPUT", en: "-ana ~ -iana" },
    { a: "mala", concept: "COMPLEMENTING", en: "complement" },
    { a: "manya", concept: "BRANCH OF KNOWLEDGE", en: "X science" },
    { a: "mwaza", concept: "DIRECTED INWARDS", en: "in-, intro-" },
    { a: "muula", concept: "DIRECTED OUTWARDS", en: "ex-, extro-" },
    { a: "mwala", concept: "INWARDS", en: "intro-" },
    { a: "muwa", concept: "ONENESS", en: "mono-, one-, uni-" },
    { a: "mwa", concept: "INNER LOCATION", en: "en- ~ endo- ~  ento-, in-" },
    { a: "na", concept: "POSSESSING", en: "-ate, -ed, -ferous, -ful –gerous" },
    { a: "nala", concept: "GAINING", en: "" },
    { a: "nata", concept: "AGAIN", en: "re-" },
    { a: "nda", concept: "OTHER", en: "allo-" },
    { a: "ndama", concept: "COLLECTIVE OF ALLO -X - S", en: "-eme" },
    { a: "nena", concept: "LARGE SIZE", en: "macro-, mega-" },
    { a: "nga", concept: "ACTING AS", en: "acting X" },
    { a: "ngela", concept: "WAY", en: "-esque, -fashion, -style" },
    { a: "niina", concept: "SIMPLE", en: "simple" },
    { a: "nkana", concept: "EQUAL TO — IN TERMS OF", en: "equ-, iso-" },
    { a: "nkuna", concept: "UNEQUAL TO — IN TERMS OF", en: "aniso-" },
    { a: "nna", concept: "CONCERNING/PERTAINING TO", en: "" },
    { a: "nnana", concept: "ARTEFACT", en: "artificial" },
    { a: "nnona", concept: "ORIGIN", en: "proto-, ur-" },
    { a: "nsa", concept: "LOW LOCATION", en: "cata-, down-, infra-, sub-, under-" },
    { a: "nsa", concept: "FIRST-DEGREE INFERIORITY", en: "cata-, down-, infra-, sub-, under-" },
    { a: "nsafa", concept: "SECOND-DEGREE INFERIORITY", en: "hypo-" },
    { a: "nsaffa", concept: "THIRD-DEGREE INFERIORITY", en: "ultramicro-, micromicro-" },
    { a: "jja", concept: "ENDING, GOAL", en: "" },
    { a: "nyoola", concept: "TWISTED", en: "strepto- nnyhu• [VERY SMALL SIZE] = ultramicro- nnyhunnyhu• [EXTREMELY SMALL SIZE] = micromicro-" },
    { a: "nyiga", concept: "PRESSURE", en: "piezo-" },
    { a: "nuka", concept: "LOSING", en: "" },
    { a: "nufu", concept: "NOT POSSESSING; WITHOUT", en: "a(n)-, -less" },
    { a: "nusa", concept: "HALF", en: "demi-, half-, hemi-, semi-" },
    { a: "nyweza", concept: "FIXING", en: "pexy" },
    { a: "nywa", concept: "COMPONENT", en: "" },
    { a: "nywama", concept: "COLLECTIVE/AGGREGATE OF COMPONENTS", en: "-alia, -ware" },
    { a: "pa", concept: "ELEMENT OF A COLLECTIVE", en: "" },
    { a: "pima", concept: "BRANCH OF KNOWLEDGE", en: "-metrics, -metry" },
    { a: "pika", concept: "ECONOMIC INFLATION", en: "-flation" },
    { a: "sa1", concept: "MEDIUM DEGREE", en: "medium (-)" },
    { a: "sa2", concept: "GAP", en: "" },
    { a: "saama", concept: "EXCISING", en: "-ectomy" },
    { a: "saana", concept: "WORTHINESS", en: "worthy" },
    { a: "sala", concept: "CUTTING", en: "-tomy" },
    { a: "samba", concept: "FLEEING", en: "-fugal" },
    { a: "satwa", concept: "THREE – BRANCHED", en: "tricho-" },
    { a: "sawa1", concept: "HEALING", en: "-iatrics, -iatry" },
    { a: "sawa2", concept: "CONTAINER", en: "-angium, asc(o)-" },
    { a: "sela", concept: "PROCESSION", en: "-cade" },
    { a: "seeta", concept: "LEVEL/FLAT", en: "plan (o)-" },
    { a: "siba", concept: "BEING ADDICTED TO", en: "-aholic ~ -oholic" },
    { a: "singa", concept: "FOUNDATIONAL", en: "basic, basi-" },
    { a: "sinza", concept: "WORSHIP", en: "-latry" },
    { a: "sukka", concept: "MORE THAN USUAL/EXPECTED", en: "over-" },
    { a: "suuma", concept: "SECOND-ORDER", en: "after-, meta-, post-" },
    { a: "ta", concept: "NEGATION", en: "a(n)-, dis-, in-, non-,un-" },
    { a: "taba", concept: "JOINING TOGETHER", en: "inter-" },
    { a: "taafa", concept: "OBLIQUENESS", en: "plagio-" },
    { a: "taasa", concept: "PROTECTION", en: "para-" },
    { a: "teeka", concept: "ARRANGEMENT", en: "system, taxo" },
    { a: "tema", concept: "MEDIUM SIZE", en: "midi-, average, medium" },
    { a: "tikka", concept: "MAXIMUM", en: "-most, maximum, top" },
    { a: "toba", concept: "MINIMUM", en: "minimum, bottom" },
    { a: "toba", concept: "ALTERNATING", en: "" },
    { a: "tona", concept: "SMALL SIZE", en: "micro-, mini-" },
    { a: "tumba", concept: "DEPTH", en: "bathy-" },
    { a: "tuufa", concept: "RICHTNESS", en: "ortho-, recti-" },
    { a: "tunga", concept: "SEWING", en: "-rrhaphy" },
    { a: "Ula", concept: "REVERSAL/REMOVAL VALENCY = 2", en: "de-, dis-, un-" },
    { a: "Uka", concept: "REVERSAL/REMOVAL VALENCY = 1", en: "de-, dis-, un-" },
    { a: "Unta", concept: "COUNTERING", en: "anti-, contra-, counter-" },
    { a: "va", concept: "WHOLE", en: "holo-" },
    { a: "vaaka", concept: "COMING OFF", en: "" },
    { a: "vaama", concept: "COMING OUT OF", en: "-in (e)" },
    { a: "viila", concept: "MOVEMENT FROM", en: "" },
    { a: "vuka", concept: "DISINTEGRATION", en: "-lysis" },
    { a: "wa", concept: "OF", en: "-al, -an, -ar, -ary, -er, -ese, -i, -ic(al), -ish, -ite, -ose, -ous, -y" },
    { a: "waaya", concept: "SUPPLEMENTING", en: "by (e)-" },
    { a: "wadda", concept: "EFFECTIVELY AS USUAL", en: "" },
    { a: "waga", concept: "SUPPORTING", en: "pro-" },
    { a: "wamba", concept: "SEIZURE", en: "-lepsy" },
    { a: "waka", concept: "PLURAL", en: "pluri-" },
    { a: "wala", concept: "MUTATION", en: "-escence, -genesis" },
    { a: "wanga", concept: "RESEMBLING", en: "-esque, -like, -oid, -ode" },
    { a: "wanva", concept: "LENGTH OF TIME", en: "-long" },
    { a: "wela", concept: "BEING ENOUGH", en: "pleo-" },
    { a: "weeva", concept: "BARE, SMOOTH", en: "psilo-" },
    { a: "wika", concept: "POTENTIAL", en: "potenti-" },
    { a: "wila", concept: "OCCUPYING A BUILDING", en: "" },
    { a: "wilo", concept: "A BUILDING OCCUPIED BY", en: "-arium ~ -ary, -etum" },
    { a: "wonda", concept: "FOLLOWING", en: "after-, post-" },
    { a: "wooma", concept: "PLEASANTNESS", en: "eu-" },
    { a: "ya", concept: "CAUSING", en: "-ate, -en, em-, en-, in-, -ify, -ize, de-, dis-, un-" },
    { a: "yaga", concept: "LOVE", en: "•philia" },
    { a: "yaka1", concept: "FORMER", en: "ex-" },
    { a: "yaka2", concept: "INFLAMMATION", en: "-itis" },
    { a: "yala", concept: "FAR", en: "tele-" },
    { a: "yama", concept: "SINGLE", en: "single" },
    { a: "yanna", concept: "ALLNESS", en: "all-, omni-, pan-" },
    { a: "yava", concept: "PAUCITY", en: "a (n)-, -penia" },
    { a: "yasa", concept: "SPLIT", en: "-fid" },
    { a: "yawa", concept: "MIXEDNESS", en: "hetero-, mixed(-)" },
    { a: "yema", concept: "TOTALITY", en: "" },
    { a: "yela", concept: "BEYOND", en: "extra-, trans-, ultra-" },
    { a: "yina", concept: "SELF", en: "auto-, eigen-, idio-, proper- , own (-), self-, sui-" },
    { a: "yinza", concept: "POTENTIAL", en: "potenti-" },
    { a: "yoga", concept: "LANGUAGE VARIETY", en: "-lect, -phasia" },
    { a: "yogaba", concept: "SPEECH CONDITION/DISORDER", en: "-lalia" },
    { a: "yosa", concept: "SHOWING", en: "phan(ero)}-, -phane" },
    { a: "yuna", concept: "ATTRACTED TO", en: "-petal" },
    { a: "yunga", concept: "SYSTEM", en: "-work" },
    { a: "yuwa", concept: "UNMIXEDNESS", en: "homo-, same-" },
    { a: "za", concept: "[PRODUCING MATERIAL", en: "-gen, -parous" },
    { a: "zaba", concept: "MENTAL DISORDER", en: "-phrenia" },
    { a: "ziba", concept: "DIFFICULTY", en: "dys-" },
    { a: "zimba", concept: "SWELLING", en: "-cele, -oma" },
    { a: "zinga", concept: "COMPREHENSIVENESS", en: "comprehensive" },
    { a: "zomba", concept: "ON BOTH SIDES", en: "ambi-, amphi-" },
    { a: "zuba", concept: "SURGICAL OPENING OPERATION", en: "-stomy" },
  ];
  var PHRASES = [
    ["man", "omuntu"],
    ["person", "omuntu"],
    ["people", "abantu"],
    ["tree", "omuti"],
    ["trees", "emiti"],
    ["cow", "ente"],
    ["thing", "ekintu"],
    ["things", "ebintu"],
    ["door", "oluggi"],
    ["work", "omulimu"],
    ["hunger", "enjala"],
    ["children", "abaana"],
    ["child", "omwana"],
    ["strength", "amaanyi"],
    ["faith", "okukkiriza"],
    ["ignorance", "obutamanya"],
    ["love", "okwagala"],
    ["fearlessness", "obutatya"],
    ["strong", "wa maanyi"],
    ["weak", "atalina maanyi"],
    ["lion", "empologoma"],
    ["cry", "kaaba"],
    ["chew", "gaya"],
    ["arrive", "tuuka"],
    ["promise", "essuubi"],
    ["leaves", "ndagala"],
    ["why", "lwaki"],
    ["why didn't you come", "lwaki obutajja"],
    ["go to the capital", "genda ku kibuga"],
    ["i am reading", "nsoma busomi"],
    ["you had better do so", "wakiri okole bwe otyo"],
    ["he is a man", "ye muntu buntu"],
    ["i don't even know him", "n'okumanya simumanyi"],
    ["hello", "Oli otya"],
    ["how are you", "Oli otya"],
    ["thank you", "Weebale"],
    ["thank you very much", "Weebale nnyo"],
    ["goodbye", "Weraba"],
    ["yes", "Yee"],
    ["no", "Nedda"],
    ["please", "Nsaba"],
    ["sorry", "Nsonyiwa"],
    ["water", "amazzi"],
    ["food", "emmere"],
    ["friend", "mukwano"],
  ];
  var PRON = "Luganda sounds, from Pilkington's Hand-book (1891, public domain). a as in father or balm. e as ai in pair. i as ee in spleen. o between the ow in low and the aw in law. u as oo in wool. g is always hard. ng' is the ng in singer, not finger. l and r trade places: l is written after a, o, u and r after e, i (omulimu, emirimu). Every syllable ends in a vowel. Stress is usually on the second-to-last syllable, but not always. ky before a vowel is said like ch, gy before a vowel like j. A doubled vowel is long. Words in a sentence often drop the last vowel of a small word before the next vowel.";

  function norm(s) {
    return String(s || '').toLowerCase().replace(/[^a-z0-9'\s]/g, ' ').replace(/\s+/g, ' ').trim();
  }
  function pairs() { return PHRASES.slice(); }
  function affixHit(q) {
    var i, row, a, c;
    for (i = 0; i < AFFIX.length; i++) {
      row = AFFIX[i];
      a = norm(row.a);
      c = norm(row.concept);
      if (!a) continue;
      if (q === a || q === c || q === norm(row.en)) return row;
    }
    return null;
  }
  function phraseHit(q) {
    var i, p, en;
    for (i = 0; i < PHRASES.length; i++) {
      p = PHRASES[i];
      en = norm(p[0]);
      if (q === en || q === norm(p[1])) return p;
    }
    return null;
  }
  function answer(text) {
    var q = norm(text);
    if (!q) return '';
    if (/pronounc|how (do|to) (you )?say luganda|luganda sound|luganda spelling/.test(q)) return PRON;
    var say = q.match(/^(?:how do you say|how do i say|translate|what is the luganda for)\s+(.+?)(?:\s+in luganda)?$/);
    if (say) {
      var hit = phraseHit(norm(say[1]));
      if (hit) return hit[0] + ' is ' + hit[1] + ' in Luganda.';
    }
    var mean = q.match(/^(?:what does|what's|whats)\s+(.+?)\s+mean(?:\s+in (?:english|luganda))?$/);
    if (mean) {
      var key = norm(mean[1]);
      var ph = phraseHit(key);
      if (ph) return ph[1] + ' means ' + ph[0] + '.';
      var ax = affixHit(key);
      if (ax) return 'The Luganda affix ' + ax.a + ' marks ' + ax.concept.toLowerCase() + (ax.en ? ' (' + ax.en + ')' : '') + '.';
    }
    var ax2 = affixHit(q);
    if (ax2 && q.length > 2) return 'The Luganda affix ' + ax2.a + ' marks ' + ax2.concept.toLowerCase() + (ax2.en ? ' (' + ax2.en + ')' : '') + '.';
    return '';
  }
  /* Whole line only. A leftover English word is not guessed. */
  function translate(text, from, to) {
    var src = String(text || '').trim();
    if (!src || !from || !to || from === to) return '';
    if (from !== 'lg' && to !== 'lg') return '';
    var q = norm(src);
    var i;
    if (to === 'lg') {
      for (i = 0; i < PHRASES.length; i++) {
        if (norm(PHRASES[i][0]) === q) return PHRASES[i][1];
      }
      return '';
    }
    for (i = 0; i < PHRASES.length; i++) {
      if (norm(PHRASES[i][1]) === q) return PHRASES[i][0];
    }
    return '';
  }
  root.NalunoLgBooks = { affix: AFFIX, phrases: PHRASES, pron: PRON, pairs: pairs, answer: answer, translate: translate };
})(typeof window !== 'undefined' ? window : globalThis);

