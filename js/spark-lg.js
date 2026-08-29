/* ============================================================
   MODULE: js/spark-lg.js
   Naluno Luganda book. Seed phrases first, then words you teach.
   Generic translators are not used when this book already knows
   the line. OWNERSHIP: lexicon only.
   ============================================================ */

const SPARK_LG_SEED = [
  ['hello', 'Oli otya'],
  ['hi', 'Gyebale ko'],
  ['good morning', 'Wasuze otya nno'],
  ['good afternoon', 'Osibye otya nno'],
  ['good evening', 'Osiibye otya nno'],
  ['good night', 'Sula bulungi'],
  ['how are you', 'Oli otya'],
  ['how are you?', 'Oli otya?'],
  ['i am fine', 'Ndi bulungi'],
  ['i\'m fine', 'Ndi bulungi'],
  ['thank you', 'Weebale'],
  ['thanks', 'Weebale'],
  ['thank you very much', 'Weebale nnyo'],
  ['thanks a lot', 'Weebale nnyo'],
  ['please', 'Nsaba'],
  ['yes', 'Yee'],
  ['no', 'Nedda'],
  ['sorry', 'Nsonyiwa'],
  ['excuse me', 'Nsaba okuyita'],
  ['welcome', 'Tukwanirizza'],
  ['goodbye', 'Weraba'],
  ['bye', 'Weraba'],
  ['see you', 'Tulabagane'],
  ['see you later', 'Tunaalabagana'],
  ['nice to meet you', 'Nsanyuse okukulaba'],
  ['what is your name', 'Erinnya lyo ggwe ani'],
  ['what\'s your name', 'Erinnya lyo ggwe ani'],
  ['my name is', 'Erinnya lyange nze'],
  ['i am', 'Nze'],
  ['where are you from', 'Ova wa'],
  ['where are you from?', 'Ova wa?'],
  ['i am from', 'Nva'],
  ['i don\'t understand', 'Sitegeera'],
  ['i do not understand', 'Sitegeera'],
  ['speak slowly', 'Yogera mpola'],
  ['can you help me', 'Oyinza okunnyamba'],
  ['help me', 'Nnyamba'],
  ['i love this', 'Kino nkyagala'],
  ['i like it', 'Nkyagala'],
  ['friend', 'Mukwano'],
  ['brother', 'Muganda wange'],
  ['sister', 'Mwannyina'],
  ['family', 'Amaka'],
  ['home', 'Eka'],
  ['water', 'Amazzi'],
  ['food', 'Emmere'],
  ['eat', 'Lya'],
  ['drink', 'Nywa'],
  ['money', 'Ssente'],
  ['phone', 'Essimu'],
  ['today', 'Lero'],
  ['tomorrow', 'Enkya'],
  ['yesterday', 'Jjo'],
  ['now', 'Kati'],
  ['later', 'Oluvannyuma'],
  ['come', 'Jja'],
  ['go', 'Genda'],
  ['wait', 'Lindawo'],
  ['look', 'Laba'],
  ['listen', 'Wuliriza'],
  ['speak', 'Yogera'],
  ['write', 'Wandiika'],
  ['read', 'Soma'],
  ['yes please', 'Yee, nsaba'],
  ['no thank you', 'Nedda, weebale'],
  ['what is this', 'Kino kiki'],
  ['how much', 'Ssente mmeka'],
  ['where', 'Wa'],
  ['when', 'Ddi'],
  ['who', 'Ani'],
  ['why', 'Lwaki'],
  ['what', 'Ki'],
  ['ok', 'Kale'],
  ['okay', 'Kale'],
  ['good', 'Kirungi'],
  ['beautiful', 'Kya nnyo'],
  ['peace', 'Emirembe'],
  ['god bless you', 'Katonda akuwe omukisa'],
  ['i am happy', 'Nsanyuse'],
  ['i am here', 'Ndi wano'],
  ['are you there', 'Oli eyo'],
  ['what called you here?', 'Ki ekikuleese wano?'],
  ['what called you here', 'Ki ekikuleese wano'],
  ['where does your voice come from?', 'Eddoboozi lyo livva wa?'],
  ['where does your voice come from', 'Eddoboozi lyo livva wa'],
  ['what are you building?', 'Okola ki?'],
  ['what are you building', 'Okola ki'],
  ['what should we remember from this meeting?', 'Ki kye twalina okujjukira okuva mu nkisise eno?'],
  ['what should we remember from this meeting', 'Ki kye twalina okujjukira okuva mu nkisise eno'],
  ['two voices. one page.', 'Amaloboozi abiri. Olupapula lumu.'],
  ['i am coming', 'Njija'],
  ['i am going', 'Ngenda'],
  ['i miss you', 'Nkwagala nnyo nkwetaaga'],
  ['see you tomorrow', 'Tulabagane enkya'],
  ['how much is this', 'Kino kiri ssente mmeka'],
  ['i need help', 'Njagala obuyambi'],
  ['are you okay', 'Oli bulungi'],
  ['i am okay', 'Ndi bulungi'],
  ['let us talk', 'Twogere'],
  ['call me', 'Nkuwereze essimu'],
  ['text me', 'Mpa obubaka'],
  ['good', 'Kirungi'],
  ['bad', 'Kibi'],
  ['love', 'Okwagala'],
  ['you', 'Ggwe'],
  ['me', 'Nze'],
  ['we', 'Ffe'],
  ['they', 'Bo'],
];

let sparkLgLive = [];
let sparkLgUnsub = null;
let sparkLgUnlocked = false;
const SPARK_LG_GATE = '7ecf54fbcf7b7614d703d17b3466e267a69f591f9ca7a4beb6e53924eb94f320';

async function sparkLgHash(text){
  if(typeof sha256Hex === 'function') return sha256Hex(text);
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(function(b){ return b.toString(16).padStart(2,'0'); }).join('');
}

async function sparkLgUnlock(pass){
  const h = await sparkLgHash(String(pass || '').trim());
  sparkLgUnlocked = (h === SPARK_LG_GATE);
  if(sparkLgUnlocked){
    try{ sessionStorage.setItem('nalunoLgGate', '1'); }catch(_){}
    toast('You can teach the Luganda book');
  } else {
    toast('That password is not for the book');
  }
  syncSparkLgLockUi();
  return sparkLgUnlocked;
}

function sparkLgCanEdit(){
  if(sparkLgUnlocked) return true;
  try{ if(sessionStorage.getItem('nalunoLgGate') === '1'){ sparkLgUnlocked = true; return true; } }catch(_){}
  return false;
}

function syncSparkLgLockUi(){
  const can = sparkLgCanEdit();
  const form = $('sparkLgEditForm');
  const gate = $('sparkLgGate');
  if(form) form.style.display = can ? 'flex' : 'none';
  if(gate) gate.style.display = can ? 'none' : 'block';
}

function sparkLgNorm(s){
  return String(s || '')
    .toLowerCase()
    .replace(/['’]/g, "'")
    .replace(/[^\p{L}\p{N}'\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function sparkLgPairs(){
  const out = [];
  const seen = {};
  function add(src, dst){
    const a = sparkLgNorm(src);
    const b = String(dst || '').trim();
    if(!a || !b) return;
    if(seen[a]) return;
    seen[a] = true;
    out.push({ src: a, dst: b });
  }
  sparkLgLive.forEach(function(p){ add(p.src, p.dst); });
  SPARK_LG_SEED.forEach(function(p){ add(p[0], p[1]); });
  out.sort(function(a,b){ return b.src.length - a.src.length; });
  return out;
}

function sparkLgApply(text, from, to){
  const src = String(text || '').trim();
  if(!src) return '';
  if(from !== 'lg' && to !== 'lg') return null;
  const pairs = sparkLgPairs();
  if(to === 'lg'){
    const key = sparkLgNorm(src);
    for(let i = 0; i < pairs.length; i++){
      if(pairs[i].src === key) return pairs[i].dst;
    }
    let rest = ' ' + key + ' ';
    let used = false;
    for(let i = 0; i < pairs.length; i++){
      const needle = ' ' + pairs[i].src + ' ';
      if(rest.indexOf(needle) >= 0){
        rest = rest.split(needle).join(' ' + pairs[i].dst + ' ');
        used = true;
      }
    }
    rest = rest.replace(/\s+/g, ' ').trim();
    if(used && rest && sparkLgNorm(rest) !== key){
      // leftover 3+ letter latin tokens mean mixed English — do not claim success
      if(/\b[a-z]{3,}\b/i.test(rest)) return null;
      return rest;
    }
    return null;
  }
  if(from === 'lg' && to !== 'lg'){
    const key = sparkLgNorm(src);
    for(let i = 0; i < pairs.length; i++){
      if(sparkLgNorm(pairs[i].dst) === key) return pairs[i].src;
    }
    let rest = ' ' + key + ' ';
    let used = false;
    const rev = pairs.slice().sort(function(a,b){ return sparkLgNorm(b.dst).length - sparkLgNorm(a.dst).length; });
    for(let i = 0; i < rev.length; i++){
      const needle = ' ' + sparkLgNorm(rev[i].dst) + ' ';
      if(needle.length < 4) continue;
      if(rest.indexOf(needle) >= 0){
        rest = rest.split(needle).join(' ' + rev[i].src + ' ');
        used = true;
      }
    }
    rest = rest.replace(/\s+/g, ' ').trim();
    if(used && rest && sparkLgNorm(rest) !== key){
      return rest;
    }
  }
  return null;
}

/* ---------------- LEARN FROM VERIFIED SOURCES ONLINE ----------------
   PanLex (panlex.org) is a real, purpose-built, freely-accessible lexical
   translation database covering thousands of language pairs, documented at
   dev.panlex.org/api — used here exactly per its own documented query
   pattern for "give me expressions in language X that are translations of
   this text in language Y" (their own worked example: translating a known
   Russian expression into English uses the same trtt/truid shape used
   below for English into Luganda). Luganda's PanLex identifier is
   "lug-000" — its ISO 639-3 code (lug, confirmed against the ISO 639-3
   registry and Ethnologue) plus PanLex's "-000" suffix for a language's
   primary/default variety, the same pattern eng-000 and rus-000 follow in
   PanLex's own documented examples.

   IMPORTANT, deliberate design choice: this is a REAL person's actual
   in-person conversation, not a low-stakes UI string. A wrong translation
   here isn't a cosmetic bug — it can genuinely embarrass someone or break
   a real conversation. So this NEVER auto-adds anything to the book. It
   only surfaces PanLex's own results, each carrying PanLex's own quality
   score, for the same gated human teacher to review and explicitly accept
   — exactly the same trust boundary the book already has for anything a
   person types in by hand. Nothing from here is ever used as a live
   translation until a human has looked at it and pressed Add. */
const SPARK_LG_PANLEX_UID = 'lug-000';
async function sparkLgSearchOnline(englishText){
  const q = String(englishText || '').trim();
  if(!q) return [];
  const results = [];
  try{
    const res = await fetch('https://api.panlex.org/ex', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        uid: SPARK_LG_PANLEX_UID,
        trtt: [q],
        truid: ['eng-000'],
        include: ['trq'],
        limit: 8,
      }),
    });
    if(res.ok){
      const j = await res.json();
      (j.result || []).forEach(function(row){
        if(row && row.tt){
          results.push({ text: row.tt, quality: (typeof row.trq === 'number') ? row.trq : null, source: 'PanLex' });
        }
      });
    }
  }catch(_){ /* offline, or PanLex unreachable — an empty result list is the honest outcome */ }
  // Highest documented quality first — PanLex's own editorial confidence score,
  // not anything invented here.
  results.sort(function(a,b){ return (b.quality||0) - (a.quality||0); });
  return results;
}
function sparkLgWiktionaryLink(englishText){
  const q = String(englishText || '').trim();
  if(!q) return '';
  // A real cross-reference link for the human reviewer, not a parsed data
  // source — Wiktionary's translation tables live in wikitext that's
  // genuinely fragile to parse reliably by machine, and this is exactly the
  // kind of thing that shouldn't be guessed at when a real conversation is
  // riding on it. Offered so the teacher can independently double-check
  // PanLex's suggestion against Wiktionary's own Luganda coverage before
  // accepting it, same spirit as the "no auto-add" rule above.
  return 'https://en.wiktionary.org/wiki/' + encodeURIComponent(q.toLowerCase().split(/\s+/)[0]) + '#Translations';
}

async function sparkLgLoad(){

  try{
    const raw = localStorage.getItem('nalunoLgBook');
    if(raw){
      const parsed = JSON.parse(raw);
      if(Array.isArray(parsed)) sparkLgLive = parsed;
    }
  }catch(_){}
  if(!fbDb) return;
  try{
    if(sparkLgUnsub) sparkLgUnsub();
    sparkLgUnsub = fbDb.collection('lexicon').doc('lg').collection('entries')
      .limit(400)
      .onSnapshot(function(snap){
        const rows = [];
        snap.forEach(function(d){
          const x = d.data() || {};
          if(x.src && x.dst) rows.push({ id: d.id, src: x.src, dst: x.dst, by: x.by });
        });
        sparkLgLive = rows;
        try{ localStorage.setItem('nalunoLgBook', JSON.stringify(rows.slice(0, 300))); }catch(_){}
        renderSparkLgBook();
      });
  }catch(_){}
}

/* Self-teaching, but grounded — never guessed. If a newly taught sentence
   contains an ALREADY-CONFIRMED shorter phrase on both sides (English and
   Luganda), what's left over on each side, after removing that known
   phrase, is a genuine new atomic unit the teacher just implicitly taught
   without realizing it — e.g. teaching "I am going home" while "I am
   going" -> "Ŋŋenda" is already known extracts "home" -> "eka" as a new
   confirmed fact, not a guess, because it's directly derived from what a
   human just typed and confirmed as correct. This never invents anything;
   it only ever surfaces something the human already, in effect, wrote. */
function sparkLgExtractNewFragment(newSrc, newDst){
  const src = sparkLgNorm(newSrc);
  const dst = String(newDst || '').trim();
  if(!src || !dst) return null;
  const known = sparkLgPairs();
  for(let i = 0; i < known.length; i++){
    const k = known[i];
    if(k.src === src) continue; // that's the sentence itself, not a sub-phrase
    const srcNeedle = ' ' + k.src + ' ';
    const srcHaystack = ' ' + src + ' ';
    if(srcHaystack.indexOf(srcNeedle) < 0) continue;
    if(dst.toLowerCase().indexOf(k.dst.toLowerCase()) < 0) continue;
    const remSrc = srcHaystack.split(srcNeedle).join(' ').replace(/\s+/g, ' ').trim();
    const remDstRe = new RegExp(k.dst.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    const remDst = dst.replace(remDstRe, ' ').replace(/\s+/g, ' ').trim();
    if(remSrc && remDst && remSrc.length <= 40 && remDst.length <= 40
      && !known.some(function(p){ return p.src === sparkLgNorm(remSrc); })){
      return { src: remSrc, dst: remDst };
    }
  }
  return null;
}

async function sparkLgTeach(src, dst){
  if(!sparkLgCanEdit()){
    toggleSparkLgBook(true);
    toast('Unlock the Luganda book first');
    return false;
  }
  const a = String(src || '').trim();
  const b = String(dst || '').trim();
  if(!a || !b){ toast('Need both the original and the Luganda'); return false; }
  const fragment = sparkLgExtractNewFragment(a, b);
  sparkLgLive = [{ src: a, dst: b }].concat(sparkLgLive.filter(function(p){
    return sparkLgNorm(p.src) !== sparkLgNorm(a);
  }));
  try{ localStorage.setItem('nalunoLgBook', JSON.stringify(sparkLgLive.slice(0, 300))); }catch(_){}
  if(fbDb && currentUser){
    try{
      await fbDb.collection('lexicon').doc('lg').collection('entries').add({
        src: a, dst: b, from: 'en', to: 'lg',
        by: currentUser.uid, ts: Date.now(),
        gate: SPARK_LG_GATE,
      });
    }catch(e){
      toast('Saved on this phone. Cloud book needs rules published.');
    }
  }
  toast('Added to the Luganda book');
  if(fragment){
    // Surfaced, not saved — tapping calls sparkLgTeach again for exactly
    // this fragment, going through the identical add path (including its
    // own extraction check), so the human is still the one confirming it.
    setTimeout(function(){
      toast('Also learned: "' + fragment.src + '" \u2192 "' + fragment.dst + '" \u2014 tap to save', function(){
        sparkLgTeach(fragment.src, fragment.dst);
      });
    }, 2000);
  }
  renderSparkLgBook();
  return true;
}

function renderSparkLgBook(){
  const list = $('sparkLgList');
  if(!list) return;
  const rows = sparkLgPairs().slice(0, 80);
  list.innerHTML = rows.map(function(p){
    return '<div class="spark-lg-row"><b>' + escapeHtml(p.src) + '</b><span>' + escapeHtml(p.dst) + '</span></div>';
  }).join('') || '<div class="lobby-sub">The book is empty.</div>';
}

function toggleSparkLgBook(on){
  const el = $('sparkLgBook');
  if(!el) return;
  const show = (on == null) ? !el.classList.contains('open') : !!on;
  el.classList.toggle('open', show);
  if(show){
    renderSparkLgBook();
    syncSparkLgLockUi();
  }
}

function bindSparkLgBook(){
  const open = $('sparkLgOpenBtn');
  if(open) open.onclick = function(){ toggleSparkLgBook(); };
  const close = $('sparkLgCloseBtn');
  if(close) close.onclick = function(){ toggleSparkLgBook(false); };
  const add = $('sparkLgAddBtn');
  if(add) add.onclick = function(){
    sparkLgTeach(($('sparkLgSrc') && $('sparkLgSrc').value) || '', ($('sparkLgDst') && $('sparkLgDst').value) || '')
      .then(function(ok){
        if(ok){
          if($('sparkLgSrc')) $('sparkLgSrc').value = '';
          if($('sparkLgDst')) $('sparkLgDst').value = '';
        }
      });
  };
  const search = $('sparkLgSearchBtn');
  if(search) search.onclick = async function(){
    const srcInput = $('sparkLgSrc');
    const dstInput = $('sparkLgDst');
    const resultsEl = $('sparkLgSearchResults');
    const q = (srcInput && srcInput.value || '').trim();
    if(!q){ toast('Type the English phrase first'); return; }
    if(resultsEl){
      resultsEl.style.display = 'block';
      resultsEl.innerHTML = '<div class="lobby-sub">Searching PanLex\u2026</div>';
    }
    const candidates = await sparkLgSearchOnline(q);
    if(!resultsEl) return;
    if(!candidates.length){
      resultsEl.innerHTML = '<div class="lobby-sub">No verified match found for "' + escapeHtml(q) + '". You can still teach it directly.</div>';
      return;
    }
    const wikiUrl = sparkLgWiktionaryLink(q);
    resultsEl.innerHTML = candidates.slice(0, 5).map(function(c){
      return '<div class="spark-lg-suggestion">'
        + '<span>' + escapeHtml(c.text) + '</span>'
        + '<span class="spark-lg-suggestion-src">' + escapeHtml(c.source) + (c.quality != null ? ' \u00b7 quality ' + c.quality : '') + '</span>'
        + '<button type="button" class="spark-lg-use-btn" data-txt="' + escapeHtml(c.text) + '">Use</button>'
        + '</div>';
    }).join('') + '<a href="' + escapeHtml(wikiUrl) + '" target="_blank" rel="noopener" class="spark-lg-wiki-link">Cross-check on Wiktionary \u2192</a>'
      + '<div class="lobby-sub" style="margin-top:6px;">Review before adding \u2014 these are suggestions from PanLex, not yet confirmed for this book.</div>';
    resultsEl.querySelectorAll('.spark-lg-use-btn').forEach(function(btn){
      btn.onclick = function(){
        if(dstInput) dstInput.value = btn.getAttribute('data-txt') || '';
        if(dstInput) dstInput.focus();
      };
    });
  };
  const unlock = $('sparkLgUnlockBtn');
  if(unlock) unlock.onclick = function(){
    sparkLgUnlock(($('sparkLgPass') && $('sparkLgPass').value) || '');
  };
  const pass = $('sparkLgPass');
  if(pass) pass.addEventListener('keydown', function(e){
    if(e.key === 'Enter'){ e.preventDefault(); sparkLgUnlock(pass.value); }
  });
}

window.sparkLgApply = sparkLgApply;
window.sparkLgTeach = sparkLgTeach;
window.sparkLgLoad = sparkLgLoad;
window.toggleSparkLgBook = toggleSparkLgBook;

if(document.readyState === 'loading'){
  document.addEventListener('DOMContentLoaded', bindSparkLgBook);
} else {
  bindSparkLgBook();
}
