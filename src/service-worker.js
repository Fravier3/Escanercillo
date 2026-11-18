/* global version, paths */
const scope = self.registration.scope;
const prefix = 'escanercillo-' + scope + '-';
const name = prefix + version;
const urls = new Set(paths.map(path => new URL(path, scope).href));
// Only immutable, same-origin build files are cached here. Match the cached
// bytes even if module requests carry different Origin headers from precache.
const staticMatch = { ignoreVary: true };

self.addEventListener('install', event => {
  event.waitUntil(caches.open(name).then(cache => cache.addAll(
    Array.from(urls, url => new Request(url, { cache: 'reload' }))
  )));
});

self.addEventListener('message', ({ data }) => {
  if (data === 'activate') self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const prior = (await caches.keys()).filter(key => key.startsWith(prefix) && key !== name);
    // Keep one prior build for a second tab still editing a document.
    await Promise.all(prior.slice(0, -1).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET' || !request.url.startsWith(scope)) return;
  if (request.mode === 'navigate') {
    event.respondWith(caches.open(name).then(async cache => (await cache.match(new URL('index.html', scope).href)) ?? fetch(request)));
    return;
  }
  if (urls.has(request.url)) {
    event.respondWith(caches.open(name).then(async cache => (await cache.match(request, staticMatch)) ?? fetch(request)));
    return;
  }
  if (/\/(?:assets\/|engine-[a-f0-9]+\/)/.test(new URL(request.url).pathname)) {
    event.respondWith((async () => {
      for (const key of (await caches.keys()).filter(key => key.startsWith(prefix)).reverse()) {
        const match = await (await caches.open(key)).match(request, staticMatch);
        if (match) return match;
      }
      return fetch(request);
    })());
  }
});
