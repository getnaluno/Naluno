// Naluno service worker — offline shell + background call push.
const CACHE_NAME = 'naluno-shell-v3';
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

  event.respondWith(
    fetch(event.request).then(response=>{
      const copy = response.clone();
      caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy)).catch(()=>{});
      return response;
    }).catch(()=>{
      return caches.match(event.request).then(cached=>{
        if(cached) return cached;
        if(event.request.mode === 'navigate') return caches.match('./index.html');
        return new Response('', { status: 503, statusText: 'Offline' });
      });
    })
  );
});

importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-messaging-compat.js');
importScripts('firebase-config.js');

try{
  firebase.initializeApp(firebaseConfig);
  const messaging = firebase.messaging();
  messaging.onBackgroundMessage(payload=>{
    const data = (payload && payload.data) || {};
    const title = data.title || (payload.notification && payload.notification.title) || 'Incoming call — Naluno';
    const body = data.body || (payload.notification && payload.notification.body) || 'Tap to answer';
    const callId = data.callId || data.call_id || '';

    self.registration.showNotification(title, {
      body,
      icon: 'icon-192.png',
      badge: 'icon-192.png',
      tag: callId ? ('naluno-call-' + callId) : 'naluno-call',
      renotify: true,
      requireInteraction: true,
      vibrate: [500,200,500,200,500,200,500,200,500,200,500,200,500],
      data: {
        callId,
        type: data.type || 'incoming_call',
        url: callId ? ('./?call=' + encodeURIComponent(callId)) : './',
      },
      actions: [
        { action: 'answer', title: 'Answer' },
        { action: 'dismiss', title: 'Dismiss' },
      ],
    });
  });
}catch(e){
  // Config missing or messaging unsupported — SW still serves the offline shell.
}

self.addEventListener('notificationclick', event=>{
  const data = (event.notification && event.notification.data) || {};
  const action = event.action || 'answer';
  event.notification.close();

  if(action === 'dismiss') return;

  const targetUrl = data.url || (data.callId ? ('./?call=' + encodeURIComponent(data.callId)) : './');

  event.waitUntil((async ()=>{
    const list = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    for(const client of list){
      // Prefer an existing Naluno tab: focus it and tell it about the call.
      if('focus' in client){
        await client.focus();
        try{
          client.postMessage({
            type: 'naluno-incoming-call',
            callId: data.callId || null,
            action: 'answer',
          });
        }catch(_){}
        return;
      }
    }
    if(clients.openWindow){
      return clients.openWindow(targetUrl);
    }
  })());
});
