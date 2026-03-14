const CACHE_NAME = "chasingmajors-checklist-v3";
const APP_SHELL = [
  "./",
  "./index.html",
  "./app.js",
  "./manifest.webmanifest"
];

self.addEventListener("install", (event) => {
  self.skipWaiting();

  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(APP_SHELL);
    })
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();

      await Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );

      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;

  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // Never cache Apps Script API calls
  if (url.hostname.includes("script.google.com")) {
    event.respondWith(fetch(req));
    return;
  }

  // For page navigations: network first, cache fallback
  if (req.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(req);
          const cache = await caches.open(CACHE_NAME);
          cache.put("./index.html", fresh.clone());
          return fresh;
        } catch (err) {
          const cached = await caches.match("./index.html");
          return cached || Response.error();
        }
      })()
    );
    return;
  }

  // For local app shell files: stale-while-revalidate
  if (
    url.origin === self.location.origin &&
    (url.pathname.endsWith("/app.js") ||
      url.pathname.endsWith("/index.html") ||
      url.pathname.endsWith("/manifest.webmanifest") ||
      url.pathname === self.location.pathname ||
      url.pathname.endsWith("/"))
  ) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_NAME);
        const cached = await cache.match(req);

        const networkFetch = fetch(req)
          .then((fresh) => {
            cache.put(req, fresh.clone());
            return fresh;
          })
          .catch(() => null);

        return cached || (await networkFetch) || Response.error();
      })()
    );
    return;
  }

  // Default: network first, cache fallback
  event.respondWith(
    (async () => {
      try {
        return await fetch(req);
      } catch (err) {
        const cached = await caches.match(req);
        return cached || Response.error();
      }
    })()
  );
});
