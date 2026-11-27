'use strict';
const COVER_CACHE = 'annas-annals-covers-v1';
const MAX_COVERS = 300;
let generation = 0;
const pending = new Set();

self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', event => {
  const request = event.request, url = new URL(request.url);
  if (request.method !== 'GET' || request.destination !== 'image' || url.origin !== 'https://covers.openlibrary.org' || !url.pathname.startsWith('/b/isbn/')) return;
  const current = generation;
  const work = (async () => {
    let cache;
    try { cache = await caches.open(COVER_CACHE); }
    catch { return fetch(request); }
    const existing = await cache.match(request);
    if (existing) return existing;
    // Prefer responses whose image bytes the cover cache can measure.
    const response = await fetch(request, { mode: 'cors', credentials: 'omit' })
      .catch(() => fetch(request));
    if ((response.ok || response.type === 'opaque') && current === generation) {
      try {
        await cache.put(request, response.clone());
        const keys = await cache.keys();
        while (keys.length > MAX_COVERS) await cache.delete(keys.shift());
      } catch { /* A full or unavailable cache must not block the image. */ }
    }
    return response;
  })();
  pending.add(work); work.finally(() => pending.delete(work)).catch(() => {});
  event.respondWith(work);
});
self.addEventListener('message', event => {
  if (event.data?.type !== 'CLEAR_COVER_CACHE') return;
  generation++;
  const work = (async () => {
    await Promise.allSettled([...pending]);
    await caches.delete(COVER_CACHE);
  })();
  event.waitUntil(work);
  work.then(() => event.ports[0]?.postMessage({ok:true}), () => event.ports[0]?.postMessage({ok:false}));
});
