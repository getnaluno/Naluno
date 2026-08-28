// Naluno service worker — offline shell + background call push.
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
const CACHE_NAME = 'naluno-shell-v105';
const CORE_ASSETS = [
  './', './index.html', './manifest.json', './icon-192.png', './icon-512.png',
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
      cache.put(new Request(bare), copy).catch(function(){});
    }).catch(function(){});
  }

  event.respondWith((async ()=>{
    const cached = await caches.match(event.request, { ignoreSearch: true })
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
      if(callId){
        await new Promise(r => setTimeout(r, 2500));
        await self.registration.showNotification(title, Object.assign({}, opts, { renotify: true }));
        await new Promise(r => setTimeout(r, 3500));
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
