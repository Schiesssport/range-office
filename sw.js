// =============================================================================
// OpenRangeOffice service worker.
//
// Cache-first with stale-while-revalidate: every GET is served from the cache
// immediately (no network wait — page loads stay snappy even on a flaky range
// network), while a background fetch refreshes the cached entry for next time.
// If a request misses the cache (e.g. a brand-new resource not in ASSETS), we
// fall through to the network and only error out when both fail.
//
// Update delivery still goes through the SW lifecycle, not the fetch handler:
// `app.js` calls `registration.update()` on every load, the browser fetches
// this script, and a byte change triggers install (pre-warming a fresh cache
// under the new CACHE_NAME). The `Updates` class in app.js then prompts the
// user; accepting it posts SKIP_WAITING and reloads.
//
// CACHE_NAME is stamped at delivery time, never hand-edited:
//   * GitHub Actions deploy stamps the release tag (see deploy.yml).
//   * `npm run prod` stamps a startup timestamp so you can dry-run the
//     production cache strategy locally.
//   * `npm run dev` leaves the placeholder untouched. That literal value is
//     also our signal for "this is development" — the fetch handler switches
//     to network-first so reloads pick up edits immediately.
// =============================================================================

const CACHE_NAME = '__CACHE_VERSION__';
const IS_DEV = CACHE_NAME === '__CACHE_VERSION__';
const ASSETS = [
    './',
    'index.html',
    'styles.css',
    'manifest.webmanifest',
    'icon.svg',
    'src/app.js',
    'src/core/escape.js',
    'src/core/translations.js',
    'src/core/categories.js',
    'src/core/barcodes.js',
    'src/core/csv.js',
    'src/core/licenses.js',
    'src/core/updates.js',
    'src/core/ids.js',
    'src/core/matches.js',
    'src/core/scorecards.js',
    'src/vendor/JsBarcode.all.min.js',
    'src/vendor/pdf.min.js',
    'src/vendor/pdf.worker.min.js',
];

self.addEventListener('install', (event) => {
    event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)));
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) =>
            Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
        )
    );
});

const fetchAndCache = (request, cache) => fetch(request).then((response) => {
    if (response && response.ok && new URL(request.url).origin === self.location.origin) {
        cache.put(request, response.clone()).catch(() => {});
    }
    return response;
}).catch(() => null);

self.addEventListener('fetch', (event) => {
    if (event.request.method !== 'GET') return;
    event.respondWith((async () => {
        const cache = await caches.open(CACHE_NAME);
        if (IS_DEV) {
            // Network-first on localhost: reloads always pick up code edits,
            // and we still fall back to the cache when the dev server is down
            // so PWA offline behavior remains testable.
            const fresh = await fetchAndCache(event.request, cache);
            if (fresh) return fresh;
            return (await cache.match(event.request)) || new Response('', { status: 504, statusText: 'offline-no-cache' });
        }
        // Cache-first + stale-while-revalidate on deployed origins.
        const cached = await cache.match(event.request);
        const networkFetch = fetchAndCache(event.request, cache);
        if (cached) {
            event.waitUntil(networkFetch);
            return cached;
        }
        return (await networkFetch) || new Response('', { status: 504, statusText: 'offline-no-cache' });
    })());
});

self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});
