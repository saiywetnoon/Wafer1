/* Daily Crispy Roll Ledger — service worker
   Strategy:
   • App shell (same-origin GET)  → cache-first, then network (also fills cache).
   • CDN libraries (jsdelivr/unpkg/fonts) → stale-while-revalidate so the app's
     second open is fully offline-capable even for the third-party libraries.
   The ledger data itself is NEVER cached by this worker — it lives in the user's
   browser storage and on Supabase; uploading happens in page JS, not the SW. */

const CACHE = 'roll-ledger-v2';

const APP_SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './css/tailwind.css',
  './css/styles.css',
  './js/config.js',
  './js/supabase.js',
  './js/storage.js',
  './js/google.js',
  './js/helpers.js',
  './js/modal.js',
  './js/pricing.js',
  './js/usage.js',
  './js/ledger.js',
  './js/sales.js',
  './js/dashboard.js',
  './js/calendar.js',
  './js/csv.js',
  './js/sync-ui.js',
  './js/sample-data.js',
  './js/inventory.js',
  './js/customers.js',
  './js/suppliers.js',
  './js/tools.js',
  './js/pan-timers.js',
  './js/cash.js',
  './js/companies.js',
  './js/auth.js',
  './js/cloud.js',
  './js/ai.js',
  './js/init.js',
  './hkop_kop_favicon.ico'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE).then(function (cache) {
      return cache.addAll(APP_SHELL);
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

function isCdn(url) {
  return /(^|\.)(jsdelivr\.net|unpkg\.com|googleapis\.com|gstatic\.com)$/.test(url.hostname);
}

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);

  // Third-party libraries: serve cached copy instantly; refresh it in the
  // background so the cache stays current.
  if (isCdn(url)) {
    event.respondWith(
      caches.match(req).then(function (cached) {
        var fetchP = fetch(req).then(function (res) {
          if (res && res.ok) {
            var copy = res.clone();
            caches.open(CACHE).then(function (cache) { cache.put(req, copy); });
          }
          return res;
        }).catch(function () { return cached; });
        return cached || fetchP;
      })
    );
    return;
  }

  // Navigations (the HTML shell): NETWORK-first. Vercel serves index.html with
  // Cache-Control: max-age=0, so every deploy is picked up on the next load;
  // the cached copy is only a fallback for offline.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).then(function (res) {
        if (res && res.ok && url.origin === location.origin) {
          var copy = res.clone();
          caches.open(CACHE).then(function (cache) { cache.put(req, copy); });
        }
        return res;
      }).catch(function () {
        return caches.match(req).then(function (cached) {
          return cached || caches.match('./index.html');
        });
      })
    );
    return;
  }

  // Same-origin static assets (versioned with ?v=...): cache-first with a
  // background refresh so changed files (new query) are fetched after reload.
  event.respondWith(
    caches.match(req).then(function (cached) {
      var fetchP = fetch(req).then(function (res) {
        if (res && res.ok && url.origin === location.origin) {
          var copy = res.clone();
          caches.open(CACHE).then(function (cache) { cache.put(req, copy); });
        }
        return res;
      }).catch(function () { return cached; });
      return cached || fetchP;
    })
  );
});