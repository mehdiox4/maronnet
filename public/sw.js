'use strict';
// Service worker MARONET 360 : met en cache le shell de l'application (jamais l'API).
const V = 'm360-v1';
const SHELL = ['/', '/index.html', '/css/app.css', '/js/core.js', '/js/forms.js', '/js/views.js', '/js/pages.js', '/js/main.js', '/manifest.webmanifest', '/icons/logo.png', '/icons/icon-192.png'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(V).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== V).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin || u.pathname.startsWith('/api/')) return; // l'API et les données ne sont jamais mises en cache
  // réseau d'abord (toujours à jour), cache en secours hors ligne
  e.respondWith(fetch(e.request).then((r) => { if (r.ok) { const c = r.clone(); caches.open(V).then((ca) => ca.put(e.request, c)); } return r; })
    .catch(() => caches.match(e.request).then((m) => m || (e.request.mode === 'navigate' ? caches.match('/index.html') : Response.error()))));
});
