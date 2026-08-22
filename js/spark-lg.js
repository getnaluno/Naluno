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

async function sparkLgTeach(src, dst){
  if(!sparkLgCanEdit()){
    toggleSparkLgBook(true);
    toast('Unlock the Luganda book first');
    return false;
  }
  const a = String(src || '').trim();
  const b = String(dst || '').trim();
  if(!a || !b){ toast('Need both the original and the Luganda'); return false; }
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
