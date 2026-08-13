// Naluno service worker — offline shell + background call push.
// v4: NEVER cache JS/CSS (stale modules were breaking Signal/calls after deploys).
const CACHE_NAME = 'naluno-shell-v7';
const CORE_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
];

self.addEventListener('install', event=>{
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(CORE_ASSETS).catch(()=>{}))
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

  // Always network for app code — never serve stale modules
  const path = url.pathname || '';
  if(path.includes('/js/') || path.endsWith('.js') || path.includes('/css/') || path.endsWith('.css') || path.endsWith('firebase-config.js')){
    event.respondWith(
      fetch(event.request).catch(() => caches.match(event.request))
    );
    return;
  }

  event.respondWith(
    fetch(event.request).then(response=>{
      // Only cache shell assets, not API/media
      if(response.ok && (path.endsWith('.html') || path.endsWith('/') || path.includes('manifest') || path.includes('icon'))){
        const copy = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy)).catch(()=>{});
      }
      return response;
    }).catch(()=>{
      return caches.match(event.request).then(cached=>{
        if(cached) return cached;
        if(event.request.mode === 'navigate') return caches.match('./index.html');
        return new Response('', { status: 503 });
      });
    })
  );
});

// Push: incoming call
self.addEventListener('push', event=>{
  let data = {};
  try{ data = event.data ? event.data.json() : {}; }catch(e){ try{ data = { body: event.data.text() }; }catch(_){} }
  const title = data.title || 'Incoming call — Naluno';
  const body = data.body || 'Tap to answer';
  const callId = data.callId || data.tag || '';
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: './icon-192.png',
      badge: './icon-192.png',
      tag: callId ? ('naluno-call-' + callId) : 'naluno-call',
      renotify: true,
      requireInteraction: true,
      data: data,
      actions: [
        { action: 'answer', title: 'Answer' },
        { action: 'decline', title: 'Decline' },
      ],
    })
  );
});

self.addEventListener('notificationclick', event=>{
  event.notification.close();
  const data = event.notification.data || {};
  const action = event.action;
  event.waitUntil((async ()=>{
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for(const c of clients){
      try{
        c.postMessage({
          type: 'naluno-incoming-call',
          action: action || 'open',
          callId: data.callId || null,
          data,
        });
        if('focus' in c) await c.focus();
        return;
      }catch(_){}
    }
    if(self.clients.openWindow){
      await self.clients.openWindow('./');
    }
  })());
});
