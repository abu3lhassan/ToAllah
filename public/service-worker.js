const CACHE_NAME = "toallah-pwa-v2";
const APP_SHELL = [
  "/",
  "/index.html",
  "/manifest.webmanifest",
  "/apple-touch-icon.png",
  "/icons/icon-192x192.png",
  "/icons/icon-512x512.png"
];

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL).catch(() => {}))
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);

  // Only handle GET requests on our own origin
  if (request.method !== "GET") return;
  if (url.origin !== self.location.origin) return;

  // Never intercept API calls — always go to network
  if (url.pathname.startsWith("/api/")) return;

  // Navigation requests: network first, fall back to cached index.html for offline
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() => caches.match("/index.html"))
    );
    return;
  }

  // App shell static assets: cache first
  if (APP_SHELL.some((p) => url.pathname === p)) {
    event.respondWith(
      caches.match(request).then((cached) => cached || fetch(request))
    );
    return;
  }

  // Icons and fonts: cache first, cache on first fetch
  if (url.pathname.startsWith("/icons/") || url.pathname.startsWith("/fonts/")) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return response;
        });
      })
    );
    return;
  }

  // JS/CSS app files: always network-first, bypass HTTP cache entirely
  if (["/app.js", "/styles.css", "/config.js"].includes(url.pathname)) {
    event.respondWith(
      fetch(new Request(request, { cache: "no-store" }))
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  // Everything else (dynamic pages, etc.): network only — no caching
});
