const CACHE = "cm-checklist-beta-v2";
const ASSETS = ["./", "./index.html", "./app.js", "./manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.map(k => (k !== CACHE ? caches.delete(k) : null)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Only cache same-origin app files
  if (url.origin === location.origin) {
    event.respondWith(
      caches.match(req).then((cached) => cached || fetch(req))
    );
  }
});
