/* =====================================================================
   Service Worker — minimal offline cache
   =====================================================================
   The role of this file is to make the app work without an internet
   connection once the user has loaded it at least once. This is what
   turns the site into a real Progressive Web App (PWA), so it behaves
   like a native app after "Add to Home Screen".

   Strategy: cache-first.
     1. On `install`, pre-cache the app's static files (HTML, CSS, JS,
        manifest, icons).
     2. On `fetch`, serve from cache if available; otherwise fall back
        to the network.

   When you change any of the cached files, bump CACHE_VERSION below so
   that old caches get invalidated and clients pick up the new version.
   ===================================================================== */

const CACHE_VERSION = 'cash-register-v1';

// Files that make up the entire app — all relative paths so the SW
// works regardless of the GitHub Pages subpath the site is hosted at.
const APP_SHELL = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

// On install: open the cache and add every file in APP_SHELL.
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then(cache => cache.addAll(APP_SHELL))
  );
  // Activate the new SW immediately on next page load
  self.skipWaiting();
});

// On activate: delete any old caches so we don't keep stale files.
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== CACHE_VERSION)
          .map(key => caches.delete(key))
      )
    )
  );
  // Take control of any open pages right away
  self.clients.claim();
});

// On fetch: cache-first. Try the cache, then fall through to network.
self.addEventListener('fetch', event => {
  // Only handle GET requests — POSTs etc. should always go through.
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      // Not cached: fetch from the network. (We don't cache the response
      // here because the install step already pre-cached the app shell;
      // anything else is probably a one-off / dynamic request.)
      return fetch(event.request);
    })
  );
});
