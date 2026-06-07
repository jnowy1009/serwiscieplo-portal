// Portal nie wymaga Service Workera — działa tylko online (Supabase).
// Ten SW usuwa wszystkie stare cache i wyrejestrowuje siebie,
// żeby żadne cachowanie nie mogło zakłócać ładowania danych.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.map(k => caches.delete(k))))
      .then(() => self.registration.unregister())
  );
});
