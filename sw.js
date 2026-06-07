// WAŻNE: index.html nigdy nie jest cachowany — zawsze pobierany świeżo z sieci.
// Zmiana wersji cache wymusza usunięcie starych wpisów u wszystkich użytkowników.
const CACHE = 'portal-v3.0.0';
const STATIC = ['/manifest.json'];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(STATIC)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (url.origin !== location.origin) return;

  // index.html: ZAWSZE świeży z sieci — nigdy z cache SW
  // (portal wymaga internetu do działania, cached HTML = stary zepsуty kod)
  if (url.pathname === '/' || url.pathname === '/index.html') {
    e.respondWith(fetch(e.request));
    return;
  }

  // Inne zasoby (manifest, ikony): sieć-first, cache jako fallback offline
  e.respondWith(
    fetch(e.request)
      .then(res => {
        if (res.ok) caches.open(CACHE).then(c => c.put(e.request, res.clone()));
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
