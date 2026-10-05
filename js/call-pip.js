/* Floating call. One session: this never opens a second peer connection.
   Android: the activity enters the system Picture-in-Picture window.
   Web: a document window when the browser has one, otherwise one video
   that is a split of the other person and you. That video is what opens
   on its own when you leave the page. */
function nalunoPipLive(){
  try{
    return !!(typeof incallIsLive === 'function' && incallIsLive());
  }catch(_){ return false; }
}
function nalunoPipMic(){
  return !(typeof micOn !== 'undefined' && micOn === false);
}
function nalunoPipCam(){
  return !(typeof camOn !== 'undefined' && camOn === false);
}
function nalunoPipAction(name, api){
  if(!api || typeof api.live !== 'function' || !api.live()) return 'idle';
  if(name === 'end'){
    if(typeof api.end === 'function') api.end();
    return 'ended';
  }
  if(name === 'mute'){
    if(typeof api.setMic === 'function') api.setMic(!api.mic());
    return 'mute';
  }
  if(name === 'cam'){
    if(typeof api.setCam === 'function') api.setCam(!api.cam());
    return 'cam';
  }
  if(name === 'back'){
    if(typeof api.back === 'function') api.back();
    return 'back';
  }
  return 'noop';
}

const nalunoPip = (function(){
  let armed = false;
  let nativeArmed = false;
  let webWin = null;
  let closing = false;
  let remoteWasMuted = false;
  let splitVideo = null;
  let splitCanvas = null;
  let splitStream = null;
  let splitTimer = null;

  function native(){
    return (typeof window !== 'undefined' && window.NalunoNative) ? window.NalunoNative : null;
  }
  function hasNative(){
    const n = native();
    if(!n) return false;
    /* JavascriptInterface methods are often typeof "object", not "function".
       A typeof test then reports the latest app as if PiP was missing. */
    try{ return n.armCallPip != null || n.enterCallPipNow != null; }catch(_){ return false; }
  }
  function tellNative(on){
    try{
      const n = native();
      if(!n) return false;
      n.armCallPip(on ? 'true' : 'false');
      nativeArmed = !!on;
      return true;
    }catch(_){ return false; }
  }
  function syncNative(){
    try{
      const n = native();
      if(!n || n.updateCallPip == null) return;
      n.updateCallPip(nalunoPipMic() ? 'true' : 'false', nalunoPipCam() ? 'true' : 'false');
    }catch(_){}
  }
  function liveApi(){
    return {
      live: nalunoPipLive,
      mic: nalunoPipMic,
      cam: nalunoPipCam,
      setMic: function(on){ try{ if(typeof setMic === 'function') setMic(!!on); }catch(_){} },
      setCam: function(on){ try{ if(typeof setCam === 'function') setCam(!!on); }catch(_){} },
      end: function(){ try{ if(typeof endActiveCall === 'function') endActiveCall('hangup'); }catch(_){} },
      back: function(){ closeWeb(); try{ window.focus(); }catch(_){} }
    };
  }
  function act(name){
    const result = nalunoPipAction(name, liveApi());
    syncNative();
    paintButtons();
    return result;
  }
  function bindSession(){
    try{
      if(!navigator.mediaSession) return;
      if(hasNative()) return;
      const nameEl = document.getElementById('remoteName');
      const who = (nameEl && nameEl.textContent) || 'Call';
      if(typeof MediaMetadata !== 'undefined'){
        navigator.mediaSession.metadata = new MediaMetadata({
          title: 'Naluno call',
          artist: who,
          album: 'Naluno'
        });
      }
      navigator.mediaSession.playbackState = 'playing';
      if(typeof navigator.mediaSession.setActionHandler === 'function'){
        navigator.mediaSession.setActionHandler('enterpictureinpicture', function(){
          openWeb().catch(function(){});
        });
      }
    }catch(_){}
  }
  function clearSession(){
    try{
      if(!navigator.mediaSession) return;
      if(typeof navigator.mediaSession.setActionHandler === 'function'){
        navigator.mediaSession.setActionHandler('enterpictureinpicture', null);
      }
      navigator.mediaSession.metadata = null;
      navigator.mediaSession.playbackState = 'none';
    }catch(_){}
  }
  function lockRemotePip(){
    const v = remoteEl();
    if(!v) return;
    /* On Android Chrome the other person's picture is what Android floats
       when you leave the app (see androidWeb below), so it must stay
       allowed there. */
    if(androidWeb() && armed){
      try{ v.removeAttribute('disablePictureInPicture'); }catch(_){}
      try{ v.disablePictureInPicture = false; }catch(_){}
      return;
    }
    try{ v.setAttribute('disablePictureInPicture', ''); }catch(_){}
    try{ v.disablePictureInPicture = true; }catch(_){}
  }
  /* ---- Android Chrome (browser or installed web app) ----
     Chrome on Android floats a video by itself when you leave the app, but
     only a video that fills the screen while the page is in full screen.
     The media-session route below is desktop Chrome only, and a web page
     cannot open a floating window without a tap. So a video call made or
     answered on Android Chrome goes full screen at that tap (it must be a
     tap), and the other person's picture fills it; leaving the app then
     floats it. A tap on the call puts it back in full screen after the
     back gesture has taken it out. Voice calls, iPhone and the Naluno
     Android app are not touched. */
  let fsByUs = false;
  function androidWeb(){
    try{
      if(hasNative()) return false;
      const ua = String((navigator && navigator.userAgent) || '');
      if(!/Android/i.test(ua) || /iPhone|iPad|iPod/i.test(ua)) return false;
      return !!(document.documentElement && document.documentElement.requestFullscreen);
    }catch(_){ return false; }
  }
  function videoCall(){
    try{ return !(typeof nalunoIsVoiceCall === 'function' && nalunoIsVoiceCall()); }catch(_){ return true; }
  }
  function goFullscreen(){
    if(!androidWeb() || !videoCall()) return false;
    if(document.fullscreenElement) return true;
    try{
      const p = document.documentElement.requestFullscreen({ navigationUI: 'hide' });
      fsByUs = true;
      if(p && p.catch) p.catch(function(){ fsByUs = false; });
      return true;
    }catch(_){ fsByUs = false; return false; }
  }
  function leaveFullscreen(){
    if(!fsByUs) return;
    fsByUs = false;
    try{
      if(document.fullscreenElement && document.exitFullscreen){
        const p = document.exitFullscreen();
        if(p && p.catch) p.catch(function(){});
      }
    }catch(_){}
  }
  function remoteEl(){
    return document.getElementById('remoteVideo');
  }
  function localStream(){
    try{
      if(typeof stream !== 'undefined' && stream && stream.getVideoTracks && stream.getVideoTracks().length) return stream;
    }catch(_){}
    return null;
  }
  function localPreviewEl(){
    const ids = ['pipRawVideo', 'sendRawVideo', 'incomingSelfVideo', 'localVideo'];
    let fallback = null;
    for(let i = 0; i < ids.length; i++){
      const el = document.getElementById(ids[i]);
      if(!el || !el.srcObject) continue;
      if((el.videoWidth || 0) > 0) return el;
      if(!fallback) fallback = el;
    }
    return fallback;
  }
  function splitEl(){
    return splitVideo || document.getElementById('nalunoSplitPip');
  }
  function remoteAudioStream(){
    const v = remoteEl();
    if(v && v.srcObject && v.srcObject.getAudioTracks && v.srcObject.getAudioTracks().length) return v.srcObject;
    try{
      if(typeof remoteCombinedStream !== 'undefined' && remoteCombinedStream && remoteCombinedStream.getAudioTracks && remoteCombinedStream.getAudioTracks().length){
        return remoteCombinedStream;
      }
    }catch(_){}
    return null;
  }
  function syncSplitAudio(){
    if(!splitStream) return;
    const src = remoteAudioStream();
    const want = src ? src.getAudioTracks().filter(function(t){ return t && t.readyState === 'live'; }) : [];
    const have = {};
    splitStream.getAudioTracks().forEach(function(t){ have[t.id] = t; });
    want.forEach(function(t){
      if(have[t.id]){ delete have[t.id]; return; }
      try{ splitStream.addTrack(t); }catch(_){}
    });
    Object.keys(have).forEach(function(id){
      try{ splitStream.removeTrack(have[id]); }catch(_){}
    });
  }
  function drawCover(ctx, video, x, y, w, h, mirror){
    const vw = video.videoWidth || 0;
    const vh = video.videoHeight || 0;
    if(!vw || !vh || w < 2 || h < 2) return false;
    const scale = Math.max(w / vw, h / vh);
    const dw = vw * scale;
    const dh = vh * scale;
    const dx = x + (w - dw) / 2;
    const dy = y + (h - dh) / 2;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    if(mirror){
      ctx.translate(x + w / 2, y + h / 2);
      ctx.scale(-1, 1);
      ctx.translate(-(x + w / 2), -(y + h / 2));
    }
    try{ ctx.drawImage(video, dx, dy, dw, dh); }catch(_){}
    ctx.restore();
    return true;
  }
  function drawSplit(){
    if(!splitCanvas) return;
    const ctx = splitCanvas.getContext('2d');
    if(!ctx) return;
    const w = splitCanvas.width;
    const h = splitCanvas.height;
    const splitY = Math.round(h * 0.56);
    ctx.fillStyle = '#101218';
    ctx.fillRect(0, 0, w, h);
    const remote = remoteEl();
    const self = localPreviewEl();
    const remoteOk = !!(remote && drawCover(ctx, remote, 0, 0, w, splitY, false));
    const selfOk = !!(self && drawCover(ctx, self, 0, splitY, w, h - splitY, true));
    ctx.fillStyle = 'rgba(0,0,0,.28)';
    ctx.fillRect(0, splitY - 28, w, 28);
    ctx.fillRect(0, h - 28, w, 28);
    ctx.fillStyle = 'rgba(255,255,255,.92)';
    ctx.font = '15px sans-serif';
    const nameEl = document.getElementById('remoteName');
    const name = (nameEl && nameEl.textContent) || (remoteOk ? '' : 'Camera off');
    ctx.fillText(name || (remoteOk ? '' : 'Camera off'), 12, splitY - 9);
    ctx.fillText(selfOk ? 'You' : 'You · camera off', 12, h - 9);
  }
  function onSplitEnter(){
    if(webWin && !webWin.closed) return;
    try{ if(typeof nalunoDropRemoteBoost === 'function') nalunoDropRemoteBoost(); }catch(_){}
    try{ if(typeof nalunoHoldOutbound === 'function') nalunoHoldOutbound(true); }catch(_){}
    const src = remoteEl();
    if(src){
      remoteWasMuted = !!src.muted;
      try{ src.muted = true; }catch(_){}
    }
    if(splitVideo){
      try{ splitVideo.muted = false; splitVideo.volume = 1; }catch(_){}
    }
  }
  function onSplitLeave(){
    if(splitVideo){ try{ splitVideo.muted = true; }catch(_){} }
    if(closing) return;
    if(webWin && !webWin.closed) return;
    restoreRemote();
  }
  function stopSplit(){
    if(splitTimer){ try{ clearInterval(splitTimer); }catch(_){} splitTimer = null; }
    const v = splitEl();
    if(v){
      try{ v.autoPictureInPicture = false; }catch(_){}
      try{ v.removeAttribute('autopictureinpicture'); }catch(_){}
      try{ v.muted = true; v.pause(); v.srcObject = null; }catch(_){}
    }
    splitStream = null;
    splitCanvas = null;
  }
  function ensureSplitVideo(){
    if(hasNative() || typeof document === 'undefined') return null;
    if(splitVideo && splitCanvas && splitStream){
      syncSplitAudio();
      if(splitVideo.paused){
        const p = splitVideo.play();
        if(p && p.catch) p.catch(function(){});
      }
      return splitVideo;
    }
    let v = document.getElementById('nalunoSplitPip');
    if(!v){
      v = document.createElement('video');
      v.id = 'nalunoSplitPip';
      v.setAttribute('playsinline', '');
      v.setAttribute('webkit-playsinline', '');
      v.autoplay = true;
      v.playsInline = true;
      v.muted = true;
      v.dataset.nalunoCallPip = '1';
      v.style.cssText = 'position:fixed;left:0;bottom:0;width:12px;height:12px;opacity:0.02;pointer-events:none;z-index:0';
      document.body.appendChild(v);
      v.addEventListener('enterpictureinpicture', onSplitEnter);
      v.addEventListener('leavepictureinpicture', onSplitLeave);
    }
    try{ v.disablePictureInPicture = false; }catch(_){}
    try{ v.removeAttribute('disablePictureInPicture'); }catch(_){}
    try{ v.autoPictureInPicture = true; }catch(_){}
    try{ v.setAttribute('autopictureinpicture', ''); }catch(_){}
    const c = document.createElement('canvas');
    c.width = 360;
    c.height = 640;
    splitCanvas = c;
    splitVideo = v;
    drawSplit();
    let streamOut = null;
    try{ streamOut = c.captureStream(12); }catch(_){ streamOut = null; }
    if(!streamOut) return v;
    splitStream = streamOut;
    syncSplitAudio();
    try{ v.srcObject = streamOut; }catch(_){}
    const play = v.play();
    if(play && play.catch) play.catch(function(){});
    if(!splitTimer){
      splitTimer = setInterval(function(){
        if(!nalunoPipLive()){ stopSplit(); return; }
        drawSplit();
        syncSplitAudio();
        const el = splitEl();
        if(el && el.paused){
          const p = el.play();
          if(p && p.catch) p.catch(function(){});
        }
      }, 80);
    }
    return v;
  }
  async function openSplitPip(){
    const v = ensureSplitVideo();
    if(!v) return false;
    /* Older iPhones have only Apple's own call for this (still needs the tap). */
    if(typeof v.requestPictureInPicture !== 'function'){
      try{
        if(typeof v.webkitSupportsPresentationMode === 'function' && v.webkitSupportsPresentationMode('picture-in-picture')){
          drawSplit();
          v.webkitSetPresentationMode('picture-in-picture');
          return true;
        }
      }catch(_){}
      return false;
    }
    if(document.pictureInPictureElement === v) return true;
    drawSplit();
    try{ v.disablePictureInPicture = false; }catch(_){}
    try{
      const p = v.play();
      if(p && p.catch) p.catch(function(){});
    }catch(_){}
    await v.requestPictureInPicture();
    return true;
  }
  function restoreRemote(){
    const v = remoteEl();
    if(!v) return;
    try{ v.muted = remoteWasMuted; }catch(_){}
    if(v.srcObject){
      const p = v.play();
      if(p && p.catch) p.catch(function(){});
    }
    try{ if(typeof nalunoHearRemote === 'function') nalunoHearRemote(v); }catch(_){}
    try{
      if(!document.hidden && !(document.body && document.body.classList.contains('naluno-os-pip')) && typeof nalunoHoldOutbound === 'function'){
        nalunoHoldOutbound(false);
      }
    }catch(_){}
  }
  function closeWeb(){
    const w = webWin;
    webWin = null;
    if(!w) return;
    try{ w.close(); }catch(_){}
    restoreRemote();
  }
  function paintButtons(){
    if(!webWin || webWin.closed) return;
    const doc = webWin.document;
    if(!doc) return;
    const mute = doc.getElementById('pipMute');
    const cam = doc.getElementById('pipCam');
    if(mute) mute.textContent = nalunoPipMic() ? 'Mute' : 'Unmute';
    if(cam) cam.textContent = nalunoPipCam() ? 'Camera off' : 'Camera on';
  }
  function paintWeb(pipWin){
    const doc = pipWin.document;
    doc.title = 'Naluno call';
    const style = doc.createElement('style');
    style.textContent = [
      'html,body{margin:0;height:100%;background:#000;color:#fff;font-family:system-ui,sans-serif}',
      '.stage{display:flex;flex-direction:column;height:100%}',
      '.face{position:relative;flex:1 1 0;min-height:34%;background:#141820;overflow:hidden}',
      '.face video{width:100%;height:100%;object-fit:cover;background:#000}',
      '.self video{transform:scaleX(-1)}',
      '.who{position:absolute;left:8px;bottom:8px;font-size:12px;letter-spacing:.04em;color:rgba(255,255,255,.8)}',
      '.bar{display:flex;gap:6px;padding:8px;background:#0d0f17;flex:none}',
      'button{flex:1;border:1px solid rgba(255,255,255,.28);background:transparent;color:#fff;border-radius:999px;padding:8px 4px;font-size:12px}',
      'button.end{background:#e23b4a;border-color:#e23b4a}'
    ].join('');
    doc.head.appendChild(style);
    const stage = doc.createElement('div');
    stage.className = 'stage';
    const remote = doc.createElement('div');
    remote.className = 'face';
    const self = doc.createElement('div');
    self.className = 'face self';
    const rv = doc.createElement('video');
    rv.autoplay = true;
    rv.playsInline = true;
    rv.setAttribute('playsinline', '');
    const src = remoteEl();
    if(src && src.srcObject){
      remoteWasMuted = !!src.muted;
      try{ if(typeof nalunoDropRemoteBoost === 'function') nalunoDropRemoteBoost(); }catch(_){}
      try{ if(typeof nalunoHoldOutbound === 'function') nalunoHoldOutbound(true); }catch(_){}
      try{ src.muted = true; }catch(_){}
      rv.srcObject = src.srcObject;
      rv.muted = false;
      try{ rv.volume = 1; }catch(_){}
    }
    remote.appendChild(rv);
    const who = doc.createElement('div');
    who.className = 'who';
    const nameEl = document.getElementById('remoteName');
    who.textContent = (nameEl && nameEl.textContent) || '';
    remote.appendChild(who);
    const lv = doc.createElement('video');
    lv.autoplay = true;
    lv.playsInline = true;
    lv.muted = true;
    const mine = localStream();
    const preview = localPreviewEl();
    if(mine) lv.srcObject = mine;
    else if(preview && preview.srcObject) lv.srcObject = preview.srcObject;
    self.appendChild(lv);
    const you = doc.createElement('div');
    you.className = 'who';
    you.textContent = 'You';
    self.appendChild(you);
    const bar = doc.createElement('div');
    bar.className = 'bar';
    function btn(id, label, name, extra){
      const b = doc.createElement('button');
      b.type = 'button';
      b.id = id;
      b.textContent = label;
      if(extra) b.className = extra;
      b.addEventListener('click', function(){ act(name); });
      return b;
    }
    bar.appendChild(btn('pipMute', nalunoPipMic() ? 'Mute' : 'Unmute', 'mute'));
    bar.appendChild(btn('pipCam', nalunoPipCam() ? 'Camera off' : 'Camera on', 'cam'));
    bar.appendChild(btn('pipBack', 'Back', 'back'));
    bar.appendChild(btn('pipEnd', 'End', 'end', 'end'));
    stage.appendChild(remote);
    stage.appendChild(self);
    stage.appendChild(bar);
    doc.body.appendChild(stage);
    const play = rv.play();
    if(play && play.catch) play.catch(function(){
      try{ if(src) src.muted = remoteWasMuted; }catch(_){}
    });
    const playL = lv.play();
    if(playL && playL.catch) playL.catch(function(){});
  }
  async function openWeb(){
    if(!nalunoPipLive() || hasNative()) return false;
    if(webWin && !webWin.closed) return true;
    const split = splitEl();
    const docPip = !!(window.documentPictureInPicture && typeof documentPictureInPicture.requestWindow === 'function');
    if(!docPip && split && document.pictureInPictureElement === split) return true;
    if(window.documentPictureInPicture && typeof documentPictureInPicture.requestWindow === 'function'){
      try{
        const pipWin = await documentPictureInPicture.requestWindow({ width: 340, height: 560 });
        webWin = pipWin;
        paintWeb(pipWin);
        try{
          if(document.pictureInPictureElement && document.exitPictureInPicture) document.exitPictureInPicture();
        }catch(_){}
        pipWin.addEventListener('pagehide', function(){
          if(closing) return;
          webWin = null;
          restoreRemote();
        });
        return true;
      }catch(_){}
    }
    return openSplitPip();
  }
  function arm(){
    if(!nalunoPipLive()) return;
    armed = true;
    tellNative(true);
    syncNative();
    lockRemotePip();
    if(hasNative()){
      stopSplit();
      clearSession();
      return;
    }
    bindSession();
    ensureSplitVideo();
  }
  function disarm(){
    armed = false;
    closing = true;
    leaveFullscreen();
    tellNative(false);
    closeWeb();
    stopSplit();
    clearSession();
    try{ document.body.classList.remove('naluno-os-pip'); }catch(_){}
    lockRemotePip();
    try{
      if(document.pictureInPictureElement && document.exitPictureInPicture) document.exitPictureInPicture();
    }catch(_){}
    restoreRemote();
    closing = false;
  }
  function onOs(on){
    try{ document.body.classList.toggle('naluno-os-pip', !!on); }catch(_){}
    try{ if(typeof nalunoHoldOutbound === 'function') nalunoHoldOutbound(!!on); }catch(_){}
    if(on){
      try{ if(typeof resetPipLayoutStyles === 'function') resetPipLayoutStyles(); }catch(_){}
      const v = remoteEl();
      if(v && v.srcObject){
        const p = v.play();
        if(p && p.catch) p.catch(function(){});
      }
      try{
        const self = document.getElementById('pipRawVideo');
        if(self){
          const p = self.play();
          if(p && p.catch) p.catch(function(){});
        }
      }catch(_){}
    }
  }
  function onFocus(has){
    if(!nalunoPipLive()) return;
    if(!has) return;
    try{ if(typeof nalunoResumeHeldAudio === 'function') nalunoResumeHeldAudio(); }catch(_){}
    try{ if(typeof nalunoApplyEarpiece === 'function') nalunoApplyEarpiece(); }catch(_){}
    const v = remoteEl();
    if(v && v.srcObject){
      const p = v.play();
      if(p && p.catch) p.catch(function(){});
    }
  }
  function float(){
    if(hasNative()){
      try{
        const n = native();
        if(n) n.enterCallPipNow();
      }catch(_){}
      return;
    }
    openWeb().catch(function(){});
  }
  function open(){
    return !!(webWin && !webWin.closed) || !!(typeof document !== 'undefined' && document.body && document.body.classList.contains('naluno-os-pip'));
  }
  function backgrounded(){
    try{
      if(document.hidden) return true;
      if(document.body && document.body.classList.contains('naluno-os-pip')) return true;
      if(webWin && !webWin.closed) return true;
    }catch(_){}
    return false;
  }

  return {
    arm: arm,
    disarm: disarm,
    act: act,
    onOs: onOs,
    onFocus: onFocus,
    float: float,
    open: open,
    backgrounded: backgrounded,
    sync: syncNative,
    bind: bindSession,
    retryArm: function(){ if(nalunoPipLive() && !nativeArmed) arm(); },
    fullscreen: goFullscreen,
    leaveFullscreen: leaveFullscreen,
    androidWeb: androidWeb
  };
})();
window.nalunoPip = nalunoPip;

if(typeof document !== 'undefined' && document.addEventListener){
  /* Any way the call screen closes (declined, busy, no answer) leaves full screen. */
  (function watchOverlay(){
    const ov = document.getElementById('callOverlay');
    if(!ov || typeof MutationObserver === 'undefined'){
      if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watchOverlay);
      return;
    }
    new MutationObserver(function(){
      if(!ov.classList.contains('active')){ try{ nalunoPip.leaveFullscreen(); }catch(_){} }
    }).observe(ov, { attributes: true, attributeFilter: ['class'] });
  })();
  /* Capture phase, so the full-screen request is still inside the tap. */
  document.addEventListener('click', function(e){
    try{
      if(!nalunoPip.androidWeb()) return;
      const t = e.target;
      if(!t || !t.closest) return;
      if(t.closest('#joinBtn, #acceptIncoming')){ nalunoPip.fullscreen(); return; }
      if(t.closest('#endBtn, #cancelCall, #declineIncoming, #callFloatBtn')) return;
      if(t.closest('#incall') && nalunoPipLive() && !document.fullscreenElement) nalunoPip.fullscreen();
    }catch(_){}
  }, true);
  document.addEventListener('click', function(e){
    const btn = e.target && e.target.closest && e.target.closest('#callFloatBtn');
    if(!btn) return;
    e.preventDefault();
    nalunoPip.float();
  });
  window.addEventListener('online', function(){
    if(!nalunoPipLive()) return;
    try{
      if(typeof peerConnection !== 'undefined' && peerConnection && typeof nalunoCallMediaUp === 'function' && !nalunoCallMediaUp(peerConnection) && typeof nalunoTryRelay === 'function'){
        nalunoTryRelay(peerConnection);
      }
    }catch(_){}
  });
  if(navigator.mediaDevices && navigator.mediaDevices.addEventListener){
    navigator.mediaDevices.addEventListener('devicechange', function(){
      if(!nalunoPipLive()) return;
      try{ if(typeof nalunoApplyEarpiece === 'function') nalunoApplyEarpiece(); }catch(_){}
      try{ if(typeof nalunoResumeHeldAudio === 'function') nalunoResumeHeldAudio(); }catch(_){}
    });
  }
  setInterval(function(){
    if(!nalunoPipLive()) return;
    try{ nalunoPip.retryArm(); }catch(_){}
    try{ nalunoPip.sync(); }catch(_){}
    try{ nalunoPip.bind(); }catch(_){}
  }, 1500);
  document.addEventListener('visibilitychange', function(){
    if(!nalunoPipLive()) return;
    if(document.hidden){
      try{ if(typeof nalunoHoldOutbound === 'function') nalunoHoldOutbound(true); }catch(_){}
      try{
        const n = window.NalunoNative;
        if(n) n.enterCallPipNow();
      }catch(_){}
      return;
    }
    if(!(document.body && document.body.classList.contains('naluno-os-pip'))){
      try{ if(typeof nalunoHoldOutbound === 'function') nalunoHoldOutbound(false); }catch(_){}
    }
  });
}
