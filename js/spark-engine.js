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
    'thank you': 'Asante',
    'thanks': 'Asante',
    'yes': 'Ndiyo',
    'no': 'Hapana',
    'please': 'Tafadhali',
    'sorry': 'Samahani',
    'goodbye': 'Kwaheri',
    'stop': 'Simama',
    'my god': 'Mungu wangu',
    'god': 'Mungu',
    'peace': 'Amani',
    'friend': 'Rafiki',
    'i love you': 'Nakupenda',
    'what called you here?': 'Nini kilikuleta hapa?',
    'where does your voice come from?': 'Sauti yako inatoka wapi?',
    'what are you building?': 'Unajenga nini?',
    'ok': 'Sawa',
    'okay': 'Sawa',
  },
  'en|ar': {
    'hello': 'مرحبا',
    'hi': 'أهلا',
    'thank you': 'شكرا',
    'yes': 'نعم',
    'no': 'لا',
    'please': 'من فضلك',
    'sorry': 'آسف',
    'goodbye': 'مع السلامة',
    'stop': 'قف',
    'ok': 'حسنا',
  },
  'en|fr': {
    'hello': 'Bonjour',
    'hi': 'Salut',
    'thank you': 'Merci',
    'yes': 'Oui',
    'no': 'Non',
    'please': 'S’il vous plaît',
    'sorry': 'Désolé',
    'goodbye': 'Au revoir',
    'stop': 'Arrête',
    'ok': 'D’accord',
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
  return /MYMEMORY|QUERY LENGTH LIMIT|QUOTA|VISIT HTTPS:\/\/MYMEMORY/i.test(t);
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
  if(cached && !sparkTxIsJunk(cached)) return cached;
  try{
    if(typeof Translator !== 'undefined' && Translator.create){
      const tr = await Translator.create({ sourceLanguage: from, targetLanguage: to });
      const out = await tr.translate(src);
      if(out && !sparkTxIsJunk(out)){
        sparkTxCacheSet(from, to, src, out);
        return out;
      }
    }
  }catch(_){}
  try{
    const res = await fetch('https://naluno-spark-translate.naluno.workers.dev', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: src.slice(0, 800), from: from, to: to }),
    });
    if(res.ok){
      const data = await res.json();
      if(data && data.text && !sparkTxIsJunk(data.text)){
        sparkTxCacheSet(from, to, src, data.text);
        return data.text;
      }
    }
  }catch(_){}
  try{
    const url = 'https://lingva.ml/api/v1/' + encodeURIComponent(from) + '/' + encodeURIComponent(to) + '/' + encodeURIComponent(src.slice(0, 500));
    const res = await fetch(url);
    if(res.ok){
      const data = await res.json();
      const out = data && (data.translation || data.text);
      if(out && !sparkTxIsJunk(out)){
        sparkTxCacheSet(from, to, src, out);
        return out;
      }
    }
  }catch(_){}
  return src;
}

window.sparkEngineTranslate = sparkEngineTranslate;
window.sparkTxIsJunk = sparkTxIsJunk;
