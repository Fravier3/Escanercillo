/* global version, paths */
const scope = self.registration.scope;
const prefix = 'archivo-pdf-' + scope + '-';
const cacheName = prefix + version;
const staticFiles = new Set(paths.map(path => new URL(path, scope).href));
const staticMatch = { ignoreVary: true };

self.addEventListener('install', event => {
  event.waitUntil(caches.open(cacheName).then(cache => cache.addAll(
    Array.from(staticFiles, url => new Request(url, { cache: 'reload' }))
  )));
});
self.addEventListener('message', ({ data }) => {
  if (data === 'activate') self.skipWaiting();
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const cacheKeys = await caches.keys();
    const earlier = cacheKeys.filter(key => key.startsWith(prefix) && key !== cacheName);
    await Promise.all(earlier.slice(0, -1).map(key => caches.delete(key)));
    const scannerCaches = cacheKeys.filter(key => key.startsWith('escanercillo-' + scope + '-'));
    await Promise.all(scannerCaches.map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET' || !request.url.startsWith(scope)) return;
  const relative = new URL(request.url).pathname.slice(new URL(scope).pathname.length);
  if (request.mode === 'navigate' && (relative === '' || relative === 'index.html')) {
    event.respondWith(caches.open(cacheName).then(async cache => (await cache.match(new URL('./index.html', scope))) ?? fetch(request)));
    return;
  }
  if (staticFiles.has(request.url) || /^(assets|pdf-assets|pdfcraft)\//.test(relative)) {
    event.respondWith((async () => {
      const cache = await caches.open(cacheName);
      const local = await cache.match(request, staticMatch);
      if (local) return local;
      if (relative.startsWith('assets/')) {
        const earlier = await caches.match(request, staticMatch);
        if (earlier) return earlier;
      }
      const response = await fetch(request);
      if (response.ok) event.waitUntil(cache.put(request, response.clone()).catch(() => {}));
      return response;
    })());
  }
});
