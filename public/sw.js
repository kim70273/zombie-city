/* 좀비시티 service worker: hashed assets cache-first, shell network-first */
const CACHE = 'zc-v1';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;

  if (url.pathname.includes('/assets/')) {
    // Vite content-hashed assets: immutable, cache-first
    e.respondWith(
      caches.open(CACHE).then((c) =>
        c.match(e.request).then(
          (r) => r || fetch(e.request).then((res) => { c.put(e.request, res.clone()); return res; })
        )
      )
    );
  } else {
    // app shell: network-first, cache fallback for offline launch
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
          return res;
        })
        .catch(() => caches.match(e.request))
    );
  }
});
