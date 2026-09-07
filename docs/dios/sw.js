/* オフライン用の固定説明だけ保存。認証情報・API・会話・業務画面はキャッシュしない。 */
/* global self, caches, fetch, URL */
const CACHE = 'dios-offline-v1';
self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.add('/dios/offline')));
});
self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith('dios-offline-') && key !== CACHE).map((key) => caches.delete(key)))));
});
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || event.request.mode !== 'navigate' || url.origin !== self.location.origin || !['/dios', '/dios/'].includes(url.pathname)) return;
  event.respondWith(fetch(event.request).catch(() => caches.open(CACHE).then((cache) => cache.match('/dios/offline'))));
});
