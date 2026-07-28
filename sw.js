// This used to do nothing — every load required the network, full stop, with no
// fallback. That's the entire reason the app couldn't open offline at all, and why
// offline showed the browser's own blank error page instead of anything from Naluno:
// nothing was ever cached for the browser to fall back to.
const CACHE_NAME = 'naluno-shell-v1';
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
    caches.open(CACHE_NAME).then(cache => cache.addAll(CORE_ASSETS).catch(()=>{
      // A single failed asset (e.g. genuinely offline during install itself)
      // shouldn't block the whole service worker from installing.
    }))
  );
});

self.addEventListener('activate', event=>{
  self.clients.claim();
  // Clean out any cache left over from a previous version of this service worker.
  event.waitUntil(
    caches.keys().then(names => Promise.all(
      names.filter(n => n !== CACHE_NAME).map(n => caches.delete(n))
    ))
  );
});

self.addEventListener('fetch', event=>{
  if(event.request.method !== 'GET') return; // never intercept writes

  const url = new URL(event.request.url);
  const isSameOrigin = url.origin === self.location.origin;
  const isFirebaseSdkScript = url.hostname === 'www.gstatic.com' && url.pathname.includes('firebasejs');
  // Anything else — Firestore's own real-time channel, FCM, auth endpoints — passes
  // straight through untouched. Those already have their own offline handling
  // (Firestore's persistence layer, enabled separately); caching or replaying that
  // traffic here would risk serving stale data instead of letting Firestore manage
  // its own sync correctly.
  if(!isSameOrigin && !isFirebaseSdkScript) return;

  event.respondWith(
    fetch(event.request).then(response=>{
      // Network succeeded — this is the freshest copy, so update the cache with it.
      // This is also what keeps a genuinely new deploy from being stuck behind an old
      // cached version once you're back online (the update-check banner still works
      // exactly as before; this only ever affects what's served when offline).
      const copy = response.clone();
      caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy)).catch(()=>{});
      return response;
    }).catch(()=>{
      // Network failed — genuinely offline. Fall back to whatever's cached.
      return caches.match(event.request).then(cached=>{
        if(cached) return cached;
        // Nothing cached for this exact request — for the page itself specifically,
        // fall back to the cached app shell so it still opens looking like Naluno
        // instead of the browser's own blank offline page.
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
    const title = (payload.notification && payload.notification.title) || 'Incoming call — Naluno';
    const body = (payload.notification && payload.notification.body) || 'Tap to answer';
    self.registration.showNotification(title, {
      body,
      icon: 'icon-192.png',
      tag: 'naluno-call', // replaces any earlier call notification rather than stacking them
      requireInteraction: true, // stays on screen until actually dismissed or tapped,
                                 // instead of politely disappearing after a few seconds
      vibrate: [400, 200, 400, 200, 400, 200, 400], // a real, deliberate ring pattern —
                                                     // not the default single soft buzz
      renotify: true, // re-vibrates/re-alerts even if a previous call notification
                       // with the same tag is still showing
    });
  });
}catch(e){
  // firebase-config.js still has placeholder values, or messaging isn't supported here —
  // the service worker still registers fine, background push just won't fire.
}

self.addEventListener('notificationclick', event=>{
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type:'window' }).then(list=>{
      for(const client of list){ if('focus' in client) return client.focus(); }
      if(clients.openWindow) return clients.openWindow('./');
    })
  );
});
