/* OWNERSHIP (broadcast-space.js): Broadcast VOD/live community only.
   MUST NOT touch: calls peerConnection, remoteCombinedStream, bandMeshPcs.
   ICE for live: getIceServers() from ice-core. Playback: <video src> only. */
/* ============================================================
   MODULE: js/broadcast-space.js
   Broadcast = living community, not a video player.
   Video is the first message; conversation, questions, results,
   resources, and journey make it valuable.
   OWNERSHIP: Broadcast Space UI + Firestore community data.
   ============================================================ */

let activeBroadcastId = null;
let activeBroadcastMeta = null; // { contactId?, isMine, creatorUid, title, ... }
let bspaceUnsubs = [];

function bspaceClearListeners(){
  bspaceUnsubs.forEach(u=>{ try{ u(); }catch(e){} });
  bspaceUnsubs = [];
  roomReactRows = [];
  bspaceDocCache = {};
}

function bspaceEscape(s){
  return escapeHtml(String(s == null ? '' : s));
}

function bspaceWhoLabel(uid){
  if(!uid) return 'Someone';
  if(currentUser && uid === currentUser.uid) return 'You';
  const c = contacts.find(x => x.firebaseUid === uid);
  if(c) return (c.name || 'Someone').split(' ')[0];
  if(activeBroadcastMeta && activeBroadcastMeta.creatorUid === uid){
    return (activeBroadcastMeta.creatorName || 'Creator').split(' ')[0];
  }
  return 'Member';
}

function ensureBroadcastDocId(meta){
  if(meta.broadcastId) return meta.broadcastId;
  // Legacy fallback for old signal-linked spaces
  if(meta.isMine && meta.segment && meta.segment.id) return 'sig_' + meta.segment.id;
  if(meta.contactId != null && meta.segment && meta.segment.createdAt){
    return 'c' + meta.contactId + '_' + meta.segment.createdAt;
  }
  return 'local_' + Date.now();
}

async function ensureBroadcastFirestore(meta){
  if(!fbDb || !currentUser) return null;
  const id = ensureBroadcastDocId(meta);
  const ref = fbDb.collection('broadcasts').doc(id);
  const snap = await ref.get();
  if(meta.broadcastId && snap.exists) return id;
  if(!snap.exists){
    const seg = meta.segment || {};
    const listing = (typeof nalunoBroadcastListingFields === 'function')
      ? nalunoBroadcastListingFields()
      : { listed: false, held: true, heldReason: 'new-publisher', hidden: false };
    await ref.set(Object.assign({
      creatorUid: meta.creatorUid || currentUser.uid,
      creatorName: meta.creatorName || (currentProfile && currentProfile.name) || 'Someone',
      title: meta.title || (seg.text ? String(seg.text).slice(0, 80) : 'Broadcast'),
      description: meta.description || (seg.caption || seg.text || ''),
      tags: meta.tags || [],
      mediaType: seg.type || 'photo',
      mediaUrl: seg.videoUrl || seg.photoUrl || seg.dataUrl || null,
      thumb: seg.thumbDataUrl || null,
      filterCss: seg.filterCss || '',
      bg: seg.bg || null,
      createdAt: seg.createdAt || Date.now(),
      updatedAt: Date.now(),
      memberUids: [meta.creatorUid || currentUser.uid],
      source: meta.isMine ? 'signal_self' : 'signal_contact',
    }, listing));
    // Journey seed
    await ref.collection('journey').add({
      type: 'created',
      text: 'Broadcast opened',
      ts: Date.now(),
      by: meta.creatorUid || currentUser.uid,
    });
  }
  return id;
}

let bspaceSpeakToken = 0;
let bspaceSpeakAudio = null;
function bspaceStopSpeak(){
  bspaceSpeakToken += 1;
  try{ if(window.speechSynthesis) window.speechSynthesis.cancel(); }catch(_){}
  try{ if(bspaceSpeakAudio){ bspaceSpeakAudio.pause(); bspaceSpeakAudio.src = ''; bspaceSpeakAudio = null; } }catch(_){}
}
function bspacePlayUrl(url, token){
  return new Promise(function(resolve){
    if(token !== bspaceSpeakToken){ resolve(false); return; }
    const audio = new Audio();
    bspaceSpeakAudio = audio;
    let done = false;
    function finish(ok){
      if(done) return;
      done = true;
      if(bspaceSpeakAudio === audio) bspaceSpeakAudio = null;
      resolve(!!ok && token === bspaceSpeakToken);
    }
    audio.onended = function(){ finish(true); };
    audio.onerror = function(){ finish(false); };
    const giveUp = setTimeout(function(){ finish(false); }, 8000);
    audio.onplaying = function(){ clearTimeout(giveUp); };
    audio.src = url;
    const started = audio.play();
    if(started && started.catch) started.catch(function(){ finish(false); });
  });
}
async function bspacePlayNativeLg(text, token){
  const src = String(text || '').trim();
  if(!src) return false;
  const bits = [];
  const sentences = src.split(/(?<=[.!?])\s+/);
  sentences.forEach(function(sentence){
    const s = sentence.trim();
    if(!s) return;
    for(let i = 0; i < s.length; i += 180) bits.push(s.slice(i, i + 180));
  });
  if(!bits.length) return false;
  for(let i = 0; i < bits.length; i++){
    if(token !== bspaceSpeakToken) return false;
    const url = 'https://translate.googleapis.com/translate_tts?ie=UTF-8&client=gtx&tl=lg&q=' + encodeURIComponent(bits[i]);
    const ok = await bspacePlayUrl(url, token);
    if(!ok) return false;
  }
  return token === bspaceSpeakToken;
}
async function bspaceSpeakWriting(text, lang, btn){
  const src = String(text || '').replace(/\s+/g, ' ').replace(/\bSee more\b|\bSee less\b/g, '').trim();
  if(!src){ toast('Nothing to read'); return; }
  if(btn && btn.getAttribute('data-on') === '1'){
    btn.removeAttribute('data-on');
    btn.textContent = 'Listen';
    bspaceStopSpeak();
    return;
  }
  const token = bspaceSpeakToken + 1;
  bspaceSpeakToken = token;
  if(btn){ btn.setAttribute('data-on', '1'); btn.textContent = 'Stop'; }
  if(lang === 'lg'){
    try{
      const played = await bspacePlayNativeLg(src, token);
      if(token !== bspaceSpeakToken) return;
      if(played){
        if(btn){ btn.removeAttribute('data-on'); btn.textContent = 'Listen'; }
        return;
      }
    }catch(_){}
  }
  if(token !== bspaceSpeakToken) return;
  if(!window.speechSynthesis){
    toast('This phone cannot read aloud');
    if(btn){ btn.removeAttribute('data-on'); btn.textContent = 'Listen'; }
    return;
  }
  const spoken = (lang === 'lg' && window.NalunoLgSpeak && typeof NalunoLgSpeak.speak === 'function')
    ? NalunoLgSpeak.speak(src)
    : src;
  const voiceLang = lang === 'lg' ? 'lg' : (lang || ((typeof sparkGuessLang === 'function') ? sparkGuessLang() : 'en'));
  const voice = bspacePickVoice(voiceLang);
  const rec = (typeof SPARK_LANGS !== 'undefined' && SPARK_LANGS.find(function(l){ return l.id === (lang || voiceLang); }));
  window.speechSynthesis.cancel();
  const chunks = [];
  for(let i = 0; i < spoken.length; i += 1500) chunks.push(spoken.slice(i, i + 1500));
  chunks.forEach(function(chunk, idx){
    const u = new SpeechSynthesisUtterance(chunk);
    u.lang = (voice && voice.lang) || (lang === 'lg' ? 'sw-KE' : ((rec && rec.rec) || 'en-US'));
    if(voice) u.voice = voice;
    u.rate = lang === 'lg' ? 1 : 0.98;
    u.pitch = 1;
    if(idx === chunks.length - 1){
      u.onend = function(){
        if(token !== bspaceSpeakToken || !btn) return;
        btn.removeAttribute('data-on');
        btn.textContent = 'Listen';
      };
    }
    window.speechSynthesis.speak(u);
  });
}

function bspacePickVoice(lang){
  if(!window.speechSynthesis || !window.speechSynthesis.getVoices) return null;
  const voices = window.speechSynthesis.getVoices() || [];
  const want = String(lang || 'en').toLowerCase().slice(0, 2);
  let best = null;
  let bestScore = 0;
  voices.forEach(function(v){
    const name = String(v.name || '').toLowerCase();
    const vl = String(v.lang || '').toLowerCase();
    let s = 0;
    if(want === 'lg'){
      if(vl.indexOf('lg') === 0) s += 12;
      else if(vl.indexOf('sw') === 0) s += 7;
      else if(vl.indexOf('en-ug') === 0 || vl.indexOf('en_ug') === 0) s += 5;
    } else if(vl.indexOf(want) === 0) s += 5;
    if(/natural|neural|premium|enhanced|wavenet|studio/.test(name)) s += 4;
    if(/google/.test(name) && want !== 'lg') s += 2;
    if(/compact|espeak/.test(name)) s -= 4;
    if(s > bestScore){ bestScore = s; best = v; }
  });
  return best;
}
try{
  if(window.speechSynthesis){
    window.speechSynthesis.getVoices();
    window.speechSynthesis.addEventListener('voiceschanged', function(){ window.speechSynthesis.getVoices(); });
  }
}catch(_){}

let bspaceWriteOrig = [];
let bspaceWriteTitles = [];
let bspaceLangToken = 0;
let bspacePendingCover = null;
const bspaceTxMemo = Object.create(null);
function bspaceTranslateChunk(bit, from, to){
  if(typeof sparkEngineTranslate !== 'function') return Promise.resolve(bit);
  return sparkEngineTranslate(bit, from, to).then(function(out){ return out || bit; }).catch(function(){ return bit; });
}
async function bspaceTranslateText(text, to, onPartial){
  if(!to || typeof sparkEngineTranslate !== 'function') return text;
  const guessed = (typeof sparkGuessLang === 'function') ? sparkGuessLang() : 'en';
  const from = guessed === to ? 'en' : guessed;
  const src = String(text || '');
  if(!src) return src;
  if(from === to) return src;
  const key = from + '>' + to + '\n' + src;
  if(bspaceTxMemo[key]){
    if(typeof onPartial === 'function') onPartial(bspaceTxMemo[key], true);
    return bspaceTxMemo[key];
  }
  const size = 480;
  const bits = [];
  for(let i = 0; i < src.length; i += size) bits.push(src.slice(i, i + size));
  const outs = new Array(bits.length);
  let pending = bits.length;
  await new Promise(function(resolve){
    if(!bits.length){ resolve(); return; }
    bits.forEach(function(bit, idx){
      bspaceTranslateChunk(bit, from, to).then(function(out){
        outs[idx] = out;
        pending--;
        if(typeof onPartial === 'function'){
          let acc = '';
          let hole = false;
          for(let j = 0; j < bits.length; j++){
            if(outs[j] == null){ hole = true; acc += src.slice(j * size); break; }
            acc += outs[j];
          }
          onPartial(acc, !hole && pending <= 0);
        }
        if(pending <= 0) resolve();
      });
    });
  });
  const joined = outs.map(function(o, i){ return o || bits[i]; }).join('');
  bspaceTxMemo[key] = joined;
  return joined;
}
async function bspaceApplyLanguage(lang){
  const box = $('bspaceWriting');
  if(!box || box.classList.contains('is-editing')) return;
  const token = ++bspaceLangToken;
  const articles = box.querySelectorAll('[data-write-body]');
  const jobs = [];
  function paint(el, text){
    if(token !== bspaceLangToken || !el) return;
    el.textContent = text;
  }
  for(let i = 0; i < articles.length; i++){
    const clamp = articles[i].querySelector('.bspace-read-clamp');
    const head = articles[i].querySelector('[data-write-title]');
    const orig = (bspaceWriteOrig[i] != null) ? bspaceWriteOrig[i] : (clamp ? (clamp.textContent || '') : '');
    const titleOrig = (bspaceWriteTitles[i] != null) ? bspaceWriteTitles[i] : (head ? (head.getAttribute('data-orig') || head.textContent || '') : '');
    const chip = box.querySelector('[data-write-ch="' + i + '"]');
    if(!lang){
      if(clamp) paint(clamp, orig);
      if(head) paint(head, titleOrig);
      if(chip) chip.textContent = titleOrig || ('Chapter ' + (i + 1));
      continue;
    }
    if(clamp && orig){
      jobs.push(bspaceTranslateText(orig, lang, function(partial){
        paint(clamp, partial || orig);
      }));
    }
    if(titleOrig){
      jobs.push(bspaceTranslateText(titleOrig, lang, function(partial){
        const next = partial || titleOrig;
        if(head) paint(head, next);
        if(chip && token === bspaceLangToken) chip.textContent = next;
      }));
    }
  }
  await Promise.all(jobs);
}

function bspacePaintWriting(seg){
  const box = $('bspaceWriting');
  const listen = $('bspaceListenWrap');
  if(!box) return;
  const chapters = (seg && seg.chapters && seg.chapters.length) ? seg.chapters : [{ title: '', text: (seg && seg.text) || '' }];
  const use = chapters.filter(function(c){
    const t = String((c && c.text) || '').trim();
    if(!t) return false;
    return !(window.NalunoPass && NalunoPass.looksLikeShell && NalunoPass.looksLikeShell(t));
  });
  bspaceWriteOrig = use.map(function(c){ return String(c.text || ''); });
  bspaceWriteTitles = use.map(function(c){ return String((c && c.title) || ''); });
  if(!use.length){
    box.hidden = true;
    box.innerHTML = '';
    if(listen) listen.hidden = true;
    return;
  }
  const nav = use.length > 1
    ? '<div style="display:flex;gap:6px;overflow:auto;padding:0 0 10px;">' + use.map(function(c, i){
        const label = c.title || ('Chapter ' + (i + 1));
        return '<button type="button" data-write-ch="' + i + '" style="flex:0 0 auto;border-radius:999px;border:1px solid var(--line);background:' + (i === 0 ? 'rgba(124,255,178,.16)' : 'transparent') + ';color:var(--text);padding:6px 10px;font-size:12px;">' + bspaceEscape(label) + '</button>';
      }).join('') + '</div>'
    : '';
  box.hidden = false;
  box.innerHTML = nav + use.map(function(c, i){
    const text = String(c.text || '');
    const long = text.length > 180;
    const shownTitle = c.title || '';
    return '<article data-write-body="' + i + '" style="' + (i ? 'display:none;' : '') + '">'
      + '<h2 data-write-title="1" data-orig="' + bspaceEscape(shownTitle) + '" style="margin:0 0 10px;font-family:var(--font-futuristic);font-size:22px;line-height:1.2;' + (shownTitle ? '' : 'display:none;') + '">' + bspaceEscape(shownTitle) + '</h2>'
      + '<div class="bspace-read-clamp" data-clamp="' + (long ? '1' : '0') + '" style="font-size:16px;line-height:1.55;">' + bspaceEscape(text) + '</div>'
      + (long ? '<button type="button" class="bspace-mini" data-write-more="' + i + '">See more</button>' : '')
      + '</article>';
  }).join('');
  if(listen) listen.hidden = false;
  if(typeof bspaceFillHear === 'function') bspaceFillHear();
  const hear = $('bspaceHear');
  if(hear && hear.value) bspaceApplyLanguage(hear.value);
}
(function wireWritingClicks(){
  const box = $('bspaceWriting');
  if(!box || box.__wired) return;
  box.__wired = true;
  box.addEventListener('click', function(e){
    const more = e.target && e.target.closest && e.target.closest('[data-write-more]');
    if(more){
      e.preventDefault();
      e.stopPropagation();
      const article = more.closest('[data-write-body]');
      const clamp = article && article.querySelector('.bspace-read-clamp');
      if(!clamp) return;
      const closed = clamp.getAttribute('data-clamp') !== '0';
      clamp.setAttribute('data-clamp', closed ? '0' : '1');
      more.textContent = closed ? 'See less' : 'See more';
      return;
    }
    const ch = e.target && e.target.closest && e.target.closest('[data-write-ch]');
    if(!ch || box.classList.contains('is-editing')) return;
    const n = ch.getAttribute('data-write-ch');
    box.querySelectorAll('[data-write-body]').forEach(function(el){
      el.style.display = el.getAttribute('data-write-body') === n ? '' : 'none';
    });
    box.querySelectorAll('[data-write-ch]').forEach(function(b){
      b.style.background = b === ch ? 'rgba(124,255,178,.16)' : 'transparent';
    });
  });
})();
function bspaceClearWriting(){
  const box = $('bspaceWriting');
  const listen = $('bspaceListenWrap');
  if(box){ box.hidden = true; box.innerHTML = ''; }
  if(listen) listen.hidden = true;
  bspaceStopSpeak();
}
(function wireBspaceListen(){
  const btn = $('bspaceListenBtn');
  const hear = $('bspaceHear');
  if(!btn || btn.__wired) return;
  btn.__wired = true;
  function fillHear(){
    if(!hear || hear.dataset.ready === '1' || typeof SPARK_LANGS === 'undefined') return;
    hear.dataset.ready = '1';
    const groups = [];
    SPARK_LANGS.forEach(function(l){
      const name = l.group || 'More';
      let g = null;
      for(let i = 0; i < groups.length; i++) if(groups[i].name === name) g = groups[i];
      if(!g){ g = { name: name, items: [] }; groups.push(g); }
      g.items.push(l);
    });
    const current = hear.value;
    hear.innerHTML = '<option value="">As written</option>' + groups.map(function(g){
      return '<optgroup label="' + g.name + '">' + g.items.map(function(l){
        return '<option value="' + l.id + '">' + l.name + '</option>';
      }).join('') + '</optgroup>';
    }).join('');
    if(current) hear.value = current;
  }
  fillHear();
  window.bspaceFillHear = fillHear;
  document.addEventListener('DOMContentLoaded', fillHear);
  if(hear) hear.onchange = function(){
    bspaceApplyLanguage(hear.value);
  };
  btn.onclick = function(e){
    if(e) e.stopPropagation();
    const box = $('bspaceWriting');
    let shown = null;
    if(box){
      box.querySelectorAll('[data-write-body]').forEach(function(el){
        if(!shown && el.style.display !== 'none') shown = el;
      });
    }
    const text = shown ? (function(){
      const head = shown.querySelector('[data-write-title]');
      const clamp = shown.querySelector('.bspace-read-clamp');
      return ((head && head.textContent) ? head.textContent + '. ' : '') + ((clamp && clamp.textContent) || '');
    })() : ((activeBroadcastMeta && (activeBroadcastMeta.body || (activeBroadcastMeta.segment && activeBroadcastMeta.segment.text))) || '');
    bspaceSpeakWriting(text, hear ? hear.value : '', btn);
  };
})();

function renderBspaceMedia(seg){
  const host = $('bspaceMedia');
  const hero = $('bspaceHero');
  const writing = !!(seg && seg.type === 'writing');
  const photo = writing && seg.thumbUrl && !/\.(mp4|webm|mov|m4v|m3u8)(\?|$)/i.test(seg.thumbUrl) ? seg.thumbUrl : '';
  if(hero){
    hero.classList.toggle('is-read', writing && !photo);
    hero.classList.toggle('is-plain', writing && !photo);
    hero.classList.toggle('is-photo', !!photo);
  }
  if(!host) return;
  if(!seg){
    bspaceClearWriting();
    host.innerHTML = `<div class="bspace-hero-text" style="color:var(--text-dim);">No media</div>`;
    return;
  }
  if(writing){
    const dock = $('bspaceSeekDock');
    if(dock) dock.remove();
    if(photo){
      host.innerHTML = '<img class="bspace-cover" alt="" src="' + bspaceEscape(photo) + '" />';
    } else {
      host.innerHTML = '';
    }
    bspacePaintWriting(seg);
    return;
  }
  bspaceClearWriting();
  if(seg.type === 'text'){
    host.innerHTML = `<div class="bspace-hero-text" style="background:${seg.bg || 'var(--surface)'};">${bspaceEscape(seg.text || '')}</div>`;
    return;
  }
  if(seg.type === 'video'){
    const chapters = (activeBroadcastMeta && activeBroadcastMeta.chapters) || seg.chapters || null;
    const breathers = (activeBroadcastMeta && activeBroadcastMeta.breathers) || [];
    let rawSrc = '';
    if(typeof legacyBroadcastPlayUrl === 'function'){
      rawSrc = legacyBroadcastPlayUrl(Object.assign({}, seg, { chapters: chapters, mediaUrl: seg.mediaUrl || seg.videoUrl }));
    }
    if(!rawSrc) rawSrc = seg.videoUrl || seg.mediaUrl || seg.photoUrl || seg.dataUrl || (chapters && chapters[0] && chapters[0].mediaUrl) || '';
    const playUrls = (typeof nalunoPlayCandidates === 'function') ? nalunoPlayCandidates(rawSrc, { bucket: 'broadcast' }) : [rawSrc];
    rawSrc = playUrls[0] || rawSrc;
    const mediaId = (typeof nalunoMediaIdFromUrl === 'function') ? nalunoMediaIdFromUrl(rawSrc) : '';
    const bcastId = activeBroadcastId || (activeBroadcastMeta && (activeBroadcastMeta.broadcastId || activeBroadcastMeta.id)) || null;
    let vel = $('bspaceVideoEl');
    const existingId = vel && vel.dataset && vel.dataset.mediaId;
    const canReuse = !!(vel && mediaId && existingId && existingId === mediaId &&
      host.contains(vel) && (vel.readyState >= 1 || !vel.paused));
    // Visible chapter chips only when real chapters (not silent upload parts)
    const showChapters = chapters && chapters.length > 1 && !chapters.every(c => c.silent);
    if(!canReuse){
    host.innerHTML = `
      <div class="bspace-media-frame" style="position:relative;width:100%;height:100%;background:#000;overflow:hidden;min-height:180px;">
        <video id="bspaceVideoEl" playsinline webkit-playsinline preload="auto" poster="${seg.thumbDataUrl ? bspaceEscape(seg.thumbDataUrl) : ''}" style="width:100%;height:100%;object-fit:cover;display:block;background:#000;filter:${seg.filterCss || ''}"></video>
        <button type="button" id="bspacePlayKick" aria-label="Play" style="position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);z-index:6;width:64px;height:64px;border-radius:50%;border:none;background:rgba(124,255,178,.92);color:#0D0F17;font-size:22px;box-shadow:0 8px 28px rgba(0,0,0,.45);cursor:pointer;">▶</button>
        <div id="bspaceBreather" style="display:none;position:absolute;inset:0;background:#07080D;align-items:center;justify-content:center;flex-direction:column;gap:10px;z-index:12;">
          <div style="font-family:var(--font-futuristic);font-size:15px;color:var(--mint);" id="bspaceBreatherLabel">Chapter break</div>
          <div style="font-family:var(--font-mono);font-size:11px;color:var(--text-dim);" id="bspaceBreatherAd">Next chapter in a moment</div>
          <button type="button" id="bspaceReplaceChBtn" style="display:none;margin-top:8px;padding:8px 14px;border-radius:999px;border:1px solid var(--line);background:rgba(124,255,178,.12);color:var(--mint);font-family:var(--font-mono);font-size:12px;">Replace chapter</button>
        </div>
      </div>
      `;
    vel = $('bspaceVideoEl');
    if(vel && typeof bindMediaElement === 'function') bindMediaElement(vel, rawSrc, { broadcastId: bcastId, kind: 'broadcast' });
    else if(vel){ vel.preload = 'auto'; vel.src = rawSrc; }
    if(vel && mediaId) vel.dataset.mediaId = mediaId;
    if(vel && bcastId) vel.dataset.broadcastId = bcastId;
    } else {
      if(vel && typeof bindMediaElement === 'function'){
        bindMediaElement(vel, rawSrc, { broadcastId: bcastId, kind: 'broadcast' });
      }
    }
    // Dock seek bar BELOW the 9:16 hero (sibling), not inside cover frame
    try{
      const hero = $('bspaceHero');
      let dock = $('bspaceSeekDock');
      if(!canReuse && dock) dock.remove();
      if(canReuse && dock){
        /* keep playing dock */
      } else {
      dock = document.createElement('div');
      dock.id = 'bspaceSeekDock';
      dock.className = 'bspace-seek-dock';
      dock.innerHTML = `
        <button type="button" id="bspacePlayBtn" aria-label="Play/Pause" style="flex-shrink:0;width:36px;height:36px;border-radius:50%;border:1px solid var(--line);background:rgba(124,255,178,.12);color:var(--mint);font-size:14px;cursor:pointer;">▶</button>
        <span id="bspaceTimeCur" style="font-family:var(--font-mono);font-size:11px;color:var(--text-dim);min-width:40px;">0:00</span>
        <input type="range" id="bspaceSeekRange" min="0" max="1000" value="0" step="1" style="flex:1;height:28px;accent-color:var(--mint);cursor:pointer;" />
        <span id="bspaceTimeDur" style="font-family:var(--font-mono);font-size:11px;color:var(--text-dim);min-width:40px;text-align:right;">0:00</span>`;
      if(hero && hero.parentNode){
        if(hero.nextSibling) hero.parentNode.insertBefore(dock, hero.nextSibling);
        else hero.parentNode.appendChild(dock);
      }
      }
    }catch(e){ console.warn('[bspace] seek dock', e); }
    if(!canReuse){
      try{ wireBspaceSeekAndAutoplay(vel); }catch(e){ console.warn('[bspace] seek wire', e); }
    }
    if(seg.thumbDataUrl && typeof nalunoProbePosterAR === 'function') nalunoProbePosterAR(seg.thumbDataUrl);
    if(vel && !canReuse){
      const kick = $('bspacePlayKick');
      const hideKick = function(){ if(kick) kick.style.display = 'none'; };
      const showKick = function(){ if(kick) kick.style.display = 'block'; };
      const tryPlay = function(){
        try{ if(typeof nalunoExclusiveMedia === 'function') nalunoExclusiveMedia(vel); }catch(_){}
        try{
          vel.dataset.nalunoWantPlay = '1';
          vel.dataset.nalunoKeepAlive = '1';
          vel.dataset.nalunoUserPaused = '0';
        }catch(_){}
        try{ vel.muted = true; }catch(_){}
        const p = vel.play();
        if(p && p.then){
          p.then(function(){
            hideKick();
            requestAnimationFrame(function(){ try{ vel.muted = false; }catch(_){} });
          }).catch(function(){
            try{ vel.muted = true; }catch(_){}
            vel.play().then(hideKick).catch(function(){ showKick(); });
          });
        }
      };
      if(kick) kick.onclick = function(e){ e.preventDefault(); e.stopPropagation(); tryPlay(); };
      vel.addEventListener('click', function(e){
        e.preventDefault();
        e.stopPropagation();
        if(document.body.classList.contains('naluno-bspace-idle')){
          try{ document.body.classList.remove('naluno-bspace-idle'); }catch(_){}
          return;
        }
        if(vel.paused) tryPlay();
        else {
          try{ vel.dataset.nalunoUserPaused = '1'; vel.dataset.nalunoWantPlay = '0'; }catch(_){}
          vel.pause();
        }
      });
      vel.addEventListener('playing', function(){
        hideKick();
        try{
          vel.dataset.nalunoWantPlay = '1';
          vel.dataset.nalunoKeepAlive = '1';
          vel.dataset.nalunoUserPaused = '0';
        }catch(_){}
        try{ if(vel.poster) vel.removeAttribute('poster'); }catch(_){}
        try{ adaptBspaceHeroToVideo(); }catch(_){}
      });
      vel.addEventListener('pause', function(){
        if(vel.ended) return;
        showKick();
      });
      vel.addEventListener('error', function(){
        const code = vel.error && vel.error.code;
        if(code === 1) return;
        console.warn('[bspace] video error', code, vel.src);
        // Broadcast stays on Worker URL (no vault, no full-file blob pull for long media).
        if(!vel.dataset.retried && rawSrc){
          vel.dataset.retried = '1';
          try{
            const fixed = (typeof resolveMediaUrl === 'function') ? resolveMediaUrl(rawSrc) : rawSrc;
            const base = fixed || rawSrc;
            vel.src = base + (base.indexOf('?') >= 0 ? '&' : '?') + 'r=' + Date.now();
            tryPlay();
            return;
          }catch(_){}
          try{
            vel.src = rawSrc + (rawSrc.indexOf('?') >= 0 ? '&' : '?') + 'r=' + Date.now();
            vel.play().catch(function(){});
          }catch(_){}
        } else if(!vel.dataset.offlineTried && window.NalunoOfflineBroadcast && rawSrc){
          /* The network copy could not be reached after a retry — exactly the
             moment saving something offline exists for. Fall back to the
             cached copy automatically: the person should not have to
             remember they saved this to make it play. */
          vel.dataset.offlineTried = '1';
          window.NalunoOfflineBroadcast.cachedUrlFor(rawSrc).then(function(blobUrl){
            if(blobUrl){
              vel.src = blobUrl;
              vel.play().catch(function(){});
              try{
                const chip = document.getElementById('bspaceOfflineChip');
                if(chip) chip.style.display = 'block';
                if(activeBroadcastId && window.NalunoOfflineBroadcast) window.NalunoOfflineBroadcast.markWatched(activeBroadcastId);
              }catch(_){}
            } else {
              showKick();
            }
          }).catch(function(){ showKick(); });
        } else {
          showKick();
        }
      });
      // Want-play from the first gesture so foreground resume + watchdog can re-kick.
      try{
        vel.dataset.nalunoWantPlay = '1';
        vel.dataset.nalunoKeepAlive = '1';
      }catch(_){}
      setTimeout(function(){ if(vel.paused && vel.dataset.nalunoUserPaused !== '1') tryPlay(); }, 120);
      // Soft network nudge only — do not full-fetch Broadcast into a blob.
      setTimeout(function(){
        if(vel.paused && vel.dataset.nalunoUserPaused !== '1' && rawSrc && !/^blob:/i.test(String(vel.src||''))){
          try{
            const fixed = (typeof resolveMediaUrl === 'function') ? resolveMediaUrl(rawSrc) : rawSrc;
            if(fixed && String(vel.src||'').split('?')[0] !== String(fixed).split('?')[0]){
              vel.src = fixed;
            }
            tryPlay();
          }catch(_){}
        }
      }, 900);
      setTimeout(function(){ if(vel.paused) showKick(); }, 1600);
    }
    try{
      if(vel){
        vel.disableRemotePlayback = true;
        vel.removeAttribute('controls');
        if(navigator.mediaSession){
          try{ navigator.mediaSession.metadata = null; }catch(_){}
        }
      }
    }catch(_){}
    let barHost = document.getElementById('bspaceChapterHost');
    const title = $('bspaceTitle');
    const titleRow = title && title.closest ? title.closest('.bspace-title-row') : null;
    const listenRow = $('bspaceListenWrap');
    const anchor = (listenRow && listenRow.parentNode) ? listenRow : (titleRow || title);
    if(anchor && anchor.parentNode){
      if(!barHost){
        barHost = document.createElement('div');
        barHost.id = 'bspaceChapterHost';
      }
      const after = anchor.nextSibling;
      if(barHost !== after){
        if(after) anchor.parentNode.insertBefore(barHost, after);
        else anchor.parentNode.appendChild(barHost);
      }
    }
    if(barHost){
      barHost.innerHTML = showChapters ? '<div id="bspaceChapterBar" class="bspace-chapter-bar"></div>' : '';
    }
    wireBroadcastChapterPlayer(showChapters ? chapters : (chapters && chapters.length ? chapters : null), breathers, { showChips: !!showChapters });
    try{ adaptBspaceHeroToVideo(); }catch(_){}
    return;
  }
  // photo
  // photoUrl first — photo Signals are uploaded to R2 now, so dataUrl is
  // only present on a freshly-posted local row.
  const photoSrc = seg.photoUrl
    ? ((typeof resolveMediaUrl === 'function') ? resolveMediaUrl(seg.photoUrl) : seg.photoUrl)
    : (seg.dataUrl || '');
  host.innerHTML = `<img src="${bspaceEscape(photoSrc)}" alt="" style="filter:${seg.filterCss || ''}" />`;
}

function setBspaceTab(name){
  document.querySelectorAll('#bspaceTabs .bspace-tab').forEach(t=>{
    t.classList.toggle('on', t.dataset.bspan === name);
  });
  ['conversation','questions','results','resources','journey','updates'].forEach(n=>{
    const p = $('bspan-' + n);
    if(p) p.style.display = n === name ? 'block' : 'none';
  });
}

let bspaceDocCache = {};
let roomReactRows = [];
const bspaceTalkOpen = {};
const bspaceReactOpen = {};

function bspaceReactRowsFor(target, targetId){
  const want = String(targetId || '');
  return roomReactRows.filter(function(r){
    return r.target === target && String(r.targetId || '') === want;
  });
}
function bspaceMyReact(target, targetId){
  if(typeof currentUser === 'undefined' || !currentUser) return '';
  const hit = bspaceReactRowsFor(target, targetId).find(function(r){ return r.from === currentUser.uid; });
  return hit ? (hit.emoji || '') : '';
}
function bspaceReactSummary(target, targetId){
  const counts = {};
  bspaceReactRowsFor(target, targetId).forEach(function(r){
    if(!r.emoji) return;
    counts[r.emoji] = (counts[r.emoji] || 0) + 1;
  });
  return Object.keys(counts).map(function(e){
    return counts[e] > 1 ? (e + ' ' + counts[e]) : e;
  }).join('  ');
}
function bspacePaintVote(){
  const up = $('bspaceUp');
  const down = $('bspaceDown');
  const upN = $('bspaceUpN');
  const downN = $('bspaceDownN');
  const rows = bspaceReactRowsFor('broadcast', '');
  let ups = 0, downs = 0;
  rows.forEach(function(r){
    if(r.emoji === '👍') ups += 1;
    if(r.emoji === '👎') downs += 1;
  });
  const mine = bspaceMyReact('broadcast', '');
  if(up) up.classList.toggle('on', mine === '👍');
  if(down) down.classList.toggle('on', mine === '👎');
  if(upN) upN.textContent = ups ? String(ups) : '';
  if(downN) downN.textContent = downs ? String(downs) : '';
}
async function bspaceSetReact(target, targetId, emoji){
  if(!currentUser || !fbDb || !activeBroadcastId){ toast('Sign in to react'); return null; }
  const docId = (String(target) + '_' + (targetId || 'root') + '_' + currentUser.uid).slice(0, 700);
  const ref = fbDb.collection('broadcasts').doc(activeBroadcastId).collection('roomReacts').doc(docId);
  const prev = bspaceMyReact(target, targetId);
  if(prev === emoji){
    await ref.delete();
    return '';
  }
  await ref.set({
    from: currentUser.uid,
    target: String(target).slice(0, 24),
    targetId: String(targetId || '').slice(0, 128),
    emoji: String(emoji).slice(0, 8),
    ts: Date.now(),
  });
  return emoji;
}
function bspaceNoteVote(prev, next){
  if(!window.NalunoDiscover || typeof NalunoDiscover.note !== 'function' || !activeBroadcastId) return;
  if(prev === '👍' && next !== '👍') NalunoDiscover.note('unlike', activeBroadcastId);
  if(prev === '👎' && next !== '👎') NalunoDiscover.note('undislike', activeBroadcastId);
  if(next === '👍') NalunoDiscover.note('like', activeBroadcastId);
  if(next === '👎') NalunoDiscover.note('dislike', activeBroadcastId);
}
async function bspaceVote(kind){
  const emoji = kind === 'down' ? '👎' : '👍';
  const prev = bspaceMyReact('broadcast', '');
  try{
    const next = await bspaceSetReact('broadcast', '', emoji);
    bspaceNoteVote(prev, next || '');
  }catch(e){
    toast((e && e.message) || 'Could not save that');
  }
}
function listenRoomReacts(){
  if(!fbDb || !activeBroadcastId) return;
  const unsub = fbDb.collection('broadcasts').doc(activeBroadcastId).collection('roomReacts').limit(500).onSnapshot(function(snap){
    roomReactRows = snap.docs.map(function(d){
      const m = d.data() || {};
      return { id: d.id, from: m.from || '', target: m.target || '', targetId: m.targetId || '', emoji: m.emoji || '' };
    });
    bspacePaintVote();
    bspaceRepaintTalk();
  }, function(){});
  bspaceUnsubs.push(unsub);
}
function bspaceRepaintTalk(){
  if(bspaceDocCache.conversation) renderBspaceConversation(bspaceDocCache.conversation);
  if(bspaceDocCache.questions) renderBspaceQuestions(bspaceDocCache.questions);
  if(bspaceDocCache.results) renderBspaceResults(bspaceDocCache.results);
  if(bspaceDocCache.resources) renderBspaceResources(bspaceDocCache.resources);
}
function bspaceHoldPlayback(){
  const v = $('bspaceVideoEl');
  if(!v || v.paused) return;
  try{ v.dataset.nalunoKeepAlive = '1'; v.dataset.nalunoWantPlay = '1'; }catch(_){}
  function resume(){
    if(v.paused && v.dataset.nalunoUserPaused !== '1'){
      const p = v.play();
      if(p && p.catch) p.catch(function(){});
    }
  }
  resume();
  setTimeout(resume, 60);
  setTimeout(resume, 280);
}
function bspaceCloseLine(){
  const sheet = $('bspaceLineSheet');
  if(sheet) sheet.classList.remove('active');
  try{ if(window.nalunoBack) window.nalunoBack.drop('bspaceLineSheet'); }catch(_){}
}
function bspaceEnsureLineSheet(){
  let sheet = $('bspaceLineSheet');
  if(sheet) return sheet;
  sheet = document.createElement('div');
  sheet.id = 'bspaceLineSheet';
  sheet.className = 'call-overlay over-video';
  sheet.innerHTML = '<div class="discover-card" role="dialog" aria-label="Keep a line">'
    + '<div class="discover-top"><b>Keep a line</b><button type="button" id="bspaceLineClose">Close</button></div>'
    + '<textarea id="bspaceLineText" maxlength="240" rows="3" placeholder="A sentence worth keeping"></textarea>'
    + '<button type="button" class="bspace-mini primary" id="bspaceLineSave">Keep</button>'
    + '<div id="bspaceLineList"></div></div>';
  const room = $('bspace');
  const hero = $('bspaceHero');
  const host = (hero && room && room.contains(hero)) ? hero : room;
  if(host) host.appendChild(sheet);
  $('bspaceLineClose').onclick = bspaceCloseLine;
  $('bspaceLineSave').onclick = function(){ bspaceSaveLine(); };
  sheet.addEventListener('click', function(e){
    const btn = e.target && e.target.closest ? e.target.closest('[data-line-drop]') : null;
    if(!btn) return;
    bspaceDropLine(btn.getAttribute('data-line-drop'));
  });
  return sheet;
}
async function bspacePaintLines(){
  const host = $('bspaceLineList');
  if(!host || !currentUser || !fbDb || !activeBroadcastId) return;
  try{
    const snap = await fbDb.collection('users').doc(currentUser.uid).collection('lines').limit(40).get();
    const rows = snap.docs.map(function(d){ return Object.assign({ id: d.id }, d.data() || {}); })
      .filter(function(r){ return r.broadcastId === activeBroadcastId; })
      .sort(function(a, b){ return (b.ts || 0) - (a.ts || 0); });
    host.innerHTML = rows.map(function(r){
      return '<p class="bspace-line"><span>' + bspaceEscape(r.text || '') + '</span> <button type="button" data-line-drop="' + bspaceEscape(r.id) + '">Remove</button></p>';
    }).join('');
  }catch(_){}
}
function bspaceOpenLine(){
  if(!currentUser){ toast('Sign in to keep a line'); return; }
  const room = $('bspace');
  const hero = $('bspaceHero');
  if(!room || !room.classList.contains('active')) return;
  const host = (hero && room.contains(hero)) ? hero : room;
  const sheet = bspaceEnsureLineSheet();
  if(sheet.parentElement !== host) host.appendChild(sheet);
  sheet.classList.add('active');
  bspaceHoldPlayback();
  try{ if(window.nalunoBack) window.nalunoBack.push(); }catch(_){}
  bspacePaintLines();
  const box = $('bspaceLineText');
  if(box){ try{ box.focus(); }catch(_){} }
}
async function bspaceSaveLine(){
  const box = $('bspaceLineText');
  const text = ((box && box.value) || '').trim().slice(0, 240);
  if(!text){ toast('Write the sentence'); return; }
  if(!currentUser || !fbDb || !activeBroadcastId) return;
  try{
    await fbDb.collection('users').doc(currentUser.uid).collection('lines').add({
      text: text,
      broadcastId: activeBroadcastId,
      title: (activeBroadcastMeta && activeBroadcastMeta.title) || '',
      ts: Date.now(),
    });
    if(box) box.value = '';
    if(window.NalunoDiscover && typeof NalunoDiscover.note === 'function'){
      NalunoDiscover.note('kept_line', activeBroadcastId);
    }
    toast('Kept');
    bspacePaintLines();
  }catch(e){
    toast((e && e.message) || 'Could not keep that');
  }
}
async function bspaceDropLine(id){
  if(!id || !currentUser || !fbDb) return;
  try{
    await fbDb.collection('users').doc(currentUser.uid).collection('lines').doc(id).delete();
    bspacePaintLines();
  }catch(e){
    toast((e && e.message) || 'Could not remove that');
  }
}
if($('bspaceUp')) $('bspaceUp').onclick = function(){ bspaceVote('up'); };
if($('bspaceDown')) $('bspaceDown').onclick = function(){ bspaceVote('down'); };
if($('bspaceKeepLine')) $('bspaceKeepLine').onclick = function(){ bspaceOpenLine(); };

function bspaceTalkBody(col, m){
  if(col === 'resources'){
    if(m.url){
      return '<a href="' + bspaceEscape(m.url) + '" target="_blank" rel="noopener" style="color:var(--mint);word-break:break-all;">' + bspaceEscape(m.title || m.url) + '</a>';
    }
    return bspaceEscape(m.title || m.text || 'Resource');
  }
  if(col !== 'conversation') return bspaceEscape(m.text || '');
  const media = (typeof resolveMediaUrl === 'function') ? resolveMediaUrl(m.mediaUrl) : (m.mediaUrl || '');
  const isVoice = media && (m.type === 'voice' || m.type === 'audio');
  const isPhoto = media && (m.type === 'photo' || m.type === 'image');
  if(isVoice){
    return '<div style="font-family:var(--font-mono);font-size:10px;color:var(--mint);margin-bottom:6px;">Voice note</div>'
      + '<video class="band-audio-player" controls playsinline preload="metadata" src="' + bspaceEscape(media) + '" style="width:100%;max-width:280px;height:44px;border-radius:8px;background:#0a0c14;"></video>';
  }
  if(isPhoto){
    return '<img src="' + bspaceEscape(media) + '" alt="Photo" loading="lazy" style="max-width:100%;max-height:320px;border-radius:12px;display:block;background:#0a0c14;" />';
  }
  if(m.text) return bspaceEscape(m.text);
  return '<span style="color:var(--text-dim);font-size:12px;">Attachment unavailable</span>';
}
function bspaceThreadCard(col, row){
  const m = row.m || {};
  const sum = bspaceReactSummary(col, row.id);
  const reacts = (window.NalunoRoomThreads && NalunoRoomThreads.COMMENT_REACTS) || ['👍','👎','❤️','🔥','👏','💡'];
  const mine = bspaceMyReact(col, row.id);
  const pick = reacts.map(function(e){
    return '<button type="button" class="bspace-emoji' + (mine === e ? ' on' : '') + '" data-emoji="' + e + '" data-target="' + bspaceEscape(row.id) + '">' + e + '</button>';
  }).join('');
  return '<div class="bspace-reply">'
    + '<div class="who">' + bspaceEscape(bspaceWhoLabel(m.from)) + ' · ' + timeAgo(m.ts || Date.now()) + bspaceDeleteBtnHtml(col, row.id, m.from) + '</div>'
    + '<div class="body">' + bspaceTalkBody(col, m) + '</div>'
    + '<div class="bspace-post-tools"><button type="button" data-react-open="' + bspaceEscape(row.id) + '">React</button>'
    + (sum ? '<span class="bspace-react-sum">' + sum + '</span>' : '') + '</div>'
    + '<div class="bspace-react-pick"' + (bspaceReactOpen[col + ':' + row.id] ? '' : ' hidden') + '>' + pick + '</div>'
    + '</div>';
}
function bspaceRenderTalk(el, docs, col, emptyText, extraHtml){
  if(!el) return;
  const Threads = window.NalunoRoomThreads;
  const grouped = Threads ? Threads.group(docs) : { tops: (docs || []).map(function(d){ return { id: d.id, m: d.data ? d.data() : d }; }), replies: {} };
  if(!grouped.tops.length){
    el.innerHTML = emptyText
      ? '<div class="bspace-card"><div class="body" style="color:var(--text-dim);">' + emptyText + '</div></div>'
      : '';
    return;
  }
  el.innerHTML = grouped.tops.map(function(row){
    const m = row.m || {};
    const kids = (grouped.replies && grouped.replies[row.id]) || [];
    const embedded = (col === 'questions' && Array.isArray(m.answers)) ? m.answers : [];
    const n = kids.length + embedded.length;
    const open = !!bspaceTalkOpen[col + ':' + row.id];
    const reacts = (window.NalunoRoomThreads && NalunoRoomThreads.COMMENT_REACTS) || ['👍','👎','❤️','🔥','👏','💡'];
    const mine = bspaceMyReact(col, row.id);
    const sum = bspaceReactSummary(col, row.id);
    const pick = reacts.map(function(e){
      return '<button type="button" class="bspace-emoji' + (mine === e ? ' on' : '') + '" data-emoji="' + e + '" data-target="' + bspaceEscape(row.id) + '">' + e + '</button>';
    }).join('');
    const who = col === 'questions'
      ? (bspaceEscape(bspaceWhoLabel(m.from)) + ' asks · ' + timeAgo(m.ts || Date.now()))
      : (bspaceEscape(bspaceWhoLabel(m.from)) + ' · ' + timeAgo(m.ts || Date.now()));
    const threadBits = kids.map(function(k){ return bspaceThreadCard(col, k); }).join('')
      + embedded.map(function(a){
        return '<div class="bspace-reply"><div class="who">' + bspaceEscape(bspaceWhoLabel(a.from)) + '</div><div class="body">' + bspaceEscape(a.text || '') + '</div></div>';
      }).join('');
    const extra = extraHtml ? extraHtml(m, row.id) : '';
    const label = n ? (n + (n === 1 ? ' reply' : ' replies')) : 'Reply';
    return '<div class="bspace-card" data-post="' + bspaceEscape(row.id) + '">'
      + '<div class="who">' + who + bspaceDeleteBtnHtml(col, row.id, m.from) + '</div>'
      + '<div class="body">' + bspaceTalkBody(col, m) + '</div>'
      + extra
      + '<div class="bspace-post-tools">'
      + '<button type="button" data-react-open="' + bspaceEscape(row.id) + '">React</button>'
      + (sum ? '<span class="bspace-react-sum">' + sum + '</span>' : '')
      + '<button type="button" data-thread-toggle="' + bspaceEscape(row.id) + '">' + label + '</button>'
      + '</div>'
      + '<div class="bspace-react-pick"' + (bspaceReactOpen[col + ':' + row.id] ? '' : ' hidden') + '>' + pick + '</div>'
      + '<div class="bspace-thread"' + (open ? '' : ' hidden') + '>' + threadBits
      + '<div class="bspace-composer"><input data-reply-input="' + bspaceEscape(row.id) + '" maxlength="800" placeholder="Reply…" />'
      + '<button type="button" class="bspace-mini primary" data-reply-send="' + bspaceEscape(row.id) + '">Reply</button></div>'
      + '</div></div>';
  }).join('');
  bspaceWireDeleteButtons(el);
  bspaceWireTalk(el, col);
}
function bspaceWireTalk(el, col){
  el.onclick = function(e){
    const t = e.target;
    if(!t || !t.closest) return;
    const reactBtn = t.closest('[data-react-open]');
    if(reactBtn && el.contains(reactBtn)){
      const id = reactBtn.getAttribute('data-react-open');
      const key = col + ':' + id;
      bspaceReactOpen[key] = !bspaceReactOpen[key];
      const card = reactBtn.closest('.bspace-card, .bspace-reply');
      const pick = card && card.querySelector('.bspace-react-pick');
      if(pick) pick.hidden = !bspaceReactOpen[key];
      return;
    }
    const emojiBtn = t.closest('[data-emoji]');
    if(emojiBtn && el.contains(emojiBtn)){
      const id = emojiBtn.getAttribute('data-target');
      const emoji = emojiBtn.getAttribute('data-emoji');
      bspaceSetReact(col, id, emoji).then(function(next){
        if(window.NalunoDiscover && typeof NalunoDiscover.note === 'function' && next){
          NalunoDiscover.note(emoji === '👎' ? 'comment_down' : 'comment_react', activeBroadcastId);
        }
      }).catch(function(err){ toast((err && err.message) || 'Could not react'); });
      return;
    }
    const toggle = t.closest('[data-thread-toggle]');
    if(toggle && el.contains(toggle)){
      const id = toggle.getAttribute('data-thread-toggle');
      const key = col + ':' + id;
      bspaceTalkOpen[key] = !bspaceTalkOpen[key];
      const card = toggle.closest('.bspace-card');
      const thread = card && card.querySelector('.bspace-thread');
      if(thread) thread.hidden = !bspaceTalkOpen[key];
      if(bspaceTalkOpen[key]){
        const input = card.querySelector('[data-reply-input]');
        if(input){ try{ input.focus(); }catch(_){} }
      }
      return;
    }
    const send = t.closest('[data-reply-send]');
    if(send && el.contains(send)){
      const id = send.getAttribute('data-reply-send');
      const card = send.closest('.bspace-card');
      const input = card && card.querySelector('[data-reply-input]');
      const text = ((input && input.value) || '').trim();
      if(!text) return;
      bspaceTalkOpen[col + ':' + id] = true;
      const payload = { type: 'text', text: text, parent_id: id };
      bspacePost(col, payload).then(function(ok){
        if(ok && input) input.value = '';
      });
    }
  };
}

function renderBspaceConversation(docs){
  const el = $('bspaceConversation');
  if(!el) return;
  let pin = $('bspaceLivePin');
  if(!pin){
    pin = document.createElement('div');
    pin.id = 'bspaceLivePin';
    pin.style.cssText = 'display:none;margin:0 0 12px;';
    el.parentNode.insertBefore(pin, el);
  }
  const LIVE_NOTICE_TTL_MS = 24 * 60 * 60 * 1000;
  const isLiveSystem = (m)=>{
    if(!m) return false;
    if(m.kind === 'went_live' || m.kind === 'was_live') return true;
    if(m.type === 'live') return true;
    const t = (m.text || '').toLowerCase();
    return /\b(is live now|was live|went live|join live)\b/.test(t);
  };
  const liveNoticeRefTs = (m)=>{
    const ended = Number((activeBroadcastMeta && activeBroadcastMeta.lastLiveEndedAt) || 0);
    const ts = Number(m && m.ts) || 0;
    return ended || ts || 0;
  };
  const liveNoticeFresh = (m)=>{
    if(!m) return false;
    const currentlyLive = !!(activeBroadcastMeta && activeBroadcastMeta.live);
    const kind = String(m.kind || '');
    const text = String(m.text || '').toLowerCase();
    const isPresent = kind === 'went_live' || /\bis live now|join live\b/.test(text);
    if(currentlyLive && isPresent) return true;
    if(currentlyLive && kind === 'was_live') return false;
    const when = liveNoticeRefTs(m);
    if(!when) return false;
    return (Date.now() - when) < LIVE_NOTICE_TTL_MS;
  };
  const reallyLived = !!(activeBroadcastMeta && (
    activeBroadcastMeta.live ||
    (activeBroadcastMeta.lastLiveStartedAt && activeBroadcastMeta.lastLiveDurationMs != null)
  ));
  const pinned = [];
  const rest = [];
  (docs || []).forEach(d=>{
    const m = d.data ? d.data() : d;
    if(isLiveSystem(m)){
      if(liveNoticeFresh(m)) pinned.push({ d, m });
    } else rest.push(d);
  });
  if(pinned.length && reallyLived){
    pinned.sort((a,b)=> (b.m.ts||0) - (a.m.ts||0));
    const latest = pinned[0].m;
    const stillLive = !!(activeBroadcastMeta && activeBroadcastMeta.live);
    const label = stillLive ? '● LIVE' : '● WAS LIVE';
    const fallbackText = stillLive ? 'Creator is live now — join to watch' : 'Creator was live';
    const isMine = !!(currentUser && latest.from === currentUser.uid);
    let displayText = latest.text || fallbackText;
    if(isMine && latest.kind === 'went_live'){
      displayText = 'You\u2019re live now — you can watch reactions come in below.';
    } else if(isMine && latest.kind === 'was_live'){
      const dur = (typeof formatLiveDuration === 'function') ? formatLiveDuration(latest.durationMs) : '';
      displayText = 'You were live' + (dur ? ' for ' + dur : '') + '.';
    }
    pin.style.display = 'block';
    pin.innerHTML = '<div class="bspace-card" style="border:1px solid rgba(124,255,178,.45);background:rgba(124,255,178,.08);"><div class="who" style="color:var(--mint);">' + label + ' · ' + timeAgo(latest.ts || Date.now()) + '</div><div class="body" style="font-weight:600;">' + bspaceEscape(displayText) + '</div></div>';
  } else {
    pin.style.display = 'none';
    pin.innerHTML = '';
  }
  bspaceRenderTalk(el, rest, 'conversation', '');
}

function renderBspaceQuestions(docs){
  const el = $('bspaceQuestions');
  bspaceRenderTalk(el, docs, 'questions', 'No questions yet — ask anything.', function(m, id){
    const best = m.bestAnswer ? '<div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--line);"><span style="font-family:var(--font-mono);font-size:10px;color:var(--mint);">Best answer</span><div class="body">' + bspaceEscape(m.bestAnswer) + '</div></div>' : '';
    const mark = (activeBroadcastMeta && activeBroadcastMeta.isMine && !m.bestAnswer)
      ? '<button type="button" class="bspace-mini" data-mark-best="' + bspaceEscape(id) + '" style="margin-top:8px;">Mark best from replies…</button>' : '';
    return best + mark;
  });
  if(!el) return;
  el.querySelectorAll('[data-mark-best]').forEach(function(btn){
    btn.onclick = function(e){
      if(e){ e.stopPropagation(); }
      const card = btn.closest('.bspace-card');
      const replies = card ? card.querySelectorAll('.bspace-reply .body') : [];
      const first = replies[0] ? replies[0].textContent : '';
      if(!first){ toast('Open the replies first'); return; }
      bspaceMarkBest(btn.getAttribute('data-mark-best'), first);
    };
  });
}

function renderBspaceResults(docs){
  bspaceRenderTalk($('bspaceResults'), docs, 'results', 'When this Broadcast changes something in someone’s life, it shows up here.');
}

function renderBspaceResources(docs){
  bspaceRenderTalk($('bspaceResources'), docs, 'resources', 'No resources attached yet.');
}

function renderBspaceJourney(docs){
  const el = $('bspaceJourney');
  if(!el) return;
  if(!docs.length){
    el.innerHTML = `<div class="evt">This story is just beginning.</div>`;
    return;
  }
  el.innerHTML = docs.map(d=>{
    const m = d.data();
    return `<div class="evt"><strong>${bspaceEscape(m.text || m.type || 'Update')}</strong><br><span style="font-family:var(--font-mono);font-size:10.5px;">${timeAgo(m.ts || Date.now())}</span></div>`;
  }).join('');
}

async function paintBspaceViews(meta){
  const row = $('bspaceViewRow');
  if(!row) return;
  let views = (meta && typeof meta.views === 'number') ? meta.views : 0;
  let total = 0;
  const creatorUid = meta && meta.creatorUid;
  const isOwner = !!(currentUser && creatorUid && currentUser.uid === creatorUid);
  try{
    if(fbDb && activeBroadcastId){
      const doc = await fbDb.collection('broadcasts').doc(activeBroadcastId).get();
      if(doc.exists){
        const d = doc.data() || {};
        views = (typeof d.views === 'number') ? d.views : views;
        if(activeBroadcastMeta){
          activeBroadcastMeta.strandId = d.strandId || activeBroadcastMeta.strandId;
          activeBroadcastMeta.strandName = d.strandName || activeBroadcastMeta.strandName;
          activeBroadcastMeta.views = views;
        }
      }
    }
    // Total across every Broadcast of this creator — creator-only.
    if(isOwner && fbDb && creatorUid){
      try{
        const t = await fbDb.collection('toga').doc(creatorUid).get();
        if(t.exists && typeof (t.data() || {}).viewsTotal === 'number'){
          // Floored at zero: increment(-n) has no server-side clamp, so a
          // total that went negative from historical deletions (before the
          // delete-time adjustment existed) must never render as a negative
          // view count.
          total = Math.max(0, (t.data() || {}).viewsTotal || 0);
        } else {
          const mine = ((typeof feedBroadcasts !== 'undefined' && feedBroadcasts) || []).filter(function(x){ return x.creatorUid === creatorUid; });
          total = mine.reduce(function(n, x){ return n + (Number(x.views) || 0); }, 0);
          if(!total) total = views;
        }
      }catch(_){
        total = views;
      }
    }
  }catch(_){}
  const fmt = (typeof formatNalunoViews === 'function') ? formatNalunoViews : String;
  const strand = (activeBroadcastMeta && activeBroadcastMeta.strandName) || '';
  row.style.display = 'grid';
  let html = ''
    + '<div class="bspace-stat-card">'
    +   '<div class="bspace-stat-k">This Broadcast</div>'
    +   '<div class="bspace-stat-v">' + fmt(views) + '</div>'
    +   '<div class="bspace-stat-h">views on this room</div>'
    + '</div>';
  if(isOwner){
    html += ''
      + '<div class="bspace-stat-card bspace-stat-card--mine">'
      +   '<div class="bspace-stat-k">All of yours</div>'
      +   '<div class="bspace-stat-v">' + fmt(total) + '</div>'
      +   '<div class="bspace-stat-h">' + (strand ? ('Every Broadcast · ' + bspaceEscape(strand) + ' + rest') : 'Every Broadcast you have published') + '</div>'
      + '</div>';
  }
  row.innerHTML = html;
  if(!row.__statToggle){
    row.__statToggle = true;
    row.addEventListener('click', function(e){
      const card = e.target && e.target.closest ? e.target.closest('.bspace-stat-card') : null;
      if(card) card.classList.toggle('open');
    });
  }
}

function renderBspaceRelated(){
  const el = $('bspaceRelated');
  if(!el) return;
  const b = Object.assign({}, activeBroadcastMeta || {}, {
    id: activeBroadcastId,
    strandId: (activeBroadcastMeta && activeBroadcastMeta.strandId) || null,
    strandName: (activeBroadcastMeta && activeBroadcastMeta.strandName) || null,
    creatorUid: activeBroadcastMeta && activeBroadcastMeta.creatorUid,
    tags: (activeBroadcastMeta && activeBroadcastMeta.tags) || [],
  });
  function paint(rel){
    if(!rel || !rel.items || !rel.items.length){
      el.innerHTML = `<div class="bspace-card"><div class="body" style="color:var(--text-dim);">${bspaceEscape(rel && rel.label ? rel.label : 'Nearby Broadcasts will fill this Strand.')}</div></div>`;
      return;
    }
    el.innerHTML = '<div class="nearby-strip">' + rel.items.map(function(item){
      const thumbRaw = item.thumbUrl || item.thumb || '';
      const thumb = (thumbRaw && !(typeof nalunoThumbLooksDead === 'function' && nalunoThumbLooksDead(thumbRaw))) ? thumbRaw : '';
      const media = item.mediaUrl || item.videoUrl || '';
      const rescue = media ? (' data-media="'+bspaceEscape(media)+'" data-bcast-id="'+bspaceEscape(item.id||'')+'" onerror="nalunoRescueThumb(this)"') : '';
      const mediaHtml = thumb
        ? '<img src="'+bspaceEscape(thumb)+'" alt=""'+rescue+' />'
        : (media
          ? '<img alt="" data-need-thumb="1"'+rescue+' />'
          : '<div class="nearby-fallback">'+bspaceEscape(String(item.creatorName||'?').slice(0,1).toUpperCase())+'</div>');
      return `<button type="button" class="nearby-tile" data-rel-id="${bspaceEscape(item.id)}">
        <div class="nearby-frame">${mediaHtml}<span class="nearby-title">${bspaceEscape((item.title||'Broadcast').slice(0,42))}</span></div>
      </button>`;
    }).join('') + '</div>';
    el.querySelectorAll('[data-rel-id]').forEach(function(node){
      node.onclick = function(){
        const id = node.getAttribute('data-rel-id');
        if(typeof openBroadcastById === 'function') openBroadcastById(id);
      };
    });
    try{ if(typeof armStrandThumbs === 'function') armStrandThumbs(el); }catch(_){}
    try{ el.querySelectorAll('img[data-need-thumb="1"]').forEach(function(img){ if(typeof nalunoRescueThumb === 'function') nalunoRescueThumb(img); }); }catch(_){}
  }
  if(typeof relatedBroadcasts === 'function'){
    relatedBroadcasts(b).then(paint).catch(function(){ paint({ items: [], label: 'Related Broadcasts' }); });
  } else {
    paint({ items: [], label: 'Related Broadcasts' });
  }
}

function listenBspaceCollection(colName, renderFn, orderField){
  if(!fbDb || !activeBroadcastId) return;
  const col = fbDb.collection('broadcasts').doc(activeBroadcastId).collection(colName);
  const hold = { unsub: null, triedPlain: false };
  function arm(ordered){
    const q = ordered
      ? col.orderBy(orderField || 'ts', 'desc').limit(80)
      : col.limit(80);
    hold.unsub = q.onSnapshot(function(snap){
      let docs = snap.docs.slice();
      if(ordered) docs.reverse();
      else docs.sort(function(a, b){
        const ta = (a.data && a.data() && a.data().ts) || 0;
        const tb = (b.data && b.data() && b.data().ts) || 0;
        return ta - tb;
      });
      bspaceDocCache[colName] = docs;
      try{ renderFn(docs); }catch(err){ console.warn('[bspace] paint', colName, err); }
      scheduleBspaceLivePaint();
    }, function(err){
      console.warn('[bspace] listen', colName, err && err.code, err && err.message);
      try{ if(hold.unsub) hold.unsub(); }catch(_){}
      if(ordered && !hold.triedPlain){
        hold.triedPlain = true;
        arm(false);
      }
    });
  }
  arm(true);
  bspaceUnsubs.push(function(){ try{ if(hold.unsub) hold.unsub(); }catch(_){} });
}
let bspaceLivePaintTimer = null;
function scheduleBspaceLivePaint(){
  if(bspaceLivePaintTimer) clearTimeout(bspaceLivePaintTimer);
  bspaceLivePaintTimer = setTimeout(function(){
    bspaceLivePaintTimer = null;
    try{ if(typeof renderBspaceImpact === 'function') renderBspaceImpact(); }catch(_){}
    try{ if(activeBroadcastMeta && typeof paintBspaceViews === 'function') paintBspaceViews(activeBroadcastMeta); }catch(_){}
  }, 240);
}

async function openBroadcastSpace(meta){
  // Carry chapter architecture for player + future ads
  if(meta.chapters) meta.chapters = meta.chapters;
  if(meta.breathers) meta.breathers = meta.breathers;

  // meta: { isMine, contactId?, segment, creatorUid, creatorName, title?, description?, tags? }
  if(meta && meta.broadcastId && typeof fbDb !== 'undefined' && fbDb){
    try{
      const snap = await fbDb.collection('broadcasts').doc(meta.broadcastId).get();
      if(snap.exists){
        const data = snap.data() || {};
        const uid = (typeof currentUser !== 'undefined' && currentUser) ? currentUser.uid : '';
        if(typeof broadcastVisibleTo === 'function' && !broadcastVisibleTo(data, uid)){
          toast('This Broadcast isn’t available.');
          return;
        }
        meta.held = !!data.held;
        meta.hidden = !!data.hidden;
      }
    }catch(_){}
  }

  // meta: { isMine, contactId?, segment, creatorUid, creatorName, title?, description?, tags? }
  activeBroadcastMeta = meta;
  if(meta.broadcastId) activeBroadcastId = meta.broadcastId;
  if(!activeBroadcastMeta.chapters && meta.segment && meta.segment.chapters){
    activeBroadcastMeta.chapters = meta.segment.chapters;
  }
  bspaceClearListeners();

  const seg = meta.segment || {};
  const title = meta.title || (seg.type === 'text' ? (seg.text || 'Broadcast').slice(0, 60) : (seg.caption || 'Broadcast'));
  const desc = meta.description || seg.caption || (seg.type === 'text' ? '' : 'Watch, join the conversation, and explore questions and resources.');

  $('bspaceCreatorName').textContent = meta.creatorName || 'Someone';
  if(window.NalunoKnown && typeof NalunoKnown.paintBeside === 'function'){
    NalunoKnown.paintBeside($('bspaceCreatorName'), meta.creatorUid);
  }
  $('bspaceCreatorMeta').textContent = meta.isMine ? 'Your Broadcast' : 'Creator Circle';
  $('bspaceTitle').textContent = title;
  $('bspaceDesc').textContent = bspaceShownAbout(desc);
  const by = $('bspaceByline');
  if(by){
    const credit = (window.NalunoPass && typeof NalunoPass.lockedCredit === 'function') ? NalunoPass.lockedCredit(meta) : null;
    const line = (credit && NalunoPass.byline) ? NalunoPass.byline(credit) : '';
    by.textContent = line;
    by.hidden = !line;
  }
  const quiet = $('bspaceQuiet');
  if(quiet) quiet.open = false;
  try{ if($('bspaceMoreMenu')) $('bspaceMoreMenu').hidden = true; }catch(_){}
  bspaceCloseEdit();
  try{
    const note = $('bspaceModNote');
    if(note){
      if(meta.hidden){
        note.textContent = 'This Broadcast was taken down. It is not on the public feed.';
        note.style.display = 'block';
      } else if(meta.held){
        note.textContent = 'Waiting to go out. Naluno Screen was not sure. It is on your list only until it is cleared.';
        note.style.display = 'block';
      } else {
        note.style.display = 'none';
      }
    }
  }catch(_){}
  const tags = meta.tags && meta.tags.length ? meta.tags : (seg.type ? [seg.type] : ['idea']);
  $('bspaceTags').innerHTML = tags.map(t => `<span class="bspace-tag">${bspaceEscape(t)}</span>`).join('');
  renderBspaceMedia(seg);
  setBspaceTab('conversation');
  renderBspaceRelated();

  const isCreator = !!(meta.isMine || (currentUser && meta.creatorUid === currentUser.uid));
  $('bspaceResourceComposer').style.display = isCreator ? 'flex' : 'none';
  $('bspaceGoLive').style.display = isCreator ? 'inline-block' : 'none';
  if($('bspaceDeleteBtn')) $('bspaceDeleteBtn').style.display = isCreator ? 'inline-block' : 'none';
  if($('bspaceReportBtn')) $('bspaceReportBtn').style.display = isCreator ? 'none' : 'inline-block';
  if($('bspaceAdvertiseBtn')) $('bspaceAdvertiseBtn').style.display = isCreator ? 'inline-block' : 'none';
  if($('bspaceEditBtn')) $('bspaceEditBtn').style.display = isCreator ? 'inline-block' : 'none';
  try{
    const O = window.NalunoOfflineBroadcast, btn = $('bspaceSaveOfflineBtn');
    if(O && btn && activeBroadcastId){
      const saved = O.isSaved(activeBroadcastId);
      btn.textContent = saved ? 'Saved' : 'Save';
      btn.classList.toggle('saved', saved);
      if(saved) O.markWatched(activeBroadcastId);
    }
  }catch(_){}
  const chip = $('bspaceOfflineChip'); if(chip) chip.style.display = 'none';
  const strandRow = $('bspaceStrandRow');
  if(strandRow){
    strandRow.style.display = isCreator ? 'block' : 'none';
    if(isCreator && typeof loadMyStrands === 'function'){
      loadMyStrands().then(function(){
        if(typeof fillStrandSelect === 'function') fillStrandSelect($('bspaceStrandPick'));
        const pick = $('bspaceStrandPick');
        if(pick && meta.strandId) pick.value = meta.strandId;
      }).catch(function(){});
    }
  }

  try{
    const badge = $('bspaceLiveBadge');
    if(badge){ badge.style.display = 'none'; badge.textContent = ''; }
    const pin = $('bspaceLivePin');
    if(pin){ pin.style.display = 'none'; pin.innerHTML = ''; }
  }catch(_){}
  $('bspace').classList.add('active');
  try{ if(window.nalunoBack) window.nalunoBack.push(); }catch(_){}
  try{ document.body.classList.add('naluno-bspace-open'); }catch(_){}
  $('bspaceScroll').scrollTop = 0;
  try{ if(typeof nalunoExitFeedLandscape === 'function') nalunoExitFeedLandscape(); }catch(_){}
  try{ if(typeof pauseAllStrandPreviews === 'function') pauseAllStrandPreviews(); }catch(_){}
  try{ if(typeof nalunoPauseDetachedMedia === 'function') nalunoPauseDetachedMedia(); }catch(_){}
  try{
    document.querySelectorAll('video, audio').forEach(function(el){
      try{
        if(el.closest && el.closest('#bspace')) return;
        if(el.closest && el.closest('#callOverlay')) return;
        if(el.closest && el.closest('#nalunoAdViewer')) return;
        el.__nalunoOn = false;
        el.dataset.nalunoWantPlay = '0';
        el.dataset.nalunoUserPaused = '1';
        delete el.dataset.nalunoKeepAlive;
        try{ el.muted = true; }catch(_){}
        try{ el.pause(); }catch(_){}
      }catch(_){}
    });
  }catch(_){}
  try{
    const other = document.getElementById('bspaceVideoEl');
    if(typeof nalunoExclusiveMedia === 'function') nalunoExclusiveMedia(other || null);
  }catch(_){}

  if(!fbDb || !currentUser){
    $('bspaceJoinBtn').textContent = 'Sign in to join';
    $('bspaceJoinBtn').classList.remove('joined');
    $('bspaceConversation').innerHTML = `<div class="bspace-card"><div class="body" style="color:var(--text-dim);">Sign in to chat, ask questions, and share with this community.</div></div>`;
    return;
  }

  try{
    activeBroadcastId = await ensureBroadcastFirestore(meta);
  }catch(e){
    console.warn('[bspace] ensure failed', e);
    toast('Couldn’t open community data');
    activeBroadcastId = ensureBroadcastDocId(meta);
  }

  // Membership button — join the creator's Circle, not the live stream.
  // FIX: this rendered as "Join [Name]" — visually indistinguishable from a
  // live-stream join control, and it sits right next to the real one in this
  // same header cluster. "Join MAGAMBO" next to "Leave live" next to live
  // view stats reads as three contradictory controls for the same thing,
  // when two completely unrelated features (following a creator vs.
  // watching their live stream) just happen to share the word "Join."
  // Renamed so Circle membership can never be mistaken for a live control,
  // regardless of layout.
  try{
    const creatorUid = meta.creatorUid;
    const isMine = !!(meta.isMine || (currentUser && creatorUid === currentUser.uid));
    const btn = $('bspaceJoinBtn');
    if(isMine){
      if(btn){
        btn.textContent = 'Your Circle';
        btn.classList.add('joined');
        btn.disabled = true;
      }
    } else {
      const joined = await (typeof creatorCircleJoined === 'function'
        ? creatorCircleJoined(creatorUid)
        : false);
      if(btn){
        btn.disabled = false;
        btn.textContent = joined ? 'Leave' : 'Join';
        btn.classList.toggle('joined', joined);
      }
    }
  }catch(e){
    $('bspaceJoinBtn').textContent = 'Join';
  }

  try{
    if(typeof paintBspaceSupportButton === 'function') paintBspaceSupportButton();
  }catch(_){}

  try{
    if(typeof armBroadcastViewWatch === 'function'){
      armBroadcastViewWatch(activeBroadcastId, meta.creatorUid, isCreator);
    }
  }catch(_){}

  try{ paintBspaceViews(meta); }catch(_){}

  listenRoomReacts();
  listenBspaceCollection('conversation', renderBspaceConversation, 'ts');
  listenBspaceCollection('questions', renderBspaceQuestions, 'ts');
  listenBspaceCollection('results', renderBspaceResults, 'ts');
  listenBspaceCollection('resources', renderBspaceResources, 'ts');
  listenBspaceCollection('journey', renderBspaceJourney, 'ts');
  listenBspaceCollection('updates', renderBspaceUpdates, 'ts');
  bspaceWatchLiveState();

  const dash = $('bspaceDashboard');
  const upTab = $('bspaceUpdatesTab');
  if(isCreator){
    if(dash) dash.style.display = 'block';
    if(upTab) upTab.style.display = 'inline-block';
    renderBspaceImpact();
  } else {
    if(dash) dash.style.display = 'none';
    if(upTab) upTab.style.display = 'inline-block'; // members can read updates
  }
}

function closeBroadcastSpace(){
  const was = $('bspace') && $('bspace').classList.contains('active');
  bspaceForceLandscape = false;
  try{
    document.body.classList.remove('naluno-landscape-media', 'naluno-bspace-land-css', 'naluno-bspace-idle');
    const app = document.querySelector('.app');
    if(app) app.classList.remove('naluno-landscape-media');
    if(typeof nalunoNativeUnlockOrientation === 'function') nalunoNativeUnlockOrientation();
  }catch(_){}
  try{ if(window.__bspaceNextTimer){ clearTimeout(window.__bspaceNextTimer); window.__bspaceNextTimer = null; } }catch(_){}
  if(typeof bLiveOnSpaceClosed === 'function') bLiveOnSpaceClosed();
  bspaceStopLive();
  bspaceStopSpeak();
  bspaceClearListeners();
  activeBroadcastId = null;
  activeBroadcastMeta = null;
  try{
    document.querySelectorAll('#bspace video, #bspace audio').forEach(function(el){
      try{
        el.dataset.nalunoWantPlay = '0';
        el.dataset.nalunoUserPaused = '1';
        delete el.dataset.nalunoKeepAlive;
        el.pause();
        el.removeAttribute('src');
        el.srcObject = null;
        el.load();
      }catch(_){}
    });
  }catch(_){}
  const vid = $('bspaceVideoEl');
  if(vid){
    try{ vid.pause(); }catch(e){}
    try{ vid.removeAttribute('src'); vid.load(); }catch(e){}
  }
  try{
    const host = $('bspaceMedia');
    if(host) host.innerHTML = '';
  }catch(_){}
  try{
    const dock = $('bspaceSeekDock');
    if(dock) dock.remove();
  }catch(_){}
  try{
    if(typeof stopAllAppMediaAndLockSession === 'function') stopAllAppMediaAndLockSession();
    else if(navigator.mediaSession){
      navigator.mediaSession.metadata = null;
      if(navigator.mediaSession.playbackState !== undefined){
        navigator.mediaSession.playbackState = 'none';
      }
    }
  }catch(_){}
  try{ if(typeof nalunoPauseDetachedMedia === 'function') nalunoPauseDetachedMedia(); }catch(_){}
  try{ document.body.classList.remove('naluno-bspace-open', 'naluno-bcast-watch', 'naluno-feed-landscape'); }catch(_){}
  try{
    const scroller = document.getElementById('broadcastTabScroll');
    if(scroller) scroller.scrollTop = 0;
  }catch(_){}
  $('bspace').classList.remove('active');
  if(was){ try{ if(window.nalunoBack) window.nalunoBack.drop('bspace'); }catch(_){} }
}

async function bspaceRequireMember(){
  if(!currentUser || !fbDb || !activeBroadcastId){ toast('Sign in to take part'); return false; }
  return true;
}

async function bspacePost(col, payload){
  if(!(await bspaceRequireMember())) return false;
  const publicTalk = (col === 'conversation' || col === 'questions') && payload && payload.text && payload.type !== 'system';
  if(publicTalk && window.NalunoSafety && typeof window.NalunoSafety.scorePublicText === 'function'){
    let scored = null;
    try{ scored = window.NalunoSafety.scorePublicText(String(payload.text), { surface: 'comment' }); }catch(_){}
    const stop = scored && typeof nalunoSafetyStopped === 'function' && nalunoSafetyStopped(scored);
    if(stop){
      try{ toast(typeof nalunoSafetyStatement === 'function' ? nalunoSafetyStatement(scored) : 'Held for a safety review.'); }catch(_){}
      try{
        if(currentUser && currentUser.getIdToken){
          const tok = await currentUser.getIdToken(false);
          const res = await fetch('https://naluno-economy.naluno.workers.dev/v1/safety/score', {
            method: 'POST',
            headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' },
            body: JSON.stringify({ surface: 'comment', text: String(payload.text), content_id: activeBroadcastId || '' }),
          });
          const body = await res.json().catch(function(){ return {}; });
          const caseId = body && body.result && body.result.case_id;
          if(caseId && typeof openSafetyAppeal === 'function') openSafetyAppeal(caseId, body.result.statement || '');
        }
      }catch(_){}
      return false;
    }
  }
  const body = { from: currentUser.uid, ts: Date.now() };
  Object.keys(payload || {}).forEach(function(k){
    if(payload[k] !== undefined) body[k] = payload[k];
  });
  if((body.type === 'voice' || body.type === 'photo' || body.type === 'image') && !body.mediaUrl){
    toast('That did not upload, so it was not posted');
    return false;
  }
  try{
    const ref = await fbDb.collection('broadcasts').doc(activeBroadcastId).collection(col).add(body);
    bspaceRememberPost(col, ref.id, body);
    const parentPatch = { updatedAt: Date.now() };
    const talk = col === 'conversation' && body.type !== 'system';
    if (talk) {
      if (body.parent_id) parentPatch.replies = firebase.firestore.FieldValue.increment(1);
      else parentPatch.comments = firebase.firestore.FieldValue.increment(1);
    }
    if (body.parent_id && !talk) {
      parentPatch.replies = firebase.firestore.FieldValue.increment(1);
    }
    if (col === 'questions') {
      parentPatch.comments = firebase.firestore.FieldValue.increment(1);
    }
    try{
      await fbDb.collection('broadcasts').doc(activeBroadcastId).set(parentPatch, { merge:true });
    }catch(err){
      console.warn('[bspace] count', err);
    }
    try{
      const creator = activeBroadcastMeta && activeBroadcastMeta.creatorUid;
      if(talk && creator && currentUser && creator !== currentUser.uid && typeof bumpTogaMonth === 'function'){
        bumpTogaMonth(creator, { engageMonthDelta: 1, featuredBroadcastId: activeBroadcastId });
      }
      if ((col === 'conversation' || col === 'questions' || col === 'results') && body.type !== 'system' && window.NalunoDiscover && typeof NalunoDiscover.note === 'function') {
        const kind = body.parent_id ? 'answer' : (col === 'questions' ? 'question' : 'meaningful_comment');
        NalunoDiscover.note(kind, activeBroadcastId);
      }
      if(talk && typeof nalunoTrack === 'function'){
        const isReply = !!body.parent_id;
        nalunoTrack(isReply ? 'COMMENT_REPLY' : 'BROADCAST_COMMENT', {
          broadcast_id: activeBroadcastId,
          target_type: 'conversation',
          creator_uid: creator || '',
          parent_event_id: body.parent_id || null,
          text: body.text || '',
        });
      }
      if(col === 'questions' && typeof nalunoTrack === 'function'){
        nalunoTrack('BROADCAST_COMMENT', {
          broadcast_id: activeBroadcastId,
          target_type: 'question',
          creator_uid: creator || '',
          text: body.text || '',
        });
      }
    }catch(_){}
    return true;
  }catch(e){
    console.warn('[bspace] post failed', e);
    toast(e.message || 'Couldn’t post');
    return false;
  }
}
function bspaceRememberPost(col, id, data){
  const row = { id: id, data: function(){ return data; } };
  const cur = (bspaceDocCache[col] || []).filter(function(d){ return d.id !== id; });
  cur.push(row);
  bspaceDocCache[col] = cur;
  const paint = {
    conversation: renderBspaceConversation,
    questions: renderBspaceQuestions,
    results: renderBspaceResults,
    resources: renderBspaceResources,
    journey: renderBspaceJourney,
    updates: renderBspaceUpdates,
  }[col];
  if(paint){ try{ paint(cur); }catch(_){} }
}

$('bspaceBack').onclick = closeBroadcastSpace;

(function wireBspaceTidy(){
  const desc = $('bspaceDesc');
  if(desc && !desc.__tidy){
    desc.__tidy = true;
    desc.onclick = function(){ desc.classList.toggle('open'); };
  }
  const strandBtn = $('bspaceStrandToggle');
  const strandBody = $('bspaceStrandBody');
  if(strandBtn && strandBody && !strandBtn.__tidy){
    strandBtn.__tidy = true;
    strandBtn.onclick = function(){
      const open = strandBody.hasAttribute('hidden');
      if(open) strandBody.removeAttribute('hidden');
      else strandBody.setAttribute('hidden', '');
      strandBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    };
  }
})();

document.querySelectorAll('#bspaceTabs .bspace-tab').forEach(tab=>{
  tab.onclick = ()=> setBspaceTab(tab.dataset.bspan);
});

$('bspaceJoinBtn').onclick = async ()=>{
  if(!currentUser || !fbDb || !activeBroadcastId){ toast('Sign in to join'); return; }
  const btn = $('bspaceJoinBtn');
  if(btn && btn.disabled) return;
  const creatorUid = activeBroadcastMeta && activeBroadcastMeta.creatorUid;
  if(!creatorUid){ toast('Creator missing'); return; }
  if(currentUser.uid === creatorUid) return;
  const joined = !!(btn && btn.classList.contains('joined'));
  if(joined){
    if(btn){ btn.disabled = true; btn.textContent = 'Leaving…'; }
    try{
      if(typeof leaveCreatorCircle === 'function'){
        await leaveCreatorCircle(creatorUid, activeBroadcastId);
      } else {
        await fbDb.collection('users').doc(creatorUid).collection('circle').doc(currentUser.uid).delete();
        await fbDb.collection('broadcasts').doc(activeBroadcastId).set({
          memberUids: firebase.firestore.FieldValue.arrayRemove(currentUser.uid),
          updatedAt: Date.now(),
        }, { merge:true });
      }
      if(btn){
        btn.textContent = 'Join';
        btn.classList.remove('joined');
        btn.disabled = false;
      }
      const name = ((activeBroadcastMeta && activeBroadcastMeta.creatorName) || 'this creator').split(' ')[0];
      toast('You left ' + name + '’s Circle');
    }catch(e){
      console.warn('[bspace] leave', e);
      if(btn){ btn.disabled = false; btn.textContent = 'Leave'; btn.classList.add('joined'); }
      toast((e && e.message) || 'Couldn’t leave');
    }
    return;
  }
  if(btn){ btn.disabled = true; btn.textContent = 'Joining…'; }
  try{
    if(typeof joinCreatorCircle === 'function'){
      await joinCreatorCircle(creatorUid, activeBroadcastId);
    } else {
      const ref = fbDb.collection('broadcasts').doc(activeBroadcastId);
      await ref.set({
        memberUids: firebase.firestore.FieldValue.arrayUnion(currentUser.uid),
        updatedAt: Date.now(),
      }, { merge:true });
    }
    const name = ((activeBroadcastMeta && activeBroadcastMeta.creatorName) || 'this creator').split(' ')[0];
    if(btn){
      btn.textContent = 'Leave';
      btn.classList.add('joined');
      btn.disabled = false;
    }
    toast('You’re with ' + name + ' — every Broadcast of theirs');
  }catch(e){
    console.warn('[bspace] join', e);
    if(btn){ btn.disabled = false; btn.textContent = 'Join'; btn.classList.remove('joined'); }
    toast(e.message || 'Couldn’t join — check connection / rules');
  }
};

if($('bspaceStrandSave')){
  $('bspaceStrandSave').onclick = async function(){
    if(!activeBroadcastId || !currentUser) return;
    const pick = $('bspaceStrandPick');
    const nameEl = $('bspaceStrandNew');
    const strandId = (pick && pick.value) || '';
    const strandName = (nameEl && nameEl.value.trim()) || '';
    if(!strandId && !strandName){ toast('Pick a Strand or type a new name'); return; }
    try{
      const s = await attachBroadcastToStrand(activeBroadcastId, strandId, strandName);
      if(s){
        if(activeBroadcastMeta){
          activeBroadcastMeta.strandId = s.id;
          activeBroadcastMeta.strandName = s.name;
        }
        toast('On Strand · ' + s.name);
        renderBspaceRelated();
        if(nameEl) nameEl.value = '';
        if(typeof fillStrandSelect === 'function') fillStrandSelect(pick);
        if(pick) pick.value = s.id;
      }
    }catch(e){
      toast((e && e.message) || 'Could not save Strand');
    }
  };
}

$('bspaceConvSend').onclick = async ()=>{
  const input = $('bspaceConvInput');
  const text = ((input && input.value) || '').trim();
  if(!text || (input && input.dataset.sending === '1')) return;
  if(input) input.dataset.sending = '1';
  const ok = await bspacePost('conversation', { type:'text', text });
  if(input) input.dataset.sending = '0';
  if(ok && input) input.value = '';
};
$('bspaceConvInput').addEventListener('keydown', e=>{
  if(e.key === 'Enter'){ e.preventDefault(); $('bspaceConvSend').onclick(); }
});

let bspaceVoiceRec = null;
let bspaceVoiceStream = null;
let bspaceVoiceStartInFlight = false;
let bspaceVoiceChunks = [];
let bspaceVoiceStart = 0;
let bspaceVoiceTimer = null;

function bspaceVoiceResetBtn(){
  const btn = $('bspaceConvVoice');
  if(!btn) return;
  btn.textContent = 'Voice';
  btn.style.background = '';
  btn.style.color = '';
}
async function bspaceVoiceStopAndSend(){
  const btn = $('bspaceConvVoice');
  if(bspaceVoiceTimer){ clearInterval(bspaceVoiceTimer); bspaceVoiceTimer = null; }
  const rec = bspaceVoiceRec;
  const stream = bspaceVoiceStream;
  bspaceVoiceRec = null;
  bspaceVoiceStream = null;
  if(!rec){ bspaceVoiceResetBtn(); return; }
  const blob = await new Promise(resolve=>{
    rec.onstop = ()=>{
      const b = new Blob(bspaceVoiceChunks, { type: (bspaceVoiceChunks[0] && bspaceVoiceChunks[0].type) || 'audio/webm' });
      resolve(b.size ? b : null);
    };
    try{ rec.stop(); }catch(_){ resolve(null); }
  });
  bspaceVoiceChunks = [];
  if(stream) stream.getTracks().forEach(t=>{ try{ t.stop(); }catch(_){} });
  bspaceVoiceResetBtn();
  if(!blob){ toast('Nothing recorded'); return; }
  try{
    if(typeof nalunoUploadLog === 'function') nalunoUploadLog('Broadcast voice', Math.round(blob.size/1024)+'KB');
    if(btn) btn.textContent = 'Uploading…';
    const ct = (blob.type && String(blob.type).indexOf('audio/') === 0) ? blob.type : 'audio/webm';
    let url = null;
    if(typeof uploadBroadcastFile === 'function'){
      url = await uploadBroadcastFile(blob, null, ct);
    } else if(typeof uploadVideoToR2 === 'function'){
      url = await uploadVideoToR2(blob);
    } else {
      throw new Error('Uploader not loaded');
    }
    const posted = await bspacePost('conversation', { type:'voice', mediaUrl:url, text:'', duration: Math.round((Date.now()-bspaceVoiceStart)/1000) });
    if(posted) toast('Voice added');
    try{ if(typeof nalunoUploadLog === 'function') nalunoUploadLog('Broadcast voice ok'); }catch(_){}
  }catch(e){
    try{ if(typeof nalunoUploadLog === 'function') nalunoUploadLog('Broadcast voice FAIL', e && e.message); }catch(_){}
    toast(e.message || 'Voice failed');
  }finally{
    bspaceVoiceResetBtn();
  }
}

$('bspaceConvVoice').onclick = async ()=>{
  if(!(await bspaceRequireMember())) return;
  if(bspaceVoiceRec && bspaceVoiceRec.state === 'recording'){
    await bspaceVoiceStopAndSend();
    return;
  }
  if(!navigator.mediaDevices || !window.MediaRecorder){ toast('Voice not supported here'); return; }
  // Same in-flight latch as bspaceStartLive — the guard above checks
  // bspaceVoiceRec, which doesn't exist until after getUserMedia() resolves,
  // so two quick taps would open two mic streams and orphan the first.
  if(bspaceVoiceStartInFlight) return;
  bspaceVoiceStartInFlight = true;
  try{
    bspaceVoiceChunks = [];
    bspaceVoiceStream = await navigator.mediaDevices.getUserMedia({ audio:true });
    const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : (MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : '');
    bspaceVoiceRec = new MediaRecorder(bspaceVoiceStream, mime ? { mimeType: mime, audioBitsPerSecond: 40000 } : { audioBitsPerSecond: 40000 });
    bspaceVoiceRec.ondataavailable = e=>{ if(e.data && e.data.size) bspaceVoiceChunks.push(e.data); };
    bspaceVoiceStart = Date.now();
    bspaceVoiceRec.start(250);
    const btn = $('bspaceConvVoice');
    if(btn){ btn.textContent = 'Stop'; btn.style.background = 'var(--red)'; btn.style.color = '#fff'; }
    bspaceVoiceTimer = setInterval(()=>{
      if(Date.now() - bspaceVoiceStart >= 60000) bspaceVoiceStopAndSend();
    }, 500);
  }catch(e){
    toast(e.message || 'Mic unavailable');
    bspaceVoiceResetBtn();
  }finally{
    bspaceVoiceStartInFlight = false;
  }
};

$('bspaceQSend').onclick = async ()=>{
  const input = $('bspaceQInput');
  const text = ((input && input.value) || '').trim();
  if(!text) return;
  const ok = await bspacePost('questions', { type:'question', text, answers:[], bestAnswer:null });
  if(!ok) return;
  if(input) input.value = '';
  await bspacePost('journey', { type:'question', text: 'New question: ' + text.slice(0, 80) });
};

async function bspaceAnswerQuestion(qid){
  if(!(await bspaceRequireMember())) return;
  const input = document.querySelector(`.bspace-answer-input[data-qid="${qid}"]`);
  const text = input && input.value.trim();
  if(!text) return;
  try{
    const ref = fbDb.collection('broadcasts').doc(activeBroadcastId).collection('questions').doc(qid);
    const snap = await ref.get();
    if(!snap.exists) return;
    const answers = snap.data().answers || [];
    answers.push({ from: currentUser.uid, text, ts: Date.now() });
    await ref.update({ answers });
    if(input) input.value = '';
  }catch(e){ toast(e.message || 'Couldn’t answer'); }
}

$('bspaceResultSend').onclick = async ()=>{
  const input = $('bspaceResultInput');
  const text = ((input && input.value) || '').trim();
  if(!text) return;
  const ok = await bspacePost('results', { type:'result', text });
  if(!ok) return;
  if(input) input.value = '';
  await bspacePost('journey', { type:'result', text: 'Result shared: ' + text.slice(0, 80) });
};

$('bspaceResSend').onclick = async ()=>{
  const title = ($('bspaceResTitle').value || '').trim();
  const url = ($('bspaceResUrl').value || '').trim();
  if(!title && !url) return;
  $('bspaceResTitle').value = '';
  $('bspaceResUrl').value = '';
  await bspacePost('resources', { type:'link', title: title || url, url });
  await bspacePost('journey', { type:'resource', text: 'Resource attached: ' + (title || url).slice(0, 80) });
};

/* ---- Creator impact dashboard ---- */
function renderBspaceImpact(){
  const grid = $('bspaceImpactGrid');
  if(!grid || !activeBroadcastId || !fbDb) return;
  const creatorUid = (activeBroadcastMeta && activeBroadcastMeta.creatorUid) || '';
  Promise.all([
    fbDb.collection('broadcasts').doc(activeBroadcastId).collection('conversation').get(),
    fbDb.collection('broadcasts').doc(activeBroadcastId).collection('questions').get(),
    fbDb.collection('broadcasts').doc(activeBroadcastId).collection('results').get(),
    fbDb.collection('broadcasts').doc(activeBroadcastId).collection('resources').get(),
    fbDb.collection('broadcasts').doc(activeBroadcastId).get(),
    creatorUid ? fbDb.collection('users').doc(creatorUid).collection('circle').limit(200).get() : Promise.resolve(null),
  ]).then(([conv, qs, res, resources, doc, circleSnap])=>{
    const members = (doc.exists && doc.data().memberUids) || [];
    const circleRows = [];
    if(circleSnap && circleSnap.docs){
      circleSnap.forEach(function(d){ circleRows.push(d.id); });
    }
    const communityN = circleRows.length || members.length;
    const answered = qs.docs.filter(d => (d.data().answers && d.data().answers.length) || d.data().bestAnswer).length;
    const realConvCount = conv.docs.filter(d => {
      const t = d.data().type;
      return t !== 'system' && t !== 'live';
    }).length;
    const cells = [
      ['Community', communityN],
      ['Conversations', realConvCount],
      ['Questions', qs.size],
      ['Answered', answered],
      ['Results', res.size],
      ['Resources', resources.size],
    ];
    grid.innerHTML = cells.map(([label, n]) =>
      `<div class="bspace-card${label === 'Community' ? ' bspace-stat-tappable' : ''}" ${label === 'Community' ? 'id="bspaceCommunityCell" role="button" tabindex="0"' : ''} style="margin:0;text-align:center;padding:14px 8px;">
        <div style="font-family:var(--font-futuristic);font-size:22px;color:var(--mint);">${n}</div>
        <div style="font-family:var(--font-mono);font-size:10px;color:var(--text-dim);margin-top:4px;">${label}${label === 'Community' ? ' \u00b7 tap' : ''}</div>
      </div>`
    ).join('');
    // Community is the only tappable cell: it opens the list of people who
    // actually joined this creator's Circle. Deliberately lazy — the member
    // list is NOT fetched as part of this dashboard render (which runs on
    // every Broadcast open); it's only loaded when someone actually taps,
    // so the common case costs nothing extra.
    const cell = $('bspaceCommunityCell');
    if(cell){
      const open = function(){
        const creatorUid = (activeBroadcastMeta && activeBroadcastMeta.creatorUid) || '';
        if(typeof openCircleMembers === 'function') openCircleMembers(creatorUid, members);
      };
      cell.onclick = open;
      cell.onkeydown = function(e){
        if(e && (e.key === 'Enter' || e.key === ' ')){ e.preventDefault(); open(); }
      };
    }
  }).catch(()=>{ grid.innerHTML = ''; });
}

function renderBspaceUpdates(docs){
  const el = $('bspaceUpdates');
  if(!el) return;
  if(!docs.length){
    el.innerHTML = `<div class="bspace-card"><div class="body" style="color:var(--text-dim);">No updates yet. The creator can correct, pin, or add follow-ups here.</div></div>`;
    return;
  }
  el.innerHTML = docs.map(d=>{
    const m = d.data();
    return `<div class="bspace-card">
      <div class="who">${m.pinned ? '📌 ' : ''}Update · ${timeAgo(m.ts || Date.now())}</div>
      <div class="body">${bspaceEscape(m.text || '')}</div>
    </div>`;
  }).join('');
}

/* ---- Go Live: same Broadcast, new chapter ---- */
let bspaceLiveStream = null;
let bspaceLiveUnsub = null;
let bspaceLiveRecorder = null;
let bspaceLiveChunks = [];
let bspaceLiveRecStartedAt = 0;

async function bspaceStopLive(){
  // FIX (major): this function used to run unconditionally every time a
  // Broadcast view closed — which happens for EVERY broadcast, live or not,
  // any time someone taps back. With no guard, it always wrote
  // lastLiveEndedAt = now to whatever broadcast was open, permanently
  // stamping plain uploads that were never live with a "Was live · just now"
  // badge the instant anyone simply viewed and closed them. Only a genuine
  // live session (an active camera stream or an in-progress recording) can
  // trigger any of this now.
  if(!bspaceLiveStream && (!bspaceLiveRecorder || bspaceLiveRecorder.state === 'inactive')){
    return;
  }
  const bcastId = activeBroadcastId;
  // Stop recorder first and keep chunks for permanent "Live recording" chapter
  let liveBlob = null;
  let liveDur = 0;
  try{
    if(bspaceLiveRecorder && bspaceLiveRecorder.state !== 'inactive'){
      liveDur = Math.max(1, (Date.now() - (bspaceLiveRecStartedAt || Date.now())) / 1000);
      liveBlob = await new Promise(resolve=>{
        bspaceLiveRecorder.onstop = ()=>{
          const blob = new Blob(bspaceLiveChunks, { type: (bspaceLiveChunks[0] && bspaceLiveChunks[0].type) || 'video/webm' });
          resolve(blob.size ? blob : null);
        };
        try{ bspaceLiveRecorder.stop(); }catch(_){ resolve(null); }
      });
    }
  }catch(e){ console.warn('[live] record stop', e); }
  bspaceLiveRecorder = null;
  bspaceLiveChunks = [];

  if(typeof bLiveOnHostStopped === 'function'){
    try{ await bLiveOnHostStopped(); }catch(_){}
  }
  if(bspaceLiveStream){
    bspaceLiveStream.getTracks().forEach(t=>{ try{ t.stop(); }catch(_){} });
    bspaceLiveStream = null;
  }
  if(bspaceLiveUnsub){ try{ bspaceLiveUnsub(); }catch(_){} bspaceLiveUnsub = null; }
  const badge = $('bspaceLiveBadge');
  if(badge) badge.style.display = 'none';
  const btn = $('bspaceGoLive');
  if(btn){ btn.textContent = 'Go live'; btn.style.background = ''; btn.style.color = ''; }
  if(fbDb && bcastId && currentUser){
    // Duration for the past-tense message/badge — read the start time BEFORE
    // clearing it, and keep it (as lastLiveStartedAt/lastLiveEndedAt) instead
    // of discarding it, so "was live" can say when and for how long.
    let startedAt = null;
    try{
      const snap = await fbDb.collection('broadcasts').doc(bcastId).get();
      startedAt = (snap.exists && snap.data() && snap.data().liveAt) || bspaceLiveRecStartedAt || null;
    }catch(_){ startedAt = bspaceLiveRecStartedAt || null; }
    const endedAt = Date.now();
    const durationMs = startedAt ? Math.max(0, endedAt - startedAt) : null;
    fbDb.collection('broadcasts').doc(bcastId).set({
      live: false,
      liveAt: null,
      liveBy: null,
      lastLiveStartedAt: startedAt,
      lastLiveEndedAt: endedAt,
      lastLiveDurationMs: durationMs,
    }, { merge:true }).catch(()=>{});
    // Past tense after live ends (pin + journey) — present tense while live
    // ("is live now"), past tense once it stops ("was live"), with how long.
    try{
      const who = (currentProfile && currentProfile.name) || 'Creator';
      const durText = (typeof formatLiveDuration === 'function') ? formatLiveDuration(durationMs) : '';
      // FIX: this used to always say "recording saved when available" —
      // stale and confusing by the time anyone actually reads it, since the
      // recording is very often already there and playable. Whether it's
      // saved is announced for real, once it's actually true, by the
      // separate "Live session saved as chapter" journey entry posted below
      // once the upload finishes — this message just states what happened.
      fbDb.collection('broadcasts').doc(bcastId).collection('conversation').add({
        type: 'system',
        kind: 'was_live',
        durationMs: durationMs || null,
        text: who + ' was live' + (durText ? ' for ' + durText : '') + '.',
        from: currentUser.uid,
        ts: Date.now(),
      }).catch(function(){});
      fbDb.collection('broadcasts').doc(bcastId).collection('journey').add({
        type: 'live',
        text: 'Live session ended' + (durText ? ' (' + durText + ')' : ''),
        ts: Date.now(),
        by: currentUser.uid,
      }).catch(function(){});
    }catch(_){}
  }

  // Append recorded live as a chapter on this Broadcast (background)
  if(liveBlob && liveBlob.size > 1000 && bcastId && currentUser && (typeof uploadBroadcastFile === 'function' || typeof uploadVideoToR2 === 'function')){
    toast('Saving live recording…');
    const job = {
      label: 'Saving live recording…',
      doneMsg: 'Live saved as chapter',
      run: async (progress)=>{
        
      let liveThumb = null;
      try{
        if(liveBlob && typeof generateVideoThumbnail === 'function'){
          liveThumb = await generateVideoThumbnail(liveBlob);
          if(liveThumb && typeof persistThumbnailDataUrl === 'function'){
            liveThumb = await persistThumbnailDataUrl(liveThumb);
          }
        }
      }catch(_){}
if(progress) progress('Uploading live recording…');
        const url = (typeof uploadBroadcastFile === 'function')
          ? await uploadBroadcastFile(liveBlob, progress)
          : await uploadVideoToR2(liveBlob);
        const ref = fbDb.collection('broadcasts').doc(bcastId);
        const snap = await ref.get();
        if(!snap.exists) return;
        const d = snap.data() || {};
        const chapters = Array.isArray(d.chapters) ? d.chapters.slice() : [];
        const idx = chapters.length;
        chapters.push({
          index: idx,
          thumbUrl: liveThumb || null,
          mediaUrl: url,
          duration: liveDur,
          title: 'Live · ' + new Date().toLocaleString(),
          fromLive: true,
          bytes: liveBlob.size,
        });
        const breathers = (typeof buildBreathersForChapters === 'function')
          ? buildBreathersForChapters(chapters.length)
          : (d.breathers || null);
        await ref.set({
          chapters,
          breathers,
          mediaUrl: d.mediaUrl || url,
          mediaType: d.mediaType || 'video',
          thumbUrl: d.thumbUrl || liveThumb || null,
          updatedAt: Date.now(),
        }, { merge:true });
        try{
          await ref.collection('journey').add({
            type: 'live_recording',
            text: 'Live session saved as chapter',
            ts: Date.now(),
            by: currentUser.uid,
          });
        }catch(_){}
        if(activeBroadcastId === bcastId && activeBroadcastMeta){
          activeBroadcastMeta.chapters = chapters;
          activeBroadcastMeta.breathers = breathers;
          if(typeof renderBspaceMedia === 'function' && activeBroadcastMeta.segment){
            activeBroadcastMeta.segment.chapters = chapters;
            activeBroadcastMeta.segment.videoUrl = activeBroadcastMeta.segment.videoUrl || url;
            renderBspaceMedia(activeBroadcastMeta.segment);
          }
        }
      },
    };
    if(typeof enqueuePublishJob === 'function') enqueuePublishJob(job);
    else job.run(()=>{}).catch(e=> toast(e.message || 'Could not save live'));
  } else {
    try{
      const liveEl = $('bspaceLiveVideo') || $('bspaceViewerLiveVideo');
      if(liveEl){ try{ liveEl.srcObject = null; }catch(_){} }
      if(typeof renderBspaceMedia === 'function' && activeBroadcastMeta && activeBroadcastMeta.segment){
        renderBspaceMedia(activeBroadcastMeta.segment);
      }
    }catch(_){}
  }
}

let bspaceLiveStartInFlight = false;

async function bspaceStartLive(){
  if(!(await bspaceRequireMember())) return;
  const isCreator = !!(activeBroadcastMeta && (activeBroadcastMeta.isMine || (currentUser && activeBroadcastMeta.creatorUid === currentUser.uid)));
  if(!isCreator){ toast('Only the creator can go live'); return; }
  if(bspaceLiveStream){ await bspaceStopLive(); toast('Live ended'); return; }
  // FIX (found by stress-testing a double tap): the guard above checks
  // bspaceLiveStream, but that isn't assigned until AFTER getUserMedia()
  // resolves — and opening a camera on Android routinely takes 300ms-2s
  // (permission prompt, hardware init). Any tap inside that window passed
  // the guard too, so two quick taps opened TWO camera streams, ran the
  // whole go-live fan-out TWICE (360 Firestore writes, 120 pushes, and
  // every single person messaged twice), and orphaned the first
  // MediaStream — camera left running with nothing holding a reference to
  // stop it. This latch closes the window; it's cleared in a finally so a
  // failed or denied camera can still be retried.
  if(bspaceLiveStartInFlight) return;
  bspaceLiveStartInFlight = true;
  try{
    bspaceLiveStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 1920 }, frameRate: { ideal: 30, max: 30 } },
      audio: true,
    });
    try{
      const vt = bspaceLiveStream.getVideoTracks()[0];
      if(vt && vt.applyConstraints){
        vt.applyConstraints({ width: { ideal: 1920 }, height: { ideal: 1920 }, frameRate: { ideal: 30 } }).catch(function(){});
      }
    }catch(_){}
  }catch(e){
    bspaceLiveStartInFlight = false;
    toast('Camera/mic needed to go live');
    return;
  }
  bspaceLiveStartInFlight = false;
  const host = $('bspaceMedia');
  if(host){
    host.innerHTML = `<video id="bspaceLiveVideo" autoplay playsinline muted style="width:100%;height:100%;object-fit:cover;"></video>`;
    const v = $('bspaceLiveVideo');
    if(v){
      v.srcObject = bspaceLiveStream;
      try{ v.dataset.nalunoKeepAlive = '1'; v.dataset.nalunoWantPlay = '1'; }catch(_){}
      v.play().catch(()=>{});
      try{ if(typeof nalunoCorrectVideoOrientation === 'function') nalunoCorrectVideoOrientation(v, bspaceLiveStream, true); }catch(_){}
    }
  }
  const badge = $('bspaceLiveBadge');
  if(badge) badge.style.display = 'block';
  const btn = $('bspaceGoLive');
  if(btn){ btn.textContent = 'End live'; btn.style.background = 'var(--red)'; btn.style.color = '#fff'; }

  await fbDb.collection('broadcasts').doc(activeBroadcastId).set({
    live: true,
    liveAt: Date.now(),
    liveBy: currentUser.uid,
    updatedAt: Date.now(),
  }, { merge:true });
  if(typeof bLiveOnHostStarted === 'function'){
    try{ await bLiveOnHostStarted(bspaceLiveStream); }catch(e){ console.warn('[live]', e); }
    // Record live for permanent chapter when live ends
    try{
      bspaceLiveChunks = [];
      bspaceLiveRecStartedAt = Date.now();
      const mime = MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus')
        ? 'video/webm;codecs=vp9,opus'
        : (MediaRecorder.isTypeSupported('video/webm') ? 'video/webm' : '');
      bspaceLiveRecorder = new MediaRecorder(bspaceLiveStream, mime ? { mimeType: mime, videoBitsPerSecond: 1800000 } : { videoBitsPerSecond: 1800000 });
      bspaceLiveRecorder.ondataavailable = e=>{
        if(e.data && e.data.size){
          bspaceLiveChunks.push(e.data);
          if(bspaceLiveChunks.length >= 240){
            try{ bspaceLiveRecorder.stop(); }catch(_){}
          }
        }
      };
      bspaceLiveRecorder.start(1000);
    }catch(e){ console.warn('[live] record start', e); bspaceLiveRecorder = null; }
  }
  // FIX ("was live" / "is live now" always read in third person, even when
  // the creator is the one looking at their own broadcast — "MAGAMBO is
  // live now" makes no sense addressed to MAGAMBO). Adds kind:'went_live' so
  // the renderer can say "You're live now" to the creator specifically,
  // while text keeps the old, name-baked wording as a fallback for anything
  // that just reads text directly (older clients, notifications, search).
  await bspacePost('conversation', { type:'system', kind:'went_live', text: ((currentProfile && currentProfile.name) || 'Creator') + ' is live now — tap Join live to watch.' });
  await bspacePost('journey', { type:'live', text: 'Live session started' });
  if(typeof notifyFrequenciesLive === 'function'){
    await notifyFrequenciesLive(activeBroadcastId, (activeBroadcastMeta && activeBroadcastMeta.title) || 'Broadcast');
  }
  toast('You’re live — your frequencies were notified');
}

$('bspaceGoLive').onclick = ()=> bspaceStartLive();

if($('bspaceUpdateSend')){
  $('bspaceUpdateSend').onclick = async ()=>{
    const text = ($('bspaceUpdateInput').value || '').trim();
    if(!text) return;
    if(!(activeBroadcastMeta && (activeBroadcastMeta.isMine || (currentUser && activeBroadcastMeta.creatorUid === currentUser.uid)))){
      toast('Only the creator can post updates');
      return;
    }
    $('bspaceUpdateInput').value = '';
    await bspacePost('updates', { type:'update', text, pinned: false });
    await bspacePost('journey', { type:'update', text: 'Update: ' + text.slice(0, 80) });
    toast('Broadcast updated');
    renderBspaceImpact();
  };
}

if($('bspaceConvPhoto')){
  // Overlay input is the tap target — do not call input.click() from the button.
}
if($('bspaceConvPhotoInput')){
  $('bspaceConvPhotoInput').onchange = async ()=>{
    const file = $('bspaceConvPhotoInput').files && $('bspaceConvPhotoInput').files[0];
    try{ if(typeof nalunoUploadLog === 'function') nalunoUploadLog('Broadcast photo pick', file ? (file.name+' '+file.size) : 'empty'); }catch(_){}
    if(!file){
      toast('No photo came through — try the Files app');
      return;
    }
    if(!(await bspaceRequireMember())) return;
    try{
      toast('Uploading photo…');
      const url = (typeof uploadPhotoToR2 === 'function')
        ? await uploadPhotoToR2(file)
        : (typeof uploadBroadcastFile === 'function')
          ? await uploadBroadcastFile(file, null, (file.type && file.type.indexOf('image/')===0) ? file.type : 'image/jpeg')
          : await uploadVideoToR2(file);
      const posted = await bspacePost('conversation', { type:'photo', mediaUrl: url, text: '' });
      if(posted) toast('Photo shared');
      try{ if(typeof nalunoUploadLog === 'function') nalunoUploadLog('Broadcast photo ok'); }catch(_){}
    }catch(e){
      try{ if(typeof nalunoUploadLog === 'function') nalunoUploadLog('Broadcast photo FAIL', e && e.message); }catch(_){}
      toast(e.message || 'Upload failed');
    }
  };
}

/** "12m", "1h 05m" — used for the "was live" wording, never technical (no ms/raw numbers). */
function formatLiveDuration(ms){
  if(!ms || ms < 1000) return '';
  const totalMin = Math.round(ms / 60000);
  if(totalMin < 1) return 'under a minute';
  if(totalMin < 60) return totalMin + 'm';
  const h = Math.floor(totalMin / 60), m = totalMin % 60;
  return h + 'h' + (m ? ' ' + m + 'm' : '');
}
window.formatLiveDuration = formatLiveDuration;

// Watch live flag when viewing someone else's broadcast
function bspaceWatchLiveState(){
  if(!fbDb || !activeBroadcastId) return;
  const unsub = fbDb.collection('broadcasts').doc(activeBroadcastId).onSnapshot(doc=>{
    if(!doc.exists) return;
    const d = doc.data() || {};
    try{
      if(activeBroadcastMeta){
        activeBroadcastMeta.live = !!d.live;
        activeBroadcastMeta.views = typeof d.views === 'number' ? d.views : (activeBroadcastMeta.views || 0);
        activeBroadcastMeta.lastLiveStartedAt = d.lastLiveStartedAt || null;
        activeBroadcastMeta.lastLiveEndedAt = d.lastLiveEndedAt || null;
        activeBroadcastMeta.lastLiveDurationMs = (d.lastLiveDurationMs != null) ? d.lastLiveDurationMs : null;
      }
    }catch(_){}
    const badge = $('bspaceLiveBadge');
    const isCreator = !!(activeBroadcastMeta && (activeBroadcastMeta.isMine || (currentUser && activeBroadcastMeta.creatorUid === currentUser.uid)));
    if(badge){
      if(d.live){
        // Present tense while actually live.
        badge.style.display = 'block';
        badge.textContent = isCreator ? 'Live now' : ((typeof bLiveViewerPc !== 'undefined' && bLiveViewerPc) ? 'Live now' : 'Live now — join');
      } else if(!bspaceLiveStream){
        // Past tense for a while after ending, then fade away — never a bare
        // "LIVE" left showing once it's over, and never silently blank either.
        // FIX: also require lastLiveStartedAt + lastLiveDurationMs to be
        // present. A genuine live session always has both; the bug that used
        // to stamp lastLiveEndedAt on every closed broadcast (fixed above,
        // in bspaceStopLive) always left those two null for a broadcast that
        // was never actually live, since there was no real start time to
        // compute a duration from. This means any already-corrupted data
        // from before that fix self-heals here without needing a migration.
        const endedAt = d.lastLiveEndedAt || 0;
        const hadRealSession = !!(d.lastLiveStartedAt && d.lastLiveDurationMs != null);
        const recentEnough = endedAt && hadRealSession && (Date.now() - endedAt) < 24 * 60 * 60 * 1000;
        if(recentEnough){
          const dur = formatLiveDuration(d.lastLiveDurationMs);
          badge.style.display = 'block';
          badge.textContent = 'Was live' + (dur ? ' for ' + dur : '') + ' · ' + timeAgo(endedAt);
        } else {
          badge.style.display = 'none';
        }
      }
    }
    if(typeof bLiveOnSpaceOpened === 'function'){
      bLiveOnSpaceOpened(!!d.live, isCreator);
    }
    scheduleBspaceLivePaint();
    // Non-creator: always expose Join live while host is live
    if(d.live && !isCreator){
      if(typeof bLiveShowJoinUi === 'function') bLiveShowJoinUi(true);
      if(typeof bLiveEnsureJoinBanner === 'function'){
        const ban = bLiveEnsureJoinBanner();
        if(ban) ban.style.display = 'flex';
      }
    }
    // Host ended: clear viewer chrome
    if(!d.live && !isCreator){
      if(typeof bLiveLeaveViewer === 'function' && typeof bLiveViewerPc !== 'undefined' && bLiveViewerPc){
        try{ bLiveLeaveViewer(); }catch(_){}
      }
      if(typeof bLiveShowJoinUi === 'function') bLiveShowJoinUi(false);
    }
  }, err => console.warn('[bspace] live watch', err));
  bspaceUnsubs.push(unsub);
}


function bspaceMetaFromRecord(id, d){
  d = d || {};
  if(d.mediaType === 'writing' || d.kind === 'writing'){
    const chapters = Array.isArray(d.chapters) ? d.chapters : [];
    const text = d.body || chapters.map(function(c){ return c && c.text ? c.text : ''; }).filter(Boolean).join('\n\n') || d.description || '';
    return {
      isMine: !!(typeof currentUser !== 'undefined' && currentUser && d.creatorUid === currentUser.uid),
      broadcastId: id,
      segment: {
        type: 'writing',
        text: text,
        chapters: chapters,
        caption: d.description || '',
        thumbUrl: d.thumbUrl || d.mediaUrl || '',
        bg: 'linear-gradient(165deg,#141a16,#0d1018)',
      },
      creatorUid: d.creatorUid,
      creatorName: d.creatorName,
      title: d.title,
      description: d.description,
      tags: d.tags || [],
      chapters: chapters,
      body: text,
      originCredit: d.originCredit || null,
      repostOf: d.repostOf || null,
      live: false,
      strandId: d.strandId || null,
      strandName: d.strandName || null,
      views: typeof d.views === 'number' ? d.views : 0,
    };
  }
  const chapters = Array.isArray(d.chapters) ? d.chapters : null;
  const primary = (typeof legacyBroadcastPlayUrl === 'function')
    ? legacyBroadcastPlayUrl(d)
    : (d.mediaUrl || d.videoUrl || (chapters && chapters[0] && chapters[0].mediaUrl) || null);
  let mediaType = d.mediaType || 'photo';
  if(d.mediaType === 'video' || d.videoUrl) mediaType = 'video';
  if(mediaType === 'photo' && primary && (typeof looksLikeVideoUrl === 'function' ? looksLikeVideoUrl(primary) : /\.(mp4|webm|mov|m4v)(\?|$)/i.test(primary))){
    mediaType = 'video';
  }
  if(chapters && chapters.length && chapters.some(function(c){ return c && c.mediaUrl && !c.silent && (c.start != null || c.duration); })){
    if(primary) mediaType = 'video';
  }
  const segment = {
    type: mediaType,
    dataUrl: mediaType === 'photo' ? primary : null,
    mediaUrl: primary,
    videoUrl: mediaType === 'video' ? primary : null,
    thumbDataUrl: d.thumbUrl || d.thumb || null,
    text: mediaType === 'text' ? (d.description || d.title) : null,
    bg: 'linear-gradient(160deg,#1a1f2e,#0d1018)',
    filterCss: d.filterCss || '',
    caption: d.description || '',
    chapters: chapters,
  };
  if(segment.type === 'video' && !segment.videoUrl && segment.mediaUrl){
    segment.videoUrl = segment.mediaUrl;
  }
  return {
    isMine: !!(typeof currentUser !== 'undefined' && currentUser && d.creatorUid === currentUser.uid),
    broadcastId: id,
    segment: segment,
    creatorUid: d.creatorUid,
    creatorName: d.creatorName,
    title: d.title,
    description: d.description,
    tags: d.tags || [],
    chapters: d.chapters || null,
    breathers: d.breathers || null,
    originCredit: d.originCredit || null,
    repostOf: d.repostOf || null,
    mediaUrl: primary,
    thumbUrl: d.thumbUrl || d.thumb || null,
    live: !!d.live,
    lastLiveStartedAt: d.lastLiveStartedAt || null,
    lastLiveEndedAt: d.lastLiveEndedAt || null,
    lastLiveDurationMs: (d.lastLiveDurationMs != null) ? d.lastLiveDurationMs : null,
    strandId: d.strandId || null,
    views: typeof d.views === 'number' ? d.views : 0,
  };
}

function cachedBroadcastRow(id){
  const pools = [];
  try{ if(typeof feedBroadcasts !== 'undefined' && feedBroadcasts) pools.push(feedBroadcasts); }catch(_){}
  try{ if(typeof myBroadcasts !== 'undefined' && myBroadcasts) pools.push(myBroadcasts); }catch(_){}
  for(let p = 0; p < pools.length; p++){
    const list = pools[p] || [];
    for(let i = 0; i < list.length; i++){
      if(list[i] && list[i].id === id) return list[i];
    }
  }
  return null;
}

/* ---- Open permanent Broadcast by Firestore id ---- */
async function openBroadcastSpaceById(id){
  if(!id){ toast('Missing Broadcast'); return; }
  const cached = cachedBroadcastRow(id);
  const cachedPlayable = cached && (cached.mediaUrl || cached.videoUrl || (cached.chapters && cached.chapters.length) || cached.mediaType === 'text' || cached.mediaType === 'writing' || cached.kind === 'writing' || cached.body || cached.description);
  if(cachedPlayable){
    try{
      await openBroadcastSpace(bspaceMetaFromRecord(id, cached));
      return;
    }catch(_){}
  }
  if(!fbDb){ toast('Offline'); return; }
  try{
    const snap = await fbDb.collection('broadcasts').doc(id).get();
    if(!snap.exists || snap.data().deleted){ toast('Broadcast not found'); return; }
    await openBroadcastSpace(bspaceMetaFromRecord(id, snap.data()));
  }catch(e){
    console.warn(e);
    toast('Couldn’t open Broadcast');
  }
}




async function bspaceMarkBest(qid, answerText){
  if(!fbDb || !activeBroadcastId || !currentUser) return;
  if(!(activeBroadcastMeta && (activeBroadcastMeta.isMine || activeBroadcastMeta.creatorUid === currentUser.uid))){
    toast('Only the creator can mark the best answer');
    return;
  }
  try{
    await fbDb.collection('broadcasts').doc(activeBroadcastId).collection('questions').doc(qid).update({
      bestAnswer: answerText,
    });
    await bspacePost('journey', { type:'best', text: 'Best answer marked' });
    toast('Best answer saved to this Broadcast');
    renderBspaceImpact();
  }catch(e){ toast(e.message || 'Couldn’t mark'); }
}


function bspaceOpenReport(){
  if(typeof openReportSheet !== 'function'){ toast('Reporting isn’t available right now'); return; }
  const meta = activeBroadcastMeta || {};
  if(currentUser && meta.creatorUid && meta.creatorUid === currentUser.uid){
    toast('This is yours — use Delete if it should come down.');
    return;
  }
  openReportSheet({
    target_type: 'broadcast',
    target_id: activeBroadcastId || '',
    target_user_id: meta.creatorUid || '',
    broadcast_id: activeBroadcastId || '',
    name: meta.creatorName || meta.title || 'this Broadcast',
  });
}

/* Report sits beside Share. The sheet must sit above this space or the tap
   looks dead. Own Broadcasts hide Report (Delete is the control). */
function bspaceOfflinePayload(){
  const meta = activeBroadcastMeta || {};
  const seg = meta.segment || {};
  const chapters = (meta.chapters && meta.chapters.length) ? meta.chapters : (seg.chapters || []);
  const raws = [];
  const push = function(u){
    if(!u || typeof u !== 'string') return;
    const resolved = (typeof resolveMediaUrl === 'function') ? (resolveMediaUrl(u) || u) : u;
    if(raws.indexOf(u) < 0) raws.push(u);
    if(resolved && raws.indexOf(resolved) < 0) raws.push(resolved);
  };
  push(meta.mediaUrl);
  push(seg.mediaUrl);
  push(seg.videoUrl);
  (chapters || []).forEach(function(c){ if(c && c.mediaUrl) push(c.mediaUrl); });
  const playable = raws.filter(function(u){ return u && u.indexOf('blob:') !== 0 && u.indexOf('data:') !== 0; });
  return {
    id: activeBroadcastId,
    mediaUrl: playable[0] || '',
    mediaUrls: playable,
    thumbUrl: meta.thumbUrl || seg.thumbDataUrl || seg.thumbUrl || '',
    title: meta.title || '',
    creatorName: meta.creatorName || '',
  };
}

if($('bspaceSaveOfflineBtn')){
  $('bspaceSaveOfflineBtn').onclick = async function(e){
    try{ e.stopPropagation(); }catch(_){}
    const btn = $('bspaceSaveOfflineBtn');
    const O = window.NalunoOfflineBroadcast;
    if(!O || !activeBroadcastId || !activeBroadcastMeta) return;
    if(O.isSaved(activeBroadcastId)){
      if(!confirm('Remove this from your saved Broadcasts?')) return;
      await O.removeSaved(activeBroadcastId);
      btn.textContent = 'Save'; btn.classList.remove('saved');
      toast('Removed from saved');
      return;
    }
    const payload = bspaceOfflinePayload();
    if(!payload.mediaUrl){
      toast('This Broadcast has no video to save');
      return;
    }
    btn.classList.add('saving'); btn.textContent = 'Saving\u2026';
    const r = await O.saveBroadcast(payload, function(frac){ btn.textContent = 'Saving \u2026 ' + Math.round(frac*100) + '%'; });
    btn.classList.remove('saving');
    if(r.ok){ btn.textContent = 'Saved'; btn.classList.add('saved'); toast('Saved \u2014 watch it without a connection'); }
    else { btn.textContent = 'Save'; toast(r.error || 'Could not save this'); }
  };
}
if($('bspaceShareSignalBtn')){
  $('bspaceShareSignalBtn').onclick = function(e){
    try{ e.stopPropagation(); }catch(_){}
    if(!activeBroadcastId){ return; }
    if(typeof openSignalLinkedTo === 'function') openSignalLinkedTo(activeBroadcastId);
    else toast('Signals are not available right now');
  };
}
async function bspacePassOn(){
  if(!activeBroadcastId || !activeBroadcastMeta) return;
  if(!currentUser || typeof createPermanentBroadcast !== 'function'){ toast('Sign in first'); return; }
  const meta = activeBroadcastMeta;
  const seg = meta.segment || {};
  const writing = seg.type === 'writing';
  const credit = (window.NalunoPass && typeof NalunoPass.creditForShare === 'function')
    ? NalunoPass.creditForShare(meta)
    : null;
  const mine = credit && currentUser && credit.creatorUid === currentUser.uid;
  try{
    await createPermanentBroadcast({
      title: meta.title || 'Broadcast',
      description: meta.description || '',
      tags: meta.tags || [],
      mediaType: writing ? 'writing' : (seg.type === 'photo' ? 'photo' : 'video'),
      mediaUrl: writing ? (seg.thumbUrl || null) : (seg.videoUrl || seg.mediaUrl || seg.dataUrl || meta.mediaUrl || null),
      thumbUrl: meta.thumbUrl || seg.thumbUrl || seg.thumbDataUrl || null,
      chapters: writing ? (meta.chapters || seg.chapters || null) : (meta.chapters || seg.chapters || null),
      body: writing ? (meta.body || seg.text || '') : '',
      words: writing ? String(meta.body || seg.text || '').split(/\s+/).filter(Boolean).length : 0,
      strandId: meta.strandId || null,
      strandName: meta.strandName || null,
      originCredit: mine ? null : credit,
      repostOf: (credit && credit.broadcastId) || activeBroadcastId,
      screen: { decision: 'allow' },
    });
    toast('Passed on');
    if(typeof loadFeedBroadcasts === 'function') loadFeedBroadcasts();
  }catch(e){
    toast((e && e.message) || 'Could not pass this on');
  }
}
function bspaceCloseSend(){
  const sheet = $('bspaceSendSheet');
  if(sheet) sheet.hidden = true;
}
function bspaceOpenSend(){
  if(!activeBroadcastId) return;
  const sheet = $('bspaceSendSheet');
  const list = $('bspaceSendList');
  if(!sheet || !list) return;
  const people = (typeof contacts !== 'undefined' && contacts ? contacts : []).filter(function(c){
    return c && c.isReal && c.firebaseUid && (!currentUser || c.firebaseUid !== currentUser.uid);
  });
  if(!people.length){
    toast('Add someone in Wireline first');
    return;
  }
  list.innerHTML = people.map(function(c){
    const name = c.name || c.number || 'Someone';
    return '<button type="button" data-send-uid="' + bspaceEscape(c.firebaseUid) + '" style="display:block;width:100%;text-align:left;margin:0 0 8px;padding:12px 14px;border-radius:12px;border:1px solid var(--line);background:transparent;color:var(--text);font-size:14px;">' + bspaceEscape(name) + '</button>';
  }).join('');
  list.querySelectorAll('[data-send-uid]').forEach(function(btn){
    btn.onclick = async function(){
      const uid = btn.getAttribute('data-send-uid');
      const person = people.find(function(c){ return c.firebaseUid === uid; });
      if(!person || typeof sendRealMessage !== 'function'){ toast('Could not send'); return; }
      const title = (activeBroadcastMeta && activeBroadcastMeta.title) || 'Broadcast';
      const link = (typeof broadcastShareUrl === 'function')
        ? broadcastShareUrl(activeBroadcastId, title)
        : ('https://getnaluno.com/app/?broadcast=' + encodeURIComponent(activeBroadcastId));
      try{
        await sendRealMessage(person, { type: 'text', text: title + '\n' + link }, title);
        bspaceCloseSend();
        toast('Sent in Naluno');
      }catch(e){
        toast((e && e.message) || 'Could not send');
      }
    };
  });
  sheet.hidden = false;
}
if($('bspacePassBtn')) $('bspacePassBtn').onclick = function(e){ try{ if(e) e.stopPropagation(); }catch(_){} bspacePassOn(); };
if($('bspaceSendBtn')) $('bspaceSendBtn').onclick = function(e){ try{ if(e) e.stopPropagation(); }catch(_){} bspaceOpenSend(); };
if($('bspaceSendClose')) $('bspaceSendClose').onclick = function(){ bspaceCloseSend(); };
if($('bspaceReportBtn')){
  $('bspaceReportBtn').onclick = function(e){
    if(e){ e.preventDefault(); e.stopPropagation(); }
    bspaceOpenReport();
  };
}

/** A picture of this Broadcast for the share sheet. Chats unfurl whatever
 *  URL they are given; getnaluno.com is one page for every Broadcast, so the
 *  preview has to travel as the image itself. Drawn here — no worker URL. */
async function bspaceShareCard(title, creator, thumbUrl){
  const canvas = document.createElement('canvas');
  canvas.width = 1200; canvas.height = 630;
  const ctx = canvas.getContext('2d');
  if(!ctx) return null;
  ctx.fillStyle = '#0D0F17';
  ctx.fillRect(0, 0, 1200, 630);
  ctx.fillStyle = '#7CFFB2';
  ctx.fillRect(0, 0, 10, 630);
  if(thumbUrl && /^https?:/i.test(thumbUrl)){
    try{
      const img = await new Promise(function(resolve, reject){
        const el = new Image();
        el.crossOrigin = 'anonymous';
        el.onload = function(){ resolve(el); };
        el.onerror = function(){ reject(new Error('thumb')); };
        el.src = thumbUrl;
      });
      const scale = Math.max(1200 / img.width, 630 / img.height);
      const w = img.width * scale, h = img.height * scale;
      ctx.globalAlpha = 0.55;
      ctx.drawImage(img, (1200 - w) / 2, (630 - h) / 2, w, h);
      ctx.globalAlpha = 1;
      const fade = ctx.createLinearGradient(0, 280, 0, 630);
      fade.addColorStop(0, 'rgba(13,15,23,0)');
      fade.addColorStop(1, 'rgba(13,15,23,0.92)');
      ctx.fillStyle = fade;
      ctx.fillRect(0, 0, 1200, 630);
    }catch(_){}
  }
  ctx.fillStyle = '#7CFFB2';
  ctx.font = '600 28px sans-serif';
  ctx.fillText('NALUNO', 56, 80);
  ctx.fillStyle = '#E8ECF5';
  ctx.font = '700 64px sans-serif';
  const line = String(title || 'Broadcast').slice(0, 48);
  ctx.fillText(line, 56, 460);
  ctx.fillStyle = '#8A92A6';
  ctx.font = '400 32px sans-serif';
  ctx.fillText(creator ? ('by ' + String(creator).slice(0, 40)) : 'A Broadcast', 56, 520);
  const blob = await new Promise(function(resolve){ canvas.toBlob(resolve, 'image/jpeg', 0.86); });
  return blob && blob.size ? blob : null;
}

if($('bspaceShareBtn')){
  $('bspaceShareBtn').onclick = async ()=>{
    if(!activeBroadcastId) return;
    const title = (activeBroadcastMeta && activeBroadcastMeta.title) || 'Naluno Broadcast';
    const creator = (activeBroadcastMeta && activeBroadcastMeta.creatorName) || '';
    const link = typeof broadcastShareUrl === 'function'
      ? broadcastShareUrl(activeBroadcastId, title)
      : ('https://getnaluno.com/app/?broadcast=' + encodeURIComponent(activeBroadcastId));
    if(/workers\.dev/i.test(link)){
      toast('Share link was refused — it pointed at a worker');
      return;
    }
    const thumb = (activeBroadcastMeta && (activeBroadcastMeta.thumbUrl || (activeBroadcastMeta.segment && activeBroadcastMeta.segment.thumbDataUrl))) || '';
    let files;
    try{
      const card = await bspaceShareCard(title, creator, thumb);
      if(card) files = [new File([card], 'naluno-broadcast.jpg', { type: 'image/jpeg' })];
    }catch(_){}
    const text = title + (creator ? (' — ' + creator) : '') + '\n' + link;
    try{
      const withFile = files && navigator.canShare && navigator.canShare({ files: files });
      if(navigator.share){
        const payload = { title: title, text: text, url: link };
        if(withFile) payload.files = files;
        await navigator.share(payload);
      } else if(withFile && navigator.share){
        await navigator.share({ title: title, text: text, files: files });
      } else if(navigator.clipboard && navigator.clipboard.writeText){
        await navigator.clipboard.writeText(text);
        toast('Link copied');
      } else {
        toast(link);
      }
      try{
        if(typeof nalunoTrack === 'function'){
          nalunoTrack('BROADCAST_SHARE', {
            target_type: 'broadcast',
            target_id: activeBroadcastId,
            broadcast_id: activeBroadcastId,
            creator_uid: (activeBroadcastMeta && activeBroadcastMeta.creatorUid) || '',
          });
        }
      }catch(_){}
    }catch(e){
      if(e && e.name === 'AbortError') return;
      /* A phone that rejects the picture still gets the clean link. */
      try{
        if(navigator.share){
          await navigator.share({ title: title, text: text, url: link });
          return;
        }
      }catch(e2){
        if(e2 && e2.name === 'AbortError') return;
      }
      try{
        if(navigator.clipboard && navigator.clipboard.writeText){
          await navigator.clipboard.writeText(text);
          toast('Link copied');
          return;
        }
      }catch(_){}
      toast(link);
    }
  };
}
if($('bspaceDeleteBtn')){
  $('bspaceDeleteBtn').onclick = async ()=>{
    if(!activeBroadcastId || !(activeBroadcastMeta && activeBroadcastMeta.isMine)) return;
    if(!confirm('Delete this Broadcast? The community space will be closed.')) return;
    try{
      await deletePermanentBroadcast(activeBroadcastId);
      closeBroadcastSpace();
      if(typeof loadFeedBroadcasts === 'function') await loadFeedBroadcasts();
      toast('Broadcast deleted');
    }catch(e){ toast(e.message || 'Couldn’t delete'); }
  };
}
if($('bspaceAdvertiseBtn')){
  $('bspaceAdvertiseBtn').onclick = function(e){
    try{ if(e) e.stopPropagation(); }catch(_){}
    if(!activeBroadcastId || !activeBroadcastMeta) return;
    const mine = !!(activeBroadcastMeta.isMine || (currentUser && activeBroadcastMeta.creatorUid === currentUser.uid));
    if(!mine){ toast('Only the creator can advertise this'); return; }
    if(window.NalunoAds && typeof window.NalunoAds.openFromBroadcast === 'function'){
      window.NalunoAds.openFromBroadcast(activeBroadcastMeta, activeBroadcastId);
    } else toast('Ads are not available right now');
  };
}

/* Share, Save, Report, Delete and Go live live in this menu. The top bar
   was a row of pills that wrapped over the picture, especially while live. */
(function wireBspaceMore(){
  const btn = $('bspaceMoreBtn');
  const menu = $('bspaceMoreMenu');
  if(!btn || !menu || btn.__wired) return;
  btn.__wired = true;
  function shut(){
    menu.setAttribute('hidden', '');
    btn.setAttribute('aria-expanded', 'false');
  }
  btn.onclick = function(e){
    if(e){ e.preventDefault(); e.stopPropagation(); }
    const opening = menu.hasAttribute('hidden');
    if(opening){
      menu.removeAttribute('hidden');
      btn.setAttribute('aria-expanded', 'true');
    } else shut();
  };
  menu.addEventListener('click', function(){ shut(); });
  document.addEventListener('click', function(e){
    if(menu.hasAttribute('hidden')) return;
    if(btn.contains(e.target) || menu.contains(e.target)) return;
    shut();
  });
})();


/* ---- Chapter player + breather / ad-slot architecture ---- */
let bspaceChapterIndex = 0;
let bspaceChapterList = [];
let bspaceBreatherList = [];
let bspaceBreatherTimer = null;


function formatBspaceTime(sec){
  sec = Math.max(0, Math.floor(sec || 0));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m + ':' + String(s).padStart(2, '0');
}

/** Autoplay + always-visible seek scrubber (native controls often clipped by cover frame). */
function wireBspaceSeekAndAutoplay(v){
  if(!v) return;
  const range = $('bspaceSeekRange');
  const curEl = $('bspaceTimeCur');
  const durEl = $('bspaceTimeDur');
  const playBtn = $('bspacePlayBtn');
  let scrubbing = false;

  function syncPlayBtn(){
    if(playBtn) playBtn.textContent = v.paused ? '▶' : '❚❚';
  }
  function syncTimes(){
    const d = v.duration;
    if(durEl){
      const trueD = (typeof nalunoTrueDuration === 'function') ? nalunoTrueDuration(v) : d;
      durEl.textContent = (isFinite(trueD) && trueD > 0) ? formatBspaceTime(trueD) : '0:00';
    }
    if(curEl) curEl.textContent = formatBspaceTime(v.currentTime);
    if(range){
      const trueD = (typeof nalunoTrueDuration === 'function') ? nalunoTrueDuration(v) : d;
      if(isFinite(trueD) && trueD > 0 && !scrubbing){
        range.value = String(Math.round((v.currentTime / trueD) * 1000));
      }
    }
  }

  if(range){
    const seekTo = ()=>{
      const d = (typeof nalunoTrueDuration === 'function') ? nalunoTrueDuration(v) : v.duration;
      if(!isFinite(d) || d <= 0) return;
      const t = (parseInt(range.value, 10) / 1000) * d;
      try{ v.currentTime = t; }catch(_){}
      syncTimes();
    };
    range.addEventListener('input', ()=>{ scrubbing = true; seekTo(); });
    range.addEventListener('change', ()=>{ scrubbing = false; seekTo(); });
    range.addEventListener('touchstart', ()=>{ scrubbing = true; }, { passive: true });
    range.addEventListener('touchend', ()=>{ scrubbing = false; seekTo(); }, { passive: true });
  }
  if(playBtn){
    playBtn.onclick = ()=>{
      if(v.paused){
        try{ v.dataset.nalunoWantPlay = '1'; v.dataset.nalunoKeepAlive = '1'; v.dataset.nalunoUserPaused = '0'; }catch(_){}
        const p = v.play();
        if(p && p.catch) p.catch(()=>{});
      } else {
        try{ v.dataset.nalunoUserPaused = '1'; v.dataset.nalunoWantPlay = '0'; }catch(_){}
        v.pause();
      }
      syncPlayBtn();
    };
  }

  v.addEventListener('timeupdate', syncTimes);
  v.addEventListener('loadedmetadata', syncTimes);
  v.addEventListener('durationchange', syncTimes);
  v.addEventListener('play', syncPlayBtn);
  v.addEventListener('pause', syncPlayBtn);
  v.addEventListener('ended', syncPlayBtn);

  // Autoplay: try unmuted first; if blocked, muted autoplay then unmute on first tap
  v.playsInline = true;
  v.setAttribute('playsinline', '');
  v.setAttribute('webkit-playsinline', '');
  const tryPlay = ()=>{
    const p = v.play();
    if(p && p.catch){
      p.catch(()=>{
        try{
          v.muted = true;
          v.play().then(()=>{
            // Keep muted until user taps play — still starts content
            syncPlayBtn();
          }).catch(()=>{});
        }catch(_){}
      });
    }
  };
  if(v.readyState >= 2) tryPlay();
  else v.addEventListener('loadeddata', tryPlay, { once: true });
  // Second chance after src bind settles
  setTimeout(tryPlay, 400);
  v.addEventListener('ended', function(){
    if(typeof nalunoResumeIfTruncated === 'function'){
      const recovered = nalunoResumeIfTruncated(v, function(){ syncPlayBtn(); });
      if(recovered) return;
    }
    const d = (typeof nalunoTrueDuration === 'function') ? nalunoTrueDuration(v) : v.duration;
    const t = v.currentTime || 0;
    if(isFinite(d) && t < (d || 0) - 0.45){
      try{ v.preload = 'auto'; v.currentTime = Math.max(0, t + 0.001); }catch(_){}
      v.play().catch(function(){});
      return;
    }
    // True end of content → strand next / nearby / restart
    if(typeof bspaceOnPlaybackEnded === 'function') bspaceOnPlaybackEnded();
  });
  syncPlayBtn();
  syncTimes();
}

/** After a Broadcast finishes: next episode in the same Strand (upload order),
 *  else a nearby Broadcast from someone else, else back to the titles list —
 *  never loop/restart the same clip, and never leave a "LIVE"-style badge or
 *  a frozen last frame with nothing for the person to do. */
function bspaceOnPlaybackEnded(){
  try{
    if(bspaceOnPlaybackEnded._lock && (Date.now() - bspaceOnPlaybackEnded._lock) < 2800) return;
    bspaceOnPlaybackEnded._lock = Date.now();
  }catch(_){}
  try{ if(window.__bspaceNextTimer){ clearTimeout(window.__bspaceNextTimer); window.__bspaceNextTimer = null; } }catch(_){}
  const meta = activeBroadcastMeta || {};
  const curId = activeBroadcastId;
  function backToTitles(){
    // FIX: idle end-of-content used to restart/loop the same clip. The person
    // asked for this instead: return to the screen where every title lives.
    try{ toast('That\u2019s everything here — back to Broadcasts'); }catch(_){}
    if(typeof closeBroadcastSpace === 'function') closeBroadcastSpace();
  }
  function scheduleOpen(id, label, delayMs){
    if(!id || id === curId) return false;
    try{
      toast((label || 'Next') + ' in a moment…');
    }catch(_){}
    window.__bspaceNextTimer = setTimeout(function(){
      window.__bspaceNextTimer = null;
      if(activeBroadcastId !== curId) return; // user navigated away
      if(typeof openBroadcastById === 'function') openBroadcastById(id);
    }, delayMs || 4500);
    return true;
  }
  // 1) Next episode in this Strand, in upload order.
  // 1) Next episode in this Strand, in upload order.
  // FIX: relatedBroadcasts() deliberately EXCLUDES the current item from its
  // results (correct for its original job — an "other items in this Strand"
  // display list) — which means searching that list for curId's index could
  // never find it, so this could never actually advance to the next episode
  // at all. Sequencing needs curId present in the list to find its position,
  // so this builds that list directly instead of reusing relatedBroadcasts().
  const tryStrand = function(){
    if(!meta.strandId) return false;
    const pool = [];
    try{
      if(typeof feedBroadcasts !== 'undefined' && feedBroadcasts) pool.push.apply(pool, feedBroadcasts);
      if(typeof myBroadcasts !== 'undefined' && myBroadcasts) pool.push.apply(pool, myBroadcasts);
    }catch(_){}
    const seen = {};
    const siblings = pool.filter(function(x){
      if(!x || x.deleted || x.strandId !== meta.strandId || seen[x.id]) return false;
      seen[x.id] = true;
      return true;
    }).sort(function(a,b){ return (Number(a.createdAt)||0) - (Number(b.createdAt)||0); });
    let idx = -1;
    for(let i = 0; i < siblings.length; i++){
      if(siblings[i].id === curId){ idx = i; break; }
    }
    // Only ever move FORWARD in upload order. If this was already the last
    // episode (or curId isn't found), there is no "next" — fall to nearby.
    if(idx < 0 || idx + 1 >= siblings.length) return false;
    const next = siblings[idx + 1];
    return scheduleOpen(next.id, 'Next in ' + (meta.strandName || 'Strand') + ' · ' + (next.title || 'Broadcast'), 4500);
  };
  // 2) Strand finished (or no Strand) → a nearby Broadcast from someone else.
  const tryNearby = function(){
    const pool = (typeof feedBroadcasts !== 'undefined' && feedBroadcasts) ? feedBroadcasts : [];
    const candidates = pool.filter(function(x){
      return x && !x.deleted && x.id !== curId && (!meta.strandId || x.strandId !== meta.strandId);
    });
    if(!candidates.length) return false;
    // Prefer something live right now, then most recent.
    candidates.sort(function(a,b){
      if(!!b.live !== !!a.live) return (b.live?1:0) - (a.live?1:0);
      return (Number(b.createdAt)||0) - (Number(a.createdAt)||0);
    });
    const next = candidates[0];
    return scheduleOpen(next.id, 'Up next · ' + (next.title || 'Broadcast'), 4500);
  };
  const did = tryStrand();
  if(!did){
    if(!tryNearby()){
      // 3) Nothing left to suggest → the titles list, not a restart/loop.
      backToTitles();
    }
  }
}
window.bspaceOnPlaybackEnded = bspaceOnPlaybackEnded;

function wireBroadcastChapterPlayer(chapters, breathers, opts){
  opts = opts || {};
  bspaceChapterList = Array.isArray(chapters) ? chapters.slice().sort((a,b)=>(a.index||0)-(b.index||0)) : [];
  bspaceBreatherList = Array.isArray(breathers) ? breathers : [];
  bspaceChapterIndex = 0;
  const v = $('bspaceVideoEl');
  if(!v) return;
  // Resolve src for first chapter only if the element is not already on that file
  if(bspaceChapterList[0] && bspaceChapterList[0].mediaUrl){
    const u = (typeof resolveMediaUrl === 'function') ? resolveMediaUrl(bspaceChapterList[0].mediaUrl) : bspaceChapterList[0].mediaUrl;
    const have = (v.currentSrc || v.getAttribute('src') || '').split('?')[0];
    if(!have || (u && have.indexOf(u.split('?')[0]) < 0)){
      v.src = u;
    }
  }

  const bar = $('bspaceChapterBar');
  if(bar && opts.showChips && bspaceChapterList.length > 1){
    const canCut = !!(activeBroadcastMeta && activeBroadcastMeta.isMine);
    const shared = bspaceChapterList.length > 1 && bspaceChapterList.every(c => c.mediaUrl === bspaceChapterList[0].mediaUrl);
    bar.innerHTML = bspaceChapterList.map(function(ch,i){
      const gone = ch.status === 'removed' && !ch.replacementUrl;
      const replaced = !!(ch.replacementUrl || ch.status === 'replaced');
      const label = gone ? (canCut ? 'Ad · Replace' : 'Ad')
        : ((ch.title || ('Ch '+(i+1))) + (replaced ? ' · new' : ''));
      return `<span style="display:inline-flex;align-items:center;gap:4px;">
        <button type="button" data-ch="${i}" style="font-family:var(--font-mono);font-size:10px;padding:4px 8px;border-radius:999px;border:1px solid ${gone?'rgba(255,84,112,.5)':'var(--line)'};background:${gone?'rgba(255,84,112,.16)':(i===0?'rgba(124,255,178,.15)':'transparent')};color:${gone?'#ff8a9a':(i===0?'var(--mint)':'var(--text-dim)')};cursor:pointer;">${bspaceEscape(label)}</button>
        ${canCut && gone ? '<span class="naluno-pick-wrap" style="position:relative;display:inline-flex;overflow:hidden;"><button type="button" style="pointer-events:none;font-family:var(--font-mono);font-size:10px;padding:3px 7px;border-radius:999px;border:1px solid var(--line);background:transparent;color:var(--mint);">Replace</button><input type="file" accept="'+(typeof VIDEO_PICK_ACCEPT==='string'?VIDEO_PICK_ACCEPT:'video/*')+'" data-repch="'+i+'" style="position:absolute;inset:0;width:100%;height:100%;opacity:0.01;font-size:16px;cursor:pointer;z-index:2;"></span>' : ''}
        ${canCut && !gone ? '<button type="button" data-delch="'+i+'" aria-label="Remove chapter" style="border:none;background:transparent;color:var(--text-dim);font-size:14px;cursor:pointer;line-height:1;">×</button>' : ''}
      </span>`;
    }).join('');
    bar.querySelectorAll('[data-ch]').forEach(btn=>{
      btn.onclick = ()=> playBroadcastChapter(parseInt(btn.getAttribute('data-ch'),10), true);
    });
    bar.querySelectorAll('[data-delch]').forEach(btn=>{
      btn.onclick = function(e){
        e.preventDefault(); e.stopPropagation();
        deleteBroadcastChapter(parseInt(btn.getAttribute('data-delch'),10));
      };
    });
    bar.querySelectorAll('input[data-repch]').forEach(inp=>{
      inp.onchange = function(){
        const file = inp.files && inp.files[0];
        const idx = parseInt(inp.getAttribute('data-repch'),10);
        try{ inp.value = ''; }catch(_){}
        if(file) replaceBroadcastChapterWithFile(idx, file);
      };
    });
  }

  // Single-file mid-rolls (atSec on breathers)
  v.ontimeupdate = ()=>{
    if(bspaceChapterList.length > 1) return;
    const marks = bspaceBreatherList.filter(b => typeof b.atSec === 'number');
    if(!marks.length) return;
    const t = v.currentTime || 0;
    marks.forEach(m=>{
      if(m._fired) return;
      if(t >= m.atSec && t < m.atSec + 1.5){
        m._fired = true;
        showBreatherAdSlot(m, ()=>{});
      }
    });
  };

  v.onended = ()=>{
    const d = v.duration;
    const t = v.currentTime || 0;
    const falseEnd = (typeof nalunoFiniteDuration === 'function')
      ? (!nalunoFiniteDuration(d) || t < d - 0.45)
      : (!isFinite(d) || d === Infinity || t < (d || 0) - 0.45);
    if(falseEnd){
      try{ v.preload = 'auto'; v.currentTime = Math.max(0, t + 0.001); }catch(_){}
      v.play().catch(function(){});
      return;
    }
    const shared = bspaceChapterList.length > 1 && bspaceChapterList.every(c => c.mediaUrl === bspaceChapterList[0].mediaUrl);
    if(shared){
      // Single shared file finished → strand next / restart
      if(typeof bspaceOnPlaybackEnded === 'function') bspaceOnPlaybackEnded();
      return;
    }
    if(bspaceChapterList.length <= 1){
      if(typeof bspaceOnPlaybackEnded === 'function') bspaceOnPlaybackEnded();
      return;
    }
    const next = bspaceChapterIndex + 1;
    if(next >= bspaceChapterList.length){
      if(typeof bspaceOnPlaybackEnded === 'function') bspaceOnPlaybackEnded();
      return;
    }
    playBroadcastChapter(next, false);
  };
}

function playBroadcastChapter(index, userInitiated){
  const ch = bspaceChapterList[index];
  if(!ch) return;
  if(typeof chapterIsActive === 'function' && !chapterIsActive(ch)){
    const nxt = (typeof nextActiveChapterIndex === 'function') ? nextActiveChapterIndex(bspaceChapterList, index - 1) : -1;
    if(nxt >= 0){
      showChapterAdBucket(index, function(){ playBroadcastChapter(nxt, false); });
    } else {
      showChapterAdBucket(index, function(){});
    }
    return;
  }
  if(ch.replacementUrl){
    bspaceChapterIndex = index;
    const v = $('bspaceVideoEl');
    if(!v) return;
    const url = (typeof resolveMediaUrl === 'function') ? resolveMediaUrl(ch.replacementUrl) : ch.replacementUrl;
    try{ v.pause(); }catch(_){}
    v.src = url;
    const kick = function(){
      const p = v.play();
      if(p && p.catch) p.catch(function(){ try{ v.muted = true; v.play().catch(function(){}); }catch(_){} });
    };
    if(v.readyState >= 2) kick();
    else v.addEventListener('loadeddata', kick, { once: true });
    v.onended = function(){
      const nxt = (typeof nextActiveChapterIndex === 'function') ? nextActiveChapterIndex(bspaceChapterList, index) : index + 1;
      if(nxt >= 0) playBroadcastChapter(nxt, false);
      else if(typeof bspaceOnPlaybackEnded === 'function') bspaceOnPlaybackEnded();
    };
    return;
  }
  if(!ch.mediaUrl) return;
  bspaceChapterIndex = index;
  const v = $('bspaceVideoEl');
  if(!v) return;
  const url = (typeof resolveMediaUrl === 'function') ? resolveMediaUrl(ch.mediaUrl) : ch.mediaUrl;
  const shared = !!ch.sharedSource || (bspaceChapterList.length > 1 && bspaceChapterList.every(c => c.mediaUrl === ch.mediaUrl));

  if(shared){
    // One file: play continuously. Seek ONLY when the person taps a chapter chip.
    // Auto-seeking at each 4-min mark is what made later chapters drag/stutter.
    const startAt = typeof ch.start === 'number' ? ch.start : 0;
    const fileKey = (url.split('?')[0].split('/').pop() || '');
    const alreadyOnFile = !!(fileKey && String(v.currentSrc || v.src).indexOf(fileKey) >= 0);
    const kickPlay = function(doSeek){
      if(doSeek && startAt >= 0){
        const onSeeked = function(){
          v.removeEventListener('seeked', onSeeked);
          const p = v.play();
          if(p && p.catch) p.catch(function(){ try{ v.muted = true; v.play().catch(function(){}); }catch(_){} });
        };
        v.addEventListener('seeked', onSeeked);
        try{ v.currentTime = startAt; }catch(_){ onSeeked(); }
      } else {
        const p = v.play();
        if(p && p.catch) p.catch(function(){ try{ v.muted = true; v.play().catch(function(){}); }catch(_){} });
      }
    };
    if(!alreadyOnFile){
      v.src = url;
      if(typeof nalunoMediaIdFromUrl === 'function'){
        const mid = nalunoMediaIdFromUrl(url);
        if(mid) v.dataset.mediaId = mid;
      }
      v.onloadedmetadata = function(){ kickPlay(!!userInitiated && startAt > 0.4); };
    } else {
      kickPlay(!!userInitiated);
    }
    v.ontimeupdate = function(){
      const t = v.currentTime || 0;
      let idx = 0;
      for(let i = 0; i < bspaceChapterList.length; i++){
        const c = bspaceChapterList[i];
        if(typeof c.start === 'number' && t >= c.start - 0.05) idx = i;
      }
      const here = bspaceChapterList[idx];
      if(here && here.status === 'removed' && !here.replacementUrl && typeof here.end === 'number'){
        if(t >= here.start && t < here.end - 0.05){
          if(v._nalunoSkipHole) return;
          v._nalunoSkipHole = true;
          const nxt = (typeof nextActiveChapterIndex === 'function') ? nextActiveChapterIndex(bspaceChapterList, idx) : -1;
          showChapterAdBucket(idx, function(){
            v._nalunoSkipHole = false;
            if(nxt >= 0 && typeof bspaceChapterList[nxt].start === 'number'){
              try{ v.currentTime = bspaceChapterList[nxt].start; }catch(_){}
              v.play().catch(function(){});
            } else {
              try{ v.pause(); }catch(_){}
            }
          });
          return;
        }
      }
      if(here && here.replacementUrl && t >= (here.start||0) && t < (here.end || t + 1) && !v._nalunoReplace){
        v._nalunoReplace = true;
        playBroadcastChapter(idx, false);
        return;
      }
      if(idx !== bspaceChapterIndex){
        bspaceChapterIndex = idx;
        const bar = $('bspaceChapterBar');
        if(bar){
          bar.querySelectorAll('[data-ch]').forEach(btn=>{
            const on = parseInt(btn.getAttribute('data-ch'),10) === idx;
            btn.style.background = on ? 'rgba(124,255,178,.15)' : 'transparent';
            btn.style.color = on ? 'var(--mint)' : 'var(--text-dim)';
          });
        }
      }
    };
  } else {
    try{ v.pause(); }catch(_){}
    v.src = url;
    const kick = function(){
      const p = v.play();
      if(p && p.catch) p.catch(function(){
        try{ v.muted = true; v.play().then(function(){ /* content visible */ }).catch(function(){}); }catch(_){}
      });
    };
    if(v.readyState >= 2) kick();
    else v.addEventListener('loadeddata', kick, { once: true });
    setTimeout(kick, 300);
  }
  const bar = $('bspaceChapterBar');
  if(bar){
    bar.querySelectorAll('[data-ch]').forEach(btn=>{
      const on = parseInt(btn.getAttribute('data-ch'),10) === index;
      btn.style.background = on ? 'rgba(124,255,178,.15)' : 'transparent';
      btn.style.color = on ? 'var(--mint)' : 'var(--text-dim)';
    });
  }
  hideBreatherAdSlot();
}

function showBreatherAdSlot(breather, onDone){
  const el = $('bspaceBreather');
  if(!el){ if(onDone) onDone(); return; }
  try{
    const v = $('bspaceVideoEl');
    if(v){
      v.dataset.nalunoUserPaused = '1';
      v.dataset.nalunoWantPlay = '0';
      try{ v.pause(); }catch(_){}
    }
  }catch(_){}
  let ad = breather && breather.adSlot;
  if((!ad || ad.status !== 'ready') && typeof NalunoAds !== 'undefined' && NalunoAds.breatherSlot){
    try{ ad = NalunoAds.breatherSlot('broadcast-break'); }catch(_){}
    if(breather) breather.adSlot = ad;
  }
  el.style.display = 'flex';
  try{
    const kick = $('bspacePlayKick');
    if(kick){ kick.style.display = 'none'; kick.dataset.adHidden = '1'; }
  }catch(_){}
  const label = $('bspaceBreatherLabel');
  const adLine = $('bspaceBreatherAd');
  if(label) label.textContent = (ad && ad.status === 'ready') ? 'Ad' : ((breather && breather.label) || 'Chapter break');
  let finished = false;
  const finish = function(){
    if(finished) return;
    finished = true;
    try{
      const cv = $('bspaceVideoEl');
      if(cv){
        cv.muted = false;
        if(!cv.volume) cv.volume = 1;
      }
    }catch(_){}
    hideBreatherAdSlot();
    if(onDone) onDone();
    resumeBspaceAfterAd();
  };
  if(adLine){
    adLine.style.position = 'absolute';
    adLine.style.inset = '0';
    adLine.style.margin = '0';
    if(ad && ad.status === 'ready' && ad.creativeHtml){
      adLine.innerHTML = ad.creativeHtml;
      try{ if(typeof NalunoAds !== 'undefined' && NalunoAds.wireBreather) NalunoAds.wireBreather(adLine, ad, finish); }catch(_){}
    } else if(ad && ad.enabled){
      adLine.textContent = 'Next chapter…';
    } else {
      adLine.textContent = 'Next chapter…';
    }
  }
  if(bspaceBreatherTimer) clearTimeout(bspaceBreatherTimer);
  const skip = (ad && ad.status === 'ready') ? Math.max(0, Number(ad.skipAfterSec) || 5) : 0;
  let skipBtn = $('bspaceAdSkip');
  if(ad && ad.status === 'ready'){
    if(!skipBtn){
      skipBtn = document.createElement('button');
      skipBtn.type = 'button';
      skipBtn.id = 'bspaceAdSkip';
      skipBtn.style.cssText = 'position:absolute;left:16px;right:16px;bottom:28px;z-index:4;padding:14px 16px;border-radius:12px;border:1px solid rgba(124,255,178,.4);background:rgba(13,15,23,.78);color:#E8ECF5;font-size:13px;cursor:pointer;';
      el.appendChild(skipBtn);
    }
    skipBtn.style.display = 'inline-flex';
    skipBtn.disabled = skip > 0;
    skipBtn.textContent = skip > 0 ? ('Skip in ' + skip + 's') : 'Skip';
    let left = skip;
    skipBtn.onclick = function(){
      if(skipBtn.disabled) return;
      try{ if(typeof NalunoAds !== 'undefined' && NalunoAds.disarmViewComplete) NalunoAds.disarmViewComplete(); }catch(_){}
      try{ if(ad && ad.ad && typeof NalunoAds !== 'undefined') NalunoAds.track(ad.ad, 'skip'); }catch(_){}
      finish();
    };
    if(bspaceBreatherTimer){
      try{ clearTimeout(bspaceBreatherTimer); }catch(_){}
      try{ clearInterval(bspaceBreatherTimer); }catch(_){}
    }
    if(skip > 0){
      bspaceBreatherTimer = setInterval(function(){
        left -= 1;
        if(left <= 0){
          skipBtn.disabled = false;
          skipBtn.textContent = 'Skip';
          try{ clearInterval(bspaceBreatherTimer); }catch(_){}
          bspaceBreatherTimer = null;
        } else {
          skipBtn.textContent = 'Skip in ' + left + 's';
        }
      }, 1000);
    }
    return;
  }
  if(skipBtn) skipBtn.style.display = 'none';
  const wait = Math.max(400, Math.min((breather && breather.durationMs) || 1200, 2500));
  bspaceBreatherTimer = setTimeout(function(){
    hideBreatherAdSlot();
    if(onDone) onDone();
    else resumeBspaceAfterAd();
  }, wait);
}

function resumeBspaceAfterAd(){
  const v = $('bspaceVideoEl');
  if(!v) return;
  try{
    v.dataset.nalunoUserPaused = '0';
    v.dataset.nalunoWantPlay = '1';
    v.dataset.nalunoKeepAlive = '1';
    v.muted = false;
    if(!v.volume) v.volume = 1;
    const p = v.play();
    if(p && p.catch){
      p.catch(function(){
        try{ v.muted = false; v.volume = 1; v.play().catch(function(){}); }catch(_){}
      });
    }
  }catch(_){}
}

function hideBreatherAdSlot(){
  try{ if(typeof NalunoAds !== 'undefined' && NalunoAds.disarmViewComplete) NalunoAds.disarmViewComplete(); }catch(_){}
  const el = $('bspaceBreather');
  if(el){
    try{
      el.querySelectorAll('video, audio').forEach(function(v){
        try{
          v.dataset.nalunoUserPaused = '1';
          v.dataset.nalunoWantPlay = '0';
          v.pause();
          v.muted = true;
        }catch(_){}
      });
    }catch(_){}
    el.style.display = 'none';
  }
  try{
    const kick = $('bspacePlayKick');
    if(kick && kick.dataset.adHidden === '1'){
      kick.style.display = '';
      delete kick.dataset.adHidden;
    }
  }catch(_){}
  const skipBtn = $('bspaceAdSkip');
  if(skipBtn) skipBtn.style.display = 'none';
  if(bspaceBreatherTimer){
    try{ clearTimeout(bspaceBreatherTimer); }catch(_){}
    try{ clearInterval(bspaceBreatherTimer); }catch(_){}
    bspaceBreatherTimer = null;
  }
}


/* Broadcast video stage: respect uploaded aspect (portrait OR landscape).
   Live mesh stays 9:16 cover; recorded/uploaded video adapts to its real frame.
   User can toggle Fit (letterbox, full picture) vs Fill (crop to stage). */

/* Broadcast video stage.
   Naluno stage is 9:16 (phone). Fill uses the uploaded picture's aspect.
   Fit shows the whole picture inside the 9:16 stage (letterbox if needed).
   Rotated 9:16 camera files that report 1920×1080 stay portrait via poster. */

let bspaceFitMode = 'fill'; // default Fill so 9:16 clips fill the phone
let bspaceForceLandscape = false;

function nalunoDeviceWantsLandscape(){
  try{
    if(screen.orientation && screen.orientation.type && String(screen.orientation.type).indexOf('landscape') >= 0) return true;
    if(typeof window.orientation === 'number' && Math.abs(window.orientation) === 90) return true;
    if(window.innerWidth > window.innerHeight) return true;
  }catch(_){}
  return false;
}

function adaptBspaceHeroToVideo(){
  const hero = $('bspaceHero');
  const v = $('bspaceVideoEl');
  if(!hero || !v) return;
  hero.style.width = '100%';
  hero.style.background = '#000';

  const apply = function(){
    const poster = v.poster || v.getAttribute('poster') || '';
    const portrait = (typeof nalunoVideoLooksPortrait === 'function')
      ? nalunoVideoLooksPortrait(v, poster)
      : !(v.videoWidth > 0 && v.videoHeight > 0 && v.videoWidth > v.videoHeight);
    const w = v.videoWidth || 0;
    const h = v.videoHeight || 0;

    let orientLandscape = !!(bspaceForceLandscape || (typeof nalunoDeviceWantsLandscape === 'function' && nalunoDeviceWantsLandscape()));
    if(!orientLandscape){
      try{
        if(screen.orientation && screen.orientation.type){
          orientLandscape = String(screen.orientation.type).indexOf('landscape') >= 0;
        } else if(typeof window.orientation === 'number'){
          orientLandscape = Math.abs(window.orientation) === 90;
        } else {
          orientLandscape = window.innerWidth > window.innerHeight;
        }
      }catch(_){}
    }

    v.style.objectFit = bspaceFitMode === 'fill' ? 'cover' : 'contain';
    try{
      document.body.classList.toggle('naluno-fit-cover', bspaceFitMode === 'fill');
      document.body.classList.toggle('naluno-fit-contain', bspaceFitMode !== 'fill');
    }catch(_){}

    if(bspaceForceLandscape || orientLandscape){
      hero.style.aspectRatio = 'auto';
      hero.style.width = '100%';
      hero.style.height = '100dvh';
      hero.style.maxHeight = '100dvh';
      hero.style.borderRadius = '0';
      try{
        document.body.classList.add('naluno-landscape-media');
        const app = document.querySelector('.app');
        if(app) app.classList.add('naluno-landscape-media');
        try{ if(typeof nalunoBspaceShowChrome === 'function') nalunoBspaceShowChrome(); }catch(_){}
      }catch(_){}
    } else if(!portrait && w > 0 && h > 0){
      hero.style.aspectRatio = w + ' / ' + h;
      hero.style.maxHeight = 'min(56vh, 420px)';
      hero.style.height = '';
      hero.style.borderRadius = '';
    } else {
      hero.style.aspectRatio = '9 / 16';
      hero.style.maxHeight = 'min(82vh, 780px)';
      hero.style.height = '';
      hero.style.borderRadius = '';
    }

    if(!bspaceForceLandscape && !orientLandscape){
      try{
        document.body.classList.remove('naluno-landscape-media', 'naluno-bspace-land-css');
        const app = document.querySelector('.app');
        if(app) app.classList.remove('naluno-landscape-media');
      }catch(_){}
    }

    v.style.width = '100%';
    v.style.height = '100%';
    v.style.maxHeight = 'none';
    v.style.background = '#000';
  };

  apply();
  v.addEventListener('loadedmetadata', apply);
  v.addEventListener('loadeddata', apply);
  v.addEventListener('playing', apply);

  try{
    let chip = $('bspaceFitToggle');
    if(!chip && hero){
      chip = document.createElement('button');
      chip.type = 'button';
      chip.id = 'bspaceFitToggle';
      chip.className = 'bspace-mini';
      chip.style.cssText = 'position:absolute;right:12px;bottom:12px;z-index:6;font-size:11px;';
      chip.onclick = function(e){
        e.preventDefault();
        e.stopPropagation();
        bspaceFitMode = bspaceFitMode === 'fill' ? 'fit' : 'fill';
        chip.textContent = bspaceFitMode === 'fill' ? 'Fit' : 'Fill';
        apply();
      };
      hero.appendChild(chip);
    }
    if(chip){
      chip.textContent = bspaceFitMode === 'fill' ? 'Fit' : 'Fill';
      chip.title = 'Fill covers the stage. Fit shows the whole picture.';
    }
    let orient = $('bspaceOrientToggle');
    if(!orient && hero){
      orient = document.createElement('button');
      orient.type = 'button';
      orient.id = 'bspaceOrientToggle';
      orient.className = 'bspace-mini';
      orient.style.cssText = 'position:absolute;right:12px;bottom:52px;z-index:8;font-size:11px;';
      orient.textContent = 'Fill screen';
      orient.onclick = function(e){
        e.preventDefault();
        e.stopPropagation();
        bspaceForceLandscape = !bspaceForceLandscape;
        if(!bspaceForceLandscape){
          try{ if(typeof nalunoNativeUnlockOrientation === 'function') nalunoNativeUnlockOrientation(); }catch(_){}
          document.body.classList.remove('naluno-landscape-media', 'naluno-bspace-land-css');
          const app = document.querySelector('.app');
          if(app) app.classList.remove('naluno-landscape-media');
          orient.classList.remove('primary');
        } else {
          document.body.classList.add('naluno-landscape-media');
          const app = document.querySelector('.app');
          if(app) app.classList.add('naluno-landscape-media');
          orient.classList.add('primary');
          if(typeof nalunoNativeLockLandscape === 'function'){
            nalunoNativeLockLandscape().then(function(){ try{ adaptBspaceHeroToVideo(); }catch(_){} });
          }
        }
        try{ adaptBspaceHeroToVideo(); }catch(_){}
      };
      hero.appendChild(orient);
    }
    if(orient){
      orient.textContent = 'Fill screen';
      orient.title = 'Use the whole phone screen';
      orient.classList.toggle('primary', !!bspaceForceLandscape);
    }
  }catch(_){}

  try{
    if(!window.__bspaceOrientBound){
      window.__bspaceOrientBound = true;
      const re = function(){
        try{
          if($('bspace') && $('bspace').classList.contains('active') && nalunoDeviceWantsLandscape()){
            bspaceForceLandscape = true;
          }
        }catch(_){}
        try{ adaptBspaceHeroToVideo(); }catch(_){}
      };
      window.addEventListener('orientationchange', re);
      window.addEventListener('resize', re);
      if(screen.orientation && screen.orientation.addEventListener){
        screen.orientation.addEventListener('change', re);
      }
    }
  }catch(_){}
}

function nalunoStrandSiblingsFor(id){
  const lists = [];
  try{ if(typeof feedBroadcasts !== 'undefined' && feedBroadcasts) lists.push(feedBroadcasts); }catch(_){}
  try{ if(typeof myBroadcasts !== 'undefined' && myBroadcasts) lists.push(myBroadcasts); }catch(_){}
  const pool = [];
  const seen = {};
  lists.forEach(function(arr){
    (arr || []).forEach(function(b){
      if(!b || !b.id || b.deleted || seen[b.id]) return;
      seen[b.id] = true;
      pool.push(b);
    });
  });
  const cur = pool.find(function(b){ return b.id === id; });
  let sid = cur && cur.strandId;
  if(!sid && typeof getOpenStrandFolderId === 'function') sid = getOpenStrandFolderId();
  if(!sid) return { items: cur ? [cur] : [], index: 0 };
  const items = pool.filter(function(b){ return b.strandId === sid; })
    .sort(function(a,b){ return (Number(a.createdAt)||0) - (Number(b.createdAt)||0); });
  const index = items.findIndex(function(b){ return b.id === id; });
  return { items: items, index: index };
}

function nalunoBspaceStep(dir){
  try{
    const v = document.getElementById('bspaceVideoEl');
    if(v){
      v.dataset.nalunoUserPaused = '1';
      v.dataset.nalunoWantPlay = '0';
      delete v.dataset.nalunoKeepAlive;
      try{ v.muted = true; v.volume = 0; }catch(_){}
      try{ v.pause(); }catch(_){}
    }
  }catch(_){}
  try{ if(typeof nalunoPauseLeavingMedia === 'function') nalunoPauseLeavingMedia(); }catch(_){}
  const id = activeBroadcastId;
  if(!id){
    try{ closeBroadcastSpace(); }catch(_){}
    return;
  }
  const pack = nalunoStrandSiblingsFor(id);
  if(dir < 0){
    if(pack.index > 0 && pack.items[pack.index - 1] && typeof openBroadcastById === 'function'){
      openBroadcastById(pack.items[pack.index - 1].id);
    } else {
      closeBroadcastSpace();
    }
    return;
  }
  if(pack.index >= 0 && pack.index < pack.items.length - 1 && typeof openBroadcastById === 'function'){
    openBroadcastById(pack.items[pack.index + 1].id);
  }
}
window.nalunoBspaceStep = nalunoBspaceStep;

(function bindBspaceChromeIdle(){
  const root = document.getElementById('bspace');
  if(!root || root.__nalunoChromeBound) return;
  root.__nalunoChromeBound = true;
  let hideTimer = null;
  function showChrome(){
    try{ document.body.classList.remove('naluno-bspace-idle'); }catch(_){}
    if(hideTimer) clearTimeout(hideTimer);
    hideTimer = setTimeout(function(){
      hideTimer = null;
      try{
        if(!document.body.classList.contains('naluno-landscape-media')) return;
        const v = document.getElementById('bspaceVideoEl');
        if(v && v.paused) return;
        document.body.classList.add('naluno-bspace-idle');
      }catch(_){}
    }, 2800);
  }
  root.addEventListener('pointerdown', showChrome);
  root.addEventListener('touchstart', showChrome, { passive: true });
  window.nalunoBspaceShowChrome = showChrome;
})();

(function bindBspaceSwipe(){
  const root = document.getElementById('bspaceHero') || document.getElementById('bspace');
  if(!root || root.__nalunoSwipeBound) return;
  root.__nalunoSwipeBound = true;
  let sx = 0, sy = 0, axis = '', on = false;
  function down(e){
    if(e.target && e.target.closest && e.target.closest('#bspaceSeekDock, #bspaceTabs, .bspace-tabs, .bspace-body, .bspace-panel, input, textarea, select, .nearby-strip, .bspace-mini, .back-btn')){
      on = false; return;
    }
    const t = (e.touches && e.touches[0]) || e;
    sx = t.clientX; sy = t.clientY; axis = ''; on = true;
  }
  function move(e){
    if(!on) return;
    const t = (e.touches && e.touches[0]) || e;
    const dx = t.clientX - sx, dy = t.clientY - sy;
    if(!axis){
      if(Math.abs(dx) < 14 && Math.abs(dy) < 14) return;
      axis = Math.abs(dx) > Math.abs(dy) * 1.2 ? 'x' : 'y';
    }
    if(axis === 'x' && e.cancelable){ try{ e.preventDefault(); }catch(_){} }
  }
  function up(e){
    if(!on) return;
    on = false;
    const t = (e.changedTouches && e.changedTouches[0]) || e;
    const dx = t.clientX - sx, dy = t.clientY - sy;
    const wasX = axis === 'x' || (axis === '' && Math.abs(dx) > Math.abs(dy) * 1.2);
    axis = '';
    if(!wasX || Math.abs(dx) < 56) return;
    if(dx < 0) nalunoBspaceStep(1);
    else nalunoBspaceStep(-1);
  }
  root.addEventListener('touchstart', down, { passive: true });
  root.addEventListener('touchmove', move, { passive: false });
  root.addEventListener('touchend', up, { passive: true });
})();

function showChapterAdBucket(index, onDone){
  const mine = !!(activeBroadcastMeta && activeBroadcastMeta.isMine);
  const breather = {
    durationMs: mine ? 2200 : 1400,
    label: mine ? 'Ad bucket' : 'Next',
    adSlot: { enabled: true, status: 'reserved' },
  };
  const el = $('bspaceBreather');
  const btn = $('bspaceReplaceChBtn');
  if(btn){
    btn.style.display = mine ? 'inline-flex' : 'none';
    btn.onclick = function(){ replaceBroadcastChapter(index); };
  }
  showBreatherAdSlot(breather, function(){
    if(btn) btn.style.display = 'none';
    if(onDone) onDone();
  });
}

async function persistBroadcastChapters(){
  if(!fbDb || !activeBroadcastId) return;
  await fbDb.collection('broadcasts').doc(activeBroadcastId).set({
    chapters: bspaceChapterList,
    updatedAt: Date.now(),
  }, { merge: true });
  if(activeBroadcastMeta) activeBroadcastMeta.chapters = bspaceChapterList;
}

async function deleteBroadcastChapter(index){
  if(!activeBroadcastMeta || !activeBroadcastMeta.isMine) return;
  if(!bspaceChapterList || index < 0 || index >= bspaceChapterList.length) return;
  const liveCount = bspaceChapterList.filter(function(ch){ return typeof chapterIsActive !== 'function' || chapterIsActive(ch); }).length;
  if(liveCount <= 1 && chapterIsActive(bspaceChapterList[index])){
    toast('Keep at least one chapter');
    return;
  }
  const ch = bspaceChapterList[index];
  ch.status = 'removed';
  ch.removedAt = Date.now();
  ch.replacementUrl = null;
  ch.adSlot = { enabled: true, status: 'reserved', kind: 'bucket' };
  try{
    await persistBroadcastChapters();
  }catch(e){
    toast('Could not update chapters');
    return;
  }
  toast('Chapter is now an ad bucket');
  const nxt = (typeof nextActiveChapterIndex === 'function') ? nextActiveChapterIndex(bspaceChapterList, index - 1) : -1;
  if(nxt >= 0) playBroadcastChapter(nxt, false);
  if(typeof wireBroadcastChapterPlayer === 'function'){
    wireBroadcastChapterPlayer(bspaceChapterList, bspaceBreatherList, { showChips: true });
  }
}

function replaceBroadcastChapter(index){
  if(!activeBroadcastMeta || !activeBroadcastMeta.isMine) return;
  if(!bspaceChapterList || !bspaceChapterList[index]) return;
  toast('Tap Replace on the chapter chip');
}
async function replaceBroadcastChapterWithFile(index, file){
  if(!activeBroadcastMeta || !activeBroadcastMeta.isMine) return;
  if(!bspaceChapterList || !bspaceChapterList[index] || !file) return;
  toast('Uploading replacement…');
  try{
    let url = '';
    if(typeof uploadBroadcastFile === 'function') url = await uploadBroadcastFile(file);
    else if(typeof uploadVideoToR2 === 'function') url = await uploadVideoToR2(file);
    if(!url) throw new Error('Upload failed');
    const ch = bspaceChapterList[index];
    ch.status = 'replaced';
    ch.replacementUrl = url;
    ch.replacedAt = Date.now();
    await persistBroadcastChapters();
    toast('Chapter replaced');
    playBroadcastChapter(index, true);
    wireBroadcastChapterPlayer(bspaceChapterList, bspaceBreatherList, { showChips: true });
  }catch(e){
    toast((e && e.message) || 'Replace failed');
  }
}

function bspaceShownAbout(desc){
  const d = String(desc || '').trim();
  if(!d || d === 'Live Broadcast') return '';
  if(d === 'Watch, join the conversation, and explore questions and resources.') return '';
  return d;
}
function bspaceFitArea(el){
  if(!el || el.tagName !== 'TEXTAREA') return;
  el.style.height = 'auto';
  el.style.height = Math.max(el.scrollHeight, 28) + 'px';
}
function bspaceRestorePageTitle(text){
  const cur = document.getElementById('bspaceTitle');
  if(!cur) return;
  const value = text != null ? text : ((cur.tagName === 'INPUT' || cur.tagName === 'TEXTAREA') ? cur.value : cur.textContent);
  if(cur.tagName !== 'H1'){
    const h = document.createElement('h1');
    h.className = 'bspace-title';
    h.id = 'bspaceTitle';
    h.textContent = value || '';
    cur.replaceWith(h);
  } else {
    if(text != null) cur.textContent = text;
    cur.style.display = '';
  }
}
function bspaceRestoreDesc(text){
  const cur = document.getElementById('bspaceDesc');
  if(!cur) return;
  const value = text != null ? text : (cur.tagName === 'TEXTAREA' ? cur.value : cur.textContent);
  if(cur.tagName !== 'P'){
    const p = document.createElement('p');
    p.className = 'bspace-desc';
    p.id = 'bspaceDesc';
    p.textContent = value || '';
    cur.replaceWith(p);
    const writing = document.getElementById('bspaceWriting');
    if(writing && writing.parentNode && p.parentNode === writing){
      if(writing.nextSibling) writing.parentNode.insertBefore(p, writing.nextSibling);
      else writing.parentNode.appendChild(p);
    }
    p.onclick = function(){ p.classList.toggle('open'); };
  } else {
    cur.textContent = value || '';
    cur.style.display = '';
  }
}
function bspaceEditTitleInline(){
  const cur = document.getElementById('bspaceTitle');
  if(!cur || cur.tagName === 'INPUT') return;
  const input = document.createElement('input');
  input.id = 'bspaceTitle';
  input.className = 'bspace-title bspace-inline-page';
  input.maxLength = 120;
  input.value = (activeBroadcastMeta && activeBroadcastMeta.title) || cur.textContent || '';
  cur.replaceWith(input);
}
function bspaceEditDescInline(){
  const cur = document.getElementById('bspaceDesc');
  if(!cur || cur.tagName === 'TEXTAREA') return;
  const ta = document.createElement('textarea');
  ta.id = 'bspaceDesc';
  ta.className = 'bspace-desc bspace-inline-desc';
  ta.maxLength = 2000;
  ta.rows = 2;
  ta.placeholder = 'What is this Broadcast about?';
  ta.value = (cur.textContent || '').trim();
  cur.replaceWith(ta);
  bspaceFitArea(ta);
  ta.addEventListener('input', function(){ bspaceFitArea(ta); });
}
function bspacePreviewCover(file){
  if(!file) return;
  bspacePendingCover = file;
  const url = URL.createObjectURL(file);
  const host = $('bspaceMedia');
  const hero = $('bspaceHero');
  if(hero){
    hero.classList.remove('is-read', 'is-plain');
    hero.classList.add('is-photo');
  }
  if(host){
    host.style.display = '';
    host.innerHTML = '<img class="bspace-cover" alt="" src="' + url + '" />';
  }
}
function bspaceBeginInlineWrite(){
  const box = $('bspaceWriting');
  if(!box) return;
  box.hidden = false;
  box.classList.add('is-editing');
  if(!box.querySelector('[data-write-body]')){
    box.innerHTML = '<article data-write-body="0"><h2 data-write-title="1" data-orig=""></h2><div class="bspace-read-clamp" data-clamp="0"></div></article>';
    bspaceWriteOrig = [''];
    bspaceWriteTitles = [''];
  }
  box.querySelectorAll('[data-write-body]').forEach(function(article){
    article.style.display = '';
    const head = article.querySelector('[data-write-title]');
    const clamp = article.querySelector('.bspace-read-clamp');
    const more = article.querySelector('[data-write-more]');
    const idx = Number(article.getAttribute('data-write-body')) || 0;
    if(more) more.style.display = 'none';
    if(head && head.tagName !== 'TEXTAREA'){
      const ta = document.createElement('textarea');
      ta.className = 'bspace-inline-title';
      ta.setAttribute('data-write-title', '1');
      ta.setAttribute('data-orig', (bspaceWriteTitles[idx] != null) ? bspaceWriteTitles[idx] : (head.getAttribute('data-orig') || ''));
      ta.value = (bspaceWriteTitles[idx] != null) ? bspaceWriteTitles[idx] : (head.textContent || '');
      ta.maxLength = 80;
      ta.rows = 1;
      ta.placeholder = 'Chapter';
      head.replaceWith(ta);
      bspaceFitArea(ta);
      ta.addEventListener('input', function(){ bspaceFitArea(ta); });
    }
    if(clamp && clamp.tagName !== 'TEXTAREA'){
      const ta = document.createElement('textarea');
      ta.className = 'bspace-inline-body bspace-read-clamp';
      ta.value = (bspaceWriteOrig[idx] != null) ? bspaceWriteOrig[idx] : (clamp.textContent || '');
      ta.maxLength = 20000;
      ta.rows = 6;
      ta.placeholder = 'Write here';
      clamp.replaceWith(ta);
      bspaceFitArea(ta);
      ta.addEventListener('input', function(){ bspaceFitArea(ta); });
    }
  });
  let bar = box.querySelector('.bspace-inline-actions');
  if(!bar){
    bar = document.createElement('div');
    bar.className = 'bspace-inline-actions';
    bar.innerHTML = '<button type="button" class="bspace-mini" id="bspacePhotoBtn">Change photo</button>'
      + '<input type="file" id="bspacePhotoInput" accept="image/jpeg,image/png,image/webp,image/*" hidden />'
      + '<button type="button" class="bspace-mini primary" id="bspaceInlineSave">Save</button>'
      + '<button type="button" class="bspace-mini" id="bspaceInlineCancel">Cancel</button>';
    box.appendChild(bar);
  }
  const photoBtn = bar.querySelector('#bspacePhotoBtn');
  const input = bar.querySelector('#bspacePhotoInput');
  const seg = activeBroadcastMeta && activeBroadcastMeta.segment;
  const hasPhoto = !!(bspacePendingCover || (seg && seg.thumbUrl));
  if(photoBtn) photoBtn.textContent = hasPhoto ? 'Change photo' : 'Add photo';
  if(photoBtn && input){
    photoBtn.onclick = function(){ input.click(); };
    input.onchange = function(){
      const file = input.files && input.files[0];
      if(!file) return;
      bspacePreviewCover(file);
      photoBtn.textContent = 'Change photo';
    };
  }
  const save = bar.querySelector('#bspaceInlineSave');
  const cancel = bar.querySelector('#bspaceInlineCancel');
  if(save) save.onclick = function(){ bspaceSaveEdit(); };
  if(cancel) cancel.onclick = function(){ bspacePendingCover = null; bspaceCloseEdit(); };
  bspaceEditTitleInline();
  bspaceEditDescInline();
  const descNow = document.getElementById('bspaceDesc');
  if(descNow && bar && descNow.parentNode !== box) box.insertBefore(descNow, bar);
  try{ box.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }catch(_){}
}
function bspaceCloseEdit(){
  const form = $('bspaceEdit');
  if(form) form.hidden = true;
  bspacePendingCover = null;
  const writingBox = $('bspaceWriting');
  const wasInline = !!(writingBox && writingBox.classList.contains('is-editing'));
  bspaceRestorePageTitle((activeBroadcastMeta && activeBroadcastMeta.title) || '');
  bspaceRestoreDesc(activeBroadcastMeta ? bspaceShownAbout(activeBroadcastMeta.description) : '');
  if(wasInline){
    writingBox.classList.remove('is-editing');
    if(activeBroadcastMeta && activeBroadcastMeta.segment){
      try{ renderBspaceMedia(activeBroadcastMeta.segment); }catch(_){}
    }
  }
}
function bspaceOpenEdit(){
  if(!activeBroadcastMeta || !activeBroadcastId) return;
  const isCreator = !!(activeBroadcastMeta.isMine || (currentUser && activeBroadcastMeta.creatorUid === currentUser.uid));
  if(!isCreator) return;
  const writing = activeBroadcastMeta.segment && activeBroadcastMeta.segment.type === 'writing';
  try{ if($('bspaceMoreMenu')) $('bspaceMoreMenu').hidden = true; }catch(_){}
  if(writing){
    const form = $('bspaceEdit');
    if(form) form.hidden = true;
    bspaceBeginInlineWrite();
    return;
  }
  const box = $('bspaceEdit');
  if(!box) return;
  const title = $('bspaceEditTitle');
  const about = $('bspaceEditAbout');
  if(title) title.value = activeBroadcastMeta.title || '';
  if(about) about.value = bspaceShownAbout(activeBroadcastMeta.description);
  const host = $('bspaceEditChapters');
  if(host) host.innerHTML = '';
  box.hidden = false;
  const shownTitle = $('bspaceTitle');
  const shownDesc = $('bspaceDesc');
  if(shownTitle) shownTitle.style.display = 'none';
  if(shownDesc) shownDesc.style.display = 'none';
}
async function bspaceSaveEdit(){
  if(!fbDb || !activeBroadcastId || !currentUser) return;
  const writing = activeBroadcastMeta && activeBroadcastMeta.segment && activeBroadcastMeta.segment.type === 'writing';
  const inline = !!(writing && $('bspaceWriting') && $('bspaceWriting').classList.contains('is-editing'));
  let title = '';
  let description = '';
  if(inline){
    const titleEl = document.getElementById('bspaceTitle');
    title = ((titleEl && (titleEl.value != null && titleEl.tagName !== 'H1' ? titleEl.value : titleEl.textContent)) || '').trim();
    const descEl = document.getElementById('bspaceDesc');
    description = ((descEl && (descEl.tagName === 'TEXTAREA' ? descEl.value : descEl.textContent)) || '').trim().slice(0, 2000);
  } else {
    title = (($('bspaceEditTitle') && $('bspaceEditTitle').value) || '').trim();
    description = (($('bspaceEditAbout') && $('bspaceEditAbout').value) || '').trim().slice(0, 2000);
  }
  if(!title){ toast('Add a title'); return; }
  const patch = {
    title: title.slice(0, 120),
    description: description,
    updatedAt: Date.now(),
    searchText: [title, description, (typeof currentProfile !== 'undefined' && currentProfile && currentProfile.name) || ''].join(' ').toLowerCase().slice(0, 6000),
  };
  if(writing){
    const chapters = [];
    const root = inline ? document.querySelectorAll('#bspaceWriting [data-write-body]') : document.querySelectorAll('#bspaceEditChapters .bspace-edit-ch');
    root.forEach(function(block, i){
      const textEl = inline ? block.querySelector('.bspace-inline-body, .bspace-read-clamp') : block.querySelector('[data-ch-text]');
      const titleEl = inline ? block.querySelector('[data-write-title]') : block.querySelector('[data-ch-title]');
      const text = ((textEl && (textEl.value != null ? textEl.value : textEl.textContent)) || '').trim();
      if(!text) return;
      if(window.NalunoPass && NalunoPass.looksLikeShell && NalunoPass.looksLikeShell(text)) return;
      const chTitle = ((titleEl && (titleEl.value != null ? titleEl.value : titleEl.textContent)) || '').trim().slice(0, 80) || ('Chapter ' + (i + 1));
      chapters.push({ index: chapters.length, title: chTitle, text: text.slice(0, 20000) });
    });
    if(!chapters.length){ toast('The writing is empty'); return; }
    const body = chapters.map(function(c){ return (c.title ? c.title + '\n' : '') + c.text; }).join('\n\n').slice(0, 80000);
    patch.chapters = chapters;
    patch.body = body;
    patch.words = body.split(/\s+/).filter(Boolean).length;
    patch.searchText = [title, description, body.slice(0, 4000)].join(' ').toLowerCase().slice(0, 8000);
    if(window.NalunoPass && typeof NalunoPass.textKey === 'function'){
      const key = NalunoPass.textKey(body);
      if(key) patch.textKey = key;
    }
    if(!(activeBroadcastMeta && activeBroadcastMeta.originCredit) && typeof broadcastWritingCredit === 'function'){
      try{
        const found = await broadcastWritingCredit(body);
        if(found) patch.originCredit = found;
      }catch(_){}
    }
  }
  const btn = inline ? $('bspaceInlineSave') : $('bspaceEditSave');
  if(btn) btn.disabled = true;
  try{
    if(inline && bspacePendingCover){
      toast('Uploading photo…');
      let coverUrl = '';
      if(typeof uploadPhotoToR2 === 'function') coverUrl = await uploadPhotoToR2(bspacePendingCover);
      else if(typeof uploadBroadcastFile === 'function') coverUrl = await uploadBroadcastFile(bspacePendingCover, null, (bspacePendingCover.type && bspacePendingCover.type.indexOf('image/') === 0) ? bspacePendingCover.type : 'image/jpeg');
      if(!coverUrl) throw new Error('Could not upload the photo');
      patch.thumbUrl = coverUrl;
      patch.mediaUrl = coverUrl;
    }
    await fbDb.collection('broadcasts').doc(activeBroadcastId).update(patch);
    activeBroadcastMeta.title = patch.title;
    activeBroadcastMeta.description = description;
    if(patch.thumbUrl){
      activeBroadcastMeta.thumbUrl = patch.thumbUrl;
      activeBroadcastMeta.mediaUrl = patch.mediaUrl;
      if(activeBroadcastMeta.segment) activeBroadcastMeta.segment.thumbUrl = patch.thumbUrl;
    }
    if(patch.chapters){
      activeBroadcastMeta.chapters = patch.chapters;
      activeBroadcastMeta.body = patch.body;
      if(activeBroadcastMeta.segment){
        activeBroadcastMeta.segment.chapters = patch.chapters;
        activeBroadcastMeta.segment.text = patch.body;
      }
    }
    if(patch.originCredit) activeBroadcastMeta.originCredit = patch.originCredit;
    bspacePendingCover = null;
    bspaceCloseEdit();
    toast('Saved');
  }catch(e){
    toast((e && e.message) || 'Could not save');
  }finally{
    if(btn) btn.disabled = false;
  }
}
if($('bspaceEditBtn')) $('bspaceEditBtn').onclick = function(){ bspaceOpenEdit(); };
if($('bspaceEditCancel')) $('bspaceEditCancel').onclick = function(){ bspaceCloseEdit(); };
if($('bspaceEditSave')) $('bspaceEditSave').onclick = function(){ bspaceSaveEdit(); };
