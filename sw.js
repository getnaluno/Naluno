// Minimal service worker. Its core job is still just existing and registering —
// that's what makes Chrome/Edge/Android consider Naluno installable at all.
// It also now handles background push notifications for incoming calls, which is
// the one thing that can reach you while the app itself isn't open.

self.addEventListener('install', ()=> self.skipWaiting());
self.addEventListener('activate', ()=> self.clients.claim());
self.addEventListener('fetch', ()=>{ /* pass-through — no offline caching yet, by design */ });

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
