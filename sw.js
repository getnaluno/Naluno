// Minimal service worker. Its only job right now is to exist and register —
// that's what makes Chrome/Edge/Android consider Naluno installable at all.
// A real offline-caching strategy (cache the shell, fall back when offline) is a
// natural next step once the app itself has stabilized, not before.

self.addEventListener('install', ()=> self.skipWaiting());
self.addEventListener('activate', ()=> self.clients.claim());
self.addEventListener('fetch', ()=>{ /* pass-through — no caching yet, by design */ });
