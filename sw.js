// Naluno service worker — offline shell + background call push.
// v28: Network-first for JS/CSS WITH cache fallback so offline open works.
const CACHE_NAME = 'naluno-shell-v63';
const CORE_ASSETS = [
  './', './index.html', './manifest.json', './icon-192.png', './icon-512.png',
  './firebase-config.js', './css/app.css',
  './js/core.js', './js/metrics.js', './js/data.js', './js/crypto.js', './js/atmosphere.js',
  './js/pwa.js', './js/auth.js', './js/camera.js', './js/call-filters.js', './js/calls.js', './js/media-vault.js', './js/wireline.js',
  './js/band-room.js', './js/band-list.js', './js/broadcast-core.js', './js/broadcast-space.js',
  './js/broadcast-live.js', './js/broadcast-composer.js', './js/broadcast-upload.js',
  './js/signal-core.js', './js/signal-ui.js',
  './js/sfu-live.js', './js/compass.js', './js/beacon.js', './js/find.js', './js/profile.js', './js/notifications.js',
  './js/ice-core.js', './js/compat-lock.js', './js/keep-alive.js', './js/media-contain.js',
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
  const url = new URL(event.request.url);
  const isSameOrigin = url.origin === self.location.origin;
  const isFirebaseSdkScript = url.hostname === 'www.gstatic.com' && url.pathname.includes('firebasejs');
  if(!isSameOrigin && !isFirebaseSdkScript) return;

  const path = url.pathname || '';
  const isAppCode = path.includes('/js/') || path.endsWith('.js') ||
    path.includes('/css/') || path.endsWith('.css') || path.endsWith('firebase-config.js');

  if(isAppCode || isFirebaseSdkScript){
    event.respondWith(
      caches.match(event.request, { ignoreSearch: true }).then(cached => {
        const net = fetch(event.request).then(response=>{
          if(response && response.ok && isSameOrigin){
            const copy = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy)).catch(()=>{});
          }
          return response;
        });
        if(cached){
          net.catch(()=>{});
          return cached;
        }
        return net.catch(() =>
          caches.match(url.pathname).then(c2 => c2 || fetch(event.request))
        );
      })
    );
    return;
  }

  const isNav = event.request.mode === 'navigate' || path.endsWith('.html') || path.endsWith('/');
  if(isNav){
    event.respondWith(
      caches.match('./index.html').then(cached => {
        const net = fetch(event.request).then(response=>{
          if(response && response.ok){
            const copy = response.clone();
            caches.open(CACHE_NAME).then(cache => {
              cache.put(event.request, copy);
              cache.put('./index.html', response.clone()).catch(()=>{});
            }).catch(()=>{});
          }
          return response;
        });
        if(cached){ net.catch(()=>{}); return cached; }
        return net.catch(()=> caches.match('/index.html'));
      })
    );
    return;
  }
  event.respondWith(
    fetch(event.request).then(response=>{
      if(response.ok && (path.includes('manifest') || path.includes('icon'))){
        const copy = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy)).catch(()=>{});
      }
      return response;
    }).catch(()=>{
      return caches.match(event.request).then(cached => cached || new Response('', { status: 503 }));
    })
  );
});

self.addEventListener('push', event=>{
  let data = {};
  try{ data = event.data ? event.data.json() : {}; }catch(e){ try{ data = { body: event.data.text() }; }catch(_){} }
  // FCM web often nests: { notification: {title,body}, data: { callId, ... } }
  try{
    if(data.data && typeof data.data === 'object'){
      data = Object.assign({}, data, data.data);
    }
    if(data.notification && typeof data.notification === 'object'){
      if(!data.title && data.notification.title) data.title = data.notification.title;
      if(!data.body && data.notification.body) data.body = data.notification.body;
    }
  }catch(_){}
  const title = data.title || 'Incoming call — Naluno';
  const body = data.body || 'Tap to answer';
  const callId = data.callId || data.call_id || data.tag || '';
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
    // Second + third notification so the phone keeps sounding if the first was quiet
    if(callId){
      await new Promise(r => setTimeout(r, 2500));
      await self.registration.showNotification(title, Object.assign({}, opts, { renotify: true }));
      await new Promise(r => setTimeout(r, 3500));
      await self.registration.showNotification(title, Object.assign({}, opts, { renotify: true }));
    }
  })());
});

self.addEventListener('notificationclick', event=>{
  event.notification.close();
  const data = event.notification.data || {};
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
