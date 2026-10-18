/**
 * Service Worker para funcionamiento rápido en dispositivos móviles.
 * Cachea los recursos estáticos (app shell) y SIEMPRE consulta la red para /api/*.
 */

const CACHE_NAME = 'prospector-nfc-v4';
const RECURSOS_SHELL = [
  './',
  './index.html',
  './css/app.css',
  './js/app.js',
  './js/api.js',
  './js/mapa.js',
  './js/scoring.js',
  './js/ruta.js',
  './manifest.webmanifest',
  './icons/icon.svg'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(RECURSOS_SHELL).catch((err) => {
        console.warn('Advertencia precacheando shell:', err);
      });
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // NUNCA cachear llamadas dinámicas a las APIs
  if (url.pathname.startsWith('/api/')) {
    return;
  }

  // Network-first con fallback a cache para recursos de la app
  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200 && event.request.method === 'GET') {
          const respClonada = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, respClonada));
        }
        return networkResponse;
      })
      .catch(() => caches.match(event.request))
  );
});
