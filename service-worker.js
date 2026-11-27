'use strict';
const COVER_CACHE = 'annas-annals-covers-v1';
self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('message', event => {
  if (event.data?.type !== 'CLEAR_COVER_CACHE') return;
  const work = caches.delete(COVER_CACHE);
  event.waitUntil(work);
  work.then(() => event.ports[0]?.postMessage({ok:true}), () => event.ports[0]?.postMessage({ok:false}));
});
