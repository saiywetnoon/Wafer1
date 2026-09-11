/* ============================================================
   SERVICE WORKER — installable PWA + offline-first shell
   ------------------------------------------------------------
   - Pre-caches the app shell (index.html, css, js, icons).
   - Navigation requests: NETWORK first, fall back to the cached
     page when offline (so the app always opens even without net).
   - Same-origin static assets: stale-while-revalidate (instant
     from cache, updated in the background). The ?v= query strings
     on script/style links change per build, so new builds never
     serve stale files from this cache.
   Bump CACHE_VERSION whenever the shell changes.
   ============================================================ */
const CACHE_VERSION = 'crp-shell-v1';
const APP_SHELL = [
  './',
  './index.html',
  './css/styles.css',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/icon.svg',
  './hkop_kop_favicon.ico'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_VERSION).then(function (cache) {
      return cache.addAll(APP_SHELL).catch(function (err) {
        // A single missing entry must not block the whole install.
        console.warn('[SW] precache partial', err);
      });
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys.filter(function (k) { return k !== CACHE_VERSION; })
          .map(function (k) { return caches.delete(k); })
      );
    }).then(function () { return self.clients.claim(); })
  );
});

/* True for app shell page navigations. */
function isNavigation(req) {
  return req.mode === 'navigate' ||
    (req.method === 'GET' && req.destination === 'document');
}
/* Same-origin static asset (js/css/png/ico/json/manifest/svg). */
function isSameOriginStatic(url) {
  return url.origin === self.location.origin &&
    /\.(js|css|png|ico|svg|json|webmanifest|woff2?)$/i.test(url.pathname);
}

self.addEventListener('fetch', function (event) {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // 1) Page navigations: network first, cached page when offline.
  if (isNavigation(req)) {
    event.respondWith(
      fetch(req).then(function (res) {
        const copy = res.clone();
        caches.open(CACHE_VERSION).then(function (c) { c.put('./index.html', copy); });
        return res;
      }).catch(function () {
        return caches.match('./index.html').then(function (hit) {
          return hit || caches.match('./');
        });
      })
    );
    return;
  }

  // 2) Our own static assets: stale-while-revalidate.
  if (isSameOriginStatic(url)) {
    event.respondWith(
      caches.match(req).then(function (hit) {
        const network = fetch(req).then(function (res) {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE_VERSION).then(function (c) { c.put(req, copy); });
          }
          return res;
        }).catch(function () { return hit; });
        return hit || network;
      })
    );
    return;
  }

  // 3) Everything else (CDNs, Supabase, fonts): network only.
  return;
});