/* ============================================================
   MODULE: js/spark-engine.js
   Naluno translation — glossary + cache. No quota services.
   OWNERSHIP: Spark text only.
   ============================================================ */

const SPARK_BOOK = {
  'en|sw': {
    'hello': 'Habari',
    'hi': 'Mambo',
    'how are you': 'Uko aje',
    'how are you?': 'Uko aje?',
    'i am fine': 'Niko sawa',
    'i\'m fine': 'Niko sawa',
    'thank you': 'Asante',
    'thanks': 'Asante',
    'thank you very much': 'Asante sana',
    'yes': 'Ndiyo',
    'no': 'Hapana',
    'please': 'Tafadhali',
    'sorry': 'Samahani',
    'goodbye': 'Kwaheri',
    'bye': 'Kwaheri',
    'stop': 'Simama',
    'my god': 'Mungu wangu',
    'god': 'Mungu',
    'peace': 'Amani',
    'friend': 'Rafiki',
    'i love you': 'Nakupenda',
    'i love this': 'Napenda hii',
    'what called you here?': 'Nini kilikuleta hapa?',
    'where does your voice come from?': 'Sauti yako inatoka wapi?',
    'what are you building?': 'Unajenga nini?',
    'what should we remember from this meeting?': 'Tunakumbuke nini kutoka mkutano huu?',
    'ok': 'Sawa',
    'okay': 'Sawa',
    'good morning': 'Habari ya asubuhi',
    'good night': 'Usiku mwema',
    'welcome': 'Karibu',
    'water': 'Maji',
    'food': 'Chakula',
    'come': 'Njoo',
    'go': 'Nenda',
    'wait': 'Ngoja',
    'help me': 'Nisaidie',
    'where': 'Wapi',
    'when': 'Lini',
    'who': 'Nani',
    'why': 'Kwa nini',
    'what': 'Nini',
  },
  'en|ar': {
    'hello': 'مرحبا',
    'hi': 'أهلا',
    'how are you': 'كيف حالك',
    'thank you': 'شكرا',
    'thanks': 'شكرا',
    'yes': 'نعم',
    'no': 'لا',
    'please': 'من فضلك',
    'sorry': 'آسف',
    'goodbye': 'مع السلامة',
    'bye': 'مع السلامة',
    'stop': 'قف',
    'ok': 'حسنا',
    'okay': 'حسنا',
    'peace': 'سلام',
    'friend': 'صديق',
    'welcome': 'أهلا وسهلا',
    'water': 'ماء',
    'come': 'تعال',
    'go': 'اذهب',
    'wait': 'انتظر',
  },
  'en|fr': {
    'hello': 'Bonjour',
    'hi': 'Salut',
    'how are you': 'Comment ça va',
    'thank you': 'Merci',
    'thanks': 'Merci',
    'yes': 'Oui',
    'no': 'Non',
    'please': 'S’il vous plaît',
    'sorry': 'Désolé',
    'goodbye': 'Au revoir',
    'bye': 'Salut',
    'stop': 'Arrête',
    'ok': 'D’accord',
    'okay': 'D’accord',
    'welcome': 'Bienvenue',
    'friend': 'Ami',
    'i love you': 'Je t’aime',
    'come': 'Viens',
    'go': 'Va',
    'wait': 'Attends',
  },
  'en|es': {
    'hello': 'Hola',
    'hi': 'Hola',
    'thank you': 'Gracias',
    'yes': 'Sí',
    'no': 'No',
    'please': 'Por favor',
    'sorry': 'Lo siento',
    'goodbye': 'Adiós',
    'ok': 'Vale',
    'friend': 'Amigo',
  },
  'en|pt': {
    'hello': 'Olá',
    'hi': 'Oi',
    'thank you': 'Obrigado',
    'yes': 'Sim',
    'no': 'Não',
    'please': 'Por favor',
    'sorry': 'Desculpa',
    'goodbye': 'Tchau',
    'ok': 'Ok',
  },
};

function sparkTxKey(from, to, text){
  return String(from) + '|' + String(to) + '|' + String(text || '').toLowerCase().trim();
}

function sparkTxCacheGet(from, to, text){
  try{
    const all = JSON.parse(localStorage.getItem('nalunoSparkTx') || '{}');
    return all[sparkTxKey(from, to, text)] || '';
  }catch(_){ return ''; }
}

function sparkTxCacheSet(from, to, text, out){
  if(!out) return;
  try{
    const all = JSON.parse(localStorage.getItem('nalunoSparkTx') || '{}');
    all[sparkTxKey(from, to, text)] = out;
    const keys = Object.keys(all);
    if(keys.length > 400){
      keys.slice(0, keys.length - 400).forEach(function(k){ delete all[k]; });
    }
    localStorage.setItem('nalunoSparkTx', JSON.stringify(all));
  }catch(_){}
}

function sparkBookApply(text, from, to){
  const src = String(text || '').trim();
  if(!src || from === to) return '';
  const pair = SPARK_BOOK[from + '|' + to];
  const rev = SPARK_BOOK[to + '|' + from];
  const key = src.toLowerCase();
  if(pair && pair[key]) return pair[key];
  if(rev){
    const hit = Object.keys(rev).find(function(k){ return String(rev[k]).toLowerCase() === key; });
    if(hit) return hit;
  }
  return '';
}

function sparkTxIsJunk(s){
  const t = String(s || '');
  return /MYMEMORY|QUERY LENGTH LIMIT|QUOTA|VISIT HTTPS:\/\/MYMEMORY|ERROR:|UNTRANSLATED/i.test(t);
}

function sparkTxIsEcho(src, out){
  if(!out) return true;
  const a = String(src || '').trim().toLowerCase().replace(/\s+/g, ' ');
  const b = String(out || '').trim().toLowerCase().replace(/\s+/g, ' ');
  return !!a && a === b;
}

function sparkTxAccept(src, out, from, to){
  if(!out) return false;
  if(sparkTxIsJunk(out)) return false;
  if(from && to && from !== to && sparkTxIsEcho(src, out)) return false;
  return true;
}

function sparkFetch(url, opts, ms){
  const ctl = new AbortController();
  const t = setTimeout(function(){ ctl.abort(); }, ms || 4000);
  return fetch(url, Object.assign({}, opts || {}, { signal: ctl.signal }))
    .finally(function(){ clearTimeout(t); });
}

function sparkMapLang(id){
  const s = String(id || 'en').toLowerCase();
  if(s === 'zh') return 'zh-CN';
  return s;
}

function sparkParseGtx(data){
  try{
    if(!Array.isArray(data) || !Array.isArray(data[0])) return '';
    return data[0].map(function(row){ return row && row[0] ? row[0] : ''; }).join('');
  }catch(_){ return ''; }
}

async function sparkEngineTranslate(text, from, to){
  const src = String(text || '').trim();
  if(!src) return '';
  if(!from || !to || from === to) return src;
  if(typeof sparkLgApply === 'function' && (from === 'lg' || to === 'lg')){
    const known = sparkLgApply(src, from, to);
    if(known) return known;
  }
  const book = sparkBookApply(src, from, to);
  if(book) return book;
  const cached = sparkTxCacheGet(from, to, src);
  if(cached && sparkTxAccept(src, cached, from, to)) return cached;

  const sl = sparkMapLang(from);
  const tl = sparkMapLang(to);

  try{
    const onAndroid = /Android/i.test(navigator.userAgent || '');
    if(!onAndroid && typeof Translator !== 'undefined' && Translator.create && Translator.availability){
      const avail = await Promise.race([
        Translator.availability({ sourceLanguage: sl, targetLanguage: tl }),
        new Promise(function(res){ setTimeout(function(){ res('unavailable'); }, 1500); }),
      ]);
      if(avail === 'available'){
        const tr = await Promise.race([
          Translator.create({ sourceLanguage: sl, targetLanguage: tl }),
          new Promise(function(_, rej){ setTimeout(function(){ rej(new Error('timeout')); }, 2000); }),
        ]);
        const out = await tr.translate(src);
        if(sparkTxAccept(src, out, from, to)){
          sparkTxCacheSet(from, to, src, out);
          return out;
        }
      }
    }
  }catch(_){}

  try{
    const res = await sparkFetch('https://naluno-spark-translate.naluno.workers.dev', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: src.slice(0, 800), from: sl, to: tl }),
    }, 5500);
    if(res.ok){
      const data = await res.json();
      if(data && sparkTxAccept(src, data.text, from, to)){
        sparkTxCacheSet(from, to, src, data.text);
        return data.text;
      }
    }
  }catch(_){}

  try{
    const gtx = 'https://translate.googleapis.com/translate_a/single?client=gtx&sl='
      + encodeURIComponent(sl) + '&tl=' + encodeURIComponent(tl)
      + '&dt=t&q=' + encodeURIComponent(src.slice(0, 500));
    const res = await sparkFetch(gtx, {}, 4000);
    if(res.ok){
      const data = await res.json();
      const out = sparkParseGtx(data);
      if(sparkTxAccept(src, out, from, to)){
        sparkTxCacheSet(from, to, src, out);
        return out;
      }
    }
  }catch(_){}

  try{
    const hosts = ['https://lingva.ml', 'https://lingva.garudalinux.org'];
    for(let i = 0; i < hosts.length; i++){
      try{
        const url = hosts[i] + '/api/v1/' + encodeURIComponent(sl) + '/' + encodeURIComponent(tl) + '/' + encodeURIComponent(src.slice(0, 500));
        const res = await sparkFetch(url, {}, 3500);
        if(!res.ok) continue;
        const data = await res.json();
        const out = data && (data.translation || data.text);
        if(sparkTxAccept(src, out, from, to)){
          sparkTxCacheSet(from, to, src, out);
          return out;
        }
      }catch(_){}
    }
  }catch(_){}

  return '';
}

window.sparkEngineTranslate = sparkEngineTranslate;
window.sparkTxIsJunk = sparkTxIsJunk;
window.sparkTxAccept = sparkTxAccept;
window.sparkTxIsEcho = sparkTxIsEcho;
