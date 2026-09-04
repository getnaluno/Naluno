// Naluno service worker — offline shell + background call push.
// v140: 09.04c avatars via https+img overlay; call Decline is Decline; stop ringing after hangup; profile photoUrl.
// v139: 09.04b lobby always opens; sticky column (search/strand); band wipe sticks; avatars; swipe pauses media.
// v138: 09.04a Signal playback no dual-load (AbortError 20 stutter); all video types on pickers.
// v137: 09.03e Samsung overlay pickers, live WebRTC order, live push not a call, SW ?v= fallback.
// v136: 09.03d Signal videos use the working Broadcast upload pipe (Signal /b/init 401).
// v133: 09.03a upload unblock — wake-lock cannot stall publish; swipe cannot steal New Broadcast; Signal composer skipped by exclusive play.
// v115: 28y Toga name/score no overlap, Delete centered, Signal exclusive skip + preview pause.
// v114: 28x Toga names slide without view-switch, Toga photos, swipe-left wraps to Toga home, Was live stays on real lives.
// v113: 28w launcher icon restored, bspace tabs don't steal swipe, share copy off WhatsApp, live camera skipped by exclusive play.
// v111: 28u web splash is a dark field — Chrome must not paint icon-192.png first.
// v110: 28t For You-only home, sticky persist, fill-screen chrome idle, exclusive play, strand back stays.
// v106: 28p swipe L/R switches For You and My Broadcasts.
// v105: 28o no PNG splash — drawing logo is first paint.
// v104: 28n drawing logo replaces PNG splash, 3s then enter.
// v103: 28m entry logo sonar animation.
// v102: 28l landscape expand + rail glow + signal session lock.
// v101: 28k flip flicker — keep decoder, stable stage, no video Ken Burns.
// v100: 28j living shell — aurora, nav glow, atmosphere-tied tint. Architecture untouched.
// v99: 28i Search lives in sticky For You / My Broadcasts bar.
// v98: 28h Toga always open, names slide, swipe-up cue.
// v97: 28g landscape toggle on feed + bspace 16:9.
// v96: 28f entry page then full-phone video; flip unchanged.
// v95: 28e full-screen snap flip feed, S23 enforced.
// v94: 28d S23 motion fallback — pulse survives Remove animations, previews no longer gated.
// v93: 28c one-column strand preview feed + visible signal edge pulse.
// v92: 28b signal edge pulse + broadcast scroll reveal.
// v91: 28a Broadcast living-room visual refresh (Signal create tile, Toga banner).
// v89: 25c media-session lock + signal thumbs + live video/push + strand next + end restart. v88: 25b Broadcast off vault + Worker edge cache + onerror off-by-one. v87: 24c + vault in-use LRU + shared Signal upload + rules + storage shim + live notif + toga txn + ice unsub + cam climb gen. 23q folders + Toga wall of fame + 23n play, plus media identity on 23q.
// v83: Strand folders at Broadcast entry.
// v79: same-origin only (never gstatic); full latest shell.
// v73: same-origin only; video/* pick; call camera max climb.
const CACHE_NAME = 'naluno-shell-v140';
const CORE_ASSETS = [
  './', './index.html', './manifest.json', './splash-empty.png', './icon-maskable-512.png', './icon-192.png', './icon-512.png',
  './firebase-config.js', './css/app.css',
  './js/core.js', './js/metrics.js', './js/data.js', './js/crypto.js', './js/atmosphere.js',
  './js/pwa.js', './js/auth.js', './js/camera.js', './js/call-filters.js', './js/calls.js', './js/media-vault.js', './js/wireline.js',
  './js/band-room.js', './js/band-list.js', './js/broadcast-core.js', './js/broadcast-space.js',
  './js/broadcast-live.js', './js/broadcast-composer.js', './js/broadcast-upload.js',
  './js/origin.js', './js/strand.js', './js/circle.js',
  './js/signal-core.js', './js/signal-ui.js',
  './js/sfu-live.js', './js/compass.js', './js/weather.js', './js/beacon.js', './js/find.js', './js/profile.js', './js/notifications.js',
  './js/ice-core.js', './js/compat-lock.js', './js/keep-alive.js', './js/media-contain.js',
  './js/spark.js', './js/spark-page.js', './js/spark-engine.js', './js/spark-lg.js',
  './js/diagnostics.js', './js/economy.js', './js/economy-ui.js',
];

self.addEventListener('install', event=>{
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      Promise.all(CORE_ASSETS.map(u => cache.add(u).catch(()=>{})))
    )
  );
});

self.addEventListener('activate', event=>{
  self.clients.claim();
  event.waitUntil(
    caches.keys().then(names => Promise.all(
      names.filter(n => n !== CACHE_NAME).map(n => caches.delete(n))
    ))
  );
});

self.addEventListener('fetch', event=>{
  if(event.request.method !== 'GET') return;
  // Version checks and hard reloads must hit the network, not the SW cache.
  if(event.request.cache === 'no-store' || event.request.cache === 'reload') return;
  const url = new URL(event.request.url);
  const isSameOrigin = url.origin === self.location.origin;
  // NEVER intercept Firebase CDN (gstatic). A 2.5s timeout on large SDK scripts
  // leaves firebase undefined on mobile → "Sign-in is not ready yet."
  // Sign-in needs the network anyway; let the browser load CDN scripts normally.
  if(!isSameOrigin) return;

  const path = url.pathname || '';
  const isAppCode = path.includes('/js/') || path.endsWith('.js') ||
    path.includes('/css/') || path.endsWith('.css') || path.endsWith('firebase-config.js');
  const isNav = event.request.mode === 'navigate' || path.endsWith('.html') || path.endsWith('/');
  const bare = url.origin + url.pathname;

  function netTimeout(req, ms){
    const ctl = new AbortController();
    const t = setTimeout(function(){ ctl.abort(); }, ms);
    return fetch(req, { signal: ctl.signal }).finally(function(){ clearTimeout(t); });
  }
  function isShellResponse(r, p){
    if(!r || !r.ok) return false;
    const ct = (r.headers.get('content-type') || '').toLowerCase();
    if(p.endsWith('.js') || p.includes('/js/') || p.includes('firebasejs')){
      return ct.indexOf('javascript') >= 0 || ct.indexOf('ecmascript') >= 0 || ct.indexOf('text/plain') >= 0 || !ct;
    }
    if(p.endsWith('.css')) return ct.indexOf('css') >= 0 || !ct;
    if(p.endsWith('.html') || p.endsWith('/')) return ct.indexOf('html') >= 0 || !ct;
    return true;
  }
  function putBare(r){
    if(!r || !r.ok) return;
    if(!isShellResponse(r, path) && isAppCode) return;
    const copy = r.clone();
    caches.open(CACHE_NAME).then(function(cache){
      cache.put(event.request, copy.clone()).catch(function(){});
      if(!isAppCode) cache.put(new Request(bare), copy).catch(function(){});
    }).catch(function(){});
  }

  // App JS/CSS must not be served from a query-stripped cache. ignoreSearch
  // is why GitHub updates looked like "nothing changed" — yesterday's
  // uploader kept running. Network-first, match the exact ?v= URL only.
  if(isAppCode){
    event.respondWith((async ()=>{
      try{
        const response = await netTimeout(event.request, 8000);
        if(response && response.ok && isShellResponse(response, path)){
          putBare(response);
          return response;
        }
      }catch(_){}
      const exact = await caches.match(event.request);
      if(exact && isShellResponse(exact, path)) return exact;
      const bareHit = await caches.match(new Request(bare));
      if(bareHit && isShellResponse(bareHit, path)) return bareHit;
      try{ return await fetch(event.request); }catch(_){}
      return new Response('/* naluno: js miss */', { status: 503, headers: { 'Content-Type': 'application/javascript' } });
    })());
    return;
  }

  event.respondWith((async ()=>{
    const cached = await caches.match(event.request)
      || await caches.match(new Request(bare))
      || (isNav ? await caches.match('./index.html') : null);
    try{
      const response = await netTimeout(event.request, 2500);
      if(response && response.ok){
        if(isSameOrigin) putBare(response);
        return response;
      }
    }catch(_){}
    if(cached) return cached;
    if(isNav){
      const html = await caches.match('./index.html');
      if(html) return html;
    }
    return new Response('', { status: 503 });
  })());
});

const handledCallIds = {};
function markCallHandled(callId){
  if(callId) handledCallIds[callId] = Date.now();
  const cutoff = Date.now() - 10 * 60 * 1000;
  Object.keys(handledCallIds).forEach(function(k){
    if(handledCallIds[k] < cutoff) delete handledCallIds[k];
  });
}
function isCallHandled(callId){
  return !!(callId && handledCallIds[callId]);
}
async function closeCallNotifications(callId){
  try{
    const list = await self.registration.getNotifications();
    (list || []).forEach(function(n){
      const d = n.data || {};
      if(d.type === 'incoming_call' && (!callId || !d.callId || d.callId === callId)){
        try{ n.close(); }catch(_){}
      }
    });
  }catch(_){}
}

self.addEventListener('message', event=>{
  const msg = (event && event.data) || {};
  if(msg.type === 'naluno-call-handled' || msg.type === 'naluno-decline-call'){
    markCallHandled(msg.callId);
    event.waitUntil(closeCallNotifications(msg.callId));
  }
});

self.addEventListener('push', event=>{
  let data = {};
  try{ data = event.data ? event.data.json() : {}; }catch(e){ try{ data = { body: event.data.text() }; }catch(_){} }
  try{
    if(data.data && typeof data.data === 'object'){
      data = Object.assign({}, data, data.data);
    }
    if(data.notification && typeof data.notification === 'object'){
      if(!data.title && data.notification.title) data.title = data.notification.title;
      if(!data.body && data.notification.body) data.body = data.notification.body;
    }
  }catch(_){}
  const callId = data.callId || data.call_id || data.tag || '';
  // FIX: every push used to get call-style "Answer/Decline" buttons, insistent
  // vibration, and requireInteraction — including a plain "X is live" alert,
  // which made no sense (there's nothing to answer or decline) and could read
  // as a real incoming call. Only an actual call gets that treatment now.
  const isCall = data.type === 'incoming_call' || (!data.type && !!callId);
  if(isCall){
    if(callId && isCallHandled(callId)) return;
    const title = data.title || 'Incoming call — Naluno';
    const body = data.body || 'Tap to answer';
    event.waitUntil((async ()=>{
      const opts = {
        body, icon: './icon-192.png', badge: './icon-192.png',
        tag: callId || 'naluno-call',
        renotify: true,
        requireInteraction: true,
        silent: false,
        vibrate: [500, 200, 500, 200, 500, 200, 500],
        data: { callId, type: 'incoming_call', url: callId ? ('./?call=' + encodeURIComponent(callId)) : './' },
        actions: [
          { action: 'answer', title: 'Answer' },
          { action: 'decline', title: 'Decline' },
        ],
      };
      await self.registration.showNotification(title, opts);
      const clientList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for(const client of clientList){
        try{ client.postMessage({ type: 'naluno-incoming-call', callId }); }catch(_){}
      }
      // One follow-up only, and only if the call is still ringing. A second
      // delayed re-show at 6s is why the notification kept insisting after
      // the lobby was already closed.
      if(callId){
        await new Promise(r => setTimeout(r, 2500));
        if(isCallHandled(callId)){
          await closeCallNotifications(callId);
          return;
        }
        await self.registration.showNotification(title, Object.assign({}, opts, { renotify: true }));
      }
    })());
    return;
  }
  // Non-call push (e.g. "X is live") — a normal, single, tap-to-open alert.
  const title = data.title || 'Naluno';
  const body = data.body || '';
  const broadcastId = data.broadcastId || '';
  event.waitUntil((async ()=>{
    await self.registration.showNotification(title, {
      body, icon: './icon-192.png', badge: './icon-192.png',
      tag: (data.type || 'naluno') + ':' + (broadcastId || Date.now()),
      renotify: false,
      requireInteraction: false,
      silent: false,
      data: { type: data.type || 'general', broadcastId, url: broadcastId ? ('./?broadcast=' + encodeURIComponent(broadcastId)) : './' },
    });
  })());
});

self.addEventListener('notificationclick', event=>{
  event.notification.close();
  const data = event.notification.data || {};
  if(data.type && data.type !== 'incoming_call'){
    // Non-call notification: just open/focus the app at the right place —
    // never post a fake "incoming call" message for something that isn't one.
    const target = data.url || './';
    event.waitUntil(
      self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList=>{
        for(const client of clientList){
          if('focus' in client) return client.focus();
        }
        if(self.clients.openWindow) return self.clients.openWindow(target);
      })
    );
    return;
  }
  const callId = data.callId || '';
  const action = event.action || '';
  if(action === 'decline'){
    markCallHandled(callId);
    event.waitUntil((async ()=>{
      await closeCallNotifications(callId);
      const clientList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for(const client of clientList){
        try{ client.postMessage({ type: 'naluno-decline-call', callId }); }catch(_){}
      }
    })());
    return;
  }
  const target = callId ? ('./?call=' + encodeURIComponent(callId)) : (data.url || './');
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList=>{
      for(const client of clientList){
        if('focus' in client){
          client.postMessage({ type: 'naluno-incoming-call', callId });
          return client.focus();
        }
      }
      if(self.clients.openWindow) return self.clients.openWindow(target);
    })
  );
});
