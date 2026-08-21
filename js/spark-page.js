/* ============================================================
   MODULE: js/spark-page.js
   Shared Spark page after two people pulse.
   Live text + voice, each speaking their own language.
   OWNERSHIP: sparkRooms + translation only.
   ============================================================ */

const SPARK_LANGS = [
  { id:'en', name:'English', rec:'en-US' },
  { id:'ar', name:'العربية', rec:'ar-AE' },
  { id:'fr', name:'Français', rec:'fr-FR' },
  { id:'sw', name:'Kiswahili', rec:'sw-KE' },
  { id:'lg', name:'Luganda', rec:'lg-UG' },
  { id:'es', name:'Español', rec:'es-ES' },
  { id:'pt', name:'Português', rec:'pt-BR' },
  { id:'hi', name:'हिन्दी', rec:'hi-IN' },
  { id:'zh', name:'中文', rec:'zh-CN' },
  { id:'tr', name:'Türkçe', rec:'tr-TR' },
  { id:'de', name:'Deutsch', rec:'de-DE' },
  { id:'ru', name:'Русский', rec:'ru-RU' },
  { id:'ko', name:'한국어', rec:'ko-KR' },
  { id:'ja', name:'日本語', rec:'ja-JP' },
  { id:'am', name:'አማርኛ', rec:'am-ET' },
  { id:'so', name:'Soomaali', rec:'so-SO' },
  { id:'fa', name:'فارسی', rec:'fa-IR' },
];

const SPARK_ICE = [
  'What called you here?',
  'Where does your voice come from?',
  'What are you building?',
  'What should we remember from this meeting?',
];

const SPARK_TRANSLATE_WORKER = 'https://naluno-spark-translate.naluno.workers.dev';

let sparkRoomId = null;
let sparkOtherUid = null;
let sparkOtherName = 'Them';
let sparkMyLang = 'en';
let sparkTheirLang = 'en';
let sparkUnsub = null;
let sparkMsgUnsub = null;
let sparkVoiceRec = null;
let sparkVoiceChunks = [];
let sparkVoiceStream = null;
let sparkListen = null;

function sparkGuessLang(){
  const nav = String((navigator.language || 'en')).toLowerCase();
  const hit = SPARK_LANGS.find(function(l){ return nav.indexOf(l.id) === 0; });
  return hit ? hit.id : 'en';
}

function sparkRoomKey(a, b){
  return [String(a), String(b)].sort().join('_');
}

function sparkLangName(id){
  const hit = SPARK_LANGS.find(function(l){ return l.id === id; });
  return hit ? hit.name : id;
}

function sparkRecLang(id){
  const hit = SPARK_LANGS.find(function(l){ return l.id === id; });
  return hit ? hit.rec : 'en-US';
}

async function sparkTranslate(text, from, to){
  if(typeof sparkEngineTranslate === 'function'){
    return sparkEngineTranslate(text, from, to);
  }
  const src = String(text || '').trim();
  if(!src || !from || !to || from === to) return src;
  return src;
}

async function ensureSparkRoom(otherUid, otherName){
  if(!currentUser || !fbDb || !otherUid) return null;
  const id = sparkRoomKey(currentUser.uid, otherUid);
  const ref = fbDb.collection('sparkRooms').doc(id);
  const mine = sparkGuessLang();
  const names = {};
  names[currentUser.uid] = (currentProfile && currentProfile.name) || 'You';
  names[otherUid] = otherName || 'Them';
  const langs = {};
  langs[currentUser.uid] = mine;
  await ref.set({
    participants: [currentUser.uid, otherUid].sort(),
    names: names,
    langs: langs,
    updatedAt: Date.now(),
  }, { merge: true });
  try{ localStorage.setItem('nalunoLastSpark', JSON.stringify({ id: id, otherUid: otherUid, otherName: otherName || 'Them' })); }catch(_){}
  return id;
}

function closeSparkPage(){
  if(sparkUnsub){ try{ sparkUnsub(); }catch(_){} sparkUnsub = null; }
  if(sparkMsgUnsub){ try{ sparkMsgUnsub(); }catch(_){} sparkMsgUnsub = null; }
  stopSparkVoice();
  const page = $('sparkPage');
  if(page) page.classList.remove('active');
}

async function openSparkPage(otherUid, otherName){
  if(!currentUser || !fbDb || !otherUid) return;
  sparkOtherUid = otherUid;
  sparkOtherName = otherName || 'Them';
  sparkMyLang = sparkGuessLang();
  sparkRoomId = await ensureSparkRoom(otherUid, sparkOtherName);
  const page = $('sparkPage');
  if(!page) return;
  if($('sparkPageName')) $('sparkPageName').textContent = sparkOtherName;
  fillSparkLangSelects();
  page.classList.add('active');
  listenSparkRoom();
  try{ if(typeof sparkLgLoad === 'function') sparkLgLoad(); }catch(_){}
}

function fillSparkLangSelects(){
  const sel = $('sparkMyLang');
  if(!sel) return;
  sel.innerHTML = SPARK_LANGS.map(function(l){
    return '<option value="' + l.id + '"' + (l.id === sparkMyLang ? ' selected' : '') + '>' + l.name + '</option>';
  }).join('');
  sel.onchange = async function(){
    sparkMyLang = sel.value;
    if(!fbDb || !sparkRoomId || !currentUser) return;
    const patch = {};
    patch['langs.' + currentUser.uid] = sparkMyLang;
    try{ await fbDb.collection('sparkRooms').doc(sparkRoomId).update(patch); }catch(_){}
  };
}

function listenSparkRoom(){
  if(sparkUnsub){ try{ sparkUnsub(); }catch(_){} }
  if(sparkMsgUnsub){ try{ sparkMsgUnsub(); }catch(_){} }
  if(!fbDb || !sparkRoomId) return;
  const roomRef = fbDb.collection('sparkRooms').doc(sparkRoomId);
  sparkUnsub = roomRef.onSnapshot(function(snap){
    const d = snap.data() || {};
    const langs = d.langs || {};
    if(langs[sparkOtherUid]) sparkTheirLang = langs[sparkOtherUid];
    if(langs[currentUser && currentUser.uid]) sparkMyLang = langs[currentUser.uid];
    if($('sparkTheirLangLabel')){
      $('sparkTheirLangLabel').textContent = sparkLangName(sparkTheirLang);
    }
  });
  sparkMsgUnsub = roomRef.collection('messages').orderBy('ts', 'asc').limitToLast(80).onSnapshot(function(snap){
    renderSparkMessages(snap.docs.map(function(doc){ return Object.assign({ id: doc.id }, doc.data()); }));
  }, function(){});
}

function sparkSpeak(text, lang){
  if(!text || !window.speechSynthesis) return;
  try{
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = sparkRecLang(lang || sparkMyLang);
    window.speechSynthesis.speak(u);
  }catch(_){}
}

function renderSparkMessages(rows){
  const box = $('sparkPageMsgs');
  if(!box) return;
  if(!rows.length){
    box.innerHTML = '<div class="spark-empty">Two voices. One page. Type or hold to speak — they hear you in their language.</div>';
    return;
  }
  box.innerHTML = rows.map(function(m){
    const mine = m.from === (currentUser && currentUser.uid);
    const shown = mine
      ? (m.text || '')
      : ((m.translations && m.translations[sparkMyLang]) || m.text || '');
    const orig = (!mine && m.text && m.text !== shown) ? m.text : '';
    const voice = m.audioUrl
      ? '<audio controls preload="metadata" src="' + escapeHtml(m.audioUrl) + '" style="width:100%;margin-top:6px;"></audio>'
      : '';
    const hear = shown
      ? '<button type="button" class="spark-hear" data-say="' + encodeURIComponent(shown) + '">Listen</button>'
      : '';
    const teach = (!mine && (sparkMyLang === 'lg' || sparkTheirLang === 'lg'))
      ? '<button type="button" class="spark-hear" data-teach="' + encodeURIComponent(m.text || '') + '">Fix Luganda</button>'
      : '';
    return '<div class="spark-row ' + (mine ? 'me' : 'them') + '">'
      + '<div class="spark-bubble">'
      + '<div class="spark-main">' + escapeHtml(shown) + '</div>'
      + (orig ? '<div class="spark-orig">' + escapeHtml(orig) + '</div>' : '')
      + voice + hear + teach
      + '</div></div>';
  }).join('');
  box.querySelectorAll('.spark-hear').forEach(function(btn){
    btn.onclick = function(){
      if(btn.getAttribute('data-teach') != null){
        const src = decodeURIComponent(btn.getAttribute('data-teach') || '');
        const better = prompt('Correct Luganda for:\n' + src, shown);
        if(better && typeof sparkLgTeach === 'function') sparkLgTeach(src, better);
        return;
      }
      sparkSpeak(decodeURIComponent(btn.getAttribute('data-say') || ''), sparkMyLang);
    };
  });
  box.scrollTop = box.scrollHeight;
}

async function sendSparkText(raw, extra){
  const text = String(raw || '').trim();
  if(!text || !fbDb || !sparkRoomId || !currentUser) return;
  const translations = {};
  if(sparkTheirLang && sparkTheirLang !== sparkMyLang){
    try{ translations[sparkTheirLang] = await sparkTranslate(text, sparkMyLang, sparkTheirLang); }catch(_){}
  }
  const payload = Object.assign({
    from: currentUser.uid,
    type: (extra && extra.type) || 'text',
    text: text,
    lang: sparkMyLang,
    translations: translations,
    ts: Date.now(),
  }, extra || {});
  await fbDb.collection('sparkRooms').doc(sparkRoomId).collection('messages').add(payload);
}

async function sendSparkIce(phrase){
  if($('sparkInput')) $('sparkInput').value = '';
  await sendSparkText(phrase);
}

function stopSparkVoice(){
  try{ if(sparkListen) sparkListen.stop(); }catch(_){}
  sparkListen = null;
  try{ if(sparkVoiceRec && sparkVoiceRec.state !== 'inactive') sparkVoiceRec.stop(); }catch(_){}
  sparkVoiceRec = null;
  if(sparkVoiceStream){
    sparkVoiceStream.getTracks().forEach(function(t){ t.stop(); });
    sparkVoiceStream = null;
  }
  const btn = $('sparkTalkBtn');
  if(btn) btn.classList.remove('hot');
}

async function startSparkVoice(){
  if(!navigator.mediaDevices){ toast('Voice is not available here'); return; }
  stopSparkVoice();
  let heard = '';
  try{
    const Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
    if(Rec){
      sparkListen = new Rec();
      sparkListen.lang = sparkRecLang(sparkMyLang);
      sparkListen.interimResults = true;
      sparkListen.continuous = true;
      sparkListen.onresult = function(e){
        let s = '';
        for(let i = 0; i < e.results.length; i++) s += e.results[i][0].transcript;
        heard = s;
        if($('sparkInput')) $('sparkInput').value = s;
      };
      sparkListen.start();
    }
  }catch(_){}
  try{
    sparkVoiceStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    sparkVoiceChunks = [];
    sparkVoiceRec = new MediaRecorder(sparkVoiceStream);
    sparkVoiceRec.ondataavailable = function(e){ if(e.data && e.data.size) sparkVoiceChunks.push(e.data); };
    sparkVoiceRec.onstop = async function(){
      const blob = new Blob(sparkVoiceChunks, { type: sparkVoiceRec.mimeType || 'audio/webm' });
      let url = '';
      try{
        if(typeof uploadVideoToR2 === 'function' && blob.size > 200){
          url = await uploadVideoToR2(new File([blob], 'spark-voice.webm', { type: blob.type }));
        }
      }catch(_){}
      const text = ($('sparkInput') && $('sparkInput').value.trim()) || heard || 'Voice';
      await sendSparkText(text, { type: 'voice', audioUrl: url || '' });
      if($('sparkInput')) $('sparkInput').value = '';
    };
    sparkVoiceRec.start();
    const btn = $('sparkTalkBtn');
    if(btn) btn.classList.add('hot');
    toast('Listening — release to send');
  }catch(e){
    toast('Allow the microphone, then try again');
  }
}

function bindSparkPage(){
  const back = $('sparkPageBack');
  if(back) back.onclick = closeSparkPage;
  const send = $('sparkSendBtn');
  if(send) send.onclick = function(){
    const input = $('sparkInput');
    const t = input && input.value;
    if(input) input.value = '';
    sendSparkText(t).catch(function(e){ toast((e && e.message) || 'Could not send'); });
  };
  const input = $('sparkInput');
  if(input){
    input.addEventListener('keydown', function(e){
      if(e.key === 'Enter' && !e.shiftKey){
        e.preventDefault();
        send.click();
      }
    });
  }
  const talk = $('sparkTalkBtn');
  if(talk){
    const down = function(e){ e.preventDefault(); startSparkVoice(); };
    const up = function(e){ e.preventDefault(); stopSparkVoice(); };
    talk.addEventListener('pointerdown', down);
    talk.addEventListener('pointerup', up);
    talk.addEventListener('pointercancel', up);
    talk.addEventListener('pointerleave', function(e){ if(talk.classList.contains('hot')) up(e); });
  }
  const ice = $('sparkIce');
  if(ice){
    ice.innerHTML = SPARK_ICE.map(function(p){
      return '<button type="button" class="spark-ice" data-ice="' + escapeHtml(p) + '">' + escapeHtml(p) + '</button>';
    }).join('');
    ice.querySelectorAll('[data-ice]').forEach(function(b){
      b.onclick = function(){ sendSparkIce(b.getAttribute('data-ice')); };
    });
  }
}

window.openSparkPage = openSparkPage;
window.closeSparkPage = closeSparkPage;
window.ensureSparkRoom = ensureSparkRoom;

if(document.readyState === 'loading'){
  document.addEventListener('DOMContentLoaded', bindSparkPage);
} else {
  bindSparkPage();
}
