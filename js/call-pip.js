/* Floating call. One session: this never opens a second peer connection.
   Android: the activity enters the system Picture-in-Picture window.
   Web: Document Picture-in-Picture (the browser window that stays above
   other apps). A single-video float is only the fallback where that
   window does not exist. */
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
  let webWin = null;
  let closing = false;
  let remoteWasMuted = false;

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
      if(!n) return;
      n.armCallPip(on ? 'true' : 'false');
    }catch(_){}
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
      if(!navigator.mediaSession || typeof navigator.mediaSession.setActionHandler !== 'function') return;
      if(hasNative()) return;
      navigator.mediaSession.setActionHandler('enterpictureinpicture', function(){
        openWeb().catch(function(){});
      });
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
  function restoreRemote(){
    const v = remoteEl();
    if(!v) return;
    try{ v.muted = remoteWasMuted; }catch(_){}
    if(v.srcObject){
      const p = v.play();
      if(p && p.catch) p.catch(function(){});
    }
    try{ if(typeof nalunoHearRemote === 'function') nalunoHearRemote(v); }catch(_){}
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
      '.face{position:relative;flex:1;min-height:0;background:#141820;overflow:hidden}',
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
    if(mine) lv.srcObject = mine;
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
    if(window.documentPictureInPicture && typeof documentPictureInPicture.requestWindow === 'function'){
      const pipWin = await documentPictureInPicture.requestWindow({ width: 300, height: 460 });
      webWin = pipWin;
      paintWeb(pipWin);
      pipWin.addEventListener('pagehide', function(){
        if(closing) return;
        webWin = null;
        restoreRemote();
      });
      return true;
    }
    const v = remoteEl();
    if(v && v.srcObject && typeof v.requestPictureInPicture === 'function'){
      try{ v.removeAttribute('disablePictureInPicture'); }catch(_){}
      await v.requestPictureInPicture();
      return true;
    }
    return false;
  }
  function arm(){
    if(!nalunoPipLive()) return;
    armed = true;
    tellNative(true);
    syncNative();
    bindSession();
    const v = remoteEl();
    if(v){
      try{ v.removeAttribute('disablePictureInPicture'); }catch(_){}
    }
  }
  function disarm(){
    armed = false;
    closing = true;
    tellNative(false);
    closeWeb();
    try{ document.body.classList.remove('naluno-os-pip'); }catch(_){}
    const v = remoteEl();
    if(v){
      try{ v.setAttribute('disablePictureInPicture', ''); }catch(_){}
      try{
        if(document.pictureInPictureElement === v && document.exitPictureInPicture) document.exitPictureInPicture();
      }catch(_){}
    }
    restoreRemote();
    closing = false;
  }
  function onOs(on){
    try{ document.body.classList.toggle('naluno-os-pip', !!on); }catch(_){}
    if(on){
      try{ if(typeof resetPipLayoutStyles === 'function') resetPipLayoutStyles(); }catch(_){}
      const v = remoteEl();
      if(v && v.srcObject){
        const p = v.play();
        if(p && p.catch) p.catch(function(){});
      }
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
    bind: bindSession
  };
})();
window.nalunoPip = nalunoPip;

if(typeof document !== 'undefined' && document.addEventListener){
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
    try{ nalunoPip.sync(); }catch(_){}
    try{ nalunoPip.bind(); }catch(_){}
  }, 1500);
}
