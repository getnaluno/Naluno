/* ============================================================
   MODULE: js/wireline.js
   Wireline DM, offline queue, voice notes, mood, emotion wheel
   OWNERSHIP: change this domain here only.
   Scripts share globals (intentional) so load order matches the old monolith.
   ============================================================ */
/* ---------------- WIRELINE (direct messages) ----------------
   A Wireline is a private channel between two frequencies — separate from Broadcast
   (public, one-to-many) and calls (live, synchronous). Threads persist via storage.
   'them' messages carry read (has the person using this app seen it).
   'me' messages carry status: 'sent' | 'delivered' | 'read' — driven by the recipient's
   signal strength, same way replies are: off-the-grid contacts never advance past 'sent'. */
let wirelineThreads = {}; // { [contactId]: [{ id, from, type:'text'|'voice', text?, dataUrl?, duration?, waveform?, ts, read?, status? }] }
let activeThreadContactId = null;
// Empty now — real threads load live from Firestore per-contact when opened (see
// openThread), and demo contacts that used to seed this no longer exist.
const wirelineSeed = {};

function dayStampKey(ts){
  const d = new Date(ts || Date.now());
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
}
function dayStampLabel(ts){
  const d = new Date(ts || Date.now());
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startMsg = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const dayMs = 86400000;
  if(startMsg === startToday) return 'Today';
  if(startMsg === startToday - dayMs) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday:'short', month:'short', day:'numeric', year: d.getFullYear() !== now.getFullYear() ? 'numeric' : undefined });
}
function formatClockTime(ts){
  const d = new Date(ts);
  let h = d.getHours(); const m = d.getMinutes();
  const ampm = h>=12 ? 'PM' : 'AM'; h = h%12 || 12;
  return h+':'+String(m).padStart(2,'0')+' '+ampm;
}

function renderWirelineList(){
  const rows = contacts.map(c=>{
    if(c.isReal){
      const preview = realThreadPreviews[c.firebaseUid];
      if(!preview){
        return { c, last:null, preview:'No messages yet — say hello', unread:false };
      }
      return {
        c,
        last: { ts: preview.ts },
        preview: (preview.fromMe ? 'You: ' : '') + preview.text,
        unread: preview.unread,
      };
    }
    const msgs = wirelineThreads[c.id] || [];
    const last = msgs[msgs.length-1];
    const lastText = last ? (
      last.type==='voice' ? '🎙 Voice note · '+formatDuration(last.duration||0) :
      last.type==='mood' ? '◐ '+((MOODS.find(x=>x.key===last.mood)||{}).label || 'A feeling') :
      last.type==='missed_call' ? ('📞 ' + missedCallLabelForViewer(last)) :
      last.text
    ) : '';
    const preview = last ? ((last.from==='me' ? 'You: ' : '') + lastText) : 'No messages yet — say hello';
    const unread = !!(last && last.from==='them' && !last.read);
    return { c, last, preview, unread };
  }).sort((a,b)=> (b.last?b.last.ts:0) - (a.last?a.last.ts:0));

  $('wirelineList').innerHTML = rows.map(r=>`
    <div class="contact-row" data-thread="${r.c.id}">
      <div class="avatar" style="width:46px;height:46px;font-size:15px;${contactAvatarStyleAttr(r.c)}position:relative;">${r.c.photo&&r.c.photo.dataUrl?'':r.c.initials}</div>
      <div class="contact-meta"><div class="contact-name">${r.c.name}</div><div class="contact-sub" style="${r.unread?'color:var(--text);font-weight:600;':''}">${escapeHtml(r.preview)}</div></div>
      <div style="display:flex; flex-direction:column; align-items:flex-end; gap:6px; flex-shrink:0;">
        <span class="bcast-time">${r.last ? timeAgo(r.last.ts) : ''}</span>
        ${r.unread ? '<span style="width:8px;height:8px;border-radius:50%;background:var(--mint);"></span>' : ''}
      </div>
    </div>
  `).join('');
  document.querySelectorAll('[data-thread]').forEach(el=>{
    el.onclick = ()=> openThread(parseInt(el.dataset.thread));
  });

  const hasUnread = rows.some(r=>r.unread);
  $('wirelineNavDot').style.display = hasUnread ? 'block' : 'none';
}

/* ---------------- REAL WIRELINE (Firestore-backed threads) ----------------
   threadId is the two participants' real uids, sorted and joined with "_" — deterministic,
   so both people land on the same thread doc without a lookup step. A single live listener
   covers the currently open thread; a second listener covers every real thread's preview
   (last message + unread state) for the Wireline list, using denormalized fields on the
   thread doc itself so the list never needs to open every thread just to show previews. */
function realThreadId(otherUid){ return [currentUser.uid, otherUid].sort().join('_'); }
let activeThreadUnsubscribe = null;
let threadsListUnsubscribe = null;
let realThreadPreviews = {}; // { [otherUid]: { text, ts, fromMe, unread } }

function startThreadsListListener(){
  if(!fbDb || !currentUser) return;
  if(threadsListUnsubscribe) threadsListUnsubscribe();
  threadsListUnsubscribe = fbDb.collection('threads')
    .where('participants', 'array-contains', currentUser.uid)
    .onSnapshot(snap=>{
      snap.forEach(doc=>{
        const d = doc.data();
        const otherUid = (d.participants||[]).find(u=>u!==currentUser.uid);
        if(!otherUid) return;
        realThreadPreviews[otherUid] = {
          text: d.lastMessageText || '',
          ts: d.lastMessageAt && d.lastMessageAt.toMillis ? d.lastMessageAt.toMillis() : Date.now(),
          fromMe: d.lastMessageFrom === currentUser.uid,
          unread: d.lastMessageFrom !== currentUser.uid && !(d.readBy||[]).includes(currentUser.uid),
        };
      });
      renderWirelineList();
    }, ()=>{ /* preview list just won't populate this session */ });
}

function openWirelineFromFrequencies(id){
  document.querySelectorAll('.navbtn').forEach(b=>b.classList.toggle('active', b.dataset.tab==='wireline'));
  document.querySelectorAll('.tabscreen').forEach(s=>s.classList.toggle('active', s.id==='tab-wireline'));
  openThread(id);
}

function updateThreadStatusLabel(){
  if(!activeThreadContactId) return;
  const c = contacts.find(x=>x.id===activeThreadContactId); if(!c) return;
  $('threadStatus').textContent = signalMeta[computeSignal(c).tier].label;
}
function openThread(contactId){
  const c = contacts.find(x=>x.id===contactId); if(!c) return;
  activeThreadContactId = contactId;
  applyContactAvatarToEl($('threadAvatar'), c);
  $('threadName').textContent = c.name;
  updateThreadStatusLabel();
  $('threadInput').value = '';
  updateComposerButtons();
  $('wirelineThread').classList.add('active');

  if(activeThreadUnsubscribe){ activeThreadUnsubscribe(); activeThreadUnsubscribe = null; }

  if(c.isReal && c.firebaseUid && fbDb && currentUser){
    wirelineThreads[contactId] = wirelineThreads[contactId] || [];
    renderThreadMessages();
    const tid = realThreadId(c.firebaseUid);
    const threadRef = fbDb.collection('threads').doc(tid);
    activeThreadUnsubscribe = threadRef.collection('messages').orderBy('ts','asc').onSnapshot(async snap=>{
      const mapped = await Promise.all(snap.docs.map(async d=>{
        const m = d.data();
        let text = m.text;
if(m.encrypted && m.ciphertext && m.iv){
          const cacheKey = d.id + ':' + (m.ciphertext || '').slice(0, 24);
          if(wirelineDecryptCache[cacheKey]){
            text = wirelineDecryptCache[cacheKey];
          } else {
            let pk = c.publicKey;
            if(!pk && fbDb && c.firebaseUid){
              try{
                const doc = await fbDb.collection('users').doc(c.firebaseUid).get();
                if(doc.exists && doc.data().publicKey){ pk = doc.data().publicKey; c.publicKey = pk; }
              }catch(_){}
            }
            const decrypted = await decryptMessageText(c.firebaseUid, pk, m.ciphertext, m.iv);
            if(decrypted !== null){
              text = decrypted;
              wirelineDecryptCache[cacheKey] = decrypted;
            } else {
              text = '🔒 Couldn\u2019t decrypt this message';
            }
          }
        }
        const msgType = m.type || 'text';
        const isSys = msgType === 'missed_call' || msgType === 'system' || m.system === true;
        if(isSys && !text) text = m.text || (msgType === 'missed_call' ? 'Missed call' : 'System');
        return {
          id: d.id,
          from: isSys ? 'system' : (m.from===currentUser.uid ? 'me' : 'them'),
          type: isSys && msgType === 'text' ? 'system' : msgType,
          text, mood: m.mood, waveform: m.waveform, duration: m.duration, dataUrl: m.dataUrl,
          callId: m.callId || null,
          callerUid: m.callerUid || null,
          calleeUid: m.calleeUid || null,
          ts: m.ts && m.ts.toMillis ? m.ts.toMillis() : Date.now(),
          status: m.status || 'sent',
          reaction: m.reaction,
        };
      }));
      // Decryption is async — by the time it resolves, the person may have already
      // navigated to a different thread. Only apply this if it's still the one open.
      if(activeThreadContactId !== contactId) return;
      // Keep local missed_call rows that have not appeared in Firestore yet
      const prev = wirelineThreads[contactId] || [];
      const byCall = new Map();
      mapped.forEach(m => {
        if(m.type === 'missed_call' && m.callId) byCall.set(m.callId, m);
      });
      prev.forEach(m => {
        if(m.type === 'missed_call' && m.callId && !byCall.has(m.callId)) byCall.set(m.callId, m);
      });
      const rest = mapped.filter(m => !(m.type === 'missed_call' && m.callId));
      const missed = Array.from(byCall.values());
      wirelineThreads[contactId] = rest.concat(missed).sort((a,b)=>a.ts-b.ts);
      renderThreadMessages();
      // This thread is actively open, so any of their messages just received count as read.
      threadRef.update({ readBy: firebase.firestore.FieldValue.arrayUnion(currentUser.uid) }).catch(()=>{});
      snap.docs.forEach(d=>{
        const m = d.data();
        if(m.from !== currentUser.uid && m.status !== 'read') d.ref.update({ status:'read' }).catch(()=>{});
      });
    }, err=>{ toast('Couldn\u2019t load messages: ' + err.message); });
  } else {
    (wirelineThreads[contactId] || []).forEach(m=>{ if(m.from==='them') m.read = true; });
    renderThreadMessages();
    saveWireline();
    renderWirelineList();
  }
}
function closeThread(){
  if(voiceRecorder && voiceRecorder.state !== 'inactive') cancelVoiceRecording();
  if(activeThreadUnsubscribe){ activeThreadUnsubscribe(); activeThreadUnsubscribe = null; }
  $('wirelineThread').classList.remove('active');
  activeThreadContactId = null;
}
$('threadBack').onclick = closeThread;
function wirelineStartCallFromThread(){
  // Capture contact BEFORE any UI close (closeThread clears activeThreadContactId)
  const id = activeThreadContactId;
  if(!id){ toast('No conversation selected'); return; }
  const list = (typeof contacts !== 'undefined' && Array.isArray(contacts)) ? contacts : [];
  let c = list.find(x => x.id === id);
  if(!c) c = list.find(x => x.firebaseUid === id);
  if(!c){ toast('Contact missing'); return; }
  if(!c.isReal || !c.firebaseUid){ toast('Calls need a real connection'); return; }
  if(typeof startOutgoingCall !== 'function'){ toast('Calls still loading — try again'); return; }
  // Keep thread id available for hangup restore
  try{
    if(typeof window !== 'undefined') window.__wirelineCallContactId = c.id;
  }catch(_){}
  // Open lobby first so Wireline never covers it; close thread after lobby is visible
  try{ startOutgoingCall(c.id); }
  catch(e){ console.error('[wireline] call', e); toast(e.message || 'Could not start call'); return; }
  setTimeout(function(){
    try{
      if($('wirelineThread')) $('wirelineThread').classList.remove('active');
    }catch(_){}
  }, 80);
}
if($('threadCallBtn')){
  $('threadCallBtn').onclick = function(e){
    if(e){ e.preventDefault(); e.stopPropagation(); }
    wirelineStartCallFromThread();
  };
}

function receiptTickHtml(status){
  if(status==='queued'){
    return `<svg class="receipt-tick" width="12" height="12" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2" opacity=".6"/><path d="M12 7v5l3.5 2" stroke="currentColor" stroke-width="2" stroke-linecap="round" opacity=".6"/></svg>`;
  }
  if(status==='read'){
    return `<svg class="receipt-tick" width="15" height="10" viewBox="0 0 20 12" fill="none"><path d="M1 6l4 4 5-8" stroke="#00E5FF" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M8 6l4 4 7-9" stroke="#00E5FF" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  }
  if(status==='delivered'){
    return `<svg class="receipt-tick" width="15" height="10" viewBox="0 0 20 12" fill="none"><path d="M1 6l4 4 5-8" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" opacity=".55"/><path d="M8 6l4 4 7-9" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" opacity=".55"/></svg>`;
  }
  return `<svg class="receipt-tick" width="15" height="10" viewBox="0 0 20 12" fill="none"><path d="M1 6l4 4 5-8" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" opacity=".55"/></svg>`;
}
/* Silent communication: send a feeling instead of words. Each mood maps to a live
   background already built for Greenroom/Band — no new visual code, just reused at
   chat-bubble scale. The receiver sees motion and a one-word label, nothing typed. */
const MOODS = [
  { key:'exhausted',   label:'Exhausted',      vibe:'rain' },
  { key:'calm',        label:'Calm',           vibe:'aurora' },
  { key:'warm',        label:'Thinking of you',vibe:'studio' },
  { key:'wonder',      label:'In awe',         vibe:'stars' },
  { key:'peaceful',    label:'At peace',       vibe:'forest' },
  { key:'longing',     label:'Missing you',    vibe:'desert' },
  { key:'overwhelmed', label:'Overwhelmed',    vibe:'waterfall' },
];
function voiceBubbleHtml(m){
  const waveform = m.waveform && m.waveform.length ? m.waveform : Array(24).fill(0.4);
  const bars = waveform.map(v=>`<span style="height:${Math.round(4+v*18)}px;"></span>`).join('');
  const playing = currentPlayingVoiceId === m.id;
  const icon = playing
    ? `<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="4" width="5" height="16" rx="1"/><rect x="14" y="4" width="5" height="16" rx="1"/></svg>`
    : `<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M6 4l14 8-14 8V4z"/></svg>`;
  return `<div class="voice-bubble">
      <div class="voice-play-btn" data-voice="${m.id}">${icon}</div>
      <div class="voice-wave">${bars}</div>
      <div class="voice-duration">${formatDuration(m.duration||0)}</div>
    </div>`;
}
function moodBubbleHtml(m){
  const mood = MOODS.find(x=>x.key===m.mood) || MOODS[0];
  return `<div style="width:150px; height:90px; border-radius:14px; overflow:hidden; position:relative;">
    <canvas class="mood-canvas" data-vibe="${mood.vibe}" width="150" height="90" style="width:100%; height:100%; display:block;"></canvas>
    <div style="position:absolute; left:9px; bottom:7px; font-family:var(--font-mono); font-size:9.5px; color:rgba(255,255,255,.85); text-shadow:0 1px 3px rgba(0,0,0,.6);">${escapeHtml(mood.label)}</div>
  </div>`;
}
/* Reactions replace 👍❤️😂 with something that actually tells the sender what landed —
   eight words instead of three cartoons. Works on any message type, since it's just
   metadata attached to whatever was sent, not a property of text specifically. */
const EMOTIONS = [
  { key:'curious',    label:'Curious',    color:'#00E5FF' },
  { key:'inspired',   label:'Inspired',   color:'#FFB86B' },
  { key:'confused',   label:'Confused',   color:'#8B90A8' },
  { key:'proud',      label:'Proud',      color:'#7CFFB2' },
  { key:'comforted',  label:'Comforted',  color:'#7C4DFF' },
  { key:'moved',      label:'Moved',      color:'#FF7676' },
  { key:'thinking',   label:'Thinking',   color:'#4FBF87' },
  { key:'goosebumps', label:'Goosebumps', color:'#FF5470' },
];
function reactionBadgeHtml(m){
  if(!m.reaction) return '';
  return `<div style="display:inline-flex; align-items:center; gap:5px; margin-top:4px; padding:3px 9px; border-radius:999px; background:${m.reaction.color}22; border:1px solid ${m.reaction.color}55; font-family:var(--font-mono); font-size:9.5px; color:${m.reaction.color};"><span style="width:6px;height:6px;border-radius:50%;background:${m.reaction.color};flex-shrink:0;"></span>${escapeHtml(m.reaction.label)}</div>`;
}
/* Session-only: once a ciphertext decrypts, keep plaintext so UI never flips to lock icon. */
const wirelineDecryptCache = {};
function renderThreadMessages(){
  const queued = (localQueuedMessages[activeThreadContactId] || []).map(q => ({
    id: q.queueId, from:'me', ts: q.queuedAt, status:'queued',
    ...q.payload,
  }));
  const msgs = [...(wirelineThreads[activeThreadContactId] || []), ...queued].sort((a,b)=>a.ts-b.ts);
  if(msgs.length===0){
    $('threadMessages').innerHTML = `<div class="msg-empty"><span style="font-family:var(--font-futuristic); font-size:14px;">Nothing on this channel yet</span><span style="font-size:12.5px;">Send the first signal — or hold any message to react.</span></div>`;
    return;
  }
  let lastDay = null;
  $('threadMessages').innerHTML = msgs.map(m=>{
    const day = dayStampKey(m.ts);
    let dayHtml = '';
    if(day !== lastDay){
      lastDay = day;
      dayHtml = `<div class="msg-day-stamp" style="display:flex;justify-content:center;margin:14px 0 8px;"><span style="font-size:11px;font-family:var(--font-mono);color:var(--text-dim);background:rgba(255,255,255,.06);padding:4px 12px;border-radius:999px;border:1px solid rgba(255,255,255,.08);">${escapeHtml(dayStampLabel(m.ts))}</span></div>`;
    }
    if(m.type === 'system' || m.type === 'missed_call'){
      const label = m.type === 'missed_call'
        ? missedCallLabelForViewer(m)
        : (m.text || 'System');
      return dayHtml + `<div class="msg-row system" data-msgid="${m.id}" style="justify-content:center;margin:6px 0;">
        <div style="font-size:12px;color:var(--text-dim);font-family:var(--font-mono);padding:6px 12px;border-radius:999px;background:rgba(255,84,112,.12);border:1px solid rgba(255,84,112,.25);">📞 ${escapeHtml(label)} · ${formatClockTime(m.ts)}</div>
      </div>`;
    }
    let bubbleInner, bubbleClass = 'msg-bubble';
    if(m.type==='voice'){ bubbleInner = voiceBubbleHtml(m); bubbleClass = 'msg-bubble voice-bubble-wrap'; }
    else if(m.type==='mood'){ bubbleInner = moodBubbleHtml(m); bubbleClass = 'msg-bubble mood-bubble-wrap'; }
    else { bubbleInner = escapeHtml(m.text); }
    const receipt = m.from==='me' ? receiptTickHtml(m.status || 'sent') : '';
    const deleteBtn = m.from==='me' ? `<span class="msg-delete-btn" data-delmsg="${m.id}" title="Delete" aria-label="Delete message"><svg width="11" height="11" viewBox="0 0 24 24" fill="none"><path d="M4 7h16M9 7V5a2 2 0 012-2h2a2 2 0 012 2v2m2 0v13a2 2 0 01-2 2H9a2 2 0 01-2-2V7h10z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></span>` : '';
    return dayHtml + `<div class="msg-row ${m.from}" data-msgid="${m.id}">
      <div class="${bubbleClass}">${bubbleInner}</div>
      <div class="msg-time">${formatClockTime(m.ts)}${receipt}${deleteBtn}</div>
      ${reactionBadgeHtml(m)}
    </div>`;
  }).join('');
  document.querySelectorAll('[data-voice]').forEach(el=>{
    el.onclick = ()=> toggleVoicePlay(el.dataset.voice);
  });
  document.querySelectorAll('[data-delmsg]').forEach(el=>{
    el.onclick = e=>{ e.stopPropagation(); deleteThreadMessage(el.dataset.delmsg); };
  });
  wireLongPressReactions('#threadMessages .msg-row[data-msgid]');
  $('threadMessages').scrollTop = $('threadMessages').scrollHeight;
}
/* Hard delete — the message is just gone, no "this message was deleted" stamp left
   behind. That stamp is a design choice some apps make on purpose; this app doesn't
   make it, the same way Band's ephemeral chat doesn't keep a record either. */
function deleteThreadMessage(msgId){
  if(!confirm('Delete this message? This can\u2019t be undone.')) return;
  if(String(msgId).startsWith('queued-')){
    // Still sitting in the local queue, never actually sent — remove it there instead
    // of trying to delete a Firestore doc that was never created.
    removeFromMessageQueue(msgId);
    renderThreadMessages();
    return;
  }
  const c = contacts.find(x=>x.id===activeThreadContactId);
  if(c && c.isReal && c.firebaseUid && fbDb){
    const tid = realThreadId(c.firebaseUid);
    fbDb.collection('threads').doc(tid).collection('messages').doc(String(msgId)).delete()
      .catch(e=> toast(e.message || 'Couldn\u2019t delete'));
    // the open thread's onSnapshot listener re-renders once Firestore confirms the delete
  } else {
    wirelineThreads[activeThreadContactId] = (wirelineThreads[activeThreadContactId] || []).filter(m=>String(m.id)!==String(msgId));
    saveWireline();
    renderThreadMessages();
    renderWirelineList();
  }
}

/* Long-press (hold ~450ms without moving) opens the emotion wheel for that message.
   Shared by any message list that wants reactions — currently Wireline. */
function wireLongPressReactions(selector){
  document.querySelectorAll(selector).forEach(row=>{
    let pressTimer = null, startX = 0, startY = 0, moved = false;
    const clear = ()=>{ clearTimeout(pressTimer); pressTimer = null; };
    row.addEventListener('pointerdown', e=>{
      moved = false; startX = e.clientX; startY = e.clientY;
      pressTimer = setTimeout(()=>{ if(!moved) openEmotionWheel(row.dataset.msgid); }, 450);
    });
    row.addEventListener('pointermove', e=>{
      if(Math.abs(e.clientX-startX) > 20 || Math.abs(e.clientY-startY) > 20){ moved = true; clear(); }
    });
    row.addEventListener('pointerup', clear);
    row.addEventListener('pointerleave', clear);
    row.addEventListener('pointercancel', clear);
  });
}
let emotionWheelTargetMsgId = null;
function openEmotionWheel(msgId){
  emotionWheelTargetMsgId = msgId;
  $('emotionWheelBackdrop').classList.add('active');
}
function closeEmotionWheel(){
  $('emotionWheelBackdrop').classList.remove('active');
  emotionWheelTargetMsgId = null;
}
function chooseEmotion(key){
  const emo = EMOTIONS.find(e=>e.key===key);
  const c = contacts.find(x=>x.id===activeThreadContactId);
  const msgId = emotionWheelTargetMsgId;
  if(emo && c && c.isReal && c.firebaseUid && fbDb){
    const tid = realThreadId(c.firebaseUid);
    fbDb.collection('threads').doc(tid).collection('messages').doc(String(msgId))
      .update({ reaction: { key: emo.key, label: emo.label, color: emo.color } })
      .catch(e=> toast(e.message || 'Couldn\u2019t react'));
    // the open thread's onSnapshot listener will re-render once Firestore confirms the write
  } else {
    const msgs = wirelineThreads[activeThreadContactId] || [];
    const msg = msgs.find(m=>String(m.id)===String(msgId));
    if(msg && emo){
      msg.reaction = { key: emo.key, label: emo.label, color: emo.color };
      saveWireline();
      renderThreadMessages();
    }
  }
  closeEmotionWheel();
}
function layoutEmotionWheel(){
  const radius = 92;
  document.querySelectorAll('.emotion-option').forEach((el,i)=>{
    const angle = (-90 + i*45) * Math.PI/180;
    const x = 110 + radius*Math.cos(angle) - 32;
    const y = 110 + radius*Math.sin(angle) - 32;
    el.style.left = x+'px'; el.style.top = y+'px';
  });
}

function autoSizeThreadInput(){
  const el = $('threadInput');
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 120) + 'px';
}
function updateComposerButtons(){
  const hasText = $('threadInput').value.trim().length > 0;
  $('threadMicBtn').style.display = hasText ? 'none' : 'flex';
  $('threadSendBtn').style.display = hasText ? 'flex' : 'none';
}
$('threadInput').addEventListener('input', ()=>{ autoSizeThreadInput(); updateComposerButtons(); });
$('threadInput').addEventListener('keydown', e=>{
  if(e.key==='Enter' && !e.shiftKey){ e.preventDefault(); sendThreadMessage(); }
});
$('threadSendBtn').onclick = sendThreadMessage;

function sendThreadMessage(){
  const text = $('threadInput').value.trim();
  if(!text || !activeThreadContactId) return;
  const c = contacts.find(x=>x.id===activeThreadContactId);
  if(!c) return;
  if(c.isReal && c.firebaseUid){
    sendRealMessage(c, { type:'text', text }, text);
    return;
  }
  const id = activeThreadContactId;
  if(!wirelineThreads[id]) wirelineThreads[id] = [];
  const msg = { id: Date.now()+Math.random(), from:'me', type:'text', text, ts: Date.now(), status:'sent' };
  wirelineThreads[id].push(msg);
  $('threadInput').value = '';
  autoSizeThreadInput();
  updateComposerButtons();
  renderThreadMessages();
  renderWirelineList();
  saveWireline();
  advanceReceipt(id, msg);
  maybeSimulateReply(id);
}

/* ---------------- OFFLINE MESSAGE QUEUE ----------------
   This is the honest, buildable slice of "works when the internet is unavailable" —
   it makes YOUR OWN end of a flaky or absent connection fully resilient: compose a
   message with no connection at all, it's saved locally and shown immediately as
   Queued, and sent automatically the moment this device's connection genuinely
   returns, no manual retry needed. What this can't do — reach someone who is ALSO
   offline with no internet anywhere on the path between you — would need real
   device-to-device radio access (Bluetooth, Wi-Fi Direct), which no browser exposes
   to web pages at all. That's a hard platform wall, not a gap in this code. */
let localQueuedMessages = {}; // { [contactId]: [{ queueId, contactId, firebaseUid, payload, previewText, queuedAt }] }
function getMessageQueue(){
  try{ return JSON.parse(localStorage.getItem('naluno:messageQueue') || '[]'); }
  catch(e){ return []; }
}
function saveMessageQueueToStorage(queue){
  try{ localStorage.setItem('naluno:messageQueue', JSON.stringify(queue)); }catch(e){}
}
function rebuildLocalQueuedMessagesIndex(){
  localQueuedMessages = {};
  getMessageQueue().forEach(item=>{
    if(!localQueuedMessages[item.contactId]) localQueuedMessages[item.contactId] = [];
    localQueuedMessages[item.contactId].push(item);
  });
}
function queueMessageForLater(contactId, firebaseUid, payload, previewText){
  const queue = getMessageQueue();
  const queueId = 'queued-' + Date.now() + '-' + Math.random().toString(36).slice(2);
  queue.push({ queueId, contactId, firebaseUid, payload, previewText, queuedAt: Date.now() });
  saveMessageQueueToStorage(queue);
  rebuildLocalQueuedMessagesIndex();
  return queueId;
}
function removeFromMessageQueue(queueId){
  saveMessageQueueToStorage(getMessageQueue().filter(item => item.queueId !== queueId));
  rebuildLocalQueuedMessagesIndex();
}
/* Runs the moment this device's connection genuinely comes back (the browser's own
   'online' event), and once more right after sign-in in case connectivity was already
   restored before the tab reopened. Every attempt that still fails just stays queued
   for the next trigger — nothing is ever silently dropped. */
async function flushMessageQueue(){
  if((typeof nalunoIsOnline === 'function' ? !nalunoIsOnline() : !navigator.onLine) || !currentUser || !fbDb) return;
  const queue = getMessageQueue();
  if(queue.length === 0) return;
  for(const item of queue){
    try{
      await sendRealMessage({ firebaseUid: item.firebaseUid }, item.payload, item.previewText, item.queueId);
    }catch(e){ /* still couldn't send — stays in the queue for the next trigger */ }
  }
  if(activeThreadContactId) renderThreadMessages();
  renderWirelineList();
}
window.addEventListener('online', flushMessageQueue);
rebuildLocalQueuedMessagesIndex();

/* Writes a message to the real Firestore thread and updates the thread's denormalized
   preview fields (lastMessageText/At/From, readBy) in the same call — this is what
   renderWirelineList's real-contact branch and startThreadsListListener actually read.
   queueId is only passed when this is a retry of an already-queued message — on
   success, that local optimistic entry is what gets removed, since the real Firestore-
   synced version is about to arrive through the normal thread listener instead. */
async function sendRealMessage(c, payload, previewText, queueId){
  if(!fbDb || !currentUser) return;
  // Checked BEFORE ever touching Firestore, not after waiting for a failure that was
  // never actually coming: with offline persistence enabled (needed to fix the
  // Frequencies/Callsign lag), a write made while genuinely offline doesn't reject —
  // it stays pending indefinitely until the server can confirm it. This is the real
  // reason queued messages only ever appeared once back online: the catch block
  // holding all the queueing logic was waiting on a rejection that would never come,
  // the await just silently hung. Bailing out immediately here, before ever calling
  // Firestore, also avoids a real duplicate-send risk: if the write had actually been
  // issued, Firestore's own offline queue would retry it independently of this custom
  // one, and both eventually succeeding would send the message twice.
  if((typeof nalunoIsOnline === 'function' ? !nalunoIsOnline() : !navigator.onLine) && !queueId){
    const c2 = contacts.find(x=>x.firebaseUid===c.firebaseUid);
    if(c2){
      queueMessageForLater(c2.id, c.firebaseUid, payload, previewText);
      $('threadInput').value = '';
      autoSizeThreadInput();
      updateComposerButtons();
      if(activeThreadContactId===c2.id) renderThreadMessages();
      toast('No connection — queued, will send automatically');
      return;
    }
  }
  const tid = realThreadId(c.firebaseUid);
  const threadRef = fbDb.collection('threads').doc(tid);
  try{
    let finalPayload = payload;
    let finalPreview = previewText;
    if(payload.type === 'text'){
      const contact = contacts.find(x=>x.firebaseUid===c.firebaseUid);
      const theirKey = contact && contact.publicKey;
      const encrypted = theirKey ? await encryptMessageText(c.firebaseUid, theirKey, payload.text) : null;
      if(encrypted){
        finalPayload = { type:'text', ciphertext: encrypted.ciphertext, iv: encrypted.iv, encrypted:true };
        finalPreview = '🔒 Encrypted message'; // the list preview must never leak real content either
      }
      // No key available yet (they haven't opened the app since this shipped) — falls
      // through to sending payload/previewText as plaintext, exactly as before this
      // feature existed, so an in-progress rollout never breaks a real conversation.
    }
    await threadRef.set({
      participants: [currentUser.uid, c.firebaseUid].sort(),
      lastMessageAt: firebase.firestore.FieldValue.serverTimestamp(),
      lastMessageText: finalPreview,
      lastMessageFrom: currentUser.uid,
      readBy: [currentUser.uid],
    }, { merge:true });
    await threadRef.collection('messages').add({
      from: currentUser.uid,
      ts: firebase.firestore.FieldValue.serverTimestamp(),
      status: 'sent',
      ...finalPayload,
    });
    if(queueId) removeFromMessageQueue(queueId);
    $('threadInput').value = '';
    autoSizeThreadInput();
    updateComposerButtons();
    markMyActivity();
    bumpTodayActivity();
  }catch(e){
    if(!queueId){
      // Not already queued — this is a fresh send that failed for some OTHER reason
      // (a real error, not just being offline, which is now caught above before this
      // point is ever reached). Queue it instead of just showing an error and losing
      // what was typed.
      const c2 = contacts.find(x=>x.firebaseUid===c.firebaseUid);
      if(c2){
        queueMessageForLater(c2.id, c.firebaseUid, payload, previewText);
        $('threadInput').value = '';
        autoSizeThreadInput();
        updateComposerButtons();
        if(activeThreadContactId===c2.id) renderThreadMessages();
        toast('No connection — queued, will send automatically');
        return;
      }
    }
    toast(e.message || 'Couldn\u2019t send — try again');
    throw e; // let flushMessageQueue know this retry attempt still failed
  }
}

/* Read receipts follow the same reachability model as everything else: an off-the-grid
   contact never confirms delivery; a fading one confirms delivery but not reading;
   only a strong signal reliably reaches all the way to 'read'. Real contacts don't use
   this at all — their receipts come from the actual other person's client, in openThread. */
function advanceReceipt(contactId, msg){
  const c = contacts.find(x=>x.id===contactId);
  if(!c || c.isReal || computeSignal(c).tier==='off') return;
  const deliveredDelay = 400 + Math.random()*500;
  setTimeout(()=>{
    msg.status = 'delivered';
    if(activeThreadContactId===contactId) renderThreadMessages();
    saveWireline();
  }, deliveredDelay);
  if(computeSignal(c).tier==='strong'){
    const readDelay = deliveredDelay + 1200 + Math.random()*1800;
    setTimeout(()=>{
      msg.status = 'read';
      if(activeThreadContactId===contactId) renderThreadMessages();
      saveWireline();
    }, readDelay);
  }
}

/* Demo-only auto-reply so the channel feels alive rather than a dead drop. Contacts who
   are 'off the grid' stay silent — reachability governs replies here, same as everywhere else.
   A reply is real evidence of reachability, so it's the one thing that bumps their signal. */
function maybeSimulateReply(contactId){
  const c = contacts.find(x=>x.id===contactId);
  if(!c || c.isReal || computeSignal(c).tier==='off') return;
  const delay = computeSignal(c).tier==='strong' ? 1200 + Math.random()*1400 : 3200 + Math.random()*2600;
  const replies = ['Got it 👍','On it.','Haha true','Let me check and get back to you','Sounds good','Can we talk about this on a call?','Yeah, saw that too'];
  setTimeout(()=>{
    const text = replies[Math.floor(Math.random()*replies.length)];
    if(!wirelineThreads[contactId]) wirelineThreads[contactId] = [];
    const isViewing = activeThreadContactId === contactId && $('wirelineThread').classList.contains('active');
    wirelineThreads[contactId].push({ id: Date.now()+Math.random(), from:'them', type:'text', text, ts: Date.now(), read: isViewing });
    saveWireline();
    bumpContactActivity(contactId);
    if(isViewing) renderThreadMessages();
    else toast(c.name.split(' ')[0] + ' sent a message');
  }, delay);
}

/* Storage architecture: 'wireline:threads' holds only lightweight metadata (text, timestamps,
   waveform samples, receipt status) — never audio. Each voice note's actual audio lives under
   its own key ('wireline:voice:<id>'), so one long recording can't blow the 5MB limit for
   every other message in every other thread. Audio is cached in memory once fetched or recorded. */
let voiceAudioCache = {}; // msgId -> dataUrl

function threadsWithoutAudio(threads){
  const lean = {};
  Object.entries(threads).forEach(([cid, msgs])=>{
    lean[cid] = msgs.map(m => m.type==='voice' ? (({ dataUrl, ...rest }) => rest)(m) : m);
  });
  return lean;
}
async function saveWireline(){
  if(!storageAvailable) return;
  try{ await window.storage.set('wireline:threads', JSON.stringify(threadsWithoutAudio(wirelineThreads))); }
  catch(e){ /* best-effort — thread metadata alone should always fit comfortably under 5MB */ }
}
async function loadWireline(){
  if(storageAvailable){
    try{
      const res = await window.storage.get('wireline:threads');
      wirelineThreads = (res && res.value) ? JSON.parse(res.value) : wirelineSeed;
    }catch(e){ wirelineThreads = wirelineSeed; }
  } else {
    wirelineThreads = wirelineSeed;
  }
  renderWirelineList();
}
async function saveVoiceAudio(msgId, dataUrl){
  voiceAudioCache[msgId] = dataUrl; // available immediately this session regardless of storage
  if(!storageAvailable) return;
  try{ await window.storage.set('wireline:voice:'+msgId, dataUrl); }
  catch(e){ toast('That voice note is too long to keep after a refresh, but is fine for now'); }
}
async function getVoiceAudio(msgId){
  if(voiceAudioCache[msgId]) return voiceAudioCache[msgId];
  // Real messages already carry dataUrl straight from Firestore (no separate storage
  // hop needed) — check the currently loaded thread before falling back to local cache.
  const liveMsgs = wirelineThreads[activeThreadContactId] || [];
  const liveMsg = liveMsgs.find(m=>String(m.id)===String(msgId));
  if(liveMsg && liveMsg.dataUrl){ voiceAudioCache[msgId] = liveMsg.dataUrl; return liveMsg.dataUrl; }
  if(!storageAvailable) return null;
  try{
    const res = await window.storage.get('wireline:voice:'+msgId);
    if(res && res.value){ voiceAudioCache[msgId] = res.value; return res.value; }
  }catch(e){ /* nothing saved for this message, or it didn't fit */ }
  return null;
}

/* ---------------- VOICE NOTES ----------------
   Records real microphone audio via MediaRecorder, and samples actual amplitude with
   the Web Audio API during recording to draw a genuine waveform (not a decorative one). */
const VOICE_MAX_SECONDS = 120;
let voiceStream = null, voiceRecorder = null, voiceChunks = [], voiceStartTime = 0;
let voiceTimerInterval = null, voiceAudioCtx = null, voiceSampleInterval = null, voiceSamples = [];
let currentPlayingVoiceId = null;

function formatDuration(secs){
  const s = Math.max(0, Math.round(secs));
  const m = Math.floor(s/60), r = s%60;
  return m+':'+String(r).padStart(2,'0');
}
function blobToDataUrl(blob){
  return new Promise((resolve, reject)=>{
    const r = new FileReader();
    r.onload = ()=> resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}
function downsampleWaveform(samples, targetCount){
  if(samples.length===0) return Array(targetCount).fill(0.3);
  const out = [];
  for(let i=0;i<targetCount;i++){
    const start = Math.floor(i*samples.length/targetCount);
    const end = Math.max(start+1, Math.floor((i+1)*samples.length/targetCount));
    let sum=0, n=0;
    for(let j=start;j<end && j<samples.length;j++){ sum+=samples[j]; n++; }
    out.push(n ? sum/n : 0.1);
  }
  const max = Math.max(...out, 0.05);
  return out.map(v => 0.18 + 0.82*(v/max));
}
function showRecordingUI(){ $('threadComposerNormal').style.display='none'; $('threadComposerMood').style.display='none'; $('threadComposerRecording').style.display='flex'; }
function hideRecordingUI(){ $('threadComposerNormal').style.display='flex'; $('threadComposerRecording').style.display='none'; }

/* Voice notes are a solo recording, not a live call — requestHighQualityStream's
   echoCancellation/noiseSuppression are tuned for two-way conversations. Applied to
   one person talking alone, echo cancellation has nothing real to cancel (that's the
   "big hall" artifact), and noise suppression's gating on a quiet signal is what
   clicking sounds like. Voice notes get their own, deliberately different constraints. */
async function requestVoiceRecordingStream(){
  return navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation:false, noiseSuppression:false, autoGainControl:true, channelCount:1 }
  });
}

async function startVoiceRecording(){
  if(!activeThreadContactId) return;
  if(!window.MediaRecorder || !navigator.mediaDevices){ toast('Voice notes aren\u2019t supported in this browser'); return; }
  try{
    voiceStream = await requestVoiceRecordingStream();
  }catch(e){
    toast('Microphone unavailable — check your browser permissions');
    return;
  }
  voiceChunks = []; voiceSamples = [];

  // Boost and soft-limit the signal ourselves — this is the real fix for "quiet even
  // at max device volume," which the browser's built-in gain control wasn't handling.
  // A compressor right after the boost stops that gain from clipping on loud syllables.
  let recordingStream = voiceStream;
  try{
    voiceAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const source = voiceAudioCtx.createMediaStreamSource(voiceStream);
    const gainNode = voiceAudioCtx.createGain();
    gainNode.gain.value = 1.8;
    const compressor = voiceAudioCtx.createDynamicsCompressor();
    compressor.threshold.value = -18; compressor.knee.value = 24;
    compressor.ratio.value = 8; compressor.attack.value = 0.003; compressor.release.value = 0.25;
    const dest = voiceAudioCtx.createMediaStreamDestination();
    source.connect(gainNode); gainNode.connect(compressor); compressor.connect(dest);
    recordingStream = dest.stream;

    // Waveform sampling now taps the same boosted/limited signal that's actually being
    // recorded, so what you see matches what you'll hear.
    const analyser = voiceAudioCtx.createAnalyser();
    analyser.fftSize = 256;
    compressor.connect(analyser);
    const data = new Uint8Array(analyser.fftSize);
    voiceSampleInterval = setInterval(()=>{
      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for(let i=0;i<data.length;i++){ const v = (data[i]-128)/128; sum += v*v; }
      voiceSamples.push(Math.min(1, Math.sqrt(sum/data.length)*4));
    }, 120);
  }catch(e){
    // Web Audio graph failed for some reason — better to record the raw mic stream
    // than lose voice notes entirely.
    recordingStream = voiceStream;
  }

  try{
    voiceRecorder = new MediaRecorder(recordingStream);
  }catch(e){
    toast('Voice notes aren\u2019t supported in this browser');
    voiceStream.getTracks().forEach(t=>t.stop()); voiceStream = null;
    return;
  }
  voiceRecorder.ondataavailable = e=>{ if(e.data && e.data.size>0) voiceChunks.push(e.data); };
  voiceRecorder.start();
  voiceStartTime = Date.now();
  showRecordingUI();
  $('recordingTimer').textContent = '0:00';
  voiceTimerInterval = setInterval(()=>{
    const secs = (Date.now()-voiceStartTime)/1000;
    $('recordingTimer').textContent = formatDuration(secs);
    if(secs >= VOICE_MAX_SECONDS){ toast('Reached the 2-minute limit'); confirmVoiceRecording(); }
  }, 250);
}
function cleanupVoiceRecording(){
  clearInterval(voiceTimerInterval); voiceTimerInterval = null;
  clearInterval(voiceSampleInterval); voiceSampleInterval = null;
  if(voiceStream){ voiceStream.getTracks().forEach(t=>t.stop()); voiceStream = null; }
  if(voiceAudioCtx){ voiceAudioCtx.close().catch(()=>{}); voiceAudioCtx = null; }
  voiceRecorder = null;
}
function cancelVoiceRecording(){
  if(voiceRecorder && voiceRecorder.state !== 'inactive') voiceRecorder.stop();
  cleanupVoiceRecording();
  hideRecordingUI();
}
function confirmVoiceRecording(){
  if(!voiceRecorder || voiceRecorder.state === 'inactive') return;
  const durationSecs = (Date.now()-voiceStartTime)/1000;
  const samplesSnapshot = voiceSamples.slice();
  const contactId = activeThreadContactId;
  voiceRecorder.onstop = async ()=>{
    const blob = new Blob(voiceChunks, { type: (voiceChunks[0] && voiceChunks[0].type) || 'audio/webm' });
    cleanupVoiceRecording();
    hideRecordingUI();
    if(durationSecs < 0.5){ toast('Too short — hold the mic a bit longer'); return; }
    try{
      const dataUrl = await blobToDataUrl(blob);
      const waveform = downsampleWaveform(samplesSnapshot, 26);
      pushVoiceMessage(contactId, dataUrl, durationSecs, waveform);
    }catch(e){ toast('Couldn\u2019t save that voice note'); }
  };
  voiceRecorder.stop();
}
$('threadMicBtn').onclick = startVoiceRecording;
$('voiceCancelBtn').onclick = cancelVoiceRecording;
$('voiceConfirmBtn').onclick = confirmVoiceRecording;
{
  const rwf = $('recordingWaveform');
  for(let i=0;i<16;i++){ const s=document.createElement('span'); s.style.animationDelay=(Math.random()*1.1).toFixed(2)+'s'; rwf.appendChild(s); }
}

function pushVoiceMessage(contactId, dataUrl, durationSecs, waveform){
  if(!contactId) return;
  const c = contacts.find(x=>x.id===contactId);
  if(c && c.isReal && c.firebaseUid){
    // Firestore documents cap out at 1MB; without a Storage bucket wired up yet, the
    // audio has to live directly in the message doc, so there's a real, honest ceiling
    // here — this isn't a bug, it's the actual limit of the current architecture.
    if(dataUrl.length > 700000){
      toast('That voice note is too long to send for real right now (~30s max until Storage is wired up)');
      return;
    }
    sendRealMessage(c, { type:'voice', dataUrl, duration: durationSecs, waveform }, '🎙 Voice note');
    return;
  }
  if(!wirelineThreads[contactId]) wirelineThreads[contactId] = [];
  const msg = { id: Date.now()+Math.random(), from:'me', type:'voice', duration: durationSecs, waveform, ts: Date.now(), status:'sent' };
  wirelineThreads[contactId].push(msg);
  renderThreadMessages();
  renderWirelineList();
  saveWireline();              // lightweight — no audio in this write
  saveVoiceAudio(msg.id, dataUrl); // audio written to its own key, separately
  advanceReceipt(contactId, msg);
  maybeSimulateReply(contactId);
}

async function toggleVoicePlay(msgId){
  const audio = $('threadAudioPlayer');
  if(String(currentPlayingVoiceId) === String(msgId) && !audio.paused){
    audio.pause();
    return;
  }
  const dataUrl = await getVoiceAudio(msgId);
  if(!dataUrl){ toast('Couldn\u2019t load that voice note'); return; }
  if(audio.src !== dataUrl) audio.src = dataUrl;
  currentPlayingVoiceId = msgId;
  audio.play().catch(()=> toast('Playback unavailable in this preview'));
}
$('threadAudioPlayer').addEventListener('play', renderThreadMessages);
$('threadAudioPlayer').addEventListener('pause', renderThreadMessages);
$('threadAudioPlayer').addEventListener('ended', ()=>{ currentPlayingVoiceId = null; renderThreadMessages(); });

/* ---------------- MOOD PICKER (silent communication) ---------------- */
function renderMoodPicker(){
  $('threadComposerMood').innerHTML = MOODS.map(m=>`
    <div class="mood-pick-card" data-mood="${m.key}" style="flex-shrink:0; width:76px; height:56px; border-radius:12px; overflow:hidden; position:relative; cursor:pointer; border:1px solid var(--line);">
      <canvas class="mood-canvas" data-vibe="${m.vibe}" width="76" height="56" style="width:100%; height:100%; display:block;"></canvas>
      <div style="position:absolute; left:5px; bottom:3px; font-family:var(--font-mono); font-size:7.5px; color:rgba(255,255,255,.85); text-shadow:0 1px 2px rgba(0,0,0,.6);">${escapeHtml(m.label)}</div>
    </div>`).join('');
  document.querySelectorAll('#threadComposerMood [data-mood]').forEach(el=>{
    el.onclick = ()=> sendMoodMessage(el.dataset.mood);
  });
}
$('threadMoodBtn').onclick = ()=>{
  const showing = $('threadComposerMood').style.display !== 'none';
  if(showing){
    $('threadComposerMood').style.display = 'none';
    $('threadComposerNormal').style.display = 'flex';
  } else {
    renderMoodPicker();
    $('threadComposerNormal').style.display = 'none';
    $('threadComposerMood').style.display = 'flex';
  }
};
function sendMoodMessage(moodKey){
  if(!activeThreadContactId) return;
  const id = activeThreadContactId;
  const c = contacts.find(x=>x.id===id);
  $('threadComposerMood').style.display = 'none';
  $('threadComposerNormal').style.display = 'flex';
  if(c && c.isReal && c.firebaseUid){
    const label = (MOODS.find(m=>m.key===moodKey)||{}).label || 'A feeling';
    sendRealMessage(c, { type:'mood', mood: moodKey }, '◐ ' + label);
    return;
  }
  if(!wirelineThreads[id]) wirelineThreads[id] = [];
  const msg = { id: Date.now()+Math.random(), from:'me', type:'mood', mood:moodKey, ts: Date.now(), status:'sent' };
  wirelineThreads[id].push(msg);
  renderThreadMessages();
  renderWirelineList();
  saveWireline();
  advanceReceipt(id, msg);
  maybeSimulateReply(id);
}
/* Animates every visible mood-canvas — in the picker and in sent bubbles alike — reusing
   backgroundPresets directly. Only runs while Wireline's thread overlay is open. */
const moodAnimStart = performance.now();
function moodAnimTick(now){
  requestAnimationFrame(moodAnimTick);
  if(!$('wirelineThread').classList.contains('active')) return;
  const canvases = document.querySelectorAll('.mood-canvas');
  if(canvases.length===0) return;
  const t = (now - moodAnimStart) / 1000;
  canvases.forEach(c=>{
    const preset = backgroundPresets[c.dataset.vibe];
    if(!preset || preset.type!=='canvas') return;
    preset.painter(c.getContext('2d'), c.width, c.height, t);
  });
}
requestAnimationFrame(moodAnimTick);

/* ---------------- EMOTION WHEEL ---------------- */
(function renderEmotionWheelOptions(){
  const wheel = $('emotionWheel');
  EMOTIONS.forEach(emo=>{
    const el = document.createElement('div');
    el.className = 'emotion-option';
    el.dataset.emotion = emo.key;
    el.innerHTML = `<span class="dot" style="background:${emo.color};"></span><span>${escapeHtml(emo.label)}</span>`;
    el.style.borderColor = emo.color + '55';
    el.onclick = ()=> chooseEmotion(emo.key);
    wheel.appendChild(el);
  });
  layoutEmotionWheel();
})();
$('emotionWheelBackdrop').onclick = e=>{ if(e.target===$('emotionWheelBackdrop')) closeEmotionWheel(); };



/** One missed-call row per callId. Label depends on who is viewing:
 *  - caller sees "No answer"
 *  - callee sees "Missed call"
 */
function missedCallLabelForViewer(m){
  try{
    if(!currentUser) return m.text || 'Missed call';
    if(m.calleeUid && m.calleeUid === currentUser.uid) return 'Missed call';
    if(m.callerUid && m.callerUid === currentUser.uid) return 'No answer';
    // Fallback from stored text / incoming flag
    if(m.incoming === true) return 'Missed call';
    if(m.incoming === false) return 'No answer';
    if(m.text === 'No answer' || m.text === 'Missed call') return m.text;
  }catch(_){}
  return m.text || 'Missed call';
}

async function recordMissedCallInWireline(contactId, opts){
  opts = opts || {};
  if(!contactId) return;
  const callId = opts.callId || '';
  const ts = opts.ts || Date.now();
  const c = contacts.find(x => x.id === contactId || String(x.id) === String(contactId));
  const otherUid = c && c.firebaseUid ? c.firebaseUid : null;
  // Who am I in this call?
  const incoming = !!opts.incoming;
  const callerUid = opts.callerUid || (incoming ? otherUid : (currentUser && currentUser.uid)) || null;
  const calleeUid = opts.calleeUid || (incoming ? (currentUser && currentUser.uid) : otherUid) || null;

  if(!wirelineThreads[contactId]) wirelineThreads[contactId] = [];
  // Dedupe local by callId — never two chips for one call
  if(callId){
    const existingIdx = wirelineThreads[contactId].findIndex(m => m.type === 'missed_call' && m.callId === callId);
    if(existingIdx >= 0){
      const row = wirelineThreads[contactId][existingIdx];
      row.callerUid = row.callerUid || callerUid;
      row.calleeUid = row.calleeUid || calleeUid;
      try{ saveWireline(); }catch(_){}
      try{ renderWirelineList(); }catch(_){}
      if(activeThreadContactId === contactId) try{ renderThreadMessages(); }catch(_){}
      // Still try Firestore if not persisted yet
    } else {
      wirelineThreads[contactId].push({
        id: 'missed_' + (callId || Date.now()) + '_' + Math.random().toString(36).slice(2,6),
        from: 'system',
        type: 'missed_call',
        text: 'Missed call', // neutral store; UI picks label
        callId: callId,
        callerUid: callerUid,
        calleeUid: calleeUid,
        ts: ts,
        status: 'sent',
      });
      try{ saveWireline(); }catch(_){}
    }
  } else {
    wirelineThreads[contactId].push({
      id: 'missed_' + Date.now() + '_' + Math.random().toString(36).slice(2,6),
      from: 'system',
      type: 'missed_call',
      text: 'Missed call',
      callerUid: callerUid,
      calleeUid: calleeUid,
      ts: ts,
      status: 'sent',
    });
    try{ saveWireline(); }catch(_){}
  }
  try{ renderWirelineList(); }catch(_){}
  if(activeThreadContactId === contactId) {
    try{ renderThreadMessages(); }catch(_){}
  }

  // Single Firestore row per callId (either side may race; first write wins)
  try{
    if(c && c.isReal && c.firebaseUid && fbDb && currentUser){
      const tid = realThreadId(c.firebaseUid);
      const threadRef = fbDb.collection('threads').doc(tid);
      if(callId){
        try{
          const existing = await threadRef.collection('messages')
            .where('callId', '==', callId).limit(1).get();
          if(!existing.empty) return;
        }catch(_){}
      }
      const preview = missedCallLabelForViewer({ callerUid, calleeUid, incoming });
      await threadRef.set({
        participants: [currentUser.uid, c.firebaseUid].sort(),
        lastMessageAt: firebase.firestore.FieldValue.serverTimestamp(),
        lastMessageText: preview,
        lastMessageFrom: 'system',
        readBy: [currentUser.uid],
      }, { merge: true });
      await threadRef.collection('messages').add({
        from: currentUser.uid,
        type: 'missed_call',
        text: 'Missed call',
        callId: callId || null,
        callerUid: callerUid,
        calleeUid: calleeUid,
        system: true,
        ts: firebase.firestore.FieldValue.serverTimestamp(),
        status: 'sent',
      });
    }
  }catch(e){ console.warn('[wireline] missed call persist', e); }
}


